// A small terminal on xterm.js. Look and hard-won details (font, theme, glyphs, key row,
// visualViewport, gestures, links) adapted from old daemons-run (tag pre-pivot-2026-09-05)
// resources/js/lib/terminal*.ts and resources/js/components/TerminalSession.tsx.
// tmux on the server owns the scrollback (agent/PROTOCOL.md "Terminals"): this view shows tmux's
// screen, and scrolling sends mouse wheel reports that tmux turns into copy mode or page keys.
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { saveFontSize, TERMINAL_FONT_FAMILY } from '@/lib/terminalFont';
import { applicationCursor, chunkInput, controlChord } from '@/lib/terminalKeys';
import { registerLinks } from '@/lib/terminalLinks';
import { attachTouchGestures, trackMouseEncoding } from '@/lib/terminalTouch';

const THEME = { background: '#050708', foreground: '#F5F1E8', cursor: '#C4FF18', selectionBackground: '#6E38D5' };

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
  /** The session's recent history as plain text (from tmux; the screen if the server cannot). */
  selectionText: () => Promise<string>;
  fit: () => void;
};

export type Harness = 'claude' | 'codex' | 'opencode' | 'shell';

type Props = {
  serverId: string;
  session: string;
  cwd?: string;
  command?: string;
  ctrl: boolean;
  onCtrlUsed: () => void;
  onState: (state: ConnectionState) => void;
  fontSize: number;
  /** A link was tapped or long-pressed on a touch screen. */
  onLink: (url: string) => void;
  /** Pinch zoom changed the font size. */
  onFontSize: (size: number) => void;
};

/** One terminal attached to one tmux session; reattaches by itself after a disconnect. */
export const TerminalView = forwardRef<TerminalHandle, Props>(function TerminalView(
  { serverId, session, cwd, command, ctrl, onCtrlUsed, onState, fontSize, onLink, onFontSize },
  ref,
) {
  const host = useRef<HTMLDivElement>(null);
  const term = useRef<Terminal | null>(null);
  const fit = useRef<FitAddon | null>(null);
  const socket = useRef<WebSocket | null>(null);
  const pending = useRef<Uint8Array[]>([]);
  const ctrlRef = useRef(ctrl);
  const stateRef = useRef(onState);
  const callbacks = useRef({ onLink, onFontSize });
  const harness = useRef<{ harness: Harness; scroll: string }>({ harness: 'shell', scroll: 'page-keys' });
  const captures = useRef<((text: string) => void)[]>([]);
  const [, force] = useState(0);
  ctrlRef.current = ctrl;
  stateRef.current = onState;
  callbacks.current = { onLink, onFontSize };

  const sendRaw = (chunk: Uint8Array) => {
    const ws = socket.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(chunk);
    else if (pending.current.reduce((n, c) => n + c.byteLength, 0) < 4096) pending.current.push(chunk);
  };
  const sendBytes = (data: string) => {
    for (const chunk of chunkInput(data)) sendRaw(chunk);
  };

  /** What xterm itself holds: the visible screen (tmux has the history). */
  const localText = () => {
    const t = term.current;
    if (!t) return '';
    const buffer = t.buffer.active;
    const lines: string[] = [];
    for (let i = 0; i < buffer.length; i++) lines.push((buffer.getLine(i)?.translateToString(true) ?? '').trimEnd());
    return lines.join('\n').replace(/\n+$/, '');
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
      saveFontSize(size);
      fit.current?.fit();
    },
    selectionText: () =>
      new Promise<string>((resolve) => {
        const ws = socket.current;
        if (ws?.readyState !== WebSocket.OPEN) return resolve(localText());
        const done = (text: string) => {
          clearTimeout(timer);
          captures.current = captures.current.filter((c) => c !== done);
          resolve(text || localText());
        };
        const timer = setTimeout(() => done(''), 8000);
        captures.current.push(done);
        ws.send(JSON.stringify({ type: 'capture', lines: 2000 }));
      }),
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
    t.open(host.current!);
    const links = registerLinks(t);
    const mouse = trackMouseEncoding(t);
    // WebGL only at an integer device pixel ratio and outside WebDriver: at fractional ratios
    // (Pixel 8: 2.625) it rendered nothing or blurry glyphs (old daemons-run terminalRenderer.ts).
    const dpr = window.devicePixelRatio;
    if (!navigator.webdriver && Math.abs(dpr - Math.round(dpr)) < 0.01) {
      try {
        const webgl = new WebglAddon();
        webgl.onContextLoss(() => webgl.dispose());
        t.loadAddon(webgl);
      } catch {
        // DOM renderer fallback.
      }
    }
    host.current!.dataset.renderer = t.element?.querySelector('canvas') ? 'webgl' : 'dom';
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
    // Legacy mouse reports: one char per byte, not UTF-8.
    t.onBinary((data) => sendRaw(Uint8Array.from(data, (c) => c.charCodeAt(0) & 0xff)));
    term.current = t;
    fit.current = f;
    const el = host.current!;
    const detachTouch = attachTouchGestures(t, el, {
      pagePerSwipe: () => harness.current.harness === 'opencode',
      encoding: mouse.encoding,
      send: (data) => (typeof data === 'string' ? sendBytes(data) : sendRaw(data)),
      onLink: (url) => callbacks.current.onLink(url),
      onFontSize: (size) => {
        saveFontSize(size);
        f.fit();
        callbacks.current.onFontSize(size);
      },
    });

    // Read access for tests and debugging: the WebGL renderer leaves no text in the DOM.
    (window as unknown as { __daemonsTerminal?: () => string }).__daemonsTerminal = () => {
      const buffer = t.buffer.active;
      const lines: string[] = [];
      for (let i = 0; i < buffer.length; i++) lines.push((buffer.getLine(i)?.translateToString(true) ?? '').trimEnd());
      return lines.join('\n');
    };
    (window as unknown as { __daemonsTerminalState?: () => object }).__daemonsTerminalState = () => ({
      viewportY: t.buffer.active.viewportY,
      baseY: t.buffer.active.baseY,
      cols: t.cols,
      rows: t.rows,
      buffer: t.buffer.active.type,
      mouseTracking: t.modes.mouseTrackingMode,
      mouseEncoding: mouse.encoding(),
      fontSize: t.options.fontSize,
      ...harness.current,
    });
    document.fonts?.load(`400 ${fontSize}px "Geist Mono Terminal"`).then(() => f.fit()).catch(() => undefined);
    f.fit();
    force((n) => n + 1);
    return () => {
      detachTouch();
      links.dispose();
      mouse.dispose();
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
          const msg = JSON.parse(event.data) as { type: string; t?: number; harness?: Harness; scroll?: string; text?: string };
          if (msg.type === 'capture') {
            captures.current[0]?.(msg.text ?? '');
          } else if (msg.type === 'opened') {
            opened = true;
            harness.current = { harness: msg.harness ?? 'shell', scroll: msg.scroll ?? 'page-keys' };
            if (host.current) host.current.dataset.harness = harness.current.harness;
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
        // tmux redraws its screen on attach; start from a clean one.
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
