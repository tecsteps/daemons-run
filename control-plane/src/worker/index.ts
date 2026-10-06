import { WorkerEntrypoint } from 'cloudflare:workers';
import { Hono } from 'hono';
import { accountRoutes, authRoutes, requireSameOrigin, requireSession } from './auth';
import type { Env, HonoEnv } from './env';
import { agentRoutes, installRoute } from './agent-routes';
import { appRoutes, handleAppRequest, ticketRoute } from './apps-proxy';
import { providerRoutes, serverRoutes, settingsRoutes } from './servers';

export { ServerConnection } from './server-connection';
export { KeyVault } from './key-vault';

const app = new Hono<HonoEnv>();

app.onError((error, c) => {
  console.error(error);
  return c.json({ error: 'Something went wrong on the control plane. Try again.' }, 500);
});

app.route('/', installRoute);
app.route('/agent', agentRoutes);
app.route('/', ticketRoute);
app.route('/api', authRoutes);

// Everything else under /api needs the owner session and, for writes, our own origin.
const owner = new Hono<HonoEnv>();
owner.use('*', requireSameOrigin, requireSession);
owner.route('/', accountRoutes);
owner.route('/servers', serverRoutes);
owner.route('/providers', providerRoutes);
owner.route('/settings', settingsRoutes);
owner.route('/apps', appRoutes);
app.route('/api', owner);

app.all('/api/*', (c) => c.json({ error: 'Not found.' }, 404));
app.all('/agent/*', (c) => c.json({ error: 'Not found.' }, 404));
app.all('*', (c) => c.env.ASSETS.fetch(c.req.raw));

export default {
  fetch: app.fetch,
} satisfies ExportedHandler<Env>;

/** Only reachable through the service binding of the apps gateway Worker (08). */
export class AppsGateway extends WorkerEntrypoint<Env> {
  async fetch(request: Request): Promise<Response> {
    return handleAppRequest(request, this.env);
  }
}
