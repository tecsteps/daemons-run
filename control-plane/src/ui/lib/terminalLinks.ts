// Adapted from old daemons-run (tag pre-pivot-2026-09-05) resources/js/lib/terminalLinks.ts:
// http(s) links in the terminal, including URLs a TUI hard-wrapped onto several rows (Claude
// Code's login link), and the tap/long-press classification for touch.
import type { IDisposable, ILink, Terminal } from '@xterm/xterm';

const HTTP_URL = /https?:\/\/[^\s<>"']+/gi;
const URL_CHAR = /^[A-Za-z0-9\-._~:/?#[\]@!$&()*+,;=%]$/;
const URL_PREFIX = /^[A-Za-z0-9\-._~:/?#[\]@!$&()*+,;=%]+/;
const SENTENCE_PREFIX = /^[A-Za-z]+(?:\s+[A-Za-z]+)+/;
const PROSE_WORD = /^[A-Za-z]+[.!?]?$/;
const PROMPT_PREFIX = /^(?:\[[^\]]+\]\s*)?[\w.-]+@[\w.-]+(?::[^\s]*)?[#$%>]\s*/;
const STATUS_PATH = /^\/(?:[^/\s]+\/)*[^/\s]+\.[A-Za-z0-9]{1,8}(?:\s|$)/;
const MAX_CONTINUATION_ROWS = 32;

export const TAP_MAX_DISTANCE_PX = 12;
export const TAP_MAX_DURATION_MS = 400;
export const LONG_PRESS_MS = 500;

/** 1-based buffer cell (x = column, y = buffer line), as xterm's link API uses. */
export type Cell = { x: number; y: number };
export type TerminalLink = { url: string; range: { start: Cell; end: Cell } };
type Line = { y: number; text: string; xOffset?: number };

export function trimTrailingUrlPunctuation(url: string): string {
  let end = url.length;
  while (end > 0 && '),.;:!?'.includes(url[end - 1])) end -= 1;
  return url.slice(0, end);
}

export function isSafeHttpUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

export function findHttpUrls(text: string): { url: string; start: number; end: number }[] {
  const found: { url: string; start: number; end: number }[] = [];
  for (const match of text.matchAll(HTTP_URL)) {
    const url = trimTrailingUrlPunctuation(match[0]);
    if (match.index !== undefined && isSafeHttpUrl(url)) found.push({ url, start: match.index, end: match.index + url.length });
  }
  return found;
}

/** Links in a run of rows that belong together (a URL continued on the next rows). */
export function linksInLines(lines: Line[]): TerminalLink[] {
  if (lines.length === 0) return [];
  return findHttpUrls(lines.map((l) => l.text).join('')).map((m) => ({
    url: m.url,
    range: { start: positionAt(lines, m.start), end: positionAt(lines, Math.max(m.start, m.end - 1)) },
  }));
}

function positionAt(lines: Line[], index: number): Cell {
  let remaining = index;
  for (const line of lines) {
    if (remaining < line.text.length) return { x: remaining + 1 + (line.xOffset ?? 0), y: line.y };
    remaining -= line.text.length;
  }
  const last = lines.at(-1)!;
  return { x: Math.max(1, last.text.length + (last.xOffset ?? 0)), y: last.y };
}

export function linkContains(link: TerminalLink, p: Cell): boolean {
  const { start, end } = link.range;
  if (p.y < start.y || p.y > end.y) return false;
  if (start.y === end.y) return p.x >= start.x && p.x <= end.x;
  if (p.y === start.y) return p.x >= start.x;
  if (p.y === end.y) return p.x <= end.x;
  return true;
}

/** Rows after a URL that ends at the right edge and plausibly continue it. */
export function continuedUrlLines(rowText: (index: number) => { text: string; wrapped: boolean } | undefined, startIndex: number, startText: string, matchEnd: number): Line[] {
  const trimmed = startText.trimEnd();
  const lines: Line[] = [{ y: startIndex + 1, text: trimmed }];
  if (matchEnd !== trimmed.length || !URL_CHAR.test(trimmed.at(-1) ?? '')) return lines;
  for (let offset = 1; offset <= MAX_CONTINUATION_ROWS; offset++) {
    const row = rowText(startIndex + offset);
    if (!row) break;
    const text = row.text.trimEnd();
    const continuation = row.wrapped ? text : text.trimStart();
    const prefix = continuation.match(URL_PREFIX)?.[0] ?? '';
    if (
      prefix === '' ||
      /^https?:\/\//i.test(continuation) ||
      SENTENCE_PREFIX.test(continuation) ||
      PROMPT_PREFIX.test(continuation) ||
      STATUS_PATH.test(continuation) ||
      (text !== continuation && PROSE_WORD.test(continuation))
    ) {
      break;
    }
    lines.push({ y: startIndex + offset + 1, text: prefix, xOffset: text.length - continuation.length });
    if (prefix.length !== continuation.length || !URL_CHAR.test(prefix.at(-1) ?? '')) break;
  }
  return lines;
}

/** All links that cover buffer line `y` (1-based). */
export function linksAtRow(term: Terminal, y: number): TerminalLink[] {
  const buffer = term.buffer.active;
  const target = y - 1;
  if (target < 0 || !buffer.getLine(target)) return [];
  const rowText = (i: number) => {
    const line = buffer.getLine(i);
    return line ? { text: line.translateToString(true), wrapped: line.isWrapped } : undefined;
  };
  const links: TerminalLink[] = [];
  for (let index = Math.max(0, target - MAX_CONTINUATION_ROWS); index <= target; index++) {
    const text = buffer.getLine(index)?.translateToString(true);
    if (text === undefined) continue;
    for (const match of findHttpUrls(text)) {
      const link = linksInLines(continuedUrlLines(rowText, index, text, match.end)).find(
        (l) => l.range.start.y === index + 1 && l.range.start.x === match.start + 1,
      );
      if (link && link.range.start.y <= y && link.range.end.y >= y && !links.some((l) => l.url === link.url && l.range.start.y === link.range.start.y)) {
        links.push(link);
      }
    }
  }
  return links;
}

export function linkAt(term: Terminal, cell: Cell): TerminalLink | undefined {
  return linksAtRow(term, cell.y).find((l) => linkContains(l, cell));
}

export function openHttpUrl(url: string) {
  if (isSafeHttpUrl(url)) window.open(url, '_blank', 'noopener,noreferrer');
}

/** Desktop: click a link (also a hard-wrapped one) to open it. */
export function registerLinks(term: Terminal): IDisposable {
  return term.registerLinkProvider({
    provideLinks(y, callback) {
      const links: ILink[] = linksAtRow(term, y).map((l) => ({
        text: l.url,
        range: l.range,
        decorations: { pointerCursor: true, underline: true },
        activate: () => openHttpUrl(l.url),
      }));
      callback(links.length ? links : undefined);
    },
  });
}

export type TouchEnd = {
  cancelled: boolean;
  durationMs: number;
  hasLink: boolean;
  longPressed: boolean;
  maximumDistancePx: number;
  multiTouch: boolean;
  scrolling: boolean;
};

/** What a finished one-finger touch means: link actions, a tap, or nothing. */
export function classifyTouchEnd(t: TouchEnd): 'link' | 'tap' | 'none' {
  if (t.cancelled || t.durationMs < 0 || t.longPressed || t.maximumDistancePx > TAP_MAX_DISTANCE_PX || t.multiTouch || t.scrolling) return 'none';
  if (t.durationMs > TAP_MAX_DURATION_MS) return 'none';
  if (t.hasLink) return 'link';
  return 'tap';
}
