/* ============================================
   JAVASCRIPT - Интерактивность и Анимации
   ============================================ */

const DASHBOARD_BUILD = '20261102-portrait';

function getDashboardUrl(hash = '') {
    const normalizedHash = hash ? '#' + String(hash).replace(/^#/, '') : '';
    return `dashboard.html?v=${DASHBOARD_BUILD}${normalizedHash}`;
}

const SESSION_TOKEN_KEY = 'customerSessionToken';
const AUTH_STORAGE_KEYS = ['isLoggedIn', 'userName', 'userEmail', 'rememberMe', SESSION_TOKEN_KEY];
const SUPPORT_WHATSAPP_URL = 'https://wa.me/77072867777';

function getSessionToken() {
    const token = sessionStorage.getItem(SESSION_TOKEN_KEY) || localStorage.getItem(SESSION_TOKEN_KEY) || '';
    return /^ms_[A-Za-z0-9_-]{20,}$/.test(token) ? token : '';
}

function clearSession() {
    AUTH_STORAGE_KEYS.forEach((key) => {
        sessionStorage.removeItem(key);
        localStorage.removeItem(key);
    });
}

function storeSession(token, account, remember) {
    clearSession();
    const store = remember ? localStorage : sessionStorage;
    store.setItem(SESSION_TOKEN_KEY, token);
    store.setItem('isLoggedIn', 'true');
    store.setItem('userName', (account && account.name) || '');
    store.setItem('userEmail', (account && account.email) || '');
}

function updateStoredAccount(account) {
    if (!account) return;
    const store = localStorage.getItem(SESSION_TOKEN_KEY) ? localStorage : sessionStorage;
    store.setItem('userName', account.name || '');
    store.setItem('userEmail', account.email || '');
}

function getAuthValue(key) {
    return sessionStorage.getItem(key) || localStorage.getItem(key);
}

async function authRequest(path, { method = 'GET', body, token } = {}) {
    const session = token === undefined ? getSessionToken() : token;
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (session) headers.Authorization = 'Bearer ' + session;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60000);
    try {
        const response = await fetch(API_BASE + path, {
            method,
            headers,
            body: body === undefined ? undefined : JSON.stringify(body),
            signal: controller.signal
        });
        const data = await response.json();
        if (!data || typeof data !== 'object' || Array.isArray(data) || typeof data.ok !== 'boolean') {
            throw new Error('Некорректный ответ сервера. Попробуйте ещё раз позже.');
        }
        return { response, data };
    } finally {
        clearTimeout(timer);
    }
}

function getClientAccessToken() {
    const key = 'clientAccessToken';
    let token = localStorage.getItem(key) || '';
    if (!/^[a-f0-9]{64}$/i.test(token)) {
        if (!window.crypto || !window.crypto.getRandomValues) {
            throw new Error('Безопасное локальное хранилище недоступно. Откройте сайт через HTTPS.');
        }
        const bytes = new Uint8Array(32);
        window.crypto.getRandomValues(bytes);
        token = Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
        localStorage.setItem(key, token);
    }
    return token;
}

function isMotionEnabled() {
    return !window.matchMedia('(prefers-reduced-motion: reduce)').matches
        && document.body.getAttribute('data-motion') !== 'still';
}

function scrollToSection(selector) {
    const element = document.querySelector(selector);
    if (element) {
        element.scrollIntoView({ behavior: isMotionEnabled() ? 'smooth' : 'auto' });
    }
}

function isUserAuthenticated() {
    return Boolean(getSessionToken());
}

function handleHeroMatrixCTA() {
    if (isUserAuthenticated()) {
        window.location.href = getDashboardUrl('matrix');
        return;
    }
    openRegistrationModal();
}

function updateScrollProgress() {
    const bar = document.getElementById('scrollProgress');
    if (!bar) return;
    const scrollTop = window.scrollY || document.documentElement.scrollTop;
    const docHeight = document.documentElement.scrollHeight - window.innerHeight;
    const percent = docHeight > 0 ? (scrollTop / docHeight) * 100 : 0;
    bar.style.width = percent.toFixed(2) + '%';
}

// Счетчик статистики
const animateCountUp = () => {
    const statNumbers = document.querySelectorAll('.stat-number');
    
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting && !entry.target.animated) {
                const target = parseInt(entry.target.dataset.target);
                const increment = target / 100;
                let current = 0;
                
                const timer = setInterval(() => {
                    current += increment;
                    if (current >= target) {
                        entry.target.textContent = target;
                        clearInterval(timer);
                    } else {
                        entry.target.textContent = Math.floor(current);
                    }
                }, 10);
                
                entry.target.animated = true;
            }
        });
    });
    
    statNumbers.forEach(number => observer.observe(number));
};

// Ленивая загрузка анимаций при видимости
const observeElements = () => {
    const elements = document.querySelectorAll('.fade-in, .slide-in, .about-card, .service-item');
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.style.opacity = '1';
                entry.target.style.animation = reduceMotion
                    ? 'none'
                    : (entry.target.classList.contains('fade-in')
                        ? 'fadeIn var(--anim-medium, 0.65s) ease-out forwards'
                        : 'slideUp var(--anim-medium, 0.65s) ease-out forwards');
                observer.unobserve(entry.target);
            }
        });
    }, { threshold: 0.1 });

    elements.forEach(el => observer.observe(el));
};

// Ленивая загрузка частиц только при необходимости
let particlesInitialized = false;
const lazyInitParticles = () => {
    if (particlesInitialized) return;
    particlesInitialized = true;
    initMysticParticles();
};

// Активная навигация при прокрутке
const updateActiveNav = () => {
    const sections = document.querySelectorAll('section');
    const navLinks = document.querySelectorAll('.nav-link');
    
    window.addEventListener('scroll', () => {
        let current = '';
        
        sections.forEach(section => {
            const sectionTop = section.offsetTop;
            const sectionHeight = section.clientHeight;
            if (pageYOffset >= sectionTop - 100) {
                current = section.getAttribute('id');
            }
        });
        
        navLinks.forEach(link => {
            link.classList.remove('active');
            if (link.getAttribute('href') === '#' + current) {
                link.classList.add('active');
            }
        });
    });
};

// Обработка отправки формы
const handleFormSubmit = () => {
    const form = document.querySelector('.contact-form');
    if (!form) return;
    
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const submitBtn = form.querySelector('.submit-btn');
        const originalText = submitBtn.textContent;
        submitBtn.disabled = true;
        submitBtn.textContent = '⟳ Отправка...';

        const name = form.querySelector('[name="name"], #contact-name, input[placeholder*="имя"], input[placeholder*="Имя"]');
        const email = form.querySelector('[name="email"], #contact-email, input[type="email"]');
        const message = form.querySelector('[name="message"], #contact-message, textarea');

        try {
            const resp = await fetch(API_BASE + '/api/contact', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: name ? name.value : '',
                    email: email ? email.value : '',
                    message: message ? message.value : ''
                })
            });
            const data = await resp.json().catch(() => ({}));
            if (resp.ok && data.ok !== false) {
                submitBtn.textContent = '✓ Сообщение отправлено!';
                submitBtn.style.background = 'linear-gradient(135deg, #4CAF50, #45a049)';
                form.reset();
            } else {
                throw new Error(data.message || 'Ошибка');
            }
        } catch {
            showError('Не удалось отправить сообщение. Попробуйте позже.');
            submitBtn.textContent = 'Ошибка отправки';
        } finally {
            submitBtn.disabled = false;
            setTimeout(() => {
                submitBtn.textContent = originalText;
                submitBtn.style.background = '';
            }, 3000);
        }
    });
};

// Параллакс эффект при движении мыши
const mouseParallax = () => {
    const shapes = document.querySelectorAll('.floating-shape');
    
    document.addEventListener('mousemove', (e) => {
        const mouseX = e.clientX / window.innerWidth;
        const mouseY = e.clientY / window.innerHeight;
        
        shapes.forEach((shape, index) => {
            const speed = (index + 1) * 10;
            shape.style.transform = `translate(${mouseX * speed}px, ${mouseY * speed}px)`;
        });
    });
};

// Эффект появления навигации при прокрутке
let navbarScrollListenerAttached = false;
const navbarScroll = () => {
    const applyNavbarShadow = () => {
        const navbar = document.querySelector('.navbar');
        if (!navbar) return;
        if (window.scrollY > 50) {
            navbar.style.boxShadow = '0 5px 20px rgba(0, 0, 0, 0.15)';
        } else {
            navbar.style.boxShadow = '0 2px 10px rgba(0, 0, 0, 0.1)';
        }
    };

    // Применяем сразу на случай, если страница уже прокручена
    applyNavbarShadow();

    // Слушатель добавляем только один раз, чтобы не копить дубликаты
    if (!navbarScrollListenerAttached) {
        window.addEventListener('scroll', applyNavbarShadow, { passive: true });
        navbarScrollListenerAttached = true;
    }
};

// Анимация при наведении на карточки услуг
const serviceCardHover = () => {
    const serviceItems = document.querySelectorAll('.service-item, .mediumship-card');
    
    serviceItems.forEach(item => {
        item.addEventListener('mouseenter', function() {
            this.style.transform = 'translateY(-4px) scale(1.01)';
        });
        
        item.addEventListener('mouseleave', function() {
            this.style.transform = 'translateY(0) scale(1)';
        });
    });
};

// Волновая анимация удалена для оптимизации производительности
const waveAnimation = () => {};
const addWaveStyle = () => {};

// Прогрессивная загрузка изображений
const lazyLoad = () => {
    const images = document.querySelectorAll('img');
    
    const imageObserver = new IntersectionObserver((entries, observer) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const img = entry.target;
                img.style.opacity = '0';
                img.onload = () => {
                    img.style.transition = 'opacity 0.5s ease-out';
                    img.style.opacity = '1';
                };
                observer.unobserve(img);
            }
        });
    });
    
    images.forEach(img => imageObserver.observe(img));
};

/* ════════════════════════════════════════════════
   ✦ COSMIC DESIGN — SHOOTING STARS & SCROLL REVEAL
   ════════════════════════════════════════════════ */

/** Падающие звёзды — создаём N элементов и добавляем на страницу */
function initShootingStars() {
    const count = 6;
    for (let i = 0; i < count; i++) {
        const star = document.createElement('div');
        star.className = 'shooting-star';
        star.style.left  = (15 + Math.random() * 75) + 'vw';
        star.style.top   = (Math.random() * 50) + 'vh';
        star.style.setProperty('--ss-dur',   (2.2 + Math.random() * 2.8) + 's');
        star.style.setProperty('--ss-delay', (Math.random() * 14) + 's');
        document.body.appendChild(star);
    }
}

/** Scroll-reveal — добавляем класс .cosmic-reveal к карточкам и запускаем observer */
function initCosmicReveal() {
    if (!isMotionEnabled() || !('IntersectionObserver' in window)) return;
    const elements = document.querySelectorAll(
        '.section-heading, .experience-card, .portrait-card, .portrait-cta, .about-text, .about-feat-card, .faq-heading, .guest-review-form, .contact-heading, .section-footnote'
    );
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('revealed');
                setTimeout(() => { entry.target.style.transitionDelay = ''; }, 1200);
                observer.unobserve(entry.target);
            }
        });
    }, { threshold: 0.08, rootMargin: '0px 0px -25px 0px' });
    elements.forEach(el => {
        el.classList.add('cosmic-reveal');
        observer.observe(el);
    });
    document.querySelectorAll('.experience-card, .portrait-card').forEach((card) => {
        const index = Array.prototype.indexOf.call(card.parentElement.children, card);
        card.style.transitionDelay = `${index * 90}ms`;
    });
}

/** Кнопки — отслеживаем мышь для позиции ripple */
function initButtonRipple() {
    document.querySelectorAll('.btn-primary, .submit-btn, .cta-button, .plan-btn').forEach(btn => {
        btn.addEventListener('mousemove', (e) => {
            const rect = btn.getBoundingClientRect();
            btn.style.setProperty('--mx', ((e.clientX - rect.left) / rect.width * 100) + '%');
            btn.style.setProperty('--my', ((e.clientY - rect.top)  / rect.height * 100) + '%');
        });
    });
}

/** Параллакс hero-слоёв для глубины */
function initHeroLayerParallax() {
    const hero = document.querySelector('.hero');
    const pointer = window.matchMedia('(hover: hover) and (pointer: fine)');
    if (!hero) return;
    let frame = 0;
    let rx = 0;
    let ry = 0;
    const reset = () => {
        cancelAnimationFrame(frame);
        frame = 0;
        hero.style.setProperty('--stage-rx', '0deg');
        hero.style.setProperty('--stage-ry', '0deg');
    };
    hero.addEventListener('pointermove', (e) => {
        if (!isMotionEnabled() || !pointer.matches) return;
        const rect = hero.getBoundingClientRect();
        rx = -((e.clientY - rect.top) / rect.height - .5) * 7;
        ry = ((e.clientX - rect.left) / rect.width - .5) * 9;
        if (frame) return;
        frame = requestAnimationFrame(() => {
            hero.style.setProperty('--stage-rx', `${rx.toFixed(2)}deg`);
            hero.style.setProperty('--stage-ry', `${ry.toFixed(2)}deg`);
            frame = 0;
        });
    }, { passive: true });
    hero.addEventListener('pointerleave', reset);
    document.addEventListener('motionchange', reset);
    pointer.addEventListener('change', reset);
}

// Инициализация всех функций при загрузке страницы
document.addEventListener('DOMContentLoaded', () => {
    waveAnimation();
    addWaveStyle();
    observeElements();
    animateCountUp();
    mouseParallax();
    lazyLoad();
    initUnifiedAuraTracking();
    initMotionModes();
    initCosmicReveal();
    initButtonRipple();
    initHeroLayerParallax();

    updateActiveNav();
    navbarScroll();
    updateScrollProgress();
    handleFormSubmit();
    formGlowEffect();
    formProtection();
    serviceCardHover();
    checkLoginStatus();
    setupProfileMenuInteractions();
    initAtmosphereModes();
    initNavPrefsPanel();
    initHeroNebulaCanvas();
});

window.addEventListener('scroll', updateScrollProgress, { passive: true });
window.addEventListener('resize', updateScrollProgress);

// Случайная позиция фигур при загрузке
window.addEventListener('load', () => {
    const shapes = document.querySelectorAll('.floating-shape');
    shapes.forEach(shape => {
        const randomX = Math.random() * 200 - 100;
        const randomY = Math.random() * 200 - 100;
        shape.style.left = randomX + 'px';
        shape.style.top = randomY + 'px';
    });
});

// Защита от потери данных в форме + эффект свечения при фокусе
const formProtection = () => {
    const formInputs = document.querySelectorAll('.contact-form input, .contact-form textarea');
    let hasChanges = false;

    formInputs.forEach(input => {
        input.addEventListener('change', () => {
            hasChanges = true;
        });

        input.addEventListener('focus', function() {
            this.style.boxShadow = '0 0 0 3px rgba(102, 126, 234, 0.1), 0 0 15px rgba(102, 126, 234, 0.3)';
        });

        input.addEventListener('blur', function() {
            this.style.boxShadow = 'none';
        });
    });

    window.addEventListener('beforeunload', (e) => {
        if (hasChanges) {
            e.preventDefault();
            e.returnValue = '';
        }
    });
};

const formGlowEffect = () => formProtection();

/* ============================================
   ВАЛИДАЦИЯ И ИНДИКАТОРЫ ЗАГРУЗКИ
   ============================================ */

const FormValidator = {
    email: (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value),
    phone: (value) => /^[\d\s\-\+\(\)]{6,}$/.test(value),
    name: (value) => value.trim().length >= 2,
    text: (value) => value.trim().length >= 3,
    password: (value) => value.length >= 6,
    strongPassword: (value) => value.length >= 8 && value.length <= 128 && /\p{L}/u.test(value) && /\d/.test(value)
};

function showLoadingIndicator(element) {
    const btn = element.closest('form')?.querySelector('.submit-btn') || element;
    const originalText = btn.textContent;
    const originalDisabled = btn.disabled;

    btn.disabled = true;
    btn.innerHTML = '<span style="display:inline-block;margin-right:8px;">⟳</span>Загрузка...';
    btn.style.opacity = '0.7';

    return () => {
        btn.textContent = originalText;
        btn.disabled = originalDisabled;
        btn.style.opacity = '1';
    };
}

function validateField(input, validator) {
    const isValid = validator(input.value);
    const errorSpan = input.parentElement?.querySelector('.form-error');

    if (!isValid) {
        input.style.borderColor = '#E74C3C';
        if (errorSpan) {
            errorSpan.textContent = `Некорректное значение`;
            errorSpan.style.display = 'block';
        }
    } else {
        input.style.borderColor = '';
        if (errorSpan) {
            errorSpan.style.display = 'none';
        }
    }

    return isValid;
}

function validateForm(form, rules) {
    let isValid = true;
    Object.entries(rules).forEach(([selector, validator]) => {
        const input = form.querySelector(selector);
        if (input && !validateField(input, validator)) {
            isValid = false;
        }
    });
    return isValid;
}

// Дебаунс функция для управления событиями
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// Оптимизированная обработка скролла с debounce
window.addEventListener('scroll', debounce(() => {
    updateActiveNav();
    navbarScroll();
}, 100), { passive: true });

// Указание браузеру на предварительную загрузку ресурсов
if ('requestIdleCallback' in window) {
    requestIdleCallback(() => {
        // Предзагрузка изображений и других ресурсов
        const preloadLinks = document.querySelectorAll('link[rel="preload"]');
        preloadLinks.forEach(link => {
            link.rel = 'prefetch';
        });
    });
}

/* ============================================
   МИСТИЧЕСКИЕ ЭФФЕКТЫ — АТМОСФЕРА
   ============================================ */

// Плавающие мистические частицы-орбы
function initMysticParticles() {
    const configs = [
        { size: 6,  color: 'rgba(138,109,192,VAR)', op: 0.50, dur: 12, delay: 0    },
        { size: 4,  color: 'rgba(212,174,92,VAR)',  op: 0.40, dur: 16, delay: 3.5  },
        { size: 8,  color: 'rgba(138,109,192,VAR)', op: 0.35, dur: 10, delay: 1.8  },
        { size: 3,  color: 'rgba(255,255,255,VAR)', op: 0.30, dur: 18, delay: 6    },
        { size: 5,  color: 'rgba(196,162,74,VAR)',  op: 0.38, dur: 14, delay: 2.2  },
        { size: 4,  color: 'rgba(138,109,192,VAR)', op: 0.45, dur: 9,  delay: 4.7  },
        { size: 3,  color: 'rgba(212,174,92,VAR)',  op: 0.32, dur: 20, delay: 8    },
        { size: 6,  color: 'rgba(170,142,222,VAR)', op: 0.42, dur: 11, delay: 0.9  },
        { size: 5,  color: 'rgba(138,109,192,VAR)', op: 0.28, dur: 15, delay: 5.3  },
        { size: 4,  color: 'rgba(196,162,74,VAR)',  op: 0.36, dur: 13, delay: 7.1  },
    ];

    configs.forEach((cfg, i) => {
        const el = document.createElement('div');
        el.className = 'mystic-particle';
        const x = 5 + Math.random() * 90;
        const y = 10 + Math.random() * 80;
        const dx  = (Math.random() - 0.5) * 60;
        const dy  = -(30 + Math.random() * 80);
        const dx2 = (Math.random() - 0.5) * 50;
        const dy2 = -(100 + Math.random() * 100);
        const color = cfg.color.replace('VAR', '1');
        Object.assign(el.style, {
            width:  cfg.size + 'px',
            height: cfg.size + 'px',
            left:   x + 'vw',
            top:    y + 'vh',
            background: `radial-gradient(circle, ${color} 0%, transparent 100%)`,
            boxShadow: `0 0 ${cfg.size * 3}px ${color}`,
            '--op':    cfg.op,
            '--dur':   cfg.dur + 's',
            '--delay': cfg.delay + 's',
            '--dx':    dx + 'px',
            '--dy':    dy + 'px',
            '--dx2':   dx2 + 'px',
            '--dy2':   dy2 + 'px',
        });
        document.body.appendChild(el);
    });
}

// Аура курсора внутри карточек
function initCardAura() {
    const cards = document.querySelectorAll('.mediumship-card, .service-item');
    cards.forEach(card => {
        card.addEventListener('mousemove', (e) => {
            const rect = card.getBoundingClientRect();
            const x = ((e.clientX - rect.left) / rect.width  * 100).toFixed(1) + '%';
            const y = ((e.clientY - rect.top)  / rect.height * 100).toFixed(1) + '%';
            card.style.setProperty('--card-mx', x);
            card.style.setProperty('--card-my', y);
        });
    });
}

// Универсальный трекинг курсора для мягкой ауры карточек
function initUnifiedAuraTracking() {
    const cards = document.querySelectorAll(
        '.experience-card, .portrait-card, .about-feat-card, .testimonial-card'
    );
    const pointer = window.matchMedia('(hover: hover) and (pointer: fine)');
    cards.forEach(card => {
        card.addEventListener('pointermove', (e) => {
            if (!pointer.matches || !isMotionEnabled()) return;
            const rect = card.getBoundingClientRect();
            const x = ((e.clientX - rect.left) / rect.width * 100).toFixed(1) + '%';
            const y = ((e.clientY - rect.top) / rect.height * 100).toFixed(1) + '%';
            card.style.setProperty('--mx', x);
            card.style.setProperty('--my', y);
        }, { passive: true });
    });
}

// Пароль проверяется только на backend — не хранится в клиентском коде
const API_BASE = (() => {
    const PROD_API = 'https://roza-ogly-api.onrender.com';
    let saved = '';
    try { saved = (localStorage.getItem('apiBaseUrl') || '').trim().replace(/\/$/, ''); } catch { saved = ''; }
    if (saved && saved !== PROD_API) { try { localStorage.removeItem('apiBaseUrl'); } catch {} }
    const isLocalHost = ['127.0.0.1', 'localhost'].includes(window.location.hostname);
    if (isLocalHost) {
        return 'http://127.0.0.1:5000';
    }
    return PROD_API;
})();
window.API_BASE = API_BASE;

function escapeHtml(value) {
    return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function safeHttpUrl(value) {
    try {
        const url = new URL(String(value || '').trim(), window.location.href);
        return (url.protocol === 'http:' || url.protocol === 'https:') ? url.href : '';
    } catch {
        return '';
    }
}

function getStorageArray(key) {
    try {
        return JSON.parse(localStorage.getItem(key) || '[]');
    } catch {
        return [];
    }
}

function setStorageArray(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
}

function addAdminRecord(key, payload) {
    const items = getStorageArray(key);
    items.unshift({ id: Date.now(), createdAt: new Date().toISOString(), ...payload });
    setStorageArray(key, items.slice(0, 200));
}

// Функции для работы с модальными окнами входа

function openLoginModal() {
    const modal = document.getElementById('loginModal');
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
}

function closeLoginModal() {
    const modal = document.getElementById('loginModal');
    modal.classList.remove('active');
    document.body.style.overflow = 'auto';
}

function openRegistrationModal() {
    closeLoginModal();
    const modal = document.getElementById('registrationModal');
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
}

function closeRegistrationModal() {
    const modal = document.getElementById('registrationModal');
    modal.classList.remove('active');
    document.body.style.overflow = 'auto';
}

function openForgotPasswordModal() {
    if (document.getElementById('forgotPasswordModal')) {
        return;
    }

    const message = 'Здравствуйте! Не могу войти в личный кабинет. Подскажите, какие есть варианты восстановления доступа.';
    const whatsappUrl = SUPPORT_WHATSAPP_URL + '?text=' + encodeURIComponent(message);

    const modal = document.createElement('div');
    modal.className = 'modal active';
    modal.id = 'forgotPasswordModal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'forgotPasswordTitle');
    modal.innerHTML = `
        <div class="modal-content">
            <button class="close-modal" type="button" aria-label="Закрыть">×</button>
            <div class="modal-header">
                <h2 id="forgotPasswordTitle">Восстановление доступа</h2>
                <p>Автоматический сброс пароля пока не подключён. Напишите мастеру в WhatsApp, чтобы уточнить доступные варианты. Восстановление доступа может быть недоступно.</p>
            </div>
            <div class="login-form">
                <a class="submit-btn" href="${escapeHtml(safeHttpUrl(whatsappUrl))}" target="_blank" rel="noopener noreferrer" style="display:flex;align-items:center;justify-content:center;text-decoration:none">Написать в WhatsApp</a>
                <p class="modal-note" style="margin-top:14px">Никому не сообщайте свой пароль — мастер его никогда не спрашивает.</p>
            </div>
        </div>
    `;

    document.body.appendChild(modal);
    document.body.style.overflow = 'hidden';

    const closeModal = () => {
        modal.remove();
        document.body.style.overflow = 'auto';
    };

    modal.querySelector('.close-modal')?.addEventListener('click', closeModal);
    modal.addEventListener('click', (event) => {
        if (event.target === modal) {
            closeModal();
        }
    });
    document.addEventListener('keydown', function onKey(event) {
        if (event.key === 'Escape') {
            closeModal();
            document.removeEventListener('keydown', onKey);
        }
    });
}

document.addEventListener('click', (event) => {
    const forgotLink = event.target.closest('.forgot-password');
    if (!forgotLink) {
        return;
    }
    event.preventDefault();
    openForgotPasswordModal();
});

// Закрытие модального окна при клике на фон
document.addEventListener('DOMContentLoaded', () => {
    const loginModal = document.getElementById('loginModal');
    const registrationModal = document.getElementById('registrationModal');
    
    window.addEventListener('click', (event) => {
        if (event.target === loginModal) {
            closeLoginModal();
        }
        if (event.target === registrationModal) {
            closeRegistrationModal();
        }
    });
    
    // Закрытие при нажатии Escape
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            closeLoginModal();
            closeRegistrationModal();
        }
    });
});

// Переключение видимости пароля
function togglePassword(btn) {
    const passwordInput = document.getElementById('password');
    const button = btn || event.currentTarget;
    if (passwordInput.type === 'password') {
        passwordInput.type = 'text';
        if (button) button.textContent = '🙈';
    } else {
        passwordInput.type = 'password';
        if (button) button.textContent = '👁️';
    }
}

function toggleRegistrationPassword(btn) {
    const passwordInput = document.getElementById('reg-password');
    const button = btn || event.currentTarget;
    if (passwordInput.type === 'password') {
        passwordInput.type = 'text';
        if (button) button.textContent = '🙈';
    } else {
        passwordInput.type = 'password';
        if (button) button.textContent = '👁️';
    }
}

function authNetworkError(error) {
    return error && error.name === 'AbortError'
        ? 'Сервер долго не отвечает — возможно, он просыпается. Повторите через минуту.'
        : 'Сервер авторизации недоступен. Проверьте интернет и попробуйте ещё раз.';
}

// Обработка формы входа
document.addEventListener('DOMContentLoaded', () => {
    const loginForm = document.getElementById('loginFormElement');
    if (!loginForm) return;

    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('email').value.trim();
        const password = document.getElementById('password').value;
        const remember = document.getElementById('rememberMe').checked;

        if (!email || !password) {
            showError('Пожалуйста, заполните все поля');
            return;
        }
        if (!FormValidator.email(email)) {
            showError('Введите корректный email');
            return;
        }

        const resetBtn = showLoadingIndicator(loginForm.querySelector('.submit-btn'));
        try {
            const { response, data } = await authRequest('/api/auth/login', {
                method: 'POST',
                body: { email, password, remember },
                token: ''
            });
            if (!response.ok || !data.ok || !data.token) {
                showError(data.message || 'Не удалось войти. Попробуйте ещё раз.');
                return;
            }
            storeSession(data.token, data.account, remember);
            loginForm.reset();
            completeLogin(data.account);
        } catch (error) {
            showError(authNetworkError(error));
        } finally {
            resetBtn();
        }
    });
});

// Обработка формы регистрации
document.addEventListener('DOMContentLoaded', () => {
    const registrationForm = document.getElementById('registrationFormElement');
    if (!registrationForm) return;

    registrationForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = document.getElementById('name').value.trim();
        const email = document.getElementById('reg-email').value.trim();
        const password = document.getElementById('reg-password').value;
        const confirmPassword = document.getElementById('confirm-password').value;
        const agree = document.getElementById('agree').checked;

        if (!name || !email || !password || !confirmPassword) {
            showError('Пожалуйста, заполните все поля');
            return;
        }
        if (!FormValidator.name(name)) {
            showError('Имя должно содержать не менее 2 символов');
            return;
        }
        if (!FormValidator.email(email)) {
            showError('Введите корректный email');
            return;
        }
        if (!FormValidator.strongPassword(password)) {
            showError('Пароль: 8–128 символов, минимум одна буква и одна цифра');
            return;
        }
        if (password !== confirmPassword) {
            showError('Пароли не совпадают');
            return;
        }
        if (!agree) {
            showError('Пожалуйста, согласитесь с условиями использования');
            return;
        }

        const resetBtn = showLoadingIndicator(registrationForm.querySelector('.submit-btn'));
        try {
            const { response, data } = await authRequest('/api/auth/register', {
                method: 'POST',
                body: { name, email, password, remember: true },
                token: ''
            });
            if (!response.ok || !data.ok || !data.token) {
                showError(data.message || 'Не удалось создать аккаунт. Попробуйте ещё раз.');
                return;
            }
            storeSession(data.token, data.account, true);
            registrationForm.reset();
            completeLogin(data.account);
        } catch (error) {
            showError(authNetworkError(error));
        } finally {
            resetBtn();
        }
    });
});

function syncDrawerAccount(loggedIn, userName) {
    const label = document.getElementById('drawerAccountLabel');
    const hint = document.getElementById('drawerAccountHint');
    const avatar = document.getElementById('drawerAccountAvatar');
    const logoutLink = document.getElementById('drawerLogoutLink');
    const name = String(userName || '').trim();
    if (label) label.textContent = loggedIn ? 'Мой кабинет' : 'Войти в кабинет';
    if (hint) hint.textContent = loggedIn ? (name ? `${name} · расчёты и разборы` : 'Расчёты, разборы и сеансы') : 'Сохраняйте расчёты и полные разборы';
    if (avatar) avatar.textContent = loggedIn ? (name.charAt(0).toUpperCase() || '◈') : '◈';
    if (logoutLink) logoutLink.hidden = !loggedIn;
}

function openCabinetFromDrawer(event) {
    toggleMobileMenu();
    if (isUserAuthenticated()) return;
    event.preventDefault();
    openLoginModal();
}

function applyLoggedInUi(userName) {
    const loginBtn = document.querySelector('.login-btn');
    const userProfile = document.getElementById('userProfile');
    const profileAvatar = document.querySelector('.profile-avatar');
    if (loginBtn) loginBtn.style.display = 'none';
    if (userProfile) {
        userProfile.classList.remove('hidden');
        userProfile.classList.remove('open');
    }
    if (profileAvatar) {
        profileAvatar.textContent = (userName || '•').trim().charAt(0).toUpperCase() || '•';
    }
    syncDrawerAccount(true, userName);
}

function applyLoggedOutUi() {
    const loginBtn = document.querySelector('.login-btn');
    const userProfile = document.getElementById('userProfile');
    if (loginBtn) loginBtn.style.display = '';
    if (userProfile) {
        userProfile.classList.add('hidden');
        userProfile.classList.remove('open');
    }
    syncDrawerAccount(false);
}

function completeLogin(account) {
    const userName = (account && account.name) || 'гость';
    applyLoggedInUi(userName);
    closeRegistrationModal();
    closeLoginModal();
    showSuccess(`Добро пожаловать, ${userName}!`);
    setTimeout(() => {
        window.location.href = getDashboardUrl();
    }, 800);
}

function openAuthFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const mode = params.get('auth');
    if (!mode) return;
    const reason = params.get('reason');
    params.delete('auth');
    params.delete('reason');
    const query = params.toString();
    history.replaceState(null, '', window.location.pathname + (query ? '?' + query : '') + window.location.hash);
    if (isUserAuthenticated()) return;
    if (mode === 'register') {
        openRegistrationModal();
    } else {
        openLoginModal();
    }
    if (reason === 'expired') {
        showError('Сессия истекла. Войдите снова.');
    }
}

// Проверка входа при загрузке: сессию подтверждает сервер
function checkLoginStatus() {
    const token = getSessionToken();
    if (!token) {
        if (getAuthValue('isLoggedIn')) clearSession();
        applyLoggedOutUi();
        openAuthFromUrl();
        return;
    }

    applyLoggedInUi(getAuthValue('userName') || '');
    openAuthFromUrl();
    authRequest('/api/auth/me', { token })
        .then(({ response, data }) => {
            if (response.status === 401) {
                clearSession();
                applyLoggedOutUi();
                return;
            }
            if (response.ok && data.account) {
                updateStoredAccount(data.account);
                applyLoggedInUi(data.account.name);
            }
        })
        .catch(() => {});
}

function toggleProfileMenu(event) {
    event.stopPropagation();
    const userProfile = document.getElementById('userProfile');
    if (!userProfile || userProfile.classList.contains('hidden')) {
        return;
    }
    userProfile.classList.toggle('open');
}

function setupProfileMenuInteractions() {
    const userProfile = document.getElementById('userProfile');
    if (!userProfile) {
        return;
    }

    document.addEventListener('click', (event) => {
        if (!userProfile.classList.contains('hidden') && !userProfile.contains(event.target)) {
            userProfile.classList.remove('open');
        }
    });

    userProfile.querySelectorAll('.profile-link').forEach((link) => {
        link.addEventListener('click', () => {
            userProfile.classList.remove('open');
        });
    });
}

// Функция выхода
function logout() {
    const token = getSessionToken();
    clearSession();
    applyLoggedOutUi();
    showSuccess('Вы вышли из аккаунта');
    if (token) {
        authRequest('/api/auth/logout', { method: 'POST', body: {}, token }).catch(() => {});
    }
}

// Обработка формы записи на главной странице
document.addEventListener('DOMContentLoaded', () => {
    const bookingForm = document.getElementById('bookingFormElement');
    if (!bookingForm) {
        return;
    }

    const dateField = bookingForm.querySelector('input[type="date"]');
    const timeField = bookingForm.querySelector('input[type="time"]');
    const serviceField = bookingForm.querySelector('select');
    const slotRoot = document.getElementById('mainBookingSlots');
    const insightText = document.getElementById('bookingInsightText');
    const insightDuration = document.getElementById('bookingInsightDuration');
    const insightPrice = document.getElementById('bookingInsightPrice');

    const serviceAdvice = {
        tarot: {
            duration: '40-60 мин',
            price: 'от 5 000 ₸',
            text: 'Идеально для выбора между вариантами и понимания ближайшего периода.'
        },
        spirits: {
            duration: '60-90 мин',
            price: 'от 10 000 ₸',
            text: 'Бережный глубокий формат. Лучше выбрать спокойное время без спешки.'
        },
        cleaning: {
            duration: '60 мин',
            price: 'от 7 500 ₸',
            text: 'Рекомендуется после эмоциональной перегрузки и ощущения утечки сил.'
        },
        astro: {
            duration: '60-90 мин',
            price: 'от 9 000 ₸',
            text: 'Подходит для планирования важных шагов на месяц/год вперед.'
        },
        reiki: {
            duration: '45 мин',
            price: 'от 6 000 ₸',
            text: 'Мягкая энергетическая настройка, хорошо сочетается с восстановлением сна.'
        },
        coaching: {
            duration: '90 мин',
            price: 'от 12 500 ₸',
            text: 'Долгий формат для системных изменений и индивидуальной стратегии.'
        }
    };

    function renderBookingInsight() {
        if (!serviceField || !insightText || !insightDuration || !insightPrice) return;
        const value = serviceField.value;
        const advice = serviceAdvice[value];
        if (!advice) {
            insightText.textContent = 'Выберите услугу, чтобы увидеть длительность, ориентир стоимости и подготовку к сеансу.';
            insightDuration.textContent = 'Длительность: —';
            insightPrice.textContent = 'Стоимость: —';
            return;
        }
        insightText.textContent = advice.text;
        insightDuration.textContent = 'Длительность: ' + advice.duration;
        insightPrice.textContent = 'Стоимость: ' + advice.price;
    }

    async function loadSlotHints() {
        if (!dateField || !slotRoot) return;
        const date = (dateField.value || '').trim();
        if (!date) {
            slotRoot.innerHTML = '';
            return;
        }
        const qs = new URLSearchParams({ date });
        if (timeField && timeField.value) {
            qs.set('time', timeField.value);
        }
        try {
            const response = await fetch(API_BASE + '/api/bookings/slots?' + qs.toString());
            const data = await response.json();
            if (!response.ok || !data.ok) {
                slotRoot.innerHTML = '<div class="slot-hint-empty">Не удалось загрузить свободные слоты</div>';
                return;
            }
            const list = (data.available || []).slice(0, 8);
            if (!list.length) {
                slotRoot.innerHTML = '<div class="slot-hint-empty">На эту дату нет свободных слотов</div>';
                return;
            }
            slotRoot.innerHTML = '<div class="slot-hint-title">Свободное время:</div>'
                + '<div class="slot-chip-row">'
                + list.map((t) => '<button type="button" class="slot-chip" data-time="' + escapeHtml(t) + '">' + escapeHtml(t) + '</button>').join('')
                + '</div>';
            slotRoot.querySelectorAll('.slot-chip').forEach((btn) => {
                btn.addEventListener('click', () => {
                    if (timeField) {
                        timeField.value = btn.getAttribute('data-time') || '';
                    }
                });
            });
        } catch {
            slotRoot.innerHTML = '<div class="slot-hint-empty">Сервер недоступен, подсказки времени временно отключены</div>';
        }
    }

    if (dateField) {
        dateField.addEventListener('change', loadSlotHints);
    }
    if (timeField) {
        timeField.addEventListener('change', loadSlotHints);
    }
    if (serviceField) {
        serviceField.addEventListener('change', renderBookingInsight);
    }

    renderBookingInsight();

    bookingForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const nameField = bookingForm.querySelector('input[type="text"]');
        const phoneField = bookingForm.querySelector('input[type="tel"]');
        const emailField = bookingForm.querySelector('input[type="email"]');
        const noteField = bookingForm.querySelector('textarea');

        // Валидация
        if (!validateField(nameField, FormValidator.name) ||
            !validateField(phoneField, FormValidator.phone) ||
            !validateField(emailField, FormValidator.email)) {
            showError('Пожалуйста, заполните все поля корректно');
            return;
        }

        const resetBtn = showLoadingIndicator(bookingForm.querySelector('.submit-btn'));
        let accessToken;
        try {
            accessToken = getClientAccessToken();
        } catch (error) {
            showError(error.message);
            resetBtn();
            return;
        }

        const payload = {
            name: nameField ? nameField.value.trim() : '',
            phone: phoneField ? phoneField.value.trim() : '',
            email: emailField ? emailField.value.trim() : '',
            service: serviceField ? serviceField.options[serviceField.selectedIndex].text : '',
            date: dateField ? dateField.value : '',
            time: timeField ? timeField.value : '',
            format: 'Запись через сайт',
            note: noteField ? noteField.value.trim() : '',
            accessToken
        };

        try {
            const headers = { 'Content-Type': 'application/json' };
            const sessionToken = getSessionToken();
            if (sessionToken) headers.Authorization = 'Bearer ' + sessionToken;
            const response = await fetch(API_BASE + '/api/bookings', {
                method: 'POST',
                headers,
                body: JSON.stringify(payload)
            });
            const data = await response.json().catch(() => ({}));
            if (response.status === 401 && data.sessionExpired) {
                clearSession();
                applyLoggedOutUi();
                showError('Сессия истекла. Войдите снова или отправьте запись как гость.');
                resetBtn();
                return;
            }
            if (!response.ok) {
                if (data && data.conflict) {
                    showError((data.message || 'Это время занято') + (data.suggestedTime ? (' Рекомендуем: ' + data.suggestedTime) : ''));
                    if (data.suggestedTime && timeField) {
                        timeField.value = data.suggestedTime;
                    }
                    await loadSlotHints();
                    resetBtn();
                    return;
                }
                showError(data.message || 'Не удалось записаться');
                resetBtn();
                return;
            }

            addAdminRecord('bookings', {
                name: payload.name || 'Не указано',
                email: payload.email || 'Не указано',
                service: payload.service || 'Не указано',
                date: payload.date,
                time: payload.time,
                source: 'index-booking-api'
            });

            bookingForm.reset();
            if (slotRoot) slotRoot.innerHTML = '';
            showSuccess(sessionToken
                ? '✓ Запись сохранена. Она появилась в личном кабинете — мастер свяжется с вами для подтверждения.'
                : '✓ Запись сохранена. Мастер свяжется с вами для подтверждения.');
            resetBtn();
        } catch (error) {
            showError('Сервер записи недоступен. Проверьте соединение и повторите попытку.');
            resetBtn();
        }
    });
});

function renderGuestReviews() {
    const list = document.getElementById('guestReviewsList');
    if (!list) {
        return;
    }

    const defaults = [
        { name: 'Айгерим', rating: 5, text: 'Очень спокойная и профессиональная консультация. После сеанса стало легче принимать решения.' },
        { name: 'Нурлан', rating: 5, text: 'Понравилась точность расклада и поддержка после встречи. Рекомендую.' },
        { name: 'Жанна', rating: 4, text: 'Уютная атмосфера и сильная энергетика. Спасибо за внимание к деталям.' }
    ];

    const stored = getStorageArray('guestReviews');
    const reviews = stored.length ? stored : defaults;

    list.innerHTML = reviews
        .slice(0, 12)
        .map((item) => {
            const rating = Math.min(5, Math.max(0, Math.round(Number(item.rating || 5)) || 0));
            const stars = '★★★★★'.slice(0, rating) + '☆☆☆☆☆'.slice(0, 5 - rating);
            return `
                <article class="guest-item">
                    <div class="guest-item-head">
                        <span class="guest-item-name">${escapeHtml(item.name)}</span>
                        <span class="guest-item-stars">${stars}</span>
                    </div>
                    <p class="guest-item-text">${escapeHtml(item.text)}</p>
                </article>
            `;
        })
        .join('');
}

document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('guestReviewForm');
    renderGuestReviews();

    if (!form) {
        return;
    }

    form.addEventListener('submit', (e) => {
        e.preventDefault();
        const name = document.getElementById('guestName').value.trim();
        const rating = Number(document.getElementById('guestRating').value || 5);
        const text = document.getElementById('guestText').value.trim();

        // Валидация
        if (!validateField(form.querySelector('#guestName'), FormValidator.name) ||
            !validateField(form.querySelector('#guestText'), FormValidator.text)) {
            showError('Заполните имя и текст отзыва корректно');
            return;
        }

        if (!name || !text) {
            showError('Заполните имя и текст отзыва');
            return;
        }

        const resetBtn = showLoadingIndicator(form.querySelector('.submit-btn'));

        const items = getStorageArray('guestReviews');
        items.unshift({ name, rating, text, createdAt: new Date().toISOString() });
        setStorageArray('guestReviews', items.slice(0, 40));
        addAdminRecord('guestReviews', { name, rating, text, source: 'site-guest-review' });

        form.reset();
        renderGuestReviews();
        showSuccess('✓ Спасибо! Ваш отзыв опубликован.');
        resetBtn();
    });
});

async function renderPublicContent() {
    const root = document.getElementById('publicContentList');
    if (!root) {
        return;
    }

    root.innerHTML = '<div class="public-item"><p>⟳ Загрузка...</p></div>';

    try {
        const response = await fetch(API_BASE + '/api/content', {
            signal: AbortSignal.timeout(5000)
        });

        const data = await response.json();

        if (!response.ok || !data.ok) {
            root.innerHTML = '<div class="public-item"><p>⚠ Материалы скоро появятся.</p></div>';
            return;
        }

        const names = {
            story: 'История',
            doc: 'Документ',
            photo: 'Фото',
            video: 'Видео'
        };

        const items = (data.items || []).slice(0, 20);
        if (!items.length) {
            root.innerHTML = '<div class="public-item"><p>Пока нет публикаций.</p></div>';
            return;
        }

        root.innerHTML = items.map((item) => {
            const kind = escapeHtml(names[item.kind] || item.kind);
            const mediaUrl = safeHttpUrl(item.media_url);
            const link = mediaUrl ? '<a href="' + escapeHtml(mediaUrl) + '" target="_blank" rel="noopener noreferrer">Открыть →</a>' : '';
            const body = escapeHtml(item.body ? item.body : 'Без описания');
            return '<article class="public-item">'
                + '<div class="kind">' + kind + '</div>'
                + '<h3>' + escapeHtml(item.title || 'Без названия') + '</h3>'
                + '<p>' + body + '</p>'
                + link
                + '</article>';
        }).join('');
    } catch (error) {
        if (error.name === 'AbortError') {
            root.innerHTML = '<div class="public-item"><p>⚠ Загрузка заняла слишком много времени.</p></div>';
        } else {
            root.innerHTML = '<div class="public-item"><p>⚠ Не удалось загрузить публикации.</p></div>';
        }
    }
}

document.addEventListener('DOMContentLoaded', renderPublicContent);

// Показ сообщения об ошибке
function showError(message) {
    const notification = document.createElement('div');
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: #E74C3C;
        color: white;
        padding: 16px 24px;
        border-radius: 10px;
        box-shadow: 0 5px 15px rgba(0, 0, 0, 0.2);
        z-index: 9999;
        animation: slideUp 0.3s ease;
        font-weight: 600;
    `;
    notification.textContent = message;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.style.animation = 'fadeIn 0.3s ease reverse';
        setTimeout(() => notification.remove(), 300);
    }, 4000);
}

// Показ сообщения об успехе
function showSuccess(message) {
    const notification = document.createElement('div');
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: #27AE60;
        color: white;
        padding: 16px 24px;
        border-radius: 10px;
        box-shadow: 0 5px 15px rgba(0, 0, 0, 0.2);
        z-index: 9999;
        animation: slideUp 0.3s ease;
        font-weight: 600;
    `;
    notification.textContent = message;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.style.animation = 'fadeIn 0.3s ease reverse';
        setTimeout(() => notification.remove(), 300);
    }, 4000);
}

/* ============================================
   ИНТЕРАКТИВНЫЕ ФУНКЦИИ
   ============================================ */

// Данные для гаданий
const tarotCards = [
    { name: "Маг", meaning: "Начало, инициатива, самоопределение" },
    { name: "Верховная Жрица", meaning: "Интуиция, миролюбивость, скрытые знания" },
    { name: "Императрица", meaning: "Плодородие, красота, природная власть" },
    { name: "Император", meaning: "Власть, лидерство, отцовство" },
    { name: "Иерофант", meaning: "Духовность, ритуал, традиция" },
    { name: "Влюбленные", meaning: "Любовь, гармония, ценности" },
    { name: "Колесница", meaning: "Контроль, воля, целеустремленность" },
    { name: "Отшельник", meaning: "Размышление, осторожность, поиск" },
    { name: "Колесо Судьбы", meaning: "Судьба, новые циклы, удача" },
    { name: "Справедливость", meaning: "Справедливость, равновесие, правда" }
];

const dailyAdvices = [
    "Сегодня - хороший день для новых начинаний. Не бойтесь делать первый шаг!",
    "Обратите внимание на свою интуицию. Она подскажет вам правильный путь.",
    "День благоприятен для медитации и размышлений. Найдите время для себя.",
    "Энергия сегодня поддерживает общение с любимыми людьми. Свяжитесь с ними!",
    "День требует действия. Не откладывайте важные дела на потом.",
    "Слушайте звёзды. Вселенная посылает вам положительные знак.",
    "Хороший день для творчества и самовыражения. Позвольте себе быть собой.",
    "День благоприятен для переговоров и компромиссов.",
    "Сегодня хороший день для исцеления и гармонии. Позаботьтесь о себе.",
    "Энергия дня поддерживает финансовые начинания. Рассмотрите возможности."
];

// Гадание с картами таро
function drawTarotCard() {
    const cardResult = document.getElementById('cardResult');
    const randomIndex = Math.floor(Math.random() * tarotCards.length);
    const card = tarotCards[randomIndex];
    
    cardResult.innerHTML = `
        <h4 style="color: var(--primary); margin-bottom: 10px;">Ваша Карта: ${card.name}</h4>
        <p style="margin: 0; font-size: 14px; line-height: 1.6;">
            <strong>Значение:</strong> ${card.meaning}
        </p>
    `;
    cardResult.classList.remove('hidden');
}

// Число удачи
function getLuckyNumber() {
    const numberResult = document.getElementById('numberResult');
    const luckyNumber = Math.floor(Math.random() * 100) + 1;
    const significance = {
        lucky: luckyNumber % 2 === 0 ? 'четное (стабильность)' : 'нечетное (динамика)',
        meaning: luckyNumber < 33 ? 'энергия новых начинаний' : luckyNumber < 67 ? 'баланс и гармония' : 'высокая вибрация и успех'
    };
    
    numberResult.innerHTML = `
        <h4 style="color: var(--primary); margin-bottom: 10px; font-size: 32px; font-weight: 700;">
            ✨ ${luckyNumber}
        </h4>
        <p style="margin: 0; font-size: 14px;">
            <strong>Тип:</strong> ${significance.lucky}<br>
            <strong>Значение:</strong> ${significance.meaning}
        </p>
    `;
    numberResult.classList.remove('hidden');
}

// Совет дня
function getDailyAdvice() {
    const adviceResult = document.getElementById('adviceResult');
    const randomIndex = Math.floor(Math.random() * dailyAdvices.length);
    const advice = dailyAdvices[randomIndex];
    
    adviceResult.innerHTML = `
        <p style="margin: 0; font-size: 16px; line-height: 1.8; font-style: italic;">
            "💫 ${advice}"
        </p>
    `;
    adviceResult.classList.remove('hidden');
}

// Инициализация при загрузке страницы
document.addEventListener('DOMContentLoaded', checkLoginStatus);
document.addEventListener('DOMContentLoaded', setupProfileMenuInteractions);

const MOTION_LEVELS = ['still', 'soft', 'normal', 'cinema'];

function applyAtmosphere(atmo) {
    const allowed = ['ritual', 'lunar', 'oracle'];
    const safe = allowed.includes(atmo) ? atmo : 'ritual';
    document.body.setAttribute('data-atmo', safe);
    localStorage.setItem('atmo', safe);
    document.querySelectorAll('.atmo-btn').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.atmo === safe);
    });
}

function initAtmosphereModes() {
    const root = document.getElementById('atmoSwitcher');
    if (!root) return;
    root.querySelectorAll('.atmo-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
            applyAtmosphere(btn.dataset.atmo || 'ritual');
        });
    });
    applyAtmosphere(localStorage.getItem('atmo') || 'ritual');
}

function initHeroNebulaCanvas() {
    const canvas = document.getElementById('heroNebulaCanvas');
    const hero = document.querySelector('.hero');
    if (!canvas || !hero) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const stars = Array.from({ length: 60 }, () => ({
        x: Math.random(),
        y: Math.random(),
        radius: .35 + Math.random() * 1.1,
        phase: Math.random() * Math.PI * 2
    }));
    let w = 0;
    let h = 0;
    let frame = 0;
    let previous = 0;
    let elapsed = 0;
    let visible = true;
    const paint = () => {
        ctx.clearRect(0, 0, w, h);
        stars.slice(0, w < 600 ? 30 : 60).forEach(star => {
            const phase = elapsed * .00025 + star.phase;
            const x = star.x * w + Math.sin(phase) * 12;
            const y = star.y * h + Math.cos(phase * .7) * 10;
            ctx.fillStyle = `rgba(222, 214, 194, ${.18 + (Math.sin(phase) + 1) * .16})`;
            ctx.beginPath();
            ctx.arc(x, y, star.radius, 0, Math.PI * 2);
            ctx.fill();
        });
    };
    const draw = timestamp => {
        if (timestamp - previous >= 1000 / 30) {
            const scale = { soft: .5, normal: 1, cinema: 1.6 }[document.body.dataset.motion] || 1;
            elapsed += Math.min(timestamp - previous, 60) * scale;
            previous = timestamp;
            paint();
        }
        frame = requestAnimationFrame(draw);
    };
    const reconcile = () => {
        const active = visible && !document.hidden && !reducedMotion.matches && document.body.dataset.motion !== 'still';
        canvas.dataset.animationState = active ? 'running' : 'paused';
        document.body.classList.toggle('page-idle', document.hidden);
        if (active && !frame) {
            previous = performance.now();
            frame = requestAnimationFrame(draw);
        } else if (!active && frame) {
            cancelAnimationFrame(frame);
            frame = 0;
        }
    };
    const resize = () => {
        const rect = hero.getBoundingClientRect();
        const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
        w = Math.max(1, Math.floor(rect.width));
        h = Math.max(1, Math.floor(rect.height));
        canvas.width = Math.round(w * ratio);
        canvas.height = Math.round(h * ratio);
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
        paint();
    };
    resize();
    window.addEventListener('resize', resize, { passive: true });
    document.addEventListener('visibilitychange', reconcile);
    document.addEventListener('motionchange', reconcile);
    reducedMotion.addEventListener('change', reconcile);
    if ('IntersectionObserver' in window) {
        new IntersectionObserver(entries => {
            visible = entries[0].isIntersecting;
            hero.classList.toggle('ambient-offscreen', !visible);
            reconcile();
        }).observe(hero);
    }
    reconcile();
}

function applyMotionLevel(level) {
    const safe = MOTION_LEVELS.includes(level) ? level : 'normal';
    document.body.setAttribute('data-motion', safe);
    document.documentElement.setAttribute('data-motion', safe);
    localStorage.setItem('motionLevel', safe);
    document.querySelectorAll('.motion-btn').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.motion === safe);
        btn.setAttribute('aria-pressed', String(btn.dataset.motion === safe));
    });
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    document.body.classList.toggle('motion-reduced', reduced);
    const toggle = document.getElementById('ambientToggle');
    if (toggle) {
        toggle.disabled = reduced;
        toggle.setAttribute('aria-pressed', String(reduced || safe === 'still'));
        toggle.querySelector('.motion-control-icon').textContent = reduced || safe === 'still' ? '▷' : 'Ⅱ';
        toggle.querySelector('.motion-control-label').textContent = reduced
            ? 'Движение отключено системой'
            : safe === 'still' ? 'Включить анимацию' : 'Пауза анимации';
    }
    document.dispatchEvent(new CustomEvent('motionchange', { detail: { level: safe } }));
}

function initMotionModes() {
    const root = document.getElementById('motionSwitcher');
    const preferred = localStorage.getItem('motionLevel') || 'normal';
    let resumeLevel = preferred === 'still' ? 'normal' : preferred;
    root?.querySelectorAll('.motion-btn').forEach((btn) => {
        btn.addEventListener('click', () => applyMotionLevel(btn.dataset.motion || 'normal'));
    });
    document.getElementById('ambientToggle')?.addEventListener('click', () => {
        const current = document.body.dataset.motion;
        if (current === 'still') {
            applyMotionLevel(resumeLevel);
        } else {
            resumeLevel = current;
            applyMotionLevel('still');
        }
    });
    window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', () => {
        applyMotionLevel(document.body.dataset.motion);
    });
    applyMotionLevel(preferred);
}

function initNavPrefsPanel() {
    const navPrefs = document.querySelector('.nav-prefs');
    const toggle = document.getElementById('navPrefsToggle');
    const panel = document.getElementById('navPrefsPanel');
    if (!navPrefs || !toggle || !panel) return;

    const closePanel = () => {
        navPrefs.classList.remove('open');
        panel.hidden = true;
        toggle.setAttribute('aria-expanded', 'false');
    };

    const openPanel = () => {
        navPrefs.classList.add('open');
        panel.hidden = false;
        toggle.setAttribute('aria-expanded', 'true');
    };

    toggle.addEventListener('click', (event) => {
        event.stopPropagation();
        if (panel.hidden) {
            openPanel();
        } else {
            closePanel();
        }
    });

    document.addEventListener('click', (event) => {
        if (!navPrefs.contains(event.target)) closePanel();
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') closePanel();
    });
}

/* ============================================
   МОБИЛЬНОЕ МЕНЮ
   ============================================ */

const mobileDrawerBackground = new Map();
let mobileDrawerOverflow = '';

function toggleMobileMenu() {
    const drawer  = document.getElementById('mobileDrawer');
    const overlay = document.getElementById('drawerOverlay');
    const btn     = document.getElementById('navHamburger');
    if (!drawer) return;

    const isOpen = drawer.classList.toggle('active');
    if (overlay) overlay.classList.toggle('active', isOpen);
    if (btn) {
        btn.classList.toggle('open', isOpen);
        btn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
        btn.setAttribute('aria-label', isOpen ? 'Закрыть меню' : 'Открыть меню');
    }
    drawer.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
    document.body.classList.toggle('drawer-open', isOpen);
    if (isOpen) {
        mobileDrawerOverflow = document.body.style.overflow;
        for (const element of document.body.children) {
            if (element === drawer || element === overlay) continue;
            mobileDrawerBackground.set(element, element.inert);
            element.inert = true;
        }
        document.body.style.overflow = 'hidden';
        drawer.setAttribute('role', 'dialog');
        drawer.setAttribute('aria-modal', 'true');
        drawer.inert = false;
        const closeBtn = drawer.querySelector('.drawer-close');
        if (closeBtn) closeBtn.focus({ preventScroll: true });
        return;
    }
    // Links navigate on their own; only the close controls hand focus back to the hamburger.
    const focused = document.activeElement;
    const returnFocus = btn && (focused === overlay || (drawer.contains(focused) && focused.tagName !== 'A'));
    for (const [element, inert] of mobileDrawerBackground) element.inert = inert;
    mobileDrawerBackground.clear();
    document.body.style.overflow = mobileDrawerOverflow;
    drawer.removeAttribute('aria-modal');
    drawer.inert = true;
    if (returnFocus) btn.focus({ preventScroll: true });
}

document.addEventListener('DOMContentLoaded', () => {
    document.addEventListener('keydown', (e) => {
        const drawer = document.getElementById('mobileDrawer');
        if (!drawer || !drawer.classList.contains('active')) return;
        if (e.key === 'Escape') {
            e.preventDefault();
            toggleMobileMenu();
            document.getElementById('navHamburger')?.focus({ preventScroll: true });
        } else if (e.key === 'Tab') {
            const controls = [...drawer.querySelectorAll('a[href], button:not([disabled]), [tabindex]')]
                .filter(element => element.tabIndex >= 0 && element.getClientRects().length);
            const first = controls[0], last = controls[controls.length - 1];
            if ((e.shiftKey && document.activeElement === first) || (!e.shiftKey && document.activeElement === last) || !drawer.contains(document.activeElement)) {
                e.preventDefault();
                (e.shiftKey ? last : first)?.focus();
            }
        }
    });
    window.matchMedia('(min-width: 1061px)').addEventListener('change', event => {
        const drawer = document.getElementById('mobileDrawer');
        if (event.matches && drawer?.classList.contains('active')) toggleMobileMenu();
    });
});

/* ============================================
   КНОПКА "НАВЕРХ"
   ============================================ */

function scrollToTop() {
    window.scrollTo({ top: 0, behavior: isMotionEnabled() ? 'smooth' : 'auto' });
}

window.addEventListener('scroll', () => {
    const btn = document.getElementById('scrollTopBtn');
    if (btn) btn.classList.toggle('visible', window.scrollY > 400);
});

/* ============================================
   FAQ АККОРДЕОН
   ============================================ */

function toggleFaq(questionEl) {
    const item = questionEl.closest('.faq-item');
    const isOpen = item.classList.contains('open');
    document.querySelectorAll('.faq-item.open').forEach(i => {
        i.classList.remove('open');
        i.querySelector('.faq-answer').style.maxHeight = null;
    });
    if (!isOpen) {
        item.classList.add('open');
        const inner = item.querySelector('.faq-answer-inner');
        item.querySelector('.faq-answer').style.maxHeight = inner.scrollHeight + 'px';
    }
}

/* ============================================
   ЭКСПРЕСС-ПЛАН СЕАНСА
   ============================================ */

function calculateSessionPlan() {
    const goal = document.getElementById('plannerGoal')?.value;
    const format = document.getElementById('plannerFormat')?.value;
    const urgency = document.getElementById('plannerUrgency')?.value;

    if (!goal || !format || !urgency) {
        return;
    }

    const plans = {
        clarity: {
            title: 'Таро чтение с фокусом на решение',
            description: 'Определяем 2-3 сценария развития, риски и лучший шаг на текущий период.',
            duration: '40-60 мин',
            price: 'от 5 000 ₸'
        },
        energy: {
            title: 'Энергетическая диагностика и мягкая чистка',
            description: 'Выявляем энергетические утечки, даем практики восстановления и стабилизации.',
            duration: '60 мин',
            price: 'от 7 500 ₸'
        },
        contact: {
            title: 'Контакт с тонким миром',
            description: 'Деликатный сеанс связи с ушедшим близким с бережным сопровождением.',
            duration: '60-90 мин',
            price: 'от 10 000 ₸'
        },
        love: {
            title: 'Консультация по отношениям',
            description: 'Разбираем динамику пары, точки напряжения и шаги для гармонизации.',
            duration: '45-60 мин',
            price: 'от 6 500 ₸'
        }
    };

    const selectedPlan = plans[goal];
    const priceAdjust = format === 'offline' ? 1500 : 0;
    const slotText = urgency === 'fast' ? 'сегодня/завтра' : 'в течение 1-3 дней';

    document.getElementById('plannerTitle').textContent = selectedPlan.title;
    document.getElementById('plannerDescription').textContent = selectedPlan.description + (format === 'offline' ? ' Формат: личная встреча.' : ' Формат: онлайн-сеанс.');
    document.getElementById('plannerDuration').textContent = selectedPlan.duration;
    document.getElementById('plannerPrice').textContent = priceAdjust ? selectedPlan.price + ' + формат' : selectedPlan.price;
    document.getElementById('plannerSlot').textContent = slotText;

    const empty = document.getElementById('plannerEmptyState');
    const result = document.getElementById('plannerResult');
    if (empty) {
        empty.classList.add('hidden');
    }
    if (result) {
        result.classList.remove('hidden');
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const plannerFields = ['plannerGoal', 'plannerFormat', 'plannerUrgency'];
    plannerFields.forEach(id => {
        const field = document.getElementById(id);
        if (field) {
            field.addEventListener('change', calculateSessionPlan);
        }
    });
});

/* ============================================
   ПРЕЛОАДЕР
   ============================================ */

window.addEventListener('load', () => {
    const preloader = document.getElementById('preloader');
    if (preloader) {
        setTimeout(() => preloader.classList.add('hidden'), 1400);
    }
});

/* ============================================
   SECTION TITLE UNDERLINE — IN-VIEW TRIGGER
   ============================================ */
document.addEventListener('DOMContentLoaded', () => {
    const titles = document.querySelectorAll('.section-title');
    if (!titles.length) return;

    const titleObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('in-view');
                titleObserver.unobserve(entry.target);
            }
        });
    }, { threshold: 0.5 });

    titles.forEach(t => titleObserver.observe(t));
});

/* ============================================
   STAGGER CARD ANIMATIONS — SLIDE-IN ON SCROLL
   ============================================ */
document.addEventListener('DOMContentLoaded', () => {
    const cards = document.querySelectorAll('.slide-in');
    if (!cards.length) return;

    const cardObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('visible');
                cardObserver.unobserve(entry.target);
            }
        });
    }, { threshold: 0.12 });

    cards.forEach(c => cardObserver.observe(c));
});

/* ============================================
   SCROLL-TO-TOP BUTTON VISIBILITY
   ============================================ */
window.addEventListener('scroll', () => {
    const btn = document.getElementById('scrollTopBtn');
    if (!btn) return;
    if (window.scrollY > 400) btn.classList.add('visible');
    else btn.classList.remove('visible');

    /* Обновляем активный пункт в нижнем мобильном меню */
    const mbnItems = document.querySelectorAll('.mbn-item');
    if (mbnItems.length) {
        const sections = ['home','about','mediumship','testimonials','contact'];
        let current = 'home';
        sections.forEach(id => {
            const el = document.getElementById(id);
            if (el && window.scrollY >= el.offsetTop - 100) current = id;
        });
        mbnItems.forEach(item => {
            const href = item.getAttribute('href');
            item.classList.toggle('active', href === '#' + current);
        });
    }
}, { passive: true });

/* ============================================
   COSMIC INTERACTION LAYER — global polish
   ============================================ */
function initTestimonialNavigation() {
    const track = document.getElementById('testimonialTrack');
    const buttons = document.querySelectorAll('[data-review-direction]');
    if (!track || !buttons.length) return;
    const update = () => {
        const end = Math.max(0, track.scrollWidth - track.clientWidth);
        buttons.forEach(button => {
            button.disabled = Number(button.dataset.reviewDirection) < 0
                ? track.scrollLeft <= 1
                : track.scrollLeft >= end - 1;
        });
    };
    buttons.forEach(button => {
        button.addEventListener('click', () => {
            const card = track.firstElementChild;
            if (!card) return;
            const step = card.getBoundingClientRect().width + (parseFloat(getComputedStyle(track).columnGap) || 0);
            track.scrollBy({
                left: step * Number(button.dataset.reviewDirection),
                behavior: isMotionEnabled() ? 'smooth' : 'auto'
            });
        });
    });
    track.addEventListener('scroll', update, { passive: true });
    new ResizeObserver(update).observe(track);
    update();
}

document.addEventListener('DOMContentLoaded', initTestimonialNavigation);
