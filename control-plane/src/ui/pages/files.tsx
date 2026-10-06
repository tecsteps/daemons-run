// Layout ideas adapted from old daemons-run resources/js/components/daemon/files/ (tree panel,
// editor panel, dialogs); data comes from the agent's file.* messages via /api/servers/:id/files.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowUp, Download, File, FileText, Folder, FolderPlus, Image, MoreHorizontal, Save, Upload, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { CodeEditor } from '@/components/CodeEditor';
import { ConfirmDestructive } from '@/components/ConfirmDestructive';
import { Page } from '@/components/layout/Page';
import { LoadingRows, Notice } from '@/components/Notice';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { api, ApiError } from '@/lib/api';
import { relativeTime } from '@/lib/time';
import type { ServerView } from '@/lib/types';
import { cn } from '@/lib/utils';

type Entry = { name: string; type: 'file' | 'dir' | 'link'; size: number; mtime_ms: number; mode: number };
type Opened = { path: string; kind: 'text' | 'image' | 'binary' | 'large'; text?: string; url?: string; size: number; mtime: number };

const IMAGE = /\.(png|jpe?g|gif|webp|svg|avif|ico)$/i;
const join = (dir: string, name: string) => (dir === '/' ? `/${name}` : `${dir}/${name}`);
const parent = (path: string) => path.replace(/\/[^/]+$/, '') || '/';

function size(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 ** 2).toFixed(1)} MB`;
}

function useDark() {
  const [dark, setDark] = useState(() => document.documentElement.dataset.theme === 'dark');
  useEffect(() => {
    const observer = new MutationObserver(() => setDark(document.documentElement.dataset.theme === 'dark'));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);
  return dark;
}

export function FilesPage() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const queryClient = useQueryClient();
  const dark = useDark();
  const dir = params.get('path') ?? '/projects';
  const [hidden, setHidden] = useState(false);
  const [opened, setOpened] = useState<Opened | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [asking, setAsking] = useState<null | { kind: 'file' | 'folder' } | { kind: 'rename'; entry: Entry }>(null);
  const [name, setName] = useState('');
  const [deleting, setDeleting] = useState<Entry | null>(null);
  const [leaving, setLeaving] = useState<(() => void) | null>(null);
  const [uploads, setUploads] = useState<{ name: string; done: number; total: number; error?: string }[]>([]);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const dirty = draft !== null && opened?.kind === 'text' && draft !== opened.text;

  const server = useQuery({ queryKey: ['server', id], queryFn: () => api<{ server: ServerView }>(`/servers/${id}`) });
  const online = server.data?.server.status === 'online';
  const list = useQuery({
    queryKey: ['files', id, dir, hidden],
    queryFn: () => api<{ entries: Entry[] }>(`/servers/${id}/files?path=${encodeURIComponent(dir)}&hidden=${hidden ? 1 : 0}`),
    enabled: online,
  });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['files', id, dir] });

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  /** Runs `go` now, or after the owner agrees to drop unsaved changes. */
  const guard = (go: () => void) => (dirty ? setLeaving(() => go) : go());

  const navigate = (path: string) => guard(() => {
    setOpened(null);
    setDraft(null);
    setParams({ path }, { replace: false });
  });

  const open = useCallback(
    async (path: string) => {
      const res = await fetch(`/api/servers/${id}/files/content?edit=1&path=${encodeURIComponent(path)}`, { credentials: 'same-origin' });
      if (res.status === 413) {
        const stat = await api<{ size: number; mtime_ms: number }>(`/servers/${id}/files/stat?path=${encodeURIComponent(path)}`);
        setOpened({ path, kind: 'large', size: stat.size, mtime: stat.mtime_ms });
        setDraft(null);
        return;
      }
      if (!res.ok) throw new ApiError(((await res.json().catch(() => ({ error: 'The file could not be opened.' }))) as { error: string }).error, res.status);
      const buffer = new Uint8Array(await res.arrayBuffer());
      const mtime = Number(res.headers.get('X-Mtime-Ms'));
      if (IMAGE.test(path)) {
        const type = path.toLowerCase().endsWith('.svg') ? 'image/svg+xml' : 'image/*';
        setOpened({ path, kind: 'image', url: URL.createObjectURL(new Blob([buffer], { type })), size: buffer.length, mtime });
      } else if (buffer.subarray(0, 8000).includes(0)) {
        setOpened({ path, kind: 'binary', size: buffer.length, mtime });
      } else {
        const text = new TextDecoder().decode(buffer);
        setOpened({ path, kind: 'text', text, size: buffer.length, mtime });
      }
      setDraft(null);
    },
    [id],
  );
  const [openError, setOpenError] = useState<string | null>(null);
  const openFile = (path: string) =>
    guard(() => {
      setOpenError(null);
      open(path).catch((e: Error) => setOpenError(e.message));
    });

  const save = useMutation({
    mutationFn: async (force: boolean) => {
      if (!opened || draft === null) return null;
      const q = force ? '' : `&expected_mtime_ms=${opened.mtime}`;
      const res = await fetch(`/api/servers/${id}/files/content?path=${encodeURIComponent(opened.path)}${q}`, {
        method: 'PUT',
        credentials: 'same-origin',
        body: draft,
      });
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown> & { error?: string };
      if (res.status === 409) throw new ApiError(body.error ?? 'Conflict.', 409, body);
      if (!res.ok) throw new ApiError(body.error ?? 'Saving failed.', res.status, body);
      return body as { size: number; mtime_ms: number };
    },
    onSuccess: (r) => {
      if (!r || !opened || draft === null) return;
      setOpened({ ...opened, text: draft, size: r.size, mtime: r.mtime_ms });
      setDraft(null);
      setConflict(false);
      refresh();
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 409) setConflict(true);
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      if (!asking) return;
      if (asking.kind === 'folder') return api(`/servers/${id}/files/mkdir`, { method: 'POST', json: { path: join(dir, name) } });
      if (asking.kind === 'rename') return api(`/servers/${id}/files/rename`, { method: 'POST', json: { from: join(dir, asking.entry.name), to: join(dir, name) } });
      const res = await fetch(`/api/servers/${id}/files/content?path=${encodeURIComponent(join(dir, name))}`, { method: 'PUT', credentials: 'same-origin', body: '' });
      if (!res.ok) throw new ApiError(((await res.json()) as { error: string }).error, res.status);
    },
    onSuccess: () => {
      const created = asking?.kind === 'file' ? join(dir, name) : null;
      setAsking(null);
      refresh();
      if (created) openFile(created);
    },
  });

  const remove = useMutation({
    mutationFn: (e: Entry) => api(`/servers/${id}/files?path=${encodeURIComponent(join(dir, e.name))}&recursive=${e.type === 'dir' ? 1 : 0}`, { method: 'DELETE' }),
    onSuccess: (_r, e) => {
      setDeleting(null);
      if (opened?.path === join(dir, e.name)) setOpened(null);
      refresh();
    },
  });

  const upload = async (files: FileList | File[]) => {
    const list = [...files];
    setUploads(list.map((f) => ({ name: f.name, done: 0, total: f.size })));
    await Promise.all(
      list.map(
        (f, i) =>
          new Promise<void>((resolve) => {
            // XHR for upload progress; fetch has none.
            const xhr = new XMLHttpRequest();
            xhr.open('PUT', `/api/servers/${id}/files/content?path=${encodeURIComponent(join(dir, f.name))}`);
            xhr.upload.onprogress = (e) => setUploads((u) => u.map((x, j) => (j === i ? { ...x, done: e.loaded } : x)));
            xhr.onload = () => {
              const error = xhr.status >= 300 ? (JSON.parse(xhr.responseText || '{}').error ?? 'Upload failed.') : undefined;
              setUploads((u) => u.map((x, j) => (j === i ? { ...x, done: x.total, error } : x)));
              resolve();
            };
            xhr.onerror = () => {
              setUploads((u) => u.map((x, j) => (j === i ? { ...x, error: 'Upload failed.' } : x)));
              resolve();
            };
            xhr.send(f);
          }),
      ),
    );
    refresh();
  };

  const crumbs = useMemo(() => {
    const parts = dir.split('/').filter(Boolean);
    return parts.map((p, i) => ({ label: p, path: `/${parts.slice(0, i + 1).join('/')}` }));
  }, [dir]);

  const s = server.data?.server;
  const entries = list.data?.entries ?? [];
  const showEditor = !!opened;

  return (
    <Page title="Files" crumbs={[{ label: 'Servers', to: '/servers' }, { label: s?.name ?? '…', to: `/servers/${id}` }, { label: 'Files' }]} width="console">
      {s && !online ? <Notice tone="warning">{s.name} is offline. Files are available again when it reconnects.</Notice> : null}
      <div className="grid min-h-[32rem] min-w-0 grid-cols-1 gap-4 lg:grid-cols-[minmax(18rem,26rem)_1fr]">
        <section
          className={cn('flex min-w-0 flex-col rounded-md border border-line bg-surface', showEditor && 'max-lg:hidden', dragging && 'ring-2 ring-lime')}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            if (e.dataTransfer.files.length) void upload(e.dataTransfer.files);
          }}
        >
          <div className="flex min-w-0 flex-wrap items-center gap-1 border-b border-line p-2">
            <Button variant="quiet" size="icon-sm" aria-label="Up one folder" disabled={dir === '/'} onClick={() => navigate(parent(dir))}>
              <ArrowUp />
            </Button>
            <nav aria-label="Path" className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto font-mono text-caption whitespace-nowrap text-muted">
              <button type="button" onClick={() => navigate('/')} className="px-1 hover:text-ink-900">
                /
              </button>
              {crumbs.map((c, i) => (
                <span key={c.path} className="flex items-center">
                  <button type="button" onClick={() => navigate(c.path)} className={cn('px-0.5 hover:text-ink-900', i === crumbs.length - 1 && 'text-ink-900')}>
                    {c.label}
                  </button>
                  {i < crumbs.length - 1 ? '/' : null}
                </span>
              ))}
            </nav>
          </div>
          <div className="flex flex-wrap items-center gap-1 border-b border-line p-2">
            <Button variant="secondary" size="sm" disabled={!online} onClick={() => { setName(''); setAsking({ kind: 'file' }); }} data-testid="files-new-file">
              <FileText />
              File
            </Button>
            <Button variant="secondary" size="sm" disabled={!online} onClick={() => { setName(''); setAsking({ kind: 'folder' }); }}>
              <FolderPlus />
              Folder
            </Button>
            <Button variant="secondary" size="sm" disabled={!online} onClick={() => fileInput.current?.click()} data-testid="files-upload">
              <Upload />
              Upload
            </Button>
            <input ref={fileInput} type="file" multiple hidden data-testid="files-upload-input" onChange={(e) => e.target.files && void upload(e.target.files)} />
            <label className="ml-auto flex items-center gap-2 text-caption text-muted">
              Hidden
              <Switch checked={hidden} onCheckedChange={setHidden} />
            </label>
          </div>
          {uploads.length ? (
            <ul className="flex flex-col gap-1 border-b border-line p-2 text-caption" data-testid="files-uploads">
              {uploads.map((u) => (
                <li key={u.name} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate font-mono text-ink-900">{u.name}</span>
                  <span className={u.error ? 'text-red' : 'text-muted'}>
                    {u.error ?? (u.done >= u.total ? 'Uploaded' : `${Math.round((u.done / Math.max(1, u.total)) * 100)}%`)}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
          {list.error ? (
            <Notice className="m-2" onRetry={() => void list.refetch()}>
              {list.error.message}
            </Notice>
          ) : null}
          {list.isLoading ? (
            <div className="p-2">
              <LoadingRows rows={3} />
            </div>
          ) : (
            <ul className="min-h-0 flex-1 overflow-y-auto py-1" data-testid="files-list">
              {entries.length === 0 && !list.error ? <li className="p-4 text-body text-muted">This folder is empty. Drop files here to upload.</li> : null}
              {entries.map((e) => {
                const path = join(dir, e.name);
                const Icon = e.type === 'dir' ? Folder : IMAGE.test(e.name) ? Image : File;
                return (
                  <li key={e.name} className={cn('group flex min-w-0 items-center gap-1 pr-1', opened?.path === path && 'bg-lime-pale')}>
                    <button
                      type="button"
                      data-testid={`file-${e.name}`}
                      onClick={() => (e.type === 'dir' ? navigate(path) : openFile(path))}
                      className="flex min-h-10 min-w-0 flex-1 items-center gap-2 px-3 text-left phone:min-h-11"
                    >
                      <Icon className={cn('size-4 shrink-0', e.type === 'dir' ? 'text-lime-deep' : 'text-muted')} aria-hidden />
                      <span className="min-w-0 flex-1 truncate font-mono text-tech text-ink-900">{e.name}</span>
                      <span className="shrink-0 text-caption text-muted">{e.type === 'dir' ? '' : size(e.size)}</span>
                    </button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="quiet" size="icon-sm" aria-label={`Actions for ${e.name}`}>
                          <MoreHorizontal />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem asChild>
                          <a href={e.type === 'dir' ? `/api/servers/${id}/files/archive?path=${encodeURIComponent(path)}` : `/api/servers/${id}/files/content?path=${encodeURIComponent(path)}`} download>
                            {e.type === 'dir' ? 'Download .tar.gz' : 'Download'}
                          </a>
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => { setName(e.name); setAsking({ kind: 'rename', entry: e }); }}>Rename</DropdownMenuItem>
                        <DropdownMenuItem className="text-red" onSelect={() => setDeleting(e)}>
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className={cn('flex min-h-[28rem] min-w-0 flex-col overflow-hidden rounded-md border border-line bg-canvas', !showEditor && 'max-lg:hidden')}>
          {opened ? (
            <>
              <div className="flex min-w-0 items-center gap-2 border-b border-line p-2">
                <Button variant="quiet" size="icon-sm" aria-label="Close file" onClick={() => guard(() => { setOpened(null); setDraft(null); })}>
                  <X />
                </Button>
                <span className="min-w-0 flex-1 truncate font-mono text-tech text-ink-900" data-testid="files-open-path">
                  {opened.path}
                  {dirty ? <span className="ml-2 text-amber-deep">● unsaved</span> : null}
                </span>
                <span className="hidden text-caption text-muted sm:inline">
                  {size(opened.size)} · changed {relativeTime(opened.mtime)}
                </span>
                {opened.kind === 'text' ? (
                  <Button size="sm" disabled={!dirty || save.isPending} onClick={() => save.mutate(false)} data-testid="files-save">
                    <Save />
                    {save.isPending ? 'Saving…' : 'Save'}
                  </Button>
                ) : (
                  <Button asChild size="sm" variant="secondary">
                    <a href={`/api/servers/${id}/files/content?path=${encodeURIComponent(opened.path)}`} download>
                      <Download />
                      Download
                    </a>
                  </Button>
                )}
              </div>
              {save.error && !conflict ? <Notice className="m-2">{save.error.message}</Notice> : null}
              <div className="min-h-0 flex-1">
                {opened.kind === 'text' ? (
                  <CodeEditor key={`${opened.path}:${opened.mtime}`} path={opened.path} initial={opened.text ?? ''} dark={dark} onChange={setDraft} onSave={() => save.mutate(false)} />
                ) : opened.kind === 'image' ? (
                  <div className="flex h-full items-center justify-center bg-surface p-4">
                    <img src={opened.url} alt={opened.path} className="max-h-full max-w-full object-contain" data-testid="files-image" />
                  </div>
                ) : (
                  <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
                    <File className="size-8 text-muted" aria-hidden />
                    <p className="text-control font-medium text-ink-900" data-testid="files-binary">
                      {opened.kind === 'large' ? 'This file is larger than 2 MB.' : 'This is a binary file.'}
                    </p>
                    <p className="text-body text-muted">{size(opened.size)}. Download it to open it on your device.</p>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="m-auto max-w-sm p-6 text-center text-body text-muted">
              {openError ? <Notice>{openError}</Notice> : 'Pick a file to view or edit it. Changes are saved straight to the server.'}
              <p className="mt-3">
                <Link className="underline" to={`/servers/${id}/terminal`}>
                  Open a terminal
                </Link>{' '}
                for anything bigger.
              </p>
            </div>
          )}
        </section>
      </div>

      <Dialog open={asking !== null} onOpenChange={(o) => !o && setAsking(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{asking?.kind === 'folder' ? 'New folder' : asking?.kind === 'rename' ? 'Rename' : 'New file'}</DialogTitle>
            <DialogDescription>In {dir}</DialogDescription>
          </DialogHeader>
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              create.mutate();
            }}
          >
            <Input value={name} onChange={(e) => setName(e.target.value.replace(/\//g, ''))} autoFocus autoCapitalize="off" autoCorrect="off" spellCheck={false} className="h-11 font-mono" data-testid="files-name" />
            {create.error ? <p className="text-caption text-red">{create.error.message}</p> : null}
            <DialogFooter>
              <Button type="button" variant="secondary" onClick={() => setAsking(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={!name || create.isPending} data-testid="files-name-submit">
                {asking?.kind === 'rename' ? 'Rename' : 'Create'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={conflict} onOpenChange={setConflict}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>The file changed on the server</DialogTitle>
            <DialogDescription>Something else (a coding agent, perhaps) saved {opened?.path} after you opened it.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="secondary"
              data-testid="conflict-reload"
              onClick={() => {
                setConflict(false);
                if (opened) void open(opened.path);
              }}
            >
              Reload theirs
            </Button>
            <Button variant="destructive-fill" data-testid="conflict-overwrite" onClick={() => save.mutate(true)}>
              Overwrite with mine
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={leaving !== null} onOpenChange={(o) => !o && setLeaving(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Discard unsaved changes?</DialogTitle>
            <DialogDescription>{opened?.path} has changes that are not saved.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setLeaving(null)}>
              Keep editing
            </Button>
            <Button
              variant="destructive-fill"
              onClick={() => {
                const go = leaving;
                setLeaving(null);
                setDraft(null);
                go?.();
              }}
            >
              Discard
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDestructive
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete ${deleting?.name}?`}
        description={deleting?.type === 'dir' ? 'The folder and everything in it is deleted on the server.' : 'The file is deleted on the server.'}
        pending={remove.isPending}
        error={remove.error?.message}
        onConfirm={() => deleting && remove.mutate(deleting)}
      />
    </Page>
  );
}
