import type { Address, Hex } from 'viem'

export type Custody = 'wallet' | 'staking'
export type Squeek = {
  tokenId: string
  custody: Custody
  level: number
  basePower: string | null
  nextMergeHeight: string
  mergeState: 'ready' | 'cooldown' | 'terminal' | 'merges_closed'
  metadataStatus: string
}
export type Identities = {
  core: string; genesis: string; token: string
  mining: { proxy: string; implementation: string; implementationVersion: string; storageLayoutDigest: string }
  staking: { proxy: string; implementation: string; implementationVersion: string; storageLayoutDigest: string }
}
export type Envelope = {
  status: string; reason?: string; release: { id: string }; identities: Identities
  chain: { chainId: string; safeThroughBlock: string; safeBlockHash: string; safeBlockTimestamp: string }
}
export type Economy = Envelope & {
  nft: { maximumLevel: number; mergesOpen: boolean; basePower: string[]; cooldownBlocks: string[] }
  staking: { paused: boolean; sqkPerPower: string; referencePower: string; exitPolicy: { minBps: number; maxBps: number } }
}
export type Account = Envelope & {
  account: string
  economy: { currentRound?: string; coreBlockHeight: string; mergesOpen: boolean; stakingPaused: boolean; maximumLevel: number }
  tokens: Squeek[]; nextCursor: string | null
  tokenCounts: { wallet: string; staking: string }
  rewards: { claimableBaseUnits: string }
  power: { nftPower: string; sqkPower: string }
  stake: { principalBaseUnits: string; freshUntilRound: string }
  claimRecipient: string | null
}
export type Snapshot = {
  inventorySource: 'indexer' | 'manual'
  account: Account; economy: Economy; balance: bigint
  blockNumber: bigint; blockHash: Hex; verifiedAt: number
  liveClaimable: bigint; principal: bigint; nftPower: bigint; sqkPower: bigint
  stakeCandidate: bigint; stakeGain: bigint
}
export type Pair = { survivor: Squeek; donor: Squeek; baseGain: bigint; newPower: bigint }
export type Action =
  | { kind: 'merge'; survivor: string; donor: string; custody: Custody }
  | { kind: 'claim' }
  | { kind: 'stake'; amount: bigint }
  | { kind: 'approve'; amount: bigint }
export type Prepared = {
  action: Action; from: Address; to: Address; data: Hex; value: '0x0'; chainId: '0xaa36a7'
  blockNumber: string; blockHash: Hex; preparedAt: string
  recipient?: Address; payout?: string; newLevel?: number; baseGain?: string
}
