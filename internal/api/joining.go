package api

import (
	"errors"
	"net/http"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ryanzhou/communalcache/internal/auth"
	"github.com/ryanzhou/communalcache/internal/db"
)

func (s *Server) joinCache(w http.ResponseWriter, r *http.Request) {
	u, _ := auth.UserFrom(r.Context())
	result, err := db.JoinCache(r.Context(), s.Pool, r.PathValue("token"), u.ID)
	if errors.Is(err, db.ErrMembershipRemoved) {
		writeError(w, http.StatusForbidden, "membership_removed")
		return
	}
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "not_found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal")
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) listJoinRequests(w http.ResponseWriter, r *http.Request) {
	u, _ := auth.UserFrom(r.Context())
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusNotFound, "not_found")
		return
	}
	requests, err := db.ListJoinRequests(r.Context(), s.Pool, id.String(), u.ID)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "not_found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal")
		return
	}
	writeJSON(w, http.StatusOK, requests)
}

func (s *Server) approveJoinRequest(w http.ResponseWriter, r *http.Request) {
	u, _ := auth.UserFrom(r.Context())
	cacheID, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusNotFound, "not_found")
		return
	}
	userID, err := uuid.Parse(r.PathValue("userId"))
	if err != nil {
		writeError(w, http.StatusNotFound, "not_found")
		return
	}
	err = db.ApproveJoinRequest(r.Context(), s.Pool, cacheID.String(), u.ID, userID.String())
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "not_found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) rejectJoinRequest(w http.ResponseWriter, r *http.Request) {
	u, _ := auth.UserFrom(r.Context())
	cacheID, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusNotFound, "not_found")
		return
	}
	userID, err := uuid.Parse(r.PathValue("userId"))
	if err != nil {
		writeError(w, http.StatusNotFound, "not_found")
		return
	}
	err = db.RejectJoinRequest(r.Context(), s.Pool, cacheID.String(), u.ID, userID.String())
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "not_found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
