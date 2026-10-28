import { Mesh, PlaneGeometry } from "three";

import { EXTENT, FLOOR, FLOOR_UNFOLD_S } from "./aoko-fx";
import { COLORS, OVER, shader, texture } from "./aoko-gl";
import { RIM, SCENE, circle, hash, smooth, tone } from "./aoko-paint";

// 脚下的地面法阵就是 img0609（俯视）里那面：外圈 img0640（符文带、星形弦线、印章环）套内盘 img1627（旋刃、中心四枚印章、粗亮边），
// 底下是砖地：本身是暗灰紫，紫色是法阵照出来的，法阵暗了、熄了，那层紫跟着淡，只剩暗底。砖地是一块真的水平面，透视、近大远小由 aoko-stage.ts 的相机给。
const BRICK_TEX = 1280;
const BRICK_R = BRICK_TEX / 2 / EXTENT;
// 法阵单独一张纹理，边长与 floor-outer 贴图一致（须与 character-art 仓库 scripts/fx/aoko-fx-assets.ts 同步）。砖地是柔和的渐变和砖缝，低一档的分辨率就够。
const CIRCLE_TEX = 1600;
const R = (CIRCLE_TEX / 2) * RIM;
// img0640 圈内 0.43 R 以内是空的，img0609 里内盘的粗亮边正好贴着这一圈。
const INNER_R = 0.43 * R;
// 法阵纹理在砖地坐标里占的半宽（砖地半宽记作 1）。
const CIRCLE_SPAN = 1 / (EXTENT * RIM);
const TAU = Math.PI * 2;

// 展开逐帧照剧场版官方账号「魔法陣体験」那段地面投影（docs/references.md），关键帧是 PR #723 在原片上量的：
// 原片那面法阵就是内盘 img1627，把原片每一帧按透视拉正回 img1627 的贴图坐标，按半径分圈、对细线与宽块两层做回归，量出每一圈每一刻的亮度：
// 法阵从头到尾是原尺寸、不转，从触地点往外显现（软前沿）；细线与靠中心的宽块跟着前沿出来，外半圈的宽刃先只有三四成亮，
// 等第二道波从半径 0.45 推到外缘才填满；整面糊在光里亮几秒、微微起伏；收尾细线和中心一带暗下去再亮回清晰版。
// 下面的关键帧除 BLUR、GAIN 外就是量出来的值，时间是从触地起的秒数、半径以内盘外缘为 1，中间线性插值；7.75 秒以后都是平时的完整法阵，只剩 GAIN 往下回落。
// 原片没有 img0640 外圈，显现前沿过了内盘外缘就接着往外推，把外圈也显出来。
type Keys = [number, number][];
// 显现前沿（亮到一半处）的半径。过了内盘外缘照原片末段的速度（约每秒一个内盘半径）接着往外推。
const REVEAL: Keys = [[0, -0.1], [0.2, 0.05], [0.55, 0.15], [0.7, 0.25], [0.8, 0.35], [0.88, 0.45], [1.12, 0.55], [1.2, 0.65], [1.35, 0.75], [1.45, 0.85], [1.55, 0.95], [1.62, 1.05], [2.2, 1.7], [2.8, 2.45], [3.1, 3.9]];
// 软边按原片「最早出现光」比「亮到一半」领先约 0.2 定的。
const REVEAL_FEATHER = 0.4;
// 宽刃第二道波的前沿半径；波到之前，半径 FILL_INNER 以外（印以外）的宽块只有 FILL_EARLY 那么亮。
// 回归里中心一带的宽块偏亮，对照画面看是印的粗边和糊开的细线，宽刃本身这时还没亮。
const WAVE: Keys = [[0, 0.3], [2.3, 0.3], [3, 0.9], [3.15, 1.2]];
const WAVE_FEATHER = 0.15;
const FILL_INNER = 0.3;
const FILL_EARLY = 0.15;
// 两层的整体亮度，平时为 1：显现时细线比平稳时亮一截，6–6.6 秒再起一点；收尾细线与宽块暗下去再亮回。
const LINES: Keys = [[0, 1.6], [2.8, 1.5], [4, 1], [6, 0.97], [6.6, 1.07], [6.75, 1.05], [7.25, 0.25], [7.75, 1]];
const FILL: Keys = [[0, 1], [6.75, 1], [7.25, 0.65], [7.75, 1]];
// 糊的程度（1 = 整面换成糊的那份）与额外泛光。原片糊到 6.75 秒，lyjw 嫌长，宽刃填满后就对焦。
const BLUR: Keys = [[0, 1], [3.2, 1], [4, 0], [7.75, 0]];
const BLOOM: Keys = [[0, 0], [0.5, 0.25], [2.75, 0.25], [4.5, 0.2], [6, 0.22], [6.6, 0.28], [7.1, 0], [7.75, 0]];
// 整面的增益：展开时比平时亮（lyjw 要的），定格后用 1.5 秒回落到平时亮度。
const GAIN: Keys = [[0, 1.5], [7.75, 1.5], [FLOOR_UNFOLD_S, 1]];
// 原片没有外圈；泛光那几秒外圈先压暗，免得粗亮环抢了内盘。
const OUTER: Keys = [[0, 0.6], [6.75, 0.6], [7.75, 1]];
const SPARK_S = 0.5;
const SPARKS = 14;
// 糊的那份由两档各占一半（原片糊得比一档模糊更厉害），摊薄了线条，按这个倍数补亮。两档取贴图的粗一级 mip：
// 2 级约等于缩到 1/4、3.3 级约等于缩到 1/10 再放大。
const BLUR_GAIN = [0.6, 0.75];
const BLUR_LOD = [2, 3.3];

const at = (keys: Keys, t: number) => {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [b, vb] = keys[i];
    if (t > b) continue;
    const [a, va] = keys[i - 1];
    return va + ((vb - va) * (t - a)) / (b - a);
  }
  return keys[keys.length - 1][1];
};

function floorTextures(outer: HTMLImageElement) {
  const bricks = document.createElement("canvas");
  bricks.width = bricks.height = BRICK_TEX;
  const b = bricks.getContext("2d")!;
  const lit = b.createRadialGradient(BRICK_TEX / 2, BRICK_TEX / 2, 0, BRICK_TEX / 2, BRICK_TEX / 2, BRICK_TEX / 2);
  // 四成半径内保持亮，往外按 smoothstep 落到零，到边上斜率也归零；线性收尾在透视压扁的远端会显出一道硬边。
  for (let i = 0; i <= 16; i++) lit.addColorStop(i / 16, tone(SCENE.brick, 0.85 * (1 - smooth(0.4, 1, i / 16))));
  b.fillStyle = lit;
  b.fillRect(0, 0, BRICK_TEX, BRICK_TEX);
  b.globalCompositeOperation = "destination-out";
  b.fillStyle = tone(SCENE.brick, 0.6);
  const row = BRICK_R * 0.09;
  for (let y = 0, i = 0; y < BRICK_TEX; y += row, i++) {
    b.fillRect(0, y, BRICK_TEX, 4);
    for (let x = (i % 2) * row; x < BRICK_TEX; x += row * 2.1) b.fillRect(x, y, 3, row);
  }

  const tex = document.createElement("canvas");
  tex.width = tex.height = CIRCLE_TEX;
  const c = tex.getContext("2d")!;
  c.translate(CIRCLE_TEX / 2, CIRCLE_TEX / 2);
  const pool = c.createRadialGradient(0, 0, 0, 0, 0, R);
  pool.addColorStop(0, tone(SCENE.deep, 0.22));
  pool.addColorStop(1, tone(SCENE.deep, 0.08));
  c.fillStyle = pool;
  c.beginPath();
  c.arc(0, 0, R, 0, Math.PI * 2);
  c.fill();
  c.globalCompositeOperation = "lighter";
  circle(c, outer, R);
  return { bricks, tex };
}

// 平时（u=1）：外圈随 spin 转、内盘以 1.6 倍反转，法阵叠在砖地上（source-over）。
// 展开中（u<1）：外圈和内盘的「细线」「宽块」两层（宽块由 fill 遮罩拆出，两层 alpha 互补）各按自己的径向前沿显现，
// 中心冒一团光和几颗火星；BLUR 那几秒整面换成取粗 mip 的糊的那份，整面再乘 GAIN。
// 砖地是暗底上叠法阵照出的紫：紫按法阵亮度（alpha×gain）与前沿到了几成叠；暗底不低于 ground，召唤时跟着前沿出来，平时重放不熄。
const FRAG = `${COLORS}uniform sampler2D bricks,tex,inner,fillMask;uniform float spin,alpha,u,ground,gain;
uniform vec4 k0;uniform vec4 k1;uniform vec2 spark;uniform vec3 sparks[${SPARKS}];varying vec2 v;
float inside(vec2 u){return step(0.,u.x)*step(u.x,1.)*step(0.,u.y)*step(u.y,1.);}
vec2 rot(vec2 p,float a){float c=cos(a),s=sin(a);return vec2(c*p.x-s*p.y,s*p.x+c*p.y);}
float front(float rho,float edge,float feather){return smoothstep(0.,1.,(edge-rho)/feather+.5);}
const float INNER=${(CIRCLE_TEX / 2 / (INNER_R / RIM)).toFixed(5)};
vec4 disc(vec2 q,float lod){
  vec2 qt=rot(q,-spin)*.5+.5;
  vec2 qi=rot(q,1.6*spin)*INNER*.5+.5;
  vec4 o=texture2D(tex,qt,lod)*inside(qt);
  vec4 i=texture2D(inner,qi,lod)*inside(qi);
  if(u>=1.)return i*alpha+o*alpha*(1.-i.a*alpha);
  float rho=length(q)*INNER/${RIM.toFixed(3)};
  float edge=k0.x,wave=k0.y,lines=k0.z,fill=k0.w,outer=k1.x;
  o*=alpha*fill*outer*front(rho,edge,${REVEAL_FEATHER.toFixed(2)});
  float m=texture2D(fillMask,qi,lod).a;
  float shape=front(rho,edge,${REVEAL_FEATHER.toFixed(2)});
  float fillShape=shape*(rho<${FILL_INNER.toFixed(2)}?1.:${FILL_EARLY.toFixed(2)}+${(1 - FILL_EARLY).toFixed(2)}*front(rho,wave,${WAVE_FEATHER.toFixed(2)}));
  vec4 d=min(i*(1.-m)*shape*lines+i*m*fillShape*fill,vec4(1.))*alpha;
  return d+o*(1.-d.a);
}
void main(){
  vec2 q=(v*2.-1.)/${CIRCLE_SPAN.toFixed(5)};
  vec4 c=disc(q,0.);
  float reach=1.;
  if(u<1.){
    float soft=k1.y,bloom=k1.z;
    if(soft>0.||bloom>0.)c=c*(1.-soft)+disc(q,${BLUR_LOD[0].toFixed(1)})*soft*${BLUR_GAIN[0]}+disc(q,${BLUR_LOD[1].toFixed(1)})*(soft*${BLUR_GAIN[1]}+bloom);
    vec2 s=rot(q,-spin)*${(CIRCLE_TEX / 2).toFixed(1)};
    float fade=spark.x;
    if(fade>0.){
      float core=${INNER_R.toFixed(2)}*(.15+.25*spark.y);
      float r=length(s)/core;
      vec4 g=r<.3?mix(vec4(WHITE,1.)*fade,vec4(ICE,1.)*.6*fade,r/.3):mix(vec4(ICE,1.)*.6*fade,vec4(0.),clamp((r-.3)/.7,0.,1.));
      for(int i=0;i<${SPARKS};i++){float d=length(s-sparks[i].xy)/(2.*sparks[i].z);g+=vec4(WHITE,1.)*fade*max(1.-d,0.);}
      c+=g;
    }
    c=min(c*gain,vec4(1.));
    reach=k1.w;
  }
  vec4 m=texture2D(bricks,v);
  vec4 l=m*min(1.,alpha*gain)*reach;
  vec4 b=l+vec4(BRICKDARK,1.)*m.a*max(ground,reach)*(1.-l.a);
  gl_FragColor=c+b*(1.-c.a);
}`;

export function floor(outer: HTMLImageElement, inner: HTMLImageElement, innerFill: HTMLImageElement, anisotropy: number) {
  const { bricks, tex } = floorTextures(outer);
  const opts = { mip: true, anisotropy };
  const sparks = new Float32Array(SPARKS * 3);
  for (let i = 0; i < SPARKS; i++) sparks.set([0, 0, 0.01 * R * (1 + hash(i + 110))], i * 3);
  const material = shader(
    FRAG,
    {
      bricks: { value: texture(bricks, opts) },
      tex: { value: texture(tex, opts) },
      inner: { value: texture(inner, opts) },
      fillMask: { value: texture(innerFill, opts) },
      spin: { value: 0 },
      alpha: { value: 1 },
      u: { value: 1 },
      ground: { value: 1 },
      gain: { value: 1 },
      k0: { value: [0, 0, 1, 1] },
      k1: { value: [1, 0, 0, 1] },
      spark: { value: [0, 0] },
      sparks: { value: sparks },
    },
    OVER,
  );
  const reach = FLOOR.r * EXTENT;
  const mesh = new Mesh(new PlaneGeometry(2 * reach, 2 * reach), material);
  // 平面本来在 xy 里，绕 x 转 90° 躺平：v 朝 +z（镜头这边，画面下方）增大，v=1 是近端。
  mesh.rotation.x = Math.PI / 2;
  mesh.position.set(FLOOR.x, FLOOR.y, 0);
  mesh.renderOrder = 0;
  return {
    mesh,
    // unfold 是展开进度（召唤时、平时重新点亮时），1 就是完整法阵；alpha 是法阵亮度；砖地暗底不低于 ground（召唤时 0、平时 1）。
    update(spin: number, alpha: number, unfold: number, ground: number) {
      const u = material.uniforms;
      u.spin.value = spin;
      u.alpha.value = alpha;
      u.u.value = unfold;
      u.ground.value = ground;
      u.gain.value = 1;
      if (unfold >= 1) return;
      const t = unfold * FLOOR_UNFOLD_S;
      u.gain.value = at(GAIN, t);
      const edge = at(REVEAL, t);
      u.k0.value = [edge, at(WAVE, t), at(LINES, t), at(FILL, t)];
      u.k1.value = [at(OUTER, t), at(BLUR, t), at(BLOOM, t), Math.max(0, Math.min(1, (INNER_R * edge) / R))];
      // 进度 0 是还没开始（召唤白闪里、平时熄灭的暗场），光团要等进度动了才亮。
      const fade = smooth(0, 0.02, unfold) * (1 - smooth(0.1, SPARK_S, t));
      const spark = 1 - (1 - Math.min(1, t / SPARK_S)) ** 3;
      u.spark.value = [fade, spark];
      for (let i = 0; i < SPARKS; i++) {
        const a = hash(i + 70) * TAU;
        const dist = INNER_R * (0.1 + 0.5 * hash(i + 90)) * spark;
        sparks[i * 3] = Math.cos(a) * dist;
        sparks[i * 3 + 1] = Math.sin(a) * dist;
      }
    },
  };
}
