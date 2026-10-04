import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { BokehPass } from "three/addons/postprocessing/BokehPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { Reflector } from "three/addons/objects/Reflector.js";

const canvas = document.getElementById("stage");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance", preserveDrawingBuffer: true });
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;
renderer.shadowMap.enabled = false;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0d0c0a);
scene.fog = new THREE.FogExp2(0x0d0c0a, 0.0055);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

const camera = new THREE.PerspectiveCamera(32, 16 / 9, 0.1, 400);

scene.add(new THREE.HemisphereLight(0x3a3833, 0x050505, 0.9));
const key = new THREE.DirectionalLight(0xfff4e6, 1.9); key.position.set(10, 16, 14); scene.add(key);
const fill = new THREE.DirectionalLight(0xd9d4c7, 0.55); fill.position.set(-4, 6, 40); scene.add(fill);
const rim = new THREE.DirectionalLight(0xd9d4c7, 0.9); rim.position.set(-14, 8, -12); scene.add(rim);
const beadLight = new THREE.PointLight(0xe08a5c, 0, 4.5, 2); scene.add(beadLight);

const FLOOR_Y = -8.25;
const floor = new Reflector(new THREE.PlaneGeometry(400, 400), { clipBias: 0.003, textureWidth: 1024, textureHeight: 1024, color: 0x2a2825 });
floor.rotation.x = -Math.PI / 2; floor.position.y = FLOOR_Y; scene.add(floor);
const haze = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshBasicMaterial({ color: 0x0d0c0a, transparent: true, opacity: 0.55, depthWrite: false }));
haze.rotation.x = -Math.PI / 2; haze.position.y = FLOOR_Y + 0.01; scene.add(haze);

const SIGNAL = new THREE.Color(0xe08a5c);
const edgeMat = new THREE.MeshStandardMaterial({ color: 0x3a3732, metalness: 0.9, roughness: 0.32, emissive: SIGNAL, emissiveIntensity: 0 });

function slab(painter, w, h, depth = 0.16) {
  const tex = new THREE.CanvasTexture(painter.canvas);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 16;
  const front = new THREE.MeshPhysicalMaterial({ map: tex, roughness: 0.42, metalness: 0.05, clearcoat: 0.8, clearcoatRoughness: 0.22, envMapIntensity: 1.0, emissive: SIGNAL, emissiveIntensity: 0 });
  const edge = edgeMat.clone();
  const back = new THREE.MeshStandardMaterial({ color: 0x15140f, metalness: 0.6, roughness: 0.5 });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, depth), [edge, edge, edge, edge, front, back]);
  mesh.userData = { painter, tex, front, edge };
  scene.add(mesh);
  return mesh;
}
function repaint(mesh, fn) { mesh.userData.painter.paint(fn); mesh.userData.tex.needsUpdate = true; }
function glow(mesh, k) { mesh.userData.edge.emissiveIntensity = 1.4 * k; }
function dim(mesh, k) { const v = 1 - 0.7 * k; mesh.userData.front.color.setScalar(v); mesh.userData.edge.color.setScalar(0.23 * v + 0.02); }

function rod(a, b, radius = 0.022) {
  const geo = new THREE.TubeGeometry(new THREE.LineCurve3(a, b), 1, radius, 10, false);
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x8a857a, metalness: 0.95, roughness: 0.3 }));
  scene.add(mesh);
  return mesh;
}
const glowMat = new THREE.MeshStandardMaterial({ color: SIGNAL, emissive: SIGNAL, emissiveIntensity: 2.6, roughness: 0.6 });
function glowRod(a, b, radius = 0.034) {
  const mesh = new THREE.Mesh(new THREE.TubeGeometry(new THREE.LineCurve3(a, b), 1, radius, 10, false), glowMat);
  scene.add(mesh);
  return mesh;
}
function setRod(mesh, a, b, radius = 0.034) {
  mesh.geometry.dispose();
  mesh.geometry = new THREE.TubeGeometry(new THREE.LineCurve3(a, b), 1, radius, 10, false);
}
const bead = new THREE.Mesh(new THREE.SphereGeometry(0.1, 24, 24), new THREE.MeshStandardMaterial({ color: 0xffe3c8, emissive: 0xffb27a, emissiveIntensity: 3, roughness: 0.3 }));
scene.add(bead);
function setBead(x, y, z, alpha) {
  bead.visible = alpha > 0.01;
  bead.position.set(x, y, z);
  bead.scale.setScalar(Math.max(0.001, alpha));
  beadLight.position.set(x, y + 0.2, z + 0.6);
  beadLight.intensity = 2.5 * alpha;
}
function ring(radius, alpha, y = 0, x = 0, z = 0) {
  const mesh = new THREE.Mesh(new THREE.RingGeometry(radius, radius + 0.06, 96), new THREE.MeshBasicMaterial({ color: SIGNAL, transparent: true, opacity: alpha, side: THREE.DoubleSide, depthWrite: false }));
  mesh.rotation.x = -Math.PI / 2; mesh.position.set(x, y, z);
  return mesh;
}
const fx = new THREE.Group(); scene.add(fx);
function clearFx() { while (fx.children.length) { const c = fx.children.pop(); c.geometry.dispose(); c.material.dispose(); } }

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(1920, 1080), 0.42, 0.35, 1.15);
composer.addPass(bloom);
const bokeh = new BokehPass(scene, camera, { focus: 12, aperture: 0.00022, maxblur: 0.006 });
composer.addPass(bokeh);
const grain = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, uT: { value: 0 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uT; varying vec2 vUv;
    float hash(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
    void main(){
      vec2 d = (vUv - 0.5);
      float ca = 0.0012 * dot(d, d) * 4.0;
      vec3 c;
      c.r = texture2D(tDiffuse, vUv + d * ca).r;
      c.g = texture2D(tDiffuse, vUv).g;
      c.b = texture2D(tDiffuse, vUv - d * ca).b;
      float v = smoothstep(1.4, 0.45, length(d * vec2(1.0, 1.15)));
      c *= mix(0.74, 1.0, v);
      c += (hash(floor(vUv * vec2(1920.0, 1080.0)) + uT) - 0.5) * 0.028;
      gl_FragColor = vec4(c, 1.0);
    }`,
});
composer.addPass(grain);
composer.addPass(new OutputPass());

function resize(w, h, dpr) {
  renderer.setPixelRatio(dpr);
  renderer.setSize(w, h, false);
  composer.setPixelRatio(dpr);
  composer.setSize(w, h);
  camera.aspect = w / h; camera.updateProjectionMatrix();
}
function look(px, py, pz, tx, ty, tz, fov = 32) {
  camera.position.set(px, py, pz);
  camera.lookAt(tx, ty, tz);
  camera.fov = fov; camera.updateProjectionMatrix();
  bokeh.uniforms.focus.value = camera.position.distanceTo(new THREE.Vector3(tx, ty, tz));
}
function project(x, y, z) {
  const v = new THREE.Vector3(x, y, z).project(camera);
  return [(v.x + 1) / 2 * 1920, (1 - v.y) / 2 * 1080];
}
function render(t) { grain.uniforms.uT.value = (Math.floor(t * 60) % 1000) * 0.37; composer.render(); }

export const S = { THREE, scene, camera, renderer, slab, repaint, glow, dim, rod, glowRod, setRod, setBead, bead, ring, fx, clearFx, resize, look, project, render, FLOOR_Y, SIGNAL, bloom };
