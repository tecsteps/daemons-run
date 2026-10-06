import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/** A small stand-in for the Hetzner Cloud API, for local E2E runs (HETZNER_API_BASE). */
export function startFakeHetzner(port = 8788) {
  const serverTypes = JSON.parse(readFileSync(join(here, 'fixtures', 'hetzner-server-types.json'), 'utf8'));
  const locations = JSON.parse(readFileSync(join(here, 'fixtures', 'hetzner-locations.json'), 'utf8'));
  // Make CX23 orderable in nbg1 so the default path is the cheapest x86 type.
  for (const t of serverTypes.server_types) {
    if (t.name === 'cx23') for (const l of t.locations) if (l.name === 'nbg1') l.available = true;
  }
  const servers = new Map<number, any>();
  const created: any[] = [];
  let next = 1000;
  const http: Server = createServer((req, res) => {
    const url = new URL(req.url!, 'http://x');
    const send = (status: number, body?: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(body === undefined ? '' : JSON.stringify(body));
    };
    if (req.headers.authorization !== 'Bearer good-token') return send(401, { error: { code: 'unauthorized', message: 'unable to authenticate' } });
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const path = url.pathname.replace(/^\/v1/, '');
      if (req.method === 'GET' && path === '/locations') return send(200, locations);
      if (req.method === 'GET' && path === '/server_types') return send(200, serverTypes);
      if (req.method === 'GET' && path === '/ssh_keys') return send(200, { ssh_keys: [] });
      if (req.method === 'POST' && path === '/ssh_keys') return send(201, { ssh_key: { id: 7 } });
      if (req.method === 'POST' && path === '/servers') {
        const input = JSON.parse(body);
        if (input.name === 'quota') return send(403, { error: { code: 'resource_limit_exceeded', message: 'server limit exceeded' } });
        const s = { id: next++, name: input.name, status: 'initializing', public_net: { ipv4: { ip: '203.0.113.10' }, ipv6: { ip: '2001:db8::/64' } }, labels: input.labels };
        servers.set(s.id, s);
        created.push(input);
        return send(201, { server: s });
      }
      const m = /^\/servers\/(\d+)$/.exec(path);
      if (m && req.method === 'GET') {
        const s = servers.get(Number(m[1]));
        if (!s) return send(404, { error: { code: 'not_found', message: 'not found' } });
        s.status = 'running';
        return send(200, { server: s });
      }
      if (m && req.method === 'DELETE') {
        servers.delete(Number(m[1]));
        return send(200, { action: {} });
      }
      if (req.method === 'GET' && path === '/servers') {
        return send(200, { servers: [...servers.values()].filter((s) => s.name === url.searchParams.get('name')) });
      }
      if (/^\/servers\/\d+\/actions\/rebuild$/.test(path)) return send(201, { action: {} });
      send(404, { error: { code: 'not_found', message: `no route ${req.method} ${path}` } });
    });
  });
  http.listen(port);
  return { servers, created, close: () => http.close() };
}
