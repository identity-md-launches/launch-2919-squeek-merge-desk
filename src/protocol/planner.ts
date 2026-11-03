import { formatUnits, parseUnits } from 'viem'
import type { Economy, Pair, Squeek } from './types'

export function findPairs(tokens: Squeek[], economy: Economy): Pair[] {
  const groups = new Map<string, Squeek[]>()
  for (const t of tokens) {
    if (t.mergeState !== 'ready' || t.level >= economy.nft.maximumLevel) continue
    const key = `${t.custody}:${t.level}`
    groups.set(key, [...(groups.get(key) ?? []), t])
  }
  const pairs: Pair[] = []
  for (const group of groups.values()) {
    group.sort((a, b) => BigInt(a.tokenId) < BigInt(b.tokenId) ? -1 : 1)
    for (let i = 0; i + 1 < group.length; i += 2) {
      const survivor = group[i], donor = group[i + 1]
      const old = BigInt(economy.nft.basePower[survivor.level - 1])
      const next = BigInt(economy.nft.basePower[survivor.level])
      pairs.push({ survivor, donor, baseGain: next - old * 2n, newPower: next })
    }
  }
  return pairs.sort((a, b) => {
    if (a.survivor.custody !== b.survivor.custody) return a.survivor.custody === 'staking' ? -1 : 1
    return a.baseGain === b.baseGain ? 0 : a.baseGain > b.baseGain ? -1 : 1
  })
}
export function amountLabel(value: bigint | string, decimals = 18, precision = 3) {
  const formatted = formatUnits(BigInt(value), decimals)
  const [whole, fraction = ''] = formatted.split('.')
  const grouped = BigInt(whole).toLocaleString('en-US')
  const part = fraction.slice(0, precision).replace(/0+$/, '')
  if (BigInt(value) > 0n && whole === '0' && !part) return `<0.${'0'.repeat(precision - 1)}1`
  return `${grouped}${part ? `.${part}` : ''}`
}
export function parseStake(input: string): bigint {
  if (!/^\d+(\.\d{1,18})?$/.test(input.trim())) throw new Error('Enter a positive SQK amount with up to 18 decimal places.')
  const n = parseUnits(input.trim(), 18)
  if (n <= 0n) throw new Error('Enter an amount greater than zero.')
  return n
}
export function filterTokens(tokens: Squeek[], filter: string, search: string) {
  return tokens.filter(t => (filter === 'all' || (filter === 'ready' ? t.mergeState === 'ready' : t.custody === filter)) && t.tokenId.includes(search.trim().replace(/^#/, '')))
}
export function actionLabel(action: { kind: string }) {
  return ({ claim: 'Claim rewards', merge: 'Merge Squeeks', stake: 'Stake SQK', approve: 'Approve SQK' } as Record<string, string>)[action.kind]
}
