package api

import (
	"crypto/rand"
	"encoding/base64"
	"errors"
	"net/http"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ryanzhou/communalcache/internal/auth"
	"github.com/ryanzhou/communalcache/internal/db"
)

const maxCacheName = 60

func inviteToken() (string, error) {
	var bytes [32]byte
	if _, err := rand.Read(bytes[:]); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(bytes[:]), nil
}

func (s *Server) createCache(w http.ResponseWriter, r *http.Request) {
	u, _ := auth.UserFrom(r.Context())
	var body struct {
		Name             *string `json:"name"`
		RequiresApproval bool    `json:"requires_approval"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	if body.Name == nil {
		writeError(w, http.StatusBadRequest, "invalid_name")
		return
	}
	name := strings.TrimSpace(*body.Name)
	if name == "" || utf8.RuneCountInString(name) > maxCacheName {
		writeError(w, http.StatusBadRequest, "invalid_name")
		return
	}
	token, err := inviteToken()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal")
		return
	}
	cache, err := db.CreateCache(r.Context(), s.Pool, u.ID, name, token, body.RequiresApproval)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal")
		return
	}
	writeJSON(w, http.StatusCreated, cache)
}

func (s *Server) listCaches(w http.ResponseWriter, r *http.Request) {
	u, _ := auth.UserFrom(r.Context())
	caches, err := db.ListCaches(r.Context(), s.Pool, u.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal")
		return
	}
	writeJSON(w, http.StatusOK, caches)
}

func (s *Server) getCache(w http.ResponseWriter, r *http.Request) {
	u, _ := auth.UserFrom(r.Context())
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusNotFound, "not_found")
		return
	}
	cache, err := db.GetCache(r.Context(), s.Pool, id.String(), u.ID)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "not_found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal")
		return
	}
	writeJSON(w, http.StatusOK, cache)
}

func (s *Server) patchCache(w http.ResponseWriter, r *http.Request) {
	u, _ := auth.UserFrom(r.Context())
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusNotFound, "not_found")
		return
	}
	var body struct {
		Name             *string `json:"name"`
		RequiresApproval *bool   `json:"requires_approval"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	if body.Name == nil && body.RequiresApproval == nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	if body.Name != nil {
		name := strings.TrimSpace(*body.Name)
		if name == "" || utf8.RuneCountInString(name) > maxCacheName {
			writeError(w, http.StatusBadRequest, "invalid_name")
			return
		}
		body.Name = &name
	}
	cache, err := db.PatchCache(r.Context(), s.Pool, id.String(), u.ID, body.Name, body.RequiresApproval)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "not_found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal")
		return
	}
	writeJSON(w, http.StatusOK, cache)
}

func (s *Server) rotateCacheInvite(w http.ResponseWriter, r *http.Request) {
	u, _ := auth.UserFrom(r.Context())
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusNotFound, "not_found")
		return
	}
	token, err := inviteToken()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal")
		return
	}
	cache, err := db.RotateCacheInvite(r.Context(), s.Pool, id.String(), u.ID, token)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "not_found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal")
		return
	}
	writeJSON(w, http.StatusOK, cache)
}
