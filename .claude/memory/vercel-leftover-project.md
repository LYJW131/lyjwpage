---
name: vercel-leftover-project
description: Old Vercel project lyjwpage still exists (lyjw.me still listed on it); root vercel.json keeps its Git deploys off, so don't delete vercel.json while it exists
metadata:
  type: project
---

Checked 2026-10-23 05:4x SGT via Vercel MCP (thread「仓库架构是否清晰」): team `lyjw131s-projects` still has project `lyjwpage`, live=false, domains still list lyjw.me. Root `vercel.json` (`git.deploymentEnabled: false`) is what stops Vercel building main, so keep it until the project is deleted. Deleting the Vercel project is irreversible: lyjw's call; it was offered, no answer yet.
