import type { KeyVault } from './key-vault';
import type { ServerConnection } from './server-connection';

export type Env = {
  DB: D1Database;
  ASSETS: Fetcher;
  SERVER_CONNECTION: DurableObjectNamespace<ServerConnection>;
  KEY_VAULT: DurableObjectNamespace<KeyVault>;
  SETUP_CODE?: string;
  AGENT_RELEASE: string;
  /** Optional overrides; derived from the hostname when unset. */
  APPS_ORIGIN?: string;
  CONTROL_PLANE_ORIGIN?: string;
  /** Tests only: replaces the Hetzner API base URL. */
  HETZNER_API_BASE?: string;
};

export type AppVars = {
  sessionId: string;
};

export type HonoEnv = { Bindings: Env; Variables: AppVars };
