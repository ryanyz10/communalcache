package db

import (
	"context"
	"embed"
	"fmt"
	"io/fs"
	"sort"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

//go:embed migrations/*.sql
var migrationFS embed.FS

// Migrate runs embedded SQL migrations under a session advisory lock on a
// dedicated connection (not the pool) — advisory locks are session-scoped.
func Migrate(ctx context.Context, pool *pgxpool.Pool) error {
	conn, err := pool.Acquire(ctx)
	if err != nil {
		return fmt.Errorf("acquire migration connection: %w", err)
	}
	defer conn.Release()

	if _, err := conn.Exec(ctx, `SELECT pg_advisory_lock(87201401)`); err != nil {
		return fmt.Errorf("advisory lock: %w", err)
	}
	defer func() { _, _ = conn.Exec(context.Background(), `SELECT pg_advisory_unlock(87201401)`) }()

	if err := ensureLedger(ctx, conn); err != nil {
		return err
	}

	entries, err := fs.ReadDir(migrationFS, "migrations")
	if err != nil {
		return err
	}
	var names []string
	for _, e := range entries {
		if !e.IsDir() && strings.HasSuffix(e.Name(), ".sql") {
			names = append(names, e.Name())
		}
	}
	sort.Strings(names)

	for _, name := range names {
		var applied bool
		if err := conn.QueryRow(ctx,
			`SELECT EXISTS(SELECT 1 FROM app.schema_migrations WHERE filename = $1)`, name,
		).Scan(&applied); err != nil {
			return err
		}
		if applied {
			continue
		}
		body, err := migrationFS.ReadFile("migrations/" + name)
		if err != nil {
			return err
		}
		tx, err := conn.Begin(ctx)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, string(body)); err != nil {
			_ = tx.Rollback(ctx)
			return fmt.Errorf("migration %s: %w", name, err)
		}
		if _, err := tx.Exec(ctx,
			`INSERT INTO app.schema_migrations (filename) VALUES ($1)`, name,
		); err != nil {
			_ = tx.Rollback(ctx)
			return err
		}
		if err := tx.Commit(ctx); err != nil {
			return err
		}
	}
	return nil
}

// ensureLedger puts the migration ledger in app (never public) and relocates any
// pre-existing public.schema_migrations rows. Must run under the advisory lock.
func ensureLedger(ctx context.Context, conn *pgxpool.Conn) error {
	if _, err := conn.Exec(ctx, `CREATE SCHEMA IF NOT EXISTS app`); err != nil {
		return fmt.Errorf("ensure app schema: %w", err)
	}
	if _, err := conn.Exec(ctx, `
		CREATE TABLE IF NOT EXISTS app.schema_migrations (
			filename text PRIMARY KEY,
			applied_at timestamptz NOT NULL DEFAULT now()
		)`); err != nil {
		return fmt.Errorf("ensure schema_migrations: %w", err)
	}

	var hasPublic bool
	if err := conn.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM information_schema.tables
			WHERE table_schema = 'public' AND table_name = 'schema_migrations'
		)`).Scan(&hasPublic); err != nil {
		return err
	}
	if !hasPublic {
		return nil
	}
	if _, err := conn.Exec(ctx, `
		INSERT INTO app.schema_migrations (filename, applied_at)
		SELECT filename, applied_at FROM public.schema_migrations
		ON CONFLICT (filename) DO NOTHING`); err != nil {
		return fmt.Errorf("copy public schema_migrations: %w", err)
	}
	if _, err := conn.Exec(ctx, `DROP TABLE public.schema_migrations`); err != nil {
		return fmt.Errorf("drop public schema_migrations: %w", err)
	}
	return nil
}

func Connect(ctx context.Context, databaseURL string) (*pgxpool.Pool, error) {
	cfg, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return nil, err
	}
	// Session mode / direct only — transaction pooling breaks advisory locks.
	cfg.ConnConfig.DefaultQueryExecMode = pgx.QueryExecModeCacheStatement
	return pgxpool.NewWithConfig(ctx, cfg)
}
