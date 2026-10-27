import { Group, type Mesh, type PlaneGeometry, type ShaderMaterial } from "three";

import { FLOOR, RING_R, RING_SWELL, RING_SWELL_S, RING_X, RING_Y, RUNE_R, type FxState, type Reveal } from "./aoko-fx";
import { COLORS, channels, plane, quads, shader, sprite, texture } from "./aoko-gl";
import { BOKEH, RIM, hash } from "./aoko-paint";
import { floor } from "./aoko-floor";

// 立绘身后的一层：地面法阵、往上飘的光丝、散景、竖直的大光环（img0628）。
// 顺序照原来 2D 背景画布：地面先画（source-over），其余都是叠加光。

const THREAD = `${COLORS}void main(){gl_FragColor=vec4(THREAD,1.)*q.x*(1.-v.y);}`;
const BOKEH_FRAG = `void main(){float r=length(v*2.-1.);float a=r<.7?mix(1.,.7,r/.7):mix(.7,0.,clamp((r-.7)/.3,0.,1.));gl_FragColor=vec4(q.rgb,1.)*q.a*a;}`;
const HALO = `${COLORS}uniform float a;varying vec2 v;void main(){float r=length(v*2.-1.)*1.2;float k=clamp((r-.8)/.38,0.,1.);gl_FragColor=vec4(SKY,1.)*a*(1.-abs(k*2.-1.))*step(.8,r)*step(r,1.18);}`;
const LINE = `${COLORS}uniform float a;varying vec2 v;void main(){gl_FragColor=vec4(WHITE,1.)*a*(1.-abs(v.x*2.-1.));}`;

const BOKEH_RGB = BOKEH.map(channels);

export function back(images: Record<"band" | "runes" | "floorOuter" | "floorInner", HTMLImageElement>, anisotropy: number) {
  const group = new Group();
  const ground = floor(images.floorOuter, images.floorInner, anisotropy);
  group.add(ground.mesh);

  const threads = quads(16, THREAD, {}, 1);
  const bokeh = quads(10, BOKEH_FRAG, {}, 2);
  group.add(threads.mesh, bokeh.mesh);

  const ring = new Group();
  ring.position.set(RING_X, RING_Y, 0);
  group.add(ring);
  const halo = plane(RING_R * 2.4, RING_R * 2.4, shader(HALO, { a: { value: 0 } }), 3);
  const opts = { mip: true, anisotropy };
  const bandTex = texture(images.band, opts);
  const band = sprite(bandTex, (2 * RING_R) / RIM, 4);
  const band2 = sprite(bandTex, (2 * RING_R) / RIM, 5);
  const runes = sprite(texture(images.runes, opts), (2 * RUNE_R) / 0.96 / RIM, 6);
  const lines = [0, Math.PI / 2].map((angle) => {
    const line = plane(2 * RING_R, 1.5, shader(LINE, { a: { value: 0 } }), 7);
    line.rotation.z = angle;
    return line;
  });
  ring.add(halo, band, band2, runes, ...lines);
  const alpha = (mesh: Mesh<PlaneGeometry, ShaderMaterial>, a: number) => {
    mesh.material.uniforms[mesh.material.uniforms.alpha ? "alpha" : "a"].value = a;
  };

  return {
    group,
    update({ power, flash, t }: FxState, show: Reveal) {
      ground.update(t * 0.03, 0.8 + 0.2 * power, show.floor);

      threads.begin();
      for (let i = 0; i < 16; i++) {
        const p = (t * (0.08 + hash(i) * 0.1) + hash(i + 40)) % 1;
        const x = FLOOR.x + (hash(i + 7) * 2 - 1) * FLOOR.r * 0.8;
        const y0 = FLOOR.y + (hash(i + 13) - 0.5) * FLOOR.r * FLOOR.tilt - p * 900;
        const h = 120 + hash(i + 21) * 360;
        // 渐变在 v.y=0（下端）最亮，所以从下往上排四个角。
        threads.add(
          [
            [x - 1.5, y0],
            [x + 1.5, y0],
            [x + 1.5, y0 - h],
            [x - 1.5, y0 - h],
          ],
          [Math.sin(Math.PI * p) * (0.18 + 0.3 * power) * show.ring, 0, 0, 0],
        );
      }
      threads.end();

      bokeh.begin();
      for (let i = 0; i < 10; i++) {
        const x = -180 + hash(i + 3) * 1300;
        const y = 900 - ((hash(i + 9) * 1500 + t * (6 + hash(i) * 8)) % 1500);
        const r = 10 + hash(i + 5) * 26;
        const a = (0.1 + 0.18 * hash(i + 11)) * (0.6 + 0.4 * Math.sin(t * 0.9 + i * 2.1));
        bokeh.rect(x - r, y - r, 2 * r, 2 * r, [...BOKEH_RGB[i % 4], a * show.ring]);
      }
      bokeh.end();

      // img0628 的亮环接近白青、外侧带一圈蓝晕：贴图本身偏青，叠两遍再垫一圈光晕。
      const glow = 0.6 + 0.4 * power + 0.3 * flash;
      const swell = 0.5 - 0.5 * Math.cos((t / RING_SWELL_S) * Math.PI * 2);
      ring.scale.setScalar(1 + RING_SWELL * swell);
      alpha(halo, (0.16 + 0.22 * power + 0.04 * swell) * show.ring);
      band.rotation.z = band2.rotation.z = t * 0.04;
      alpha(band, Math.min(1, glow) * show.ring);
      alpha(band2, Math.min(1, glow * 0.55) * show.ring);
      runes.rotation.z = -t * 0.07;
      alpha(runes, Math.min(1, glow) * show.ring);
      // 在光环以内、往两头淡掉，画到环外硬收尾就像一道划痕。
      for (const line of lines) alpha(line, (0.16 + 0.3 * power + 0.4 * flash) * show.ring);
    },
  };
}
