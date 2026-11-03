import { test } from 'node:test'
import assert from 'node:assert/strict'
import { encodeFunctionData } from 'viem'
import { amountLabel, filterTokens, findPairs, parseStake } from '../src/protocol/planner'
import { checkEnvelope } from '../src/protocol/api'
import { parseTokenIds } from '../src/protocol/direct'
import { unsignedBundle } from '../src/protocol/transactions'
import { genesisAbi, stakingAbi } from '../src/protocol/abis'
import { CONTRACTS, PIN } from '../src/protocol/config'
import type { Economy, Squeek } from '../src/protocol/types'

// Synthetic eligibility fixtures for unit tests only; never imported by the app.
const economy = { nft: { maximumLevel: 10, basePower: ['1000', '2200', '4840', '10648', '23426', '51536', '113380', '249436', '548759', '1207269'] } } as Economy
const token = (tokenId: string, level = 1, custody: 'wallet' | 'staking' = 'wallet', mergeState: Squeek['mergeState'] = 'ready'): Squeek => ({ tokenId, level, custody, mergeState, basePower: '1000', nextMergeHeight: '0', metadataStatus: 'available' })

test('recommends deposited pairs first, then the greatest marginal base power', () => {
  const result = findPairs([token('1', 3), token('2', 3), token('3', 1, 'staking'), token('4', 1, 'staking')], economy)
  assert.equal(result[0].survivor.tokenId, '3')
  assert.equal(result[0].baseGain, 200n)
  assert.equal(result[1].baseGain, 968n)
})
test('never pairs different custody, level, cooldown, closed merges or terminal levels', () => {
  assert.equal(findPairs([token('1'), token('2', 1, 'staking'), token('3', 2), token('4', 1, 'wallet', 'cooldown'), token('5', 10), token('6', 10), token('7', 1, 'wallet', 'merges_closed')], economy).length, 0)
})
test('each recommended donor is used once and IDs sort as bigint', () => {
  const pairs = findPairs([token('12'), token('3'), token('2'), token('4')], economy)
  assert.deepEqual(pairs.map(p => [p.survivor.tokenId, p.donor.tokenId]), [['2', '3'], ['4', '12']])
})
test('filters combine custody, readiness and an optional # prefix', () => {
  const tokens = [token('12'), token('22', 1, 'staking'), token('123', 1, 'wallet', 'cooldown')]
  assert.deepEqual(filterTokens(tokens, 'ready', '#12').map(t => t.tokenId), ['12'])
  assert.deepEqual(filterTokens(tokens, 'staking', '2').map(t => t.tokenId), ['22'])
  assert.equal(filterTokens(tokens, 'all', '99').length, 0)
})
test('SQK parsing keeps all 18 decimals and refuses negative, exponent and excessive precision', () => {
  assert.equal(parseStake('12.123456789012345678'), 12123456789012345678n)
  for (const value of ['0', '-1', '1e6', '.5', '1.1234567890123456789', 'NaN', '', '1,000']) assert.throws(() => parseStake(value))
})
test('direct inventory reads preserve exact bigint IDs, enforce the batch bound and refuse duplicates', () => {
  assert.deepEqual(parseTokenIds('2, 1, 999999999999999999999'), [1n, 2n, 999999999999999999999n])
  for (const value of ['', '1,1', '0', '-1', '1e3', Array.from({ length: 33 }, (_, i) => i + 1).join(',')]) assert.throws(() => parseTokenIds(value))
})
test('display formatting never turns a positive dust amount into zero', () => {
  assert.equal(amountLabel(1n), '<0.001')
  assert.equal(amountLabel(1234567890000000000000n), '1,234.567')
  assert.equal(amountLabel('10648', 0), '10,648')
})
test('an unavailable or mismatched API deployment fails closed', () => {
  const envelope = { status: 'available', release: { id: PIN.release }, chain: { chainId: '11155111', safeThroughBlock: '12055250', safeBlockHash: '0x' + 'a'.repeat(64) }, identities: PIN.identities }
  assert.doesNotThrow(() => checkEnvelope(envelope))
  assert.throws(() => checkEnvelope({ status: 'unavailable', reason: 'indexer_unavailable' }), /unavailable/)
  assert.throws(() => checkEnvelope({ ...envelope, release: { id: 'unrecognized-release' } }), /changed/)
  assert.throws(() => checkEnvelope({ ...envelope, chain: { ...envelope.chain, chainId: '1' } }), /changed/)
  assert.throws(() => checkEnvelope({ ...envelope, identities: { ...envelope.identities, genesis: CONTRACTS.token } }), /different contracts/)
})
test('current Genesis and deposited merge selectors and argument order are distinct', () => {
  assert.equal(encodeFunctionData({ abi: genesisAbi, functionName: 'merge', args: [1n, 2n] }).slice(0, 10), '0xd1c2babb')
  const deposited = encodeFunctionData({ abi: stakingAbi, functionName: 'mergeDeposited', args: [CONTRACTS.genesis, 1n, 2n] })
  assert.notEqual(deposited.slice(0, 10), '0xd1c2babb')
  const claim = encodeFunctionData({ abi: stakingAbi, functionName: 'claim', args: [CONTRACTS.genesis] })
  assert.equal(claim.slice(0, 10), '0x1e83409a')
})
test('unsigned bundle has the Sepolia chain, owner, exact call and zero native value', () => {
  const prepared = { chainId: '0xaa36a7', from: CONTRACTS.genesis, to: CONTRACTS.staking, data: '0x1234', value: '0x0' } as const
  assert.deepEqual(unsignedBundle(prepared), { version: '2.0.0', chainId: '0xaa36a7', from: CONTRACTS.genesis, atomicRequired: true, calls: [{ to: CONTRACTS.staking, data: '0x1234', value: '0x0' }] })
  assert.equal('privateKey' in unsignedBundle(prepared), false)
})
