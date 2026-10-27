import { ColorManagement, Group, type Object3D, LinearSRGBColorSpace, Mesh, NoToneMapping, PerspectiveCamera, PlaneGeometry, Scene, ShaderMaterial, Vector2, WebGLRenderer, WebGLRenderTarget } from "three";

import { EXTENT, FLOOR } from "./aoko-fx";
import { bloom } from "./aoko-bloom";
import { OVER } from "./aoko-gl";

// 相机由地面法阵的投影反推：原来的 2D 条带就是针孔投影（近端横向放大 1/(1−depth·v)、纵向偏移 k·(放大−1)），
// 对上之后镜头在法阵圆心正前方 DIST 远、高度在原图 y=EYE_Y（正是她眼睛的高度），z=0 平面上一个原图像素正好映到立绘的一个像素。
// 所以平面的东西（立绘、身后光环、电弧）和原来逐像素对齐，地面、手臂环这些立体的东西按真透视画。
const REACH = FLOOR.r * EXTENT;
export const DIST = REACH / FLOOR.depth;
export const EYE_X = FLOOR.x;
export const EYE_Y = FLOOR.y - (REACH * FLOOR.tilt) / FLOOR.depth;

// 立体的东西放到深度 z 时，沿视线挪回去，保证它在画面上还落在原图的 (x, y)：返回位置和要乘的缩放。
export function atDepth(x: number, y: number, z: number): [number, number, number, number] {
  const k = (DIST - z) / DIST;
  return [EYE_X + (x - EYE_X) * k, EYE_Y + (y - EYE_Y) * k, z, k];
}

export type View = { left: number; ox: number; oy: number; scale: number; dpr: number };

// three 构造 WebGL2 失败会直接抛错，返回 null 交给调用方退回 2D。
export function stage(canvas: HTMLCanvasElement) {
  ColorManagement.enabled = false;
  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer({ canvas, alpha: true, premultipliedAlpha: true, antialias: false, powerPreference: "low-power" });
  } catch {
    return null;
  }
  renderer.outputColorSpace = LinearSRGBColorSpace;
  renderer.toneMapping = NoToneMapping;
  renderer.setClearColor(0x000000, 0);
  // 着色器编译或链接失败 three 只打日志不抛错，记下来让调用方退回 2D。
  let failed = false;
  renderer.debug.onShaderError = (g, _p, vs, fs) => {
    console.error("aoko: shader failed", g.getShaderInfoLog(vs), g.getShaderInfoLog(fs));
    failed = true;
  };
  // 子节点都按原图像素写（y 朝下），根节点把 y 翻成 three 的朝上。
  const flipped = () => {
    const scene = new Scene();
    const root = new Group();
    root.scale.y = -1;
    scene.add(root);
    return { scene, root };
  };
  // 两层：底层（地面、身后光环、立绘）直接画到画布；前景（手臂环、电弧、光球）先在离屏缓冲里叠加，再整张按 source-over 盖上去。
  // 这和原来前景单独一张 2D 画布的合成一样：光叠得越亮，底下的立绘被压得越多，而不是直接加亮。
  const base = flipped();
  const fore = flipped();
  const layer = new WebGLRenderTarget(1, 1, { samples: 4 });
  const blit = new Scene();
  const quad = new Mesh(
    new PlaneGeometry(2, 2),
    new ShaderMaterial({
      vertexShader: `varying vec2 v;void main(){v=uv;gl_Position=vec4(position.xy,0.,1.);}`,
      // 泛光按叠加光算：透明度也跟着涨，和前景层自己的 lighter 一样。
      fragmentShader: `uniform sampler2D map,glow;uniform float k;varying vec2 v;
void main(){vec4 c=texture2D(map,v)+texture2D(glow,v)*k;c.a=max(c.a,max(c.r,max(c.g,c.b)));gl_FragColor=min(c,vec4(1.));}`,
      uniforms: { map: { value: layer.texture }, glow: { value: null }, k: { value: 0 } },
      ...OVER,
    }),
  );
  quad.frustumCulled = false;
  blit.add(quad);
  const glow = bloom(renderer);
  const size = new Vector2();
  const camera = new PerspectiveCamera();
  camera.position.set(EYE_X, -EYE_Y, DIST);
  camera.updateMatrixWorld();

  return {
    renderer,
    root: base.root,
    fore: fore.root,
    anisotropy: renderer.capabilities.getMaxAnisotropy(),
    failed: () => failed,
    // 画布铺在页面 [left, left+width] × [0, height]（CSS 像素），原图 (0,0) 落在 (ox, oy)，一个原图像素 scale 个 CSS 像素。
    layout({ left, ox, oy, scale, dpr }: View, width: number, height: number) {
      renderer.setPixelRatio(dpr);
      renderer.setSize(width, height, false);
      renderer.getDrawingBufferSize(size);
      layer.setSize(size.x, size.y);
      glow.setSize(size.x, size.y);
      const near = 10;
      const k = near / DIST;
      const L = (left - ox) / scale - EYE_X;
      const R = (left + width - ox) / scale - EYE_X;
      const T = -oy / scale - EYE_Y;
      const B = (height - oy) / scale - EYE_Y;
      camera.projectionMatrix.makePerspective(L * k, R * k, -T * k, -B * k, near, DIST * 3);
      camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
    },
    // 先把所有着色器编好：光炮的光线、扩散环平时不显示，three 只编可见的，第一次发射时现编会卡一下。
    warm() {
      for (const { scene } of [base, fore]) {
        const hidden: Object3D[] = [];
        scene.traverse((o) => {
          if (!o.visible) hidden.push(o);
          o.visible = true;
        });
        renderer.compile(scene, camera);
        for (const o of hidden) o.visible = false;
      }
    },
    // strength 是泛光强度（0 不糊）。
    render(strength: number) {
      renderer.setRenderTarget(layer);
      renderer.render(fore.scene, camera);
      quad.material.uniforms.k.value = strength;
      if (strength > 0) quad.material.uniforms.glow.value = glow.render(layer.texture);
      renderer.setRenderTarget(null);
      renderer.render(base.scene, camera);
      renderer.autoClear = false;
      renderer.render(blit, camera);
      renderer.autoClear = true;
    },
    dispose() {
      layer.dispose();
      glow.dispose();
      quad.geometry.dispose();
      quad.material.dispose();
      renderer.dispose();
    },
  };
}
