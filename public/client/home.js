(function () {
    'use strict';

    var THEME_KEY = 'osaHomeTheme';
    var root = document.documentElement;

    function applyTheme(t) {
        root.setAttribute('data-theme', t);
        localStorage.setItem(THEME_KEY, t);
        var icon = document.getElementById('themeIcon');
        if (icon) icon.textContent = t === 'light' ? '\u2600' : '\u263E';
    }

    applyTheme(localStorage.getItem(THEME_KEY) || 'light');

    document.addEventListener('DOMContentLoaded', function () {
        applyTheme(localStorage.getItem(THEME_KEY) || 'light');

        // Theme toggle
        var tb = document.getElementById('themeToggleBtn');
        if (tb) tb.onclick = function () {
            applyTheme(root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
        };

        // Settings panel
        var panel = document.getElementById('homeSettingsPanel');
        var overlay = document.getElementById('homeSettingsOverlay');
        var openBtn = document.getElementById('homeSettingsBtn');
        var closeBtn = document.getElementById('homeSettingsClose');

        function openP() { panel.classList.add('open'); overlay.classList.add('visible'); }
        function closeP() { panel.classList.remove('open'); overlay.classList.remove('visible'); }

        if (openBtn) openBtn.onclick = openP;
        if (closeBtn) closeBtn.onclick = closeP;
        if (overlay) overlay.onclick = closeP;

        // Settings tabs
        var tabs = document.querySelectorAll('.sp-tab');
        tabs.forEach(function (tab) {
            tab.onclick = function () {
                tabs.forEach(function (t) { t.classList.remove('active'); });
                document.querySelectorAll('.sp-pane').forEach(function (p) { p.classList.remove('active'); });
                tab.classList.add('active');
                var el = document.getElementById(tab.getAttribute('data-tab'));
                if (el) el.classList.add('active');
            };
        });

        // Snowfall — lightweight, 60 particles
        var canvas = document.getElementById('snowCanvas');
        if (!canvas) return;
        var ctx = canvas.getContext('2d');
        var W, H;
        var COUNT = 60;
        var flakes = [];

        function resize() {
            W = canvas.width = window.innerWidth;
            H = canvas.height = window.innerHeight;
        }
        resize();
        window.addEventListener('resize', resize);

        for (var i = 0; i < COUNT; i++) flakes.push({
            x: Math.random() * (W || 800),
            y: Math.random() * (H || 600),
            r: 1 + Math.random() * 2,
            s: 0.3 + Math.random() * 0.7,
            d: (Math.random() - 0.5) * 0.25,
            o: 0.25 + Math.random() * 0.4
        });

        function draw() {
            ctx.clearRect(0, 0, W, H);
            var color = getComputedStyle(root).getPropertyValue('--snow').trim() || 'rgba(160,160,255,0.4)';
            for (var i = 0; i < flakes.length; i++) {
                var f = flakes[i];
                ctx.globalAlpha = f.o;
                ctx.fillStyle = color;
                ctx.beginPath();
                ctx.arc(f.x, f.y, f.r, 0, 6.283);
                ctx.fill();
                f.y += f.s;
                f.x += f.d;
                if (f.y > H + 4) { f.y = -4; f.x = Math.random() * W; }
                if (f.x > W + 4) f.x = -4;
                if (f.x < -4) f.x = W + 4;
            }
            ctx.globalAlpha = 1;
            requestAnimationFrame(draw);
        }
        draw();

        // Hide home UI buttons when game starts
        var homeUI = [
            document.getElementById('themeToggleBtn'),
            document.getElementById('homeSettingsBtn'),
            document.getElementById('snowCanvas')
        ];
        var smw = document.getElementById('startMenuWrapper');
        if (smw) {
            new MutationObserver(function () {
                var hidden = smw.style.display === 'none' || parseInt(smw.style.top) < -100;
                homeUI.forEach(function (el) { if (el) el.style.display = hidden ? 'none' : ''; });
            }).observe(smw, { attributes: true, attributeFilter: ['style'] });
        }

        // Keybind sync
        var grid = document.getElementById('homeKeybindGrid');
        var hidden = document.getElementById('controlSettings');
        if (!grid || !hidden) return;

        grid.onclick = function (e) {
            var b = e.target.closest('b[data-key]');
            if (!b) return;
            var hb = hidden.querySelector('b[data-key="' + b.getAttribute('data-key') + '"]');
            if (hb) hb.click();
        };

        function sync() {
            hidden.querySelectorAll('b[data-key]').forEach(function (src) {
                var dst = grid.querySelector('b[data-key="' + src.getAttribute('data-key') + '"]');
                if (dst) dst.textContent = src.textContent;
            });
        }
        setTimeout(sync, 500);
        new MutationObserver(sync).observe(hidden, { subtree: true, characterData: true, childList: true });
    });
})();
