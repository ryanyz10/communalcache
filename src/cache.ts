import { DurableObject } from 'cloudflare:workers'

export function migrateCache(storage: DurableObjectStorage) {
  storage.transactionSync(() => {
    const sql = storage.sql
    sql.exec('CREATE TABLE IF NOT EXISTS schema_version (singleton INTEGER PRIMARY KEY CHECK(singleton = 1), version INTEGER NOT NULL)')
    const version = sql.exec<{ version: number }>('SELECT version FROM schema_version WHERE singleton = 1').toArray()[0]?.version ?? 0
    if (version > 2) throw new Error('Unsupported cache schema version')
    if (version < 1) {
      sql.exec(`
        CREATE TABLE cache_config (
          singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
          id TEXT NOT NULL UNIQUE, name TEXT NOT NULL, join_secret TEXT NOT NULL,
          requires_approval INTEGER NOT NULL DEFAULT 0 CHECK(requires_approval IN (0, 1)),
          created_at INTEGER NOT NULL
        );
        CREATE TABLE members (
          user_id TEXT PRIMARY KEY NOT NULL,
          role TEXT NOT NULL CHECK(role IN ('owner', 'member')),
          status TEXT NOT NULL CHECK(status IN ('active', 'pending', 'removed')),
          created_at INTEGER NOT NULL,
          CHECK(role <> 'owner' OR status = 'active')
        );
        CREATE UNIQUE INDEX one_owner ON members(role) WHERE role = 'owner';
        CREATE TABLE items (
          id TEXT PRIMARY KEY NOT NULL, owner_id TEXT NOT NULL REFERENCES members(user_id),
          title TEXT NOT NULL, description TEXT, photo_path TEXT,
          is_consumable INTEGER NOT NULL CHECK(is_consumable IN (0, 1)), quantity INTEGER,
          created_at INTEGER NOT NULL,
          CHECK(is_consumable = (quantity IS NOT NULL)),
          CHECK(quantity IS NULL OR (typeof(quantity) = 'integer' AND quantity BETWEEN 0 AND 9999))
        );
        CREATE INDEX items_owner ON items(owner_id);
        CREATE TABLE requests (
          id TEXT PRIMARY KEY NOT NULL, item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
          requester_id TEXT NOT NULL REFERENCES members(user_id), quantity INTEGER,
          status TEXT NOT NULL CHECK(status IN ('pending', 'approved', 'rejected')),
          decision_reason TEXT, decided_at INTEGER, created_at INTEGER NOT NULL,
          CHECK(quantity IS NULL OR (typeof(quantity) = 'integer' AND quantity BETWEEN 1 AND 9999)),
          CHECK((status = 'pending') = (decided_at IS NULL)),
          CHECK(status <> 'rejected' OR decision_reason IS NOT NULL)
        );
        CREATE INDEX pending_requests ON requests(item_id) WHERE status = 'pending';
        CREATE INDEX requests_requester ON requests(requester_id);
      `)
    }
    if (version < 2) {
      sql.exec(`CREATE TABLE pending_sync (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL UNIQUE, kind TEXT NOT NULL, payload TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )`)
    }
    sql.exec('INSERT INTO schema_version (singleton, version) VALUES (1, 2) ON CONFLICT(singleton) DO UPDATE SET version = excluded.version')
  })
}

export class Cache extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    ctx.blockConcurrencyWhile(async () => { migrateCache(ctx.storage) })
  }

  async schemaVersion() {
    if (this.ctx.storage.sql.exec('SELECT 1 FROM pending_sync LIMIT 1').toArray().length && await this.ctx.storage.getAlarm() === null) {
      await this.ctx.storage.setAlarm(Date.now() + 60_000)
    }
    return this.ctx.storage.sql.exec<{ version: number }>('SELECT version FROM schema_version WHERE singleton = 1').one().version
  }

  async alarm() {
    // Foundation has no producers/consumers yet. Never discard future durable work.
    if (this.ctx.storage.sql.exec('SELECT 1 FROM pending_sync LIMIT 1').toArray().length) {
      await this.ctx.storage.setAlarm(Date.now() + 60_000)
    }
  }
}
