/* consent.js — информирование об использовании cookie и localStorage.
   Сайт использует только необходимые данные (вход, тема, настройки анимаций,
   гостевые отзывы в браузере). Аналитика и реклама не подключены.
   Если позже подключите аналитику — загружайте её только после window.cookieConsent.analytics === true. */
(function () {
    'use strict';

    var KEY = 'cookieConsent.v1';
    var state = { necessary: true, analytics: false, decided: false };

    function read() {
        try {
            var raw = localStorage.getItem(KEY);
            if (!raw) return null;
            var data = JSON.parse(raw);
            return data && typeof data === 'object' ? data : null;
        } catch (e) { return null; }
    }

    function write(analytics) {
        state.analytics = !!analytics;
        state.decided = true;
        try {
            localStorage.setItem(KEY, JSON.stringify({ analytics: state.analytics, at: new Date().toISOString() }));
        } catch (e) { /* хранилище недоступно — баннер просто не запомнит выбор */ }
        window.cookieConsent = state;
        document.dispatchEvent(new CustomEvent('cookie-consent', { detail: state }));
    }

    var saved = read();
    if (saved) {
        state.analytics = saved.analytics === true;
        state.decided = true;
    }
    window.cookieConsent = state;

    window.openCookieSettings = function () {
        try { localStorage.removeItem(KEY); } catch (e) {}
        state.decided = false;
        show();
    };

    function show() {
        if (document.getElementById('cookieBanner')) return;

        var banner = document.createElement('div');
        banner.id = 'cookieBanner';
        banner.className = 'cookie-banner';
        banner.setAttribute('role', 'dialog');
        banner.setAttribute('aria-label', 'Использование cookie');

        var text = document.createElement('p');
        text.appendChild(document.createTextNode(
            'Мы используем только необходимые файлы cookie и локальное хранилище браузера: для входа, настроек оформления и работы форм. ' +
            'Рекламы и сторонней аналитики на сайте нет. Подробнее — в '));
        var link = document.createElement('a');
        link.href = 'cookies.html';
        link.textContent = 'политике cookie';
        text.appendChild(link);
        text.appendChild(document.createTextNode('.'));

        var actions = document.createElement('div');
        actions.className = 'cookie-banner-actions';

        var ok = document.createElement('button');
        ok.type = 'button';
        ok.className = 'cookie-btn primary';
        ok.textContent = 'Понятно';
        ok.addEventListener('click', function () { write(false); banner.remove(); });

        actions.appendChild(ok);
        banner.appendChild(text);
        banner.appendChild(actions);
        document.body.appendChild(banner);
    }

    function init() { if (!state.decided) show(); }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
