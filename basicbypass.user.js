// ==UserScript==
// @name         UpLearn Telemetry + Fullscreen + Tab-Switch Blocker (Hardened)
// @namespace    https://github.com/FabianDream/In-Browser-API-Interceptor
// @version      1.6.3
// @description  Blocks telemetry, third-party trackers, WebWorker beacons, auto-fullscreen, and tab-switch/blur detection.
// @author       FabianDream
// @homepageURL  https://github.com/FabianDream/In-Browser-API-Interceptor
// @supportURL   https://github.com/FabianDream/In-Browser-API-Interceptor/issues
// @updateURL    https://raw.githubusercontent.com/FabianDream/In-Browser-API-Interceptor/refs/heads/main/basicbypass.user.js
// @downloadURL  https://raw.githubusercontent.com/FabianDream/In-Browser-API-Interceptor/refs/heads/main/basicbypass.user.js
// @match        https://web.uplearn.co.uk/*
// @run-at       document-start
// @grant        none
// @inject-into  page
//
// @webRequest   [{"selector":{"include":"*://jitsu.uplearn.co.uk/*"},"action":"cancel"}]
// @webRequest   [{"selector":{"include":"*://*.jitsu.com/*"},"action":"cancel"}]
// @webRequest   [{"selector":{"include":"*://openreplay.uplearn.co.uk/*"},"action":"cancel"}]
// @webRequest   [{"selector":{"include":"*://*.ingest.us.sentry.io/*"},"action":"cancel"}]
// @webRequest   [{"selector":{"include":"*://static.cloudflareinsights.com/*"},"action":"cancel"}]
// @webRequest   [{"selector":{"include":"*://api-iam.intercom.io/*"},"action":"cancel"}]
// @webRequest   [{"selector":{"include":"*://widget.intercom.io/*"},"action":"cancel"}]
// @webRequest   [{"selector":{"include":"*://js.intercomcdn.com/*"},"action":"cancel"}]
// @webRequest   [{"selector":{"include":"*://nexus-websocket-*.intercom.io/*"},"action":"cancel"}]
// @webRequest   [{"selector":{"include":"*://www.googletagmanager.com/*"},"action":"cancel"}]
// @webRequest   [{"selector":{"include":"*://*.google-analytics.com/*"},"action":"cancel"}]
// @webRequest   [{"selector":{"include":"*://analytics.google.com/*"},"action":"cancel"}]
// @webRequest   [{"selector":{"include":"*://*.googleadservices.com/*"},"action":"cancel"}]
// @webRequest   [{"selector":{"include":"*://*.doubleclick.net/*"},"action":"cancel"}]
// @webRequest   [{"selector":{"include":"*://connect.facebook.net/*"},"action":"cancel"}]
// @webRequest   [{"selector":{"include":"*://*.sc-static.net/*"},"action":"cancel"}]
// @webRequest   [{"selector":{"include":"*://bat.bing.com/*"},"action":"cancel"}]
// @webRequest   [{"selector":{"include":"*://*.clarity.ms/*"},"action":"cancel"}]
// @webRequest   [{"selector":{"include":"*://bzrcdn.openai.com/*"},"action":"cancel"}]
// @webRequest   [{"selector":{"include":"*://*.fullstory.com/*"},"action":"cancel"}]
// @webRequest   [{"selector":{"include":"*://*.hotjar.com/*"},"action":"cancel"}]
// @webRequest   [{"selector":{"include":"*://*.mixpanel.com/*"},"action":"cancel"}]
// @webRequest   [{"selector":{"include":"*://*.segment.io/*"},"action":"cancel"}]
// @webRequest   [{"selector":{"include":"*://*.amplitude.com/*"},"action":"cancel"}]
// @webRequest   [{"selector":{"include":"*://*.posthog.com/*"},"action":"cancel"}]
// ==/UserScript==

(function () {
    'use strict';

    // ============================================================
    // STEALTH & CLOAKING INFRASTRUCTURE
    // ============================================================
    const origDefineProperty   = Object.defineProperty;
    const origDefineProperties = Object.defineProperties;
    const origGetOwnPropDesc   = Object.getOwnPropertyDescriptor;
    const origSetPrototypeOf   = Object.setPrototypeOf;
    const origToString         = Function.prototype.toString;
    const reflectApply         = Reflect.apply;
    const reflectConstruct     = Reflect.construct;
    const reflectOwnKeys       = Reflect.ownKeys;

    const wmGet       = WeakMap.prototype.get;
    const wmSet       = WeakMap.prototype.set;
    const wsHas       = WeakSet.prototype.has;
    const wsAdd       = WeakSet.prototype.add;
    const setHas      = Set.prototype.has;
    const setAdd      = Set.prototype.add;
    const setDel      = Set.prototype.delete;
    const mapGet      = Map.prototype.get;
    const mapSet      = Map.prototype.set;
    const mapDel      = Map.prototype.delete;
    const mapKeys     = Map.prototype.keys;
    const mapSizeDesc = origGetOwnPropDesc(Map.prototype, 'size');
    const mapSize     = mapSizeDesc && mapSizeDesc.get;
    const mapIterNext = Object.getPrototypeOf(new Map().keys()).next;

    const cloakedFns = new WeakMap();

    function cloak(fn) {
        wmSet.call(cloakedFns, fn, `function ${fn.name}() { [native code] }`);
        return fn;
    }

    function patchConstructor(Patched, Orig) {
        Patched.prototype = Orig.prototype;
        origSetPrototypeOf(Patched, Orig);
        try {
            origDefineProperty(Orig.prototype, 'constructor', {
                value: Patched,
                writable: true,
                configurable: true,
            });
        } catch {}
        return cloak(Patched);
    }

    Function.prototype.toString = cloak(({
        toString() {
            return wmGet.call(cloakedFns, this) || origToString.call(this);
        },
    }).toString);

    const noop = () => {};

    function makeGetter(prop, val) {
        const name = `get ${prop}`;
        return cloak(({ [name]() { return val; } })[name]);
    }

    function makeHandlerDesc(prop) {
        const gName = `get ${prop}`;
        const sName = `set ${prop}`;
        return {
            get: cloak(({ [gName]() { return null; } })[gName]),
            set: cloak(({ [sName](_) {} })[sName]),
            enumerable: true,
            configurable: true,
        };
    }

    const DEBUG = false;
    const LOG   = DEBUG && typeof console !== 'undefined' && console.log
        ? console.log.bind(console, '%c[UL]', 'color:#00e5ff;font-weight:bold')
        : noop;
    const WARN  = DEBUG && typeof console !== 'undefined' && console.warn
        ? console.warn.bind(console, '[UL]')
        : noop;

    // Response synthesis for dropped telemetry calls
    const SYNTHETIC_OK_BODY = '{"data":{"logImproperUse":true}}';
    const NO_CONTENT_INIT   = { status: 204, statusText: 'No Content' };
    const OK_RESPONSE_INIT  = {
        status: 200,
        statusText: 'OK',
        headers: { 'Content-Type': 'application/json' },
    };

    function syntheticOk() {
        return new Response(SYNTHETIC_OK_BODY, OK_RESPONSE_INIT);
    }

    function syntheticNoContent() {
        return new Response(null, NO_CONTENT_INIT);
    }

    function isPostMethod(method) {
        if (method === 'POST') return true;
        return typeof method === 'string' && method.length === 4 &&
            (method.charCodeAt(0) | 32) === 112 &&
            (method.charCodeAt(1) | 32) === 111 &&
            (method.charCodeAt(2) | 32) === 115 &&
            (method.charCodeAt(3) | 32) === 116;
    }

    // ============================================================
    // 1. TELEMETRY HOST DEFINITIONS & SINGLE-PASS URL CLASSIFIER
    // ============================================================
    const API_HOST = 'web.uplearn.co.uk';

    const URL_OTHER      = 0;
    const URL_TELEMETRY  = 1;
    const URL_TARGET_API = 2;

    const TELEMETRY_HOSTS = new Set([
        'jitsu.uplearn.co.uk',
        'jitsu.com',
        'openreplay.uplearn.co.uk',
        'sentry.io',
        'cloudflareinsights.com',
        'intercom.io',
        'intercomcdn.com',
        'googletagmanager.com',
        'google-analytics.com',
        'analytics.google.com',
        'googleadservices.com',
        'doubleclick.net',
        'facebook.net',
        'sc-static.net',
        'bat.bing.com',
        'clarity.ms',
        'bzrcdn.openai.com',
        'fullstory.com',
        'hotjar.com',
        'mixpanel.com',
        'segment.io',
        'amplitude.com',
        'posthog.com',
    ]);

    function toUrlString(url) {
        if (typeof url === 'string') return url;
        if (!url) return '';
        if (typeof url.url === 'string') return url.url;
        if (typeof url.href === 'string') return url.href;
        if (typeof url.baseVal === 'string') return url.baseVal;
        return String(url);
    }

    function hostIsTelemetry(host) {
        if (setHas.call(TELEMETRY_HOSTS, host)) return true;
        let pos = host.indexOf('.');
        while (pos !== -1) {
            const next = host.indexOf('.', pos + 1);
            if (next === -1) return false;
            if (setHas.call(TELEMETRY_HOSTS, host.slice(pos + 1))) return true;
            pos = next;
        }
        return false;
    }

    const HOST_CACHE_MAX = 256;
    const hostKindCache  = new Map();

    // Unified single-pass scheme + hostname classifier
    function classifyUrl(url) {
        const str = typeof url === 'string' ? url : toUrlString(url);
        const len = str.length;
        if (len === 0) return URL_OTHER;
        if (str.charCodeAt(0) === 47 && (len === 1 || str.charCodeAt(1) !== 47)) {
            return URL_TARGET_API;
        }

        let start = 0;
        while (start < len && str.charCodeAt(start) <= 32) start++;
        if (start >= len) return URL_OTHER;

        const c0 = str.charCodeAt(start);
        if (c0 === 47) { // '/'
            if (start + 1 >= len || str.charCodeAt(start + 1) !== 47) return URL_TARGET_API;
            start += 2;
        } else {
            const first = c0 | 32;
            if (first < 97 || first > 122) return URL_TARGET_API;
            const limit = start + 32 < len ? start + 32 : len;
            let schemeEnd = 0;
            for (let i = start + 1; i < limit; i++) {
                const ch = str.charCodeAt(i);
                if (ch === 58) { // ':'
                    if (i + 2 < len && str.charCodeAt(i + 1) === 47 && str.charCodeAt(i + 2) === 47) {
                        schemeEnd = i + 3;
                        break;
                    }
                    return URL_OTHER;
                }
                const low = ch | 32;
                if (!((low >= 97 && low <= 122) || (ch >= 48 && ch <= 57) || ch === 43 || ch === 45 || ch === 46)) {
                    return URL_TARGET_API;
                }
            }
            if (schemeEnd === 0) return URL_TARGET_API;
            start = schemeEnd;
        }

        let end = start;
        let colon = -1;
        let inBracket = false;
        let hasUpper = false;
        for (; end < len; end++) {
            const c = str.charCodeAt(end);
            if (c === 47 || c === 63 || c === 35 || c <= 32) break; // / ? # or control/space
            if (c === 64) { // @
                start = end + 1;
                colon = -1;
                inBracket = false;
                hasUpper = false;
            } else if (c === 91) { // [
                inBracket = true;
            } else if (c === 93) { // ]
                inBracket = false;
            } else if (c === 58 && !inBracket && colon === -1) { // :
                colon = end;
            } else if (c >= 65 && c <= 90 && colon === -1) { // A-Z
                hasUpper = true;
            }
        }

        if (colon !== -1) end = colon;
        while (end > start && str.charCodeAt(end - 1) === 46) end--;
        const hostLen = end - start;
        if (hostLen <= 0) return URL_OTHER;

        if (!hasUpper && hostLen === API_HOST.length && str.startsWith(API_HOST, start)) {
            return URL_TARGET_API;
        }

        const rawHost = str.slice(start, end);
        const host = hasUpper ? rawHost.toLowerCase() : rawHost;
        if (host === API_HOST) return URL_TARGET_API;

        let kind = mapGet.call(hostKindCache, host);
        if (kind !== undefined) return kind;

        kind = hostIsTelemetry(host) ? URL_TELEMETRY : URL_OTHER;
        if ((mapSize ? mapSize.call(hostKindCache) : hostKindCache.size) >= HOST_CACHE_MAX) {
            const oldest = mapIterNext.call(mapKeys.call(hostKindCache)).value;
            if (oldest !== undefined) mapDel.call(hostKindCache, oldest);
        }
        mapSet.call(hostKindCache, host, kind);
        return kind;
    }

    function isTelemetryUrl(url) {
        return classifyUrl(url) === URL_TELEMETRY;
    }

    const MAX_BODY_SCAN       = 65536;
    const LOG_IMPROPER_USE_RE = /logimproperuse/i;
    let sharedTextDecoder = null;

    function bodyLooksLikeLogImproperUse(body) {
        if (typeof body === 'string') {
            return body.length <= MAX_BODY_SCAN && LOG_IMPROPER_USE_RE.test(body);
        }
        if (!body || typeof body !== 'object') return false;
        try {
            if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) {
                const s = body.toString();
                return s.length <= MAX_BODY_SCAN && LOG_IMPROPER_USE_RE.test(s);
            }
            if (ArrayBuffer.isView(body) || (typeof ArrayBuffer !== 'undefined' && body instanceof ArrayBuffer)) {
                if (body.byteLength > MAX_BODY_SCAN) return false;
                sharedTextDecoder ||= new TextDecoder();
                return LOG_IMPROPER_USE_RE.test(sharedTextDecoder.decode(body));
            }
            if (typeof FormData !== 'undefined' && body instanceof FormData) {
                for (const [key, val] of body) {
                    if (
                        (typeof key === 'string' && key.length <= MAX_BODY_SCAN && LOG_IMPROPER_USE_RE.test(key)) ||
                        (typeof val === 'string' && val.length <= MAX_BODY_SCAN && LOG_IMPROPER_USE_RE.test(val))
                    ) return true;
                }
            }
        } catch {}
        return false;
    }

    // ============================================================
    // 2. DOM, SCRIPT, IFRAME, IMAGE & LINK TAG INTERCEPTION
    // ============================================================
    function hookElementProperty(proto, prop, tag) {
        const desc = proto && origGetOwnPropDesc(proto, prop);
        if (desc && desc.set) {
            const origSet = desc.set;
            const sName = `set ${prop}`;
            origDefineProperty(proto, prop, {
                get: desc.get,
                set: cloak(({
                    [sName](val) {
                        if (isTelemetryUrl(val)) {
                            LOG(`blocked <${tag}> ${prop}:`, val);
                            return;
                        }
                        return origSet.call(this, val);
                    },
                })[sName]),
                configurable: true,
                enumerable: desc.enumerable,
            });
        }
    }

    if (typeof HTMLScriptElement !== 'undefined') hookElementProperty(HTMLScriptElement.prototype, 'src',  'script');
    if (typeof HTMLIFrameElement !== 'undefined') hookElementProperty(HTMLIFrameElement.prototype, 'src',  'iframe');
    if (typeof HTMLImageElement  !== 'undefined') hookElementProperty(HTMLImageElement.prototype,  'src',  'img');
    const ImageCtor = typeof Image === 'function' ? Image : window.Image;
    if (typeof ImageCtor === 'function' && ImageCtor.prototype && (typeof HTMLImageElement === 'undefined' || ImageCtor.prototype !== HTMLImageElement.prototype)) {
        hookElementProperty(ImageCtor.prototype, 'src', 'img');
    }
    if (typeof HTMLLinkElement   !== 'undefined') hookElementProperty(HTMLLinkElement.prototype,   'href', 'link');

    function isUrlAttribute(name) {
        if (name === 'src' || name === 'href') return true;
        if (typeof name !== 'string') return false;
        const len = name.length;
        if (len === 3) {
            return (name.charCodeAt(0) | 32) === 115 &&
                   (name.charCodeAt(1) | 32) === 114 &&
                   (name.charCodeAt(2) | 32) === 99;
        }
        if (len === 4) {
            return (name.charCodeAt(0) | 32) === 104 &&
                   (name.charCodeAt(1) | 32) === 114 &&
                   (name.charCodeAt(2) | 32) === 101 &&
                   (name.charCodeAt(3) | 32) === 102;
        }
        return false;
    }

    const origSetAttribute = Element.prototype.setAttribute;
    Element.prototype.setAttribute = cloak(({
        setAttribute(name, value) {
            if (isUrlAttribute(name) && isTelemetryUrl(value)) {
                LOG(`blocked setAttribute(${name}):`, value);
                return;
            }
            return origSetAttribute.call(this, name, value);
        },
    }).setAttribute);

    // ============================================================
    // 3. WEB WORKER, BLOB & WEBSOCKET NEUTERING
    // ============================================================
    const TELEMETRY_CODE_RE = /openreplay|sentry|sessionReplay|replayUploader/i;
    const telemetryBlobs    = new WeakSet();
    const telemetryBlobUrls = new Set();

    function createDummyTarget(newTarget, FallbackCtor, descs) {
        const dummy = reflectConstruct(EventTarget, [], newTarget || FallbackCtor);
        origDefineProperties(dummy, descs);
        return dummy;
    }

    if (typeof URL !== 'undefined') {
        const origCreateObjectURL = URL.createObjectURL;
        const origRevokeObjectURL = URL.revokeObjectURL;

        if (origCreateObjectURL) {
            URL.createObjectURL = cloak(({
                createObjectURL(obj) {
                    const url = origCreateObjectURL.call(this, obj);
                    if (obj && typeof obj === 'object' && wsHas.call(telemetryBlobs, obj)) {
                        setAdd.call(telemetryBlobUrls, url);
                    }
                    return url;
                },
            }).createObjectURL);
        }

        if (origRevokeObjectURL) {
            URL.revokeObjectURL = cloak(({
                revokeObjectURL(url) {
                    if (typeof url === 'string') {
                        setDel.call(telemetryBlobUrls, url);
                    }
                    return origRevokeObjectURL.call(this, url);
                },
            }).revokeObjectURL);
        }
    }

    const MEDIA_BLOB_TYPE_RE = /^(?:video|audio|image|font)\//i;

    function isTelemetryBlobPart(part, options) {
        if (typeof part === 'string') {
            return part.length < 1e6 &&
                !(options && typeof options.type === 'string' && MEDIA_BLOB_TYPE_RE.test(options.type)) &&
                TELEMETRY_CODE_RE.test(part);
        }
        return typeof part === 'object' && part !== null && wsHas.call(telemetryBlobs, part);
    }

    const OrigBlob = window.Blob;
    if (OrigBlob) {
        const PatchedBlob = patchConstructor(function Blob(blobParts = undefined, options = undefined) {
            if (!new.target) return OrigBlob();
            const argc = arguments.length;
            const blob = new.target === PatchedBlob
                ? (argc === 0 ? new OrigBlob() : argc === 1 ? new OrigBlob(blobParts) : new OrigBlob(blobParts, options))
                : reflectConstruct(OrigBlob, argc === 0 ? [] : argc === 1 ? [blobParts] : [blobParts, options], new.target);
            try {
                if (blobParts) {
                    if (Array.isArray(blobParts)) {
                        for (let i = 0, len = blobParts.length; i < len; i++) {
                            if (isTelemetryBlobPart(blobParts[i], options)) {
                                wsAdd.call(telemetryBlobs, blob);
                                break;
                            }
                        }
                    } else if (typeof blobParts[Symbol.iterator] === 'function') {
                        for (const part of blobParts) {
                            if (isTelemetryBlobPart(part, options)) {
                                wsAdd.call(telemetryBlobs, blob);
                                break;
                            }
                        }
                    }
                }
            } catch {}
            return blob;
        }, OrigBlob);
        window.Blob = PatchedBlob;
    }

    const OrigWorker = window.Worker;
    if (OrigWorker) {
        const WORKER_DUMMY_DESCS = {
            postMessage:    { value: cloak(({ postMessage(message) {} }).postMessage), writable: true, configurable: true },
            terminate:      { value: cloak(({ terminate() {} }).terminate), writable: true, configurable: true },
            onerror:        { value: null, writable: true, configurable: true },
            onmessage:      { value: null, writable: true, configurable: true },
            onmessageerror: { value: null, writable: true, configurable: true },
        };

        window.Worker = patchConstructor(function Worker(scriptURL, options = undefined) {
            if (!new.target) return OrigWorker();
            const urlStr = toUrlString(scriptURL);
            if (
                setHas.call(telemetryBlobUrls, urlStr) ||
                isTelemetryUrl(urlStr) ||
                (urlStr.startsWith('data:') && TELEMETRY_CODE_RE.test(urlStr))
            ) {
                LOG('blocked telemetry WebWorker:', urlStr);
                return createDummyTarget(new.target, OrigWorker, WORKER_DUMMY_DESCS);
            }
            return reflectConstruct(OrigWorker, arguments, new.target);
        }, OrigWorker);
    }

    const OrigWebSocket = window.WebSocket;
    if (OrigWebSocket) {
        const WS_DUMMY_DESCS = {
            readyState:     { value: 0, writable: true, configurable: true },
            protocol:       { value: '', writable: true, configurable: true },
            extensions:     { value: '', writable: true, configurable: true },
            bufferedAmount: { value: 0, writable: true, configurable: true },
            binaryType:     { value: 'blob', writable: true, configurable: true },
            send:           { value: cloak(({ send(data) {} }).send), writable: true, configurable: true },
            close:          { value: cloak(({ close() { this.readyState = 3; } }).close), writable: true, configurable: true },
            onopen:         { value: null, writable: true, configurable: true },
            onerror:        { value: null, writable: true, configurable: true },
            onclose:        { value: null, writable: true, configurable: true },
            onmessage:      { value: null, writable: true, configurable: true },
        };

        function dispatchDummyWsEvent(target, evt, prop) {
            try { target.dispatchEvent(evt); } catch {}
            try {
                const handler = target[prop];
                if (typeof handler === 'function') handler.call(target, evt);
            } catch {}
        }

        window.WebSocket = patchConstructor(function WebSocket(url, protocols = undefined) {
            if (!new.target) return OrigWebSocket();
            const urlStr = toUrlString(url);
            if (isTelemetryUrl(urlStr)) {
                LOG('blocked WebSocket connection:', urlStr);
                const dummy = createDummyTarget(new.target, OrigWebSocket, WS_DUMMY_DESCS);
                origDefineProperty(dummy, 'url', {
                    value: urlStr,
                    writable: true,
                    configurable: true,
                });
                setTimeout(() => {
                    dummy.readyState = 3;
                    dispatchDummyWsEvent(dummy, new Event('error'), 'onerror');
                    const closeEvt = typeof CloseEvent !== 'undefined'
                        ? new CloseEvent('close', { code: 1006, reason: 'Blocked' })
                        : new Event('close');
                    dispatchDummyWsEvent(dummy, closeEvt, 'onclose');
                }, 0);
                return dummy;
            }
            return reflectConstruct(OrigWebSocket, arguments, new.target);
        }, OrigWebSocket);

        const WS_CONSTS = ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'];
        for (let i = 0; i < WS_CONSTS.length; i++) {
            const k = WS_CONSTS[i];
            const d = origGetOwnPropDesc(OrigWebSocket, k);
            origDefineProperty(
                window.WebSocket,
                k,
                d && 'value' in d
                    ? { value: d.value, writable: !!d.writable, enumerable: !!d.enumerable, configurable: !!d.configurable }
                    : { value: i, writable: false, enumerable: true, configurable: false }
            );
        }
    }

    // ============================================================
    // 4. FETCH / XHR / BEACON INTERCEPTORS
    // ============================================================
    const SKIP_CONTENT_TYPE_RE = /^\s*(?:image\/|video\/|audio\/|multipart\/|application\/octet-stream\b)/i;

    function shouldSkipRequestScan(req) {
        const headers = req.headers;
        if (!headers || typeof headers.get !== 'function') return false;
        const cl = headers.get('content-length');
        if (cl != null && cl !== '' && Number(cl) > MAX_BODY_SCAN) return true;
        const ct = headers.get('content-type');
        return !!(ct && SKIP_CONTENT_TYPE_RE.test(ct));
    }

    const origFetch = typeof window.fetch === 'function' ? window.fetch : null;
    if (origFetch) {
        window.fetch = cloak(({
            fetch(input, init = undefined) {
                try {
                    const kind = classifyUrl(input);
                    if (kind === URL_TELEMETRY) {
                        LOG('blocked telemetry fetch:', input);
                        return Promise.resolve(syntheticNoContent());
                    }

                    const method = (init && init.method) || (typeof input === 'object' && input !== null ? input.method : undefined);
                    if (kind === URL_TARGET_API && isPostMethod(method)) {
                        const body = init && init.body;
                        let asyncSource = null;

                        if (body != null) {
                            if (bodyLooksLikeLogImproperUse(body)) {
                                LOG('dropped LogImproperUse (fetch)');
                                return Promise.resolve(syntheticOk());
                            }
                            if (typeof body.text === 'function' && !(typeof body.size === 'number' && body.size > MAX_BODY_SCAN)) {
                                asyncSource = body;
                            }
                        } else if (typeof Request !== 'undefined' && input instanceof Request && input.body != null && !input.bodyUsed) {
                            if (!shouldSkipRequestScan(input)) {
                                asyncSource = input.clone();
                            }
                        }

                        if (asyncSource) {
                            return asyncSource.text().then(
                                (text) => {
                                    if (text.length <= MAX_BODY_SCAN && LOG_IMPROPER_USE_RE.test(text)) {
                                        LOG('dropped LogImproperUse (async fetch body)');
                                        return syntheticOk();
                                    }
                                    return origFetch.call(this, input, init);
                                },
                                () => origFetch.call(this, input, init)
                            );
                        }
                    }
                } catch (e) {
                    WARN('fetch interceptor error:', e);
                }

                return origFetch.call(this, input, init);
            },
        }).fetch);
    }

    const OrigXHR = window.XMLHttpRequest;
    if (OrigXHR) {
        const origOpen  = OrigXHR.prototype.open;
        const origSend  = OrigXHR.prototype.send;
        const origAbort = OrigXHR.prototype.abort;
        const xhrState  = new WeakMap();

        const responseUrlDesc = {
            get: cloak(({
                'get responseURL'() {
                    const st = wmGet.call(xhrState, this);
                    return (st && st.url) || '';
                },
            })['get responseURL']),
            configurable: true,
        };

        function makeXhrDescs(status, statusText, text, isJsonOk, rawHeaders) {
            return {
                readyState:   { value: 4, configurable: true },
                status:       { value: status, configurable: true },
                statusText:   { value: statusText, configurable: true },
                responseText: { value: text, configurable: true },
                responseURL:  responseUrlDesc,
                response: {
                    get: cloak(({
                        'get response'() {
                            return this.responseType === 'json'
                                ? (isJsonOk ? { data: { logImproperUse: true } } : null)
                                : text;
                        },
                    })['get response']),
                    configurable: true,
                },
                getResponseHeader: {
                    value: cloak(({
                        getResponseHeader(name) {
                            return rawHeaders && String(name).toLowerCase() === 'content-type'
                                ? 'application/json'
                                : null;
                        },
                    }).getResponseHeader),
                    configurable: true,
                },
                getAllResponseHeaders: {
                    value: cloak(({
                        getAllResponseHeaders() {
                            return rawHeaders;
                        },
                    }).getAllResponseHeaders),
                    configurable: true,
                },
            };
        }

        const XHR_BLOCKED_DESCS = makeXhrDescs(204, 'No Content', '', false, '');
        const XHR_OK_DESCS      = makeXhrDescs(200, 'OK', SYNTHETIC_OK_BODY, true, 'content-type: application/json\r\n');
        const SPOOFED_XHR_KEYS  = Object.keys(XHR_OK_DESCS);

        function spoofXhr(xhr, st, descs) {
            const seq = ++st.seq;
            setTimeout(() => {
                if (st.seq !== seq) return;
                st.spoofed = true;
                try {
                    origDefineProperties(xhr, descs);
                    xhr.dispatchEvent(new Event('readystatechange'));
                    const EvtCtor = typeof ProgressEvent !== 'undefined' ? ProgressEvent : Event;
                    xhr.dispatchEvent(new EvtCtor('load'));
                    xhr.dispatchEvent(new EvtCtor('loadend'));
                } catch {}
            }, 0);
        }

        OrigXHR.prototype.open = cloak(({
            open(method, url) {
                let st = wmGet.call(xhrState, this);
                if (!st) {
                    st = { method: '', url: '', kind: URL_OTHER, seq: 0, spoofed: false };
                    wmSet.call(xhrState, this, st);
                } else if (st.spoofed) {
                    st.spoofed = false;
                    for (let i = 0; i < SPOOFED_XHR_KEYS.length; i++) {
                        delete this[SPOOFED_XHR_KEYS[i]];
                    }
                }
                const urlStr = toUrlString(url);
                st.method = method;
                st.url    = urlStr;
                st.kind   = classifyUrl(urlStr);
                st.seq++;
                return reflectApply(origOpen, this, arguments);
            },
        }).open);

        OrigXHR.prototype.send = cloak(({
            send(body = undefined) {
                try {
                    const st = wmGet.call(xhrState, this);
                    if (st) {
                        if (st.kind === URL_TELEMETRY) {
                            LOG('blocked telemetry xhr:', st.url);
                            spoofXhr(this, st, XHR_BLOCKED_DESCS);
                            return;
                        }
                        if (st.kind === URL_TARGET_API && isPostMethod(st.method) && bodyLooksLikeLogImproperUse(body)) {
                            LOG('dropped LogImproperUse (xhr)');
                            spoofXhr(this, st, XHR_OK_DESCS);
                            return;
                        }
                    }
                } catch (e) {
                    WARN('xhr interceptor error:', e);
                }
                return origSend.call(this, body);
            },
        }).send);

        if (origAbort) {
            OrigXHR.prototype.abort = cloak(({
                abort() {
                    const st = wmGet.call(xhrState, this);
                    if (st) st.seq++;
                    return reflectApply(origAbort, this, arguments);
                },
            }).abort);
        }
    }

    if (typeof navigator.sendBeacon === 'function') {
        const origBeacon = navigator.sendBeacon;
        navigator.sendBeacon = cloak(({
            sendBeacon(url, data = undefined) {
                try {
                    const kind = classifyUrl(url);
                    if (kind === URL_TELEMETRY) {
                        LOG('blocked sendBeacon:', url);
                        return true;
                    }
                    if (kind === URL_TARGET_API && data != null && bodyLooksLikeLogImproperUse(data)) {
                        LOG('dropped LogImproperUse (sendBeacon)');
                        return true;
                    }
                } catch {}
                return origBeacon.call(this, url, data);
            },
        }).sendBeacon);
    }

    // ============================================================
    // 5. FULLSCREEN, VISIBILITY, FOCUS & EVENT SUPPRESSION
    // ============================================================
    const DocProto         = typeof Document !== 'undefined' ? Document.prototype : null;
    const HtmlDocProto     = typeof HTMLDocument !== 'undefined' && HTMLDocument.prototype !== DocProto ? HTMLDocument.prototype : null;
    const WinProto         = typeof Window !== 'undefined' ? Window.prototype : null;
    const EventTargetProto = typeof EventTarget !== 'undefined' ? EventTarget.prototype : null;
    const docTarget        = DocProto || document;

    const DOC_SPOOF_SPECS = [
        ['fullscreenEnabled',       false],
        ['webkitFullscreenEnabled', false],
        ['mozFullScreenEnabled',    false],
        ['msFullscreenEnabled',     false],
        ['fullscreenElement',       null],
        ['webkitFullscreenElement', null],
        ['mozFullScreenElement',    null],
        ['webkitIsFullScreen',      false],
        ['visibilityState',         'visible'],
        ['webkitVisibilityState',   'visible'],
        ['hidden',                  false],
        ['webkitHidden',            false],
    ];

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

    const PROTECTED_DOC_PROPS = new Set(['hasFocus', 'addEventListener']);
    const PROTECTED_WIN_PROPS = new Set(['addEventListener']);
    const PROTECTED_ET_PROPS  = new Set(['addEventListener']);

    const docSpoofDescs = {
        hasFocus: {
            value: cloak(({ hasFocus() { return true; } }).hasFocus),
            writable: true,
            enumerable: true,
            configurable: true,
        },
    };
    const winSpoofDescs = {};

    for (let i = 0; i < DOC_SPOOF_SPECS.length; i++) {
        const [prop, val] = DOC_SPOOF_SPECS[i];
        if (prop in docTarget || prop in document) {
            setAdd.call(PROTECTED_DOC_PROPS, prop);
            docSpoofDescs[prop] = {
                get: makeGetter(prop, val),
                enumerable: true,
                configurable: true,
            };
        }
    }

    for (const evt of SUPPRESSED_EVENTS) {
        if (evt === 'webkitvisibilitychange') continue;
        const prop  = 'on' + evt;
        const inDoc = prop in docTarget || prop in document;
        const inWin = prop in window;
        if (!inDoc && !inWin) continue;

        const desc = makeHandlerDesc(prop);
        if (inDoc) {
            setAdd.call(PROTECTED_DOC_PROPS, prop);
            docSpoofDescs[prop] = desc;
        }
        if (inWin) {
            setAdd.call(PROTECTED_WIN_PROPS, prop);
            winSpoofDescs[prop] = desc;
        }
    }

    try {
        origDefineProperties(docTarget, docSpoofDescs);
    } catch {
        for (const prop of Object.keys(docSpoofDescs)) {
            try {
                origDefineProperty(docTarget, prop, docSpoofDescs[prop]);
            } catch {
                try { origDefineProperty(document, prop, docSpoofDescs[prop]); } catch {}
            }
        }
    }
    if (docTarget !== document) {
        for (const prop of Object.keys(docSpoofDescs)) {
            if (origGetOwnPropDesc(document, prop)) {
                try { origDefineProperty(document, prop, docSpoofDescs[prop]); } catch {}
            }
            if (HtmlDocProto && origGetOwnPropDesc(HtmlDocProto, prop)) {
                try { origDefineProperty(HtmlDocProto, prop, docSpoofDescs[prop]); } catch {}
            }
        }
    }

    try {
        origDefineProperties(window, winSpoofDescs);
    } catch {
        for (const prop of Object.keys(winSpoofDescs)) {
            try { origDefineProperty(window, prop, winSpoofDescs[prop]); } catch {}
        }
    }

    const FS_METHODS = [
        'requestFullscreen',
        'webkitRequestFullscreen',
        'webkitRequestFullScreen',
        'mozRequestFullScreen',
        'msRequestFullscreen',
    ];

    for (let i = 0; i < FS_METHODS.length; i++) {
        const m = FS_METHODS[i];
        if (m in Element.prototype) {
            const rejectFn = cloak(({
                [m]() {
                    const p = Promise.reject(new DOMException('Fullscreen blocked', 'NotAllowedError'));
                    p.catch(noop);
                    return p;
                },
            })[m]);
            try {
                origDefineProperty(Element.prototype, m, {
                    value: rejectFn,
                    writable: true,
                    enumerable: true,
                    configurable: true,
                });
            } catch {
                Element.prototype[m] = rejectFn;
            }
        }
    }

    const origProtoAdd = EventTarget.prototype.addEventListener;
    const winDesc      = origGetOwnPropDesc(window, 'window');
    const rawWin       = (winDesc && winDesc.value) || window;

    const patchedAddEventListener = cloak(({
        addEventListener(type, listener, options = undefined) {
            if (
                (this === document || this === rawWin || this === window || this == null) &&
                setHas.call(SUPPRESSED_EVENTS, type)
            ) {
                return;
            }
            if (arguments.length >= 2) {
                return origProtoAdd.call(this, type, listener, options);
            }
            return arguments.length === 1
                ? origProtoAdd.call(this, type)
                : origProtoAdd.call(this);
        },
    }).addEventListener);

    function defineAddEventListener(target, protoFallback) {
        const desc = origGetOwnPropDesc(target, 'addEventListener') ||
            (protoFallback && origGetOwnPropDesc(protoFallback, 'addEventListener'));
        try {
            origDefineProperty(target, 'addEventListener', {
                value: patchedAddEventListener,
                writable: true,
                enumerable: desc ? desc.enumerable : true,
                configurable: true,
            });
        } catch {
            try { target.addEventListener = patchedAddEventListener; } catch {}
        }
    }

    defineAddEventListener(EventTarget.prototype, null);
    if (window.addEventListener !== patchedAddEventListener) {
        defineAddEventListener(window, WinProto);
    }
    if (document.addEventListener !== patchedAddEventListener) {
        defineAddEventListener(document, DocProto);
    }

    const killEvent = (e) => {
        if (
            e.type === 'blur' &&
            e.target &&
            e.target !== window &&
            e.target !== rawWin &&
            e.target !== document
        ) {
            return;
        }
        e.stopImmediatePropagation();
    };

    for (const evt of SUPPRESSED_EVENTS) {
        if (evt === 'focusout') continue;
        try {
            origProtoAdd.call(rawWin, evt, killEvent, true);
        } catch {
            try { origProtoAdd.call(window, evt, killEvent, true); } catch {}
        }
    }

    // ============================================================
    // 6. PROPERTY PROTECTION & MONITORING
    // ============================================================
    function getProtectedSet(target) {
        if (!target || (typeof target !== 'object' && typeof target !== 'function')) return null;
        if (target === document || target === DocProto || target === HtmlDocProto) return PROTECTED_DOC_PROPS;
        if (target === window || target === rawWin || target === WinProto) return PROTECTED_WIN_PROPS;
        if (target === EventTargetProto) return PROTECTED_ET_PROPS;
        return null;
    }

    function isProtectedProp(target, prop) {
        const set = getProtectedSet(target);
        return set !== null && setHas.call(set, prop);
    }

    Object.defineProperty = cloak(({
        defineProperty(target, prop, descriptor) {
            return isProtectedProp(target, prop)
                ? target
                : origDefineProperty(target, prop, descriptor);
        },
    }).defineProperty);

    Object.defineProperties = cloak(({
        defineProperties(target, props) {
            const set = props != null ? getProtectedSet(target) : null;
            if (set) {
                const obj = Object(props);
                const keys = reflectOwnKeys(obj);
                let safeProps = null;
                for (let i = 0; i < keys.length; i++) {
                    const key = keys[i];
                    if (setHas.call(set, key)) {
                        if (!safeProps) {
                            safeProps = Object.create(null);
                            for (let j = 0; j < i; j++) {
                                const prevKey = keys[j];
                                const d = origGetOwnPropDesc(obj, prevKey);
                                if (d && d.enumerable) safeProps[prevKey] = obj[prevKey];
                            }
                        }
                    } else if (safeProps) {
                        const d = origGetOwnPropDesc(obj, key);
                        if (d && d.enumerable) safeProps[key] = obj[key];
                    }
                }
                if (safeProps) {
                    return origDefineProperties(target, safeProps);
                }
            }
            return origDefineProperties(target, props);
        },
    }).defineProperties);

    if (Reflect.defineProperty) {
        const origReflectDefineProperty = Reflect.defineProperty;
        Reflect.defineProperty = cloak(({
            defineProperty(target, prop, descriptor) {
                return isProtectedProp(target, prop)
                    ? true
                    : origReflectDefineProperty(target, prop, descriptor);
            },
        }).defineProperty);
    }

    LOG('=== READY | telemetry: blocked | workers: neutered | fullscreen: disabled | tab-switch: blocked ===');
})();
