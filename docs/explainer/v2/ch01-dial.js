// 第 01 章钟楼那一站的任务表盘：钟楼正面的钟面浮出、放大成表盘，一个采集任务一根指针，到它跑的那一分钟往前弹一格（一拍当一分钟），
// 弹的那根指针尖发光；中心亮点和钟摆每拍一下，和配乐的滴答同拍。调度表也在这里，ch01-collector.js 的时序卡读同一张。
(() => {
  const NS = window.CH01;
  if (!NS) return;
  const { E, prog, clamp, lerp, text, measure } = K;
  const TAU = Math.PI * 2;

  // 调度表须与 workers/collector/src/registry.ts#JOBS 一致。apple-recent 每分钟登记，任务里再按
  // apple-recent.ts#appleRecentDue 分闲 / 活跃两档；这里让它在 APPLE_CHANGED 那一分钟看到列表变了。
  const JOBS = [
    ["apple-recent", 1, 0], ["provider-status", 1, 0], ["pagespeed", 60, 7], ["github-chart", 10, 1], ["github-repo", 30, 2],
    ["site-deployments", 1, 0], ["site-analytics", 15, 3], ["cloudflare-deployments", 2, 0], ["cloudflare-metrics", 15, 4],
    ["uptime-probe", 1, 0], ["site-health", 5, 4], ["digest", 15, 5], ["avatar-watch", 5, 1],
  ];
  const MINUTES = 12;
  const APPLE_IDLE = 5, APPLE_HOLD = 10, APPLE_CHANGED = 5;
  const due = (j, m) => (JOBS[j][0] === "apple-recent"
    ? (m >= APPLE_CHANGED && m < APPLE_CHANGED + APPLE_HOLD) || m % APPLE_IDLE === 0
    : m % JOBS[j][1] === JOBS[j][2]);
  NS.cron = { JOBS, MINUTES, due };

  const beatOf = (b) => (b - NS.AT.dial) * 4;
  // 指针走过的格数：到期那一拍往前弹一格，弹的那一下按 E.spring 的闭式解带一点回弹
  function handSteps(j, b) {
    if (b < NS.AT.dial) return 0;
    const bt = Math.min(beatOf(b), MINUTES - 1e-6), m = Math.floor(bt + 1e-9);
    let n = 0;
    for (let i = 0; i < m; i++) if (due(j, i)) n++;
    if (due(j, m)) n += E.spring(clamp((bt - m) / 0.55));
    return n;
  }
  const minuteNow = (b) => (b < NS.AT.dial ? -1 : Math.min(MINUTES - 1, Math.floor(beatOf(b) + 1e-9)));
  // 到期那根指针尖的亮度、中心亮点：落拍后按秒衰减（impact 的半衰期是秒）
  const since = (b, m, hl) => { const at = NS.AT.dial + m / 4; return NS.impact(Math.max(b, at), at, hl); };
  const fired = (j, b) => { const m = minuteNow(b); return m >= 0 && due(j, m) ? since(b, m, 0.14) : 0; };
  const tickP = (b) => { const m = minuteNow(b); return m >= 0 ? since(b, m, 0.085) : 0; };

  // 浮出、收回的时刻：到位正好是第一拍（AT.dial），收回赶在甩镜头（STOP.CLOCK.t1）之前。
  // 刚浮出和快收回的 XF 小节里，深色表盘和钟楼上的白钟面交叉淡化，不在一帧里换
  const OUT = [20.75, 21.0], BACK = [23.45, 23.7], XF = 0.13;
  const dialK = (b) => E.io(prog(b, OUT[0], OUT[1])) * (1 - E.io(prog(b, BACK[0], BACK[1])));
  const dialO = (b) => E.io(prog(b, OUT[0], OUT[0] + XF)) * (1 - E.io(prog(b, BACK[1] - XF, BACK[1])));
  NS.dialK = dialK;

  const T = window.THREE;
  if (!T) return;
  const RD = 50;
  let _v, _m, _q0, _q1;

  // 两边都要单独调透明度，所以表盘和钟楼正面那块钟面用各自复制的材质，不动共用的 M。
  // 透明度管不到投影：影子另用一份按透明度抖动丢片元（alphaHash）的材质，跟着一起淡。
  // 表盘排在白钟面之后画（renderOrder），不然半透明的盘面可能先写深度，把白钟面的指针挡掉
  const fading = (m) => { const c = m.clone(); c.transparent = true; return c; };
  function build(scene, h, M) {
    const { paint, prep, gCyl, merge, col, P, face } = h;
    _v = new T.Vector3(); _m = new T.Matrix4(); _q0 = new T.Quaternion(); _q1 = new T.Quaternion();
    const solid = fading(M.solid), lit = fading(M.screenLit), shade = new T.MeshBasicMaterial({ alphaHash: true }), faceShade = shade.clone();
    const faceMats = [faceShade, ...face.children.map((o) => { o.customDepthMaterial = faceShade; return (o.material = fading(o.material)); })];
    const g = new T.Group();
    const disc = gCyl(0, 0, 0, RD, 6, NS.tone(P.coral, 0.12), { top: P.screen, bevel: 1.5, seg: 72 }); disc.rotateX(Math.PI / 2); disc.translate(0, 0, -6);
    const tube = [];
    for (let i = 0; i <= 12; i++) { const a = (i / 12) * TAU; tube.push(new T.Vector2(RD + 2.8 * Math.cos(a), 0.5 + 2.8 * Math.sin(a))); }
    const bez = new T.LatheGeometry(tube, 72); bez.rotateX(Math.PI / 2);
    const fm = new T.Mesh(merge([disc, paint(prep(bez), P.coral)]), solid); fm.castShadow = true; fm.receiveShadow = true; g.add(fm);
    const ticks = [];
    for (let i = 0; i < 60; i++) {
      const big = i % 5 === 0, len = big ? 6 : 3, a = (i / 60) * TAU, r = RD - 5 - len / 2, bx = new T.BoxGeometry(big ? 1.5 : 0.8, len, 0.6);
      bx.rotateZ(-a); bx.translate(r * Math.sin(a), r * Math.cos(a), 0.3);
      ticks.push(paint(prep(bx), big ? P.cream : NS.tone(P.cream, 0.45)));
    }
    g.add(new T.Mesh(merge(ticks), lit));
    const ball = (r) => { const pts = []; for (let i = 0; i <= 8; i++) { const a = -Math.PI / 2 + (i / 8) * Math.PI; pts.push(new T.Vector2(r * Math.cos(a), r * Math.sin(a))); } return new T.LatheGeometry(pts, 20); };
    const glowMat = () => new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0, emissive: col(NS.SIGH), emissiveIntensity: 0, transparent: true });
    const hands = JOBS.map((_, j) => {
      const L = RD * (0.4 + (0.46 * j) / (JOBS.length - 1)), z = 1.2 + j * 0.45, hg = new T.Group();
      const rg = new T.RoundedBoxGeometry(L + 2.5, 0.95, 0.7, 1, 0.3); rg.translate((L - 2.5) / 2, 0, z);
      const rod = new T.Mesh(paint(prep(rg), P.cream), solid); rod.castShadow = true;
      const tg = ball(1.9); tg.translate(L, 0, z);
      const tip = new T.Mesh(paint(prep(tg), P.cream), glowMat()); tip.castShadow = true;
      hg.add(rod, tip); g.add(hg);
      return { g: hg, tip, L, z };
    });
    const cg = gCyl(0, 0, 0, 3.2, 1.4, P.cream, { bevel: 0.5 }); cg.rotateX(Math.PI / 2); cg.translate(0, 0, 1.2 + JOBS.length * 0.45 + 0.2);
    const cap = new T.Mesh(cg, glowMat()); cap.castShadow = true; g.add(cap);
    const pend = new T.Group(); pend.position.set(0, -RD - 3.5, 1.2);
    const pr = new T.BoxGeometry(0.8, 15, 0.6); pr.translate(0, -7.5, 0);
    const bob = gCyl(0, 0, 0, 3.4, 1.6, P.coral, { bevel: 0.6 }); bob.rotateX(Math.PI / 2); bob.translate(0, -16, -0.8);
    const pm = new T.Mesh(merge([paint(prep(pr), P.ink2), bob]), solid); pm.castShadow = true; pend.add(pm); g.add(pend);
    g.traverse((o) => { if (o.isMesh) { o.customDepthMaterial = shade; o.renderOrder = 1; } });
    g.visible = false; scene.add(g);
    const D = NS.DIAL, w3 = (p) => new T.Vector3(p[0], p[2], p[1]);
    _m.makeBasis(w3(D.r), w3(D.u), w3(D.n));
    const mats = [solid, lit, shade, cap.material, ...hands.map((x) => x.tip.material)];
    return { g, hands, cap, pend, mats, faceMats, to: w3(D.c), toQ: new T.Quaternion().setFromRotationMatrix(_m), toS: D.R / RD };
  }

  function pose(b, D, A) {
    const k = dialK(b), o = dialO(b), face = A.clocks[0].g;
    D.g.visible = o > 0.001; face.visible = o < 0.999;
    for (const m of D.faceMats) m.opacity = 1 - o;
    NS.dialNow = null;
    if (!D.g.visible) return;
    for (const m of D.mats) m.opacity = o;
    // 起点比白钟面往外 3：交叉淡化时两块盘面不共面，不打架
    _v.copy(face.position); _v.z += 3;
    D.g.position.lerpVectors(_v, D.to, k); D.g.position.y += Math.sin(k * Math.PI) * 40;
    D.g.quaternion.slerpQuaternions(_q0.identity(), D.toQ, k);
    D.g.scale.setScalar(lerp(1, D.toS, k));
    const n = JOBS.length;
    D.hands.forEach((h, j) => {
      h.g.rotation.z = -(-Math.PI / 2 + (j / n) * TAU + handSteps(j, b) * (TAU / 12));
      h.tip.material.emissiveIntensity = 1.5 * fired(j, b);
    });
    const tk = tickP(b);
    D.cap.material.emissiveIntensity = 1.3 * tk;
    D.pend.rotation.z = 0.26 * Math.cos(Math.PI * beatOf(b)) * k;
    D.g.updateMatrixWorld(true);
    const sp = (obj, x, y, z) => { _v.set(x, y, z).applyMatrix4(obj.matrixWorld); return NS.W.proj(_v.x, _v.z, _v.y); };
    const c = sp(D.g, 0, 0, 6), rim = sp(D.g, RD, 0, 0);
    NS.dialNow = { k, c, R: Math.hypot(rim[0] - c[0], rim[1] - c[1]), tick: tk, tips: D.hands.map((h, j) => { const p = sp(h.g, h.L, 0, h.z); return [p[0], p[1], fired(j, b)]; }) };
  }

  // 2D 层：指针尖和中心的光晕、钟摆旁的「cron :MM」读数；表盘在场就跟着它走，缩回时随它一起淡掉
  function labels(x, e, b) {
    const d = NS.dialNow, st = NS.STOP.CLOCK;
    if (!d) return;
    const a = NS.live(st, b) * E.io(prog(d.k, 0.3, 0.9));
    if (a <= 0) return;
    const [cx, cy] = d.c;
    if (d.tick > 0.05) NS.glow(e, cx, cy, 0.4 * d.R, 0.55 * d.tick * a);
    for (const [tx, ty, f] of d.tips) if (f > 0.05) NS.glow(e, tx, ty, 0.21 * d.R, 0.7 * f * a);
    const m = minuteNow(b);
    if (m < 0) return;
    const f1 = NS.MONO(28), f2 = NS.MONO(40, 600), w1 = measure(x, "cron", f1), w2 = measure(x, ":00", f2);
    const rx = cx + 0.3 * d.R, ry = cy + 1.31 * d.R;
    NS.plate(x, rx - 18, ry - 44, w1 + w2 + 50, 62, a);
    text(x, "cron", rx, ry, { font: f1, color: NS.P.ink2, alpha: a });
    text(x, `:${String(m).padStart(2, "0")}`, rx + w1 + 14, ry + 2, { font: f2, color: NS.SIG, alpha: a });
  }

  NS.dial = { build, pose, labels };
})();
