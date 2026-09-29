// 第 03 章 · 一间屋子的账房（状态核心 StateCore + StateHub，FACTS §3）。16 小节。
// 画面分两层：
//   3D：一间小屋的剖面模型（光线步进，暗底、骨白轮廓、墙体切口打斜线），第 2 小节强拍上屋顶掀开、前墙落下；
//   纸：账本、「要做的事」清单、四个库的对照表，像第 02 章的检查单一样按拍一行一行写上去。
// 镜头一直连续移动，不硬切；3D 里的信封、标注按同一套相机投影到屏幕上画。
(() => {
  const { css, Pass, Layer } = G;
  const { E, prog, keys, clamp, lerp, text, FONT, line, dashed, envelope, stamp, clawd, bubble, fillRect, rect, polyline } = K;
  const tr = (k) => I18N.tr(k);
  let room, lab, emit;

  const FRAG = `
uniform vec3 uCamPos; uniform vec3 uCamTgt; uniform float uFov;
uniform float uRoof;    // 0 屋子关着；1 屋顶掀走、前墙落下（剖面）
uniform float uRing;    // 广播后经过的秒数（<0 没有广播）
uniform float uMast;    // 天线顶上的灯
uniform vec3 uRise;     // 另外三个库（LAG 墙、D1 架、抽屉柜）从地里升起的进度
uniform float uLamp;    // 桌灯

float sdBox(vec3 p, vec3 b){ vec3 q = abs(p) - b; return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0); }
float sdCylY(vec3 p, float h, float r){ vec2 d = abs(vec2(length(p.xz), p.y)) - vec2(r, h); return min(max(d.x, d.y), 0.0) + length(max(d, 0.0)); }
vec2 U(vec2 a, vec2 b){ return a.x < b.x ? a : b; }

// 材质：1 墙 3 桌 4 账本纸 5 屋顶 6 灯 7 地面 9 岗亭与天线 10 LAG 墙 11 D1 架 12 抽屉柜
vec2 map(vec3 p){
  float Hb = mix(2.8, 2.05, uRoof), Hf = mix(2.8, 0.32, uRoof);
  float back = sdBox(p - vec3(0.0, Hb * 0.5, -2.575), vec3(3.15, Hb * 0.5, 0.075));
  float front = sdBox(p - vec3(0.0, Hf * 0.5, 2.575), vec3(3.15, Hf * 0.5, 0.075));
  front = max(front, -sdBox(p - vec3(0.9, 1.55, 2.575), vec3(0.7, 0.42, 0.3)));
  float left = sdBox(p - vec3(-3.075, Hb * 0.5, 0.0), vec3(0.075, Hb * 0.5, 2.65));
  left = max(left, -sdBox(p - vec3(-3.075, 0.95, 0.0), vec3(0.3, 0.95, 0.44)));
  float right = sdBox(p - vec3(3.075, Hb * 0.5, 0.0), vec3(0.075, Hb * 0.5, 2.65));
  right = max(right, -sdBox(p - vec3(3.075, 1.05, 0.0), vec3(0.3, 0.05, 0.3)));
  vec2 r = vec2(min(min(back, front), min(left, right)), 1.0);
  if (uRoof < 0.999) r = U(r, vec2(sdBox(p - vec3(0.0, 2.88 + uRoof * 7.0, 0.0), vec3(3.35, 0.08, 2.85)), 5.0));
  r = U(r, vec2(p.y, 7.0));
  // 桌子、摊开的账本、桌灯
  float desk = sdBox(p - vec3(0.2, 0.74, -0.35), vec3(0.95, 0.03, 0.5));
  vec3 q = p - vec3(0.2, 0.36, -0.35); q.xz = abs(q.xz) - vec2(0.86, 0.42);
  desk = min(desk, sdBox(q, vec3(0.03, 0.37, 0.03)));
  desk = min(desk, sdCylY(p - vec3(0.95, 0.98, -0.72), 0.22, 0.015));
  r = U(r, vec2(desk, 3.0));
  vec3 lp = p - vec3(0.15, 0.785, -0.3);
  float pages = min(sdBox(lp - vec3(-0.22, 0.0, 0.0), vec3(0.21, 0.01, 0.29)), sdBox(lp - vec3(0.22, 0.0, 0.0), vec3(0.21, 0.01, 0.29)));
  r = U(r, vec2(pages - 0.004, 4.0));
  r = U(r, vec2(length(p - vec3(0.95, 1.22, -0.72)) - 0.07, 6.0));
  // 门外：StateCore 的岗亭、LivePushRoom 的天线
  r = U(r, vec2(sdBox(p - vec3(4.3, 0.6, 0.0), vec3(0.42, 0.6, 0.42)), 9.0));
  r = U(r, vec2(sdBox(p - vec3(4.3, 1.24, 0.0), vec3(0.55, 0.04, 0.55)), 9.0));
  r = U(r, vec2(sdCylY(p - vec3(5.6, 1.6, -1.3), 1.6, 0.045), 9.0));
  r = U(r, vec2(length(p - vec3(5.6, 3.26, -1.3)) - 0.12, 6.0));
  if (max(uRise.x, max(uRise.y, uRise.z)) <= 0.0) return r;
  // 可滞后：一墙格子
  vec3 wp = p - vec3(9.6, 1.5 - (1.0 - uRise.x) * 3.2, -3.2);
  float wall = sdBox(wp, vec3(2.0, 1.5, 0.25));
  vec3 hq = wp; hq.xy = mod(hq.xy + 0.25, 0.5) - 0.25;
  wall = max(wall, -sdBox(hq - vec3(0.0, 0.0, 0.14), vec3(0.19, 0.19, 0.25)));
  r = U(r, vec2(wall, 10.0));
  // 历史：沿 -z 望不到头的档案架
  vec3 dp = p - vec3(-7.4, -(1.0 - uRise.y) * 2.2, -1.5);
  dp.x = dp.x - clamp(floor(dp.x / 1.9 + 0.5), -2.0, 0.0) * 1.9;   // 三排书架
  float dz = mod(dp.z + 0.8, 1.6) - 0.8;
  float up = sdBox(vec3(abs(dp.x) - 0.5, dp.y - 1.0, dz - 0.75), vec3(0.03, 1.0, 0.03));
  float by = mod(dp.y + 0.25, 0.5) - 0.25;
  float boards = max(sdBox(vec3(dp.x, by, dz), vec3(0.52, 0.02, 0.8)), abs(dp.y - 1.0) - 1.0);
  float books = max(sdBox(vec3(dp.x, by - 0.12, mod(dz + 0.07, 0.14) - 0.07), vec3(0.38, 0.1, 0.055)), abs(dp.y - 1.0) - 0.95);
  r = U(r, vec2(max(max(min(min(up, boards), books), dp.z - 0.8), -dp.z - 14.0), 11.0));
  // 凭据：带锁的小抽屉柜
  r = U(r, vec2(sdBox(p - vec3(4.7, 0.5 - (1.0 - uRise.z) * 1.1, 3.3), vec3(0.4, 0.5, 0.32)), 12.0));
  return r;
}
vec3 normalAt(vec3 p, float e){
  vec2 k = vec2(1.0, -1.0);
  return normalize(k.xyy * map(p + k.xyy * e).x + k.yyx * map(p + k.yyx * e).x + k.yxy * map(p + k.yxy * e).x + k.xxx * map(p + k.xxx * e).x);
}
float shadow(vec3 ro, vec3 rd, float maxT){
  float res = 1.0, t = 0.04;
  for (int i = 0; i < 48; i++) {
    float h = map(ro + rd * t).x;
    res = min(res, 8.0 * h / t);
    t += clamp(h, 0.03, 0.5);
    if (res < 0.01 || t > maxT) break;
  }
  return sat(res);
}
float hatchLines(float u, float freq, float w){ float v = fract(u * freq); float fw = fwidth(u * freq); return 1.0 - smoothstep(w - fw, w + fw, abs(v - 0.5) * 2.0); }

void main(){
  vec2 sp = (screenPos() - LOG * 0.5) / (LOG.y * 0.5); sp.y = -sp.y;
  vec3 fw = normalize(uCamTgt - uCamPos);
  vec3 rt = normalize(cross(fw, vec3(0.0, 1.0, 0.0)));
  vec3 upv = cross(rt, fw);
  float fl = 1.0 / tan(uFov * 0.5);
  vec3 rd = normalize(fw * fl + rt * sp.x + upv * sp.y);
  vec3 ro = uCamPos;
  // 走光线，同时记下「擦过物体又离开」时的最近距离，用来画外轮廓
  float t = 0.0, hp = 1e9, hpp = 1e9, tp = 0.0, sil = 1e9; vec2 h = vec2(0.0); bool hit = false;
  for (int i = 0; i < 200; i++) {
    h = map(ro + rd * t);
    if (hp < hpp && h.x > hp && tp > 0.3) sil = min(sil, hp / tp);
    if (h.x < 0.0006 * t + 0.0003) { hit = true; break; }
    hpp = hp; hp = h.x; tp = t;
    t += h.x * 0.85;
    if (t > 120.0) break;
  }
  float pix = 1.0 / (LOG.y * 0.5 * fl);            // 一个逻辑像素对应的角度
  vec3 bg = C_INK * 0.5;
  vec3 col = bg;
  if (hit) {
    vec3 p = ro + rd * t;
    float m = h.y;
    vec3 n = normalAt(p, 0.001);
    vec3 nB = normalAt(p, 0.018);
    float crease = smoothstep(0.12, 0.4, length(n - nB));
    vec3 kd = normalize(vec3(-0.55, 0.85, 0.45));
    float dif = max(dot(n, kd), 0.0) * shadow(p + n * 0.01, kd, 25.0);
    float inside = step(abs(p.x), 3.0) * step(abs(p.z), 2.5);
    // 桌灯：暖光，只照屋里
    vec3 Lp = vec3(0.95, 1.2, -0.72); vec3 ld = Lp - p; float dl = length(ld); ld /= dl;
    float lamp = uLamp * inside * max(dot(n, ld), 0.0) / (1.0 + dl * dl * 1.6) * 1.4;
    float base = 0.05;
    if (m == 7.0) base = inside > 0.5 ? 0.045 : 0.02;
    else if (m == 3.0) base = 0.075;
    else if (m == 4.0) base = 0.55;
    else if (m == 9.0 || m == 12.0) base = 0.07;
    else if (m == 10.0 || m == 11.0) base = 0.06;
    col = C_BONE * base * (0.4 + 1.5 * dif) + C_SIGNALD * lamp * (0.15 + base);
    // 暗面打一层稀疏斜线
    vec3 an = abs(n);
    vec2 uv = an.y > max(an.x, an.z) ? p.xz : (an.x > an.z ? p.zy : p.xy);
    if (dif < 0.2 && m != 4.0) col += C_BONE * 0.05 * hatchLines(uv.x + uv.y, 9.0, 0.12) * (1.0 - dif * 5.0);
    // 墙体切口（剖面）：切开的墙顶填斜线
    if (m == 1.0 && n.y > 0.9 && p.y > 0.2 && uRoof > 0.5) col = C_BONE * 0.07 + C_BONE * 0.42 * hatchLines(p.x + p.z, 14.0, 0.28);
    // 屋里地板半米一格；屋外地面一米一格，越远越淡
    if (m == 7.0) {
      float g = inside > 0.5 ? 0.5 : 1.0;
      vec2 gg = abs(fract(p.xz / g + 0.5) - 0.5) * g;
      float gw = fwidth(p.x) + fwidth(p.z);
      col += C_BONE * (inside > 0.5 ? 0.09 : 0.06) * (1.0 - smoothstep(0.0, gw * 1.2 + 0.004, min(gg.x, gg.y))) * exp(-t * 0.03);
    }
    // 账本纸：横格线
    if (m == 4.0) { float rl = fract((p.z + 0.3) * 20.0); col = mix(col, C_PINK * 0.3, (1.0 - smoothstep(0.0, 0.12, abs(rl - 0.5))) * 0.35); }
    col = mix(col, C_BONE * 0.8, crease * 0.85);
    if (m == 6.0) col = C_EMBER * (p.x > 5.0 ? 2.5 * uMast : 2.2 * uLamp);
    // 广播：以天线脚下为圆心，地面上一圈圈橙色往外走
    if (m == 7.0 && uRing >= 0.0) {
      float rr = length(p.xz - vec2(5.6, -1.3));
      for (int k = 0; k < 3; k++) {
        float R = (uRing - float(k) * 0.22) * 6.5;
        if (R > 0.0) col += C_SIGNALD * 1.8 * exp(-abs(rr - R) * 10.0) * exp(-R * 0.1);
      }
    }
    col = mix(bg, col, exp(-max(t - 10.0, 0.0) * 0.035));
  }
  float outline = 1.0 - smoothstep(pix * 0.7, pix * 1.8, sil);
  col = mix(col, C_BONE * 0.85, outline * 0.9);
  // 关着门时，窗里透出来的光
  if (uRoof < 0.5) {
    vec3 c0 = vec3(0.9, 1.55, 2.66);
    if (abs(rd.z) > 1e-3) { float tq = (c0.z - ro.z) / rd.z; if (tq > 0.0) { vec2 d2 = max(abs((ro + rd * tq).xy - c0.xy) - vec2(0.7, 0.42), 0.0); col += C_SIGNALD * 0.18 * uLamp * exp(-length(d2) * 2.5) * (1.0 - uRoof * 2.0); } }
  }
  fragColor = vec4(col, 1.0);
}`;

  // ---------- 镜头：一直连续，不硬切。[小节, [位置 xyz, 目标 xyz, 视角°], 缓动] ----------
  const CAM = [
    [0, [-9.8, 2.4, 9.6, -1.8, 1.1, 0, 40]],
    [1.7, [-8.2, 2.6, 8.0, -1.5, 1.1, 0, 40], E.io],
    [2.55, [-4.3, 6.3, 7.9, 1.1, 0.6, -0.3, 44], E.io],
    [4.9, [-3.5, 5.5, 6.9, 1.1, 0.7, -0.3, 44], E.lin],
    [5.45, [0.4, 4.9, 7.8, 3.3, 1.0, -0.6, 48], E.io],
    [7.9, [1.0, 4.6, 7.2, 3.4, 1.0, -0.6, 48], E.lin],
    [8.45, [-0.6, 7.2, 10.4, 2.3, 0.9, -0.7, 50], E.io],
    [11.3, [-0.2, 6.8, 9.8, 2.3, 0.9, -0.7, 50], E.lin],
    [13.4, [1.6, 14.5, 18.5, 6.6, 0.4, -2.0, 52], E.io],
    [16, [1.2, 15.3, 19.4, 6.6, 0.4, -2.0, 52], E.lin],
  ];
  const DEG = Math.PI / 180;
  function camAt(b) { const k = keys(b, CAM); return { pos: k.slice(0, 3), tgt: k.slice(3, 6), fov: k[6] * DEG }; }
  // 与着色器同一套相机：世界点 → [屏幕 x, y, 深度, 焦距]
  function project(c, P) {
    const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const norm = (a) => { const l = Math.hypot(...a); return a.map((v) => v / l); };
    const fw = norm(sub(c.tgt, c.pos)), rt = norm(cross(fw, [0, 1, 0])), up = cross(rt, fw);
    const d = sub(P, c.pos), z = dot(d, fw);
    if (z < 0.05) return null;
    const fl = 1 / Math.tan(c.fov / 2);
    return [G.W / 2 + (dot(d, rt) / z) * fl * (G.H / 2), G.H / 2 - (dot(d, up) / z) * fl * (G.H / 2), z, fl];
  }
  const pxPerM = (s) => (s[3] * (G.H / 2)) / s[2];

  // ---------- 账本：每一封记一行 ----------
  const COMMITS = [
    ...[
      ["mac", "desktop"], ["homepod", "listening"], ["emby", "watching"], ["mac", "chargingDevices"],
      ["playstation", "playing"], ["mac", "vibeCoding"], ["agents", "cursor"], ["iphone", "pulse buckets"],
      ["mac", "desktop"], ["homepod", "listening"], ["mac", "chargingDevices"], ["emby", "watching"],
    ].map(([src, what], i) => ({ t: 2 + i * 0.25, src, what })),
    { t: 5.0, src: "mac", what: "desktop", hot: true },
    { t: 8.0, src: "mac", what: "desktop" },
    { t: 8.5, src: "playstation", what: "playing" },
    { t: 9.0, src: "mac", whatKey: "ch03.hbRow", heart: true, dim: true },
    { t: 10.5, src: "mac", whatKey: "ch03.flipRow", flip: true, hot: true },
  ];
  // 信封走的路：门外排队 → 进门 → 桌前 → 上桌落到账本上
  const PATH = [[-14, 0.1, 0], [-3.1, 0.1, 0], [-0.9, 0.1, -0.1], [-0.35, 0.86, -0.3], [0.1, 0.86, -0.3]];
  const segL = PATH.slice(1).map((p, i) => Math.hypot(p[0] - PATH[i][0], p[1] - PATH[i][1], p[2] - PATH[i][2]));
  const PL = segL.reduce((a, b) => a + b, 0);
  function pathAt(s) {
    s = clamp(s, 0, PL);
    for (let i = 0; i < segL.length; i++) {
      if (s <= segL[i]) { const k = s / segL[i]; return PATH[i].map((v, j) => lerp(v, PATH[i + 1][j], k)); }
      s -= segL[i];
    }
    return PATH[PATH.length - 1];
  }
  const GAP = 0.78;

  // 2D 画的信封不会被 3D 的墙挡住：这里用线段对墙体盒子求交，挡住的画淡（门洞、墙缝、窗洞算通透）
  function hiddenByWall(c, P, roof) {
    const Hb = lerp(2.8, 2.05, roof), Hf = lerp(2.8, 0.32, roof);
    const walls = [
      { lo: [-3.15, 0, -2.65], hi: [-3.0, Hb, 2.65], hole: (q) => Math.abs(q[2]) < 0.44 && q[1] < 1.9 },
      { lo: [3.0, 0, -2.65], hi: [3.15, Hb, 2.65] },
      { lo: [-3.15, 0, -2.65], hi: [3.15, Hb, -2.5] },
      { lo: [-3.15, 0, 2.5], hi: [3.15, Hf, 2.65], hole: (q) => Math.abs(q[0] - 0.9) < 0.7 && Math.abs(q[1] - 1.55) < 0.42 },
    ];
    const o = c.pos, d = P.map((v, i) => v - o[i]);
    for (const w of walls) {
      let t0 = 0, t1 = 1, ok = true;
      for (let i = 0; i < 3 && ok; i++) {
        if (Math.abs(d[i]) < 1e-9) { ok = o[i] >= w.lo[i] && o[i] <= w.hi[i]; continue; }
        let ta = (w.lo[i] - o[i]) / d[i], tb = (w.hi[i] - o[i]) / d[i];
        if (ta > tb) [ta, tb] = [tb, ta];
        t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
        ok = t0 <= t1;
      }
      if (!ok || t0 > 0.97) continue; // 没碰到，或者碰到的就是信封自己脚下那段墙（正在穿门）
      const q = o.map((v, i) => v + d[i] * t0);
      if (w.hole && w.hole(q)) continue;
      return true;
    }
    return false;
  }

  // 纸片：浅色卡片 + 细边 + 落影
  function paper(x, px, py, w, h, a = 1, rot = 0) {
    x.save(); x.globalAlpha = a; x.translate(px, py); x.rotate(rot);
    x.shadowColor = "rgba(0,0,0,0.45)"; x.shadowBlur = 30; x.shadowOffsetY = 10;
    x.fillStyle = css("paper"); x.fillRect(0, 0, w, h);
    x.shadowColor = "transparent";
    x.strokeStyle = css("pink"); x.lineWidth = 2; x.strokeRect(0.5, 0.5, w - 1, h - 1);
    x.restore();
  }
  function heart(x, cx, cy, s, color) {
    x.save(); x.fillStyle = color; x.beginPath();
    x.moveTo(cx, cy + s * 0.35);
    x.bezierCurveTo(cx - s, cy - s * 0.35, cx - s * 0.45, cy - s, cx, cy - s * 0.45);
    x.bezierCurveTo(cx + s * 0.45, cy - s, cx + s, cy - s * 0.35, cx, cy + s * 0.35);
    x.fill(); x.restore();
  }

  // 账本那张纸：最近几行，每拍写一行、打一个勾
  function ledgerDoc(x, b, a, px, py, w, rowsMax) {
    if (a <= 0) return;
    const done = COMMITS.filter((c) => b >= c.t);
    const lh = 50, head = 150;
    paper(x, px, py, w, head + rowsMax * lh + 24, a);
    text(x, tr("ch03.ledger"), px + 32, py + 58, { font: FONT.cjk(36, 600), alpha: a });
    text(x, tr("ch03.ledgerSub"), px + 32, py + 96, { font: FONT.mono(18), color: css("graphite"), alpha: a, maxW: w - 64 });
    line(x, px + 28, py + 116, px + w - 28, py + 116, 1.4, css("pink"), a);
    text(x, "#", px + 32, py + 142, { font: FONT.mono(18), color: css("graphite"), alpha: a });
    text(x, tr("ch03.col.src"), px + 90, py + 142, { font: FONT.cjk(20, 600), color: css("graphite"), alpha: a });
    text(x, tr("ch03.col.what"), px + 280, py + 142, { font: FONT.cjk(20, 600), color: css("graphite"), alpha: a });
    // 超过 rowsMax 行时整体往上滚，滚动在一拍内做完
    const n = done.length;
    const last = done[n - 1];
    const scrollK = last ? E.outExpo(clamp((b - last.t) / 0.12)) : 1;
    x.save(); x.beginPath(); x.rect(px, py + head, w, rowsMax * lh + 10); x.clip();
    for (let i = Math.max(0, n - rowsMax - 1); i < n; i++) {
      const c = done[i];
      const slot = i - Math.max(0, n - rowsMax) + (n > rowsMax ? 1 - scrollK : 0);
      const y = py + head + 38 + slot * lh;
      const k = clamp((b - c.t) / 0.1);
      const col = c.hot ? css("signal") : c.dim ? css("graphite") : css("pink");
      text(x, String(i + 1).padStart(2, "0"), px + 32, y, { font: FONT.mono(22), color: css("graphite"), alpha: a * k });
      text(x, c.src, px + 90, y, { font: FONT.mono(24, 500), color: col, alpha: a * k });
      const what = c.whatKey ? tr(c.whatKey) : c.what;
      text(x, what, px + 280, y, { font: c.whatKey ? FONT.cjk(24, 600) : FONT.mono(24, 500), color: col, alpha: a, reveal: k, perChar: true, maxW: w - 350 });
      if (c.heart) heart(x, px + 264, y - 8, 11, css("signal"));
      polyline(x, [[px + w - 62, y - 12], [px + w - 52, y - 2], [px + w - 34, y - 24]], clamp((b - c.t - 0.04) / 0.08), 4, css("signal"), a);
      line(x, px + 28, y + 16, px + w - 28, y + 16, 1, css("pink"), 0.18 * a);
    }
    x.restore();
  }

  // 「要做的事」清单
  function slipDoc(x, px, py, w, rows, a, o = {}) {
    if (a <= 0) return;
    paper(x, px, py, w, 110 + rows.length * 64 + (rows.some((r) => r.note) ? 18 : 0), a, o.rot || 0);
    x.save(); x.translate(px, py); x.rotate(o.rot || 0);
    text(x, tr("ch03.slip"), 30, 62, { font: FONT.cjk(38, 600), alpha: a });
    line(x, 26, 84, w - 26, 84, 1.4, css("pink"), a);
    rows.forEach((r, i) => {
      const y = 140 + i * 64;
      if (!r.empty) {
        rect(x, 30, y - 32, 36, 36, 2, css("pink"), a);
        polyline(x, [[36, y - 14], [45, y - 4], [62, y - 28]], r.tick ?? 0, 4, css("signal"), a);
      }
      text(x, r.s, r.empty ? 30 : 86, y, { font: FONT.cjk(30, 600), color: r.empty ? css("graphite") : css("pink"), alpha: a, maxW: w - 120 });
      if (r.note) text(x, r.note, 86, y + 28, { font: FONT.cjk(20, 600), color: css("graphite"), alpha: a });
    });
    x.restore();
  }

  // 3D 锚点 → 引线 → 带暗底的字；贴边时换到另一侧
  function label(x, c, P, str, dx, dy, o = {}) {
    const s = project(c, P);
    const a = o.a ?? 1;
    if (!s || a <= 0) return;
    const col = o.color || css("bone");
    const f = o.font || FONT.cjk(30, 600);
    const w = K.measure(x, str, f);
    let tx = s[0] + dx; const ty = s[1] + dy;
    let right = dx < 0;
    if (!right && tx + w + 30 > G.W) { right = true; tx = s[0] - Math.abs(dx); }
    else if (right && tx - w - 30 < 0) { right = false; tx = s[0] + Math.abs(dx); }
    x.save(); x.globalAlpha = a; x.fillStyle = col; x.beginPath(); x.arc(s[0], s[1], 5, 0, Math.PI * 2); x.fill(); x.restore();
    line(x, s[0], s[1], tx, ty, 1.4, col, 0.85 * a);
    const px = parseFloat(/([\d.]+)px/.exec(f)[1]);
    fillRect(x, right ? tx - w - 24 : tx, ty - px * 1.4, w + 24, px * 1.4, css("ink"), 0.85 * a);
    line(x, tx, ty, tx + (right ? -w - 24 : w + 24), ty, 1.6, col, a);
    text(x, str, right ? tx - 12 : tx + 12, ty - px * 0.4, { font: f, color: col, align: right ? "right" : "left", alpha: a });
  }

  function render(f) {
    const b = f.bar;
    const c = camAt(b);
    const roof = E.io(prog(b, 1.95, 2.4));
    const ringAt = b >= 11.0 ? 11.0 : b >= 6.5 && b < 9.5 ? 6.5 : null;
    const ring = ringAt != null ? (b - ringAt) * f.BAR : -1;
    G.setCam({ x: G.W / 2, y: G.H / 2, zoom: 1, rot: 0 });
    G.fill(room, {
      uCamPos: c.pos, uCamTgt: c.tgt, uFov: c.fov, uRoof: roof, uRing: ring,
      uMast: 0.5 + (ring >= 0 ? 1.5 * Math.exp(-ring * 1.5) : 0), uLamp: 1,
      uRise: [prog(b, 12.0, 12.35, E.outBack), prog(b, 12.25, 12.6, E.outBack), prog(b, 12.5, 12.85, E.outBack)],
    });

    const x = lab.begin();
    const e = emit.begin();
    const bone = css("bone");
    const out = (t0, t1) => 1 - prog(b, t0, t1);

    // ---- 信封队列：每拍往前挪一格，最前面那封上桌、写进账本 ----
    let moved = 0;
    for (const cm of COMMITS) moved += E.io(prog(b, cm.t - 0.2, cm.t));
    const arrive = (1 - E.out(prog(b, 0, 1.7))) * 9; // 开场时整队从远处走过来
    const head = Math.round(moved);
    for (let i = COMMITS.length - 1; i >= 0; i--) {
      const cm = COMMITS[i];
      if (b >= cm.t + 0.02) continue;
      const sPos = PL - GAP * (i - moved) - arrive;
      if (sPos < 0) continue;
      const P = pathAt(sPos);
      const s = project(c, P);
      if (!s) continue;
      const w = 0.44 * pxPerM(s);
      const front = i === head && b >= cm.t - 0.6;
      const col = front ? css("signalD") : bone;
      const ey = s[1] - w * 0.36;
      const ea = hiddenByWall(c, [P[0], P[1] + 0.12, P[2]], roof) ? 0.12 : 1;
      envelope(x, s[0], ey, w, col, { lw: Math.max(1.4, w * 0.05), fill: css("ink2"), alpha: ea });
      if (cm.heart) heart(x, s[0], ey + w * 0.1, w * 0.14, css("signalD"));
      if (front && ea > 0.5) K.spark(e, null, [s[0], ey - w * 0.05], null, { t: G.t, size: 0.7 });
      if ((P[0] > -3.2 || i <= head + 2) && w > 26) {
        text(x, cm.flip ? "presence" : cm.src, s[0], s[1] + w * 0.1 + 18, { font: FONT.mono(Math.max(16, Math.min(22, w * 0.28)), 500), color: front ? css("signalD") : css("ash"), align: "center", alpha: ea });
      }
    }

    // ---- 旁白（左下，压一层暗底）与标题 ----
    x.save(); x.translate(420, 1080); x.scale(1.7, 0.5);
    const gr = x.createRadialGradient(0, 0, 0, 0, 0, 760);
    gr.addColorStop(0, "rgba(10,9,8,0.9)"); gr.addColorStop(0.6, "rgba(10,9,8,0.7)"); gr.addColorStop(1, "rgba(10,9,8,0)");
    x.fillStyle = gr; x.fillRect(-760, -760, 1520, 1520); x.restore();
    const nar = (key, py, r, a = 1, size = 60) => text(x, tr(key), 110, py, { maxW: 1080, font: FONT.cjk(size, 600), color: bone, reveal: r, dim: 0.14, perChar: true, alpha: a });
    if (b < 2.2) {
      const k = prog(b, 0.1, 0.7, E.out) * out(1.9, 2.2);
      text(x, "03", 110, 190, { font: FONT.pixel(112), color: css("signalD"), alpha: k });
      text(x, tr("ch03.title"), 290, 170, { font: FONT.cjk(58, 600), color: bone, reveal: prog(b, 0.15, 0.8), alpha: out(1.9, 2.2) });
      text(x, "workers/api · StateCore → StateHub", 292, 216, { font: FONT.mono(22), color: css("ash"), reveal: prog(b, 0.3, 1.0), alpha: out(1.9, 2.2) });
      nar("ch03.n1", 1000, prog(b, 0.3, 1.3), out(1.9, 2.2), 56);
      label(x, c, [0, 2.95, 0], 'StateHub · idFromName("global")', 110, -90, { a: prog(b, 0.9, 1.1) * out(1.8, 2.0), font: FONT.mono(28, 500) });
      label(x, c, [-3.2, 1.9, 0], tr("ch03.door"), -40, -50, { a: prog(b, 1.1, 1.3) * out(1.8, 2.0), font: FONT.cjk(28, 600) });
    }
    if (b >= 2.2 && b < 5.2) { nar("ch03.n2a", 910, prog(b, 2.3, 2.9), out(4.95, 5.15)); nar("ch03.n2b", 990, prog(b, 2.9, 3.5), out(4.95, 5.15)); }
    if (b >= 5.0 && b < 8.3) {
      if (b < 6.5) { nar("ch03.n3a", 910, prog(b, 5.05, 5.5), out(6.3, 6.5)); nar("ch03.n3b", 990, prog(b, 5.5, 6.1), out(6.3, 6.5)); }
      else { nar("ch03.n4a", 910, prog(b, 6.5, 6.9), out(8.1, 8.3)); nar("ch03.n4b", 990, prog(b, 6.9, 7.4), out(8.1, 8.3)); }
    }
    if (b >= 8.5 && b < 10.45) { nar("ch03.n5a", 910, prog(b, 8.8, 9.4), out(10.25, 10.45)); nar("ch03.n5b", 990, prog(b, 9.4, 10.0), out(10.25, 10.45)); }
    if (b >= 10.45 && b < 12.1) { nar("ch03.n6a", 910, prog(b, 10.5, 10.9), out(11.9, 12.1)); nar("ch03.n6b", 990, prog(b, 10.9, 11.5), out(11.9, 12.1)); }
    if (b >= 12.2) { nar("ch03.n7a", 910, prog(b, 12.3, 13.1)); nar("ch03.n7b", 990, prog(b, 13.1, 13.9)); }

    // ---- 账本（第 2–5 小节、第 8–11 小节） ----
    const la = prog(b, 2.1, 2.35, E.out) * out(5.0, 5.2) + prog(b, 8.3, 8.5, E.out) * out(11.4, 11.6);
    const early = b < 6;
    const lx = early ? 1210 + (1 - E.out(clamp(la))) * 80 : 80 - (1 - E.out(clamp(la))) * 80;
    const lw = early ? 620 : 600;
    ledgerDoc(x, b, la, lx, early ? 90 : 60, early ? lw : 640, early ? 8 : 5);
    if (la > 0) {
      const s = project(c, [0.15, 0.8, -0.3]);
      if (s) dashed(x, s[0], s[1], early ? lx : lx + 640, early ? 250 : 220, 1.4, bone, [6, 6], 0.7 * la);
    }

    // ---- 「要做的事」：5:0 换歌那封落账后写出来，6:0 从墙缝递出去，6:2 门外照单办 ----
    const slipRows = (t1, t2) => [
      { s: tr("ch03.slip.push"), tick: t1 },
      { s: tr("ch03.slip.tags"), note: tr("ch03.slip.tagsNote"), tick: t2 },
    ];
    if (b >= 5.1 && b < 6.05) {
      const k = prog(b, 5.1, 5.3, E.outBack);
      const fly = prog(b, 5.75, 6.0, E.in);
      const s = project(c, [3.1, 1.05, 0]);
      const px = lerp(1180, s ? s[0] : 1400, fly), py = lerp(170, s ? s[1] - 40 : 500, fly);
      const sc = lerp(1, 0.18, fly);
      x.save(); x.translate(px, py); x.scale(sc, sc); x.translate(-px, -py);
      slipDoc(x, px, py, 560, slipRows(0, 0), k * (1 - prog(fly, 0.8, 1)), { rot: -0.02 });
      x.restore();
    }
    if (b >= 6.0 && b < 8.3) {
      const a = prog(b, 6.0, 6.15) * out(8.0, 8.3);
      const sb = project(c, [4.3, 1.3, 0]);
      slipDoc(x, 1290, 700, 540, slipRows(prog(b, 6.5, 6.6), prog(b, 7.0, 7.1)), a);
      if (sb) dashed(x, sb[0], sb[1] - 20, 1290, 760, 1.4, bone, [6, 6], 0.7 * a);
      label(x, c, [4.3, 1.3, 0.3], tr("ch03.core"), -60, 120, { a: prog(b, 6.05, 6.25) * out(8.0, 8.3) });
      if (b >= 6.5 && sb) {
        label(x, c, [5.6, 3.3, -1.3], tr("ch03.push"), 70, -40, { a: prog(b, 6.5, 6.62) * out(8.0, 8.3), color: css("signalD") });
        const sm = project(c, [5.6, 3.3, -1.3]);
        if (sm) text(x, tr("ch03.pushTo"), sm[0] + 82, sm[1] + 12, { font: FONT.cjk(28, 600), color: css("signalD"), alpha: prog(b, 6.6, 6.8) * out(8.0, 8.3), maxW: G.W - sm[0] - 100 });
        // 回执：从岗亭飞回入口（画面左边）；202 由入口等齐三盏灯再盖
        const k = prog(b, 6.5, 7.4, E.io);
        const sx = lerp(sb[0] - 200, 330, k), sy = lerp(sb[1] - 120, 250, k);
        const ra = prog(b, 6.5, 6.56) * out(8.0, 8.3);
        paper(x, sx - 110, sy - 40, 220, 76, ra, -0.04);
        text(x, "ok · data", sx, sy + 10, { font: FONT.mono(26, 600), align: "center", alpha: ra });
        text(x, tr("ch03.back"), sx, sy + 78, { font: FONT.cjk(30, 600), color: css("signalD"), align: "center", alpha: prog(b, 6.6, 6.8) * out(8.0, 8.3) });
        text(x, tr("ch03.backNote"), sx, sy + 118, { font: FONT.cjk(26, 600), color: css("ash"), align: "center", alpha: prog(b, 7.0, 7.2) * out(8.0, 8.3), maxW: 620 });
        // 两件事同一拍出发
        const pa = prog(b, 6.52, 6.7) * out(7.6, 7.9);
        if (pa > 0) text(x, "‖ " + tr("ch03.parallel") + " ‖", sb[0] - 60, sb[1] - 230, { font: FONT.cjk(40, 600), color: css("signalD"), align: "center", alpha: pa });
        // tags → Vercel（布局变了才寄）
        const kv = prog(b, 7.0, 7.9, E.io);
        if (kv > 0 && kv < 1) {
          const vx = lerp(sb[0] + 40, 2050, kv), vy = lerp(sb[1] - 60, 520, kv);
          const va = 1 - prog(kv, 0.55, 0.85);
          envelope(x, vx, vy, 80, bone, { lw: 2, fill: css("ink2"), alpha: va });
          text(x, tr("ch03.vercel"), vx + 56, vy + 8, { font: FONT.mono(24), color: css("ash"), alpha: va });
        }
      }
    }

    // ---- 心跳（第 9 小节）与在线翻转（第 10:2 → 11:0） ----
    if (b >= 9.05 && b < 10.45) {
      const a = prog(b, 9.1, 9.25, E.outBack) * out(10.3, 10.45);
      slipDoc(x, 1330, 690, 480, [{ s: tr("ch03.slip.empty"), empty: true }], a, { rot: 0.015 });
      text(x, tr("ch03.quiet"), 1350, 910, { font: FONT.cjk(28, 600), color: css("ash"), alpha: prog(b, 9.3, 9.5) * out(10.3, 10.45) });
      const cs = project(c, [1.05, 0.77, 0.1]);
      const cin = prog(b, 9.35, 9.6), cout = prog(b, 10.2, 10.4);
      if (cs && cin > 0 && cout < 1) {
        const q = clamp(pxPerM(cs) * 0.035, 4, 9);
        const hop = Math.sin(cin * Math.PI) * 50 * (1 - cin) + Math.sin(cout * Math.PI) * 50;
        clawd(x, cs[0], cs[1] - hop, q, { pose: cin < 1 || cout > 0 ? "arms-up" : "default" });
        bubble(x, tr("ch03.clawd"), cs[0] + 40, cs[1] - q * 12 - 24, { px: 30, k: prog(b, 9.6, 9.75) * (1 - prog(b, 10.1, 10.2)), reveal: prog(b, 9.6, 10.0), tail: "left" });
      }
    }
    if (b >= 10.5 && b < 11.8) {
      const a = prog(b, 10.55, 10.7, E.outBack) * out(11.6, 11.8);
      slipDoc(x, 1330, 690, 480, [{ s: tr("ch03.slip.presence"), tick: prog(b, 11.0, 11.1) }, { s: tr("ch03.slip.3tags"), tick: prog(b, 11.05, 11.15) }], a, { rot: -0.015 });
      label(x, c, [5.6, 3.3, -1.3], tr("ch03.push"), 70, -40, { a: prog(b, 11.0, 11.15) * out(11.6, 11.8), color: css("signalD") });
    }

    // ---- 拉远：四个库 ----
    if (b >= 12.0) {
      const a = (t0) => prog(b, t0, t0 + 0.2);
      label(x, c, [-1.5, 2.1, -1.5], tr("ch03.lg.rt") + " · StateHub", 30, -210, { a: a(12.6) });
      label(x, c, [0.3, 0.2, 2.6], tr("ch03.pulse7"), 60, 90, { a: a(13.9), font: FONT.cjk(28, 600), color: css("ash") });
      label(x, c, [10.8, 1.2, -3.0], tr("ch03.lg.lag") + " · KV LAG", 60, 110, { a: a(13.0) });
      label(x, c, [-9.3, 2.1, -3.5], tr("ch03.lg.d1") + " · D1", -40, -90, { a: a(13.3) });
      label(x, c, [4.7, 1.0, 3.3], tr("ch03.lg.cred") + " · KV CREDENTIALS", 60, 60, { a: a(13.6) });
      label(x, c, [5.6, 3.3, -1.3], "LivePushRoom", 40, -110, { a: a(13.75), color: css("signalD"), font: FONT.mono(28, 500) });
      const la2 = prog(b, 14.0, 14.3, E.out);
      if (la2 > 0) {
        const px = 1290, py = 50, w = 560;
        const rows = [["rt", css("signal")], ["lag"], ["d1"], ["cred"]];
        paper(x, px, py, w, 104 + rows.length * 80, la2);
        text(x, tr("ch03.legend"), px + 30, py + 60, { font: FONT.cjk(36, 600), alpha: la2 });
        line(x, px + 26, py + 82, px + w - 26, py + 82, 1.4, css("pink"), la2);
        // 每行两层：上面是层名和推不推送，下面是落在哪
        rows.forEach(([k, col], i) => {
          const y = py + 132 + i * 80, rk = prog(b, 14.2 + i * 0.12, 14.35 + i * 0.12);
          text(x, tr(`ch03.lg.${k}`), px + 30, y, { font: FONT.cjk(28, 600), color: col || css("pink"), alpha: la2 * rk });
          text(x, tr(`ch03.lg.${k}N`), px + w - 30, y, { font: FONT.cjk(26, 600), color: css("graphite"), align: "right", alpha: la2 * rk });
          text(x, tr(`ch03.lg.${k}W`), px + 30, y + 32, { font: FONT.mono(22, 500), color: css("graphite"), alpha: la2 * rk, maxW: w - 60 });
        });
      }
    }

    G.composite(lab.upload(), { mode: G.MODE.normal });
    G.composite(emit.upload(), { mode: G.MODE.add, gain: 2 });
    const c0 = camAt(Math.max(0, b - 1 / 60 / f.BAR));
    const s0 = project(c0, [0.2, 0.8, -0.3]), s1 = project(c, [0.2, 0.8, -0.3]);
    f.post = {
      bloom: 0.8, threshold: 0.9, halation: 0.35, grain: 0.05, vignette: 0.45, ca: 0.6,
      fade: 1 - prog(b, 0, 0.3),
      flash: (b >= 2.0 && b < 2.1 ? 0.06 : 0) + (ringAt != null ? Math.exp(-ring * 6) * 0.05 : 0), flashCol: [1, 0.8, 0.6],
      blur: s0 && s1 ? [(s1[0] - s0[0]) * 0.5, (s1[1] - s0[1]) * 0.5] : [0, 0],
    };
  }

  window.CHAPTERS.push({
    id: "ch03", title: "ch.03", bars: 16,
    init() { room = new Pass(FRAG); lab = new Layer(); emit = new Layer(0.5); },
    render,
  });
})();
