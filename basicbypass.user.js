// ==UserScript==
// @name         UpLearn Telemetry + Fullscreen + Tab-Switch Blocker
// @namespace    https://github.com/local/uplearn-blocker
// @version      1.1.2
// @description  Blocks telemetry, third-party trackers, auto-fullscreen, and tab-switch/blur detection across all userscript managers.
// @author       you
// @match        https://web.uplearn.co.uk/*
// @run-at       document-start
// @grant        none
// @inject-into  page
// @noframes
//
// @webRequest   [{"selector":{"include":"://openreplay.uplearn.co.uk/"},"action":"cancel"}]
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
    // REUSABLE STATIC HELPERS & CONSTANTS
    // ============================================================
    function noop() {}
    function returnVisible() { return 'visible'; }
    function returnFalse() { return false; }
    function returnTrue() { return true; }
    function returnNull() { return null; }

    const SYNTHETIC_OK_JSON = { data: { logImproperUse: true } };
    const SYNTHETIC_OK_BODY = JSON.stringify(SYNTHETIC_OK_JSON);
    const JSON_HEADERS      = { 'Content-Type': 'application/json' };
    const NO_CONTENT_INIT   = { status: 204, statusText: 'No Content' };

    function syntheticOk() {
        return new Response(SYNTHETIC_OK_BODY, {
            status: 200,
            statusText: 'OK',
            headers: JSON_HEADERS,
        });
    }

    function isPostMethod(method) {
        return method === 'POST' || (typeof method === 'string' && method.length === 4 && method.toUpperCase() === 'POST');
    }

    // ============================================================
    // 1. TELEMETRY HOST DEFINITIONS & ULTRA-FAST MATCHER
    // ============================================================
    const API_HOST    = 'web.uplearn.co.uk';
    const API_PATH_RE = /\/api\/?$/;

    // Compiled regex matching all blocked telemetry hostnames & domains in a single pass.
    // 'jitsu.uplearn.co.uk' and 'web.uplearn.co.uk' are intentionally excluded / unblocked.
    const TELEMETRY_HOST_RE = /(?:^|\.)(?:openreplay\.uplearn\.co\.uk|sentry\.io|cloudflareinsights\.com|intercom\.io|intercomcdn\.com|googletagmanager\.com|google-analytics\.com|analytics\.google\.com|facebook\.net|sc-static\.net|bat\.bing\.com|bzrcdn\.openai\.com|fullstory\.com|hotjar\.com|mixpanel\.com|segment\.io|amplitude\.com|posthog\.com)$/i;

    // Fast hostname extractor avoiding expensive `new URL()` allocations
    function getHostname(url) {
        if (!url || typeof url !== 'string') return '';
        const len = url.length;
        let start = 0;
        while (start < len && url.charCodeAt(start) <= 32) start++;
        if (start >= len) return '';

        const c0 = url.charCodeAt(start);
        const c1 = url.charCodeAt(start + 1);

        // Fast exit for relative URLs: /path (not //domain), ./path, ../path, #hash
        if ((c0 === 47 && c1 !== 47) || c0 === 46 || c0 === 35) {
            return '';
        }

        const protoIdx = url.indexOf('://', start);
        if (protoIdx !== -1) {
            start = protoIdx + 3;
        } else if (c0 === 47 && c1 === 47) {
            start += 2;
        } else {
            return '';
        }

        let end = start;
        let atIdx = -1;
        while (end < len) {
            const c = url.charCodeAt(end);
            if (c === 47 || c === 63 || c === 35 || c <= 32) break; // '/', '?', '#', whitespace
            if (c === 64) atIdx = end; // '@' (credentials)
            end++;
        }
        if (atIdx !== -1) start = atIdx + 1;

        // Strip port if present
        const colonIdx = url.indexOf(':', start);
        if (colonIdx !== -1 && colonIdx < end) {
            end = colonIdx;
        }

        return url.slice(start, end).toLowerCase();
    }

    function isTelemetryUrl(url) {
        if (!url) return false;
        if (typeof url !== 'string') {
            if (typeof url.hostname === 'string') return TELEMETRY_HOST_RE.test(url.hostname);
            url = url.url || url.href || String(url);
        }
        const host = getHostname(url);
        return host ? TELEMETRY_HOST_RE.test(host) : false;
    }

    function isTargetApi(url) {
        if (!url) return false;
        if (typeof url !== 'string') {
            url = url.url || url.href || String(url);
        }
        if (!url.includes('api')) return false;

        // Fast path for relative paths: /api, /api/, /api?..., /api/?...
        if (url.charCodeAt(0) === 47) {
            if (url === '/api' || url === '/api/') return true;
            if (url.startsWith('/api?') || url.startsWith('/api/?') || url.startsWith('/api#')) return true;
        }
        // Fast path for absolute URLs matching API_HOST
        if (url.startsWith('https://web.uplearn.co.uk/api') || url.startsWith('//web.uplearn.co.uk/api') || url.startsWith('http://web.uplearn.co.uk/api')) {
            const idx = url.indexOf('/api');
            const after = url.slice(idx + 4);
            if (after === '' || after === '/' || after.charCodeAt(0) === 63 || after.charCodeAt(0) === 35) return true;
        }

        try {
            const u = new URL(url, location.href);
            return u.host === API_HOST && API_PATH_RE.test(u.pathname);
        } catch {
            return false;
        }
    }

    const LOG_IMPROPER_USE_RE = /logimproperuse/i;

    function bodyLooksLikeLogImproperUse(body) {
        if (!body) return false;
        if (typeof body !== 'string') {
            try {
                if (body instanceof URLSearchParams) body = body.toString();
                else return false;
            } catch {
                return false;
            }
        }
        return LOG_IMPROPER_USE_RE.test(body);
    }

    // ============================================================
    // 2. DOM & SCRIPT/IFRAME INJECTION BLOCKER
    // ============================================================
    function hookSrcProperty(proto, tag) {
        const desc = Object.getOwnPropertyDescriptor(proto, 'src');
        if (desc && desc.set) {
            Object.defineProperty(proto, 'src', {
                get: desc.get,
                set(val) {
                    if (isTelemetryUrl(val)) {
                        LOG(`blocked <${tag}> src:`, val);
                        return;
                    }
                    return desc.set.call(this, val);
                },
                configurable: true,
            });
        }
    }

    if (typeof HTMLScriptElement !== 'undefined') hookSrcProperty(HTMLScriptElement.prototype, 'script');
    if (typeof HTMLIFrameElement !== 'undefined') hookSrcProperty(HTMLIFrameElement.prototype, 'iframe');

    const origSetAttribute = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function (name, value) {
        if ((name === 'src' || (typeof name === 'string' && name.length === 3 && name.toLowerCase() === 'src')) && isTelemetryUrl(value)) {
            LOG('blocked setAttribute(src):', value);
            return;
        }
        return origSetAttribute.call(this, name, value);
    };

    function purgeTelemetryChildren(container) {
        if (!container.getElementsByTagName) return;
        const scripts = container.getElementsByTagName('script');
        for (let i = scripts.length - 1; i >= 0; i--) {
            const s = scripts[i];
            const src = s.getAttribute('src') || s.src;
            if (src && isTelemetryUrl(src)) {
                LOG('purged <script> from DOM container:', src);
                s.remove();
            }
        }
        const iframes = container.getElementsByTagName('iframe');
        for (let i = iframes.length - 1; i >= 0; i--) {
            const f = iframes[i];
            const src = f.getAttribute('src') || f.src;
            if (src && isTelemetryUrl(src)) {
                LOG('purged <iframe> from DOM container:', src);
                f.remove();
            }
        }
    }

    // Remove any static or dynamically appended tracker elements
    const domObserver = new MutationObserver((mutations) => {
        for (let i = 0; i < mutations.length; i++) {
            const added = mutations[i].addedNodes;
            for (let j = 0; j < added.length; j++) {
                const node = added[j];
                if (node.nodeType !== 1) continue;
                const tag = node.tagName;
                if (tag === 'SCRIPT' || tag === 'IFRAME' || tag === 'script' || tag === 'iframe') {
                    const src = node.getAttribute('src') || node.src;
                    if (src && isTelemetryUrl(src)) {
                        LOG(`purged <${tag.toLowerCase()}> from DOM:`, src);
                        node.remove();
                        continue;
                    }
                }
                if (node.firstElementChild !== null || (node.children && node.children.length > 0)) {
                    purgeTelemetryChildren(node);
                }
            }
        }
    });

    domObserver.observe(document.documentElement || document, { childList: true, subtree: true });

    // ============================================================
    // 3. WEBSOCKET BLOCKER (Intercom / Analytics Sockets)
    // ============================================================
    const OrigWebSocket = window.WebSocket;
    if (OrigWebSocket) {
        const PatchedWebSocket = function (url, protocols) {
            if (isTelemetryUrl(url)) {
                LOG('blocked WebSocket connection:', url);
                const dummy = new EventTarget();
                Object.setPrototypeOf(dummy, OrigWebSocket.prototype);
                dummy.CONNECTING = 0;
                dummy.OPEN = 1;
                dummy.CLOSING = 2;
                dummy.CLOSED = 3;
                dummy.readyState = 3; // CLOSED
                dummy.url = String(url);
                dummy.protocol = '';
                dummy.extensions = '';
                dummy.bufferedAmount = 0;
                dummy.binaryType = 'blob';
                dummy.onopen = null;
                dummy.onmessage = null;
                dummy.onerror = null;
                dummy.onclose = null;
                dummy.send = noop;
                dummy.close = noop;

                setTimeout(() => {
                    try {
                        const err = new Event('error');
                        if (typeof dummy.onerror === 'function') dummy.onerror(err);
                        dummy.dispatchEvent(err);

                        const closeEvt = typeof CloseEvent !== 'undefined'
                            ? new CloseEvent('close', { code: 1006, reason: 'Blocked' })
                            : new Event('close');
                        if (typeof dummy.onclose === 'function') dummy.onclose(closeEvt);
                        dummy.dispatchEvent(closeEvt);
                    } catch {}
                }, 0);
                return dummy;
            }
            return arguments.length > 1 && protocols !== undefined
                ? new OrigWebSocket(url, protocols)
                : new OrigWebSocket(url);
        };
        PatchedWebSocket.prototype = OrigWebSocket.prototype;
        Object.setPrototypeOf(PatchedWebSocket, OrigWebSocket);
        window.WebSocket = PatchedWebSocket;
    }

    // ============================================================
    // 4. FETCH / XHR / SEND-BEACON INTERCEPTORS
    // ============================================================
    const origFetch = window.fetch ? window.fetch.bind(window) : null;
    if (origFetch) {
        window.fetch = function (input, init) {
            try {
                const url = typeof input === 'string'
                    ? input
                    : (input && (input.url || input.href || String(input))) || '';

                if (isTelemetryUrl(url)) {
                    LOG('blocked telemetry fetch:', url);
                    return Promise.resolve(new Response('', NO_CONTENT_INIT));
                }

                const rawMethod = (init && init.method) || (input && input.method);
                if (isPostMethod(rawMethod) && isTargetApi(url)) {
                    const body = init ? init.body : null;

                    if (body == null && typeof Request !== 'undefined' && input instanceof Request) {
                        const ct = (input.headers.get('content-type') || '').toLowerCase();
                        if (ct.includes('application/json')) {
                            const passInit = init;
                            try {
                                return input.clone().text().then((text) => {
                                    if (bodyLooksLikeLogImproperUse(text)) {
                                        LOG('dropped LogImproperUse (Request body)');
                                        return syntheticOk();
                                    }
                                    return passInit !== undefined ? origFetch(input, passInit) : origFetch(input);
                                }).catch(() => (passInit !== undefined ? origFetch(input, passInit) : origFetch(input)));
                            } catch {}
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

            return init !== undefined ? origFetch(input, init) : origFetch(input);
        };
    }

    function mockXhr(xhr, status, statusText, responseText, jsonResponse) {
        Object.defineProperties(xhr, {
            readyState:   { value: 4, configurable: true },
            status:       { value: status, configurable: true },
            statusText:   { value: statusText, configurable: true },
            responseText: { value: responseText, configurable: true },
            response:     {
                get() { return xhr.responseType === 'json' ? jsonResponse : responseText; },
                configurable: true
            }
        });
        setTimeout(() => {
            try {
                xhr.dispatchEvent(new Event('readystatechange'));
                const loadEvt = typeof ProgressEvent !== 'undefined' ? new ProgressEvent('load') : new Event('load');
                xhr.dispatchEvent(loadEvt);
                const loadEndEvt = typeof ProgressEvent !== 'undefined' ? new ProgressEvent('loadend') : new Event('loadend');
                xhr.dispatchEvent(loadEndEvt);
            } catch {}
        }, 0);
    }

    const OrigXHR = window.XMLHttpRequest;
    if (OrigXHR) {
        const origOpen = OrigXHR.prototype.open;
        const origSend = OrigXHR.prototype.send;

        OrigXHR.prototype.open = function (method, url) {
            this.__ul_method = method;
            this.__ul_url    = url;
            delete this.readyState;
            delete this.status;
            delete this.statusText;
            delete this.responseText;
            delete this.response;
            return origOpen.apply(this, arguments);
        };

        OrigXHR.prototype.send = function (body) {
            try {
                const url    = this.__ul_url;
                const method = this.__ul_method;

                if (isTelemetryUrl(url)) {
                    LOG('blocked telemetry xhr:', url);
                    mockXhr(this, 204, 'No Content', '', null);
                    return;
                }

                if (isPostMethod(method) && isTargetApi(url) && bodyLooksLikeLogImproperUse(body)) {
                    LOG('dropped LogImproperUse (xhr)');
                    mockXhr(this, 200, 'OK', SYNTHETIC_OK_BODY, SYNTHETIC_OK_JSON);
                    return;
                }
            } catch (e) {
                WARN('xhr interceptor error:', e);
            }
            return origSend.call(this, body);
        };
    }

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
    // 5. FULLSCREEN BLOCKER
    // ============================================================
    const FULLSCREEN_METHODS = [
        'requestFullscreen',
        'webkitRequestFullscreen',
        'webkitRequestFullScreen',
        'mozRequestFullScreen',
        'msRequestFullscreen',
    ];

    function blockFullscreen() {
        LOG('blocked requestFullscreen on', this.tagName || String(this));
        try {
            const doc = document;
            const fsEl = doc.fullscreenElement || doc.webkitFullscreenElement || doc.mozFullScreenElement || doc.msFullscreenElement;
            if (fsEl) {
                const exit = doc.exitFullscreen || doc.webkitExitFullscreen || doc.mozCancelFullScreen || doc.msExitFullscreen;
                if (exit) exit.call(doc).catch(noop);
            }
        } catch {}
        return Promise.reject(new DOMException('Fullscreen request blocked by userscript', 'NotAllowedError'));
    }
    blockFullscreen.__ul_patched = true;

    function installFullscreenBlocker() {
        const proto = Element.prototype;
        for (let i = 0; i < FULLSCREEN_METHODS.length; i++) {
            const name = FULLSCREEN_METHODS[i];
            if (!proto[name] || proto[name].__ul_patched) continue;
            try {
                Object.defineProperty(proto, name, { value: blockFullscreen, writable: true, configurable: true });
            } catch {
                proto[name] = blockFullscreen;
            }
        }
    }
    installFullscreenBlocker();

    // ============================================================
    // 6. TAB-SWITCH / VISIBILITY / FOCUS DETECTION BLOCKER
    // ============================================================
    const VISIBILITY_DESCS = {
        visibilityState:       { get: returnVisible, configurable: true },
        webkitVisibilityState: { get: returnVisible, configurable: true },
        hidden:                { get: returnFalse,   configurable: true },
        webkitHidden:          { get: returnFalse,   configurable: true },
    };

    function patchVisibilityProps() {
        try {
            Object.defineProperties(document, VISIBILITY_DESCS);
            if (typeof Document !== 'undefined' && Document.prototype) {
                Object.defineProperties(Document.prototype, VISIBILITY_DESCS);
            }
        } catch (e) { WARN('visibility patch failed', e); }
    }
    patchVisibilityProps();

    function installHasFocusPatch() {
        try {
            document.hasFocus = returnTrue;
            if (typeof Document !== 'undefined' && Document.prototype) {
                Document.prototype.hasFocus = returnTrue;
            }
        } catch {}
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

    let origProtoAdd = EventTarget.prototype.addEventListener;
    try {
        EventTarget.prototype.addEventListener = function (type, listener, options) {
            if ((this === window || this === document) && SUPPRESSED_EVENTS.has(type)) {
                return;
            }
            return origProtoAdd.call(this, type, listener, options);
        };
    } catch (e) { WARN('addEventListener patch failed', e); }

    const KILL = (e) => {
        // Allow in-page input/form element blur/focusout events to proceed normally
        if ((e.type === 'blur' || e.type === 'focusout') && e.target && e.target !== window && e.target !== document) {
            return;
        }
        e.stopImmediatePropagation();
        e.stopPropagation();
    };

    const KILL_EVENTS = ['visibilitychange', 'webkitvisibilitychange', 'blur', 'focusout', 'pagehide', 'freeze'];
    for (let i = 0; i < KILL_EVENTS.length; i++) {
        const evt = KILL_EVENTS[i];
        try {
            origProtoAdd.call(window,   evt, KILL, true);
            origProtoAdd.call(document, evt, KILL, true);
        } catch {}
    }

    const NULL_PROP_DESC = { get: returnNull, set: noop, configurable: true };
    const BLOCKED_PROPS = ['onblur', 'onfocusout', 'onpagehide', 'onvisibilitychange', 'onwebkitvisibilitychange', 'onfreeze'];
    function installBlockedProps() {
        for (let i = 0; i < BLOCKED_PROPS.length; i++) {
            const prop = BLOCKED_PROPS[i];
            try {
                Object.defineProperty(window,   prop, NULL_PROP_DESC);
                Object.defineProperty(document, prop, NULL_PROP_DESC);
            } catch {}
        }
    }
    installBlockedProps();

    // Lightweight health-check guard instead of unconditional Object.defineProperty thrashing
    setInterval(() => {
        if (document.visibilityState !== 'visible' || document.hidden !== false || document.webkitHidden !== false) {
            patchVisibilityProps();
        }
        if (document.hasFocus !== returnTrue) {
            installHasFocusPatch();
        }
        if (window.onblur !== null || document.onblur !== null || window.onvisibilitychange !== null || document.onvisibilitychange !== null) {
            installBlockedProps();
        }
        installFullscreenBlocker();
    }, 2000);

    LOG('=== READY | telemetry: blocked | fullscreen: blocked | tab-switch detection: blocked ===');
})();