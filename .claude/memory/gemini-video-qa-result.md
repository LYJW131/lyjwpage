---
name: gemini-video-qa-result
description: Gemini 3.8 Flash (gemini-api CLI) as explainer video checker (2026-10-23 SGT): 8-9/12 planted, but only 1-3/16 real issues on the 3D demo; not adopted, keep Haiku
metadata:
  type: project
---

lyjw added the Gemini egress injection (generativelanguage.googleapis.com, key injected; pass any GEMINI_API_KEY value) 2026-10-23 04:32 SGT and asked to trial explainer acceptance. Report: [Gemini 看讲解片验收](<private claude.ai link>); data/scripts `/mnt/project-files/gemini-video-qa/`.

Same 12 planted defects as [[jev-vision-qa-result]]. Whole 24 fps clips (processing.fps=24, resolution high) and 18-sheet batches both caught 8-9/12 over 4 runs (always miss D7 28 px border gap, F2 10 px one-frame jump, F3 6 px tear; D2 dot 1/4), 0 false alarms, frame-exact positions. Haiku 10/12. Video ≈264 tokens/frame, ~$0.065 per 144 frames (2026 price; doubles 2027-01-01).

Gotchas: free tier is 20 req/day per model family and 503 retries count (3.5/3.7 share 3.6/3.8 quota) — tell lyjw before burning quota; lyjw has since added billing. Release download is 403 from cloud; install with `go install github.com/google-gemini/gemini-api-cli/cmd/gemini-api@latest`. `analyze` can't set fps (default 1 fps); use `generate --body` with `processing.fps`. Frequent 503 high-demand on 3.8-flash.

Real test (lyjw asked, same day): 3D demo round-2 recording (48 s, `/mnt/project-files/gemini-video-qa/real/`), truth = 16 issues the lead forwarded from Haiku round 2. Gemini 4 runs (24/24/10/2 fps) caught 1-3 each, 4 combined; missed every big one (off-frame launch, overexposed shatter, UPDATE card, tiny/grainy text); misread 2 strings (tyjwpage, collectof). Non-streaming whole-video calls get 502 — use `--stream=true`; fps max 24. lyjw: Haiku runs 4 in parallel (~4 min wall) and is near-free on the Claude subscription, so speed and price aren't Gemini wins either.

Other uses tried 2026-10-23 05:3x SGT (samples in `/mnt/project-files/gemini-video-qa/uses/`): TTS (gemini-3.8-flash-tts) ch08 narration zh/en ~7 s each, round-trip transcript near-exact — most useful, would be a new explainer voice track (lyjw's call); Lyria 3.5 music ignored 30 s length (61 s), earshot (install: venv + pip git+https://github.com/Leonxlnx/earshot, lyjw OK'd 2026-10-23) heard ~102 BPM as asked but no kalimba (pizzicato/plucked guitar + glockenspiel, 'corporate background'), true peak +0.7 dBTP; Gemini's own audio description (piano, 80 BPM) was wrong — don't trust Gemini to listen — doesn't fit the bar-locked deterministic score; Nano Banana 2.1 image good but Clawd off-model (crab legs) — drafts only.

**How to apply:** keep Haiku as checker; don't re-propose Gemini for frame QA. See [[not-adopting]]. See [[verification-haiku-worker]].
