import { PlaneGeometry } from "three";

import { AHEAD, MUZZLE } from "./aoko-cannon";
import { FLOOR, ORB, RING_X, RING_Y } from "./aoko-fx";
import { FACE_BOX, FACE_COLS, FACE_ROWS, type Face } from "./aoko-face";
import { OVER, plane, shader, texture } from "./aoko-gl";
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

// 光炮照手：光源就是掌心前方的光团（aoko-cannon.ts#AHEAD），随距离按 FALLOFF 衰减（照法取自 PR #722）。
// 手用法线图（scripts/aoko-hand-normals.py），受光量分两档硬边色阶，照原片手指上那种一块块的亮斑；整只手先冲一层淡紫（原片里背光面也是亮的淡紫，不是暗紫）。
const HAND_FALLOFF = 300;

// 场景光照人：整张立绘有法线图（aoko-entry.ts#ART 的 bodyNormal），每个光源按位置、颜色、强度算受光，光源在身后的只亮朝它那侧的轮廓。
// 要的是二次元的打光：原画不压暗，没照到的地方保持原样；受光面一刀切成一块色（不做平滑过渡），沿原来的颜色提亮，
// 深色的地方只带一点光的颜色。直接按滤色把青光叠上去，红裙会被冲成发灰的粉。
// 法线图只留大体积、不带衣褶细节，细节一多受光面就碎成一片片的脏斑（lyjw：「褶皱太多了」）。
// 位置是原图像素（x 右、y 下、z 朝镜头），r 是衰减到一半的距离。法线图是 y 朝上，着色器里翻成 y 朝下；伸出的手用手层自己的法线。
// 脚下法阵照腿另算（GROUND）：按法线一刀切的受光落在黑靴上只是一片发灰的哑光，看不出被照；
// 改成从地面往上渐弱的一层青光，再沿剪影边缘描一圈细的轮廓光，越靠近地面越亮；直接叠加、不按底色缩放，黑靴底色太暗，乘上去就没了。
const GROUND = { rgb: [0.35, 0.75, 1], fade: 700, rim: 1100, k: 0.45, edge: 1 };
const LIGHTS = {
  floorBack: { at: [FLOOR.x, FLOOR.y, -600], rgb: [0.4, 0.6, 1], k: 0.7, r: 1400 },
  // 掌心光球跟着手层摆（位置由 lamp 传进来），蓄力时变亮，发射那一下最亮。
  orb: { rgb: [0.55, 0.9, 1], k: 0.3, r: 220 },
  halo: { at: [RING_X, RING_Y, -400], rgb: [0.6, 0.55, 1], k: 0.6, r: 900 },
};
const v3 = (a: readonly number[]) => `vec3(${a.map(f).join(",")})`;

const FRAG = `uniform sampler2D img,rig,faces,arm,fill,armN,bodyN;uniform vec4 lamp,lv;uniform float t,lid,flash,appear,shutTile,hasN;uniform vec3 face;uniform vec3 rift[${RIFTS}];varying vec2 v;
const vec2 S=vec2(${SRC_W}.,${SRC_H}.);const float PAD=${PAD}.;
const vec2 ORB=vec2(${ORB[0]}.,${ORB[1]}.);
const vec3 LAVENDER=vec3(.62,.6,.98);
void lightUp(vec3 N,vec2 P,vec3 at,vec3 rgb,float k,float r,inout vec3 glow){
  vec3 l=vec3(at.xy-P,at.z);float dl=length(l);vec3 L=l/max(dl,1.);
  float att=k/(1.+dl*dl/(r*r));
  glow+=rgb*smoothstep(.12,.22,dot(N,L))*att;
  if(at.z<0.)glow+=rgb*smoothstep(.45,.6,1.-N.z)*smoothstep(.2,.4,dot(normalize(N.xy+.0001),normalize(L.xy+.0001)))*att*1.6;
}
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
  vec4 nm=texture2D(armN,clamp(au,0.,1.))*inside(au);
  vec3 n=nm.a>.5?normalize(nm.rgb*2.-1.):vec3(0.,0.,1.);
  vec3 nb=hasN>0.?texture2D(bodyN,clamp(s,0.,1.)).xyz*2.-1.:vec3(0.,0.,1.);
  vec3 N=normalize(mix(vec3(nb.x,-nb.y,nb.z),n,ar.a));
  vec3 glow=vec3(0.);
  vec2 px=2.5/S;
  float near=texture2D(img,s+vec2(px.x,0.)).a+texture2D(img,s-vec2(px.x,0.)).a+texture2D(img,s+vec2(0.,px.y)).a+texture2D(img,s-vec2(0.,px.y)).a;
  float edge=clamp((c.a-near*.25)*2.5,0.,1.);
  float low=smoothstep(${f(FLOOR.y - GROUND.fade)},${f(FLOOR.y)},P.y);
  float hem=smoothstep(${f(FLOOR.y - GROUND.rim)},${f(FLOOR.y)},P.y);
  vec3 ground=${v3(GROUND.rgb)}*lv.x*(low*low*${f(GROUND.k)}*(.6+.4*clamp(N.z+N.y,0.,1.))+edge*hem*${f(GROUND.edge)});
  lightUp(N,P,${v3(LIGHTS.floorBack.at)},${v3(LIGHTS.floorBack.rgb)},${f(LIGHTS.floorBack.k)}*lv.x,${f(LIGHTS.floorBack.r)},glow);
  lightUp(N,P,${v3(LIGHTS.halo.at)},${v3(LIGHTS.halo.rgb)},${f(LIGHTS.halo.k)}*lv.y,${f(LIGHTS.halo.r)},glow);
  lightUp(N,P,lamp.xyz,${v3(LIGHTS.orb.rgb)},${f(LIGHTS.orb.k)}*lv.z*(.55+.45*sin(t*2.4))*(1.+2.5*lv.w)+2.*flash+.6*lamp.w,${f(LIGHTS.orb.r)},glow);
  vec3 lit=base+glow*(base*1.2+.14)+ground;
  base=mix(lit,.85+.15*(1.-exp(-(lit-.85)*4.)),step(.85,lit));
  if(lamp.w>0.){
    vec3 l=vec3(vec2(${MUZZLE[0]}.,${MUZZLE[1]}.)-(Q0-dh),${AHEAD}.);
    float dl=length(l);
    float e=max(dot(n,l/dl),0.)/(1.+dl*dl/${HAND_FALLOFF ** 2}.)*lamp.w;
    float band=smoothstep(.16,.2,e)*.6+smoothstep(.4,.44,e)*.4;
    vec3 wash=mix(base,LAVENDER*(.55+.45*dot(base,vec3(.299,.587,.114))),.6*min(lamp.w,1.));
    vec3 hit=mix(wash,max(base,vec3(.9,.91,1.)),band);
    base=mix(base,hit,ar.a*min(lamp.w,1.));
  }
  c.rgb=base*c.a;
  c.rgb+=smoothstep(60.,12.,length(P-ORB))*cy*(.1+.24*pulse)*GLOW*c.a;
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

type Images = Record<"art" | "rig" | "faces" | "arm" | "fill", HTMLImageElement> & Record<"armNormal" | "bodyNormal", HTMLImageElement | null>;
// 法阵与身后光环照人的亮度、光球显出来的程度、蓄力进度，都是 0–1。
export type Lights = { floor: number; ring: number; front: number; power: number };

export function figure(images: Images) {
  const riftData = new Float32Array(RIFTS * 3);
  const material = shader(
    FRAG,
    {
      img: { value: texture(images.art) },
      rig: { value: texture(images.rig, { premultiply: false }) },
      faces: { value: texture(images.faces) },
      arm: { value: texture(images.arm) },
      fill: { value: texture(images.fill) },
      // 法线图缺了就给一张透明的 1×1：着色器见 alpha 为 0 当朝前的法线。
      armN: { value: texture(images.armNormal ?? document.createElement("canvas"), { premultiply: false }) },
      bodyN: { value: texture(images.bodyNormal ?? document.createElement("canvas"), { premultiply: false }) },
      hasN: { value: images.bodyNormal ? 1 : 0 },
      lamp: { value: [0, 0, 0, 0] },
      lv: { value: [0, 0, 0, 0] },
      t: { value: 0 },
      lid: { value: 0 },
      flash: { value: 0 },
      appear: { value: 1 },
      shutTile: { value: -1 },
      face: { value: [-1, -1, 0] },
      rift: { value: riftData },
    },
    OVER,
  );
  const W = SRC_W + 2 * PAD;
  const H = SRC_H + 2 * PAD;
  const mesh = plane(W, H, material, 50);
  mesh.position.set(SRC_W / 2, SRC_H / 2, 0);

  // 影子照 CSS drop-shadow 的算法，糊半径按 CSS 像素给，换算成原图像素要知道当前缩放，所以布局变了重画。
  const silhouette = document.createElement("canvas");
  const shadowMat = shader(SHADOW_FRAG, { map: { value: texture(silhouette) }, appear: { value: 1 }, alpha: { value: 0.52 }, h: { value: H }, top: { value: PAD } }, OVER);
  const shadow = plane(W, H, shadowMat, 49);
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
      // three 首次上传后贴图尺寸就定死了，画布换了尺寸只能换一张新贴图。
      shadowMat.uniforms.map.value.dispose();
      shadowMat.uniforms.map.value = texture(silhouette);
    },
    // lamp：光团在场景里的位置与照在人身上的强度 [x, y, z, k]（aoko-front.ts#orbAt）。
    update(t: number, closed: number, face: Face, lights: Lights, flash: number, appear: number, lamp: readonly number[]) {
      const u = material.uniforms;
      u.lamp.value = lamp;
      u.t.value = t;
      u.lid.value = closed;
      u.face.value = [face.from, face.to, face.mix];
      u.shutTile.value = face.shut;
      u.lv.value = [lights.floor, lights.ring, lights.front, lights.power];
      u.flash.value = flash;
      u.appear.value = appear;
      rifts(t, riftData);
      shadowMat.uniforms.appear.value = appear;
    },
  };
}
