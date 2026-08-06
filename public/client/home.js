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

    applyTheme(localStorage.getItem(THEME_KEY) || 'dark'); // immediate, no flash

    document.addEventListener('DOMContentLoaded', function () {
        applyTheme(localStorage.getItem(THEME_KEY) || 'dark');

        var tb = document.getElementById('themeToggleBtn');
        if (tb) tb.onclick = function () {
            applyTheme(root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
        };

        var panel = document.getElementById('homeSettingsPanel');
        var overlay = document.getElementById('homeSettingsOverlay');
        var openBtn = document.getElementById('homeSettingsBtn');
        var closeBtn = document.getElementById('homeSettingsClose');

        function openP() { panel.classList.add('open'); overlay.classList.add('visible'); }
        function closeP() {
            panel.classList.remove('open'); overlay.classList.remove('visible');
            // if the game is running, hand the keyboard back to it
            var gaw = document.getElementById('gameAreaWrapper');
            var cv = document.getElementById('gameCanvas');
            if (gaw && cv && gaw.style.display !== 'none') cv.focus();
        }

        if (openBtn) openBtn.onclick = openP;
        if (closeBtn) closeBtn.onclick = closeP;
        if (overlay) overlay.onclick = closeP;

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

        var clPanel = document.getElementById('homeChangelogPanel');
        var clOverlay = document.getElementById('homeChangelogOverlay');
        var clOpenBtn = document.getElementById('homeChangelogBtn');
        var clCloseBtn = document.getElementById('homeChangelogClose');

        function openCL() { clPanel.classList.add('open'); clOverlay.classList.add('visible'); }
        function closeCL() { clPanel.classList.remove('open'); clOverlay.classList.remove('visible'); }

        if (clOpenBtn) clOpenBtn.onclick = openCL;
        if (clCloseBtn) clCloseBtn.onclick = closeCL;
        if (clOverlay) clOverlay.onclick = closeCL;

        // contributors modal - opened from the sidebar credits line
        var contribPanel = document.getElementById('contributorsPanel');
        var contribOverlay = document.getElementById('contributorsOverlay');
        var contribLink = document.getElementById('contributorsLink');
        var contribClose = document.getElementById('contributorsClose');
        function openContrib() {
            if (contribPanel) { contribPanel.classList.add('open'); contribOverlay.classList.add('visible'); }
        }
        function closeContrib() {
            if (contribPanel) { contribPanel.classList.remove('open'); contribOverlay.classList.remove('visible'); }
        }
        if (contribLink) contribLink.onclick = openContrib;
        if (contribClose) contribClose.onclick = closeContrib;
        if (contribOverlay) contribOverlay.onclick = closeContrib;

        // professional region dropdown (server selector)
        var dd = document.getElementById('serverDropdown');
        var ddTrigger = document.getElementById('serverDropdownTrigger');
        var ddLabel = document.getElementById('serverDropdownLabel');
        var regionSelector = document.getElementById('regionSelector');

        // sleek notification toast
        function showToast(message) {
            var container = document.getElementById('toastContainer');
            if (!container) return;
            var toast = document.createElement('div');
            toast.className = 'toast';
            toast.textContent = message;
            container.appendChild(toast);
            setTimeout(function () {
                toast.classList.add('hide');
                setTimeout(function () { toast.remove(); }, 300);
            }, 2600);
        }

        function updateRegionLabel() {
            if (!ddLabel) return;
            var selected = regionSelector ? regionSelector.querySelector('.region-option.selected') : null;
            var name = (selected && selected.dataset.region) || 'Europe';
            var countEl = selected ? selected.querySelector('.region-count') : null;
            var count = countEl && countEl.style.display !== 'none' ? countEl.textContent.trim() : '';
            ddLabel.textContent = count ? name + ' \u2022 ' + count : name;
        }

        // refresh the region options with live server counts
        function renderRegionCounts(serverData) {
            var data = Array.isArray(serverData) ? serverData : [];
            var counts = {};
            function norm(r) {
                r = String(r || '').toLowerCase();
                if (r.indexOf('euro') === 0 || r === 'eu') return 'Europe';
                if (r.indexOf('amer') === 0 || r === 'usa' || r === 'us') return 'USA';
                if (r.indexOf('asia') === 0) return 'Asia';
                return null;
            }
            data.forEach(function (s) {
                var key = norm(s.region);
                if (key) counts[key] = (counts[key] || 0) + (Number(s.players) || 0);
            });
            if (!regionSelector) return;
            regionSelector.querySelectorAll('.region-option').forEach(function (opt) {
                var countEl = opt.querySelector('.region-count');
                if (!countEl) return;
                if (counts[opt.dataset.region] !== undefined) {
                    countEl.textContent = counts[opt.dataset.region];
                    countEl.style.display = '';
                } else if (opt.dataset.region === 'Europe') {
                    countEl.textContent = '0';
                    countEl.style.display = '';
                } else {
                    countEl.style.display = 'none';
                }
            });
            updateRegionLabel();
        }
        if (window.global) window.global.updateRegionSelector = renderRegionCounts;

        function setDropdownOpen(open) {
            if (dd) dd.classList.toggle('open', !!open);
        }

        if (ddTrigger) {
            ddTrigger.onclick = function (e) {
                e.stopPropagation();
                setDropdownOpen(!dd.classList.contains('open'));
            };
        }
        document.addEventListener('click', function (e) {
            if (dd && !dd.contains(e.target)) setDropdownOpen(false);
        });

        if (regionSelector) {
            regionSelector.addEventListener('click', function (e) {
                var opt = e.target.closest ? e.target.closest('.region-option') : null;
                if (!opt) return;
                var selected = regionSelector.querySelector('.region-option.selected');
                if (opt.dataset.region === 'Europe') {
                    if (selected && selected !== opt) {
                        selected.classList.remove('selected');
                        opt.classList.add('selected');
                    }
                    setDropdownOpen(false);
                    updateRegionLabel();
                } else {
                    showToast('Location doesn\u2019t exist');
                }
            });
        }

        var selTbody = document.getElementById('serverSelector');
        if (selTbody) {
            selTbody.addEventListener('click', function () {
                setDropdownOpen(false);
                updateRegionLabel();
            });
            new MutationObserver(updateRegionLabel).observe(selTbody, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ['class']
            });
        }
        setTimeout(function () {
            if (window.global) renderRegionCounts(window.global.servers);
        }, 600);

        // keep the counts fresh while on the menu
        setInterval(function () {
            var gaw = document.getElementById('gameAreaWrapper');
            if (gaw && gaw.style.display !== 'none') return;
            fetch('/getServers.json').then(function (r) { return r.json(); })
                .then(function (data) {
                    renderRegionCounts(data);
                    if (window.global && window.global.refreshServerCounts) window.global.refreshServerCounts(data);
                })
                .catch(function () {});
        }, 15000);

        var clTabs = document.querySelectorAll('.cl-tab');
        var patchNotes = document.getElementById('patchNotes');
        clTabs.forEach(function (tab) {
            tab.onclick = function () {
                clTabs.forEach(function (t) { t.classList.remove('active'); });
                tab.classList.add('active');
                if (patchNotes) {
                    patchNotes.className = 'shadowScroll ' + tab.getAttribute('data-type');
                }
            };
        });

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

        var homeUI = [
            document.getElementById('themeToggleBtn'),
            document.getElementById('homeSettingsBtn'),
            document.getElementById('homeChangelogBtn'),
            document.getElementById('homeSidebar'),
            document.getElementById('snowCanvas')
        ];
        var smw = document.getElementById('startMenuWrapper');
        if (smw) {
            new MutationObserver(function () {
                var hidden = smw.style.display === 'none' || parseInt(smw.style.top) < -100;
                homeUI.forEach(function (el) { if (el) el.style.display = hidden ? 'none' : ''; });
                // mark in-game so the shared settings panel keeps its dark,
                // unchangeable look while playing (homepage follows the theme)
                document.body.classList.toggle('in-game', hidden);
                if (hidden) { closeCL(); closeP(); setDropdownOpen(false); }
            }).observe(smw, { attributes: true, attributeFilter: ['style'] });
        }

        var grid = document.getElementById('homeKeybindGrid');
        var hidden = document.getElementById('controlSettings');
        if (!grid || !hidden) return;

        grid.onclick = function (e) {
            var b = e.target.closest('b[data-key]');
            if (!b) return;
            // don't let the original click bubble to the document handler —
            // it would instantly unselect the cell the proxy just selected
            e.stopPropagation();
            var hb = hidden.querySelector('b[data-key="' + b.getAttribute('data-key') + '"]');
            if (hb) hb.click();
        };

        function sync() {
            hidden.querySelectorAll('b[data-key]').forEach(function (src) {
                var dst = grid.querySelector('b[data-key="' + src.getAttribute('data-key') + '"]');
                if (!dst) return;
                dst.textContent = src.textContent || '·';
                // mirror the "waiting for a key" state onto the visible grid
                dst.classList.toggle('kb-editing', !!src.closest('.editing'));
            });
        }
        setTimeout(sync, 500);
        new MutationObserver(sync).observe(hidden, { subtree: true, characterData: true, childList: true, attributes: true, attributeFilter: ['class'] });
    });
})();
