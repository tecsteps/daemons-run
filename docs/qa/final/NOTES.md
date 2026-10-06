# Final run: the product flow end to end

2026-10-06 ~22:15, control plane daemons-dev on agent release **v0.1.0**, suite `e2e/final-flow.spec.ts` (FINAL_FLOW=1).

1. Homepage (preview) → Install → the install page with the Deploy button and the coding-agent prompt; `/install.md` served as text/markdown. (`01`, `02`)
2. Sign in with the passkey.
3. Hetzner connected (Settings).
4. Create server through the form: **CX23**, nbg1, Claude Code + OpenCode; confirm dialog (< €6/month). (`03`, `04`)
5. Online **146 s after ordering** (final-cx23-b; final-cx23 took 110 s). (`05`)
6. On a phone (390×844, touch): open the terminal, start Claude Code: welcome screen renders. (`06`)
7. New shell tab: an app on localhost:3000, `daemons expose 3000 --name shop2` prints the app URL. (`07`)
8. The phone opens `https://daemons-apps-dev.fabian-wesner.workers.dev/shop2/`: the app (private, owner session via ticket). A signed-out browser is sent to sign-in. (`08`)

Runs: `final-cx23` (fresh, failed at a test regex after step 6, resumed and passed); `final-cx23-b` (fresh, failed on a test path bug after step 7, resumed on the same server and passed). Both failures were in the test script, not the product.
Real phone browser on the same fresh CX23: `node e2e/mobile/android.mjs final-cx23-b` passed (keyboard, Ctrl/history, scrollback, Select, landscape, background and return, OpenCode transcript scroll, Claude Code).

Path B install on a fresh Cloudflare account state: see `docs/qa/03-installation/NOTES.md` (66 s from the one-line prompt).
