package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

// Desktop is one sample of the focused window. Field names and limits are
// the contract of shared/ingest/omarchy.ts#prepareOmarchyReport.
type Desktop struct {
	ApplicationName string  `json:"applicationName"`
	AppID           *string `json:"appId"`
	WindowTitle     *string `json:"windowTitle"`
	Workspace       *string `json:"workspace"`
}

type envelope struct {
	Version    int   `json:"version"`
	ObservedAt int64 `json:"observedAt"`
	Modules    struct {
		Desktop *Desktop `json:"desktop"`
	} `json:"modules"`
}

func optional(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

func desktopOf(w *activeWindow, names *appNames) *Desktop {
	if w == nil {
		return nil
	}
	name := names.lookup(w.Class)
	if name == "" {
		name = w.Title
	}
	if name == "" {
		return nil
	}
	return &Desktop{
		ApplicationName: name,
		AppID:           optional(w.Class),
		WindowTitle:     optional(w.Title),
		Workspace:       optional(w.Workspace.Name),
	}
}

func encodeReport(d *Desktop, observedAt time.Time) ([]byte, error) {
	var e envelope
	e.Version = 1
	e.ObservedAt = observedAt.UnixMilli()
	e.Modules.Desktop = d
	return json.Marshal(e)
}

type pusher struct {
	cfg    config
	client *http.Client
}

func (p pusher) push(ctx context.Context, body []byte) error {
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, p.cfg.ingestURL, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("CF-Access-Client-Id", p.cfg.clientID)
	req.Header.Set("CF-Access-Client-Secret", p.cfg.clientSecret)
	res, err := p.client.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(res.Body, 64*1024))
	var reply struct {
		OK    bool   `json:"ok"`
		Error string `json:"error"`
	}
	_ = json.Unmarshal(raw, &reply)
	if res.StatusCode/100 != 2 || !reply.OK {
		if reply.Error != "" {
			return fmt.Errorf("site returned %d: %s", res.StatusCode, reply.Error)
		}
		return fmt.Errorf("site returned %d", res.StatusCode)
	}
	return nil
}
