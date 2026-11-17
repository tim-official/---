// Расчёт матрицы, знак зодиака и отрисовка октаграммы.
import { ZODIAC } from './data.js';

const SVGNS = 'http://www.w3.org/2000/svg';

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

export { calcMatrix, zodiacFor, parseDate, el, html, drawChart };
