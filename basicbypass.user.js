// ==UserScript==
// @name         UpLearn Telemetry + Fullscreen + Tab-Switch Blocker
// @namespace    https://github.com/local/uplearn-blocker
// @version      1.0.0
// @description  Blocks telemetry (LogImproperUse + analytics hosts), blocks auto-fullscreen, and hides tab-switch/blur/focus-out detection.
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

    const LOG  = (...a) => console.log('%c[UL]', 'color:#00e5ff;font-weight:bold', ...a);
    const WARN = (...a) => console.warn('[UL]', ...a);

    LOG('blocker loaded on', location.host);

    // ============================================================
    // 1. TELEMETRY BLOCKING
    // ============================================================
    const API_HOST    = 'web.uplearn.co.uk';
    const API_PATH_RE = /\/api\/?$/;

    const TELEMETRY_HOSTS = [
        'openreplay.uplearn.co.uk',
        'jitsu.uplearn.co.uk',
        'ingest.us.sentry.io',
        'sentry.io',
        'static.cloudflareinsights.com',
        'cloudflareinsights.com',
        'api-iam.intercom.io',
        'widget.intercom.io',
        'js.intercomcdn.com',
        'intercom.io',
        'intercomcdn.com',
        'googletagmanager.com',
        'google-analytics.com',
        'analytics.google.com',
        'connect.facebook.net',
        'facebook.net',
        'sc-static.net',
        'bat.bing.com',
        'bzrcdn.openai.com',
        'fullstory.com',
        'hotjar.com',
        'mixpanel.com',
        'segment.io',
        'amplitude.com',
        'posthog.com',
    ];

    function hostOf(url) {
        try { return new URL(url, location.href).hostname.toLowerCase(); }
        catch { return ''; }
    }

    function isTelemetryUrl(url) {
        const h = hostOf(url);
        if (!h) return false;
        return TELEMETRY_HOSTS.some((t) => h === t || h.endsWith('.' + t) || h.includes(t));
    }

    function isTargetApi(url) {
        try {
            const u = new URL(url, location.href);
            return u.host === API_HOST && API_PATH_RE.test(u.pathname);
        } catch { return false; }
    }

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
        } catch { /* not JSON — substring match stands */ }
        return true;
    }

    function syntheticOk() {
        return new Response(JSON.stringify({ data: { logImproperUse: true } }), {
            status: 200,
            statusText: 'OK',
            headers: { 'Content-Type': 'application/json' }
        });
    }

    // ---------- fetch ----------
    const origFetch = window.fetch;
    if (origFetch) {
        window.fetch = function (input, init) {
            try {
                const url = typeof input === 'string' ? input
                          : (input && input.url) ? input.url
                          : String(input);

                if (isTelemetryUrl(url)) {
                    LOG('blocked telemetry fetch:', url);
                    return Promise.resolve(new Response('', { status: 204, statusText: 'No Content' }));
                }

                const method = ((init && init.method) || (input && input.method) || 'GET').toUpperCase();

                if (method === 'POST' && isTargetApi(url)) {
                    let body = init && typeof init.body === 'string' ? init.body : null;

                    // Body hidden inside a Request object.
                    if (body == null && typeof Request !== 'undefined' && input instanceof Request) {
                        const ct = (input.headers.get('content-type') || '').toLowerCase();
                        if (ct.includes('application/json')) {
                            const self = this;
                            const passInit = init;
                            return input.clone().text().then((text) => {
                                if (bodyLooksLikeLogImproperUse(text)) {
                                    LOG('dropped LogImproperUse (Request body)');
                                    return syntheticOk();
                                }
                                return origFetch.call(self, input, passInit);
                            });
                        }
                    }

                    if (body != null && bodyLooksLikeLogImproperUse(body)) {
                        LOG('dropped LogImproperUse (fetch)');
                        return Promise.resolve(syntheticOk());
                    }
                }
            } catch (e) {
                WARN('fetch interceptor error:', e);
            }

            return origFetch.call(this, input, init);
        };
    }

    // ---------- XHR ----------
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
                const url    = this.__ul_url;
                const method = (this.__ul_method || '').toUpperCase();

                if (isTelemetryUrl(url)) {
                    LOG('blocked telemetry xhr:', url);
                    const self = this;
                    const payload = '';
                    Object.defineProperty(self, 'readyState',   { value: 4,    configurable: true });
                    Object.defineProperty(self, 'status',       { value: 204,  configurable: true });
                    Object.defineProperty(self, 'statusText',   { value: 'No Content', configurable: true });
                    Object.defineProperty(self, 'responseText', { value: payload, configurable: true });
                    Object.defineProperty(self, 'response', {
                        get() {
                            if (self.responseType === 'json') return null;
                            return payload;
                        },
                        configurable: true
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

                if (method === 'POST' && isTargetApi(url) && bodyLooksLikeLogImproperUse(body)) {
                    LOG('dropped LogImproperUse (xhr)');
                    const self = this;
                    const payload = JSON.stringify({ data: { logImproperUse: true } });
                    Object.defineProperty(self, 'readyState',   { value: 4,   configurable: true });
                    Object.defineProperty(self, 'status',       { value: 200, configurable: true });
                    Object.defineProperty(self, 'statusText',   { value: 'OK', configurable: true });
                    Object.defineProperty(self, 'responseText', { value: payload, configurable: true });
                    Object.defineProperty(self, 'response', {
                        get() {
                            if (self.responseType === 'json') return { data: { logImproperUse: true } };
                            return payload;
                        },
                        configurable: true
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
            } catch (e) {
                WARN('xhr interceptor error:', e);
            }
            return origSend.call(this, body);
        };
    }

    // ---------- sendBeacon ----------
    if (navigator.sendBeacon) {
        const origBeacon = navigator.sendBeacon.bind(navigator);
        navigator.sendBeacon = function (url, data) {
            try {
                if (isTelemetryUrl(url)) {
                    LOG('blocked sendBeacon:', url);
                    return true;
                }
            } catch {}
            return origBeacon(url, data);
        };
    }

    // ============================================================
    // 2. AUTO FULLSCREEN BLOCKER
    // ============================================================
    const FULLSCREEN_METHODS = [
        'requestFullscreen',
        'webkitRequestFullscreen',
        'webkitRequestFullScreen',
        'mozRequestFullScreen',
        'msRequestFullscreen',
    ];

    function installFullscreenBlocker() {
        const proto = Element.prototype;
        FULLSCREEN_METHODS.forEach((name) => {
            if (!proto[name] || proto[name].__ul_patched) return;
            const orig = proto[name];
            const wrapped = function () {
                LOG('blocked requestFullscreen on', this.tagName || String(this));
                try {
                    if (document.fullscreenElement && document.exitFullscreen) {
                        document.exitFullscreen().catch(() => {});
                    }
                } catch {}
                return Promise.reject(new DOMException(
                    'Fullscreen request blocked by userscript',
                    'NotAllowedError'
                ));
            };
            wrapped.__ul_patched = true;
            wrapped.__ul_orig    = orig;
            try {
                Object.defineProperty(proto, name, {
                    value: wrapped, writable: true, configurable: true,
                });
            } catch {
                proto[name] = wrapped;
            }
        });
    }
    installFullscreenBlocker();

    // ============================================================
    // 3. TAB-SWITCH / VISIBILITY / FOCUS DETECTION BLOCKER
    // ============================================================
    function patchVisibilityProps() {
        try {
            Object.defineProperty(document, 'visibilityState', {
                get: () => 'visible', configurable: true
            });
            Object.defineProperty(document, 'webkitVisibilityState', {
                get: () => 'visible', configurable: true
            });
            Object.defineProperty(document, 'hidden', {
                get: () => false, configurable: true
            });
            Object.defineProperty(document, 'webkitHidden', {
                get: () => false, configurable: true
            });
        } catch (e) { WARN('visibility patch failed', e); }
    }
    patchVisibilityProps();

    function installHasFocusPatch() {
        try { document.hasFocus = function () { return true; }; } catch {}
    }
    installHasFocusPatch();

    const SUPPRESSED_EVENTS = new Set([
        'visibilitychange',
        'webkitvisibilitychange',
        'blur',
        'focusout',
        'pagehide',
        'freeze',
    ]);

    // Swallow page-registered listeners for those events.
    try {
        const origProtoAdd = EventTarget.prototype.addEventListener;
        EventTarget.prototype.addEventListener = function (type, listener, options) {
            if ((this === window || this === document) && SUPPRESSED_EVENTS.has(type)) {
                return;
            }
            return origProtoAdd.call(this, type, listener, options);
        };
    } catch (e) { WARN('addEventListener patch failed', e); }

    // Kill anything that still fires (capture phase, before page handlers).
    const KILL = (e) => {
        e.stopImmediatePropagation();
        e.stopPropagation();
    };
    ['visibilitychange', 'webkitvisibilitychange', 'blur', 'focusout', 'pagehide'].forEach((evt) => {
        try {
            EventTarget.prototype.addEventListener.call(window,   evt, KILL, true);
            EventTarget.prototype.addEventListener.call(document, evt, KILL, true);
        } catch {}
    });

    // Neutralise on* handler properties.
    ['onblur', 'onfocusout', 'onpagehide', 'onvisibilitychange'].forEach((prop) => {
        try {
            Object.defineProperty(window,   prop, { get: () => null, set: () => {}, configurable: true });
            Object.defineProperty(document, prop, { get: () => null, set: () => {}, configurable: true });
        } catch {}
    });

    // Re-assert periodically (SPA navigations / late patches).
    setInterval(() => {
        patchVisibilityProps();
        installHasFocusPatch();
        installFullscreenBlocker();
    }, 2000);

    LOG('=== READY | telemetry: blocked | fullscreen: blocked | tab-switch detection: blocked ===');
})();