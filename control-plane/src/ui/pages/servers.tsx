import { useQuery } from '@tanstack/react-query';
import { Plus, Server, SquareTerminal } from 'lucide-react';
import { Link, useSearchParams } from 'react-router';
import { EmptyState } from '@/components/EmptyState';
import { Eyebrow, Page } from '@/components/layout/Page';
import { LoadingRows, Notice } from '@/components/Notice';
import { StatusPill } from '@/components/StatusPill';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { relativeTime } from '@/lib/time';
import { AGENT_LABELS, type ServerView } from '@/lib/types';

export function useServers() {
  return useQuery({
    queryKey: ['servers'],
    queryFn: () => api<{ servers: ServerView[] }>('/servers'),
    refetchInterval: (q) => (q.state.data?.servers.some((s) => s.status === 'creating' || s.status === 'installing') ? 4000 : 30_000),
  });
}

export function serverSubtitle(s: ServerView) {
  if (s.provider === 'hetzner') return [s.size?.toUpperCase(), s.location].filter(Boolean).join(' · ');
  return s.hostname ? `Your machine · ${s.hostname}` : 'Your machine';
}

function ServerCard({ server }: { server: ServerView }) {
  const ready = server.status === 'online';
  return (
    <article data-testid="server-card" className="flex min-w-0 flex-col gap-4 rounded-md border border-line bg-surface p-4">
      <div className="flex min-w-0 items-start gap-3">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-md border-2 border-ink-900 bg-lime text-ink-900" aria-hidden>
          <Server className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <Link to={`/servers/${server.id}`} className="block truncate font-mono text-card-title font-semibold text-ink-900 hover:underline">
            {server.name}
          </Link>
          <p className="truncate text-body text-muted">{serverSubtitle(server)}</p>
        </div>
        <StatusPill status={server.status} />
      </div>
      <p className="text-body text-muted">
        {server.status === 'offline'
          ? `Last seen ${relativeTime(server.lastSeenAt)}`
          : server.status === 'online'
            ? server.agents.map((a) => AGENT_LABELS[a] ?? a).join(' · ')
            : server.status === 'failed'
              ? (server.error ?? 'Something went wrong.')
              : server.install.step
                ? `Installing: ${server.install.step}`
                : server.provider
                  ? 'Waiting for the server to boot…'
                  : 'Waiting for the install command to run…'}
      </p>
      <div className="flex flex-col gap-2 border-t border-line pt-4">
        <Eyebrow>Terminal</Eyebrow>
        <div className="flex flex-wrap gap-2">
          {ready ? (
            <Button asChild variant="ink" size="sm">
              <Link to={`/servers/${server.id}/terminal`}>
                <SquareTerminal />
                Open terminal
              </Link>
            </Button>
          ) : (
            <Button asChild variant="secondary" size="sm">
              <Link to={`/servers/${server.id}`}>{server.status === 'offline' ? 'Details' : 'Show progress'}</Link>
            </Button>
          )}
        </div>
      </div>
    </article>
  );
}

export function ServersPage() {
  const { data, error, isLoading, refetch } = useServers();
  const [params] = useSearchParams();
  const servers = data?.servers ?? [];
  return (
    <Page title="Servers" description={servers.length ? 'Your machines, their terminals and apps.' : undefined}>
      {params.get('welcome') ? (
        <Notice tone="info">
          Welcome. Add a second device in{' '}
          <Link className="underline" to="/settings">
            Settings
          </Link>{' '}
          so you never get locked out.
        </Notice>
      ) : null}
      {error ? <Notice onRetry={() => void refetch()}>{error.message}</Notice> : null}
      {isLoading ? (
        <LoadingRows />
      ) : servers.length === 0 && !error ? (
        <EmptyState
          illustration="app-empty-daemons"
          title="No servers yet"
          description="Create a Hetzner server in a few clicks, or connect any Ubuntu 24.04 machine you already have."
          action={
            <>
              <Button asChild size="cta">
                <Link to="/servers/new">
                  <Plus className="size-4" />
                  New server
                </Link>
              </Button>
              <Button asChild variant="secondary" size="lg">
                <Link to="/servers/new?existing=1">Add existing server</Link>
              </Button>
            </>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {servers.map((s) => (
            <ServerCard key={s.id} server={s} />
          ))}
        </div>
      )}
    </Page>
  );
}
