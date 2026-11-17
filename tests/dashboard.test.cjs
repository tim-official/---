const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const dashboard = fs.readFileSync(path.join(root, 'dashboard.html'), 'utf8');
const mainScript = fs.readFileSync(path.join(root, 'script.js'), 'utf8');

function loadFunctions(source, names, globals) {
    const code = names.map(name => {
        const match = source.match(new RegExp(`^(?:async )?function ${name}\\([\\s\\S]*?^}`, 'm'));
        assert.ok(match, `Missing top-level function ${name}`);
        return match[0];
    }).join('\n');
    const context = vm.createContext(globals);
    vm.runInContext(code, context);
    return context;
}

function response(data, status = 200) {
    return { ok: status >= 200 && status < 300, status, json: async () => data };
}

function requestContext(result) {
    const calls = [];
    const redirects = [];
    const context = loadFunctions(dashboard, ['fetchJSON', 'isAuthFailure'], {
        API_BASE: 'https://example.invalid',
        AbortController,
        setTimeout,
        clearTimeout,
        apiHeaders: () => ({ Authorization: 'Bearer test-session', 'X-Client-Key': 'test-capability' }),
        fetch: async (...args) => { calls.push(args); return result; },
        redirectToLogin: reason => redirects.push(reason),
        showNotify: () => {},
    });
    return { context, calls, redirects };
}

test('dashboard requests keep session and legacy capability separate', async () => {
    const { context, calls } = requestContext(response({ ok: true, orders: [] }));
    const result = await context.fetchJSON('/api/orders', { retries: 0 });
    assert.equal(result.ok, true);
    assert.equal(calls[0][0], 'https://example.invalid/api/orders');
    assert.equal(calls[0][1].headers.Authorization, 'Bearer test-session');
    assert.equal(calls[0][1].headers['X-Client-Key'], 'test-capability');
});

for (const data of [null, [], {}, { orders: [] }, { ok: 'true' }]) {
    test(`dashboard rejects invalid API envelope ${JSON.stringify(data)}`, async () => {
        const { context } = requestContext(response(data));
        await assert.rejects(context.fetchJSON('/api/orders', { retries: 0 }));
    });
}

test('dashboard rejects non-JSON success responses', async () => {
    const { context } = requestContext({
        ok: true, status: 200, json: async () => { throw new SyntaxError('Invalid JSON'); },
    });
    await assert.rejects(context.fetchJSON('/api/orders', { retries: 0 }));
});

test('expired sessions redirect without retrying a mutation', async () => {
    const { context, calls, redirects } = requestContext(
        response({ ok: false, sessionExpired: true, message: 'Session expired' }, 401)
    );
    await assert.rejects(
        context.fetchJSON('/api/auth/profile', { method: 'POST', body: { name: 'Test' } }),
        error => error.authFailure === true
    );
    assert.deepEqual(redirects, ['expired']);
    assert.equal(calls.length, 1);
});

test('unconfigured payment errors remain explicit and are not retried', async () => {
    const { context, calls } = requestContext(
        response({ ok: false, message: 'Payments not configured' }, 503)
    );
    await assert.rejects(context.fetchJSON('/api/orders', { method: 'POST', body: {} }),
        /Payments not configured/);
    assert.equal(calls.length, 1);
});

test('temporary server errors can still be retried', async () => {
    const { context, calls } = requestContext(response({ ok: false }, 502));
    context.fetch = async (...args) => {
        calls.push(args);
        return calls.length === 1 ? response({ ok: false }, 502) : response({ ok: true });
    };
    assert.equal((await context.fetchJSON('/api/orders')).ok, true);
    assert.equal(calls.length, 2);
});

test('main-page authentication rejects a malformed response instead of returning an empty object', async () => {
    const context = loadFunctions(mainScript, ['authRequest'], {
        API_BASE: 'https://example.invalid',
        AbortController,
        setTimeout,
        clearTimeout,
        getSessionToken: () => '',
        fetch: async () => ({
            ok: true, json: async () => { throw new SyntaxError('Invalid JSON'); },
        }),
    });
    await assert.rejects(context.authRequest('/api/auth/me'));
    context.fetch = async () => response([]);
    await assert.rejects(context.authRequest('/api/auth/me'));
    context.fetch = async () => response({ ok: true, account: { name: 'Test' } });
    assert.equal((await context.authRequest('/api/auth/me')).data.account.name, 'Test');
});

test('password recovery does not promise unavailable verification or include account email', () => {
    const start = mainScript.indexOf('function openForgotPasswordModal()');
    const end = mainScript.indexOf('\nfunction ', start + 10);
    const recovery = mainScript.slice(start, end);
    assert.match(recovery, /восстановление доступа может быть недоступно/i);
    assert.doesNotMatch(recovery, /после проверки|восстановят вручную/i);
    assert.doesNotMatch(recovery, /typedEmail|Email аккаунта/i);
});

function trainingContext(state) {
    const storage = new Map([['trainingState', state], ['currentOrder', 'unrelated-pending-order']]);
    let renders = 0;
    const context = loadFunctions(dashboard, ['syncTrainingState', 'onOrderPaid'], {
        localStorage: {
            getItem: key => storage.get(key) ?? null,
            setItem: (key, value) => storage.set(key, value),
            removeItem: key => storage.delete(key),
        },
        loadUser: () => { renders++; },
        loadTrainingStatus: () => {},
    });
    return { context, storage, renders: () => renders };
}

for (const [before, after] of [['accepted', 'waitlist'], ['waitlist', 'accepted'], ['not_paid', 'accepted']]) {
    test(`server training status replaces cached ${before} with ${after}`, () => {
        const { context, storage, renders } = trainingContext(before);
        context.syncTrainingState([{ kind: 'training', status: 'paid', enrollmentStatus: after }]);
        assert.equal(storage.get('trainingState'), after);
        assert.equal(storage.get('currentOrder'), 'unrelated-pending-order');
        assert.equal(renders(), 1);
    });
}

test('unchanged enrollment avoids rerendering and missing paid orders clear stale state', () => {
    const { context, storage, renders } = trainingContext('accepted');
    context.syncTrainingState([{ kind: 'training', status: 'paid', enrollmentStatus: 'accepted' }]);
    assert.equal(renders(), 0);
    context.syncTrainingState([{ kind: 'consultation', status: 'paid' }]);
    assert.equal(storage.get('trainingState'), 'not_paid');
    assert.equal(renders(), 1);
});

test('missing enrollment status cannot silently grant acceptance', () => {
    const { context, storage } = trainingContext('not_paid');
    assert.throws(() => context.onOrderPaid({ kind: 'training', status: 'paid' }));
    assert.equal(storage.get('trainingState'), 'not_paid');
    assert.equal(storage.get('currentOrder'), 'unrelated-pending-order');
});

test('a malformed orders list is shown as an error, not as no purchases', async () => {
    const list = { textContent: '', innerHTML: '' };
    let synced = false;
    const context = loadFunctions(dashboard, ['loadMyOrders'], {
        document: { getElementById: () => list },
        fetchJSON: async () => ({ ok: true }),
        syncTrainingState: () => { synced = true; },
        showNotify: () => {},
    });
    await context.loadMyOrders();
    assert.equal(synced, false);
    assert.notEqual(list.textContent, '');
});

for (const [reduced, level, expected] of [
    [false, 'normal', true],
    [false, 'cinema', true],
    [false, 'still', false],
    [true, 'normal', false],
    [true, 'cinema', false],
]) {
    test(`motion respects system=${reduced} and preference=${level}`, () => {
        const context = loadFunctions(mainScript, ['isMotionEnabled'], {
            window: { matchMedia: () => ({ matches: reduced }) },
            document: { body: { getAttribute: () => level } },
        });
        assert.equal(context.isMotionEnabled(), expected);
    });
    test(`cabinet motion respects system=${reduced} and preference=${level}`, () => {
        const context = loadFunctions(dashboard, ['isDashboardMotionEnabled'], {
            window: { matchMedia: () => ({ matches: reduced }) },
            document: { body: { getAttribute: () => level } },
        });
        assert.equal(context.isDashboardMotionEnabled(), expected);
    });
}

test('main-page canvas pauses offscreen, in hidden tabs and for reduced motion', () => {
    const scheduled = new Map();
    const events = new Map();
    let nextFrame = 0;
    let intersect;
    let onReducedMotion;
    const media = { matches: false, addEventListener: (_, handler) => { onReducedMotion = handler; } };
    const noop = () => {};
    const canvas = {
        dataset: {},
        getContext: () => ({ clearRect: noop, beginPath: noop, arc: noop, fill: noop, setTransform: noop }),
    };
    const hero = {
        classList: { toggle: noop },
        getBoundingClientRect: () => ({ width: 1000, height: 700 }),
    };
    const document = {
        hidden: false,
        body: { dataset: { motion: 'normal' }, classList: { toggle: noop } },
        getElementById: () => canvas,
        querySelector: () => hero,
        addEventListener: (name, handler) => events.set(name, handler),
    };
    const context = loadFunctions(mainScript, ['initHeroNebulaCanvas'], {
        window: { matchMedia: () => media, devicePixelRatio: 3, addEventListener: noop, IntersectionObserver: true },
        document,
        performance: { now: () => 0 },
        requestAnimationFrame: handler => { scheduled.set(++nextFrame, handler); return nextFrame; },
        cancelAnimationFrame: id => scheduled.delete(id),
        IntersectionObserver: class {
            constructor(handler) { intersect = handler; }
            observe() {}
        },
    });
    context.initHeroNebulaCanvas();
    assert.equal(canvas.width, 1500);
    assert.equal(canvas.dataset.animationState, 'running');
    assert.equal(scheduled.size, 1);

    events.get('motionchange')();
    assert.equal(scheduled.size, 1, 'A preference change must not start a duplicate render loop');
    intersect([{ isIntersecting: false }]);
    assert.equal(canvas.dataset.animationState, 'paused');
    assert.equal(scheduled.size, 0);
    intersect([{ isIntersecting: true }]);
    assert.equal(scheduled.size, 1);

    document.hidden = true;
    events.get('visibilitychange')();
    assert.equal(scheduled.size, 0);
    document.hidden = false;
    events.get('visibilitychange')();
    assert.equal(scheduled.size, 1);

    media.matches = true;
    onReducedMotion();
    assert.equal(scheduled.size, 0);
    media.matches = false;
    onReducedMotion();
    assert.equal(scheduled.size, 1);
    document.body.dataset.motion = 'still';
    events.get('motionchange')();
    assert.equal(canvas.dataset.animationState, 'paused');
    assert.equal(scheduled.size, 0);
});

test('main-page disclosures and carousel retain keyboard-accessible controls', () => {
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
    assert.equal(new Set(ids).size, ids.length, 'IDs must be unique');
    for (const [, target] of html.matchAll(/\bhref="#([^"]+)"/g)) {
        assert.ok(ids.includes(target), `Missing anchor target ${target}`);
    }
    assert.equal((html.match(/<details class="faq-item">/g) || []).length, 5);
    assert.equal((html.match(/<summary class="faq-question">/g) || []).length, 5);
    assert.match(html, /id="testimonialTrack" tabindex="0"/);
    assert.match(html, /id="ambientToggle" aria-pressed="false"/);
    assert.doesNotMatch(html, /function animNode|setTimeout\(function run/);
    assert.doesNotMatch(html, /class="(?:drawer-candles|drawer-candle|footer-candle)"/);
});

for (const initialLevel of ['cinema', 'still']) {
    test(`cabinet canvas lifecycle and persisted ${initialLevel} preference`, () => {
        const scheduled = new Map(), documentEvents = new Map(), windowEvents = new Map(), buttonEvents = new Map();
        const storage = new Map([['motionLevel', initialLevel]]);
        let nextFrame = 0, paints = 0, onReducedMotion;
        const noop = () => {};
        const reduced = { matches: false, addEventListener: (_, fn) => { onReducedMotion = fn; } };
        const fine = { matches: true, addEventListener: noop };
        const canvas = {
            dataset: {}, style: {},
            getContext: () => ({
                clearRect: () => { paints++; }, beginPath: noop, arc: noop, fill: noop, setTransform: noop,
            }),
        };
        const button = {
            attributes: {}, disabled: false,
            setAttribute(key, value) { this.attributes[key] = value; },
            querySelector: () => ({ textContent: '' }),
            addEventListener: (key, fn) => buttonEvents.set(key, fn),
        };
        const document = {
            hidden: false,
            documentElement: { setAttribute: noop },
            body: {
                dataset: {}, classList: { toggle: noop },
                getAttribute() { return this.dataset.motion; },
                setAttribute(_, value) { this.dataset.motion = value; },
            },
            getElementById: id => id === 'starsCanvas' ? canvas : button,
            addEventListener: (key, fn) => documentEvents.set(key, fn),
        };
        const context = loadFunctions(dashboard, ['isDashboardMotionEnabled', 'initCabinetMotion'], {
            document,
            window: {
                innerWidth: 1000, innerHeight: 800, devicePixelRatio: 3,
                matchMedia: query => query.includes('reduced-motion') ? reduced : fine,
                addEventListener: (key, fn) => windowEvents.set(key, fn),
            },
            localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
            requestAnimationFrame: fn => { scheduled.set(++nextFrame, fn); return nextFrame; },
            cancelAnimationFrame: id => scheduled.delete(id),
            showNotify: () => assert.fail('Unexpected motion error'),
        });
        context.initCabinetMotion();
        assert.equal(canvas.width, 1500, 'DPR is capped at 1.5');
        assert.equal(scheduled.size, initialLevel === 'still' ? 0 : 1);
        if (initialLevel === 'still') buttonEvents.get('click')();
        assert.equal(canvas.dataset.animationState, 'running');
        windowEvents.get('pageshow')();
        assert.equal(scheduled.size, 1, 'Resume does not create a second loop');
        const tick = time => {
            const [id, fn] = scheduled.entries().next().value;
            scheduled.delete(id);
            fn(time);
        };
        const initialPaints = paints;
        tick(16);
        assert.equal(paints, initialPaints, 'Rendering is capped below 60 FPS');
        tick(34);
        assert.equal(paints, initialPaints + 1);
        buttonEvents.get('click')();
        assert.equal(storage.get('motionLevel'), 'still');
        assert.equal(button.attributes['aria-pressed'], 'true');
        assert.equal(scheduled.size, 0);
        buttonEvents.get('click')();
        assert.equal(storage.get('motionLevel'), initialLevel === 'still' ? 'normal' : 'cinema');
        assert.equal(scheduled.size, 1);
        document.hidden = true;
        documentEvents.get('visibilitychange')();
        assert.equal(scheduled.size, 0);
        assert.equal(canvas.dataset.animationState, 'paused');
        document.hidden = false;
        documentEvents.get('visibilitychange')();
        assert.equal(scheduled.size, 1);
        reduced.matches = true;
        onReducedMotion();
        assert.equal(scheduled.size, 0);
        assert.equal(button.disabled, true);
        reduced.matches = false;
        onReducedMotion();
        assert.equal(scheduled.size, 1);
        storage.set('motionLevel', 'still');
        windowEvents.get('storage')({ key: 'motionLevel' });
        assert.equal(scheduled.size, 0, 'Pause from another page is respected');
    });
}

test('cabinet sidebar restores focus, scrolling and prior inert state', () => {
    let mobile = true;
    const document = { activeElement: null };
    const element = () => {
        const classes = new Set();
        return {
            inert: false, attributes: {}, isConnected: true,
            classList: { contains: value => classes.has(value), toggle: (value, on) => on ? classes.add(value) : classes.delete(value) },
            setAttribute(key, value) { this.attributes[key] = value; },
            removeAttribute(key) { delete this.attributes[key]; },
            focus() { document.activeElement = this; },
        };
    };
    const sidebar = element(), overlay = element(), trigger = element(), close = element(), main = element(), other = element();
    other.inert = true;
    document.activeElement = trigger;
    document.body = { children: [sidebar, overlay, main, other], style: { overflow: 'clip' } };
    document.getElementById = id => ({ sidebar, sidebarOverlay: overlay, sidebarToggle: trigger, sidebarClose: close })[id];
    const context = loadFunctions(dashboard, ['setSidebarOpen', 'toggleSidebar', 'closeSidebar'], {
        document, window: { matchMedia: () => ({ matches: mobile }) },
        sidebarBackground: new Map(), sidebarOverflow: '', sidebarReturnFocus: null,
    });
    context.toggleSidebar();
    assert.equal(main.inert, true);
    assert.equal(document.body.style.overflow, 'hidden');
    assert.equal(sidebar.attributes['aria-modal'], 'true');
    assert.equal(document.activeElement, close);
    context.closeSidebar();
    assert.equal(document.activeElement, trigger);
    assert.equal(main.inert, false);
    assert.equal(other.inert, true, 'Pre-existing inert state is preserved');
    assert.equal(document.body.style.overflow, 'clip');
    assert.equal(sidebar.inert, true);
    context.toggleSidebar();
    mobile = false;
    context.setSidebarOpen(false, false);
    assert.equal(sidebar.inert, false, 'Desktop navigation remains usable after resizing');
    assert.equal(main.inert, false);
    assert.equal(sidebar.attributes.role, undefined);
});

test('unsupported name input has an explicit UI state rather than a partial reading', () => {
    const context = loadFunctions(dashboard, ['getPortraitNameInfo', 'renderNamePane'], {
        window: { MatrixNames: require(path.join(root, 'data', 'name-data.js')) },
    });
    const info = context.getPortraitNameInfo('Алeна');
    assert.equal(info.number, null);
    assert.match(context.renderNamePane(info), /Напишите имя кириллицей/);
    assert.doesNotMatch(context.renderNamePane(info), /Число имени/);
});

test('matrix interpretation renders nine escaped points with the centre first and optional deep readings', () => {
    const arcana = Object.fromEntries(Array.from({ length: 22 }, (_, index) => [index + 1, {
        name: `Аркан ${index + 1}`, key: 'ключ', desc: 'описание', plus: 'плюс', minus: 'минус',
    }]));
    arcana[5] = { name: 'Иерофант <img src=x onerror=alert(1)>', key: 'учитель', desc: 'мудрость', plus: 'плюс', minus: 'минус' };
    const context = loadFunctions(dashboard, ['escapeHtml', 'getMatrixPointGuide', 'renderInterpText', 'renderMatrixInterpretations'], {
        ARCANA: arcana,
        POSITION_ARCANA: { A: { 5: { desc: 'Глубокий текст', plus: 'Женщина:; Красота; Забота; Мужчина:; Опора', minus: 'Тень' } } },
    });
    const html = context.renderMatrixInterpretations({ A: 5, B: 12, V: 3, G: 20, D: 4, E: 17, Zh: 15, I: 5, Z: 7 });
    const ids = [...html.matchAll(/<article[^>]+id="interpPoint-([A-Za-z]+)"/g)].map(match => match[1]);
    assert.deepEqual(ids, ['D', 'A', 'B', 'V', 'G', 'E', 'Zh', 'I', 'Z']);
    assert.equal((html.match(/class="lx-interp-chip"/g) || []).length, 9);
    assert.match(html, /Иерофант &lt;img src=x onerror=alert\(1\)&gt;/);
    assert.doesNotMatch(html, /<img/);
    assert.doesNotMatch(html, /style="|✅|⚠️|📌/u, 'No inline colours or legacy emoji markers');
    assert.equal((html.match(/<details class="lx-point-more">/g) || []).length, 1, 'Deep reading only where position text exists');
    assert.match(html, /<p class="lx-point-sub">Женщина<\/p><ul><li>Красота<\/li><li>Забота<\/li><\/ul><p class="lx-point-sub">Мужчина<\/p><ul><li>Опора<\/li><\/ul>/);
    assert.equal(context.renderInterpText('Один; два'), '<p>Один; два</p>');
});
test('cabinet text and reading links retain at least 4.5:1 contrast in both palettes', () => {
    const css = fs.readFileSync(path.join(root, 'luxe-dashboard.css'), 'utf8');
    const property = (block, name) => {
        const match = block.match(new RegExp(`(?:^|[;{])\\s*${name}:\\s*([^;]+)`));
        assert.ok(match, `Missing ${name}`);
        return match[1].trim();
    };
    const rgb = hex => hex.slice(1).match(/../g).map(value => parseInt(value, 16) / 255);
    const luminance = channels => channels
        .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4)
        .reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
    const linkRule = css.match(/html body#studioDashboard \.portrait-key-go\s*\{([^}]+)\}/);
    assert.ok(linkRule, 'Missing reading-link style');
    const opacity = Number(property(linkRule[1], 'opacity'));

    for (const [theme, selector] of [
        ['dark', /html:root\s*\{([^}]+)\}/],
        ['light', /html\[data-theme="light"\]\s*\{([^}]+)\}/],
    ]) {
        const rule = css.match(selector);
        assert.ok(rule, `Missing ${theme} palette`);
        const foreground = rgb(property(rule[1], '--lx-gold'));
        const background = rgb(property(rule[1], '--studio-bg'));
        const painted = foreground.map((value, index) => value * opacity + background[index] * (1 - opacity));
        const a = luminance(painted);
        const b = luminance(background);
        const contrast = (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
        assert.ok(contrast >= 4.5, `${theme} reading-link contrast is ${contrast.toFixed(2)}:1`);

        const surfaces = theme === 'light'
            ? ['--studio-bg', '--studio-surface', '--studio-field']
            : ['--studio-bg'];
        for (const text of ['--studio-text', '--studio-muted', '--lx-gold', '--lx-violet', '--lx-teal', '--lx-rose']) {
            const textLuminance = luminance(rgb(property(rule[1], text)));
            for (const surface of surfaces) {
                const surfaceLuminance = luminance(rgb(property(rule[1], surface)));
                const ratio = (Math.max(textLuminance, surfaceLuminance) + .05) / (Math.min(textLuminance, surfaceLuminance) + .05);
                assert.ok(ratio >= 4.5, `${theme} ${text} on ${surface}: ${ratio.toFixed(2)}:1`);
            }
        }
    }
});

for (const [section, targetId] of [
    ['matrix', 'matrixResult'], ['zodiac', 'matrixPortrait'], ['chakras', 'matrixHealthSection']
]) {
    for (const motion of [true, false]) {
        test(`atlas ${section} opens its reading after calculation with motion=${motion}`, () => {
            const hint = { dataset: {}, hidden: true, textContent: '' };
            const events = [];
            const target = {
                hidden: false, style: { display: 'block' },
                setAttribute: (...args) => events.push(['attribute', ...args]),
                focus: () => events.push(['result-focus']),
                scrollIntoView: options => events.push(['scroll', options.behavior]),
            };
            const context = loadFunctions(dashboard, ['openAtlasReading', 'finishAtlasReading'], {
                Object,
                document: {
                    getElementById: id => id === 'matrixReadingHint' ? hint
                        : id === 'matrixName' ? { focus: () => events.push(['input-focus']) }
                            : id === targetId ? target : null,
                    querySelector: () => 'matrix-link',
                },
                showPage: (...args) => events.push(['page', ...args]),
                closeSidebar: () => events.push(['close-sidebar']),
                setPortraitTab: (...args) => events.push(['tab', ...args]),
                isDashboardMotionEnabled: () => motion,
                showNotify: () => assert.fail('Unexpected atlas error'),
            });
            assert.equal(context.finishAtlasReading(), false);
            context.openAtlasReading(section);
            assert.equal(hint.dataset.reading, section);
            assert.equal(hint.hidden, false);
            assert.match(hint.textContent, /дату рождения/);
            assert.deepEqual(events[0], ['page', 'matrix', 'matrix-link']);
            assert.ok(events.some(event => event[0] === 'input-focus'));
            assert.ok(!events.some(event => event[0] === 'result-focus'), 'No stale result before calculation');
            assert.equal(context.finishAtlasReading(), true);
            assert.equal(hint.hidden, true);
            assert.equal(hint.dataset.reading, undefined);
            assert.deepEqual(events.at(-1), ['scroll', motion ? 'smooth' : 'auto']);
            assert.equal(events.some(event => event[0] === 'tab'), section === 'zodiac');
            assert.equal(context.finishAtlasReading(), false, 'Selection is consumed once');
        });
    }
}

test('atlas navigation surfaces invalid sections and unavailable results', () => {
    const notices = [];
    const hint = { dataset: { reading: 'zodiac' }, hidden: false };
    const context = loadFunctions(dashboard, ['openAtlasReading', 'finishAtlasReading'], {
        Object,
        document: { getElementById: id => id === 'matrixReadingHint' ? hint : null },
        showNotify: (...args) => notices.push(args),
    });
    context.openAtlasReading('constructor');
    assert.equal(notices[0][1], 'error');
    assert.equal(context.finishAtlasReading(), false);
    assert.equal(notices[1][1], 'error');
    assert.equal(hint.dataset.reading, undefined);
});

test('celestial gallery shares local artwork and keeps the entry visible without animation', () => {
    const main = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    const mainCss = fs.readFileSync(path.join(root, 'modern-2026.css'), 'utf8');
    const sharedCss = fs.readFileSync(path.join(root, 'celestial-studio.css'), 'utf8');
    const artwork = fs.readFileSync(path.join(root, 'images', 'celestial-atlas.svg'), 'utf8');
    for (const html of [main, dashboard]) {
        assert.match(html, /href="celestial-studio\.css\?v=/);
        for (const symbol of ['zodiac', 'chakras']) {
            assert.ok(html.includes(`images/celestial-atlas.svg#${symbol}`));
            assert.ok(artwork.includes(`<symbol id="${symbol}"`));
        }
    }
    assert.match(mainCss, /\.hero-content > :not\(\.hero-title\)\s*\{\s*opacity: 1;/);
    assert.match(sharedCss, /html\[data-motion="still"\] \.celestial-art > svg \{ animation: none; \}/);
    assert.match(sharedCss, /@media \(prefers-reduced-motion: reduce\)/);
});
