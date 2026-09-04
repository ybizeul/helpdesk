package api

import (
	"regexp"
	"strconv"
	"strings"
	"unicode/utf8"

	"go.mongodb.org/mongo-driver/v2/bson"
)

const (
	ticketSearchMaxLen = 200
	ticketSearchLimit  = 50
)

var ticketNumberQueryRe = regexp.MustCompile(`^#?\d+$`)

func escapeTextSearch(q string) string {
	q = strings.ReplaceAll(q, `\`, `\\`)
	q = strings.ReplaceAll(q, `"`, `\"`)
	return `"` + q + `"`
}

func normalizeSearchQuery(raw string) string {
	q := strings.TrimSpace(raw)
	if utf8.RuneCountInString(q) > ticketSearchMaxLen {
		q = string([]rune(q)[:ticketSearchMaxLen])
	}
	return q
}

func ticketListExcludesClosed(status, includeClosed, q string) bool {
	if status != "" || includeClosed != "" {
		return false
	}
	return normalizeSearchQuery(q) == ""
}

// applyTicketSearch adds a single search predicate to filter.
// Number and email queries are exact/regex only: MongoDB forbids $text inside $or.
// Searching is true when q is non-empty. useTextScore is true only for $text queries.
func applyTicketSearch(filter bson.M, raw string) (searching, useTextScore bool) {
	q := normalizeSearchQuery(raw)
	if q == "" {
		return false, false
	}

	if ticketNumberQueryRe.MatchString(q) {
		n, err := strconv.Atoi(strings.TrimPrefix(q, "#"))
		if err == nil && n > 0 {
			filter["number"] = n
			return true, false
		}
	}
	if strings.Contains(q, "@") {
		filter["requester.email"] = bson.M{
			"$regex":   regexp.QuoteMeta(q),
			"$options": "i",
		}
		return true, false
	}

	filter["$text"] = bson.M{"$search": escapeTextSearch(q), "$language": "none"}
	return true, true
}
