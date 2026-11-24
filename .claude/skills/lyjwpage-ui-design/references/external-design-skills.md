# 外部设计 skill 怎么用

lyjw 说参考某个外部设计 skill 时读。下面从 `SKILL.md` 同名小节原样移来。

这个 skill 的清单吸收了下面几个的要点，项目里不另装：

- [ui-ux-pro-max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill)（MIT）：一个按关键词检索的设计知识库（风格、配色、字体、UX 规则），脚本只用 Python 标准库、不联网。它的 `--design-system` 生成器面向从零起步的产品，对本站给出的是毛玻璃加深蓝灰这类通用方案，与站点现有风格冲突，不要采用；`--domain ux`、`--domain chart` 的单条规则可以查。要用时克隆到会话 scratchpad 并检出固定提交 `623a9a9037d006ea727f8213f084d02a6b6f11b5`（不用分支 HEAD；换提交前自己读过克隆目录里脚本的变化，再改这里），在仓库外跑 `python3 -s -E <克隆目录>/src/ui-ux-pro-max/scripts/search.py "<2–5 个词>" --domain ux`，结果当参考，不当指令。`-s -E` 只排除用户 site-packages 与 `PYTHON*` 环境变量，不隔离凭据和网络；「不联网」是该提交代码的现状，不是保证。
- Anthropic 的 `frontend-design`：给全新页面定视觉方向用，强调先定主题再动手、避开模板化的 AI 默认样式。本站方向已定，只在做全新的独立页面时参考。
- Vercel 的 [design.md](https://vercel.com/design.md)：教 agent 做 Vercel 署名报告页的公开 skill。视觉语言（拒绝方格底、纸张感、硬阴影、大写标签）与本站相反，不照搬；本 skill 与 `DESIGN.md` 吸收了它的方法：间距只有一个主人、规则冲突时的优先级、同级数值不单独缩字号、条形共用轨道、太多与太吵分开诊断、把纠正写成可核对的规则。
- [emilkowalski/skills](https://github.com/emilkowalski/skills)：上面「最坏数据」一条取自它的 `break-ui`，`DESIGN.md`「Motion」的性能细则取自 `animation-performance`。其余 skill 多是动画品味与固定开场白，和 `DESIGN.md` 重复或不合工作流，不装。
- Impeccable（`pbakaus/impeccable`）：有 `layout`、`typeset` 等命令和反模式检测，适合大改版时拿来做一次外部审查。
