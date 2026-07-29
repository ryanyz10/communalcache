package db

import (
	"context"
	"sync"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ryanzhou/communalcache/internal/dbtest"
)

func TestMigrateFresh(t *testing.T) {
	pool := dbtest.Open(t)
	dbtest.ResetSchema(t, pool)
	ctx := context.Background()

	if err := Migrate(ctx, pool); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	assertLedgerHardened(t, pool)
	assertNoPublicLedger(t, pool)

	if err := Migrate(ctx, pool); err != nil {
		t.Fatalf("second migrate: %v", err)
	}
	assertLedgerHardened(t, pool)
}

func TestMigrateLegacyPublicLedger(t *testing.T) {
	pool := dbtest.Open(t)
	dbtest.ResetSchema(t, pool)
	ctx := context.Background()

	// Pre-fix shape: 001 already applied under a public ledger, no app ledger.
	seedLegacyPublicLedger(t, pool)

	if err := Migrate(ctx, pool); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	var has001, has002 bool
	if err := pool.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM app.schema_migrations WHERE filename='001_init.sql')`,
	).Scan(&has001); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM app.schema_migrations WHERE filename='002_ledger_hardening.sql')`,
	).Scan(&has002); err != nil {
		t.Fatal(err)
	}
	if !has001 {
		t.Fatal("expected 001 row preserved from public ledger")
	}
	if !has002 {
		t.Fatal("expected 002 to run on legacy database")
	}
	assertLedgerHardened(t, pool)
	assertNoPublicLedger(t, pool)

	var n int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM app.schema_migrations`).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n < 2 {
		t.Fatalf("expected preserved migration rows, got %d", n)
	}
}

func TestMigrateConcurrentLegacy(t *testing.T) {
	pool := dbtest.Open(t)
	dbtest.ResetSchema(t, pool)
	ctx := context.Background()
	seedLegacyPublicLedger(t, pool)

	var wg sync.WaitGroup
	errs := make(chan error, 2)
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			errs <- Migrate(ctx, pool)
		}()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatalf("concurrent migrate: %v", err)
		}
	}
	assertLedgerHardened(t, pool)
	assertNoPublicLedger(t, pool)
}

func seedLegacyPublicLedger(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	ctx := context.Background()

	body, err := migrationFS.ReadFile("migrations/001_init.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, string(body)); err != nil {
		t.Fatalf("apply 001: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		CREATE TABLE public.schema_migrations (
			filename text PRIMARY KEY,
			applied_at timestamptz NOT NULL DEFAULT now()
		);
		INSERT INTO public.schema_migrations (filename) VALUES ('001_init.sql');
		DROP TABLE IF EXISTS app.schema_migrations;
	`); err != nil {
		t.Fatalf("seed public ledger: %v", err)
	}
}

func assertNoPublicLedger(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	var exists bool
	if err := pool.QueryRow(context.Background(), `
		SELECT EXISTS (
			SELECT 1 FROM information_schema.tables
			WHERE table_schema = 'public' AND table_name = 'schema_migrations'
		)`).Scan(&exists); err != nil {
		t.Fatal(err)
	}
	if exists {
		t.Fatal("public.schema_migrations still exists")
	}
}

func assertLedgerHardened(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	ctx := context.Background()

	var rls, force bool
	if err := pool.QueryRow(ctx, `
		SELECT c.relrowsecurity, c.relforcerowsecurity
		FROM pg_class c
		JOIN pg_namespace n ON n.oid = c.relnamespace
		WHERE n.nspname = 'app' AND c.relname = 'schema_migrations'
	`).Scan(&rls, &force); err != nil {
		t.Fatalf("ledger relrowsecurity: %v", err)
	}
	if !rls {
		t.Fatal("expected RLS enabled on app.schema_migrations")
	}
	if force {
		t.Fatal("FORCE ROW LEVEL SECURITY must not be set")
	}

	var policies int
	if err := pool.QueryRow(ctx, `
		SELECT count(*) FROM pg_policies
		WHERE schemaname = 'app' AND tablename = 'schema_migrations'
	`).Scan(&policies); err != nil {
		t.Fatal(err)
	}
	if policies != 0 {
		t.Fatalf("expected zero policies, got %d", policies)
	}

	for _, role := range []string{"anon", "authenticated"} {
		var canSelect bool
		if err := pool.QueryRow(ctx,
			`SELECT has_table_privilege($1, 'app.schema_migrations', 'SELECT')`, role,
		).Scan(&canSelect); err != nil {
			t.Fatalf("privilege %s: %v", role, err)
		}
		if canSelect {
			t.Fatalf("%s still has SELECT on app.schema_migrations", role)
		}
	}
}
