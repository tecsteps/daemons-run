// Terminal chrome (tab strip, status line, zoom controls) adapted from old daemons-run
// resources/js/components/TerminalSession.tsx and TerminalZoomControls.tsx.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, ChevronDown, Maximize2, Minimize2, Plus, SquareTerminal } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { ConfirmDestructive } from '@/components/ConfirmDestructive';
import { TerminalKeyRow } from '@/components/TerminalKeyRow';
import { defaultFontSize, FONT_SIZES, TerminalView, type ConnectionState, type TerminalHandle } from '@/components/TerminalView';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { clockTime } from '@/lib/time';
import { AGENT_LABELS, type ServerView } from '@/lib/types';
import { cn } from '@/lib/utils';
import { useCoarsePointer, useVisualViewport } from '@/lib/viewport';

type Session = { name: string; created: number; attached: number; cwd: string; command: string };

const AGENT_COMMANDS: Record<string, string> = { claude: 'claude', codex: 'codex', opencode: 'opencode' };

function uniqueName(base: string, taken: string[]) {
  if (!taken.includes(base)) return base;
  for (let i = 2; ; i++) if (!taken.includes(`${base}-${i}`)) return `${base}-${i}`;
}

function usePhone() {
  const query = '(max-width: 47.999rem), ((orientation: landscape) and (max-height: 31.999rem))';
  const [phone, setPhone] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setPhone(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return phone;
}

function StatusLine({ state }: { state: ConnectionState }) {
  const tone =
    state.kind === 'connected' ? 'bg-lime' : state.kind === 'ended' || state.kind === 'offline' ? 'bg-red' : 'bg-amber motion-safe:animate-pulse';
  const text =
    state.kind === 'connected'
      ? `Connected${state.latency !== null ? ` · ${state.latency} ms` : ''}`
      : state.kind === 'connecting'
        ? 'Connecting…'
        : state.reason;
  return (
    <p data-testid="terminal-status" data-state={state.kind} className="flex min-w-0 items-center gap-2 font-mono text-caption text-bone/70">
      <span aria-hidden className={cn('size-2 shrink-0 rounded-full', tone)} />
      <span className="truncate">{text}</span>
    </p>
  );
}

export function TerminalPage() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const queryClient = useQueryClient();
  const phone = usePhone();
  const coarse = useCoarsePointer();
  const viewport = useVisualViewport();
  const termRef = useRef<TerminalHandle>(null);
  const [ctrl, setCtrl] = useState(false);
  const [state, setState] = useState<ConnectionState>({ kind: 'connecting' });
  const [fontSize, setFontSize] = useState(defaultFontSize);
  const [immersive, setImmersive] = useState(false);
  const [selectText, setSelectText] = useState<string | null>(null);
  const [closing, setClosing] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [pendingOpen, setPendingOpen] = useState<{ name: string; command?: string; cwd?: string } | null>(null);

  const server = useQuery({ queryKey: ['server', id], queryFn: () => api<{ server: ServerView }>(`/servers/${id}`), refetchInterval: 20_000 });
  const online = server.data?.server.status === 'online';
  const sessions = useQuery({
    queryKey: ['terminals', id],
    queryFn: () => api<{ sessions: Session[] }>(`/servers/${id}/terminals`),
    enabled: online,
    refetchInterval: 30_000,
  });
  const list = useMemo(() => sessions.data?.sessions ?? [], [sessions.data]);
  const requested = params.get('s');
  const current = pendingOpen?.name ?? (requested && (list.some((s) => s.name === requested) || requested === pendingOpen?.name) ? requested : list[0]?.name) ?? null;

  useEffect(() => {
    document.title = `${server.data?.server.name ?? 'Terminal'} · Terminal · daemons.run`;
  }, [server.data]);

  const open = useCallback(
    (name: string, command?: string, cwd?: string) => {
      setState({ kind: 'connecting' });
      setPendingOpen({ name, command, cwd });
      setParams({ s: name }, { replace: true });
    },
    [setParams],
  );

  // Links like "Open terminal here" carry the folder (and maybe a command) for a new session.
  const linkCwd = params.get('cwd');
  const linkCommand = params.get('command');
  useEffect(() => {
    if (!sessions.data || !requested || (!linkCwd && !linkCommand)) return;
    if (sessions.data.sessions.some((x) => x.name === requested)) setParams({ s: requested }, { replace: true });
    else open(requested, linkCommand ?? undefined, linkCwd ?? undefined);
  }, [sessions.data, requested, linkCwd, linkCommand, open, setParams]);

  // Once the agent created the session, it shows up in the list.
  useEffect(() => {
    if (state.kind === 'connected' && pendingOpen) {
      void queryClient.invalidateQueries({ queryKey: ['terminals', id] }).then(() => setPendingOpen(null));
    }
  }, [state.kind, pendingOpen, queryClient, id]);
  useEffect(() => {
    if (state.kind === 'ended') void queryClient.invalidateQueries({ queryKey: ['terminals', id] });
  }, [state.kind, queryClient, id]);

  const kill = useMutation({
    mutationFn: (name: string) => api(`/servers/${id}/terminals/${encodeURIComponent(name)}`, { method: 'DELETE' }),
    onSuccess: (_r, name) => {
      setClosing(null);
      if (current === name) setParams({}, { replace: true });
      void queryClient.invalidateQueries({ queryKey: ['terminals', id] });
    },
  });
  const rename = useMutation({
    mutationFn: (p: { from: string; to: string }) =>
      api(`/servers/${id}/terminals/${encodeURIComponent(p.from)}`, { method: 'PATCH', json: { name: p.to } }),
    onSuccess: (_r, p) => {
      setRenaming(null);
      setParams({ s: p.to }, { replace: true });
      void queryClient.invalidateQueries({ queryKey: ['terminals', id] });
    },
  });

  const changeFont = (delta: number | null) => {
    const next = delta === null ? (phone ? 12 : 14) : Math.min(FONT_SIZES.max, Math.max(FONT_SIZES.min, fontSize + delta));
    setFontSize(next);
    termRef.current?.setFontSize(next);
  };

  const toggleFullscreen = async () => {
    if (document.fullscreenElement) await document.exitFullscreen().catch(() => undefined);
    else if (!immersive && document.documentElement.requestFullscreen && !phone) await document.documentElement.requestFullscreen().catch(() => undefined);
    setImmersive((v) => !v);
  };

  const s = server.data?.server;
  const agents = s?.agents ?? [];
  const taken = list.map((x) => x.name);
  const showSession = online && current !== null;

  // On phones the terminal owns the visual viewport, so the prompt stays above the keyboard.
  const frameStyle = phone || coarse ? { position: 'fixed' as const, left: 0, right: 0, top: viewport.offsetTop, height: viewport.height } : undefined;

  return (
    <div
      data-testid="terminal-page"
      style={frameStyle}
      className={cn('z-40 flex min-h-0 min-w-0 flex-1 flex-col bg-ink-950 text-bone', immersive && !frameStyle && 'fixed inset-0')}
    >
      {immersive && !viewport.keyboard ? null : (
        <header className="flex min-w-0 shrink-0 items-center gap-1 border-b border-white/10 px-1.5 py-1 sm:px-3">
          <Link
            to={`/servers/${id}`}
            aria-label="Back to server"
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-md text-bone/80 hover:bg-white/10 phone:size-11"
          >
            <ArrowLeft className="size-4" />
          </Link>
          <span className="hidden max-w-40 shrink-0 truncate font-mono text-control font-medium sm:inline">{s?.name}</span>
          <div role="tablist" aria-label="Terminals" className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:none]">
            {list.map((t) => (
              <div
                key={t.name}
                className={cn(
                  'flex h-9 shrink-0 items-center rounded-md border font-mono text-caption phone:h-11',
                  t.name === current ? 'border-lime/60 bg-white/10 text-bone' : 'border-transparent text-bone/70 hover:bg-white/5',
                )}
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={t.name === current}
                  data-testid={`terminal-tab-${t.name}`}
                  onClick={() => {
                    if (t.name !== current) setState({ kind: 'connecting' });
                    setParams({ s: t.name }, { replace: true });
                  }}
                  className="h-full px-2.5"
                >
                  {t.name}
                </button>
                {t.name === current ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button type="button" aria-label={`Actions for ${t.name}`} className="h-full px-1 text-bone/60 hover:text-bone">
                        <ChevronDown className="size-3.5" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                      <DropdownMenuItem
                        onSelect={() => {
                          setNewName(t.name);
                          setRenaming(t.name);
                        }}
                      >
                        Rename
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => setClosing(t.name)} className="text-red">
                        Close session
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : null}
              </div>
            ))}
            {pendingOpen && !taken.includes(pendingOpen.name) ? (
              <span className="flex h-9 shrink-0 items-center rounded-md border border-lime/60 bg-white/10 px-2.5 font-mono text-caption phone:h-11">
                {pendingOpen.name}
              </span>
            ) : null}
            {online ? (
              <button
                type="button"
                aria-label="New terminal"
                data-testid="terminal-new"
                onClick={() => open(uniqueName('shell', taken))}
                className="inline-flex size-9 shrink-0 items-center justify-center rounded-md text-bone/80 hover:bg-white/10 phone:size-11"
              >
                <Plus className="size-4" />
              </button>
            ) : null}
          </div>
          <div className="hidden shrink-0 items-center gap-0.5 font-mono text-caption sm:flex" aria-label="Font size">
            <button type="button" onClick={() => changeFont(-1)} className="h-8 rounded-md px-2 text-bone/80 hover:bg-white/10" aria-label="Smaller text">
              A-
            </button>
            <button type="button" onClick={() => changeFont(null)} className="h-8 rounded-md px-2 text-bone/80 hover:bg-white/10" aria-label="Default text size">
              A
            </button>
            <button type="button" onClick={() => changeFont(1)} className="h-8 rounded-md px-2 text-bone/80 hover:bg-white/10" aria-label="Larger text">
              A+
            </button>
          </div>
          <button
            type="button"
            onClick={() => void toggleFullscreen()}
            aria-label={immersive ? 'Exit full screen' : 'Full screen'}
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-md text-bone/80 hover:bg-white/10 phone:size-11"
          >
            {immersive ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
          </button>
        </header>
      )}
      {showSession ? (
        <div className="flex shrink-0 items-center justify-between gap-2 px-3 py-1">
          <StatusLine state={state} />
          <div className="flex items-center gap-0.5 font-mono text-caption sm:hidden">
            <button type="button" onClick={() => changeFont(-1)} className="h-8 rounded-md px-2 text-bone/80" aria-label="Smaller text">
              A-
            </button>
            <button type="button" onClick={() => changeFont(1)} className="h-8 rounded-md px-2 text-bone/80" aria-label="Larger text">
              A+
            </button>
          </div>
        </div>
      ) : null}

      <div className="relative flex min-h-0 flex-1 flex-col px-1 pb-1 sm:px-2">
        {!s ? null : !online ? (
          <div data-testid="terminal-offline" className="m-auto flex max-w-sm flex-col items-center gap-2 p-6 text-center">
            <SquareTerminal className="size-8 text-bone/40" aria-hidden />
            <p className="text-control font-medium">
              {s.status === 'offline' ? `Server offline since ${clockTime(s.lastSeenAt)}` : 'This server is not ready yet.'}
            </p>
            <p className="text-body text-bone/60">
              {s.status === 'offline'
                ? 'Your sessions keep running on the server. This page reconnects when it is back.'
                : 'The terminal opens once the server shows Online.'}
            </p>
          </div>
        ) : showSession ? (
          <TerminalView
            key={current}
            ref={termRef}
            serverId={id!}
            session={current}
            cwd={pendingOpen?.name === current ? pendingOpen.cwd : undefined}
            command={pendingOpen?.name === current ? pendingOpen.command : undefined}
            ctrl={ctrl}
            onCtrlUsed={() => setCtrl(false)}
            onState={setState}
            fontSize={fontSize}
          />
        ) : sessions.isLoading ? null : (
          <div data-testid="terminal-quick-start" className="m-auto flex w-full max-w-md flex-col items-center gap-4 p-6 text-center">
            <p className="text-section font-bold">Start a terminal</p>
            <p className="text-body text-bone/60">
              Sessions run in tmux on the server: close the tab or lose Wi-Fi, and they keep running. New terminals open in{' '}
              <code className="font-mono">/projects</code>.
            </p>
            <div className="flex w-full flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-center">
              {agents.map((a) => (
                <Button key={a} size="cta" data-testid={`quick-${a}`} onClick={() => open(uniqueName(a, taken), AGENT_COMMANDS[a])}>
                  {AGENT_LABELS[a] ?? a}
                </Button>
              ))}
              <Button
                size="cta"
                variant="secondary"
                className="border-white/20 bg-transparent text-bone hover:bg-white/10"
                data-testid="quick-shell"
                onClick={() => open(uniqueName('shell', taken))}
              >
                Shell
              </Button>
            </div>
          </div>
        )}
        {state.kind === 'ended' && showSession ? (
          <div className="absolute inset-x-3 bottom-3 flex items-center justify-between gap-3 rounded-md border border-white/15 bg-ink-900 p-3" style={{ backgroundColor: '#11120f' }}>
            <span className="text-body">{state.reason}</span>
            <Button size="sm" onClick={() => open(uniqueName('shell', taken))}>
              New terminal
            </Button>
          </div>
        ) : null}
      </div>

      {(coarse || phone) && showSession ? (
        <TerminalKeyRow
          ctrl={ctrl}
          onCtrl={setCtrl}
          onSend={(data) => termRef.current?.send(data)}
          onPaste={() => {
            void navigator.clipboard
              ?.readText()
              .then((text) => text && termRef.current?.paste(text))
              .catch(() => undefined);
          }}
          onSelect={() => setSelectText(termRef.current?.selectionText() ?? '')}
          onHideKeyboard={() => termRef.current?.blur()}
        />
      ) : null}

      <Dialog open={selectText !== null} onOpenChange={(o) => !o && setSelectText(null)}>
        <DialogContent className="flex max-h-[85dvh] flex-col">
          <DialogHeader>
            <DialogTitle>Select text</DialogTitle>
          </DialogHeader>
          <pre
            data-testid="terminal-select-text"
            className="min-h-0 flex-1 overflow-auto rounded-md bg-ink-950 p-3 font-mono text-caption whitespace-pre-wrap text-bone select-text"
            style={{ WebkitUserSelect: 'text', userSelect: 'text' }}
          >
            {selectText}
          </pre>
          <DialogFooter>
            <Button
              onClick={() => {
                const sel = window.getSelection()?.toString();
                void navigator.clipboard?.writeText(sel || selectText || '');
                setSelectText(null);
              }}
            >
              <Check />
              Copy {window.getSelection()?.toString() ? 'selection' : 'all'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={renaming !== null} onOpenChange={(o) => !o && setRenaming(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename terminal</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (renaming) rename.mutate({ from: renaming, to: newName });
            }}
            className="flex flex-col gap-3"
          >
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 32))}
              className="h-11 font-mono"
              autoFocus
            />
            {rename.error ? <p className="text-caption text-red">{rename.error.message}</p> : null}
            <DialogFooter>
              <Button type="button" variant="secondary" onClick={() => setRenaming(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={!newName || rename.isPending}>
                Rename
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDestructive
        open={closing !== null}
        onOpenChange={(o) => !o && setClosing(null)}
        title={`Close ${closing}?`}
        description="This ends the tmux session and everything running in it (a coding agent, a dev server)."
        confirmLabel="Close session"
        pending={kill.isPending}
        error={kill.error?.message}
        onConfirm={() => closing && kill.mutate(closing)}
      />
    </div>
  );
}
