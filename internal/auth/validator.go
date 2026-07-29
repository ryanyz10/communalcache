package auth

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/lestrrat-go/httprc/v3"
	"github.com/lestrrat-go/jwx/v3/jwa"
	"github.com/lestrrat-go/jwx/v3/jwk"
	"github.com/lestrrat-go/jwx/v3/jws"
	"github.com/lestrrat-go/jwx/v3/jwt"
)

const (
	minForcedRefresh = 30 * time.Second
	jwksHTTPTimeout  = 10 * time.Second
)

// Claims are the verified identity fields we trust after validation.
type Claims struct {
	Subject string
	Email   string
}

// Validator verifies Supabase JWTs against a cached JWKS.
type Validator struct {
	issuer  string
	jwksURL string
	cache   *jwk.Cache

	mu           sync.Mutex
	lastForcedAt time.Time
}

func NewValidator(ctx context.Context, supabaseURL string) (*Validator, error) {
	if supabaseURL == "" {
		return nil, fmt.Errorf("supabase URL is required")
	}
	jwksURL := supabaseURL + "/auth/v1/.well-known/jwks.json"
	httpClient := &http.Client{Timeout: jwksHTTPTimeout}
	cache, err := jwk.NewCache(ctx, httprc.NewClient(httprc.WithHTTPClient(httpClient)))
	if err != nil {
		return nil, fmt.Errorf("jwks cache: %w", err)
	}
	if err := cache.Register(ctx, jwksURL,
		jwk.WithMinInterval(15*time.Minute),
		jwk.WithHTTPClient(httpClient),
	); err != nil {
		return nil, fmt.Errorf("register jwks: %w", err)
	}
	return &Validator{
		issuer:  supabaseURL + "/auth/v1",
		jwksURL: jwksURL,
		cache:   cache,
	}, nil
}

func (v *Validator) Validate(ctx context.Context, raw string) (Claims, error) {
	claims, err := v.validateOnce(ctx, raw)
	if err == nil {
		return claims, nil
	}
	if !isUnknownKid(err) {
		return Claims{}, err
	}
	if !v.tryForcedRefresh(ctx) {
		return Claims{}, err
	}
	return v.validateOnce(ctx, raw)
}

func (v *Validator) tryForcedRefresh(ctx context.Context) bool {
	v.mu.Lock()
	defer v.mu.Unlock()
	if time.Since(v.lastForcedAt) < minForcedRefresh {
		return false
	}
	if _, err := v.cache.Refresh(ctx, v.jwksURL); err != nil {
		return false
	}
	v.lastForcedAt = time.Now()
	return true
}

func (v *Validator) validateOnce(ctx context.Context, raw string) (Claims, error) {
	msg, err := jws.Parse([]byte(raw))
	if err != nil {
		return Claims{}, fmt.Errorf("parse jws: %w", err)
	}
	sigs := msg.Signatures()
	if len(sigs) != 1 {
		return Claims{}, fmt.Errorf("expected exactly one signature")
	}
	alg, ok := sigs[0].ProtectedHeaders().Algorithm()
	if !ok {
		return Claims{}, fmt.Errorf("missing alg")
	}
	if alg != jwa.ES256() && alg != jwa.RS256() {
		return Claims{}, fmt.Errorf("alg %s not allowed", alg)
	}

	set, err := v.cache.Lookup(ctx, v.jwksURL)
	if err != nil {
		return Claims{}, fmt.Errorf("jwks lookup: %w", err)
	}

	// Deliberately do not pass jws.WithInferAlgorithmFromKey — jwx must
	// enforce each JWK's own alg, rejecting alg=none and HS256 confusion.
	tok, err := jwt.Parse([]byte(raw),
		jwt.WithKeySet(set),
		jwt.WithIssuer(v.issuer),
		jwt.WithAudience("authenticated"),
		jwt.WithAcceptableSkew(30*time.Second),
		jwt.WithRequiredClaim(jwt.ExpirationKey),
	)
	if err != nil {
		return Claims{}, err
	}

	sub, ok := tok.Subject()
	if !ok || sub == "" {
		return Claims{}, fmt.Errorf("missing sub")
	}
	var email string
	if err := tok.Get("email", &email); err != nil || email == "" {
		return Claims{}, fmt.Errorf("missing email")
	}
	return Claims{Subject: sub, Email: email}, nil
}

func isUnknownKid(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	for _, n := range []string{"key id", "kid", "key not found", "failed to find key", "no key found"} {
		if strings.Contains(msg, n) {
			return true
		}
	}
	return false
}
