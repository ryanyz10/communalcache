package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestDecodeJSONOK(t *testing.T) {
	var got struct {
		DisplayName string `json:"display_name"`
	}
	req := httptest.NewRequest(http.MethodPatch, "/", strings.NewReader(`{"display_name":"Ada"}`))
	w := httptest.NewRecorder()
	if !decodeJSON(w, req, &got) {
		t.Fatalf("decode failed: %s", w.Body.String())
	}
	if got.DisplayName != "Ada" {
		t.Fatalf("got %q", got.DisplayName)
	}
}

func TestDecodeJSONRejectsTrailingObject(t *testing.T) {
	var got struct {
		DisplayName string `json:"display_name"`
	}
	body := `{"display_name":"a"} {"display_name":"b"}`
	req := httptest.NewRequest(http.MethodPatch, "/", strings.NewReader(body))
	w := httptest.NewRecorder()
	if decodeJSON(w, req, &got) {
		t.Fatal("expected failure for trailing JSON object")
	}
	if w.Code != http.StatusBadRequest {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
	assertErrorCode(t, w, "invalid_json")
}

func TestDecodeJSONRejectsOversizedTrailingGarbage(t *testing.T) {
	var got struct {
		DisplayName string `json:"display_name"`
	}
	// Second value is a huge JSON string so the decoder keeps reading until MaxBytesReader trips,
	// rather than failing immediately on a syntax error from bare junk.
	body := `{"display_name":"a"} "` + strings.Repeat("x", maxJSONBody) + `"`
	req := httptest.NewRequest(http.MethodPatch, "/", strings.NewReader(body))
	w := httptest.NewRecorder()
	if decodeJSON(w, req, &got) {
		t.Fatal("expected failure for oversized trailing garbage")
	}
	if w.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
	assertErrorCode(t, w, "body_too_large")
}

func TestDecodeJSONRejectsUnknownField(t *testing.T) {
	var got struct {
		DisplayName string `json:"display_name"`
	}
	req := httptest.NewRequest(http.MethodPatch, "/", strings.NewReader(`{"display_name":"a","extra":1}`))
	w := httptest.NewRecorder()
	if decodeJSON(w, req, &got) {
		t.Fatal("expected failure for unknown field")
	}
	if w.Code != http.StatusBadRequest {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
}

func assertErrorCode(t *testing.T, w *httptest.ResponseRecorder, want string) {
	t.Helper()
	var payload map[string]string
	if err := json.NewDecoder(bytes.NewReader(w.Body.Bytes())).Decode(&payload); err != nil {
		t.Fatalf("decode response: %v body=%s", err, w.Body.String())
	}
	if payload["error"] != want {
		t.Fatalf("error=%q want %q", payload["error"], want)
	}
}
