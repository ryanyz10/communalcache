package api

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/lestrrat-go/jwx/v3/jwa"
	"github.com/lestrrat-go/jwx/v3/jwk"
	"github.com/lestrrat-go/jwx/v3/jwt"

	"github.com/ryanzhou/communalcache/internal/auth"
	"github.com/ryanzhou/communalcache/internal/config"
	"github.com/ryanzhou/communalcache/internal/db"
	"github.com/ryanzhou/communalcache/internal/dbtest"
)

func TestMeAndProfileGate(t *testing.T) {
	pool, validator, issuer, priv := setupAPI(t)
	srv := &Server{
		Cfg:  config.Config{SupabaseURL: "http://test", SupabaseAnonKey: "anon", AppBaseURL: "http://localhost:5173"},
		Pool: pool,
		Auth: validator,
	}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/me", srv.requireAuth(srv.getMe))
	mux.HandleFunc("PATCH /api/me", srv.requireAuth(srv.patchMe))
	mux.HandleFunc("POST /api/caches", srv.requireProfile(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))

	uid := uuid.NewString()
	token := signAPI(t, priv, issuer, uid, "ada@example.com")

	req := httptest.NewRequest(http.MethodPost, "/api/caches", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)
	if w.Code != http.StatusConflict {
		t.Fatalf("gated write status=%d body=%s", w.Code, w.Body.String())
	}

	req = httptest.NewRequest(http.MethodPatch, "/api/me", strings.NewReader(`{"display_name":"Ada"}`))
	req.Header.Set("Authorization", "Bearer "+token)
	w = httptest.NewRecorder()
	mux.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("patch me status=%d body=%s", w.Code, w.Body.String())
	}
	var patched map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &patched)
	if _, ok := patched["email"]; ok {
		t.Fatal("PATCH /api/me must not return email")
	}

	req = httptest.NewRequest(http.MethodPatch, "/api/me", strings.NewReader(`{"display_name":"`+strings.Repeat("a", 60)+`"}`))
	req.Header.Set("Authorization", "Bearer "+token)
	w = httptest.NewRecorder()
	mux.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("60 chars: %d", w.Code)
	}
	req = httptest.NewRequest(http.MethodPatch, "/api/me", strings.NewReader(`{"display_name":"`+strings.Repeat("a", 61)+`"}`))
	req.Header.Set("Authorization", "Bearer "+token)
	w = httptest.NewRecorder()
	mux.ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("61 chars: %d", w.Code)
	}

	req = httptest.NewRequest(http.MethodPatch, "/api/me", strings.NewReader(`{"display_name":"  Bob  "}`))
	req.Header.Set("Authorization", "Bearer "+token)
	w = httptest.NewRecorder()
	mux.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("trim: %d %s", w.Code, w.Body.String())
	}
	_ = json.Unmarshal(w.Body.Bytes(), &patched)
	if patched["display_name"] != "Bob" {
		t.Fatalf("trimmed=%v", patched["display_name"])
	}
	req = httptest.NewRequest(http.MethodPatch, "/api/me", strings.NewReader(`{"display_name":"   "}`))
	req.Header.Set("Authorization", "Bearer "+token)
	w = httptest.NewRecorder()
	mux.ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("whitespace-only: %d", w.Code)
	}

	req = httptest.NewRequest(http.MethodGet, "/api/me", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w = httptest.NewRecorder()
	mux.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("get me: %d", w.Code)
	}
	var me map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &me)
	if me["display_name"] != "Bob" {
		t.Fatalf("display_name wiped: %v", me["display_name"])
	}

	req = httptest.NewRequest(http.MethodPost, "/api/caches", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w = httptest.NewRecorder()
	mux.ServeHTTP(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("gated after profile: %d", w.Code)
	}
}

func setupAPI(t *testing.T) (*pgxpool.Pool, *auth.Validator, string, jwk.Key) {
	t.Helper()
	pool := dbtest.Open(t)
	dbtest.ResetSchema(t, pool)
	ctx := context.Background()
	if err := db.Migrate(ctx, pool); err != nil {
		t.Fatal(err)
	}

	priv, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	privJWK, err := jwk.Import(priv)
	if err != nil {
		t.Fatal(err)
	}
	_ = privJWK.Set(jwk.KeyIDKey, "k1")
	_ = privJWK.Set(jwk.AlgorithmKey, jwa.ES256())
	pub, err := privJWK.PublicKey()
	if err != nil {
		t.Fatal(err)
	}
	set := jwk.NewSet()
	_ = set.AddKey(pub)

	mux := http.NewServeMux()
	mux.HandleFunc("/auth/v1/.well-known/jwks.json", func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(set)
	})
	hs := httptest.NewServer(mux)
	t.Cleanup(hs.Close)
	v, err := auth.NewValidator(ctx, hs.URL)
	if err != nil {
		t.Fatal(err)
	}
	return pool, v, hs.URL + "/auth/v1", privJWK
}

func signAPI(t *testing.T, priv jwk.Key, issuer, sub, email string) string {
	t.Helper()
	tok := jwt.New()
	_ = tok.Set(jwt.IssuerKey, issuer)
	_ = tok.Set(jwt.AudienceKey, []string{"authenticated"})
	_ = tok.Set(jwt.SubjectKey, sub)
	_ = tok.Set(jwt.ExpirationKey, time.Now().Add(time.Hour))
	_ = tok.Set("email", email)
	alg, _ := priv.Algorithm()
	b, err := jwt.Sign(tok, jwt.WithKey(alg, priv))
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}
