package main

import (
	"fmt"
	"strings"
	"time"

	"github.com/egoist/mygo"
	"github.com/egoist/mygo/ui"
)

type tone int

const (
	toneMuted tone = iota
	toneGood
	toneWarn
	toneBad
)

func (h *hub) state() (string, tone) {
	switch {
	case !h.cfg.canPush():
		return "未配置凭据", toneWarn
	case h.paused:
		return "已暂停", toneMuted
	case h.st.err != nil:
		return "出错", toneBad
	case h.st.pushedAt.IsZero():
		return "启动中", toneMuted
	case h.cfg.dryRun:
		return "试运行", toneWarn
	default:
		return "上报中", toneGood
	}
}

// headline is the one line the tray menu and tooltip show.
func (h *hub) headline() string {
	label, _ := h.state()
	if d := h.st.desktop; d != nil && !h.paused && (h.st.err == nil || !h.cfg.canPush()) {
		return label + " · " + d.ApplicationName
	}
	return label
}

func (h *hub) view(c *ui.Context) {
	if c.Shortcut(ui.Cmd, ui.KeyW) {
		h.win.Hide()
	}
	ui.Column(c).Fill().Padding(20).Gap(16).Children(func() {
		h.header(c)
		ui.Tabs(c, &h.tab, "概览", "设置")
		ui.Scroll(c).Grow(1).Children(func() {
			ui.Column(c).Gap(16).Children(func() {
				if h.tab == 0 {
					h.overview(c)
				} else {
					h.settings(c)
				}
			})
		})
	})
}

func (h *hub) header(c *ui.Context) {
	t := c.Theme()
	label, tn := h.state()
	dot := map[tone]ui.Color{toneMuted: t.TextMuted, toneGood: t.Success, toneWarn: t.Warning, toneBad: t.Danger}[tn]
	ui.Row(c).Gap(12).AlignItems(ui.Center).Children(func() {
		ui.Column(c).Grow(1).Gap(2).Children(func() {
			ui.Text(c, "Omarchy Reporter").FontSize(20).Bold()
			ui.Text(c, "把这台机器的前台应用上报到 lyjwpage").FontSize(12).TextColor(t.TextMuted)
		})
		ui.Row(c).Gap(6).AlignItems(ui.Center).Children(func() {
			ui.Box(c).Width(8).Height(8).Radius(4).Background(dot)
			ui.Text(c, label).FontSize(13)
		})
	})
}

func card(c *ui.Context, title string, fn func()) {
	t := c.Theme()
	ui.Column(c).Gap(10).Padding(14).Radius(10).Background(t.Surface).Border(1, t.Border).Children(func() {
		ui.Text(c, title).FontSize(12).TextColor(t.TextMuted)
		fn()
	})
}

func row(c *ui.Context, label, value string) {
	t := c.Theme()
	ui.Row(c).Gap(12).Children(func() {
		ui.Text(c, label).Width(84).TextColor(t.TextMuted)
		ui.Text(c, value).Grow(1).Wrap().Selectable()
	})
}

func orDash(s *string) string {
	if s == nil || *s == "" {
		return "—"
	}
	return *s
}

func (h *hub) overview(c *ui.Context) {
	t := c.Theme()
	card(c, "前台应用", func() {
		d := h.st.desktop
		if d == nil {
			ui.Text(c, "没有聚焦的窗口").TextColor(t.TextMuted)
			return
		}
		ui.Text(c, d.ApplicationName).FontSize(22).Bold()
		row(c, "窗口标题", orDash(d.WindowTitle))
		row(c, "App ID", orDash(d.AppID))
		row(c, "工作区", orDash(d.Workspace))
	})

	card(c, "上报", func() {
		last := "还没有"
		if !h.st.pushedAt.IsZero() {
			last = h.st.pushedAt.Format(time.TimeOnly)
		}
		row(c, "最近一次", last)
		row(c, "本次已上报", fmt.Sprintf("%d 次", h.st.pushes))
		row(c, "上报地址", h.cfg.ingestURL)
		if h.st.err != nil && h.cfg.canPush() {
			ui.Text(c, h.st.err.Error()).Wrap().TextColor(t.Danger).Selectable()
		}
		if !h.cfg.canPush() {
			ui.Text(c, "到「设置」里填 Access Client ID 和 Secret，或打开试运行。").Wrap().TextColor(t.Warning)
		}
	})

	card(c, "控制", func() {
		ui.Form(c, func() {
			paused := h.paused
			ui.Field(c, "暂停上报", func() {
				if ui.Switch(c, &paused).Changed() {
					h.setPaused(paused)
				}
			}).Description("暂停期间什么都不发，站点过几分钟就当这台机器不在线。")
			login := h.openAtLogin
			ui.Field(c, "登录时启动", func() {
				if ui.Switch(c, &login).Changed() {
					if err := mygo.App.SetOpenAtLogin(login); err == nil {
						h.openAtLogin = login
					}
				}
			}).Description("自启时只进托盘，不弹窗口。")
		})
	})
}

func (h *hub) settings(c *ui.Context) {
	t := c.Theme()
	card(c, "上报", func() {
		ui.Form(c, func() {
			ui.Field(c, "上报地址", func() {
				ui.TextInput(c, &h.form.ingestURL).Placeholder(defaultIngestURL)
			})
			ui.Field(c, "Client ID", func() {
				ui.TextInput(c, &h.form.clientID).Placeholder("xxxx.access")
			})
			ui.Field(c, "Client Secret", func() {
				ui.TextInput(c, &h.form.clientSecret).Password()
			}).Description("Cloudflare Access service token，只授予 ingest:omarchy。")
			ui.Field(c, "试运行", func() {
				ui.Switch(c, &h.form.dryRun)
			}).Description("只把信封打到日志，不发给站点。")
		})
	})
	ui.Row(c).Gap(12).AlignItems(ui.Center).Children(func() {
		ui.Text(c, h.saveMsg).Grow(1).FontSize(12).TextColor(t.TextMuted)
		dirty := h.form != h.cfg
		if ui.Button(c, "还原").Disabled(!dirty).Clicked() {
			h.form, h.saveMsg = h.cfg, ""
		}
		if ui.PrimaryButton(c, "保存").Disabled(!dirty).Clicked() {
			h.save()
		}
	})
	ui.Text(c, "配置文件："+h.cfg.path).FontSize(12).Wrap().TextColor(t.TextMuted).Selectable()
}

func (h *hub) save() {
	next := h.form
	next.ingestURL = strings.TrimSpace(next.ingestURL)
	if next.ingestURL == "" {
		next.ingestURL = defaultIngestURL
	}
	next.clientID = strings.TrimSpace(next.clientID)
	next.clientSecret = strings.TrimSpace(next.clientSecret)
	if err := saveConfig(next); err != nil {
		h.saveMsg = "保存失败：" + err.Error()
		return
	}
	h.cfg, h.form = next, next
	h.saveMsg = "已保存，上报已按新设置重启"
	h.start()
}
