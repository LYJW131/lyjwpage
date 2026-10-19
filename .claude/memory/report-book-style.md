---
name: report-book-style
description: Reports, posters and share pages for lyjw use the 书页 (book page) look, serif text with Tufte-style margin notes; lyjw picked it 2026-10-19, replacing the Swiss grid
metadata:
  type: feedback
---

lyjw 2026-10-19 17:37 SGT: 「之前那个artifacts风格我看腻了 再去找几种来给我选一下」. Four looks of the same report were offered ([报告风格四选一](<private claude.ai link>)): 书页, 纯文本 (mono man page), 留白 (Japanese minimal), 仪表 (Braun panels). lyjw picked 书页 on the card (23:03 SGT). Earlier rounds rejected: Swiss grid (used 2026-10-14 to 10-19, lyjw got tired of it), Vercel Geist, IBM Carbon, Material 3 Expressive.

**Why:** reports are for reading; a clean serif column with numbers moved to the margin keeps attention low.

**How to apply:** any report/poster/share page meant for lyjw (not site UI, which follows DESIGN.md per [[design-md-ui-approval]]) is an Artifact, never .md. Start from /mnt/project-files/report-style/book-template.html (copy, replace content, keep CSS): Source Serif 4 + Noto Serif SC, near-white #fbfbf9 / dark #18191b, one ink-blue accent (#2f4f7f / #8fb0e0), no panels, radii or shadows. Desktop ≥900px: text column 64%, per-item meta (number, date, source, length), key figures and the 「跟 lyjwpage」 note float into the right margin; put .figs and .rel right after .en in the markup so they sit beside the list top; on phones they fold under the list. Italic muted leads, hairline separators only. Writing stays A style (short controlled sentences). Times in SGT; call lyjw "lyjw". Screenshots: report-style/book-desktop-light.png, book-mobile-dark.png.
