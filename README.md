# Squeek Merge Desk

A community project for the Squeekchain **Buildooooor badge**. This English-first, dark-theme holder utility runs on **Sepolia only**. Review Genesis Squeeks, choose a concrete merge pair or compare additional SQK staking, and prepare unsigned claim/merge calls. Your wallet signs; the app never requests or stores a private key.

## Install, run and rebuild

Use Node.js 24 and npm:

```sh
npm ci
npm run dev
```

Preview the included production export:

```sh
npm run preview
```

Rebuild it from source:

```sh
npm run typecheck
npm test
npm run build
```

`dist/index.html` and all its assets are included. Import the **contents of `dist/`** into Genesis IMD or a static/IPFS host. Vite uses `base: './'`; asset paths are relative, navigation stays on one page, and no server rewrites, API keys or environment files are required. Fonts, icons, favicon and share image are local. Wallets, chain reads and the public indexer need network access.

## Use the desk

Connect an EIP-6963 browser wallet or Coinbase Wallet. On a phone, the same control offers MetaMask, Coinbase Wallet, Rabby, Phantom and Coinbase Smart Wallet. Switch to Sepolia before preparing transactions.

The desk loads wallet-held and deposited Squeeks. Choose the proposed pair or select a survivor and matching donor yourself. A merge **permanently burns the donor**. Review and acknowledge the exact IDs, then download/copy the unsigned call or send it to your wallet. Claims show the actual configured recipient. Staking quotes are contract reads; any required approval is for the exact entered amount and is a separate transaction.

If the indexer is unavailable, enter up to 32 token IDs under “Read specific Squeeks directly from Sepolia.” Ownership, balances and eligibility are read onchain. This mode clearly shows a partial inventory and recommends only from the entered IDs. A public-address review is read-only until the owner wallet connects.

## Validation

Production build and typecheck passed; **10 unit tests**, **14 Chromium interaction checks**, and **16/16 pinned taste checks** passed. Checks include unsigned JSON export/copy, burn acknowledgement, wallet rejection, wrong chain/add-chain recovery, ownership failure, failed simulation, filters, staking quotes and mobile wallet links. Browser checks replay actual public Sepolia read responses; no transaction was broadcast.

```sh
npx playwright install chromium
npm run test:browser
```

The browser script serves the built export under `/preview/`, runs bounded checks, and closes its server. It also attempts WebKit. Here WebKit lacked system libraries, so Safari, physical wallet-app handoffs, Coinbase passkey creation, live signatures/receipts and native 200% zoom were not verified. The supplied browser MCP also lacked Chrome; standalone Playwright Chromium was used. The indexer returned intermittent `unavailable` responses; the direct-read recovery was validated. See [the complete validation record](artifacts/validation.md), [integration details](artifacts/INTEGRATION.md), and [DESIGN.md](DESIGN.md).

The optional `npm run test:record` refreshes `tests/fixtures/sepolia-rpc.json` using public, read-only Sepolia calls. It uses public holder addresses solely as test fixtures, and refuses broadcast methods. Normal tests are independent of the live indexer/RPC.

## Genesis attribution

For Buildooooor ownership, the project's **first IMD job must be paid by a regular wallet already verified on the builder's Genesis profile**. Connecting here does not establish that attribution. This build did not make or verify a job payment and does not claim a badge or team approval. [Genesis explains its project requirements](https://squeekchain.com/genesis/code).

Third-party notices are included in `public/THIRD-PARTY.txt`, `public/licenses/` and `artifacts/licenses/`. Design guidance attribution is recorded in [DESIGN.md](DESIGN.md).
