// ==UserScript==
// @name         UpLearn Telemetry + Fullscreen + Tab-Switch Blocker (Hardened)
// @namespace    https://github.com/local/uplearn-blocker
// @version      1.2.0
// @description  Blocks telemetry, third-party trackers, WebWorker beacons, auto-fullscreen, and tab-switch/blur detection.
// @author       you
// @match        https://web.uplearn.co.uk/*
// @run-at       document-start
// @grant        none
// @inject-into  page
//
// @webRequest   [{"selector":{"include":"://jitsu.uplearn.co.uk/"},"action":"cancel"}]
// @webRequest   [{"selector":{"include":"://jitsu.com/"},"action":"cancel"}]
// @webRequest   [{"selector":{"include":"://openreplay.uplearn.co.uk/"},"action":"cancel"}]
// @webRequest   [{"selector":{"include":"://.ingest.us.sentry.io/"},"action":"cancel"}]
// @webRequest   [{"selector":{"include":"://static.cloudflareinsights.com/"},"action":"cancel"}]
// @webRequest   [{"selector":{"include":"://api-iam.intercom.io/"},"action":"cancel"}]
// @webRequest   [{"selector":{"include":"://widget.intercom.io/"},"action":"cancel"}]
// @webRequest   [{"selector":{"include":"://js.intercomcdn.com/"},"action":"cancel"}]
// @webRequest   [{"selector":{"include":"://nexus-websocket-.intercom.io/"},"action":"cancel"}]
// @webRequest   [{"selector":{"include":"://www.googletagmanager.com/"},"action":"cancel"}]
// @webRequest   [{"selector":{"include":"://google-analytics.com/"},"action":"cancel"}]
// @webRequest   [{"selector":{"include":"://analytics.google.com/"},"action":"cancel"}]
// @webRequest   [{"selector":{"include":"://googleadservices.com/"},"action":"cancel"}]
// @webRequest   [{"selector":{"include":"://doubleclick.net/"},"action":"cancel"}]
// @webRequest   [{"selector":{"include":"://connect.facebook.net/"},"action":"cancel"}]
// @webRequest   [{"selector":{"include":"://sc-static.net/"},"action":"cancel"}]
// @webRequest   [{"selector":{"include":"://bat.bing.com/"},"action":"cancel"}]
// @webRequest   [{"selector":{"include":"://bzrcdn.openai.com/"},"action":"cancel"}]
// @webRequest   [{"selector":{"include":"://*.posthog.com/"},"action":"cancel"}]
// ==/UserScript==

(function () {
    'use strict';

    const LOG  = (...a) => console.log('%c[UL]', 'color:#00e5ff;font-weight:bold', ...a);
    const WARN = (...a) => console.warn('[UL]', ...a);

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
    // 1. TELEMETRY HOST DEFINITIONS & MATCHER
    // ============================================================
    const API_HOST    = 'web.uplearn.co.uk';
    const API_PATH_RE = /\/api\/?$/;

    // Added googleadservices, doubleclick, clarity, and wildcard posthog
    const TELEMETRY_HOST_RE = /(?:^|\.)(?:jitsu\.uplearn\.co\.uk|jitsu\.com|openreplay\.uplearn\.co\.uk|sentry\.io|cloudflareinsights\.com|intercom\.io|intercomcdn\.com|googletagmanager\.com|google-analytics\.com|analytics\.google\.com|googleadservices\.com|doubleclick\.net|facebook\.net|sc-static\.net|bat\.bing\.com|clarity\.ms|bzrcdn\.openai\.com|fullstory\.com|hotjar\.com|mixpanel\.com|segment\.io|amplitude\.com|posthog\.com)\.?$/i;

    function getHostname(url) {
        if (!url || typeof url !== 'string') return '';
        const len = url.length;
        let start = 0;
        while (start < len && url.charCodeAt(start) <= 32) start++;
        if (start >= len) return '';

        const c0 = url.charCodeAt(start);
        const c1 = url.charCodeAt(start + 1);

        if ((c0 === 47 && c1 !== 47) || c0 === 46 || c0 === 35) return '';

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
            if (c === 47 || c === 63 || c === 35 || c <= 32) break;
            if (c === 64) atIdx = end;
            end++;
        }
        if (atIdx !== -1) start = atIdx + 1;

        const colonIdx = url.indexOf(':', start);
        if (colonIdx !== -1 && colonIdx < end) end = colonIdx;

        while (end > start && url.charCodeAt(end - 1) === 46) end--;

        return url.slice(start, end).toLowerCase();
    }

    function isTelemetryUrl(url) {
        if (!url) return false;
        if (typeof url !== 'string') {
            if (typeof url.hostname === 'string') {
                let hn = url.hostname.toLowerCase();
                while (hn.charCodeAt(hn.length - 1) === 46) hn = hn.slice(0, -1);
                return TELEMETRY_HOST_RE.test(hn);
            }
            url = url.url || url.href || String(url);
        }
        const host = getHostname(url);
        return host ? TELEMETRY_HOST_RE.test(host) : false;
    }

    function isTargetApi(url) {
        if (!url) return false;
        if (typeof url !== 'string') url = url.url || url.href || String(url);
        if (!url.includes('api')) return false;

        if (url.charCodeAt(0) === 47) {
            if (url === '/api' || url === '/api/') return true;
            if (url.startsWith('/api?') || url.startsWith('/api/?') || url.startsWith('/api#')) return true;
        }
        if (url.startsWith('https://web.uplearn.co.uk/api') || url.startsWith('//web.uplearn.co.uk/api') || url.startsWith('http://web.uplearn.co.uk/api')) {
            const idx = url.indexOf('/api');
            const after = url.slice(idx + 4);
            if (after === '' || after === '/' || after.charCodeAt(0) === 63 || after.charCodeAt(0) === 35) return true;
        }

        try {
            const u = new URL(url, location.href);
            const host = u.hostname.endsWith('.') ? u.hostname.slice(0, -1) : u.hostname;
            return host === API_HOST && API_PATH_RE.test(u.pathname);
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
    // 2. DOM & IMAGE/SCRIPT/IFRAME INJECTION BLOCKER
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
    if (typeof HTMLImageElement  !== 'undefined') hookSrcProperty(HTMLImageElement.prototype,  'img');

    // Intercept new Image() beacons
    const OrigImage = window.Image;
    if (OrigImage) {
        window.Image = function (...args) {
            const img = new OrigImage(...args);
            return img;
        };
        window.Image.prototype = OrigImage.prototype;
    }

    const origSetAttribute = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function (name, value) {
        if ((name === 'src' || (typeof name === 'string' && name.toLowerCase() === 'src')) && isTelemetryUrl(value)) {
            LOG('blocked setAttribute(src):', value);
            return;
        }
        return origSetAttribute.call(this, name, value);
    };

    // ============================================================
    // 3. WEB WORKER NEUTER (Stops OpenReplay & Sentry worker uploaders)
    // ============================================================
    const OrigWorker = window.Worker;
    if (OrigWorker) {
        window.Worker = function (scriptURL, options) {
            const urlStr = String(scriptURL || '');
            // Check if worker URL points to telemetry or is an OpenReplay/Sentry Blob
            if (isTelemetryUrl(urlStr) || urlStr.startsWith('blob:')) {
                LOG('blocked telemetry WebWorker:', urlStr);
                // Return a dummy worker that does nothing
                const dummy = new EventTarget();
                dummy.postMessage = noop;
                dummy.terminate = noop;
                dummy.onerror = null;
                dummy.onmessage = null;
                return dummy;
            }
            return new OrigWorker(scriptURL, options);
        };
        window.Worker.prototype = OrigWorker.prototype;
    }

    // ============================================================
    // 4. WEBSOCKET BLOCKER
    // ============================================================
    const OrigWebSocket = window.WebSocket;
    if (OrigWebSocket) {
        const PatchedWebSocket = function (url, protocols) {
            if (isTelemetryUrl(url)) {
                LOG('blocked WebSocket connection:', url);
                const dummy = new EventTarget();
                Object.setPrototypeOf(dummy, OrigWebSocket.prototype);
                dummy.readyState = 3; // CLOSED
                dummy.send = noop;
                dummy.close = noop;
                setTimeout(() => {
                    try {
                        const err = new Event('error');
                        dummy.dispatchEvent(err);
                        const closeEvt = typeof CloseEvent !== 'undefined'
                            ? new CloseEvent('close', { code: 1006, reason: 'Blocked' })
                            : new Event('close');
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
    // 5. FETCH / XHR / BEACON INTERCEPTORS
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
                        try {
                            return input.clone().text().then((text) => {
                                if (bodyLooksLikeLogImproperUse(text)) {
                                    LOG('dropped LogImproperUse (Request body)');
                                    return syntheticOk();
                                }
                                return init !== undefined ? origFetch(input, init) : origFetch(input);
                            }).catch(() => (init !== undefined ? origFetch(input, init) : origFetch(input)));
                        } catch {}
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
                const method = this.__ul_method;

                if (isTelemetryUrl(url)) {
                    LOG('blocked telemetry xhr:', url);
                    Object.defineProperties(this, {
                        readyState: { value: 4 },
                        status:     { value: 204 },
                        statusText: { value: 'No Content' },
                    });
                    setTimeout(() => {
                        this.dispatchEvent(new Event('readystatechange'));
                        this.dispatchEvent(new Event('load'));
                        this.dispatchEvent(new Event('loadend'));
                    }, 0);
                    return;
                }

                if (isPostMethod(method) && isTargetApi(url) && bodyLooksLikeLogImproperUse(body)) {
                    LOG('dropped LogImproperUse (xhr)');
                    Object.defineProperties(this, {
                        readyState:   { value: 4 },
                        status:       { value: 200 },
                        statusText:   { value: 'OK' },
                        responseText: { value: SYNTHETIC_OK_BODY },
                        response:     { get: () => (this.responseType === 'json' ? SYNTHETIC_OK_JSON : SYNTHETIC_OK_BODY) },
                    });
                    setTimeout(() => {
                        this.dispatchEvent(new Event('readystatechange'));
                        this.dispatchEvent(new Event('load'));
                        this.dispatchEvent(new Event('loadend'));
                    }, 0);
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
    // 6. FULLSCREEN BLOCKER & AVAILABILITY SPOOFER
    // ============================================================
    function installFullscreenBlocker() {
        const docDescs = {
            fullscreenEnabled:       { get: returnFalse, configurable: true },
            webkitFullscreenEnabled: { get: returnFalse, configurable: true },
            mozFullScreenEnabled:    { get: returnFalse, configurable: true },
            msFullscreenEnabled:     { get: returnFalse, configurable: true },
        };
        try {
            Object.defineProperties(document, docDescs);
            if (typeof Document !== 'undefined' && Document.prototype) {
                Object.defineProperties(Document.prototype, docDescs);
            }
        } catch {}

        const rejectFs = () => Promise.reject(new DOMException('Fullscreen blocked', 'NotAllowedError'));
        const proto = Element.prototype;
        ['requestFullscreen', 'webkitRequestFullscreen', 'webkitRequestFullScreen', 'mozRequestFullScreen', 'msRequestFullscreen'].forEach((m) => {
            try {
                Object.defineProperty(proto, m, { value: rejectFs, writable: true, configurable: true });
            } catch {
                proto[m] = rejectFs;
            }
        });
    }
    installFullscreenBlocker();

    // ============================================================
    // 7. TAB-SWITCH / VISIBILITY / FOCUS SPOOFER
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
            document.hasFocus = returnTrue;
            if (typeof Document !== 'undefined' && Document.prototype) {
                Document.prototype.hasFocus = returnTrue;
            }
        } catch {}
    }
    patchVisibilityProps();

    const SUPPRESSED_EVENTS = new Set(['visibilitychange', 'webkitvisibilitychange', 'blur', 'focusout', 'pagehide', 'freeze']);

    let origProtoAdd = EventTarget.prototype.addEventListener;
    try {
        EventTarget.prototype.addEventListener = function (type, listener, options) {
            if ((this === window || this === document) && SUPPRESSED_EVENTS.has(type)) {
                return;
            }
            return origProtoAdd.call(this, type, listener, options);
        };
    } catch {}

    const KILL = (e) => {
        if ((e.type === 'blur' || e.type === 'focusout') && e.target && e.target !== window && e.target !== document) {
            return;
        }
        e.stopImmediatePropagation();
        e.stopPropagation();
    };

    ['visibilitychange', 'webkitvisibilitychange', 'blur', 'focusout', 'pagehide', 'freeze'].forEach((evt) => {
        try {
            origProtoAdd.call(window, evt, KILL, true);
            origProtoAdd.call(document, evt, KILL, true);
        } catch {}
    });

    setInterval(() => {
        if (document.visibilityState !== 'visible' || document.hidden !== false) patchVisibilityProps();
        if (document.fullscreenEnabled !== false) installFullscreenBlocker();
    }, 2000);

    LOG('=== READY | telemetry: blocked | workers: neutered | fullscreen: disabled | tab-switch: blocked ===');
})();