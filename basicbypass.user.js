// ==UserScript==
// @name         UpLearn Telemetry + Fullscreen + Tab-Switch Blocker (Optimised)
// @namespace    https://github.com/local/uplearn-blocker
// @version      1.4.0
// @description  Blocks telemetry, third-party trackers, WebWorker beacons, auto-fullscreen, and tab-switch/blur detection.
// @author       you
// @match        https://web.uplearn.co.uk/*
// @run-at       document-start
// @grant        none
// @inject-into  page
// @webRequest   [{"selector":"*://*jitsu.uplearn.co.uk/*","action":"cancel"},{"selector":"*://*jitsu.com/*","action":"cancel"},{"selector":"*://*openreplay.uplearn.co.uk/*","action":"cancel"},{"selector":"*://*sentry.io/*","action":"cancel"},{"selector":"*://*cloudflareinsights.com/*","action":"cancel"},{"selector":"*://*intercom.io/*","action":"cancel"},{"selector":"*://*intercomcdn.com/*","action":"cancel"},{"selector":"*://*googletagmanager.com/*","action":"cancel"},{"selector":"*://*google-analytics.com/*","action":"cancel"},{"selector":"*://*analytics.google.com/*","action":"cancel"},{"selector":"*://*googleadservices.com/*","action":"cancel"},{"selector":"*://*doubleclick.net/*","action":"cancel"},{"selector":"*://*facebook.net/*","action":"cancel"},{"selector":"*://*sc-static.net/*","action":"cancel"},{"selector":"*://*bat.bing.com/*","action":"cancel"},{"selector":"*://*clarity.ms/*","action":"cancel"},{"selector":"*://*bzrcdn.openai.com/*","action":"cancel"},{"selector":"*://*posthog.com/*","action":"cancel"},{"selector":"*://*fullstory.com/*","action":"cancel"},{"selector":"*://*hotjar.com/*","action":"cancel"},{"selector":"*://*mixpanel.com/*","action":"cancel"},{"selector":"*://*segment.io/*","action":"cancel"},{"selector":"*://*amplitude.com/*","action":"cancel"}]
// ==/UserScript==

(function () {
    'use strict';

    // ============================================================
    // CORE HELPERS
    // ============================================================
    const DEBUG = false;

    function noop() {}
    function returnVisible() { return 'visible'; }
    function returnFalse() { return false; }
    function returnTrue() { return true; }

    // bind() means no per-call string building and no lookups when DEBUG is off
    const LOG  = DEBUG ? console.log.bind(console, '%c[UL]', 'color:#00e5ff;font-weight:bold') : noop;
    const WARN = DEBUG ? console.warn.bind(console, '[UL]') : noop;

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

    cloak(noop, 'noop');
    cloak(returnVisible, 'get');
    cloak(returnFalse, 'get');
    cloak(returnTrue, 'hasFocus');

    // Capture natives BEFORE we patch them. These ignore `this`, so they can be called directly.
    const origDefineProperty   = Object.defineProperty;
    const origDefineProperties = Object.defineProperties;
    const origReflectDefine    = Reflect.defineProperty;
    const DocProto             = Document.prototype;

    // Synthetic responses for dropped calls
    const SYNTHETIC_OK_JSON = { data: { logImproperUse: true } };
    const SYNTHETIC_OK_BODY = JSON.stringify(SYNTHETIC_OK_JSON);
    const OK_INIT           = { status: 200, statusText: 'OK', headers: { 'Content-Type': 'application/json' } };
    const NO_CONTENT_INIT   = { status: 204, statusText: 'No Content' };

    const syntheticOk        = () => new Response(SYNTHETIC_OK_BODY, OK_INIT);
    const syntheticNoContent = () => new Response(null, NO_CONTENT_INIT);

    const isPostMethod = (m) =>
        typeof m === 'string' && m.length === 4 && (m === 'POST' || m.toUpperCase() === 'POST');

    // Reusable dummy for blocked Worker/WebSocket constructors
    function makeDummy(newTarget, Orig, descs) {
        const dummy = new EventTarget();
        Object.setPrototypeOf(dummy, (newTarget && newTarget.prototype) || Orig.prototype);
        origDefineProperties(dummy, descs);
        return dummy;
    }

    // ============================================================
    // 1. TELEMETRY HOST MATCHING
    // ============================================================
    const API_HOST = 'web.uplearn.co.uk';

    // Suffix lookup: Set.has() on each parent domain beats a 20-way regex alternation
    const TELEMETRY_HOSTS = new Set([
        'jitsu.uplearn.co.uk', 'jitsu.com', 'openreplay.uplearn.co.uk', 'sentry.io',
        'cloudflareinsights.com', 'intercom.io', 'intercomcdn.com', 'googletagmanager.com',
        'google-analytics.com', 'analytics.google.com', 'googleadservices.com', 'doubleclick.net',
        'facebook.net', 'sc-static.net', 'bat.bing.com', 'clarity.ms', 'bzrcdn.openai.com',
        'fullstory.com', 'hotjar.com', 'mixpanel.com', 'segment.io', 'amplitude.com', 'posthog.com',
    ]);

    const hostVerdicts = new Map(); // hostname -> boolean (bounded)

    function hostIsTelemetry(host) {
        let v = hostVerdicts.get(host);
        if (v !== undefined) return v;
        v = false;
        for (let start = 0; ;) {
            if (TELEMETRY_HOSTS.has(start ? host.slice(start) : host)) { v = true; break; }
            const dot = host.indexOf('.', start);
            if (dot === -1) break;
            start = dot + 1;
        }
        if (hostVerdicts.size > 500) hostVerdicts.clear();
        hostVerdicts.set(host, v);
        return v;
    }

    const HOST_EXTRACT_RE = /^(?:[a-z0-9+.-]+:)?\/\/(?:[^@/?#]+@)?(\[[a-f0-9:]+\]|[^:/?#]+)/i;

    function stripDot(h) {
        return h.charCodeAt(h.length - 1) === 46 ? h.slice(0, -1) : h;
    }

    function getHostname(url) {
        const m = HOST_EXTRACT_RE.exec(url);
        return m ? stripDot(m[1].toLowerCase()) : '';
    }

    function isTelemetryUrl(url) {
        if (!url) return false;
        if (typeof url !== 'string') {
            const hn = url.hostname;
            if (typeof hn === 'string' && hn) return hostIsTelemetry(stripDot(hn.toLowerCase()));
            return isTelemetryUrl(String(url.url || url.href || url));
        }
        const c0 = url.charCodeAt(0);
        if (c0 === 47 && url.charCodeAt(1) !== 47) return false;   // /root-relative: same-origin
        if (c0 === 100 && url.startsWith('data:')) return false;   // data: URIs
        const host = getHostname(url);
        return host !== '' && hostIsTelemetry(host);
    }

    const SCHEME_OR_PROTO_REL_RE = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

    // True for same-origin relative URLs and absolute URLs on API_HOST
    function isTargetApi(u) {
        if (!u) return false;
        if (typeof u !== 'string') {
            if (typeof u.hostname === 'string') return u.hostname === API_HOST;
            u = String(u.url || u.href || u);
        }
        if (u.charCodeAt(0) === 47 && u.charCodeAt(1) !== 47) return true;
        if (!SCHEME_OR_PROTO_REL_RE.test(u)) return true;
        return getHostname(u) === API_HOST;
    }

    // ---- request body scanning (size-capped, case-sensitive substring) ----
    // 'ogImproperUse' matches both LogImproperUse and logImproperUse without a /i regex.
    const MARKER   = 'ogImproperUse';
    const MAX_SCAN = 65536; // telemetry payloads are tiny; never read big uploads
    let sharedDecoder = null;

    const textHasMarker = (s) => s.length <= MAX_SCAN && s.indexOf(MARKER) !== -1;

    function bodyHasMarker(body) {
        if (!body) return false;
        if (typeof body === 'string') return textHasMarker(body);
        try {
            if (body instanceof URLSearchParams) return textHasMarker(body.toString());
            if (ArrayBuffer.isView(body) || body instanceof ArrayBuffer) {
                if (body.byteLength > MAX_SCAN) return false;
                return textHasMarker((sharedDecoder || (sharedDecoder = new TextDecoder())).decode(body));
            }
            if (body instanceof FormData) {
                for (const [k, v] of body) {
                    if (k.indexOf(MARKER) !== -1 || (typeof v === 'string' && textHasMarker(v))) return true;
                }
            }
        } catch {}
        return false;
    }

    // ============================================================
    // 2. DOM TAG INTERCEPTION
    // ============================================================
    function hookElementProperty(proto, prop, tag) {
        const desc = proto && Object.getOwnPropertyDescriptor(proto, prop);
        if (!desc || !desc.set) return;
        const nativeSet = desc.set;
        origDefineProperty(proto, prop, {
            get: desc.get,
            set(val) {
                if (isTelemetryUrl(val)) {
                    LOG('blocked element', tag, prop, val);
                    return;
                }
                return nativeSet.call(this, val);
            },
            configurable: true,
            enumerable: desc.enumerable,
        });
    }

    hookElementProperty(HTMLScriptElement.prototype, 'src',  'script');
    hookElementProperty(HTMLIFrameElement.prototype, 'src',  'iframe');
    hookElementProperty(HTMLImageElement.prototype,  'src',  'img');
    hookElementProperty(HTMLLinkElement.prototype,   'href', 'link');

    // Case-insensitive "src" / "href" test with zero allocations
    // (setAttribute is one of the hottest calls on any framework-driven page)
    function isSrcOrHref(n) {
        const len = n.length;
        if (len === 3) {
            return (n.charCodeAt(0) | 32) === 115 && (n.charCodeAt(1) | 32) === 114 && (n.charCodeAt(2) | 32) === 99;
        }
        if (len === 4) {
            return (n.charCodeAt(0) | 32) === 104 && (n.charCodeAt(1) | 32) === 114 &&
                   (n.charCodeAt(2) | 32) === 101 && (n.charCodeAt(3) | 32) === 102;
        }
        return false;
    }

    const origSetAttribute = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function (name, value) {
        if (typeof name === 'string' && isSrcOrHref(name) && isTelemetryUrl(value)) {
            LOG('blocked setAttribute', name, value);
            return;
        }
        return origSetAttribute.apply(this, arguments);
    };
    cloak(Element.prototype.setAttribute, 'setAttribute');

    // ============================================================
    // 3. WEB WORKER & BLOB NEUTER
    // ============================================================
    const TELEMETRY_CODE_RE = /openreplay|sentry|sessionReplay|replayUploader/i;
    const telemetryBlobs    = new WeakSet();
    const telemetryBlobUrls = new Set();
    const isScriptType      = (t) => !t || t.indexOf('javascript') !== -1;

    const origCreateObjectURL = URL.createObjectURL;
    URL.createObjectURL = function (obj) {
        const url = origCreateObjectURL.apply(this, arguments);
        if (obj instanceof Blob) {
            if (telemetryBlobs.has(obj)) {
                telemetryBlobUrls.add(url);
            } else if (obj.size < 1e6 && isScriptType(obj.type)) {
                // Only read small, script-typed blobs (original read EVERY blob as text)
                obj.text().then((code) => {
                    if (TELEMETRY_CODE_RE.test(code)) telemetryBlobUrls.add(url);
                }, noop);
            }
        }
        return url;
    };
    cloak(URL.createObjectURL, 'createObjectURL');

    const OrigBlob = window.Blob;
    const PatchedBlob = function (parts, options) {
        if (!new.target) {
            throw new TypeError("Failed to construct 'Blob': Please use the 'new' operator");
        }
        const blob = Reflect.construct(OrigBlob, arguments, new.target);
        try {
            if (Array.isArray(parts) && isScriptType(options && options.type)) {
                for (let i = 0; i < parts.length; i++) {
                    const p = parts[i];
                    if (typeof p === 'string' && TELEMETRY_CODE_RE.test(p)) {
                        telemetryBlobs.add(blob);
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
                LOG('blocked telemetry WebWorker', urlStr);
                return makeDummy(new.target, OrigWorker, WORKER_DUMMY_DESCS);
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
                LOG('blocked WebSocket', url);
                const dummy = makeDummy(new.target, OrigWebSocket, WS_DUMMY_DESCS);
                origDefineProperty(dummy, 'url', { value: String(url), writable: true, configurable: true });
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
                    LOG('blocked telemetry fetch', input);
                    return Promise.resolve(syntheticNoContent());
                }

                const method = (init && init.method) || (input && input.method);
                if (isPostMethod(method) && isTargetApi(input)) {
                    const self = this, args = arguments;
                    const body = init ? init.body : null;
                    // Two-argument then(): if the real fetch rejects, we must NOT send it a second time
                    const decide = (text) => (textHasMarker(text) ? syntheticOk() : origFetch.apply(self, args));
                    const fallback = () => origFetch.apply(self, args);

                    if (body == null) {
                        if (input instanceof Request) {
                            return input.clone().text().then(decide, fallback);
                        }
                    } else if (body instanceof Blob) {
                        if (body.size <= MAX_SCAN) return body.text().then(decide, fallback);
                    } else if (bodyHasMarker(body)) {
                        LOG('dropped LogImproperUse (fetch)');
                        return Promise.resolve(syntheticOk());
                    }
                }
            } catch (e) {
                WARN('fetch interceptor error', e);
            }
            return origFetch.apply(this, arguments);
        };
        cloak(window.fetch, 'fetch');
    }

    const OrigXHR = window.XMLHttpRequest;
    if (OrigXHR) {
        const origOpen = OrigXHR.prototype.open;
        const origSend = OrigXHR.prototype.send;

        // Per-instance state lives in a WeakMap instead of expando properties on every XHR
        const xhrState = new WeakMap(); // xhr -> { method, url, seq, spoofed }

        const XHR_COMMON_DESCS = {
            getResponseHeader: {
                value: cloak(function (name) {
                    return String(name).toLowerCase() === 'content-type' ? 'application/json' : null;
                }, 'getResponseHeader'),
                configurable: true,
            },
            getAllResponseHeaders: {
                value: cloak(function () { return 'content-type: application/json\r\n'; }, 'getAllResponseHeaders'),
                configurable: true,
            },
            responseURL: {
                get: cloak(function () {
                    const s = xhrState.get(this);
                    return s && s.url != null ? String(s.url) : '';
                }, 'get responseURL'),
                configurable: true,
            },
        };

        const XHR_BLOCKED_DESCS = {
            readyState:   { value: 4, configurable: true },
            status:       { value: 204, configurable: true },
            statusText:   { value: 'No Content', configurable: true },
            responseText: { value: '', configurable: true },
            response:     { value: '', configurable: true },
            ...XHR_COMMON_DESCS,
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
            ...XHR_COMMON_DESCS,
        };

        const XHR_SPOOFED_KEYS = Object.keys(XHR_BLOCKED_DESCS);

        function spoofXhr(xhr, state, descs) {
            state.spoofed = true;
            const seq = ++state.seq;
            origDefineProperties(xhr, descs);
            setTimeout(() => {
                if (state.seq !== seq) return; // xhr was re-opened meanwhile
                try {
                    xhr.dispatchEvent(new Event('readystatechange'));
                    xhr.dispatchEvent(new Event('load'));
                    xhr.dispatchEvent(new Event('loadend'));
                } catch {}
            }, 0);
        }

        OrigXHR.prototype.open = function (method, url) {
            let s = xhrState.get(this);
            if (!s) xhrState.set(this, s = { method: '', url: '', seq: 0, spoofed: false });
            s.method = method;
            s.url = url;
            s.seq++;
            if (s.spoofed) {
                s.spoofed = false;
                for (let i = 0; i < XHR_SPOOFED_KEYS.length; i++) delete this[XHR_SPOOFED_KEYS[i]];
            }
            return origOpen.apply(this, arguments);
        };
        cloak(OrigXHR.prototype.open, 'open');

        OrigXHR.prototype.send = function (body) {
            const s = xhrState.get(this);
            if (s) {
                try {
                    if (isTelemetryUrl(s.url)) {
                        LOG('blocked telemetry xhr', s.url);
                        spoofXhr(this, s, XHR_BLOCKED_DESCS);
                        return;
                    }
                    if (isPostMethod(s.method) && isTargetApi(s.url) && bodyHasMarker(body)) {
                        LOG('dropped LogImproperUse (xhr)');
                        spoofXhr(this, s, XHR_OK_DESCS);
                        return;
                    }
                } catch (e) {
                    WARN('xhr interceptor error', e);
                }
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
                    LOG('blocked sendBeacon', url);
                    return true;
                }
                if (isTargetApi(url) && bodyHasMarker(data)) {
                    LOG('dropped LogImproperUse (sendBeacon)');
                    return true;
                }
            } catch {}
            return origBeacon.apply(navigator, arguments);
        };
        cloak(navigator.sendBeacon, 'sendBeacon');
    }

    // ============================================================
    // 6. FULLSCREEN BLOCKER
    // ============================================================
    // Patched on Document.prototype only: instance-level copies on `document` were redundant.
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
        'requestFullscreen', 'webkitRequestFullscreen', 'webkitRequestFullScreen',
        'mozRequestFullScreen', 'msRequestFullscreen',
    ];

    function installFullscreenBlocker() {
        try { origDefineProperties(DocProto, FULLSCREEN_DOC_DESCS); } catch {}
        const proto = Element.prototype;
        for (let i = 0; i < FS_METHODS.length; i++) {
            const m = FS_METHODS[i];
            try { origDefineProperty(proto, m, FS_METHOD_DESC); } catch { proto[m] = rejectFs; }
        }
    }
    installFullscreenBlocker();

    // ============================================================
    // 7. VISIBILITY / FOCUS SPOOFER & EVENT HANDLERS
    // ============================================================
    const VISIBILITY_DESCS = {
        visibilityState:       { get: returnVisible, set: noop, configurable: true },
        webkitVisibilityState: { get: returnVisible, set: noop, configurable: true },
        hidden:                { get: returnFalse,   set: noop, configurable: true },
        webkitHidden:          { get: returnFalse,   set: noop, configurable: true },
    };

    function patchVisibilityProps() {
        try {
            origDefineProperties(DocProto, VISIBILITY_DESCS);
            DocProto.hasFocus = returnTrue;
        } catch {}
    }
    patchVisibilityProps();

    const NULL_EVENT_HANDLER = {
        get: cloak(() => null, 'get'),
        set: cloak(noop, 'set'),
        configurable: true,
    };

    const SENSITIVE_EVENT_PROPS = [
        'onblur', 'onfocusout', 'onvisibilitychange', 'onpagehide', 'onfreeze',
        'onfullscreenchange', 'onwebkitfullscreenchange', 'onmozfullscreenchange',
        'onfullscreenerror', 'onwebkitfullscreenerror',
    ];

    for (const prop of SENSITIVE_EVENT_PROPS) {
        try {
            origDefineProperty(window, prop, NULL_EVENT_HANDLER);
            origDefineProperty(document, prop, NULL_EVENT_HANDLER);
        } catch {}
    }

    const SUPPRESSED_EVENTS = new Set([
        'visibilitychange', 'webkitvisibilitychange', 'blur', 'focusout', 'pagehide', 'freeze',
        'fullscreenchange', 'webkitfullscreenchange', 'mozfullscreenchange',
        'fullscreenerror', 'webkitfullscreenerror',
    ]);

    const origProtoAdd = EventTarget.prototype.addEventListener;

    // (original also reassigned window/document.addEventListener and resolved a "rawWin";
    //  both were no-ops, since window.window is an accessor and the prototype patch already covers them)
    const patchedAddEventListener = function (type, listener, options) {
        if (SUPPRESSED_EVENTS.has(type) && (this == null || this === window || this === document)) {
            return;
        }
        return origProtoAdd.apply(this, arguments);
    };
    cloak(patchedAddEventListener, 'addEventListener');
    try { EventTarget.prototype.addEventListener = patchedAddEventListener; } catch {}

    // Catches handlers wired up outside addEventListener (e.g. <body onblur="...">)
    const KILL = (e) => {
        if ((e.type === 'blur' || e.type === 'focusout') &&
            e.target && e.target !== window && e.target !== document) {
            return;
        }
        e.stopImmediatePropagation();
        e.stopPropagation();
    };

    for (const evt of SUPPRESSED_EVENTS) {
        try { origProtoAdd.call(window, evt, KILL, true); } catch {}
        try { origProtoAdd.call(document, evt, KILL, true); } catch {}
    }

    // ============================================================
    // 8. PROPERTY PROTECTION
    // ============================================================
    const PROTECTED_DOC_PROPS = new Set([
        'visibilityState', 'webkitVisibilityState', 'hidden', 'webkitHidden', 'hasFocus',
        'fullscreenEnabled', 'webkitFullscreenEnabled', 'mozFullScreenEnabled', 'msFullscreenEnabled',
        'fullscreenElement', 'webkitFullscreenElement', 'mozFullScreenElement', 'webkitIsFullScreen',
    ]);
    const PROTECTED_HANDLER_PROPS = new Set(SENSITIVE_EVENT_PROPS);

    // Object.defineProperty is called constantly by bundlers and frameworks, so exit on the
    // cheapest possible check (three pointer comparisons) before touching any Set.
    function isProtected(target, prop) {
        if (target !== document && target !== window && target !== DocProto) return false;
        if ((target === document || target === DocProto) && PROTECTED_DOC_PROPS.has(prop)) return true;
        return (target === window || target === document) && PROTECTED_HANDLER_PROPS.has(prop);
    }

    Object.defineProperty = function (target, prop, descriptor) {
        if (isProtected(target, prop)) return target;
        return origDefineProperty(target, prop, descriptor);
    };
    cloak(Object.defineProperty, 'defineProperty');

    Object.defineProperties = function (target, props) {
        // Original ran Object.keys() + built a copy on EVERY call, whatever the target
        if (props && typeof props === 'object' &&
            (target === document || target === window || target === DocProto)) {
            const safe = {};
            let filtered = false;
            for (const key of Object.keys(props)) {
                if (isProtected(target, key)) { filtered = true; continue; }
                safe[key] = props[key];
            }
            if (filtered) return origDefineProperties(target, safe);
        }
        return origDefineProperties(target, props);
    };
    cloak(Object.defineProperties, 'defineProperties');

    Reflect.defineProperty = function (target, prop, descriptor) {
        if (isProtected(target, prop)) return true;
        return origReflectDefine(target, prop, descriptor);
    };
    cloak(Reflect.defineProperty, 'defineProperty');

    // Safety net in case something still manages to undo the spoofing
    setInterval(() => {
        try {
            if (document.visibilityState !== 'visible' || document.hidden !== false || !document.hasFocus()) {
                patchVisibilityProps();
            }
            if (document.fullscreenEnabled !== false) installFullscreenBlocker();
        } catch {}
    }, 5000);

    LOG('=== READY ===');
})();
