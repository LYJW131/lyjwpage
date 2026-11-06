package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// Cases from MacTelemetryHub Tests/TelemetryCoreTests/WindowTitleTests.swift.
func TestNormalizeTitle(t *testing.T) {
	for _, c := range []struct {
		raw   string
		names []string
		want  string
	}{
		{"⠋ Building project", nil, "Building project"},
		{"⣿ Building project", nil, "Building project"},
		{"◐ claude", nil, "claude"},
		{"[3/10] Compiling TelemetryCore", nil, "Compiling TelemetryCore"},
		{"Downloading 47% — Safari", nil, "Downloading — Safari"},
		{"Downloading 12.5% — Safari", nil, "Downloading — Safari"},
		{"Inbox (3)", nil, "Inbox"},
		{"(12) Inbox", nil, "Inbox"},
		{"  Report\tDecision \n Swift  ", nil, "Report Decision Swift"},
		{"● — MacTelemetryHub", nil, "MacTelemetryHub"},
		{"LYJW's Homepage - Google Chrome", []string{"Google Chrome"}, "LYJW's Homepage"},
		{"Noul — Mozilla Firefox", []string{"Firefox"}, "Noul"},
		{"telemetry.ts - lyjwpage - Visual Studio Code", []string{"Code"}, "telemetry.ts - lyjwpage"},
		{"Google Chrome Help - google chrome", []string{"Google Chrome"}, "Google Chrome Help"},
		{"Google Chrome", []string{"Google Chrome"}, ""},
		{"Claude Status - Incident History", []string{"Google Chrome"}, "Claude Status - Incident History"},
		{"Scanner - Barcode", []string{"Code"}, "Scanner - Barcode"},
		{"my-code", []string{"Code"}, "my-code"},
		{"Page - Google Chrome", nil, "Page - Google Chrome"},
		{"Apple Music - 网页播放器 - Chromium", []string{"Chromium", "chromium"}, "Apple Music - 网页播放器"},
		{"   ", nil, ""},
		{"⠋ ⠙ ●", nil, ""},
	} {
		if got := normalizeTitle(c.raw, c.names...); got != c.want {
			t.Errorf("%q: got %q, want %q", c.raw, got, c.want)
		}
	}
	if got := []rune(normalizeTitle(strings.Repeat("字", 300))); len(got) != maxTitlePoints {
		t.Errorf("cut to %d code points, got %d", maxTitlePoints, len(got))
	}
}

func probs(secret, private, work, adult, political, informative float64) map[dimension]float64 {
	return map[dimension]float64{exposesSecret: secret, exposesPrivateMatter: private, exposesConfidentialWork: work,
		isAdultContent: adult, isPoliticallySensitive: political, isInformative: informative}
}

// Rows of the calibration table on MacTelemetryHub's WindowTitleJudgmentThresholds.
func TestThresholds(t *testing.T) {
	for _, c := range []struct {
		name   string
		p      map[dimension]float64
		want   verdict
		locked []dimension
	}{
		{"Swift Concurrency docs", probs(0.01, 0.02, 0.03, 0.01, 0.02, 0.96), verdictPublished, nil},
		{"ReportDecision.swift", probs(0.03, 0.04, 0.10, 0.01, 0.04, 0.97), verdictPublished, nil},
		{"Untitled", probs(0.02, 0.03, 0.02, 0.01, 0.02, 0.04), verdictOmitted, nil},
		{"Budget draft.txt", probs(0.02, 0.54, 0.05, 0.01, 0.02, 0.97), verdictNeedsConfirmation, nil},
		{"landlord", probs(0.02, 0.71, 0.08, 0.01, 0.03, 0.97), verdictLocked, []dimension{exposesPrivateMatter}},
		{"招商银行", probs(0.07, 0.97, 0.62, 0.01, 0.03, 0.97), verdictLocked, []dimension{exposesPrivateMatter, exposesConfidentialWork}},
		{"六四事件", probs(0.02, 0.05, 0.03, 0.02, 0.98, 0.98), verdictLocked, []dimension{isPoliticallySensitive}},
		// Risk first: a sensitive title with nothing in it is locked, not omitted.
		{"sensitive and empty", probs(0.9, 0.01, 0.01, 0.01, 0.01, 0.01), verdictLocked, []dimension{exposesSecret}},
	} {
		v, locked := standardThresholds.judge(c.p)
		if v != c.want || fmt.Sprint(locked) != fmt.Sprint(c.locked) {
			t.Errorf("%s: got %s %v, want %s %v", c.name, v, locked, c.want, c.locked)
		}
	}
}

func TestJevRequestAndAnswers(t *testing.T) {
	raw, _ := json.Marshal(newJevRequest("Ghostty", "com.mitchellh.ghostty", "~/lyjwpage"))
	var got struct {
		Model     string
		State     map[string]any
		Questions map[string]struct{ Type string }
	}
	_ = json.Unmarshal(raw, &got)
	if got.Model != jevModel || got.State["bundleIdentifier"] != "com.mitchellh.ghostty" || len(got.Questions) != 6 ||
		got.Questions["isPoliticallySensitive"].Type != "noul" {
		t.Fatalf("got %s", raw)
	}
	if _, err := parseJevAnswers([]byte(`{"answers":{"exposesSecret":{"type":"noul","noul":0.1}}}`)); err != errMissingAnswer {
		t.Fatalf("a missing answer must fail the whole judgment, got %v", err)
	}
}

func fakeJev(t *testing.T, answer func(title string) (int, map[dimension]float64)) *atomic.Int32 {
	t.Helper()
	var calls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		var req jevRequest
		_ = json.NewDecoder(r.Body).Decode(&req)
		status, p := answer(req.State.Title)
		w.WriteHeader(status)
		answers := map[string]any{}
		for d, v := range p {
			answers[string(d)] = map[string]any{"type": "noul", "noul": v}
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"model": jevModel, "answers": answers})
	}))
	old := jevEndpoint
	jevEndpoint = srv.URL
	t.Cleanup(func() { jevEndpoint = old; srv.Close() })
	return &calls
}

func waitFor(t *testing.T, cond func() bool) {
	t.Helper()
	for deadline := time.Now().Add(5 * time.Second); time.Now().Before(deadline); time.Sleep(20 * time.Millisecond) {
		if cond() {
			return
		}
	}
	t.Fatal("timed out")
}

func TestTitleJudgeFlow(t *testing.T) {
	calls := fakeJev(t, func(title string) (int, map[dimension]float64) {
		if strings.Contains(title, "bank") {
			return 200, probs(0.07, 0.97, 0.1, 0.01, 0.03, 0.97)
		}
		return 200, probs(0.01, 0.02, 0.03, 0.01, 0.02, 0.96)
	})
	path := filepath.Join(t.TempDir(), "titles.json")
	j := newTitleJudge(path)
	j.configure(titleRules{enabled: true, apiKey: "k", trusted: []string{"trusted.app"}, blacklist: []string{"secret.app"}})

	if s := j.resolve("Docs", "browser", "Swift docs"); s != titleJudging {
		t.Fatalf("first sight should be judging, got %s", s)
	}
	waitFor(t, func() bool { return j.resolve("Docs", "browser", "Swift docs") == titleStatus(verdictPublished) })
	if s := j.resolve("Bank", "browser", "my bank balance"); s != titleJudging {
		t.Fatal(s)
	}
	// While the new title is judged, the last published one of the same app holds.
	if got := j.reportable(titleStatus(verdictPublished), "browser", "Swift docs"); got != "Swift docs" {
		t.Fatal(got)
	}
	if got := j.reportable(titleJudging, "browser", "my bank balance"); got != "Swift docs" {
		t.Fatalf("hold: got %q", got)
	}
	if got := j.reportable(titleJudging, "other", "x"); got != "" {
		t.Fatalf("hold must not cross apps: got %q", got)
	}
	waitFor(t, func() bool { return j.resolve("Bank", "browser", "my bank balance") == titleStatus(verdictLocked) })
	e, _ := j.entry("browser", "my bank balance")
	if e.reason() != "私人事务 0.97" {
		t.Fatalf("reason: %q", e.reason())
	}

	if j.resolve("T", "trusted.app", "anything") != titleTrusted || j.resolve("S", "secret.app", "anything") != titleBlacklisted {
		t.Fatal("lists")
	}
	before := calls.Load()
	// The cache answers repeat titles, also after a restart.
	j2 := newTitleJudge(path)
	j2.configure(titleRules{enabled: true, apiKey: "k"})
	if j2.resolve("Docs", "browser", "Swift docs") != titleStatus(verdictPublished) || calls.Load() != before {
		t.Fatal("cache should survive a restart without asking again")
	}
	j2.decide(titleKey("browser", "my bank balance"), verdictPublished)
	if j2.resolve("Bank", "browser", "my bank balance") != titleStatus(verdictPublished) {
		t.Fatal("the owner's call wins")
	}
	j2.configure(titleRules{enabled: false, apiKey: "k"})
	if j2.resolve("Docs", "browser", "Swift docs") != titleDisabled {
		t.Fatal("switch off")
	}
	// Clearing drops the owner's calls too, and stays cleared after a restart.
	j2.clear()
	if len(j2.review()) != 0 || len(newTitleJudge(path).review()) != 0 {
		t.Fatal("clear should empty the cache on disk")
	}
}

func TestTitleJudgeFailures(t *testing.T) {
	fakeJev(t, func(string) (int, map[dimension]float64) { return 401, nil })
	j := newTitleJudge(filepath.Join(t.TempDir(), "titles.json"))
	if j.resolve("A", "a", "x") != titleDisabled {
		t.Fatal("zero rules are off")
	}
	j.configure(titleRules{enabled: true})
	if j.resolve("A", "a", "x") != titleUnavailable {
		t.Fatal("no key reports no title")
	}
	j.configure(titleRules{enabled: true, apiKey: "bad"})
	j.resolve("A", "a", "x")
	waitFor(t, func() bool { return j.error() != "" })
	// 401 is not retried and nothing is cached: the title stays unreported.
	if _, ok := j.entry("a", "x"); ok || !strings.Contains(j.error(), "401") {
		t.Fatalf("got %q", j.error())
	}
}
