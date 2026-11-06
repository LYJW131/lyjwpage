package main

import (
	"bufio"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

// appNames maps a Wayland app_id (Hyprland class) to the Name of its desktop
// entry, so the site gets "Ghostty" rather than "com.mitchellh.ghostty".
type appNames struct {
	mu    sync.Mutex
	cache map[string]string
	dirs  []string
}

func newAppNames() *appNames {
	return &appNames{cache: map[string]string{}, dirs: applicationDirs()}
}

func applicationDirs() []string {
	home, _ := os.UserHomeDir()
	dataHome := os.Getenv("XDG_DATA_HOME")
	if dataHome == "" {
		dataHome = filepath.Join(home, ".local/share")
	}
	dataDirs := os.Getenv("XDG_DATA_DIRS")
	if dataDirs == "" {
		dataDirs = "/usr/local/share:/usr/share"
	}
	dirs := []string{filepath.Join(dataHome, "applications")}
	for _, d := range strings.Split(dataDirs, ":") {
		if d != "" {
			dirs = append(dirs, filepath.Join(d, "applications"))
		}
	}
	return dirs
}

func (a *appNames) lookup(class string) string {
	if class == "" {
		return ""
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	if name, ok := a.cache[class]; ok {
		return name
	}
	name := findAppName(a.dirs, class)
	if name == "" {
		name = class
	}
	a.cache[class] = name
	return name
}

// findAppName prefers a desktop entry whose StartupWMClass is the class,
// then one whose file name is the class (as Wayland apps name them).
func findAppName(dirs []string, class string) string {
	var byFile string
	for _, dir := range dirs {
		_ = filepath.WalkDir(dir, func(path string, d os.DirEntry, err error) error {
			if err != nil || d.IsDir() || !strings.HasSuffix(path, ".desktop") {
				return nil
			}
			id := strings.TrimSuffix(filepath.Base(path), ".desktop")
			fileMatch := strings.EqualFold(id, class)
			entry, err := readDesktopEntry(path)
			if err != nil {
				return nil
			}
			if strings.EqualFold(entry.wmClass, class) && entry.name != "" {
				byFile = entry.name
				return filepath.SkipAll
			}
			if fileMatch && byFile == "" {
				byFile = entry.name
			}
			return nil
		})
	}
	return byFile
}

type desktopEntry struct{ name, wmClass string }

func readDesktopEntry(path string) (desktopEntry, error) {
	f, err := os.Open(path)
	if err != nil {
		return desktopEntry{}, err
	}
	defer f.Close()
	return parseDesktopEntry(bufio.NewScanner(f)), nil
}

func parseDesktopEntry(s *bufio.Scanner) desktopEntry {
	var e desktopEntry
	inMain := false
	for s.Scan() {
		line := strings.TrimSpace(s.Text())
		if strings.HasPrefix(line, "[") {
			inMain = line == "[Desktop Entry]"
			continue
		}
		if !inMain {
			continue
		}
		key, value, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		switch strings.TrimSpace(key) {
		case "Name":
			e.name = strings.TrimSpace(value)
		case "StartupWMClass":
			e.wmClass = strings.TrimSpace(value)
		}
	}
	return e
}
