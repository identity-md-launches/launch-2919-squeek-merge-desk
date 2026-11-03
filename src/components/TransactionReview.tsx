import { useState } from 'react'
import { useConnection, useWalletClient } from 'wagmi'
import { ArrowUpRight, Check, Copy, Download, ShieldCheck } from 'lucide-react'
import { isAddressEqual, type Hex } from 'viem'
import { Modal } from './Modal'
import type { Prepared } from '../protocol/types'
import { actionLabel, amountLabel } from '../protocol/planner'
import { friendlyError, prepareAction, unsignedBundle } from '../protocol/transactions'
import { chain, client } from '../protocol/config'

export function TransactionReview({ initial, onClose, onConfirmed }: { initial: Prepared; onClose: () => void; onConfirmed: () => void }) {
  const { address, chainId } = useConnection(), { data: wallet } = useWalletClient()
  const [prepared, setPrepared] = useState(initial), [error, setError] = useState(''), [pending, setPending] = useState(false)
  const [ack, setAck] = useState(false), [copied, setCopied] = useState(false), [hash, setHash] = useState<Hex>(), [confirmed, setConfirmed] = useState(false)
  const action = prepared.action, merge = action.kind === 'merge'
  const canSign = !!wallet && !!address && isAddressEqual(address, prepared.from) && chainId === 11155111
  const json = JSON.stringify(unsignedBundle(prepared), null, 2)
  async function send() {
    if (!wallet || !canSign || (merge && !ack)) return
    setPending(true); setError('')
    try {
      if (await wallet.getChainId() !== 11155111) throw new Error('Switch your wallet to Sepolia and try again.')
      const accounts = await wallet.getAddresses()
      if (!accounts[0] || !isAddressEqual(accounts[0], prepared.from)) throw new Error('Your wallet account changed. Close this review and prepare again.')
      const fresh = await prepareAction(action, prepared.from)
      setPrepared(fresh)
      if (fresh.recipient && prepared.recipient && !isAddressEqual(fresh.recipient, prepared.recipient)) throw new Error('Your claim recipient changed. Review the updated recipient before trying again.')
      if (action.kind === 'merge' && (fresh.newLevel !== prepared.newLevel || fresh.baseGain !== prepared.baseGain)) throw new Error('The Squeek levels or power changed. Review the updated merge before trying again.')
      const tx = await wallet.sendTransaction({ account: prepared.from, chain, to: fresh.to, data: fresh.data, value: 0n })
      setHash(tx)
      const receipt = await client.waitForTransactionReceipt({ hash: tx, timeout: 90_000 })
      if (receipt.status !== 'success') throw new Error('The transaction reverted on Sepolia. Refresh your inventory before trying again.')
      setConfirmed(true); onConfirmed()
    } catch (e) { setError(friendlyError(e)) } finally { setPending(false) }
  }
  function download() {
    const payload = JSON.stringify({ description: actionLabel(action), simulation: { blockNumber: prepared.blockNumber, blockHash: prepared.blockHash, preparedAt: prepared.preparedAt }, bundle: unsignedBundle(prepared) }, null, 2)
    const url = URL.createObjectURL(new Blob([payload], { type: 'application/json' }))
    const a = document.createElement('a'); a.href = url; a.download = `squeek-${action.kind}-sepolia.json`; a.click(); URL.revokeObjectURL(url)
  }
  return <Modal title={confirmed ? 'Transaction confirmed' : hash ? 'Transaction submitted' : `Review ${action.kind === 'approve' ? 'SQK approval' : action.kind}`} onClose={onClose} wide>
    {confirmed ? <p className="notice notice-success"><Check size={20} />Confirmed on Sepolia. Refresh after the indexer catches up to see the updated inventory.</p> : <p className="review-status"><ShieldCheck size={18} />Simulation passed at Ethereum block {prepared.blockNumber}.</p>}
    <dl className="review-facts">
      <div><dt>Action</dt><dd>{actionLabel(action)}</dd></div>
      {merge && <><div><dt>Survivor</dt><dd>#{action.survivor} · Level {prepared.newLevel}</dd></div><div><dt>Permanently burned</dt><dd className="danger-text">#{action.donor}</dd></div><div><dt>Additional base power</dt><dd>+{amountLabel(prepared.baseGain!, 0, 0)}</dd></div><div><dt>Custody</dt><dd>{action.custody === 'staking' ? 'Stays deposited in staking' : 'Stays in your wallet; deposit to earn'}</dd></div></>}
      {prepared.payout && <div><dt>Estimated claim</dt><dd>{amountLabel(prepared.payout)} SQK</dd></div>}
      {(action.kind === 'stake' || action.kind === 'approve') && <div><dt>Amount</dt><dd>{amountLabel(action.amount)} SQK</dd></div>}
      {prepared.recipient && <div className="vertical-fact"><dt>Claim recipient</dt><dd><code>{prepared.recipient}</code>{!isAddressEqual(prepared.recipient, prepared.from) && <span className="danger-text small">This is your configured recipient, a different wallet.</span>}</dd></div>}
      <div className="vertical-fact"><dt>From</dt><dd><code>{prepared.from}</code></dd></div>
      <div className="vertical-fact"><dt>Contract on Sepolia</dt><dd><a className="address-link" href={`https://sepolia.etherscan.io/address/${prepared.to}`} target="_blank" rel="noreferrer"><code>{prepared.to}</code><ArrowUpRight size={15} /></a></dd></div>
      <div><dt>ETH sent</dt><dd>0 ETH + wallet-estimated gas</dd></div>
    </dl>
    {!hash && <>
      {merge && <label className="confirmation"><input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)} /><span>I understand Squeek #{action.donor} is permanently burned. Squeek #{action.survivor} keeps its ID and image.</span></label>}
      {action.kind === 'approve' && <p className="notice">This approval lets the staking contract spend exactly {amountLabel(action.amount)} SQK. After it confirms, prepare a separate stake.</p>}
      {action.kind === 'stake' && <p className="notice">New stake has a fresh period. Unstaking can charge a variable exit fee. Review the current policy before signing.</p>}
      <details className="call-details"><summary>Inspect unsigned call</summary><pre tabIndex={0} role="region" aria-label="Unsigned transaction JSON">{json}</pre></details>
      <div className="review-actions">
        <button className="button button-primary" disabled={!canSign || pending || (merge && !ack)} onClick={() => void send()}><WalletIcon />{pending ? 'Checking your wallet…' : 'Send to wallet'}</button>
        <button className="button button-secondary" disabled={merge && !ack} onClick={download}><Download size={17} />Download JSON</button>
        <button className="button button-secondary" disabled={merge && !ack} onClick={async () => { try { await navigator.clipboard.writeText(json); setCopied(true) } catch { setError('Clipboard unavailable. Download the JSON instead.') } }}><Copy size={17} />{copied ? 'Copied' : 'Copy call'}</button>
      </div>
      <p className="small muted">This is an unsigned call. Your wallet shows gas and asks for your signature. Eligibility is checked again before sending.</p>
      {!canSign && <p className="notice" role="status">Connect the owner wallet on Sepolia to send this call.</p>}
    </>}
    {hash && <p><a href={`https://sepolia.etherscan.io/tx/${hash}`} target="_blank" rel="noreferrer">View transaction on Sepolia Etherscan <ArrowUpRight size={15} /></a></p>}
    {pending && hash && <p role="status" className="muted">Waiting for confirmation. You can follow the transaction on Etherscan.</p>}
    {error && <p className="notice notice-error" role="alert">{error}</p>}
  </Modal>
}
function WalletIcon() { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><rect x="3" y="5" width="18" height="15" rx="3" /><path d="M16 11h5v5h-5zM4 5V3h13" /></svg> }
