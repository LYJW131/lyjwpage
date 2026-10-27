import { Mesh, PlaneGeometry, ShaderMaterial, type Texture } from "three";

import { MUZZLE } from "./aoko-cannon";
import { ORB } from "./aoko-fx";
import { FACE_BOX, FACE_COLS, FACE_ROWS, type Face } from "./aoko-face";
import { OVER, VERT, texture } from "./aoko-gl";
import { ARM_RING_SHAPES, RIFTS, rifts } from "./aoko-rings";

// 着色器坐标系：位置与摆幅都按原图像素写，与贴图实际分辨率无关。
export const SRC_W = 934;
export const SRC_H = 1873;
// 平面四周多留的原图像素：发梢和裙摆会摆出立绘边框。
export const PAD = 28;
// 手层覆盖原图坐标 ARM_BOX（x, y, 宽, 高）。手层在右手手腕处竖直切开，摆幅在切口处降到 0，前臂和上臂留在原图里不动，否则胸口的肩带会和补全图错位。
export const ARM_BOX = [204, 146, 252, 268] as const;
export const PALM = [320, 265] as const;

// 手臂环附近的空气扭曲：环的椭圆带上和每个张开的断口周围，立绘按两道错开的正弦轻轻晃一两个像素，像隔着热空气看（img0667 环后面的手臂是扭的）。
// 不用径向波：同心推开的那种读起来是水波纹，lyjw 不要。
// 最大那圈的上沿离下巴很近，折射只做在 CHIN_Y（原图下巴高度）以下，不把嘴扭花。
const CHIN_Y = 255;
const f = (n: number) => n.toFixed(3);
const REFRACT = ARM_RING_SHAPES.rings
  .map(({ x, y, r }, k) => {
    const [c, s] = [Math.cos(ARM_RING_SHAPES.axis), Math.sin(ARM_RING_SHAPES.axis)];
    return `  {vec2 o=P-vec2(${f(x)},${f(y)});vec2 l=vec2(dot(o,vec2(${f(c)},${f(s)})),dot(o,vec2(${f(-s)},${f(c)})));float e=length(vec2(l.x/${f(r * ARM_RING_SHAPES.squash)},l.y/${f(r)}));air+=vec2(sin(P.y*.07+t*2.3+${k}.),sin(P.x*.06-t*1.9+${k * 2}.))*2.*smoothstep(.3,0.,abs(e-1.));}`;
  })
  .join("\n");

// 光炮照人：光源在炮口正前方 LAMP_Z（原图像素），随距离按 FALLOFF 衰减（照法与参数取自 PR #722）。
// 手用法线图（scripts/aoko-hand-normals.py），受光量分两档硬边色阶，照原片手指上那种一块块的亮斑；整只手先冲一层淡紫（原片里背光面也是亮的淡紫，不是暗紫）。
// 手以外（脸、袖子、头发）拿立绘透明度的梯度当法线，朝光的轮廓边先亮，按更远的 BODY_FALLOFF 柔和地补一层，不分档。
const LAMP_Z = 34;
const HAND_FALLOFF = 170;
const BODY_FALLOFF = 210;

const FRAG = `uniform sampler2D img,rig,faces,arm,fill,armN;uniform vec3 lamp;uniform float t,lid,glow,flash,appear,shutTile;uniform vec3 face;uniform vec3 rift[${RIFTS}];varying vec2 v;
const vec2 S=vec2(${SRC_W}.,${SRC_H}.);const float PAD=${PAD}.;
const vec2 ORB=vec2(${ORB[0]}.,${ORB[1]}.);
const vec3 FILL=vec3(.42,.46,.78),LAVENDER=vec3(.62,.6,.98);
const vec3 SHADE=vec3(.06,.055,.19),TINT=vec3(.361,.357,.957),HIGH=vec3(.765,.714,.996),RIM=vec3(.463,.573,.965);
float inside(vec2 u){return step(0.,u.x)*step(u.x,1.)*step(0.,u.y)*step(u.y,1.);}
vec4 tile(float i,vec2 bu){if(i<0.)return vec4(0.);vec2 o=vec2(mod(i,${FACE_COLS}.),floor(i/${FACE_COLS}.));return texture2D(faces,(o+clamp(bu,0.,1.))/vec2(${FACE_COLS}.,${FACE_ROWS}.))*inside(bu);}
vec3 over(vec3 c,vec4 p){return mix(c,p.rgb/max(p.a,.001),p.a);}
float hsh(vec2 p){return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453);}
float vn(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hsh(i),hsh(i+vec2(1.,0.)),f.x),mix(hsh(i+vec2(0.,1.)),hsh(i+1.),f.x),f.y);}
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
  vec2 air=vec2(0.);
${REFRACT}
  for(int i=0;i<${RIFTS};i++){vec2 o=P-rift[i].xy;float l=max(length(o),1.);air+=vec2(sin(P.y*.11+t*5.+float(i)),sin(P.x*.1-t*4.3+float(i)))*2.5*rift[i].z*smoothstep(44.,0.,l);}
  float belowChin=smoothstep(${CHIN_Y}.,${CHIN_Y + 35}.,P.y);
  d+=air*belowChin;
  vec2 po=P-ORB;float pl=max(length(po),1.);
  d+=po/pl*smoothstep(46.,0.,abs(pl-(1.-flash)*700.))*flash*9.;
  vec2 s=(P-d)/S;
  vec4 c=texture2D(img,s)*inside(s);
  vec2 bu=(s*S-vec2(${FACE_BOX[0]}.,${FACE_BOX[1]}.))/${FACE_BOX[2]}.;
  c.rgb=mix(over(c.rgb,tile(face.x,bu)),over(c.rgb,tile(face.y,bu)),face.z);
  if(lid>0.&&shutTile>=0.){
    vec2 Q=s*S;
    vec4 shut=tile(shutTile,bu);
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
  if(lamp.z>0.){
    vec4 nm=texture2D(armN,clamp(au,0.,1.))*inside(au);
    vec3 n=nm.a>.5?normalize(nm.rgb*2.-1.):vec3(0.,0.,1.);
    vec3 l=vec3(vec2(${MUZZLE[0]}.,${MUZZLE[1]}.)-(Q0-dh),${LAMP_Z}.);
    float dl=length(l);
    float e=max(dot(n,l/dl),0.)/(1.+dl*dl/${HAND_FALLOFF ** 2}.)*lamp.z;
    float band=smoothstep(.16,.2,e)*.6+smoothstep(.4,.44,e)*.4;
    vec3 wash=mix(base,LAVENDER*(.55+.45*dot(base,vec3(.299,.587,.114))),.6*min(lamp.z,1.));
    vec3 lit=mix(wash,max(base,vec3(.9,.91,1.)),band);
    base=mix(base,lit,ar.a*min(lamp.z,1.));
    vec2 ga=vec2(texture2D(img,s+vec2(px.x,0.)).a-texture2D(img,s-vec2(px.x,0.)).a,texture2D(img,s+vec2(0.,px.y)).a-texture2D(img,s-vec2(0.,px.y)).a);
    vec3 nb=normalize(vec3(-ga*1.5,1.));
    vec3 lb=vec3(lamp.xy-P,${LAMP_Z * 2}.);
    float db=length(lb);
    base+=FILL*max(dot(nb,lb/db),0.)/(1.+db*db/${BODY_FALLOFF ** 2}.)*lamp.z*(1.-ar.a);
  }
  c.rgb=base*c.a;
  c.rgb+=smoothstep(60.,12.,length(P-ORB))*cy*(.1+.24*pulse)*GLOW*c.a;
  c.rgb+=smoothstep(170.,20.,length(P-ORB))*(.05+.09*pulse)*GLOW*c.a;
  vec2 eL=(P-vec2(447.,180.))/vec2(26.,30.);
  vec2 eR=(P-vec2(530.,182.))/vec2(26.,30.);
  float iris=(smoothstep(1.,.6,length(eL))+smoothstep(1.,.6,length(eR)))*cy;
  float shine=pow(.5+.5*sin(t*1.2-.6),3.);
  c.rgb+=iris*(.12+.38*shine)*GLOW*c.a;
  float glint=smoothstep(6.,1.5,length(P-vec2(440.,170.)))+smoothstep(6.,1.5,length(P-vec2(523.,172.)));
  c.rgb+=glint*clamp(cy*2.,0.,1.)*.55*shine*c.a;
  if(appear<1.){
    float front=appear*1.3-.15-(1.-P.y/S.y)-(vn(P/40.)*.7+vn(P/12.)*.3-.5)*.18;
    c.rgb+=GLOW*smoothstep(.05,0.,front)*1.5*c.a;
    c*=smoothstep(0.,.006,front);
  }
  gl_FragColor=c;
}`;

// CSS drop-shadow(0 12px 24px) 的替身：立绘外轮廓糊一遍、往下错开，压在身后特效之上、立绘之下。
// 外轮廓离线糊好不跟着摆：头发裙摆只摆几个原图像素，24px 的软影里看不出；显形时按同一条从脚往上的线一起显出来。
const SHADOW_FRAG = `uniform sampler2D map;uniform float appear,alpha,h,top;varying vec2 v;
void main(){float y=v.y*h-top;float front=appear*1.3-.15-(1.-y/${SRC_H}.);gl_FragColor=vec4(0.,0.,0.,texture2D(map,v).a*alpha*smoothstep(0.,.08,front));}`;

type Images = Record<"art" | "rig" | "faces" | "arm" | "fill" | "normal", HTMLImageElement>;

export function figure(images: Images) {
  const riftData = new Float32Array(RIFTS * 3);
  const material = new ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      img: { value: texture(images.art) },
      rig: { value: texture(images.rig, { premultiply: false }) },
      faces: { value: texture(images.faces) },
      arm: { value: texture(images.arm) },
      fill: { value: texture(images.fill) },
      armN: { value: texture(images.normal, { premultiply: false }) },
      lamp: { value: [0, 0, 0] },
      t: { value: 0 },
      lid: { value: 0 },
      glow: { value: 0 },
      flash: { value: 0 },
      appear: { value: 1 },
      shutTile: { value: -1 },
      face: { value: [-1, -1, 0] },
      rift: { value: riftData },
    },
    ...OVER,
  });
  const W = SRC_W + 2 * PAD;
  const H = SRC_H + 2 * PAD;
  const mesh = new Mesh(new PlaneGeometry(W, H), material);
  mesh.position.set(SRC_W / 2, SRC_H / 2, 0);
  mesh.renderOrder = 50;

  // 影子的糊半径按 CSS 像素给（和原来的 drop-shadow 一样），换算成原图像素要知道当前缩放，所以布局变了重画。
  const silhouette = document.createElement("canvas");
  const shadowTex: Texture = texture(silhouette);
  const shadowMat = new ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: SHADOW_FRAG,
    uniforms: { map: { value: shadowTex }, appear: { value: 1 }, alpha: { value: 0.52 }, h: { value: H }, top: { value: PAD } },
    ...OVER,
  });
  const shadow = new Mesh(new PlaneGeometry(W, H), shadowMat);
  shadow.renderOrder = 49;
  let shadowScale = 0;

  return {
    mesh,
    shadow,
    setScale(scale: number) {
      if (Math.abs(scale - shadowScale) < 0.01) return;
      shadowScale = scale;
      // 糊的范围 3σ 以内都在 PAD 外面也要有，影子平面比立绘四周多出 MARGIN。
      const sigma = 12 / scale;
      const k = 0.25;
      const margin = 3 * sigma;
      silhouette.width = Math.round((W + 2 * margin) * k);
      silhouette.height = Math.round((H + 2 * margin) * k);
      const ctx = silhouette.getContext("2d")!;
      ctx.filter = `blur(${sigma * k}px)`;
      ctx.drawImage(images.art, (PAD + margin) * k, (PAD + margin) * k, SRC_W * k, SRC_H * k);
      shadow.geometry.dispose();
      shadow.geometry = new PlaneGeometry(W + 2 * margin, H + 2 * margin);
      shadow.position.set(SRC_W / 2, SRC_H / 2 + 12 / scale, 0);
      shadowMat.uniforms.h.value = H + 2 * margin;
      shadowMat.uniforms.top.value = PAD + margin;
      shadowTex.needsUpdate = true;
    },
    // lamp：光炮炮口跟手摆动后的位置与照在人身上的强度 [x, y, k]。
    update(t: number, closed: number, face: Face, light: number, flash: number, appear: number, lamp: readonly number[]) {
      const u = material.uniforms;
      u.lamp.value = lamp;
      u.t.value = t;
      u.lid.value = closed;
      u.face.value = [face.from, face.to, face.mix];
      u.shutTile.value = face.shut;
      u.glow.value = light;
      u.flash.value = flash;
      u.appear.value = appear;
      rifts(t, riftData);
      shadowMat.uniforms.appear.value = appear;
    },
  };
}
