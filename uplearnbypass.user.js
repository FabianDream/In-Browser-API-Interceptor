// ==UserScript==
// @name         UpLearn Telemetry Blocker & TimeSpent Booster
// @namespace    https://github.com/local/uplearn-telemetry-blocker
// @version      1.9.0
// @description  Blocks telemetry ALWAYS; toggleable +60s time boost and fullscreen block. UI toggled via Right Ctrl (Win/Linux) or Right Command (macOS).
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

    LOG('=== SCRIPT LOADED on', location.host, '| platform:', navigator.platform, '===');

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

    const stats = {
        apiPosts: 0, seen: 0, boosted: 0, blocked: 0, groupExtra: 0,
        fsBlocked: 0,
    };

    // ============================================================
    // ─── TELEMETRY BLOCKING (ALWAYS ON) ────────────────────────
    // ============================================================
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
    // ─── STATE ─────────────────────────────────────────────────
    // ============================================================
    const QUIZ_OP             = 'AnswerProgressQuizQuestion';
    const GROUP_OP            = 'CompleteProgressQuizGroup';
    const EXTRA_SECONDS       = 60;
    const TOGGLE_STORAGE_KEY  = 'uplearn_time_boost_enabled';
    const FS_BLOCK_KEY        = 'uplearn_fs_block_enabled';
    const UI_VISIBLE_KEY      = 'uplearn_time_boost_ui_visible';

    let accumulatedExtraSeconds = 0;

    let timeBoostEnabled = (() => {
        try {
            const v = localStorage.getItem(TOGGLE_STORAGE_KEY);
            return v === null ? true : v === 'true';
        } catch { return true; }
    })();

    let fsBlockEnabled = (() => {
        try {
            const v = localStorage.getItem(FS_BLOCK_KEY);
            return v === null ? true : v === 'true';   // default ON = block
        } catch { return true; }
    })();

    let uiVisible = (() => {
        try {
            const v = localStorage.getItem(UI_VISIBLE_KEY);
            return v === null ? true : v === 'true';
        } catch { return true; }
    })();

    let paintUI = null;
    let applyUIVisibility = null;

    function setTimeBoost(enabled) {
        timeBoostEnabled = !!enabled;
        try { localStorage.setItem(TOGGLE_STORAGE_KEY, String(timeBoostEnabled)); } catch {}
        if (typeof paintUI === 'function') paintUI();
        LOG('time-boost ' + (timeBoostEnabled ? 'ENABLED' : 'DISABLED') +
            '  (telemetry blocking remains ALWAYS ON)');
        return timeBoostEnabled;
    }
    function setFsBlock(enabled) {
        fsBlockEnabled = !!enabled;
        try { localStorage.setItem(FS_BLOCK_KEY, String(fsBlockEnabled)); } catch {}
        if (typeof paintUI === 'function') paintUI();
        LOG('fullscreen-block ' +
            (fsBlockEnabled ? 'ENABLED (requestFullscreen will be swallowed)'
                            : 'DISABLED (fullscreen requests allowed)'));
        return fsBlockEnabled;
    }
    function setUIVisible(visible) {
        uiVisible = !!visible;
        try { localStorage.setItem(UI_VISIBLE_KEY, String(uiVisible)); } catch {}
        if (typeof applyUIVisibility === 'function') applyUIVisibility();
        LOG('ui ' + (uiVisible ? 'SHOWN' : 'HIDDEN'));
        return uiVisible;
    }

    window.__ulTimeBoost = {
        // time boost
        isEnabled:    () => timeBoostEnabled,
        enable:       () => setTimeBoost(true),
        disable:      () => setTimeBoost(false),
        toggle:       () => setTimeBoost(!timeBoostEnabled),
        // fullscreen block
        isFsBlocked:  () => fsBlockEnabled,
        enableFsBlock:  () => setFsBlock(true),
        disableFsBlock: () => setFsBlock(false),
        toggleFsBlock:  () => setFsBlock(!fsBlockEnabled),
        // UI visibility
        isUIVisible:  () => uiVisible,
        showUI:       () => setUIVisible(true),
        hideUI:       () => setUIVisible(false),
        toggleUI:     () => setUIVisible(!uiVisible),
        // misc
        getAccumulated:   () => accumulatedExtraSeconds,
        resetAccumulated: () => { accumulatedExtraSeconds = 0; LOG('accumulator reset'); },
        stats,
    };

    // ============================================================
    // ─── FULLSCREEN BLOCK (TOGGLEABLE) ─────────────────────────
    // ============================================================
    // Patched at document-start so that no page script can capture
    // the original method first. Any of the four standard/vendor
    // names, on Element.prototype, gets intercepted.
    //
    // When blocking: we return a resolved Promise (matching the spec
    // behaviour when fullscreen succeeds) rather than rejecting, so
    // page code that does `await requestFullscreen()` doesn't throw.
    function patchFullscreenMethod(proto, name) {
        const orig = proto[name];
        if (typeof orig !== 'function') return;
        proto[name] = function (...args) {
            if (fsBlockEnabled) {
                stats.fsBlocked++;
                LOG(`Blocked ${name}() on <${this.tagName ? this.tagName.toLowerCase() : '?'}> — fullscreen block is ON`);
                return Promise.resolve();
            }
            return orig.apply(this, args);
        };
    }
    try {
        if (typeof Element !== 'undefined' && Element.prototype) {
            patchFullscreenMethod(Element.prototype, 'requestFullscreen');
            patchFullscreenMethod(Element.prototype, 'webkitRequestFullscreen');
            patchFullscreenMethod(Element.prototype, 'mozRequestFullScreen');
            patchFullscreenMethod(Element.prototype, 'msRequestFullscreen');
            LOG('requestFullscreen + vendor prefixes patched');
        }
    } catch (e) { WARN('fullscreen patch failed', e); }

    // ============================================================
    // ─── TIME BOOST LOGIC ──────────────────────────────────────
    // ============================================================
    function parseISODuration(str) {
        const m = /^PT(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(str);
        if (!m) return null;
        return parseFloat(m[1] || 0) * 3600 + parseFloat(m[2] || 0) * 60 + parseFloat(m[3] || 0);
    }
    function toISODuration(totalSeconds) {
        return 'PT' + String(Math.round(totalSeconds * 1000) / 1000) + 'S';
    }

    function maybeBumpTimeSpent(body, source) {
        if (!timeBoostEnabled)         return { body, changed: false };
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

                    if (body == null && input instanceof Request) {
                        const ct = (input.headers.get('content-type') || '').toLowerCase();
                        if (ct.includes('application/json')) {
                            const self = this;
                            const passInit = init;
                            return input.clone().text().then((text) => {
                                if (bodyLooksLikeLogImproperUse(text)) {
                                    LOG('LogImproperUse (Request body) — dropping [always-on]');
                                    stats.blocked++;
                                    return logImproperUseSyntheticResponse();
                                }
                                const { body: newBody, changed } = maybeBumpTimeSpent(text, 'fetch-Req');
                                const newReq = new Request(input, {
                                    body: changed ? newBody : text,
                                    method: input.method
                                });
                                return origFetch.call(self, newReq, passInit);
                            });
                        }
                    }

                    if (body != null && bodyLooksLikeLogImproperUse(body)) {
                        LOG('LogImproperUse — dropping [always-on]');
                        stats.blocked++;
                        return Promise.resolve(logImproperUseSyntheticResponse());
                    }

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

            // Explicit init (strict-mode `arguments` is not aliased)
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
    // UI — two stacked pills
    // ============================================================
    function installToggleUI() {
        if (!document.body) { setTimeout(installToggleUI, 100); return; }
        if (document.getElementById('__ul-pill-container')) return;

        const isMac = /Mac|iPhone|iPad|iPod/i.test(navigator.platform);
        const shortcutLabel = isMac ? 'Right ⌘' : 'Right Ctrl';

        const container = document.createElement('div');
        container.id = '__ul-pill-container';
        Object.assign(container.style, {
            position: 'fixed', right: '12px', bottom: '12px', zIndex: '2147483647',
            display: 'flex', flexDirection: 'column', gap: '6px',
            alignItems: 'flex-end',
            fontFamily: 'system-ui, -apple-system, sans-serif',
        });

        // ---------- Pill 1: Time Boost ----------
        const pillBoost = document.createElement('div');
        Object.assign(pillBoost.style, {
            fontSize: '12px', fontWeight: '600', lineHeight: '1.3',
            padding: '8px 12px', borderRadius: '12px',
            boxShadow: '0 2px 10px rgba(0,0,0,0.30)',
            cursor: 'pointer', userSelect: 'none',
            transition: 'background 0.15s, color 0.15s, transform 0.1s',
            letterSpacing: '0.2px', textAlign: 'center',
        });
        pillBoost.title =
            'Click: toggle +' + EXTRA_SECONDS + 's time boost (telemetry blocking is always on) | ' +
            shortcutLabel + ': hide/show all pills';

        const boostRow1 = document.createElement('div');
        const boostRow2 = document.createElement('div');
        Object.assign(boostRow2.style, {
            marginTop: '3px', fontSize: '10px', fontWeight: '600',
            opacity: '0.85', letterSpacing: '0.3px',
        });
        pillBoost.appendChild(boostRow1);
        pillBoost.appendChild(boostRow2);

        // ---------- Pill 2: Fullscreen Block ----------
        const pillFS = document.createElement('div');
        Object.assign(pillFS.style, {
            fontSize: '12px', fontWeight: '600', lineHeight: '1.3',
            padding: '8px 12px', borderRadius: '12px',
            boxShadow: '0 2px 10px rgba(0,0,0,0.30)',
            cursor: 'pointer', userSelect: 'none',
            transition: 'background 0.15s, color 0.15s, transform 0.1s',
            letterSpacing: '0.2px', textAlign: 'center',
        });
        pillFS.title =
            'Click: toggle auto-fullscreen blocking. ' +
            'When BLOCKED, requestFullscreen() calls from the page are swallowed.';

        const fsRow1 = document.createElement('div');
        const fsRow2 = document.createElement('div');
        Object.assign(fsRow2.style, {
            marginTop: '3px', fontSize: '10px', fontWeight: '600',
            opacity: '0.85', letterSpacing: '0.3px',
        });
        pillFS.appendChild(fsRow1);
        pillFS.appendChild(fsRow2);

        // ---------- Paint ----------
        paintUI = () => {
            // Pill 1
            if (timeBoostEnabled) {
                boostRow1.textContent = `+${EXTRA_SECONDS}s  ON`;
                pillBoost.style.background = '#16a34a';
                pillBoost.style.color      = '#ffffff';
            } else {
                boostRow1.textContent = `+${EXTRA_SECONDS}s  OFF`;
                pillBoost.style.background = '#334155';
                pillBoost.style.color      = '#cbd5e1';
            }
            boostRow2.textContent =
                `🛡 telemetry always blocked  ·  drops:${stats.blocked}` +
                (timeBoostEnabled
                    ? `  ·  q:${stats.boosted}  pending:+${accumulatedExtraSeconds}s  grp:+${stats.groupExtra}s`
                    : '');

            // Pill 2
            if (fsBlockEnabled) {
                fsRow1.textContent = `Fullscreen: BLOCKED`;
                pillFS.style.background = '#0369a1';    // blue for "active block"
                pillFS.style.color      = '#ffffff';
            } else {
                fsRow1.textContent = `Fullscreen: ALLOWED`;
                pillFS.style.background = '#334155';    // grey for "off"
                pillFS.style.color      = '#cbd5e1';
            }
            fsRow2.textContent = `fs-blocked:${stats.fsBlocked}`;
        };
        applyUIVisibility = () => { container.style.display = uiVisible ? 'flex' : 'none'; };

        // ---------- Events ----------
        pillBoost.addEventListener('click', (e) => {
            e.preventDefault(); e.stopPropagation();
            setTimeBoost(!timeBoostEnabled);
        });
        pillBoost.addEventListener('mouseenter', () => { pillBoost.style.transform = 'scale(1.05)'; });
        pillBoost.addEventListener('mouseleave', () => { pillBoost.style.transform = 'scale(1)';   });

        pillFS.addEventListener('click', (e) => {
            e.preventDefault(); e.stopPropagation();
            setFsBlock(!fsBlockEnabled);
        });
        pillFS.addEventListener('mouseenter', () => { pillFS.style.transform = 'scale(1.05)'; });
        pillFS.addEventListener('mouseleave', () => { pillFS.style.transform = 'scale(1)';   });

        container.appendChild(pillFS);
        container.appendChild(pillBoost);
        paintUI();
        applyUIVisibility();
        document.body.appendChild(container);
        setInterval(paintUI, 500);

        LOG('Toggle UI installed | timeBoost:', timeBoostEnabled,
            '| fsBlock:', fsBlockEnabled, '| uiVisible:', uiVisible,
            '| shortcut:', shortcutLabel);
    }

    // ---- UI visibility shortcut: Right Ctrl (Win/Linux) OR Right Command (macOS) ----
    const UI_TOGGLE_CODES = new Set(['ControlRight', 'MetaRight']);
    window.addEventListener('keydown', (e) => {
        if (UI_TOGGLE_CODES.has(e.code) && !e.repeat) {
            setUIVisible(!uiVisible);
        }
    }, true);

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', installToggleUI, { once: true });
    } else {
        installToggleUI();
    }

    LOG('=== READY — timeBoost:', timeBoostEnabled,
        '| fsBlock:', fsBlockEnabled,
        '| UI visible:', uiVisible,
        '| telemetry blocking: ALWAYS ON ===');
})();