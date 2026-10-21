// 第 01 章的渲染：three.js 借主画布的 WebGL2 上下文把 ch01-models.js 搭的模型渲进一张多重采样的离屏图，本章的合成着色器再叠上天空、远景雾和移轴景深，写进 G.scene。
// three 缓存 GL 状态，引擎的着色器不经过它：每次渲染前后都要 resetState()，否则两边互相踩状态。
(() => {
  const NS = window.CH01;
  const T = window.THREE;
  if (!T || !NS || !NS.models) return;
  const { clamp, lerp, E, prog, hash } = K;
  const P = NS.P, { col, L } = NS.models;
  const { BELT, JEV, NAS, DROP3, PHN, VAULT, DRAWER, EXITS } = L;
  let R = null, scene, cam, sun, rt = null, rtW = 0, comp = null, ready = false, A, M;
  const _m4 = new T.Matrix4(), _q = new T.Quaternion(), _v = new T.Vector3(), _s = new T.Vector3();
  const CLAWD_BODY = new T.Color();
  // fr：clawd.js 的一帧；q：一格的宽（世界单位），一格高 2q；pos：脚底中心；yaw：正面朝向（绕竖轴）；squash：落地挤压量
  function clawdPose(o) {
    const { g, m } = A.clawd;
    if (!o) { g.visible = false; return; }
    const { body, eyes } = window.Clawd.cells(o.fr.pose, o.fr.offset || 0);
    const q = o.q, D = 5 * q, x0 = (o.fr.x || 0) * 2;
    let k = 0;
    const put = (i, j, zc, dz, c) => {
      _v.set((i + x0 - 9 + 0.5) * q, (12 - 2 * j - 1) * q, zc); _s.set(q * 1.001, 2 * q * 1.001, dz);
      m.setMatrixAt(k, _m4.compose(_v, _q, _s)); m.setColorAt(k, c); k++;
    };
    const body3 = CLAWD_BODY.copy(col(NS.SIGH)).multiplyScalar(1.3), eye3 = col("#1E1424");
    for (const [i, j] of body) put(i, j, 0, D, body3);
    for (const [i, j] of eyes) { put(i, j, D / 2 - 0.45 * q, 0.9 * q, eye3); put(i, j, -0.45 * q, D - 0.9 * q, body3); }
    m.count = k; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true;
    const s = o.squash || 0;
    g.scale.set(1 + s * 0.5, 1 - s, 1 + s * 0.5);
    g.position.set(o.pos[0], o.pos[2], o.pos[1]);
    g.rotation.set(0, o.yaw, 0);
    g.visible = true;
  }

  const SUN_DIR = new T.Vector3(-0.62, 0.72, 0.34).normalize();
  function lights() {
    sun = new T.DirectionalLight(col("#FFF1E2"), 2.7);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0004;
    sun.shadow.radius = 2.5;
    scene.add(sun, sun.target);
    const rim = new T.DirectionalLight(col("#E9DDFF"), 0.75);
    rim.position.set(0.75, 0.45, -0.55).multiplyScalar(1000);
    scene.add(rim);
    scene.add(new T.HemisphereLight(col("#E4DCFA"), col("#F6D9C2"), 1.25));
    scene.add(new T.AmbientLight(col("#FFFFFF"), 0.08));
  }
  // 阴影相机跟着镜头的落点走、大小跟着机位：中心按阴影贴图的像素格取整，镜头慢推时影子边不爬
  const _r = new T.Vector3(), _u = new T.Vector3(), _c = new T.Vector3();
  function fitShadow(center, half) {
    const S = sun.shadow.camera, texel = (2 * half) / sun.shadow.mapSize.x;
    _r.crossVectors(new T.Vector3(0, 1, 0), SUN_DIR).normalize();
    _u.crossVectors(SUN_DIR, _r);
    const cr = Math.round(center.dot(_r) / texel) * texel, cu = Math.round(center.dot(_u) / texel) * texel, cl = center.dot(SUN_DIR);
    _c.copy(_r).multiplyScalar(cr).addScaledVector(_u, cu).addScaledVector(SUN_DIR, cl);
    sun.target.position.copy(_c);
    sun.position.copy(_c).addScaledVector(SUN_DIR, 4000);
    S.left = -half; S.right = half; S.top = half; S.bottom = -half; S.near = 1500; S.far = 7000;
    S.updateProjectionMatrix();
    sun.shadow.normalBias = texel * 1.1;
  }

  const COMP = `
uniform sampler2D uCol; uniform sampler2D uDep;
uniform vec2 uNF; uniform float uFocus; uniform float uAper; uniform float uMaxR; uniform vec2 uTx;
uniform vec3 uS0; uniform vec3 uS1; uniform vec3 uS2; uniform vec2 uHaze; uniform float uHazeK;
float linz(float d){ float z = d * 2.0 - 1.0; return 2.0 * uNF.x * uNF.y / (uNF.y + uNF.x - z * (uNF.y - uNF.x)); }
float cocAt(float d){ if (d >= 1.0) return uMaxR; float z = linz(d); return clamp(uAper * abs(z - uFocus) / z, 0.0, uMaxR); }
vec3 skyAt(float y){ return y < 0.58 ? mix(uS0, uS1, y / 0.58) : mix(uS1, uS2, (y - 0.58) / 0.42); }
void main(){
  vec2 uv = vUv;
  float d0 = texture(uDep, uv).r;
  float coc = cocAt(d0);
  vec4 c = texture(uCol, uv);
  if (coc > 0.6) {
    vec4 acc = c; float ws = 1.0;
    for (int i = 0; i < 12; i++) {
      float r = sqrt((float(i) + 0.5) / 12.0) * coc, th = float(i) * 2.39996;
      vec2 o = vec2(cos(th), sin(th)) * r * uTx;
      float w = clamp(cocAt(texture(uDep, uv + o).r) / max(r, 0.75), 0.0, 1.0);
      acc += texture(uCol, uv + o) * w; ws += w;
    }
    c = acc / ws;
  }
  vec3 s = skyAt(1.0 - uv.y);
  float h = d0 >= 1.0 ? 0.0 : smoothstep(uHaze.x, uHaze.y, linz(d0)) * uHazeK;
  vec3 rgb = c.rgb + s * (1.0 - c.a);
  rgb = mix(rgb, s * c.a + rgb * (1.0 - c.a), h);
  fragColor = vec4(rgb, 1.0);
}`;
  const SKY = [P.sky0, P.sky1, P.sky2].map((h) => { const c = col(h); return [c.r, c.g, c.b]; });

  function init() {
    if (ready) return;
    R = new T.WebGLRenderer({ canvas: G.canvas, context: G.gl, antialias: false });
    R.autoClear = true;
    R.setClearColor(0x000000, 0);
    R.shadowMap.enabled = true;
    R.shadowMap.type = T.PCFShadowMap;
    scene = new T.Scene();
    cam = new T.PerspectiveCamera(26, 16 / 9, 50, 20000);
    ({ A, M } = NS.models.build(scene));
    lights();
    comp = G.pass(COMP);
    R.resetState();
    ready = true;
  }
  function ensureRT() {
    const w = Math.min(G.PW, 2560), h = Math.round((w * G.PH) / G.PW);
    if (rt && rtW === w) return;
    if (rt) rt.dispose();
    rt = new T.WebGLRenderTarget(w, h, { type: T.HalfFloatType, samples: 4, depthBuffer: true });
    rt.depthTexture = new T.DepthTexture(w, h);
    rtW = w;
  }

  // v：{ at: [X, Y, Z] 画面中心对着的点, az 方位（度，0 = 从 +Y 看过去、45 = 标准等距方位）, el 仰角（度）, d 距离, zoom 焦距倍数, sh 阴影半宽 }
  const _t = new T.Vector3();
  function view(v) {
    const az = (v.az * Math.PI) / 180, el = (v.el * Math.PI) / 180;
    _t.set(v.at[0], v.at[2], v.at[1]);
    cam.fov = v.fov ?? 26;
    cam.position.set(_t.x + v.d * Math.cos(el) * Math.sin(az), _t.y + v.d * Math.sin(el), _t.z + v.d * Math.cos(el) * Math.cos(az));
    cam.up.set(0, 1, 0);
    cam.lookAt(_t);
    cam.near = Math.max(20, v.d * 0.12); cam.far = v.d * 5 + 6000;
    cam.zoom = v.zoom ?? 1;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);
    fitShadow(_t, v.sh ?? v.d * 0.62);
    NS.cur = v;
  }
  const _p = new T.Vector3();
  function proj(X, Y, Z = 0) {
    _p.set(X, Z, Y).project(cam);
    return [(_p.x + 1) * 960, (1 - _p.y) * 540, _p.z];
  }
  // 摄像机的右方向（世界 X、Y），标准方位下就是导轨的方向
  function right() { const az = (NS.cur.az * Math.PI) / 180; return [Math.cos(az), -Math.sin(az)]; }

  function draw(o = {}) {
    ensureRT();
    R.resetState();
    R.setRenderTarget(rt);
    R.render(scene, cam);
    R.setRenderTarget(null);
    R.resetState();
    const ct = R.properties.get(rt.texture).__webglTexture, dt = R.properties.get(rt.depthTexture).__webglTexture;
    const v = NS.cur, focus = o.focus ?? v.d;
    G.fill(comp, {
      uCol: { tex: ct }, uDep: { tex: dt }, uNF: [cam.near, cam.far], uFocus: focus, uAper: (o.aper ?? 26) * (rt.width / 1920), uMaxR: 7 * (rt.width / 1920),
      uTx: [1 / rt.width, 1 / rt.height], uS0: SKY[0], uS1: SKY[1], uS2: SKY[2], uHaze: [focus * 1.15, focus * 2.4], uHazeK: o.haze ?? 0.8,
    });
  }

  let envN = 0;
  function envAt(X, Y, Z, s = 1, yaw = 0) {
    if (envN >= A.env.length || s <= 0.01) return;
    const m = A.env[envN++];
    m.visible = true; m.position.set(X, Z, Y); m.scale.setScalar(s); m.rotation.set(0, yaw, 0);
  }
  function pose(b) {
    const AT = NS.AT;
    envN = 0;
    for (const m of A.env) m.visible = false;
    A.tile.visible = false; A.icon.visible = false; A.iconBase.visible = false; A.file.visible = false; A.poster.visible = false;

    const flash = NS.impact(b, AT.flip, 0.3), sq = prog(b, AT.flip - 0.05, AT.flip + 0.05);
    A.lid.art.scale.set(1, sq > 0 && sq < 1 ? Math.max(0.05, Math.abs(Math.cos(sq * Math.PI))) : 1, 1);
    M.screen.color.setScalar(1 + 0.5 * flash);

    const off = ((b * 4) % 1) * 30;
    let n = 0;
    for (let u = 10 + off; u < BELT.x1 - BELT.x0 - 6; u += 30) {
      A.belt.setMatrixAt(n++, _m4.makeTranslation(BELT.x0 + u, 18.4, BELT.y + BELT.d / 2));
    }
    A.belt.count = n; A.belt.instanceMatrix.needsUpdate = true;

    const run = prog(b, AT.jev, AT.jev + 0.05) * (1 - prog(b, AT.judged, AT.judged + 0.02)), done = prog(b, AT.judged, AT.judged + 0.08, E.out);
    NS.PROB.forEach((p, i) => {
      const ph = (b * 3.2 + i * 0.27) % 1, r = A.jevRun[i];
      r.visible = run > 0.02; r.position.x = JEV.x + 24 + ph * 70 + 16;
      const f = A.jevFill[i], w = 102 * p * done;
      f.visible = w > 0.2; f.scale.x = Math.max(0.01, w);
    });
    const drop = 1 - prog(b, AT.lock, AT.lock + 0.06, E.in);
    A.shackle.position.y = 10 * drop;
    const up = prog(b, AT.owner, AT.owner + 0.08, E.outBack);
    A.flag.rotation.set(0, 0, lerp(-Math.PI / 2, 0, up));
    const ck = prog(b, AT.cleared, AT.cleared + 0.08, E.outBack);
    A.tray.visible = ck > 0.01; A.tray.scale.setScalar(Math.max(0.01, 1.1 * ck));

    if (b >= AT.wt && b < AT.cleared + 0.06) {
      const p = NS.tilePath(b), k = 1 - prog(b, AT.cleared, AT.cleared + 0.06);
      A.tile.visible = k > 0.02; A.tile.position.set(p[0], p[2], p[1]); A.tile.scale.setScalar(Math.max(0.02, k));
    }

    const out = NS.drawerOut(b) * 58;
    A.drawer.position.z = out; A.drawerKnob.position.z = out;
    if (b >= AT.icon && b < AT.drop + 0.05) {
      const k = prog(b, AT.icon, AT.hash, E.out), p = [lerp(900, 1110, k), lerp(1300, 1150, k), 90 + Math.sin(k * Math.PI) * 40];
      const sk = prog(b, AT.hash, AT.hash + 0.12);
      if (b < AT.hash + 0.12) {
        A.icon.visible = true; A.iconBase.visible = sk < 0.6;
        A.iconBase.position.set(p[0], p[2], p[1]); A.iconBase.scale.setScalar(Math.max(0.02, 1 - sk * 1.6));
        A.icon.cells.forEach((c, i) => {
          const sh = hash(c.i * 13 + c.j * 7) * sk * 26, s = Math.max(0.02, 1 - sk);
          _v.set(p[0] - 18.9 + c.i * 4.2 + sh, p[2] + 7.1 + sh * 0.5, p[1] - 18.9 + c.j * 4.2 - sh * 0.4); _s.setScalar(s);
          A.icon.setMatrixAt(i, _m4.compose(_v, _q, _s));
        });
        A.icon.instanceMatrix.needsUpdate = true;
      }
      if (b >= AT.hash) {
        const fk = prog(b, AT.hash, AT.drop, E.io), d = DROP3, q = [lerp(p[0], d[0], fk), lerp(p[1], d[1], fk), lerp(p[2], d[2], fk) + Math.sin(fk * Math.PI) * 60];
        A.file.visible = true; A.file.position.set(q[0], q[2], q[1]); A.file.scale.setScalar(lerp(0.4, 1, prog(b, AT.hash, AT.hash + 0.1)));
      }
    }
    if (b >= AT.poster && b < AT.posterIn + 0.05) {
      const k = prog(b, AT.poster, AT.posterIn, E.io), s3 = [NAS.x + 90, NAS.y + 70, NAS.h + 50], d = DROP3;
      A.poster.visible = true;
      A.poster.position.set(lerp(s3[0], d[0], k), lerp(s3[2], d[2], k) + Math.sin(k * Math.PI) * 110, lerp(s3[1], d[1], k));
    }
    if (b >= AT.emby && b < AT.emby + 0.6) {
      const k = prog(b, AT.emby, AT.emby + 0.55, E.in);
      envAt(lerp(NAS.x + 90, 1900, k), lerp(NAS.y + 80, 600, k), NAS.h + 60 + Math.sin(k * Math.PI) * 80, 1.1 * (1 - prog(b, AT.emby + 0.4, AT.emby + 0.55)));
    }

    const on = prog(b, AT.wake, AT.wake + 0.08);
    A.phone.visible = on > 0.01;
    A.phone.scale.setScalar(1);
    A.phoneDark.material.opacity = 1 - on;
    A.phoneDark.visible = on < 0.99;
    if (b >= AT.send && b < AT.send + 0.45) {
      const k = prog(b, AT.send, AT.send + 0.42, E.in);
      envAt(lerp(PHN.x + 60, 2300, k), lerp(PHN.y + 70, 200, k), PHN.z + 200 + Math.sin(k * Math.PI) * 160, 1.2 * (1 - prog(b, AT.send + 0.3, AT.send + 0.42)));
    }

    A.roof.position.y = 1000 * NS.roofLift(b);
    A.roof.visible = NS.roofLift(b) < 0.999;
    A.boxes.forEach((m, i) => (m.material.emissiveIntensity = 0.35 * NS.impact(b, AT.boxes[i], 0.25)));
    A.hubRing.material.emissiveIntensity = 0.45 * NS.impact(b, AT.merge, 0.25);

    const m = clamp((b - AT.dial) * 4, 0, 60), am = (m / 60) * Math.PI * 2, ah = ((10 + m / 60) / 12) * Math.PI * 2;
    for (const c of A.clocks) { c.mm.rotation.z = -am; c.hh.rotation.z = -ah; }
    A.vane.rotation.y = NS.vaneYaw(b);

    const mb = NS.minuteAt7(b), idx = NS.PLAYS.reduce((acc, p, i) => (mb >= p.start ? i : acc), -1);
    A.else.art.visible = idx >= 0; A.else.fill.visible = idx >= 0;
    if (idx >= 0) {
      A.else.art.material.color.copy(col(idx ? P.lilac : P.rose));
      A.else.fill.scale.z = Math.max(0.01, 80 * clamp((mb - NS.PLAYS[idx].start) / NS.PLAYS[idx].len));
    }

    NS.actors(b, { envAt, clawdPose });
  }

  NS.W = {
    init, view, draw, pose, proj, right, L,
    get ready() { return ready; },
  };
})();
