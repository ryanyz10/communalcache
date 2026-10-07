package db

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
)

type Cache struct {
	ID               string `json:"id"`
	Name             string `json:"name"`
	OwnerID          string `json:"owner_id"`
	InviteToken      string `json:"invite_token"`
	RequiresApproval bool   `json:"requires_approval"`
}

type CacheMember struct {
	UserID      string  `json:"user_id"`
	DisplayName *string `json:"display_name"`
}

type CacheDetail struct {
	Cache
	Members []CacheMember `json:"members"`
}

func CreateCache(ctx context.Context, pool *pgxpool.Pool, userID, name, token string, requiresApproval bool) (Cache, error) {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return Cache{}, err
	}
	defer tx.Rollback(ctx)

	var cache Cache
	err = tx.QueryRow(ctx, `
		INSERT INTO app.caches (name, owner_id, invite_token, requires_approval)
		VALUES ($1, $2, $3, $4)
		RETURNING id::text, name, owner_id::text, invite_token, requires_approval
	`, name, userID, token, requiresApproval).Scan(
		&cache.ID, &cache.Name, &cache.OwnerID, &cache.InviteToken, &cache.RequiresApproval,
	)
	if err != nil {
		return Cache{}, err
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO app.cache_members (cache_id, user_id, status)
		VALUES ($1, $2, 'active')
	`, cache.ID, userID)
	if err != nil {
		return Cache{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Cache{}, err
	}
	return cache, nil
}

func ListCaches(ctx context.Context, pool *pgxpool.Pool, userID string) ([]Cache, error) {
	rows, err := pool.Query(ctx, `
		SELECT c.id::text, c.name, c.owner_id::text, c.invite_token, c.requires_approval
		FROM app.caches c
		JOIN app.cache_members m ON m.cache_id = c.id AND m.user_id = $1 AND m.status = 'active'
		ORDER BY c.created_at, c.id
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	caches := []Cache{}
	for rows.Next() {
		var cache Cache
		if err := rows.Scan(&cache.ID, &cache.Name, &cache.OwnerID, &cache.InviteToken, &cache.RequiresApproval); err != nil {
			return nil, err
		}
		caches = append(caches, cache)
	}
	return caches, rows.Err()
}

func GetCache(ctx context.Context, pool *pgxpool.Pool, cacheID, userID string) (CacheDetail, error) {
	var cache CacheDetail
	err := pool.QueryRow(ctx, `
		SELECT c.id::text, c.name, c.owner_id::text, c.invite_token, c.requires_approval,
		       jsonb_agg(jsonb_build_object('user_id', member.user_id::text, 'display_name', u.display_name)
		                 ORDER BY member.created_at, member.user_id)
		FROM app.caches c
		JOIN app.cache_members viewer ON viewer.cache_id = c.id AND viewer.user_id = $2 AND viewer.status = 'active'
		JOIN app.cache_members member ON member.cache_id = c.id AND member.status = 'active'
		JOIN app.users u ON u.id = member.user_id
		WHERE c.id = $1
		GROUP BY c.id
	`, cacheID, userID).Scan(
		&cache.ID, &cache.Name, &cache.OwnerID, &cache.InviteToken, &cache.RequiresApproval, &cache.Members,
	)
	return cache, err
}

func PatchCache(ctx context.Context, pool *pgxpool.Pool, cacheID, userID string, name *string, requiresApproval *bool) (Cache, error) {
	var cache Cache
	err := pool.QueryRow(ctx, `
		UPDATE app.caches c
		SET name = COALESCE($3, c.name), requires_approval = COALESCE($4, c.requires_approval)
		FROM app.cache_members m
		WHERE c.id = $1 AND c.owner_id = $2
		  AND m.cache_id = c.id AND m.user_id = $2 AND m.status = 'active'
		RETURNING c.id::text, c.name, c.owner_id::text, c.invite_token, c.requires_approval
	`, cacheID, userID, name, requiresApproval).Scan(
		&cache.ID, &cache.Name, &cache.OwnerID, &cache.InviteToken, &cache.RequiresApproval,
	)
	return cache, err
}

func RotateCacheInvite(ctx context.Context, pool *pgxpool.Pool, cacheID, userID, token string) (Cache, error) {
	var cache Cache
	err := pool.QueryRow(ctx, `
		UPDATE app.caches c SET invite_token = $3
		FROM app.cache_members m
		WHERE c.id = $1 AND c.owner_id = $2
		  AND m.cache_id = c.id AND m.user_id = $2 AND m.status = 'active'
		RETURNING c.id::text, c.name, c.owner_id::text, c.invite_token, c.requires_approval
	`, cacheID, userID, token).Scan(
		&cache.ID, &cache.Name, &cache.OwnerID, &cache.InviteToken, &cache.RequiresApproval,
	)
	return cache, err
}
