import { CylinderGeometry, DoubleSide, Group, Matrix4, Mesh, MeshBasicMaterial, PlaneGeometry, ShaderMaterial, SphereGeometry, Vector3, type Texture } from "three";

import { BOLT_H, BOLT_W, BOLT_X, BOLT_Y, ORB, type FxState } from "./aoko-fx";
import { cannon, cannonSince, MUZZLE } from "./aoko-cannon";
import { ARM_BOX, PALM } from "./aoko-figure";
import { COLORS, LIGHTER, VERT, plane, quads, shader, texture } from "./aoko-gl";
import { RIM, hash, smooth } from "./aoko-paint";
import { ARM_AXIS, ARM_SPOTS, FOREARM, GAPS, JAG_ARCS, JAG_POINTS, RING_SQUASH, SHARD, glints, jags, ringGaps, type HandPose } from "./aoko-rings";
import { atDepth } from "./aoko-stage";

// 立绘前面的一层：手臂三环、电弧、星点、光球。都是叠加光，前景整层在召唤显形的末段才渐显（show）。

// 前臂在三维里的走向：画面上沿 ARM_AXIS，往画面里斜，环面法线朝镜头的分量就是椭圆开口 RING_SQUASH。手腕近、肘远。
const AXIS = new Vector3(Math.cos(ARM_AXIS) * Math.sqrt(1 - RING_SQUASH ** 2), Math.sin(ARM_AXIS) * Math.sqrt(1 - RING_SQUASH ** 2), -RING_SQUASH);
const ARM_LEN = Math.hypot(FOREARM.to[0] - FOREARM.from[0], FOREARM.to[1] - FOREARM.from[1]) / Math.sqrt(1 - RING_SQUASH ** 2);
// 前臂中点在 z=0，手腕在镜头这边。
const depthAlong = (at: number) => -AXIS.z * ARM_LEN * (0.5 - at);
// 环的局部 x 是环面里朝镜头翻起来的那个方向（画面上投成沿前臂、压扁），y 是画面里垂直前臂的方向。
const E1 = new Vector3(RING_SQUASH * Math.cos(ARM_AXIS), RING_SQUASH * Math.sin(ARM_AXIS), Math.sqrt(1 - RING_SQUASH ** 2));
const E2 = new Vector3(-Math.sin(ARM_AXIS), Math.cos(ARM_AXIS), 0);
const RING_BASIS = new Matrix4().makeBasis(E1, E2, E1.clone().cross(E2));
const TAU = Math.PI * 2;

// 碎环：本体在断口处缺一块；断口后那一小段碎片往外错开、略转，单独再采一次。角度在环自己转动的坐标里。
const RING_FRAG = `uniform sampler2D map;uniform float alpha,hr;uniform vec4 gap[${GAPS * 2}];varying vec2 v;
float inArc(float a,float lo,float hi){return step(mod(a-lo,${TAU.toFixed(6)}),hi-lo);}
void main(){
  vec2 p=(v*2.-1.)*hr;
  float a=atan(p.y,p.x);
  float cut=0.;
  vec4 c=vec4(0.);
  for(int j=0;j<${GAPS};j++){
    vec4 g=gap[j*2];vec4 h=gap[j*2+1];
    float shard=${SHARD}*g.z;
    cut=max(cut,inArc(a,g.x,g.y+shard));
    if(g.z<.02)continue;
    float mid=g.y+shard*.5;
    vec2 o=p-vec2(cos(mid),sin(mid))*g.w;
    float r=-h.x;o=vec2(cos(r)*o.x-sin(r)*o.y,sin(r)*o.x+cos(r)*o.y);
    vec2 uv=o/hr*.5+.5;
    c+=texture2D(map,uv)*inArc(atan(o.y,o.x),g.y,g.y+shard)*step(0.,uv.x)*step(uv.x,1.)*step(0.,uv.y)*step(uv.y,1.)*.85;
  }
  c+=texture2D(map,v)*(1.-cut);
  gl_FragColor=c*alpha*1.6;
}`;
const SOLID = `${COLORS}uniform float alpha;void main(){gl_FragColor=vec4(ICE,1.)*alpha;}`;
// 星点：中心一团白光，外加横竖各一道细线（q.x 是半径，单位原图像素）。
const GLINT = `${COLORS}void main(){vec2 p=(v*2.-1.)*q.x;float r=length(p)/(q.x*.5);vec4 dot=mix(vec4(WHITE,1.)*.9,vec4(CORE,1.)*0.,clamp(r,0.,1.));
float line=max(step(abs(p.y),.5),step(abs(p.x),.5))*.8;gl_FragColor=(dot*step(r,1.)+vec4(WHITE,1.)*line)*q.y;}`;
// 电弧贴图是镜头整帧，电弧在帧边被截断；搬到立绘旁边后帧边会露成一条直线，所以四边渐隐。
const BOLT = `uniform sampler2D map;uniform float alpha;varying vec2 v;
void main(){vec2 e=vec2(min(v.x/.12,1.)*min((1.-v.x)/.12,1.),min(v.y/.12,1.)*min((1.-v.y)/.12,1.));gl_FragColor=texture2D(map,v)*alpha*e.x*e.y;}`;
// 径向光：中心 c0，到 m 处 c1，边上 0。
const ORB_FRAG = `${COLORS}uniform float a0,a1;varying vec2 v;void main(){float r=length(v*2.-1.);vec4 c=r<.35?mix(vec4(WHITE,1.)*a0,vec4(CORE,1.)*a1,r/.35):mix(vec4(CORE,1.)*a1,vec4(0.),clamp((r-.35)/.65,0.,1.));gl_FragColor=c;}`;

// 炮口跟着手层摆：与立绘着色器里的 dh、上面的手挡板同一个变换。
export const muzzle = ({ dx, dy, zoom }: HandPose) => [PALM[0] + zoom * (MUZZLE[0] + dx - PALM[0]), PALM[1] + zoom * (MUZZLE[1] + dy - PALM[1])] as const;

type Sprites = Record<"ring" | "octa" | "runes" | "bolt" | "boltFine" | "arm", HTMLImageElement>;

export function front(images: Sprites, anisotropy: number) {
  const group = new Group();
  const opts = { mip: true, anisotropy };

  // 只写深度的挡板：袖子是一根圆柱（两头圆帽），手是一块按手层透明度裁出的平面。环后面那半圈被它们挡住，前面半圈照常亮。
  const hidden = new MeshBasicMaterial({ colorWrite: false, side: DoubleSide });
  const occluders = new Group();
  const wrist = atDepth(FOREARM.from[0], FOREARM.from[1], depthAlong(0));
  const elbow = atDepth(FOREARM.to[0], FOREARM.to[1], depthAlong(1));
  const a = new Vector3(...wrist.slice(0, 3));
  const b = new Vector3(...elbow.slice(0, 3));
  const sleeve = new Mesh(new CylinderGeometry(FOREARM.half, FOREARM.half, a.distanceTo(b), 16, 1, true), hidden);
  sleeve.position.copy(a).add(b).multiplyScalar(0.5);
  sleeve.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), b.clone().sub(a).normalize());
  occluders.add(sleeve);
  for (const end of [a, b]) {
    const cap = new Mesh(new SphereGeometry(FOREARM.half, 16, 8), hidden);
    cap.position.copy(end);
    occluders.add(cap);
  }
  const handMat = new ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: `uniform sampler2D map;varying vec2 v;void main(){if(texture2D(map,v).a<.5)discard;gl_FragColor=vec4(0.);}`,
    uniforms: { map: { value: texture(images.arm) } },
    colorWrite: false,
    side: DoubleSide,
  });
  const hand = new Mesh(new PlaneGeometry(ARM_BOX[2], ARM_BOX[3]), handMat);
  occluders.add(hand);
  for (const o of occluders.children) o.renderOrder = -1;
  group.add(occluders);
  const handDepth = depthAlong(0);

  const rings = ARM_SPOTS.map((spot, k) => {
    const [x, y, z, s] = atDepth(spot.x, spot.y, depthAlong(spot.at));
    const holder = new Group();
    holder.position.set(x, y, z);
    holder.quaternion.setFromRotationMatrix(RING_BASIS);
    holder.scale.setScalar(s);
    const squash = new Group();
    holder.add(squash);
    const spin = new Group();
    squash.add(spin);
    const half = spot.r / RIM;
    const gap = new Float32Array(GAPS * 8);
    const material = new ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: RING_FRAG,
      uniforms: { map: { value: texture(images[spot.sprite], opts) }, alpha: { value: 1 }, hr: { value: half }, gap: { value: gap } },
      ...LIGHTER,
      depthTest: true,
    });
    const disc = new Mesh(new PlaneGeometry(2 * half, 2 * half), material);
    disc.renderOrder = 60;
    const jag = quads(JAG_ARCS * (JAG_POINTS - 1), SOLID, { alpha: { value: 1 } }, 61);
    jag.material.depthTest = true;
    spin.add(disc, jag.mesh);
    group.add(holder);
    return { spot, k, squash, spin, material, gap, jag };
  });

  const boltTex = [texture(images.bolt), texture(images.boltFine)];
  const bolts = boltTex.map((map: Texture, i) => {
    const mesh = plane(BOLT_W, BOLT_H, shader(BOLT, { map: { value: map }, alpha: { value: 0 } }), 62 + i);
    mesh.position.set(BOLT_X + BOLT_W / 2, BOLT_Y + BOLT_H / 2, 0);
    return mesh;
  });
  group.add(...bolts);

  const stars = quads(8, GLINT, {}, 64);
  group.add(stars.mesh);

  // 原图画好的蓝球上常亮的一团光；蓄力和发射交给掌心光炮，这团不跟着涨。
  const orb = plane(92, 92, shader(ORB_FRAG, { a0: { value: 0.3 }, a1: { value: 0.18 } }), 65);
  orb.position.set(ORB[0], ORB[1], 0);
  const gun = cannon(66);
  group.add(orb, gun.group);

  return {
    group,
    update(state: FxState, pose: HandPose, show: number) {
      const { power, flash, t, still } = state;
      // 手层摆动跟 aoko-figure.ts 着色器里的 dh 同一套：平移 d，再以掌心为中心放大 zoom。
      const [hx, hy] = [PALM[0] + pose.zoom * (ARM_BOX[0] + ARM_BOX[2] / 2 + pose.dx - PALM[0]), PALM[1] + pose.zoom * (ARM_BOX[1] + ARM_BOX[3] / 2 + pose.dy - PALM[1])];
      const [x, y, z, s] = atDepth(hx, hy, handDepth);
      hand.position.set(x, y, z);
      hand.scale.setScalar(pose.zoom * s);

      for (const { spot, k, squash, spin, material, gap, jag } of rings) {
        squash.scale.set(1 - 0.4 * flash, 1 + 0.1 * flash, 1);
        spin.rotation.z = t * spot.spin;
        const alpha = Math.min(1, 0.55 + 0.45 * smooth(0.1 + 0.15 * k, 0.5 + 0.15 * k, power) + 0.4 * flash) * show;
        material.uniforms.alpha.value = alpha;
        ringGaps(k, t).forEach((g, j) => {
          const push = spot.r * g.open * (0.08 + 0.025 * Math.sin(t * 9 + j * 2 + k));
          gap.set([g.at, g.end, g.open, push, 0.06 * g.open * Math.sin(t * 7 + j), 0, 0, 0], j * 8);
        });
        jag.material.uniforms.alpha.value = alpha * 0.9;
        jag.begin();
        for (const arc of jags(k, spot.r, t)) {
          for (let i = 1; i < arc.length; i++) {
            const [x0, y0] = arc[i - 1];
            const [x1, y1] = arc[i];
            const len = Math.hypot(x1 - x0, y1 - y0);
            const [nx, ny] = [((y0 - y1) / len) * 0.9, ((x1 - x0) / len) * 0.9];
            jag.add(
              [
                [x0 + nx, y0 + ny],
                [x1 + nx, y1 + ny],
                [x1 - nx, y1 - ny],
                [x0 - nx, y0 - ny],
              ],
              [0, 0, 0, 0],
            );
          }
        }
        jag.end();
      }

      // 闲置时电弧每几秒噼啪一阵，蓄力起持续闪；闪烁按 70ms 一格取随机亮度。
      const win = Math.floor(t / 3.2);
      const burst = (t % 3.2) - hash(win) * 2.4;
      const gate = still ? 0.7 : Math.max(burst > 0 && burst < 0.45 ? 1 : 0, smooth(0.15, 0.4, power));
      const tick = Math.floor(t / 0.07);
      const ba = gate * (still ? 1 : hash(tick) > 0.25 ? 0.5 + 0.5 * hash(tick + 0.5) : 0.15);
      const bb = gate * (still ? 0.8 : hash(tick + 3) > 0.4 ? 0.6 + 0.4 * hash(tick + 9) : 0);
      bolts[0].material.uniforms.alpha.value = ba * (0.6 + 0.4 * power) * show;
      bolts[1].material.uniforms.alpha.value = bb * show;

      stars.begin();
      for (const g of glints(t)) {
        if (g.size <= 0) continue;
        stars.rect(g.x - g.size, g.y - g.size, 2 * g.size, 2 * g.size, [g.size, (0.5 + 0.5 * power) * Math.sin(Math.PI * g.life) * show, 0, 0]);
      }
      stars.end();

      orb.material.uniforms.a0.value = 0.3 * show;
      orb.material.uniforms.a1.value = 0.18 * show;
      const [mx, my] = muzzle(pose);
      gun.update(state, cannonSince(state), mx, my, show);
    },
  };
}
