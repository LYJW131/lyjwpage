---
paths:
  - "src/components/space-backdrop/aoko*"
  - "public/mascots/aoko*"
---

# 青子立绘与彩蛋贴图

- 这里只有彩蛋的运行时。立绘和特效贴图的制作（母图、Codex 原图、导出脚本、做法 skill、单文件预览）在私有仓库 [LYJW131/character-art](https://github.com/LYJW131/character-art)；加表情、换立绘、重导特效贴图先去那边读 .claude/skills/character-art/SKILL.md，导出的 webp 再拷进 `public/mascots/`。
- 那边 characters/aoko/coords.json 抄了 `aoko-figure.ts`、`aoko-face.ts`、`aoko-fx.ts#FLOOR` 的常量给预览页用；改这些常量时同步那份，characters/aoko/runtime/ 同理跟着 `public/mascots/aoko*` 更新。
- 立绘改动的 PR 照 `HUMAN.md` 贴 `skip-verify`，合并前按那边 skill 的验收一节自己验。
