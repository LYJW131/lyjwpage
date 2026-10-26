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
// 第五法魔术阵与正面掌心魔弹特效图集（归一化按 2048 坐标系采样，UV 固定在片段着色器各象限，重打图集须同步改 UV）。
const VFX = "/mascots/aoko-vfx.webp";
// 着色器坐标系：立绘原图框 934×1873，统一胸口视高针孔相机 CAM=(410,380,2200) 同时驱动脚下大魔法阵与正面掌心魔弹。
const SRC_W = 934;
const SRC_H = 1873;
const PAD_L = 1020;
const PAD_R = 940;
const PAD_T = 280;
const PAD_B = 480;
const TOT_W = SRC_W + PAD_L + PAD_R;
const TOT_H = SRC_H + PAD_T + PAD_B;
const MAX_WIDTH = 320;
const EDGE = 14;
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

const VERT = `attribute vec2 p;varying vec2 v;void main(){v=vec2(p.x,-p.y)*.5+.5;gl_Position=vec4(p,0.,1.);}`;

const FRAG = `precision mediump float;
uniform sampler2D img,rig,blink,arm,fill,vfx;uniform float t,lid;varying vec2 v;
const vec2 S=vec2(${SRC_W}.,${SRC_H}.);
const vec2 PAD0=vec2(${PAD_L}.,${PAD_T}.);
const vec2 TOT=vec2(${TOT_W}.,${TOT_H}.);
vec2 rot(vec2 q,float a){float c=cos(a),s=sin(a);return vec2(c*q.x-s*q.y,s*q.x+c*q.y);}
vec4 tile2k(vec2 q,vec2 ctr,float rad){
  float m=1.-smoothstep(.94,1.,length(q));
  if(m<=.001)return vec4(0.);
  return texture2D(vfx,(ctr+q*rad)/2048.)*m;
}
vec3 scr(vec3 a,vec3 b){return 1.-(1.-clamp(a,0.,1.))*(1.-clamp(b,0.,1.));}
vec4 emit(vec4 base,vec3 light){
  vec3 L=1.-exp(-max(light,vec3(0.))*vec3(1.15,1.70,2.85));
  float la=max(L.r,max(L.g,L.b));
  vec3 rgb=scr(base.rgb,L);
  float oa=max(base.a,1.-(1.-base.a)*(1.-la));
  return vec4(min(rgb,oa),oa);
}
void main(){\n  vec2 P=v*TOT-PAD0;
  float edgeFade=smoothstep(${-PAD_L + 8}.,${-PAD_L + 120}.,P.x)*smoothstep(${-PAD_T + 8}.,${-PAD_T + 85}.,P.y);
  vec2 u=P/S;
  float inU=step(0.,u.x)*step(u.x,1.)*step(0.,u.y)*step(u.y,1.);
  vec3 w=texture2D(rig,clamp(u,0.,1.)).rgb*inU;
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

  float pulse=.5+.5*sin(t*2.1);
  float surge=.88+.10*pulse+.12*pow(.5+.5*sin(t*.95+.4),3.);
  const vec3 GLOW=vec3(.30,.84,1.);
  const vec3 COBALT=vec3(.14,.36,1.);
  const vec3 SAPPHIRE=vec3(.20,.28,.94);

  const vec3 CAM=vec3(410.,380.,2200.);
  vec3 rd=vec3(P,0.)-CAM;

  vec3 gLight=vec3(0.);
  if(P.y>1180.){\n    float tf=1436./(P.y-380.);
    vec2 gp=vec2(410.+(P.x-410.)*tf-485.,2200.*(1.-tf)+55.)/1420.;
    float gr=length(gp);
    if(gr<1.06){\n      float pg=clamp(1.02-.22*(tf-1.),.72,1.14);
      vec4 gQ0=tile2k(rot(gp,t*.062),vec2(512.,512.),492.);
      vec4 gQ1=tile2k(rot(gp,-t*.044-.82),vec2(1536.,512.),492.);
      vec4 gQ2=tile2k(rot(gp,t*.029),vec2(512.,1536.),492.);
      vec3 gTex=scr(scr(gQ0.rgb*1.05,gQ1.rgb*1.08),gQ2.rgb*1.05)*pg*(.90+.10*pulse);
      float rimHalo=(exp(-pow(gr-.95,2.)/.0042)*.24+exp(-pow(gr-.58,2.)/.0032)*.11+exp(-gr*gr/.045)*.06)*pg;
      gLight=scr(gTex,mix(SAPPHIRE,COBALT,.68)*rimHalo*(.88+.12*pulse));
    }\n  }\n  float gAura=smoothstep(1440.,180.,abs(P.x-485.))*smoothstep(1180.,1810.,P.y)*smoothstep(2380.,1810.,P.y)*(.05+.02*pulse);
  vec4 outC=emit(vec4(0.),(gLight+SAPPHIRE*gAura)*edgeFade);

  vec2 palm=vec2(328.,285.);
  vec2 dh0=vec2(-.5,-1.)*5.*sin(t*.8+.4)+vec2(.4,-.3)*2.*sin(t*1.9);
  const vec3 D3=vec3(-.052,-.028,.9983);
  const vec3 U3=vec3(.9986,-.0015,.0520);
  const vec3 V3=vec3(0.,.9996,.0280);
  vec3 M0=vec3(338.+dh0.x,286.+dh0.y,0.);
  float rb=dot(rd,D3);

  float palmAmb=exp(-dot(P-M0.xy,P-M0.xy)/(195.*195.))*(.07+.03*surge);
  outC=emit(outC,mix(SAPPHIRE,COBALT,.52)*palmAmb*edgeFade);

  vec2 s=(P-d)/S;
  float inS=step(0.,s.x)*step(s.x,1.)*step(0.,s.y)*step(s.y,1.);
  vec4 c=texture2D(img,s)*inS;
  if(lid>0.){\n    vec2 Q=s*S;
    vec2 bu=(Q-vec2(${BLINK_BOX[0]}.,${BLINK_BOX[1]}.))/${BLINK_BOX[2]}.;
    float inB=step(0.,bu.x)*step(bu.x,1.)*step(0.,bu.y)*step(bu.y,1.);
    vec4 shut=texture2D(blink,clamp(bu,0.,1.))*inB;
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
  }\n  vec2 Q0=s*S;
  vec2 AB=vec2(${ARM_BOX[0]}.,${ARM_BOX[1]}.),AS=vec2(${ARM_BOX[2]}.,${ARM_BOX[3]}.);
  vec2 u0=(Q0-AB)/AS;
  float inA0=step(0.,u0.x)*step(u0.x,1.)*step(0.,u0.y)*step(u0.y,1.);
  float wg=smoothstep(455.,365.,Q0.x)*smoothstep(372.,300.,Q0.y);
  float was=smoothstep(0.,.5,texture2D(arm,clamp(u0,0.,1.)).a*inA0)*smoothstep(.03,.25,wg);
  c=c*(1.-was)+texture2D(fill,clamp(u0,0.,1.))*was;

  vec2 sL=s+vec2(-6.,-3.)/S;
  vec2 sB2=s+vec2(0.,9.)/S;
  float bodyRimL=clamp(c.a-texture2D(img,clamp(sL,0.,1.)).a*step(0.,sL.x)*step(sL.x,1.)*step(0.,sL.y)*step(sL.y,1.),0.,1.);
  float bodyRimB=clamp(c.a-texture2D(img,clamp(sB2,0.,1.)).a*step(0.,sB2.x)*step(sB2.x,1.)*step(0.,sB2.y)*step(sB2.y,1.),0.,1.);
  float muzProx=smoothstep(560.,90.,length(P-M0.xy));
  c.rgb+=bodyRimL*muzProx*(.28+.12*surge)*GLOW*c.a;

  float gndProx=smoothstep(1380.,1868.,P.y)*smoothstep(640.,80.,abs(P.x-485.));
  c.rgb+=(bodyRimB*.42+gndProx*.12)*(.86+.14*pulse)*mix(COBALT,GLOW,.52)*c.a;
  c.rgb=min(c.rgb,c.a);

  outC=c+outC*(1.-c.a);

  {\n    vec3 cRear=M0-38.*D3;
    float trR=dot(cRear-CAM,D3)/rb;
    vec3 hR=CAM+trR*rd-cRear;
    vec2 qR2=vec2(dot(hR,U3),dot(hR,V3))/425.;
    float rR=length(qR2);
    if(rR<1.02){\n      float outerOnly=smoothstep(.40,.50,rR);
      vec4 rQ1=tile2k(rot(qR2,-t*.13),vec2(1536.,512.),492.)*outerOnly;
      vec4 rQ2=tile2k(rot(qR2,t*.09),vec2(512.,1536.),492.);
      float bodyBehind=1.-.88*c.a;
      outC=emit(outC,scr(rQ1.rgb*.78,rQ2.rgb*.76)*surge*bodyBehind*edgeFade);
    }\n  }\n
  vec2 dh=wg*(dh0+(Q0-palm)*.014*(.5+.5*sin(t*2.4-.8)));
  vec2 au=(Q0-dh-AB)/AS;
  float inAu=step(0.,au.x)*step(au.x,1.)*step(0.,au.y)*step(au.y,1.);
  vec4 ar=texture2D(arm,clamp(au,0.,1.))*inAu;
  vec2 auL=au+vec2(-4.,3.)/AS;
  float armRim=clamp(ar.a-texture2D(arm,clamp(auL,0.,1.)).a*step(0.,auL.x)*step(auL.x,1.)*step(0.,auL.y)*step(auL.y,1.),0.,1.);
  ar.rgb+=armRim*(.26+.12*surge)*GLOW*ar.a*(1.-.45*ar.r);
  ar.rgb=min(ar.rgb,ar.a);
  outC=ar+outC*(1.-ar.a);

  const vec2 ORB=vec2(368.,318.);
  float cy=clamp((outC.b-outC.r)*2.2,0.,1.);
  outC.rgb+=smoothstep(68.,12.,length(P-(ORB+dh0)))*cy*(.14+.20*surge)*GLOW*outC.a;
  vec2 eL=(P-vec2(447.,180.))/vec2(26.,30.);
  vec2 eR=(P-vec2(530.,182.))/vec2(26.,30.);
  float iris=(smoothstep(1.,.6,length(eL))+smoothstep(1.,.6,length(eR)))*cy*c.a;
  float shine=pow(.5+.5*sin(t*1.2-.6),3.);
  outC.rgb+=iris*(.14+.32*max(shine,surge-.78))*GLOW;
  float glint=(smoothstep(6.,1.5,length(P-vec2(440.,170.)))+smoothstep(6.,1.5,length(P-vec2(523.,172.))))*c.a;
  outC.rgb+=glint*clamp(cy*2.,0.,1.)*.48*max(shine,.38);
  outC.rgb=min(outC.rgb,outC.a);

  float streakMask=smoothstep(1380.,180.,abs(P.x-485.))*smoothstep(2320.,1810.,P.y)*smoothstep(1220.,1720.,P.y)*(1.-.68*c.a)*edgeFade;
  if(streakMask>.002){\n    vec2 su1=vec2(fract((P.x+420.)/540.),fract((P.y-1220.)/580.+t*.13));
    vec2 su2=vec2(fract((P.x+680.)/420.),fract((P.y-1220.)/480.+t*.19+.37));
    float fade1=sin(su1.y*3.14159)*sin(su1.x*3.14159);
    float fade2=sin(su2.y*3.14159)*sin(su2.x*3.14159);
    vec4 st1=texture2D(vfx,(vec2(1560.,1560.)+su1*464.)/2048.)*fade1;
    vec4 st2=texture2D(vfx,(vec2(1560.,1560.)+su2*464.)/2048.)*fade2;
    float fil=pow(.5+.5*sin(P.x*.045+sin(t*.6)*1.2)*sin(P.x*.11-t*.8),4.)*smoothstep(2160.,1750.,P.y)*smoothstep(1240.,1740.,P.y);
    outC=emit(outC,((st1.rgb+st2.rgb*.75)*.38+mix(COBALT,GLOW,.56)*fil*.16)*streakMask*(.88+.14*pulse));
  }\n
  float gloveKeep=1.-.85*ar.a*(1.-cy)*smoothstep(18.,48.,length(P-M0.xy));
  float faceShield=1.-.88*smoothstep(170.,65.,length(P-vec2(485.,190.)))*c.a;
  float fgKeep=gloveKeep*faceShield;
  {\n    vec3 cF1=M0+34.*D3;
    float tr1=dot(cF1-CAM,D3)/rb;
    vec3 h1=CAM+tr1*rd-cF1;
    vec2 q1=vec2(dot(h1,U3),dot(h1,V3))/205.;
    if(length(q1)<1.02){\n      vec4 f1=tile2k(rot(q1,t*.26),vec2(1280.,1280.),240.);
      outC=emit(outC,f1.rgb*.78*surge*fgKeep*edgeFade);
    }\n
    vec3 cF2=M0+195.*D3;
    float tr2=dot(cF2-CAM,D3)/rb;
    vec3 h2=CAM+tr2*rd-cF2;
    vec2 q2=vec2(dot(h2,U3),dot(h2,V3))/108.;
    if(length(q2)<1.02){\n      vec4 f2=tile2k(rot(q2,-t*.42),vec2(1280.,1280.),240.);
      outC=emit(outC,f2.rgb*.82*surge*fgKeep*edgeFade);
    }\n
    for(int i=0;i<2;i++){\n      float wph=fract(t*.46+float(i)*.5);
      vec3 cW=M0+(24.+400.*wph)*D3;
      float trW=dot(cW-CAM,D3)/rb;
      vec2 qW=vec2(dot(CAM+trW*rd-cW,U3),dot(CAM+trW*rd-cW,V3))/(46.+185.*wph);
      float rW=length(qW);
      float shock=smoothstep(.040,.005,abs(rW-1.))*sin(wph*3.14159)*(.34+.12*surge);
      outC=emit(outC,mix(COBALT,GLOW,.62)*shock*fgKeep*edgeFade);
    }\n  }\n
  {\n    vec3 cB=M0+24.*D3;
    float trB=dot(cB-CAM,D3)/rb;
    vec3 hB=CAM+trB*rd-cB;
    vec2 qb=vec2(dot(hB,U3),dot(hB,V3));
    float rb2=length(qb);

    vec4 arcs=tile2k(rot(qb/265.,-t*.24),vec2(1280.,1792.),240.);
    vec4 burst=tile2k(qb/375.,vec2(1792.,1280.),240.);
    vec4 burst2=tile2k(rot(qb/225.,t*.15+.55),vec2(1792.,1280.),240.);

    float ang=atan(qb.y,qb.x);
    float rays=pow(.5+.5*sin(ang*10.+t*3.2)*cos(ang*6.-t*2.1),2.4)*exp(-rb2/95.)*smoothstep(10.,34.,rb2);
    float sheath=exp(-(rb2*rb2)/(34.*34.));
    float core=exp(-(rb2*rb2)/(14.*14.));
    float hot=smoothstep(7.5,1.2,rb2);

    vec3 muzzle=scr(arcs.rgb*.58,burst.rgb*.76+burst2.rgb*.28)*surge*fgKeep
      +mix(COBALT,GLOW,.62)*rays*.28*surge*fgKeep
      +COBALT*sheath*(.34+.10*surge)
      +GLOW*core*(.64+.14*surge)
      +vec3(.78,.98,1.)*hot*(.62+.14*surge);
    outC=emit(outC,muzzle*edgeFade);
  }\n
  gl_FragColor=outC;
}`;

type AokoOptions = {
  gutter: () => { left: number; right: number };
  reducedMotion?: boolean;
};

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function rigRenderer(
  canvas: HTMLCanvasElement,
  art: HTMLImageElement,
  rig: HTMLImageElement,
  blink: HTMLImageElement,
  arm: HTMLImageElement,
  fill: HTMLImageElement,
  vfx: HTMLImageElement,
) {
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
  texture(5, vfx, true);
  gl.uniform1i(gl.getUniformLocation(program, "img"), 0);
  gl.uniform1i(gl.getUniformLocation(program, "rig"), 1);
  gl.uniform1i(gl.getUniformLocation(program, "blink"), 2);
  gl.uniform1i(gl.getUniformLocation(program, "arm"), 3);
  gl.uniform1i(gl.getUniformLocation(program, "fill"), 4);
  gl.uniform1i(gl.getUniformLocation(program, "vfx"), 5);
  const time = gl.getUniformLocation(program, "t");
  const lid = gl.getUniformLocation(program, "lid");

  return (t: number, closed = 0) => {
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform1f(time, t);
    gl.uniform1f(lid, closed);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  };
}

export function aokoStanding(parent: HTMLElement, { gutter, reducedMotion = false }: AokoOptions) {
  const canvas = document.createElement("canvas");
  canvas.setAttribute("aria-hidden", "true");
  // 在星空层（opacity-70）之外挂载，立绘不跟着点阵一起变暗。
  canvas.style.cssText = "position:fixed;z-index:-10;pointer-events:none;filter:drop-shadow(0 12px 24px var(--paper-shadow));";
  parent.appendChild(canvas);

  let render: ((t: number, closed?: number) => void) | null = null;
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
    // 后台标签回来时 t 会跳很远，直接从现在重新排，不补眨眼错过的那些。
    if (t > blinkAt + BLINK_TOTAL) {
      const late = t - blinkAt > BLINK_TOTAL + 1;
      blinkAt = late ? t + gap() : blinkAt + BLINK_TOTAL + (Math.random() < DOUBLE_BLINK_CHANCE ? 0.12 : gap());
    }
    const closed = lidAt(t - blinkAt);
    // 眨眼只有约 0.3 秒，这段按刷新率逐帧画，30fps 限帧下眼皮只剩两三帧会显得跳。
    if (!closed && now - last < FRAME_MS) return;
    last = now;
    render?.(t, closed);
  };

  const layout = () => {
    const { left, right } = gutter();
    const width = Math.min(MAX_WIDTH, right - left - 2 * EDGE, (innerHeight - 48) * (SRC_W / SRC_H));
    const scale = width / SRC_W;
    const cssW = TOT_W * scale;
    const cssH = TOT_H * scale;
    const dpr = Math.min(2, devicePixelRatio || 1);
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
    canvas.style.left = `${(left + right - width) / 2 - PAD_L * scale}px`;
    canvas.style.bottom = `${Math.max(44, (innerHeight - SRC_H * scale) * 0.22) - PAD_B * scale}px`;
    render?.((performance.now() - t0) / 1000);
  };
  layout();

  void Promise.all([loadImage(SRC), loadImage(RIG), loadImage(BLINK), loadImage(ARM), loadImage(FILL), loadImage(VFX)]).then(
    ([art, rig, blink, arm, fill, vfx]) => {
      if (stopped) return;
      render = rigRenderer(canvas, art, rig, blink, arm, fill, vfx);
      if (!render) {
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        const k = canvas.width / TOT_W;
        ctx.save();
        ctx.globalAlpha = 0.78;
        ctx.translate((PAD_L + 485) * k, (PAD_T + 1816) * k);
        ctx.scale(1, 0.54);
        ctx.drawImage(vfx, 0, 0, 1024, 1024, -1350 * k, -1350 * k, 2700 * k, 2700 * k);
        ctx.restore();
        return;
      }
      if (!reducedMotion) {
        raf = requestAnimationFrame(frame);
      } else {
        render(1.2, 0);
      }
    },
  );

  return {
    el: canvas,
    layout,
    stop() {
      stopped = true;
      cancelAnimationFrame(raf);
      canvas.remove();
    },
  };
}
