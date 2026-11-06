package main

// 源：LYJW131/MacTelemetryHub Sources/TelemetryCore/WindowTitleNormalizer.swift。
// The normalized text is at once the question to Jev, the cache key and what
// is reported, so the three never drift apart.

import (
	"regexp"
	"strings"
	"unicode"
)

// maxTitlePoints matches the site's cut, in code points.
const maxTitlePoints = 200

var (
	// Progress [3/10], percentages 47%, unread badges (3) at either end.
	strippedPatterns = []*regexp.Regexp{
		regexp.MustCompile(`\[\s*\d+\s*/\s*\d+\s*\]`),
		regexp.MustCompile(`\b\d{1,3}(?:\.\d+)?\s*%`),
		regexp.MustCompile(`(?:^\s*\(\d+\)|\(\d+\)\s*$)`),
	}
	segmentSeparator = regexp.MustCompile(`\s+[-–—|·]\s+`)
	edgeSeparators   = " \t\r\n-–—·|:•*"
)

// isDecoration covers spinner glyphs: Braille (CLI spinners) and the
// Geometric Shapes block (●○◐◓◑◒▪▫◌◍◉), stripped as whole blocks because
// every tool picks its own set.
func isDecoration(r rune) bool {
	return (r >= 0x2800 && r <= 0x28FF) || (r >= 0x25A0 && r <= 0x25FF)
}

func normalizeTitle(raw string, applicationNames ...string) string {
	text := strings.Map(func(r rune) rune {
		if isDecoration(r) {
			return -1
		}
		return r
	}, raw)
	for _, p := range strippedPatterns {
		text = p.ReplaceAllString(text, " ")
	}
	text = stripApplicationSuffix(text, applicationNames)
	text = strings.Trim(strings.Join(strings.Fields(text), " "), edgeSeparators)
	if points := []rune(text); len(points) > maxTitlePoints {
		text = string(points[:maxTitlePoints])
	}
	return text
}

// stripApplicationSuffix drops the app's own name the title ends with once
// (`page - Chromium`); a title that is only the app's name becomes empty.
func stripApplicationSuffix(text string, applicationNames []string) string {
	var names []string
	for _, n := range applicationNames {
		if n = strings.ToLower(strings.TrimSpace(n)); n != "" {
			names = append(names, n)
		}
	}
	if len(names) == 0 {
		return text
	}
	seps := segmentSeparator.FindAllStringIndex(text, -1)
	if len(seps) == 0 {
		whole := strings.ToLower(strings.TrimSpace(text))
		for _, n := range names {
			if whole == n {
				return ""
			}
		}
		return text
	}
	last := seps[len(seps)-1]
	tail := strings.ToLower(strings.TrimSpace(text[last[1]:]))
	if tail == "" {
		return text
	}
	for _, n := range names {
		if tail == n || (strings.HasSuffix(tail, n) && wordBoundaryBefore(tail, n)) {
			return text[:last[0]]
		}
	}
	return text
}

func wordBoundaryBefore(tail, name string) bool {
	prefix := []rune(tail[:len(tail)-len(name)])
	if len(prefix) == 0 {
		return true
	}
	r := prefix[len(prefix)-1]
	return !unicode.IsLetter(r) && !unicode.IsNumber(r)
}
