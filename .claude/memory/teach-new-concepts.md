---
name: teach-new-concepts
description: When lyjw meets an unfamiliar concept (e.g. formal verification), explain it so lyjw has to think: anchor, contrast, one check question, invite explain-back
metadata:
  type: feedback
---

lyjw 2026-10-20 02:03 SGT: 「今后遇到这种我不熟悉的新知识 你可以想办法让我多思考来理解」. Trigger was the formal-verification thread: lyjw restated "TLA+ 是一种语言，建模来分析代码" in their own words, Claude confirmed and corrected one gap (TLA+ checks the hand-written model, not the code). That explain-back exchange is the model to repeat.

**Why:** Anthropic's RCT ([How AI assistance impacts the formation of coding skills](https://www.anthropic.com/research/AI-assistance-coding-skills), 2026-01-29): AI users scored 17% lower on mastery; high scorers asked conceptual questions or asked for explanations, low scorers delegated. Retrieval practice and generative learning (self-explaining, teaching, mapping) are the best-supported study methods (Karpicke 2025 review; Fiorella & Mayer 2016, "Eight Ways to Promote Generative Learning").

**When:** lyjw asks 是什么 / 怎么理解 / 解释一下, or a reply introduces a concept lyjw has not used before. Not for task progress, PR status, or things lyjw already knows.

**How to apply (pick one or two per reply, not all):**
1. Anchor: explain through something in lyjwpage lyjw already knows (TLA+ via the BuildCoordinator audit; tests as the baseline).
2. Contrast: set it next to its neighbours (tests vs TLA+ vs Lean) so the difference does the explaining.
3. Concrete first: one real example (a counterexample trace) before the general rule.
4. One check question: put a question before the key point and the answer right below it, so lyjw can stop and guess. At most one per reply.
5. Invite explain-back: end with 「用一句话说说你的理解，我来对一下」. When lyjw restates, say what is right, then fix the one gap precisely. Do not re-explain everything.
6. Retrieval later: when the concept comes up again in later work, ask lyjw to recall it in a line before explaining again.

**Limits:** never withhold the answer or block work waiting for lyjw's reply; questions are optional and the task goes on. No quizzes on trivia. No scheduled review/quiz mechanism (morning-report questions etc.) unless lyjw OKs it. Keep the A style and short replies. Related: [[bare-link-means-summarize]].
