# 🌹 Матрицы Судьбы - Профессиональная Визитка

Современный, красивый и интерактивный веб-сайт-визитка с потрясающими анимациями.

## ✨ Особенности

- **Красивый дизайн** - Современный интерфейс с градиентами и стильными элементами
- **Плавные анимации** - Более 15+ различных CSS и JavaScript анимаций
- **Интерактивность** - Параллакс эффекты, счетчик статистики, анимации при прокрутке
- **Адаптивность** - Полная поддержка мобильных устройств и планшетов
- **Производительность** - Оптимизирован для быстрой загрузки и плавной работы
- **SEO-дружелюбный** - Правильная структура HTML и семантическая разметка

## 🎨 Включенные Анимации

1. **Герой Секция**
   - Появление заголовка с задержкой
   - Плавающие фигуры с параллаксом
   - Волновой эффект при скролле

2. **Карточки Услуг**
   - Масштабирование при наведении
   - Блеск света при наведении
   - Плавный переход цветов

3. **Элементы**
   - Появление элементов при прокрутке
   - Счетчик статистики с анимацией
   - Подсветка при наведении на ссылки

4. **Дополнительно**
   - Фиксированная навигация с эффектом размытия
   - Прокрутка индикатора мыши
   - Свечение формы при вводе

## 📁 Структура Проекта

```
роза оглы сайт/
│
├── index.html       # Основной HTML файл
├── styles.css       # Стили и анимации CSS
├── script.js        # JavaScript функциональность
└── README.md        # Этот файл
```

## 🚀 Быстрый Старт

1. **Откройте файл index.html** в браузере
2. Или используйте Live Server в VS Code:
   - Установите расширение "Live Server"
   - Кликните правой кнопкой на index.html
   - Выберите "Open with Live Server"

## 🎯 Разделы Сайта

### Навигация
- Фиксированная навигация с логотипом
- Активная ссылка при прокрутке
- Подчеркивание при наведении

### Герой Секция
- Привлекательный заголовок
- CTA кнопка "Начать"
- Плавающие геометрические фигуры
- Индикатор прокрутки мыши

### Обо Мне
- Три информационные карточки
- Значки и описания
- Эффект тени при наведении

### Услуги
- Четыре карточки услуг
- Нумерация услуг
- Эффект масштабирования

### Статистика
- Счетчик с анимацией
- Четыре показателя
- Триггер при прокрутке на секцию

### Контакты
- Форма обратной связи
- Информация о контактах
- Валидация формы

## 🎨 Цветовая Схема

- **Основной градиент:** #667eea - #764ba2 (фиолетово-синий)
- **Акцент:** #FFE66D (золотой)
- **Текст:** #2D3436 (Темный)
- **Фон:** #F7F7F7 (Светло-серый)

## 💻 Технологии

- **HTML5** - Семантическая разметка
- **CSS3** - Moderne стили и анимации
- **JavaScript (Vanilla)** - Без фреймворков

## 📱 Адаптивность

Сайт полностью адаптирован для:
- 📱 Мобильные телефоны (320px+)
- 📱 Планшеты (768px+)
- 💻 Десктопы (1024px+)

## 🔧 Кастомизация

### Изменение цветов
Отредактируйте CSS переменные в начале `styles.css`:

```css
:root {
    --primary: #FF6B6B;
    --secondary: #4ECDC4;
    --accent: #FFE66D;
    /* ... остальные переменные */
}
```

## Backend deployment

The Flask API lives in `backend/`. Local development uses SQLite; production must provide a PostgreSQL `DATABASE_URL`. The Render service intentionally refuses to start without it so customer records cannot silently fall back to an ephemeral disk. Install backend dependencies with `pip install -r backend/requirements.txt`.

Configure `PAYMENT_CARD_NUMBER`, `PAYMENT_CARD_HOLDER`, and `PAYMENT_BANK_NAME` as private environment variables before enabling transfer orders. Payments are confirmed manually through the protected `/api/orders/<code>/review` endpoint; the legacy card-verification endpoints are disabled and do not accept or store CVV/card submissions. Keep `TASK_SECRET` private; it protects both payment review and reminder-task calls.

Customer accounts are server-side: `POST /api/auth/register`, `/api/auth/login`, `/api/auth/logout`, `/api/auth/logout-all`, `/api/auth/profile`, `/api/auth/password` and `GET /api/auth/me`. Passwords are stored as PBKDF2 hashes and the browser keeps only an opaque `ms_…` session token, sent as `Authorization: Bearer`. A signed-in customer sees only their own bookings and orders; guest bookings still require the client access key stored in that browser. Email verification and automatic password reset are not implemented yet (`/api/auth/password/forgot` returns 503). `SUPPORT_WHATSAPP` is a contact for support requests, not an implemented identity-verification or password-reset process.

Run the backend tests from the repository root: `python -m unittest discover -s backend\tests` (set `PYTHONIOENCODING=utf-8` on Windows). These tests use a disposable database and mock outbound notifications.

Run the dependency-free frontend regression tests with `node --test tests\dashboard.test.cjs`. They cover session headers, invalid API responses, order-list errors and server-authoritative training status, including the waitlist. They also check main-page motion preferences, canvas lifecycle and accessible navigation. A paid transfer does not itself guarantee an accepted training place. These tests do not perform real payments or replace browser layout checks.

### Main-page design and motion

The main page uses the scoped `main-experience` layer in `modern-2026.css`; it does not restyle the dashboard. Its matrix is a decorative illustration with fixed numbers, not a personal calculation. The hero pause control and atmosphere menu share the `motionLevel` preference. System reduced-motion settings always take precedence; the canvas stops while paused, offscreen or in a hidden tab, and limits rendering to 30 FPS with a 1.5 device-pixel-ratio cap. Reviews scroll only on user input, and FAQ disclosures use native keyboard-accessible `details`/`summary` elements.

The celestial studio layout combines a centred editorial headline, a compact calculation entry panel and three visual cards for the matrix, zodiac and chakras. The spacious gallery direction is inspired by the [public Flow interface overview](https://blog.google/innovation-and-ai/models-and-research/google-labs/flow-updates-february-2026/); it does not integrate Google's service or copy project assets. `celestial-studio.css` provides the shared gallery component, and `images/celestial-atlas.svg` contains original decorative symbols reused on both pages. Cards stack on small screens; their animation stops with the existing pause preference or system reduced motion, without hiding the entry button.

### Personal portrait and cabinet design

After a matrix calculation, the cabinet shows a «Портрет личности» panel with three tabs: the business card for point A, the zodiac sign and the name meaning. The main page `#portrait` section is only a teaser that links to the cabinet. The data lives in static scripts:

- `data/business-card-data.js` (`window.MatrixBusinessCard`): arcana chapters 3–21 from «визитная карточка.docx». Arcana 1, 2 and 22 are missing from the source, so the cabinet falls back to the short built-in descriptions.
- `data/zodiac-data.js` (`window.MatrixZodiac`): 12 signs, date lookup and cusp detection.
- `data/name-data.js` (`window.MatrixNames`): name dictionary with aliases and Kazakh spellings, plus name number (1–9) and name arcana (1–22).

The texts are symbolic self-reflection prompts, not predictions or guarantees. `luxe-dashboard.css` is the final dashboard style layer (loaded after `studio-dashboard.css`); it covers both themes, mobile drawer and `prefers-reduced-motion`. Check the data with `node --test tests\business-card-data.test.cjs tests\zodiac-data.test.cjs tests\name-data.test.cjs`.

The name dictionary contains 282 entries. Calculations use the first Cyrillic name (including Kazakh letters and hyphenated names), normalize Е/Ё, and explicitly reject mixed alphabets or digits rather than silently changing the input. Unknown valid names still receive the symbolic number calculation, but no invented etymology.

Both navigation drawers support Escape, a contained Tab sequence and restored background interaction; the cabinet keeps its sidebar visible on desktop. Its animation button shares the main page's `motionLevel` setting, responds to system changes immediately, and stops the 30 FPS / 1.5 DPR canvas in hidden tabs. Browser checks should cover both themes, keyboard navigation, narrow layouts and live reduced-motion changes. The interaction design follows [WAI dialog guidance](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/) and [WAI tabs guidance](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/).

Reading links use fully opaque accent text; palette regression tests require at least 4.5:1 contrast against each theme background.

The matrix «Таланты» section uses the same luxe cabinet layer: three talent branches are separated into grouped panels, with responsive arcana cards and full descriptions that do not require nested scrolling. The layout supports both themes and collapses to one column on narrow screens.

The cabinet's light theme uses a warm ivory-to-pearl canvas with champagne, muted lavender and sage accents. Its dark theme uses quieter graphite panels and lavender primary actions. Both share the celestial gallery and spacious navigation; legacy text variables and inline labels are mapped to matching contrast-safe colours. The calculated SVG matrix colours are unchanged.

The overview's atlas cards open the existing calculation form with a description of the selected reading. After a successful calculation, `finishAtlasReading` opens and focuses the matrix, zodiac tab or chakra section, respecting motion preferences. The selection is consumed once and cleared when leaving the matrix page. Gallery illustrations are explicitly labelled as non-personal previews; the chakra card is a symbolic reading, not medical diagnosis. Booking, learning, authentication and payment behaviour are unchanged.

The «Детальный разбор матрицы» block is rendered by `renderMatrixInterpretations` in `dashboard.html`. Point D comes first as the centre hero card, followed by the four core points and the age lines. A sticky chip bar jumps to each point and highlights the point in view. «Глубже» accordions hold the longer `POSITION_ARCANA` texts, and one button opens or closes them all. Cards fade in on scroll only when the browser supports `animation-timeline: view()` and motion is not reduced; otherwise they are shown at once. All values pass through `escapeHtml`. All content is currently free; a subscription paywall is not implemented yet.

### Изменение текста
Просто отредактируйте текст в `index.html`

### Добавление новых анимаций
Добавьте новые `@keyframes` в `styles.css` и примените их к элементам

## 📊 Производительность

- **Без внешних библиотек** - Чистый HTML/CSS/JS
- **Оптимизирован для скорости** - Минимальные зависимости
- **Мобильно-оптимизирован** - Быстрая загрузка на мобильных

## 🐛 Поддержка Браузеров

- ✅ Chrome 90+
- ✅ Firefox 88+
- ✅ Safari 14+
- ✅ Edge 90+

## 📝 Заметки

- Форма не отправляет реальные письма (это демонстрация)
- Все анимации работают на CSS3 и Vanilla JS
- Можно легко интегрировать с бэкендом

## 🎓 Обучение

Этот проект отлично подходит для изучения:
- CSS анимаций и переходов
- Intersection Observer API
- Vanilla JavaScript
- Адаптивного дизайна
- Современных веб-практик



## What is new in v2

- **SEO**: Added canonical URL, og:url, og:image, og:site_name, full Twitter Card tags, robots meta, JSON-LD LocalBusiness structured data
- **PWA**: Added manifest.json (web app manifest), favicon.svg (SVG icon), apple-touch-icon
- **Robots & Sitemap**: Added robots.txt and sitemap.xml to root
- **Accessibility (a11y)**: Added skip-to-main-content link, aria-expanded / aria-controls on hamburger button, aria-label updates on menu open/close, focus-visible keyboard outline styles
- **Prefers-reduced-motion**: All CSS animations/transitions disabled for users who prefer reduced motion
- **Preconnect**: Added preconnect to fonts.gstatic.com for faster font loading
- **Code quality**: Script.js now correctly manages aria-expanded state for mobile nav

## 📄 Лицензия

Свободно используйте и модифицируйте для своих нужд!

---

**Создано с ❤️**
