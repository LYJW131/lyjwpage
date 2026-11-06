package main

import (
	"bufio"
	"os"
	"path/filepath"
	"strings"
)

const defaultIngestURL = "https://ingest.homepage.lyjw.llc/api/ingest/omarchy"

type config struct {
	ingestURL    string
	clientID     string
	clientSecret string
	dryRun       bool
	path         string
}

func (c config) canPush() bool { return c.dryRun || (c.clientID != "" && c.clientSecret != "") }

func configPath() string {
	dir := os.Getenv("XDG_CONFIG_HOME")
	if dir == "" {
		home, _ := os.UserHomeDir()
		dir = filepath.Join(home, ".config")
	}
	return filepath.Join(dir, "lyjwpage", "omarchy-reporter.env")
}

// loadConfig reads KEY=VALUE lines from the config file; the process
// environment overrides them.
func loadConfig() config {
	path := configPath()
	values := map[string]string{}
	if f, err := os.Open(path); err == nil {
		values = parseEnv(bufio.NewScanner(f))
		f.Close()
	}
	get := func(key string) string {
		if v, ok := os.LookupEnv(key); ok {
			return strings.TrimSpace(v)
		}
		return values[key]
	}
	c := config{
		ingestURL:    get("SITE_INGEST_URL"),
		clientID:     get("ACCESS_CLIENT_ID"),
		clientSecret: get("ACCESS_CLIENT_SECRET"),
		dryRun:       get("DRY_RUN") == "true",
		path:         path,
	}
	if c.ingestURL == "" {
		c.ingestURL = defaultIngestURL
	}
	return c
}

func parseEnv(s *bufio.Scanner) map[string]string {
	values := map[string]string{}
	for s.Scan() {
		line := strings.TrimSpace(s.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		key, value, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		values[strings.TrimSpace(key)] = strings.Trim(strings.TrimSpace(value), `"'`)
	}
	return values
}
