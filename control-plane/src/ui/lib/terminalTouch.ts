// Adapted from old daemons-run (tag pre-pivot-2026-09-05) resources/js/components/TerminalSession.tsx
// (mouse encoding tracking, wheel reports, touch/pointer gestures) and
// resources/js/lib/terminalTouchScroll.ts. tmux owns the scrollback and has mouse mode on, so a
// vertical drag becomes mouse wheel reports; tmux decides per harness what a wheel does
// (agent/PROTOCOL.md "Terminals").
import type { Terminal } from '@xterm/xterm';
import { clampFontSize } from '@/lib/terminalFont';
import { KEY, applicationCursor } from '@/lib/terminalKeys';
import { classifyTouchEnd, linkAt, LONG_PRESS_MS, TAP_MAX_DISTANCE_PX, type Cell } from '@/lib/terminalLinks';

export type MouseEncoding = 'default' | 'sgr' | 'sgr-pixels';

const PAGE_UP = '\x1b[5~';
const PAGE_DOWN = '\x1b[6~';
/** tmux scrolls 5 lines per wheel report in copy mode; one report per 5 rows dragged follows the finger. */
const ROWS_PER_WHEEL_REPORT = 5;
const MAX_REPORTS_PER_MOVE = 4;

/** Tracks the mouse report encoding the application asked for (xterm does not expose it). */
export function trackMouseEncoding(term: Terminal): { encoding: () => MouseEncoding; dispose: () => void } {
  let encoding: MouseEncoding = 'default';
  const update = (params: (number | number[])[], on: boolean) => {
    for (const p of params) {
      if (p === 1006) encoding = on ? 'sgr' : 'default';
      else if (p === 1016) encoding = on ? 'sgr-pixels' : 'default';
    }
    return false;
  };
  const handlers = [
    term.parser.registerCsiHandler({ prefix: '?', final: 'h' }, (p) => update(p, true)),
    term.parser.registerCsiHandler({ prefix: '?', final: 'l' }, (p) => update(p, false)),
    term.parser.registerEscHandler({ final: 'c' }, () => {
      encoding = 'default';
      return false;
    }),
  ];
  return { encoding: () => encoding, dispose: () => handlers.forEach((h) => h.dispose()) };
}

/** A wheel report at a cell, in the encoding the application enabled. Up = older output. */
export function wheelReport(cell: { column: number; row: number; x: number; y: number }, up: boolean, encoding: MouseEncoding): string | Uint8Array | undefined {
  const button = up ? 64 : 65;
  if (encoding === 'sgr-pixels') return `\x1b[<${button};${cell.x};${cell.y}M`;
  if (encoding === 'sgr') return `\x1b[<${button};${cell.column};${cell.row}M`;
  if (cell.column > 223 || cell.row > 223) return undefined;
  return new Uint8Array([0x1b, 0x5b, 0x4d, button + 32, cell.column + 32, cell.row + 32]);
}

type Options = {
  /**
   * True for a full-screen TUI whose wheel tmux turns into page keys (OpenCode): one wheel report
   * per swipe, as the old project measured. Otherwise the wheel scrolls tmux history (copy mode)
   * and the drag sends one report per 5 rows, so the text follows the finger.
   */
  pagePerSwipe: () => boolean;
  encoding: () => MouseEncoding;
  /** Raw bytes to the PTY (no Ctrl latch, no cursor-mode rewrite). */
  send: (data: string | Uint8Array) => void;
  onLink: (url: string) => void;
  onFontSize: (size: number) => void;
};

/** Touch gestures on the terminal: drag to scroll, pinch to zoom, tap to focus, tap/long-press links. */
export function attachTouchGestures(term: Terminal, host: HTMLElement, o: Options): () => void {
  const screen = () => term.element?.querySelector('.xterm-screen');
  const screenRect = () => screen()?.getBoundingClientRect() ?? host.getBoundingClientRect();
  const rowHeight = () => Math.max(1, screenRect().height / term.rows);
  const cellAt = (e: PointerEvent) => {
    const r = screenRect();
    const x = Math.max(0, Math.min(r.width - 1, e.clientX - r.left));
    const y = Math.max(0, Math.min(r.height - 1, e.clientY - r.top));
    return { column: Math.floor((x / r.width) * term.cols) + 1, row: Math.floor((y / r.height) * term.rows) + 1, x: Math.round(x), y: Math.round(y) };
  };
  const bufferCell = (e: PointerEvent): Cell => {
    const c = cellAt(e);
    return { x: c.column, y: term.buffer.active.viewportY + c.row };
  };

  const pointers = new Map<number, { x: number; y: number }>();
  let pinch: { distance: number; fontSize: number } | null = null;
  let start: { id: number; x: number; y: number; at: number; link?: string } | undefined;
  let lastY = 0;
  let maxDistance = 0;
  let scrolling = false;
  let multiTouch = false;
  let longPressed = false;
  let longPressTimer: ReturnType<typeof setTimeout> | undefined;
  let remainderPx = 0;
  let reports = 0;
  const cancelLongPress = () => clearTimeout(longPressTimer);
  const distance = () => {
    const [a, b] = [...pointers.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  };

  // deltaY > 0: the finger moved up, show newer output.
  const scroll = (e: PointerEvent, deltaY: number) => {
    remainderPx += deltaY;
    if (term.modes.mouseTrackingMode !== 'none') {
      if (term.modes.mouseTrackingMode === 'x10') return;
      if (o.pagePerSwipe()) {
        if (reports === 0 && Math.abs(remainderPx) >= rowHeight()) {
          const report = wheelReport(cellAt(e), remainderPx < 0, o.encoding());
          if (report) o.send(report);
          reports = 1;
        }
        return;
      }
      const step = rowHeight() * ROWS_PER_WHEEL_REPORT;
      const n = Math.trunc(remainderPx / step);
      if (n === 0) return;
      remainderPx -= n * step;
      const report = wheelReport(cellAt(e), n < 0, o.encoding());
      for (let i = 0; report && i < Math.min(Math.abs(n), MAX_REPORTS_PER_MOVE); i++) o.send(report);
      return;
    }
    if (term.buffer.active.type === 'alternate') {
      // No mouse tracking on the alternate screen: page keys while dragging (terminalTouchScroll.ts).
      const page = Math.max(48, Math.min(120, screenRect().height * 0.25));
      const pages = Math.trunc(remainderPx / page);
      if (pages !== 0) {
        o.send((pages > 0 ? PAGE_DOWN : PAGE_UP).repeat(Math.min(2, Math.abs(pages))));
        remainderPx -= pages * page;
        reports += 1;
      }
      return;
    }
    const lines = Math.trunc(remainderPx / rowHeight());
    if (lines !== 0) {
      term.scrollLines(lines);
      remainderPx -= lines * rowHeight();
    }
  };
  const onDown = (e: PointerEvent) => {
    if (e.pointerType !== 'touch') return;
    // Suppress compatibility mouse events: a drag must never send a stray mouse press to the TUI.
    e.preventDefault();
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) {
      multiTouch = false;
      longPressed = false;
      scrolling = false;
      maxDistance = 0;
      remainderPx = 0;
      reports = 0;
      lastY = e.clientY;
      const link = linkAt(term, bufferCell(e))?.url;
      start = { id: e.pointerId, x: e.clientX, y: e.clientY, at: e.timeStamp, link };
      if (link) {
        longPressTimer = setTimeout(() => {
          if (start?.id !== e.pointerId || maxDistance > TAP_MAX_DISTANCE_PX || scrolling || multiTouch) return;
          longPressed = true;
          o.onLink(link);
        }, LONG_PRESS_MS);
      }
    } else if (pointers.size === 2) {
      cancelLongPress();
      multiTouch = true;
      start = undefined;
      pinch = { distance: distance(), fontSize: Number(term.options.fontSize) };
    }
  };

  const onMove = (e: PointerEvent) => {
    if (e.pointerType !== 'touch' || !pointers.has(e.pointerId)) return;
    e.preventDefault();
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && pointers.size >= 2 && pinch.distance > 0) {
      const size = clampFontSize((pinch.fontSize * distance()) / pinch.distance);
      if (size !== term.options.fontSize) term.options.fontSize = size;
      return;
    }
    if (!start || multiTouch) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    maxDistance = Math.max(maxDistance, Math.hypot(dx, dy));
    if (maxDistance > TAP_MAX_DISTANCE_PX) cancelLongPress();
    if (!scrolling && maxDistance > TAP_MAX_DISTANCE_PX && Math.abs(dy) >= Math.abs(dx)) scrolling = true;
    if (scrolling) scroll(e, lastY - e.clientY);
    lastY = e.clientY;
  };

  const onUp = (e: PointerEvent) => {
    if (e.pointerType !== 'touch') return;
    e.preventDefault();
    const cancelled = e.type === 'pointercancel';
    const ended = start?.id === e.pointerId ? start : undefined;
    cancelLongPress();
    if (ended) {
      maxDistance = Math.max(maxDistance, Math.hypot(e.clientX - ended.x, e.clientY - ended.y));
      if (scrolling && !cancelled) scroll(e, lastY - e.clientY);
      // A short swipe on an alternate screen without mouse tracking: a few arrow keys.
      if (scrolling && !cancelled && reports === 0 && term.modes.mouseTrackingMode === 'none' && term.buffer.active.type === 'alternate') {
        const d = ended.y - e.clientY;
        const key = applicationCursor(d > 0 ? KEY.down : KEY.up, term.modes.applicationCursorKeysMode);
        o.send(key.repeat(Math.min(4, Math.max(1, Math.round(Math.abs(d) / rowHeight())))));
      }
      const link = ended.link ?? linkAt(term, bufferCell(e))?.url;
      const action = classifyTouchEnd({
        cancelled,
        durationMs: e.timeStamp - ended.at,
        hasLink: link !== undefined,
        longPressed,
        maximumDistancePx: maxDistance,
        multiTouch,
        scrolling,
      });
      if (action === 'link' && link) o.onLink(link);
      else if (action === 'tap') {
        term.focus();
        // Normal screen only: a TUI on the alternate screen gets no surprise clicks (old behaviour).
        if (term.buffer.active.type === 'normal') {
          const init = { bubbles: true, cancelable: true, button: 0, buttons: 1, clientX: e.clientX, clientY: e.clientY, detail: 1 };
          screen()?.dispatchEvent(new MouseEvent('mousedown', init));
          document.dispatchEvent(new MouseEvent('mouseup', { ...init, buttons: 0 }));
        }
      }
    }
    pointers.delete(e.pointerId);
    if (pinch && pointers.size < 2) {
      pinch = null;
      o.onFontSize(Number(term.options.fontSize));
    }
    if (pointers.size === 0) {
      multiTouch = false;
      start = undefined;
      longPressed = false;
    }
  };

  // xterm's own touch handling would scroll or select underneath the gestures above.
  const stop = (e: TouchEvent) => e.stopPropagation();
  host.style.touchAction = 'none';
  host.addEventListener('pointerdown', onDown);
  host.addEventListener('pointermove', onMove, { passive: false });
  host.addEventListener('pointerup', onUp);
  host.addEventListener('pointercancel', onUp);
  for (const type of ['touchstart', 'touchmove', 'touchend'] as const) host.addEventListener(type, stop, { capture: true, passive: true });
  return () => {
    cancelLongPress();
    host.removeEventListener('pointerdown', onDown);
    host.removeEventListener('pointermove', onMove);
    host.removeEventListener('pointerup', onUp);
    host.removeEventListener('pointercancel', onUp);
    for (const type of ['touchstart', 'touchmove', 'touchend'] as const) host.removeEventListener(type, stop, { capture: true });
  };
}
