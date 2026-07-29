//go:build hosted

package db_test

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Hosted PostgREST boundary check — operator smoke, not CI.
// Isolated from TEST_DATABASE_URL and from `go test ./...` (build tag `hosted`).
// Run via `make boundary-http`.
//
// Required env:
//
//	HOSTED_DATABASE_URL  — catalog reads only; never TEST_DATABASE_URL
//	SUPABASE_URL
//	SUPABASE_ANON_KEY    — legacy JWT anon key (eyJ…), not sb_publishable_…
//	BOUNDARY_USER_JWT    — a real signed-in access token
func TestHostedPostgRESTBoundary(t *testing.T) {
	hostedURL := os.Getenv("HOSTED_DATABASE_URL")
	supabaseURL := strings.TrimRight(os.Getenv("SUPABASE_URL"), "/")
	anonKey := os.Getenv("SUPABASE_ANON_KEY")
	userJWT := os.Getenv("BOUNDARY_USER_JWT")

	missing := []string{}
	if hostedURL == "" {
		missing = append(missing, "HOSTED_DATABASE_URL")
	}
	if supabaseURL == "" {
		missing = append(missing, "SUPABASE_URL")
	}
	if anonKey == "" {
		missing = append(missing, "SUPABASE_ANON_KEY")
	}
	if userJWT == "" {
		missing = append(missing, "BOUNDARY_USER_JWT")
	}
	if len(missing) > 0 {
		t.Fatalf("hosted boundary requires %s", strings.Join(missing, ", "))
	}
	if !strings.HasPrefix(anonKey, "eyJ") {
		t.Fatal("SUPABASE_ANON_KEY must be the legacy JWT anon key (eyJ…), not sb_publishable_…; copy from GET /api/config")
	}

	ctx := context.Background()
	pool, err := pgxpool.New(ctx, hostedURL)
	if err != nil {
		t.Fatalf("hosted db connect: %v", err)
	}
	t.Cleanup(pool.Close)

	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `SET TRANSACTION READ ONLY`); err != nil {
		t.Fatal(err)
	}

	rows, err := tx.Query(ctx, `
		SELECT table_name FROM information_schema.tables
		WHERE table_schema = 'app' AND table_type = 'BASE TABLE'
		ORDER BY table_name
	`)
	if err != nil {
		t.Fatalf("list app tables: %v", err)
	}
	var tables []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			rows.Close()
			t.Fatal(err)
		}
		tables = append(tables, name)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	if len(tables) == 0 {
		t.Fatal("hosted app schema has no tables")
	}

	client := &http.Client{Timeout: 15 * time.Second}

	// Positive control: project is reachable. Do not send apikey — Auth health
	// rejects sb_publishable_ keys and this check only proves connectivity.
	req, err := http.NewRequest(http.MethodGet, supabaseURL+"/auth/v1/health", nil)
	if err != nil {
		t.Fatal(err)
	}
	res, err := client.Do(req)
	if err != nil {
		t.Fatalf("positive control transport error: %v", err)
	}
	body, _ := io.ReadAll(res.Body)
	res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		t.Fatalf("positive control failed: status=%d body=%s", res.StatusCode, body)
	}

	restBase := supabaseURL + "/rest/v1"
	for _, table := range tables {
		t.Run("anon/"+table, func(t *testing.T) {
			assertDenied(t, client, restBase+"/"+table+"?select=*&limit=1", anonKey, "")
		})
		t.Run("user/"+table, func(t *testing.T) {
			assertDenied(t, client, restBase+"/"+table+"?select=*&limit=1", anonKey, userJWT)
		})
	}
}

func assertDenied(t *testing.T, client *http.Client, url, anonKey, bearer string) {
	t.Helper()
	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("apikey", anonKey)
	req.Header.Set("Accept-Profile", "app")
	req.Header.Set("Content-Profile", "app")
	if bearer != "" {
		req.Header.Set("Authorization", "Bearer "+bearer)
	} else {
		req.Header.Set("Authorization", "Bearer "+anonKey)
	}

	res, err := client.Do(req)
	if err != nil {
		t.Fatalf("transport error (failure, not skip): %v", err)
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(res.Body)

	if res.StatusCode >= 200 && res.StatusCode < 300 {
		t.Fatalf("unexpected 2xx from PostgREST: status=%d body=%s", res.StatusCode, body)
	}
	if !acceptedDenial(res.StatusCode, body) {
		t.Fatalf("unlisted denial: status=%d body=%s", res.StatusCode, body)
	}
}

func acceptedDenial(status int, body []byte) bool {
	// Gateway 404 when Data API is disabled.
	if status == http.StatusNotFound {
		return true
	}
	if status == http.StatusUnauthorized || status == http.StatusForbidden {
		return true
	}
	var payload struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	}
	if err := json.Unmarshal(body, &payload); err == nil {
		if payload.Code == "PGRST106" || payload.Code == "42501" {
			return true
		}
		// Data API off / schema cache unusable — PostgREST reachable but not serving.
		if status == http.StatusServiceUnavailable && payload.Code == "PGRST002" {
			return true
		}
		if strings.Contains(strings.ToLower(payload.Message), "schema must be one of") {
			return true
		}
	}
	return false
}

func TestAcceptedDenialPGRST002(t *testing.T) {
	body := []byte(`{"code":"PGRST002","message":"Could not query the database for the schema cache. Retrying."}`)
	if !acceptedDenial(http.StatusServiceUnavailable, body) {
		t.Fatal("503 + PGRST002 must be an accepted denial")
	}
	if acceptedDenial(http.StatusOK, body) {
		t.Fatal("2xx must never be accepted even with a denial-shaped body")
	}
}
