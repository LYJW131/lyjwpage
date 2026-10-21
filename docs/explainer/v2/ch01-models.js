// 第 01 章立体模型的搭建：岛、各站的小房子、会动的小件和体素 Clawd，按顶点色批量合并成几块网格。
// 世界坐标：X、Y 是地面，Z 朝上；three 里是 (X, Z, Y)。这一换轴是一次镜像：绕 three 的 y 轴转正角，在世界里是把 +X 转向 −Y。
(() => {
  const NS = (window.CH01 = window.CH01 || {});
  const T = window.THREE;
  if (!T) return;
  const { lerp } = K;
  const P = NS.P;

  const COLS = new Map();
  const col = (c) => { let v = COLS.get(c); if (!v) { v = new T.Color(c); COLS.set(c, v); } return v; };
  function paint(g, side, top = side, bottom = side) {
    const n = g.attributes.normal, a = new Float32Array(n.count * 3), cs = col(side), ct = col(top), cb = col(bottom);
    for (let i = 0; i < n.count; i++) {
      const y = n.getY(i), c = y > 0.5 ? ct : y < -0.5 ? cb : cs;
      a[3 * i] = c.r; a[3 * i + 1] = c.g; a[3 * i + 2] = c.b;
    }
    g.setAttribute("color", new T.BufferAttribute(a, 3));
    return g;
  }
  function prep(g) {
    const o = g.index ? g.toNonIndexed() : g;
    if (o.attributes.uv) o.deleteAttribute("uv");
    return o;
  }
  function gBox(X0, Y0, Z0, w, d, h, c, o = {}) {
    const r = o.r ?? Math.min(o.rMax ?? 5, 0.2 * Math.min(w, d, h));
    const g0 = r >= 0.6 ? new T.RoundedBoxGeometry(w, h, d, r > 3 ? 2 : 1, r) : new T.BoxGeometry(w, h, d);
    g0.translate(X0 + w / 2, Z0 + h / 2, Y0 + d / 2);
    return paint(prep(g0), c, o.top ?? c, o.bottom ?? c);
  }
  function gCyl(X, Y, Z, r, h, c, o = {}) {
    const b = Math.min(o.bevel ?? 3, r * 0.3, h * 0.3), pts = [new T.Vector2(0, 0)];
    for (let i = 0; i <= 3; i++) { const a = -Math.PI / 2 + (i / 3) * (Math.PI / 2); pts.push(new T.Vector2(r - b + b * Math.cos(a), b + b * Math.sin(a))); }
    for (let i = 0; i <= 3; i++) { const a = (i / 3) * (Math.PI / 2); pts.push(new T.Vector2(r - b + b * Math.cos(a), h - b + b * Math.sin(a))); }
    pts.push(new T.Vector2(0, h));
    const g0 = new T.LatheGeometry(pts, o.seg ?? 28);
    g0.translate(X, Z, Y);
    return paint(prep(g0), c, o.top ?? c, o.bottom ?? c);
  }
  function flat(g0) {
    const g = prep(g0);
    g.computeVertexNormals();
    return g;
  }
  function gPyr(X0, Y0, Z0, w, d, h, c) {
    const g0 = new T.ConeGeometry(Math.SQRT1_2, h, 4, 1);
    g0.rotateY(Math.PI / 4); g0.scale(w, 1, d); g0.translate(X0 + w / 2, Z0 + h / 2, Y0 + d / 2);
    return paint(flat(g0), c);
  }
  // 屋脊沿 X 的双坡顶
  function gGable(X0, Y0, Z0, w, d, h, c) {
    const s = new T.Shape([new T.Vector2(0, 0), new T.Vector2(d, 0), new T.Vector2(d / 2, h)]);
    const g0 = new T.ExtrudeGeometry(s, { depth: w, bevelEnabled: false });
    g0.rotateY(-Math.PI / 2); g0.translate(X0 + w, Z0, Y0);
    return paint(flat(g0), c);
  }
  function gBeam(a, b, hw, z0, z1, c, o) {
    const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy);
    const g = gBox(-L / 2, -hw, z0, L, 2 * hw, z1 - z0, c, o);
    g.rotateY(Math.atan2(-dy, dx));
    g.translate((a[0] + b[0]) / 2, 0, (a[1] + b[1]) / 2);
    return g;
  }
  // 面上的贴片：+Y 面（u 沿 +X）、+X 面（u 沿 +Y）、顶面（u 沿 +X、v 沿 +Y），v 都从 Z0 往上量
  const decY = (X0, Y, Z0, u0, v0, u1, v1, c, t = 0.8) => gBox(X0 + u0, Y, Z0 + v0, u1 - u0, t, v1 - v0, c, { r: 0 });
  const decX = (X, Y0, Z0, u0, v0, u1, v1, c, t = 0.8) => gBox(X, Y0 + u0, Z0 + v0, t, u1 - u0, v1 - v0, c, { r: 0 });
  const decT = (X0, Y0, Z, u0, v0, u1, v1, c, t = 0.8) => gBox(X0 + u0, Y0 + v0, Z, u1 - u0, v1 - v0, t, c, { r: 0 });
  function disc(r, c, seg = 32) { const g0 = new T.CircleGeometry(r, seg); return paint(prep(g0), c); }

  let scene;
  const M = {};
  const batch = { solid: [], gloss: [], unlit: [] };
  const feet = [];
  const add = (g, kind = "solid") => { batch[kind].push(g); return g; };
  const sBox = (X0, Y0, Z0, w, d, h, c, o = {}) => { if (Z0 <= 1 && !o.noFoot) feet.push([X0, Y0, w, d, Math.min(h, 160)]); return add(gBox(X0, Y0, Z0, w, d, h, c, o), o.kind); };
  const sCyl = (X, Y, Z, r, h, c, o = {}) => { if (Z <= 1) feet.push([X - r, Y - r, 2 * r, 2 * r, h]); return add(gCyl(X, Y, Z, r, h, c, o), o.kind); };
  function mesh(g, mat = M.solid, shadow = true) {
    const m = new T.Mesh(g, mat);
    m.castShadow = shadow; m.receiveShadow = true;
    scene.add(m);
    return m;
  }
  function merge(list) { return T.mergeGeometries(list, false); }
  function group(parts, mat = M.solid) { return mesh(merge(parts), mat); }

  const MAIN = { x0: 0, y0: 0, w: 1800, d: 1300, steps: [[90, 56, 150], [260, 150, 250], [470, 250, 330], [640, 330, 390]] };
  const TOKYO = { x0: 2080, y0: -470, w: 340, d: 320, z: 140, th: 40, steps: [[40, 40, 110], [110, 110, 170]] };
  const ELSE = { x0: -1420, y0: -260, w: 260, d: 280, z: 120, th: 36, steps: [[36, 36, 100], [96, 100, 150]] };
  const CLOUD = { x0: 840, y0: 60, w: 200, d: 170, z: 440, th: 26, steps: [[40, 26, 70]] };
  function island(I, topTex) {
    const { x0, y0, w, d, z = 0, th = 56, steps } = I;
    for (const [ins, h0, h1] of steps) add(gBox(x0 + ins, y0 + ins, z - h1, w - 2 * ins, d - 2 * ins, h1 - h0, P.rock, { rMax: 10 }));
    add(gBox(x0 + 4, y0 + 4, z - th, w - 8, d - 8, th - 10, P.sand, { rMax: 6 }));
    add(gBox(x0, y0, z - 13, w, d, 13, P.lip, { top: topTex ? P.lip : P.grass, rMax: 6 }));
  }
  function tree(X, Y, s = 1, leaf = P.mint, Z = 0) {
    if (Z <= 1) feet.push([X - 22 * s, Y - 22 * s, 44 * s, 44 * s, 80 * s]);
    add(gBox(X - 5 * s, Y - 5 * s, Z, 10 * s, 10 * s, 28 * s, P.wood));
    add(gBox(X - 21 * s, Y - 21 * s, Z + 26 * s, 42 * s, 42 * s, 36 * s, leaf, { rMax: 9 * s }));
    add(gBox(X - 13 * s, Y - 13 * s, Z + 60 * s, 26 * s, 26 * s, 20 * s, leaf, { rMax: 7 * s }));
  }
  const TREES = [[640, 160, 1.2], [760, 260, 0.9], [1740, 1250, 0.9], [80, 700, 1.1], [1000, 760, 0.9], [1720, 470, 0.8], [520, 640, 1.0]];
  const FAR = [[-2500, -1500, -420, 1.7], [3500, -1200, -260, 1.3], [-2300, 2300, -620, 1.5], [3900, 1700, -520, 1.1], [900, -2600, -120, 1.0], [-3300, 600, -300, 0.9]];

  const ROOM = { x0: 130, y0: 870, w: 340, d: 340, wall: 170 };
  const LAP = { x: 238, y: 905, z: 70 };
  const LID_TILT = 0.21;
  const PARK3 = [560, 990, 53];
  const RAIL = [[500, 1050], [1060, 490]], RAIL_Z = 46;
  function macRoom() {
    const R0 = ROOM;
    sBox(R0.x0, R0.y0, 0, R0.w, R0.d, 12, P.wood, { rMax: 3 });
    add(decT(R0.x0 + 150, R0.y0 + 170, 12, 0, 0, 150, 130, P.rose, 1.2));
    sBox(R0.x0, R0.y0, 12, R0.w, 14, R0.wall, P.cream, { noFoot: true });
    sBox(R0.x0, R0.y0, 12, 14, R0.d, R0.wall, P.cream, { noFoot: true });
    feet.push([R0.x0, R0.y0, R0.w, R0.d, 150]);
    add(decY(R0.x0, R0.y0 + 14, 12, 190, 72, 312, 150, P.sky, 1));
    add(decY(R0.x0, R0.y0 + 15, 12, 249, 72, 253, 150, P.cream, 1.4));
    add(decY(R0.x0, R0.y0 + 15, 12, 190, 109, 312, 113, P.cream, 1.4));
    add(decX(R0.x0 + 14, R0.y0, 12, 140, 84, 222, 148, P.pink, 1.2));
    add(decX(R0.x0 + 15, R0.y0, 12, 152, 96, 210, 136, NS.tone(P.pink, 0.18), 1.2));
    add(gBox(180, 885, 12, 12, 12, 50, P.sky));
    add(gBox(396, 885, 12, 12, 12, 50, P.sky));
    add(gBox(330, 885, 12, 74, 92, 50, P.sky));
    add(gBox(172, 880, 62, 248, 108, 8, P.sky));
    add(gBox(LAP.x, LAP.y, LAP.z, 108, 58, 5, P.steel, { kind: "gloss" }), "gloss");
    add(gCyl(392, 905, 70, 9, 4, P.butter));
    add(gBox(390, 903, 74, 4, 4, 46, P.butter));
    add(gBox(378, 900, 112, 22, 16, 10, P.butter));
    add(gBox(268, 1010, 12, 8, 8, 30, P.coral));
    add(gBox(250, 995, 42, 64, 54, 7, P.coral));
    add(gBox(250, 1045, 49, 64, 6, 52, P.coral));
    add(gCyl(170, 1170, 12, 15, 26, P.coral));
    add(gBox(160, 1160, 38, 20, 20, 22, P.mint));
    add(gBox(150, 1168, 46, 14, 14, 16, P.mint));
    add(gBox(174, 1150, 50, 12, 12, 20, P.mint));
  }
  // 笔记本的盖子往后仰 LID_TILT：开场镜头略往下看，盖子正对镜头时屏幕是一块方正的矩形（接第 00 章晒图上的小样）
  const LID = { hinge: [LAP.x, LAP.y - 2, LAP.z + 5], w: 108, h: 72, t: 5 };
  function lidPoint(u, v, out = 0) {
    const [X0, Y0, Z0] = LID.hinge, s = Math.sin(LID_TILT), c = Math.cos(LID_TILT);
    return [X0 + u, Y0 + (LID.t / 2 + out) * c - v * s, Z0 + v * c + (LID.t / 2 + out) * s];
  }
  const HUB3 = lidPoint(96, 63, 2);
  function lid() {
    const g = new T.Group();
    const parts = [gBox(0, -LID.t / 2, 0, LID.w, LID.t, LID.h, P.steel)];
    const scr = [decY(5, LID.t / 2, 5, 0, 0, 98, 62, P.screen, 0.4), decY(5, LID.t / 2 + 0.4, 59, 0, 0, 98, 8, P.screenL, 0.3),
      decY(52, LID.t / 2 + 0.4, 40, 0, 0, 40, 4, P.screenL, 0.3), decY(52, LID.t / 2 + 0.4, 30, 0, 0, 28, 4, P.screenL, 0.3)];
    const body = new T.Mesh(merge(parts), M.gloss); body.castShadow = body.receiveShadow = true;
    const screen = new T.Mesh(merge(scr), M.screen);
    const art = new T.Mesh(paint(prep(new T.BoxGeometry(30, 34, 0.3)), P.coral), M.screenLit);
    art.position.set(14 + 15, 16 + 17, LID.t / 2 + 0.75);
    const dot = new T.Mesh(disc(2.6, NS.SIGH), M.screenLit); dot.position.set(96, 63, LID.t / 2 + 0.8);
    g.add(body, screen, art, dot);
    g.position.set(LID.hinge[0], LID.hinge[2], LID.hinge[1]);
    g.rotation.x = -LID_TILT;
    scene.add(g);
    return { g, art, screen };
  }

  const BELT = { x0: 500, x1: 980, y: 1098, d: 46, z: 18.4 };
  const JEV = { x: 720, y: 1076, w: 150, d: 90, h: 128 };
  const EXITS = [[1010, 1030], [1010, 1118], [1010, 1206]];
  function gate() {
    sBox(BELT.x0, BELT.y, 0, BELT.x1 - BELT.x0, BELT.d, 18, P.lilac);
    sBox(638, 1084, 0, 22, 12, 100, P.butter);
    sBox(638, 1150, 0, 22, 12, 100, P.butter);
    add(gBox(634, 1080, 100, 30, 86, 14, P.butter));
    sBox(JEV.x, JEV.y, 0, JEV.w, JEV.d, JEV.h, P.rose);
    add(gBox(JEV.x + 20, JEV.y + 20, JEV.h, 40, 40, 10, NS.tone(P.rose, 0.1)));
    add(gCyl(JEV.x + 112, JEV.y + 44, JEV.h, 10, 22, P.butter));
    add(decY(JEV.x, JEV.y + JEV.d, 0, 14, 18, 136, 114, P.screen, 0.6), "unlit");
    NS.PROB.forEach((_, i) => { const v = 96 - i * 22; add(decY(JEV.x, JEV.y + JEV.d + 0.6, 0, 24, v - 6, 126, v + 6, P.screenL, 0.3), "unlit"); });
    sBox(EXITS[0][0] - 4, EXITS[0][1], 0, 70, 46, 18, P.cream);
    sBox(EXITS[1][0], EXITS[1][1], 0, 62, 50, 46, P.steel, { kind: "gloss" });
    add(decY(EXITS[1][0], EXITS[1][1] + 50, 0, 18, 8, 44, 30, P.ink2, 2));
    sBox(EXITS[2][0], EXITS[2][1], 0, 54, 46, 56, P.coral);
    add(gGable(EXITS[2][0] - 3, EXITS[2][1] - 3, 56, 60, 52, 16, P.coral));
    add(decY(EXITS[2][0], EXITS[2][1] + 46, 0, 12, 30, 42, 36, P.ink2, 1));
  }

  const VAULT = { x: 1170, y: 1010, w: 230, d: 200, h: 176 };
  const NAS = { x: 1500, y: 1060, w: 190, d: 160, h: 104 };
  const DRAWER = { u: 84, v: 70, w: 62, h: 42 };
  const DROP3 = [VAULT.x + DRAWER.u + DRAWER.w / 2, VAULT.y + VAULT.d + 30, DRAWER.v + DRAWER.h];
  function vault() {
    sBox(VAULT.x, VAULT.y, 0, VAULT.w, VAULT.d, VAULT.h, P.sky);
    add(gBox(VAULT.x - 8, VAULT.y - 8, VAULT.h, VAULT.w + 16, VAULT.d + 16, 12, NS.tone(P.sky, 0.08)));
    for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) {
      const u = 14 + c * 70, v = 20 + r * 50;
      if (c === 1 && r === 1) continue;
      add(gBox(VAULT.x + u, VAULT.y + VAULT.d, v, 62, 2, 42, NS.tone(P.sky, 0.1), { r: 1 }));
      add(decY(VAULT.x, VAULT.y + VAULT.d + 2, 0, u + 24, v + 18, u + 38, v + 24, NS.tone(P.sky, 0.34), 1.2));
    }
    add(decY(VAULT.x, VAULT.y + VAULT.d, 0, DRAWER.u - 1, DRAWER.v - 1, DRAWER.u + DRAWER.w + 1, DRAWER.v + DRAWER.h + 1, NS.tone(P.sky, 0.4), 0.3));
    sBox(NAS.x, NAS.y, 0, NAS.w, NAS.d, NAS.h, P.lilac);
    for (let i = 0; i < 4; i++) {
      add(gBox(NAS.x + 16 + i * 43, NAS.y + NAS.d, 18, 34, 2, 68, NS.tone(P.lilac, 0.12), { r: 1 }));
      add(decY(NAS.x, NAS.y + NAS.d + 2, 0, 22 + i * 43, 74, 30 + i * 43, 80, i === 1 ? NS.SIGH : P.mint, 0.8), "unlit");
    }
    add(gBox(NAS.x + 24, NAS.y + 44, NAS.h, 146, 54, 46, P.coral));
    for (let u = 10; u < 146; u += 12) add(decY(NAS.x + 24, NAS.y + 98, NAS.h, u, 6, u + 2.4, 40, NS.tone(P.coral, 0.2), 0.8));
  }

  const PHN = { x: 1650, y: 650, w: 26, d: 140, z: 26, h: 250 };
  function phoneModel() {
    sBox(PHN.x - 36, PHN.y - 20, 0, 100, PHN.d + 40, 26, P.cream);
    add(gBox(PHN.x, PHN.y, PHN.z, PHN.w, PHN.d, PHN.h, P.steel, { rMax: 9 }), "gloss");
    add(decX(PHN.x + PHN.w, PHN.y, PHN.z, 10, 12, PHN.d - 10, PHN.h - 12, P.screen, 0.5), "unlit");
    add(decX(PHN.x + PHN.w + 0.5, PHN.y, PHN.z, PHN.d / 2 - 22, PHN.h - 30, PHN.d / 2 + 22, PHN.h - 21, P.ink, 0.4), "unlit");
  }
  function phoneScreen() {
    const g = new T.Group(), parts = [];
    const S = (u, v) => [PHN.x + PHN.w + 0.8, PHN.y + u, PHN.z + v];
    const lines = [[22, 150], [46, 150], [56, 180], [70, 116], [84, 162], [118, 162]];
    for (let i = 1; i < lines.length; i++) {
      const [u0, v0] = lines[i - 1], [u1, v1] = lines[i], L = Math.hypot(u1 - u0, v1 - v0);
      const b = new T.BoxGeometry(0.4, 4, L + 3); b.rotateX(-Math.atan2(v1 - v0, u1 - u0));
      const [x, y, z] = S((u0 + u1) / 2, (v0 + v1) / 2); b.translate(x, z, y);
      parts.push(paint(prep(b), P.cream));
    }
    for (let i = 0; i < 3; i++) {
      const r = 34 - i * 11, d0 = new T.CircleGeometry(r, 40); d0.rotateY(Math.PI / 2);
      const [x, y, z] = S(PHN.d / 2, 72); d0.translate(x + 0.2 * i, z, y);
      parts.push(paint(prep(d0), i % 2 ? P.screen : NS.SIGH));
    }
    const m = new T.Mesh(merge(parts), M.screenLit);
    g.add(m); scene.add(g);
    return m;
  }

  const HOUSE = { x0: 1240, y0: 90, w: 360, d: 330, wall: 150 };
  const HA3 = [1268, 269, 120], CT3 = [1472, 200, 66], POD3 = [1330, 330, 62], ROOF_Z = 12 + HOUSE.wall;
  function house() {
    const H = HOUSE;
    sBox(H.x0, H.y0, 0, H.w, H.d, 12, P.wood, { rMax: 3 });
    sBox(H.x0, H.y0, 12, H.w, 14, H.wall, P.rose, { noFoot: true });
    sBox(H.x0, H.y0, 12, 14, H.d, H.wall, P.rose, { noFoot: true });
    feet.push([H.x0, H.y0, H.w, H.d, 150]);
    add(gBox(1290, 108, 12, 210, 46, 40, P.cream));
    add(gBox(1312, 112, 52, 150, 8, 82, P.screen, { r: 2 }), "gloss");
    add(gBox(1520, 112, 12, 30, 58, 100, P.cream));
    add(decY(1520, 170, 12, 12, 10, 16, 90, P.sky, 1));
    add(gBox(1440, 176, 12, 60, 50, 24, P.steel), "gloss");
    add(gBox(CT3[0] - 24, CT3[1] - 18, 36, 48, 36, 26, P.coral));
    for (let u = 6; u < 48; u += 8) add(decY(CT3[0] - 24, CT3[1] + 18, 36, u, 4, u + 1.8, 22, NS.tone(P.coral, 0.22), 0.6));
    add(gBox(1254, 230, 98, 30, 90, 6, P.wood));
    add(gBox(1256, 246, 104, 24, 46, 30, P.cream));
    const dot = disc(6, NS.SIGH, 18); dot.rotateY(Math.PI / 2); dot.translate(1280.6, 119, 269);
    add(dot, "unlit");
    add(gCyl(POD3[0], POD3[1], 12, 24, 50, P.cream, { top: P.steel, bevel: 6 }));
    add(gBox(1440, 300, 12, 110, 70, 30, P.lilac));
    add(gBox(1440, 366, 42, 110, 8, 40, P.lilac));
  }

  const CONTS = [P.coral, P.butter, P.sky];
  function tokyo() {
    const z = TOKYO.z;
    add(gBox(2110, -440, z, 280, 250, 12, P.cream));
    CONTS.forEach((c, i) => {
      const Z = z + 12 + i * 58;
      for (let u = 10; u < 210; u += 14) add(decY(2150, -324, Z, u, 6, u + 2.2, 50, NS.tone(c, 0.2), 0.6));
      add(decX(2360, -400, Z, 37, 8, 39.2, 48, NS.tone(c, 0.35), 0.6));
    });
    tree(2380, -170, 1.1, P.pink, z);
    tree(2125, -170, 0.8, P.pink, z);
  }
  function tokyoBoxes() {
    return CONTS.map((c, i) => {
      const m = new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0, emissive: col(NS.SIGH), emissiveIntensity: 0 });
      return mesh(gBox(2150, -400, TOKYO.z + 12 + i * 58, 210, 76, 56, c), m);
    });
  }

  const HUB = [1040, 388];
  function hubModel() {
    sCyl(HUB[0], HUB[1], 0, 46, 74, P.cream);
    add(gCyl(HUB[0], HUB[1], 84, 30, 30, P.coral));
    add(decY(HUB[0] - 18, HUB[1] + 44, 0, 0, 20, 36, 46, P.ink2, 2));
    for (let i = 0; i <= 4; i++) {
      const k = i / 4, px = lerp(RAIL[0][0], RAIL[1][0], k), py = lerp(RAIL[0][1], RAIL[1][1], k);
      sBox(px - 6, py - 6, 0, 12, 12, 38, P.lilac);
    }
    add(gBeam(RAIL[0], RAIL[1], 9, 38, RAIL_Z, P.lilac, { top: NS.tone(P.lilac, -0.05), rMax: 3 }));
  }
  function hubRing() {
    const m = new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0, emissive: col(NS.SIGH), emissiveIntensity: 0 });
    return mesh(gCyl(HUB[0], HUB[1], 74, 52, 10, P.coral), m);
  }
  function cloudModel() {
    const z = CLOUD.z;
    add(gBox(880, 90, z, 90, 70, 50, P.cream));
    add(decY(880, 160, z, 14, 14, 76, 38, P.screen, 0.6), "unlit");
    add(decY(880, 160.6, z, 22, 28, 44, 31, P.mint, 0.3), "unlit");
    add(gBox(1000, 110, z, 6, 6, 100, P.steel));
    add(gCyl(1003, 113, z + 98, 9, 12, NS.SIGH, { bevel: 4 }), "unlit");
  }

  const TOWER = { x: 230, y: 190, w: 140, d: 140, h: 330 };
  const CLOCK_C = [70, 270];
  function towerModel() {
    const Tw = TOWER;
    sBox(Tw.x - 34, Tw.y - 34, 0, Tw.w + 68, Tw.d + 68, 34, P.cream);
    add(gBox(Tw.x - 14, Tw.y - 14, 34, Tw.w + 28, Tw.d + 28, 16, NS.tone(P.cream, 0.06)));
    add(gBox(Tw.x, Tw.y, 50, Tw.w, Tw.d, Tw.h, P.butter, { rMax: 4 }));
    for (let r = 0; r < 2; r++) {
      add(decY(Tw.x, Tw.y + Tw.d, 50, 48, 60 + r * 80, 92, 112 + r * 80, NS.tone(P.butter, 0.2), 1));
      add(decX(Tw.x + Tw.w, Tw.y, 50, 48, 60 + r * 80, 92, 112 + r * 80, NS.tone(P.butter, 0.2), 1));
    }
    add(gPyr(Tw.x - 12, Tw.y - 12, 50 + Tw.h, Tw.w + 24, Tw.d + 24, 96, P.coral));
    const zt = 50 + Tw.h + 96, cx = Tw.x + Tw.w / 2, cy = Tw.y + Tw.d / 2;
    add(gBox(cx - 3, cy - 3, zt - 4, 6, 6, 62, P.ink2, { r: 1 }));
    add(gBox(cx - 2, cy - 2, zt + 40, 4, 4, 24, P.ink2, { r: 0 }));
  }
  function clockFace(face) {
    const Tw = TOWER, out = new T.Group(), parts = [disc(50, P.cream, 40)];
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2, b = new T.BoxGeometry(2.6, 6, 0.8);
      b.rotateZ(-a); b.translate(44.5 * Math.sin(a), 44.5 * Math.cos(a), 0.6);
      parts.push(paint(prep(b), P.ink2));
    }
    const faceM = new T.Mesh(merge(parts), M.solid); faceM.receiveShadow = true;
    const hand = (len, w, c) => {
      const b = new T.BoxGeometry(w, len, 1.2); b.translate(0, len / 2 - 4, 1.4);
      const h = new T.Mesh(paint(prep(b), c), c === NS.SIGH ? M.screenLit : M.solid); h.castShadow = true;
      return h;
    };
    const mm = hand(40, 4.2, NS.SIGH), hh = hand(26, 5, P.ink);
    out.add(faceM, mm, hh);
    if (face === "y") { out.position.set(Tw.x + CLOCK_C[0], 50 + CLOCK_C[1], Tw.y + Tw.d + 0.6); }
    else { out.position.set(Tw.x + Tw.w + 0.6, 50 + CLOCK_C[1], Tw.y + Tw.d - CLOCK_C[0]); out.rotation.y = Math.PI / 2; }
    scene.add(out);
    return { mm, hh, g: out };
  }
  function vane() {
    const s = new T.Shape([[-46, -4], [26, -4], [26, -14], [50, 0], [26, 14], [26, 4], [-46, 4], [-56, 14], [-56, -14]].map(([u, v]) => new T.Vector2(u, v)));
    const g0 = new T.ExtrudeGeometry(s, { depth: 3, bevelEnabled: false });
    g0.rotateX(-Math.PI / 2);
    const m = new T.Mesh(paint(flat(g0), NS.SIGH), M.screenLit); m.castShadow = true;
    m.position.set(TOWER.x + TOWER.w / 2, 50 + TOWER.h + 96 + 50, TOWER.y + TOWER.d / 2);
    scene.add(m);
    return m;
  }

  const PH7 = [ELSE.x0 + 120, ELSE.y0 + 110, ELSE.z];
  function elsePhone() {
    add(gBox(PH7[0] - 30, PH7[1] - 80, PH7[2], 90, 180, 22, P.cream));
    add(gBox(PH7[0], PH7[1] - 60, PH7[2] + 22, 26, 140, 250, P.steel, { rMax: 9 }), "gloss");
    add(decX(PH7[0] + 26, PH7[1] - 60, PH7[2] + 22, 10, 12, 130, 238, P.screen, 0.5), "unlit");
    tree(ELSE.x0 + 50, ELSE.y0 + 230, 0.8, P.rose, ELSE.z);
  }
  function elseScreen() {
    const X = PH7[0] + 26.8, Y0 = PH7[1] - 60, Z0 = PH7[2] + 22;
    const art = new T.Mesh(paint(prep(new T.BoxGeometry(0.4, 80, 80)), "#FFFFFF"), new T.MeshBasicMaterial({ vertexColors: true, color: col(P.rose) }));
    art.position.set(X, Z0 + 160, Y0 + 70); scene.add(art);
    const bar = new T.Mesh(paint(prep(new T.BoxGeometry(0.4, 8, 80)), P.screenL), M.screenLit);
    bar.position.set(X, Z0 + 74, Y0 + 70); scene.add(bar);
    const g = new T.BoxGeometry(0.5, 8, 1); g.translate(0, 0, 0.5);
    const fill = new T.Mesh(paint(prep(g), NS.SIGH), M.screenLit);
    fill.position.set(X + 0.2, Z0 + 74, Y0 + 30); scene.add(fill);
    return { art, fill };
  }

  function envGeo() {
    const parts = [gBox(-20, -14, 0, 40, 28, 7, NS.SIGH, { top: P.envTop, r: 1.6 })];
    parts.push(gBeam([-19, -13], [0, 2.2], 0.9, 7, 7.7, NS.SIGH, { r: 0 }), gBeam([0, 2.2], [19, -13], 0.9, 7, 7.7, NS.SIGH, { r: 0 }));
    return merge(parts);
  }
  const ENV_POOL = 20;
  function tileGeo() {
    const parts = [gBox(-22, -15, 0, 44, 30, 6, P.cream, { r: 1.5 })];
    for (const [v, u1] of [[7, 36], [15, 28], [23, 33]]) parts.push(gBox(-22 + 6, -15 + v - 1.6, 6, u1 - 6, 3.2, 0.8, P.ink2, { r: 0 }));
    return merge(parts);
  }
  const GLYPH = new Set(["2,3", "3,4", "4,5", "3,6", "2,7", "5,7", "6,7", "7,7"]);
  function iconCells() {
    const out = [];
    for (let i = 0; i < 10; i++) for (let j = 0; j < 10; j++) {
      const edge = i === 0 || j === 0 || i === 9 || j === 9;
      if (edge && (i === 0 || i === 9) && (j === 0 || j === 9)) continue;
      out.push({ i, j, c: GLYPH.has(`${i},${j}`) ? P.cream : edge ? P.screenL : P.screen });
    }
    return out;
  }

  const A = {};
  function build(sc) {
    scene = sc;
    M.solid = new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0 });
    M.gloss = new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.05 });
    M.screen = new T.MeshBasicMaterial({ vertexColors: true });
    M.screenLit = new T.MeshBasicMaterial({ vertexColors: true });
    M.unlit = M.screen;

    island(MAIN, true);
    island(TOKYO); island(ELSE); island(CLOUD);
    for (const [fx, fy, fz, s] of FAR) {
      const I = { x0: fx, y0: fy, w: 260 * s, d: 200 * s, z: fz, th: 22 * s, steps: [[24 * s, 22 * s, 70 * s], [60 * s, 70 * s, 140 * s]] };
      island(I); tree(fx + 80 * s, fy + 70 * s, 0.9 * s, P.mint, fz);
    }
    for (const [u, v, s] of TREES) tree(u, v, s);
    macRoom(); gate(); vault(); phoneModel(); house(); tokyo(); hubModel(); cloudModel(); towerModel(); elsePhone();

    const top = topTexture();
    const gplane = new T.PlaneGeometry(MAIN.w - 10, MAIN.d - 10); gplane.rotateX(-Math.PI / 2); gplane.translate(MAIN.w / 2, 0.15, MAIN.d / 2);
    const gm = new T.Mesh(gplane, new T.MeshStandardMaterial({ map: top, roughness: 0.9, metalness: 0 }));
    gm.receiveShadow = true; scene.add(gm);

    mesh(merge(batch.solid), M.solid);
    mesh(merge(batch.gloss), M.gloss);
    const un = mesh(merge(batch.unlit), M.screen); un.castShadow = false;

    A.lid = lid();
    A.envG = envGeo();
    A.env = Array.from({ length: ENV_POOL }, () => { const m = mesh(A.envG); m.visible = false; return m; });
    A.tile = mesh(tileGeo()); A.tile.visible = false;
    const cells = iconCells(), ib = new T.BoxGeometry(4.2, 4.2, 4.2);
    A.icon = new T.InstancedMesh(ib, M.solid, cells.length); A.icon.castShadow = true; A.icon.cells = cells;
    cells.forEach((c, i) => A.icon.setColorAt(i, col(c.c)));
    scene.add(A.icon);
    A.iconBase = mesh(gBox(-24, -24, 0, 48, 48, 5, P.cream, { r: 1.5 }));
    A.file = mesh(gBox(-14, -10, 0, 28, 20, 8, P.cream, { top: P.plate, r: 1.5 }));
    A.poster = mesh(merge([gBox(-12, -16, 0, 24, 32, 5, P.rose, { top: P.pink, r: 1.2 }), decT(-7, -10, 5, 0, 0, 14, 14, P.butter, 0.6)]));
    A.drawer = mesh(gBox(VAULT.x + DRAWER.u, VAULT.y + VAULT.d - 60, DRAWER.v, DRAWER.w, 60, DRAWER.h, NS.tone(P.sky, -0.04), { r: 1.5 }));
    A.drawerKnob = mesh(gBox(VAULT.x + DRAWER.u + 24, VAULT.y + VAULT.d, DRAWER.v + 18, 14, 2, 6, NS.tone(P.sky, 0.34), { r: 0 }));
    A.belt = new T.InstancedMesh(paint(prep(new T.BoxGeometry(2.4, 0.6, BELT.d - 12)), NS.tone(P.lilac, 0.22)), M.solid, 18);
    A.belt.receiveShadow = true; scene.add(A.belt);
    const shackle = merge([gBox(EXITS[1][0] + 21, EXITS[1][1] + 50, 30, 3.4, 3.4, 10, P.ink2, { r: 0 }), gBox(EXITS[1][0] + 39, EXITS[1][1] + 50, 30, 3.4, 3.4, 10, P.ink2, { r: 0 }),
      gBox(EXITS[1][0] + 21, EXITS[1][1] + 50, 38, 21.4, 3.4, 3.4, P.ink2, { r: 0 })]);
    A.shackle = mesh(shackle);
    A.flag = new T.Group();
    const fl = new T.Mesh(merge([gBox(-2, -2, 0, 4, 4, 38, NS.SIGH, { r: 0 }), gBox(-2, -14, 26, 4, 12, 12, NS.SIGH, { r: 0 })]), M.screenLit); fl.castShadow = true;
    A.flag.add(fl); A.flag.position.set(EXITS[2][0] + 56, 30, EXITS[2][1] + 16); scene.add(A.flag);
    A.tray = mesh(A.envG); A.tray.position.set(EXITS[0][0] + 31, 18, EXITS[0][1] + 23);
    A.jevRun = Array.from({ length: 4 }, (_, i) => { const m = mesh(paint(prep(new T.BoxGeometry(32, 12, 0.4)), P.cream), M.screenLit, false); m.position.set(0, 96 - i * 22, JEV.y + JEV.d + 1.1); return m; });
    A.jevFill = Array.from({ length: 4 }, (_, i) => { const g = new T.BoxGeometry(1, 12, 0.4); g.translate(0.5, 0, 0); const m = mesh(paint(prep(g), NS.SIGH), M.screenLit, false); m.position.set(JEV.x + 24, 96 - i * 22, JEV.y + JEV.d + 1.3); return m; });
    A.phone = phoneScreen();
    A.phoneDark = new T.Mesh(paint(prep(new T.BoxGeometry(0.3, PHN.h - 24, PHN.d - 20)), P.screen), new T.MeshBasicMaterial({ vertexColors: true, transparent: true }));
    A.phoneDark.position.set(PHN.x + PHN.w + 1.2, PHN.z + PHN.h / 2, PHN.y + PHN.d / 2); scene.add(A.phoneDark);
    A.roof = mesh(gGable(HOUSE.x0 - 16, HOUSE.y0 - 16, ROOF_Z, HOUSE.w + 32, HOUSE.d + 32, 70, P.coral));
    A.boxes = tokyoBoxes();
    A.hubRing = hubRing();
    A.clocks = [clockFace("y"), clockFace("x")];
    if (NS.dial) A.dial = NS.dial.build(scene, { paint, prep, gCyl, merge, col, P, face: A.clocks[0].g }, M);
    A.vane = vane();
    A.else = elseScreen();
    A.clawd = clawdModel();
    return { A, M };
  }

  function topTexture() {
    const c = document.createElement("canvas"), k = 1.2;
    c.width = Math.round(MAIN.w * k); c.height = Math.round(MAIN.d * k);
    const x = c.getContext("2d");
    x.fillStyle = P.grass; x.fillRect(0, 0, c.width, c.height);
    x.scale(k, k);
    x.globalAlpha = 0.6; x.strokeStyle = P.grid; x.lineWidth = 2;
    x.beginPath();
    for (let u = 100; u < MAIN.w; u += 100) { x.moveTo(u, 0); x.lineTo(u, MAIN.d); }
    for (let v = 100; v < MAIN.d; v += 100) { x.moveTo(0, v); x.lineTo(MAIN.w, v); }
    x.stroke();
    x.globalAlpha = 0.6; x.strokeStyle = P.ink2; x.lineWidth = 2.4; x.lineCap = "round"; x.setLineDash([8, 7]);
    for (const [ex, ey] of EXITS) { x.beginPath(); x.moveTo(BELT.x1 + 4, BELT.y + BELT.d / 2); x.lineTo(ex - 6, ey + 22); x.stroke(); }
    x.setLineDash([]);
    // 贴地的假环境光遮蔽：每个落地物件的投影四周压一圈暗
    x.globalAlpha = 1;
    for (const [X0, Y0, w, d, h] of feet) {
      const g = Math.min(26, 8 + h * 0.12);
      x.filter = `blur(${(g * 0.45 * k).toFixed(1)}px)`;
      x.fillStyle = NS.rgba(P.shade, 0.3);
      x.fillRect(X0 - g * 0.35, Y0 - g * 0.35, w + g * 0.7, d + g * 0.7);
    }
    x.filter = "none";
    const t = new T.CanvasTexture(c);
    t.colorSpace = T.SRGBColorSpace; t.anisotropy = 8;
    return t;
  }

  function clawdModel() {
    const g = new T.Group(), n = 18 * 6 * 2, box = new T.BoxGeometry(1, 1, 1);
    const m = new T.InstancedMesh(box, new T.MeshStandardMaterial({ roughness: 0.55, metalness: 0 }), n);
    m.castShadow = true; m.receiveShadow = true; m.count = 0;
    g.add(m); g.visible = false; scene.add(g);
    return { g, m };
  }

  NS.models = { build, col, L: { MAIN, TOKYO, ELSE, CLOUD, ROOM, LAP, HUB3, PARK3, RAIL, RAIL_Z, LID_TILT, BELT, JEV, EXITS, VAULT, NAS, DRAWER, DROP3, PHN, HOUSE, HA3, CT3, POD3, ROOF_Z, HUB, TOWER, PH7, lidPoint, LID } };
})();
