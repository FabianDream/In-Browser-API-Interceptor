// ==UserScript==
// @name         UpLearn Telemetry + Fullscreen + Tab-Switch Blocker (Hardened)
// @namespace    https://github.com/local/uplearn-blocker
// @version      1.3.0
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

    // ============================================================
    // STEALTH & CLOAKING INFRASTRUCTURE
    // ============================================================
    const origToString = Function.prototype.toString;
    const cloakedFns = new WeakMap();

    function cloak(fn, name) {
        if (typeof fn === 'function') {
            cloakedFns.set(fn, `function ${name || fn.name || ''}() { [native code] }`);
        }
        return fn;
    }

    Function.prototype.toString = function () {
        return (typeof this === 'function' && cloakedFns.get(this)) || origToString.call(this);
    };
    cloak(Function.prototype.toString, 'toString');

    // Secure console logging (unhookable & silenced by default)
    const rawLog  = (typeof console !== 'undefined' && console.log)  ? console.log.bind(console)  : function () {};
    const rawWarn = (typeof console !== 'undefined' && console.warn) ? console.warn.bind(console) : function () {};
    const DEBUG   = false;
    const LOG     = DEBUG ? (...a) => rawLog('%c[UL]', 'color:#00e5ff;font-weight:bold', ...a) : function () {};
    const WARN    = DEBUG ? (...a) => rawWarn('[UL]', ...a) : function () {};

    function noop() {}
    function returnVisible() { return 'visible'; }
    function returnFalse() { return false; }
    function returnTrue() { return true; }

    cloak(noop, 'noop');
    cloak(returnVisible, 'get');
    cloak(returnFalse, 'get');
    cloak(returnTrue, 'hasFocus');

    // Capture native Object reflection methods for internal use
    const origDefineProperty   = Object.defineProperty;
    const origDefineProperties = Object.defineProperties;

    // Response synthesis for dropped telemetry calls
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
    // 1. TELEMETRY HOST DEFINITIONS & URL MATCHER (OPTIMIZED)
    // ============================================================
    const API_HOST = 'web.uplearn.co.uk';

    const TELEMETRY_HOST_RE = /(?:^|\.)(?:jitsu\.uplearn\.co\.uk|jitsu\.com|openreplay\.uplearn\.co\.uk|sentry\.io|cloudflareinsights\.com|intercom\.io|intercomcdn\.com|googletagmanager\.com|google-analytics\.com|analytics\.google\.com|googleadservices\.com|doubleclick\.net|facebook\.net|sc-static\.net|bat\.bing\.com|clarity\.ms|bzrcdn\.openai\.com|fullstory\.com|hotjar\.com|mixpanel\.com|segment\.io|amplitude\.com|posthog\.com)\.?$/i;

    // High-performance compact host extractor regex
    const HOST_EXTRACT_RE = /^(?:[a-z0-9+.-]+:)?\/\/(?:[^@/?#]+@)?(\[[a-f0-9:]+\]|[^:/?#]+)/i;

    function getHostname(url) {
        if (!url || typeof url !== 'string') return '';
        const m = url.match(HOST_EXTRACT_RE);
        return m ? m[1].toLowerCase().replace(/\.$/, '') : '';
    }

    function isTelemetryUrl(url) {
        if (!url) return false;
        if (typeof url === 'string') {
            // Instant fast-path: root-relative paths (/api, /bundles/...) are always same-origin
            if (url.charCodeAt(0) === 47 && url.charCodeAt(1) !== 47) return false;
            // Data URIs are never telemetry hosts
            if (url.startsWith('data:')) return false;
        } else {
            if (typeof url.hostname === 'string' && url.hostname.length > 0) {
                let hn = url.hostname;
                let end = hn.length;
                while (end > 0 && hn.charCodeAt(end - 1) === 46) end--;
                if (end === 0) return false;
                if (end < hn.length) hn = hn.slice(0, end);
                return hn !== API_HOST && TELEMETRY_HOST_RE.test(hn);
            }
            url = url.url || url.href || String(url);
            if (typeof url === 'string') {
                if (url.charCodeAt(0) === 47 && url.charCodeAt(1) !== 47) return false;
                if (url.startsWith('data:')) return false;
            }
        }
        const host = getHostname(url);
        return host !== '' && host !== API_HOST && TELEMETRY_HOST_RE.test(host);
    }

    // Broadened API matching: any same-origin or relative endpoint on web.uplearn.co.uk
    function isTargetApi(url) {
        if (!url) return false;
        if (typeof url !== 'string') {
            if (typeof url.hostname === 'string') {
                return url.hostname === API_HOST;
            }
            url = url.url || url.href || String(url);
        }
        if (typeof url !== 'string') return false;

        // Root-relative path (/api, /graphql, etc.) is always same-origin
        if (url.charCodeAt(0) === 47) {
            if (url.charCodeAt(1) !== 47) return true;
            // Protocol-relative //web.uplearn.co.uk/...
            const rest = url.slice(2);
            return rest.startsWith(API_HOST) && (
                rest.length === API_HOST.length ||
                rest.charCodeAt(API_HOST.length) === 47 ||
                rest.charCodeAt(API_HOST.length) === 58 ||
                rest.charCodeAt(API_HOST.length) === 63
            );
        }

        // Absolute http(s) URL matching API_HOST
        if (url.startsWith('https://' + API_HOST) || url.startsWith('http://' + API_HOST)) {
            const nextIdx = (url.charCodeAt(4) === 115 ? 8 : 7) + API_HOST.length;
            if (
                url.length === nextIdx ||
                url.charCodeAt(nextIdx) === 47 ||
                url.charCodeAt(nextIdx) === 58 ||
                url.charCodeAt(nextIdx) === 63
            ) {
                return true;
            }
        }

        // Relative path without leading slash (e.g. "api/graphql") if no scheme present
        if (!/^[a-z0-9+.-]+:\/\//i.test(url) && !url.startsWith('//')) {
            return true;
        }

        try {
            const u = new URL(url, location.href);
            const host = u.hostname.endsWith('.') ? u.hostname.slice(0, -1) : u.hostname;
            return host === API_HOST;
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
                    for (const [key, val] of body) {
                        if (
                            (typeof key === 'string' && LOG_IMPROPER_USE_RE.test(key)) ||
                            (typeof val === 'string' && LOG_IMPROPER_USE_RE.test(val))
                        ) return true;
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
    // 2. DOM, SCRIPT, IFRAME, IMAGE & LINK TAG INTERCEPTION
    // ============================================================
    function hookElementProperty(proto, prop, tag) {
        if (!proto) return;
        const desc = Object.getOwnPropertyDescriptor(proto, prop);
        if (desc && desc.set) {
            origDefineProperty.call(Object, proto, prop, {
                get: desc.get,
                set(val) {
                    if (isTelemetryUrl(val)) {
                        LOG(`blocked <${tag}> ${prop}:`, val);
                        return;
                    }
                    return desc.set.call(this, val);
                },
                configurable: true,
                enumerable: desc.enumerable,
            });
        }
    }

    if (typeof HTMLScriptElement !== 'undefined') hookElementProperty(HTMLScriptElement.prototype, 'src',  'script');
    if (typeof HTMLIFrameElement !== 'undefined') hookElementProperty(HTMLIFrameElement.prototype, 'src',  'iframe');
    if (typeof HTMLImageElement  !== 'undefined') hookElementProperty(HTMLImageElement.prototype,  'src',  'img');
    if (typeof HTMLLinkElement   !== 'undefined') hookElementProperty(HTMLLinkElement.prototype,   'href', 'link');

    const OrigImage = window.Image;
    if (OrigImage && OrigImage.prototype && (typeof HTMLImageElement === 'undefined' || OrigImage.prototype !== HTMLImageElement.prototype)) {
        hookElementProperty(OrigImage.prototype, 'src', 'img');
    }

    const origSetAttribute = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function (name, value) {
        const lower = typeof name === 'string' ? name.toLowerCase() : '';
        if ((lower === 'src' || lower === 'href') && isTelemetryUrl(value)) {
            LOG(`blocked setAttribute(${name}):`, value);
            return;
        }
        return origSetAttribute.call(this, name, value);
    };
    cloak(Element.prototype.setAttribute, 'setAttribute');

    // ============================================================
    // 3. WEB WORKER & BLOB TARGETED NEUTER
    // ============================================================
    const TELEMETRY_CODE_RE = /openreplay|sentry|sessionReplay|replayUploader/i;
    const telemetryBlobUrls = new Set();
    const origCreateObjectURL = (typeof URL !== 'undefined' && URL.createObjectURL) ? URL.createObjectURL : null;

    if (origCreateObjectURL) {
        URL.createObjectURL = function (blob) {
            const url = origCreateObjectURL.apply(this, arguments);
            if (blob && blob.__ul_isTelemetry) {
                telemetryBlobUrls.add(url);
            } else if (blob instanceof Blob) {
                try {
                    if (typeof blob.text === 'function') {
                        blob.text().then((code) => {
                            if (TELEMETRY_CODE_RE.test(code)) {
                                telemetryBlobUrls.add(url);
                            }
                        }).catch(noop);
                    }
                } catch {}
            }
            return url;
        };
        cloak(URL.createObjectURL, 'createObjectURL');
    }

    const OrigBlob = window.Blob;
    if (OrigBlob) {
        const PatchedBlob = function (blobParts, options) {
            if (!new.target) {
                throw new TypeError("Failed to construct 'Blob': Please use the 'new' operator");
            }
            const blob = Reflect.construct(OrigBlob, arguments, new.target);
            try {
                if (blobParts && (Array.isArray(blobParts) || typeof blobParts[Symbol.iterator] === 'function')) {
                    for (const part of blobParts) {
                        if (typeof part === 'string' && TELEMETRY_CODE_RE.test(part)) {
                            blob.__ul_isTelemetry = true;
                            break;
                        }
                    }
                }
            } catch {}
            return blob;
        };
        PatchedBlob.prototype = OrigBlob.prototype;
        Object.setPrototypeOf(PatchedBlob, OrigBlob);
        window.Blob = PatchedBlob;
        cloak(PatchedBlob, 'Blob');
    }

    const OrigWorker = window.Worker;
    if (OrigWorker) {
        const WORKER_DUMMY_DESCS = {
            postMessage:    { value: noop, writable: true, configurable: true },
            terminate:      { value: noop, writable: true, configurable: true },
            onerror:        { value: null, writable: true, configurable: true },
            onmessage:      { value: null, writable: true, configurable: true },
            onmessageerror: { value: null, writable: true, configurable: true },
        };

        const PatchedWorker = function (scriptURL, options) {
            if (!new.target) {
                throw new TypeError("Failed to construct 'Worker': Please use the 'new' operator");
            }
            const urlStr = typeof scriptURL === 'string' ? scriptURL : String(scriptURL || '');
            if (telemetryBlobUrls.has(urlStr) || isTelemetryUrl(scriptURL)) {
                LOG('blocked telemetry WebWorker:', urlStr);
                const dummy = new EventTarget();
                Object.setPrototypeOf(dummy, (new.target && new.target.prototype) || OrigWorker.prototype);
                origDefineProperties.call(Object, dummy, WORKER_DUMMY_DESCS);
                return dummy;
            }
            return Reflect.construct(OrigWorker, arguments, new.target);
        };
        PatchedWorker.prototype = OrigWorker.prototype;
        Object.setPrototypeOf(PatchedWorker, OrigWorker);
        window.Worker = PatchedWorker;
        cloak(PatchedWorker, 'Worker');
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
            if (!new.target) {
                throw new TypeError("Failed to construct 'WebSocket': Please use the 'new' operator");
            }
            if (isTelemetryUrl(url)) {
                LOG('blocked WebSocket connection:', url);
                const dummy = new EventTarget();
                Object.setPrototypeOf(dummy, (new.target && new.target.prototype) || OrigWebSocket.prototype);
                origDefineProperties.call(Object, dummy, WS_DUMMY_DESCS);
                origDefineProperty.call(Object, dummy, 'url', {
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
            return Reflect.construct(OrigWebSocket, arguments, new.target);
        };
        PatchedWebSocket.prototype = OrigWebSocket.prototype;
        Object.setPrototypeOf(PatchedWebSocket, OrigWebSocket);
        window.WebSocket = PatchedWebSocket;
        cloak(PatchedWebSocket, 'WebSocket');
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
                                return origFetch.apply(this, arguments);
                            }).catch(() => origFetch.apply(this, arguments));
                        } catch {}
                    }

                    if (typeof Blob !== 'undefined' && body instanceof Blob) {
                        try {
                            return body.text().then((text) => {
                                if (bodyLooksLikeLogImproperUse(text)) {
                                    LOG('dropped LogImproperUse (Blob body)');
                                    return syntheticOk();
                                }
                                return origFetch.apply(this, arguments);
                            }).catch(() => origFetch.apply(this, arguments));
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

            return origFetch.apply(this, arguments);
        };
        cloak(window.fetch, 'fetch');
    }

    const OrigXHR = window.XMLHttpRequest;
    if (OrigXHR) {
        const origOpen = OrigXHR.prototype.open;
        const origSend = OrigXHR.prototype.send;

        const XHR_COMMON_DESCS = {
            getResponseHeader: {
                value: cloak(function (name) {
                    return String(name).toLowerCase() === 'content-type' ? 'application/json' : null;
                }, 'getResponseHeader'),
                configurable: true,
            },
            getAllResponseHeaders: {
                value: cloak(function () {
                    return 'content-type: application/json\r\n';
                }, 'getAllResponseHeaders'),
                configurable: true,
            },
            responseURL: {
                get: cloak(function () {
                    return this.__ul_url || '';
                }, 'get responseURL'),
                configurable: true,
            },
        };

        const XHR_BLOCKED_DESCS = {
            readyState:            { value: 4, configurable: true },
            status:                { value: 204, configurable: true },
            statusText:            { value: 'No Content', configurable: true },
            responseText:          { value: '', configurable: true },
            response:              { value: '', configurable: true },
            getResponseHeader:     XHR_COMMON_DESCS.getResponseHeader,
            getAllResponseHeaders: XHR_COMMON_DESCS.getAllResponseHeaders,
            responseURL:           XHR_COMMON_DESCS.responseURL,
        };

        const XHR_OK_DESCS = {
            readyState:   { value: 4, configurable: true },
            status:       { value: 200, configurable: true },
            statusText:   { value: 'OK', configurable: true },
            responseText: { value: SYNTHETIC_OK_BODY, configurable: true },
            response: {
                get: cloak(function () {
                    return this.responseType === 'json' ? SYNTHETIC_OK_JSON : SYNTHETIC_OK_BODY;
                }, 'get response'),
                configurable: true,
            },
            getResponseHeader:     XHR_COMMON_DESCS.getResponseHeader,
            getAllResponseHeaders: XHR_COMMON_DESCS.getAllResponseHeaders,
            responseURL:           XHR_COMMON_DESCS.responseURL,
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
                delete this.getResponseHeader;
                delete this.getAllResponseHeaders;
                delete this.responseURL;
            }
            return origOpen.apply(this, arguments);
        };
        cloak(OrigXHR.prototype.open, 'open');

        OrigXHR.prototype.send = function (body) {
            try {
                const url    = this.__ul_url;
                const method = this.__ul_method;

                if (isTelemetryUrl(url)) {
                    LOG('blocked telemetry xhr:', url);
                    this.__ul_spoofed = true;
                    const seq = (this.__ul_seq = (this.__ul_seq || 0) + 1);
                    origDefineProperties.call(Object, this, XHR_BLOCKED_DESCS);
                    dispatchXhrDone(this, seq);
                    return;
                }

                if (isPostMethod(method) && isTargetApi(url) && bodyLooksLikeLogImproperUse(body)) {
                    LOG('dropped LogImproperUse (xhr)');
                    this.__ul_spoofed = true;
                    const seq = (this.__ul_seq = (this.__ul_seq || 0) + 1);
                    origDefineProperties.call(Object, this, XHR_OK_DESCS);
                    dispatchXhrDone(this, seq);
                    return;
                }
            } catch (e) {
                WARN('xhr interceptor error:', e);
            }
            return origSend.apply(this, arguments);
        };
        cloak(OrigXHR.prototype.send, 'send');
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
            return origBeacon.apply(navigator, arguments);
        };
        cloak(navigator.sendBeacon, 'sendBeacon');
    }

    // ============================================================
    // 6. FULLSCREEN BLOCKER & AVAILABILITY SPOOFER
    // ============================================================
    const FULLSCREEN_DOC_DESCS = {
        fullscreenEnabled:       { get: returnFalse, set: noop, configurable: true },
        webkitFullscreenEnabled: { get: returnFalse, set: noop, configurable: true },
        mozFullScreenEnabled:    { get: returnFalse, set: noop, configurable: true },
        msFullscreenEnabled:     { get: returnFalse, set: noop, configurable: true },
        fullscreenElement:       { get: () => null,  set: noop, configurable: true },
        webkitFullscreenElement: { get: () => null,  set: noop, configurable: true },
        mozFullScreenElement:    { get: () => null,  set: noop, configurable: true },
        webkitIsFullScreen:      { get: returnFalse, set: noop, configurable: true },
    };

    const rejectFs = function () {
        const p = Promise.reject(new DOMException('Fullscreen blocked', 'NotAllowedError'));
        p.catch(noop);
        return p;
    };
    cloak(rejectFs, 'requestFullscreen');

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
            origDefineProperties.call(Object, document, FULLSCREEN_DOC_DESCS);
            if (typeof Document !== 'undefined' && Document.prototype) {
                origDefineProperties.call(Object, Document.prototype, FULLSCREEN_DOC_DESCS);
            }
        } catch {}

        const proto = Element.prototype;
        for (let i = 0; i < FS_METHODS.length; i++) {
            const m = FS_METHODS[i];
            try {
                origDefineProperty.call(Object, proto, m, FS_METHOD_DESC);
            } catch {
                proto[m] = rejectFs;
            }
        }
    }
    installFullscreenBlocker();

    // ============================================================
    // 7. TAB-SWITCH / VISIBILITY / FOCUS SPOOFER & HANDLERS
    // ============================================================
    const VISIBILITY_DESCS = {
        visibilityState:       { get: returnVisible, set: noop, configurable: true },
        webkitVisibilityState: { get: returnVisible, set: noop, configurable: true },
        hidden:                { get: returnFalse,   set: noop, configurable: true },
        webkitHidden:          { get: returnFalse,   set: noop, configurable: true },
    };

    function patchVisibilityProps() {
        try {
            origDefineProperties.call(Object, document, VISIBILITY_DESCS);
            if (typeof Document !== 'undefined' && Document.prototype) {
                origDefineProperties.call(Object, Document.prototype, VISIBILITY_DESCS);
            }
            document.hasFocus = returnTrue;
            if (typeof Document !== 'undefined' && Document.prototype) {
                Document.prototype.hasFocus = returnTrue;
            }
        } catch {}
    }
    patchVisibilityProps();

    // Sensitive event handler property neutering (window.onblur = ..., document.onvisibilitychange = ...)
    const NULL_EVENT_HANDLER = {
        get: () => null,
        set: noop,
        configurable: true,
    };
    cloak(NULL_EVENT_HANDLER.get, 'get');
    cloak(NULL_EVENT_HANDLER.set, 'set');

    const SENSITIVE_EVENT_PROPS = [
        'onblur',
        'onfocusout',
        'onvisibilitychange',
        'onpagehide',
        'onfreeze',
        'onfullscreenchange',
        'onwebkitfullscreenchange',
        'onmozfullscreenchange',
        'onfullscreenerror',
        'onwebkitfullscreenerror',
    ];

    for (const prop of SENSITIVE_EVENT_PROPS) {
        try {
            origDefineProperty.call(Object, window, prop, NULL_EVENT_HANDLER);
            origDefineProperty.call(Object, document, prop, NULL_EVENT_HANDLER);
        } catch {}
    }

    // Suppressed events (includes tab-switch, blur, freeze, and fullscreen state/error events)
    const SUPPRESSED_EVENTS = new Set([
        'visibilitychange',
        'webkitvisibilitychange',
        'blur',
        'focusout',
        'pagehide',
        'freeze',
        'fullscreenchange',
        'webkitfullscreenchange',
        'mozfullscreenchange',
        'fullscreenerror',
        'webkitfullscreenerror',
    ]);

    const origProtoAdd = EventTarget.prototype.addEventListener;
    const winDesc      = Object.getOwnPropertyDescriptor(window, 'window');
    const rawWin       = (winDesc && winDesc.value) || window;

    const patchedAddEventListener = function (type, listener, options) {
        if (SUPPRESSED_EVENTS.has(type)) {
            const target = this == null || this === window ? rawWin : this;
            if (target === rawWin || target === document) {
                return;
            }
        }
        return origProtoAdd.apply(this, arguments);
    };
    cloak(patchedAddEventListener, 'addEventListener');

    try {
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
            origProtoAdd.call(rawWin, evt, KILL, true);
        } catch {
            try { origProtoAdd.call(window, evt, KILL, true); } catch {}
        }
        try {
            origProtoAdd.call(document, evt, KILL, true);
        } catch {}
    }

    // ============================================================
    // 8. PROPERTY PROTECTION & MONITORING
    // ============================================================
    const PROTECTED_DOC_PROPS = new Set([
        'visibilityState',
        'webkitVisibilityState',
        'hidden',
        'webkitHidden',
        'hasFocus',
        'fullscreenEnabled',
        'webkitFullscreenEnabled',
        'mozFullScreenEnabled',
        'msFullscreenEnabled',
        'fullscreenElement',
        'webkitFullscreenElement',
        'mozFullScreenElement',
        'webkitIsFullScreen',
    ]);

    const PROTECTED_HANDLER_PROPS = new Set(SENSITIVE_EVENT_PROPS);

    // Guard Object.defineProperty against site scripts attempting to overwrite spoofed properties
    Object.defineProperty = function (target, prop, descriptor) {
        if (target === document || (typeof Document !== 'undefined' && target === Document.prototype)) {
            if (PROTECTED_DOC_PROPS.has(prop)) {
                return target;
            }
        }
        if (target === window || target === document) {
            if (PROTECTED_HANDLER_PROPS.has(prop)) {
                return target;
            }
        }
        return origDefineProperty.call(Object, target, prop, descriptor);
    };
    cloak(Object.defineProperty, 'defineProperty');

    Object.defineProperties = function (target, props) {
        if (props && typeof props === 'object') {
            const isDoc = target === document || (typeof Document !== 'undefined' && target === Document.prototype);
            const isWinOrDoc = target === window || target === document;
            let filtered = false;
            const safeProps = {};
            for (const key of Object.keys(props)) {
                if ((isDoc && PROTECTED_DOC_PROPS.has(key)) || (isWinOrDoc && PROTECTED_HANDLER_PROPS.has(key))) {
                    filtered = true;
                    continue;
                }
                safeProps[key] = props[key];
            }
            if (filtered) {
                return origDefineProperties.call(Object, target, safeProps);
            }
        }
        return origDefineProperties.call(Object, target, props);
    };
    cloak(Object.defineProperties, 'defineProperties');

    if (typeof Reflect !== 'undefined' && Reflect.defineProperty) {
        const origReflectDefineProperty = Reflect.defineProperty;
        Reflect.defineProperty = function (target, prop, descriptor) {
            if (target === document || (typeof Document !== 'undefined' && target === Document.prototype)) {
                if (PROTECTED_DOC_PROPS.has(prop)) {
                    return true;
                }
            }
            if (target === window || target === document) {
                if (PROTECTED_HANDLER_PROPS.has(prop)) {
                    return true;
                }
            }
            return origReflectDefineProperty.call(Reflect, target, prop, descriptor);
        };
        cloak(Reflect.defineProperty, 'defineProperty');
    }

    // Polling backup with functional hasFocus check (safeguards against prototype tampering)
    setInterval(() => {
        try {
            if (document.visibilityState !== 'visible' || document.hidden !== false || !document.hasFocus()) {
                patchVisibilityProps();
            }
            if (document.fullscreenEnabled !== false) {
                installFullscreenBlocker();
            }
        } catch {}
    }, 5000);

    LOG('=== READY | telemetry: blocked | workers: neutered | fullscreen: disabled | tab-switch: blocked ===');
})();
