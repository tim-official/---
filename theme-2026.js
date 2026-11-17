/* Theme 2026 — микровзаимодействия: reveal при прокрутке, ripple, счётчики */
(function () {
    'use strict';

    var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    function initReveal() {
        var targets = document.querySelectorAll('[data-reveal]');
        if (!targets.length) return;

        if (reduced || !('IntersectionObserver' in window)) {
            targets.forEach(function (el) { el.classList.add('is-visible'); });
            return;
        }

        var io = new IntersectionObserver(function (entries) {
            entries.forEach(function (entry) {
                if (!entry.isIntersecting) return;
                var el = entry.target;
                var delay = Number(el.dataset.revealDelay || 0);
                setTimeout(function () { el.classList.add('is-visible'); }, delay);
                io.unobserve(el);
            });
        }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });

        targets.forEach(function (el) { io.observe(el); });
    }

    function initRipple() {
        if (reduced) return;
        document.addEventListener('pointerdown', function (e) {
            var btn = e.target.closest('.btn, .sidebar-command-actions button, .topbar-back, .theme-toggle-btn');
            if (!btn || btn.disabled) return;

            var rect = btn.getBoundingClientRect();
            var size = Math.max(rect.width, rect.height);
            var wave = document.createElement('span');
            wave.className = 'ripple';
            wave.style.width = wave.style.height = size + 'px';
            wave.style.left = (e.clientX - rect.left - size / 2) + 'px';
            wave.style.top = (e.clientY - rect.top - size / 2) + 'px';

            if (getComputedStyle(btn).position === 'static') btn.style.position = 'relative';
            btn.appendChild(wave);
            setTimeout(function () { wave.remove(); }, 640);
        }, { passive: true });
    }

    function animateNumber(el) {
        var raw = (el.textContent || '').trim();
        if (!/^\d+$/.test(raw)) return;

        var target = Number(raw);
        if (!target || target > 100000) return;

        var duration = 900;
        var start = performance.now();

        function step(now) {
            var p = Math.min((now - start) / duration, 1);
            var eased = 1 - Math.pow(1 - p, 3);
            el.textContent = String(Math.round(target * eased));
            if (p < 1) requestAnimationFrame(step);
        }

        el.textContent = '0';
        requestAnimationFrame(step);
    }

    function initCounters(root) {
        if (reduced) return;
        (root || document).querySelectorAll('.kpi-value, .sidebar-command-stat strong').forEach(animateNumber);
    }

    function autoTagReveal() {
        var dashboardPages = document.querySelectorAll('.page');

        if (dashboardPages.length) {
            dashboardPages.forEach(function (page) {
                page.querySelectorAll('.card, .kpi-card, .settings-card, .profile-card').forEach(function (el) {
                    if (!el.hasAttribute('data-reveal') && !el.closest('.grid-4')) {
                        el.setAttribute('data-reveal', '');
                    }
                });
            });
            return;
        }

        var siteSelector = [
            '.service-card', '.feature-card', '.pricing-card', '.review-card',
            '.testimonial-card', '.stat-card', '.info-card', '.step-card',
            '.faq-item', '.contact-card', '.section-title', '.section-head'
        ].join(',');

        document.querySelectorAll(siteSelector).forEach(function (el, index) {
            if (el.hasAttribute('data-reveal')) return;
            if (el.getBoundingClientRect().top < window.innerHeight * 0.9) return;
            el.setAttribute('data-reveal', '');
            el.dataset.revealDelay = String((index % 4) * 70);
        });
    }

    function boot() {
        autoTagReveal();
        initReveal();
        initRipple();
        initCounters();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }

    window.Theme2026 = {
        reveal: initReveal,
        counters: initCounters
    };
})();
