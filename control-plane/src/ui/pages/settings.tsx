import { startRegistration } from '@simplewebauthn/browser';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, KeyRound, Monitor, Moon, Pencil, Sun, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { ConfirmDestructive } from '@/components/ConfirmDestructive';
import { Page, SectionCard } from '@/components/layout/Page';
import { Notice } from '@/components/Notice';
import { StatusPill } from '@/components/StatusPill';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { applyThemePreference, currentThemePreference, type ThemePreference } from '@/lib/theme';
import { relativeTime, shortDate } from '@/lib/time';
import { cn } from '@/lib/utils';

type Passkey = { id: string; name: string; created_at: number; last_used_at: number | null };
type SessionRow = { id: string; user_agent: string | null; created_at: number; last_seen_at: number; passkey_name: string | null };
type ProviderRow = { id: string; label: string; createdAt: number; needsCredentials: boolean };

function Passkeys() {
  const qc = useQueryClient();
  const { data, error, refetch } = useQuery({ queryKey: ['passkeys'], queryFn: () => api<{ passkeys: Passkey[] }>('/passkeys') });
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [deleting, setDeleting] = useState<Passkey | null>(null);
  const passkeys = data?.passkeys ?? [];

  async function add() {
    setAddError(null);
    setAdding(true);
    try {
      const options = await api<Parameters<typeof startRegistration>[0]['optionsJSON']>('/passkeys/options', { method: 'POST' });
      const response = await startRegistration({ optionsJSON: options });
      await api('/passkeys', { method: 'POST', json: { response } });
      await qc.invalidateQueries({ queryKey: ['passkeys'] });
    } catch (e) {
      if (!(e instanceof Error && (e.name === 'NotAllowedError' || e.name === 'AbortError'))) {
        setAddError(e instanceof Error ? e.message : 'The passkey could not be added.');
      }
    } finally {
      setAdding(false);
    }
  }

  const rename = useMutation({
    mutationFn: (p: { id: string; name: string }) => api(`/passkeys/${encodeURIComponent(p.id)}`, { method: 'PATCH', json: { name: p.name } }),
    onSuccess: () => {
      setEditing(null);
      void qc.invalidateQueries({ queryKey: ['passkeys'] });
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/passkeys/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    onSuccess: () => {
      setDeleting(null);
      void qc.invalidateQueries({ queryKey: ['passkeys'] });
      void qc.invalidateQueries({ queryKey: ['sessions'] });
    },
  });

  return (
    <SectionCard
      testId="passkeys"
      title="Passkeys"
      description={passkeys.length === 1 ? 'Add a second device (your phone, for example) so you never get locked out.' : 'Each device you can sign in with.'}
      actions={
        <Button variant={passkeys.length === 1 ? 'primary' : 'secondary'} size="sm" onClick={() => void add()} disabled={adding} data-testid="add-passkey">
          <KeyRound />
          {adding ? 'Waiting…' : 'Add passkey'}
        </Button>
      }
    >
      {error ? <Notice onRetry={() => void refetch()}>{error.message}</Notice> : null}
      {addError ? <Notice>{addError}</Notice> : null}
      <ul className="flex flex-col divide-y divide-line">
        {passkeys.map((p) => (
          <li key={p.id} className="flex min-w-0 flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0">
            {editing === p.id ? (
              <form
                className="flex min-w-0 flex-1 items-center gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  rename.mutate({ id: p.id, name });
                }}
              >
                <Input value={name} onChange={(e) => setName(e.target.value)} className="h-9 min-w-0 flex-1" autoFocus maxLength={64} />
                <Button type="submit" size="icon-sm" aria-label="Save name">
                  <Check />
                </Button>
              </form>
            ) : (
              <div className="min-w-0 flex-1">
                <p className="truncate text-control font-medium text-ink-900">{p.name}</p>
                <p className="text-caption text-muted">
                  Added {shortDate(p.created_at)} · last used {relativeTime(p.last_used_at)}
                </p>
              </div>
            )}
            {editing === p.id ? null : (
              <div className="flex gap-1">
                <Button
                  variant="quiet"
                  size="icon-sm"
                  aria-label={`Rename ${p.name}`}
                  onClick={() => {
                    setEditing(p.id);
                    setName(p.name);
                  }}
                >
                  <Pencil />
                </Button>
                <Button variant="quiet" size="icon-sm" aria-label={`Delete ${p.name}`} disabled={passkeys.length < 2} onClick={() => setDeleting(p)}>
                  <Trash2 />
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>
      <ConfirmDestructive
        open={!!deleting}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Delete passkey?"
        description={`${deleting?.name ?? ''} can no longer sign in, and its sessions end now.`}
        pending={remove.isPending}
        error={remove.error?.message}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
      />
    </SectionCard>
  );
}

function Sessions() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['sessions'], queryFn: () => api<{ current: string; sessions: SessionRow[] }>('/sessions') });
  const revoke = useMutation({
    mutationFn: (id: string) => api(`/sessions/${id}`, { method: 'DELETE' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['sessions'] }),
  });
  return (
    <SectionCard title="Sessions" description="Browsers signed in to this control plane.">
      <ul className="flex flex-col divide-y divide-line">
        {(data?.sessions ?? []).map((s) => (
          <li key={s.id} className="flex min-w-0 items-center gap-3 py-3 first:pt-0 last:pb-0">
            <div className="min-w-0 flex-1">
              <p className="truncate text-control font-medium text-ink-900">
                {s.passkey_name ?? 'Unknown device'}
                {s.id === data?.current ? <span className="ml-2 text-caption font-normal text-lime-deep">This browser</span> : null}
              </p>
              <p className="text-caption text-muted">Active {relativeTime(s.last_seen_at)}</p>
            </div>
            {s.id === data?.current ? null : (
              <Button variant="secondary" size="sm" onClick={() => revoke.mutate(s.id)}>
                Sign out
              </Button>
            )}
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}

export function useProviders() {
  return useQuery({ queryKey: ['providers'], queryFn: () => api<{ providers: ProviderRow[] }>('/providers') });
}

export function HetznerConnect({ onConnected, compact = false }: { onConnected?: () => void; compact?: boolean }) {
  const qc = useQueryClient();
  const [token, setToken] = useState('');
  const save = useMutation({
    mutationFn: () => api('/providers/hetzner', { method: 'PUT', json: { token } }),
    onSuccess: () => {
      setToken('');
      void qc.invalidateQueries({ queryKey: ['providers'] });
      void qc.invalidateQueries({ queryKey: ['options'] });
      onConnected?.();
    },
  });
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <label className="flex flex-col gap-1.5 text-control font-medium text-ink-900">
        Hetzner API token
        <Input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          autoComplete="off"
          spellCheck={false}
          placeholder="Paste a Read & Write token"
          className="h-11 font-mono"
          data-testid="hetzner-token"
        />
      </label>
      {compact ? null : (
        <p className="text-caption text-muted">
          In the{' '}
          <a className="underline" href="https://console.hetzner.cloud/" target="_blank" rel="noreferrer">
            Hetzner Console
          </a>
          : open a project → Security → API tokens → Generate API token, with Read & Write. The token is stored encrypted and never shown again.
        </p>
      )}
      {save.error ? <Notice>{save.error.message}</Notice> : null}
      <div>
        <Button type="submit" disabled={!token.trim() || save.isPending} data-testid="connect-hetzner">
          {save.isPending ? 'Checking the token…' : 'Connect Hetzner'}
        </Button>
      </div>
    </form>
  );
}

function Providers() {
  const qc = useQueryClient();
  const { data } = useProviders();
  const hetzner = data?.providers.find((p) => p.id === 'hetzner');
  const [replacing, setReplacing] = useState(false);
  const remove = useMutation({
    mutationFn: () => api('/providers/hetzner', { method: 'DELETE' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['providers'] }),
  });
  return (
    <SectionCard
      testId="providers"
      title="Hetzner"
      description="Servers are created in your own Hetzner account and billed there. daemons.run adds no markup."
      actions={hetzner && !hetzner.needsCredentials ? <StatusPill status="online" label={`Connected · added ${shortDate(hetzner.createdAt)}`} /> : null}
    >
      {hetzner?.needsCredentials ? <Notice tone="warning">The stored token can no longer be read. Paste it again to keep creating servers.</Notice> : null}
      {!hetzner || hetzner.needsCredentials || replacing ? (
        <HetznerConnect onConnected={() => setReplacing(false)} />
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={() => setReplacing(true)}>
            Replace token
          </Button>
          <Button variant="destructive" size="sm" onClick={() => remove.mutate()}>
            Disconnect
          </Button>
        </div>
      )}
    </SectionCard>
  );
}

function SshKey() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['ssh-key'], queryFn: () => api<{ publicKey: string | null }>('/settings/ssh-key') });
  const [value, setValue] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (publicKey: string) => api('/settings/ssh-key', { method: 'PUT', json: { publicKey } }),
    onSuccess: () => {
      setValue(null);
      void qc.invalidateQueries({ queryKey: ['ssh-key'] });
    },
  });
  const current = value ?? data?.publicKey ?? '';
  return (
    <SectionCard
      title="SSH key"
      description={
        data?.publicKey
          ? 'New servers accept this key for root over SSH.'
          : 'Optional. Without a key, password login is turned off: you reach your servers through the browser terminal.'
      }
    >
      <textarea
        value={current}
        onChange={(e) => setValue(e.target.value)}
        rows={3}
        spellCheck={false}
        placeholder="ssh-ed25519 AAAA… you@laptop"
        className="w-full rounded-md border border-line bg-canvas p-3 font-mono text-caption text-ink-900"
      />
      {save.error ? <Notice>{save.error.message}</Notice> : null}
      <div className="flex gap-2">
        <Button size="sm" disabled={value === null || save.isPending} onClick={() => save.mutate(current)}>
          Save key
        </Button>
        {data?.publicKey ? (
          <Button size="sm" variant="secondary" onClick={() => save.mutate('')}>
            Remove
          </Button>
        ) : null}
      </div>
    </SectionCard>
  );
}

function Appearance() {
  const [preference, setPreference] = useState<ThemePreference>(currentThemePreference());
  const options = [
    { value: 'system', label: 'System', icon: Monitor },
    { value: 'light', label: 'Light', icon: Sun },
    { value: 'dark', label: 'Dark', icon: Moon },
  ] as const;
  return (
    <SectionCard title="Appearance">
      <div role="radiogroup" aria-label="Theme" className="grid max-w-sm grid-cols-3 gap-2">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={preference === o.value}
            onClick={() => {
              applyThemePreference(o.value);
              setPreference(o.value);
            }}
            className={cn(
              'flex h-11 items-center justify-center gap-2 rounded-md border text-control',
              preference === o.value ? 'app-selected' : 'border-line bg-canvas text-ink-900 hover:bg-surface',
            )}
          >
            <o.icon className="size-4" aria-hidden />
            {o.label}
          </button>
        ))}
      </div>
    </SectionCard>
  );
}

export function SettingsPage() {
  return (
    <Page title="Settings" width="form">
      <Passkeys />
      <Providers />
      <SshKey />
      <Sessions />
      <Appearance />
    </Page>
  );
}
