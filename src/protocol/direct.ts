import { isAddressEqual, type Address } from 'viem'
import { client, CONTRACTS, erc20Abi, PIN } from './config'
import { coreAbi, genesisAbi, stakingAbi } from './abis'
import { verifyGraph } from './transactions'
import type { Account, Economy, Snapshot, Squeek } from './types'

export function parseTokenIds(input: string): bigint[] {
  const entries = input.trim().split(/[\s,]+/)
  if (!input.trim() || entries.length > 32 || entries.some(s => !/^\d+$/.test(s) || BigInt(s) <= 0n)) throw new Error('Enter 1–32 positive token IDs, separated by commas.')
  const ids = entries.map(BigInt)
  if (new Set(ids.map(String)).size !== ids.length) throw new Error('Each token ID must appear only once.')
  return ids.sort((a, b) => a < b ? -1 : 1)
}

/** A clearly labeled, partial inventory, recovered entirely from the pinned onchain graph. */
export async function loadDirect(owner: Address, input: string, signal?: AbortSignal): Promise<Snapshot> {
  const ids = parseTokenIds(input)
  const block = await client.getBlock()
  if (!block.hash || block.number === null) throw new Error('Unable to read Sepolia. Refresh to try again.')
  const blockNumber = block.number
  await verifyGraph(blockNumber)
  const [state, maximum, open, paused, parameters, policy, balance, liveClaimable, stake, power, recipient] = await Promise.all([
    client.readContract({ address: CONTRACTS.core, abi: coreAbi, functionName: 'state', blockNumber }),
    client.readContract({ address: CONTRACTS.genesis, abi: genesisAbi, functionName: 'MAXIMUM_LEVEL', blockNumber }),
    client.readContract({ address: CONTRACTS.genesis, abi: genesisAbi, functionName: 'mergesOpen', blockNumber }),
    client.readContract({ address: CONTRACTS.staking, abi: stakingAbi, functionName: 'paused', blockNumber }),
    client.readContract({ address: CONTRACTS.staking, abi: stakingAbi, functionName: 'powerParameters', blockNumber }),
    client.readContract({ address: CONTRACTS.staking, abi: stakingAbi, functionName: 'exitPolicy', blockNumber }),
    client.readContract({ address: CONTRACTS.token, abi: erc20Abi, functionName: 'balanceOf', args: [owner], blockNumber }),
    client.readContract({ address: CONTRACTS.staking, abi: stakingAbi, functionName: 'claimable', args: [owner], blockNumber }),
    client.readContract({ address: CONTRACTS.staking, abi: stakingAbi, functionName: 'stakeOf', args: [owner], blockNumber }),
    client.readContract({ address: CONTRACTS.staking, abi: stakingAbi, functionName: 'accountPower', args: [owner], blockNumber }),
    client.readContract({ address: CONTRACTS.staking, abi: stakingAbi, functionName: 'claimRecipient', args: [owner], blockNumber }),
  ])
  const levels = await Promise.all(Array.from({ length: maximum }, async (_, index) => {
    const [base, cooldown] = await Promise.all([
      client.readContract({ address: CONTRACTS.staking, abi: stakingAbi, functionName: 'basePower', args: [CONTRACTS.genesis, index + 1], blockNumber }),
      client.readContract({ address: CONTRACTS.genesis, abi: genesisAbi, functionName: 'cooldownBlocks', args: [index + 1], blockNumber }),
    ])
    return { base: base.toString(), cooldown: cooldown.toString() }
  }))
  const tokens: Squeek[] = []
  // Bound concurrency for public RPC services.
  for (let offset = 0; offset < ids.length; offset += 4) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    tokens.push(...await Promise.all(ids.slice(offset, offset + 4).map(async id => {
      const [actualOwner, level, next] = await Promise.all([
        client.readContract({ address: CONTRACTS.genesis, abi: genesisAbi, functionName: 'ownerOf', args: [id], blockNumber }),
        client.readContract({ address: CONTRACTS.genesis, abi: genesisAbi, functionName: 'level', args: [id], blockNumber }),
        client.readContract({ address: CONTRACTS.genesis, abi: genesisAbi, functionName: 'nextMergeHeight', args: [id], blockNumber }),
      ])
      let custody: 'wallet' | 'staking' = 'wallet'
      if (isAddressEqual(actualOwner, CONTRACTS.staking)) {
        custody = 'staking'
        const depositor = await client.readContract({ address: CONTRACTS.staking, abi: stakingAbi, functionName: 'depositor', args: [CONTRACTS.genesis, id], blockNumber })
        if (!isAddressEqual(depositor, owner)) throw new Error(`This address is not the depositor of #${id}. Check the ID and try again.`)
      } else if (!isAddressEqual(actualOwner, owner)) throw new Error(`This address does not own #${id}. Check the ID and try again.`)
      return { tokenId: id.toString(), custody, level, basePower: levels[level - 1].base, nextMergeHeight: next.toString(), mergeState: level >= maximum ? 'terminal' as const : !open ? 'merges_closed' as const : next > state.blockHeight ? 'cooldown' as const : 'ready' as const, metadataStatus: 'unknown' }
    })))
  }
  const envelope = { status: 'available', release: { id: PIN.release }, identities: PIN.identities, chain: { chainId: '11155111', safeThroughBlock: blockNumber.toString(), safeBlockHash: block.hash, safeBlockTimestamp: new Date(Number(block.timestamp) * 1000).toISOString() } }
  const economy: Economy = { ...envelope, nft: { maximumLevel: maximum, mergesOpen: open, basePower: levels.map(l => l.base), cooldownBlocks: levels.map(l => l.cooldown) }, staking: { paused, sqkPerPower: parameters[0].toString(), referencePower: parameters[1].toString(), exitPolicy: { minBps: policy.minBps, maxBps: policy.maxBps } } }
  const account: Account = { ...envelope, account: owner, tokens, nextCursor: null, tokenCounts: { wallet: tokens.filter(t => t.custody === 'wallet').length.toString(), staking: tokens.filter(t => t.custody === 'staking').length.toString() }, rewards: { claimableBaseUnits: liveClaimable.toString() }, power: { nftPower: power[0].toString(), sqkPower: power[1].toString() }, stake: { principalBaseUnits: stake[0].toString(), freshUntilRound: stake[2].toString() }, claimRecipient: BigInt(recipient) === 0n ? null : recipient, economy: { coreBlockHeight: state.blockHeight.toString(), mergesOpen: open, stakingPaused: paused, maximumLevel: maximum } }
  const target = parameters[0] * parameters[1] / 10n ** 18n
  const stakeCandidate = balance < target ? balance : target
  const quoted = await client.readContract({ address: CONTRACTS.staking, abi: stakingAbi, functionName: 'quotePower', args: [stake[0] + stakeCandidate, power[0]], blockNumber })
  return { inventorySource: 'manual', account, economy, balance, liveClaimable, principal: stake[0], nftPower: power[0], sqkPower: power[1], stakeCandidate, stakeGain: quoted - power[1], blockNumber, blockHash: block.hash, verifiedAt: Date.now() }
}
