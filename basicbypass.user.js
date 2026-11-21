// ==UserScript==
// @name         UpLearn Telemetry + Fullscreen + Tab-Switch Blocker (Hardened)
// @namespace    https://github.com/FabianDream/In-Browser-API-Interceptor
// @version      1.7.0
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
    // 0. STEALTH, BUILTIN SNAPSHOTS & SHARED HELPERS
    // ============================================================
    const origCreate           = Object.create;
    const origKeys             = Object.keys;
    const origDefineProperty   = Object.defineProperty;
    const origDefineProperties = Object.defineProperties;
    const origGetOwnPropDesc   = Object.getOwnPropertyDescriptor;
    const origSetPrototypeOf   = Object.setPrototypeOf;
    const origToString         = Function.prototype.toString;
    const reflectApply         = Reflect.apply;
    const reflectConstruct     = Reflect.construct;
    const reflectOwnKeys       = Reflect.ownKeys;
    const isArray              = Array.isArray;

    const OrigPromise          = Promise;
    const OrigEvent            = Event;
    const OrigDOMException     = typeof DOMException === 'function' ? DOMException : Error;
    const OrigResponse         = typeof Response === 'function' ? Response : null;
    const OrigRequest          = typeof Request === 'function' ? Request : null;
    const OrigURLSearchParams  = typeof URLSearchParams === 'function' ? URLSearchParams : null;
    const OrigFormData         = typeof FormData === 'function' ? FormData : null;
    const OrigArrayBuffer      = typeof ArrayBuffer === 'function' ? ArrayBuffer : null;
    const isArrayBufferView    = OrigArrayBuffer ? OrigArrayBuffer.isView : () => false;
    const OrigTextDecoder      = typeof TextDecoder === 'function' ? TextDecoder : null;
    const ProgressEvtCtor      = typeof ProgressEvent === 'function' ? ProgressEvent : OrigEvent;
    const CloseEvtCtor         = typeof CloseEvent === 'function' ? CloseEvent : null;
    const origSetTimeout       = window.setTimeout;

    const wmGet       = WeakMap.prototype.get;
    const wmSet       = WeakMap.prototype.set;
    const setHas      = Set.prototype.has;
    const setAdd      = Set.prototype.add;
    const setDel      = Set.prototype.delete;
    const mapGet      = Map.prototype.get;
    const mapSet      = Map.prototype.set;
    const mapDel      = Map.prototype.delete;
    const mapKeys     = Map.prototype.keys;
    const mapIterNext = Object.getPrototypeOf(new Map().keys()).next;

    const cloakedFns = new WeakMap();
    const noop       = () => {};

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

    function defineDescriptors(target, descs, fallback) {
        try {
            origDefineProperties(target, descs);
        } catch {
            const keys = origKeys(descs);
            for (let i = 0; i < keys.length; i++) {
                const prop = keys[i];
                try {
                    origDefineProperty(target, prop, descs[prop]);
                } catch {
                    if (fallback) {
                        try { origDefineProperty(fallback, prop, descs[prop]); } catch {}
                    }
                }
            }
        }
    }

    const DEBUG = false;
    const LOG   = DEBUG && typeof console !== 'undefined' && console.log
        ? console.log.bind(console, '%c[UL]', 'color:#00e5ff;font-weight:bold')
        : noop;
    const WARN  = DEBUG && typeof console !== 'undefined' && console.warn
        ? console.warn.bind(console, '[UL]')
        : noop;

    // Shared payload-matching & response synthesis
    const MAX_BODY_SCAN       = 65536;
    const LOG_IMPROPER_USE_RE = /logimproperuse/i;
    const MEDIA_BLOB_TYPE_RE  = /^(?:video|audio|image|font)\//i;
    const SYNTHETIC_OK_BODY   = '{"data":{"logImproperUse":true}}';
    const NO_CONTENT_INIT     = { status: 204, statusText: 'No Content' };
    const OK_RESPONSE_INIT    = {
        status: 200,
        statusText: 'OK',
        headers: { 'Content-Type': 'application/json' },
    };

    function syntheticOk() {
        return new OrigResponse(SYNTHETIC_OK_BODY, OK_RESPONSE_INIT);
    }

    function syntheticNoContent() {
        return new OrigResponse(null, NO_CONTENT_INIT);
    }

    function isImproperUseText(str) {
        const len = str.length;
        return len >= 14 && len <= MAX_BODY_SCAN && LOG_IMPROPER_USE_RE.test(str);
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
    const API_HOST          = 'web.uplearn.co.uk';
    const API_HOST_LEN      = API_HOST.length;
    const API_ORIGIN_PREFIX = 'https://' + API_HOST + '/';

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
    let hostKindCacheSize = 0;

    function classifyUrl(url) {
        const str = typeof url === 'string' ? url : toUrlString(url);
        const len = str.length;
        if (len === 0) return URL_OTHER;

        const firstCh = str.charCodeAt(0);
        if (firstCh === 47 && (len === 1 || str.charCodeAt(1) !== 47)) {
            return URL_TARGET_API;
        }

        let start = 0;
        if (firstCh === 104) { // 'h'
            if (str.startsWith(API_ORIGIN_PREFIX)) return URL_TARGET_API;
            if (str.startsWith('https://')) {
                start = 8;
            } else if (str.startsWith('http://')) {
                start = 7;
            }
        }

        if (start === 0) {
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
        }

        let end = start;
        let colon = -1;
        let inBracket = false;
        let hasUpper = false;
        for (; end < len; end++) {
            const c = str.charCodeAt(end);
            if (c === 47 || c === 63 || c === 35 || c === 92 || c <= 32) break; // / ? # \ or control/space
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

        if (hostLen === API_HOST_LEN && !hasUpper && str.startsWith(API_HOST, start)) {
            return URL_TARGET_API;
        }

        const rawHost = str.slice(start, end);
        const host = hasUpper ? rawHost.toLowerCase() : rawHost;
        if (hasUpper && hostLen === API_HOST_LEN && host === API_HOST) {
            return URL_TARGET_API;
        }

        let kind = mapGet.call(hostKindCache, host);
        if (kind !== undefined) return kind;

        kind = hostIsTelemetry(host) ? URL_TELEMETRY : URL_OTHER;
        if (hostKindCacheSize >= HOST_CACHE_MAX) {
            const oldest = mapIterNext.call(mapKeys.call(hostKindCache)).value;
            if (oldest !== undefined) {
                mapDel.call(hostKindCache, oldest);
                hostKindCacheSize--;
            }
        }
        mapSet.call(hostKindCache, host, kind);
        hostKindCacheSize++;
        return kind;
    }

    function isTelemetryUrl(url) {
        return classifyUrl(url) === URL_TELEMETRY;
    }

    // ============================================================
    // 2. DOM, SCRIPT, IFRAME, IMAGE & LINK TAG INTERCEPTION
    // ============================================================
    function hookElementProperty(proto, prop, tag) {
        const desc = proto && origGetOwnPropDesc(proto, prop);
        if (!desc || !desc.set) return;
        const origSet = desc.set;
        const sName = `set ${prop}`;
        origDefineProperty(proto, prop, {
            get: desc.get,
            set: cloak(({
                [sName](val) {
                    if (isTelemetryUrl(val)) {
                        if (DEBUG) LOG(`blocked <${tag}> ${prop}:`, val);
                        return;
                    }
                    return origSet.call(this, val);
                },
            })[sName]),
            configurable: true,
            enumerable: desc.enumerable,
        });
    }

    const HTMLImgProto = typeof HTMLImageElement !== 'undefined' ? HTMLImageElement.prototype : null;
    const ELEMENT_HOOKS = [
        [typeof HTMLScriptElement !== 'undefined' ? HTMLScriptElement.prototype : null, 'src',  'script'],
        [typeof HTMLIFrameElement !== 'undefined' ? HTMLIFrameElement.prototype : null, 'src',  'iframe'],
        [HTMLImgProto,                                                                  'src',  'img'],
        [typeof HTMLLinkElement   !== 'undefined' ? HTMLLinkElement.prototype   : null, 'href', 'link'],
    ];
    for (let i = 0; i < ELEMENT_HOOKS.length; i++) {
        hookElementProperty(ELEMENT_HOOKS[i][0], ELEMENT_HOOKS[i][1], ELEMENT_HOOKS[i][2]);
    }
    const ImageCtor = typeof Image === 'function' ? Image : window.Image;
    if (typeof ImageCtor === 'function' && ImageCtor.prototype && ImageCtor.prototype !== HTMLImgProto) {
        hookElementProperty(ImageCtor.prototype, 'src', 'img');
    }

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
                if (DEBUG) LOG(`blocked setAttribute(${name}):`, value);
                return;
            }
            return origSetAttribute.call(this, name, value);
        },
    }).setAttribute);

    // ============================================================
    // 3. WEB WORKER, BLOB & WEBSOCKET NEUTERING
    // ============================================================
    const TELEMETRY_CODE_RE = /openreplay|sentry|sessionReplay|replayUploader/i;
    const BLOB_TELEMETRY    = 1;
    const BLOB_IMPROPER_USE = 2;
    const BLOB_ALL_FLAGS    = BLOB_TELEMETRY | BLOB_IMPROPER_USE;

    const blobFlags         = new WeakMap();
    const telemetryBlobUrls = new Set();
    let hasTelemetryBlobs     = false;
    let hasImproperUseBlobs   = false;
    let telemetryBlobUrlCount = 0;

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
                    if (
                        hasTelemetryBlobs &&
                        obj &&
                        typeof obj === 'object' &&
                        ((wmGet.call(blobFlags, obj) || 0) & BLOB_TELEMETRY)
                    ) {
                        if (!setHas.call(telemetryBlobUrls, url)) {
                            setAdd.call(telemetryBlobUrls, url);
                            telemetryBlobUrlCount++;
                        }
                    }
                    return url;
                },
            }).createObjectURL);
        }

        if (origRevokeObjectURL) {
            URL.revokeObjectURL = cloak(({
                revokeObjectURL(url) {
                    if (telemetryBlobUrlCount > 0 && typeof url === 'string' && setDel.call(telemetryBlobUrls, url)) {
                        telemetryBlobUrlCount--;
                    }
                    return origRevokeObjectURL.call(this, url);
                },
            }).revokeObjectURL);
        }
    }

    function classifyBlobPart(part, isMediaType) {
        if (typeof part === 'string') {
            if (isMediaType) return 0;
            let flags = 0;
            const len = part.length;
            if (len >= 6 && len < 1e6 && TELEMETRY_CODE_RE.test(part)) {
                flags |= BLOB_TELEMETRY;
            }
            if (isImproperUseText(part)) {
                flags |= BLOB_IMPROPER_USE;
            }
            return flags;
        }
        if ((hasTelemetryBlobs || hasImproperUseBlobs) && part !== null && typeof part === 'object') {
            return wmGet.call(blobFlags, part) || 0;
        }
        return 0;
    }

    const OrigBlob = window.Blob;
    if (OrigBlob) {
        const PatchedBlob = patchConstructor(function Blob(blobParts = undefined, options = undefined) {
            if (!new.target) return OrigBlob();
            const argc = arguments.length;
            const blob = new.target === PatchedBlob
                ? (argc === 0 ? new OrigBlob() : argc === 1 ? new OrigBlob(blobParts) : new OrigBlob(blobParts, options))
                : reflectConstruct(OrigBlob, arguments, new.target);
            try {
                if (blobParts) {
                    const isMediaType = !!(options && typeof options.type === 'string' && MEDIA_BLOB_TYPE_RE.test(options.type));
                    if (!isMediaType || hasTelemetryBlobs || hasImproperUseBlobs) {
                        let flags = 0;
                        if (isArray(blobParts)) {
                            for (let i = 0, len = blobParts.length; i < len; i++) {
                                flags |= classifyBlobPart(blobParts[i], isMediaType);
                                if (flags === BLOB_ALL_FLAGS) break;
                            }
                        } else if (typeof blobParts[Symbol.iterator] === 'function') {
                            for (const part of blobParts) {
                                flags |= classifyBlobPart(part, isMediaType);
                                if (flags === BLOB_ALL_FLAGS) break;
                            }
                        }
                        if (flags !== 0) {
                            wmSet.call(blobFlags, blob, flags);
                            if (flags & BLOB_TELEMETRY) hasTelemetryBlobs = true;
                            if (flags & BLOB_IMPROPER_USE) hasImproperUseBlobs = true;
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
                (telemetryBlobUrlCount > 0 && setHas.call(telemetryBlobUrls, urlStr)) ||
                isTelemetryUrl(urlStr) ||
                (urlStr.startsWith('data:') && TELEMETRY_CODE_RE.test(urlStr))
            ) {
                if (DEBUG) LOG('blocked telemetry WebWorker:', urlStr);
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
                if (DEBUG) LOG('blocked WebSocket connection:', urlStr);
                const dummy = createDummyTarget(new.target, OrigWebSocket, WS_DUMMY_DESCS);
                origDefineProperty(dummy, 'url', {
                    value: urlStr,
                    writable: true,
                    configurable: true,
                });
                origSetTimeout.call(window, () => {
                    if (dummy.readyState === 3) return;
                    dummy.readyState = 3;
                    dispatchDummyWsEvent(dummy, new OrigEvent('error'), 'onerror');
                    const closeEvt = CloseEvtCtor
                        ? new CloseEvtCtor('close', { code: 1006, reason: 'Blocked' })
                        : new OrigEvent('close');
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
    let sharedTextDecoder = null;

    function bodyLooksLikeLogImproperUse(body) {
        if (typeof body === 'string') return isImproperUseText(body);
        if (!body || typeof body !== 'object') return false;
        if (hasImproperUseBlobs && ((wmGet.call(blobFlags, body) || 0) & BLOB_IMPROPER_USE)) {
            return true;
        }
        try {
            if (OrigURLSearchParams && body instanceof OrigURLSearchParams) {
                return isImproperUseText(body.toString());
            }
            if (isArrayBufferView(body) || (OrigArrayBuffer && body instanceof OrigArrayBuffer)) {
                if (body.byteLength > MAX_BODY_SCAN || !OrigTextDecoder) return false;
                sharedTextDecoder ||= new OrigTextDecoder();
                return isImproperUseText(sharedTextDecoder.decode(body));
            }
            if (OrigFormData && body instanceof OrigFormData) {
                for (const [key, val] of body) {
                    if (
                        (typeof key === 'string' && isImproperUseText(key)) ||
                        (typeof val === 'string' && isImproperUseText(val))
                    ) return true;
                }
            }
        } catch {}
        return false;
    }

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
                        if (DEBUG) LOG('blocked telemetry fetch:', input);
                        return OrigPromise.resolve(syntheticNoContent());
                    }

                    if (kind === URL_TARGET_API) {
                        const method = (init && init.method) || (typeof input === 'object' && input !== null ? input.method : undefined);
                        if (isPostMethod(method)) {
                            const hasInitBody = init != null && init.body !== undefined;
                            const body = hasInitBody ? init.body : null;
                            let asyncSource = null;

                            if (body != null) {
                                if (bodyLooksLikeLogImproperUse(body)) {
                                    if (DEBUG) LOG('dropped LogImproperUse (fetch)');
                                    return OrigPromise.resolve(syntheticOk());
                                }
                                if (
                                    typeof body === 'object' &&
                                    typeof body.text === 'function' &&
                                    !(typeof body.size === 'number' && body.size > MAX_BODY_SCAN) &&
                                    !(typeof body.type === 'string' && MEDIA_BLOB_TYPE_RE.test(body.type))
                                ) {
                                    asyncSource = body;
                                }
                            } else if (
                                !hasInitBody &&
                                OrigRequest &&
                                input instanceof OrigRequest &&
                                input.body != null &&
                                !input.bodyUsed &&
                                !shouldSkipRequestScan(input)
                            ) {
                                asyncSource = input.clone();
                            }

                            if (asyncSource !== null) {
                                return asyncSource.text().then(
                                    (text) => {
                                        if (isImproperUseText(text)) {
                                            if (DEBUG) LOG('dropped LogImproperUse (async fetch body)');
                                            return syntheticOk();
                                        }
                                        return origFetch.call(this, input, init);
                                    },
                                    () => origFetch.call(this, input, init)
                                );
                            }
                        }
                    }
                } catch (e) {
                    if (DEBUG) WARN('fetch interceptor error:', e);
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
        const SPOOFED_XHR_KEYS  = origKeys(XHR_OK_DESCS);

        function spoofXhr(xhr, st, descs) {
            const seq = ++st.seq;
            origSetTimeout.call(window, () => {
                if (st.seq !== seq) return;
                st.spoofed = true;
                try {
                    origDefineProperties(xhr, descs);
                    xhr.dispatchEvent(new OrigEvent('readystatechange'));
                    xhr.dispatchEvent(new ProgressEvtCtor('load'));
                    xhr.dispatchEvent(new ProgressEvtCtor('loadend'));
                } catch {}
            }, 0);
        }

        OrigXHR.prototype.open = cloak(({
            open(method, url) {
                const urlStr = toUrlString(url);
                const kind   = classifyUrl(urlStr);
                const isPost = kind === URL_TARGET_API && isPostMethod(method);
                const st     = wmGet.call(xhrState, this);

                if (st) {
                    if (st.spoofed) {
                        st.spoofed = false;
                        for (let i = 0; i < SPOOFED_XHR_KEYS.length; i++) {
                            delete this[SPOOFED_XHR_KEYS[i]];
                        }
                    }
                    st.url    = urlStr;
                    st.kind   = kind;
                    st.isPost = isPost;
                    st.seq++;
                } else if (kind === URL_TELEMETRY || isPost) {
                    wmSet.call(xhrState, this, { url: urlStr, kind, isPost, seq: 1, spoofed: false });
                }

                const argc = arguments.length;
                if (argc === 2) return origOpen.call(this, method, url);
                if (argc === 3) return origOpen.call(this, method, url, arguments[2]);
                return reflectApply(origOpen, this, arguments);
            },
        }).open);

        OrigXHR.prototype.send = cloak(({
            send(body = undefined) {
                try {
                    const st = wmGet.call(xhrState, this);
                    if (st) {
                        if (st.kind === URL_TELEMETRY) {
                            if (DEBUG) LOG('blocked telemetry xhr:', st.url);
                            spoofXhr(this, st, XHR_BLOCKED_DESCS);
                            return;
                        }
                        if (st.isPost && bodyLooksLikeLogImproperUse(body)) {
                            if (DEBUG) LOG('dropped LogImproperUse (xhr)');
                            spoofXhr(this, st, XHR_OK_DESCS);
                            return;
                        }
                    }
                } catch (e) {
                    if (DEBUG) WARN('xhr interceptor error:', e);
                }
                return origSend.call(this, body);
            },
        }).send);

        if (origAbort) {
            OrigXHR.prototype.abort = cloak(({
                abort() {
                    const st = wmGet.call(xhrState, this);
                    if (st) st.seq++;
                    return origAbort.call(this);
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
                        if (DEBUG) LOG('blocked sendBeacon:', url);
                        return true;
                    }
                    if (kind === URL_TARGET_API && data != null && bodyLooksLikeLogImproperUse(data)) {
                        if (DEBUG) LOG('dropped LogImproperUse (sendBeacon)');
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

    defineDescriptors(docTarget, docSpoofDescs, docTarget !== document ? document : null);
    if (docTarget !== document) {
        const docKeys = origKeys(docSpoofDescs);
        for (let i = 0; i < docKeys.length; i++) {
            const prop = docKeys[i];
            const desc = docSpoofDescs[prop];
            if (origGetOwnPropDesc(document, prop)) {
                try { origDefineProperty(document, prop, desc); } catch {}
            }
            if (HtmlDocProto && origGetOwnPropDesc(HtmlDocProto, prop)) {
                try { origDefineProperty(HtmlDocProto, prop, desc); } catch {}
            }
        }
    }
    defineDescriptors(window, winSpoofDescs, null);

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
                    const p = OrigPromise.reject(new OrigDOMException('Fullscreen blocked', 'NotAllowedError'));
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

    const winDesc = origGetOwnPropDesc(window, 'window');
    const rawWin  = (winDesc && winDesc.value) || window;

    if (EventTargetProto && typeof EventTargetProto.addEventListener === 'function') {
        const origProtoAdd = EventTargetProto.addEventListener;

        const patchedAddEventListener = cloak(({
            addEventListener(type, listener, options = undefined) {
                if (
                    (this === document || this === window || this === rawWin || this == null) &&
                    setHas.call(SUPPRESSED_EVENTS, type)
                ) {
                    return;
                }
                const argc = arguments.length;
                if (argc >= 2) return origProtoAdd.call(this, type, listener, options);
                return argc === 1 ? origProtoAdd.call(this, type) : origProtoAdd.call(this);
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

        defineAddEventListener(EventTargetProto, null);
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
                e.target !== document &&
                e.target !== rawWin
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
    }

    // ============================================================
    // 6. PROPERTY PROTECTION & MONITORING
    // ============================================================
    function getProtectedSet(target) {
        if (!target || typeof target !== 'object') return null;
        if (target === document || target === DocProto || target === HtmlDocProto) return PROTECTED_DOC_PROPS;
        if (target === window || target === WinProto || target === rawWin) return PROTECTED_WIN_PROPS;
        if (target === EventTargetProto) return PROTECTED_ET_PROPS;
        return null;
    }

    function isProtectedProp(target, prop) {
        const set = getProtectedSet(target);
        if (set === null) return false;
        const key = typeof prop === 'string' || typeof prop === 'symbol' ? prop : String(prop);
        return setHas.call(set, key);
    }

    Object.defineProperty = cloak(({
        defineProperty(target, prop, descriptor) {
            if (isProtectedProp(target, prop)) return target;
            return origDefineProperty(target, prop, descriptor);
        },
    }).defineProperty);

    Object.defineProperties = cloak(({
        defineProperties(target, props) {
            const set = props != null ? getProtectedSet(target) : null;
            if (set !== null) {
                const obj = Object(props);
                const keys = reflectOwnKeys(obj);
                let safeProps = null;
                for (let i = 0; i < keys.length; i++) {
                    const key = keys[i];
                    if (setHas.call(set, key)) {
                        if (safeProps === null) {
                            safeProps = origCreate(null);
                            for (let j = 0; j < i; j++) {
                                const prevKey = keys[j];
                                const d = origGetOwnPropDesc(obj, prevKey);
                                if (d && d.enumerable) safeProps[prevKey] = obj[prevKey];
                            }
                        }
                    } else if (safeProps !== null) {
                        const d = origGetOwnPropDesc(obj, key);
                        if (d && d.enumerable) safeProps[key] = obj[key];
                    }
                }
                if (safeProps !== null) {
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
                if (isProtectedProp(target, prop)) return true;
                return origReflectDefineProperty(target, prop, descriptor);
            },
        }).defineProperty);
    }

    if (DEBUG) LOG('=== READY | telemetry: blocked | workers: neutered | fullscreen: disabled | tab-switch: blocked ===');
})();
