package main

import (
	"bufio"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"image"
	_ "image/jpeg"
	"image/png"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"golang.org/x/image/draw"
)

// iconSize is the edge of the PNG uploaded for an app, the size the Mac
// reporter's icons are drawn at on the site.
const iconSize = 128

type appIcon struct {
	png  []byte
	hash string // SHA-256 of png, hex
}

func (i *appIcon) objectKey() string { return i.hash + ".png" }

// iconThemes lists the themes to search for an icon name: the user's theme,
// the themes it inherits, then hicolor, as the icon theme spec orders them.
func iconThemes(roots []string) []string {
	theme := ""
	if out, err := exec.Command("gsettings", "get", "org.gnome.desktop.interface", "icon-theme").Output(); err == nil {
		theme = strings.Trim(strings.TrimSpace(string(out)), "'")
	}
	var themes []string
	seen := map[string]bool{}
	var add func(string)
	add = func(name string) {
		if name == "" || seen[name] || len(themes) > 8 {
			return
		}
		seen[name] = true
		themes = append(themes, name)
		for _, root := range roots {
			if inherits := themeInherits(filepath.Join(root, name, "index.theme")); inherits != nil {
				for _, parent := range inherits {
					add(parent)
				}
				return
			}
		}
	}
	add(theme)
	add("hicolor")
	return themes
}

func themeInherits(path string) []string {
	f, err := os.Open(path)
	if err != nil {
		return nil
	}
	defer f.Close()
	s := bufio.NewScanner(f)
	for s.Scan() {
		if v, ok := strings.CutPrefix(strings.TrimSpace(s.Text()), "Inherits="); ok {
			var out []string
			for _, p := range strings.Split(v, ",") {
				if p = strings.TrimSpace(p); p != "" {
					out = append(out, p)
				}
			}
			return out
		}
	}
	return []string{}
}

func iconRoots() []string {
	home, _ := os.UserHomeDir()
	var roots []string
	for _, d := range applicationDirs() {
		roots = append(roots, filepath.Join(filepath.Dir(d), "icons"))
	}
	return append([]string{filepath.Join(home, ".icons")}, roots...)
}

// findIconFile resolves the Icon= of a desktop entry to a file: an absolute
// path as is, otherwise the best match in the first theme that has one
// (a scalable SVG, else the largest PNG), then /usr/share/pixmaps.
func findIconFile(name string, roots, themes []string) string {
	if name == "" {
		return ""
	}
	if filepath.IsAbs(name) {
		if _, err := os.Stat(name); err == nil {
			return name
		}
		return ""
	}
	for _, theme := range themes {
		best, bestSize := "", -1
		for _, root := range roots {
			dir := filepath.Join(root, theme)
			_ = filepath.WalkDir(dir, func(path string, d os.DirEntry, err error) error {
				if err != nil || d.IsDir() {
					return nil
				}
				base := filepath.Base(path)
				ext := filepath.Ext(base)
				if strings.TrimSuffix(base, ext) != name || (ext != ".svg" && ext != ".png") {
					return nil
				}
				if size := iconDirSize(path, ext); size > bestSize {
					best, bestSize = path, size
				}
				return nil
			})
		}
		if best != "" {
			return best
		}
	}
	for _, ext := range []string{".svg", ".png"} {
		p := filepath.Join("/usr/share/pixmaps", name+ext)
		if _, err := os.Stat(p); err == nil {
			return p
		}
	}
	return ""
}

// iconDirSize ranks an icon by the size its directory names, as
// "256x256" or "48x48@2", an SVG above any bitmap.
func iconDirSize(path, ext string) int {
	if ext == ".svg" {
		return 1 << 20
	}
	for _, part := range strings.Split(filepath.ToSlash(path), "/") {
		w, rest, ok := strings.Cut(part, "x")
		if !ok {
			continue
		}
		h, scale, _ := strings.Cut(rest, "@")
		wn, err1 := strconv.Atoi(w)
		_, err2 := strconv.Atoi(h)
		if err1 == nil && err2 == nil {
			if s, err := strconv.Atoi(scale); err == nil && s > 1 {
				return wn * s
			}
			return wn
		}
	}
	return 0
}

// renderIcon turns an icon file into a square PNG of iconSize.
func renderIcon(ctx context.Context, path string) (*appIcon, error) {
	var src image.Image
	if strings.HasSuffix(path, ".svg") {
		ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
		defer cancel()
		out, err := exec.CommandContext(ctx, "rsvg-convert", "-w", strconv.Itoa(iconSize), "-h", strconv.Itoa(iconSize), "-a", path).Output()
		if err != nil {
			return nil, err
		}
		if src, _, err = image.Decode(bytes.NewReader(out)); err != nil {
			return nil, err
		}
	} else {
		f, err := os.Open(path)
		if err != nil {
			return nil, err
		}
		defer f.Close()
		if src, _, err = image.Decode(f); err != nil {
			return nil, err
		}
	}
	dst := image.NewNRGBA(image.Rect(0, 0, iconSize, iconSize))
	b := src.Bounds()
	scale := float64(iconSize) / float64(max(b.Dx(), b.Dy()))
	w, h := int(float64(b.Dx())*scale+0.5), int(float64(b.Dy())*scale+0.5)
	x, y := (iconSize-w)/2, (iconSize-h)/2
	draw.CatmullRom.Scale(dst, image.Rect(x, y, x+w, y+h), src, b, draw.Over, nil)
	var buf bytes.Buffer
	if err := png.Encode(&buf, dst); err != nil {
		return nil, err
	}
	sum := sha256.Sum256(buf.Bytes())
	return &appIcon{png: buf.Bytes(), hash: hex.EncodeToString(sum[:])}, nil
}
