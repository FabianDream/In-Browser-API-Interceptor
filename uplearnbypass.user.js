// ==UserScript==
// @name         UpLearn Telemetry Blocker & Tab-Switch Spoofer
// @namespace    https://github.com/local/uplearn-telemetry-blocker
// @version      1.0.0
// @description  Blocks telemetry endpoints, spoofs LogImproperUse GraphQL mutations, and prevents tab-switch/visibility detection on web.uplearn.co.uk
// @author       you
// @match        https://web.uplearn.co.uk/*
// @run-at       document-start
// @grant        none
// @noframes
//
// -- Violentmonkey request blocking (network-level, like declarativeNetRequest) --
// @webRequest   [{"selector":{"include":"*://openreplay.uplearn.co.uk/*"},"action":"cancel"}]
// @webRequest   [{"selector":{"include":"*://jitsu.uplearn.co.uk/*"},"action":"cancel"}]
// @webRequest   [{"selector":{"include":"*://*.ingest.us.sentry.io/*"},"action":"cancel"}]
// @webRequest   [{"selector":{"include":"*://static.cloudflareinsights.com/*"},"action":"cancel"}]
// @webRequest   [{"selector":{"include":"*://api-iam.intercom.io/*"},"action":"cancel"}]
// @webRequest   [{"selector":{"include":"*://widget.intercom.io/*"},"action":"cancel"}]
// @webRequest   [{"selector":{"include":"*://js.intercomcdn.com/*"},"action":"cancel"}]
// @webRequest   [{"selector":{"include":"*://nexus-websocket-*.intercom.io/*"},"action":"cancel"}]
// @webRequest   [{"selector":{"include":"*://www.googletagmanager.com/*"},"action":"cancel"}]
// @webRequest   [{"selector":{"include":"*://connect.facebook.net/*"},"action":"cancel"}]
// @webRequest   [{"selector":{"include":"*://sc-static.net/*"},"action":"cancel"}]
// @webRequest   [{"selector":{"include":"*://bat.bing.com/*"},"action":"cancel"}]
// @webRequest   [{"selector":{"include":"*://bzrcdn.openai.com/*"},"action":"cancel"}]
// ==/UserScript==

(function () {
    'use strict';

    // ============================================================
    // PART 1 — GraphQL LogImproperUse mutation spoofing
    // ============================================================
    // Intercepts fetch + XHR POSTs to /api/, and if the payload
    // looks like a LogImproperUse telemetry mutation, drops the
    // request and returns a synthetic 200 response instead.

    const API_HOST = 'web.uplearn.co.uk';
    const API_PATH_RE = /\/api\/?$/;

    function isTargetApi(url) {
        try {
            const u = new URL(url, location.href);
            return u.host === API_HOST && API_PATH_RE.test(u.pathname);
        } catch {
            return false;
        }
    }

    function bodyLooksLikeLogImproperUse(body) {
        if (body == null) return false;
        if (typeof body !== 'string') {
            // URLSearchParams or FormData
            try {
                if (body instanceof URLSearchParams) body = body.toString();
                else if (typeof FormData !== 'undefined' && body instanceof FormData) {
                    // GraphQL over multipart is unusual; skip
                    return false;
                } else return false;
            } catch { return false; }
        }
        // Fast string check first
        if (!/LogImproperUse|logImproperUse/i.test(body)) return false;
        // Parse JSON to be sure
        try {
            const parsed = JSON.parse(body);
            const op = parsed && (parsed.operationName || '');
            if (/LogImproperUse/i.test(op)) return true;
            const q = parsed && parsed.query;
            if (typeof q === 'string' && /LogImproperUse|logImproperUse/i.test(q)) return true;
        } catch {
            // Not JSON — fall back to raw regex hit
        }
        return true;
    }

    function syntheticResponse() {
        const body = JSON.stringify({ data: { logImproperUse: true } });
        return new Response(body, {
            status: 200,
            statusText: 'OK',
            headers: { 'Content-Type': 'application/json' }
        });
    }

    // ---- Monkey-patch window.fetch ----
    const origFetch = window.fetch;
    if (origFetch) {
        window.fetch = function (input, init) {
            try {
                const url = typeof input === 'string' ? input
                          : (input && input.url) ? input.url
                          : String(input);
                const method = (init && init.method) ||
                               (input && input.method) || 'GET';
                const body = (init && init.body) ||
                             (input && typeof input.clone === 'function' ? null : null);
                if (method.toUpperCase() === 'POST' &&
                    isTargetApi(url) &&
                    bodyLooksLikeLogImproperUse(body)) {
                    console.debug('[telemetry-blocker] Dropped fetch LogImproperUse →', url);
                    return Promise.resolve(syntheticResponse());
                }
            } catch (e) { /* pass-through */ }
            return origFetch.apply(this, arguments);
        };
    }

    // ---- Monkey-patch XMLHttpRequest ----
    const OrigXHR = window.XMLHttpRequest;
    if (OrigXHR) {
        const origOpen = OrigXHR.prototype.open;
        const origSend = OrigXHR.prototype.send;

        OrigXHR.prototype.open = function (method, url) {
            this.__telem_block_method = method;
            this.__telem_block_url = url;
            return origOpen.apply(this, arguments);
        };

        OrigXHR.prototype.send = function (body) {
            try {
                if ((this.__telem_block_method || '').toUpperCase() === 'POST' &&
                    isTargetApi(this.__telem_block_url) &&
                    bodyLooksLikeLogImproperUse(body)) {
                    console.debug('[telemetry-blocker] Dropped XHR LogImproperUse →',
                                  this.__telem_block_url);

                    // Fabricate a successful response and fire the events
                    // the caller's onreadystatechange / onload listeners expect.
                    const self = this;
                    const payload = JSON.stringify({ data: { logImproperUse: true } });

                    Object.defineProperty(self, 'readyState', { value: 4, configurable: true });
                    Object.defineProperty(self, 'status',     { value: 200, configurable: true });
                    Object.defineProperty(self, 'statusText', { value: 'OK', configurable: true });
                    Object.defineProperty(self, 'responseText', { value: payload, configurable: true });
                    Object.defineProperty(self, 'response', {
                        get() {
                            if (self.responseType === 'json') return { data: { logImproperUse: true } };
                            return payload;
                        },
                        configurable: true
                    });

                    // Async so callers can attach handlers first
                    setTimeout(() => {
                        try {
                            self.dispatchEvent(new Event('readystatechange'));
                            self.dispatchEvent(new ProgressEvent('load'));
                            self.dispatchEvent(new ProgressEvent('loadend'));
                        } catch (e) { /* ignore */ }
                    }, 0);
                    return;
                }
            } catch (e) { /* pass-through */ }
            return origSend.apply(this, arguments);
        };
    }

    // ============================================================
    // PART 2 — Tab-switch / visibility spoofing
    // ============================================================
    // Force the page to always believe it is visible & focused,
    // and silently drop visibility/blur/focus/pagehide listeners
    // so client-side "you switched tabs!" detection never fires.

    const SUPPRESSED_EVENTS = new Set([
        'visibilitychange',
        'webkitvisibilitychange',
        'blur',
        'focusout',
        'pagehide'
    ]);

    // -- 2a. Override document visibility properties --
    try {
        Object.defineProperty(document, 'visibilityState', {
            get: () => 'visible',
            configurable: true
        });
        Object.defineProperty(document, 'webkitVisibilityState', {
            get: () => 'visible',
            configurable: true
        });
        Object.defineProperty(document, 'hidden', {
            get: () => false,
            configurable: true
        });
        Object.defineProperty(document, 'webkitHidden', {
            get: () => false,
            configurable: true
        });
    } catch (e) { console.warn('[telemetry-blocker] visibility patch failed', e); }

    // -- 2b. hasFocus always true --
    try {
        document.hasFocus = function () { return true; };
    } catch (e) { /* ignore */ }

    // -- 2c. Intercept addEventListener on window & document --
    function wrapAddEventListener(target) {
        const origAdd = target.addEventListener;
        target.addEventListener = function (type, listener, options) {
            if (SUPPRESSED_EVENTS.has(type)) {
                // Silently swallow — never register the handler
                return;
            }
            return origAdd.call(this, type, listener, options);
        };
    }
    wrapAddEventListener(window);
    wrapAddEventListener(document);

    // Also block direct EventTarget.prototype.addEventListener calls
    // made against window/document via a generic wrapper.
    try {
        const origProtoAdd = EventTarget.prototype.addEventListener;
        EventTarget.prototype.addEventListener = function (type, listener, options) {
            if ((this === window || this === document) && SUPPRESSED_EVENTS.has(type)) {
                return;
            }
            return origProtoAdd.call(this, type, listener, options);
        };
    } catch (e) { /* ignore */ }

    // -- 2d. Neutralize property-handler assignment (window.onblur = …) --
    ['onblur', 'onfocusout', 'onpagehide', 'onvisibilitychange'].forEach((prop) => {
        try {
            Object.defineProperty(window, prop, {
                get: () => null,
                set: () => { /* swallow */ },
                configurable: true
            });
            Object.defineProperty(document, prop, {
                get: () => null,
                set: () => { /* swallow */ },
                configurable: true
            });
        } catch (e) { /* ignore */ }
    });

    // -- 2e. Belt-and-braces: capture-phase killer for the events --
    // Some libraries use `.on()` internally and reach the real addEventListener
    // before our patch, or attach via iframe/document-level delegation.
    // Add a capture-phase listener that stops propagation before any
    // user-registered bubble-phase handler sees the event.
    const KILL = (e) => {
        e.stopImmediatePropagation();
        e.stopPropagation();
    };
    ['visibilitychange', 'webkitvisibilitychange', 'blur', 'focusout', 'pagehide']
        .forEach((evt) => {
            try {
                // Use the original (unpatched) proto method here so we actually register it
                EventTarget.prototype.addEventListener.call(window, evt, KILL, true);
                EventTarget.prototype.addEventListener.call(document, evt, KILL, true);
            } catch (e) { /* ignore */ }
        });

    // -- 2f. Re-assert hasFocus periodically in case the page re-writes it --
    setInterval(() => {
        try { document.hasFocus = function () { return true; }; } catch (e) { /* ignore */ }
    }, 2000);

    console.debug('[telemetry-blocker] active on', location.host);
})();
