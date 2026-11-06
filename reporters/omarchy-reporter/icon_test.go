package main

import (
	"bytes"
	"context"
	"image"
	"image/color"
	"image/png"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func writePNG(t *testing.T, path string, size int) {
	t.Helper()
	img := image.NewNRGBA(image.Rect(0, 0, size, size/2))
	for x := range size {
		img.Set(x, 0, color.NRGBA{255, 0, 0, 255})
	}
	var buf bytes.Buffer
	_ = png.Encode(&buf, img)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, buf.Bytes(), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestFindIconFile(t *testing.T) {
	root := t.TempDir()
	writePNG(t, filepath.Join(root, "hicolor/48x48/apps/foo.png"), 48)
	writePNG(t, filepath.Join(root, "hicolor/256x256/apps/foo.png"), 256)
	writePNG(t, filepath.Join(root, "hicolor/32x32@2/apps/foo.png"), 64)
	writePNG(t, filepath.Join(root, "Mine/64x64/apps/bar.png"), 64)
	writePNG(t, filepath.Join(root, "hicolor/512x512/apps/bar.png"), 512)

	if got := findIconFile("foo", []string{root}, []string{"Mine", "hicolor"}); !strings.Contains(got, "256x256") {
		t.Errorf("largest bitmap: got %s", got)
	}
	// The first theme that has the icon wins, as the theme spec says.
	if got := findIconFile("bar", []string{root}, []string{"Mine", "hicolor"}); !strings.Contains(got, "Mine") {
		t.Errorf("theme order: got %s", got)
	}
	if got := findIconFile("nope", []string{root}, []string{"hicolor"}); got != "" {
		t.Errorf("missing: got %s", got)
	}
	if iconDirSize("x/scalable/apps/a.svg", ".svg") <= iconDirSize("x/512x512/apps/a.png", ".png") {
		t.Error("SVG should rank above bitmaps")
	}
}

func TestRenderIcon(t *testing.T) {
	path := filepath.Join(t.TempDir(), "wide.png")
	writePNG(t, path, 512)
	icon, err := renderIcon(context.Background(), path)
	if err != nil {
		t.Fatal(err)
	}
	img, err := png.Decode(bytes.NewReader(icon.png))
	if err != nil || img.Bounds().Dx() != iconSize || img.Bounds().Dy() != iconSize {
		t.Fatalf("got %v, %v", img.Bounds(), err)
	}
	// A wide icon is letterboxed: the top row stays transparent.
	if _, _, _, a := img.At(iconSize/2, 0).RGBA(); a != 0 {
		t.Error("expected transparent padding")
	}
	if icon.hash != hashHex(icon.png) || icon.objectKey() != icon.hash+".png" {
		t.Error("hash must be the SHA-256 of the PNG")
	}
}

func TestBucketEnsure(t *testing.T) {
	var seen []string
	stored := map[string]bool{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seen = append(seen, r.Method+" "+r.URL.Path)
		if !strings.HasPrefix(r.Header.Get("Authorization"), "AWS4-HMAC-SHA256 Credential=id/") ||
			!strings.Contains(r.Header.Get("Authorization"), "/auto/s3/aws4_request") {
			w.WriteHeader(http.StatusForbidden)
			return
		}
		switch r.Method {
		case http.MethodHead:
			if !stored[r.URL.Path] {
				w.WriteHeader(http.StatusNotFound)
			}
		case http.MethodPut:
			if r.Header.Get("Content-Type") != "image/png" {
				w.WriteHeader(http.StatusBadRequest)
				return
			}
			stored[r.URL.Path] = true
		}
	}))
	defer srv.Close()
	b := config{r2Endpoint: srv.URL + "/", r2Bucket: "images", r2AccessKeyID: "id", r2SecretAccessKey: "secret"}.bucket()
	icon := &appIcon{png: []byte("png"), hash: hashHex([]byte("png"))}
	for range 2 {
		if err := b.ensure(context.Background(), icon); err != nil {
			t.Fatal(err)
		}
	}
	key := "/images/" + icon.hash + ".png"
	want := []string{"HEAD " + key, "PUT " + key, "HEAD " + key}
	if strings.Join(seen, ",") != strings.Join(want, ",") {
		t.Fatalf("got %v", seen)
	}
	if (config{r2Bucket: "x"}).bucket() != nil {
		t.Error("partial R2 settings must not upload")
	}
}
