# Squeek Merge Desk design system

## Overview

A compact work desk for Squeekchain Genesis holders: warm charcoal surfaces, cream text, apricot actions and an original geometric hamster mark. Recommendations precede the collection; the action planner and funded rewards sit beside it on desktop. This is a tool, with the product name and wallet control on the first 390px screen. The disconnected illustration is decorative, not a fabricated holding.

The implementation lives in `src/styles.css`, `src/App.tsx` and `src/components/`. There is one dark theme. Native buttons, selects, details and modal dialogs provide the interaction foundation. No marketing hero, gradients, surface shadows or entrance sequence.

## Colors

Canonical values are sRGB hex in `src/styles.css`. Neutral primitives feed semantic tokens; components use semantic roles. Component-specific surfaces are also named tokens.

| Semantic token | Value | Use |
| --- | --- | --- |
| `--color-bg` | `#141615` | Page, input inset and code background |
| `--color-surface` | `#1a1d1b` | Stats, planner, rewards, dialogs and NFT cards |
| `--color-hover`, `--color-control` | `#202420` | Hover and field backgrounds |
| `--color-border` | `#3e453b` | Structural outlines and separators |
| `--color-text` | `#f1f2e9` | Main text |
| `--color-muted` | `#a7afa3` | Supporting text and neutral icons |
| `--color-accent` | `#f6ad78` | Primary fills and brand illustration |
| `--color-accent-hover` | `#ffc399` | Primary hover |
| `--color-on-accent` | `#22251e` | Primary-button foreground |
| `--color-success` | `#bedba5` | Ready/check/simulation status, with text or an icon |
| `--color-danger` | `#ffb3a7` | Errors and irreversible burn detail |
| `--color-focus` | `#f7d4b9` | Keyboard outline |
| `--color-recommendation` | `#1d211c` | Recommendation background |
| `--color-recommendation-border` | `#4a4d3e` | Recommendation outline |
| `--color-feature-bg` | `#343a2f` | Merge feature icon tile |
| `--color-soft-border` | `#353b30` | Recommendation footer separator |
| `--color-illustration` | `#b9bda6` | Decorative neutral Squeeks |
| `--color-error-bg` | `#32231f` | Error notice surface |

The active segmented control uses neutral primitive `--neutral-800` (`#292e28`). The remaining neutral primitives are `--neutral-950`, `900`, `850`, `700`, `400` and `100`, corresponding to the semantic values above. Accent/status primitives are `--apricot-400`, `--apricot-300`, `--green-400` and `--red-400`.

Measured declared opaque pairs: main text/page **16.11:1**, muted/page **8.05:1**, muted/surface **7.53:1**, muted/recommendation **7.23:1**, primary label/fill **8.26:1**, success/surface **11.22:1**, error/error surface **8.78:1**. The final taste probe also checked rendered entry-page text. Wallet-brand artwork and NFT images keep their own colors; image content is not a text contrast claim.

## Typography

Manrope variable, normal style, weights **400, 500 and 600**, locally served from `src/assets/manrope-latin.woff2` with `font-display: swap`. Fallback: Arial, sans-serif. Addresses/JSON use the system monospace stack. Fonts are not fetched at runtime.

| Token | Size | Role |
| --- | --- | --- |
| `--text-xs` | 12px | Captions, metadata, status detail |
| `--text-sm` | 14px | Buttons, supporting text, compact labels |
| `--text-body` | 16px | Body copy, inputs, card headings |
| `--text-heading` | 20px | Section headings and connected recommendation |
| `--text-feature` | 28px | Stats, reward amount, phone page title |
| `--text-display` | 40px | Desktop page title |

Body line-height is 1.5; the main heading is 1.15, section headings 1.3, card headings 1.4. Heading tracking is −0.045em at display size, −0.035em for the phone title, −0.025em for sections. Body tracking is natural. Headings use balanced wrapping; paragraphs use pretty wrapping. Data use tabular numbers and can wrap; full addresses and JSON remain available. The header's shortened wallet address expands to a complete address in its sheet. Inputs remain 16px on phones.

## Layout

The header is at most 1440px wide with 48px desktop insets. `.page-shell` is at most 1344px, including 48px inline padding and a 44px top inset. `.desk-grid` uses one flexible content column plus a 350px action column, separated by 28px. Alignment, spacing and tonal surfaces carry the hierarchy.

Spacing uses explicit values, mostly 4px increments: 4/8/12px within controls and groups, 16/20/24/28/32px between related surfaces, 44/48px at the page level. 6/10/14/18/22/26px are used for optical or compact component adjustments. These are source values, not an additional invented spacing-token API.

| Breakpoint | Implemented behavior |
| --- | --- |
| Above 1440px | Header inline inset becomes 72px |
| At 1160px | Page/header insets become 32px; sidebar 320px; NFT grid two columns |
| At 940px | Resource nav hides; sidebar 300px; stats lose icons; compact diagram |
| At 760px | Desk stacks; action area uses two columns; full-width collection can use three columns; title becomes 28px; page inset 24px |
| At 570px | Page/header inset 16px; stats become 2×2; actions stack; NFT grid two columns; dialogs become bottom sheets; filters/search wrap |
| At 350px | Compact brand/diagram, reduced button padding and stacked public-address form controls |

Reading/DOM order remains recommendation, collection, action planner and supporting notes. “Plan this merge” and card actions bring the planner into view. Section scrolling respects reduced motion. Screenshots/reflow checks cover 320, 390, 570, 760, 940, 1160 and 1440px with disconnected and connected data. Native 200% browser zoom and a physical device were not tested.

## Elevation & Depth

Flat surfaces use borders and tonal separation, never a combined border/shadow treatment. The recommendation has its own restrained green-gray surface. The native modal enters the browser top layer; its backdrop is black at 72% opacity with a 4px blur. Body scrolling is locked while open; native modal behavior makes the rest of the page inert. No sticky controls cover the content.

## Shapes

`--radius-sm: 6px` for buttons, fields and marks; `--radius: 12px` for panels/NFT cards; `--radius-lg: 16px` for recommendations/dialogs. Compact segment corners are 4px. NFT upper image corners are 11px, inset from a 12px outlined card. Phone sheets retain rounded upper corners and square lower corners with safe-area padding. Circles are reserved for tiny status dots.

## Components

- **Buttons** (`styles.css`): `.button-primary` is the filled current action; `.button-secondary` is outlined; `.text-button` is a low-emphasis resource/control. Recommendation actions relinquish primary fill when a planner action is ready. Normal buttons are at least 44px high; compact filters remain at least 38–40px. Disabled actions have nearby reasons.
- **`WalletControl`** (`components/WalletControl.tsx`): one first-screen connect control; per-wallet pending state, inline rejection, named EIP-6963 rows and local brand marks. It becomes an address menu when connected and a chain-switch action on another chain. Phone wallets are direct links; no QR/relay path.
- **`Modal`** (`components/Modal.tsx`): native `dialog`, common title/close button, Escape and backdrop closing. It explicitly wraps Tab/Shift+Tab among currently visible controls, excludes collapsed details, and restores trigger focus. Desktop width is 420px or 580px for wide reviews, with a 90dvh phone cap.
- **`TransactionReview`** (`components/TransactionReview.tsx`): readable action facts, full recipient/contract/owner addresses, explicit donor-burn acknowledgement, focusable scrollable JSON region, download/copy, wallet handoff and receipt state. Sending always rechecks chain/account and simulates again. Changed recipient or merge result requires renewed review.
- **Recommendation/merge planner** (`App.tsx`): real holdings/power values, native labeled survivor/donor selects, swap control and explicit result. Pair previews use the actual NFT image. Wallet and staking custody remain distinct.
- **NFT cards** (`TokenCard`/`TokenImage` in `App.tsx`): onchain data images only; image loading/unavailable state, level, custody, textual readiness/cooldown and planner action. Search/filter controls precede the collection, and an empty result offers reset.
- **Direct recovery** (`App.tsx`, `protocol/direct.ts`): labeled ID entry, ownership validation and an explicit partial-inventory notice. No fabricated holdings appear during service failure.
- **Original art** (`SqueekArt.tsx`, `public/favicon.svg`, `public/share.png`): decorative geometric hamster outline and apricot brand mark. Functional icons use Lucide with one outline style. Wallet marks keep their official colors.

Hover changes background/border, keyboard focus uses a 2px ring at 4px offset, and press scales buttons to 0.96. Transitions are 120ms and name their properties. Reduced motion removes CSS animations/transitions/press scaling and uses immediate section scrolling. A loading spinner always accompanies status text. Forced-colors CSS preserves a system focus outline and button borders; native forced-colors use was not inspected.

## Do's and Don'ts

- Reuse the semantic colors, six-size scale, native fields, button variants and `Modal` before adding a new pattern.
- Keep the product and connect action on the first phone screen; keep detailed protocol explanations in the guide/review.
- Distinguish unknown data, an empty collection, a partial inventory, a rejected wallet request and a confirmed receipt.
- Keep actual token IDs, claim recipients, Squeek-block cooldowns and burn consequences visible. Do not truncate critical addresses without a complete accessible alternative.
- Add a related surface by placing a section in the existing desk/side column, using a `.section-heading`, native controls and the current loading/error/empty patterns. Preserve mobile stacking and the shared focus rules.
- Do not add floating overlays, nested decorative cards, invented live metrics, extra font families or an arbitrary contract-input setting.

Design guidance was applied and adapted from Jakub Krehel's **Better Interface**, MIT, pinned commit `267330e1adfc66a718fb65fa6918c1f06d0a689e`. Documentation method adapted from Paul Bakaus's **Impeccable**, Apache-2.0, pinned commit `9d715cc4f5564a990ca8345abfdd5df6dc9b41c8`. Original notices/licenses are retained in `artifacts/licenses/interface-guidance.txt`. The worker's six-domain review, fixes and coverage limits are in `artifacts/validation.md`.
