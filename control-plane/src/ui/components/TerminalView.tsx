// A small terminal on xterm.js. Look and hard-won details (font, theme, glyphs, key row,
// visualViewport) adapted from old daemons-run resources/js/lib/terminal*.ts and TerminalSession.tsx.
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { WebglAddon } from '@xterm/addon-webgl';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { applicationCursor, chunkInput, controlChord } from '@/lib/terminalKeys';

export const TERMINAL_FONT_FAMILY = '"Geist Mono Terminal", "Geist Mono", Menlo, Consolas, ui-monospace, monospace';
const THEME = { background: '#050708', foreground: '#F5F1E8', cursor: '#C4FF18', selectionBackground: '#6E38D5' };
const FONT_KEY = 'daemons:terminal-font-size';
export const FONT_SIZES = { min: 10, max: 22 };

export function defaultFontSize() {
  try {
    const stored = Number(localStorage.getItem(FONT_KEY));
    if (stored >= FONT_SIZES.min && stored <= FONT_SIZES.max) return stored;
  } catch {}
  return window.matchMedia('(max-width: 47.999rem)').matches ? 12 : 14;
}

export type ConnectionState =
  | { kind: 'connecting' }
  | { kind: 'connected'; latency: number | null }
  | { kind: 'reconnecting'; reason: string }
  | { kind: 'ended'; reason: string }
  | { kind: 'offline'; reason: string };

export type TerminalHandle = {
  send: (data: string) => void;
  paste: (text: string) => void;
  focus: () => void;
  blur: () => void;
  setFontSize: (size: number) => void;
  selectionText: () => string;
  fit: () => void;
};

type Props = {
  serverId: string;
  session: string;
  cwd?: string;
  command?: string;
  ctrl: boolean;
  onCtrlUsed: () => void;
  onState: (state: ConnectionState) => void;
  fontSize: number;
};

/** One terminal attached to one tmux session; reattaches by itself after a disconnect. */
export const TerminalView = forwardRef<TerminalHandle, Props>(function TerminalView(
  { serverId, session, cwd, command, ctrl, onCtrlUsed, onState, fontSize },
  ref,
) {
  const host = useRef<HTMLDivElement>(null);
  const term = useRef<Terminal | null>(null);
  const fit = useRef<FitAddon | null>(null);
  const socket = useRef<WebSocket | null>(null);
  const pending = useRef<Uint8Array[]>([]);
  const ctrlRef = useRef(ctrl);
  const stateRef = useRef(onState);
  const [, force] = useState(0);
  ctrlRef.current = ctrl;
  stateRef.current = onState;

  const sendBytes = (data: string) => {
    for (const chunk of chunkInput(data)) {
      const ws = socket.current;
      if (ws?.readyState === WebSocket.OPEN) ws.send(chunk);
      else if (pending.current.reduce((n, c) => n + c.byteLength, 0) < 4096) pending.current.push(chunk);
    }
  };

  const sendInput = (data: string) => {
    const t = term.current;
    if (ctrlRef.current && data.length === 1) {
      const chord = controlChord(data);
      onCtrlUsed();
      if (chord) return sendBytes(chord);
    }
    sendBytes(t ? applicationCursor(data, t.modes.applicationCursorKeysMode) : data);
  };
  const sendInputRef = useRef(sendInput);
  sendInputRef.current = sendInput;

  useImperativeHandle(ref, () => ({
    send: (data) => sendInputRef.current(data),
    paste: (text) => term.current?.paste(text),
    focus: () => term.current?.focus(),
    blur: () => term.current?.blur(),
    setFontSize: (size) => {
      if (!term.current) return;
      term.current.options.fontSize = size;
      try {
        localStorage.setItem(FONT_KEY, String(size));
      } catch {}
      fit.current?.fit();
    },
    selectionText: () => {
      const t = term.current;
      if (!t) return '';
      if (t.hasSelection()) return t.getSelection();
      const buffer = t.buffer.active;
      const lines: string[] = [];
      for (let i = 0; i < buffer.length; i++) lines.push(buffer.getLine(i)?.translateToString(true) ?? '');
      return lines.join('\n').replace(/\n+$/, '');
    },
    fit: () => fit.current?.fit(),
  }));

  // The terminal itself: created once per session.
  useEffect(() => {
    const t = new Terminal({
      fontFamily: TERMINAL_FONT_FAMILY,
      fontSize,
      customGlyphs: true,
      scrollback: 5000,
      cursorBlink: !window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      macOptionClickForcesSelection: true,
      allowProposedApi: true,
      theme: THEME,
    });
    const f = new FitAddon();
    t.loadAddon(f);
    t.loadAddon(new WebLinksAddon((_e, uri) => window.open(uri, '_blank', 'noopener,noreferrer')));
    t.open(host.current!);
    try {
      const webgl = new WebglAddon();
      webgl.onContextLoss(() => webgl.dispose());
      t.loadAddon(webgl);
    } catch {
      // DOM renderer fallback.
    }
    // Mobile: input must reach the PTY unchanged.
    const textarea = t.textarea;
    if (textarea) {
      for (const [k, v] of Object.entries({ autocorrect: 'off', autocapitalize: 'off', autocomplete: 'off', spellcheck: 'false' })) textarea.setAttribute(k, v);
    }
    t.attachCustomKeyEventHandler((e) => {
      // Cmd/Ctrl+C with a selection copies instead of sending ^C.
      if (e.type === 'keydown' && (e.metaKey || (e.ctrlKey && e.shiftKey)) && e.key.toLowerCase() === 'c' && t.hasSelection()) {
        void navigator.clipboard?.writeText(t.getSelection());
        return false;
      }
      return true;
    });
    t.onData((data) => sendInputRef.current(data));
    t.onBinary((data) => sendBytes(data));
    term.current = t;
    fit.current = f;
    // Read access for tests and debugging: the WebGL renderer leaves no text in the DOM.
    (window as unknown as { __daemonsTerminal?: () => string }).__daemonsTerminal = () => {
      const buffer = t.buffer.active;
      const lines: string[] = [];
      for (let i = 0; i < buffer.length; i++) lines.push(buffer.getLine(i)?.translateToString(true) ?? '');
      return lines.join('\n');
    };
    document.fonts?.load(`400 ${fontSize}px "Geist Mono Terminal"`).then(() => f.fit()).catch(() => undefined);
    f.fit();
    force((n) => n + 1);
    return () => {
      t.dispose();
      term.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverId, session]);

  // The connection: reconnects with backoff until the session ends or the page closes.
  useEffect(() => {
    const t = term.current;
    if (!t) return;
    let closed = false;
    let attempt = 0;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let pingTimer: ReturnType<typeof setInterval> | undefined;
    let resizeObserver: ResizeObserver | undefined;

    const connect = () => {
      stateRef.current(attempt === 0 ? { kind: 'connecting' } : { kind: 'reconnecting', reason: 'Reconnecting…' });
      fit.current?.fit();
      const url = new URL(`/api/servers/${serverId}/terminals/${encodeURIComponent(session)}/ws`, window.location.href);
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      url.searchParams.set('cols', String(t.cols));
      url.searchParams.set('rows', String(t.rows));
      if (cwd) url.searchParams.set('cwd', cwd);
      if (command) url.searchParams.set('command', command);
      const ws = new WebSocket(url);
      ws.binaryType = 'arraybuffer';
      socket.current = ws;
      let opened = false;
      ws.onmessage = (event) => {
        if (typeof event.data === 'string') {
          const msg = JSON.parse(event.data) as { type: string; t?: number };
          if (msg.type === 'opened') {
            opened = true;
            attempt = 0;
            stateRef.current({ kind: 'connected', latency: null });
            // Desktop: type right away. Phones: no keyboard until the user taps the terminal.
            if (!window.matchMedia('(pointer: coarse)').matches) t.focus();
            for (const chunk of pending.current.splice(0)) ws.send(chunk);
            ws.send(JSON.stringify({ type: 'ping', t: performance.now() }));
          } else if (msg.type === 'pong' && msg.t !== undefined) {
            stateRef.current({ kind: 'connected', latency: Math.round(performance.now() - msg.t) });
          }
          return;
        }
        t.write(new Uint8Array(event.data as ArrayBuffer));
      };
      ws.onopen = () => {
        // The agent replays the scrollback of an existing session; start from a clean screen.
        t.reset();
      };
      ws.onclose = (event) => {
        if (closed || socket.current !== ws) return;
        socket.current = null;
        if (event.code === 4002) {
          stateRef.current({ kind: 'ended', reason: 'This session ended.' });
          return;
        }
        if (event.code === 4401) {
          stateRef.current({ kind: 'ended', reason: 'You were signed out.' });
          return;
        }
        if (event.code === 4004) {
          stateRef.current({ kind: 'ended', reason: event.reason || 'The terminal could not be opened.' });
          return;
        }
        attempt += 1;
        const delay = Math.min(10_000, 500 * 2 ** Math.min(attempt, 5));
        stateRef.current(
          opened || event.code === 4001
            ? { kind: 'reconnecting', reason: event.reason || 'Connection lost. Reconnecting…' }
            : { kind: 'offline', reason: event.reason || 'The server is not reachable right now.' },
        );
        retryTimer = setTimeout(connect, delay);
      };
    };

    const sendSize = () => {
      fit.current?.fit();
      const ws = socket.current;
      if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'resize', cols: t.cols, rows: t.rows }));
    };
    let resizeFrame = 0;
    resizeObserver = new ResizeObserver(() => {
      cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(sendSize);
    });
    resizeObserver.observe(host.current!);
    t.onResize(() => {
      const ws = socket.current;
      if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'resize', cols: t.cols, rows: t.rows }));
    });
    pingTimer = setInterval(() => {
      const ws = socket.current;
      if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping', t: performance.now() }));
    }, 15_000);
    // Coming back from the background: reconnect at once instead of waiting for the backoff.
    const onVisible = () => {
      if (document.visibilityState === 'visible' && !socket.current && !closed) {
        clearTimeout(retryTimer);
        connect();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    connect();
    return () => {
      closed = true;
      clearTimeout(retryTimer);
      clearInterval(pingTimer);
      resizeObserver?.disconnect();
      document.removeEventListener('visibilitychange', onVisible);
      socket.current?.close(1000);
      socket.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverId, session, term.current]);

  return <div ref={host} data-testid="terminal" data-terminal-focus className="h-full min-h-0 w-full min-w-0 overflow-hidden" />;
});
