// Preview list and port offers adapted from old daemons-run resources/js/components/PreviewLinks.tsx
// and components/daemon/PreviewOffers.tsx.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { ConfirmDestructive } from '@/components/ConfirmDestructive';
import { CopyControl } from '@/components/CopyControl';
import { EmptyState } from '@/components/EmptyState';
import { Page, SectionCard } from '@/components/layout/Page';
import { LoadingRows, Notice } from '@/components/Notice';
import { StatusPill } from '@/components/StatusPill';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { api } from '@/lib/api';
import type { ServerView } from '@/lib/types';

export type AppView = {
  name: string;
  port: number;
  cwd: string | null;
  public: boolean;
  serverId: string;
  serverName: string | null;
  url: string;
  createdAt: number;
};

type Port = { port: number; address: string; process: string; pid: number; cwd: string };

export function useApps() {
  return useQuery({ queryKey: ['apps'], queryFn: () => api<{ appsOrigin: string; apps: AppView[] }>('/apps') });
}

/** The gateway is a separate Worker; the browser asks it directly whether it exists (08). */
export function useGateway(origin: string | undefined) {
  return useQuery({
    queryKey: ['gateway', origin],
    enabled: !!origin,
    staleTime: 60_000,
    queryFn: async () => {
      try {
        const r = await fetch(`${origin}/_daemons/health`, { cache: 'no-store' });
        return r.ok;
      } catch {
        return false;
      }
    },
  });
}

function suggestAppName(p: Port) {
  const base = (p.cwd.split('/').filter(Boolean).pop() ?? p.process).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  return (base && base !== 'projects' && base !== 'dev' ? base : `app-${p.port}`).slice(0, 40);
}

/** "Port 5173 (vite, /projects/shop) — Expose?" for one server. */
export function PortOffers({ server, apps }: { server: ServerView; apps: AppView[] }) {
  const queryClient = useQueryClient();
  const ports = useQuery({
    queryKey: ['ports', server.id],
    queryFn: () => api<{ ports: Port[] }>(`/servers/${server.id}/ports`),
    enabled: server.status === 'online',
    refetchInterval: 15_000,
  });
  const [names, setNames] = useState<Record<number, string>>({});
  const expose = useMutation({
    mutationFn: (p: Port) =>
      api('/apps', { method: 'POST', json: { serverId: server.id, port: p.port, name: names[p.port] ?? suggestAppName(p), cwd: p.cwd || undefined } }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['apps'] }),
  });
  if (server.status !== 'online') return null;
  const exposed = new Set(apps.filter((a) => a.serverId === server.id).map((a) => a.port));
  const offers = (ports.data?.ports ?? []).filter((p) => !exposed.has(p.port) && p.port !== 22 && p.port !== 53 && p.port < 49152);
  if (ports.error) return <Notice onRetry={() => void ports.refetch()}>{ports.error.message}</Notice>;
  if (offers.length === 0) return null;
  return (
    <SectionCard title={`Listening on ${server.name}`} description="Apps on these ports can get a link." testId={`offers-${server.name}`}>
      <ul className="flex flex-col divide-y divide-line">
        {offers.map((p) => (
          <li key={`${p.port}-${p.pid}`} className="flex min-w-0 flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0">
            <div className="min-w-0 flex-1">
              <p className="font-mono text-control text-ink-900">Port {p.port}</p>
              <p className="truncate text-caption text-muted">
                {p.process}
                {p.cwd ? ` · ${p.cwd}` : ''}
              </p>
            </div>
            <Input
              aria-label={`Name for port ${p.port}`}
              value={names[p.port] ?? suggestAppName(p)}
              onChange={(e) => setNames((n) => ({ ...n, [p.port]: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') }))}
              className="h-9 w-36 font-mono"
            />
            <Button size="sm" onClick={() => expose.mutate(p)} disabled={expose.isPending} data-testid={`expose-${p.port}`}>
              Expose
            </Button>
          </li>
        ))}
      </ul>
      {expose.error ? <Notice>{expose.error.message}</Notice> : null}
    </SectionCard>
  );
}

function AppRow({ app }: { app: AppView }) {
  const queryClient = useQueryClient();
  const [removing, setRemoving] = useState(false);
  const toggle = useMutation({
    mutationFn: (next: boolean) => api(`/apps/${app.name}`, { method: 'PATCH', json: { public: next } }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['apps'] }),
  });
  const remove = useMutation({
    mutationFn: () => api(`/apps/${app.name}`, { method: 'DELETE' }),
    onSuccess: () => {
      setRemoving(false);
      void queryClient.invalidateQueries({ queryKey: ['apps'] });
    },
  });
  return (
    <li data-testid={`app-${app.name}`} className="flex min-w-0 flex-col gap-3 py-4 first:pt-0 last:pb-0">
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-mono text-card-title font-semibold text-ink-900">{app.name}</span>
        <StatusPill status={app.public ? 'public' : 'private'} size="sm" />
        <span className="text-caption text-muted">
          port {app.port} on{' '}
          <Link className="underline" to={`/servers/${app.serverId}`}>
            {app.serverName ?? 'a removed server'}
          </Link>
          {app.cwd ? ` · ${app.cwd}` : ''}
        </span>
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <a href={app.url} target="_blank" rel="noreferrer" className="min-w-0 truncate font-mono text-tech text-cyan-deep underline-offset-2 hover:underline">
          {app.url}
        </a>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild size="sm">
          <a href={app.url} target="_blank" rel="noreferrer">
            <ExternalLink />
            Open
          </a>
        </Button>
        <CopyControl value={app.url} label="Copy link" />
        <label className="ml-1 flex items-center gap-2 text-caption text-ink-900">
          <Switch checked={app.public} onCheckedChange={(v) => toggle.mutate(v)} data-testid={`public-${app.name}`} />
          Public link
        </label>
        <Button variant="quiet" size="sm" onClick={() => setRemoving(true)} className="ml-auto" aria-label={`Unexpose ${app.name}`}>
          <Trash2 />
          Unexpose
        </Button>
      </div>
      {app.public ? <p className="text-caption text-amber-deep">Anyone with the link can open this app, without signing in.</p> : null}
      <ConfirmDestructive
        open={removing}
        onOpenChange={setRemoving}
        title={`Unexpose ${app.name}?`}
        description="The link stops working. The app itself keeps running on the server."
        confirmLabel="Unexpose"
        pending={remove.isPending}
        onConfirm={() => remove.mutate()}
      />
    </li>
  );
}

export function AppsPage() {
  const apps = useApps();
  const servers = useQuery({ queryKey: ['servers'], queryFn: () => api<{ servers: ServerView[] }>('/servers') });
  const gateway = useGateway(apps.data?.appsOrigin);
  const list = apps.data?.apps ?? [];
  const online = (servers.data?.servers ?? []).filter((s) => s.status === 'online');
  return (
    <Page title="Apps" description="Apps on localhost, at a link. Private apps ask for your passkey; public ones do not.">
      {apps.error ? <Notice onRetry={() => void apps.refetch()}>{apps.error.message}</Notice> : null}
      {gateway.data === false ? (
        <SectionCard tone="lime" title="Enable app links" testId="enable-app-links">
          <p className="text-body text-ink-900">
            Apps get their own address, <code className="font-mono">{apps.data?.appsOrigin}</code>, separate from this control plane, so code in an app can
            never act as you here. Deploy that small second Worker once:
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <a href="https://deploy.workers.cloudflare.com/?url=https://github.com/tecsteps/daemons-run/tree/main/apps-gateway" target="_blank" rel="noreferrer">
              <img src="https://deploy.workers.cloudflare.com/button" alt="Deploy to Cloudflare" height={32} />
            </a>
            <Button variant="secondary" size="sm" onClick={() => void gateway.refetch()}>
              I deployed it
            </Button>
          </div>
        </SectionCard>
      ) : null}
      {apps.isLoading ? (
        <LoadingRows rows={2} />
      ) : list.length === 0 ? (
        <EmptyState
          illustration="app-empty-previews"
          title="No apps exposed yet"
          description={
            <>
              Start an app on a server, then run <code className="font-mono text-ink-900">daemons expose 3000</code> in its folder, or use Expose below.
            </>
          }
        />
      ) : (
        <SectionCard>
          <ul className="flex flex-col divide-y divide-line">
            {list.map((a) => (
              <AppRow key={a.name} app={a} />
            ))}
          </ul>
          <p className="text-caption text-muted">
            Apps share one address with each other. Each app must run under its base path, for example Vite with <code className="font-mono">--base /shop/</code>.
          </p>
        </SectionCard>
      )}
      {online.map((s) => (
        <PortOffers key={s.id} server={s} apps={list} />
      ))}
    </Page>
  );
}
