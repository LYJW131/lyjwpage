package main

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// activeWindow is the subset of `hyprctl activewindow -j` the reporter reads.
type activeWindow struct {
	Class     string `json:"class"`
	Title     string `json:"title"`
	Workspace struct {
		Name string `json:"name"`
	} `json:"workspace"`
}

func hyprlandDir() (string, error) {
	sig := os.Getenv("HYPRLAND_INSTANCE_SIGNATURE")
	if sig == "" {
		return "", errors.New("HYPRLAND_INSTANCE_SIGNATURE is not set")
	}
	runtime := os.Getenv("XDG_RUNTIME_DIR")
	if runtime == "" {
		runtime = filepath.Join("/run/user", itoa(os.Getuid()))
	}
	return filepath.Join(runtime, "hypr", sig), nil
}

func itoa(n int) string {
	b, _ := json.Marshal(n)
	return string(b)
}

// queryActiveWindow asks Hyprland's request socket for the focused window.
// It returns nil when no window has focus, as on an empty workspace.
func queryActiveWindow(ctx context.Context, dir string) (*activeWindow, error) {
	ctx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	var d net.Dialer
	conn, err := d.DialContext(ctx, "unix", filepath.Join(dir, ".socket.sock"))
	if err != nil {
		return nil, err
	}
	defer conn.Close()
	if deadline, ok := ctx.Deadline(); ok {
		_ = conn.SetDeadline(deadline)
	}
	if _, err := conn.Write([]byte("j/activewindow")); err != nil {
		return nil, err
	}
	body, err := io.ReadAll(conn)
	if err != nil {
		return nil, err
	}
	return parseActiveWindow(body)
}

func parseActiveWindow(body []byte) (*activeWindow, error) {
	var w activeWindow
	if err := json.Unmarshal(body, &w); err != nil {
		return nil, err
	}
	if w.Class == "" && w.Title == "" {
		return nil, nil
	}
	return &w, nil
}

// focusEvents are the socket2 events after which the focused window, its
// title or its workspace may differ.
var focusEvents = map[string]bool{
	"activewindow": true, "activewindowv2": true, "closewindow": true,
	"workspace": true, "workspacev2": true, "focusedmon": true, "windowtitle": true, "windowtitlev2": true,
}

func isFocusEvent(line string) bool {
	name, _, ok := strings.Cut(line, ">>")
	return ok && focusEvents[name]
}

// watchFocus sends on changed after each focus-related event until ctx ends,
// reconnecting when Hyprland restarts its socket.
func watchFocus(ctx context.Context, dir string, changed chan<- struct{}, logf func(string, ...any)) {
	for ctx.Err() == nil {
		var d net.Dialer
		conn, err := d.DialContext(ctx, "unix", filepath.Join(dir, ".socket2.sock"))
		if err != nil {
			logf("hyprland event socket: %v", err)
			sleep(ctx, 5*time.Second)
			continue
		}
		stop := context.AfterFunc(ctx, func() { conn.Close() })
		scanner := bufio.NewScanner(conn)
		scanner.Buffer(make([]byte, 64*1024), 1024*1024)
		for scanner.Scan() {
			if isFocusEvent(scanner.Text()) {
				select {
				case changed <- struct{}{}:
				default:
				}
			}
		}
		stop()
		conn.Close()
		if ctx.Err() == nil {
			logf("hyprland event socket closed: %v", scanner.Err())
			sleep(ctx, 2*time.Second)
		}
	}
}

func sleep(ctx context.Context, d time.Duration) {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
	case <-t.C:
	}
}
