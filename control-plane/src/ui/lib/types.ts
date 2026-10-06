export type ServerStatus = 'creating' | 'installing' | 'online' | 'offline' | 'failed';

export type ServerView = {
  id: string;
  name: string;
  provider: string | null;
  providerServerId: string | null;
  status: ServerStatus;
  location: string | null;
  size: string | null;
  priceMonthly: string | null;
  agents: string[];
  ipv4: string | null;
  ipv6: string | null;
  error: string | null;
  install: { step: string | null; status: string | null; log: string | null; updatedAt: number | null };
  agentVersion: string | null;
  hostname: string | null;
  os: string | null;
  arch: string | null;
  cpus: number | null;
  memoryBytes: number | null;
  diskBytes: number | null;
  lastSeenAt: number | null;
  createdAt: number;
};

export type Me = { authenticated: boolean; setupOpen: boolean; setupCodeConfigured: boolean };

export const AGENT_LABELS: Record<string, string> = { claude: 'Claude Code', codex: 'Codex', opencode: 'OpenCode' };
