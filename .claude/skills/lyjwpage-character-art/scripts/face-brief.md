<!-- 给 codex exec 的改脸提示词。复制成 brief.md，换掉 {{名字}} 与 {{表情}}。第 1 张图那段描述的是青子的 face_open（喊叫脸），第 1 张图换了就照实改写：闭眼格把它换成这个表情的 Codex 原图（改名 face_base.png），并用文末「闭眼格」那段替换「Make」那段；别的角色照新底图写。害羞这类本来就脸红的表情，把 Rules 最后一条的 No blush 改成「A faint blush on the cheeks just under the eyes is fine」：害羞那格就是这样，lyjw 认可。 -->

Use your image generation tool (image editing, with the attached images as input). Do not write code to draw it.

Attached images, in order:
1. face_open.png (1024x1024) — close-up of an anime girl (the TARGET art). Currently she has an ANGRY, shouting expression: brows angled down toward the nose, wide open shouting mouth, eyes wide open, brown bangs falling over the eyes. A white-gloved hand is at the lower left.
2. expression_ref.png — the SAME character drawn by a different artist, used ONLY as a reference for the facial expression. Do not copy its art style, colours, shading, eye design, framing, head angle or hair; only read the expression from it.

Make `{{名字}}.png`, 1024x1024, saved in the current directory: image 1 with ONLY the facial expression changed to: {{表情}}.

Rules:
- Keep the art style of image 1 exactly: same crisp line art, same cel shading, same eye design (blue irises with highlights), same skin tone.
- Only the brows, eyes, eyelids and mouth may change. Everything else must stay pixel-identical: the bangs and hair strands crossing over the eyes and brows (keep them on top), face outline, chin, ears, nose, neck, gloved hand, background, colours, framing and scale, so it can be overlaid exactly on image 1. Do not turn or tilt the head.
- No blush, no sweat drops, no tears, no added effects or symbols.

Generate the image once and save it right away; do not regenerate or refine it.

When the file exists, reply with its path and one sentence on any issue.

<!-- 闭眼格：替换上面的 Make 段落 -->
Make `{{名字}}_shut.png` saved in the current directory, same size as image 1: image 1 with ONLY the eyes changed: BOTH EYES gently CLOSED as in a normal blink, each closed eye a softly curved, slightly DOWNWARD-curving upper lash line with a few short lashes, positioned where the middle of the open eye was (NOT upward ^ ^ happy arcs, NOT squeezed shut); brows and mouth exactly as in image 1.
