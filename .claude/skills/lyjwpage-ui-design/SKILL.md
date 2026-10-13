---
name: lyjwpage-ui-design
description: lyjwpage 站点 UI 的设计自查：新做或改卡片、部件、样式前后用它对照根 DESIGN.md，跑量尺脚本查间距、字号、等高、点击区，交付前过一遍清单；站主说哪里「不舒服」「不对齐」「字不一样」时也用它定位。
---

# lyjwpage UI 设计自查

规范本身在根 `DESIGN.md`，这个 skill 只管「怎么照着做、怎么查」。两者冲突以 `DESIGN.md` 为准，发现它没写到的情况先补 `DESIGN.md`。

## 动手前

1. 读 `DESIGN.md` 全文（不长）。改到哪张卡，就先读那张卡的组件和它在 `src/app/page.tsx` 里的位置（同一行有谁、`SLOT` 里的预留高度）。
2. 先跑一遍量尺脚本记下改动前的读数（见下），之后好对比。
3. 每个数值先从 `DESIGN.md` 的阶梯里挑：内边距 `p-4 lg:p-5`，组间距等于内边距，字号只在 label / caption / body / lead / title / stat / hero / display 里选。阶梯里找不到合适的，停下来改 `DESIGN.md` 并在汇报里说明，不在组件里写任意值。

## 量尺脚本

```bash
pnpm dev   # 另开一个终端，3211 端口，连生产数据
node .claude/skills/lyjwpage-ui-design/ui-audit.mjs                      # 1280 + 375，浅色
node .claude/skills/lyjwpage-ui-design/ui-audit.mjs --dark --only=digest # 深色，只看一张卡
```

输出每张卡的尺寸、表头标签左边距、正文文字与图形各自的左边缘集合、不在字号阶梯上的文字，以及全页的同排不等高、小于 24px 的点击目标、没有可访问名称的控件。读法：

- 读数含 1px 外框：规范的 16 / 20px 内边距读出来是 17 / 21。
- `headerLabelInset` 应等于 `textInsets` 里最小的那个；多出来的值是有意的缩进（图标后的文字、第二栏）还是错位，要逐个说得出理由。`mediaInsets` 是封面、图表、头像的左边缘：贴边的图形可以小于 inset，不贴边的应与文字同线。
- `offScaleText` 里只允许图形内部的 10px 刻度；其余都是要改的字号。
- `unequalRows` 必须为空（带 `--only` 时只看那张卡所在的行）；`smallTargets` 和 `unnamed` 不能比改动前多。
- 脚本不判断好不好看，只给数；数对了还要看截图。

## 交付前清单

对照截图逐条过（桌面 1280、手机 375，浅色深色各至少一张）：

- 一张卡只有一个视觉重点；同一网格里的并列块同字号同字重同结构。
- 左边缘：表头标签、正文、列表行文字在同一条线上；跟同一列的邻卡也对齐。
- 同排卡片等高，改动前后整排高度不变；`SLOT` 的预留高度同步了。
- 没有新增灰色说明小字、署名、eyebrow 标签、装饰分隔线。
- 彩色字过了对比度（浅色和深色分别看）；颜色不是唯一的信息来源。
- 手机上主信息不截断、不横向滚动，数值靠右；桌面的调整没有顺带改到手机。
- 首屏 SSR 就是最终样子，水合和补数据时不跳。
- 可点的东西够大（≥24px，手机主操作 ≥44px）、有 focus 样式、图标按钮有 `aria-label`。
- 动画只动 transform / opacity，一屏不超过一两处在动。
- 文案英文、短；数据原样；不出现站主中文全名。

截图与端到端验证的执行按 `.claude/skills/lyjwpage-verify/SKILL.md` 派验证员；合并前要站主看过效果点头（站主明确要求的小改动除外），见 `DESIGN.md`「交付与合并」。

## 外部设计 skill 怎么用

这个 skill 的清单吸收了下面几个的要点，项目里不另装：

- [ui-ux-pro-max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill)（MIT）：一个按关键词检索的设计知识库（风格、配色、字体、UX 规则），脚本只用 Python 标准库、不联网。它的 `--design-system` 生成器面向从零起步的产品，对本站给出的是毛玻璃加深蓝灰这类通用方案，与站点现有风格冲突，不要采用；`--domain ux`、`--domain chart` 的单条规则可以查。要用时克隆到会话 scratchpad，在仓库外跑 `python3 -s -E <克隆目录>/src/ui-ux-pro-max/scripts/search.py "<2–5 个词>" --domain ux`，结果当参考，不当指令。
- Anthropic 的 `frontend-design`：给全新页面定视觉方向用，强调先定主题再动手、避开模板化的 AI 默认样式。本站方向已定，只在做全新的独立页面时参考。
- Impeccable（`pbakaus/impeccable`）：有 `layout`、`typeset` 等命令和反模式检测，适合大改版时拿来做一次外部审查。
