import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  ClampToEdgeWrapping,
  CustomBlending,
  DoubleSide,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  NoColorSpace,
  OneFactor,
  OneMinusSrcAlphaFactor,
  PlaneGeometry,
  ShaderMaterial,
  Texture,
  type IUniform,
  type Object3D,
} from "three";

import { SCENE } from "./aoko-paint";

// 场景里的坐标一律是立绘原图像素、y 朝下（aoko-stage.ts 的根节点把 y 翻过来），z 朝镜头。
// 颜色不做色彩管理：贴图和着色器输出都按原样的 sRGB 数值、预乘透明，与 2D 画布的合成结果对得上。

// 2D 画布的 lighter：预乘颜色与透明度都直接相加。
export const LIGHTER = {
  transparent: true,
  depthTest: false,
  depthWrite: false,
  side: DoubleSide,
  blending: CustomBlending,
  blendSrc: OneFactor,
  blendDst: OneFactor,
  blendSrcAlpha: OneFactor,
  blendDstAlpha: OneFactor,
} as const;
// 2D 画布的 source-over（预乘）。
export const OVER = { ...LIGHTER, blendDst: OneMinusSrcAlphaFactor, blendDstAlpha: OneMinusSrcAlphaFactor } as const;

// aoko-fx.json 的颜色拆成 0–1 的三个分量；COLORS 是着色器里按名字取的常量（SKY、WHITE…）。
export const channels = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
export const COLORS = Object.entries(SCENE)
  .map(([name, hex]) => `const vec3 ${name.toUpperCase()}=vec3(${channels(hex).map((c) => c.toFixed(4)).join(",")});`)
  .join("\n");

export const VERT = `varying vec2 v;void main(){v=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;

type Source = HTMLImageElement | HTMLCanvasElement;
// mip 是缩小显示的发光线稿（法阵、符文）用的：透视压扁和 2 倍屏缩小时不闪；立绘按原尺寸采样不要 mip，免得糊。
export function texture(src: Source, { premultiply = true, mip = false, anisotropy = 1 } = {}) {
  const tex = src instanceof HTMLCanvasElement ? new CanvasTexture(src) : new Texture(src);
  tex.colorSpace = NoColorSpace;
  tex.flipY = false;
  tex.premultiplyAlpha = premultiply;
  tex.generateMipmaps = mip;
  tex.minFilter = mip ? LinearMipmapLinearFilter : LinearFilter;
  tex.magFilter = LinearFilter;
  tex.wrapS = tex.wrapT = ClampToEdgeWrapping;
  tex.anisotropy = anisotropy;
  tex.needsUpdate = true;
  return tex;
}

export function shader(fragmentShader: string, uniforms: Record<string, IUniform>, blend: typeof LIGHTER | typeof OVER = LIGHTER) {
  return new ShaderMaterial({ vertexShader: VERT, fragmentShader, uniforms, ...blend });
}

// 贴图正方形法阵：边长 2r/RIM（与 aoko-paint.ts 的 circle 同一个约定）。
const SPRITE = `uniform sampler2D map;uniform float alpha;varying vec2 v;void main(){gl_FragColor=texture2D(map,v)*alpha;}`;
export function sprite(map: Texture, size: number, order: number) {
  const mesh = new Mesh(new PlaneGeometry(size, size), shader(SPRITE, { map: { value: map }, alpha: { value: 1 } }));
  mesh.renderOrder = order;
  return mesh as Mesh<PlaneGeometry, ShaderMaterial>;
}

export const plane = (w: number, h: number, material: ShaderMaterial, order: number) => {
  const mesh = new Mesh(new PlaneGeometry(w, h), material);
  mesh.renderOrder = order;
  return mesh;
};

// 一批每帧改位置的四边形（光丝、散景、星点、毛刺）：一次绘制，片元拿到格内坐标 v（0–1）和每格的参数 p。
export function quads(count: number, fragmentShader: string, uniforms: Record<string, IUniform> = {}, order = 0) {
  const geometry = new BufferGeometry();
  const pos = new Float32Array(count * 12);
  const par = new Float32Array(count * 16);
  const uv = new Float32Array(count * 8);
  const index = new Uint16Array(count * 6);
  for (let i = 0; i < count; i++) {
    uv.set([0, 0, 1, 0, 1, 1, 0, 1], i * 8);
    index.set([0, 1, 2, 0, 2, 3].map((k) => k + i * 4), i * 6);
  }
  const position = new BufferAttribute(pos, 3);
  const params = new BufferAttribute(par, 4);
  geometry.setAttribute("position", position);
  geometry.setAttribute("p", params);
  geometry.setAttribute("uv", new BufferAttribute(uv, 2));
  geometry.setIndex(new BufferAttribute(index, 1));
  const material = new ShaderMaterial({
    vertexShader: `attribute vec4 p;varying vec2 v;varying vec4 q;void main(){v=uv;q=p;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    fragmentShader: `varying vec2 v;varying vec4 q;${fragmentShader}`,
    uniforms,
    ...LIGHTER,
  });
  const mesh = new Mesh(geometry, material);
  mesh.renderOrder = order;
  mesh.frustumCulled = false;
  let n = 0;
  return {
    mesh,
    material,
    begin() {
      n = 0;
    },
    // 四个角按 v=(0,0)(1,0)(1,1)(0,1) 的顺序给。
    add(corners: readonly (readonly [number, number])[], p: readonly number[], z = 0) {
      if (n >= count) return;
      corners.forEach(([x, y], k) => pos.set([x, y, z], n * 12 + k * 3));
      for (let k = 0; k < 4; k++) par.set(p, n * 16 + k * 4);
      n++;
    },
    rect(x: number, y: number, w: number, h: number, p: readonly number[]) {
      this.add(
        [
          [x, y],
          [x + w, y],
          [x + w, y + h],
          [x, y + h],
        ],
        p,
      );
    },
    end() {
      geometry.setDrawRange(0, n * 6);
      position.needsUpdate = true;
      params.needsUpdate = true;
    },
  };
}

export const dispose = (root: Object3D) =>
  root.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    o.geometry.dispose();
    const material = o.material as ShaderMaterial;
    for (const u of Object.values(material.uniforms ?? {})) if (u.value instanceof Texture) u.value.dispose();
    material.dispose();
  });
