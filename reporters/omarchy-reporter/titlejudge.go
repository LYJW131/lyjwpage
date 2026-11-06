package main

// 源：LYJW131/MacTelemetryHub App/MacTelemetryHub/WindowTitleJudge.swift 与
// Sources/TelemetryCore/WindowTitleJudgmentCache.swift. Only titles that are
// published or trusted enter the envelope; a missing key, a failure and
// every verdict but published report no title.

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"time"
)

const (
	titleSettleDelay     = 500 * time.Millisecond
	titlePerAppInterval  = 1500 * time.Millisecond
	titleRetryBase       = 5 * time.Second
	titleRetryMax        = 300 * time.Second
	titleMaxRetries      = 4
	titleCacheCapacity   = 500
	titleCacheVersion    = 1
	titleHoldMaxDuration = 20 * time.Second
)

type titleStatus string

const (
	titleNone        titleStatus = "none"
	titleDisabled    titleStatus = "disabled"
	titleBlacklisted titleStatus = "blacklisted"
	titleTrusted     titleStatus = "trusted"
	titleJudging     titleStatus = "judging"
	titleUnavailable titleStatus = "unavailable"
)

func (s titleStatus) displayName() string {
	switch s {
	case titleNone:
		return "无标题"
	case titleDisabled:
		return "已关闭"
	case titleBlacklisted:
		return "黑名单"
	case titleTrusted:
		return "免判"
	case titleJudging:
		return "判断中"
	case titleUnavailable:
		return "无法判断"
	}
	return verdict(s).displayName()
}

func (s titleStatus) reportable() bool {
	return s == titleTrusted || s == titleStatus(verdictPublished)
}

type titleRules struct {
	enabled   bool
	blacklist []string // app IDs whose titles are never judged or reported
	trusted   []string // app IDs whose titles are reported without asking
	apiKey    string
}

func (r titleRules) equal(o titleRules) bool {
	return r.enabled == o.enabled && r.apiKey == o.apiKey && slices.Equal(r.blacklist, o.blacklist) && slices.Equal(r.trusted, o.trusted)
}

func containsApp(list []string, appID string) bool {
	return appID != "" && slices.ContainsFunc(list, func(s string) bool { return strings.EqualFold(s, appID) })
}

type titleEntry struct {
	AppID           string                `json:"appId"`
	ApplicationName string                `json:"applicationName"`
	Title           string                `json:"title"`
	Verdict         verdict               `json:"verdict"`
	Source          string                `json:"source"` // "jev" or "user"; the owner's call beats the model
	Probabilities   map[dimension]float64 `json:"probabilities"`
	LockedBy        []dimension           `json:"lockedBy"`
	JudgedAt        int64                 `json:"judgedAt"`
	LastSeenAt      int64                 `json:"lastSeenAt"`
}

func titleKey(appID, title string) string {
	if appID == "" {
		appID = "-"
	}
	return appID + "\n" + title
}

func (e titleEntry) key() string { return titleKey(e.AppID, e.Title) }

// reason names the questions behind a locked or pending verdict.
func (e titleEntry) reason() string {
	var dims []dimension
	switch e.Verdict {
	case verdictLocked:
		dims = e.LockedBy
	case verdictNeedsConfirmation:
		dims = standardThresholds.unsettled(e.Probabilities)
	}
	var parts []string
	for _, d := range dims {
		if v, ok := e.Probabilities[d]; ok {
			parts = append(parts, d.displayName()+" "+formatProb(v))
		} else {
			parts = append(parts, d.displayName())
		}
	}
	return strings.Join(parts, "、")
}

type pendingTitle struct{ applicationName, appID, title string }

type titleJudge struct {
	mu        sync.Mutex
	rules     titleRules
	entries   []titleEntry // LRU: most recently seen last
	path      string
	client    *http.Client
	pending   map[string]pendingTitle
	scheduled map[string]string // app -> title with a timer armed
	timers    map[string]*time.Timer
	lastAsked map[string]time.Time
	inFlight  map[string]bool
	failures  map[string]int
	backoff   time.Time
	lastError string
	lastKey   string

	heldApp, heldTitle string
	holdSince          time.Time

	// onVerdict runs after any judgment lands, to report again; onConfirm
	// when a title waits for the owner. Both run off the caller's lock.
	onVerdict func()
	onConfirm func(titleEntry)
}

func titleCachePath() string {
	dir := os.Getenv("XDG_STATE_HOME")
	if dir == "" {
		home, _ := os.UserHomeDir()
		dir = filepath.Join(home, ".local", "state")
	}
	return filepath.Join(dir, "lyjwpage", "omarchy-window-titles.json")
}

func newTitleJudge(path string) *titleJudge {
	j := &titleJudge{
		path: path, client: &http.Client{},
		pending: map[string]pendingTitle{}, scheduled: map[string]string{}, timers: map[string]*time.Timer{},
		lastAsked: map[string]time.Time{}, inFlight: map[string]bool{}, failures: map[string]int{},
	}
	if raw, err := os.ReadFile(path); err == nil {
		var file struct {
			Version int          `json:"version"`
			Entries []titleEntry `json:"entries"`
		}
		// A file of another version is dropped: entries grow back by asking again.
		if json.Unmarshal(raw, &file) == nil && file.Version == titleCacheVersion {
			j.entries = file.Entries
		}
	}
	return j
}

func (j *titleJudge) configure(r titleRules) {
	j.mu.Lock()
	changedKey := j.rules.apiKey != r.apiKey
	j.rules = r
	if changedKey {
		// A wrong key once would otherwise leave every title stuck on 无法判断.
		j.failures, j.backoff, j.lastError = map[string]int{}, time.Time{}, ""
	}
	j.lastKey = ""
	j.mu.Unlock()
	j.notify()
}

func (j *titleJudge) currentRules() titleRules {
	j.mu.Lock()
	defer j.mu.Unlock()
	return j.rules
}

func (j *titleJudge) notify() {
	if j.onVerdict != nil {
		j.onVerdict()
	}
}

// resolve says what a normalized title is now, from the cache only; an
// unjudged title is scheduled and its verdict comes back through onVerdict.
func (j *titleJudge) resolve(applicationName, appID, title string) titleStatus {
	j.mu.Lock()
	defer j.mu.Unlock()
	switch {
	case !j.rules.enabled:
		return titleDisabled
	case containsApp(j.rules.blacklist, appID):
		return titleBlacklisted
	case title == "":
		return titleNone
	case containsApp(j.rules.trusted, appID):
		return titleTrusted
	}
	key := titleKey(appID, title)
	if i := j.index(key); i >= 0 {
		e := j.entries[i]
		if j.lastKey != key {
			j.lastKey = key
			e.LastSeenAt = time.Now().UnixMilli()
			j.entries = append(slices.Delete(j.entries, i, i+1), e)
			j.persistLocked()
		}
		return titleStatus(e.Verdict)
	}
	if strings.TrimSpace(j.rules.apiKey) == "" || j.failures[key] >= titleMaxRetries {
		return titleUnavailable
	}
	j.scheduleLocked(pendingTitle{applicationName, appID, title}, 0)
	return titleJudging
}

// reportable is the title that may enter the envelope. While a new title of
// the same app is judged, the last published one stays up to
// titleHoldMaxDuration so the site does not blink.
func (j *titleJudge) reportable(status titleStatus, appID, title string) string {
	j.mu.Lock()
	defer j.mu.Unlock()
	if status.reportable() && title != "" {
		j.heldApp, j.heldTitle, j.holdSince = appID, title, time.Time{}
		return title
	}
	if status != titleJudging || j.heldTitle == "" || j.heldApp != appID {
		j.heldApp, j.heldTitle = "", ""
		return ""
	}
	if j.holdSince.IsZero() {
		j.holdSince = time.Now()
	}
	if time.Since(j.holdSince) >= titleHoldMaxDuration {
		j.heldApp, j.heldTitle = "", ""
		return ""
	}
	return j.heldTitle
}

func (j *titleJudge) index(key string) int {
	return slices.IndexFunc(j.entries, func(e titleEntry) bool { return e.key() == key })
}

func appKey(p pendingTitle) string {
	if p.appID != "" {
		return p.appID
	}
	return p.applicationName
}

func (j *titleJudge) scheduleLocked(p pendingTitle, extra time.Duration) {
	app := appKey(p)
	j.pending[app] = p
	// Re-arming the same title would push its settle delay out forever.
	if t, ok := j.scheduled[app]; ok && t == p.title && extra == 0 {
		return
	}
	if t := j.timers[app]; t != nil {
		t.Stop()
	}
	now := time.Now()
	ready := now.Add(titleSettleDelay + extra)
	if t := j.lastAsked[app].Add(titlePerAppInterval); t.After(ready) {
		ready = t
	}
	if j.backoff.After(ready) {
		ready = j.backoff
	}
	j.scheduled[app] = p.title
	j.timers[app] = time.AfterFunc(ready.Sub(now), func() { j.fire(app) })
}

func (j *titleJudge) fire(app string) {
	j.mu.Lock()
	delete(j.scheduled, app)
	delete(j.timers, app)
	p, ok := j.pending[app]
	key := titleKey(p.appID, p.title)
	apiKey := strings.TrimSpace(j.rules.apiKey)
	if !ok || j.index(key) >= 0 || j.inFlight[key] || apiKey == "" {
		j.mu.Unlock()
		return
	}
	j.inFlight[key] = true
	j.lastAsked[app] = time.Now()
	j.mu.Unlock()

	probs, err := askJev(context.Background(), j.client, apiKey, p.applicationName, p.appID, p.title)

	j.mu.Lock()
	delete(j.inFlight, key)
	var confirm *titleEntry
	if err == nil {
		v, locked := standardThresholds.judge(probs)
		now := time.Now().UnixMilli()
		e := titleEntry{AppID: p.appID, ApplicationName: p.applicationName, Title: p.title, Verdict: v, Source: "jev",
			Probabilities: probs, LockedBy: locked, JudgedAt: now, LastSeenAt: now}
		j.storeLocked(e)
		delete(j.failures, key)
		j.lastError, j.lastKey = "", ""
		if v == verdictNeedsConfirmation {
			confirm = &e
		}
	} else {
		// A failure is not cached: one network blip must not pin a title.
		attempts := j.failures[key] + 1
		j.failures[key] = attempts
		j.lastError = "窗口标题判断失败：" + err.Error()
		j.lastKey = ""
		wait := min(titleRetryMax, titleRetryBase<<(attempts-1))
		var je *jevError
		retry := true
		if errors.As(err, &je) {
			retry = je.retryable()
			if retry {
				j.backoff = time.Now().Add(wait)
			}
		} else if errors.Is(err, errMissingAnswer) {
			retry = false
		}
		if retry && attempts <= titleMaxRetries {
			j.scheduleLocked(p, wait)
		}
	}
	j.mu.Unlock()
	if confirm != nil && j.onConfirm != nil {
		j.onConfirm(*confirm)
	}
	j.notify()
}

func (j *titleJudge) storeLocked(e titleEntry) {
	if i := j.index(e.key()); i >= 0 {
		j.entries = slices.Delete(j.entries, i, i+1)
	}
	j.entries = append(j.entries, e)
	if n := len(j.entries) - titleCacheCapacity; n > 0 {
		j.entries = slices.Delete(j.entries, 0, n)
	}
	j.persistLocked()
}

// decide records the owner's call, which beats the model for good.
func (j *titleJudge) decide(key string, v verdict) {
	j.mu.Lock()
	if i := j.index(key); i >= 0 {
		e := j.entries[i]
		now := time.Now().UnixMilli()
		e.Verdict, e.Source, e.Probabilities, e.LockedBy, e.JudgedAt, e.LastSeenAt = v, "user", nil, nil, now, now
		j.storeLocked(e)
		j.lastKey = ""
	}
	j.mu.Unlock()
	j.notify()
}

// forget drops a verdict; the title is asked again when it is next seen.
func (j *titleJudge) forget(key string) {
	j.mu.Lock()
	if i := j.index(key); i >= 0 {
		j.entries = slices.Delete(j.entries, i, i+1)
		j.persistLocked()
	}
	delete(j.failures, key)
	j.lastKey = ""
	j.mu.Unlock()
	j.notify()
}

// clear drops every verdict, the owner's included; titles are asked again as they come up.
func (j *titleJudge) clear() {
	j.mu.Lock()
	j.entries = nil
	j.persistLocked()
	j.failures = map[string]int{}
	j.lastKey = ""
	j.mu.Unlock()
	j.notify()
}

func (j *titleJudge) entry(appID, title string) (titleEntry, bool) {
	j.mu.Lock()
	defer j.mu.Unlock()
	if i := j.index(titleKey(appID, title)); i >= 0 {
		return j.entries[i], true
	}
	return titleEntry{}, false
}

// review lists entries locked first, then pending, omitted and published,
// newest first within each, so the ones to look at are not buried.
func (j *titleJudge) review() []titleEntry {
	j.mu.Lock()
	out := slices.Clone(j.entries)
	j.mu.Unlock()
	slices.SortStableFunc(out, func(a, b titleEntry) int {
		if d := a.Verdict.reviewOrder() - b.Verdict.reviewOrder(); d != 0 {
			return d
		}
		return int(b.LastSeenAt - a.LastSeenAt)
	})
	return out
}

func (j *titleJudge) error() string {
	j.mu.Lock()
	defer j.mu.Unlock()
	return j.lastError
}

func (j *titleJudge) persistLocked() {
	raw, err := json.MarshalIndent(struct {
		Version int          `json:"version"`
		Entries []titleEntry `json:"entries"`
	}{titleCacheVersion, j.entries}, "", "  ")
	if err != nil {
		return
	}
	if err := os.MkdirAll(filepath.Dir(j.path), 0o700); err != nil {
		return
	}
	tmp := j.path + ".tmp"
	if os.WriteFile(tmp, raw, 0o600) == nil {
		_ = os.Rename(tmp, j.path)
	}
}
