// Clawd：按 Claude Code 2.1.281 源码里的官方定义逐格还原。
// 官方用终端方块字符拼三行：
//   default    " ▐" "▛███▛█" ""   / "▝▜" "█████" "█▀" / "  ▝▝ ▝▝  "
//   look-left  " ▐" "▟███▟█" ""   / 同上
//   look-right " ▐" "█▟███▟" ""   / 同上
//   arms-up    "▗▟" "▛███▛█" "▄"  / " ▜" "█████" "█▘"
// 身体色 clawd_body = rgb(215,119,87)，中段背景 clawd_background = rgb(0,0,0)（露出来的就是眼睛）。
// 每个字符拆成 2×2 个象限，网格 18 列 × 6 行（最后一行给蹲下留位），象限按终端比例画成 1:2 的竖长像素。
(function () {
  const BODY = "#D77757", EYE = "#000000";
  const Q = { // 字符 → [左上, 右上, 左下, 右下]
    " ": [0, 0, 0, 0], "█": [1, 1, 1, 1], "▐": [0, 1, 0, 1], "▌": [1, 0, 1, 0], "▀": [1, 1, 0, 0], "▄": [0, 0, 1, 1],
    "▛": [1, 1, 1, 0], "▜": [1, 1, 0, 1], "▙": [1, 0, 1, 1], "▟": [0, 1, 1, 1],
    "▘": [1, 0, 0, 0], "▝": [0, 1, 0, 0], "▖": [0, 0, 1, 0], "▗": [0, 0, 0, 1],
  };
  const POSES = {
    default: { r1L: " ▐", r1E: "▛███▛█", r1R: "", r2L: "▝▜", r2R: "█▀" },
    "look-left": { r1L: " ▐", r1E: "▟███▟█", r1R: "", r2L: "▝▜", r2R: "█▀" },
    "look-right": { r1L: " ▐", r1E: "█▟███▟", r1R: "", r2L: "▝▜", r2R: "█▀" },
    "arms-up": { r1L: "▗▟", r1E: "▛███▛█", r1R: "▄", r2L: " ▜", r2R: "█▘" },
  };
  const LEGS = "  ▝▝ ▝▝  ";

  // 返回 { body: [[qx,qy]...], eyes: [[qx,qy]...] }，坐标以象限为单位；offset=1 时整只下移一行字符（2 个象限），腿被裁掉。
  function cells(pose = "default", offset = 0) {
    const p = POSES[pose] || POSES.default;
    const body = [], eyes = [];
    const rows = [
      [{ s: p.r1L }, { s: p.r1E, bg: true }, { s: p.r1R }],
      [{ s: p.r2L }, { s: "█████", bg: true }, { s: p.r2R }],
      [{ s: LEGS }],
    ];
    rows.forEach((segs, r) => {
      let col = 0;
      for (const seg of segs) {
        for (const ch of seg.s) {
          const q = Q[ch] || Q[" "];
          q.forEach((on, k) => {
            const qx = col * 2 + (k % 2), qy = (r + offset) * 2 + (k >> 1);
            if (r + offset > 2) return; // 高度 3 行，蹲下时最下一行被裁
            if (on) body.push([qx, qy]);
            else if (seg.bg) eyes.push([qx, qy]);
          });
          col++;
        }
      }
    });
    return { body, eyes };
  }

  // 官方入场动画用到的帧（每帧 60ms）：a(pose, offset, 帧数, x)，Y(x) 是带烟尘的蹲下两帧
  const FRAME_MS = 60;
  const a = (pose, offset, n, x = 0) => Array.from({ length: n }, () => ({ pose, offset, x }));
  const Y = (x = 0) => [{ pose: "default", offset: 1, x, poof: "dot" }, { pose: "default", offset: 1, x, poof: "wave" }];
  const JUMP = [...Y(), ...a("arms-up", 0, 3), ...a("default", 0, 1), ...Y(), ...a("arms-up", 0, 3), ...a("default", 0, 1)];
  const SEQ = {
    jump: JUMP,
    look: [...a("look-right", 0, 5), ...a("look-left", 0, 5), ...a("default", 0, 1)],
    idle: [...a("default", 0, 12), ...a("look-right", 0, 5), ...a("look-left", 0, 5)],
    celebrate: [...JUMP, ...a("default", 1, 3)],
    land: [...Y(), ...a("default", 0, 2)],
    // 吓一跳：原地蹲一下带烟尘，再站直（官方的蹲下帧组合）
    flinch: [...Y(), ...a("default", 1, 2), ...a("default", 0, 1)],
    spin: [...a("look-left", 0, 2), ...a("look-right", 0, 2), ...a("look-left", 0, 2), ...a("arms-up", 0, 3), ...a("default", 0, 1)],
    skip: [...a("default", 1, 1, -9), ...a("arms-up", 0, 2, -6), ...a("default", 0, 1, -6), ...a("default", 1, 1, -6),
      ...a("arms-up", 0, 2, -3), ...a("default", 0, 1, -3), ...a("default", 1, 1, -3), ...a("arms-up", 0, 2, 0), ...Y(0), ...a("default", 0, 1, 0)],
  };

  // 一只可复用的 Clawd：外层 div 里放 SVG 本体和两侧烟尘。qw/qh 是一个象限的像素宽高（终端里约 1:2）。
  function create(qw = 16, qh = 32) {
    const NS = "http://www.w3.org/2000/svg";
    const W = 18 * qw, H = 6 * qh;
    const el = document.createElement("div");
    el.style.cssText = `position:absolute;left:0;top:0;width:${W}px;height:${H}px`;
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("width", W); svg.setAttribute("height", H);
    svg.setAttribute("viewBox", "0 0 18 6");
    svg.setAttribute("preserveAspectRatio", "none");
    svg.setAttribute("shape-rendering", "crispEdges");
    svg.style.cssText = "position:absolute;left:0;top:0;overflow:visible";
    const eyes = document.createElementNS(NS, "path"); eyes.setAttribute("fill", EYE);
    const body = document.createElementNS(NS, "path"); body.setAttribute("fill", BODY);
    svg.append(eyes, body);
    el.appendChild(svg);
    // 官方把烟尘「·」「~」画在第 3 行字符的最左格和最右格，颜色取 inactive 灰
    const poofs = [0, 16].map((qx) => {
      const s = document.createElement("div");
      s.style.cssText = `position:absolute;left:${qx * qw}px;top:${4 * qh}px;width:${2 * qw}px;height:${2 * qh}px;` +
        `display:flex;align-items:center;justify-content:center;font:600 ${Math.round(qh * 1.1)}px Menlo,"SF Mono",monospace;color:#9A968E`;
      el.appendChild(s);
      return s;
    });
    let last = "";
    function update({ pose = "default", offset = 0, poof = null } = {}) {
      const sig = pose + offset + poof;
      if (sig === last) return;
      last = sig;
      const { body: b, eyes: e } = cells(pose, offset);
      const d = (list) => list.map(([x, y]) => `M${x} ${y}h1v1h-1z`).join("");
      body.setAttribute("d", d(b));
      eyes.setAttribute("d", d(e));
      const g = poof === "dot" ? "·" : poof === "wave" ? "~" : "";
      for (const s of poofs) s.textContent = g;
    }
    update();
    return { el, svg, update, W, H, qw, qh };
  }

  window.Clawd = { create, cells, SEQ, FRAME_MS, POSES, BODY };
})();
