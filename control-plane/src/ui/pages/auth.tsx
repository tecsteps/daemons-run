// Layout adapted from old daemons-run resources/js/pages/auth/login.tsx (dark ink surface, mascot at the door).
import { startAuthentication, startRegistration, browserSupportsWebAuthn } from '@simplewebauthn/browser';
import { useQueryClient } from '@tanstack/react-query';
import { KeyRound } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router';
import { AppIllustration } from '@/components/AppIllustration';
import { BrandMark } from '@/components/BrandMark';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api, ApiError } from '@/lib/api';
import { useMe } from '@/router';

function AuthSurface({ title, subtitle, children }: { title: string; subtitle: ReactNode; children: ReactNode }) {
  useEffect(() => {
    document.title = `${title} · daemons.run`;
  }, [title]);
  return (
    <main data-auth-surface="ink" className="flex min-h-dvh flex-col items-center justify-center bg-ink-950 px-4 py-8 text-bone">
      <div className="flex w-full max-w-5xl items-center justify-center gap-12">
        <div className="hidden lg:block" data-theme="dark">
          <AppIllustration name="app-signin" size="lg" />
        </div>
        <div className="surface-ink w-full max-w-md rounded-md border border-white/10 bg-ink-900 p-6 sm:p-8" style={{ backgroundColor: '#11120f' }}>
          <div className="mb-6 flex flex-col items-center gap-3 text-center">
            <BrandMark size={40} />
            <h1 className="font-sans text-section font-bold text-bone">{title}</h1>
            <p className="text-base leading-6 text-bone/70">{subtitle}</p>
          </div>
          {children}
        </div>
      </div>
    </main>
  );
}

function ErrorLine({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="rounded-md border border-red/40 bg-red/10 px-3 py-2 text-sm text-bone">
      {children}
    </p>
  );
}

function isCancel(error: unknown) {
  return error instanceof Error && (error.name === 'NotAllowedError' || error.name === 'AbortError');
}

const unsupported = 'This browser cannot use passkeys. Use a current Safari, Chrome, Edge or Firefox.';

export function LoginPage() {
  const { data: me } = useMe();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const next = params.get('next') ?? '/servers';

  if (me?.authenticated) return <Navigate to={next.startsWith('/') ? next : '/servers'} replace />;
  if (me?.setupOpen) return <Navigate to="/setup" replace />;

  async function signIn() {
    setError(null);
    if (!browserSupportsWebAuthn()) return setError(unsupported);
    setBusy(true);
    try {
      const options = await api<Parameters<typeof startAuthentication>[0]['optionsJSON']>('/auth/options', { method: 'POST' });
      const response = await startAuthentication({ optionsJSON: options });
      await api('/auth/verify', { method: 'POST', json: { response } });
      queryClient.setQueryData(['me'], { authenticated: true, setupOpen: false, setupCodeConfigured: true });
      void queryClient.invalidateQueries();
      // /api/... targets (the app ticket) are server routes, not SPA routes.
      if (next.startsWith('/api/')) window.location.assign(next);
      else navigate(next.startsWith('/') ? next : '/servers', { replace: true });
    } catch (e) {
      if (!isCancel(e)) setError(e instanceof Error ? e.message : 'Sign-in failed. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthSurface title="Sign in to daemons.run" subtitle="Your control plane. Your servers.">
      <div className="flex flex-col gap-4">
        {error ? <ErrorLine>{error}</ErrorLine> : null}
        <Button size="cta" className="w-full" onClick={() => void signIn()} disabled={busy} data-testid="sign-in">
          <KeyRound className="size-4" />
          {busy ? 'Waiting for your passkey…' : 'Sign in with passkey'}
        </Button>
        <p className="text-center text-sm text-bone/60">
          Lost your passkeys? Change the <code className="font-mono text-bone/80">SETUP_CODE</code> secret of this Worker in the Cloudflare
          dashboard, then open <code className="font-mono text-bone/80">/setup</code>.
        </p>
      </div>
    </AuthSurface>
  );
}

export function SetupPage() {
  const { data: me, isLoading } = useMe();
  const queryClient = useQueryClient();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    // The setup link carries the code in the fragment, which never reaches a server log.
    const read = () => {
      const match = /code=([^&]+)/.exec(window.location.hash);
      if (match) {
        setCode(decodeURIComponent(match[1]));
        history.replaceState(null, '', '/setup');
      }
    };
    read();
    window.addEventListener('hashchange', read);
    return () => window.removeEventListener('hashchange', read);
  }, []);

  if (done) return <Navigate to="/servers?welcome=1" replace />;
  if (isLoading || !me) return <main className="min-h-dvh bg-ink-950" />;
  if (!me.setupCodeConfigured) {
    return (
      <AuthSurface title="Set a setup code" subtitle="This control plane has no setup code yet.">
        <p className="text-sm text-bone/70">
          Add a secret named <code className="font-mono text-bone">SETUP_CODE</code> to this Worker (Cloudflare dashboard → Workers → your Worker →
          Settings → Variables and secrets), then reload this page.
        </p>
      </AuthSurface>
    );
  }
  if (!me.setupOpen) return <Navigate to={me.authenticated ? '/servers' : '/login'} replace />;

  async function register() {
    setError(null);
    if (!browserSupportsWebAuthn()) return setError(unsupported);
    setBusy(true);
    try {
      const options = await api<Parameters<typeof startRegistration>[0]['optionsJSON']>('/setup/options', { method: 'POST', json: { code } });
      const response = await startRegistration({ optionsJSON: options });
      await api('/setup/finish', { method: 'POST', json: { code, response } });
      queryClient.setQueryData(['me'], { authenticated: true, setupOpen: false, setupCodeConfigured: true });
      setDone(true);
    } catch (e) {
      if (isCancel(e)) return;
      if (e instanceof ApiError && e.body.code === 'wrong_code') {
        const left = Number(e.body.attemptsLeft);
        setError(`That setup code is not right. ${left} ${left === 1 ? 'attempt' : 'attempts'} left.`);
      } else if (e instanceof ApiError && e.body.code === 'locked') {
        const at = new Date(Number(e.body.retryAt)).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        setError(`Too many wrong codes. Try again after ${at}.`);
      } else {
        setError(e instanceof Error ? e.message : 'Setup failed. Try again.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthSurface title="Claim your control plane" subtitle="Enter the setup code, then create the passkey you will sign in with.">
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void register();
        }}
      >
        <label className="flex flex-col gap-1.5 text-sm font-medium text-bone">
          Setup code
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            className="h-11 border-white/15 bg-ink-950 text-bone"
            data-testid="setup-code"
          />
        </label>
        {error ? <ErrorLine>{error}</ErrorLine> : null}
        <Button type="submit" size="cta" className="w-full" disabled={busy || !code.trim()} data-testid="create-passkey">
          <KeyRound className="size-4" />
          {busy ? 'Waiting for your passkey…' : 'Create passkey'}
        </Button>
        <p className="text-center text-sm text-bone/60">The code is the phrase you chose when deploying, or the one the install script printed.</p>
      </form>
    </AuthSurface>
  );
}

export function AddDevicePage() {
  const queryClient = useQueryClient();
  const [token] = useState(() => /t=([^&]+)/.exec(window.location.hash)?.[1] ?? '');
  const [error, setError] = useState<string | null>(token ? null : 'This link is incomplete. Open the whole link, or scan the code again.');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (token) history.replaceState(null, '', '/add-device');
  }, [token]);
  if (done) return <Navigate to="/servers" replace />;

  async function register() {
    setError(null);
    if (!browserSupportsWebAuthn()) return setError(unsupported);
    setBusy(true);
    try {
      const options = await api<Parameters<typeof startRegistration>[0]['optionsJSON']>('/device/options', { method: 'POST', json: { token } });
      const response = await startRegistration({ optionsJSON: options });
      await api('/device/finish', { method: 'POST', json: { token, response } });
      queryClient.setQueryData(['me'], { authenticated: true, setupOpen: false, setupCodeConfigured: true });
      setDone(true);
    } catch (e) {
      if (!isCancel(e)) setError(e instanceof Error ? e.message : 'The passkey could not be created.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthSurface title="Add this device" subtitle="Create a passkey on this device, so you can sign in here.">
      <div className="flex flex-col gap-4">
        {error ? <ErrorLine>{error}</ErrorLine> : null}
        <Button size="cta" className="w-full" onClick={() => void register()} disabled={busy || !token} data-testid="add-device-passkey">
          <KeyRound className="size-4" />
          {busy ? 'Waiting for your passkey…' : 'Create passkey'}
        </Button>
      </div>
    </AuthSurface>
  );
}
