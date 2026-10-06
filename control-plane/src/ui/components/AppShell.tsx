// Adapted from old daemons-run resources/js/components/AppShell.tsx and MobileRecentsBar.tsx
// (layout and classes only: black rail, white canvas, phone top bar and bottom navigation).
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { AppWindow, FolderGit2, LogOut, Monitor, Moon, Plus, Server, Settings, Sun } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router';
import { BrandMark } from '@/components/BrandMark';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { applyThemePreference, currentThemePreference, type ThemePreference } from '@/lib/theme';
import { cn } from '@/lib/utils';
import type { ServerView } from '@/lib/types';

const NAV = [
  { to: '/servers', label: 'Servers', icon: Server },
  { to: '/projects', label: 'Projects', icon: FolderGit2 },
  { to: '/apps', label: 'Apps', icon: AppWindow },
  { to: '/settings', label: 'Settings', icon: Settings },
] as const;

function navClass(active: boolean) {
  return cn(
    'flex h-8 w-full min-w-0 items-center gap-2 rounded-md px-2 font-sans text-control',
    active ? 'bg-lime font-medium text-ink-950' : 'text-bone/80 hover:bg-white/10 hover:text-bone',
  );
}

function ThemeToggle() {
  const [preference, setPreference] = useState<ThemePreference>(currentThemePreference());
  const options = [
    { value: 'system', label: 'System theme', icon: Monitor },
    { value: 'light', label: 'Light theme', icon: Sun },
    { value: 'dark', label: 'Dark theme', icon: Moon },
  ] as const;
  return (
    <div role="radiogroup" aria-label="Theme" data-testid="theme-toggle" className="grid grid-cols-3 gap-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={preference === o.value}
          aria-label={o.label}
          onClick={() => {
            applyThemePreference(o.value);
            setPreference(o.value);
          }}
          className={cn(
            'flex h-8 items-center justify-center rounded-md border text-bone/80 phone:h-11',
            preference === o.value ? 'border-white/20 bg-white/10 text-bone' : 'border-white/10 hover:bg-white/5',
          )}
        >
          <o.icon className="size-4" aria-hidden />
        </button>
      ))}
    </div>
  );
}

function SystemStatus() {
  const { data } = useQuery({
    queryKey: ['servers'],
    queryFn: () => api<{ servers: ServerView[] }>('/servers'),
  });
  const servers = data?.servers ?? [];
  const online = servers.filter((s) => s.status === 'online').length;
  const label = servers.length === 0 ? 'No servers yet' : `${online} of ${servers.length} server${servers.length === 1 ? '' : 's'} online`;
  return (
    <p data-testid="system-status" className="flex items-center gap-2 px-1 font-mono text-caption text-bone/80">
      <span aria-hidden className={cn('size-2 rounded-full', servers.length > 0 && online === servers.length ? 'bg-lime' : online > 0 ? 'bg-amber' : 'bg-bone/40')} />
      {label}
    </p>
  );
}

async function signOut(navigate: (to: string) => void, queryClient: QueryClient) {
  await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
  queryClient.clear();
  queryClient.setQueryData(['me'], { authenticated: false, setupOpen: false, setupCodeConfigured: true });
  navigate('/login');
}

export function AppShell({ children, fill = false }: { children: ReactNode; fill?: boolean }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const location = useLocation();
  const onNewServer = location.pathname === '/servers/new';
  return (
    <div data-authenticated-shell className="flex h-dvh min-h-0 flex-col bg-canvas lg:flex-row">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-60 flex-col bg-ink-950 text-bone lg:flex">
        <Link to="/servers" className="flex h-[4.5rem] shrink-0 items-center gap-2 px-4">
          <BrandMark size={28} />
          <span className="font-mono text-[15px] font-medium tracking-tight">daemons.run</span>
        </Link>
        <nav aria-label="Main" className="flex flex-col gap-1 px-2 pt-4">
          {NAV.map((item) => (
            <NavLink key={item.to} to={item.to} className={({ isActive }) => navClass(isActive)}>
              <item.icon className="size-4 shrink-0" aria-hidden />
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto flex flex-col gap-3 border-t border-white/10 p-3">
          <ThemeToggle />
          <SystemStatus />
          <button
            type="button"
            onClick={() => void signOut(navigate, queryClient)}
            className="flex h-8 items-center gap-2 rounded-md px-1 text-control text-bone/70 hover:bg-white/5 hover:text-bone"
          >
            <LogOut className="size-3.5" aria-hidden />
            Sign out
          </button>
        </div>
      </aside>

      <header className={cn('fixed inset-x-0 top-0 isolate z-30 flex h-14 items-center justify-between bg-ink-950 px-3 text-bone lg:hidden', fill && 'phone:hidden')}>
        <Link to="/servers" className="flex min-h-11 min-w-11 items-center gap-2 rounded-md">
          <BrandMark size={28} />
          <span className="font-mono text-[15px] font-medium tracking-tight">daemons.run</span>
        </Link>
        {onNewServer ? null : (
          <Link
            to="/servers/new"
            aria-label="New server"
            className="inline-flex h-11 w-11 items-center justify-center rounded-md border-2 border-ink-900 bg-lime text-ink-900 hover:bg-lime/90"
          >
            <Plus className="size-4" />
          </Link>
        )}
      </header>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-canvas lg:pl-60">
        {fill ? null : (
          <header className="hidden h-[4.5rem] shrink-0 items-center justify-end border-b border-line bg-canvas px-8 lg:flex">
            {onNewServer ? null : (
              <Button asChild size="cta">
                <Link to="/servers/new">
                  <Plus className="size-4" />
                  New server
                </Link>
              </Button>
            )}
          </header>
        )}
        <main
          className={cn(
            'relative min-h-0 max-w-full min-w-0 flex-1 bg-canvas',
            fill
              ? 'flex flex-col overflow-hidden pt-14 pb-[var(--app-bottom-nav-height)] phone:pt-0 phone:pb-0 lg:pt-0 lg:pb-0'
              : 'overflow-y-auto px-4 pt-[4.5rem] pb-[calc(var(--app-bottom-nav-height)+1rem)] lg:px-8 lg:pt-8 lg:pb-8',
          )}
        >
          {children}
        </main>
        <nav
          aria-label="Main"
          data-mobile-nav
          className={cn(
            'fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-white/10 bg-ink-950 px-2 pt-1.5 pb-[calc(env(safe-area-inset-bottom,0px)+0.375rem)] text-bone lg:hidden',
            fill && 'phone:hidden',
          )}
        >
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                cn('flex min-h-14 flex-col items-center justify-center gap-1 rounded-md text-caption', isActive ? 'text-lime' : 'text-bone/70 hover:text-bone')
              }
            >
              <item.icon className="size-5" aria-hidden />
              {item.label}
            </NavLink>
          ))}
          <button
            type="button"
            onClick={() => void signOut(navigate, queryClient)}
            className="flex min-h-14 flex-col items-center justify-center gap-1 rounded-md text-caption text-bone/70 hover:text-bone"
          >
            <LogOut className="size-5" aria-hidden />
            Sign out
          </button>
        </nav>
      </div>
    </div>
  );
}
