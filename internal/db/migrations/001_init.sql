-- Application schema (never public — PostgREST Data API must not reach these tables)
CREATE SCHEMA IF NOT EXISTS app;

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "citext";

-- schema_migrations lives in app and is created by the migration runner bootstrap,
-- never here — a public ledger would sit in the schema PostgREST exposes to anon.

CREATE TABLE app.users (
    id uuid PRIMARY KEY,
    email citext UNIQUE NOT NULL,
    display_name text,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.caches (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL,
    owner_id uuid NOT NULL REFERENCES app.users (id),
    invite_token text UNIQUE NOT NULL,
    requires_approval boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.cache_members (
    cache_id uuid NOT NULL REFERENCES app.caches (id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES app.users (id) ON DELETE CASCADE,
    status text NOT NULL CHECK (status IN ('active', 'pending', 'removed')),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (cache_id, user_id)
);

CREATE TABLE app.items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    cache_id uuid NOT NULL REFERENCES app.caches (id) ON DELETE CASCADE,
    owner_id uuid NOT NULL REFERENCES app.users (id),
    title text NOT NULL,
    description text,
    photo_path text,
    is_consumable boolean NOT NULL,
    quantity int,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (is_consumable = (quantity IS NOT NULL)),
    CHECK (quantity IS NULL OR quantity BETWEEN 0 AND 9999)
);

CREATE TABLE app.requests (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    item_id uuid NOT NULL REFERENCES app.items (id) ON DELETE CASCADE,
    requester_id uuid NOT NULL REFERENCES app.users (id),
    quantity int,
    status text NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
    decision_reason text,
    decided_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (quantity IS NULL OR quantity BETWEEN 1 AND 9999),
    CHECK ((status = 'pending') = (decided_at IS NULL)),
    CHECK (status <> 'rejected' OR decision_reason IS NOT NULL)
);

CREATE INDEX requests_item_pending_idx ON app.requests (item_id) WHERE status = 'pending';

CREATE TABLE app.push_subscriptions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES app.users (id) ON DELETE CASCADE,
    endpoint text UNIQUE NOT NULL,
    p256dh text NOT NULL,
    auth text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.outbox (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    kind text NOT NULL,
    dedupe_key text NOT NULL,
    payload jsonb NOT NULL,
    attempts int NOT NULL DEFAULT 0,
    send_after timestamptz NOT NULL DEFAULT now(),
    sent_at timestamptz,
    failed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (kind, dedupe_key)
);

-- Data API boundary: revoke from browser-facing roles; RLS deny-all with zero policies.
-- Roles may be absent on vanilla Postgres; create them if missing (tests / local).
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN
        CREATE ROLE anon NOLOGIN;
    END IF;
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN
        CREATE ROLE authenticated NOLOGIN;
    END IF;
END
$$;

REVOKE ALL ON SCHEMA app FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA app REVOKE ALL ON TABLES FROM anon, authenticated;

ALTER TABLE app.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.caches ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.cache_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.items ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.outbox ENABLE ROW LEVEL SECURITY;
-- Do not FORCE ROW LEVEL SECURITY — owning role (Go DATABASE_URL) must bypass.
