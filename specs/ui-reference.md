# UI reference: the old daemons-run project

The old project (Laravel + Inertia + React, a different architecture) already solved much of the UI. Take its **look, assets and small proven components**. Never take its architecture.

- Location: `/Users/wesner/Herd/daemons-run` (state as of commit `536818912`, 2026-10-06). Paths below are relative to it.
- Its stack matches ours on the UI side: React 19, Tailwind v4, Radix (shadcn `components/ui`), lucide-react, `@xterm/xterm` 6 with fit and webgl addons, CodeMirror 6.
- Its local app does not run (every page returns 500). For visuals, use the screenshots listed below and the production homepage at https://daemons.run.

## How to take something over

1. **Copy, then cut down.** Copy the file, remove Inertia (`@inertiajs/*`), Wayfinder routes (`@/actions/*`, `@/routes/*`), Laravel-specific fetch helpers (`xsrf.ts`, `http.ts`), telemetry and anything listed under "Do not take". Replace them with plain `fetch` to our `/api/*` and our own router.
2. **Keep it small.** If a copied file stays over ~300 lines after cutting, take only the parts you need. No file over 1,000 lines.
3. **Copy the styling, not the abstractions.** Class names, tokens, spacing and states are the valuable part.
4. Mark each copied file with a one-line header comment: `// Adapted from old daemons-run <path>`.

## Design system (epic 01, 10)

| What | Where | Notes |
|---|---|---|
| Style guide "Terminal Lime" | `specs/01-ui/styleguide.md` | The binding visual rules. Ignore its product copy (pricing, Apache-2.0, OAuth, Incus sections). |
| Tokens, fonts, dark mode | `resources/css/app.css` (lines 1–420) | `@theme` tokens, light/dark overrides, the `phone` custom variant, the "Geist Mono Terminal" font faces. |
| Theme bootstrap | `public/theme-init.js`, `resources/js/lib/theme.ts`, `components/ThemeToggle.tsx` | No-flash theme init; system / light / dark. |
| Favicons and PWA icons | `public/favicon*`, `public/apple-touch-icon.png`, `public/icon-*-maskable.png`, `public/manifest.webmanifest` | Copy as is. |

## Mascot and illustrations (epic 01, 10)

| What | Where | Use |
|---|---|---|
| Marketing art (3D mascot, server cabinet, steps) | `public/images/art-*@2x.webp` (46 files) | Homepage only. On dark sections use `mix-blend-lighten`, on light `mix-blend-multiply` (see `resources/views/components/public/art.blade.php`). Skip `art-ctos-*` and `art-fabian-wesner` (old product). |
| App illustrations (flat line art, light and dark) | `public/images/app/app-*-{light,dark}@2x.webp` | Empty states, sign-in, not found, creating. Component: `components/AppIllustration.tsx`. |
| Brand mark `> <` | `components/BrandMark.tsx`, `resources/views/components/public/brand-mark.blade.php`, `public/favicon.svg` | Header and rail. |

## App shell and building blocks (epic 01)

| What | Where |
|---|---|
| Shell: black rail, white canvas, phone top bar and bottom nav | `components/AppShell.tsx` (829 lines: take the layout and classes, drop daemon lists, notifications, org menu), `components/MobileRecentsBar.tsx` (bottom bar styling only) |
| Page layout system | `components/layout/` (`Page`, `PageHeader`, `PageTabs`, `SectionCard`, `SectionNav`, `scrollRegion.ts`), page registry idea from `lib/pages.ts` |
| shadcn primitives | `components/ui/*` (button, dialog, alert-dialog, dropdown-menu, input, select, switch, tabs, tooltip, sheet, table, skeleton, spinner) |
| Small components | `StatusPill.tsx`, `EmptyState.tsx`, `FormField.tsx`, `ConfirmDestructive.tsx` (typed-name confirm), `SecretField.tsx`, `CopyControl.tsx`, `InstrumentSurface.tsx`, `lib/clipboard.ts`, `lib/relativeTime.ts` |

## Server provisioning (epic 04)

### Best source: the pre-pivot server purchase (tag `pre-pivot-2026-09-05`)

Before the pivot, the old product was "bring your own Hetzner", and buying a server was fully built and polished. Provisioning worked differently (Incus), but the purchase UI is close to what epic 04 needs. Read files from the tag without checking it out:

```
git -C /Users/wesner/Herd/daemons-run show "pre-pivot-2026-09-05:<path>"
```

(also on GitHub: `tecsteps/daemons-run-old`, a private repo, tag `pre-pivot-2026-09-05`). In zsh, quote the argument: `$T:r…` is a zsh modifier.

| What | Path at the tag | Take |
|---|---|---|
| Purchase form | `resources/js/components/ServerPurchaseForm.tsx` (404 lines) | Layout and flow: billing note ("Hetzner bills your payment method directly. daemons.run does not add any markup."), name with a 32-character limit, region select, type cards, agent picker, summary box, **confirmation dialog** (type, region, monthly price, "billed to your Hetzner account starting now", focus on Cancel), "What happens next" list. Drop the cloud-account select (one token), `BrowserRuntimeToggle`, and the TLS step. |
| Grouped type picker | `resources/js/components/ServerLaneCards.tsx` (486 lines) | The three groups **Cost-Optimized / Regular Performance / General Purpose** as cards, each with a type dropdown sorted by price, CPU vendor, traffic, hourly and monthly price, "show unavailable" switch, phone layout. Exactly the owner's requested picker; drop the recommendation and "fits ~N environments". |
| Catalog helpers | `resources/js/lib/cloudCatalog.ts` (154 lines), `resources/js/lib/money.ts` (50 lines) | `serverTypeGroups`, `typeGroup`, `cpuVendor`, `priceFor`, `disabledReason`, `trafficInTb`, region labels, EUR formatting. Port almost as is. |
| Agent picker | `resources/js/components/AgentPicker.tsx` (126 lines) | Coding-agent selection; adapt to checkboxes for Claude Code, Codex, OpenCode. |
| Provider connect | `resources/js/pages/onboarding/cloud.tsx`, `resources/js/components/CloudProviders.tsx` | Token entry and validation states. |
| Pages | `resources/js/pages/servers/{create,index,show}.tsx`, `resources/js/pages/onboarding/{server,provision}.tsx`, `resources/js/components/OnboardingShell.tsx` | Server list, detail and the provisioning progress page. |
| Hetzner API usage | `app/Services/HetznerCloudProvider.php` (PHP, read for API details only) | Server types with prices per location and **availability per location from `server_types[].locations[].available`** (the `/datacenters` endpoint no longer works for this), `/locations` for regions, token check with `GET /locations?per_page=1`, `user_data`, labels on everything, SSH key upload and cleanup. |
| Early design mockups | `specs/01-ui/page-03-onboarding-cloud.png`, `page-04-onboarding-server.png`, `page-05-onboarding-provisioning.png`, `page-16/17/18-server*.png` | Look of the onboarding steps (2026-08-17 concept art; the built UI above is newer). |

### Later versions (current checkout)

| What | Where | Notes |
|---|---|---|
| Provider credential forms | `components/CloudCredentialForms.tsx`, `components/CloudProviders.tsx` | Hetzner field set and validation states. Drop Contabo and OVHcloud for now. |
| Create server forms | `components/ServerPurchaseForm.tsx` (Hetzner) | Location and size pickers, price display. (`ServerContaboOrderForm.tsx` is for when Contabo returns.) |
| Add existing server | `components/ServerAdoptForm.tsx` | Copyable one-line command pattern. |
| Progress view | `components/daemon/ProvisioningView.tsx`, `components/ProvisioningChecklist.tsx` | Step list with the "creating" illustration. |
| Pages | `pages/servers/{index,create,show}.tsx`, `pages/onboarding/server.tsx` | Layout reference. |

## Browser terminal (epic 06)

The old terminal stack is about 27,000 lines, mostly recovery, ticket and lock machinery we do not need. **Do not port the stack.** Build a small terminal on xterm.js and read these files for the hard-won details:

| What | Where | Why it matters |
|---|---|---|
| Terminal font | `resources/css/app.css` "Geist Mono Terminal" `@font-face` blocks, `lib/xtermShadeGlyphs.ts` | Box drawing and block glyphs render gap-free (Claude Code and OpenCode TUIs). |
| Mobile key row | `components/TerminalKeyRow.tsx`, `lib/terminalKeys.ts` (escape sequences), `lib/terminalKeyboard.ts` (`useVisualViewportHeight`) | Key row above the on-screen keyboard and resizing with `visualViewport`. |
| Touch | `lib/terminalTouchScroll.ts`, the touch parts of `lib/terminalTouchInput.ts` (915 lines: read, then take only scrolling, tap and long-press) | Scrollback and selection on phones. |
| Fit and font size | `lib/terminalFit.ts`, `lib/terminalFontSize.ts`, `components/TerminalZoomControls.tsx` | Correct cols and rows on resize and rotation; A-/A/A+. |
| Copy and paste | `lib/terminalCopy.ts`, `lib/terminalPaste.ts` | Bracketed paste, Cmd+C behaviour. |
| Links | `lib/terminalLinks.ts` (take the URL detection, drop preview delegation) | Tap or click links in output. |
| Terminal chrome | `components/TerminalSession.tsx`, `components/daemon/WarmTerminalLayout.tsx` | Tab strip, status line ("Connected · 40ms"), toolbar look. |
| Screenshots | `specs/2026-09-16-pragmatic-tests/runs/2026-09-29T18-27-30-374Z/shots/` (`agent-terminal.png`, `terminal-chars-glyphs.png`, `first-terminal.png`) | Target look. |

## Files (epic 09)

| What | Where | Notes |
|---|---|---|
| Tree, editor, dialogs | `components/daemon/files/` (`FilesTreePanel`, `FilesEditorPanel`, `FilesCodeEditor`, `FilesDialogs`, `FilesTreeItemMenu`, `useFilesDrag`) | Take UI and CodeMirror setup; replace the data hooks with our `file.*` API. |
| Soft wrap, upload, download | `lib/editorSoftWrap.ts`, `lib/workspaceFilesUpload.ts`, `lib/workspaceFilesDownload.ts` | Chunked upload and download patterns. |

## Apps / previews (epic 08)

| What | Where |
|---|---|
| Preview list and offers ("Port 5173 detected, expose?") | `components/PreviewLinks.tsx`, `components/daemon/PreviewOffers.tsx`, `lib/previewOffers.ts` |
| Empty state art | `public/images/app/app-empty-previews-*` |

## Homepage (epic 10)

| What | Where |
|---|---|
| Page structure and sections | `resources/views/public/home.blade.php` |
| Header, footer, stripes, hero, CTA pair, cards, chips, icons | `resources/views/components/public/*.blade.php` (`header`, `footer`, `stripe`, `stripe-heading`, `hero-machine`, `cta-pair`, `feature`, `chip`, `icon`, `brand-icon`) |
| Live reference | https://daemons.run (desktop and mobile) |

Rewrite every piece of copy for the new product (see epic 10).

## Visual references (screenshots)

- Dashboard: `specs/2026-09-20-drop-teams/s3-screens/dashboard-{desktop,pixel7}-{light,dark}.png`, `specs/2026-09-18-qa/screenshots/dashboard-{1440,400}-{light,dark}.png`
- Terminal: see the terminal table above.

## Do not take

Chat UI (`components/daemon/Agent*`, `lib/chat*`), workspace lock and PIN (`WorkspaceLock*`, `lib/workspaceLock*`), egress and policies, SSH tab, domains tab, agent API tab, command palette, notifications, usage charts, release/TUF sections, Laravel/Livewire views, Pest tests, and every orchestration document (`CLAUDE.md`, `AGENTS.md`, `specs/2026-*`).
