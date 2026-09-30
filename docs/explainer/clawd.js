(function () {
  const BODY = "#D77757", EYE = "#000000";
  const Q = {
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
            if (r + offset > 2) return;
            if (on) body.push([qx, qy]);
            else if (seg.bg) eyes.push([qx, qy]);
          });
          col++;
        }
      }
    });
    return { body, eyes };
  }

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
    flinch: [...Y(), ...a("default", 1, 2), ...a("default", 0, 1)],
    spin: [...a("look-left", 0, 2), ...a("look-right", 0, 2), ...a("look-left", 0, 2), ...a("arms-up", 0, 3), ...a("default", 0, 1)],
    skip: [...a("default", 1, 1, -9), ...a("arms-up", 0, 2, -6), ...a("default", 0, 1, -6), ...a("default", 1, 1, -6),
      ...a("arms-up", 0, 2, -3), ...a("default", 0, 1, -3), ...a("default", 1, 1, -3), ...a("arms-up", 0, 2, 0), ...Y(0), ...a("default", 0, 1, 0)],
  };

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
