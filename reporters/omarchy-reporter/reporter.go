package main

import (
	"context"
	"fmt"
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
	desktop  *Desktop
	pushedAt time.Time
	err      error
}

type reporter struct {
	cfg     config
	dir     string
	names   *appNames
	push    func(context.Context, []byte) error
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
	return a.ApplicationName == b.ApplicationName && deref(a.AppID) == deref(b.AppID) && deref(a.Workspace) == deref(b.Workspace)
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
		d := desktopOf(w, r.names)
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
			sent = d
		} else {
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
		case <-titleTimer.C:
			report(false)
		case <-heartbeat.C:
			report(true)
		case <-r.resume:
			report(true)
		}
	}
}
