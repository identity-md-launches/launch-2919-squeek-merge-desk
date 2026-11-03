import { createConfig, http } from 'wagmi'
import { coinbaseWallet, injected } from 'wagmi/connectors'
import { sepolia } from 'viem/chains'
import { createPublicClient, getAddress, parseAbi } from 'viem'
import deployment from './deployment.json'

export const API = 'https://api.squeekchain.com'
export const RPC = 'https://ethereum-sepolia-rpc.publicnode.com'
export const chain = sepolia
export const PIN = deployment
export const CONTRACTS = {
  core: getAddress(deployment.identities.core),
  genesis: getAddress(deployment.identities.genesis),
  token: getAddress(deployment.identities.token),
  mining: getAddress(deployment.identities.mining.proxy),
  staking: getAddress(deployment.identities.staking.proxy),
}
export const config = createConfig({
  chains: [chain],
  multiInjectedProviderDiscovery: true,
  connectors: [injected(), coinbaseWallet({ appName: 'Squeek Merge Desk' })],
  transports: { [chain.id]: http(RPC, { timeout: 15_000, retryCount: 1 }) },
})
export const client = createPublicClient({ chain, transport: http(RPC, { timeout: 15_000, retryCount: 1 }) })
export const erc20Abi = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address,address) view returns (uint256)',
  'function approve(address,uint256) returns (bool)',
  'function mining() view returns (address)',
])
