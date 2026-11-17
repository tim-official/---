// Логика страницы: расчёт матрицы и знака, отрисовка карты, анимации.
import { ARCANA, ZODIAC } from './data.js';

const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const { gsap, ScrollTrigger, SplitText, ScrambleTextPlugin, DrawSVGPlugin } = window;
const hasGsap = Boolean(gsap);
if (hasGsap) gsap.registerPlugin(ScrollTrigger, SplitText, ScrambleTextPlugin, DrawSVGPlugin);

const SVGNS = 'http://www.w3.org/2000/svg';
const $ = (s, r = document) => r.querySelector(s);

/* ---------------- Расчёт ---------------- */
function reduceArcana(n) {
    if (n <= 0) return 22;
    while (n > 22) n = String(n).split('').reduce((a, d) => a + Number(d), 0);
    return n;
}
function digitSum(n) { return String(n).split('').reduce((a, d) => a + Number(d), 0); }

function calcMatrix(day, month, year) {
    const A = reduceArcana(day);
    const B = reduceArcana(month);
    const V = reduceArcana(digitSum(year));
    const G = reduceArcana(A + B + V);
    const D = reduceArcana(A + B + V + G);
    return {
        A, B, V, G, D,
        E: reduceArcana(A + B), Zh: reduceArcana(B + V), I: reduceArcana(V + G), Z: reduceArcana(A + G),
        Ain: reduceArcana(A + D), Bin: reduceArcana(B + D), Vin: reduceArcana(V + D), Gin: reduceArcana(G + D)
    };
}

function zodiacFor(day, month) {
    const md = month * 100 + day;
    return ZODIAC.find((z) => {
        const [fd, fm] = z.from.split('.').map(Number), [td, tm] = z.to.split('.').map(Number);
        const from = fm * 100 + fd, to = tm * 100 + td;
        return from <= to ? md >= from && md <= to : md >= from || md <= to;
    });
}

function parseDate(d, m, y) {
    const day = Number(d), month = Number(m), year = Number(y);
    const now = new Date();
    if (!day || !month || !year || String(y).length !== 4) return { error: 'Введите дату полностью: день, месяц и четыре цифры года.' };
    if (month < 1 || month > 12) return { error: 'Месяц должен быть от 01 до 12.' };
    const dim = new Date(year, month, 0).getDate();
    if (day < 1 || day > dim) return { error: `В этом месяце ${dim} дней. Проверьте день.` };
    if (year < 1900 || new Date(year, month - 1, day) > now) return { error: 'Проверьте год: дата не может быть в будущем или раньше 1900.' };
    return { day, month, year };
}

/* ---------------- SVG-помощники ---------------- */
function el(tag, attrs = {}, parent) {
    const n = document.createElementNS(SVGNS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
}
function html(tag, cls, text, parent) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    if (parent) parent.appendChild(n);
    return n;
}

/* ---------------- Карта матрицы ---------------- */
const P = {
    A: [10, 150], B: [150, 10], V: [290, 150], G: [150, 290],
    E: [51, 51], Zh: [249, 51], I: [249, 249], Z: [51, 249],
    Ain: [80, 150], Bin: [150, 80], Vin: [220, 150], Gin: [150, 220], D: [150, 150]
};
function hornPath(x, y, sx, sy) {
    // стилизованный рог барана (қошқар мүйіз) в углу квадрата
    const p = (dx, dy) => `${x + dx * sx},${y + dy * sy}`;
    return `M${p(0, 0)} C${p(0, -16)} ${p(-18, -22)} ${p(-24, -10)} C${p(-28, -1)} ${p(-17, 4)} ${p(-13, -3)} C${p(-10, -8)} ${p(-15, -12)} ${p(-18, -9)}`;
}

function drawChart(svg, v) {
    svg.textContent = '';
    const defs = el('defs', {}, svg);
    const rg = el('radialGradient', { id: 'coreGlow' }, defs);
    el('stop', { offset: '0%', 'stop-color': '#f2ede4', 'stop-opacity': '.35' }, rg);
    el('stop', { offset: '100%', 'stop-color': '#f2ede4', 'stop-opacity': '0' }, rg);

    const lines = el('g', {}, svg);
    el('circle', { cx: 150, cy: 150, r: 99, class: 'c-line-soft draw' }, lines);
    el('line', { x1: 10, y1: 150, x2: 290, y2: 150, class: 'c-line-soft draw' }, lines);
    el('line', { x1: 150, y1: 10, x2: 150, y2: 290, class: 'c-line-soft draw' }, lines);
    el('line', { x1: 51, y1: 51, x2: 249, y2: 249, class: 'c-line-soft draw' }, lines);
    el('line', { x1: 249, y1: 51, x2: 51, y2: 249, class: 'c-line-soft draw' }, lines);
    el('polygon', { points: '150,10 290,150 150,290 10,150', class: 'c-line draw' }, lines);
    el('polygon', { points: '51,51 249,51 249,249 51,249', class: 'c-line draw' }, lines);
    [[51, 51, 1, 1], [249, 51, -1, 1], [249, 249, -1, -1], [51, 249, 1, -1]].forEach(([x, y, sx, sy]) =>
        el('path', { d: hornPath(x, y, -sx, sy), class: 'c-orn draw' }, lines));

    el('circle', { cx: 150, cy: 150, r: 46, class: 'c-glow' }, svg);

    const labels = el('g', {}, svg);
    [['личность', 10, 122, 'middle'], ['таланты', 150, -22, 'middle'], ['задача', 290, 122, 'middle'], ['род', 150, 322, 'middle']]
        .forEach(([t, x, y, a]) => { const n = el('text', { x, y, class: 'c-label', 'text-anchor': a, 'dominant-baseline': 'central' }, labels); n.textContent = t; });

    const nodes = el('g', {}, svg);
    const order = ['A', 'B', 'V', 'G', 'E', 'Zh', 'I', 'Z', 'Ain', 'Bin', 'Vin', 'Gin', 'D'];
    order.forEach((key) => {
        const [x, y] = P[key];
        const isCore = key === 'D', isKey = ['A', 'B', 'V', 'G'].includes(key), r = isCore ? 24 : isKey ? 16 : 13;
        const g = el('g', { class: 'c-node' + (isCore ? ' is-core' : isKey ? ' is-key' : ''), transform: `translate(${x} ${y})` }, nodes);
        el('circle', { r }, g);
        const t = el('text', { 'data-v': v[key] }, g);
        t.textContent = v[key];
    });
    return svg;
}

/* ---------------- Расшифровка ---------------- */
const READ_ORDER = [
    ['D', 'Суть · центр'], ['A', 'Личность · день'], ['B', 'Таланты · месяц'], ['V', 'Задача · год'], ['G', 'Опыт рода · сумма']
];
function renderReadings(root, v) {
    root.textContent = '';
    READ_ORDER.forEach(([key, label]) => {
        const a = ARCANA[v[key]];
        const card = html('article', 'reading', null, root);
        html('span', 'reading-n', String(v[key]), card);
        html('p', 'reading-k', label, card);
        html('h3', null, a.name, card);
        html('p', null, a.desc, card);
        const d = html('p', 'do', null, card);
        html('b', null, 'Действие на неделю', d);
        d.appendChild(document.createTextNode(a.practice));
    });
}

function drawSign(svg, z) {
    svg.textContent = '';
    const pts = z.stars.map(([x, y]) => [12 + x * 176, 8 + y * 104]);
    el('polyline', { points: pts.map((p) => p.join(',')).join(' '), class: 's-line draw' }, svg);
    pts.forEach(([x, y], i) => el('circle', { cx: x, cy: y, r: i % 3 === 0 ? 2.6 : 1.8, class: 's-star' }, svg));
}

/* ---------------- Зодиакальный круг ---------------- */
function drawWheel(svg) {
    svg.textContent = '';
    const g = el('g', { id: 'wheelRot' }, svg);
    el('circle', { r: 150, class: 'w-ring' }, g);
    el('circle', { r: 112, class: 'w-ring' }, g);
    el('circle', { r: 64, class: 'w-ring' }, g);
    ZODIAC.forEach((z, i) => {
        const a0 = (i * 30 - 90) * Math.PI / 180, a1 = ((i + 1) * 30 - 90) * Math.PI / 180, am = (a0 + a1) / 2;
        const arc = (r) => [Math.cos(a0) * r, Math.sin(a0) * r, Math.cos(a1) * r, Math.sin(a1) * r];
        const [x0, y0, x1, y1] = arc(150), [x2, y2, x3, y3] = arc(112);
        el('path', { d: `M${x0},${y0} A150,150 0 0 1 ${x1},${y1} L${x3},${y3} A112,112 0 0 0 ${x2},${y2} Z`, class: 'w-sector', 'data-i': i }, g);
        el('line', { x1: Math.cos(a0) * 64, y1: Math.sin(a0) * 64, x2: x0, y2: y0, class: 'w-tick' }, g);
        const gx = Math.cos(am) * 131, gy = Math.sin(am) * 131;
        const t = el('text', { x: gx, y: gy, class: 'w-glyph', transform: `rotate(${i * 30 + 15} ${gx} ${gy})` }, g);
        t.textContent = z.glyph + '︎';
        const nx = Math.cos(am) * 90, ny = Math.sin(am) * 90;
        const n = el('text', { x: nx, y: ny, class: 'w-name', transform: `rotate(${i * 30 + 15} ${nx} ${ny})` }, g);
        n.textContent = z.name;
    });
    const c1 = el('text', { y: -2, class: 'w-center', id: 'wheelSign' }, svg); c1.textContent = '12 знаков';
    const c2 = el('text', { y: 14, class: 'w-center-sub', id: 'wheelSub' }, svg); c2.textContent = '4 стихии';
}

/* ---------------- Шаги метода ---------------- */
function fillSteps(day, month, year, v) {
    const map = {
        dd: String(day), A: v.A, mm: String(month), B: v.B,
        yy: String(year).split('').join('+'), V: v.V,
        abv: `${v.A}+${v.B}+${v.V}`, G: v.G, abvg: `${v.A}+${v.B}+${v.V}+${v.G}`, D: v.D
    };
    document.querySelectorAll('.step-calc b[data-k]').forEach((b) => { b.textContent = map[b.dataset.k]; });
}

/* ---------------- Показ результата ---------------- */
function showResult(day, month, year) {
    const v = calcMatrix(day, month, year);
    const z = zodiacFor(day, month);
    const dStr = `${String(day).padStart(2, '0')}.${String(month).padStart(2, '0')}.${year}`;
    const core = ARCANA[v.D];

    $('#resultMeta').textContent = `Ваша карта · ${dStr} · ${z.name}`;
    $('#coreName').textContent = `аркан ${v.D}, «${core.name}»`;
    $('#coreDesc').textContent = `${core.desc} Ниже — пять опорных точек вашей матрицы и что с ними делать.`;
    drawChart($('#chart'), v);
    renderReadings($('#readings'), v);
    drawSign($('#signSky'), z);
    $('#signMeta').textContent = `${z.from} — ${z.to} · ${z.element}`;
    $('#signName').textContent = z.name;
    $('#signTrait').textContent = `${z.trait}. Знак описывает манеру проявляться, а матрица — то, с чем вы работаете.`;
    fillSteps(day, month, year, v);
    document.querySelectorAll('.w-sector').forEach((s) => s.classList.toggle('is-you', Number(s.dataset.i) === ZODIAC.indexOf(z)));
    $('#wheelSign').textContent = z.name;
    $('#wheelSub').textContent = `${z.element} · ваш знак`;

    const section = $('#result');
    section.hidden = false;
    if (window.matrixSky) window.matrixSky.celebrate();

    if (!hasGsap || reduce) { section.scrollIntoView(); return; }
    ScrollTrigger.refresh();
    if (window.lenis) window.lenis.scrollTo(section, { offset: -40, duration: 1.6 }); else section.scrollIntoView({ behavior: 'smooth' });

    const tl = gsap.timeline({ delay: 0.5 });
    tl.from('#result .result-head > *', { y: 30, autoAlpha: 0, stagger: 0.12, duration: 0.9, ease: 'power3.out' })
      .fromTo('#chart .draw', { drawSVG: '0%' }, { drawSVG: '100%', duration: 1.6, stagger: 0.06, ease: 'power2.inOut' }, '<0.2')
      .from('#chart .c-node', { scale: 0, transformOrigin: '50% 50%', duration: 0.5, stagger: 0.05, ease: 'back.out(2)' }, '-=1.1')
      .from('#chart .c-label', { autoAlpha: 0, duration: 0.6 }, '<');
    document.querySelectorAll('#chart text[data-v]').forEach((t, i) => {
        tl.to(t, { duration: 1.1, scrambleText: { text: t.dataset.v, chars: '0123456789', speed: 0.6 } }, 1.4 + i * 0.04);
    });
    tl.from('#readings .reading', { y: 40, autoAlpha: 0, stagger: 0.1, duration: 0.8, ease: 'power3.out' }, 1.2)
      .fromTo('#signSky .draw', { drawSVG: '0%' }, { drawSVG: '100%', duration: 1.4, ease: 'power2.inOut' }, 1.6);
}

/* ---------------- Поле даты ---------------- */
function setupDateForm() {
    const form = $('#calc'), d = $('#dDay'), m = $('#dMonth'), y = $('#dYear'), hint = $('#dateHint');
    const fields = [d, m, y];
    fields.forEach((inp, i) => {
        inp.addEventListener('input', () => {
            inp.value = inp.value.replace(/\D/g, '');
            if (inp.value.length === inp.maxLength && fields[i + 1]) fields[i + 1].focus();
        });
        inp.addEventListener('keydown', (e) => {
            if (e.key === 'Backspace' && !inp.value && fields[i - 1]) fields[i - 1].focus();
        });
        inp.addEventListener('paste', (e) => {
            const txt = (e.clipboardData || window.clipboardData).getData('text');
            const mt = txt.match(/(\d{1,2})\D(\d{1,2})\D(\d{4})/);
            if (mt) { e.preventDefault(); d.value = mt[1].padStart(2, '0'); m.value = mt[2].padStart(2, '0'); y.value = mt[3]; y.focus(); }
        });
    });
    form.addEventListener('submit', (e) => {
        e.preventDefault();
        const r = parseDate(d.value, m.value, y.value);
        if (r.error) {
            hint.textContent = r.error;
            hint.classList.add('is-error');
            if (hasGsap && !reduce) gsap.fromTo('.datebox', { x: -8 }, { x: 0, duration: 0.5, ease: 'elastic.out(1, 0.3)' });
            return;
        }
        hint.textContent = 'Готово. Ваша карта ниже.';
        hint.classList.remove('is-error');
        showResult(r.day, r.month, r.year);
    });
}

/* ---------------- Анимации страницы ---------------- */
function setupMotion() {
    const bar = $('.bar');
    const onScroll = () => bar.classList.toggle('is-solid', window.scrollY > 40);
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();

    if (!hasGsap || reduce) return;

    if (window.Lenis) {
        const lenis = new window.Lenis({ lerp: 0.09, smoothWheel: true });
        window.lenis = lenis;
        lenis.on('scroll', ScrollTrigger.update);
        gsap.ticker.add((t) => lenis.raf(t * 1000));
        gsap.ticker.lagSmoothing(0);
    }

    // Заголовок: строки поднимаются из-под маски
    document.fonts.ready.then(() => {
        const split = SplitText.create('.hero-title', { type: 'lines,words', mask: 'lines' });
        gsap.timeline()
            .from('.hero-kicker', { y: 16, autoAlpha: 0, duration: 0.8, ease: 'power3.out' })
            .from(split.words, { yPercent: 110, duration: 1.1, stagger: 0.06, ease: 'power4.out' }, '-=0.4')
            .from('.hero-lead', { y: 24, autoAlpha: 0, duration: 0.9, ease: 'power3.out' }, '-=0.7')
            .from('.datebox', { y: 30, autoAlpha: 0, duration: 1, ease: 'power3.out' }, '-=0.6')
            .from('.ridge', { yPercent: 40, duration: 1.6, stagger: 0.1, ease: 'power3.out' }, 0)
            .from('.bar', { y: -20, autoAlpha: 0, duration: 0.8 }, 0.3);
    });

    // Горы и небо реагируют на прокрутку
    gsap.to('.ridge-back', { yPercent: -18, ease: 'none', scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: true } });
    gsap.to('.ridge-front', { yPercent: -6, ease: 'none', scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: true } });
    gsap.to('.hero-inner', { yPercent: -12, autoAlpha: 0.2, ease: 'none', scrollTrigger: { trigger: '.hero', start: 'center center', end: 'bottom top', scrub: true } });
    ScrollTrigger.create({
        start: 0, end: 'max',
        onUpdate: (self) => window.matrixSky && window.matrixSky.setScroll(self.progress)
    });

    // Шаги метода появляются по очереди, числа «досчитываются»
    gsap.from('.step', {
        y: 50, autoAlpha: 0, stagger: 0.12, duration: 0.9, ease: 'power3.out',
        scrollTrigger: { trigger: '#steps', start: 'top 80%' }
    });
    ScrollTrigger.create({
        trigger: '#steps', start: 'top 75%', once: true,
        onEnter: () => document.querySelectorAll('.step-calc b:last-child').forEach((b, i) =>
            gsap.to(b, { duration: 1, delay: 0.3 + i * 0.12, scrambleText: { text: b.textContent, chars: '0123456789', speed: 0.5 } }))
    });

    // Заголовки секций
    document.querySelectorAll('.method .h2, .zodiac .h2, .offer .h2').forEach((h) => {
        const s = SplitText.create(h, { type: 'lines', mask: 'lines' });
        gsap.from(s.lines, { yPercent: 100, duration: 1, stagger: 0.1, ease: 'power4.out', scrollTrigger: { trigger: h, start: 'top 85%' } });
    });

    // Зодиакальный круг вращается вместе с прокруткой
    gsap.fromTo('#wheelRot', { rotation: -40, svgOrigin: '0 0' }, {
        rotation: 50, svgOrigin: '0 0', ease: 'none',
        scrollTrigger: { trigger: '#zodiac', start: 'top bottom', end: 'bottom top', scrub: 1 }
    });

    gsap.from('.plan', { y: 60, autoAlpha: 0, stagger: 0.12, duration: 1, ease: 'power3.out', scrollTrigger: { trigger: '.plans', start: 'top 80%' } });
}

/* ---------------- Старт ---------------- */
drawWheel($('#wheel'));
fillSteps(14, 3, 1991, calcMatrix(14, 3, 1991));
setupDateForm();
setupMotion();
