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
	"sync/atomic"

	"github.com/egoist/mygo"
	"github.com/egoist/mygo/ui"
)

//go:embed resources/icon.png
var selfIconPNG []byte

//go:embed resources/tray.png
var trayPNG []byte

var errNotConfigured = errors.New("missing Access credentials")

func main() {
	mygo.App.SetName("Omarchy Reporter")
	dir, err := hyprlandDir()
	if err != nil {
		log.Fatal(err)
	}
	h := &hub{dir: dir, names: newAppNames(), cfg: loadConfig(), icons: map[string]ui.ImageSource{}, judge: newTitleJudge(titleCachePath())}
	h.form = h.cfg
	h.judge.configure(h.cfg.titleRules())
	h.judge.onVerdict = func() {
		if r := h.current.Load(); r != nil {
			r.wake()
		}
		if h.win != nil {
			h.win.Update(func() {})
		}
	}
	h.judge.onConfirm = h.askForConfirmation

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
	icons map[string]ui.ImageSource

	paused, openAtLogin, quitting bool
	saveMsg                       string

	win        *mygo.Window
	tray       *mygo.Tray
	statusItem *mygo.MenuItem
	pauseItem  *mygo.MenuItem
	r          *reporter
	cancel     context.CancelFunc
	judge      *titleJudge
	// current is h.r for the judge's callbacks, which run off the main thread.
	current atomic.Pointer[reporter]
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
	h.win.SetIcon(selfIconPNG)
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
		h.current.Store(nil)
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
		poke:   make(chan struct{}, 1),
		bucket: h.cfg.bucket(),
		judge:  h.judge,
	}
	if h.cfg.dryRun {
		r.bucket = nil
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
	h.current.Store(r)
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

// askForConfirmation shows a desktop notification for a title waiting on
// the owner; a click opens the review tab. The notification decides
// nothing by itself: the entry stays in the list either way.
func (h *hub) askForConfirmation(e titleEntry) {
	mygo.RunOnMain(func() {
		n := mygo.NewNotification(mygo.NotificationOptions{
			ID:       "title-" + hashHex([]byte(e.key()))[:16],
			Title:    e.ApplicationName + " 窗口标题公开确认",
			Subtitle: e.reason(),
			Body:     e.Title,
		})
		n.OnClick(func() {
			h.tab = tabTitles
			h.show()
			h.win.Invalidate()
		})
		if err := n.Show(); err != nil {
			log.Printf("notification: %v", err)
		}
	})
}
