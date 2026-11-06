package main

import (
	"context"
	"fmt"
	"sync"
	"sync/atomic"
	"time"
)

const (
	// heartbeatInterval keeps the site's copy fresh while nothing changes;
	// it must stay below shared/omarchy.ts#OMARCHY_STALE_MS.
	heartbeatInterval = 60 * time.Second
	// titleInterval caps pushes for title-only changes: terminals and
	// agents retitle every second (spinners), app switches still go at once.
	titleInterval = 15 * time.Second
	// settleDelay lets a burst of focus events (workspace + window) land
	// before sampling.
	settleDelay = 300 * time.Millisecond
)

type status struct {
	paused   bool
	pushes   int
	desktop  *Desktop
	icon     *appIcon
	pushedAt time.Time
	err      error
}

type reporter struct {
	cfg     config
	dir     string
	names   *appNames
	push    func(context.Context, []byte) error
	bucket  *r2Bucket // nil: icons are not uploaded
	onState func(status)
	logf    func(string, ...any)

	paused atomic.Bool
	resume chan struct{}
}

// sameApp reports whether two samples differ at most in the window title.
func sameApp(a, b *Desktop) bool {
	if a == nil || b == nil {
		return a == b
	}
	return a.ApplicationName == b.ApplicationName && deref(a.AppID) == deref(b.AppID) &&
		deref(a.Workspace) == deref(b.Workspace) && deref(a.IconObjectKey) == deref(b.IconObjectKey)
}

func sameDesktop(a, b *Desktop) bool {
	return sameApp(a, b) && (a == nil || deref(a.WindowTitle) == deref(b.WindowTitle))
}

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

func (r *reporter) setPaused(p bool) {
	r.paused.Store(p)
	if !p {
		select {
		case r.resume <- struct{}{}:
		default:
		}
	}
}

func (r *reporter) run(ctx context.Context) {
	changed := make(chan struct{}, 1)
	go watchFocus(ctx, r.dir, changed, r.logf)

	heartbeat := time.NewTicker(heartbeatInterval)
	defer heartbeat.Stop()
	titleTimer := time.NewTimer(0)
	<-titleTimer.C

	// Icons upload off the focus path; the sample that names one is pushed
	// again with its object key once the upload lands.
	var uploadedMu sync.Mutex
	uploaded, pending := map[string]bool{}, map[string]bool{}
	iconReady := make(chan struct{}, 1)
	isUploaded := func(icon *appIcon) bool {
		uploadedMu.Lock()
		defer uploadedMu.Unlock()
		if uploaded[icon.hash] || r.bucket == nil || pending[icon.hash] {
			return uploaded[icon.hash]
		}
		pending[icon.hash] = true
		go func() {
			err := r.bucket.ensure(ctx, icon)
			uploadedMu.Lock()
			delete(pending, icon.hash)
			uploaded[icon.hash] = err == nil
			uploadedMu.Unlock()
			if err != nil {
				r.logf("icon upload: %v", err)
				return
			}
			select {
			case iconReady <- struct{}{}:
			default:
			}
		}()
		return false
	}

	var last status
	var sent *Desktop
	report := func(force bool) {
		if r.paused.Load() {
			last.paused = true
			r.onState(last)
			return
		}
		last.paused = false
		w, err := queryActiveWindow(ctx, r.dir)
		if err != nil {
			last.err = fmt.Errorf("hyprland: %w", err)
			r.onState(last)
			return
		}
		d, icon := desktopOf(w, r.names, isUploaded)
		last.icon = icon
		if !force && last.err == nil && !last.pushedAt.IsZero() {
			if sameDesktop(d, sent) {
				return
			}
			if sameApp(d, sent) {
				if wait := titleInterval - time.Since(last.pushedAt); wait > 0 {
					titleTimer.Reset(wait)
					return
				}
			}
		}
		last.desktop = d
		body, err := encodeReport(d, time.Now())
		if err == nil {
			err = r.push(ctx, body)
		}
		last.err = err
		if err == nil {
			last.pushedAt = time.Now()
			last.pushes++
			sent = d
		} else if err != errNotConfigured {
			r.logf("push: %v", err)
		}
		r.onState(last)
	}

	report(true)
	for {
		select {
		case <-ctx.Done():
			return
		case <-changed:
			sleep(ctx, settleDelay)
			report(false)
		case <-iconReady:
			report(false)
		case <-titleTimer.C:
			report(false)
		case <-heartbeat.C:
			report(true)
		case <-r.resume:
			report(true)
		}
	}
}
