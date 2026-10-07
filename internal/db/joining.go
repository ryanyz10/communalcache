package db

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var ErrMembershipRemoved = errors.New("membership removed")

type JoinResult struct {
	CacheID string `json:"cache_id"`
	Status  string `json:"status"`
}

type JoinRequest struct {
	UserID      string    `json:"user_id"`
	DisplayName *string   `json:"display_name"`
	CreatedAt   time.Time `json:"created_at"`
}

type joinNotification struct {
	RecipientUserIDs []string `json:"recipient_user_ids"`
	CacheID          string   `json:"cache_id"`
	CacheName        string   `json:"cache_name"`
	UserID           string   `json:"user_id"`
	DisplayName      *string  `json:"display_name"`
}

func JoinCache(ctx context.Context, pool *pgxpool.Pool, token, userID string) (JoinResult, error) {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return JoinResult{}, err
	}
	defer tx.Rollback(ctx)

	inserted, err := tx.Exec(ctx, `
		INSERT INTO app.cache_members (cache_id, user_id, status)
		SELECT id, $2, CASE WHEN requires_approval THEN 'pending' ELSE 'active' END
		FROM app.caches WHERE invite_token = $1
		ON CONFLICT (cache_id, user_id) DO NOTHING
	`, token, userID)
	if err != nil {
		return JoinResult{}, err
	}

	var result JoinResult
	var ownerID string
	payload := joinNotification{UserID: userID}
	// A separate statement sees a concurrent insert that ON CONFLICT waited for.
	err = tx.QueryRow(ctx, `
		SELECT c.id::text, m.status, c.owner_id::text, c.name, u.display_name
		FROM app.caches c
		JOIN app.cache_members m ON m.cache_id = c.id AND m.user_id = $2
		JOIN app.users u ON u.id = m.user_id
		WHERE c.invite_token = $1
	`, token, userID).Scan(&result.CacheID, &result.Status, &ownerID, &payload.CacheName, &payload.DisplayName)
	if err != nil {
		return JoinResult{}, err
	}
	if result.Status == "removed" {
		return JoinResult{}, ErrMembershipRemoved
	}
	if inserted.RowsAffected() == 1 && result.Status == "pending" {
		payload.CacheID = result.CacheID
		payload.RecipientUserIDs = []string{ownerID}
		if err := enqueueJoinNotification(ctx, tx, "join_requested", payload); err != nil {
			return JoinResult{}, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return JoinResult{}, err
	}
	return result, nil
}

func ListJoinRequests(ctx context.Context, pool *pgxpool.Pool, cacheID, ownerID string) ([]JoinRequest, error) {
	var requests []JoinRequest
	err := pool.QueryRow(ctx, `
		SELECT COALESCE(jsonb_agg(jsonb_build_object(
		           'user_id', pending.user_id::text, 'display_name', u.display_name, 'created_at', pending.created_at
		       ) ORDER BY pending.created_at, pending.user_id) FILTER (WHERE pending.user_id IS NOT NULL), '[]'::jsonb)
		FROM app.caches c
		JOIN app.cache_members owner ON owner.cache_id = c.id AND owner.user_id = $2 AND owner.status = 'active'
		LEFT JOIN app.cache_members pending ON pending.cache_id = c.id AND pending.status = 'pending'
		LEFT JOIN app.users u ON u.id = pending.user_id
		WHERE c.id = $1 AND c.owner_id = $2
		GROUP BY c.id
	`, cacheID, ownerID).Scan(&requests)
	return requests, err
}

func ApproveJoinRequest(ctx context.Context, pool *pgxpool.Pool, cacheID, ownerID, userID string) error {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	payload := joinNotification{RecipientUserIDs: []string{userID}}
	err = tx.QueryRow(ctx, `
		UPDATE app.cache_members pending SET status = 'active'
		FROM app.caches c
		JOIN app.cache_members owner ON owner.cache_id = c.id AND owner.user_id = $2 AND owner.status = 'active'
		JOIN app.users u ON u.id = $3
		WHERE c.id = $1 AND c.owner_id = $2
		  AND pending.cache_id = c.id AND pending.user_id = $3 AND pending.status = 'pending'
		RETURNING c.id::text, c.name, pending.user_id::text, u.display_name
	`, cacheID, ownerID, userID).Scan(&payload.CacheID, &payload.CacheName, &payload.UserID, &payload.DisplayName)
	if err != nil {
		return err
	}
	if err := enqueueJoinNotification(ctx, tx, "join_approved", payload); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func RejectJoinRequest(ctx context.Context, pool *pgxpool.Pool, cacheID, ownerID, userID string) error {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	payload := joinNotification{RecipientUserIDs: []string{userID}}
	err = tx.QueryRow(ctx, `
		DELETE FROM app.cache_members pending
		USING app.caches c, app.cache_members owner, app.users u
		WHERE c.id = $1 AND c.owner_id = $2
		  AND owner.cache_id = c.id AND owner.user_id = $2 AND owner.status = 'active'
		  AND pending.cache_id = c.id AND pending.user_id = $3 AND pending.status = 'pending'
		  AND u.id = pending.user_id
		RETURNING c.id::text, c.name, pending.user_id::text, u.display_name
	`, cacheID, ownerID, userID).Scan(&payload.CacheID, &payload.CacheName, &payload.UserID, &payload.DisplayName)
	if err != nil {
		return err
	}
	if err := enqueueJoinNotification(ctx, tx, "join_rejected", payload); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func enqueueJoinNotification(ctx context.Context, tx pgx.Tx, kind string, payload joinNotification) error {
	// Rejection permits another attempt; cache + user alone would suppress its event.
	_, err := tx.Exec(ctx, `
		INSERT INTO app.outbox (kind, dedupe_key, payload) VALUES ($1, $2, $3)
	`, kind, uuid.NewString(), payload)
	return err
}
