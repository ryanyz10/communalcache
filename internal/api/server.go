package api

import (
	"encoding/json"
	"net/http"

	"github.com/ryanzhou/communalcache/internal/config"
)

type Server struct {
	Cfg config.Config
}

func (s *Server) Routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/healthz", s.healthz)
	mux.HandleFunc("GET /api/config", s.publicConfig)
	return mux
}

func (s *Server) healthz(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

func (s *Server) publicConfig(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]string{
		"supabase_url":      s.Cfg.SupabaseURL,
		"supabase_anon_key": s.Cfg.SupabaseAnonKey,
		"vapid_public_key":  s.Cfg.VAPIDPublicKey,
	})
}
