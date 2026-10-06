export const GITHUB = 'https://github.com/tecsteps/daemons-run';
export const DOCS = 'https://github.com/tecsteps/daemons-run#readme';
export const DEPLOY_URL = 'https://deploy.workers.cloudflare.com/?url=https://github.com/tecsteps/daemons-run/tree/main/control-plane';
export const AGENT_PROMPT = 'Install daemons.run into my Cloudflare account: follow https://daemons.run/install.md';

// Button styles from old daemons-run resources/views/components/public/cta-pair.blade.php
const ring = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lime';
export const limeCta = `group inline-flex h-12 min-h-12 items-center justify-center gap-2 whitespace-nowrap rounded-[6px] border-2 border-ink-900 bg-lime px-6 text-body font-semibold text-ink-900 shadow-[0_3px_0_0_#11120F] hover:bg-lime/90 ${ring}`;
export const outlineCta = `inline-flex h-12 min-h-12 items-center justify-center gap-2 whitespace-nowrap rounded-[6px] border-2 border-bone/50 px-6 text-body font-semibold text-bone hover:border-bone ${ring}`;
export const outlineCtaLight = `inline-flex h-12 min-h-12 items-center justify-center gap-2 whitespace-nowrap rounded-[6px] border-2 border-ink-900/40 px-6 text-body font-semibold text-ink-900 hover:border-ink-900 ${ring}`;
