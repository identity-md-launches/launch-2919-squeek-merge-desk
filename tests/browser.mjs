import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile, mkdir, writeFile, rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve, extname, sep } from 'node:path'
import { chromium, webkit } from 'playwright'
import AxeBuilder from '@axe-core/playwright'

const root = fileURLToPath(new URL('../', import.meta.url))
const dist = resolve(root, 'dist'), output = resolve(root, 'test/scratch/browser-validation')
const fixture = JSON.parse(await readFile(resolve(root, 'tests/fixtures/sepolia-rpc.json'), 'utf8'))
assert(Object.keys(fixture.records).length > 50, 'Record the public RPC fixtures first.')
await mkdir(output, { recursive: true })
function normalize(v) {
  if (typeof v === 'string') return v.startsWith('0x') ? v.toLowerCase() : v
  if (Array.isArray(v)) return v.map(normalize)
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, normalize(x)]))
  return v
}
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' }
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname)
    if (!pathname.startsWith('/preview/')) { res.writeHead(404); res.end(); return }
    const file = resolve(dist, pathname.slice('/preview/'.length) || 'index.html')
    if (!file.startsWith(dist + sep)) { res.writeHead(403); res.end(); return }
    const content = await readFile(file)
    res.writeHead(200, { 'content-type': mime[extname(file)] ?? 'application/octet-stream' }); res.end(content)
  } catch { res.writeHead(404); res.end('Not found') }
})
await new Promise(done => server.listen(0, '127.0.0.1', done))
const url = `http://127.0.0.1:${server.address().port}/preview/`
const results = [], missing = new Set(), consoles = []
async function check(name, fn) { await fn(); results.push({ name, passed: true }); console.log(`PASS ${name}`) }
async function tabTo(page, control) {
  for (let i = 0; i < 80; i++) {
    if (await control.evaluate(el => el === document.activeElement)) return
    await page.keyboard.press('Tab')
  }
  throw new Error('Control was not reachable in the natural Tab order')
}
async function installRoutes(context, state = {}) {
  await context.route('**/*', async route => {
    const request = route.request(), address = request.url()
    if (address.startsWith(url) || address.startsWith('data:')) return route.continue()
    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST,GET,OPTIONS', 'content-type': 'application/json' }
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
    if (address.startsWith('https://api.squeekchain.com')) return route.fulfill({ status: 200, headers, body: JSON.stringify({ status: 'unavailable', reason: 'indexer_unavailable' }) })
    if (address.startsWith('https://ethereum-sepolia-rpc.publicnode.com')) {
      const body = request.postDataJSON()
      const respond = item => {
        if (state.wrongRpc && item.method === 'eth_chainId') return { jsonrpc: '2.0', id: item.id, result: '0x1' }
        if (state.revertSelector && item.method === 'eth_call' && item.params?.[0]?.data?.startsWith(state.revertSelector)) return { jsonrpc: '2.0', id: item.id, error: { code: 3, message: 'execution reverted' } }
        const key = JSON.stringify(normalize({ method: item.method, params: item.params ?? [] }))
        const response = fixture.records[key]
        if (!response) { missing.add(key); return { jsonrpc: '2.0', id: item.id, error: { code: -32601, message: 'Unrecorded test request' } } }
        return { jsonrpc: '2.0', id: item.id, ...response }
      }
      return route.fulfill({ status: 200, headers, body: JSON.stringify(Array.isArray(body) ? body.map(respond) : respond(body)) })
    }
    return route.abort()
  })
}
async function installWallet(context) {
  await context.addInitScript(({ owner }) => {
    let connected = false, chain = '0xaa36a7'
    const listeners = new Map()
    const emit = (name, value) => (listeners.get(name) ?? []).forEach(fn => fn(value))
    window.testWalletRequests = []
    window.testUnknownChain = false
    window.testSetChain = id => { chain = id; emit('chainChanged', id) }
    const provider = {
      on: (name, fn) => listeners.set(name, [...(listeners.get(name) ?? []), fn]),
      removeListener: (name, fn) => listeners.set(name, (listeners.get(name) ?? []).filter(x => x !== fn)),
      request: async ({ method, params }) => {
        window.testWalletRequests.push({ method, params })
        if (method === 'eth_requestAccounts') { connected = true; return [owner] }
        if (method === 'eth_accounts') return connected ? [owner] : []
        if (method === 'eth_chainId') return chain
        if (method === 'wallet_requestPermissions') return [{ parentCapability: 'eth_accounts' }]
        if (method === 'wallet_getPermissions') return []
        if (method === 'wallet_switchEthereumChain') {
          if (window.testUnknownChain) { window.testUnknownChain = false; throw Object.assign(new Error('Unknown chain'), { code: 4902 }) }
          chain = params[0].chainId; emit('chainChanged', chain); return null
        }
        if (method === 'wallet_addEthereumChain') { chain = params[0].chainId; emit('chainChanged', chain); return null }
        if (method === 'eth_sendTransaction' || method === 'wallet_sendCalls') throw Object.assign(new Error('User rejected the request'), { code: 4001 })
        if (method === 'wallet_getCapabilities') return {}
        if (method === 'wallet_revokePermissions') { connected = false; return null }
        throw Object.assign(new Error(`Unsupported test wallet request ${method}`), { code: 4200 })
      },
    }
    window.ethereum = provider
    const detail = { info: { uuid: 'a20b08a4-c6b1-4182-970e-65dfadfc8f10', name: 'Desk Test Wallet', icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28"><rect width="28" height="28" rx="6" fill="%23f6ad78"/></svg>', rdns: 'community.squeek.test' }, provider }
    const announce = () => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail }))
    window.addEventListener('eip6963:requestProvider', announce); announce()
  }, { owner: fixture.stakedOwner })
}
async function audit(page, name) {
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  await writeFile(resolve(output, `axe-${name}.json`), JSON.stringify(result.violations, null, 2))
  assert.deepEqual(result.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target) })), [], `Accessibility scan: ${name}`)
}
async function run(engine, name) {
  const browser = await engine.launch({ headless: true })
  try {
    const state = {}, context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' })
    if (name === 'chromium') await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await installRoutes(context, state); await installWallet(context)
    const page = await context.newPage()
    page.on('pageerror', e => consoles.push(`${name}: ${e.message}`))
    await page.goto(url); await page.locator('h1').waitFor(); await page.evaluate(() => document.fonts.ready)
    await check(`${name}: production subpath, metadata and first phone action`, async () => {
      assert.match(await page.title(), /Squeek Merge Desk/)
      const box = await page.getByRole('button', { name: 'Connect wallet', exact: true }).boundingBox()
      assert(box.y + box.height <= 844)
      assert.equal(await page.locator('meta[property="og:image"]').getAttribute('content'), './share.png')
      await page.screenshot({ path: resolve(output, `${name}-390.webp`), type: 'webp' })
      assert(await page.evaluate(() => document.fonts.check('16px Manrope')))
      await audit(page, `${name}-disconnected`)
    })
    await check(`${name}: reflow at seven content widths`, async () => {
      for (const width of [320, 390, 570, 760, 940, 1160, 1440]) {
        await page.setViewportSize({ width, height: 900 })
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Overflow at ${width}`)
      }
      await page.screenshot({ path: resolve(output, `${name}-1440.webp`), type: 'webp', fullPage: true })
    })
    await check(`${name}: guide keyboard trap, Escape and focus return`, async () => {
      const trigger = page.getByRole('button', { name: 'Desk guide', exact: true })
      await trigger.focus(); await page.keyboard.press('Enter')
      await page.getByRole('dialog').waitFor()
      for (let i = 0; i < 12; i++) {
        await page.keyboard.press('Tab')
        const focus = await page.evaluate(() => ({ inside: !!document.activeElement.closest('dialog'), active: document.activeElement.outerHTML.slice(0, 220), open: document.querySelector('dialog')?.open, controls: [...(document.querySelector('dialog')?.querySelectorAll('button,a[href],summary') ?? [])].filter(el => el.getClientRects().length).map(el => el.textContent) }))
        assert(focus.inside, JSON.stringify({ i, ...focus }))
      }
      await page.screenshot({ path: resolve(output, `${name}-keyboard-focus.webp`), type: 'webp' })
      await page.keyboard.press('Escape'); await page.getByRole('dialog').waitFor({ state: 'detached' })
      assert(await trigger.evaluate(el => document.activeElement === el))
    })
    await check(`${name}: EIP-6963 connection and honest indexer failure`, async () => {
      await tabTo(page, page.getByRole('button', { name: 'Connect wallet', exact: true })); await page.keyboard.press('Enter')
      assert.equal(await page.getByRole('button', { name: 'Browser wallet', exact: true }).count(), 0)
      await tabTo(page, page.getByRole('button', { name: /Desk Test Wallet/ })); await page.keyboard.press('Enter')
      await page.getByText(/Squeekchain data is unavailable/).waitFor()
      assert(await page.getByRole('button', { name: 'Prepare merge', exact: true }).isDisabled())
    })
    await check(`${name}: direct onchain recovery, ownership and partial inventory`, async () => {
      state.wrongRpc = true
      await page.locator('#direct-ids').fill('201,202')
      await page.getByRole('button', { name: 'Read onchain', exact: true }).click()
      await page.getByText('The RPC is not on Sepolia. Transactions are blocked.').waitFor()
      assert(await page.getByRole('button', { name: 'Prepare merge', exact: true }).isDisabled())
      state.wrongRpc = false
      await page.getByRole('button', { name: 'Try again', exact: true }).click()
      await page.getByText(/Partial inventory: only the 2 IDs/).waitFor({ timeout: 20_000 })
      await page.getByText('Merge #201 with #202.', { exact: true }).waitFor()
      await audit(page, `${name}-connected`)
      for (const width of [320, 390, 570, 760, 940, 1160, 1440]) {
        await page.setViewportSize({ width, height: 900 })
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Connected overflow at ${width}`)
      }
      await page.evaluate(() => scrollTo(0, 0)); await page.screenshot({ path: resolve(output, `${name}-connected-1440.webp`), type: 'webp', fullPage: true })
    })
    await check(`${name}: filters, search, empty state and reset`, async () => {
      await page.getByRole('button', { name: 'In wallet', exact: true }).click()
      await page.getByRole('heading', { name: 'No matching Squeeks' }).waitFor()
      await page.getByRole('button', { name: 'Clear filters', exact: true }).click()
      assert.equal(await page.locator('.token-card').count(), 2)
      await page.getByRole('textbox', { name: 'Search by Squeek ID' }).fill('201')
      assert.equal(await page.locator('.token-card').count(), 1)
      await page.getByRole('textbox', { name: 'Search by Squeek ID' }).fill('999999')
      await page.getByRole('heading', { name: 'No matching Squeeks' }).waitFor()
      await page.getByRole('button', { name: 'Clear filters', exact: true }).click()
      await page.locator('.sort-label select').selectOption('level')
      assert.equal(await page.locator('.token-card').count(), 2)
    })
    await check(`${name}: swap survivor, simulate merge and export exact unsigned call`, async () => {
      await tabTo(page, page.getByRole('button', { name: 'Plan this merge', exact: true })); await page.keyboard.press('Enter')
      assert.equal(await page.locator('#survivor').inputValue(), '201')
      assert.equal(await page.locator('#donor').inputValue(), '202')
      await tabTo(page, page.getByRole('button', { name: 'Swap survivor and donor', exact: true })); await page.keyboard.press('Enter')
      assert.equal(await page.locator('#survivor').inputValue(), '202')
      assert.equal(await page.locator('#donor').inputValue(), '201')
      await tabTo(page, page.getByRole('button', { name: 'Prepare merge', exact: true })); await page.keyboard.press('Enter')
      const dialog = page.getByRole('dialog'); await dialog.getByRole('heading', { name: 'Review merge' }).waitFor()
      assert(await dialog.getByRole('button', { name: 'Send to wallet' }).isDisabled())
      assert(await dialog.getByRole('button', { name: 'Download JSON' }).isDisabled())
      await tabTo(page, dialog.getByRole('checkbox')); await page.keyboard.press('Space')
      assert(await dialog.getByRole('checkbox').isChecked())
      await dialog.getByText('Inspect unsigned call', { exact: true }).click()
      const bundle = JSON.parse(await dialog.locator('pre').innerText())
      assert.equal(bundle.chainId, '0xaa36a7'); assert.equal(bundle.from.toLowerCase(), fixture.stakedOwner.toLowerCase())
      assert.equal(bundle.calls[0].to.toLowerCase(), '0x4b67b739dfd832f4eac67a7aa3bc244fb74cea4f')
      assert.equal(BigInt('0x' + bundle.calls[0].data.slice(-128, -64)), 202n)
      assert.equal(BigInt('0x' + bundle.calls[0].data.slice(-64)), 201n)
      const downloadEvent = page.waitForEvent('download')
      await tabTo(page, dialog.getByRole('button', { name: 'Download JSON' })); await page.keyboard.press('Enter')
      const download = await downloadEvent; const file = resolve(output, `${name}-merge.json`); await download.saveAs(file)
      const exported = JSON.parse(await readFile(file, 'utf8')); assert.deepEqual(exported.bundle, bundle)
      if (name === 'chromium') {
        await dialog.getByRole('button', { name: 'Copy call', exact: true }).click()
        await dialog.getByRole('button', { name: 'Copied', exact: true }).waitFor()
        assert.deepEqual(JSON.parse(await page.evaluate(() => navigator.clipboard.readText())), bundle)
      }
      await audit(page, `${name}-merge-review`)
      await dialog.evaluate(el => { el.scrollTop = 0 })
      await page.screenshot({ path: resolve(output, `${name}-merge-review.webp`), type: 'webp' })
      await tabTo(page, dialog.getByRole('button', { name: 'Send to wallet' })); await page.keyboard.press('Enter')
      await dialog.getByText(/The wallet request was declined/).waitFor()
      assert.equal((await page.evaluate(() => window.testWalletRequests.filter(r => r.method === 'eth_sendTransaction'))).length, 1)
      await page.keyboard.press('Escape')
      state.revertSelector = bundle.calls[0].data.slice(0, 10)
      await page.getByRole('button', { name: 'Prepare merge', exact: true }).click()
      await page.getByText(/The contract rejected this request/).waitFor()
      assert.equal(await page.getByRole('dialog').count(), 0, 'A failed dry run cannot open transaction review')
      state.revertSelector = undefined
    })
    await check(`${name}: claim simulation preserves the actual recipient and payout`, async () => {
      await page.getByRole('button', { name: 'Prepare claim', exact: true }).click()
      const dialog = page.getByRole('dialog'); await dialog.getByRole('heading', { name: 'Review claim' }).waitFor()
      assert.match(await dialog.innerText(), /Estimated claim/)
      assert.match(await dialog.innerText(), new RegExp(fixture.stakedOwner, 'i'))
      await dialog.getByText('Inspect unsigned call', { exact: true }).click()
      const bundle = JSON.parse(await dialog.locator('pre').innerText())
      assert.equal(bundle.calls[0].data.slice(0, 10), '0x1e83409a')
      await page.keyboard.press('Escape')
    })
    await check(`${name}: wrong network, add-chain fallback and recovery`, async () => {
      await page.evaluate(() => { window.testUnknownChain = true; window.testSetChain('0x1') })
      await page.getByRole('button', { name: 'Switch to Sepolia', exact: true }).waitFor()
      assert(await page.getByRole('button', { name: 'Prepare claim', exact: true }).isDisabled())
      await page.getByRole('button', { name: 'Switch to Sepolia', exact: true }).click()
      await page.getByRole('button', { name: 'Prepare claim', exact: true }).waitFor({ state: 'visible' })
      await page.waitForFunction(() => window.testWalletRequests.some(r => r.method === 'wallet_addEthereumChain'))
      assert.equal(await page.getByRole('button', { name: 'Switch to Sepolia', exact: true }).count(), 0)
    })
    await check(`${name}: staking validation, power quote and exact approval`, async () => {
      await page.getByRole('button', { name: 'Stake SQK', exact: true }).click()
      await page.locator('#stake-amount').fill('-1')
      await page.getByRole('button', { name: 'Compare power', exact: true }).click()
      await page.getByText(/Enter a positive SQK amount/).waitFor()
      await page.locator('#stake-amount').fill('100')
      await page.getByRole('button', { name: 'Compare power', exact: true }).click()
      await page.getByText(/additional power/, { exact: false }).first().waitFor()
      await page.getByRole('button', { name: 'Prepare stake or approval', exact: true }).click()
      const dialog = page.getByRole('dialog'); await dialog.getByRole('heading', { name: 'Review SQK approval' }).waitFor()
      await dialog.getByText('Inspect unsigned call', { exact: true }).click()
      const bundle = JSON.parse(await dialog.locator('pre').innerText())
      assert.equal(bundle.calls[0].data.slice(0, 10), '0x095ea7b3')
      assert.equal(BigInt('0x' + bundle.calls[0].data.slice(-64)), 100n * 10n ** 18n)
      await page.keyboard.press('Escape')
    })
    await check(`${name}: connected mobile layout and disconnect`, async () => {
      await page.setViewportSize({ width: 390, height: 844 }); await page.evaluate(() => scrollTo(0, 0))
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      await page.screenshot({ path: resolve(output, `${name}-connected-390.webp`), type: 'webp', fullPage: true })
      await page.locator('.wallet-control').click()
      await page.getByRole('button', { name: 'Disconnect', exact: true }).click()
      await page.getByRole('button', { name: 'Connect wallet', exact: true }).waitFor()
      assert.equal(await page.getByText(/Partial inventory:/).count(), 0)
    })
    await context.close()
    const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1', isMobile: true, hasTouch: true })
    await installRoutes(phone)
    const mobile = await phone.newPage(); await mobile.goto(url)
    await check(`${name}: phone wallet links and Coinbase Smart Wallet sheet`, async () => {
      await mobile.getByRole('button', { name: 'Connect wallet', exact: true }).click()
      for (const wallet of ['MetaMask', 'Coinbase Wallet', 'Rabby', 'Phantom']) { const link = mobile.getByRole('link', { name: `Open in ${wallet}`, exact: true }); assert(await link.isVisible()); assert.equal(await link.locator('img').count(), 1) }
      assert(await mobile.getByRole('button', { name: /Coinbase Smart Wallet/ }).isVisible())
      assert.equal(await mobile.getByRole('button', { name: 'Browser wallet', exact: true }).count(), 0)
      const box = await mobile.getByRole('dialog').boundingBox(); assert(Math.abs(box.y + box.height - 844) <= 1)
      await mobile.screenshot({ path: resolve(output, `${name}-phone-wallets.webp`), type: 'webp' })
      await audit(mobile, `${name}-phone-wallets`)
      await mobile.keyboard.press('Escape')
    })
    await check(`${name}: public-address validation, read-only plan and ownership failure`, async () => {
      await mobile.getByText('Review a public address instead', { exact: true }).click()
      await mobile.locator('#review-address').fill('invalid')
      await mobile.getByRole('button', { name: 'Review', exact: true }).click()
      await mobile.getByText('Enter a valid, nonzero Ethereum address.').waitFor()
      assert(await mobile.locator('#review-address').evaluate(el => document.activeElement === el))
      await mobile.locator('#review-address').fill(fixture.walletOwner)
      await mobile.locator('#review-token-ids').fill('1,2')
      await mobile.getByRole('button', { name: 'Review', exact: true }).click()
      await mobile.getByText('Merge #1 with #2.', { exact: true }).waitFor()
      await mobile.getByRole('button', { name: 'Plan this merge', exact: true }).click()
      assert(await mobile.getByRole('button', { name: 'Prepare merge', exact: true }).isDisabled())
      await mobile.getByText('Read specific Squeeks directly from Sepolia', { exact: true }).click()
      await mobile.locator('#direct-ids').fill('201,202')
      await mobile.getByRole('button', { name: 'Read onchain', exact: true }).click()
      await mobile.getByText(/This address is not the depositor/).waitFor()
      assert(await mobile.getByRole('button', { name: 'Prepare merge', exact: true }).isDisabled())
      assert(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      await mobile.getByRole('button', { name: 'Change address', exact: true }).click()
      await mobile.getByText('Review a public address instead', { exact: true }).waitFor()
    })
    await check(`${name}: a single Squeek recommends a concrete additional stake`, async () => {
      await mobile.getByText('Review a public address instead', { exact: true }).click()
      await mobile.locator('#review-address').fill(fixture.stakedOwner)
      await mobile.locator('#review-token-ids').fill('201')
      await mobile.getByRole('button', { name: 'Review', exact: true }).click()
      await mobile.getByText('Put more SQK to work.', { exact: true }).waitFor()
      await mobile.getByRole('button', { name: 'Compare staking', exact: true }).click()
      assert(Number(await mobile.locator('#stake-amount').inputValue()) > 0)
      await mobile.getByRole('button', { name: 'Compare power', exact: true }).click()
      await mobile.getByText(/additional power/, { exact: false }).first().waitFor()
      assert(await mobile.getByRole('button', { name: 'Prepare stake or approval', exact: true }).isDisabled())
    })
    await phone.close()
  } finally { await browser.close() }
}
try {
  await run(chromium, 'chromium')
  try { await run(webkit, 'webkit') } catch (error) {
    if (/Host system is missing dependencies|Executable doesn't exist|error while loading shared libraries/.test(String(error))) { results.push({ name: 'WebKit', passed: null, limitation: String(error).slice(0, 1500) }); console.log('LIMITATION WebKit system libraries unavailable') }
    else throw error
  }
  assert.deepEqual([...missing], [], 'Every RPC response must be a recorded public-chain response')
  assert.deepEqual(consoles, [], 'No uncaught page errors')
  await writeFile(resolve(output, 'results.json'), JSON.stringify({ fixtureBlock: fixture.block, results, missing: [...missing], pageErrors: consoles }, null, 2))
  await rm(resolve(output, 'failure.json'), { force: true })
  console.log(`${results.filter(r => r.passed).length} browser checks passed; ${results.filter(r => r.passed === null).length} environment limitation(s).`)
} catch (error) {
  await writeFile(resolve(output, 'failure.json'), JSON.stringify({ error: String(error), results, missing: [...missing], pageErrors: consoles }, null, 2))
  console.error(error); process.exitCode = 1
} finally { await new Promise(done => server.close(done)) }
