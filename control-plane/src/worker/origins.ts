import type { Env } from './env';

/**
 * The apps gateway lives next to the control plane: `daemons` → `daemons-apps`,
 * `daemons-dev` → `daemons-apps-dev` on the same workers.dev subdomain (08).
 */
export function appsOrigin(env: Env, controlPlaneUrl: string): string {
  if (env.APPS_ORIGIN) return env.APPS_ORIGIN.replace(/\/$/, '');
  const url = new URL(controlPlaneUrl);
  const [first, ...rest] = url.hostname.split('.');
  const label = first.startsWith('daemons')
    ? `daemons-apps${first.slice('daemons'.length)}`
    : `${first}-apps`;
  return `${url.protocol}//${[label, ...rest].join('.')}${url.port ? `:${url.port}` : ''}`;
}

export function controlPlaneOriginFromApps(env: Env, appsUrl: string): string {
  if (env.CONTROL_PLANE_ORIGIN) return env.CONTROL_PLANE_ORIGIN.replace(/\/$/, '');
  const url = new URL(appsUrl);
  const [first, ...rest] = url.hostname.split('.');
  const label = first.startsWith('daemons-apps')
    ? `daemons${first.slice('daemons-apps'.length)}`
    : first.replace(/-apps$/, '');
  return `${url.protocol}//${[label, ...rest].join('.')}${url.port ? `:${url.port}` : ''}`;
}
