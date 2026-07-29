package api

import (
	"encoding/json"
	"net/http"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ryanzhou/communalcache/internal/auth"
	"github.com/ryanzhou/communalcache/internal/config"
)

type Server struct {
	Cfg  config.Config
	Pool *pgxpool.Pool
	Auth *auth.Validator
}

func (s *Server) Routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/healthz", s.healthz)
	mux.HandleFunc("GET /api/config", s.publicConfig)
	mux.HandleFunc("GET /api/me", s.requireAuth(s.getMe))
	mux.HandleFunc("PATCH /api/me", s.requireAuth(s.patchMe))
	return mux
}

func (s *Server) healthz(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) publicConfig(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{
		"supabase_url":      s.Cfg.SupabaseURL,
		"supabase_anon_key": s.Cfg.SupabaseAnonKey,
		"vapid_public_key":  s.Cfg.VAPIDPublicKey,
		"app_base_url":      s.Cfg.AppBaseURL,
	})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
