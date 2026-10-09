// ==UserScript==
// @name         UpLearn Telemetry Blocker & TimeSpent Booster
// @namespace    https://github.com/local/uplearn-telemetry-blocker
// @version      2.2.0
// @description  Blocks telemetry ALWAYS; random-range time boost; full control panel UI with custom keybind
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

    // ============================================================
    // SETTINGS
    // ============================================================
    const SETTINGS_KEY      = 'uplearn_settings_v2';
    const LEGACY_BOOST_KEY  = 'uplearn_time_boost_enabled';
    const LEGACY_UI_KEY     = 'uplearn_time_boost_ui_visible';

    const DEFAULT_KEYBIND = {
        code: 'ControlRight',
        ctrl: false,
        shift: false,
        alt: false,
        meta: false,
    };

    const DEFAULT_SETTINGS = {
        // Time boost
        timeBoostEnabled:      true,
        extraSecondsMin:       30,
        extraSecondsMax:       90,
        boostQuizQuestions:    true,
        boostGroupCompletion:  true,
        // Telemetry
        blockLogImproperUse:   true,
        // Visibility spoofing
        spoofVisibility:       true,
        spoofFocus:            true,
        suppressVisibilityEvents: true,
        // UI
        pillVisible:           true,
        pillPosition:          'bottom-right',
        pillOpacity:           1,
        showStats:             true,
        theme:                 'dark',
        accentColor:           '#16a34a',
        logLevel:              'normal',
        uiToggleKeybind:       Object.assign({}, DEFAULT_KEYBIND),
    };

    function normalizeKeybind(kb) {
        if (!kb) return Object.assign({}, DEFAULT_KEYBIND);
        if (typeof kb === 'string') return { code: kb, ctrl: false, shift: false, alt: false, meta: false };
        if (typeof kb !== 'object') return Object.assign({}, DEFAULT_KEYBIND);
        return {
            code: kb.code || null,
            ctrl: !!kb.ctrl,
            shift: !!kb.shift,
            alt: !!kb.alt,
            meta: !!kb.meta,
        };
    }

    function loadSettings() {
        const s = Object.assign({}, DEFAULT_SETTINGS);
        try {
            const raw = localStorage.getItem(SETTINGS_KEY);
            if (raw) {
                const parsed = JSON.parse(raw);
                // Migrate single `extraSeconds` -> min/max range
                if (typeof parsed.extraSeconds === 'number') {
                    parsed.extraSecondsMin = parsed.extraSeconds;
                    parsed.extraSecondsMax = parsed.extraSeconds;
                    delete parsed.extraSeconds;
                }
                Object.assign(s, parsed);
            } else {
                // migrate from v1
                const b = localStorage.getItem(LEGACY_BOOST_KEY);
                if (b !== null) s.timeBoostEnabled = b === 'true';
                const u = localStorage.getItem(LEGACY_UI_KEY);
                if (u !== null) s.pillVisible = u === 'true';
            }
        } catch (e) { console.warn('[UL] load settings failed', e); }

        normalizeRange(s);
        s.uiToggleKeybind = normalizeKeybind(s.uiToggleKeybind);
        return s;
    }

    function normalizeRange(s) {
        let min = Number(s.extraSecondsMin);
        let max = Number(s.extraSecondsMax);
        if (!isFinite(min) || min < 1) min = DEFAULT_SETTINGS.extraSecondsMin;
        if (!isFinite(max) || max < 1) max = DEFAULT_SETTINGS.extraSecondsMax;
        min = Math.round(min);
        max = Math.round(max);
        if (min > max) { const t = min; min = max; max = t; }
        s.extraSecondsMin = min;
        s.extraSecondsMax = max;
    }

    const settings = loadSettings();

    function saveSettings() {
        try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch {}
    }

    // ============================================================
    // LOGGING
    // ============================================================
    const LOG = (msg, ...rest) => {
        if (settings.logLevel === 'silent') return;
        console.log('%c[UL] ' + msg, 'color:#00e5ff;font-weight:bold', ...rest);
    };
    const WARN = (msg, ...rest) => {
        if (settings.logLevel === 'silent') return;
        console.warn('[UL] ' + msg, ...rest);
    };

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
    // TELEMETRY BLOCKING
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
    // TIME BOOST
    // ============================================================
    const QUIZ_OP  = 'AnswerProgressQuizQuestion';
    const GROUP_OP = 'CompleteProgressQuizGroup';

    let accumulatedExtraSeconds  = 0;
    let accumulatedQuestionCount = 0;

    function parseISODuration(str) {
        const m = /^PT(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(str);
        if (!m) return null;
        return parseFloat(m[1] || 0) * 3600 + parseFloat(m[2] || 0) * 60 + parseFloat(m[3] || 0);
    }
    function toISODuration(totalSeconds) {
        return 'PT' + String(Math.round(totalSeconds * 1000) / 1000) + 'S';
    }

    function pickExtraSeconds() {
        const min = Math.min(settings.extraSecondsMin, settings.extraSecondsMax);
        const max = Math.max(settings.extraSecondsMin, settings.extraSecondsMax);
        if (min === max) return min;
        return Math.floor(min + Math.random() * (max - min + 1));
    }

    function maybeBumpTimeSpent(body, source) {
        if (!settings.timeBoostEnabled) return { body, changed: false };
        if (typeof body !== 'string')    return { body, changed: false };

        const hasQuiz  = settings.boostQuizQuestions   && body.includes(QUIZ_OP);
        const hasGroup = settings.boostGroupCompletion && body.includes(GROUP_OP);
        if (!hasQuiz && !hasGroup) return { body, changed: false };

        let json;
        try { json = JSON.parse(body); }
        catch { return { body, changed: false }; }

        let changed = false;

        const patch = (obj) => {
            if (!obj || !obj.operationName || !obj.variables) return;

            if (settings.boostQuizQuestions &&
                obj.operationName === QUIZ_OP &&
                typeof obj.variables.timeSpent === 'string') {
                const total = parseISODuration(obj.variables.timeSpent);
                if (total === null) return;
                const before = obj.variables.timeSpent;
                const extra  = pickExtraSeconds();
                obj.variables.timeSpent = toISODuration(total + extra);
                accumulatedExtraSeconds  += extra;
                accumulatedQuestionCount += 1;
                stats.seen++;
                stats.boosted++;
                changed = true;
                LOG(`[${source}] ${QUIZ_OP}: ${before} -> ${obj.variables.timeSpent} ` +
                    `(+${extra}s rolled from [${settings.extraSecondsMin}-${settings.extraSecondsMax}]` +
                    `, accumulated: ${accumulatedExtraSeconds}s across ${accumulatedQuestionCount} q)`);
            }
            else if (settings.boostGroupCompletion &&
                     obj.operationName === GROUP_OP &&
                     typeof obj.variables.timeSpent === 'string') {
                const total = parseISODuration(obj.variables.timeSpent);
                if (total === null) return;
                const before  = obj.variables.timeSpent;
                const bonus   = accumulatedExtraSeconds;
                const count   = accumulatedQuestionCount;
                obj.variables.timeSpent = toISODuration(total + bonus);
                stats.groupExtra += bonus;
                changed = true;
                LOG(`[${source}] ${GROUP_OP}: ${before} -> ${obj.variables.timeSpent} ` +
                    `(+${bonus}s from ${count} question(s))`);
                accumulatedExtraSeconds  = 0;
                accumulatedQuestionCount = 0;
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
                                if (settings.blockLogImproperUse && bodyLooksLikeLogImproperUse(text)) {
                                    LOG('LogImproperUse (Request body) — dropping');
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

                    if (settings.blockLogImproperUse && body != null && bodyLooksLikeLogImproperUse(body)) {
                        LOG('LogImproperUse — dropping');
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

                    if (settings.blockLogImproperUse && bodyLooksLikeLogImproperUse(body)) {
                        LOG('xhr LogImproperUse — dropping');
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
    // VISIBILITY / FOCUS SPOOFING
    // ============================================================
    const ORIG_VIS = (() => {
        try {
            const d = Object.getOwnPropertyDescriptor(Document.prototype, 'visibilityState')
                   || Object.getOwnPropertyDescriptor(HTMLDocument.prototype, 'visibilityState');
            return d && d.get ? d.get : null;
        } catch { return null; }
    })();
    const ORIG_HIDDEN = (() => {
        try {
            const d = Object.getOwnPropertyDescriptor(Document.prototype, 'hidden')
                   || Object.getOwnPropertyDescriptor(HTMLDocument.prototype, 'hidden');
            return d && d.get ? d.get : null;
        } catch { return null; }
    })();
    const ORIG_HAS_FOCUS = document.hasFocus ? document.hasFocus.bind(document) : (() => true);

    function patchVisibilityProps() {
        try {
            Object.defineProperty(document, 'visibilityState', {
                get: () => settings.spoofVisibility ? 'visible' : (ORIG_VIS ? ORIG_VIS.call(document) : 'visible'),
                configurable: true
            });
            Object.defineProperty(document, 'webkitVisibilityState', {
                get: () => settings.spoofVisibility ? 'visible' : (ORIG_VIS ? ORIG_VIS.call(document) : 'visible'),
                configurable: true
            });
            Object.defineProperty(document, 'hidden', {
                get: () => settings.spoofVisibility ? false : (ORIG_HIDDEN ? ORIG_HIDDEN.call(document) : false),
                configurable: true
            });
            Object.defineProperty(document, 'webkitHidden', {
                get: () => settings.spoofVisibility ? false : (ORIG_HIDDEN ? ORIG_HIDDEN.call(document) : false),
                configurable: true
            });
        } catch (e) { WARN('visibility patch failed', e); }
    }
    patchVisibilityProps();

    function installHasFocusPatch() {
        try {
            document.hasFocus = function () {
                if (settings.spoofFocus) return true;
                return ORIG_HAS_FOCUS();
            };
        } catch {}
    }
    installHasFocusPatch();

    const SUPPRESSED_EVENTS = new Set([
        'visibilitychange', 'webkitvisibilitychange', 'blur', 'focusout', 'pagehide'
    ]);

    function wrapAddEventListener(target) {
        const origAdd = target.addEventListener;
        target.addEventListener = function (type, listener, options) {
            if (settings.suppressVisibilityEvents && SUPPRESSED_EVENTS.has(type)) return;
            return origAdd.call(this, type, listener, options);
        };
    }
    wrapAddEventListener(window);
    wrapAddEventListener(document);

    try {
        const origProtoAdd = EventTarget.prototype.addEventListener;
        EventTarget.prototype.addEventListener = function (type, listener, options) {
            if (settings.suppressVisibilityEvents &&
                (this === window || this === document) &&
                SUPPRESSED_EVENTS.has(type)) return;
            return origProtoAdd.call(this, type, listener, options);
        };
    } catch {}

    ['onblur', 'onfocusout', 'onpagehide', 'onvisibilitychange'].forEach((prop) => {
        try {
            Object.defineProperty(window,   prop, { get: () => null, set: () => {}, configurable: true });
            Object.defineProperty(document, prop, { get: () => null, set: () => {}, configurable: true });
        } catch {}
    });

    const KILL = (e) => {
        if (!settings.suppressVisibilityEvents) return;
        e.stopImmediatePropagation(); e.stopPropagation();
    };
    ['visibilitychange', 'webkitvisibilitychange', 'blur', 'focusout', 'pagehide'].forEach((evt) => {
        try {
            EventTarget.prototype.addEventListener.call(window,   evt, KILL, true);
            EventTarget.prototype.addEventListener.call(document, evt, KILL, true);
        } catch {}
    });

    setInterval(() => {
        patchVisibilityProps();
        installHasFocusPatch();
    }, 2000);

    // ============================================================
    // KEYBIND HELPERS
    // ============================================================
    const KEY_DISPLAY_MAP = {
        'ControlRight': 'Right Ctrl',
        'ControlLeft':  'Left Ctrl',
        'ShiftRight':   'Right Shift',
        'ShiftLeft':    'Left Shift',
        'AltRight':     'Right Alt',
        'AltLeft':      'Left Alt',
        'MetaRight':    'Right Meta',
        'MetaLeft':     'Left Meta',
        'Space':        'Space',
        'Enter':        'Enter',
        'NumpadEnter':  'Num Enter',
        'Tab':          'Tab',
        'Backspace':    'Backspace',
        'Delete':       'Delete',
        'Escape':       'Escape',
        'ArrowUp':      '↑',
        'ArrowDown':    '↓',
        'ArrowLeft':    '←',
        'ArrowRight':   '→',
        'Home':         'Home',
        'End':          'End',
        'PageUp':       'Page Up',
        'PageDown':     'Page Down',
        'Insert':       'Insert',
        'CapsLock':     'Caps Lock',
        'ScrollLock':   'Scroll Lock',
        'Pause':        'Pause',
        'NumLock':      'Num Lock',
    };

    function formatKeyCode(code) {
        if (!code) return 'None';
        if (KEY_DISPLAY_MAP[code]) return KEY_DISPLAY_MAP[code];
        if (/^Key[A-Z]$/.test(code)) return code.slice(3);
        if (/^Digit\d$/.test(code)) return code.slice(5);
        if (/^Numpad\d$/.test(code)) return 'Num ' + code.slice(6);
        if (/^Numpad/.test(code)) return 'Num ' + code.slice(6);
        if (/^F\d+$/.test(code)) return code;
        return code;
    }

    function formatKeybind(kb) {
        if (!kb || !kb.code) return 'None';
        const parts = [];
        if (kb.ctrl)  parts.push('Ctrl');
        if (kb.shift) parts.push('Shift');
        if (kb.alt)   parts.push('Alt');
        if (kb.meta)  parts.push('Meta');
        parts.push(formatKeyCode(kb.code));
        return parts.join(' + ');
    }

    function isModifierCode(code) {
        return /^(Control|Shift|Alt|Meta)(Left|Right)$/.test(code);
    }

    function captureKeybindFromEvent(e) {
        const kb = {
            code:  e.code,
            ctrl:  e.ctrlKey,
            shift: e.shiftKey,
            alt:   e.altKey,
            meta:  e.metaKey,
        };
        // A modifier key reports itself as pressed in its own modifier flag.
        // Strip that so the stored combo matches what the user "means".
        if (e.code === 'ControlLeft' || e.code === 'ControlRight') kb.ctrl  = false;
        if (e.code === 'ShiftLeft'   || e.code === 'ShiftRight')   kb.shift = false;
        if (e.code === 'AltLeft'     || e.code === 'AltRight')     kb.alt   = false;
        if (e.code === 'MetaLeft'    || e.code === 'MetaRight')    kb.meta  = false;
        return kb;
    }

    function matchesKeybind(e, kb) {
        if (!kb || !kb.code) return false;
        if (isModifierCode(kb.code)) {
            // For modifier-only keybinds, match on code alone
            return e.code === kb.code;
        }
        return e.code === kb.code
            && !!e.ctrlKey  === !!kb.ctrl
            && !!e.shiftKey === !!kb.shift
            && !!e.altKey   === !!kb.alt
            && !!e.metaKey  === !!kb.meta;
    }

    // ============================================================
    // STYLES
    // ============================================================
    function ensureStyles() {
        if (document.getElementById('__ul-styles')) return;
        const style = document.createElement('style');
        style.id = '__ul-styles';
        style.textContent = `
            /* ---------- PILL ---------- */
            #__ul-pill {
                position: fixed;
                z-index: 2147483646;
                font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
                font-size: 12px;
                font-weight: 600;
                line-height: 1.3;
                border-radius: 12px;
                box-shadow: 0 2px 12px rgba(0,0,0,0.35);
                user-select: none;
                display: flex;
                align-items: stretch;
                overflow: hidden;
                transition: transform 0.12s ease, opacity 0.15s ease;
                letter-spacing: 0.2px;
                border: 1px solid rgba(255,255,255,0.08);
            }
            #__ul-pill .ul-pill-main {
                padding: 8px 12px;
                cursor: pointer;
                text-align: center;
                transition: background 0.15s, color 0.15s;
                display: flex;
                flex-direction: column;
                justify-content: center;
                gap: 2px;
            }
            #__ul-pill .ul-pill-main:hover { filter: brightness(1.08); }
            #__ul-pill .ul-pill-row1 { font-weight: 700; }
            #__ul-pill .ul-pill-row2 {
                font-size: 10px;
                font-weight: 600;
                opacity: 0.88;
                letter-spacing: 0.3px;
            }
            #__ul-pill .ul-pill-gear {
                display: flex; align-items: center; justify-content: center;
                padding: 0 10px;
                cursor: pointer;
                background: rgba(0,0,0,0.22);
                color: inherit;
                font-size: 14px;
                transition: background 0.15s;
                border: none;
                font-family: inherit;
            }
            #__ul-pill .ul-pill-gear:hover { background: rgba(0,0,0,0.4); }

            /* ---------- MODAL ---------- */
            #__ul-settings-overlay {
                position: fixed; inset: 0;
                z-index: 2147483647;
                background: rgba(0,0,0,0.55);
                backdrop-filter: blur(6px);
                -webkit-backdrop-filter: blur(6px);
                display: flex; align-items: center; justify-content: center;
                font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
                animation: ul-fade-in 0.15s ease-out;
            }
            @keyframes ul-fade-in { from { opacity: 0; } to { opacity: 1; } }

            .ul-modal {
                --ul-bg:       #0f172a;
                --ul-fg:       #e2e8f0;
                --ul-muted:    #94a3b8;
                --ul-border:   rgba(148, 163, 184, 0.18);
                --ul-card:     #1e293b;
                --ul-input-bg: #0b1220;
                --ul-accent:   #16a34a;
                --ul-danger:   #dc2626;

                width: min(760px, 94vw);
                max-height: 88vh;
                background: var(--ul-bg);
                color: var(--ul-fg);
                border-radius: 16px;
                border: 1px solid var(--ul-border);
                box-shadow: 0 24px 80px rgba(0,0,0,0.6);
                display: flex; flex-direction: column;
                overflow: hidden;
                animation: ul-pop 0.18s ease-out;
            }
            @keyframes ul-pop { from { transform: scale(0.96); opacity: 0; } to { transform: scale(1); opacity: 1; } }
            .ul-modal[data-theme="light"] {
                --ul-bg:       #ffffff;
                --ul-fg:       #0f172a;
                --ul-muted:    #64748b;
                --ul-border:   rgba(15, 23, 42, 0.12);
                --ul-card:     #f1f5f9;
                --ul-input-bg: #ffffff;
            }

            .ul-modal .ul-header {
                display: flex; align-items: center; justify-content: space-between;
                padding: 16px 22px;
                border-bottom: 1px solid var(--ul-border);
                background: var(--ul-card);
                flex-shrink: 0;
            }
            .ul-modal .ul-title { display: flex; align-items: center; gap: 10px; }
            .ul-modal .ul-title h2 {
                margin: 0; font-size: 16px; font-weight: 700;
                letter-spacing: 0.2px;
            }
            .ul-modal .ul-logo { font-size: 20px; }
            .ul-modal .ul-close {
                background: transparent; border: none; color: var(--ul-muted);
                font-size: 20px; cursor: pointer; line-height: 1;
                padding: 4px 10px; border-radius: 8px;
                transition: background 0.15s, color 0.15s;
                font-family: inherit;
            }
            .ul-modal .ul-close:hover { background: rgba(148,163,184,0.18); color: var(--ul-fg); }

            .ul-modal .ul-body {
                padding: 4px 22px 20px;
                overflow-y: auto;
                flex: 1;
                scrollbar-width: thin;
                scrollbar-color: var(--ul-border) transparent;
            }
            .ul-modal .ul-body::-webkit-scrollbar { width: 8px; }
            .ul-modal .ul-body::-webkit-scrollbar-thumb {
                background: var(--ul-border); border-radius: 4px;
            }

            .ul-modal .ul-section { margin-top: 20px; }
            .ul-modal .ul-section h3 {
                margin: 0 0 4px 0; font-size: 12px; font-weight: 700;
                text-transform: uppercase; letter-spacing: 0.9px;
                color: var(--ul-muted);
            }
            .ul-modal .ul-desc {
                margin: 0 0 10px 0; font-size: 12px; color: var(--ul-muted);
            }

            .ul-modal .ul-row {
                display: flex; align-items: center; justify-content: space-between;
                gap: 16px;
                padding: 10px 14px;
                border-radius: 10px;
                background: var(--ul-card);
                margin-bottom: 6px;
                border: 1px solid transparent;
                transition: border-color 0.15s;
            }
            .ul-modal .ul-row:hover { border-color: var(--ul-border); }
            .ul-modal .ul-row > label {
                flex: 1; font-size: 13px; cursor: pointer;
                display: flex; flex-direction: column;
            }
            .ul-modal .ul-row > label small {
                display: block; color: var(--ul-muted);
                font-size: 11px; margin-top: 2px; font-weight: 400;
            }

            .ul-modal input[type="checkbox"] {
                appearance: none; -webkit-appearance: none;
                width: 40px; height: 22px; border-radius: 22px;
                background: #475569; position: relative; cursor: pointer;
                transition: background 0.15s;
                flex-shrink: 0;
                margin: 0;
            }
            .ul-modal input[type="checkbox"]::after {
                content: ''; position: absolute; top: 2px; left: 2px;
                width: 18px; height: 18px; border-radius: 50%;
                background: white; transition: transform 0.15s;
                box-shadow: 0 1px 3px rgba(0,0,0,0.3);
            }
            .ul-modal input[type="checkbox"]:checked { background: var(--ul-accent); }
            .ul-modal input[type="checkbox"]:checked::after { transform: translateX(18px); }

            .ul-modal input[type="number"], .ul-modal select {
                background: var(--ul-input-bg);
                color: var(--ul-fg);
                border: 1px solid var(--ul-border);
                border-radius: 8px;
                padding: 6px 10px;
                font-size: 13px;
                font-family: inherit;
                min-width: 120px;
                cursor: pointer;
            }
            .ul-modal input[type="number"] { cursor: text; }
            .ul-modal input[type="number"]:focus, .ul-modal select:focus {
                outline: 2px solid var(--ul-accent); outline-offset: 0;
            }

            /* Hide native spinner arrows on number inputs */
            .ul-modal input[type="number"]::-webkit-outer-spin-button,
            .ul-modal input[type="number"]::-webkit-inner-spin-button {
                -webkit-appearance: none;
                appearance: none;
                margin: 0;
            }
            .ul-modal input[type="number"] {
                -moz-appearance: textfield;
                appearance: textfield;
            }

            .ul-modal input[type="number"].ul-num-sm {
                min-width: 0;
                width: 74px;
                text-align: center;
                font-variant-numeric: tabular-nums;
                font-weight: 600;
            }

            .ul-modal input[type="color"] {
                width: 44px; height: 30px;
                border: 1px solid var(--ul-border);
                border-radius: 8px; background: transparent;
                cursor: pointer; padding: 2px;
            }
            .ul-modal input[type="range"] {
                width: 180px; accent-color: var(--ul-accent); cursor: pointer;
                margin: 0;
            }
            .ul-modal .ul-val {
                min-width: 52px; text-align: right; font-weight: 700;
                font-size: 13px; font-variant-numeric: tabular-nums;
            }

            .ul-modal .ul-range-group {
                display: flex; align-items: center; gap: 8px;
                flex-shrink: 0;
            }
            .ul-modal .ul-range-sep {
                color: var(--ul-muted); font-size: 12px; font-weight: 600;
            }
            .ul-modal .ul-range-unit {
                color: var(--ul-muted); font-size: 12px; font-weight: 600;
            }
            .ul-modal .ul-hint {
                display: block;
                font-size: 11px;
                color: var(--ul-muted);
                margin-top: 4px;
                text-align: right;
                font-weight: 500;
            }

            /* ---------- KEYBIND ---------- */
            .ul-modal .ul-keybind-group {
                display: flex; align-items: center; gap: 6px;
                flex-shrink: 0;
            }
            .ul-modal .ul-keybind-btn {
                background: var(--ul-input-bg);
                color: var(--ul-fg);
                border: 1px solid var(--ul-border);
                border-radius: 8px;
                padding: 6px 14px;
                font-size: 13px;
                font-family: inherit;
                font-weight: 600;
                cursor: pointer;
                min-width: 118px;
                text-align: center;
                transition: background 0.15s, border-color 0.15s, color 0.15s;
            }
            .ul-modal .ul-keybind-btn:hover {
                background: rgba(148,163,184,0.14);
            }
            .ul-modal .ul-keybind-btn.ul-capturing {
                background: var(--ul-accent);
                color: #ffffff;
                border-color: transparent;
                animation: ul-pulse 1.2s ease-in-out infinite;
            }
            @keyframes ul-pulse {
                0%, 100% { opacity: 1; }
                50%      { opacity: 0.65; }
            }
            .ul-modal .ul-keybind-clear {
                background: transparent;
                color: var(--ul-muted);
                border: 1px solid var(--ul-border);
                border-radius: 8px;
                padding: 6px 10px;
                cursor: pointer;
                font-family: inherit;
                font-size: 12px;
                font-weight: 600;
                line-height: 1;
                transition: background 0.15s, color 0.15s, border-color 0.15s;
            }
            .ul-modal .ul-keybind-clear:hover {
                background: rgba(220,38,38,0.12);
                color: var(--ul-danger);
                border-color: var(--ul-danger);
            }

            .ul-modal .ul-footer {
                display: flex; align-items: center; gap: 10px;
                padding: 14px 22px;
                border-top: 1px solid var(--ul-border);
                background: var(--ul-card);
                flex-shrink: 0;
            }
            .ul-modal .ul-spacer { flex: 1; }
            .ul-modal .ul-btn {
                background: var(--ul-accent); color: #ffffff;
                border: 1px solid transparent; border-radius: 8px;
                padding: 8px 18px; font-size: 13px; font-weight: 600;
                cursor: pointer; font-family: inherit;
                transition: filter 0.15s, background 0.15s, border-color 0.15s;
            }
            .ul-modal .ul-btn:hover { filter: brightness(1.1); }
            .ul-modal .ul-btn-secondary {
                background: transparent; color: var(--ul-fg);
                border: 1px solid var(--ul-border);
            }
            .ul-modal .ul-btn-secondary:hover {
                background: rgba(148,163,184,0.12);
            }
            .ul-modal .ul-btn-danger {
                background: transparent; color: var(--ul-danger);
                border: 1px solid var(--ul-danger);
            }
            .ul-modal .ul-btn-danger:hover {
                background: rgba(220,38,38,0.12);
            }

            .ul-modal .ul-stats {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
                gap: 8px;
            }
            .ul-modal .ul-stat {
                background: var(--ul-card);
                border-radius: 10px;
                padding: 10px 12px;
                border: 1px solid var(--ul-border);
            }
            .ul-modal .ul-stat-label {
                font-size: 10px; color: var(--ul-muted);
                text-transform: uppercase; letter-spacing: 0.6px;
                font-weight: 600;
            }
            .ul-modal .ul-stat-value {
                font-size: 18px; font-weight: 700; margin-top: 3px;
                font-variant-numeric: tabular-nums;
            }
        `;
        (document.head || document.documentElement).appendChild(style);
    }

    // ============================================================
    // PILL UI
    // ============================================================
    const POSITION_STYLES = {
        'bottom-right': { right: '12px', bottom: '12px', left: 'auto', top: 'auto' },
        'bottom-left':  { left: '12px',  bottom: '12px', right: 'auto', top: 'auto' },
        'top-right':    { right: '12px', top: '12px',   left: 'auto', bottom: 'auto' },
        'top-left':     { left: '12px',  top: '12px',   right: 'auto', bottom: 'auto' },
    };

    let pillEl     = null;
    let pillPaint  = null;

    function applyPillPosition() {
        if (!pillEl) return;
        const pos = POSITION_STYLES[settings.pillPosition] || POSITION_STYLES['bottom-right'];
        Object.assign(pillEl.style, pos);
    }

    function applyPillVisibility() {
        if (!pillEl) return;
        pillEl.style.display = settings.pillVisible ? 'flex' : 'none';
    }

    function applyPillOpacity() {
        if (!pillEl) return;
        pillEl.style.opacity = String(settings.pillOpacity);
    }

    function applyPillAccent() {
        if (!pillEl) return;
        if (settings.timeBoostEnabled) {
            pillEl.style.background = settings.accentColor;
            pillEl.style.color      = '#ffffff';
        } else {
            pillEl.style.background = '#334155';
            pillEl.style.color      = '#cbd5e1';
        }
    }

    function formatRangeLabel() {
        const a = settings.extraSecondsMin;
        const b = settings.extraSecondsMax;
        if (a === b) return `+${a}s`;
        return `+${a}–${b}s`;
    }

    function installPillUI() {
        if (!document.body) { setTimeout(installPillUI, 100); return; }
        if (document.getElementById('__ul-pill')) return;

        ensureStyles();

        const pill = document.createElement('div');
        pill.id = '__ul-pill';

        const main = document.createElement('div');
        main.className = 'ul-pill-main';

        const row1 = document.createElement('div');
        row1.className = 'ul-pill-row1';
        const row2 = document.createElement('div');
        row2.className = 'ul-pill-row2';

        main.appendChild(row1);
        main.appendChild(row2);

        const gear = document.createElement('button');
        gear.className = 'ul-pill-gear';
        gear.type = 'button';
        gear.title = 'Open settings';
        gear.textContent = '⚙';

        pill.appendChild(main);
        pill.appendChild(gear);
        document.body.appendChild(pill);
        pillEl = pill;

        pillPaint = () => {
            const accent = settings.timeBoostEnabled ? settings.accentColor : '#334155';
            pill.style.background = accent;
            pill.style.color      = settings.timeBoostEnabled ? '#ffffff' : '#cbd5e1';
            pill.style.opacity    = String(settings.pillOpacity);

            if (settings.timeBoostEnabled) {
                row1.textContent = `${formatRangeLabel()}  ON`;
            } else {
                row1.textContent = `${formatRangeLabel()}  OFF`;
            }

            if (settings.showStats) {
                row2.textContent =
                    `🛡 blocked:${stats.blocked} · q:${stats.boosted}` +
                    (accumulatedExtraSeconds > 0 ? ` · pending:+${accumulatedExtraSeconds}s` : '') +
                    (stats.groupExtra > 0 ? ` · grp:+${stats.groupExtra}s` : '');
            } else {
                row2.textContent = '🛡 always on';
            }

            // Update tooltip with current keybind
            const kbText = formatKeybind(settings.uiToggleKeybind);
            main.title = `Click: toggle time boost | ${kbText}: hide/show pill`;
        };

        main.addEventListener('click', (e) => {
            e.preventDefault(); e.stopPropagation();
            settings.timeBoostEnabled = !settings.timeBoostEnabled;
            saveSettings();
            LOG('time-boost ' + (settings.timeBoostEnabled ? 'ENABLED' : 'DISABLED'));
            pillPaint();
            syncModalIfOpen();
        });

        gear.addEventListener('click', (e) => {
            e.preventDefault(); e.stopPropagation();
            openSettingsModal();
        });

        pill.addEventListener('mouseenter', () => { pill.style.transform = 'scale(1.04)'; });
        pill.addEventListener('mouseleave', () => { pill.style.transform = 'scale(1)'; });

        applyPillPosition();
        applyPillVisibility();
        applyPillOpacity();
        pillPaint();

        setInterval(() => { if (pillPaint) pillPaint(); }, 500);

        LOG('Pill UI installed');
    }

    // ============================================================
    // SETTINGS MODAL
    // ============================================================
    let modalEl = null;
    let modalStatsInterval = null;
    let capturingKeybind = false;

    function getEffectiveTheme() {
        if (settings.theme === 'auto') {
            try {
                return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
            } catch { return 'dark'; }
        }
        return settings.theme;
    }

    function applyModalTheme() {
        if (!modalEl) return;
        const theme = getEffectiveTheme();
        modalEl.setAttribute('data-theme', theme);
        modalEl.style.setProperty('--ul-accent', settings.accentColor);
    }

    function readInputValue(input) {
        if (input.type === 'checkbox') return input.checked;
        if (input.type === 'number' || input.type === 'range') {
            const n = parseFloat(input.value);
            return isNaN(n) ? null : n;
        }
        return input.value;
    }

    function writeInputValue(input, value) {
        if (input.type === 'checkbox') input.checked = !!value;
        else input.value = value;
    }

    function updateRangeLabels() {
        if (!modalEl) return;
        const po = modalEl.querySelector('#ul-val-pillOpacity');
        if (po) po.textContent = Math.round(settings.pillOpacity * 100) + '%';

        const hint = modalEl.querySelector('#ul-range-hint');
        if (hint) {
            const a = settings.extraSecondsMin;
            const b = settings.extraSecondsMax;
            hint.textContent = (a === b)
                ? `Every question gets +${a}s.`
                : `Each question rolls a random +${a}–${b}s.`;
        }
    }

    function updateKeybindBtn() {
        if (!modalEl) return;
        const btn = modalEl.querySelector('#ul-keybind-btn');
        if (!btn) return;
        if (capturingKeybind) {
            btn.textContent = 'Press a key…';
            btn.classList.add('ul-capturing');
        } else {
            btn.textContent = formatKeybind(settings.uiToggleKeybind);
            btn.classList.remove('ul-capturing');
        }
    }

    function syncModalInputs() {
        if (!modalEl) return;
        modalEl.querySelectorAll('[data-setting]').forEach((input) => {
            const key = input.dataset.setting;
            if (!(key in settings)) return;
            writeInputValue(input, settings[key]);
        });
        updateRangeLabels();
        updateKeybindBtn();
        applyModalTheme();
    }

    function syncModalIfOpen() {
        if (modalEl) syncModalInputs();
    }

    function updateModalStats() {
        if (!modalEl) return;
        const set = (k, v) => {
            const el = modalEl.querySelector(`[data-stat="${k}"]`);
            if (el) el.textContent = v;
        };
        set('apiPosts',  stats.apiPosts);
        set('blocked',   stats.blocked);
        set('boosted',   stats.boosted);
        set('pending',   accumulatedExtraSeconds + 's');
        set('groupExtra', stats.groupExtra + 's');
    }

    function applySettingChange(key, value) {
        settings[key] = value;

        if (key === 'extraSecondsMin' || key === 'extraSecondsMax') {
            normalizeRange(settings);
            if (modalEl) {
                const minEl = modalEl.querySelector('[data-setting="extraSecondsMin"]');
                const maxEl = modalEl.querySelector('[data-setting="extraSecondsMax"]');
                if (minEl) minEl.value = settings.extraSecondsMin;
                if (maxEl) maxEl.value = settings.extraSecondsMax;
            }
        }

        saveSettings();
        LOG('setting changed:', key, '=', value);

        switch (key) {
            case 'timeBoostEnabled':
                applyPillAccent();
                if (pillPaint) pillPaint();
                break;
            case 'extraSecondsMin':
            case 'extraSecondsMax':
                updateRangeLabels();
                if (pillPaint) pillPaint();
                break;
            case 'pillVisible':
                applyPillVisibility();
                break;
            case 'pillPosition':
                applyPillPosition();
                break;
            case 'pillOpacity':
                applyPillOpacity();
                break;
            case 'showStats':
                if (pillPaint) pillPaint();
                break;
            case 'theme':
            case 'accentColor':
                applyModalTheme();
                if (pillPaint) pillPaint();
                break;
            case 'uiToggleKeybind':
                updateKeybindBtn();
                if (pillPaint) pillPaint();
                break;
        }
    }

    function openSettingsModal() {
        if (modalEl) return;
        if (!document.body) return;

        ensureStyles();
        capturingKeybind = false;

        const overlay = document.createElement('div');
        overlay.id = '__ul-settings-overlay';
        overlay.innerHTML = `
            <div class="ul-modal" id="__ul-modal" data-theme="dark">
                <header class="ul-header">
                    <div class="ul-title">
                        <span class="ul-logo">⚙️</span>
                        <h2>UpLearn Control Panel</h2>
                    </div>
                    <button class="ul-close" data-action="close" title="Close (Esc)" aria-label="Close">✕</button>
                </header>
                <div class="ul-body">

                    <section class="ul-section">
                        <h3>⏱ Time Boost</h3>
                        <p class="ul-desc">Add extra time to your quiz answer submissions.</p>

                        <div class="ul-row">
                            <label for="ul-set-timeBoostEnabled">Enable time boost
                                <small>Master switch for the +time feature</small>
                            </label>
                            <input type="checkbox" id="ul-set-timeBoostEnabled" data-setting="timeBoostEnabled">
                        </div>

                        <div class="ul-row">
                            <label for="ul-set-extraSecondsMin">Extra seconds range
                                <small>Random extra time added to each question</small>
                                <span class="ul-hint" id="ul-range-hint"></span>
                            </label>
                            <div class="ul-range-group">
                                <input type="number" class="ul-num-sm" id="ul-set-extraSecondsMin"
                                       data-setting="extraSecondsMin"
                                       min="1" max="3600" step="1"
                                       inputmode="numeric">
                                <span class="ul-range-sep">to</span>
                                <input type="number" class="ul-num-sm" id="ul-set-extraSecondsMax"
                                       data-setting="extraSecondsMax"
                                       min="1" max="3600" step="1"
                                       inputmode="numeric">
                                <span class="ul-range-unit">s</span>
                            </div>
                        </div>

                        <div class="ul-row">
                            <label for="ul-set-boostQuizQuestions">Boost quiz questions
                                <small>Patch AnswerProgressQuizQuestion payloads</small>
                            </label>
                            <input type="checkbox" id="ul-set-boostQuizQuestions" data-setting="boostQuizQuestions">
                        </div>

                        <div class="ul-row">
                            <label for="ul-set-boostGroupCompletion">Boost group completion
                                <small>Apply accumulated bonus on CompleteProgressQuizGroup</small>
                            </label>
                            <input type="checkbox" id="ul-set-boostGroupCompletion" data-setting="boostGroupCompletion">
                        </div>
                    </section>

                    <section class="ul-section">
                        <h3>🛡 Telemetry Blocking</h3>
                        <p class="ul-desc">Drops LogImproperUse requests at the network layer.</p>

                        <div class="ul-row">
                            <label for="ul-set-blockLogImproperUse">Block LogImproperUse
                                <small>Recommended: keep enabled</small>
                            </label>
                            <input type="checkbox" id="ul-set-blockLogImproperUse" data-setting="blockLogImproperUse">
                        </div>
                    </section>

                    <section class="ul-section">
                        <h3>👁 Visibility Spoofing</h3>
                        <p class="ul-desc">Makes the page think it's always focused and visible.</p>

                        <div class="ul-row">
                            <label for="ul-set-spoofVisibility">Spoof visibilityState
                                <small>document.visibilityState always returns "visible"</small>
                            </label>
                            <input type="checkbox" id="ul-set-spoofVisibility" data-setting="spoofVisibility">
                        </div>

                        <div class="ul-row">
                            <label for="ul-set-spoofFocus">Spoof focus
                                <small>document.hasFocus() always returns true</small>
                            </label>
                            <input type="checkbox" id="ul-set-spoofFocus" data-setting="spoofFocus">
                        </div>

                        <div class="ul-row">
                            <label for="ul-set-suppressVisibilityEvents">Suppress visibility events
                                <small>Swallows blur / visibilitychange / pagehide</small>
                            </label>
                            <input type="checkbox" id="ul-set-suppressVisibilityEvents" data-setting="suppressVisibilityEvents">
                        </div>
                    </section>

                    <section class="ul-section">
                        <h3>🎨 Interface</h3>
                        <p class="ul-desc">Customise the on-page pill and this panel.</p>

                        <div class="ul-row">
                            <label for="ul-set-pillVisible">Show control pill
                                <small>Hide/show the floating status pill</small>
                            </label>
                            <input type="checkbox" id="ul-set-pillVisible" data-setting="pillVisible">
                        </div>

                        <div class="ul-row">
                            <label>Toggle-pill keybind
                                <small>Press to show/hide the pill. Click to record a new one.</small>
                            </label>
                            <div class="ul-keybind-group">
                                <button type="button" class="ul-keybind-btn" id="ul-keybind-btn">Right Ctrl</button>
                                <button type="button" class="ul-keybind-clear" id="ul-keybind-clear" title="Clear keybind">✕</button>
                            </div>
                        </div>

                        <div class="ul-row">
                            <label for="ul-set-pillPosition">Pill position</label>
                            <select id="ul-set-pillPosition" data-setting="pillPosition">
                                <option value="bottom-right">Bottom right</option>
                                <option value="bottom-left">Bottom left</option>
                                <option value="top-right">Top right</option>
                                <option value="top-left">Top left</option>
                            </select>
                        </div>

                        <div class="ul-row">
                            <label for="ul-set-pillOpacity">Pill opacity</label>
                            <div style="display:flex;align-items:center;gap:12px;">
                                <input type="range" id="ul-set-pillOpacity" data-setting="pillOpacity"
                                       min="0.2" max="1" step="0.05">
                                <span class="ul-val" id="ul-val-pillOpacity">100%</span>
                            </div>
                        </div>

                        <div class="ul-row">
                            <label for="ul-set-showStats">Show live stats on pill
                                <small>Displays blocked / boosted counts on the pill</small>
                            </label>
                            <input type="checkbox" id="ul-set-showStats" data-setting="showStats">
                        </div>

                        <div class="ul-row">
                            <label for="ul-set-theme">Panel theme</label>
                            <select id="ul-set-theme" data-setting="theme">
                                <option value="dark">Dark</option>
                                <option value="light">Light</option>
                                <option value="auto">Auto (follow system)</option>
                            </select>
                        </div>

                        <div class="ul-row">
                            <label for="ul-set-accentColor">Accent colour</label>
                            <input type="color" id="ul-set-accentColor" data-setting="accentColor">
                        </div>

                        <div class="ul-row">
                            <label for="ul-set-logLevel">Console logging</label>
                            <select id="ul-set-logLevel" data-setting="logLevel">
                                <option value="silent">Silent</option>
                                <option value="normal">Normal</option>
                                <option value="verbose">Verbose</option>
                            </select>
                        </div>
                    </section>

                    <section class="ul-section">
                        <h3>📊 Stats</h3>
                        <p class="ul-desc">Live counters for this session.</p>
                        <div class="ul-stats">
                            <div class="ul-stat">
                                <div class="ul-stat-label">API POSTs</div>
                                <div class="ul-stat-value" data-stat="apiPosts">0</div>
                            </div>
                            <div class="ul-stat">
                                <div class="ul-stat-label">Blocked</div>
                                <div class="ul-stat-value" data-stat="blocked">0</div>
                            </div>
                            <div class="ul-stat">
                                <div class="ul-stat-label">Boosted</div>
                                <div class="ul-stat-value" data-stat="boosted">0</div>
                            </div>
                            <div class="ul-stat">
                                <div class="ul-stat-label">Pending bonus</div>
                                <div class="ul-stat-value" data-stat="pending">0s</div>
                            </div>
                            <div class="ul-stat">
                                <div class="ul-stat-label">Group bonus</div>
                                <div class="ul-stat-value" data-stat="groupExtra">0s</div>
                            </div>
                        </div>
                        <div style="margin-top:10px;">
                            <button class="ul-btn ul-btn-secondary" data-action="reset-stats">Reset stats</button>
                        </div>
                    </section>

                </div>
                <footer class="ul-footer">
                    <button class="ul-btn ul-btn-danger" data-action="reset-all">Reset all settings</button>
                    <div class="ul-spacer"></div>
                    <button class="ul-btn" data-action="close">Done</button>
                </footer>
            </div>
        `;
        document.body.appendChild(overlay);
        modalEl = overlay.querySelector('#__ul-modal');

        // wire setting inputs
        overlay.querySelectorAll('[data-setting]').forEach((input) => {
            const key = input.dataset.setting;

            const handler = () => {
                const val = readInputValue(input);
                if (val === null) return;
                applySettingChange(key, val);
            };

            input.addEventListener('change', handler);
            if (input.type === 'range') input.addEventListener('input', handler);

            if (input.type === 'number') {
                input.addEventListener('blur', () => {
                    applySettingChange(key, readInputValue(input));
                });
                input.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        applySettingChange(key, readInputValue(input));
                        input.blur();
                    }
                });
            }
        });

        // wire keybind recorder
        const kbBtn   = overlay.querySelector('#ul-keybind-btn');
        const kbClear = overlay.querySelector('#ul-keybind-clear');

        kbBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            capturingKeybind = !capturingKeybind;
            updateKeybindBtn();
            LOG('keybind capture ' + (capturingKeybind ? 'started' : 'cancelled'));
        });

        kbClear.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (capturingKeybind) {
                capturingKeybind = false;
                updateKeybindBtn();
                return;
            }
            applySettingChange('uiToggleKeybind', { code: null, ctrl: false, shift: false, alt: false, meta: false });
            LOG('keybind cleared');
        });

        // actions
        overlay.addEventListener('click', (e) => {
            const actionEl = e.target.closest('[data-action]');
            if (actionEl) {
                const action = actionEl.dataset.action;
                if (action === 'close') { closeSettingsModal(); return; }
                if (action === 'reset-all') {
                    if (confirm('Reset all settings to defaults?')) {
                        Object.assign(settings, DEFAULT_SETTINGS);
                        settings.uiToggleKeybind = Object.assign({}, DEFAULT_KEYBIND);
                        normalizeRange(settings);
                        saveSettings();
                        syncModalInputs();
                        applyPillPosition();
                        applyPillVisibility();
                        applyPillOpacity();
                        if (pillPaint) pillPaint();
                        LOG('settings reset to defaults');
                    }
                    return;
                }
                if (action === 'reset-stats') {
                    stats.apiPosts = 0;
                    stats.seen = 0;
                    stats.boosted = 0;
                    stats.blocked = 0;
                    stats.groupExtra = 0;
                    accumulatedExtraSeconds = 0;
                    accumulatedQuestionCount = 0;
                    updateModalStats();
                    if (pillPaint) pillPaint();
                    LOG('stats reset');
                    return;
                }
                return;
            }
            if (e.target === overlay) closeSettingsModal();
        });

        overlay.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && !capturingKeybind) {
                e.stopPropagation();
                closeSettingsModal();
            }
        });
        overlay.tabIndex = -1;
        overlay.focus();

        syncModalInputs();
        updateModalStats();
        modalStatsInterval = setInterval(updateModalStats, 400);

        LOG('Settings modal opened');
    }

    function closeSettingsModal() {
        capturingKeybind = false;
        const overlay = document.getElementById('__ul-settings-overlay');
        if (overlay) overlay.remove();
        modalEl = null;
        if (modalStatsInterval) {
            clearInterval(modalStatsInterval);
            modalStatsInterval = null;
        }
        LOG('Settings modal closed');
    }

    // ============================================================
    // GLOBAL KEYBOARD SHORTCUTS
    // ============================================================
    window.addEventListener('keydown', (e) => {
        // --- Keybind capture mode takes priority ---
        if (capturingKeybind) {
            e.preventDefault();
            e.stopPropagation();
            if (e.code === 'Escape') {
                capturingKeybind = false;
                updateKeybindBtn();
                LOG('keybind capture cancelled');
                return;
            }
            const kb = captureKeybindFromEvent(e);
            applySettingChange('uiToggleKeybind', kb);
            capturingKeybind = false;
            updateKeybindBtn();
            LOG('keybind set to:', formatKeybind(kb));
            return;
        }

        // --- Open settings with Ctrl+Shift+U ---
        if (e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey && e.code === 'KeyU') {
            e.preventDefault();
            openSettingsModal();
            return;
        }

        // --- User-configured keybind toggles the pill ---
        if (matchesKeybind(e, settings.uiToggleKeybind) && !e.repeat) {
            settings.pillVisible = !settings.pillVisible;
            saveSettings();
            applyPillVisibility();
            syncModalIfOpen();
            LOG('pill ' + (settings.pillVisible ? 'SHOWN' : 'HIDDEN'));
        }
    }, true);

    // ============================================================
    // BOOTSTRAP
    // ============================================================
    function bootstrap() {
        installPillUI();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
    } else {
        bootstrap();
    }

    // Expose a console API for power users
    window.__ul = {
        settings,
        saveSettings,
        stats,
        openSettings: openSettingsModal,
        closeSettings: closeSettingsModal,
        resetStats: () => {
            stats.apiPosts = 0;
            stats.seen = 0;
            stats.boosted = 0;
            stats.blocked = 0;
            stats.groupExtra = 0;
            accumulatedExtraSeconds = 0;
            accumulatedQuestionCount = 0;
        },
        getAccumulated: () => accumulatedExtraSeconds,
        getAccumulatedCount: () => accumulatedQuestionCount,
        pickExtraSeconds,
    };

    LOG('=== READY | timeBoost:', settings.timeBoostEnabled,
        '| range:', settings.extraSecondsMin + '–' + settings.extraSecondsMax + 's',
        '| keybind:', formatKeybind(settings.uiToggleKeybind),
        '| telemetry blocking:', settings.blockLogImproperUse ? 'ON' : 'OFF',
        '===');
})();