import React, { Component, type ReactNode } from 'react'
import ReactDOM from 'react-dom/client'
import { WagmiProvider } from 'wagmi'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { config } from './protocol/config'
import App from './App'
import './styles.css'

const queryClient = new QueryClient()
class AppBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() { return this.state.failed ? <main className="page-shell fatal-error"><h1>Squeek Merge Desk</h1><p>The desk could not load. Refresh to try again.</p><button className="button button-primary" onClick={() => location.reload()}>Reload desk</button></main> : this.props.children }
}
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><AppBoundary><WagmiProvider config={config}><QueryClientProvider client={queryClient}><App /></QueryClientProvider></WagmiProvider></AppBoundary></React.StrictMode>)
