// ==UserScript==
// @name         UpLearn Telemetry Blocker & TimeSpent Booster
// @namespace    https://github.com/local/uplearn-telemetry-blocker
// @version      1.7.1
// @description  Blocks telemetry ALWAYS; +60s time boost is toggleable (pill click / Right Ctrl shows-hides pill)
// @author       you
// @match        https://web.uplearn.co.uk/*
// @run-at       document-start
// @grant        none
// @noframes
//
// @webRequest   [{"selector":{"include":"://openreplay.uplearn.co.uk/"},"action":"cancel"}]
// @webRequest   [{"selector":{"include":"://jitsu.uplearn.co.uk/"},"action":"cancel"}]
// @webRequest   [{"selector":{"include":"://.ingest.us.sentry.io/"},"action":"cancel"}]
// @webRequest   [{"selector":{"include":"://static.cloudflareinsights.com/"},"action":"cancel"}]
// @webRequest   [{"selector":{"include":"://api-iam.intercom.io/"},"action":"cancel"}]
// @webRequest   [{"selector":{"include":"://widget.intercom.io/"},"action":"cancel"}]
// @webRequest   [{"selector":{"include":"://js.intercomcdn.com/"},"action":"cancel"}]
// @webRequest   [{"selector":{"include":"://nexus-websocket-.intercom.io/"},"action":"cancel"}]
// @webRequest   [{"selector":{"include":"://www.googletagmanager.com/"},"action":"cancel"}]
// @webRequest   [{"selector":{"include":"://connect.facebook.net/"},"action":"cancel"}]
// @webRequest   [{"selector":{"include":"://sc-static.net/"},"action":"cancel"}]
// @webRequest   [{"selector":{"include":"://bat.bing.com/"},"action":"cancel"}]
// @webRequest   [{"selector":{"include":"://bzrcdn.openai.com/"},"action":"cancel"}]
// ==/UserScript==

(function () {
    'use strict';

    const LOG  = (msg, ...rest) => console.log('%c[UL] ' + msg, 'color:#00e5ff;font-weight:bold', ...rest);
    const WARN = (msg, ...rest) => console.warn('[UL] ' + msg, ...rest);

    LOG('=== SCRIPT LOADED on', location.host, '===');

    // ============================================================
    // SHARED CONFIG
    // ============================================================
    const API_HOST    = 'web.uplearn.co.uk';
    const API_PATH_RE = /\/api\/?$/;

    function isTargetApi(url) {
        try {
            const u = new URL(url, location.href);
            return u.host === API_HOST && API_PATH_RE.test(u.pathname);
        } catch { return false; }
    }

    const stats = { apiPosts: 0, seen: 0, boosted: 0, blocked: 0, groupExtra: 0 };

    // ============================================================
    // ─── TELEMETRY BLOCKING (ALWAYS ON, INDEPENDENT OF TOGGLE) ──
    // ============================================================
    // This section is intentionally NOT gated behind `timeBoostEnabled`.
    // The user's toggle only controls the +60s time boost. LogImproperUse
    // telemetry is dropped unconditionally, every single time.

    function bodyLooksLikeLogImproperUse(body) {
        if (body == null) return false;
        if (typeof body !== 'string') {
            try {
                if (body instanceof URLSearchParams) body = body.toString();
                else return false;
            } catch { return false; }
        }
        if (!/LogImproperUse|logImproperUse/i.test(body)) return false;
        try {
            const parsed = JSON.parse(body);
            const op = parsed && (parsed.operationName || '');
            if (/LogImproperUse/i.test(op)) return true;
            const q = parsed && parsed.query;
            if (typeof q === 'string' && /LogImproperUse|logImproperUse/i.test(q)) return true;
        } catch { /* not JSON */ }
        return true;
    }

    function logImproperUseSyntheticResponse() {
        const body = JSON.stringify({ data: { logImproperUse: true } });
        return new Response(body, {
            status: 200, statusText: 'OK',
            headers: { 'Content-Type': 'application/json' }
        });
    }

    // ============================================================
    // ─── TIME BOOST (TOGGLEABLE) ───────────────────────────────
    // ============================================================
    const QUIZ_OP             = 'AnswerProgressQuizQuestion';
    const GROUP_OP            = 'CompleteProgressQuizGroup';
    const EXTRA_SECONDS       = 60;
    const TOGGLE_STORAGE_KEY  = 'uplearn_time_boost_enabled';
    const UI_VISIBLE_KEY      = 'uplearn_time_boost_ui_visible';

    let accumulatedExtraSeconds = 0;

    let timeBoostEnabled = (() => {
        try {
            const v = localStorage.getItem(TOGGLE_STORAGE_KEY);
            return v === null ? true : v === 'true';
        } catch { return true; }
    })();

    let uiVisible = (() => {
        try {
            const v = localStorage.getItem(UI_VISIBLE_KEY);
            return v === null ? true : v === 'true';
        } catch { return true; }
    })();

    let paintToggleUI     = null;
    let applyUIVisibility = null;

    function setTimeBoost(enabled) {
        timeBoostEnabled = !!enabled;
        try { localStorage.setItem(TOGGLE_STORAGE_KEY, String(timeBoostEnabled)); } catch {}
        if (typeof paintToggleUI === 'function') paintToggleUI();
        LOG('time-boost ' + (timeBoostEnabled ? 'ENABLED' : 'DISABLED') +
            '  (telemetry blocking remains ALWAYS ON)');
        return timeBoostEnabled;
    }
    function setUIVisible(visible) {
        uiVisible = !!visible;
        try { localStorage.setItem(UI_VISIBLE_KEY, String(uiVisible)); } catch {}
        if (typeof applyUIVisibility === 'function') applyUIVisibility();
        LOG('ui ' + (uiVisible ? 'SHOWN' : 'HIDDEN'));
        return uiVisible;
    }

    window.__ulTimeBoost = {
        isEnabled:    () => timeBoostEnabled,
        enable:       () => setTimeBoost(true),
        disable:      () => setTimeBoost(false),
        toggle:       () => setTimeBoost(!timeBoostEnabled),
        isUIVisible:  () => uiVisible,
        showUI:       () => setUIVisible(true),
        hideUI:       () => setUIVisible(false),
        toggleUI:     () => setUIVisible(!uiVisible),
        getAccumulated:   () => accumulatedExtraSeconds,
        resetAccumulated: () => { accumulatedExtraSeconds = 0; LOG('accumulator reset'); },
        stats,
    };

    function parseISODuration(str) {
        const m = /^PT(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(str);
        if (!m) return null;
        return parseFloat(m[1] || 0) * 3600 + parseFloat(m[2] || 0) * 60 + parseFloat(m[3] || 0);
    }
    function toISODuration(totalSeconds) {
        return 'PT' + String(Math.round(totalSeconds * 1000) / 1000) + 'S';
    }

    // Note: the very first line is the ONLY gate on the toggle.
    // Telemetry blocking never reaches this function — it's handled above.
    function maybeBumpTimeSpent(body, source) {
        if (!timeBoostEnabled)         return { body, changed: false };   // ← toggle check
        if (typeof body !== 'string')  return { body, changed: false };

        const hasQuiz  = body.includes(QUIZ_OP);
        const hasGroup = body.includes(GROUP_OP);
        if (!hasQuiz && !hasGroup) return { body, changed: false };

        let json;
        try { json = JSON.parse(body); }
        catch { return { body, changed: false }; }

        let changed = false;

        const patch = (obj) => {
            if (!obj || !obj.operationName || !obj.variables) return;

            if (obj.operationName === QUIZ_OP && typeof obj.variables.timeSpent === 'string') {
                const total = parseISODuration(obj.variables.timeSpent);
                if (total === null) return;
                const before = obj.variables.timeSpent;
                obj.variables.timeSpent = toISODuration(total + EXTRA_SECONDS);
                accumulatedExtraSeconds += EXTRA_SECONDS;
                stats.seen++;
                stats.boosted++;
                changed = true;
                LOG(`[${source}] ${QUIZ_OP}: ${before} -> ${obj.variables.timeSpent} ` +
                    `(accumulated: ${accumulatedExtraSeconds}s)`);
            }
            else if (obj.operationName === GROUP_OP && typeof obj.variables.timeSpent === 'string') {
                const total = parseISODuration(obj.variables.timeSpent);
                if (total === null) return;
                const before = obj.variables.timeSpent;
                const bonus  = accumulatedExtraSeconds;
                obj.variables.timeSpent = toISODuration(total + bonus);
                stats.groupExtra += bonus;
                changed = true;
                LOG(`[${source}] ${GROUP_OP}: ${before} -> ${obj.variables.timeSpent} ` +
                    `(+${bonus}s from ${bonus / EXTRA_SECONDS} question(s))`);
                accumulatedExtraSeconds = 0;
            }
        };

        if (Array.isArray(json)) json.forEach(patch);
        else patch(json);

        return changed
            ? { body: JSON.stringify(json), changed: true }
            : { body, changed: false };
    }

    // ============================================================
    // FETCH INTERCEPTOR
    // ============================================================
    const origFetch = window.fetch;
    if (origFetch) {
        window.fetch = function (input, init) {
            try {
                const url = typeof input === 'string' ? input
                          : (input && input.url) ? input.url
                          : String(input);
                const method = ((init && init.method) || (input && input.method) || 'GET').toUpperCase();

                if (method === 'POST' && isTargetApi(url)) {
                    stats.apiPosts++;
                    let body = init && typeof init.body === 'string' ? init.body : null;

                    // --- Request-object path ---
                    if (body == null && input instanceof Request) {
                        const ct = (input.headers.get('content-type') || '').toLowerCase();
                        if (ct.includes('application/json')) {
                            const self = this;
                            const passInit = init;
                            return input.clone().text().then((text) => {
                                // ── TELEMETRY BLOCK: always, no toggle ──
                                if (bodyLooksLikeLogImproperUse(text)) {
                                    LOG('LogImproperUse (Request body) — dropping [always-on]');
                                    stats.blocked++;
                                    return logImproperUseSyntheticResponse();
                                }
                                // ── TIME BOOST: gated inside ──
                                const { body: newBody, changed } = maybeBumpTimeSpent(text, 'fetch-Req');
                                const newReq = new Request(input, {
                                    body: changed ? newBody : text,
                                    method: input.method
                                });
                                return origFetch.call(self, newReq, passInit);
                            });
                        }
                    }

                    // ── TELEMETRY BLOCK: always, no toggle ──
                    if (body != null && bodyLooksLikeLogImproperUse(body)) {
                        LOG('LogImproperUse — dropping [always-on]');
                        stats.blocked++;
                        return Promise.resolve(logImproperUseSyntheticResponse());
                    }

                    // ── TIME BOOST: gated inside ──
                    if (body != null) {
                        const { body: newBody, changed } = maybeBumpTimeSpent(body, 'fetch');
                        if (changed) {
                            init = Object.assign({}, init || {}, { body: newBody });
                        }
                    }
                }
            } catch (e) {
                WARN('fetch interceptor error:', e);
            }

            return origFetch.call(this, input, init);
        };
    }

    // ============================================================
    // XHR INTERCEPTOR
    // ============================================================
    const OrigXHR = window.XMLHttpRequest;
    if (OrigXHR) {
        const origOpen = OrigXHR.prototype.open;
        const origSend = OrigXHR.prototype.send;

        OrigXHR.prototype.open = function (method, url) {
            this.__ul_method = method;
            this.__ul_url    = url;
            return origOpen.apply(this, arguments);
        };

        OrigXHR.prototype.send = function (body) {
            try {
                const method = (this.__ul_method || '').toUpperCase();
                if (method === 'POST' && isTargetApi(this.__ul_url)) {
                    stats.apiPosts++;

                    // ── TELEMETRY BLOCK: always, no toggle ──
                    if (bodyLooksLikeLogImproperUse(body)) {
                        LOG('xhr LogImproperUse — dropping [always-on]');
                        stats.blocked++;
                        const self = this;
                        const payload = JSON.stringify({ data: { logImproperUse: true } });
                        Object.defineProperty(self, 'readyState',   { value: 4,       configurable: true });
                        Object.defineProperty(self, 'status',       { value: 200,     configurable: true });
                        Object.defineProperty(self, 'statusText',   { value: 'OK',    configurable: true });
                        Object.defineProperty(self, 'responseText', { value: payload, configurable: true });
                        Object.defineProperty(self, 'response', {
                            get() {
                                if (self.responseType === 'json') return { data: { logImproperUse: true } };
                                return payload;
                            }, configurable: true
                        });
                        setTimeout(() => {
                            try {
                                self.dispatchEvent(new Event('readystatechange'));
                                self.dispatchEvent(new ProgressEvent('load'));
                                self.dispatchEvent(new ProgressEvent('loadend'));
                            } catch {}
                        }, 0);
                        return;
                    }

                    // ── TIME BOOST: gated inside ──
                    if (typeof body === 'string') {
                        const { body: newBody, changed } = maybeBumpTimeSpent(body, 'xhr');
                        if (changed) body = newBody;
                    }
                }
            } catch (e) {
                WARN('xhr interceptor error:', e);
            }
            return origSend.call(this, body);
        };
    }

    // ============================================================
    // VISIBILITY SPOOF
    // ============================================================
    const SUPPRESSED_EVENTS = new Set([
        'visibilitychange', 'webkitvisibilitychange', 'blur', 'focusout', 'pagehide'
    ]);
    try {
        Object.defineProperty(document, 'visibilityState',       { get: () => 'visible', configurable: true });
        Object.defineProperty(document, 'webkitVisibilityState', { get: () => 'visible', configurable: true });
        Object.defineProperty(document, 'hidden',                { get: () => false,     configurable: true });
        Object.defineProperty(document, 'webkitHidden',          { get: () => false,     configurable: true });
    } catch (e) { WARN('visibility patch failed', e); }

    try { document.hasFocus = function () { return true; }; } catch {}

    function wrapAddEventListener(target) {
        const origAdd = target.addEventListener;
        target.addEventListener = function (type, listener, options) {
            if (SUPPRESSED_EVENTS.has(type)) return;
            return origAdd.call(this, type, listener, options);
        };
    }
    wrapAddEventListener(window);
    wrapAddEventListener(document);

    try {
        const origProtoAdd = EventTarget.prototype.addEventListener;
        EventTarget.prototype.addEventListener = function (type, listener, options) {
            if ((this === window || this === document) && SUPPRESSED_EVENTS.has(type)) return;
            return origProtoAdd.call(this, type, listener, options);
        };
    } catch {}

    ['onblur', 'onfocusout', 'onpagehide', 'onvisibilitychange'].forEach((prop) => {
        try {
            Object.defineProperty(window,   prop, { get: () => null, set: () => {}, configurable: true });
            Object.defineProperty(document, prop, { get: () => null, set: () => {}, configurable: true });
        } catch {}
    });

    const KILL = (e) => { e.stopImmediatePropagation(); e.stopPropagation(); };
    ['visibilitychange', 'webkitvisibilitychange', 'blur', 'focusout', 'pagehide'].forEach((evt) => {
        try {
            EventTarget.prototype.addEventListener.call(window,   evt, KILL, true);
            EventTarget.prototype.addEventListener.call(document, evt, KILL, true);
        } catch {}
    });

    setInterval(() => {
        try { document.hasFocus = function () { return true; }; } catch {}
    }, 2000);

    // ============================================================
    // UI PILL
    // ============================================================
    function installToggleUI() {
        if (!document.body) { setTimeout(installToggleUI, 100); return; }
        if (document.getElementById('__ul-time-boost-ui')) return;

        // Two-row pill: top row is the toggle (time boost only),
        // bottom row is a permanent telemetry status indicator.
        const wrap = document.createElement('div');
        wrap.id = '__ul-time-boost-ui';
        Object.assign(wrap.style, {
            position: 'fixed', right: '12px', bottom: '12px', zIndex: '2147483647',
            fontFamily: 'system-ui, -apple-system, sans-serif',
            fontSize: '12px', fontWeight: '600', lineHeight: '1.3',
            padding: '8px 12px', borderRadius: '12px',
            boxShadow: '0 2px 10px rgba(0,0,0,0.30)',
            cursor: 'pointer', userSelect: 'none',
            transition: 'background 0.15s, color 0.15s, transform 0.1s',
            letterSpacing: '0.2px',
            textAlign: 'center',
        });
        wrap.title = 'Click: toggle +' + EXTRA_SECONDS + 's time boost (telemetry blocking is always on) | Right Ctrl: hide/show';

        const row1 = document.createElement('div');   // time-boost toggle
        const row2 = document.createElement('div');   // always-on telemetry status
        Object.assign(row2.style, {
            marginTop: '3px',
            fontSize: '10px',
            fontWeight: '600',
            opacity: '0.85',
            letterSpacing: '0.3px',
        });
        wrap.appendChild(row1);
        wrap.appendChild(row2);

        const paint = () => {
            // Row 1 — the toggle (time boost)
            if (timeBoostEnabled) {
                row1.textContent = `+${EXTRA_SECONDS}s  ON`;
                wrap.style.background = '#16a34a';
                wrap.style.color      = '#ffffff';
            } else {
                row1.textContent = `+${EXTRA_SECONDS}s  OFF`;
                wrap.style.background = '#334155';
                wrap.style.color      = '#cbd5e1';
            }
            // Row 2 — always-on telemetry status (never changes)
            row2.textContent =
                `🛡 telemetry always blocked  ·  drops:${stats.blocked}` +
                (timeBoostEnabled ? `  ·  q:${stats.boosted}  pending:+${accumulatedExtraSeconds}s  grp:+${stats.groupExtra}s` : '');
        };
        paintToggleUI     = paint;
        applyUIVisibility = () => { wrap.style.display = uiVisible ? 'block' : 'none'; };

        wrap.addEventListener('click', (e) => {
            e.preventDefault(); e.stopPropagation();
            setTimeBoost(!timeBoostEnabled);
        });
        wrap.addEventListener('mouseenter', () => { wrap.style.transform = 'scale(1.05)'; });
        wrap.addEventListener('mouseleave', () => { wrap.style.transform = 'scale(1)';   });

        paint();
        applyUIVisibility();
        document.body.appendChild(wrap);
        setInterval(paint, 500);

        LOG('Toggle UI installed | uiVisible:', uiVisible);
    }

    window.addEventListener('keydown', (e) => {
        if (e.code === 'ControlRight' && !e.repeat) {
            setUIVisible(!uiVisible);
        }
    }, true);

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', installToggleUI, { once: true });
    } else {
        installToggleUI();
    }

    LOG('=== READY — timeBoost:', timeBoostEnabled,
        '| UI visible:', uiVisible,
        '| telemetry blocking: ALWAYS ON ===');
})();