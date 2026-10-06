import { ProviderError, type CreateServerInput, type Provider, type ProviderOptions, type ProviderServer, type ProviderSize } from './provider';

const API = 'https://api.hetzner.cloud/v1';
const IMAGE = 'ubuntu-24.04';

type HetznerServer = {
  id: number;
  name: string;
  status: string;
  public_net: { ipv4: { ip: string } | null; ipv6: { ip: string } | null };
};

const GROUPS: Record<string, ProviderSize['group']> = {
  cost_optimized: 'cost-optimized',
  regular_purpose: 'regular-performance',
  general_purpose: 'general-purpose',
};

export class HetznerProvider implements Provider {
  readonly id = 'hetzner';
  readonly label = 'Hetzner';

  constructor(
    private token: string,
    private base = API,
  ) {}

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.base}${path}`, {
        method,
        headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (error) {
      throw new ProviderError('Hetzner did not answer in time.', 504, 'timeout');
    }
    if (response.status === 204) return undefined as T;
    const json = (await response.json().catch(() => ({}))) as { error?: { message: string; code: string } };
    if (!response.ok) {
      if (response.status === 401) throw new ProviderError('Hetzner rejected the API token. Check that it is a Read & Write token of the right project.', 401, 'unauthorized');
      throw new ProviderError(json.error?.message ?? `Hetzner answered ${response.status}.`, response.status, json.error?.code ?? 'error');
    }
    return json as T;
  }

  async validateCredentials() {
    await this.call('GET', '/locations?per_page=1');
  }

  async listOptions(): Promise<ProviderOptions> {
    const [locations, types] = await Promise.all([
      this.call<{ locations: { name: string; city: string; country: string }[] }>('GET', '/locations'),
      this.call<{ server_types: any[] }>('GET', '/server_types?per_page=50'),
    ]);
    const sizes: ProviderSize[] = types.server_types
      .filter((t) => !t.deprecated && !t.deprecation)
      .map((t) => ({
        name: t.name,
        group: GROUPS[t.category] ?? (t.cpu_type === 'dedicated' ? 'general-purpose' : 'regular-performance'),
        cpus: t.cores,
        cpuKind: t.cpu_type,
        cpuVendor: t.architecture === 'arm' ? 'Ampere' : t.cpu_type === 'dedicated' || t.name.startsWith('cpx') ? 'AMD' : 'Intel/AMD',
        architecture: t.architecture,
        memoryGb: t.memory,
        diskGb: t.disk,
        prices: (t.prices as any[]).map((p) => ({
          location: p.location,
          hourly: p.price_hourly.gross,
          monthly: p.price_monthly.gross,
          trafficBytes: p.included_traffic ?? null,
        })),
        availableIn: ((t.locations ?? []) as any[]).filter((l) => l.available && !l.deprecation).map((l) => l.name),
      }));
    return {
      locations: locations.locations.map((l) => ({ name: l.name, city: l.city, country: l.country })),
      sizes,
    };
  }

  private toServer(s: HetznerServer): ProviderServer {
    const status: ProviderServer['status'] =
      s.status === 'initializing'
        ? 'creating'
        : s.status === 'starting'
          ? 'starting'
          : s.status === 'running'
            ? 'running'
            : s.status === 'off' || s.status === 'stopping'
              ? 'stopped'
              : s.status === 'deleting'
                ? 'deleting'
                : 'unknown';
    return { id: String(s.id), status, ipv4: s.public_net.ipv4?.ip ?? null, ipv6: s.public_net.ipv6?.ip ?? null };
  }

  private async sshKeyId(publicKey: string, labels: Record<string, string>): Promise<number> {
    const fingerprintName = `daemons-${(await hash(publicKey)).slice(0, 12)}`;
    const found = await this.call<{ ssh_keys: { id: number }[] }>('GET', `/ssh_keys?name=${fingerprintName}`);
    if (found.ssh_keys[0]) return found.ssh_keys[0].id;
    try {
      const created = await this.call<{ ssh_key: { id: number } }>('POST', '/ssh_keys', { name: fingerprintName, public_key: publicKey, labels });
      return created.ssh_key.id;
    } catch (error) {
      // The same key may already exist under another name in this project.
      if (error instanceof ProviderError && error.code === 'uniqueness_error') {
        const all = await this.call<{ ssh_keys: { id: number; public_key: string }[] }>('GET', '/ssh_keys?per_page=50');
        const match = all.ssh_keys.find((k) => k.public_key.trim().split(' ').slice(0, 2).join(' ') === publicKey.trim().split(' ').slice(0, 2).join(' '));
        if (match) return match.id;
      }
      throw error;
    }
  }

  async createServer(input: CreateServerInput): Promise<ProviderServer> {
    const sshKeys = input.sshPublicKey ? [await this.sshKeyId(input.sshPublicKey, input.labels)] : [];
    const result = await this.call<{ server: HetznerServer }>('POST', '/servers', {
      name: input.name,
      server_type: input.size,
      location: input.location,
      image: IMAGE,
      user_data: input.userData,
      ssh_keys: sshKeys,
      labels: input.labels,
      start_after_create: true,
      public_net: { enable_ipv4: true, enable_ipv6: true },
    });
    return this.toServer(result.server);
  }

  async findServerByName(name: string, labels: Record<string, string>): Promise<ProviderServer | null> {
    const selector = Object.entries(labels).map(([k, v]) => `${k}==${v}`).join(',');
    const result = await this.call<{ servers: HetznerServer[] }>(
      'GET',
      `/servers?name=${encodeURIComponent(name)}&label_selector=${encodeURIComponent(selector)}`,
    );
    return result.servers[0] ? this.toServer(result.servers[0]) : null;
  }

  async getServer(id: string): Promise<ProviderServer | null> {
    try {
      const result = await this.call<{ server: HetznerServer }>('GET', `/servers/${id}`);
      return this.toServer(result.server);
    } catch (error) {
      if (error instanceof ProviderError && error.status === 404) return null;
      throw error;
    }
  }

  async deleteServer(id: string) {
    try {
      await this.call('DELETE', `/servers/${id}`);
    } catch (error) {
      if (error instanceof ProviderError && error.status === 404) return;
      throw error;
    }
  }

  async rebuildServer(id: string) {
    // A rebuild reinstalls the image and runs cloud-init again with the user data from
    // creation; the caller re-arms that enrollment token instead of changing user data.
    await this.call('POST', `/servers/${id}/actions/rebuild`, { image: IMAGE });
  }
}

async function hash(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text.trim()));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
