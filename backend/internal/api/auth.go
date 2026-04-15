package api

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"
)

var jwtSecret []byte

func InitJWTSecret(secret string) {
	if secret != "" {
		jwtSecret = []byte(secret)
	} else {
		jwtSecret = make([]byte, 32)
		if _, err := rand.Read(jwtSecret); err != nil {
			panic("failed to generate JWT secret: " + err.Error())
		}
	}
}

type jwtClaims struct {
	Sub  string `json:"sub"`
	Name string `json:"name"`
	Role string `json:"role"`
	Exp  int64  `json:"exp"`
	Iat  int64  `json:"iat"`
}

func generateToken(userID, name, role string) (string, error) {
	now := time.Now()
	claims := jwtClaims{
		Sub:  userID,
		Name: name,
		Role: role,
		Iat:  now.Unix(),
		Exp:  now.Add(24 * time.Hour).Unix(),
	}

	header := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"HS256","typ":"JWT"}`))
	payloadJSON, _ := json.Marshal(claims)
	payload := base64.RawURLEncoding.EncodeToString(payloadJSON)

	sigInput := header + "." + payload
	mac := hmac.New(sha256.New, jwtSecret)
	mac.Write([]byte(sigInput))
	sig := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))

	return sigInput + "." + sig, nil
}

func verifyToken(tokenStr string) (*jwtClaims, error) {
	parts := strings.SplitN(tokenStr, ".", 3)
	if len(parts) != 3 {
		return nil, fmt.Errorf("invalid token format")
	}

	sigInput := parts[0] + "." + parts[1]
	mac := hmac.New(sha256.New, jwtSecret)
	mac.Write([]byte(sigInput))
	expectedSig := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))

	if !hmac.Equal([]byte(parts[2]), []byte(expectedSig)) {
		return nil, fmt.Errorf("invalid signature")
	}

	payloadJSON, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return nil, fmt.Errorf("invalid payload encoding")
	}

	var claims jwtClaims
	if err := json.Unmarshal(payloadJSON, &claims); err != nil {
		return nil, fmt.Errorf("invalid payload JSON")
	}

	if time.Now().Unix() > claims.Exp {
		return nil, fmt.Errorf("token expired")
	}

	return &claims, nil
}

type contextKey string

const claimsKey contextKey = "claims"

func authMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Skip auth for login endpoint
		if r.URL.Path == "/api/v1/auth/login" {
			next.ServeHTTP(w, r)
			return
		}

		var tokenStr string
		if auth := r.Header.Get("Authorization"); strings.HasPrefix(auth, "Bearer ") {
			tokenStr = strings.TrimPrefix(auth, "Bearer ")
		} else if t := r.URL.Query().Get("token"); t != "" {
			tokenStr = t
		} else {
			writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "missing or invalid authorization header")
			return
		}

		claims, err := verifyToken(tokenStr)
		if err != nil {
			writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", err.Error())
			return
		}

		ctx := context.WithValue(r.Context(), claimsKey, claims)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}
