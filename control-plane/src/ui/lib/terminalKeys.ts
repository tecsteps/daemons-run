// Adapted from old daemons-run resources/js/lib/terminalKeys.ts: the bytes a hardware keyboard sends.
export const KEY = {
  esc: '\x1b',
  tab: '\t',
  up: '\x1b[A',
  down: '\x1b[B',
  right: '\x1b[C',
  left: '\x1b[D',
} as const;

/** Full-screen TUIs switch the cursor keys to application mode (DECCKM): SS3 instead of CSI. */
export function applicationCursor(data: string, applicationMode: boolean): string {
  if (!applicationMode) return data;
  return data.replace(/^\x1b\[([ABCD])$/, '\x1bO$1');
}

/** Ctrl+A = 0x01 … Ctrl+_ = 0x1f; letters are case-insensitive. */
export function controlChord(key: string): string | null {
  if (key.length !== 1) return null;
  const code = key.toUpperCase().charCodeAt(0);
  if (code === 32) return '\x00';
  if (code < 64 || code > 95) return null;
  return String.fromCharCode(code - 64);
}

/** Splits UTF-8 input into frames without cutting a code point. */
export function chunkInput(text: string, maxBytes = 32_000): Uint8Array[] {
  const encoder = new TextEncoder();
  const out: Uint8Array[] = [];
  let chunk = '';
  let size = 0;
  for (const ch of text) {
    const n = encoder.encode(ch).byteLength;
    if (chunk && size + n > maxBytes) {
      out.push(encoder.encode(chunk));
      chunk = '';
      size = 0;
    }
    chunk += ch;
    size += n;
  }
  if (chunk) out.push(encoder.encode(chunk));
  return out;
}
