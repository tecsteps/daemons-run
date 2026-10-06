import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { createBrowserRouter, Navigate, Outlet, useLocation, useNavigate } from 'react-router';
import { AppShell } from '@/components/AppShell';
import { api } from '@/lib/api';
import type { Me } from '@/lib/types';
import { LoginPage, SetupPage } from '@/pages/auth';
import { NotFoundPage } from '@/pages/not-found';
import { ServersPage } from '@/pages/servers';
import { ProjectsPage } from '@/pages/projects';
import { AppsPage } from '@/pages/apps';
import { SettingsPage } from '@/pages/settings';
import { NewServerPage } from '@/pages/new-server';
import { ServerPage } from '@/pages/server';
import { TerminalPage } from '@/pages/terminal';

export function useMe() {
  return useQuery({ queryKey: ['me'], queryFn: () => api<Me>('/me'), staleTime: 60_000 });
}

/** Owner pages: signed-out visitors go to sign-in (or setup while it is open). */
function RequireOwner({ fill = false }: { fill?: boolean }) {
  const { data, isLoading } = useMe();
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  useEffect(() => {
    const onSignedOut = () => {
      queryClient.setQueryData(['me'], (old: Me | undefined) => ({ ...(old ?? { setupOpen: false, setupCodeConfigured: true }), authenticated: false }));
      navigate(`/login?next=${encodeURIComponent(location.pathname)}`);
    };
    window.addEventListener('daemons:signed-out', onSignedOut);
    return () => window.removeEventListener('daemons:signed-out', onSignedOut);
  }, [location.pathname, navigate, queryClient]);
  if (isLoading || !data) return <div className="h-dvh bg-canvas" />;
  if (!data.authenticated) {
    return <Navigate to={data.setupOpen ? `/setup${location.hash}` : `/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  }
  return (
    <AppShell fill={fill}>
      <Outlet />
    </AppShell>
  );
}

export const router = createBrowserRouter([
  { path: '/setup', element: <SetupPage /> },
  { path: '/login', element: <LoginPage /> },
  {
    element: <RequireOwner />,
    children: [
      { path: '/', element: <Navigate to="/servers" replace /> },
      { path: '/servers', element: <ServersPage /> },
      { path: '/servers/new', element: <NewServerPage /> },
      { path: '/servers/:id', element: <ServerPage /> },
      { path: '/projects', element: <ProjectsPage /> },
      { path: '/apps', element: <AppsPage /> },
      { path: '/settings', element: <SettingsPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
  {
    element: <RequireOwner fill />,
    children: [{ path: '/servers/:id/terminal', element: <TerminalPage /> }],
  },
]);
