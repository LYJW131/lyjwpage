package main

import (
	"bufio"
	"fmt"
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

	r2Endpoint, r2Bucket, r2AccessKeyID, r2SecretAccessKey string
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

		r2Endpoint:        get("R2_ENDPOINT"),
		r2Bucket:          get("R2_BUCKET"),
		r2AccessKeyID:     get("R2_ACCESS_KEY_ID"),
		r2SecretAccessKey: get("R2_SECRET_ACCESS_KEY"),
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

// saveConfig writes the settings the window edits; the file holds the
// Access secret, so only the user may read it.
func saveConfig(c config) error {
	if err := os.MkdirAll(filepath.Dir(c.path), 0o700); err != nil {
		return err
	}
	body := fmt.Sprintf("SITE_INGEST_URL=%s\nACCESS_CLIENT_ID=%s\nACCESS_CLIENT_SECRET=%s\nDRY_RUN=%t\n"+
		"R2_ENDPOINT=%s\nR2_BUCKET=%s\nR2_ACCESS_KEY_ID=%s\nR2_SECRET_ACCESS_KEY=%s\n",
		c.ingestURL, c.clientID, c.clientSecret, c.dryRun,
		c.r2Endpoint, c.r2Bucket, c.r2AccessKeyID, c.r2SecretAccessKey)
	tmp := c.path + ".tmp"
	if err := os.WriteFile(tmp, []byte(body), 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, c.path)
}
