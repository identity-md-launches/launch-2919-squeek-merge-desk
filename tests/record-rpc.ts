/** Read-only fixture recorder. No signing, private keys or broadcast methods. */
import { mkdir, writeFile } from 'node:fs/promises'
import { getAddress, encodeFunctionData } from 'viem'

const RPC = 'https://ethereum-sepolia-rpc.publicnode.com'
const originalFetch = globalThis.fetch
const blockResponse = await originalFetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }) })
const block = (await blockResponse.json() as { result: string }).result
const records: Record<string, unknown> = {}
function normalize(v: unknown): unknown {
  if (typeof v === 'string') return v.startsWith('0x') ? v.toLowerCase() : v
  if (Array.isArray(v)) return v.map(normalize)
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, normalize(x)]))
  return v
}
globalThis.fetch = async (input, options) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  if (url.replace(/\/$/, '') !== RPC) return originalFetch(input, options)
  const request = JSON.parse(String(options?.body)) as { method: string; params: unknown[] }
  if (!['eth_chainId', 'eth_getBlockByNumber', 'eth_getCode', 'eth_getStorageAt', 'eth_call', 'eth_blockNumber'].includes(request.method)) throw new Error(`Recorder refuses ${request.method}`)
  const key = JSON.stringify(normalize({ method: request.method, params: request.params ?? [] }))
  const pinned = JSON.parse(JSON.stringify(request)) as typeof request
  pinned.params = (pinned.params ?? []).map(x => x === 'latest' ? block : x)
  const response = await originalFetch(input, { ...options, body: JSON.stringify(pinned) })
  const data = await response.clone().json() as { result?: unknown; error?: unknown }
  records[key] = data.error ? { error: data.error } : { result: data.result }
  return response
}
const { loadDirect } = await import('../src/protocol/direct')
const { prepareAction } = await import('../src/protocol/transactions')
const { client, CONTRACTS, erc20Abi } = await import('../src/protocol/config')
const { genesisAbi, stakingAbi } = await import('../src/protocol/abis')
const walletOwner = getAddress('0x598958abf7d8db8dd468cb53dd6ba705581bff54')
const stakedOwner = getAddress('0x8c6dfbcc2913016c24442684a99522047daae540')
for (const [owner, ids, custody] of [[walletOwner, '1,2', 'wallet'], [stakedOwner, '201,202', 'staking']] as const) {
  const snapshot = await loadDirect(owner, ids)
  const [survivor, donor] = ids.split(',')
  for (const [s, d] of [[survivor, donor], [donor, survivor]]) await prepareAction({ kind: 'merge', survivor: s, donor: d, custody }, owner)
  if (snapshot.liveClaimable > 0n) await prepareAction({ kind: 'claim' }, owner)
  for (const id of ids.split(',').map(BigInt)) await client.readContract({ address: CONTRACTS.genesis, abi: genesisAbi, functionName: 'tokenURI', args: [id] })
}
await client.readContract({ address: CONTRACTS.staking, abi: stakingAbi, functionName: 'quotePower', args: [100n * 10n ** 18n, 20_000n * 10n ** 18n], blockNumber: BigInt(block) })
await client.readContract({ address: CONTRACTS.token, abi: erc20Abi, functionName: 'allowance', args: [stakedOwner, CONTRACTS.staking] })
await prepareAction({ kind: 'approve', amount: 100n * 10n ** 18n }, stakedOwner)
await client.call({ account: stakedOwner, to: CONTRACTS.staking, data: encodeFunctionData({ abi: stakingAbi, functionName: 'claim', args: [stakedOwner] }), value: 0n, blockNumber: BigInt(block) })
await mkdir('tests/fixtures', { recursive: true })
await writeFile('tests/fixtures/sepolia-rpc.json', JSON.stringify({ recordedAt: new Date().toISOString(), block, description: 'Actual public Sepolia eth_call/read responses. Public holders, no keys, no transactions sent. Browser tests replay these responses.', walletOwner, stakedOwner, records }))
console.log(`Recorded ${Object.keys(records).length} read-only RPC responses at block ${BigInt(block)}.`)
