import { getAddress, isAddress, isAddressEqual, type Address } from 'viem'
import { API, CONTRACTS, PIN, client, erc20Abi } from './config'
import { stakingAbi } from './abis'
import type { Account, Economy, Envelope, Snapshot } from './types'
import { verifyGraph } from './transactions'

export function checkEnvelope(value: unknown): asserts value is Envelope {
  if (!value || typeof value !== 'object') throw new Error('The data service returned an invalid response. Try refreshing.')
  const d = value as Envelope
  if (d.status !== 'available') throw new Error(`Squeekchain data is unavailable${d.reason ? ` (${d.reason.replaceAll('_', ' ')})` : ''}. Try refreshing later.`)
  if (d.release?.id !== PIN.release || d.chain?.chainId !== '11155111') throw new Error('Squeekchain changed its deployment. Transactions are blocked until this app is updated.')
  const i = d.identities
  const checks: [string | undefined, string][] = [
    [i?.core, CONTRACTS.core], [i?.genesis, CONTRACTS.genesis], [i?.token, CONTRACTS.token],
    [i?.mining?.proxy, CONTRACTS.mining], [i?.staking?.proxy, CONTRACTS.staking],
    [i?.mining?.implementation, PIN.identities.mining.implementation], [i?.staking?.implementation, PIN.identities.staking.implementation],
  ]
  if (checks.some(([actual, expected]) => !actual || !isAddress(actual) || !isAddressEqual(actual, expected as Address)) ||
    i.mining.implementationVersion !== PIN.identities.mining.implementationVersion ||
    i.staking.implementationVersion !== PIN.identities.staking.implementationVersion ||
    i.mining.storageLayoutDigest !== PIN.identities.mining.storageLayoutDigest ||
    i.staking.storageLayoutDigest !== PIN.identities.staking.storageLayoutDigest) {
    throw new Error('The data service reports different contracts. Transactions are blocked until this app is updated.')
  }
  if (!/^\d+$/.test(d.chain.safeThroughBlock) || !/^0x[\da-f]{64}$/i.test(d.chain.safeBlockHash)) throw new Error('The data service did not provide a valid snapshot. Refresh to try again.')
}
export async function apiGet<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${API}${path}`, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000), cache: 'no-store', headers: { accept: 'application/json' } })
  if (!response.ok) throw new Error(response.status === 429 ? 'The data service is busy. Wait a moment, then refresh.' : `Unable to load Squeekchain data (HTTP ${response.status}). Refresh to try again.`)
  const result: unknown = await response.json()
  checkEnvelope(result)
  return result as T
}
export async function loadEconomy(signal?: AbortSignal) {
  const d = await apiGet<Economy>('/v1/economy/state', signal)
  if (!d.nft || !Number.isInteger(d.nft.maximumLevel) || d.nft.maximumLevel < 2 || d.nft.maximumLevel > 10 || typeof d.nft.mergesOpen !== 'boolean' || !Array.isArray(d.nft.basePower) || d.nft.basePower.length !== d.nft.maximumLevel ||
      !d.nft.basePower.every(p => /^\d+$/.test(p)) || !Array.isArray(d.nft.cooldownBlocks) || d.nft.cooldownBlocks.length !== d.nft.maximumLevel || !d.nft.cooldownBlocks.every(p => /^\d+$/.test(p)) || !d.staking || !/^\d+$/.test(d.staking.sqkPerPower) || !/^\d+$/.test(d.staking.referencePower) || !d.staking.exitPolicy || !Number.isInteger(d.staking.exitPolicy.minBps) || !Number.isInteger(d.staking.exitPolicy.maxBps)) throw new Error('The level policy is unavailable. Refresh to try again.')
  return d
}
export async function loadAccount(owner: Address, signal?: AbortSignal): Promise<Snapshot> {
  const economy = await loadEconomy(signal)
  let cursor: string | null = null, account: Account | undefined
  const tokens: Account['tokens'] = [], seen = new Set<string>(), cursors = new Set<string>()
  do {
    const query = new URLSearchParams({ limit: '100', ...(cursor ? { cursor } : {}) })
    const page: Account = await apiGet(`/v1/accounts/${owner.toLowerCase()}?${query}`, signal)
    if (!page.account || !isAddress(page.account) || getAddress(page.account) !== getAddress(owner) || !Array.isArray(page.tokens) || !page.tokenCounts || !/^\d+$/.test(page.tokenCounts.wallet) || !/^\d+$/.test(page.tokenCounts.staking) || !page.rewards || !/^\d+$/.test(page.rewards.claimableBaseUnits) || !page.economy || !/^\d+$/.test(page.economy.coreBlockHeight) || typeof page.economy.stakingPaused !== 'boolean') throw new Error('The account response could not be verified. Refresh to try again.')
    if (account && page.chain.safeBlockHash !== account.chain.safeBlockHash) throw new Error('The inventory changed while loading. Refresh to start a new snapshot.')
    for (const token of page.tokens) {
      if (!/^\d+$/.test(token.tokenId) || seen.has(token.tokenId) || !['wallet', 'staking'].includes(token.custody) || !['ready', 'cooldown', 'terminal', 'merges_closed'].includes(token.mergeState) || !Number.isInteger(token.level) || token.level < 1 || token.level > economy.nft.maximumLevel || !/^\d+$/.test(token.nextMergeHeight)) throw new Error('A Squeek record could not be verified. Refresh to try again.')
      seen.add(token.tokenId); tokens.push(token)
    }
    account ??= page
    cursor = page.nextCursor
    if (cursor !== null && typeof cursor !== 'string') throw new Error('The inventory page is incomplete. Refresh to try again.')
    if (cursor && cursors.has(cursor)) throw new Error('The inventory service repeated a page. Refresh to start again.')
    if (cursor) cursors.add(cursor)
    if (tokens.length > 10_000) throw new Error('The inventory exceeds this collection’s supply. Transactions are blocked.')
  } while (cursor !== null)
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
  account.tokens = tokens
  if (BigInt(account.tokenCounts.wallet) + BigInt(account.tokenCounts.staking) !== BigInt(tokens.length)) throw new Error('The inventory is incomplete. Refresh to load all Squeeks.')
  const blockNumber = BigInt(account.chain.safeThroughBlock)
  const block = await client.getBlock({ blockNumber })
  if (!block.hash || block.hash.toLowerCase() !== account.chain.safeBlockHash.toLowerCase()) throw new Error('The chain reorganized. Refresh to load a new snapshot.')
  await verifyGraph(blockNumber)
  const [balance, liveClaimable, stake, power, parameters] = await Promise.all([
    client.readContract({ address: CONTRACTS.token, abi: erc20Abi, functionName: 'balanceOf', args: [owner], blockNumber }),
    client.readContract({ address: CONTRACTS.staking, abi: stakingAbi, functionName: 'claimable', args: [owner], blockNumber }),
    client.readContract({ address: CONTRACTS.staking, abi: stakingAbi, functionName: 'stakeOf', args: [owner], blockNumber }),
    client.readContract({ address: CONTRACTS.staking, abi: stakingAbi, functionName: 'accountPower', args: [owner], blockNumber }),
    client.readContract({ address: CONTRACTS.staking, abi: stakingAbi, functionName: 'powerParameters', blockNumber }),
  ])
  const targetAmount = parameters[0] * parameters[1] / 10n ** 18n
  const stakeCandidate = balance < targetAmount ? balance : targetAmount
  const quoted = await client.readContract({ address: CONTRACTS.staking, abi: stakingAbi, functionName: 'quotePower', args: [stake[0] + stakeCandidate, power[0]], blockNumber })
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
  return { inventorySource: 'indexer', account, economy, balance, liveClaimable, principal: stake[0], nftPower: power[0], sqkPower: power[1], stakeCandidate, stakeGain: quoted - power[1], blockNumber, blockHash: block.hash, verifiedAt: Date.now() }
}
