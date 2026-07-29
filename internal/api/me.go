package api

import (
	"net/http"
	"strings"
	"unicode/utf8"

	"github.com/ryanzhou/communalcache/internal/auth"
)

const maxDisplayName = 60

func (s *Server) getMe(w http.ResponseWriter, r *http.Request) {
	u, ok := auth.UserFrom(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	writeJSON(w, http.StatusOK, meResponse{
		ID:          u.ID,
		Email:       u.Email,
		DisplayName: u.DisplayName,
	})
}

type patchMeBody struct {
	DisplayName *string `json:"display_name"`
}

func (s *Server) patchMe(w http.ResponseWriter, r *http.Request) {
	u, ok := auth.UserFrom(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	var body patchMeBody
	if !decodeJSON(w, r, &body) {
		return
	}
	if body.DisplayName == nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	name := strings.TrimSpace(*body.DisplayName)
	if name == "" {
		writeError(w, http.StatusBadRequest, "invalid_display_name")
		return
	}
	if utf8.RuneCountInString(name) > maxDisplayName {
		writeError(w, http.StatusBadRequest, "invalid_display_name")
		return
	}

	var out struct {
		ID          string `json:"id"`
		DisplayName string `json:"display_name"`
	}
	err := s.Pool.QueryRow(r.Context(), `
		UPDATE app.users SET display_name = $2
		WHERE id = $1
		RETURNING id::text, display_name
	`, u.ID, name).Scan(&out.ID, &out.DisplayName)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal")
		return
	}
	// No email — GET /api/me is the only route that returns one.
	writeJSON(w, http.StatusOK, map[string]string{
		"id":           out.ID,
		"display_name": out.DisplayName,
	})
}

type meResponse struct {
	ID          string  `json:"id"`
	Email       string  `json:"email"`
	DisplayName *string `json:"display_name"`
}
