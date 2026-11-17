// Работает независимо от 3D: часы Алматы и понятное сообщение, если сцена не запустилась.
(function () {
    var clockEl = document.getElementById('clock');
    function tick() {
        var t = new Date(Date.now() + 5 * 3600 * 1000);
        if (clockEl) clockEl.textContent = t.toISOString().slice(11, 19) + ' · UTC+5';
    }
    tick(); setInterval(tick, 1000);

    var shown = false;
    window.heroFail = function (msg) {
        if (shown) return; shown = true;
        var n = document.getElementById('note');
        if (!n) return;
        n.textContent = '3D-сцена не запустилась, показана картинка. Причина: ' + msg;
        n.hidden = false;
    };
    window.addEventListener('error', function (e) {
        var src = (e.target && (e.target.src || e.target.href)) || e.filename || '';
        if (!window.heroOK) window.heroFail((e.message || 'не загрузился файл') + (src ? ' (' + src.split('/').slice(-2).join('/') + ')' : ''));
    }, true);
    window.addEventListener('unhandledrejection', function (e) {
        if (!window.heroOK) window.heroFail(String(e.reason && e.reason.message || e.reason));
    });
    setTimeout(function () {
        if (window.heroOK) return;
        var c = document.createElement('canvas');
        var gl = c.getContext('webgl2') || c.getContext('webgl');
        window.heroFail(gl ? 'скрипт сцены не выполнился (возможно, его блокирует расширение браузера)' : 'в браузере выключено аппаратное ускорение или WebGL');
    }, 6000);
})();
