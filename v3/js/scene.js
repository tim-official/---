// Единая 3D-сцена на всю страницу: стеклянный кристалл-матрица с настоящим
// преломлением, слово за ним, звёзды и пыль. Кадр меняется по мере прокрутки.
import * as THREE from '../vendor/three.module.js';
import { RoomEnvironment } from '../vendor/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from '../vendor/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from '../vendor/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from '../vendor/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from '../vendor/jsm/postprocessing/OutputPass.js';

const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const canvas = document.getElementById('scene');
const BG = new THREE.Color('#04070b');

let renderer;
try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
} catch (e) {
    window.heroFail && window.heroFail('WebGL недоступен: ' + e.message);
    throw e;
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = BG;
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.5;

const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 200);
camera.position.set(0, 0, reduce ? 9.5 : 13);

/* ---------- Кадры: где стоит кристалл и какое слово за ним ---------- */
// [x, y, масштаб] для широкого и узкого экрана
const SHOTS = {
    hero:  { wide: [0, 0, 1],        narrow: [0, 0.85, 0.62], word: 'a' },
    calc:  { wide: [0, 1.72, 0.3], narrow: [0, 1.85, 0.26], word: null },
    none:  { wide: [0, -0.3, 0],     narrow: [0, 0.4, 0],     word: null },
    pause: { wide: [0, 0, 0.95],     narrow: [0, 0.35, 0.62], word: 'b' },
    price: { wide: [2.7, 0.55, 0.7], narrow: [0, 1.55, 0.34], word: null }
};
let shot = 'hero', narrow = false, asleep = false, boost = 0, scrollP = 0;
const cur = { x: 0, y: 0, s: 1 };

/* ---------- Слова за кристаллом ---------- */
const WORD_TINT = new THREE.Color(0.62, 0.6, 0.57);
const words = {};
async function makeWord(key, text, width, narrowScale) {
    // ждём именно фирменный шрифт, иначе холст нарисует запасной с засечками
    for (let i = 0; i < 20 && !document.fonts.check('800 400px Unbounded'); i++) {
        await document.fonts.load('800 400px Unbounded', text);
        if (!document.fonts.check('800 400px Unbounded')) await new Promise((r) => setTimeout(r, 150));
    }
    const c = document.createElement('canvas');
    c.width = 4096; c.height = 1100;
    const x = c.getContext('2d');
    x.font = '800 1000px Unbounded';
    const size = Math.floor(1000 * 3900 / x.measureText(text).width);
    x.font = `800 ${Math.min(size, 900)}px Unbounded`;
    x.fillStyle = '#efe8dc';
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.fillText(text, c.width / 2, c.height / 2 + 30);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    // непрозрачный материал: только такие объекты видны сквозь стекло
    const mat = new THREE.MeshBasicMaterial({ map: tex, alphaTest: 0.5, color: BG.clone(), toneMapped: false });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, width * c.height / c.width), mat);
    mesh.position.z = -2.6;
    mesh.visible = false;
    scene.add(mesh);
    words[key] = { mesh, f: 0, narrowScale };
    if (reduce) renderOnce();
}
makeWord('a', 'СУДЬБА', 12.5, 0.36);
makeWord('b', 'ХАРАКТЕР', 9.3, 0.27);

/* ---------- Кристалл ---------- */
const rig = new THREE.Group();
scene.add(rig);

const profile = [
    new THREE.Vector2(0, -2.05), new THREE.Vector2(0.5, -1.05), new THREE.Vector2(0.98, 0.0),
    new THREE.Vector2(0.86, 0.5), new THREE.Vector2(0.42, 1.05), new THREE.Vector2(0, 1.55)
];
const gemGeo = new THREE.LatheGeometry(profile, 8).toNonIndexed();
gemGeo.computeVertexNormals();
const gem = new THREE.Mesh(gemGeo, new THREE.MeshPhysicalMaterial({
    color: 0xffffff, metalness: 0, roughness: 0.03,
    transmission: 1, thickness: 2.4, ior: 1.78, dispersion: 7,
    attenuationColor: new THREE.Color('#cfeaf0'), attenuationDistance: 3.5,
    clearcoat: 0.5, clearcoatRoughness: 0.08, specularIntensity: 1,
    iridescence: 0.35, iridescenceIOR: 1.35, envMapIntensity: 1.15, flatShading: true
}));
const gemGroup = new THREE.Group();
gemGroup.add(gem);
rig.add(gemGroup);

const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.1, 2), new THREE.MeshBasicMaterial({ color: new THREE.Color('#e0603f').multiplyScalar(6), toneMapped: false }));
gemGroup.add(core);
const coreLight = new THREE.PointLight('#ff8a5c', 6, 5, 2);
gemGroup.add(coreLight);

/* ---------- Кольцо-октаграмма ---------- */
const ring = new THREE.Group();
const ringMat = new THREE.LineBasicMaterial({ color: '#efe8dc', transparent: true, opacity: 0.14 });
for (let q = 0; q < 2; q++) {
    const pts = [];
    for (let k = 0; k <= 4; k++) { const a = q * Math.PI / 4 + k * Math.PI / 2; pts.push(new THREE.Vector3(Math.cos(a) * 2.25, 0, Math.sin(a) * 2.25)); }
    ring.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), ringMat));
}
const circ = [];
for (let i = 0; i <= 128; i++) { const a = i / 128 * Math.PI * 2; circ.push(new THREE.Vector3(Math.cos(a) * 1.6, 0, Math.sin(a) * 1.6)); }
ring.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(circ), new THREE.LineBasicMaterial({ color: '#efe8dc', transparent: true, opacity: 0.1 })));
const nodeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#efe8dc').multiplyScalar(1.15), toneMapped: false });
const nodeHot = new THREE.MeshBasicMaterial({ color: new THREE.Color('#e0603f').multiplyScalar(1.8), toneMapped: false });
for (let k = 0; k < 8; k++) {
    const a = k * Math.PI / 4;
    const n = new THREE.Mesh(new THREE.SphereGeometry(k % 2 ? 0.018 : 0.026, 12, 12), k === 0 ? nodeHot : nodeMat);
    n.position.set(Math.cos(a) * 2.25, 0, Math.sin(a) * 2.25);
    ring.add(n);
}
ring.rotation.set(1.18, 0, -0.1);
rig.add(ring);

/* ---------- Звёзды и пыль ---------- */
const starMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uPixel: { value: renderer.getPixelRatio() } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `
        attribute float size; attribute float phase; attribute vec3 tint;
        uniform float uTime; uniform float uPixel;
        varying vec3 vC; varying float vA;
        void main() {
            float tw = 0.7 + 0.3 * sin(uTime * (0.6 + fract(phase * 9.1) * 2.0) + phase * 6.28);
            vC = tint; vA = tw;
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            gl_PointSize = size * uPixel * (30.0 / -mv.z);
            gl_Position = projectionMatrix * mv;
        }`,
    fragmentShader: `
        varying vec3 vC; varying float vA;
        void main() {
            float d = length(gl_PointCoord - 0.5);
            if (d > 0.5) discard;
            float a = (smoothstep(0.5, 0.0, d) * 0.9 + exp(-d * d * 20.0) * 0.4) * vA;
            gl_FragColor = vec4(vC * a, a);
        }`
});
function points(n, place) {
    const p = new Float32Array(n * 3), s = new Float32Array(n), ph = new Float32Array(n), c = new Float32Array(n * 3);
    const v = new THREE.Vector3();
    for (let i = 0; i < n; i++) { const o = place(v); p.set([v.x, v.y, v.z], i * 3); s[i] = o.s; ph[i] = Math.random(); c.set(o.c, i * 3); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    g.setAttribute('size', new THREE.BufferAttribute(s, 1));
    g.setAttribute('phase', new THREE.BufferAttribute(ph, 1));
    g.setAttribute('tint', new THREE.BufferAttribute(c, 3));
    return new THREE.Points(g, starMat);
}
const TINTS = [[0.7, 0.8, 1], [1, 1, 1], [1, 0.95, 0.85], [1, 0.82, 0.62]];
const stars = points(window.innerWidth < 700 ? 2600 : 5200, (v) => {
    v.set((Math.random() - 0.5) * 90, (Math.random() - 0.5) * 80, -20 - Math.random() * 40);
    const m = Math.pow(Math.random(), 5);
    return { s: 0.35 + m * 2.6, c: TINTS[Math.floor(Math.random() * TINTS.length)].map((x) => x * (0.5 + m * 0.7)) };
});
scene.add(stars);
const dust = points(1100, (v) => {
    const a = Math.random() * Math.PI * 2, r = 1.4 + Math.pow(Math.random(), 0.6) * 3.4;
    v.set(Math.cos(a) * r, (Math.random() - 0.5) * 2.2 * (1.6 / r), Math.sin(a) * r);
    return { s: 0.05 + Math.random() * 0.16, c: [0.85, 0.93, 0.95] };
});
dust.rotation.x = 0.35;
rig.add(dust);

const key = new THREE.DirectionalLight('#fff4e6', 0.9); key.position.set(-4, 5, 6); scene.add(key);
const rim = new THREE.DirectionalLight('#9fd8e6', 1.6); rim.position.set(5, -1, -4); scene.add(rim);

/* ---------- Постобработка ---------- */
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
composer.addPass(new UnrealBloomPass(new THREE.Vector2(1, 1), 0.3, 0.4, 1.05));
composer.addPass(new OutputPass());

/* ---------- Размеры и ввод ---------- */
const mouse = new THREE.Vector2(), look = new THREE.Vector2();
window.addEventListener('pointermove', (e) => { mouse.set(e.clientX / window.innerWidth - 0.5, e.clientY / window.innerHeight - 0.5); }, { passive: true });

function layout() {
    const w = window.innerWidth, h = window.innerHeight;
    narrow = w / h < 0.9;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    if (reduce) renderOnce();
}
window.addEventListener('resize', layout);

function target() { const s = SHOTS[shot] || SHOTS.none; return narrow ? s.narrow : s.wide; }

function apply(k) {
    const [tx, ty, ts] = target();
    cur.x += (tx - cur.x) * k; cur.y += (ty - cur.y) * k; cur.s += (ts - cur.s) * k;
    rig.position.set(cur.x, cur.y, 0);
    rig.scale.setScalar(Math.max(cur.s, 0.0001));
    rig.visible = cur.s > 0.02;
    const active = (SHOTS[shot] || SHOTS.none).word;
    for (const key in words) {
        const w = words[key];
        w.f += ((key === active ? 1 : 0) - w.f) * k;
        w.mesh.visible = w.f > 0.015;
        w.mesh.material.color.copy(BG).lerp(WORD_TINT, w.f);
        w.mesh.scale.setScalar(narrow ? w.narrowScale : 1);
        w.mesh.position.y = (narrow ? cur.y : 0) + 0.1 + (1 - w.f) * -0.6;
        w.mesh.position.x = -look.x * 0.5;
    }
}

function draw(t) {
    gem.rotation.y = t * (0.22 + boost * 2.2);
    gemGroup.position.y = Math.sin(t * 0.6) * 0.08;
    gemGroup.rotation.x = look.y * 0.25;
    gemGroup.rotation.z = 0.12 - look.x * 0.2;
    core.scale.setScalar(1 + Math.sin(t * 1.7) * 0.18 + boost * 1.6);
    coreLight.intensity = 5 + Math.sin(t * 1.7) * 1.5 + boost * 30;
    ring.rotation.y = -t * 0.06;
    dust.rotation.y = t * 0.035;
    stars.position.y = scrollP * 14;
    starMat.uniforms.uTime.value = t;
    camera.position.x = look.x * 0.6;
    camera.position.y = -look.y * 0.35;
    camera.lookAt(0, 0, 0);
    composer.render();
    if (!window.heroOK) { window.heroOK = true; document.documentElement.classList.add('is-3d'); }
}

function renderOnce() { apply(1); draw(2); }

const timer = new THREE.Timer();
function frame(ts) {
    requestAnimationFrame(frame);
    timer.update(ts);
    if (asleep || document.hidden) return;
    const dt = Math.min(timer.getDelta(), 0.05);
    look.lerp(mouse, dt * 2.2);
    boost += (0 - boost) * dt * 1.6;
    camera.position.z += (9.5 - camera.position.z) * dt * 0.9;
    apply(1 - Math.exp(-dt * 3.2));
    draw(timer.getElapsed());
}

/* ---------- Управление со страницы ---------- */
window.scene3d = {
    to(name) { if (SHOTS[name]) { shot = name; if (reduce) renderOnce(); } },
    sleep(v) { asleep = v; },
    scroll(p) { scrollP = p; },
    celebrate() { boost = 1; }
};
window.dispatchEvent(new Event('scene3d-ready'));

layout();
if (reduce) renderOnce(); else requestAnimationFrame(frame);
