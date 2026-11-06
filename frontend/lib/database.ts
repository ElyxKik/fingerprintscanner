import { createClient, type Client } from '@libsql/client';
import { join } from 'node:path';

const globalForDb = globalThis as typeof globalThis & { fingerprintDb?: Client; fingerprintDbReady?: Promise<void> };

function getClient(): Client {
  if (globalForDb.fingerprintDb) return globalForDb.fingerprintDb;
  const url = process.env.TURSO_DATABASE_URL || `file:${join(process.cwd(), 'data', 'fingerprintscanner.db')}`;
  const isRemote = url.startsWith('libsql://') || url.startsWith('https://');
  if (process.env.NODE_ENV === 'production' && !isRemote) {
    throw new Error('Configure the persistent remote Turso database for production.');
  }
  if (isRemote && !process.env.TURSO_AUTH_TOKEN) {
    throw new Error('TURSO_AUTH_TOKEN must be configured to connect to the remote database.');
  }
  globalForDb.fingerprintDb = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
  return globalForDb.fingerprintDb;
}

const schema = [
  'PRAGMA foreign_keys = ON',
  `CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email_ciphertext TEXT NOT NULL, email_lookup_hash TEXT NOT NULL UNIQUE, password_hash TEXT, email_verified_at TEXT, created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS access_tokens (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, token_hash TEXT NOT NULL UNIQUE, expires_at TEXT NOT NULL, consumed_at TEXT, scan_id TEXT, created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS scans (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, status TEXT NOT NULL, ownership_confirmed INTEGER NOT NULL, created_at TEXT NOT NULL, completed_at TEXT, error_code TEXT)`,
  `CREATE TABLE IF NOT EXISTS findings (id TEXT PRIMARY KEY, scan_id TEXT NOT NULL REFERENCES scans(id) ON DELETE CASCADE, source_name TEXT NOT NULL, url TEXT NOT NULL, title TEXT NOT NULL, snippet TEXT NOT NULL DEFAULT '', risk TEXT NOT NULL, risk_score INTEGER NOT NULL, risk_keywords TEXT NOT NULL DEFAULT '[]', result_kind TEXT NOT NULL DEFAULT 'live', removal_url TEXT, discovered_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS cleanup_requests (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, finding_id TEXT NOT NULL REFERENCES findings(id) ON DELETE CASCADE, status TEXT NOT NULL DEFAULT 'draft', request_text TEXT NOT NULL, approved_at TEXT, created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS orders (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, plan TEXT NOT NULL, amount_eur INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'checkout_unconfigured', chariow_sale_id TEXT, chariow_product_id TEXT, chariow_checkout_url TEXT, amount_usd INTEGER NOT NULL DEFAULT 0, currency TEXT NOT NULL DEFAULT 'EUR', created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS order_items (id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE, finding_id TEXT NOT NULL REFERENCES findings(id) ON DELETE CASCADE, source_name TEXT NOT NULL, url TEXT NOT NULL, created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS chariow_pulse_deliveries (delivery_id TEXT PRIMARY KEY, received_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_scans_user ON scans(user_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_findings_scan ON findings(scan_id)`,
  `CREATE INDEX IF NOT EXISTS idx_tokens_digest ON access_tokens(token_hash)`,
];

export async function database(): Promise<Client> {
  const client = getClient();
  if (!globalForDb.fingerprintDbReady) {
    globalForDb.fingerprintDbReady = (async () => {
      for (const statement of schema) await client.execute(statement);
      const columns = await client.execute('PRAGMA table_info(orders)');
      const existing = new Set(columns.rows.map(row => String(row.name)));
      for (const [name, type] of [['chariow_sale_id', 'TEXT'], ['chariow_product_id', 'TEXT'], ['chariow_checkout_url', 'TEXT'], ['amount_usd', 'INTEGER NOT NULL DEFAULT 0'], ['currency', "TEXT NOT NULL DEFAULT 'EUR'"]] as const) {
        if (!existing.has(name)) await client.execute(`ALTER TABLE orders ADD COLUMN ${name} ${type}`);
      }
    })();
  }
  await globalForDb.fingerprintDbReady;
  return client;
}

export function nowIso(): string {
  return new Date().toISOString();
}
