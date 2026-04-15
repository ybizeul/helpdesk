package store

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"fmt"
	"strings"

	"golang.org/x/crypto/argon2"
)

const (
	argonTime    = 1
	argonMemory  = 64 * 1024
	argonThreads = 4
	argonKeyLen  = 32
	saltLen      = 16
)

func HashPassword(password string) string {
	salt := make([]byte, saltLen)
	if _, err := rand.Read(salt); err != nil {
		panic(err)
	}
	hash := argon2.IDKey([]byte(password), salt, argonTime, argonMemory, argonThreads, argonKeyLen)
	return fmt.Sprintf("%s.%s",
		base64.RawStdEncoding.EncodeToString(salt),
		base64.RawStdEncoding.EncodeToString(hash),
	)
}

func VerifyPassword(password, encoded string) bool {
	parts := strings.SplitN(encoded, ".", 2)
	if len(parts) != 2 {
		return false
	}
	salt, err := base64.RawStdEncoding.DecodeString(parts[0])
	if err != nil {
		return false
	}
	existingHash, err := base64.RawStdEncoding.DecodeString(parts[1])
	if err != nil {
		return false
	}
	candidateHash := argon2.IDKey([]byte(password), salt, argonTime, argonMemory, argonThreads, argonKeyLen)
	return subtle.ConstantTimeCompare(existingHash, candidateHash) == 1
}
