-- First schema (epic 01). Later epics add columns, not new concepts.

CREATE TABLE setup_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  user_id TEXT NOT NULL,
  consumed_code_hash TEXT,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  window_started_at INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE passkeys (
  id TEXT PRIMARY KEY,
  public_key TEXT NOT NULL,
  counter INTEGER NOT NULL DEFAULT 0,
  transports TEXT,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER
);

CREATE TABLE auth_challenges (
  challenge TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  passkey_id TEXT,
  user_agent TEXT,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE providers (
  id TEXT PRIMARY KEY,
  credentials TEXT NOT NULL,
  key_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE servers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  provider TEXT,
  provider_server_id TEXT,
  status TEXT NOT NULL,
  location TEXT,
  size TEXT,
  price_monthly TEXT,
  agents TEXT NOT NULL DEFAULT '[]',
  ipv4 TEXT,
  ipv6 TEXT,
  error TEXT,
  install_step TEXT,
  install_status TEXT,
  install_log TEXT,
  install_updated_at INTEGER,
  agent_version TEXT,
  hostname TEXT,
  os TEXT,
  arch TEXT,
  cpus INTEGER,
  memory_bytes INTEGER,
  disk_bytes INTEGER,
  connected INTEGER NOT NULL DEFAULT 0,
  last_seen_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE enrollment_tokens (
  token_hash TEXT PRIMARY KEY,
  server_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);

CREATE TABLE agent_credentials (
  credential_hash TEXT PRIMARY KEY,
  server_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  revoked_at INTEGER
);

CREATE TABLE apps (
  name TEXT PRIMARY KEY,
  server_id TEXT NOT NULL,
  port INTEGER NOT NULL,
  cwd TEXT,
  public INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE app_tickets (
  token_hash TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);
