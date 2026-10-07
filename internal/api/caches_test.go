package api

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ryanzhou/communalcache/internal/db"
)

func TestCachesAuthorizationMatrix(t *testing.T) {
	pool, validator, issuer, priv := setupAPI(t)
	handler := (&Server{Pool: pool, Auth: validator}).Routes()
	ownerID := cacheTestUser(t, pool, "Owner")
	ownerToken := signAPI(t, priv, issuer, ownerID, ownerID+"@example.com")
	created := cacheRequest(handler, ownerToken, "POST", "/api/caches", `{"name":"Neighbors"}`)
	if created.Code != http.StatusCreated {
		t.Fatalf("create: %d %s", created.Code, created.Body.String())
	}
	cache := cacheResponse(t, created)

	otherOwner := cacheTestUser(t, pool, "Other owner")
	otherCache, err := db.CreateCache(context.Background(), pool, otherOwner, "Other cache", "other-token", false)
	if err != nil {
		t.Fatal(err)
	}
	roles := []struct {
		name, membership string
		read, write      int
	}{
		{"non-member", "", 404, 404},
		{"pending", "pending", 404, 404},
		{"removed", "removed", 404, 404},
		{"active", "active", 200, 404},
		{"owner", "active", 200, 200},
	}
	for _, role := range roles {
		t.Run(role.name, func(t *testing.T) {
			id := ownerID
			if role.name != "owner" {
				id = cacheTestUser(t, pool, role.name)
				if role.membership != "" {
					_, err := pool.Exec(context.Background(), `INSERT INTO app.cache_members (cache_id, user_id, status) VALUES ($1, $2, $3)`, cache.ID, id, role.membership)
					if err != nil {
						t.Fatal(err)
					}
				}
			}
			token := signAPI(t, priv, issuer, id, id+"@example.com")
			paths := []struct {
				method, suffix, body string
				want                 int
			}{
				{"GET", "", "", role.read},
				{"PATCH", "", `{"name":"Updated"}`, role.write},
				{"POST", "/invite/rotate", "", role.write},
			}
			for _, path := range paths {
				t.Run(path.method+path.suffix, func(t *testing.T) {
					w := cacheRequest(handler, token, path.method, "/api/caches/"+cache.ID+path.suffix, path.body)
					if w.Code != path.want {
						t.Fatalf("status=%d want=%d body=%s", w.Code, path.want, w.Body.String())
					}
					if strings.Contains(w.Body.String(), "email") || strings.Contains(w.Body.String(), "@example.com") {
						t.Fatalf("email leaked: %s", w.Body.String())
					}
					cross := cacheRequest(handler, token, path.method, "/api/caches/"+otherCache.ID+path.suffix, path.body)
					if cross.Code != http.StatusNotFound {
						t.Fatalf("cross-cache: %d %s", cross.Code, cross.Body.String())
					}
					for _, invalidID := range []string{"not-a-uuid", uuid.NewString()} {
						missing := cacheRequest(handler, token, path.method, "/api/caches/"+invalidID+path.suffix, path.body)
						if missing.Code != http.StatusNotFound {
							t.Fatalf("missing/malformed id %q: %d %s", invalidID, missing.Code, missing.Body.String())
						}
					}
				})
			}
		})
	}

	// Owner authority alone must not bypass active membership.
	if _, err := pool.Exec(context.Background(), `UPDATE app.cache_members SET status='removed' WHERE cache_id=$1 AND user_id=$2`, cache.ID, ownerID); err != nil {
		t.Fatal(err)
	}
	for _, path := range []struct{ method, suffix, body string }{
		{"GET", "", ""}, {"PATCH", "", `{"name":"Blocked"}`}, {"POST", "/invite/rotate", ""},
	} {
		w := cacheRequest(handler, ownerToken, path.method, "/api/caches/"+cache.ID+path.suffix, path.body)
		if w.Code != http.StatusNotFound {
			t.Fatalf("removed owner %s: %d", path.method, w.Code)
		}
	}
}

func TestCachesCreateListDetailAndOwnerSettings(t *testing.T) {
	pool, validator, issuer, priv := setupAPI(t)
	handler := (&Server{Pool: pool, Auth: validator}).Routes()
	ownerID := cacheTestUser(t, pool, "Ada")
	token := signAPI(t, priv, issuer, ownerID, ownerID+"@example.com")
	w := cacheRequest(handler, token, "GET", "/api/caches", "")
	if w.Code != http.StatusOK || strings.TrimSpace(w.Body.String()) != "[]" {
		t.Fatalf("empty list: %d %s", w.Code, w.Body.String())
	}
	w = cacheRequest(handler, token, "POST", "/api/caches", `{"name":"  Neighbors  ","requires_approval":true}`)
	if w.Code != http.StatusCreated {
		t.Fatalf("create: %d %s", w.Code, w.Body.String())
	}
	cache := cacheResponse(t, w)
	if cache.Name != "Neighbors" || cache.OwnerID != ownerID || !cache.RequiresApproval {
		t.Fatalf("created=%+v", cache)
	}
	checkInviteToken(t, cache.InviteToken)
	var status string
	if err := pool.QueryRow(context.Background(), `SELECT status FROM app.cache_members WHERE cache_id=$1 AND user_id=$2`, cache.ID, ownerID).Scan(&status); err != nil || status != "active" {
		t.Fatalf("owner membership=%q err=%v", status, err)
	}

	activeID := cacheTestUser(t, pool, "Grace")
	for _, membership := range []struct{ id, status string }{
		{activeID, "active"}, {cacheTestUser(t, pool, "Waiting"), "pending"}, {cacheTestUser(t, pool, "Removed"), "removed"},
	} {
		if _, err := pool.Exec(context.Background(), `INSERT INTO app.cache_members (cache_id, user_id, status) VALUES ($1,$2,$3)`, cache.ID, membership.id, membership.status); err != nil {
			t.Fatal(err)
		}
	}
	w = cacheRequest(handler, token, "GET", "/api/caches/"+cache.ID, "")
	if w.Code != http.StatusOK {
		t.Fatalf("detail: %d %s", w.Code, w.Body.String())
	}
	detail := cacheResponse(t, w)
	if len(detail.Members) != 2 {
		t.Fatalf("active members only: %+v", detail.Members)
	}
	for _, member := range detail.Members {
		if member.UserID != ownerID && member.UserID != activeID {
			t.Fatalf("unexpected member: %+v", member)
		}
		if member.DisplayName == nil {
			t.Fatal("display name missing")
		}
	}
	if strings.Contains(w.Body.String(), "email") || strings.Contains(w.Body.String(), "@example.com") {
		t.Fatalf("email leaked: %s", w.Body.String())
	}

	otherOwner := cacheTestUser(t, pool, "Other owner")
	for _, membership := range []string{"pending", "removed", ""} {
		other, err := db.CreateCache(context.Background(), pool, otherOwner, membership+" cache", membership+"-token", false)
		if err != nil {
			t.Fatal(err)
		}
		if membership != "" {
			if _, err := pool.Exec(context.Background(), `INSERT INTO app.cache_members (cache_id,user_id,status) VALUES ($1,$2,$3)`, other.ID, ownerID, membership); err != nil {
				t.Fatal(err)
			}
		}
	}
	w = cacheRequest(handler, token, "GET", "/api/caches", "")
	var listed []db.Cache
	if w.Code != http.StatusOK || json.Unmarshal(w.Body.Bytes(), &listed) != nil || len(listed) != 1 || listed[0].ID != cache.ID {
		t.Fatalf("active memberships only: %d %s", w.Code, w.Body.String())
	}

	w = cacheRequest(handler, token, "PATCH", "/api/caches/"+cache.ID, `{"name":"  Pantry  "}`)
	if w.Code != http.StatusOK {
		t.Fatalf("rename: %d %s", w.Code, w.Body.String())
	}
	renamed := cacheResponse(t, w)
	if renamed.Name != "Pantry" || !renamed.RequiresApproval || renamed.InviteToken != cache.InviteToken {
		t.Fatalf("rename changed omitted fields: %+v", renamed)
	}
	w = cacheRequest(handler, token, "PATCH", "/api/caches/"+cache.ID, `{"requires_approval":false}`)
	if w.Code != http.StatusOK {
		t.Fatalf("approval toggle: %d %s", w.Code, w.Body.String())
	}
	patched := cacheResponse(t, w)
	if patched.RequiresApproval || patched.Name != "Pantry" {
		t.Fatalf("toggle changed omitted name: %+v", patched)
	}
	w = cacheRequest(handler, token, "POST", "/api/caches/"+cache.ID+"/invite/rotate", "")
	if w.Code != http.StatusOK {
		t.Fatalf("rotate: %d %s", w.Code, w.Body.String())
	}
	rotated := cacheResponse(t, w)
	checkInviteToken(t, rotated.InviteToken)
	if rotated.InviteToken == cache.InviteToken {
		t.Fatal("rotation did not change the token")
	}
	w = cacheRequest(handler, token, "GET", "/api/caches/"+cache.ID, "")
	if cacheResponse(t, w).InviteToken != rotated.InviteToken {
		t.Fatal("rotation was not persisted")
	}
	activeToken := signAPI(t, priv, issuer, activeID, activeID+"@example.com")
	w = cacheRequest(handler, activeToken, "GET", "/api/caches/"+cache.ID, "")
	if w.Code != http.StatusOK || cacheResponse(t, w).InviteToken != rotated.InviteToken {
		t.Fatalf("active member cannot share invite: %d %s", w.Code, w.Body.String())
	}
}

func TestCachesValidationAndProfileGate(t *testing.T) {
	pool, validator, issuer, priv := setupAPI(t)
	handler := (&Server{Pool: pool, Auth: validator}).Routes()
	id := cacheTestUser(t, pool, "Ada")
	token := signAPI(t, priv, issuer, id, id+"@example.com")
	created := cacheRequest(handler, token, "POST", "/api/caches", `{"name":"Valid"}`)
	if created.Code != http.StatusCreated {
		t.Fatalf("create: %d %s", created.Code, created.Body.String())
	}
	cache := cacheResponse(t, created)
	for _, body := range []string{`{}`, `null`, `{"name":null}`, `{"name":"   "}`, `{"name":7}`, `{"name":"` + strings.Repeat("é", 61) + `"}`, `{"name":"Valid","owner_id":"` + uuid.NewString() + `"}`, `{"name":"Valid","invite_token":"chosen"}`, `{"name":"Valid"} {}`, `{"name":"Valid","requires_approval":"yes"}`} {
		for _, path := range []struct{ method, url string }{{"POST", "/api/caches"}, {"PATCH", "/api/caches/" + cache.ID}} {
			w := cacheRequest(handler, token, path.method, path.url, body)
			if w.Code != http.StatusBadRequest {
				t.Errorf("%s %s: status=%d body=%s", path.method, body, w.Code, w.Body.String())
			}
		}
	}
	for _, method := range []string{"POST", "PATCH"} {
		path := "/api/caches"
		if method == "PATCH" {
			path += "/" + cache.ID
		}
		w := cacheRequest(handler, token, method, path, `{"name":"`+strings.Repeat("é", 60)+`"}`)
		if w.Code != map[string]int{"POST": 201, "PATCH": 200}[method] {
			t.Fatalf("60 runes %s: %d %s", method, w.Code, w.Body.String())
		}
		w = cacheRequest(handler, token, method, path, `{"name":"`+strings.Repeat("a", maxJSONBody)+`"}`)
		if w.Code != http.StatusRequestEntityTooLarge {
			t.Fatalf("body cap %s: %d", method, w.Code)
		}
	}
	paths := []struct{ method, url, body string }{
		{"GET", "/api/caches", ""}, {"POST", "/api/caches", `{"name":"Valid"}`},
		{"GET", "/api/caches/" + cache.ID, ""}, {"PATCH", "/api/caches/" + cache.ID, `{"name":"Valid"}`},
		{"POST", "/api/caches/" + cache.ID + "/invite/rotate", ""},
	}
	for _, path := range paths {
		for _, invalidToken := range []string{"", "not-a-jwt"} {
			w := cacheRequest(handler, invalidToken, path.method, path.url, path.body)
			if w.Code != http.StatusUnauthorized {
				t.Fatalf("unauthenticated %s %s: %d", path.method, path.url, w.Code)
			}
		}
	}
	if _, err := pool.Exec(context.Background(), `UPDATE app.users SET display_name=NULL WHERE id=$1`, id); err != nil {
		t.Fatal(err)
	}
	for _, path := range paths {
		w := cacheRequest(handler, token, path.method, path.url, path.body)
		want := http.StatusConflict
		if path.method == "GET" {
			want = http.StatusOK
		}
		if w.Code != want {
			t.Fatalf("profile gate %s %s: %d %s", path.method, path.url, w.Code, w.Body.String())
		}
	}
}

func TestCreateCacheRollsBackWithoutOwnerMembership(t *testing.T) {
	pool, _, _, _ := setupAPI(t)
	ownerID := cacheTestUser(t, pool, "Ada")
	// Fail the second insert, after the cache row exists inside the transaction.
	if _, err := pool.Exec(context.Background(), `ALTER TABLE app.cache_members ADD CONSTRAINT fail_membership CHECK (status <> 'active')`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.CreateCache(context.Background(), pool, ownerID, "Must roll back", "rollback-token", false); err == nil {
		t.Fatal("expected membership insertion failure")
	}
	var caches, memberships int
	if err := pool.QueryRow(context.Background(), `SELECT (SELECT count(*) FROM app.caches), (SELECT count(*) FROM app.cache_members)`).Scan(&caches, &memberships); err != nil {
		t.Fatal(err)
	}
	if caches != 0 || memberships != 0 {
		t.Fatalf("partial create survived: caches=%d memberships=%d", caches, memberships)
	}
}

func cacheTestUser(t *testing.T, pool *pgxpool.Pool, name string) string {
	t.Helper()
	id := uuid.NewString()
	if _, err := pool.Exec(context.Background(), `INSERT INTO app.users (id,email,display_name) VALUES ($1,$2,$3)`, id, id+"@example.com", name); err != nil {
		t.Fatal(err)
	}
	return id
}

func cacheRequest(handler http.Handler, token, method, path, body string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, path, strings.NewReader(body))
	if token != "" {
		r.Header.Set("Authorization", "Bearer "+token)
	}
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)
	return w
}

func cacheResponse(t *testing.T, w *httptest.ResponseRecorder) db.CacheDetail {
	t.Helper()
	var cache db.CacheDetail
	if err := json.Unmarshal(w.Body.Bytes(), &cache); err != nil {
		t.Fatal(err)
	}
	return cache
}

func checkInviteToken(t *testing.T, token string) {
	t.Helper()
	bytes, err := base64.RawURLEncoding.DecodeString(token)
	if err != nil || len(bytes) != 32 || len(token) != 43 {
		t.Fatalf("invalid invite token: %q len=%d err=%v", token, len(bytes), err)
	}
}
