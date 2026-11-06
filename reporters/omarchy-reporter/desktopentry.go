package main

import (
	"bufio"
	"context"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

// appInfo is what the desktop entry of a Wayland app_id (Hyprland class)
// says: its Name, so the site gets "Ghostty" rather than
// "com.mitchellh.ghostty", and its icon.
type appInfo struct {
	name string
	icon *appIcon // nil when the entry names none or it cannot be drawn
}

type appNames struct {
	mu     sync.Mutex
	cache  map[string]appInfo
	dirs   []string
	roots  []string
	themes []string
}

func newAppNames() *appNames {
	roots := iconRoots()
	return &appNames{cache: map[string]appInfo{}, dirs: applicationDirs(), roots: roots, themes: iconThemes(roots)}
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

func (a *appNames) lookup(class string) appInfo {
	if class == "" {
		return appInfo{}
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	if info, ok := a.cache[class]; ok {
		return info
	}
	entry := findAppEntry(a.dirs, class)
	info := appInfo{name: entry.name}
	if info.name == "" {
		info.name = class
	}
	iconName := entry.icon
	if iconName == "" {
		iconName = class
	}
	if path := findIconFile(iconName, a.roots, a.themes); path != "" {
		info.icon, _ = renderIcon(context.Background(), path)
	}
	a.cache[class] = info
	return info
}

// findAppEntry prefers a desktop entry whose StartupWMClass is the class,
// then one whose file name is the class (as Wayland apps name them).
func findAppEntry(dirs []string, class string) desktopEntry {
	var byFile desktopEntry
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
				byFile = entry
				return filepath.SkipAll
			}
			if fileMatch && byFile.name == "" {
				byFile = entry
			}
			return nil
		})
	}
	return byFile
}

type desktopEntry struct{ name, wmClass, icon string }

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
		case "Icon":
			e.icon = strings.TrimSpace(value)
		case "StartupWMClass":
			e.wmClass = strings.TrimSpace(value)
		}
	}
	return e
}
