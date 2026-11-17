// Страница: расчёт, расшифровка, связь прокрутки с 3D-сценой и анимации.
import { ARCANA, ZODIAC } from './data.js';
import { calcMatrix, zodiacFor, parseDate, el, html, drawChart } from './matrix.js';

const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const { gsap, ScrollTrigger, SplitText, ScrambleTextPlugin, DrawSVGPlugin } = window;
const motion = Boolean(gsap) && !reduce;
if (gsap) gsap.registerPlugin(ScrollTrigger, SplitText, ScrambleTextPlugin, DrawSVGPlugin);
const $ = (s, r = document) => r.querySelector(s);
const scene = () => window.scene3d;

/* ---------------- Расшифровка ---------------- */
const CHAPTERS = [
    ['D', 'Суть · центр матрицы'], ['A', 'Личность · день рождения'], ['B', 'Таланты · месяц'],
    ['V', 'Задача · год'], ['G', 'Опыт рода · сумма']
];

function renderChapters(root, v) {
    root.textContent = '';
    CHAPTERS.forEach(([key, label]) => {
        const a = ARCANA[v[key]];
        const c = html('article', 'chapter', null, root);
        html('span', 'chapter-n', String(v[key]), c);
        html('p', 'mono', label, c);
        html('h3', null, a.name, c);
        html('p', 'chapter-d', a.desc, c);
        const d = html('p', 'chapter-do', null, c);
        html('b', null, 'Действие на неделю', d);
        d.appendChild(document.createTextNode(a.practice));
    });
}

function renderFormula(root, day, month, year, v) {
    root.textContent = '';
    [
        ['День', String(day), v.A], ['Месяц', String(month), v.B], ['Год', String(year).split('').join('+'), v.V],
        ['Сумма', `${v.A}+${v.B}+${v.V}`, v.G], ['Центр', `${v.A}+${v.B}+${v.V}+${v.G}`, v.D]
    ].forEach(([name, expr, res]) => {
        const li = html('li', null, null, root);
        html('span', null, name, li);
        li.appendChild(document.createTextNode(expr + ' → '));
        html('b', null, String(res), li);
    });
}

function drawSign(svg, z) {
    svg.textContent = '';
    const pts = z.stars.map(([x, y]) => [12 + x * 176, 8 + y * 104]);
    el('polyline', { points: pts.map((p) => p.join(',')).join(' '), class: 's-line draw' }, svg);
    pts.forEach(([x, y], i) => el('circle', { cx: x, cy: y, r: i % 3 === 0 ? 2.6 : 1.8, class: 's-star' }, svg));
}

function showResult(day, month, year, instant) {
    const v = calcMatrix(day, month, year);
    const z = zodiacFor(day, month);
    const core = ARCANA[v.D];
    const dStr = `${String(day).padStart(2, '0')}.${String(month).padStart(2, '0')}.${year}`;

    $('#resultMeta').textContent = `Ваша карта · ${dStr} · ${z.name}`;
    $('#coreName').textContent = `аркан ${v.D}, «${core.name}»`;
    $('#coreDesc').textContent = core.desc;
    renderFormula($('#formula'), day, month, year, v);
    drawChart($('#chart'), v);
    renderChapters($('#chapters'), v);
    drawSign($('#signSky'), z);
    $('#signMeta').textContent = `${z.from} — ${z.to} · ${z.element}`;
    $('#signName').textContent = z.name;
    $('#signTrait').textContent = z.trait + '.';

    const section = $('#result');
    section.hidden = false;
    observeScenes();
    if (scene()) scene().celebrate();

    if (!motion || instant) { section.scrollIntoView(); if (gsap) ScrollTrigger.refresh(); return; }
    ScrollTrigger.refresh();
    if (window.lenis) window.lenis.scrollTo(section, { duration: 1.8 }); else section.scrollIntoView({ behavior: 'smooth' });

    const tl = gsap.timeline({ delay: 0.7 });
    tl.from('#result .wrap > .mono, #result .h-xl, #result .lead, #formula li', { y: 28, autoAlpha: 0, stagger: 0.07, duration: 0.9, ease: 'power3.out' })
      .fromTo('#chart .draw', { drawSVG: '0%' }, { drawSVG: '100%', duration: 1.7, stagger: 0.06, ease: 'power2.inOut' }, 0.5)
      .from('#chart .c-node', { scale: 0, transformOrigin: '50% 50%', duration: 0.5, stagger: 0.05, ease: 'back.out(2)' }, 1.1)
      .from('#chart .c-label, .chart figcaption, .sign', { autoAlpha: 0, duration: 0.8 }, 1.6)
      .fromTo('#signSky .draw', { drawSVG: '0%' }, { drawSVG: '100%', duration: 1.4, ease: 'power2.inOut' }, 1.8);
    document.querySelectorAll('#chart text[data-v]').forEach((t, i) => {
        tl.to(t, { duration: 1, scrambleText: { text: t.dataset.v, chars: '0123456789', speed: 0.6 } }, 1.2 + i * 0.04);
    });
    gsap.utils.toArray('#chapters .chapter').forEach((c) => {
        gsap.from(c.children, { y: 34, autoAlpha: 0, stagger: 0.06, duration: 0.9, ease: 'power3.out', scrollTrigger: { trigger: c, start: 'top 84%' } });
        const n = c.querySelector('.chapter-n');
        ScrollTrigger.create({ trigger: c, start: 'top 84%', once: true, onEnter: () => gsap.to(n, { duration: 0.9, scrambleText: { text: n.textContent, chars: '0123456789', speed: 0.5 } }) });
    });
    gsap.from('.more > *', { y: 30, autoAlpha: 0, stagger: 0.1, duration: 0.9, ease: 'power3.out', scrollTrigger: { trigger: '.more', start: 'top 85%' } });
}

/* ---------------- Поле даты ---------------- */
function setupDate() {
    const form = $('#dateForm'), d = $('#dDay'), m = $('#dMonth'), y = $('#dYear'), hint = $('#dateHint');
    const fields = [d, m, y];
    fields.forEach((inp, i) => {
        inp.addEventListener('input', () => {
            inp.value = inp.value.replace(/\D/g, '');
            if (inp.value.length === inp.maxLength && fields[i + 1]) fields[i + 1].focus();
        });
        inp.addEventListener('keydown', (e) => { if (e.key === 'Backspace' && !inp.value && fields[i - 1]) fields[i - 1].focus(); });
        inp.addEventListener('paste', (e) => {
            const mt = (e.clipboardData || window.clipboardData).getData('text').match(/(\d{1,2})\D(\d{1,2})\D(\d{4})/);
            if (mt) { e.preventDefault(); d.value = mt[1].padStart(2, '0'); m.value = mt[2].padStart(2, '0'); y.value = mt[3]; y.focus(); }
        });
    });
    form.addEventListener('submit', (e) => {
        e.preventDefault();
        const r = parseDate(d.value, m.value, y.value);
        if (r.error) {
            hint.textContent = r.error;
            hint.classList.add('is-error');
            if (motion) gsap.fromTo('.digits', { x: -10 }, { x: 0, duration: 0.6, ease: 'elastic.out(1, 0.3)' });
            return;
        }
        hint.textContent = 'Готово. Ваша карта ниже.';
        hint.classList.remove('is-error');
        showResult(r.day, r.month, r.year);
    });

    // ссылка вида ?d=14.03.1991 сразу открывает карту
    const q = new URLSearchParams(location.search).get('d');
    const mt = q && q.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
    if (mt) {
        const r = parseDate(mt[1], mt[2], mt[3]);
        if (!r.error) { d.value = mt[1].padStart(2, '0'); m.value = mt[2].padStart(2, '0'); y.value = mt[3]; showResult(r.day, r.month, r.year, true); }
    }
}

/* ---------------- Связь прокрутки со сценой ---------------- */
let sceneIO = null;
function observeScenes() {
    if (!('IntersectionObserver' in window)) return;
    if (!sceneIO) {
        // кадр выбирает секция, которая пересекает середину экрана
        sceneIO = new IntersectionObserver((entries) => {
            entries.forEach((en) => { if (en.isIntersecting && scene()) scene().to(en.target.dataset.scene || 'none'); });
        }, { rootMargin: '-50% 0px -50% 0px', threshold: 0 });
    }
    document.querySelectorAll('main > section, .foot').forEach((s) => sceneIO.observe(s));
}

function setupScroll() {
    const bar = $('#bar');
    const opaque = [...document.querySelectorAll('[data-opaque]')];
    let ticking = false;
    function onScroll() {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(() => {
            ticking = false;
            const y = window.scrollY, h = window.innerHeight;
            bar.classList.toggle('is-solid', y > h * 0.6);
            if (!scene()) return;
            scene().scroll(y / Math.max(1, document.documentElement.scrollHeight - h));
            // сцену не рисуем, пока её целиком закрывает плотная секция
            let top = Infinity, bottom = -Infinity;
            opaque.forEach((s) => { const r = s.getBoundingClientRect(); if (r.bottom > 0 && r.top < h) { top = Math.min(top, r.top); bottom = Math.max(bottom, r.bottom); } });
            scene().sleep(top <= 0 && bottom >= h);
        });
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('scene3d-ready', onScroll);
    onScroll();
}

/* ---------------- Анимации ---------------- */
function setupMotion() {
    if (!motion) return;

    if (window.Lenis) {
        const lenis = new window.Lenis({ lerp: 0.09, smoothWheel: true });
        window.lenis = lenis;
        lenis.on('scroll', ScrollTrigger.update);
        gsap.ticker.add((t) => lenis.raf(t * 1000));
        gsap.ticker.lagSmoothing(0);
        document.querySelectorAll('a[href^="#"]').forEach((a) => a.addEventListener('click', (e) => {
            const t = document.querySelector(a.getAttribute('href'));
            if (t) { e.preventDefault(); lenis.scrollTo(t, { duration: 1.6 }); }
        }));
    }

    document.fonts.ready.then(() => {
        const split = SplitText.create('.hero-copy h1', { type: 'lines,words', mask: 'lines' });
        gsap.timeline({ delay: 0.5 })
            .from('.bar', { y: -16, autoAlpha: 0, duration: 0.9, ease: 'power3.out' })
            .from('.hero-copy .mono', { y: 14, autoAlpha: 0, duration: 0.8, ease: 'power3.out' }, 0.2)
            .from(split.words, { yPercent: 110, duration: 1.1, stagger: 0.05, ease: 'power4.out' }, 0.3)
            .from('.hero-copy .cta', { y: 20, autoAlpha: 0, duration: 0.9, ease: 'power3.out' }, 0.8)
            .from('.hero-meta span', { autoAlpha: 0, stagger: 0.12, duration: 0.8 }, 1);

        document.querySelectorAll('main .h-xl:not(#resultTitle), .pause-copy').forEach((h) => {
            const s = SplitText.create(h, { type: 'lines', mask: 'lines' });
            gsap.from(s.lines, { yPercent: 105, duration: 1.1, stagger: 0.09, ease: 'power4.out', scrollTrigger: { trigger: h, start: 'top 86%' } });
        });
        ScrollTrigger.refresh();
    });

    gsap.to('.hero-copy, .hero-meta', { yPercent: -30, autoAlpha: 0, ease: 'none', scrollTrigger: { trigger: '.s-hero', start: '55% center', end: 'bottom 35%', scrub: true } });
    gsap.from('.dateform > *', { y: 40, autoAlpha: 0, stagger: 0.1, duration: 1, ease: 'power3.out', scrollTrigger: { trigger: '.s-calc', start: 'top 60%' } });

    gsap.from('.facts div', { y: 24, autoAlpha: 0, stagger: 0.1, duration: 0.8, ease: 'power3.out', scrollTrigger: { trigger: '.facts', start: 'top 85%' } });
    // страницы разбора раскрываются веером по мере прокрутки
    gsap.from('.pg:nth-of-type(1)', { rotation: 0, xPercent: 60, yPercent: 0, ease: 'none', scrollTrigger: { trigger: '.pages', start: 'top 90%', end: 'center 45%', scrub: 1 } });
    gsap.from('.pg:nth-of-type(3)', { rotation: 0, xPercent: -60, yPercent: 0, ease: 'none', scrollTrigger: { trigger: '.pages', start: 'top 90%', end: 'center 45%', scrub: 1 } });

    gsap.from('.portrait', { clipPath: 'inset(100% 0 0 0)', duration: 1.4, ease: 'power4.out', scrollTrigger: { trigger: '.portrait', start: 'top 80%' } });
    gsap.from('.steps li', { y: 50, autoAlpha: 0, stagger: 0.14, duration: 1, ease: 'power3.out', scrollTrigger: { trigger: '.steps', start: 'top 80%' } });
    gsap.from('.offer > *', { y: 36, autoAlpha: 0, stagger: 0.08, duration: 1, ease: 'power3.out', scrollTrigger: { trigger: '.price-grid', start: 'top 80%' } });
    gsap.from('.faq details', { y: 24, autoAlpha: 0, stagger: 0.07, duration: 0.8, ease: 'power3.out', scrollTrigger: { trigger: '.faq', start: 'top 85%' } });
}

/* ---------------- Старт ---------------- */
observeScenes();
setupScroll();
setupMotion();
setupDate();
