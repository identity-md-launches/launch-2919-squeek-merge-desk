import { encodeFunctionData, getAddress, isAddressEqual, keccak256, type Address, type Hex } from 'viem'
import { client, CONTRACTS, erc20Abi, PIN } from './config'
import { coreAbi, genesisAbi, miningAbi, stakingAbi } from './abis'
import type { Action, Prepared } from './types'

function requireEqual(actual: string, expected: string, label: string) {
  if (actual.toLowerCase() !== expected.toLowerCase()) throw new Error(`${label} changed. Transactions are blocked until this app is updated.`)
}
const IMPLEMENTATION_SLOT = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc'

/** Fail closed against this release, including actual EIP-1967 proxy slots and runtime hashes. */
export async function verifyGraph(blockNumber: bigint) {
  if (await client.getChainId() !== 11155111) throw new Error('The RPC is not on Sepolia. Transactions are blocked.')
  const proxies = [
    { name: 'Core', address: CONTRACTS.core, implementation: PIN.coreImplementation.address, version: PIN.coreImplementation.version, digest: PIN.coreImplementation.digest, hash: PIN.runtimeHashes.coreImplementation },
    { name: 'Mining', address: CONTRACTS.mining, implementation: PIN.identities.mining.implementation, version: PIN.identities.mining.implementationVersion, digest: PIN.identities.mining.storageLayoutDigest, hash: PIN.runtimeHashes.miningImplementation },
    { name: 'Staking', address: CONTRACTS.staking, implementation: PIN.identities.staking.implementation, version: PIN.identities.staking.implementationVersion, digest: PIN.identities.staking.storageLayoutDigest, hash: PIN.runtimeHashes.stakingImplementation },
  ]
  await Promise.all(proxies.map(async p => {
    const [slot, implementation, version, digest, code] = await Promise.all([
      client.getStorageAt({ address: p.address, slot: IMPLEMENTATION_SLOT, blockNumber }),
      client.readContract({ address: p.address, abi: coreAbi, functionName: 'implementationCodeAddress', blockNumber }),
      client.readContract({ address: p.address, abi: coreAbi, functionName: 'implementationCodeVersion', blockNumber }),
      client.readContract({ address: p.address, abi: coreAbi, functionName: 'implementationStorageLayoutDigest', blockNumber }),
      client.getCode({ address: p.implementation as Address, blockNumber }),
    ])
    if (!slot || !code || code === '0x') throw new Error(`${p.name} could not be verified. Refresh to try again.`)
    requireEqual(`0x${slot.slice(-40)}`, p.implementation, `${p.name} proxy`)
    requireEqual(implementation, p.implementation, `${p.name} implementation`)
    requireEqual(version.toString(), p.version, `${p.name} version`)
    requireEqual(digest, p.digest, `${p.name} layout`)
    requireEqual(keccak256(code), p.hash, `${p.name} runtime`)
  }))
  const [nftMining, nftCore, genesis, stakingToken, stakingMining, stakingCore, bindings, tokenMining, nftCode, tokenCode] = await Promise.all([
    client.readContract({ address: CONTRACTS.genesis, abi: genesisAbi, functionName: 'mining', blockNumber }),
    client.readContract({ address: CONTRACTS.genesis, abi: genesisAbi, functionName: 'sqkCore', blockNumber }),
    client.readContract({ address: CONTRACTS.staking, abi: stakingAbi, functionName: 'genesis', blockNumber }),
    client.readContract({ address: CONTRACTS.staking, abi: stakingAbi, functionName: 'token', blockNumber }),
    client.readContract({ address: CONTRACTS.staking, abi: stakingAbi, functionName: 'mining', blockNumber }),
    client.readContract({ address: CONTRACTS.staking, abi: stakingAbi, functionName: 'core', blockNumber }),
    client.readContract({ address: CONTRACTS.mining, abi: miningAbi, functionName: 'bindings', blockNumber }),
    client.readContract({ address: CONTRACTS.token, abi: erc20Abi, functionName: 'mining', blockNumber }),
    client.getCode({ address: CONTRACTS.genesis, blockNumber }),
    client.getCode({ address: CONTRACTS.token, blockNumber }),
  ])
  for (const [a, b, label] of [
    [nftMining, CONTRACTS.mining, 'Genesis mining'], [nftCore, CONTRACTS.core, 'Genesis core'],
    [genesis, CONTRACTS.genesis, 'Staking Genesis'], [stakingToken, CONTRACTS.token, 'Staking token'],
    [stakingMining, CONTRACTS.mining, 'Staking mining'], [stakingCore, CONTRACTS.core, 'Staking core'],
    [bindings.core, CONTRACTS.core, 'Mining core'], [bindings.token, CONTRACTS.token, 'Mining token'],
    [bindings.staking, CONTRACTS.staking, 'Mining staking'], [tokenMining, CONTRACTS.mining, 'Token mining'],
  ]) requireEqual(a, b, label)
  if (!nftCode || !tokenCode) throw new Error('The collection runtime is unavailable. Refresh to try again.')
  requireEqual(keccak256(nftCode), PIN.runtimeHashes.genesis, 'Genesis runtime')
  requireEqual(keccak256(tokenCode), PIN.runtimeHashes.token, 'SQK runtime')
}

export async function prepareAction(action: Action, owner: Address): Promise<Prepared> {
  const block = await client.getBlock()
  if (!block.hash || block.number === null) throw new Error('Unable to read the latest Sepolia block. Try again.')
  const blockNumber = block.number
  await verifyGraph(blockNumber)
  const base = { action, from: getAddress(owner), value: '0x0' as const, chainId: '0xaa36a7' as const, blockNumber: blockNumber.toString(), blockHash: block.hash, preparedAt: new Date().toISOString() }
  let to: Address = CONTRACTS.staking, data: Hex, details: Partial<Prepared> = {}
  if (action.kind === 'merge') {
    if (action.survivor === action.donor) throw new Error('Choose two different Squeeks.')
    const ids = [BigInt(action.survivor), BigInt(action.donor)]
    const [state, maximum, open, paused] = await Promise.all([
      client.readContract({ address: CONTRACTS.core, abi: coreAbi, functionName: 'state', blockNumber }),
      client.readContract({ address: CONTRACTS.genesis, abi: genesisAbi, functionName: 'MAXIMUM_LEVEL', blockNumber }),
      client.readContract({ address: CONTRACTS.genesis, abi: genesisAbi, functionName: 'mergesOpen', blockNumber }),
      client.readContract({ address: CONTRACTS.staking, abi: stakingAbi, functionName: 'paused', blockNumber }),
    ])
    if (!open) throw new Error('Genesis merges are currently closed. Try again after Squeekchain reopens them.')
    if (action.custody === 'staking' && paused) throw new Error('Staking is paused. Deposited Squeeks cannot merge until it resumes.')
    const positions = await Promise.all(ids.map(async id => {
      const [actualOwner, level, next] = await Promise.all([
        client.readContract({ address: CONTRACTS.genesis, abi: genesisAbi, functionName: 'ownerOf', args: [id], blockNumber }),
        client.readContract({ address: CONTRACTS.genesis, abi: genesisAbi, functionName: 'level', args: [id], blockNumber }),
        client.readContract({ address: CONTRACTS.genesis, abi: genesisAbi, functionName: 'nextMergeHeight', args: [id], blockNumber }),
      ])
      if (action.custody === 'staking') {
        if (!isAddressEqual(actualOwner, CONTRACTS.staking)) throw new Error(`Squeek #${id} is no longer deposited. Refresh your inventory.`)
        const depositor = await client.readContract({ address: CONTRACTS.staking, abi: stakingAbi, functionName: 'depositor', args: [CONTRACTS.genesis, id], blockNumber })
        if (!isAddressEqual(depositor, owner)) throw new Error(`This wallet is not the depositor of #${id}. Refresh your inventory.`)
      } else if (!isAddressEqual(actualOwner, owner)) throw new Error(`This wallet no longer owns #${id}. Refresh your inventory.`)
      if (next > state.blockHeight) throw new Error(`Squeek #${id} needs ${next - state.blockHeight} more completed Squeek blocks. Refresh after its cooldown.`)
      if (level >= maximum) throw new Error(`Squeek #${id} is at the maximum level and cannot merge.`)
      return { level }
    }))
    if (positions[0].level !== positions[1].level) throw new Error('Both Squeeks must have the same level. Choose another pair.')
    const [oldPower, newPower] = await Promise.all([
      client.readContract({ address: CONTRACTS.staking, abi: stakingAbi, functionName: 'basePower', args: [CONTRACTS.genesis, positions[0].level], blockNumber }),
      client.readContract({ address: CONTRACTS.staking, abi: stakingAbi, functionName: 'basePower', args: [CONTRACTS.genesis, positions[0].level + 1], blockNumber }),
    ])
    details = { newLevel: positions[0].level + 1, baseGain: (newPower - oldPower * 2n).toString() }
    if (action.custody === 'wallet') {
      to = CONTRACTS.genesis
      data = encodeFunctionData({ abi: genesisAbi, functionName: 'merge', args: [ids[0], ids[1]] })
    } else data = encodeFunctionData({ abi: stakingAbi, functionName: 'mergeDeposited', args: [CONTRACTS.genesis, ids[0], ids[1]] })
  } else if (action.kind === 'claim') {
    const [claimable, recipient] = await Promise.all([
      client.readContract({ address: CONTRACTS.staking, abi: stakingAbi, functionName: 'claimable', args: [owner], blockNumber }),
      client.readContract({ address: CONTRACTS.staking, abi: stakingAbi, functionName: 'claimRecipient', args: [owner], blockNumber }),
    ])
    if (claimable === 0n) throw new Error('This wallet has no funded SQK rewards to claim yet. Refresh after the next reward stream.')
    details = { payout: claimable.toString(), recipient: BigInt(recipient) === 0n ? owner : recipient }
    data = encodeFunctionData({ abi: stakingAbi, functionName: 'claim', args: [owner] })
  } else {
    if (action.amount <= 0n) throw new Error('Enter an amount greater than zero.')
    const balance = await client.readContract({ address: CONTRACTS.token, abi: erc20Abi, functionName: 'balanceOf', args: [owner], blockNumber })
    if (action.amount > balance) throw new Error('This amount exceeds your wallet’s SQK balance. Enter a smaller amount.')
    if (action.kind === 'approve') {
      to = CONTRACTS.token
      data = encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [CONTRACTS.staking, action.amount] })
    } else {
      const allowance = await client.readContract({ address: CONTRACTS.token, abi: erc20Abi, functionName: 'allowance', args: [owner, CONTRACTS.staking], blockNumber })
      if (allowance < action.amount) throw new Error('Approve this exact SQK amount first, then prepare the stake after approval confirms.')
      data = encodeFunctionData({ abi: stakingAbi, functionName: 'stake', args: [action.amount] })
    }
  }
  await client.call({ account: owner, to, data, value: 0n, blockNumber })
  return { ...base, ...details, to, data }
}
export function unsignedBundle(p: Pick<Prepared, 'chainId' | 'from' | 'to' | 'data' | 'value'>) {
  return { version: '2.0.0', chainId: p.chainId, from: p.from, atomicRequired: true, calls: [{ to: p.to, data: p.data, value: p.value }] }
}
export function friendlyError(error: unknown) {
  const message = error instanceof Error ? error.message : 'The request failed.'
  if (/rejected|denied|4001/i.test(message)) return 'The wallet request was declined. Your assets have not changed. Try again when ready.'
  if (/no provider|not found|not installed/i.test(message)) return 'No browser wallet was found. Install a wallet extension or open this page in a wallet app.'
  if (/HTTP request|fetch|network|timeout|timed out/i.test(message)) return 'Unable to reach Sepolia. Check your connection and try again.'
  if (/transaction reverted on Sepolia/i.test(message)) return message
  if (/revert/i.test(message)) return 'The contract rejected this request. Refresh your inventory and check ownership, levels and cooldowns before trying again.'
  return message.length > 260 ? 'Unable to verify this action. Refresh your inventory and try again. No transaction was sent.' : message
}
