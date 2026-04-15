package main

import (
	"embed"
	"io/fs"
	"net/http"
	"strings"
)

//go:embed dist
var distFS embed.FS

// frontendHandler serves the embedded frontend SPA.
// API requests are not handled here — they must be routed before this handler.
func frontendHandler() http.Handler {
	sub, _ := fs.Sub(distFS, "dist")
	fileServer := http.FileServer(http.FS(sub))

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Try to serve the exact file first.
		path := strings.TrimPrefix(r.URL.Path, "/")
		if path == "" {
			path = "index.html"
		}
		if f, err := sub.Open(path); err == nil {
			f.Close()
			fileServer.ServeHTTP(w, r)
			return
		}
		// For any path that doesn't match a file, serve index.html (SPA fallback).
		r.URL.Path = "/"
		fileServer.ServeHTTP(w, r)
	})
}
