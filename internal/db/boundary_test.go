package db

import (
	"context"
	"slices"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ryanzhou/communalcache/internal/dbtest"
)

func appTables(ctx context.Context, pool *pgxpool.Pool) ([]string, error) {
	rows, err := pool.Query(ctx, `
		SELECT table_name FROM information_schema.tables
		WHERE table_schema = 'app' AND table_type = 'BASE TABLE'
		ORDER BY table_name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var names []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, err
		}
		names = append(names, name)
	}
	return names, rows.Err()
}

func TestDataAPIBoundaryLayers(t *testing.T) {
	pool := dbtest.Open(t)
	dbtest.ResetSchema(t, pool)
	ctx := context.Background()
	if err := Migrate(ctx, pool); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	tables, err := appTables(ctx, pool)
	if err != nil {
		t.Fatal(err)
	}
	if len(tables) == 0 {
		t.Fatal("app schema has no tables — boundary assertions would pass vacuously")
	}
	for _, want := range dbtest.ExpectedAppTables {
		if !slices.Contains(tables, want) {
			t.Errorf("missing expected app table %q (got %v)", want, tables)
		}
	}
	if len(tables) != len(dbtest.ExpectedAppTables) {
		t.Errorf("app tables = %v, want exactly %v", tables, dbtest.ExpectedAppTables)
	}

	var publicOurs int
	if err := pool.QueryRow(ctx, `
		SELECT count(*) FROM information_schema.tables
		WHERE table_schema = 'public'
		  AND table_name = ANY($1)
	`, dbtest.ExpectedAppTables).Scan(&publicOurs); err != nil {
		t.Fatal(err)
	}
	if publicOurs != 0 {
		t.Fatalf("found %d of our tables still in public", publicOurs)
	}

	for _, role := range []string{"anon", "authenticated"} {
		var canUse bool
		if err := pool.QueryRow(ctx,
			`SELECT has_schema_privilege($1, 'app', 'USAGE')`, role,
		).Scan(&canUse); err != nil {
			t.Fatalf("schema privilege %s: %v", role, err)
		}
		if canUse {
			t.Errorf("%s still has USAGE on schema app", role)
		}
	}

	for _, table := range tables {
		t.Run(table, func(t *testing.T) {
			var policies int
			if err := pool.QueryRow(ctx, `
				SELECT count(*) FROM pg_policies
				WHERE schemaname = 'app' AND tablename = $1
			`, table).Scan(&policies); err != nil {
				t.Fatal(err)
			}
			if policies != 0 {
				t.Errorf("expected zero policies, got %d", policies)
			}

			var rls, force bool
			if err := pool.QueryRow(ctx, `
				SELECT c.relrowsecurity, c.relforcerowsecurity
				FROM pg_class c
				JOIN pg_namespace n ON n.oid = c.relnamespace
				WHERE n.nspname = 'app' AND c.relname = $1
			`, table).Scan(&rls, &force); err != nil {
				t.Fatal(err)
			}
			if !rls {
				t.Error("relrowsecurity is false")
			}
			if force {
				t.Error("relforcerowsecurity is true — would lock the app out")
			}
		})
	}
}
