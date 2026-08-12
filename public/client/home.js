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

    /* ── Mobile / tablet gate ──────────────────────────────────────────
       Dig Wars needs keyboard + mouse, so we block touch-primary devices.
       We can't ask the browser "is a real mouse plugged in?", so we go by
       what the pointer *behaves* like:
         - hover: hover   → the pointer can rest on things without clicking
         - pointer: fine  → it can hit small targets (mouse/trackpad, not a finger)
       Both are true on a laptop (even a touchscreen one) and false on a
       phone or a bare iPad. iPadOS lies in its user agent (it claims to be
       a Mac), so we lean on maxTouchPoints instead of the UA string.
       Anyone the heuristic gets wrong can opt out, and we remember it. */
    var GATE_KEY = 'digwarsDesktopOverride';

    function isTouchOnlyDevice() {
        if (localStorage.getItem(GATE_KEY) === '1') return false;
        var precisePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
        var touchCapable = navigator.maxTouchPoints > 1 ||
            /Android|webOS|iPhone|iPad|iPod|BlackBerry/i.test(navigator.userAgent);
        return touchCapable && !precisePointer;
    }

    function initMobileGate() {
        var gate = document.getElementById('mobileGate');
        if (!gate || !isTouchOnlyDevice()) return;

        gate.hidden = false;
        var override = document.getElementById('mobileGateOverride');
        if (override) override.onclick = function () {
            localStorage.setItem(GATE_KEY, '1');
            gate.hidden = true;
        };

        // Attaching a mouse or trackpad later flips the media query — let them in.
        var mq = window.matchMedia('(hover: hover) and (pointer: fine)');
        var onChange = function (e) { if (e.matches) gate.hidden = true; };
        if (mq.addEventListener) mq.addEventListener('change', onChange);
        else if (mq.addListener) mq.addListener(onChange); // older Safari
    }

    /* ── Tutorial entry ────────────────────────────────────────────────
       The tutorial lives on its own unlisted server (id "tut"), which is
       deliberately absent from /getServers.json so it never appears on the
       region picker. We ask for it by id instead, point the socket at it,
       and start the game exactly as the Play button would.

       The storage key is versioned: bumping _v2 re-runs the tutorial for
       everyone who completed the old in-game one, which taught a different
       (and much smaller) curriculum. */
    var TUT_DONE_KEY = 'digwarsTutorialDone_v2';

    function tutorialCompleted() {
        return localStorage.getItem(TUT_DONE_KEY) === '1';
    }

    function launchTutorial(btn) {
        if (btn) { btn.disabled = true; }
        fetch('/getTutorialServer.json')
            .then(function (r) { return r.json(); })
            .then(function (sv) {
                if (!sv || !sv.ip) throw new Error('tutorial server unavailable');
                var g = window.global;
                if (!g || !g.startGame) throw new Error('client not ready');
                // The host routes only one port to the domain, and two game
                // servers cannot share one process, so the tutorial is reached
                // through the main port: the main server proxies /tut to the
                // tutorial worker. sv.proxyPath is what it listens for.
                g.serverAdd = sv.proxyPath ? sv.mainHost : sv.ip;
                g.serverPath = sv.proxyPath || "";
                g.tutorialMode = true;    // read by client/tutorial.js
                g.tutorialPlot = null;    // set only by the tutorial server
                g.startGame();

                // The tutorial server listens on its own port. If that port is
                // not reachable from outside (a proxy that only forwards the
                // main one), the socket quietly lands on the LIVE game instead
                // - which would put a beginner in a real match. The tutorial
                // server proves itself by sending TUTI; if that never arrives,
                // bail out rather than let them play on believing otherwise.
                setTimeout(function () {
                    if (g.tutorialPlot) return;      // genuinely on the tutorial server
                    if (!g.gameStart) return;        // never connected at all
                    try { g.canvas.socket.close(); } catch (e) { }
                    location.reload();
                    alert('Could not reach the tutorial server, so you were not '
                        + 'put into a live game. Please try again shortly.');
                }, 12000);
            })
            .catch(function () {
                if (btn) { btn.disabled = false; }
                alert('The tutorial server is not reachable right now. Please try again in a moment.');
            });
    }

    function initTutorialEntry() {
        var btn = document.getElementById('tutorialButton');
        var badge = document.getElementById('tutorialBadge');
        if (!btn) return;

        // Clear the retired in-game tutorial's flags so nothing from the old
        // system lingers in a returning player's browser.
        ['digwarsTutorialDone', 'digwarsStatsTaught', 'digwarsKind',
         'digwarsLessons', 'digwarsLessonsOff'].forEach(function (k) {
            localStorage.removeItem(k);
        });

        if (badge && !tutorialCompleted()) badge.hidden = false;
        btn.onclick = function () { launchTutorial(btn); };

        // First-ever visit: Play routes into the tutorial once, so a brand-new
        // player cannot walk into a live match without ever being taught.
        var start = document.getElementById('startButton');
        if (start && !tutorialCompleted()) {
            start.addEventListener('click', function firstRun(e) {
                if (tutorialCompleted()) return;
                e.preventDefault();
                e.stopImmediatePropagation();
                start.removeEventListener('click', firstRun, true);
                launchTutorial(btn);
            }, true);
        }
    }

    document.addEventListener('DOMContentLoaded', function () {
        initMobileGate();
        initTutorialEntry();

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

        // Keep the counts fresh while on the menu. This used to poll only every
        // 15s and never on returning from a game, so the number looked frozen.
        function refreshCounts() {
            var gaw = document.getElementById('gameAreaWrapper');
            if (gaw && gaw.style.display !== 'none') return;
            fetch('/getServers.json', { cache: 'no-store' })
                .then(function (r) { return r.json(); })
                .then(function (data) {
                    if (window.global) window.global.servers = data;
                    renderRegionCounts(data);
                    if (window.global && window.global.refreshServerCounts) window.global.refreshServerCounts(data);
                })
                .catch(function () {});
        }
        refreshCounts();
        setInterval(refreshCounts, 5000);
        // and the moment the menu comes back, rather than up to 5s later
        var gawEl = document.getElementById('gameAreaWrapper');
        if (gawEl && window.MutationObserver) {
            var wasHidden = gawEl.style.display === 'none';
            new MutationObserver(function () {
                var hidden = gawEl.style.display === 'none';
                if (hidden && !wasHidden) refreshCounts();
                wasHidden = hidden;
            }).observe(gawEl, { attributes: true, attributeFilter: ['style'] });
        }
        document.addEventListener('visibilitychange', function () {
            if (!document.hidden) refreshCounts();
        });

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
