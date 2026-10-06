// Flow and layout adapted from old daemons-run (tag pre-pivot-2026-09-05)
// resources/js/components/ServerPurchaseForm.tsx and AgentPicker.tsx.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { CopyField } from '@/components/CopyControl';
import { Page, SectionCard } from '@/components/layout/Page';
import { LoadingRows, Notice } from '@/components/Notice';
import { ServerTypePicker } from '@/components/ServerTypePicker';
import { StatusPill } from '@/components/StatusPill';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { api, ApiError } from '@/lib/api';
import { disabledReason, locationLabel, perMonth, priceAt, sizesIn, groups, type Options } from '@/lib/catalog';
import { AGENT_LABELS, type ServerView } from '@/lib/types';
import { cn } from '@/lib/utils';
import { HetznerConnect, useProviders } from '@/pages/settings';

const AGENTS = ['claude', 'codex', 'opencode'] as const;
const AGENT_HINTS: Record<string, string> = {
  claude: "Anthropic's coding agent",
  codex: "OpenAI's coding agent",
  opencode: 'Open source, any model provider',
};

function suggestName(existing: string[]) {
  for (let i = 1; ; i++) if (!existing.includes(`server-${i}`)) return `server-${i}`;
}

function AgentPicker({ value, onChange, error }: { value: string[]; onChange: (v: string[]) => void; error?: string }) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 text-control font-medium text-ink-900">Coding agents to install</legend>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {AGENTS.map((a) => {
          const checked = value.includes(a);
          return (
            <label
              key={a}
              data-testid={`agent-${a}`}
              className={cn(
                'flex min-h-11 cursor-pointer items-start gap-3 rounded-md border p-3',
                checked ? 'border-lime bg-lime-pale ring-1 ring-lime' : 'border-line bg-canvas hover:border-ink-900',
              )}
            >
              <input
                type="checkbox"
                className="mt-0.5 size-4 accent-[#647a00]"
                checked={checked}
                onChange={() => onChange(checked ? value.filter((v) => v !== a) : [...value, a])}
              />
              <span className="flex min-w-0 flex-col">
                <span className="text-control font-medium text-ink-900">{AGENT_LABELS[a]}</span>
                <span className="text-caption text-muted">{AGENT_HINTS[a]}</span>
              </span>
            </label>
          );
        })}
      </div>
      <p className="text-caption text-muted">Installed only. You sign in to each agent yourself in the terminal.</p>
      {error ? <p className="text-caption text-red">{error}</p> : null}
    </fieldset>
  );
}

function NameField({ value, onChange, error }: { value: string; onChange: (v: string) => void; error?: string }) {
  return (
    <label className="flex flex-col gap-1.5 text-control font-medium text-ink-900">
      Server name
      <Input
        value={value}
        maxLength={32}
        onChange={(e) => onChange(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        className="h-11 font-mono"
        data-testid="server-name"
      />
      <span className="text-caption font-normal text-muted">Lowercase letters, digits and dashes, up to 32 characters. It also becomes the hostname.</span>
      {error ? <span className="text-caption font-normal text-red">{error}</span> : null}
    </label>
  );
}

function HetznerForm({ names }: { names: string[] }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const options = useQuery({ queryKey: ['options'], queryFn: () => api<Options>('/providers/hetzner/options'), staleTime: 5 * 60_000 });
  const [name, setName] = useState(() => suggestName(names));
  const [location, setLocation] = useState('');
  const [size, setSize] = useState('');
  const [agents, setAgents] = useState<string[]>(['claude']);
  const [confirming, setConfirming] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);

  const data = options.data;
  useEffect(() => {
    if (!data || location) return;
    const names = data.locations.map((l) => l.name);
    setLocation(names.includes('nbg1') ? 'nbg1' : (names[0] ?? ''));
  }, [data, location]);
  // Default to the cheapest available type in the first group with one.
  useEffect(() => {
    if (!data || !location) return;
    const current = data.sizes.find((s) => s.name === size);
    if (current && !disabledReason(current, location)) return;
    for (const g of groups) {
      const first = sizesIn(data.sizes, g.id, location).find((s) => !disabledReason(s, location));
      if (first) return setSize(first.name);
    }
    setSize('');
  }, [data, location, size]);

  const selected = data?.sizes.find((s) => s.name === size);
  const price = selected ? priceAt(selected, location) : null;
  const loc = data?.locations.find((l) => l.name === location);

  const create = useMutation({
    mutationFn: () => api<{ server: ServerView }>('/servers', { method: 'POST', json: { name, location, size, agents } }),
    onSuccess: ({ server }) => {
      void queryClient.invalidateQueries({ queryKey: ['servers'] });
      navigate(`/servers/${server.id}`);
    },
    onSettled: () => setConfirming(false),
  });
  const fieldError = (field: string) => (create.error instanceof ApiError && create.error.body.field === field ? create.error.message : undefined);

  if (options.isLoading) return <LoadingRows rows={2} />;
  if (options.error) return <Notice onRetry={() => void options.refetch()}>{options.error.message}</Notice>;
  if (!data) return null;

  return (
    <div className="flex flex-col gap-6">
      <Notice tone="info">Hetzner bills your Hetzner account directly. daemons.run does not add any markup.</Notice>
      <NameField value={name} onChange={setName} error={fieldError('name')} />
      <label className="flex flex-col gap-1.5 text-control font-medium text-ink-900">
        Location
        <select
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          className="h-11 rounded-md border border-line bg-canvas px-3 font-sans text-ink-900"
          data-testid="server-location"
        >
          {data.locations.map((l) => (
            <option key={l.name} value={l.name}>
              {locationLabel(l)}
            </option>
          ))}
        </select>
      </label>
      <ServerTypePicker sizes={data.sizes} location={location} selected={size} onSelect={setSize} />
      {fieldError('size') ? <p className="text-caption text-red">{fieldError('size')}</p> : null}
      <AgentPicker value={agents} onChange={setAgents} error={fieldError('agents')} />

      <aside className="rounded-md border border-line bg-surface p-4">
        <h2 className="font-sans text-section font-bold text-ink-900">Summary</h2>
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-body">
          <dt className="text-muted">Type</dt>
          <dd className="font-mono text-ink-900 uppercase">{size || '—'}</dd>
          <dt className="text-muted">Location</dt>
          <dd className="text-ink-900">{loc ? locationLabel(loc) : location}</dd>
          <dt className="text-muted">Agents</dt>
          <dd className="text-ink-900">{agents.map((a) => AGENT_LABELS[a]).join(', ') || '—'}</dd>
          <dt className="text-muted">Monthly</dt>
          <dd className="font-mono text-ink-900">{perMonth(price?.monthly)}</dd>
        </dl>
        {create.error && !fieldError("name") && !fieldError("size") && !fieldError("agents") ? <Notice className="mt-4">{create.error.message}</Notice> : null}
        <Button
          size="cta"
          className="mt-4 w-full"
          disabled={!size || !name || agents.length === 0 || create.isPending}
          onClick={() => setConfirming(true)}
          data-testid="create-server"
        >
          {create.isPending ? 'Ordering…' : `Create server for ${perMonth(price?.monthly)}`}
        </Button>
      </aside>

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            cancelRef.current?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>Confirm your purchase</DialogTitle>
            <DialogDescription asChild>
              <div className="flex flex-col gap-3 text-ink-900">
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-body">
                  <dt className="text-muted">Type</dt>
                  <dd className="font-mono uppercase">{size}</dd>
                  <dt className="text-muted">Location</dt>
                  <dd>{loc ? locationLabel(loc) : location}</dd>
                  <dt className="text-muted">Monthly price</dt>
                  <dd className="font-mono">{perMonth(price?.monthly)}</dd>
                </dl>
                <p className="text-body">
                  Hetzner bills this server to your Hetzner account at the price shown, starting now. Delete it any time to stop the charge.
                </p>
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button ref={cancelRef} variant="secondary" onClick={() => setConfirming(false)} data-testid="purchase-cancel">
              Cancel
            </Button>
            <Button disabled={create.isPending} onClick={() => create.mutate()} data-testid="purchase-confirm">
              {create.isPending ? 'Ordering…' : `Buy for ${perMonth(price?.monthly)}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="flex flex-col gap-2">
        <h2 className="font-sans text-control font-semibold text-ink-900">What happens next</h2>
        <ol className="flex flex-col gap-1 text-body text-muted">
          <li>1. We order the server in your Hetzner account.</li>
          <li>2. It boots Ubuntu 24.04 and runs the daemons.run installer: Docker, Git, your coding agents, a firewall.</li>
          <li>3. The server connects back to this control plane and shows Online, usually within 5 minutes.</li>
        </ol>
      </div>
    </div>
  );
}

function ExistingForm({ names }: { names: string[] }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(() => suggestName(names));
  const [agents, setAgents] = useState<string[]>(['claude']);
  const [result, setResult] = useState<{ server: ServerView; command: string } | null>(null);
  const add = useMutation({
    mutationFn: () => api<{ server: ServerView; command: string }>('/servers/existing', { method: 'POST', json: { name, agents } }),
    onSuccess: (r) => {
      setResult(r);
      void queryClient.invalidateQueries({ queryKey: ['servers'] });
    },
  });
  const live = useQuery({
    queryKey: ['server', result?.server.id],
    queryFn: () => api<{ server: ServerView }>(`/servers/${result!.server.id}`),
    enabled: !!result,
    refetchInterval: 4000,
  });
  if (result) {
    const server = live.data?.server ?? result.server;
    return (
      <div className="flex flex-col gap-4">
        <p className="text-body text-ink-900">
          Run this on your Ubuntu 24.04 machine as a user with sudo. The command works once, for one hour.
        </p>
        <CopyField value={result.command} testId="install-command" />
        <div className="flex flex-wrap items-center gap-3">
          <StatusPill status={server.status} />
          <span className="text-body text-muted">
            {server.status === 'online' ? 'Connected.' : server.install.step ? `Installing: ${server.install.step}` : 'Waiting for the machine to run the command…'}
          </span>
        </div>
        <div>
          <Button asChild variant="secondary">
            <Link to={`/servers/${server.id}`}>Open server page</Link>
          </Button>
        </div>
      </div>
    );
  }
  const fieldError = (field: string) => (add.error instanceof ApiError && add.error.body.field === field ? add.error.message : undefined);
  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        add.mutate();
      }}
    >
      <p className="text-body text-muted">
        Any machine with Ubuntu 24.04 and internet access works: another provider, a home server, a VM. Nothing listens for incoming connections; the
        server connects out to this control plane.
      </p>
      <NameField value={name} onChange={setName} error={fieldError('name')} />
      <AgentPicker value={agents} onChange={setAgents} error={fieldError('agents')} />
      {add.error && !fieldError("name") && !fieldError("agents") ? <Notice>{add.error.message}</Notice> : null}
      <div>
        <Button type="submit" size="cta" disabled={!name || agents.length === 0 || add.isPending} data-testid="add-existing">
          {add.isPending ? 'Preparing…' : 'Get install command'}
        </Button>
      </div>
    </form>
  );
}

export function NewServerPage() {
  const [params, setParams] = useSearchParams();
  const existing = params.get('existing') === '1';
  const providers = useProviders();
  const servers = useQuery({ queryKey: ['servers'], queryFn: () => api<{ servers: ServerView[] }>('/servers') });
  const names = useMemo(() => servers.data?.servers.map((s) => s.name) ?? [], [servers.data]);
  const hetzner = providers.data?.providers.find((p) => p.id === 'hetzner');
  const connected = !!hetzner && !hetzner.needsCredentials;

  return (
    <Page title="New server" crumbs={[{ label: 'Servers', to: '/servers' }, { label: 'New server' }]} width="form">
      <div role="tablist" aria-label="Kind of server" className="grid grid-cols-2 gap-1 rounded-md border border-line bg-surface p-1">
        {[
          { key: false, label: 'Hetzner server' },
          { key: true, label: 'Existing machine' },
        ].map((t) => (
          <button
            key={String(t.key)}
            role="tab"
            type="button"
            aria-selected={existing === t.key}
            onClick={() => setParams(t.key ? { existing: '1' } : {}, { replace: true })}
            className={cn(
              'h-10 rounded-md text-control font-medium phone:h-11',
              existing === t.key ? 'app-segment-active border' : 'text-muted hover:text-ink-900',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      {servers.isLoading || providers.isLoading ? (
        <LoadingRows rows={2} />
      ) : existing ? (
        <ExistingForm names={names} />
      ) : connected ? (
        <HetznerForm names={names} />
      ) : (
        <SectionCard
          title="Connect Hetzner"
          description="Paste an API token of your Hetzner project once. New servers are created and billed in that project."
        >
          <HetznerConnect />
        </SectionCard>
      )}
    </Page>
  );
}
