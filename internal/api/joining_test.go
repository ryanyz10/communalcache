package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ryanzhou/communalcache/internal/db"
)

func TestJoinRequestsAuthorizationMatrix(t *testing.T) {
	pool, validator, issuer, priv := setupAPI(t)
	handler := (&Server{Pool: pool, Auth: validator}).Routes()
	ownerID := cacheTestUser(t, pool, "Owner")
	cache, err := db.CreateCache(context.Background(), pool, ownerID, "Gated", "gated-token", true)
	if err != nil {
		t.Fatal(err)
	}
	otherOwner := cacheTestUser(t, pool, "Other owner")
	other, err := db.CreateCache(context.Background(), pool, otherOwner, "Other", "other-token", true)
	if err != nil {
		t.Fatal(err)
	}
	approveID := cacheTestUser(t, pool, "Approve me")
	rejectID := cacheTestUser(t, pool, "Reject me")
	for _, cacheID := range []string{cache.ID, other.ID} {
		for _, id := range []string{approveID, rejectID} {
			if _, err := pool.Exec(context.Background(), `INSERT INTO app.cache_members (cache_id,user_id,status) VALUES ($1,$2,'pending')`, cacheID, id); err != nil {
				t.Fatal(err)
			}
		}
	}
	for _, role := range []string{"non-member", "pending", "removed", "active", "owner"} {
		t.Run(role, func(t *testing.T) {
			id := ownerID
			if role != "owner" {
				id = cacheTestUser(t, pool, role)
				if role != "non-member" {
					if _, err := pool.Exec(context.Background(), `INSERT INTO app.cache_members (cache_id,user_id,status) VALUES ($1,$2,$3)`, cache.ID, id, role); err != nil {
						t.Fatal(err)
					}
				}
			}
			token := signAPI(t, priv, issuer, id, id+"@example.com")
			for _, path := range []struct{ method, suffix string }{
				{"GET", "/join-requests"}, {"POST", "/join-requests/" + approveID + "/approve"}, {"POST", "/join-requests/" + rejectID + "/reject"},
			} {
				t.Run(path.suffix, func(t *testing.T) {
					w := cacheRequest(handler, token, path.method, "/api/caches/"+cache.ID+path.suffix, "")
					want := http.StatusNotFound
					if role == "owner" {
						want = http.StatusNoContent
						if path.method == "GET" {
							want = http.StatusOK
							var queue []db.JoinRequest
							if err := json.Unmarshal(w.Body.Bytes(), &queue); err != nil || len(queue) < 2 {
								t.Fatalf("queue=%s err=%v", w.Body.String(), err)
							}
							for _, entry := range queue {
								if entry.UserID == "" || entry.DisplayName == nil || entry.CreatedAt.IsZero() {
									t.Fatalf("incomplete queue entry: %+v", entry)
								}
							}
						}
					}
					if w.Code != want {
						t.Fatalf("status=%d want=%d body=%s", w.Code, want, w.Body.String())
					}
					if strings.Contains(w.Body.String(), "email") || strings.Contains(w.Body.String(), "@example.com") {
						t.Fatalf("email leaked: %s", w.Body.String())
					}
					for _, cacheID := range []string{other.ID, uuid.NewString(), "not-a-uuid"} {
						missing := cacheRequest(handler, token, path.method, "/api/caches/"+cacheID+path.suffix, "")
						if missing.Code != http.StatusNotFound {
							t.Fatalf("cross-cache/missing/malformed %s: %d", cacheID, missing.Code)
						}
					}
				})
			}
		})
	}
	ownerToken := signAPI(t, priv, issuer, ownerID, ownerID+"@example.com")
	for _, decision := range []string{"approve", "reject"} {
		for _, id := range []string{"not-a-uuid", uuid.NewString(), ownerID, approveID} {
			w := cacheRequest(handler, ownerToken, "POST", "/api/caches/"+cache.ID+"/join-requests/"+id+"/"+decision, "")
			if w.Code != http.StatusNotFound {
				t.Fatalf("invalid/non-pending target %s: %d %s", id, w.Code, w.Body.String())
			}
		}
	}
	if _, err := pool.Exec(context.Background(), `UPDATE app.cache_members SET status='removed' WHERE cache_id=$1 AND user_id=$2`, cache.ID, ownerID); err != nil {
		t.Fatal(err)
	}
	for _, path := range []struct{ method, suffix string }{
		{"GET", "/join-requests"}, {"POST", "/join-requests/" + rejectID + "/approve"}, {"POST", "/join-requests/" + rejectID + "/reject"},
	} {
		w := cacheRequest(handler, ownerToken, path.method, "/api/caches/"+cache.ID+path.suffix, "")
		if w.Code != http.StatusNotFound {
			t.Fatalf("inactive owner %s: %d", path.suffix, w.Code)
		}
	}
}

func TestJoiningLifecycleAndOutbox(t *testing.T) {
	pool, validator, issuer, priv := setupAPI(t)
	handler := (&Server{Pool: pool, Auth: validator}).Routes()
	ownerID := cacheTestUser(t, pool, "Ada")
	userID := cacheTestUser(t, pool, "Grace")
	ownerToken := signAPI(t, priv, issuer, ownerID, ownerID+"@example.com")
	token := signAPI(t, priv, issuer, userID, userID+"@example.com")
	open, err := db.CreateCache(context.Background(), pool, ownerID, "Open", "open-token", false)
	if err != nil {
		t.Fatal(err)
	}
	gated, err := db.CreateCache(context.Background(), pool, ownerID, "Gated", "gated-token", true)
	if err != nil {
		t.Fatal(err)
	}
	for attempt := 0; attempt < 2; attempt++ {
		w := cacheRequest(handler, token, "POST", "/api/join/open-token", "")
		var result db.JoinResult
		if w.Code != http.StatusOK || json.Unmarshal(w.Body.Bytes(), &result) != nil || result.CacheID != open.ID || result.Status != "active" {
			t.Fatalf("open join: %d %s", w.Code, w.Body.String())
		}
	}
	if events := joinOutbox(t, pool); len(events) != 0 {
		t.Fatalf("open join emitted events: %+v", events)
	}
	if w := cacheRequest(handler, token, "POST", "/api/join/unknown-token", ""); w.Code != http.StatusNotFound {
		t.Fatalf("unknown invite: %d", w.Code)
	}

	removedID := cacheTestUser(t, pool, "Removed")
	if _, err := pool.Exec(context.Background(), `INSERT INTO app.cache_members (cache_id,user_id,status) VALUES ($1,$2,'removed')`, gated.ID, removedID); err != nil {
		t.Fatal(err)
	}
	var before, after time.Time
	if err := pool.QueryRow(context.Background(), `SELECT created_at FROM app.cache_members WHERE cache_id=$1 AND user_id=$2`, gated.ID, removedID).Scan(&before); err != nil {
		t.Fatal(err)
	}
	removedToken := signAPI(t, priv, issuer, removedID, removedID+"@example.com")
	if w := cacheRequest(handler, removedToken, "POST", "/api/join/gated-token", ""); w.Code != http.StatusForbidden || !strings.Contains(w.Body.String(), "membership_removed") {
		t.Fatalf("removed join: %d %s", w.Code, w.Body.String())
	}
	var status string
	if err := pool.QueryRow(context.Background(), `SELECT status,created_at FROM app.cache_members WHERE cache_id=$1 AND user_id=$2`, gated.ID, removedID).Scan(&status, &after); err != nil || status != "removed" || !before.Equal(after) {
		t.Fatalf("removed row changed: status=%s created_at=%v err=%v", status, after, err)
	}

	for attempt := 0; attempt < 2; attempt++ {
		w := cacheRequest(handler, token, "POST", "/api/join/gated-token", "")
		var result db.JoinResult
		if w.Code != http.StatusOK || json.Unmarshal(w.Body.Bytes(), &result) != nil || result.CacheID != gated.ID || result.Status != "pending" {
			t.Fatalf("gated join: %d %s", w.Code, w.Body.String())
		}
	}
	if events := joinOutbox(t, pool); len(events) != 1 {
		t.Fatalf("repeated pending join events: %+v", events)
	}
	approval := false
	if _, err := db.PatchCache(context.Background(), pool, gated.ID, ownerID, nil, &approval); err != nil {
		t.Fatal(err)
	}
	if w := cacheRequest(handler, token, "POST", "/api/join/gated-token", ""); w.Code != http.StatusOK || !strings.Contains(w.Body.String(), `"pending"`) {
		t.Fatalf("pending membership changed with approval toggle: %d %s", w.Code, w.Body.String())
	}
	approval = true
	if _, err := db.PatchCache(context.Background(), pool, gated.ID, ownerID, nil, &approval); err != nil {
		t.Fatal(err)
	}
	base := "/api/caches/" + gated.ID + "/join-requests"
	if w := cacheRequest(handler, ownerToken, "POST", base+"/"+userID+"/reject", ""); w.Code != http.StatusNoContent {
		t.Fatalf("reject: %d %s", w.Code, w.Body.String())
	}
	if err := pool.QueryRow(context.Background(), `SELECT status FROM app.cache_members WHERE cache_id=$1 AND user_id=$2`, gated.ID, userID).Scan(&status); !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("rejected row survived: %s err=%v", status, err)
	}
	if w := cacheRequest(handler, token, "POST", "/api/join/gated-token", ""); w.Code != http.StatusOK || !strings.Contains(w.Body.String(), `"pending"`) {
		t.Fatalf("re-request: %d %s", w.Code, w.Body.String())
	}
	if w := cacheRequest(handler, ownerToken, "POST", base+"/"+userID+"/approve", ""); w.Code != http.StatusNoContent {
		t.Fatalf("approve: %d %s", w.Code, w.Body.String())
	}
	for _, decision := range []string{"approve", "reject"} {
		if w := cacheRequest(handler, ownerToken, "POST", base+"/"+userID+"/"+decision, ""); w.Code != http.StatusNotFound {
			t.Fatalf("second decision %s: %d", decision, w.Code)
		}
	}
	if w := cacheRequest(handler, token, "POST", "/api/join/gated-token", ""); w.Code != http.StatusOK || !strings.Contains(w.Body.String(), `"active"`) {
		t.Fatalf("approved rejoin: %d %s", w.Code, w.Body.String())
	}
	if w := cacheRequest(handler, ownerToken, "GET", base, ""); w.Code != http.StatusOK || strings.TrimSpace(w.Body.String()) != "[]" {
		t.Fatalf("empty queue: %d %s", w.Code, w.Body.String())
	}
	events := joinOutbox(t, pool)
	if len(events) != 4 {
		t.Fatalf("events=%+v", events)
	}
	keys := map[string]bool{}
	for i, kind := range []string{"join_requested", "join_rejected", "join_requested", "join_approved"} {
		event := events[i]
		recipient := userID
		if kind == "join_requested" {
			recipient = ownerID
		}
		if event.Kind != kind || len(event.Payload.RecipientUserIDs) != 1 || event.Payload.RecipientUserIDs[0] != recipient || event.Payload.CacheID != gated.ID || event.Payload.CacheName != "Gated" || event.Payload.UserID != userID || event.Payload.DisplayName == nil || *event.Payload.DisplayName != "Grace" {
			t.Fatalf("event %d=%+v", i, event)
		}
		if _, err := uuid.Parse(event.DedupeKey); err != nil || keys[event.DedupeKey] {
			t.Fatalf("attempt dedupe key reused/invalid: %q", event.DedupeKey)
		}
		keys[event.DedupeKey] = true
	}
	if _, err := db.RotateCacheInvite(context.Background(), pool, gated.ID, ownerID, "new-gated-token"); err != nil {
		t.Fatal(err)
	}
	if w := cacheRequest(handler, token, "POST", "/api/join/gated-token", ""); w.Code != http.StatusNotFound {
		t.Fatalf("old invite survived rotation: %d", w.Code)
	}
}

func TestJoiningConcurrentDoubleJoinAndDecisions(t *testing.T) {
	pool, _, _, _ := setupAPI(t)
	ownerID := cacheTestUser(t, pool, "Owner")
	userID := cacheTestUser(t, pool, "Requester")
	cache, err := db.CreateCache(context.Background(), pool, ownerID, "Gated", "gated-token", true)
	if err != nil {
		t.Fatal(err)
	}
	start := make(chan struct{})
	results := make(chan error, 12)
	for i := 0; i < cap(results); i++ {
		go func() {
			<-start
			result, err := db.JoinCache(context.Background(), pool, "gated-token", userID)
			if err == nil && (result.Status != "pending" || result.CacheID != cache.ID) {
				err = errors.New("unexpected concurrent join result")
			}
			results <- err
		}()
	}
	close(start)
	for i := 0; i < cap(results); i++ {
		if err := <-results; err != nil {
			t.Fatal(err)
		}
	}
	if events := joinOutbox(t, pool); len(events) != 1 {
		t.Fatalf("concurrent join emitted %d events", len(events))
	}
	start = make(chan struct{})
	for i := 0; i < 2; i++ {
		go func() {
			<-start
			results <- db.ApproveJoinRequest(context.Background(), pool, cache.ID, ownerID, userID)
		}()
	}
	close(start)
	succeeded, alreadyDecided := 0, 0
	for i := 0; i < 2; i++ {
		err := <-results
		if err == nil {
			succeeded++
		} else if errors.Is(err, pgx.ErrNoRows) {
			alreadyDecided++
		} else {
			t.Fatal(err)
		}
	}
	if succeeded != 1 || alreadyDecided != 1 || len(joinOutbox(t, pool)) != 2 {
		t.Fatalf("double approval: successes=%d alreadyDecided=%d", succeeded, alreadyDecided)
	}
}

func TestJoiningTransactionsRollback(t *testing.T) {
	for _, failure := range []string{"outbox-insert", "deferred-commit"} {
		t.Run(failure, func(t *testing.T) {
			pool, validator, issuer, priv := setupAPI(t)
			handler := (&Server{Pool: pool, Auth: validator}).Routes()
			ownerID := cacheTestUser(t, pool, "Owner")
			joinID := cacheTestUser(t, pool, "Join")
			approveID := cacheTestUser(t, pool, "Approve")
			rejectID := cacheTestUser(t, pool, "Reject")
			cache, err := db.CreateCache(context.Background(), pool, ownerID, "Gated", "gated-token", true)
			if err != nil {
				t.Fatal(err)
			}
			for _, id := range []string{approveID, rejectID} {
				if _, err := pool.Exec(context.Background(), `INSERT INTO app.cache_members (cache_id,user_id,status) VALUES ($1,$2,'pending')`, cache.ID, id); err != nil {
					t.Fatal(err)
				}
			}
			if failure == "outbox-insert" {
				_, err = pool.Exec(context.Background(), `ALTER TABLE app.outbox ADD CONSTRAINT block_events CHECK (kind = 'never')`)
			} else {
				_, err = pool.Exec(context.Background(), `
					CREATE FUNCTION app.fail_join_commit() RETURNS trigger LANGUAGE plpgsql AS $$
					BEGIN RAISE EXCEPTION 'forced commit failure'; END; $$;
					CREATE CONSTRAINT TRIGGER fail_join_commit AFTER INSERT OR UPDATE OR DELETE ON app.cache_members
					DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.fail_join_commit();
				`)
			}
			if err != nil {
				t.Fatal(err)
			}
			ownerToken := signAPI(t, priv, issuer, ownerID, ownerID+"@example.com")
			joinToken := signAPI(t, priv, issuer, joinID, joinID+"@example.com")
			for _, path := range []struct{ token, url string }{
				{joinToken, "/api/join/gated-token"},
				{ownerToken, "/api/caches/" + cache.ID + "/join-requests/" + approveID + "/approve"},
				{ownerToken, "/api/caches/" + cache.ID + "/join-requests/" + rejectID + "/reject"},
			} {
				w := cacheRequest(handler, path.token, "POST", path.url, "")
				if w.Code != http.StatusInternalServerError {
					t.Fatalf("forced rollback: %d %s", w.Code, w.Body.String())
				}
			}
			var status string
			if err := pool.QueryRow(context.Background(), `SELECT status FROM app.cache_members WHERE cache_id=$1 AND user_id=$2`, cache.ID, joinID).Scan(&status); !errors.Is(err, pgx.ErrNoRows) {
				t.Fatalf("rolled-back join survived: %s err=%v", status, err)
			}
			for _, id := range []string{approveID, rejectID} {
				if err := pool.QueryRow(context.Background(), `SELECT status FROM app.cache_members WHERE cache_id=$1 AND user_id=$2`, cache.ID, id).Scan(&status); err != nil || status != "pending" {
					t.Fatalf("rolled-back decision changed row: %s err=%v", status, err)
				}
			}
			if events := joinOutbox(t, pool); len(events) != 0 {
				t.Fatalf("rollback left events: %+v", events)
			}
		})
	}
}

func TestJoiningAuthAndProfileGate(t *testing.T) {
	pool, validator, issuer, priv := setupAPI(t)
	handler := (&Server{Pool: pool, Auth: validator}).Routes()
	ownerID := cacheTestUser(t, pool, "Owner")
	cache, err := db.CreateCache(context.Background(), pool, ownerID, "Gated", "gated-token", true)
	if err != nil {
		t.Fatal(err)
	}
	paths := []struct{ method, url string }{
		{"POST", "/api/join/gated-token"}, {"GET", "/api/caches/" + cache.ID + "/join-requests"},
		{"POST", "/api/caches/" + cache.ID + "/join-requests/" + uuid.NewString() + "/approve"},
		{"POST", "/api/caches/" + cache.ID + "/join-requests/" + uuid.NewString() + "/reject"},
	}
	for _, path := range paths {
		for _, token := range []string{"", "invalid-jwt"} {
			if w := cacheRequest(handler, token, path.method, path.url, ""); w.Code != http.StatusUnauthorized {
				t.Fatalf("auth gate %s: %d", path.url, w.Code)
			}
		}
	}
	if _, err := pool.Exec(context.Background(), `UPDATE app.users SET display_name=NULL WHERE id=$1`, ownerID); err != nil {
		t.Fatal(err)
	}
	token := signAPI(t, priv, issuer, ownerID, ownerID+"@example.com")
	for _, path := range paths {
		w := cacheRequest(handler, token, path.method, path.url, "")
		want := http.StatusConflict
		if path.method == "GET" {
			want = http.StatusOK
		}
		if w.Code != want {
			t.Fatalf("profile gate %s: %d %s", path.url, w.Code, w.Body.String())
		}
	}
}

type joinOutboxEvent struct {
	Kind, DedupeKey string
	Payload         struct {
		RecipientUserIDs []string `json:"recipient_user_ids"`
		CacheID          string   `json:"cache_id"`
		CacheName        string   `json:"cache_name"`
		UserID           string   `json:"user_id"`
		DisplayName      *string  `json:"display_name"`
	}
}

func joinOutbox(t *testing.T, pool *pgxpool.Pool) []joinOutboxEvent {
	t.Helper()
	rows, err := pool.Query(context.Background(), `SELECT kind,dedupe_key,payload FROM app.outbox ORDER BY created_at,id`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var events []joinOutboxEvent
	for rows.Next() {
		var event joinOutboxEvent
		var payload []byte
		if err := rows.Scan(&event.Kind, &event.DedupeKey, &payload); err != nil {
			t.Fatal(err)
		}
		if strings.Contains(string(payload), "email") || strings.Contains(string(payload), "@example.com") {
			t.Fatalf("outbox email leak: %s", payload)
		}
		if err := json.Unmarshal(payload, &event.Payload); err != nil {
			t.Fatal(err)
		}
		events = append(events, event)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	return events
}
