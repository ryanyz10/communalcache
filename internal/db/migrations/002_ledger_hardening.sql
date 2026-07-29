-- Wall the relocated ledger like every other app table.
-- Lives in its own migration so databases that already recorded 001 still run it.
ALTER TABLE app.schema_migrations ENABLE ROW LEVEL SECURITY;
-- Do not FORCE ROW LEVEL SECURITY — owning role (Go DATABASE_URL) must bypass.

REVOKE ALL ON TABLE app.schema_migrations FROM PUBLIC, anon, authenticated;
