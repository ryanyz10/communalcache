package main

import "embed"

// Built SPA assets. Placeholder until `cd web && npm run build` populates dist/.
//
//go:embed all:dist
var webFS embed.FS
