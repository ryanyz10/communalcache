package auth

import (
	"context"
)

type ctxKey int

const userKey ctxKey = 1

// User is the authenticated app.users row for this request.
type User struct {
	ID          string
	Email       string
	DisplayName *string
}

func WithUser(ctx context.Context, u User) context.Context {
	return context.WithValue(ctx, userKey, u)
}

func UserFrom(ctx context.Context) (User, bool) {
	u, ok := ctx.Value(userKey).(User)
	return u, ok
}
