import { DurableObject } from 'cloudflare:workers';
import { now } from './crypto';
import type { Env } from './env';
import { appsOrigin } from './origins';
import { exposeApp, listApps, unexposeApp } from './apps';

/** One Durable Object per server: holds the agent socket and relays browsers to it (agent/PROTOCOL.md). */

export const KIND_TERMINAL = 0x01;
export const KIND_HTTP = 0x02;
export const KIND_WS_TEXT = 0x03;
export const KIND_WS_BINARY = 0x04;

const REQUEST_TIMEOUT = 30_000;
const ACK_WINDOW = 1024 * 1024;
const HEARTBEAT_STALE = 90_000;

type Attachment =
  | { role: 'agent'; connectedAt: number; registered: boolean }
  | { role: 'terminal'; channel: number; session: string; sessionId: string }
  | { role: 'appws'; channel: number };

type Reply = { id: string; ok: boolean; error?: { code: string; message: string }; [key: string]: unknown };

export class AgentError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

type HttpStream = {
  resolve: (response: Response) => void;
  reject: (error: AgentError) => void;
  controller?: ReadableStreamDefaultController<Uint8Array>;
  unacked: number;
  publicBase: string;
  port: number;
  started: boolean;
};

export function frame(kind: number, channel: number, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(5 + payload.byteLength);
  out[0] = kind;
  new DataView(out.buffer).setUint32(1, channel);
  out.set(payload, 5);
  return out;
}

export function parseFrame(data: ArrayBuffer): { kind: number; channel: number; payload: Uint8Array } {
  const view = new DataView(data);
  return { kind: view.getUint8(0), channel: view.getUint32(1), payload: new Uint8Array(data, 5) };
}

export class ServerConnection extends DurableObject<Env> {
  private pending = new Map<string, { resolve: (r: Reply) => void; timer: ReturnType<typeof setTimeout> }>();
  private http = new Map<number, HttpStream>();
  private requestSeq = 0;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  // --- state helpers -------------------------------------------------------------------

  private agentSocket(): WebSocket | null {
    for (const ws of this.ctx.getWebSockets('agent')) {
      const a = ws.deserializeAttachment() as Attachment;
      if (a?.role === 'agent' && a.registered) return ws;
    }
    return null;
  }

  private async nextChannel(): Promise<number> {
    const next = ((await this.ctx.storage.get<number>('channel')) ?? 0) + 1;
    await this.ctx.storage.put('channel', next);
    return next;
  }

  private serverId(): Promise<string | undefined> {
    return this.ctx.storage.get<string>('serverId');
  }

  private sendJson(ws: WebSocket, message: unknown) {
    ws.send(JSON.stringify(message));
  }

  /** Sends a request to the agent and waits for its reply. */
  async request(type: string, params: Record<string, unknown> = {}, timeoutMs = REQUEST_TIMEOUT): Promise<Reply> {
    const agent = this.agentSocket();
    if (!agent) throw new AgentError('offline', 'The server is offline.');
    const id = `c${Date.now().toString(36)}${(this.requestSeq++).toString(36)}`;
    return new Promise<Reply>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        this.sendJson(agent, { type: 'cancel', id });
        reject(new AgentError('timeout', 'The server did not answer in time.'));
      }, timeoutMs);
      this.pending.set(id, {
        timer,
        resolve: (reply) => {
          clearTimeout(timer);
          this.pending.delete(id);
          if (reply.ok) resolve(reply);
          else reject(new AgentError(reply.error?.code ?? 'internal', reply.error?.message ?? 'The server reported an error.'));
        },
      });
      this.sendJson(agent, { id, type, ...params });
    });
  }

  async status(): Promise<{ connected: boolean; connectedAt: number | null; lastHeartbeat: number | null }> {
    const agent = this.agentSocket();
    if (!agent) return { connected: false, connectedAt: null, lastHeartbeat: null };
    const attachment = agent.deserializeAttachment() as Extract<Attachment, { role: 'agent' }>;
    const beat = this.ctx.getWebSocketAutoResponseTimestamp(agent)?.getTime() ?? attachment.connectedAt;
    return { connected: now() - beat < HEARTBEAT_STALE, connectedAt: attachment.connectedAt, lastHeartbeat: beat };
  }

  /** Disconnect: closes the agent socket (its credential is revoked by the caller). */
  async disconnectAgent(reason: string) {
    for (const ws of this.ctx.getWebSockets('agent')) ws.close(4003, reason);
    this.closeBrowsers(4001, 'Server disconnected.');
  }

  async closeBrowserSessions(sessionIds: string[]) {
    for (const ws of this.ctx.getWebSockets('terminal')) {
      const a = ws.deserializeAttachment() as Attachment;
      if (a.role === 'terminal' && sessionIds.includes(a.sessionId)) ws.close(4401, 'Signed out.');
    }
  }

  private closeBrowsers(code: number, reason: string) {
    for (const tag of ['terminal', 'appws']) {
      for (const ws of this.ctx.getWebSockets(tag)) {
        try {
          ws.close(code, reason);
        } catch {}
      }
    }
    for (const [channel, stream] of this.http) {
      this.failHttp(channel, stream, new AgentError('offline', reason));
    }
  }

  // --- fetch: agent connect, terminal attach, app proxy ----------------------------------

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    switch (url.pathname) {
      case '/agent':
        return this.acceptAgent(request);
      case '/terminal':
        return this.attachTerminal(request, url);
      case '/app':
        return this.proxyApp(request).catch(
          (error: unknown) =>
            new Response(error instanceof Error ? error.message : 'Proxy error', {
              status: 502,
              headers: { 'X-Daemons-Error': error instanceof AgentError ? error.code : 'internal' },
            }),
        );
      default:
        return new Response('Not found', { status: 404 });
    }
  }

  private async acceptAgent(request: Request): Promise<Response> {
    await this.ctx.storage.put('serverId', request.headers.get('X-Daemons-Server-Id')!);
    await this.ctx.storage.put('origin', request.headers.get('X-Daemons-Origin')!);
    for (const old of this.ctx.getWebSockets('agent')) old.close(4000, 'Replaced by a new connection.');
    this.closeBrowsers(4001, 'Agent reconnected.');
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1], ['agent']);
    pair[1].serializeAttachment({ role: 'agent', connectedAt: now(), registered: false } satisfies Attachment);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  private async attachTerminal(request: Request, url: URL): Promise<Response> {
    if (!this.agentSocket()) return new Response('The server is offline.', { status: 503 });
    const session = url.searchParams.get('session')!;
    const channel = await this.nextChannel();
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1], ['terminal', `ch:${channel}`]);
    pair[1].serializeAttachment({
      role: 'terminal',
      channel,
      session,
      sessionId: request.headers.get('X-Daemons-Session')!,
    } satisfies Attachment);
    const params: Record<string, unknown> = {
      channel,
      session,
      cols: Number(url.searchParams.get('cols') ?? 80),
      rows: Number(url.searchParams.get('rows') ?? 24),
    };
    if (url.searchParams.get('cwd')) params.cwd = url.searchParams.get('cwd');
    if (url.searchParams.get('command')) params.command = url.searchParams.get('command');
    const browser = pair[1];
    this.ctx.waitUntil(
      this.request('terminal.open', params).then(
        (reply) => this.sendJson(browser, { type: 'opened', created: reply.created ?? false }),
        (error: AgentError) => browser.close(4004, error.message.slice(0, 120)),
      ),
    );
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  // --- WebSocket events ----------------------------------------------------------------

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    const a = ws.deserializeAttachment() as Attachment;
    if (a.role === 'agent') return this.onAgentMessage(ws, a, message);
    const agent = this.agentSocket();
    if (a.role === 'terminal') {
      if (!agent) return ws.close(4001, 'The server is offline.');
      if (typeof message === 'string') {
        const msg = JSON.parse(message) as { type: string; cols?: number; rows?: number; t?: number };
        if (msg.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong', t: msg.t }));
          return;
        }
        if (msg.type === 'resize') {
          this.sendJson(agent, { id: `c-r${a.channel}-${now()}`, type: 'terminal.resize', channel: a.channel, cols: msg.cols, rows: msg.rows });
        }
        return;
      }
      agent.send(frame(KIND_TERMINAL, a.channel, new Uint8Array(message)));
      return;
    }
    if (a.role === 'appws') {
      if (!agent) return ws.close(1011, 'The server is offline.');
      const payload = typeof message === 'string' ? new TextEncoder().encode(message) : new Uint8Array(message);
      agent.send(frame(typeof message === 'string' ? KIND_WS_TEXT : KIND_WS_BINARY, a.channel, payload));
    }
  }

  async webSocketClose(ws: WebSocket, code: number) {
    const a = ws.deserializeAttachment() as Attachment;
    if (a.role === 'agent') {
      // Only the current socket marks the server offline; a replaced one does not.
      if (code !== 4000 && a.registered) {
        this.closeBrowsers(4001, 'The server disconnected.');
        await this.markDisconnected();
      }
      return;
    }
    const agent = this.agentSocket();
    if (!agent) return;
    if (a.role === 'terminal') {
      this.sendJson(agent, { id: `c-x${a.channel}`, type: 'terminal.close', channel: a.channel });
    } else if (a.role === 'appws') {
      this.sendJson(agent, { type: 'ws.close', channel: a.channel, code: 1000, reason: '' });
    }
  }

  async webSocketError(ws: WebSocket) {
    await this.webSocketClose(ws, 1011);
  }

  private async markDisconnected() {
    const serverId = await this.serverId();
    if (!serverId) return;
    await this.env.DB.prepare('UPDATE servers SET connected = 0, last_seen_at = ? WHERE id = ?').bind(now(), serverId).run();
  }

  private async onAgentMessage(ws: WebSocket, a: Extract<Attachment, { role: 'agent' }>, message: string | ArrayBuffer) {
    if (typeof message !== 'string') {
      const { kind, channel, payload } = parseFrame(message);
      if (kind === KIND_TERMINAL) {
        for (const browser of this.ctx.getWebSockets(`ch:${channel}`)) browser.send(payload);
      } else if (kind === KIND_HTTP) {
        this.onHttpData(channel, payload);
      } else if (kind === KIND_WS_TEXT || kind === KIND_WS_BINARY) {
        for (const browser of this.ctx.getWebSockets(`ch:${channel}`)) {
          browser.send(kind === KIND_WS_TEXT ? new TextDecoder().decode(payload) : payload);
        }
      }
      return;
    }
    const msg = JSON.parse(message) as Record<string, unknown> & { id?: string; type?: string; ok?: boolean };
    if (msg.id && 'ok' in msg) {
      this.pending.get(msg.id)?.resolve(msg as Reply);
      return;
    }
    if (msg.id && msg.type) {
      const reply = await this.onAgentRequest(ws, a, msg as { id: string; type: string } & Record<string, unknown>).catch(
        (error: unknown): Record<string, unknown> => ({
          ok: false,
          error: error instanceof AgentError ? { code: error.code, message: error.message } : { code: 'internal', message: String(error) },
        }),
      );
      this.sendJson(ws, { id: msg.id, ...reply });
      return;
    }
    this.onAgentEvent(msg);
  }

  private async onAgentRequest(
    ws: WebSocket,
    a: Extract<Attachment, { role: 'agent' }>,
    msg: { id: string; type: string } & Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const serverId = (await this.serverId())!;
    switch (msg.type) {
      case 'register': {
        if (msg.protocol !== 1) throw new AgentError('unsupported', 'Protocol version not supported.');
        const row = await this.env.DB.prepare(
          `UPDATE servers SET connected = 1, last_seen_at = ?, agent_version = ?, hostname = ?, os = ?, arch = ?, cpus = ?,
             memory_bytes = ?, disk_bytes = ?, status = 'online', install_status = 'done', error = NULL
           WHERE id = ? RETURNING name`,
        )
          .bind(now(), msg.agent_version ?? null, msg.hostname ?? null, msg.os ?? null, msg.arch ?? null, msg.cpus ?? null,
            msg.memory_bytes ?? null, msg.disk_bytes ?? null, serverId)
          .first<{ name: string }>();
        if (!row) throw new AgentError('not_found', 'This server was removed from the control plane.');
        ws.serializeAttachment({ ...a, registered: true });
        return { ok: true, server_id: serverId, name: row.name };
      }
      case 'app.expose': {
        const origin = (await this.ctx.storage.get<string>('origin'))!;
        const app = await exposeApp(this.env, serverId, {
          name: String(msg.name ?? ''),
          port: Number(msg.port),
          cwd: msg.cwd ? String(msg.cwd) : null,
          public: msg.public === true,
        });
        return { ok: true, url: `${appsOrigin(this.env, origin)}/${app.name}/`, public: app.public };
      }
      case 'app.unexpose':
        await unexposeApp(this.env, serverId, String(msg.name ?? ''));
        return { ok: true };
      case 'app.list': {
        const origin = (await this.ctx.storage.get<string>('origin'))!;
        const apps = await listApps(this.env, serverId);
        return {
          ok: true,
          apps: apps.map((app) => ({ name: app.name, port: app.port, public: !!app.public, url: `${appsOrigin(this.env, origin)}/${app.name}/` })),
        };
      }
      default:
        throw new AgentError('unsupported', `Unknown request ${msg.type}.`);
    }
  }

  private onAgentEvent(msg: Record<string, unknown>) {
    const channel = Number(msg.channel);
    switch (msg.type) {
      case 'terminal.exit':
        // A detach from inside tmux is not the end of the session: the browser reattaches.
        for (const browser of this.ctx.getWebSockets(`ch:${channel}`)) {
          if (msg.session_ended === false) browser.close(4003, 'Detached.');
          else browser.close(4002, 'The session ended.');
        }
        break;
      case 'http.response':
        this.onHttpResponse(channel, msg.status as number, msg.headers as [string, string][]);
        break;
      case 'http.end': {
        const stream = this.http.get(channel);
        if (stream?.controller) stream.controller.close();
        this.http.delete(channel);
        break;
      }
      case 'http.error': {
        const stream = this.http.get(channel);
        if (stream) this.failHttp(channel, stream, new AgentError(String(msg.code ?? 'internal'), String(msg.message ?? '')));
        break;
      }
      case 'ws.close':
        for (const browser of this.ctx.getWebSockets(`ch:${channel}`)) {
          const code = Number(msg.code) || 1000;
          browser.close(code === 1005 || code === 1006 ? 1000 : code, String(msg.reason ?? ''));
        }
        break;
    }
  }

  // --- HTTP proxy for apps (08) --------------------------------------------------------

  private async proxyApp(request: Request): Promise<Response> {
    const agent = this.agentSocket();
    const port = Number(request.headers.get('X-Daemons-App-Port'));
    const publicBase = request.headers.get('X-Daemons-Public-Base')!;
    const path = request.headers.get('X-Daemons-Path')!;
    if (!agent) throw new AgentError('offline', 'The server is offline.');
    const headers: [string, string][] = [];
    request.headers.forEach((value, name) => {
      if (!name.startsWith('x-daemons-') && !['host', 'cf-connecting-ip', 'cf-ray', 'cf-visitor', 'cf-ipcountry', 'cdn-loop'].includes(name)) {
        headers.push([name, value]);
      }
    });
    const channel = await this.nextChannel();

    if (request.headers.get('Upgrade')?.toLowerCase() === 'websocket') {
      const protocols = (request.headers.get('Sec-WebSocket-Protocol') ?? '').split(',').map((p) => p.trim()).filter(Boolean);
      const reply = await this.request('ws.open', {
        channel,
        port,
        path,
        headers: headers.filter(([n]) => !n.startsWith('sec-websocket') && !['upgrade', 'connection'].includes(n)),
        protocols,
      });
      const pair = new WebSocketPair();
      this.ctx.acceptWebSocket(pair[1], ['appws', `ch:${channel}`]);
      pair[1].serializeAttachment({ role: 'appws', channel } satisfies Attachment);
      const responseHeaders = new Headers();
      if (reply.protocol) responseHeaders.set('Sec-WebSocket-Protocol', String(reply.protocol));
      return new Response(null, { status: 101, webSocket: pair[0], headers: responseHeaders });
    }

    const response = new Promise<Response>((resolve, reject) => {
      this.http.set(channel, { resolve, reject, unacked: 0, publicBase, port, started: false });
    });
    const hasBody = request.body !== null && !['GET', 'HEAD'].includes(request.method);
    try {
      await this.request('http.request', { channel, port, method: request.method, path, headers, body: hasBody });
    } catch (error) {
      this.http.delete(channel);
      throw error;
    }
    if (hasBody) {
      const reader = request.body!.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        for (let offset = 0; offset < value.byteLength; offset += 65536) {
          agent.send(frame(KIND_HTTP, channel, value.subarray(offset, offset + 65536)));
        }
      }
      this.sendJson(agent, { type: 'http.body.end', channel });
    }
    return response;
  }

  private onHttpResponse(channel: number, status: number, headerPairs: [string, string][]) {
    const stream = this.http.get(channel);
    if (!stream || stream.started) return;
    stream.started = true;
    const headers = new Headers();
    for (const [name, value] of headerPairs) {
      const lower = name.toLowerCase();
      if (['transfer-encoding', 'connection', 'keep-alive'].includes(lower)) continue;
      if (lower === 'location') headers.append(name, rewriteLocation(value, stream.port, stream.publicBase));
      else headers.append(name, value);
    }
    const agentSocket = () => this.agentSocket();
    const sendAck = () => {
      const s = this.http.get(channel);
      if (s && s.unacked > 0) {
        agentSocket()?.send(JSON.stringify({ type: 'http.ack', channel, bytes: s.unacked }));
        s.unacked = 0;
      }
    };
    const nullBody = status === 204 || status === 304 || status === 101;
    const body = nullBody
      ? null
      : new ReadableStream<Uint8Array>(
          {
            start: (controller) => {
              stream.controller = controller;
            },
            pull: () => sendAck(),
            cancel: () => {
              this.http.delete(channel);
              agentSocket()?.send(JSON.stringify({ type: 'http.cancel', channel }));
            },
          },
          new ByteLengthQueuingStrategy({ highWaterMark: ACK_WINDOW / 2 }),
        );
    if (nullBody) this.http.delete(channel);
    stream.resolve(new Response(body, { status, headers }));
  }

  private onHttpData(channel: number, payload: Uint8Array) {
    const stream = this.http.get(channel);
    if (!stream?.controller) return;
    stream.controller.enqueue(payload.slice());
    stream.unacked += payload.byteLength;
    if ((stream.controller.desiredSize ?? 0) > 0) {
      this.agentSocket()?.send(JSON.stringify({ type: 'http.ack', channel, bytes: stream.unacked }));
      stream.unacked = 0;
    }
  }

  private failHttp(channel: number, stream: HttpStream, error: AgentError) {
    this.http.delete(channel);
    if (stream.started) stream.controller?.error(error);
    else stream.reject(error);
  }
}

/** `Location: http://localhost:3000/shop/x` → `https://daemons-apps.../shop/x`. */
export function rewriteLocation(value: string, port: number, publicBase: string): string {
  const match = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(:(\d+))?(\/.*)?$/i.exec(value);
  if (!match) return value;
  const matchedPort = match[3] ? Number(match[3]) : 80;
  if (matchedPort !== port) return value;
  return `${publicBase}${match[4] ?? '/'}`;
}

export const serverStub = (env: Env, serverId: string) => env.SERVER_CONNECTION.get(env.SERVER_CONNECTION.idFromName(serverId));
