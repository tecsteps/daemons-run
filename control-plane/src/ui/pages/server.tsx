// Progress view adapted from old daemons-run resources/js/components/daemon/ProvisioningView.tsx
// and ProvisioningChecklist.tsx (step list with the "creating" illustration).
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Circle, FolderOpen, Loader2, RotateCw, SquareTerminal, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { AppIllustration } from '@/components/AppIllustration';
import { ConfirmDestructive } from '@/components/ConfirmDestructive';
import { CopyField } from '@/components/CopyControl';
import { Page, SectionCard } from '@/components/layout/Page';
import { LoadingRows, Notice } from '@/components/Notice';
import { StatusPill } from '@/components/StatusPill';
import { Button } from '@/components/ui/button';
import { api, ApiError } from '@/lib/api';
import { bytes, clockTime, relativeTime, shortDate } from '@/lib/time';
import { AGENT_LABELS, type ServerView } from '@/lib/types';
import { cn } from '@/lib/utils';
import { NotFoundPage } from '@/pages/not-found';

const STUCK_AFTER = 15 * 60_000;

type Step = { label: string; state: 'done' | 'active' | 'todo' | 'failed'; detail?: string };

function steps(s: ServerView): Step[] {
  const hetzner = s.provider === 'hetzner';
  const failed = s.status === 'failed' || s.install.status === 'failed';
  const installing = !!s.install.step;
  const online = s.status === 'online' || s.status === 'offline';
  const list: Step[] = [];
  if (hetzner) {
    list.push({ label: 'Creating at Hetzner', state: s.providerServerId ? 'done' : failed ? 'failed' : 'active' });
    list.push({
      label: 'Booting Ubuntu 24.04',
      state: installing || online ? 'done' : s.providerServerId ? (failed ? 'failed' : 'active') : 'todo',
    });
  } else {
    list.push({ label: 'Run the install command on your machine', state: installing || online ? 'done' : 'active' });
  }
  list.push({
    label: 'Installing Docker, Git, coding agents and the daemons agent',
    state: online ? 'done' : failed && installing ? 'failed' : installing ? 'active' : 'todo',
    detail: !online && s.install.step ? `${s.install.step}${s.install.status === 'failed' ? ' failed' : '…'}` : undefined,
  });
  list.push({ label: 'Connected', state: online ? 'done' : 'todo' });
  return list;
}

function StepIcon({ state }: { state: Step['state'] }) {
  if (state === 'done') return <Check className="size-4 text-green" aria-hidden />;
  if (state === 'active') return <Loader2 className="size-4 animate-spin text-purple" aria-hidden />;
  if (state === 'failed') return <X className="size-4 text-red" aria-hidden />;
  return <Circle className="size-4 text-line" aria-hidden />;
}

function Progress({ server, onRetry, retrying, command }: { server: ServerView; onRetry: () => void; retrying: boolean; command: string | null }) {
  const failed = server.status === 'failed' || server.install.status === 'failed';
  const since = server.install.updatedAt ?? server.createdAt;
  const stuck = !failed && Date.now() - since > STUCK_AFTER;
  return (
    <SectionCard testId="progress">
      <div className="flex flex-col items-center gap-6 md:flex-row md:items-start">
        <AppIllustration name="app-creating" size="md" />
        <ol className="flex w-full min-w-0 flex-col gap-3">
          {steps(server).map((step) => (
            <li key={step.label} className="flex min-w-0 items-start gap-3">
              <span className="mt-0.5">
                <StepIcon state={step.state} />
              </span>
              <span className="min-w-0">
                <span className={cn('block text-control', step.state === 'todo' ? 'text-muted' : 'font-medium text-ink-900')}>{step.label}</span>
                {step.detail ? <span className="block font-mono text-caption text-muted">{step.detail}</span> : null}
              </span>
            </li>
          ))}
        </ol>
      </div>
      {server.status === 'creating' || server.status === 'installing' ? (
        <p className="text-caption text-muted">You can close this page. Creation continues, and this page catches up when you come back.</p>
      ) : null}
      {failed || stuck ? (
        <div className="flex flex-col gap-3">
          <Notice tone={failed ? 'error' : 'warning'}>
            {failed
              ? (server.error ?? 'The installation failed.')
              : `No progress since ${clockTime(since)}. The last installer output is below.`}{' '}
            {server.provider === 'hetzner' ? 'Retry reinstalls the server from scratch.' : 'Retry gives you a new install command.'}
          </Notice>
          {server.install.log ? (
            <pre data-testid="install-log" className="max-h-80 overflow-auto rounded-md bg-ink-950 p-3 font-mono text-caption whitespace-pre-wrap text-bone">
              {server.install.log.split('\n').slice(-50).join('\n')}
            </pre>
          ) : null}
          <div>
            <Button variant="secondary" onClick={onRetry} disabled={retrying} data-testid="retry-install">
              <RotateCw />
              {retrying ? 'Retrying…' : 'Retry install'}
            </Button>
          </div>
        </div>
      ) : null}
      {command ? <CopyField value={command} testId="install-command" /> : null}
    </SectionCard>
  );
}

function Detail({ label, value, mono = false }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-caption text-muted">{label}</dt>
      <dd className={cn('min-w-0 text-body break-words text-ink-900', mono && 'font-mono')}>{value || '—'}</dd>
    </div>
  );
}

export function ServerPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [deleting, setDeleting] = useState(false);
  const [command, setCommand] = useState<string | null>(null);
  const { data, error, isLoading, refetch } = useQuery({
    queryKey: ['server', id],
    queryFn: () => api<{ server: ServerView }>(`/servers/${id}`),
    refetchInterval: (q) => {
      const s = q.state.data?.server.status;
      return s === 'creating' || s === 'installing' ? 3000 : 20_000;
    },
  });
  const retry = useMutation({
    mutationFn: () => api<{ command?: string }>(`/servers/${id}/retry`, { method: 'POST' }),
    onSuccess: (r) => {
      setCommand(r.command ?? null);
      void refetch();
    },
  });
  const remove = useMutation({
    mutationFn: (name: string) => api(`/servers/${id}`, { method: 'DELETE', json: { confirm: name } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['servers'] });
      navigate('/servers');
    },
  });

  if (error instanceof ApiError && error.status === 404) return <NotFoundPage />;
  const server = data?.server;
  const hetzner = server?.provider === 'hetzner';
  const settled = server && (server.status === 'online' || server.status === 'offline');

  return (
    <Page
      title={server?.name ?? 'Server'}
      crumbs={[{ label: 'Servers', to: '/servers' }, { label: server?.name ?? '…' }]}
      status={server ? <StatusPill status={server.status} /> : null}
      description={
        server?.status === 'offline'
          ? `Offline since ${clockTime(server.lastSeenAt)}. Containers and sessions on the server keep running; it reconnects by itself.`
          : server?.status === 'online'
            ? `Last heartbeat ${relativeTime(server.lastSeenAt)}`
            : undefined
      }
      actions={
        server ? (
          <>
            {server.status === 'online' ? (
              <Button asChild>
                <Link to={`/servers/${server.id}/terminal`}>
                  <SquareTerminal />
                  Open terminal
                </Link>
              </Button>
            ) : null}
            {server.status === 'online' ? (
              <Button asChild variant="secondary">
                <Link to={`/servers/${server.id}/files`} data-testid="open-files">
                  <FolderOpen />
                  Files
                </Link>
              </Button>
            ) : null}
            <Button variant="destructive" onClick={() => setDeleting(true)} data-testid="delete-server">
              <Trash2 />
              {hetzner ? 'Delete' : 'Disconnect'}
            </Button>
          </>
        ) : null
      }
    >
      {error && !(error instanceof ApiError && error.status === 404) ? <Notice onRetry={() => void refetch()}>{error.message}</Notice> : null}
      {retry.error ? <Notice>{retry.error.message}</Notice> : null}
      {isLoading || !server ? (
        <LoadingRows rows={2} />
      ) : (
        <>
          {settled ? null : <Progress server={server} onRetry={() => retry.mutate()} retrying={retry.isPending} command={command} />}
          <SectionCard title="Details">
            <dl className="grid grid-cols-2 gap-4 md:grid-cols-3">
              <Detail label="Provider" value={hetzner ? 'Hetzner' : 'Your machine'} />
              {hetzner ? <Detail label="Type" value={server.size?.toUpperCase()} mono /> : null}
              {hetzner ? <Detail label="Location" value={server.location} mono /> : null}
              {hetzner ? <Detail label="Price" value={server.priceMonthly ? `€${Number(server.priceMonthly).toFixed(2)}/month` : null} /> : null}
              <Detail label="IPv4" value={server.ipv4} mono />
              <Detail label="Created" value={shortDate(server.createdAt)} />
              <Detail label="System" value={server.os ? `${server.os} · ${server.arch}` : null} />
              <Detail label="Resources" value={server.cpus ? `${server.cpus} vCPU · ${bytes(server.memoryBytes)} RAM · ${bytes(server.diskBytes)} disk` : null} />
              <Detail label="Agent" value={server.agentVersion} mono />
              <Detail label="Coding agents" value={server.agents.map((a) => AGENT_LABELS[a] ?? a).join(', ')} />
            </dl>
          </SectionCard>
        </>
      )}
      {server ? (
        <ConfirmDestructive
          open={deleting}
          onOpenChange={setDeleting}
          title={hetzner ? `Delete ${server.name}?` : `Disconnect ${server.name}?`}
          description={
            hetzner
              ? 'The server and everything on it is deleted at Hetzner. Billing stops. This cannot be undone.'
              : 'The control plane forgets this machine and revokes its agent credential. Nothing on the machine is deleted.'
          }
          expectedName={server.name}
          confirmLabel={hetzner ? 'Delete server' : 'Disconnect'}
          pending={remove.isPending}
          error={remove.error?.message}
          onConfirm={() => remove.mutate(server.name)}
        />
      ) : null}
    </Page>
  );
}
