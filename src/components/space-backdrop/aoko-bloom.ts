import { HalfFloatType, Mesh, NoBlending, OrthographicCamera, PlaneGeometry, Scene, ShaderMaterial, UnsignedByteType, Vector2, WebGLRenderTarget, type Texture, type WebGLRenderer } from "three";

// 前景光的泛光：手臂环、电弧、光炮这一层先降到 1/2、1/4…1/32 逐级模糊，再逐级放大叠回来（dual Kawase），
// 远处那几级糊得最开，光炮发射时照亮半个画面靠的就是它。只糊前景层：人物、地面不进来，脸和白衬衫不发光。
const LEVELS = 5;
const QUAD_VERT = `varying vec2 v;void main(){v=uv;gl_Position=vec4(position.xy,0.,1.);}`;
const DOWN = `uniform sampler2D map;uniform vec2 px;varying vec2 v;
void main(){vec4 s=texture2D(map,v)*4.;s+=texture2D(map,v-px)+texture2D(map,v+px)+texture2D(map,v+vec2(px.x,-px.y))+texture2D(map,v-vec2(px.x,-px.y));gl_FragColor=s/8.;}`;
const UP = `uniform sampler2D map,add;uniform vec2 px;varying vec2 v;
void main(){vec4 s=texture2D(map,v+vec2(-px.x*2.,0.))+texture2D(map,v+vec2(px.x*2.,0.))+texture2D(map,v+vec2(0.,-px.y*2.))+texture2D(map,v+vec2(0.,px.y*2.));
s+=(texture2D(map,v+px)+texture2D(map,v-px)+texture2D(map,v+vec2(px.x,-px.y))+texture2D(map,v-vec2(px.x,-px.y)))*2.;gl_FragColor=s/12.+texture2D(add,v);}`;

export function bloom(renderer: WebGLRenderer) {
  const float = renderer.extensions.has("EXT_color_buffer_float") || renderer.extensions.has("EXT_color_buffer_half_float");
  const target = () => new WebGLRenderTarget(1, 1, { type: float ? HalfFloatType : UnsignedByteType, depthBuffer: false });
  const down = Array.from({ length: LEVELS }, target);
  const up = Array.from({ length: LEVELS - 1 }, target);
  const pass = (fragmentShader: string) =>
    new ShaderMaterial({ vertexShader: QUAD_VERT, fragmentShader, uniforms: { map: { value: null }, add: { value: null }, px: { value: new Vector2() } }, blending: NoBlending, depthTest: false, depthWrite: false });
  const downMat = pass(DOWN);
  const upMat = pass(UP);
  const quad = new Mesh(new PlaneGeometry(2, 2), downMat);
  quad.frustumCulled = false;
  const scene = new Scene().add(quad);
  const camera = new OrthographicCamera();
  const run = (material: ShaderMaterial, map: Texture, src: WebGLRenderTarget | Vector2, out: WebGLRenderTarget, add?: Texture) => {
    quad.material = material;
    material.uniforms.map.value = map;
    material.uniforms.add.value = add ?? null;
    const w = src instanceof Vector2 ? src.x : src.width;
    const h = src instanceof Vector2 ? src.y : src.height;
    material.uniforms.px.value.set(1 / w, 1 / h);
    renderer.setRenderTarget(out);
    renderer.render(scene, camera);
  };
  const full = new Vector2();

  return {
    setSize(w: number, h: number) {
      full.set(w, h);
      down.forEach((rt, i) => rt.setSize(Math.max(1, Math.round(w / 2 ** (i + 1))), Math.max(1, Math.round(h / 2 ** (i + 1)))));
      up.forEach((rt, i) => rt.setSize(down[i].width, down[i].height));
    },
    // 返回 1/2 分辨率的泛光，在合成时乘强度叠到前景上。
    render(source: Texture) {
      run(downMat, source, full, down[0]);
      for (let i = 1; i < LEVELS; i++) run(downMat, down[i - 1].texture, down[i - 1], down[i]);
      for (let i = LEVELS - 2; i >= 0; i--) run(upMat, (i === LEVELS - 2 ? down[LEVELS - 1] : up[i + 1]).texture, i === LEVELS - 2 ? down[LEVELS - 1] : up[i + 1], up[i], down[i].texture);
      return up[0].texture;
    },
    dispose() {
      for (const rt of [...down, ...up]) rt.dispose();
      quad.geometry.dispose();
      downMat.dispose();
      upMat.dispose();
    },
  };
}
