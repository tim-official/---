// Живое небо: звёзды с реальной цветовой температурой, Млечный Путь,
// вращение вокруг полюса под широтой Алматы (43.2°), падающие звёзды.
import * as THREE from '../vendor/three.module.js';

const LAT = 43.2;
const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const small = window.innerWidth < 700;

function init() {
    const canvas = document.getElementById('sky');
    if (!canvas) return;

    let renderer;
    try {
        renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true, powerPreference: 'high-performance' });
    } catch (e) {
        return; // без WebGL остаётся CSS-фон
    }
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    renderer.setPixelRatio(dpr);
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    renderer.setClearColor(0x000000, 0);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 1, 3000);
    scene.add(camera);

    // Небесная сфера: наклон оси мира = широта места
    const tilt = new THREE.Group();
    tilt.rotation.x = -THREE.MathUtils.degToRad(90 - LAT);
    const celestial = new THREE.Group();
    tilt.add(celestial);
    scene.add(tilt);

    const uniforms = { uTime: { value: 0 }, uPixel: { value: dpr }, uBoost: { value: 0 } };

    const material = new THREE.ShaderMaterial({
        uniforms,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        vertexShader: /* glsl */`
            attribute float size;
            attribute float phase;
            attribute float alpha;
            attribute vec3 tint;
            uniform float uTime;
            uniform float uPixel;
            uniform float uBoost;
            varying vec3 vColor;
            varying float vAlpha;
            void main() {
                float speed = 0.5 + fract(phase * 7.13) * 2.2;
                float tw = 0.72 + 0.28 * sin(uTime * speed + phase * 6.2831);
                vColor = tint;
                vAlpha = alpha * tw * (1.0 + uBoost * 0.8);
                gl_PointSize = size * uPixel * (0.88 + 0.12 * tw) * (1.0 + uBoost * 0.25);
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }`,
        fragmentShader: /* glsl */`
            varying vec3 vColor;
            varying float vAlpha;
            void main() {
                float d = length(gl_PointCoord - 0.5);
                if (d > 0.5) discard;
                float core = smoothstep(0.5, 0.0, d);
                float halo = exp(-d * d * 16.0);
                float a = (core * core * 0.95 + halo * 0.3) * vAlpha;
                gl_FragColor = vec4(vColor * a, a);
            }`
    });

    // Цвета звёзд по спектральным классам (O/B голубые … K/M оранжевые)
    const SPECTRA = [
        [[0.63, 0.74, 1.00], 0.08], [[0.80, 0.86, 1.00], 0.17], [[1.00, 1.00, 1.00], 0.30],
        [[1.00, 0.96, 0.86], 0.22], [[1.00, 0.86, 0.66], 0.15], [[1.00, 0.73, 0.52], 0.08]
    ];
    function spectral() {
        let r = Math.random();
        for (const [c, w] of SPECTRA) { if ((r -= w) <= 0) return c; }
        return SPECTRA[2][0];
    }
    function gauss() { return (Math.random() + Math.random() + Math.random() + Math.random() - 2) / 2; }

    function makePoints(count, place) {
        const pos = new Float32Array(count * 3), col = new Float32Array(count * 3);
        const size = new Float32Array(count), phase = new Float32Array(count), alpha = new Float32Array(count);
        const v = new THREE.Vector3();
        for (let i = 0; i < count; i++) {
            const s = place(v, i);
            pos.set([v.x, v.y, v.z], i * 3);
            col.set(s.c, i * 3);
            size[i] = s.size; alpha[i] = s.a; phase[i] = Math.random();
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        g.setAttribute('tint', new THREE.BufferAttribute(col, 3));
        g.setAttribute('size', new THREE.BufferAttribute(size, 1));
        g.setAttribute('phase', new THREE.BufferAttribute(phase, 1));
        g.setAttribute('alpha', new THREE.BufferAttribute(alpha, 1));
        return new THREE.Points(g, material);
    }

    const R = 1000;
    const k = small ? 0.55 : 1;

    // 1. Поле звёзд: много слабых, мало ярких (как распределение по звёздной величине)
    celestial.add(makePoints(Math.round(7000 * k), (v) => {
        v.randomDirection().multiplyScalar(R);
        const m = Math.pow(Math.random(), 4.2);
        return { c: spectral(), size: 1.2 + m * 7.5, a: 0.35 + m * 0.65 };
    }));

    // 2. Млечный Путь: плотная полоса вдоль большого круга с ядром
    const bandNormal = new THREE.Vector3(0.35, 0.85, 0.4).normalize();
    const bandU = new THREE.Vector3().crossVectors(bandNormal, new THREE.Vector3(0, 0, 1)).normalize();
    const bandV = new THREE.Vector3().crossVectors(bandNormal, bandU).normalize();
    function bandPoint(v, spread) {
        const lon = Math.random() * Math.PI * 2;
        const core = Math.exp(-Math.pow(Math.atan2(Math.sin(lon - 1.1), Math.cos(lon - 1.1)), 2) * 1.4);
        const off = gauss() * spread * (0.7 + core * 0.9);
        v.copy(bandU).multiplyScalar(Math.cos(lon)).addScaledVector(bandV, Math.sin(lon)).addScaledVector(bandNormal, off).normalize().multiplyScalar(R * 0.98);
        return core;
    }
    celestial.add(makePoints(Math.round(16000 * k), (v) => {
        const core = bandPoint(v, 0.11);
        const warm = Math.random() < 0.35 + core * 0.3;
        return { c: warm ? [1.0, 0.9, 0.78] : [0.82, 0.9, 1.0], size: 0.9 + Math.random() * 1.8, a: 0.18 + core * 0.35 + Math.random() * 0.15 };
    }));

    // 3. Газовые облака вдоль полосы: крупные мягкие пятна
    const NEB = [[0.25, 0.55, 0.55], [0.55, 0.42, 0.33], [0.32, 0.36, 0.55], [0.6, 0.3, 0.25]];
    celestial.add(makePoints(small ? 60 : 120, (v) => {
        const core = bandPoint(v, 0.07);
        return { c: NEB[Math.floor(Math.random() * NEB.length)], size: 70 + Math.random() * 160, a: 0.05 + core * 0.07 };
    }));

    // Падающие звёзды (в системе камеры)
    const meteors = [];
    function spawnMeteor() {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
        g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(6), 3));
        const line = new THREE.Line(g, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
        const z = -400, h = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * -z, w = h * camera.aspect;
        const start = new THREE.Vector3(THREE.MathUtils.randFloat(-w * 0.2, w * 0.95), THREE.MathUtils.randFloat(h * 0.1, h * 0.85), z);
        const dir = new THREE.Vector3(-THREE.MathUtils.randFloat(0.7, 1), -THREE.MathUtils.randFloat(0.25, 0.55), 0).normalize();
        camera.add(line);
        meteors.push({ line, start, dir, t: 0, life: THREE.MathUtils.randFloat(0.7, 1.15), len: THREE.MathUtils.randFloat(h * 0.35, h * 0.6) });
    }
    function updateMeteors(dt) {
        for (let i = meteors.length - 1; i >= 0; i--) {
            const m = meteors[i];
            m.t += dt;
            const p = m.t / m.life;
            if (p >= 1) { camera.remove(m.line); m.line.geometry.dispose(); m.line.material.dispose(); meteors.splice(i, 1); continue; }
            const ease = 1 - Math.pow(1 - p, 2);
            const head = m.start.clone().addScaledVector(m.dir, m.len * 2.2 * ease);
            const tail = head.clone().addScaledVector(m.dir, -m.len * Math.min(1, p * 2.5));
            const pos = m.line.geometry.attributes.position.array;
            pos.set([head.x, head.y, head.z, tail.x, tail.y, tail.z]);
            const fade = p < 0.15 ? p / 0.15 : 1 - (p - 0.15) / 0.85;
            const col = m.line.geometry.attributes.color.array;
            col.set([fade, fade * 0.95, fade * 0.88, 0, 0, 0]);
            m.line.geometry.attributes.position.needsUpdate = true;
            m.line.geometry.attributes.color.needsUpdate = true;
        }
    }

    // Управление со стороны страницы
    let scroll = 0, boost = 0;
    const mouse = { x: 0, y: 0 }, look = { x: 0, y: 0 };
    window.matrixSky = {
        setScroll(p) { scroll = p; },
        celebrate() { boost = 1; for (let i = 0; i < 3; i++) setTimeout(spawnMeteor, i * 260); }
    };
    window.addEventListener('pointermove', (e) => {
        mouse.x = (e.clientX / window.innerWidth - 0.5) * 2;
        mouse.y = (e.clientY / window.innerHeight - 0.5) * 2;
    }, { passive: true });

    function resize() {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight, false);
        if (reduce) renderer.render(scene, camera);
    }
    window.addEventListener('resize', resize);

    // Начальный ракурс: смотрим на юг, чуть вверх
    camera.rotation.order = 'YXZ';
    celestial.rotation.y = 2.2;

    const clock = new THREE.Clock();
    let nextMeteor = 3;
    function frame() {
        requestAnimationFrame(frame);
        if (document.hidden) return;
        const dt = Math.min(clock.getDelta(), 0.05), t = clock.elapsedTime;
        uniforms.uTime.value = t;
        boost += (0 - boost) * dt * 1.2;
        uniforms.uBoost.value = boost;
        celestial.rotation.y += dt * (0.0045 + boost * 0.05);   // суточное вращение неба (ускорено)
        look.x += (mouse.x - look.x) * dt * 1.5;
        look.y += (mouse.y - look.y) * dt * 1.5;
        camera.rotation.y = -look.x * 0.06;
        camera.rotation.x = 0.32 - look.y * 0.04 + scroll * 0.5;
        if (t > nextMeteor) { spawnMeteor(); nextMeteor = t + THREE.MathUtils.randFloat(3.5, 8); }
        updateMeteors(dt);
        renderer.render(scene, camera);
    }

    if (reduce) {
        camera.rotation.order = 'YXZ';
        camera.rotation.x = 0.32;
        renderer.render(scene, camera);
        window.matrixSky.setScroll = () => {};
        window.matrixSky.celebrate = () => {};
    } else {
        frame();
    }
}

init();
