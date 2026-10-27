import { Mesh, PlaneGeometry } from "three";

import { EXTENT, FLOOR } from "./aoko-fx";
import { OVER, shader, texture } from "./aoko-gl";
import { RIM, SCENE, circle, smooth, tone } from "./aoko-paint";

// 脚下的地面法阵就是 img0609（俯视）里那面：外圈 img0640（符文带、星形弦线、印章环）套内盘 img1627（旋刃、中心四枚印章、粗亮边），
// 底下是被法阵照成紫色的砖地。现在是一块真的水平面，透视、近大远小由 aoko-stage.ts 的相机给。
const BRICK_TEX = 1280;
const BRICK_R = BRICK_TEX / 2 / EXTENT;
// 法阵单独一张纹理，边长与 floor-outer 贴图一致（须与 scripts/aoko-fx-assets.ts 同步）。砖地是柔和的渐变和砖缝，低一档的分辨率就够。
const CIRCLE_TEX = 1600;
const R = (CIRCLE_TEX / 2) * RIM;
// img0640 圈内 0.43 R 以内是空的，img0609 里内盘的粗亮边正好贴着这一圈。
const INNER_R = 0.43 * R;
// 法阵纹理在砖地坐标里占的半宽（砖地半宽记作 1）。
const CIRCLE_SPAN = 1 / (EXTENT * RIM);

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

// 外圈随 spin 转、内盘以 1.6 倍反转；法阵叠在砖地上（source-over），整块再乘 show。
const FRAG = `uniform sampler2D bricks,tex,inner;uniform float spin,alpha,show;varying vec2 v;
float inside(vec2 u){return step(0.,u.x)*step(u.x,1.)*step(0.,u.y)*step(u.y,1.);}
vec2 rot(vec2 p,float a){float c=cos(a),s=sin(a);return vec2(c*p.x-s*p.y,s*p.x+c*p.y);}
void main(){
  vec2 q=(v*2.-1.)/${CIRCLE_SPAN.toFixed(5)};
  vec2 qt=rot(q,-spin)*.5+.5;
  vec4 c=texture2D(tex,qt)*inside(qt)*alpha;
  vec2 qi=rot(q,1.6*spin)*${(CIRCLE_TEX / 2 / (INNER_R / RIM)).toFixed(5)}*.5+.5;
  vec4 i=texture2D(inner,qi)*inside(qi)*alpha;
  c=i+c*(1.-i.a);
  vec4 b=texture2D(bricks,v);
  gl_FragColor=(c+b*(1.-c.a))*show;
}`;

export function floor(outer: HTMLImageElement, inner: HTMLImageElement, anisotropy: number) {
  const { bricks, tex } = floorTextures(outer);
  const opts = { mip: true, anisotropy };
  const material = shader(
    FRAG,
    {
      bricks: { value: texture(bricks, opts) },
      tex: { value: texture(tex, opts) },
      inner: { value: texture(inner, opts) },
      spin: { value: 0 },
      alpha: { value: 1 },
      show: { value: 1 },
    },
    OVER,
  );
  const reach = FLOOR.r * EXTENT;
  const mesh = new Mesh(new PlaneGeometry(2 * reach, 2 * reach), material);
  // 平面本来在 xy 里，绕 x 转 90° 躺平：v 朝 +z（镜头这边，画面下方）增大，和原来条带里 v=+1 是近端一致。
  mesh.rotation.x = Math.PI / 2;
  mesh.position.set(FLOOR.x, FLOOR.y, 0);
  mesh.renderOrder = 0;
  return {
    mesh,
    update(spin: number, alpha: number, show: number) {
      const u = material.uniforms;
      u.spin.value = spin;
      u.alpha.value = alpha;
      u.show.value = show;
    },
  };
}
