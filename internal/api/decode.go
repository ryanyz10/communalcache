package api

import (
	"encoding/json"
	"errors"
	"net/http"
)

const maxJSONBody = 16 << 10 // 16KB

func decodeJSON(w http.ResponseWriter, r *http.Request, dst any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, maxJSONBody)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()

	if err := dec.Decode(dst); err != nil {
		var maxBytes *http.MaxBytesError
		if errors.As(err, &maxBytes) {
			writeError(w, http.StatusRequestEntityTooLarge, "body_too_large")
			return false
		}

		writeError(w, http.StatusBadRequest, "invalid_json")
		return false
	}

	return true
}
