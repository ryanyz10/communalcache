package api

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
)

const maxJSONBody = 16 << 10 // 16KB

func decodeJSON(w http.ResponseWriter, r *http.Request, dst any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, maxJSONBody)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()

	if err := dec.Decode(dst); err != nil {
		writeDecodeError(w, err)
		return false
	}
	// Reject trailing content so MaxBytesReader still bounds the whole body,
	// and a second JSON value is a 400 rather than a silent no-op.
	if err := dec.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		if err == nil {
			writeError(w, http.StatusBadRequest, "invalid_json")
			return false
		}
		writeDecodeError(w, err)
		return false
	}
	return true
}

func writeDecodeError(w http.ResponseWriter, err error) {
	var maxBytes *http.MaxBytesError
	if errors.As(err, &maxBytes) {
		writeError(w, http.StatusRequestEntityTooLarge, "body_too_large")
		return
	}
	writeError(w, http.StatusBadRequest, "invalid_json")
}
