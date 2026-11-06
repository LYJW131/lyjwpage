// Omarchy-reporter reports the focused Hyprland window of this Omarchy
// machine to lyjwpage, from a tray icon that can pause it.
package main

import (
	"bytes"
	"context"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"log"
	"net/http"
	"time"

	"github.com/egoist/mygo"
)

func main() {
	mygo.App.SetName("Omarchy Reporter")
	cfg := loadConfig()
	logf := func(format string, args ...any) { log.Printf(format, args...) }

	dir, err := hyprlandDir()
	if err != nil {
		log.Fatal(err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	r := &reporter{
		cfg:    cfg,
		dir:    dir,
		names:  newAppNames(),
		logf:   logf,
		resume: make(chan struct{}, 1),
	}
	if cfg.dryRun {
		r.push = func(_ context.Context, body []byte) error { log.Printf("dry run: %s", body); return nil }
	} else {
		r.push = pusher{cfg: cfg, client: &http.Client{}}.push
	}

	mygo.App.WhenReady(func() {
		statusItem := &mygo.MenuItem{Label: "Starting…", Disabled: true}
		menu := mygo.NewMenu([]*mygo.MenuItem{
			statusItem,
			mygo.Separator(),
			{Label: "Pause reporting", Type: mygo.MenuItemCheckbox, Click: func(it *mygo.MenuItem, _ *mygo.Window) {
				r.setPaused(it.Checked)
			}},
			{Label: "Open at login", Type: mygo.MenuItemCheckbox, Checked: mygo.App.OpenAtLogin(), Click: func(it *mygo.MenuItem, _ *mygo.Window) {
				if err := mygo.App.SetOpenAtLogin(it.Checked); err != nil {
					logf("open at login: %v", err)
					it.SetChecked(!it.Checked)
				}
			}},
			mygo.Separator(),
			{Role: mygo.RoleQuit},
		})
		tray, err := mygo.NewTray(mygo.TrayOptions{Icon: trayIcon(color.RGBA{0x7a, 0xa2, 0xf7, 0xff}), ToolTip: "Omarchy Reporter", Menu: menu})
		if err != nil {
			log.Fatal("tray: ", err)
		}
		mygo.App.OnWillQuit(func(*mygo.QuitEvent) { cancel(); tray.Destroy() })

		if !cfg.canPush() {
			statusItem.SetLabel("Missing credentials in " + cfg.path)
			return
		}
		r.onState = func(s status) {
			label := describe(s)
			mygo.RunOnMain(func() {
				statusItem.SetLabel(label)
				tray.SetToolTip("Omarchy Reporter — " + label)
			})
		}
		go r.run(ctx)
	})
	if err := mygo.App.Run(); err != nil {
		log.Fatal(err)
	}
}

func describe(s status) string {
	switch {
	case s.paused:
		return "Paused"
	case s.err != nil:
		return "Error: " + s.err.Error()
	case s.desktop == nil:
		return fmt.Sprintf("No focused window · %s", s.pushedAt.Format(time.TimeOnly))
	default:
		return fmt.Sprintf("%s · %s", s.desktop.ApplicationName, s.pushedAt.Format(time.TimeOnly))
	}
}

// trayIcon draws a filled dot, 32×32 for high-density panels.
func trayIcon(c color.Color) []byte {
	const size = 32
	img := image.NewNRGBA(image.Rect(0, 0, size, size))
	for y := range size {
		for x := range size {
			dx, dy := float64(x)-15.5, float64(y)-15.5
			if dx*dx+dy*dy <= 10*10 {
				img.Set(x, y, c)
			}
		}
	}
	var buf bytes.Buffer
	_ = png.Encode(&buf, img)
	return buf.Bytes()
}
