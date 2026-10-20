---
name: readme-diagrams
description: README architecture/workflow diagrams are SVGs from scripts/readme-diagrams.ts; Archify dropped; when to redraw
metadata:
  type: project
---

README diagrams: Archify dropped (lyjw 2026-10-19 23:23 SGT "去掉这个外部项目依赖"). Architecture and workflow are SVGs (lyjw chose SVG over PNG, transparent background, no grid) drawn by `scripts/readme-diagrams.ts` (`pnpm docs:diagrams`, zh/en × light/dark, site tokens); the old Pages URL only redirects to the README. Redraw when Workers, bindings, sources, routines or merge gates change.
