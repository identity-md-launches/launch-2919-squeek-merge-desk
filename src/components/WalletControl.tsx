import { useEffect, useState } from 'react'
import { useConnect, useConnection, useConnectors, useDisconnect, useSwitchChain } from 'wagmi'
import { ArrowUpRight, ChevronDown, Copy, ExternalLink, LogOut, Wallet } from 'lucide-react'
import { getAddress } from 'viem'
import { Modal } from './Modal'
import { friendlyError } from '../protocol/transactions'
import { OPEN_IN } from '../protocol/open-in'

export const shortAddress = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`
export function WalletControl() {
  const { address, isConnected, chainId } = useConnection()
  const connectors = useConnectors()
  const connect = useConnect(), disconnect = useDisconnect(), switchChain = useSwitchChain()
  const [open, setOpen] = useState(false), [error, setError] = useState(''), [copied, setCopied] = useState(false)
  const named = connectors.some(c => c.type === 'injected' && c.id !== 'injected')
  const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) && !named && !(window as Window & { ethereum?: unknown }).ethereum
  const listed = [...connectors.filter(c => c.type === 'injected'), ...connectors.filter(c => c.type !== 'injected')].filter(c => !(c.id === 'injected' && named) && !(mobile && c.type === 'injected'))
  const wrong = isConnected && chainId !== 11155111
  useEffect(() => { if (isConnected) { setOpen(false); setError('') } }, [isConnected])
  async function switchNetwork() {
    setError('')
    try { await switchChain.mutateAsync({ chainId: 11155111 }) } catch (e) { setError(friendlyError(e)); setOpen(true) }
  }
  return <>
    <button className={`button ${isConnected ? 'button-secondary' : 'button-primary'} wallet-control`} onClick={() => { setError(''); if (wrong) void switchNetwork(); else setOpen(true) }} disabled={switchChain.isPending}>
      <Wallet size={17} /><span>{switchChain.isPending ? 'Switching…' : wrong ? 'Switch to Sepolia' : address ? shortAddress(getAddress(address)) : 'Connect wallet'}</span>{isConnected && !wrong && <ChevronDown size={15} />}
    </button>
    {open && <Modal title={isConnected ? 'Connected wallet' : 'Connect a wallet'} onClose={() => setOpen(false)}>
      {isConnected && address ? <>
        <p className="muted">{wrong ? 'Switch to Sepolia to prepare transactions.' : 'Connected on Sepolia. Your wallet signs every transaction.'}</p>
        <code className="full-address">{getAddress(address)}</code>
        <div className="wallet-list">
          {wrong && <button className="wallet-row" onClick={() => void switchNetwork()}><Wallet size={24} />Switch to Sepolia<ArrowUpRight size={18} /></button>}
          <button className="wallet-row" onClick={async () => { try { await navigator.clipboard.writeText(getAddress(address)); setCopied(true) } catch { setError('Clipboard unavailable. Select and copy the address above.') } }}><Copy size={22} />{copied ? 'Address copied' : 'Copy address'}</button>
          <a className="wallet-row" href={`https://sepolia.etherscan.io/address/${address}`} target="_blank" rel="noreferrer"><ExternalLink size={22} />View on Sepolia Etherscan<ArrowUpRight size={18} /></a>
          <button className="wallet-row" onClick={() => { disconnect.mutate(); setOpen(false) }}><LogOut size={22} />Disconnect</button>
        </div>
      </> : <>
        <p className="muted">Connect to review your Genesis Squeeks. No signature is needed to connect.</p>
        <div className="wallet-list">
          {mobile && OPEN_IN.map(w => <a className="wallet-row" key={w.id} href={w.href(location.href)}><img src={`${import.meta.env.BASE_URL}wallets/${w.id}.svg`} width="28" height="28" alt="" /><span>Open in {w.name}</span><ArrowUpRight size={18} /></a>)}
          {listed.map(c => <button className="wallet-row" key={c.uid} disabled={connect.isPending} onClick={async () => {
            setError('')
            try { await connect.mutateAsync({ connector: c, chainId: 11155111 }); setOpen(false) } catch (e) { setError(friendlyError(e)) }
          }}>
            {c.icon ? <img src={c.icon} width="28" height="28" alt="" /> : c.id === 'coinbaseWalletSDK' ? <img src={`${import.meta.env.BASE_URL}wallets/coinbase.svg`} width="28" height="28" alt="" /> : <Wallet size={28} />}
            <span>{c.id === 'injected' ? 'Browser wallet' : c.id === 'coinbaseWalletSDK' ? mobile ? 'Coinbase Smart Wallet' : 'Coinbase Wallet' : c.name}{connect.isPending && connect.variables?.connector === c ? ' · Opening…' : ''}</span>
            <ArrowUpRight size={18} />
          </button>)}
        </div>
        <p className="small muted">On a phone, open this page in your wallet’s browser. Coinbase Smart Wallet also works with a passkey.</p>
      </>}
      {error && <p className="notice notice-error" role="alert">{error}</p>}
    </Modal>}
  </>
}
