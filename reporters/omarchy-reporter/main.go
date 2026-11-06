// Omarchy-reporter reports the focused Hyprland window of this Omarchy
// machine to lyjwpage. A window shows what it reports and edits its
// settings; closing it leaves the app in the tray.
package main

import (
	"context"
	_ "embed"
	"errors"
	"log"
	"net/http"

	"github.com/egoist/mygo"
	"github.com/egoist/mygo/ui"
)

//go:embed resources/icon.png
var appIcon []byte

//go:embed resources/tray.png
var trayPNG []byte

var errNotConfigured = errors.New("missing Access credentials")

func main() {
	mygo.App.SetName("Omarchy Reporter")
	dir, err := hyprlandDir()
	if err != nil {
		log.Fatal(err)
	}
	h := &hub{dir: dir, names: newAppNames(), cfg: loadConfig()}
	h.form = h.cfg

	mygo.App.WhenReady(h.ready)
	mygo.App.OnBeforeQuit(func(*mygo.QuitEvent) { h.quitting = true })
	mygo.App.OnWillQuit(func(*mygo.QuitEvent) {
		h.stop()
		if h.tray != nil {
			h.tray.Destroy()
		}
	})
	if err := mygo.App.Run(); err != nil {
		log.Fatal(err)
	}
}

// hub is the app's state. The view, the tray callbacks and win.Update
// funcs all run on the main thread, so it needs no lock.
type hub struct {
	dir   string
	names *appNames
	cfg   config // what the reporter runs with
	form  config // what the settings page edits
	st    status
	tab   int

	paused, openAtLogin, quitting bool
	saveMsg                       string

	win        *mygo.Window
	tray       *mygo.Tray
	statusItem *mygo.MenuItem
	pauseItem  *mygo.MenuItem
	r          *reporter
	cancel     context.CancelFunc
}

func (h *hub) ready() {
	h.openAtLogin = mygo.App.OpenAtLogin()
	h.win = mygo.NewWindow(mygo.WindowOptions{
		Title:   "Omarchy Reporter",
		Width:   480,
		Height:  600,
		Hidden:  mygo.App.WasOpenedAtLogin(),
		Content: ui.View(h.view),
	})
	h.win.SetIcon(appIcon)
	h.win.OnClose(func(e *mygo.CloseEvent) {
		if !h.quitting {
			e.PreventDefault()
			h.win.Hide()
		}
	})

	h.statusItem = &mygo.MenuItem{Label: "启动中…", Disabled: true}
	h.pauseItem = &mygo.MenuItem{Label: "暂停上报", Type: mygo.MenuItemCheckbox, Click: func(it *mygo.MenuItem, _ *mygo.Window) {
		h.setPaused(it.Checked)
		h.win.Invalidate()
	}}
	tray, err := mygo.NewTray(mygo.TrayOptions{
		Icon:    trayPNG,
		ToolTip: "Omarchy Reporter",
		Menu: mygo.NewMenu([]*mygo.MenuItem{
			h.statusItem,
			mygo.Separator(),
			{Label: "打开主窗口", Click: func(*mygo.MenuItem, *mygo.Window) { h.show() }},
			h.pauseItem,
			mygo.Separator(),
			{Label: "退出", Role: mygo.RoleQuit},
		}),
	})
	if err != nil {
		log.Println("tray:", err)
	} else {
		h.tray = tray
		tray.OnClick(h.show)
	}
	h.start()
}

func (h *hub) show() {
	h.win.Show()
	h.win.Focus()
}

func (h *hub) setPaused(p bool) {
	h.paused = p
	h.pauseItem.SetChecked(p)
	if h.r != nil {
		h.r.setPaused(p)
	}
}

func (h *hub) stop() {
	if h.cancel != nil {
		h.cancel()
		h.cancel, h.r = nil, nil
	}
}

// start (re)starts the reporter with h.cfg.
func (h *hub) start() {
	h.stop()
	h.st = status{paused: h.paused}
	h.refreshTray()
	ctx, cancel := context.WithCancel(context.Background())
	r := &reporter{
		cfg:    h.cfg,
		dir:    h.dir,
		names:  h.names,
		logf:   log.Printf,
		resume: make(chan struct{}, 1),
	}
	r.paused.Store(h.paused)
	switch {
	case !h.cfg.canPush():
		// Still sample, so the window shows what would be reported.
		r.push = func(context.Context, []byte) error { return errNotConfigured }
	case h.cfg.dryRun:
		r.push = func(_ context.Context, body []byte) error { log.Printf("dry run: %s", body); return nil }
	default:
		r.push = pusher{cfg: h.cfg, client: &http.Client{}}.push
	}
	r.onState = func(s status) {
		h.win.Update(func() {
			if h.r == r {
				h.st = s
				h.refreshTray()
			}
		})
	}
	h.r, h.cancel = r, cancel
	go r.run(ctx)
}

func (h *hub) refreshTray() {
	if h.statusItem == nil {
		return
	}
	label := h.headline()
	h.statusItem.SetLabel(label)
	if h.tray != nil {
		h.tray.SetToolTip("Omarchy Reporter — " + label)
	}
}
