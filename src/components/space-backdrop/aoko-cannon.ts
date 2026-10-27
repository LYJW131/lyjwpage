import { Group } from "three";

import { CYCLE, FIRE, type FxState } from "./aoko-fx";
import { COLORS, channels, plane, quads, shader } from "./aoko-gl";
import { SCENE, hash, smooth } from "./aoko-paint";

// 掌心光炮照剧场版最终预告开头复刻（源：docs/references.md），节奏与形状沿用 PR #722 在参考帧上量的：
// 时间都相对 aoko-fx.ts 的 FIRE（since < 0 是发射前）；参考帧 24fps：f19 点亮、f24 长满、f37 发射，换成秒就是 LIGHT、GROWN。
const LIGHT = 0.75;
const GROWN = 0.55;
// 掌心在立绘原图里的位置；原图画好的蓝色球在 aoko-fx.ts 的 ORB（掌根），这里是光炮的炮口。
export const MUZZLE = [339, 298] as const;
const R = 70;
const TAU = Math.PI * 2;
// 动画「一拍二」的翻滚：轮廓每 1/12 秒换一次。
const BOIL_S = 1 / 12;
// 参考 f37–f40 的光线大致朝这几个方向（y 朝下），每发再随机偏一点。
const RAYS = [-1.25, -0.4, 0.06, 0.45, 1.1, 2.05, 2.8, -2.55];
// 射出后整组光线绕光点顺时针转、越转越慢：参考 f37→f41 朝上那条从 -78° 转到 -49°，即 0.17 秒约 27°。
const SPIN = 3.3;
const SPIN_EASE_S = 0.35;
// 参考 f41 光线射出约 0.17 秒后才扩出那圈环，出现时半径约两个手掌宽。
const RING_AT = 0.14;
// 减少动态效果时停在长满手掌那一刻，不留半截点亮。
const STILL_SINCE = -0.3;
const LOBES = 9;

export const cannonSince = ({ t, still }: FxState) => (still ? STILL_SINCE : (t % CYCLE) - FIRE);

// 光团照在手上的强度：长满手掌时为 1，发射那一下再亮一截，半秒内退掉。
export function palmLight(at: number) {
  if (at < -LIGHT) return 0;
  if (at < 0) return 0.3 + 0.7 * smooth(-LIGHT, -GROWN, at);
  return (1 - smooth(0, 0.5, at)) * (1 + 0.5 * Math.exp(-at * 10));
}

// 云团一样的鼓包轮廓：参考帧里光团边缘是圆鼓的，不是尖刺。
function lobes(seed: number, rough: number, out: Float32Array) {
  for (let i = 0; i < LOBES; i++) {
    out[i * 2] = ((i + hash(seed * 13 + i) * 0.5) / LOBES) * TAU;
    out[i * 2 + 1] = 1 + (hash(seed * 31 + i) - 0.5) * rough;
  }
  return out;
}
const BILLOW = `float billow(vec2 p,float r,vec2 l[${LOBES}]){
  vec2 q=vec2(p.x/1.25,p.y/.85);float a=atan(q.y,q.x);if(a<0.)a+=${TAU.toFixed(6)};
  float k=l[${LOBES - 1}].y,k0=l[${LOBES - 1}].y,a0=l[${LOBES - 1}].x-${TAU.toFixed(6)};
  for(int i=0;i<${LOBES};i++){if(a>=a0&&a<l[i].x){float s=(a-a0)/max(l[i].x-a0,.001);k=mix(k0,l[i].y,s*s*(3.-2.*s));}a0=l[i].x;k0=l[i].y;}
  if(a>=a0){float s=(a-a0)/max(l[0].x+${TAU.toFixed(6)}-a0,.001);k=mix(k0,l[0].y,s*s*(3.-2.*s));}
  return smoothstep(1.5,-1.5,length(q)-r*k);
}`;
// 光团本体边上仍要够亮，鼓包轮廓才看得出。size 是本体半径，四边形半边 3·size。
const BLOB = `${COLORS}uniform float size,e;uniform vec2 outer[${LOBES}],inner[${LOBES}];varying vec2 v;
${BILLOW}
void main(){
  vec2 p=(v*2.-1.)*size*3.;
  float r=length(p);
  float g=r/(size*3.);
  vec4 c=g<.35?mix(vec4(PALE,1.)*.2,vec4(BRICK,1.)*.12,g/.35):mix(vec4(BRICK,1.)*.12,vec4(0.),clamp((g-.35)/.65,0.,1.));
  c*=e;
  float b=r/(size*1.2);
  vec4 body=b<.5?mix(vec4(WHITE,1.),vec4(WHITE,1.)*.9,b/.5):mix(vec4(WHITE,1.)*.9,vec4(PALE,1.)*.75,clamp((b-.5)/.5,0.,1.));
  c+=body*e*billow(p,size,outer)+vec4(WHITE,1.)*e*billow(p,size*.5,inner);
  float streak=step(abs(p.y),1.)*step(abs(p.x),size*1.7)*(1.-abs(p.x)/(size*1.7))*.6*e;
  gl_FragColor=c+vec4(WHITE,1.)*streak;
}`;
const GLOW = `${COLORS}uniform float a;varying vec2 v;void main(){float r=length(v*2.-1.);gl_FragColor=(r<.3?mix(vec4(WHITE,1.)*a,vec4(WHITE,1.)*.7*a,r/.3):mix(vec4(WHITE,1.)*.7*a,vec4(CORE,1.)*0.,clamp((r-.3)/.7,0.,1.)));}`;
const RAY = `void main(){float w=1.-v.x;float m=smoothstep(w+.08,w-.08,abs(v.y*2.-1.));float a=v.x<.5?mix(1.,.7,v.x*2.):mix(.7,0.,v.x*2.-1.);gl_FragColor=vec4(q.rgb,1.)*q.a*a*m;}`;
// 扩散环：宽 18 的蓝晕叠宽 3 的白线；r 和宽度单位都是原图像素。
const RING = `${COLORS}uniform float r,a,span;varying vec2 v;void main(){float d=abs(length((v*2.-1.)*span)-r);gl_FragColor=(vec4(SKY,1.)*.4*smoothstep(9.,7.,d)+vec4(WHITE,1.)*.9*smoothstep(1.5,.5,d))*a;}`;
const BLOOM = `${COLORS}uniform float a;varying vec2 v;void main(){gl_FragColor=vec4(WHITE,1.)*a*(1.-min(length(v*2.-1.),1.));}`;

export function cannon(order: number) {
  const group = new Group();
  const outer = new Float32Array(LOBES * 2);
  const inner = new Float32Array(LOBES * 2);
  const blob = plane(2, 2, shader(BLOB, { size: { value: R }, e: { value: 0 }, outer: { value: outer }, inner: { value: inner } }), order);
  const core = plane(60, 60, shader(GLOW, { a: { value: 0 } }), order + 1);
  const rays = quads(RAYS.length * 2, RAY, {}, order + 2);
  const span = 1000;
  const ring = plane(2 * span, 2 * span, shader(RING, { r: { value: 0 }, a: { value: 0 }, span: { value: span } }), order + 3);
  const bloom = plane(1280, 1280, shader(BLOOM, { a: { value: 0 } }), order + 4);
  group.add(blob, core, rays.mesh, ring, bloom);
  const sky = channels(SCENE.sky);
  const white = channels(SCENE.white);

  return {
    group,
    // x, y 是炮口跟着手层摆动后的位置；show 是前景整层的渐显。
    update({ flash, t, still }: FxState, at: number, x: number, y: number, show: number) {
      group.position.set(x, y, 0);
      group.visible = at >= -LIGHT && show > 0;
      if (!group.visible) return;
      const fired = at >= 0;
      const tick = still ? 0 : Math.floor(t / BOIL_S);
      lobes(tick, 0.75, outer);
      lobes(tick + 7, 0.8, inner);
      const grow = smooth(-LIGHT, -GROWN, at);
      const size = fired ? R * (0.6 - 0.2 * smooth(0, 0.1, at)) : (14 + (R - 14) * grow * grow) * (still ? 1 : 1 + 0.03 * Math.sin(t * 9));
      const e = fired ? 1 - smooth(0, 0.3, at) : 0.75 + 0.25 * grow;
      blob.scale.setScalar(size * 3);
      blob.material.uniforms.size.value = size;
      blob.material.uniforms.e.value = e * show;
      core.visible = fired;
      core.material.uniforms.a.value = flash * show;

      rays.begin();
      const lit = fired && flash > 0.01;
      if (lit) {
        const shot = Math.round(t - at);
        const reach = 0.75 + 0.25 * smooth(0, 0.08, at);
        const a = Math.min(1, flash * 1.6) * show;
        const turn = SPIN * SPIN_EASE_S * (1 - Math.exp(-at / SPIN_EASE_S));
        RAYS.forEach((base, i) => {
          const angle = base + turn + (hash(shot * 8 + i) - 0.5) * 0.25;
          const len = (300 + hash(shot * 8 + i + 0.5) * 450) * reach;
          const [c, s] = [Math.cos(angle), Math.sin(angle)];
          for (const [w, color, alpha] of [[12, sky, 0.35], [3.2, white, 1]] as const) {
            const h = w / 2;
            rays.add(
              [
                [h * s, -h * c],
                [len * c + h * s, len * s - h * c],
                [len * c - h * s, len * s + h * c],
                [-h * s, h * c],
              ],
              [...color, alpha * a],
            );
          }
        });
      }
      rays.end();
      ring.visible = lit;
      ring.material.uniforms.r.value = 200 + 1400 * Math.max(0, at - RING_AT);
      ring.material.uniforms.a.value = smooth(RING_AT, RING_AT + 0.03, at) * (1 - smooth(RING_AT, RING_AT + 0.35, at)) * show;
      bloom.visible = lit;
      bloom.material.uniforms.a.value = 0.35 * flash * show;
    },
  };
}
