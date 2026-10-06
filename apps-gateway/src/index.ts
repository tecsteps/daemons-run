type Env = { CONTROL_PLANE: Fetcher };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/_daemons/health') {
      // The control plane UI checks this from the browser to see whether the gateway exists.
      return Response.json({ ok: true }, { headers: { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' } });
    }
    return env.CONTROL_PLANE.fetch(request);
  },
} satisfies ExportedHandler<Env>;
