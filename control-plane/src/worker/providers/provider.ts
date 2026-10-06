/**
 * Everything the control plane needs from a server provider (04). Hetzner is the only
 * implementation in v1; a second provider is one more file plus its credential form.
 */

export type ProviderLocation = { name: string; city: string; country: string };

export type ProviderSize = {
  name: string;
  group: 'cost-optimized' | 'regular-performance' | 'general-purpose';
  cpus: number;
  cpuKind: 'shared' | 'dedicated';
  cpuVendor: string;
  architecture: 'x86' | 'arm';
  memoryGb: number;
  diskGb: number;
  /** Per location: prices as decimal strings in EUR incl. VAT, traffic in bytes. */
  prices: { location: string; hourly: string; monthly: string; trafficBytes: number | null }[];
  availableIn: string[];
};

export type ProviderOptions = { locations: ProviderLocation[]; sizes: ProviderSize[] };

export type ProviderServer = {
  id: string;
  status: 'creating' | 'starting' | 'running' | 'stopped' | 'deleting' | 'unknown';
  ipv4: string | null;
  ipv6: string | null;
};

export type CreateServerInput = {
  name: string;
  location: string;
  size: string;
  userData: string;
  sshPublicKey: string | null;
  labels: Record<string, string>;
};

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
  }
}

export interface Provider {
  readonly id: string;
  readonly label: string;
  validateCredentials(): Promise<void>;
  listOptions(): Promise<ProviderOptions>;
  createServer(input: CreateServerInput): Promise<ProviderServer>;
  /** Finds our server by name (after a timed-out create). */
  findServerByName(name: string, labels: Record<string, string>): Promise<ProviderServer | null>;
  getServer(id: string): Promise<ProviderServer | null>;
  deleteServer(id: string): Promise<void>;
  /** Reinstalls the server with the user data it was created with. */
  rebuildServer(id: string): Promise<void>;
}
