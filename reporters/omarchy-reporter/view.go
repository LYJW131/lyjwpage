package main

import (
	"fmt"
	"strings"
	"time"

	"github.com/egoist/mygo"
	"github.com/egoist/mygo/ui"
)

const (
	tabOverview = iota
	tabTitles
	tabSettings
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
		ui.Tabs(c, &h.tab, "概览", "窗口标题", "设置")
		ui.Scroll(c).Grow(1).Children(func() {
			ui.Column(c).Gap(16).Children(func() {
				switch h.tab {
				case tabOverview:
					h.overview(c)
				case tabTitles:
					h.titles(c)
				default:
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
		ui.Row(c).Gap(12).AlignItems(ui.Center).Children(func() {
			if src := h.iconImage(h.st.icon); src != nil {
				ui.Image(c, src).Size(48, 48)
			}
			ui.Text(c, d.ApplicationName).FontSize(22).Bold()
		})
		row(c, "窗口标题", orDash(optional(h.st.title)))
		row(c, "标题判断", h.titleState(d))
		row(c, "App ID", orDash(d.AppID))
		row(c, "工作区", orDash(d.Workspace))
		row(c, "图标", h.iconState(d))
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
	card(c, "图标上传（R2）", func() {
		ui.Form(c, func() {
			ui.Field(c, "Endpoint", func() {
				ui.TextInput(c, &h.form.r2Endpoint).Placeholder("https://<account>.r2.cloudflarestorage.com")
			})
			ui.Field(c, "Bucket", func() { ui.TextInput(c, &h.form.r2Bucket) })
			ui.Field(c, "Access Key ID", func() { ui.TextInput(c, &h.form.r2AccessKeyID) })
			ui.Field(c, "Secret", func() {
				ui.TextInput(c, &h.form.r2SecretAccessKey).Password()
			}).Description("只能写图片桶的密钥。四项都填了才上传图标，没填就只报图标哈希。")
		})
	})
	h.saveRow(c)
	ui.Text(c, "配置文件："+h.cfg.path).FontSize(12).Wrap().TextColor(t.TextMuted).Selectable()
}

func (h *hub) saveRow(c *ui.Context) {
	t := c.Theme()
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
}

func (h *hub) save() {
	next := h.form
	next.ingestURL = strings.TrimSpace(next.ingestURL)
	if next.ingestURL == "" {
		next.ingestURL = defaultIngestURL
	}
	next.clientID = strings.TrimSpace(next.clientID)
	next.clientSecret = strings.TrimSpace(next.clientSecret)
	next.r2Endpoint = strings.TrimSpace(next.r2Endpoint)
	next.r2Bucket = strings.TrimSpace(next.r2Bucket)
	next.r2AccessKeyID = strings.TrimSpace(next.r2AccessKeyID)
	next.r2SecretAccessKey = strings.TrimSpace(next.r2SecretAccessKey)
	next.typesafeAPIKey = strings.TrimSpace(next.typesafeAPIKey)
	next.titleBlacklist = strings.Join(splitList(next.titleBlacklist), ",")
	next.titleTrusted = strings.Join(splitList(next.titleTrusted), ",")
	if err := saveConfig(next); err != nil {
		h.saveMsg = "保存失败：" + err.Error()
		return
	}
	h.cfg, h.form = next, next
	h.saveMsg = "已保存，上报已按新设置重启"
	h.judge.configure(next.titleRules())
	h.start()
}

// iconImage decodes an app icon once; the view runs every frame.
func (h *hub) iconImage(icon *appIcon) ui.ImageSource {
	if icon == nil {
		return nil
	}
	if src, ok := h.icons[icon.hash]; ok {
		return src
	}
	src, err := ui.DecodeImage(icon.png)
	if err != nil {
		src = nil
	}
	h.icons[icon.hash] = src
	return src
}

func (h *hub) iconState(d *Desktop) string {
	switch {
	case d.IconHash == nil:
		return "没找到"
	case d.IconObjectKey != nil:
		return "已上传"
	case h.cfg.dryRun || h.cfg.bucket() == nil:
		return "未上传（没配 R2）"
	default:
		return "上传中"
	}
}

func (h *hub) titleState(d *Desktop) string {
	s := h.st.titleStatus
	label := s.displayName()
	if e, ok := h.judge.entry(deref(d.AppID), h.st.title); ok && e.reason() != "" {
		label += " · " + e.reason()
	}
	if s == titleJudging && d.WindowTitle != nil {
		label += "（先沿用上一条已公开的标题）"
	}
	if s == titleUnavailable && strings.TrimSpace(h.cfg.typesafeAPIKey) == "" {
		label += "（没配 TypeSafe API Key）"
	}
	return label
}

func (h *hub) titles(c *ui.Context) {
	t := c.Theme()
	card(c, "规则", func() {
		ui.Form(c, func() {
			ui.Field(c, "上报窗口标题", func() {
				ui.Switch(c, &h.form.titleEnabled)
			}).Description("关掉就整条链不判、不报，判断记录留着。")
			ui.Field(c, "TypeSafe API Key", func() {
				ui.TextInput(c, &h.form.typesafeAPIKey).Password()
			}).Description("Jev 判断用。没配时所有标题按锁定处理，不上报。")
			ui.Field(c, "黑名单", func() {
				ui.TextInput(c, &h.form.titleBlacklist).Placeholder("org.telegram.desktop, signal")
			}).Description("App ID，逗号分隔。标题不判、不报。")
			ui.Field(c, "免判名单", func() {
				ui.TextInput(c, &h.form.titleTrusted).Placeholder("com.mitchellh.ghostty")
			}).Description("App ID，逗号分隔。标题不问 Jev，直接上报。")
		})
	})
	h.saveRow(c)
	if err := h.judge.error(); err != "" {
		ui.Text(c, err).Wrap().TextColor(t.Danger).Selectable()
	}
	entries := h.judge.review()
	card(c, fmt.Sprintf("判断记录（%d）", len(entries)), func() {
		if len(entries) == 0 {
			ui.Text(c, "还没有判断过的标题。").TextColor(t.TextMuted)
			return
		}
		if ui.Button(c.Key("clear"), "清除判断记录").Clicked() {
			go h.confirmClearTitles(len(entries))
		}
		for i, e := range entries {
			if i >= 200 {
				ui.Text(c, "只列最近的 200 条。").FontSize(12).TextColor(t.TextMuted)
				break
			}
			if i > 0 {
				ui.Divider(c)
			}
			h.titleEntryRow(c.Key(e.key()), e)
		}
	})
}

func (h *hub) confirmClearTitles(n int) {
	res, err := mygo.Dialog.Message(mygo.MessageOptions{
		Parent: h.win, Type: mygo.MessageWarning,
		Message: fmt.Sprintf("清除全部 %d 条判断记录？", n),
		Detail:  "手动公开、锁定的结论也一起清掉。之后见到的标题重新问 Jev。",
		Buttons: []string{"取消", "清除"}, CancelButton: 0, DestructiveButtons: []int{1},
	})
	if err == nil && res.Button == 1 {
		h.judge.clear()
	}
}

func (h *hub) titleEntryRow(c *ui.Context, e titleEntry) {
	t := c.Theme()
	color := map[verdict]ui.Color{verdictLocked: t.Danger, verdictNeedsConfirmation: t.Warning, verdictOmitted: t.TextMuted, verdictPublished: t.Success}[e.Verdict]
	ui.Column(c).Gap(4).Children(func() {
		ui.Text(c, e.Title).Wrap().Selectable()
		meta := e.ApplicationName + " · " + e.Verdict.displayName()
		if r := e.reason(); r != "" {
			meta += " · " + r
		}
		if e.Source == "user" {
			meta += " · 手动"
		}
		ui.Text(c, meta).FontSize(12).TextColor(color)
		if len(e.Probabilities) > 0 {
			var parts []string
			for _, d := range dimensions {
				parts = append(parts, d.displayName()+" "+formatProb(e.Probabilities[d]))
			}
			ui.Text(c, strings.Join(parts, "  ")).FontSize(11).Wrap().TextColor(t.TextMuted)
		}
		ui.Row(c).Gap(8).Children(func() {
			if e.Verdict != verdictPublished && ui.Button(c.Key("publish"), "公开").Clicked() {
				h.judge.decide(e.key(), verdictPublished)
			}
			if e.Verdict != verdictLocked && ui.Button(c.Key("lock"), "锁定").Clicked() {
				h.judge.decide(e.key(), verdictLocked)
			}
			if ui.Button(c.Key("rejudge"), "重判").Clicked() {
				h.judge.forget(e.key())
			}
		})
	})
}
