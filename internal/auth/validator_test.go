package auth_test

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/rsa"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/lestrrat-go/jwx/v3/jwa"
	"github.com/lestrrat-go/jwx/v3/jwk"
	"github.com/lestrrat-go/jwx/v3/jwt"

	"github.com/ryanzhou/communalcache/internal/auth"
)

type jwksFixture struct {
	hits atomic.Int64
	mu   sync.Mutex
	set  jwk.Set
	srv  *httptest.Server
}

func mustValidatorAt(t *testing.T, f *jwksFixture) *auth.Validator {
	t.Helper()
	if f.set == nil {
		f.set = jwk.NewSet()
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/auth/v1/.well-known/jwks.json", func(w http.ResponseWriter, r *http.Request) {
		f.hits.Add(1)
		f.mu.Lock()
		defer f.mu.Unlock()
		_ = json.NewEncoder(w).Encode(f.set)
	})
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	f.srv = srv
	v, err := auth.NewValidator(context.Background(), srv.URL)
	if err != nil {
		t.Fatalf("NewValidator: %v", err)
	}
	return v
}

func (f *jwksFixture) replaceKeys(keys ...jwk.Key) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.set = jwk.NewSet()
	for _, k := range keys {
		_ = f.set.AddKey(k)
	}
}

func ecdsaKey(t *testing.T, kid string) (jwk.Key, jwk.Key) {
	t.Helper()
	priv, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	privJWK, err := jwk.Import(priv)
	if err != nil {
		t.Fatal(err)
	}
	_ = privJWK.Set(jwk.KeyIDKey, kid)
	_ = privJWK.Set(jwk.AlgorithmKey, jwa.ES256())
	pubJWK, err := privJWK.PublicKey()
	if err != nil {
		t.Fatal(err)
	}
	return privJWK, pubJWK
}

func rsaKey(t *testing.T, kid string) (jwk.Key, jwk.Key) {
	t.Helper()
	priv, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	privJWK, err := jwk.Import(priv)
	if err != nil {
		t.Fatal(err)
	}
	_ = privJWK.Set(jwk.KeyIDKey, kid)
	_ = privJWK.Set(jwk.AlgorithmKey, jwa.RS256())
	pubJWK, err := privJWK.PublicKey()
	if err != nil {
		t.Fatal(err)
	}
	return privJWK, pubJWK
}

func signToken(t *testing.T, priv jwk.Key, issuer string, opts ...func(jwt.Token)) string {
	t.Helper()
	tok := jwt.New()
	_ = tok.Set(jwt.IssuerKey, issuer)
	_ = tok.Set(jwt.AudienceKey, []string{"authenticated"})
	_ = tok.Set(jwt.SubjectKey, uuid.NewString())
	_ = tok.Set(jwt.ExpirationKey, time.Now().Add(time.Hour))
	_ = tok.Set("email", "ada@example.com")
	for _, o := range opts {
		o(tok)
	}
	alg, _ := priv.Algorithm()
	signed, err := jwt.Sign(tok, jwt.WithKey(alg, priv))
	if err != nil {
		t.Fatal(err)
	}
	return string(signed)
}

func TestValidateES256AndRS256(t *testing.T) {
	esPriv, esPub := ecdsaKey(t, "es1")
	rsPriv, rsPub := rsaKey(t, "rs1")
	f := &jwksFixture{set: jwk.NewSet()}
	_ = f.set.AddKey(esPub)
	_ = f.set.AddKey(rsPub)
	v := mustValidatorAt(t, f)
	issuer := f.srv.URL + "/auth/v1"

	if _, err := v.Validate(context.Background(), signToken(t, esPriv, issuer)); err != nil {
		t.Fatalf("ES256: %v", err)
	}
	if _, err := v.Validate(context.Background(), signToken(t, rsPriv, issuer)); err != nil {
		t.Fatalf("RS256: %v", err)
	}
}

func TestValidateRejects(t *testing.T) {
	priv, pub := ecdsaKey(t, "k1")
	f := &jwksFixture{set: jwk.NewSet()}
	_ = f.set.AddKey(pub)
	v := mustValidatorAt(t, f)
	issuer := f.srv.URL + "/auth/v1"

	cases := []struct {
		name string
		tok  string
	}{
		{"wrong_iss", signToken(t, priv, "http://evil/auth/v1")},
		{"wrong_aud", signToken(t, priv, issuer, func(tok jwt.Token) {
			_ = tok.Set(jwt.AudienceKey, []string{"anon"})
		})},
		{"expired", signToken(t, priv, issuer, func(tok jwt.Token) {
			_ = tok.Set(jwt.ExpirationKey, time.Now().Add(-time.Hour))
		})},
		{"missing_exp", signToken(t, priv, issuer, func(tok jwt.Token) {
			_ = tok.Remove(jwt.ExpirationKey)
		})},
		{"missing_email", signToken(t, priv, issuer, func(tok jwt.Token) {
			_ = tok.Remove("email")
		})},
		{"missing_sub", signToken(t, priv, issuer, func(tok jwt.Token) {
			_ = tok.Remove(jwt.SubjectKey)
		})},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := v.Validate(context.Background(), tc.tok); err == nil {
				t.Fatal("expected rejection")
			}
		})
	}
}

func TestValidateRejectsAlgNoneAndHS256(t *testing.T) {
	_, pub := ecdsaKey(t, "k1")
	f := &jwksFixture{set: jwk.NewSet()}
	_ = f.set.AddKey(pub)
	v := mustValidatorAt(t, f)
	issuer := f.srv.URL + "/auth/v1"

	tok := jwt.New()
	_ = tok.Set(jwt.IssuerKey, issuer)
	_ = tok.Set(jwt.AudienceKey, []string{"authenticated"})
	_ = tok.Set(jwt.SubjectKey, uuid.NewString())
	_ = tok.Set(jwt.ExpirationKey, time.Now().Add(time.Hour))
	_ = tok.Set("email", "ada@example.com")

	none, err := jwt.Sign(tok, jwt.WithKey(jwa.NoSignature(), nil))
	if err == nil {
		if _, err := v.Validate(context.Background(), string(none)); err == nil {
			t.Fatal("alg=none should be rejected")
		}
	}

	hsKey, err := jwk.Import([]byte("not-a-real-hmac-secret-value!!"))
	if err != nil {
		t.Fatal(err)
	}
	_ = hsKey.Set(jwk.KeyIDKey, "k1")
	_ = hsKey.Set(jwk.AlgorithmKey, jwa.HS256())
	hs, err := jwt.Sign(tok, jwt.WithKey(jwa.HS256(), hsKey))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := v.Validate(context.Background(), string(hs)); err == nil {
		t.Fatal("HS256 should be rejected")
	}
}

func TestValidateRejectsHeaderAlgMismatch(t *testing.T) {
	// JWK advertises ES256; token is signed RS256 with a different key sharing kid.
	_, esPub := ecdsaKey(t, "shared")
	rsPriv, _ := rsaKey(t, "shared")
	f := &jwksFixture{set: jwk.NewSet()}
	_ = f.set.AddKey(esPub)
	v := mustValidatorAt(t, f)
	issuer := f.srv.URL + "/auth/v1"
	tok := signToken(t, rsPriv, issuer)
	if _, err := v.Validate(context.Background(), tok); err == nil {
		t.Fatal("header alg mismatching JWK alg should be rejected")
	}
}

func TestValidateRotation(t *testing.T) {
	oldPriv, oldPub := ecdsaKey(t, "old")
	newPriv, newPub := ecdsaKey(t, "new")
	f := &jwksFixture{set: jwk.NewSet()}
	_ = f.set.AddKey(oldPub)
	v := mustValidatorAt(t, f)
	issuer := f.srv.URL + "/auth/v1"

	if _, err := v.Validate(context.Background(), signToken(t, oldPriv, issuer)); err != nil {
		t.Fatalf("warm: %v", err)
	}
	hitsAfterWarm := f.hits.Load()

	f.replaceKeys(newPub)
	rotated := signToken(t, newPriv, issuer)
	if _, err := v.Validate(context.Background(), rotated); err != nil {
		t.Fatalf("rotation: %v", err)
	}
	if f.hits.Load() <= hitsAfterWarm {
		t.Fatal("expected a JWKS refetch after unknown kid")
	}
}

func TestValidateConcurrentUnknownKidRateLimit(t *testing.T) {
	oldPriv, oldPub := ecdsaKey(t, "old")
	newPriv, newPub := ecdsaKey(t, "new")
	f := &jwksFixture{set: jwk.NewSet()}
	_ = f.set.AddKey(oldPub)
	v := mustValidatorAt(t, f)
	issuer := f.srv.URL + "/auth/v1"
	if _, err := v.Validate(context.Background(), signToken(t, oldPriv, issuer)); err != nil {
		t.Fatal(err)
	}
	f.replaceKeys(newPub)
	hitsBefore := f.hits.Load()

	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, _ = v.Validate(context.Background(), signToken(t, newPriv, issuer))
		}()
	}
	wg.Wait()
	refetches := f.hits.Load() - hitsBefore
	if refetches > 2 {
		t.Fatalf("too many JWKS hits during cooldown: %d", refetches)
	}
}
