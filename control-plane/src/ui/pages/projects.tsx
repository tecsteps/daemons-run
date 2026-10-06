import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { FolderGit2, GitBranch, Play, Plus, Square, SquareTerminal, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { ConfirmDestructive } from '@/components/ConfirmDestructive';
import { EmptyState } from '@/components/EmptyState';
import { Page, SectionCard } from '@/components/layout/Page';
import { LoadingRows, Notice } from '@/components/Notice';
import { StatusPill } from '@/components/StatusPill';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { api, ApiError } from '@/lib/api';
import { clockTime } from '@/lib/time';
import type { ServerView } from '@/lib/types';
import { useApps, type AppView } from '@/pages/apps';

type Project = { name: string; path: string; branch: string | null; compose: string | null; modifiedAt: number | null };
type Service = { service: string; name: string; state: string; status: string };

const CACHE = 'daemons:projects:';

/** The last list per server, kept in this browser only, for the offline state (07). */
function cached(serverId: string): { at: number; projects: Project[] } | null {
  try {
    return JSON.parse(localStorage.getItem(CACHE + serverId) ?? 'null');
  } catch {
    return null;
  }
}

function terminalLink(serverId: string, project: Project) {
  return `/servers/${serverId}/terminal?s=${encodeURIComponent(project.name.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 32))}&cwd=${encodeURIComponent(project.path)}`;
}

function ComposeServices({ server, project }: { server: ServerView; project: Project }) {
  const queryClient = useQueryClient();
  const services = useQuery({
    queryKey: ['compose', server.id, project.name],
    queryFn: () => api<{ services: Service[] }>(`/servers/${server.id}/projects/${encodeURIComponent(project.name)}/compose`),
    refetchInterval: 15_000,
  });
  const run = useMutation({
    mutationFn: (action: 'up' | 'stop') => api(`/servers/${server.id}/projects/${encodeURIComponent(project.name)}/compose/${action}`, { method: 'POST' }),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ['compose', server.id, project.name] }),
  });
  const list = services.data?.services ?? [];
  const running = list.some((s) => s.state === 'running');
  return (
    <div className="flex flex-col gap-2 rounded-md border border-line bg-canvas p-3" data-testid={`compose-${project.name}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-mono text-caption text-muted">{project.compose}</span>
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" disabled={run.isPending} onClick={() => run.mutate('up')} data-testid={`compose-up-${project.name}`}>
            <Play />
            {run.isPending && run.variables === 'up' ? 'Starting…' : 'Start Compose'}
          </Button>
          {running ? (
            <Button size="sm" variant="secondary" disabled={run.isPending} onClick={() => run.mutate('stop')}>
              <Square />
              {run.isPending && run.variables === 'stop' ? 'Stopping…' : 'Stop'}
            </Button>
          ) : null}
        </div>
      </div>
      {list.length ? (
        <ul className="flex flex-col gap-1">
          {list.map((s) => (
            <li key={s.name} className="flex items-center justify-between gap-2 text-caption">
              <span className="truncate font-mono text-ink-900">{s.service}</span>
              <StatusPill status={s.state === 'running' ? 'up' : 'down'} label={s.state === 'running' ? 'Running' : s.status || s.state} size="sm" />
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-caption text-muted">No containers yet.</p>
      )}
      {run.error ? <p className="text-caption text-red">{run.error.message}</p> : null}
    </div>
  );
}

function ProjectCard({ server, project, apps }: { server: ServerView; project: Project; apps: AppView[] }) {
  const queryClient = useQueryClient();
  const [deleting, setDeleting] = useState(false);
  const remove = useMutation({
    mutationFn: () => api(`/servers/${server.id}/projects/${encodeURIComponent(project.name)}`, { method: 'DELETE', json: { confirm: project.name } }),
    onSuccess: () => {
      setDeleting(false);
      void queryClient.invalidateQueries({ queryKey: ['projects', server.id] });
    },
  });
  const projectApps = apps.filter((a) => a.serverId === server.id && a.cwd && (a.cwd === project.path || a.cwd.startsWith(`${project.path}/`)));
  return (
    <article data-testid={`project-${project.name}`} className="flex min-w-0 flex-col gap-3 rounded-md border border-line bg-surface p-4">
      <div className="flex min-w-0 items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-md border border-line bg-canvas text-ink-900" aria-hidden>
          <FolderGit2 className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-mono text-card-title font-semibold text-ink-900">{project.name}</p>
          <p className="flex flex-wrap items-center gap-x-2 text-caption text-muted">
            <span>{server.name}</span>
            {project.branch ? (
              <span className="inline-flex items-center gap-1">
                <GitBranch className="size-3" aria-hidden />
                {project.branch}
              </span>
            ) : null}
          </p>
        </div>
      </div>
      {projectApps.length ? (
        <ul className="flex flex-col gap-1">
          {projectApps.map((a) => (
            <li key={a.name} className="truncate font-mono text-caption">
              <a className="text-cyan-deep hover:underline" href={a.url} target="_blank" rel="noreferrer">
                {a.url}
              </a>
            </li>
          ))}
        </ul>
      ) : null}
      {project.compose && server.status === 'online' ? <ComposeServices server={server} project={project} /> : null}
      <div className="mt-auto flex flex-wrap gap-2">
        {server.status === 'online' ? (
          <Button asChild size="sm" variant="secondary" className="border-ink-900 bg-ink-900 font-mono text-bone hover:bg-ink-900/90 dark:bg-bone dark:text-ink-950">
            <Link to={terminalLink(server.id, project)} data-testid={`open-terminal-${project.name}`}>
              <SquareTerminal />
              Open terminal here
            </Link>
          </Button>
        ) : null}
        <Button asChild size="sm" variant="secondary">
          <Link to="/apps">Expose app</Link>
        </Button>
        {server.status === 'online' ? (
          <Button size="sm" variant="quiet" onClick={() => setDeleting(true)} aria-label={`Delete ${project.name}`} className="ml-auto">
            <Trash2 />
          </Button>
        ) : null}
      </div>
      <ConfirmDestructive
        open={deleting}
        onOpenChange={setDeleting}
        title={`Delete ${project.name}?`}
        description={
          project.compose
            ? `Runs docker compose down, then deletes ${project.path} on ${server.name}. This cannot be undone.`
            : `Deletes ${project.path} on ${server.name}. This cannot be undone.`
        }
        expectedName={project.name}
        pending={remove.isPending}
        error={remove.error?.message}
        onConfirm={() => remove.mutate()}
      />
    </article>
  );
}

function NewProjectDialog({ servers, open, onOpenChange }: { servers: ServerView[]; open: boolean; onOpenChange: (o: boolean) => void }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [serverId, setServerId] = useState(servers[0]?.id ?? '');
  const [name, setName] = useState('');
  const [git, setGit] = useState('');
  useEffect(() => {
    if (!serverId && servers[0]) setServerId(servers[0].id);
  }, [servers, serverId]);
  useEffect(() => {
    if (git && !name) {
      const guess = git.replace(/\.git$/, '').split(/[/:]/).pop() ?? '';
      if (guess) setName(guess.replace(/[^A-Za-z0-9._-]/g, '-'));
    }
  }, [git, name]);
  const create = useMutation({
    mutationFn: () => api<{ project: Project }>(`/servers/${serverId}/projects`, { method: 'POST', json: { name, git: git || undefined } }),
    onSuccess: ({ project }) => {
      void queryClient.invalidateQueries({ queryKey: ['projects', serverId] });
      onOpenChange(false);
      navigate(terminalLink(serverId, { ...project, branch: null, compose: null, modifiedAt: null }));
    },
  });
  const gitAuth = create.error instanceof ApiError && create.error.body.code === 'git_auth';
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New project</DialogTitle>
          <DialogDescription>A folder in /projects. Clone a repository into it, or start empty.</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          {servers.length > 1 ? (
            <label className="flex flex-col gap-1.5 text-control font-medium text-ink-900">
              Server
              <select value={serverId} onChange={(e) => setServerId(e.target.value)} className="h-11 rounded-md border border-line bg-canvas px-3 text-ink-900">
                {servers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="flex flex-col gap-1.5 text-control font-medium text-ink-900">
            Git URL (optional)
            <Input
              value={git}
              onChange={(e) => setGit(e.target.value.trim())}
              placeholder="https://github.com/you/app.git"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              className="h-11 font-mono"
              data-testid="project-git"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-control font-medium text-ink-900">
            Name
            <Input
              value={name}
              onChange={(e) => setName(e.target.value.replace(/[^A-Za-z0-9._-]/g, '-'))}
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              className="h-11 font-mono"
              data-testid="project-name"
            />
          </label>
          {create.error ? (
            <Notice>
              {create.error.message}
              {gitAuth ? (
                <>
                  {' '}
                  <Link className="underline" to={`/servers/${serverId}/terminal?s=gh-auth&command=${encodeURIComponent('gh auth login')}`}>
                    Open terminal
                  </Link>
                </>
              ) : null}
            </Notice>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name || !serverId || create.isPending} data-testid="project-create">
              {create.isPending ? (git ? 'Cloning…' : 'Creating…') : git ? 'Clone' : 'Create'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ProjectsPage() {
  const servers = useQuery({ queryKey: ['servers'], queryFn: () => api<{ servers: ServerView[] }>('/servers') });
  const apps = useApps();
  const ready = (servers.data?.servers ?? []).filter((s) => s.status === 'online' || s.status === 'offline');
  const online = ready.filter((s) => s.status === 'online');
  const [creating, setCreating] = useState(false);
  const results = useQueries({
    queries: ready.map((s) => ({
      queryKey: ['projects', s.id],
      enabled: s.status === 'online',
      queryFn: async () => {
        const r = await api<{ projects: Project[] }>(`/servers/${s.id}/projects`);
        try {
          localStorage.setItem(CACHE + s.id, JSON.stringify({ at: Date.now(), projects: r.projects }));
        } catch {}
        return r;
      },
    })),
  });
  const total = results.reduce((n, r) => n + (r.data?.projects.length ?? 0), 0);
  const loading = servers.isLoading || results.some((r) => r.isLoading);

  return (
    <Page
      title="Projects"
      description={total ? 'Folders in /projects on your servers.' : undefined}
      actions={
        online.length ? (
          <Button onClick={() => setCreating(true)} data-testid="new-project">
            <Plus />
            New project
          </Button>
        ) : null
      }
    >
      {servers.error ? <Notice onRetry={() => void servers.refetch()}>{servers.error.message}</Notice> : null}
      {loading ? (
        <LoadingRows rows={2} />
      ) : ready.length === 0 ? (
        <EmptyState
          illustration="app-empty-daemons"
          title="No server yet"
          description="Projects live on your servers. Create one first."
          action={
            <Button asChild size="cta">
              <Link to="/servers/new">New server</Link>
            </Button>
          }
        />
      ) : (
        ready.map((s, i) => {
          const r = results[i];
          const offline = s.status !== 'online';
          const old = offline ? cached(s.id) : null;
          const projects = r.data?.projects ?? old?.projects ?? [];
          return (
            <SectionCard
              key={s.id}
              title={s.name}
              actions={offline ? <StatusPill status="offline" /> : null}
              description={offline ? (old ? `Offline, data from ${clockTime(old.at)}.` : 'Offline. The list appears when the server is back.') : undefined}
            >
              {r.error ? <Notice onRetry={() => void r.refetch()}>{r.error.message}</Notice> : null}
              {projects.length === 0 && !offline && !r.error ? (
                <EmptyState
                  density="section"
                  illustration="app-empty-daemons"
                  title="No projects yet"
                  description="Any folder in /projects counts, including ones you create with mkdir in a terminal."
                  action={
                    <Button size="sm" onClick={() => setCreating(true)}>
                      <Plus />
                      New project
                    </Button>
                  }
                />
              ) : (
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {projects.map((p) => (
                    <ProjectCard key={p.name} server={s} project={p} apps={apps.data?.apps ?? []} />
                  ))}
                </div>
              )}
            </SectionCard>
          );
        })
      )}
      {creating ? <NewProjectDialog servers={online} open={creating} onOpenChange={setCreating} /> : null}
    </Page>
  );
}
