import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useConnection } from 'wagmi'
import { ArrowDown, ArrowRight, ArrowUpRight, Check, ChevronDown, CircleHelp, Clock3, GitMerge, Layers3, LockKeyhole, RefreshCw, Search, ShieldCheck, SlidersHorizontal, Sparkles, Wallet, Zap } from 'lucide-react'
import { formatUnits, getAddress, isAddress, isAddressEqual, type Address } from 'viem'
import { WalletControl } from './components/WalletControl'
import { Modal } from './components/Modal'
import { SqueekArt } from './components/SqueekArt'
import { TransactionReview } from './components/TransactionReview'
import { apiGet, loadAccount, loadEconomy } from './protocol/api'
import { CONTRACTS, client, erc20Abi } from './protocol/config'
import { genesisAbi, stakingAbi } from './protocol/abis'
import { loadDirect, parseTokenIds } from './protocol/direct'
import { amountLabel, filterTokens, findPairs, parseStake } from './protocol/planner'
import { friendlyError, prepareAction } from './protocol/transactions'
import type { Action, Envelope, Pair, Prepared, Squeek } from './protocol/types'

function scrollToSection(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'nearest' })
}

export default function App() {
  const { address, chainId, isConnected } = useConnection()
  const [watched, setWatched] = useState<Address>(), [addressInput, setAddressInput] = useState(''), [addressError, setAddressError] = useState('')
  const [manualIds, setManualIds] = useState(''), [manualInput, setManualInput] = useState(''), [manualError, setManualError] = useState('')
  const [guide, setGuide] = useState(false), [tab, setTab] = useState<'merge' | 'stake'>('merge')
  const [survivor, setSurvivor] = useState(''), [donor, setDonor] = useState('')
  const [filter, setFilter] = useState('all'), [search, setSearch] = useState(''), [sort, setSort] = useState('id'), [visible, setVisible] = useState(8)
  const [stakeInput, setStakeInput] = useState(''), [stakeQuote, setStakeQuote] = useState<bigint>(), [quoteBusy, setQuoteBusy] = useState(false), [quoteError, setQuoteError] = useState('')
  const [busy, setBusy] = useState(false), [actionError, setActionError] = useState(''), [prepared, setPrepared] = useState<Prepared>()
  const owner = address ?? watched
  const inventory = useQuery({ queryKey: ['account', owner, manualIds], queryFn: ({ signal }) => manualIds ? loadDirect(owner!, manualIds, signal) : loadAccount(owner!, signal), enabled: !!owner, retry: false, staleTime: 60_000, refetchOnWindowFocus: false })
  const economy = useQuery({ queryKey: ['economy'], queryFn: ({ signal }) => loadEconomy(signal), retry: false, staleTime: 120_000, refetchOnWindowFocus: false })
  const snapshot = inventory.data
  const tokens = snapshot?.account.tokens ?? []
  const pairs = useMemo(() => snapshot ? findPairs(tokens, snapshot.economy) : [], [snapshot, tokens])
  const best = pairs[0]
  const claimRecommended = !best && !!snapshot && snapshot.stakeCandidate === 0n && snapshot.liveClaimable > 0n
  const canAct = !!address && chainId === 11155111 && !!snapshot && isAddressEqual(address, snapshot.account.account as Address)
  const first = tokens.find(t => t.tokenId === survivor), second = tokens.find(t => t.tokenId === donor)
  const pairValid = !!first && !!second && first.tokenId !== second.tokenId && first.level === second.level && first.custody === second.custody && first.mergeState === 'ready' && second.mergeState === 'ready'
  const filtered = useMemo(() => filterTokens(tokens, filter, search).sort((a, b) => sort === 'level' ? b.level - a.level || (BigInt(a.tokenId) < BigInt(b.tokenId) ? -1 : 1) : BigInt(a.tokenId) < BigInt(b.tokenId) ? -1 : 1), [tokens, filter, search, sort])
  useEffect(() => { setWatched(undefined); setPrepared(undefined); setSurvivor(''); setDonor(''); setActionError(''); setStakeInput(''); setStakeQuote(undefined); setManualIds(''); setManualInput('') }, [address])
  useEffect(() => { setVisible(8) }, [filter, search, sort, owner])
  function selectPair(pair: Pair) { setSurvivor(pair.survivor.tokenId); setDonor(pair.donor.tokenId); setTab('merge'); setActionError(''); scrollToSection('planner') }
  function followRecommendation() {
    if (claimRecommended) {
      if (canAct) void prepare({ kind: 'claim' })
      else scrollToSection('rewards')
      return
    }
    setTab('stake')
    if (snapshot && snapshot.stakeCandidate > 0n) setStakeInput(formatUnits(snapshot.stakeCandidate, 18))
    scrollToSection('planner')
  }
  function handleConfirmed(transaction: Prepared) {
    if (transaction.action.kind === 'merge' && manualIds) {
      const burned = BigInt(transaction.action.donor)
      const remaining = parseTokenIds(manualIds).filter(id => id !== burned).join(',')
      setManualIds(remaining); setManualInput(remaining); setSurvivor(''); setDonor('')
    } else void inventory.refetch()
    void economy.refetch()
  }
  async function prepare(action: Action) {
    if (!address || !canAct || busy) return
    setBusy(true); setActionError('')
    try { setPrepared(await prepareAction(action, address)) } catch (e) { setActionError(friendlyError(e)) } finally { setBusy(false) }
  }
  async function quoteStake() {
    if (!snapshot) return
    setQuoteBusy(true); setQuoteError(''); setStakeQuote(undefined)
    try {
      const amount = parseStake(stakeInput)
      if (amount > snapshot.balance) throw new Error('Enter an amount within the wallet’s SQK balance.')
      const quote = await client.readContract({ address: CONTRACTS.staking, abi: stakingAbi, functionName: 'quotePower', args: [snapshot.principal + amount, snapshot.nftPower], blockNumber: snapshot.blockNumber })
      setStakeQuote(quote - snapshot.sqkPower)
    } catch (e) { setQuoteError(friendlyError(e)) } finally { setQuoteBusy(false) }
  }
  async function prepareStake() {
    if (!address || !canAct) return
    setActionError('')
    try {
      const amount = parseStake(stakeInput)
      const allowance = await client.readContract({ address: CONTRACTS.token, abi: erc20Abi, functionName: 'allowance', args: [address, CONTRACTS.staking] })
      await prepare({ kind: allowance < amount ? 'approve' : 'stake', amount })
    } catch (e) { setActionError(friendlyError(e)) }
  }
  function reviewAddress(e: React.FormEvent) {
    e.preventDefault(); setAddressError('')
    if (!isAddress(addressInput.trim()) || BigInt(addressInput.trim()) === 0n) { setAddressError('Enter a valid, nonzero Ethereum address.'); document.getElementById('review-address')?.focus(); return }
    try { if (manualInput.trim()) parseTokenIds(manualInput) } catch (error) { setAddressError(friendlyError(error)); document.getElementById('review-token-ids')?.focus(); return }
    setManualIds(manualInput.trim()); setWatched(getAddress(addressInput.trim())); setSurvivor(''); setDonor(''); setActionError('')
  }
  const count = snapshot ? tokens.length.toLocaleString('en-US') : '—'
  return <>
    <a className="skip-link" href="#main">Skip to desk</a>
    <header className="site-header">
      <a className="brand" href="#"><img src={`${import.meta.env.BASE_URL}favicon.svg`} width="36" height="36" alt="" /><span>Merge Desk<span className="brand-sub">by the Squeek community</span></span></a>
      <nav className="header-nav" aria-label="Resources"><button className="text-button" onClick={() => setGuide(true)}>How it works</button><a className="text-button" href="https://docs.squeekchain.com/" target="_blank" rel="noreferrer">Squeekchain docs<ArrowUpRight size={15} /></a></nav>
      <div className="header-end"><span className="network-tag"><span className="network-dot" />Sepolia</span><WalletControl /></div>
    </header>
    <main id="main" className="page-shell">
      <div className="page-heading"><div><h1>Squeek Merge Desk<span className="title-dot">.</span></h1><p>Review your Genesis Squeeks. Make your next move.</p></div><button className="button button-secondary guide-button" onClick={() => setGuide(true)}><CircleHelp size={17} />Desk guide</button></div>
      <div className="testnet-line"><span><span className="network-dot" />Sepolia testnet<span className="line-dot">·</span>Test assets only</span><span className="ownership-note"><LockKeyhole size={14} />Your keys stay in your wallet</span></div>
      <section className="stats-strip" aria-label="Wallet overview">
        <Stat icon={<Layers3 size={17} />} label={snapshot?.inventorySource === 'manual' ? 'Reviewed Squeeks' : 'Genesis Squeeks'} value={count} note={snapshot ? `${snapshot.account.tokenCounts.wallet} in wallet · ${snapshot.account.tokenCounts.staking} deposited` : 'Your collection, together'} />
        <Stat icon={<Wallet size={17} />} label="Wallet SQK" value={snapshot ? amountLabel(snapshot.balance) : '—'} note="Available to stake" />
        <Stat icon={<Zap size={17} />} label="Staked SQK" value={snapshot ? amountLabel(snapshot.principal) : '—'} note="Working alongside your Squeeks" />
        <Stat icon={<Sparkles size={17} />} label="Claimable SQK" value={snapshot ? amountLabel(snapshot.liveClaimable) : '—'} note={snapshot ? 'Verified at snapshot block' : 'Funded rewards only'} />
      </section>
      {owner && <div className="account-line"><div><span className="status-dot" />{address ? 'Connected wallet' : 'Address review'}<code>{getAddress(owner)}</code></div><div className="account-actions">{!address && <button className="text-button" onClick={() => { setWatched(undefined); setManualIds(''); setManualInput(''); setSurvivor(''); setDonor('') }}>Change address</button>}<button className="text-button" onClick={() => { void inventory.refetch(); void economy.refetch() }} disabled={inventory.isFetching}><RefreshCw size={15} />{inventory.isFetching ? 'Refreshing…' : 'Refresh'}</button></div></div>}
      {inventory.isLoading && owner && <div className="notice loading-notice" role="status"><RefreshCw size={18} className="spin" /><span>Loading your Squeeks and checking Sepolia contracts…</span></div>}
      {inventory.error && <div className="notice notice-error" role="alert"><span>{friendlyError(inventory.error)}</span><button className="text-button" onClick={() => void inventory.refetch()}>Try again<RefreshCw size={15} /></button></div>}
      {owner && <details className="direct-recovery" open={!!inventory.error}><summary>Read specific Squeeks directly from Sepolia</summary><form onSubmit={e => { e.preventDefault(); setManualError(''); try { parseTokenIds(manualInput); setManualIds(manualInput.trim()); setSurvivor(''); setDonor('') } catch (error) { setManualError(friendlyError(error)) } }}><label htmlFor="direct-ids">Token IDs, separated by commas</label><div className="address-input-row"><input id="direct-ids" value={manualInput} onChange={e => setManualInput(e.target.value)} placeholder="Enter your Squeek IDs" inputMode="text" autoComplete="off" aria-invalid={!!manualError} aria-describedby="direct-hint" /><button className="button button-secondary" type="submit">Read onchain<ArrowRight size={16} /></button></div><p id="direct-hint" className="small muted">Use this when the indexer is unavailable. Reviews up to 32 IDs, verifies ownership, and keeps the full account’s balances.</p>{manualError && <p className="field-error" role="alert">{manualError}</p>}</form></details>}
      {snapshot?.inventorySource === 'manual' && <div className="notice partial-notice"><span>Partial inventory: only the {tokens.length} IDs you entered are reviewed. Balances and rewards cover the whole account.</span><button className="text-button" onClick={() => setManualIds('')}>Load full inventory<RefreshCw size={15} /></button></div>}
      {isConnected && chainId !== 11155111 && <p className="notice">Your wallet is on another network. Use “Switch to Sepolia” above to enable transaction preparation.</p>}
      <div className="desk-grid">
        <div className="main-column">
          <section className="recommendation" aria-labelledby="recommendation-title">
            <div className="recommendation-head"><div className="section-title"><span className="feature-icon"><GitMerge size={21} /></span><h2 id="recommendation-title">Your next move</h2></div><span className="small muted">{snapshot ? `${pairs.length} eligible ${pairs.length === 1 ? 'pair' : 'pairs'}` : 'Start with your wallet'}</span></div>
            {!snapshot ? <>
              <div className="merge-diagram"><SqueekArt /><span className="diagram-plus">+</span><SqueekArt variant={1} /><ArrowRight className="diagram-arrow" size={24} /><span className="diagram-result"><SqueekArt /></span></div>
              <div className="recommendation-copy"><p className="recommendation-title">{owner ? "Review your holdings to continue." : "A clearer path to more power."}</p><p className="muted">{owner ? inventory.isFetching ? "Reading your Squeeks and verifying the contracts…" : "Refresh your holdings or enter specific token IDs above." : "Connect above to find a merge pair or compare SQK staking."}</p></div>
              {!address && <details className="address-review"><summary>Review a public address instead<ChevronDown size={16} /></summary><form onSubmit={reviewAddress}><label htmlFor="review-address">Ethereum address</label><div className="address-input-row"><input id="review-address" name="review-address" value={addressInput} onChange={e => setAddressInput(e.target.value)} autoComplete="off" spellCheck={false} placeholder="0x…" aria-invalid={!!addressError} aria-describedby={addressError ? 'address-error' : undefined} /><button className="button button-secondary" type="submit">Review<ArrowRight size={16} /></button></div>{addressError && <p className="field-error" id="address-error" role="alert">{addressError}</p>}<label htmlFor="review-token-ids" className="optional-ids-label">Token IDs <span className="muted">(optional, for direct reads)</span></label><input id="review-token-ids" className="full-width" value={manualInput} onChange={e => setManualInput(e.target.value)} placeholder="Enter comma-separated Squeek IDs" autoComplete="off" /><p className="small muted">Read-only review. Connect the owner wallet to prepare transactions.</p></form></details>}
            </> : best ? <>
              <p className="recommendation-title">Merge #{best.survivor.tokenId} with #{best.donor.tokenId}.</p>
              <p className="muted">A ready pair from the reviewed Squeeks, at the same level and custody.</p>
              <div className="pair-preview"><PairToken token={best.survivor} label="Survivor" /><span className="pair-plus">+</span><PairToken token={best.donor} label="Donor" /><ArrowRight size={22} /><div className="pair-outcome"><span>Level {best.survivor.level + 1}</span><strong>+{amountLabel(best.baseGain, 0, 0)}</strong><span className="small muted">base power</span></div></div>
              <div className="recommendation-bottom"><p className="small muted">{best.survivor.custody === 'staking' ? 'Both Squeeks are deposited. The survivor stays in staking.' : 'Both Squeeks are in your wallet. Deposit the survivor to earn.'}</p><button className={`button ${canAct && !pairValid && !(tab === 'stake' && stakeInput) ? 'button-primary' : 'button-secondary'}`} disabled={busy} onClick={() => selectPair(best)}>Plan this merge<ArrowRight size={17} /></button></div>
            </> : <div className="no-pair"><div className="empty-icon"><Zap size={28} /></div><p className="recommendation-title">{snapshot.stakeCandidate > 0n ? 'Put more SQK to work.' : snapshot.liveClaimable > 0n ? 'Claim your funded rewards.' : tokens.length ? 'Keep your next pair in sight.' : 'Start with SQK staking.'}</p><p className="muted">{snapshot.stakeCandidate > 0n ? `No eligible same-level pair right now. Staking ${amountLabel(snapshot.stakeCandidate)} SQK quotes +${amountLabel(snapshot.stakeGain)} power.` : snapshot.liveClaimable > 0n ? `You have ${amountLabel(snapshot.liveClaimable)} SQK available to claim. Claim first, then review staking.` : tokens.length ? 'Your Squeeks are on cooldown, at different levels, in different custody, or at the maximum level.' : 'This address has no Genesis Squeeks. SQK staking can still contribute power.'}</p><button className={`button ${canAct && !(tab === 'stake' && stakeInput) ? 'button-primary' : 'button-secondary'}`} disabled={busy} onClick={followRecommendation}>{claimRecommended ? canAct ? 'Prepare claim' : 'Review rewards' : 'Compare staking'}<ArrowRight size={17} /></button></div>}
            <div className="trust-line"><span><ShieldCheck size={15} />Onchain checks</span><span><SlidersHorizontal size={15} />You choose the survivor</span></div>
          </section>
          {snapshot && <section className="comparison" aria-label="Merge and stake comparison"><div><span className="comparison-label"><GitMerge size={16} />Best eligible merge</span><strong>{best ? `+${amountLabel(best.baseGain, 0, 0)} base power` : 'No pair ready'}</strong><span className="small muted">{best ? 'No SQK spent · donor is burned' : 'Same level and custody required'}</span></div><div><span className="comparison-label"><Zap size={16} />Additional SQK stake</span><strong>+{amountLabel(snapshot.stakeGain)} power</strong><span className="small muted">From {amountLabel(snapshot.stakeCandidate)} SQK · exit fees apply</span></div></section>}
          <section className="inventory-section" aria-labelledby="inventory-title">
            <div className="section-heading"><h2 id="inventory-title">Your Squeeks{snapshot && <span className="count">{tokens.length}</span>}</h2><span className="small muted">Genesis collection</span></div>
            <div className="inventory-toolbar"><div className="filter-group" role="group" aria-label="Filter Squeeks">{[['all', 'All'], ['wallet', 'In wallet'], ['staking', 'Deposited'], ['ready', 'Merge ready']].map(([v, l]) => <button key={v} className={filter === v ? 'filter active' : 'filter'} aria-pressed={filter === v} onClick={() => setFilter(v)}>{l}</button>)}</div><label className="search-field"><Search size={16} /><span className="sr-only">Search by Squeek ID</span><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search ID" inputMode="numeric" /></label></div>
            {!snapshot ? <div className="inventory-empty"><span className="empty-icon"><Layers3 size={27} /></span><h3>Your collection lives here</h3><p>Holdings, levels and cooldowns appear after you connect.</p><span className="small muted">Wallet-held and deposited Squeeks, in one place.</span></div> : tokens.length === 0 ? <div className="inventory-empty"><Layers3 size={28} /><h3>No Genesis Squeeks at this address</h3><p>You can still claim funded rewards and compare SQK staking.</p><a href="https://squeekchain.com/genesis" target="_blank" rel="noreferrer">Explore Squeekchain Genesis<ArrowUpRight size={16} /></a></div> : <>
              <div className="results-line"><span className="small muted">{filtered.length} {filtered.length === 1 ? 'Squeek' : 'Squeeks'}{search && ` matching “${search}”`}</span><label className="sort-label">Sort by<select value={sort} onChange={e => setSort(e.target.value)}><option value="id">Token ID</option><option value="level">Highest level</option></select></label></div>
              {filtered.length ? <div className="token-grid">{filtered.slice(0, visible).map(t => <TokenCard key={t.tokenId} token={t} height={snapshot.account.economy.coreBlockHeight} selected={survivor === t.tokenId || donor === t.tokenId} onSelect={() => { setTab('merge'); setActionError(''); if (!survivor || survivor === t.tokenId) { setSurvivor(t.tokenId); setDonor('') } else setDonor(t.tokenId); scrollToSection('planner') }} />)}</div> : <div className="inventory-empty"><Search size={25} /><h3>No matching Squeeks</h3><p>Try another ID or clear the filters.</p><button className="button button-secondary" onClick={() => { setSearch(''); setFilter('all') }}>Clear filters</button></div>}
              {filtered.length > visible && <button className="button button-secondary load-more" onClick={() => setVisible(n => n + 8)}>Show more Squeeks<ArrowDown size={16} /></button>}
            </>}
          </section>
        </div>
        <aside className="side-column">
          <section className="planner-panel" id="planner" aria-labelledby="planner-title">
            <div className="section-heading"><h2 id="planner-title">Action planner</h2><GitMerge size={19} className="muted" /></div>
            <div className="planner-tabs" role="group" aria-label="Action type"><button aria-pressed={tab === 'merge'} className={tab === 'merge' ? 'active' : ''} onClick={() => { setTab('merge'); setActionError('') }}><GitMerge size={16} />Merge</button><button aria-pressed={tab === 'stake'} className={tab === 'stake' ? 'active' : ''} onClick={() => { setTab('stake'); setActionError('') }}><Zap size={16} />Stake SQK</button></div>
            {tab === 'merge' ? <>
              <div className="planner-fields"><label htmlFor="survivor">Keep this Squeek<span className="small muted">Survivor</span></label><select id="survivor" value={survivor} onChange={e => { setSurvivor(e.target.value); setDonor(''); setActionError('') }} disabled={!tokens.length}><option value="">{snapshot ? 'Choose a survivor' : 'Connect to choose a Squeek'}</option>{tokens.map(t => <option key={t.tokenId} value={t.tokenId} disabled={t.mergeState !== 'ready'}>#{t.tokenId} · Level {t.level} · {t.custody === 'staking' ? 'Deposited' : 'In wallet'}{t.mergeState !== 'ready' ? ` · ${t.mergeState.replaceAll('_', ' ')}` : ''}</option>)}</select>
              <span className="merge-connector"><GitMerge size={20} /></span><label htmlFor="donor">Merge this one into it<span className="small muted">Burned permanently</span></label><select id="donor" value={donor} onChange={e => { setDonor(e.target.value); setActionError('') }} disabled={!first}><option value="">{first ? 'Choose a matching Squeek' : 'Choose a survivor first'}</option>{tokens.filter(t => t.tokenId !== survivor && t.level === first?.level && t.custody === first.custody && t.mergeState === 'ready').map(t => <option key={t.tokenId} value={t.tokenId}>#{t.tokenId} · Level {t.level}</option>)}</select></div>
              {pairValid && snapshot && <div className="merge-summary"><div><span>Result</span><strong>#{survivor} · Level {first.level + 1}</strong></div><div><span>Base power</span><strong>{amountLabel(snapshot.economy.nft.basePower[first.level], 0, 0)}</strong></div><button className="text-button" onClick={() => { setSurvivor(donor); setDonor(survivor) }}>Swap survivor and donor<RefreshCw size={14} /></button></div>}
              <p className="planner-hint small"><CircleHelp size={15} />{pairValid ? `#${donor} is burned forever. #${survivor} keeps its image and ID.` : 'Choose two Squeeks at the same level and in the same custody.'}</p>
              <button className="button button-primary full-width" disabled={!canAct || !pairValid || busy} onClick={() => first && void prepare({ kind: 'merge', survivor, donor, custody: first.custody })}><GitMerge size={17} />{busy ? 'Checking eligibility…' : 'Prepare merge'}<ArrowRight size={17} /></button>
            </> : <>
              <div className="planner-fields"><label htmlFor="stake-amount">Additional SQK to stake</label><div className="amount-field"><input id="stake-amount" name="additional-sqk" aria-invalid={!!quoteError} aria-describedby={quoteError ? "stake-error" : undefined} value={stakeInput} onChange={e => { setStakeInput(e.target.value); setStakeQuote(undefined); setQuoteError('') }} inputMode="decimal" placeholder="0.00" disabled={!snapshot} /><span>SQK</span></div><div className="balance-row"><span className="small muted">Available: {snapshot ? amountLabel(snapshot.balance) : '—'} SQK</span><button className="text-button" disabled={!snapshot} onClick={() => { if (snapshot) setStakeInput(formatUnits(snapshot.balance, 18)); setStakeQuote(undefined) }}>Use balance</button></div></div>
              <button className="button button-secondary full-width" disabled={!snapshot || quoteBusy} onClick={() => void quoteStake()}><Zap size={16} />{quoteBusy ? 'Getting power quote…' : 'Compare power'}</button>
              {stakeQuote !== undefined && <p className="quote-result" role="status">+{amountLabel(stakeQuote)} additional power<span className="small muted">Contract quote at your snapshot. Rewards vary.</span></p>}
              {quoteError && <p role="alert" className="field-error" id="stake-error">{quoteError}</p>}
              <p className="small muted staking-warning">Staking is separate from merging. New stake has a fresh period; unstaking carries a variable exit fee{snapshot ? ` (${snapshot.economy.staking.exitPolicy.minBps / 100}%–${snapshot.economy.staking.exitPolicy.maxBps / 100}% in the current policy)` : ''}.</p>
              <button className="button button-primary full-width" disabled={!canAct || busy || !stakeInput || !!snapshot?.account.economy.stakingPaused} onClick={() => void prepareStake()}><ShieldCheck size={17} />{busy ? 'Checking allowance…' : 'Prepare stake or approval'}<ArrowRight size={17} /></button>
              <p className="small muted">If needed, approve the exact amount first. Prepare the stake after approval confirms.</p>
            </>}
            {!canAct && <p className="locked-note small"><LockKeyhole size={13} />{address ? chainId !== 11155111 ? 'Switch to Sepolia to prepare.' : 'Load a verified inventory to prepare.' : watched ? 'Connect this address’s wallet to prepare.' : 'Connect your wallet to prepare.'}</p>}
            {actionError && <p className="notice notice-error" role="alert">{actionError}</p>}
          </section>
          <section className="rewards-panel" id="rewards" aria-labelledby="rewards-title"><div className="section-heading"><h2 id="rewards-title">Ready to claim</h2><Sparkles size={18} className="muted" /></div><p className="reward-amount">{snapshot ? amountLabel(snapshot.liveClaimable) : '—'}<span>SQK</span></p><p className="small muted">Funded staking rewards. Claiming does not spend your Squeeks.</p><button className="button button-secondary full-width" disabled={!canAct || !snapshot || snapshot.liveClaimable === 0n || busy} onClick={() => void prepare({ kind: 'claim' })}>{busy ? 'Checking rewards…' : 'Prepare claim'}<ArrowRight size={17} /></button></section>
          <section className="desk-notes"><h2>Before you merge</h2><div><span className="note-number">01</span><p>Same level. Same custody.<span>Both in your wallet or both deposited.</span></p></div><div><span className="note-number">02</span><p>Cooldowns use Squeek blocks.<span>Clock time alone does not count.</span></p></div><div><span className="note-number">03</span><p>One Squeek survives.<span>The donor is permanently burned.</span></p></div><button className="text-button" onClick={() => setGuide(true)}>Read the desk guide<ArrowUpRight size={15} /></button></section>
        </aside>
      </div>
      <section className="bottom-note"><ShieldCheck size={20} /><div><h2>Prepared here. Signed by you.</h2><p>Every action is simulated on Sepolia before it reaches your wallet. You review the call and approve the signature.</p></div><a href="https://squeekchain.com/genesis" target="_blank" rel="noreferrer">Explore Genesis<ArrowUpRight size={16} /></a></section>
      <footer className="site-footer"><span><img src={`${import.meta.env.BASE_URL}favicon.svg`} width="20" height="20" alt="" />A community project for the Buildooooor badge.</span><div><button className="text-button" onClick={() => setGuide(true)}>About this desk</button><a href="https://docs.squeekchain.com/developers/api/" target="_blank" rel="noreferrer">Data & contracts<ArrowUpRight size={14} /></a></div></footer>
      <div className="freshness small muted" role="status">{snapshot ? `Snapshot: Ethereum block ${snapshot.blockNumber} · ${new Date(snapshot.verifiedAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}. Refresh before deciding.` : economy.error ? 'Squeekchain data is currently unavailable. Wallet connection remains available.' : economy.data ? 'Sepolia deployment recognized. Connect a wallet to verify your holdings.' : 'Checking the Sepolia data service…'}</div>
    </main>
    {guide && <Guide onClose={() => setGuide(false)} />}
    {prepared && <TransactionReview initial={prepared} onClose={() => setPrepared(undefined)} onConfirmed={() => handleConfirmed(prepared)} />}
  </>
}
function Stat({ icon, label, value, note }: { icon: React.ReactNode; label: string; value: string; note: string }) { return <div className="stat"><div className="stat-label">{icon}<span>{label}</span></div><strong>{value}</strong><span className="stat-note">{note}</span></div> }
function PairToken({ token, label }: { token: Squeek; label: string }) { return <div className="pair-token"><div className="pair-art"><TokenImage id={token.tokenId} /></div><div><span className="small muted">{label}</span><strong>#{token.tokenId}</strong><span className="small muted">Level {token.level}</span></div></div> }
function TokenCard({ token, height, selected, onSelect }: { token: Squeek; height: string; selected: boolean; onSelect: () => void }) {
  const remaining = BigInt(token.nextMergeHeight) > BigInt(height) ? BigInt(token.nextMergeHeight) - BigInt(height) : 0n
  return <article className={`token-card ${selected ? 'selected' : ''}`}><div className="token-art-frame"><TokenImage id={token.tokenId} /><span className="level-chip">Level {token.level}</span></div><div className="token-card-content"><div className="token-title"><h3>Squeek #{token.tokenId}</h3>{selected && <Check size={17} />}</div><span className="small muted">{token.custody === 'staking' ? 'Deposited in staking' : 'In your wallet'}</span><div className={`token-state ${token.mergeState === 'ready' ? 'ready' : ''}`}>{token.mergeState === 'ready' ? <Check size={14} /> : <Clock3 size={14} />}{token.mergeState === 'ready' ? 'Merge ready' : token.mergeState === 'terminal' ? 'Maximum level' : token.mergeState === 'merges_closed' ? 'Merges closed' : `${remaining} Squeek blocks left`}</div><button className="button button-secondary full-width" disabled={token.mergeState !== 'ready'} onClick={onSelect}>{selected ? 'Change selection' : 'Use in planner'}<ArrowRight size={15} /></button></div></article>
}
function TokenImage({ id }: { id: string }) {
  const data = useQuery({ queryKey: ['token-image', id], queryFn: async ({ signal }) => {
    try {
      const record = await apiGet<Envelope & { metadata: { imageDataUri: string } | null }>(`/v1/squeeks/${id}`, signal)
      if (record.metadata?.imageDataUri) return record.metadata.imageDataUri
    } catch { if (signal.aborted) throw new DOMException('Aborted', 'AbortError') }
    const uri = await client.readContract({ address: CONTRACTS.genesis, abi: genesisAbi, functionName: 'tokenURI', args: [BigInt(id)] })
    if (!uri.startsWith('data:application/json;base64,')) throw new Error('Artwork metadata is unavailable.')
    const metadata = JSON.parse(atob(uri.split(',')[1])) as { image?: string }
    return metadata.image
  }, retry: false, staleTime: 300_000, refetchOnWindowFocus: false })
  const src = data.data
  return src && /^data:image\/(svg\+xml|png|webp);base64,[A-Za-z0-9+/=]+$/.test(src) ? <img src={src} alt={`Onchain artwork for Squeek #${id}`} loading="lazy" /> : <div className="art-unavailable"><SqueekArt /><span className="small muted">{data.isLoading ? 'Loading artwork…' : 'Artwork unavailable'}</span></div>
}
function Guide({ onClose }: { onClose: () => void }) { return <Modal title="A desk for your next move" onClose={onClose} wide><div className="guide-content"><p>Squeek Merge Desk is a community utility for Squeekchain Genesis holders on Sepolia.</p><ol><li><strong>Review your holdings.</strong> Connect a browser wallet, open this page in a mobile wallet, or review a public address. Holdings include wallet-held and deposited Squeeks.</li><li><strong>Compare your options.</strong> Ready pairs share a level and custody. The desk favors deposited pairs, then the greatest base-power gain. Staking quotes use the current contract and your existing principal.</li><li><strong>Choose the survivor.</strong> A merge burns the donor forever. The survivor keeps its ID and image. A wallet-held survivor needs depositing in the official app to earn staking rewards.</li><li><strong>Review an unsigned call.</strong> The desk checks ownership and the contract deployment, then simulates. Download the call or send it to your wallet for review and signing. You pay Sepolia gas.</li></ol><h3>About staking and rewards</h3><p>Wallet-held Squeeks do not earn staking rewards. A claim pays funded account rewards to the account’s configured recipient. SQK staking has a fresh period and variable exit fees; power is not a promise of future rewards.</p><h3>Buildooooor ownership</h3><p>This community project is built for the Squeekchain Buildooooor badge. Genesis checks ownership from payment of the project’s first IMD job by a regular wallet already verified on the builder’s Genesis profile. This site does not verify that payment or award a badge.</p><a href="https://squeekchain.com/genesis/code" target="_blank" rel="noreferrer">Read the Genesis project requirements<ArrowUpRight size={16} /></a><details className="contract-details"><summary>View the pinned Sepolia contracts</summary><dl>{Object.entries(CONTRACTS).map(([name, address]) => <div key={name}><dt>{name === 'genesis' ? 'Genesis NFT' : name.charAt(0).toUpperCase() + name.slice(1)}</dt><dd><a href={`https://sepolia.etherscan.io/address/${address}`} target="_blank" rel="noreferrer"><code>{address}</code></a></dd></div>)}</dl></details><p className="small muted">The app reads your public address through Squeekchain’s API and a public Sepolia RPC. No private keys are requested or stored. Wallet reconnection preferences are stored by the wallet library in this browser.</p></div></Modal> }
