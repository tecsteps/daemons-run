/** Plain fetch to our own /api. Errors carry the server's message so screens can show it. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export async function api<T = unknown>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      ...rest,
      credentials: 'same-origin',
      headers: { ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}), ...rest.headers },
      body: json !== undefined ? JSON.stringify(json) : rest.body,
    });
  } catch {
    throw new ApiError('The control plane could not be reached. Check your connection.', 0);
  }
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    if (response.status === 401 && !path.startsWith('/auth') && !path.startsWith('/setup') && path !== '/me') {
      window.dispatchEvent(new Event('daemons:signed-out'));
    }
    throw new ApiError(String(body.error ?? `Request failed (${response.status}).`), response.status, body);
  }
  return body as T;
}
