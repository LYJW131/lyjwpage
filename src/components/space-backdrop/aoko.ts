import { aokoFx, fxState, loadImage, ORB, STILL, type FxState, type HandPose } from "./aoko-fx";
import { ARM_RING_SHAPES, RIFTS, rifts } from "./aoko-rings";

const SRC = "/mascots/aoko.webp";
// 绑定图 RGB 分别是头发、裙摆、头部的权重（0 不动，1 摆幅最大），与立绘同框；离线生成，换立绘要一起重出。
const RIG = "/mascots/aoko-rig.png";
// 闭眼贴图：只含两眼一带，alpha 是羽化遮罩，覆盖原图坐标 BLINK_BOX（x, y, 边长）这块正方形。
const BLINK = "/mascots/aoko-blink.webp";
const BLINK_BOX = [360, 52, 256];
// 伸出的手、光球和握腕的右手单独一层（ARM），覆盖原图坐标 ARM_BOX（x, y, 宽, 高）；FILL 是同一块里 Codex 补出的手背后内容，只在手移开后露出的地方用。
// 手层在右手手腕处竖直切开，摆幅在切口处降到 0，前臂和上臂留在原图里不动，否则胸口的肩带会和补全图错位。
const ARM = "/mascots/aoko-arm.webp";
const FILL = "/mascots/aoko-fill.webp";
const ARM_BOX = [204, 146, 252, 268];
const PALM = [320, 265];
// 着色器坐标系：位置与摆幅都按这套原图像素写，与贴图实际分辨率无关。
const SRC_W = 934;
const SRC_H = 1873;
// 画布四周多留的原图像素：发梢和裙摆会摆出立绘边框。
const PAD = 28;
const MAX_WIDTH = 320;
const EDGE = 12;
const FX_OVERHANG = 360;
const FRAME_MS = 1000 / 30;
// 眨眼时序取 Live2D CubismEyeBlink 的默认值（闭 0.1s、停 0.05s、睁 0.15s）并按实测「闭比睁快约四成」微调；间隔随机，免得像钟摆。
const BLINK_CLOSE = 0.09;
const BLINK_HOLD = 0.04;
const BLINK_OPEN = 0.17;
const BLINK_TOTAL = BLINK_CLOSE + BLINK_HOLD + BLINK_OPEN;
const BLINK_GAP: [number, number] = [2.5, 6.5];
const DOUBLE_BLINK_CHANCE = 0.2;

function lidAt(dt: number) {
  if (dt < 0 || dt >= BLINK_TOTAL) return 0;
  if (dt < BLINK_CLOSE) return (dt / BLINK_CLOSE) ** 2;
  if (dt < BLINK_CLOSE + BLINK_HOLD) return 1;
  return (1 - (dt - BLINK_CLOSE - BLINK_HOLD) / BLINK_OPEN) ** 2;
}

// 手臂环附近的空气折射：在每圈环的椭圆带上、以及每个张开的断口周围沿径向来回推几像素，环里外的立绘跟着波动（img0667 环后面的手臂是扭的）；
// 环的光带经过的袖子与衣服同时被照亮一圈青光（img0667 环下的手臂是亮的）。
// 最大那圈的上沿离下巴很近，折射只做在 CHIN_Y（原图下巴高度）以下，不把嘴扭花。
const CHIN_Y = 255;
const f = (n: number) => n.toFixed(3);
const REFRACT = ARM_RING_SHAPES.rings
  .map(({ x, y, r }, k) => {
    const [c, s] = [Math.cos(ARM_RING_SHAPES.axis), Math.sin(ARM_RING_SHAPES.axis)];
    return `  {vec2 o=P-vec2(${f(x)},${f(y)});vec2 l=vec2(dot(o,vec2(${f(c)},${f(s)})),dot(o,vec2(${f(-s)},${f(c)})));float e=length(vec2(l.x/${f(r * ARM_RING_SHAPES.squash)},l.y/${f(r)}));air+=o/max(length(o),1.)*sin(e*24.-t*4.+${k}.)*3.*smoothstep(.3,0.,abs(e-1.));ringLit+=smoothstep(.22,0.,abs(e-.92));}`;
  })
  .join("\n");

const VERT = `attribute vec2 p;varying vec2 v;void main(){v=vec2(p.x,-p.y)*.5+.5;gl_Position=vec4(p,0.,1.);}`;

const FRAG = `precision mediump float;
uniform sampler2D img,rig,blink,arm,fill;uniform float t,lid,glow,flash;uniform vec3 rift[${RIFTS}];varying vec2 v;
const vec2 S=vec2(${SRC_W}.,${SRC_H}.);const float PAD=${PAD}.;
const vec2 ORB=vec2(${ORB[0]}.,${ORB[1]}.);
const vec3 SHADE=vec3(.06,.055,.19),TINT=vec3(.361,.357,.957),HIGH=vec3(.765,.714,.996),RIM=vec3(.463,.573,.965);
float inside(vec2 u){return step(0.,u.x)*step(u.x,1.)*step(0.,u.y)*step(u.y,1.);}
void main(){
  vec2 P=v*(S+2.*PAD)-PAD;
  vec2 u=P/S;
  vec3 w=texture2D(rig,clamp(u,0.,1.)).rgb*inside(u);
  vec2 d=vec2(0.);
  float bph=fract(t/4.4);
  float br=(bph<.4?smoothstep(0.,.4,bph):1.-smoothstep(.42,.95,bph))*(.85+.15*sin(t*.37));
  float chest=smoothstep(640.,520.,P.y)*smoothstep(240.,330.,P.y);
  float lift=smoothstep(660.,330.,P.y);
  d.y-=(lift*3.+chest*1.)*br;
  d.x+=chest*smoothstep(150.,40.,abs(P.x-500.)-60.)*(P.x-500.)*.008*br;
  float a=.005*sin(t*.7)+.002*sin(t*1.9);
  vec2 q=P-vec2(495.,300.);
  d+=w.b*(vec2(cos(a)*q.x-sin(a)*q.y,sin(a)*q.x+cos(a)*q.y)-q);
  float h=w.r*w.r;float ph=w.r*2.6;
  float lft=smoothstep(520.,380.,P.x);
  vec2 sway=vec2(3.*sin(t*1.2-ph),8.*sin(t*1.05-ph+1.));
  vec2 hang=vec2(6.*sin(t*.95-ph+.6),2.*sin(t*1.3-ph));
  d+=h*mix(hang,sway,lft);
  float k=w.g;
  d+=k*vec2(6.*sin(t*1.5+P.x*.008),3.*sin(t*2.+P.x*.012));
  vec2 air=vec2(0.);float ringLit=0.;
${REFRACT}
  for(int i=0;i<${RIFTS};i++){vec2 o=P-rift[i].xy;float l=max(length(o),1.);air+=o/l*sin(l*.3-t*9.)*5.*rift[i].z*smoothstep(48.,0.,l);}
  float belowChin=smoothstep(${CHIN_Y}.,${CHIN_Y + 35}.,P.y);
  d+=air*belowChin;
  vec2 po=P-ORB;float pl=max(length(po),1.);
  d+=po/pl*smoothstep(46.,0.,abs(pl-(1.-flash)*700.))*flash*9.;
  vec2 s=(P-d)/S;
  vec4 c=texture2D(img,s)*inside(s);
  if(lid>0.){
    vec2 Q=s*S;
    vec2 bu=(Q-vec2(${BLINK_BOX[0]}.,${BLINK_BOX[1]}.))/${BLINK_BOX[2]}.;
    vec4 shut=texture2D(blink,clamp(bu,0.,1.))*inside(bu);
    vec2 qL=(Q-vec2(447.,183.))/vec2(36.,26.);
    vec2 qR=(Q-vec2(530.,185.))/vec2(36.,26.);
    float eye=max(smoothstep(1.,.8,length(qL)),smoothstep(1.,.8,length(qR)));
    bool left=length(qL)<length(qR);
    float qx=left?qL.x:qR.x;
    float arch=clamp(1.-qx*qx,0.,1.);
    float shutLine=left?175.+7.*qx:182.;
    float edge=mix(164.-9.*arch,shutLine-2.*arch,lid);
    float low=mix(206.,shutLine+1.,lid);
    float cover=max(smoothstep(edge+2.5,edge-2.5,Q.y),smoothstep(low-2.5,low+2.5,Q.y))*eye;
    float full=smoothstep(.92,1.,lid);
    float m=mix(cover,1.,full)*shut.a;
    c.rgb=mix(c.rgb,shut.rgb/max(shut.a,.001),m);
    float side=smoothstep(.92,.55,abs(qx))*eye*(1.-full);
    float th=1.2+3.*arch;
    float lash=smoothstep(th,th*.35,abs(Q.y-edge+th*.3))*side*smoothstep(.08,.4,lid);
    c.rgb=mix(c.rgb,vec3(.1,.07,.065),lash*.92*c.a);
  }
  vec2 Q0=s*S;
  vec2 AB=vec2(${ARM_BOX[0]}.,${ARM_BOX[1]}.),AS=vec2(${ARM_BOX[2]}.,${ARM_BOX[3]}.);
  vec2 u0=(Q0-AB)/AS;
  float wg=smoothstep(455.,365.,Q0.x)*smoothstep(372.,300.,Q0.y);
  float was=smoothstep(0.,.5,texture2D(arm,clamp(u0,0.,1.)).a*inside(u0))*smoothstep(.03,.25,wg);
  c=c*(1.-was)+texture2D(fill,clamp(u0,0.,1.))*was;
  vec2 palm=vec2(${PALM[0]}.,${PALM[1]}.);
  vec2 dh=wg*(vec2(-.5,-1.)*5.*sin(t*.8+.4)+vec2(.4,-.3)*2.*sin(t*1.9)+(Q0-palm)*.014*(.5+.5*sin(t*2.4-.8)));
  vec2 au=(Q0-dh-AB)/AS;
  vec4 ar=texture2D(arm,clamp(au,0.,1.))*inside(au);
  c=ar+c*(1.-ar.a);
  const vec3 GLOW=vec3(.45,.9,1.);
  float pulse=.5+.5*sin(t*2.4);
  float cy=clamp((c.b-c.r)*2.2,0.,1.);
  vec3 base=c.rgb/max(c.a,.001);
  float L=dot(base,vec3(.299,.587,.114));
  vec3 duo=L<.5?mix(SHADE,TINT,L*2.):mix(TINT,HIGH,L*2.-1.);
  vec2 px=3./S;
  float near=texture2D(img,s+vec2(px.x,0.)).a+texture2D(img,s-vec2(px.x,0.)).a+texture2D(img,s+vec2(0.,px.y)).a+texture2D(img,s-vec2(0.,px.y)).a;
  float rim=clamp((c.a-near*.25)*2.,0.,1.);
  base=mix(base,duo,min(glow*.65,.7))+GLOW*smoothstep(1350.,${SRC_H}.,P.y)*(.1+.25*glow)+RIM*rim*glow;
  c.rgb=base*c.a;
  c.rgb+=GLOW*min(ringLit,1.)*belowChin*(.22+.2*glow)*c.a;
  c.rgb+=smoothstep(60.,12.,length(P-ORB))*cy*(.1+.24*pulse)*GLOW*c.a;
  c.rgb+=smoothstep(170.,20.,length(P-ORB))*(.05+.09*pulse)*GLOW*c.a;
  vec2 eL=(P-vec2(447.,180.))/vec2(26.,30.);
  vec2 eR=(P-vec2(530.,182.))/vec2(26.,30.);
  float iris=(smoothstep(1.,.6,length(eL))+smoothstep(1.,.6,length(eR)))*cy;
  float shine=pow(.5+.5*sin(t*1.2-.6),3.);
  c.rgb+=iris*(.12+.38*shine)*GLOW*c.a;
  float glint=smoothstep(6.,1.5,length(P-vec2(440.,170.)))+smoothstep(6.,1.5,length(P-vec2(523.,172.)));
  c.rgb+=glint*clamp(cy*2.,0.,1.)*.55*shine*c.a;
  gl_FragColor=c;
}`;

type AokoOptions = {
  gutter: () => { left: number; right: number };
  reducedMotion?: boolean;
};

// 手层在手掌一带（wg=1）的位移，须与 FRAG 里的 dh 同步：平移 d，再以掌心为中心放大 zoom。
function handPose(t: number): HandPose {
  const a = 5 * Math.sin(t * 0.8 + 0.4);
  const b = 2 * Math.sin(t * 1.9);
  return { dx: -0.5 * a + 0.4 * b, dy: -a - 0.3 * b, zoom: 1 / (1 - 0.014 * (0.5 + 0.5 * Math.sin(t * 2.4 - 0.8))) };
}

// 闲置时也带一层蓝紫重打光：人站在亮着的法阵里，对照 img0611（原色）与 img0612（被法阵照亮）。
const glowOf = ({ power, flash }: FxState) => 0.32 + 0.55 * power + 0.25 * flash;

function rigRenderer(canvas: HTMLCanvasElement, art: HTMLImageElement, rig: HTMLImageElement, blink: HTMLImageElement, arm: HTMLImageElement, fill: HTMLImageElement) {
  const gl = canvas.getContext("webgl", { premultipliedAlpha: true, alpha: true, antialias: false });
  if (!gl) return null;
  const shader = (type: number, source: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, source);
    gl.compileShader(s);
    return s;
  };
  const program = gl.createProgram()!;
  gl.attachShader(program, shader(gl.VERTEX_SHADER, VERT));
  gl.attachShader(program, shader(gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
  gl.useProgram(program);

  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(program, "p");
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  const texture = (unit: number, image: HTMLImageElement, premultiply: boolean) => {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, premultiply);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  };
  texture(0, art, true);
  texture(1, rig, false);
  texture(2, blink, true);
  texture(3, arm, true);
  texture(4, fill, true);
  gl.uniform1i(gl.getUniformLocation(program, "img"), 0);
  gl.uniform1i(gl.getUniformLocation(program, "rig"), 1);
  gl.uniform1i(gl.getUniformLocation(program, "blink"), 2);
  gl.uniform1i(gl.getUniformLocation(program, "arm"), 3);
  gl.uniform1i(gl.getUniformLocation(program, "fill"), 4);
  const time = gl.getUniformLocation(program, "t");
  const lid = gl.getUniformLocation(program, "lid");
  const glow = gl.getUniformLocation(program, "glow");
  const burst = gl.getUniformLocation(program, "flash");
  const riftAt = gl.getUniformLocation(program, "rift");
  const riftData = new Float32Array(RIFTS * 3);

  return (t: number, closed: number, light: number, flash: number) => {
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform1f(time, t);
    gl.uniform1f(lid, closed);
    gl.uniform1f(glow, light);
    gl.uniform1f(burst, flash);
    gl.uniform3fv(riftAt, rifts(t, riftData));
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  };
}

export function aokoStanding(parent: HTMLElement, { gutter, reducedMotion = false }: AokoOptions) {
  const root = document.createElement("div");
  root.setAttribute("aria-hidden", "true");
  // 在星空层（opacity-70）之外挂载，立绘不跟着点阵一起变暗。
  root.style.cssText = "position:fixed;inset:0;z-index:-10;pointer-events:none;";
  const layer = (css: string) => {
    const c = document.createElement("canvas");
    c.style.cssText = `position:absolute;${css}`;
    root.appendChild(c);
    return c;
  };
  const back = layer("top:0;");
  const canvas = layer("filter:drop-shadow(0 12px 24px var(--paper-shadow));");
  const front = layer("top:0;");
  parent.appendChild(root);
  const fx = aokoFx(back, front);

  let render: ((t: number, closed: number, light: number, flash: number) => void) | null = null;
  let stopped = false;
  let raf = 0;
  let last = 0;
  const t0 = performance.now();
  const gap = () => BLINK_GAP[0] + Math.random() * (BLINK_GAP[1] - BLINK_GAP[0]);
  let blinkAt = 1.5 + Math.random() * 2;
  const frame = (now: number) => {
    if (stopped) return;
    raf = requestAnimationFrame(frame);
    const t = (now - t0) / 1000;
    // 后台标签回来时 t 会跳很远，直接从现在重新排，不补眨错过的那些。
    if (t > blinkAt + BLINK_TOTAL) {
      const late = t - blinkAt > BLINK_TOTAL + 1;
      blinkAt = late ? t + gap() : blinkAt + BLINK_TOTAL + (Math.random() < DOUBLE_BLINK_CHANCE ? 0.12 : gap());
    }
    const closed = lidAt(t - blinkAt);
    // 眨眼只有约 0.3 秒，这段按刷新率逐帧画，30fps 限帧下眼皮只剩两三帧会显得跳。
    if (!closed && now - last < FRAME_MS) return;
    last = now;
    draw(t, closed);
  };
  const draw = (t: number, closed = 0) => {
    const state = reducedMotion ? STILL : fxState(t);
    render?.(t, closed, glowOf(state), state.flash);
    fx.render(state, handPose(t));
  };

  const layout = () => {
    const { left, right } = gutter();
    const width = Math.min(MAX_WIDTH, right - left - 2 * EDGE, (innerHeight - 48) * (SRC_W / SRC_H));
    const scale = width / SRC_W;
    const cssW = (SRC_W + 2 * PAD) * scale;
    const cssH = (SRC_H + 2 * PAD) * scale;
    const dpr = Math.min(2, devicePixelRatio || 1);
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
    const x = (left + right - width) / 2;
    const bottom = Math.max(8, (innerHeight - SRC_H * scale) * 0.18);
    canvas.style.left = `${x - PAD * scale}px`;
    canvas.style.bottom = `${bottom - PAD * scale}px`;
    // 特效画布朝卡片列那侧多铺 FX_OVERHANG：地面法阵伸进卡片背后的那半边在画布这一侧的边缘渐隐，卡片间隙里不露硬边。
    const fxLeft = left > 0 ? Math.max(0, left - FX_OVERHANG) : 0;
    const fxRight = left > 0 ? right : Math.min(innerWidth, right + FX_OVERHANG);
    const fade = `linear-gradient(to ${left > 0 ? "right" : "left"},transparent,#000 120px)`;
    back.style.maskImage = front.style.maskImage = fade;
    fx.layout({ left: fxLeft, ox: x, oy: innerHeight - bottom - SRC_H * scale, scale, dpr }, fxRight - fxLeft, innerHeight);
    draw(reducedMotion ? 0 : (performance.now() - t0) / 1000);
  };
  layout();

  void Promise.all([loadImage(SRC), loadImage(RIG), loadImage(BLINK), loadImage(ARM), loadImage(FILL), fx.ready]).then(([art, rig, blink, arm, fill]) => {
    if (stopped) return;
    fx.setHand({ img: arm, box: ARM_BOX, palm: PALM });
    render = rigRenderer(canvas, art, rig, blink, arm, fill);
    if (!render) {
      const ctx = canvas.getContext("2d");
      const k = canvas.width / (SRC_W + 2 * PAD);
      ctx?.drawImage(art, PAD * k, PAD * k, SRC_W * k, SRC_H * k);
      fx.render(STILL, handPose(0));
      return;
    }
    draw(0);
    if (!reducedMotion) raf = requestAnimationFrame(frame);
  });

  return {
    el: root,
    layout,
    stop() {
      stopped = true;
      cancelAnimationFrame(raf);
      root.remove();
    },
  };
}
