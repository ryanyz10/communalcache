// Package dbtest opens the shared TEST_DATABASE_URL under an exclusive
// advisory lock so parallel packages cannot DROP SCHEMA under each other.
package dbtest

import (
	"context"
	"os"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

// testDBLock is distinct from the migration lock in migrate.go.
const testDBLock int64 = 87201402

func Open(t *testing.T) *pgxpool.Pool {
	t.Helper()
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL not set")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}

	conn, err := pool.Acquire(ctx)
	if err != nil {
		pool.Close()
		t.Fatalf("acquire test lock conn: %v", err)
	}
	if _, err := conn.Exec(ctx, `SELECT pg_advisory_lock($1)`, testDBLock); err != nil {
		conn.Release()
		pool.Close()
		t.Fatalf("test advisory lock: %v", err)
	}
	t.Cleanup(func() {
		_, _ = conn.Exec(context.Background(), `SELECT pg_advisory_unlock($1)`, testDBLock)
		conn.Release()
		pool.Close()
	})
	return pool
}

func ResetSchema(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	ctx := context.Background()
	if _, err := pool.Exec(ctx, `DROP SCHEMA IF EXISTS app CASCADE`); err != nil {
		t.Fatalf("drop app: %v", err)
	}
	if _, err := pool.Exec(ctx, `DROP TABLE IF EXISTS public.schema_migrations`); err != nil {
		t.Fatalf("drop public.schema_migrations: %v", err)
	}
}
