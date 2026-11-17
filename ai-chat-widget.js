/* ============================================
   ИИ-КОНСУЛЬТАНТ (виджет чата на главной странице)
   Восстановлено из исходного index.html — этот блок
   раньше был встроенным <script> и не копировался
   автоматически при переносе проекта на Next.js.
   ============================================ */
(function () {
    const API = (window.API_BASE || (window.location.hostname === 'localhost' ? 'http://localhost:5000' : 'https://roza-ogly-api.onrender.com'));
    const SID = (sessionStorage.getItem('aiSid') || (() => {
        const s = Math.random().toString(36).slice(2);
        sessionStorage.setItem('aiSid', s);
        return s;
    })());

    function escapeHtml(text) {
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    window.aiChatOpen = function () {
        const box = document.getElementById('aiChatBox');
        if (!box) return;
        box.classList.add('open');
        box.setAttribute('aria-hidden', 'false');
        document.getElementById('aiChatInput')?.focus();
    };

    window.aiChatClose = function () {
        const box = document.getElementById('aiChatBox');
        if (!box) return;
        box.classList.remove('open');
        box.setAttribute('aria-hidden', 'true');
    };

    function addMsg(text, role) {
        const box = document.getElementById('aiChatMessages');
        if (!box) return;
        const d = document.createElement('div');
        d.className = 'ai-msg ai-msg-' + role;
        d.innerHTML = '<span>' + escapeHtml(text).replace(/\n/g, '<br>') + '</span>';
        box.appendChild(d);
        box.scrollTop = box.scrollHeight;
    }

    function addTyping() {
        const box = document.getElementById('aiChatMessages');
        if (!box) return;
        const d = document.createElement('div');
        d.className = 'ai-msg ai-msg-bot ai-msg-typing';
        d.id = '_aiTyping';
        d.innerHTML = '<span><div class="ai-dot"></div><div class="ai-dot"></div><div class="ai-dot"></div></span>';
        box.appendChild(d);
        box.scrollTop = box.scrollHeight;
    }

    window.aiChatSend = async function () {
        const input = document.getElementById('aiChatInput');
        const btn = document.getElementById('aiChatSendBtn');
        if (!input || !btn) return;
        const msg = (input.value || '').trim();
        if (!msg) return;

        input.value = '';
        btn.disabled = true;
        addMsg(msg, 'user');
        addTyping();

        try {
            const r = await fetch(API + '/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: msg, session_id: SID })
            });
            const data = await r.json();
            document.getElementById('_aiTyping')?.remove();
            addMsg(data.ok ? data.reply : (data.message || 'Ошибка. Попробуйте позже.'), 'bot');
        } catch {
            document.getElementById('_aiTyping')?.remove();
            addMsg('Нет соединения. Проверьте интернет 🌙', 'bot');
        } finally {
            btn.disabled = false;
            input.focus();
        }
    };
})();
