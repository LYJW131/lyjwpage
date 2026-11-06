package main

import (
	"bufio"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestParseActiveWindow(t *testing.T) {
	w, err := parseActiveWindow([]byte(`{"class":"com.mitchellh.ghostty","title":"zsh","workspace":{"id":3,"name":"3"}}`))
	if err != nil || w == nil || w.Class != "com.mitchellh.ghostty" || w.Workspace.Name != "3" {
		t.Fatalf("got %+v, %v", w, err)
	}
	// Hyprland answers {} when no window has focus.
	if w, err := parseActiveWindow([]byte(`{}`)); err != nil || w != nil {
		t.Fatalf("empty: got %+v, %v", w, err)
	}
}

func TestIsFocusEvent(t *testing.T) {
	for line, want := range map[string]bool{
		"activewindow>>kitty,zsh":        true,
		"activewindowv2>>55e1343":        true,
		"workspace>>2":                   true,
		"windowtitlev2>>55e1343,vim":     true,
		"openlayer>>notifications":       false,
		"activewindow-without-separator": false,
	} {
		if got := isFocusEvent(line); got != want {
			t.Errorf("%q: got %v", line, got)
		}
	}
}

func TestFindAppName(t *testing.T) {
	dir := t.TempDir()
	write := func(name, body string) {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	write("com.mitchellh.ghostty.desktop", "[Desktop Entry]\nName=Ghostty\nName[zh_CN]=鬼\n[Desktop Action new]\nName=New Window\n")
	write("chromium-webapp.desktop", "[Desktop Entry]\nName=HEY\nStartupWMClass=chrome-app.hey.com__-Default\n")

	for class, want := range map[string]string{
		"com.mitchellh.ghostty":        "Ghostty",
		"chrome-app.hey.com__-Default": "HEY",
		"unknown":                      "",
	} {
		if got := findAppEntry([]string{dir}, class).name; got != want {
			t.Errorf("%q: got %q, want %q", class, got, want)
		}
	}
	names := &appNames{cache: map[string]appInfo{}, dirs: []string{dir}}
	if got := names.lookup("unknown").name; got != "unknown" {
		t.Errorf("fallback to class: got %q", got)
	}
}

func TestEncodeReport(t *testing.T) {
	icon := &appIcon{hash: strings.Repeat("a", 64)}
	names := &appNames{cache: map[string]appInfo{"firefox": {name: "Firefox", icon: icon}}}
	d, _ := desktopOf(&activeWindow{Class: "firefox", Title: "Docs"}, names, func(*appIcon) bool { return false })
	if deref(d.IconHash) != icon.hash || d.IconObjectKey != nil {
		t.Fatalf("icon not uploaded yet: %+v", d)
	}
	d, _ = desktopOf(&activeWindow{Class: "firefox", Title: "Docs"}, names, func(*appIcon) bool { return true })
	if deref(d.IconObjectKey) != icon.hash+".png" {
		t.Fatalf("icon uploaded: %+v", d)
	}
	at := time.UnixMilli(1793933395000)
	body, err := encodeReport(d, at)
	if err != nil {
		t.Fatal(err)
	}
	var got map[string]any
	_ = json.Unmarshal(body, &got)
	desktop := got["modules"].(map[string]any)["desktop"].(map[string]any)
	if got["version"] != float64(1) || got["observedAt"] != float64(at.UnixMilli()) ||
		desktop["applicationName"] != "Firefox" || desktop["appId"] != "firefox" || desktop["workspace"] != nil {
		t.Fatalf("got %s", body)
	}
	// No focused window still reports, with desktop: null.
	body, _ = encodeReport(nil, at)
	if !strings.Contains(string(body), `"desktop":null`) {
		t.Fatalf("got %s", body)
	}
}

func TestSameApp(t *testing.T) {
	a := &Desktop{ApplicationName: "Ghostty", WindowTitle: optional("◐ claude")}
	b := &Desktop{ApplicationName: "Ghostty", WindowTitle: optional("◓ claude")}
	if !sameApp(a, b) || sameDesktop(a, b) {
		t.Fatal("title-only change should be the same app but a different desktop")
	}
	if sameApp(a, nil) || !sameApp(nil, nil) {
		t.Fatal("nil handling")
	}
}

func TestParseEnv(t *testing.T) {
	got := parseEnv(bufio.NewScanner(strings.NewReader("# comment\nACCESS_CLIENT_ID=\"abc.access\"\n\nDRY_RUN = true\n")))
	if got["ACCESS_CLIENT_ID"] != "abc.access" || got["DRY_RUN"] != "true" {
		t.Fatalf("got %v", got)
	}
}
