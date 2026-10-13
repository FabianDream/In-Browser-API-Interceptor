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

    const SYNTHETIC_OK_JSON = { data: { logImproperUse: true } };
    const SYNTHETIC_OK_BODY = JSON.stringify(SYNTHETIC_OK_JSON);
    const JSON_HEADERS      = { 'Content-Type': 'application/json' };
    const NO_CONTENT_INIT   = { status: 204, statusText: 'No Content' };
    const OK_RESPONSE_INIT  = { status: 200, statusText: 'OK', headers: JSON_HEADERS };

    function syntheticOk() {
        return new Response(SYNTHETIC_OK_BODY, OK_RESPONSE_INIT);
    }

    function syntheticNoContent() {
        try {
            return new Response(null, NO_CONTENT_INIT);
        } catch {
            return new Response('', NO_CONTENT_INIT);
        }
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
        if (c0 === 47) {
            if (url.charCodeAt(start + 1) !== 47) return '';
            start += 2;
        } else {
            const lower0 = c0 | 32;
            if (lower0 < 97 || lower0 > 122) return '';
            const maxScan = start + 32 < len ? start + 32 : len;
            let protoIdx = -1;
            for (let i = start + 1; i < maxScan; i++) {
                const c = url.charCodeAt(i);
                if (c === 58) {
                    if (url.charCodeAt(i + 1) === 47 && url.charCodeAt(i + 2) === 47) {
                        protoIdx = i;
                        break;
                    }
                    continue;
                }
                const cl = c | 32;
                if ((cl >= 97 && cl <= 122) || (c >= 48 && c <= 57) || c === 43 || c === 45 || c === 46) {
                    continue;
                }
                return '';
            }
            if (protoIdx === -1) return '';
            start = protoIdx + 3;
        }

        while (start < len) {
            const sc = url.charCodeAt(start);
            if (sc !== 47 && sc !== 92) break;
            start++;
        }

        let end = start;
        let atIdx = -1;
        let colonIdx = -1;
        while (end < len) {
            const c = url.charCodeAt(end);
            if (c === 47 || c === 92 || c === 63 || c === 35 || c <= 32) break;
            if (c === 64) {
                atIdx = end;
                colonIdx = -1;
            } else if (c === 58 && colonIdx === -1) {
                colonIdx = end;
            } else if (c === 93) {
                colonIdx = -1;
            }
            end++;
        }
        if (atIdx !== -1) start = atIdx + 1;
        if (colonIdx !== -1) end = colonIdx;

        while (end > start && url.charCodeAt(end - 1) === 46) end--;

        return end > start ? url.slice(start, end).toLowerCase() : '';
    }

    function isTelemetryUrl(url) {
        if (!url) return false;
        if (typeof url !== 'string') {
            if (typeof url.hostname === 'string' && url.hostname.length > 0) {
                let hn = url.hostname;
                let end = hn.length;
                while (end > 0 && hn.charCodeAt(end - 1) === 46) end--;
                if (end === 0) return false;
                if (end < hn.length) hn = hn.slice(0, end);
                return hn !== API_HOST && TELEMETRY_HOST_RE.test(hn);
            }
            url = url.url || url.href || String(url);
        }
        const host = getHostname(url);
        return host !== '' && host !== API_HOST && TELEMETRY_HOST_RE.test(host);
    }

    function isApiBoundary(str, idx) {
        if (str.charCodeAt(idx) === 47) idx++;
        if (idx === str.length) return true;
        const c = str.charCodeAt(idx);
        return c === 63 || c === 35;
    }

    function isTargetApi(url) {
        if (!url) return false;
        if (typeof url !== 'string') url = url.url || url.href || String(url);
        if (!url.includes('api')) return false;

        if (url.charCodeAt(0) === 47) {
            if (url.startsWith('/api') && isApiBoundary(url, 4)) return true;
            if (url.startsWith('//web.uplearn.co.uk/api') && isApiBoundary(url, 23)) return true;
        } else if (
            (url.startsWith('https://web.uplearn.co.uk/api') && isApiBoundary(url, 29)) ||
            (url.startsWith('http://web.uplearn.co.uk/api') && isApiBoundary(url, 28))
        ) {
            return true;
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
    let sharedTextDecoder = null;

    function bodyLooksLikeLogImproperUse(body) {
        if (!body) return false;
        if (typeof body !== 'string') {
            try {
                if (body instanceof URLSearchParams) {
                    body = body.toString();
                } else if (typeof ArrayBuffer !== 'undefined' && (ArrayBuffer.isView(body) || body instanceof ArrayBuffer)) {
                    if (!sharedTextDecoder && typeof TextDecoder !== 'undefined') {
                        sharedTextDecoder = new TextDecoder();
                    }
                    if (!sharedTextDecoder) return false;
                    body = sharedTextDecoder.decode(body);
                } else if (typeof FormData !== 'undefined' && body instanceof FormData) {
                    for (const [, val] of body) {
                        if (typeof val === 'string' && LOG_IMPROPER_USE_RE.test(val)) return true;
                    }
                    return false;
                } else {
                    return false;
                }
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
        if (!proto) return;
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
                enumerable: desc.enumerable,
            });
        }
    }

    if (typeof HTMLScriptElement !== 'undefined') hookSrcProperty(HTMLScriptElement.prototype, 'script');
    if (typeof HTMLIFrameElement !== 'undefined') hookSrcProperty(HTMLIFrameElement.prototype, 'iframe');
    if (typeof HTMLImageElement  !== 'undefined') hookSrcProperty(HTMLImageElement.prototype,  'img');

    const OrigImage = window.Image;
    if (OrigImage && OrigImage.prototype && (typeof HTMLImageElement === 'undefined' || OrigImage.prototype !== HTMLImageElement.prototype)) {
        hookSrcProperty(OrigImage.prototype, 'img');
    }

    const origSetAttribute = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function (name, value) {
        if (
            (name === 'src' || (typeof name === 'string' && name.length === 3 && name.toLowerCase() === 'src')) &&
            isTelemetryUrl(value)
        ) {
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
        const WORKER_DUMMY_DESCS = {
            postMessage:    { value: noop, writable: true, configurable: true },
            terminate:      { value: noop, writable: true, configurable: true },
            onerror:        { value: null, writable: true, configurable: true },
            onmessage:      { value: null, writable: true, configurable: true },
            onmessageerror: { value: null, writable: true, configurable: true },
        };
        const BLOB_PREFIX_RE = /^\s*blob:/i;

        const PatchedWorker = function (scriptURL, options) {
            const urlStr = typeof scriptURL === 'string' ? scriptURL : String(scriptURL || '');
            // Check if worker URL points to telemetry or is an OpenReplay/Sentry Blob
            if (BLOB_PREFIX_RE.test(urlStr) || isTelemetryUrl(scriptURL)) {
                LOG('blocked telemetry WebWorker:', urlStr);
                const dummy = new EventTarget();
                Object.setPrototypeOf(dummy, OrigWorker.prototype);
                Object.defineProperties(dummy, WORKER_DUMMY_DESCS);
                return dummy;
            }
            return arguments.length > 1 && options !== undefined
                ? new OrigWorker(scriptURL, options)
                : new OrigWorker(scriptURL);
        };
        PatchedWorker.prototype = OrigWorker.prototype;
        Object.setPrototypeOf(PatchedWorker, OrigWorker);
        window.Worker = PatchedWorker;
    }

    // ============================================================
    // 4. WEBSOCKET BLOCKER
    // ============================================================
    const OrigWebSocket = window.WebSocket;
    if (OrigWebSocket) {
        const WS_DUMMY_DESCS = {
            readyState:     { value: 3, writable: true, configurable: true },
            protocol:       { value: '', writable: true, configurable: true },
            extensions:     { value: '', writable: true, configurable: true },
            bufferedAmount: { value: 0, writable: true, configurable: true },
            binaryType:     { value: 'blob', writable: true, configurable: true },
            send:           { value: noop, writable: true, configurable: true },
            close:          { value: noop, writable: true, configurable: true },
            onopen:         { value: null, writable: true, configurable: true },
            onerror:        { value: null, writable: true, configurable: true },
            onclose:        { value: null, writable: true, configurable: true },
            onmessage:      { value: null, writable: true, configurable: true },
        };

        const PatchedWebSocket = function (url, protocols) {
            if (isTelemetryUrl(url)) {
                LOG('blocked WebSocket connection:', url);
                const dummy = new EventTarget();
                Object.setPrototypeOf(dummy, OrigWebSocket.prototype);
                Object.defineProperties(dummy, WS_DUMMY_DESCS);
                Object.defineProperty(dummy, 'url', {
                    value: String(url),
                    writable: true,
                    configurable: true,
                });
                setTimeout(() => {
                    try {
                        const err = new Event('error');
                        if (typeof dummy.onerror === 'function') dummy.onerror.call(dummy, err);
                        dummy.dispatchEvent(err);
                        const closeEvt = typeof CloseEvent !== 'undefined'
                            ? new CloseEvent('close', { code: 1006, reason: 'Blocked' })
                            : new Event('close');
                        if (typeof dummy.onclose === 'function') dummy.onclose.call(dummy, closeEvt);
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
                if (isTelemetryUrl(input)) {
                    LOG('blocked telemetry fetch:', input);
                    return Promise.resolve(syntheticNoContent());
                }

                const rawMethod = (init && init.method) || (input && input.method);
                if (isPostMethod(rawMethod) && isTargetApi(input)) {
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

                    if (typeof Blob !== 'undefined' && body instanceof Blob) {
                        try {
                            return body.text().then((text) => {
                                if (bodyLooksLikeLogImproperUse(text)) {
                                    LOG('dropped LogImproperUse (Blob body)');
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

        const XHR_BLOCKED_DESCS = {
            readyState:   { value: 4, configurable: true },
            status:       { value: 204, configurable: true },
            statusText:   { value: 'No Content', configurable: true },
            responseText: { value: '', configurable: true },
            response:     { value: '', configurable: true },
        };

        const XHR_OK_DESCS = {
            readyState:   { value: 4, configurable: true },
            status:       { value: 200, configurable: true },
            statusText:   { value: 'OK', configurable: true },
            responseText: { value: SYNTHETIC_OK_BODY, configurable: true },
            response: {
                get() {
                    return this.responseType === 'json' ? SYNTHETIC_OK_JSON : SYNTHETIC_OK_BODY;
                },
                configurable: true,
            },
        };

        function dispatchXhrDone(xhr, seq) {
            setTimeout(() => {
                if (xhr.__ul_seq !== seq) return;
                try {
                    xhr.dispatchEvent(new Event('readystatechange'));
                    xhr.dispatchEvent(new Event('load'));
                    xhr.dispatchEvent(new Event('loadend'));
                } catch {}
            }, 0);
        }

        OrigXHR.prototype.open = function (method, url) {
            this.__ul_method = method;
            this.__ul_url    = url;
            this.__ul_seq    = (this.__ul_seq || 0) + 1;
            if (this.__ul_spoofed) {
                this.__ul_spoofed = false;
                delete this.readyState;
                delete this.status;
                delete this.statusText;
                delete this.responseText;
                delete this.response;
            }
            return origOpen.apply(this, arguments);
        };

        OrigXHR.prototype.send = function (body) {
            try {
                const url    = this.__ul_url;
                const method = this.__ul_method;

                if (isTelemetryUrl(url)) {
                    LOG('blocked telemetry xhr:', url);
                    this.__ul_spoofed = true;
                    const seq = (this.__ul_seq = (this.__ul_seq || 0) + 1);
                    Object.defineProperties(this, XHR_BLOCKED_DESCS);
                    dispatchXhrDone(this, seq);
                    return;
                }

                if (isPostMethod(method) && isTargetApi(url) && bodyLooksLikeLogImproperUse(body)) {
                    LOG('dropped LogImproperUse (xhr)');
                    this.__ul_spoofed = true;
                    const seq = (this.__ul_seq = (this.__ul_seq || 0) + 1);
                    Object.defineProperties(this, XHR_OK_DESCS);
                    dispatchXhrDone(this, seq);
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
                if (isTargetApi(url) && bodyLooksLikeLogImproperUse(data)) {
                    LOG('dropped LogImproperUse (sendBeacon)');
                    return true;
                }
            } catch {}
            return origBeacon(url, data);
        };
    }

    // ============================================================
    // 6. FULLSCREEN BLOCKER & AVAILABILITY SPOOFER
    // ============================================================
    const FULLSCREEN_DOC_DESCS = {
        fullscreenEnabled:       { get: returnFalse, configurable: true },
        webkitFullscreenEnabled: { get: returnFalse, configurable: true },
        mozFullScreenEnabled:    { get: returnFalse, configurable: true },
        msFullscreenEnabled:     { get: returnFalse, configurable: true },
    };
    const rejectFs = () => Promise.reject(new DOMException('Fullscreen blocked', 'NotAllowedError'));
    const FS_METHOD_DESC = { value: rejectFs, writable: true, configurable: true };
    const FS_METHODS = [
        'requestFullscreen',
        'webkitRequestFullscreen',
        'webkitRequestFullScreen',
        'mozRequestFullScreen',
        'msRequestFullscreen',
    ];

    function installFullscreenBlocker() {
        try {
            Object.defineProperties(document, FULLSCREEN_DOC_DESCS);
            if (typeof Document !== 'undefined' && Document.prototype) {
                Object.defineProperties(Document.prototype, FULLSCREEN_DOC_DESCS);
            }
        } catch {}

        const proto = Element.prototype;
        for (let i = 0; i < FS_METHODS.length; i++) {
            const m = FS_METHODS[i];
            try {
                Object.defineProperty(proto, m, FS_METHOD_DESC);
            } catch {
                proto[m] = rejectFs;
            }
        }
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

    const SUPPRESSED_EVENTS = new Set([
        'visibilitychange',
        'webkitvisibilitychange',
        'blur',
        'focusout',
        'pagehide',
        'freeze',
    ]);

    const origProtoAdd = EventTarget.prototype.addEventListener;
    const origWinAdd   = window.addEventListener || origProtoAdd;
    const origDocAdd   = document.addEventListener || origProtoAdd;
    const winDesc      = Object.getOwnPropertyDescriptor(window, 'window');
    const rawWin       = (winDesc && winDesc.value) || window;
    try {
        const patchedAddEventListener = function (type, listener, options) {
            const target = this == null || this === window ? rawWin : this;
            if (target === rawWin || target === document) {
                if (SUPPRESSED_EVENTS.has(type)) return;
                if (target === document) {
                    return origDocAdd.call(document, type, listener, options);
                }
                try {
                    return origWinAdd.call(rawWin, type, listener, options);
                } catch {
                    return origWinAdd.call(window, type, listener, options);
                }
            }
            return origProtoAdd.call(this, type, listener, options);
        };
        EventTarget.prototype.addEventListener = patchedAddEventListener;
        if (window.addEventListener !== patchedAddEventListener) {
            window.addEventListener = patchedAddEventListener;
        }
        if (document.addEventListener !== patchedAddEventListener) {
            document.addEventListener = patchedAddEventListener;
        }
    } catch {}

    const KILL = (e) => {
        if (
            (e.type === 'blur' || e.type === 'focusout') &&
            e.target &&
            e.target !== window &&
            e.target !== rawWin &&
            e.target !== document
        ) {
            return;
        }
        e.stopImmediatePropagation();
        e.stopPropagation();
    };

    for (const evt of SUPPRESSED_EVENTS) {
        try {
            origWinAdd.call(rawWin, evt, KILL, true);
        } catch {
            try { origWinAdd.call(window, evt, KILL, true); } catch {}
        }
        try {
            origDocAdd.call(document, evt, KILL, true);
        } catch {}
    }

    setInterval(() => {
        if (document.visibilityState !== 'visible' || document.hidden !== false || document.hasFocus !== returnTrue) {
            patchVisibilityProps();
        }
        if (document.fullscreenEnabled !== false) {
            installFullscreenBlocker();
        }
    }, 2000);

    LOG('=== READY | telemetry: blocked | workers: neutered | fullscreen: disabled | tab-switch: blocked ===');
})();