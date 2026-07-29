package api

import (
	"context"
	"net/http"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ryanzhou/communalcache/internal/auth"
)

func (s *Server) requireAuth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		raw := bearerToken(r.Header.Get("Authorization"))
		if raw == "" {
			writeError(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		claims, err := s.Auth.Validate(r.Context(), raw)
		if err != nil {
			writeError(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		if _, err := uuid.Parse(claims.Subject); err != nil {
			writeError(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		if claims.Email == "" {
			writeError(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		user, err := upsertUser(r.Context(), s.Pool, claims.Subject, claims.Email)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "internal")
			return
		}
		next(w, r.WithContext(auth.WithUser(r.Context(), user)))
	}
}

// requireProfile gates cache/item/request mutations. Apply it to those routes
// only — PATCH /api/me and push routes stay outside it by construction.
func (s *Server) requireProfile(next http.HandlerFunc) http.HandlerFunc {
	return s.requireAuth(func(w http.ResponseWriter, r *http.Request) {
		u, ok := auth.UserFrom(r.Context())
		if !ok || u.DisplayName == nil || strings.TrimSpace(*u.DisplayName) == "" {
			writeError(w, http.StatusConflict, "profile_incomplete")
			return
		}
		next(w, r)
	})
}

func bearerToken(h string) string {
	const prefix = "Bearer "
	if len(h) < len(prefix) || !strings.EqualFold(h[:len(prefix)], prefix) {
		return ""
	}
	return strings.TrimSpace(h[len(prefix):])
}

func upsertUser(ctx context.Context, pool *pgxpool.Pool, id, email string) (auth.User, error) {
	var u auth.User
	var displayName *string
	err := pool.QueryRow(ctx, `
		INSERT INTO app.users (id, email) VALUES ($1, $2)
		ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email
		RETURNING id::text, email::text, display_name
	`, id, email).Scan(&u.ID, &u.Email, &displayName)
	if err != nil {
		return auth.User{}, err
	}
	u.DisplayName = displayName
	return u, nil
}
