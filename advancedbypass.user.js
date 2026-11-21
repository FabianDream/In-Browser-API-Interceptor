// ==UserScript==
// @name         UpLearn
// @namespace    https://github.com/local/uplearn-telemetry-blocker
// @version      4.0.0
// @description  hi
// @match        https://web.uplearn.co.uk/*
// @run-at       document-start
// @grant        none
// @inject-into  page
// @noframes
// @downloadURL  https://raw.githubusercontent.com/FabianDream/In-Browser-API-Interceptor/refs/heads/main/advancedbypass.user.js
// @updateURL    https://raw.githubusercontent.com/FabianDream/In-Browser-API-Interceptor/refs/heads/main/advancedbypass.user.js
//
// Note: @webRequest is intentionally omitted so runtime Telemetry presets and
// individual service toggles take effect immediately in Violentmonkey & Tampermonkey.
// ==/UserScript==

(function () {
    'use strict';

    // ============================================================
    // 1. CACHED PRIMORDIALS, NATIVE LISTENERS & STEALTH CLOAKING
    // ============================================================
    const origDefineProperty   = Object.defineProperty;
    const origDefineProperties = Object.defineProperties;
    const origGetOwnPropDesc   = Object.getOwnPropertyDescriptor;
    const origGetOwnPropNames  = Object.getOwnPropertyNames;
    const origGetPrototypeOf   = Object.getPrototypeOf;
    const origSetPrototypeOf   = Object.setPrototypeOf;
    const origToString         = Function.prototype.toString;
    const reflectApply         = Reflect.apply;
    const reflectConstruct     = Reflect.construct;
    const wmGet                = WeakMap.prototype.get;
    const wmSet                = WeakMap.prototype.set;
    const wsHas                = WeakSet.prototype.has;
    const wsAdd                = WeakSet.prototype.add;
    const setHas               = Set.prototype.has;
    const setAdd               = Set.prototype.add;
    const setDel               = Set.prototype.delete;
    const mapGet               = Map.prototype.get;
    const mapSet               = Map.prototype.set;
    const mapDel               = Map.prototype.delete;
    const mapKeys              = Map.prototype.keys;
    const sharedTextDecoder    = typeof TextDecoder !== 'undefined' ? new TextDecoder() : null;
    const sharedTextEncoder    = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;
    const rawWin               = (typeof unsafeWindow !== 'undefined' && unsafeWindow) || (window && window.window) || window;

    // Cache native URL blob methods before Section 8 patches URL.createObjectURL/revokeObjectURL
    const origCreateObjectURL  = (typeof URL !== 'undefined' && URL.createObjectURL) ? URL.createObjectURL : null;
    const origRevokeObjectURL  = (typeof URL !== 'undefined' && URL.revokeObjectURL) ? URL.revokeObjectURL : null;

    // Cache native EventTarget methods for internal listeners so spoofVisibility
    // never drops Glisse's own listeners, and export unified safe helpers.
    const origWinAdd           = window.addEventListener ? window.addEventListener.bind(window) : null;
    const origWinRemove        = window.removeEventListener ? window.removeEventListener.bind(window) : null;
    const origDocAdd           = document.addEventListener ? document.addEventListener.bind(document) : null;
    const origDocRemove        = document.removeEventListener ? document.removeEventListener.bind(document) : null;
    const origProtoAdd         = (typeof EventTarget !== 'undefined' && EventTarget.prototype && EventTarget.prototype.addEventListener)
        ? EventTarget.prototype.addEventListener
        : null;

    const safeWinAdd = origWinAdd || ((t, fn, o) => window.addEventListener(t, fn, o));
    const safeWinRem = origWinRemove || ((t, fn, o) => window.removeEventListener(t, fn, o));
    const safeDocAdd = origDocAdd || ((t, fn, o) => document.addEventListener(t, fn, o));
    const safeDocRem = origDocRemove || ((t, fn, o) => document.removeEventListener(t, fn, o));

    const cloakedFns = new WeakMap();

    function cloak(fn, name) {
        if (typeof fn === 'function') {
            wmSet.call(cloakedFns, fn, `function ${name || fn.name || ''}() { [native code] }`);
        }
        return fn;
    }

    function patchMethod(target, prop, fn, name, enumerable = true) {
        const cloaked = cloak(fn, name || prop);
        origDefineProperty(target, prop, {
            value: cloaked,
            writable: true,
            enumerable,
            configurable: true,
        });
        return cloaked;
    }

    function patchConstructor(Orig, Patched, name) {
        Patched.prototype = Orig.prototype;
        origSetPrototypeOf(Patched, Orig);
        try {
            origDefineProperty(Orig.prototype, 'constructor', {
                value: Patched,
                writable: true,
                enumerable: false,
                configurable: true,
            });
        } catch {}
        const staticProps = origGetOwnPropNames(Orig);
        for (let i = 0; i < staticProps.length; i++) {
            const prop = staticProps[i];
            if (prop === 'length' || prop === 'name' || prop === 'prototype' || prop === 'arguments' || prop === 'caller') continue;
            if (!origGetOwnPropDesc(Patched, prop)) {
                try {
                    const desc = origGetOwnPropDesc(Orig, prop);
                    if (desc) origDefineProperty(Patched, prop, desc);
                } catch {}
            }
        }
        return cloak(Patched, name);
    }

    const patchedToString = ({
        toString() {
            return (typeof this === 'function' && wmGet.call(cloakedFns, this)) || origToString.call(this);
        }
    }).toString;
    patchMethod(Function.prototype, 'toString', patchedToString, 'toString', false);

    // Preserve native console methods before installing any console filters
    const nativeConsole = {
        log:            console.log.bind(console),
        warn:           console.warn.bind(console),
        error:          console.error.bind(console),
        info:           console.info.bind(console),
        debug:          console.debug.bind(console),
        group:          console.group.bind(console),
        groupCollapsed: console.groupCollapsed.bind(console),
        groupEnd:       console.groupEnd.bind(console),
        trace:          console.trace.bind(console),
    };

    // ============================================================
    // 2. CONSTANTS, REGISTRY & CENTRALIZED STATE OBJECTS
    // ============================================================
    const API_HOST               = 'web.uplearn.co.uk';
    const SETTINGS_KEY           = 'uplearn_settings_v2';
    const LEGACY_BOOST_KEY       = 'uplearn_time_boost_enabled';
    const LEGACY_UI_KEY          = 'uplearn_time_boost_ui_visible';
    const WINDOW_POS_KEY         = '__ul_win_pos';
    const MANUAL_BUTTON_ID       = 'us-timespent-btn';
    const DARK_MODE_STYLE_ID     = '__ul-dark-styles';
    const VIDEO_OP               = 'CompleteVideoLesson';
    const MAX_SCAN               = 65536;
    const HOST_SERVICE_CACHE_MAX = 256;
    const QUESTION_REGISTRY_MAX  = 500;

    const TELEMETRY_SERVICES = {
        openreplay:      { label: 'OpenReplay',                     hosts: ['openreplay.uplearn.co.uk'] },
        jitsu:           { label: 'Jitsu',                          hosts: ['jitsu.uplearn.co.uk'] },
        sentry:          { label: 'Sentry',                         hosts: ['sentry.io'] },
        cloudflare:      { label: 'Cloudflare Insights',            hosts: ['cloudflareinsights.com'] },
        intercom:        { label: 'Intercom',                       hosts: ['intercom.io', 'intercomcdn.com'] },
        googleAnalytics: { label: 'Google Tag Manager / Analytics', hosts: ['googletagmanager.com', 'google-analytics.com', 'analytics.google.com', 'googleadservices.com', 'doubleclick.net'] },
        facebook:        { label: 'Facebook Pixel',                 hosts: ['facebook.net', 'facebook.com'] },
        snapchat:        { label: 'Snapchat',                       hosts: ['sc-static.net'] },
        bing:            { label: 'Bing',                           hosts: ['bat.bing.com'] },
        openai:          { label: 'OpenAI CDN',                     hosts: ['bzrcdn.openai.com'] },
        fullstory:       { label: 'FullStory',                      hosts: ['fullstory.com'] },
        hotjar:          { label: 'Hotjar',                         hosts: ['hotjar.com'] },
        mixpanel:        { label: 'Mixpanel',                       hosts: ['mixpanel.com'] },
        segment:         { label: 'Segment',                        hosts: ['segment.io'] },
        amplitude:       { label: 'Amplitude',                      hosts: ['amplitude.com'] },
        posthog:         { label: 'PostHog',                        hosts: ['posthog.com'] },
    };

    const HOST_SERVICE_MAP = new Map();
    for (const key in TELEMETRY_SERVICES) {
        const svc = TELEMETRY_SERVICES[key];
        const hosts = svc.hosts;
        for (let i = 0; i < hosts.length; i++) {
            const pattern = hosts[i].toLowerCase();
            mapSet.call(HOST_SERVICE_MAP, pattern, { key, label: svc.label, pattern });
        }
    }

    function buildDefaultTelemetryServices() {
        const o = {};
        for (const k in TELEMETRY_SERVICES) o[k] = true;
        return o;
    }

    const IS_MAC = /Mac|iPhone|iPad|iPod/i.test(
        (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || navigator.userAgent
    );

    const DEFAULT_KEYBIND = {
        code: IS_MAC ? 'MetaRight' : 'ControlRight',
        ctrl: false, shift: false, alt: false, meta: false,
    };

    const DEFAULT_SETTINGS = {
        telemetryPreset:             'harsh',
        telemetryServices:           buildDefaultTelemetryServices(),
        suppressJitsu:               true,   // true = block Jitsu, false = allow + log
        blockLogImproperUse:         true,
        blockLogEvent:               true,
        privateSearchMode:           true,
        spoofVisibility:             true,
        blockWebSockets:             true,
        blockSendBeacon:             true,
        blockDomElements:            true,
        suppressConsoleNoise:        true,
        timeBoostEnabled:            true,
        dynamicTimeEnabled:          true,
        predictFinalCallEnabled:     true,
        extraSecondsMin:             30,
        extraSecondsMax:             90,
        manualTimeButtonEnabled:     true,
        manualTimeStacksWithAuto:    false,
        fullVideoWatchedEnabled:     true,
        autoSkipVideoEnabled:        true,
        addVideoDurationToTimeSpent: true,
        disableAutoFullscreen:       true,
        darkMode:                    false,
        pillVisible:                 true,
        pillPosition:                'bottom-right',
        pillOpacity:                 1,
        pillMode:                    'minimal',
        theme:                       'dark',
        accentColor:                 '#007aff',
        logLevel:                    'normal',
        keybindAction:               'toggle-pill',
        draggableUI:                 false,
        uiToggleKeybind:             Object.assign({}, DEFAULT_KEYBIND),
    };

    const BOOLEAN_SETTING_KEYS = [
        'dynamicTimeEnabled',
        'predictFinalCallEnabled',
        'manualTimeButtonEnabled',
        'manualTimeStacksWithAuto',
        'fullVideoWatchedEnabled',
        'autoSkipVideoEnabled',
        'addVideoDurationToTimeSpent',
        'draggableUI',
    ];

    const PRESET_CONFIGS = {
        off: {
            services: false, suppressJitsu: false,
            blockLogImproperUse: false, blockLogEvent: false, privateSearchMode: false,
            spoofVisibility: false, blockWebSockets: false, blockSendBeacon: false,
            blockDomElements: false, suppressConsoleNoise: false,
        },
        simple: {
            services: false, suppressJitsu: false,
            blockLogImproperUse: true, blockLogEvent: true, privateSearchMode: true,
            spoofVisibility: false, blockWebSockets: false, blockSendBeacon: false,
            blockDomElements: false, suppressConsoleNoise: true,
        },
        harsh: {
            services: true, suppressJitsu: true,
            blockLogImproperUse: true, blockLogEvent: true, privateSearchMode: true,
            spoofVisibility: true, blockWebSockets: true, blockSendBeacon: true,
            blockDomElements: true, suppressConsoleNoise: true,
        },
    };

    // Derived directly from PRESET_CONFIGS to prevent metadata drift
    const PRESET_TELEMETRY_FLAGS        = Object.keys(PRESET_CONFIGS.harsh).filter((k) => k !== 'services');
    const PRESET_SYNC_KEYS              = ['telemetryPreset', ...PRESET_TELEMETRY_FLAGS];
    const INDIVIDUAL_TELEMETRY_SETTINGS = new Set(['telemetryServices', ...PRESET_TELEMETRY_FLAGS]);

    // Session metrics & reactive subscriber hub
    const stats = {
        apiPosts: 0, seen: 0, boosted: 0, blocked: 0,
        groupExtra: 0, fullscreenBlocked: 0, consoleSuppressed: 0,
        logImproperUseBlocked: 0, jitsuPackets: 0, manualBoosted: 0,
        videosMaxed: 0, videosSkipped: 0, videoTimeAdded: 0,
        finalCallsModified: 0, questionsIdentified: 0,
    };

    const statsListeners = new Set();
    function subscribeStats(fn) {
        statsListeners.add(fn);
        return () => statsListeners.delete(fn);
    }
    let statsNotifyScheduled = false;
    function notifyStatsChange() {
        if (statsNotifyScheduled || statsListeners.size === 0) return;
        statsNotifyScheduled = true;
        const deliver = () => {
            statsNotifyScheduled = false;
            for (const fn of statsListeners) {
                try { fn(stats); } catch {}
            }
        };
        if (typeof queueMicrotask === 'function') queueMicrotask(deliver);
        else setTimeout(deliver, 0);
    }
    function bumpStat(key, delta = 1) {
        stats[key] = (stats[key] || 0) + delta;
        notifyStatsChange();
    }

    // Structured runtime state objects (eliminates scattered globals & forward refs)
    const sessionState = {
        questionRegistry:           new Map(),
        questionAliasMap:           new Map(),
        knownLessonDurations:       new Map(),
        activeSession:              null,
        lastSubmittedQuestionId:    null,
        contextRevision:            0,
        accumulatedExtraSeconds:    0,
        accumulatedQuestionCount:   0,
        /**
         * Extra seconds queued to ADD on top of UpLearn's own timeSpent.
         *   null  -> user hasn't set anything (button shows "Add time")
         *   0     -> user explicitly set 0 (button shows "+0s")
         *   N > 0 -> user set N seconds (button shows "+Xm Ys")
         */
        queuedSeconds:              null,
        editing:                    false,
        resetScheduled:             false,
        pulseTimer:                 null,
        errorTimer:                 null,
        latestExamPaperData:        null,
        latestUserProfile:          null,
        latestFeatureFlags:         null,
        latestGlobalFeatureFlags:   null,
        latestQuizFeedback:         null,
        cachedContextSnapshot:      null,
        cachedContextRevision:      -1,
    };

    const videoState = {
        currentVideoLesson:         null,
        lastSkippedTarget:          null,
        autoSkipThrottled:          false,
        autoSkipThrottleTimer:      null,
        lastActiveVideoElement:     null,
        lastQuestionAnsweredAt:     0,
        waitingForPostAnswerResume: false,
        mediaListenersInstalled:    false,
    };

    const uiState = {
        hostEl:                     null,
        shadowRoot:                 null,
        containerEl:                null,
        pillEl:                     null,
        pillRefs:                   null,
        pillCleanup:                null,
        modalBackdropEl:            null,
        modalIsOpen:                false,
        modalIsClosing:             false,
        modalCloseTimer:            null,
        modalCleanupFns:            [],
        activeTab:                  'telemetry',
        tabPanels:                  {},
        tabBarApi:                  null,
        openMenuCount:              0,
        openMenuClosers:            new Set(),
        capturingKeybind:           false,
        domObserver:                null,
        domObserverConnected:       false,
        darkObserver:               null,
        darkObserverConnected:      false,
        lastResolvedSubmitBtn:      null,
        manualBtnTimer:             null,
        pillOpacityLogTimer:        null,
        bindings:                   {},
        statsUnsub:                 null,
        pillStatsUnsub:             null,
    };

    let publicApi = null;
    let applyingPreset = false;

    // ============================================================
    // 3. SETTINGS PERSISTENCE, CLONING & PRESETS
    // ============================================================
    function normalizeKeybind(kb) {
        if (!kb) return Object.assign({}, DEFAULT_KEYBIND);
        if (typeof kb === 'string') return { code: kb, ctrl: false, shift: false, alt: false, meta: false };
        if (typeof kb !== 'object') return Object.assign({}, DEFAULT_KEYBIND);
        return { code: kb.code || null, ctrl: !!kb.ctrl, shift: !!kb.shift, alt: !!kb.alt, meta: !!kb.meta };
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

    function loadSettings() {
        const s = Object.assign({}, DEFAULT_SETTINGS);
        s.telemetryServices = Object.assign({}, DEFAULT_SETTINGS.telemetryServices);

        try {
            const raw = localStorage.getItem(SETTINGS_KEY);
            if (raw) {
                const parsed = JSON.parse(raw);
                if (typeof parsed.extraSeconds === 'number') {
                    parsed.extraSecondsMin = parsed.extraSeconds;
                    parsed.extraSecondsMax = parsed.extraSeconds;
                    delete parsed.extraSeconds;
                }
                delete parsed.spoofFocus;
                delete parsed.suppressVisibilityEvents;
                delete parsed.boostQuizQuestions;
                delete parsed.boostGroupCompletion;
                delete parsed.showStats;

                if (parsed.telemetryServices && typeof parsed.telemetryServices === 'object') {
                    for (const k in TELEMETRY_SERVICES) {
                        if (!(k in parsed.telemetryServices)) parsed.telemetryServices[k] = true;
                    }
                }
                // Migration: old allowJitsu (true = allow) -> new suppressJitsu (true = block)
                if (typeof parsed.suppressJitsu !== 'boolean') {
                    parsed.suppressJitsu = typeof parsed.allowJitsu === 'boolean'
                        ? !parsed.allowJitsu
                        : DEFAULT_SETTINGS.suppressJitsu;
                }
                delete parsed.allowJitsu;

                for (let i = 0; i < BOOLEAN_SETTING_KEYS.length; i++) {
                    const key = BOOLEAN_SETTING_KEYS[i];
                    if (typeof parsed[key] !== 'boolean') {
                        parsed[key] = DEFAULT_SETTINGS[key];
                    }
                }

                Object.assign(s, parsed);
            } else {
                const b = localStorage.getItem(LEGACY_BOOST_KEY);
                if (b !== null) s.timeBoostEnabled = b === 'true';
                const u = localStorage.getItem(LEGACY_UI_KEY);
                if (u !== null) s.pillVisible = u === 'true';
            }
        } catch (e) { nativeConsole.warn('[UL] load settings failed', e); }

        if (s.telemetryPreset === 'harsh') {
            s.suppressJitsu = true;
            s.telemetryServices.jitsu = true;
        } else if (s.telemetryPreset === 'off' || s.telemetryPreset === 'simple') {
            s.suppressJitsu = false;
            s.telemetryServices.jitsu = false;
        } else {
            s.telemetryServices.jitsu = !!s.suppressJitsu;
        }

        s.telemetryServices = Object.assign({}, s.telemetryServices);
        normalizeRange(s);
        s.pillMode = s.pillMode || 'minimal';
        if (s.keybindAction !== 'toggle-pill' && s.keybindAction !== 'open-modal') {
            s.keybindAction = 'toggle-pill';
        }
        if (s.keybindAction === 'open-modal') {
            s.pillVisible = false;
        }
        s.uiToggleKeybind = normalizeKeybind(s.uiToggleKeybind);
        return s;
    }

    const settings = loadSettings();

    let saveSettingsTimer = null;
    function saveSettings(immediate = false) {
        if (immediate) {
            if (saveSettingsTimer) {
                clearTimeout(saveSettingsTimer);
                saveSettingsTimer = null;
            }
            try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch {}
            return;
        }
        if (!saveSettingsTimer) {
            saveSettingsTimer = setTimeout(() => {
                saveSettingsTimer = null;
                try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch {}
            }, 150);
        }
    }
    try {
        safeWinAdd('beforeunload', () => saveSettings(true));
        safeWinAdd('pagehide', () => saveSettings(true));
    } catch {}

    function applyTelemetryPreset(preset) {
        const cfg = PRESET_CONFIGS[preset];
        if (cfg) {
            const nextServices = Object.assign({}, settings.telemetryServices);
            for (const k in nextServices) nextServices[k] = cfg.services;
            settings.telemetryServices    = nextServices;
            settings.suppressJitsu        = cfg.suppressJitsu;
            settings.blockLogImproperUse  = cfg.blockLogImproperUse;
            settings.blockLogEvent        = cfg.blockLogEvent;
            settings.privateSearchMode    = cfg.privateSearchMode;
            settings.spoofVisibility      = cfg.spoofVisibility;
            settings.blockWebSockets      = cfg.blockWebSockets;
            settings.blockSendBeacon      = cfg.blockSendBeacon;
            settings.blockDomElements     = cfg.blockDomElements;
            settings.suppressConsoleNoise = cfg.suppressConsoleNoise;
        }
        settings.telemetryPreset = preset;
    }

    // ============================================================
    // 4. CONSOLE LOGGING & NOISE FILTER
    // ============================================================
    const CSS = {
        base:       'color:#00e5ff;font-weight:bold',
        verbose:    'color:#a78bfa;font-weight:bold',
        block:      'color:#f87171;font-weight:bold',
        improper:   'color:#f472b6;font-weight:bold',
        service:    'color:#fbbf24;font-weight:bold',
        jitsu:      'color:#22d3ee;font-weight:bold',
        url:        'color:#e2e8f0',
        muted:      'color:#94a3b8',
        dim:        'color:#64748b',
        ok:         'color:#4ade80;font-weight:bold',
        italic:     'color:#64748b;font-style:italic',
        body:       'color:#7dd3fc',
    };

    const LOG = (msg, ...rest) => {
        if (settings.logLevel === 'silent') return;
        nativeConsole.log('%c[UL] ' + msg, CSS.base, ...rest);
    };
    const WARN = (msg, ...rest) => {
        if (settings.logLevel === 'silent') return;
        nativeConsole.warn('[UL] ' + msg, ...rest);
    };
    const VLOG = (msg, ...rest) => {
        if (settings.logLevel !== 'verbose') return;
        nativeConsole.log('%c[UL · verbose] ' + msg, CSS.verbose, ...rest);
    };

    const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    const ALWAYS_NOISE_RE = (() => {
        const parts = ['\\[Sentry\\]'];
        for (const k in TELEMETRY_SERVICES) {
            if (k === 'jitsu') continue;
            for (const h of TELEMETRY_SERVICES[k].hosts) parts.push(escapeRegExp(h));
        }
        return new RegExp(parts.join('|'), 'i');
    })();

    const JITSU_NOISE_RE = (() => {
        const parts = [
            '\\[J-(?:ERROR|WARN|DEBUG|INFO|LOG)\\]',
            '\\[Jitsu\\]',
            'Failed to send data to',
            'Dropping queued event after',
            'max send attempts',
        ];
        for (const h of TELEMETRY_SERVICES.jitsu.hosts) parts.push(escapeRegExp(h));
        return new RegExp(parts.join('|'), 'i');
    })();

    const COMBINED_NOISE_RE = new RegExp(ALWAYS_NOISE_RE.source + '|' + JITSU_NOISE_RE.source, 'i');

    function textMatchesNoise(text) {
        if (typeof text !== 'string' || !text) return false;
        return settings.suppressJitsu ? COMBINED_NOISE_RE.test(text) : ALWAYS_NOISE_RE.test(text);
    }

    function argsAreNoise(args, startIndex = 0) {
        for (let i = startIndex; i < args.length; i++) {
            const a = args[i];
            if (typeof a === 'string') {
                if (textMatchesNoise(a)) return true;
            } else if (a instanceof Error) {
                if (a.message && textMatchesNoise(a.message)) return true;
            } else if (a && typeof a === 'object') {
                try {
                    if (typeof a.url     === 'string' && textMatchesNoise(a.url))     return true;
                    if (typeof a.message === 'string' && textMatchesNoise(a.message)) return true;
                } catch {}
            }
        }
        return false;
    }

    function installConsoleNoiseFilter() {
        const methods = ['log', 'warn', 'error', 'info', 'debug'];
        for (let m = 0; m < methods.length; m++) {
            const method = methods[m];
            const orig = nativeConsole[method];
            const wrapped = ({
                [method]() {
                    if (!settings.suppressConsoleNoise) {
                        return reflectApply(orig, console, arguments);
                    }
                    const len = arguments.length;
                    if (len === 0) return reflectApply(orig, console, arguments);
                    const first = arguments[0];
                    const firstIsString = typeof first === 'string';
                    if (firstIsString && textMatchesNoise(first)) {
                        bumpStat('consoleSuppressed');
                        return;
                    }
                    if (len === 1 && firstIsString) {
                        return reflectApply(orig, console, arguments);
                    }
                    if (argsAreNoise(arguments, firstIsString ? 1 : 0)) {
                        bumpStat('consoleSuppressed');
                        return;
                    }
                    return reflectApply(orig, console, arguments);
                }
            })[method];
            console[method] = cloak(wrapped, method);
        }
        VLOG('console noise filter installed (Jitsu / Apollo / Sentry / host matches)');
    }
    installConsoleNoiseFilter();

    // ============================================================
    // 5. URL & TELEMETRY SERVICE MATCHING
    // ============================================================
    const hostServiceCache = new Map();

    function toUrlString(url) {
        if (typeof url === 'string') return url;
        if (!url) return '';
        if (typeof url === 'object') {
            if (typeof url.href === 'string') return url.href;
            if (typeof url.url === 'string') return url.url;
        }
        try { return String(url); } catch { return ''; }
    }

    let lastLocHostRaw = '';
    let lastLocHostLower = API_HOST;
    function getPageHost() {
        if (typeof location !== 'undefined') {
            const raw = location.hostname;
            if (raw) {
                if (raw === lastLocHostRaw) return lastLocHostLower;
                lastLocHostRaw = raw;
                return (lastLocHostLower = raw.toLowerCase());
            }
        }
        return API_HOST;
    }

    function isValidSchemeSlice(s, start, end) {
        if (start >= end) return false;
        const c0 = s.charCodeAt(start);
        if (!((c0 >= 97 && c0 <= 122) || (c0 >= 65 && c0 <= 90))) return false;
        for (let i = start + 1; i < end; i++) {
            const c = s.charCodeAt(i);
            if (!(
                (c >= 97 && c <= 122) || (c >= 65 && c <= 90) ||
                (c >= 48 && c <= 57) || c === 43 || c === 45 || c === 46
            )) {
                return false;
            }
        }
        return true;
    }

    function hostOf(url) {
        const s = toUrlString(url);
        const len = s.length;
        if (len === 0) return '';

        let start = 0;
        if (s.charCodeAt(0) <= 32) {
            while (start < len && s.charCodeAt(start) <= 32) start++;
            if (start >= len) return '';
        }

        let authStart = -1;
        const c0 = s.charCodeAt(start);
        if (c0 === 47) { // '/'
            if (start + 1 < len && s.charCodeAt(start + 1) === 47) {
                authStart = start + 2;
            } else {
                return getPageHost();
            }
        } else if (c0 === 104 && s.startsWith('https://', start)) {
            authStart = start + 8;
        } else if (c0 === 104 && s.startsWith('http://', start)) {
            authStart = start + 7;
        } else {
            const colonIdx = s.indexOf(':', start);
            if (colonIdx === -1) return getPageHost();
            if (!isValidSchemeSlice(s, start, colonIdx)) return getPageHost();
            if (colonIdx + 2 < len && s.charCodeAt(colonIdx + 1) === 47 && s.charCodeAt(colonIdx + 2) === 47) {
                authStart = colonIdx + 3;
            } else {
                return '';
            }
        }

        let atIdx = -1;
        let authEnd = authStart;
        let firstColon = -1;
        let hasUpper = false;
        while (authEnd < len) {
            const c = s.charCodeAt(authEnd);
            if (c === 47 || c === 63 || c === 35) break; // '/', '?', '#'
            if (c === 64) { // '@'
                atIdx = authEnd;
                firstColon = -1;
                hasUpper = false;
            } else if (c === 58 && firstColon === -1) { // ':'
                firstColon = authEnd;
            } else if (c >= 65 && c <= 90) {
                hasUpper = true;
            }
            authEnd++;
        }

        const hostStart = atIdx !== -1 ? atIdx + 1 : authStart;
        if (hostStart >= authEnd) return '';

        // IPv6 literal [...]
        if (s.charCodeAt(hostStart) === 91) {
            const closeIdx = s.indexOf(']', hostStart + 1);
            if (closeIdx === -1 || closeIdx >= authEnd) return '';
            if (closeIdx + 1 < authEnd && s.charCodeAt(closeIdx + 1) !== 58) return '';
            const h6 = s.slice(hostStart, closeIdx + 1);
            return hasUpper ? h6.toLowerCase() : h6;
        }

        let hostEnd = firstColon !== -1 ? firstColon : authEnd;
        while (hostEnd > hostStart && s.charCodeAt(hostEnd - 1) === 46) {
            hostEnd--;
        }
        if (hostEnd <= hostStart) return '';
        const h = s.slice(hostStart, hostEnd);
        return hasUpper ? h.toLowerCase() : h;
    }

    function matchAnyTelemetryService(url) {
        if (!url) return null;
        if (typeof url === 'string') {
            const c0 = url.charCodeAt(0);
            if (c0 === 47 && url.charCodeAt(1) !== 47) return null;
            if (c0 === 35 || c0 === 63) return null;
            if (url.length >= 5 && url.charCodeAt(4) === 58) {
                const c0l = c0 | 32;
                if (
                    (c0l === 100 && (url.charCodeAt(1) | 32) === 97 && (url.charCodeAt(2) | 32) === 116 && (url.charCodeAt(3) | 32) === 97) ||
                    (c0l === 98 && (url.charCodeAt(1) | 32) === 108 && (url.charCodeAt(2) | 32) === 111 && (url.charCodeAt(3) | 32) === 98)
                ) {
                    return null;
                }
            }
        }
        const h = hostOf(url);
        if (!h) return null;
        if (h === API_HOST || h === getPageHost()) return null;

        const cached = mapGet.call(hostServiceCache, h);
        if (cached !== undefined) return cached;

        let found = null;
        let entry = mapGet.call(HOST_SERVICE_MAP, h);
        if (entry) {
            found = { key: entry.key, label: entry.label, host: h, pattern: entry.pattern };
        } else {
            let dotIdx = h.indexOf('.');
            while (dotIdx !== -1) {
                entry = mapGet.call(HOST_SERVICE_MAP, h.slice(dotIdx + 1));
                if (entry) {
                    found = { key: entry.key, label: entry.label, host: h, pattern: entry.pattern };
                    break;
                }
                dotIdx = h.indexOf('.', dotIdx + 1);
            }
        }

        if (hostServiceCache.size >= HOST_SERVICE_CACHE_MAX) {
            mapDel.call(hostServiceCache, mapKeys.call(hostServiceCache).next().value);
        }
        mapSet.call(hostServiceCache, h, found);
        return found;
    }

    function isServiceEnabledIn(cfg, key) {
        if (!cfg) return false;
        if (key === 'jitsu') {
            return !!(cfg.suppressJitsu && (!cfg.telemetryServices || cfg.telemetryServices.jitsu !== false));
        }
        return !!(cfg.telemetryServices && cfg.telemetryServices[key]);
    }

    function isServiceMatchBlocked(m) {
        return !!m && isServiceEnabledIn(settings, m.key);
    }

    function matchTelemetryService(url) {
        const m = matchAnyTelemetryService(url);
        return isServiceMatchBlocked(m) ? m : null;
    }

    function isTelemetryUrl(url) { return !!matchTelemetryService(url); }

    function isApiPathnameAt(s, pathStart, len) {
        if (pathStart < 0 || pathStart + 4 > len) return false;
        if (
            s.charCodeAt(pathStart) !== 47 ||
            s.charCodeAt(pathStart + 1) !== 97 ||
            s.charCodeAt(pathStart + 2) !== 112 ||
            s.charCodeAt(pathStart + 3) !== 105
        ) {
            return false;
        }
        const after = pathStart + 4;
        if (after === len) return true;
        const c = s.charCodeAt(after);
        if (c === 63 || c === 35) return true;
        if (c === 47) {
            if (after + 1 === len) return true;
            const c2 = s.charCodeAt(after + 1);
            return c2 === 63 || c2 === 35;
        }
        return false;
    }

    function isTargetApi(url) {
        const s = toUrlString(url);
        const len = s.length;
        if (len < 4) return false;
        if (
            s === '/api' ||
            s === '/api/' ||
            s === 'https://web.uplearn.co.uk/api' ||
            s === 'https://web.uplearn.co.uk/api/'
        ) {
            return true;
        }
        let start = 0;
        if (s.charCodeAt(0) <= 32) {
            while (start < len && s.charCodeAt(start) <= 32) start++;
            if (start + 4 > len) return false;
        }
        if (s.charCodeAt(start) === 47 && s.charCodeAt(start + 1) !== 47) {
            return isApiPathnameAt(s, start, len);
        }
        if (s.indexOf('/api', start) === -1) return false;
        if (start === 0 && s.startsWith('https://web.uplearn.co.uk/api')) {
            return isApiPathnameAt(s, 25, len);
        }
        if (hostOf(s) !== API_HOST) return false;

        let sep = -1;
        if (s.charCodeAt(start) === 47 && s.charCodeAt(start + 1) === 47) {
            sep = start + 2;
        } else {
            const proto = s.indexOf('://', start);
            if (proto !== -1) sep = proto + 3;
        }
        if (sep === -1) return false;

        let pathStart = -1;
        for (let i = sep; i < len; i++) {
            const c = s.charCodeAt(i);
            if (c === 47) { pathStart = i; break; }
            if (c === 63 || c === 35) return false;
        }
        return isApiPathnameAt(s, pathStart, len);
    }

    // ============================================================
    // 6. DIAGNOSTIC REPORTING & BOOT BANNER
    // ============================================================
    function truncateBody(b, max) {
        if (b == null) return null;
        if (typeof b !== 'string') return '(non-string body)';
        if (b.length <= max) return b;
        return b.slice(0, max) + `… [+${b.length - max} more chars]`;
    }

    function describeBody(data) {
        if (!data) return '';
        if (typeof data === 'string') return data;
        try {
            if (typeof FormData !== 'undefined' && data instanceof FormData) return '(FormData)';
            if (typeof URLSearchParams !== 'undefined' && data instanceof URLSearchParams) return data.toString();
            if (typeof Blob !== 'undefined' && data instanceof Blob) return `(Blob · ${data.size} bytes)`;
            if (typeof ArrayBuffer !== 'undefined' && (data instanceof ArrayBuffer || ArrayBuffer.isView(data))) return `(ArrayBuffer · ${data.byteLength || data.length} bytes)`;
            if (typeof Document !== 'undefined' && data instanceof Document) return '(Document)';
        } catch {}
        return `(${typeof data} body)`;
    }

    function reportBlock(kind, url, details, matchedSvc) {
        if (settings.logLevel === 'silent') return;
        const m = matchedSvc !== undefined ? matchedSvc : matchTelemetryService(url);
        const svcLabel = m ? m.label : 'unmatched';
        const host = m ? m.host : hostOf(url);

        let bodyPreview = null;
        if (details && details.body != null) {
            bodyPreview = truncateBody(details.body, settings.logLevel === 'verbose' ? 1200 : 120);
        }

        if (settings.logLevel === 'verbose') {
            nativeConsole.groupCollapsed(
                `%c🛡 BLOCKED%c ${kind}%c · ${svcLabel}%c · ${host}`,
                CSS.block, CSS.url, CSS.service, CSS.muted
            );
            nativeConsole.log('%cURL:    ', CSS.muted, url);
            nativeConsole.log('%cKind:   ', CSS.muted, kind);
            nativeConsole.log('%cService:', CSS.muted,
                m ? `${svcLabel}  (matched pattern "${m.pattern}")` : '(no enabled service matched)');
            nativeConsole.log('%cHost:   ', CSS.muted, host);
            if (details) {
                for (const k in details) {
                    if (k === 'body') continue;
                    nativeConsole.log('%c' + (k + ':').padEnd(9), CSS.muted, details[k]);
                }
            }
            if (bodyPreview) nativeConsole.log('%cBody:   ', CSS.body, bodyPreview);
            nativeConsole.log('%cTime:   ', CSS.muted, new Date().toLocaleTimeString());
            nativeConsole.trace('%c↳ call site', CSS.dim);
            nativeConsole.groupEnd();
        } else {
            const line = `%c[UL] 🛡 Blocked%c ${kind}%c → ${svcLabel}%c (${host})`;
            const args = [line, CSS.block, CSS.url, CSS.service, CSS.muted];
            if (bodyPreview) {
                args[0] += `%c · body: ${bodyPreview}`;
                args.push(CSS.body);
            }
            nativeConsole.log(...args);
        }
    }

    function reportJitsuPacket(source, url, body) {
        if (settings.logLevel === 'silent') return;
        const host = hostOf(url);
        const preview = truncateBody(body, settings.logLevel === 'verbose' ? 6000 : 2000);

        nativeConsole.groupCollapsed(
            `%c📡 JITSU PACKET%c · ${source}%c · ${host}`,
            CSS.jitsu, CSS.url, CSS.muted
        );
        nativeConsole.log('%cURL:     ', CSS.muted, url);
        nativeConsole.log('%cSource:  ', CSS.muted, source);
        nativeConsole.log('%cSuppress:', CSS.muted, settings.suppressJitsu ? 'ON (request will be blocked)' : 'OFF (request passes through)');
        if (preview) {
            nativeConsole.log('%cPayload: ', CSS.body, preview);
            try {
                const parsed = JSON.parse(body);
                nativeConsole.log('%cParsed:  ', CSS.body, parsed);
            } catch {}
        } else {
            nativeConsole.log('%cPayload: ', CSS.muted, '(no body captured)');
        }
        nativeConsole.log('%cTime:    ', CSS.muted, new Date().toLocaleTimeString());
        nativeConsole.groupEnd();
    }

    const OP_TYPE_RE = /^\s*(mutation|query|subscription)/i;

    function reportLogImproperUse(source, url, body) {
        bumpStat('logImproperUseBlocked');
        if (settings.logLevel === 'silent') return;

        let opName = 'LogImproperUse';
        let opType = '';
        let variableNames = [];

        if (settings.logLevel === 'verbose') {
            try {
                const parsed = JSON.parse(body);
                const target = Array.isArray(parsed) ? parsed[0] : parsed;
                if (target && typeof target === 'object') {
                    if (typeof target.operationName === 'string' && target.operationName) {
                        opName = target.operationName;
                    }
                    if (target.variables && typeof target.variables === 'object') {
                        variableNames = Object.keys(target.variables);
                    }
                    if (typeof target.query === 'string') {
                        const m = OP_TYPE_RE.exec(target.query);
                        if (m) opType = m[1].toLowerCase();
                    }
                }
            } catch {}
            if (!opType && typeof body === 'string') {
                const opTypeMatch = OP_TYPE_RE.exec(body);
                if (opTypeMatch) opType = opTypeMatch[1].toLowerCase();
            }
        }

        const bodyPreviewShort = truncateBody(body, 140);
        const bodyPreviewFull  = truncateBody(body, 2400);

        if (settings.logLevel === 'verbose') {
            nativeConsole.groupCollapsed(
                `%c🚫 LOGIMPROPERUSE BLOCKED%c · ${source}%c · ${opName}`,
                CSS.improper, CSS.url, CSS.service
            );
            nativeConsole.log('%cURL:       ', CSS.muted, url);
            nativeConsole.log('%cSource:    ', CSS.muted, source);
            nativeConsole.log('%cOperation: ', CSS.muted, opName + (opType ? ` (${opType})` : ''));
            if (variableNames.length) {
                nativeConsole.log('%cVariables: ', CSS.muted, variableNames.join(', '));
            }
            nativeConsole.log('%cResponse:  ', CSS.muted, '→ synthetic 200 OK  { data: { logImproperUse: true } }');
            nativeConsole.log('%cBody:      ', CSS.body, bodyPreviewFull);
            nativeConsole.log('%cTime:      ', CSS.muted, new Date().toLocaleTimeString());
            nativeConsole.trace('%c↳ call site', CSS.dim);
            nativeConsole.groupEnd();
        } else {
            nativeConsole.log(
                `%c[UL] 🚫 LOGIMPROPERUSE BLOCKED%c · ${source}%c · ${opName}%c · body: ${bodyPreviewShort}`,
                CSS.improper, CSS.url, CSS.service, CSS.body
            );
        }
    }

    function reportMockedMutation(badge, opLabel, responsePreview, source, url, body) {
        if (settings.logLevel === 'silent') return;
        if (settings.logLevel === 'verbose') {
            nativeConsole.groupCollapsed(
                `%c${badge}%c · ${source}%c · ${opLabel}`,
                CSS.improper, CSS.url, CSS.service
            );
            nativeConsole.log('%cURL:       ', CSS.muted, url);
            nativeConsole.log('%cResponse:  ', CSS.muted, responsePreview);
            nativeConsole.log('%cBody:      ', CSS.body, truncateBody(body, 2400));
            nativeConsole.groupEnd();
        } else {
            nativeConsole.log(
                `%c[UL] ${badge}%c · ${source}%c · ${opLabel}`,
                CSS.improper, CSS.url, CSS.service
            );
        }
    }

    function reportLogEvent(source, url, body) {
        reportMockedMutation(
            '🚫 LOGEVENT MOCKED',
            'LogEvent',
            '→ synthetic 200 OK  { data: { logEvent: { id: "mock" } } }',
            source, url, body
        );
    }

    function reportLogLessonSearch(source, url, body) {
        reportMockedMutation(
            '🔒 PRIVATE SEARCH MOCKED',
            'LogLessonSearch',
            '→ synthetic 200 OK  { data: { logVideoSearchRequest: { id: "mock" } } }',
            source, url, body
        );
    }

    function reportFeatureFlagsTransformed(source, url, strippedFlags) {
        if (settings.logLevel === 'silent') return;
        const flagList = (strippedFlags && strippedFlags.length)
            ? strippedFlags.join(', ')
            : 'course_activity_*';
        if (settings.logLevel === 'verbose') {
            nativeConsole.groupCollapsed(
                `%c🪟 WINDOWED MODE%c · Feature flags stripped%c · ${source}`,
                CSS.improper, CSS.url, CSS.service
            );
            nativeConsole.log('%cURL:       ', CSS.muted, url);
            nativeConsole.log('%cStripped:  ', CSS.muted, flagList);
            nativeConsole.log('%cResult:    ', CSS.muted, 'Activity session initializes without gated fullscreen/improper-use flags');
            nativeConsole.groupEnd();
        } else {
            nativeConsole.log(
                `%c[UL] 🪟 WINDOWED MODE%c · Feature flags stripped (${source}): ${flagList}`,
                CSS.improper, CSS.url
            );
        }
    }

    function reportAllow(kind, url, reason) {
        if (settings.logLevel !== 'verbose') return;
        nativeConsole.log(
            `%c[UL · verbose] ↩ Allowed%c ${kind}%c · ${url}%c · ${reason}`,
            CSS.ok, CSS.url, CSS.muted, CSS.italic
        );
    }

    // ============================================================
    // 7. DOM INJECTION BLOCKER & UNIFIED MUTATION OBSERVER
    // ============================================================
    function hookElementProperty(proto, prop, tag) {
        const desc = origGetOwnPropDesc(proto, prop);
        if (desc && desc.set) {
            const setterName = 'set ' + prop;
            const setter = ({
                [setterName](val) {
                    const anyM = (settings.blockDomElements || settings.logLevel === 'verbose') && val
                        ? matchAnyTelemetryService(val)
                        : null;
                    if (anyM) {
                        if (settings.blockDomElements && isServiceMatchBlocked(anyM)) {
                            bumpStat('blocked');
                            reportBlock(`<${tag}>.${prop} assignment`, toUrlString(val), { element: tag }, anyM);
                            return '';
                        }
                        if (settings.logLevel === 'verbose') {
                            if (!settings.telemetryServices[anyM.key]) {
                                reportAllow(`<${tag}>.${prop}`, toUrlString(val), `service "${anyM.label}" disabled`);
                            } else if (anyM.key === 'jitsu' && !settings.suppressJitsu) {
                                reportAllow(`<${tag}>.${prop}`, toUrlString(val), `service "${anyM.label}" not suppressed`);
                            }
                        }
                    }
                    if (arguments.length === 1) return desc.set.call(this, val);
                    return reflectApply(desc.set, this, arguments);
                }
            })[setterName];
            cloak(setter, setterName);
            origDefineProperty(proto, prop, {
                get: desc.get,
                set: setter,
                enumerable: desc.enumerable,
                configurable: true,
            });
        }
    }
    try { if (typeof HTMLScriptElement !== 'undefined') hookElementProperty(HTMLScriptElement.prototype, 'src',  'script'); } catch {}
    try { if (typeof HTMLIFrameElement !== 'undefined') hookElementProperty(HTMLIFrameElement.prototype, 'src',  'iframe'); } catch {}
    try { if (typeof HTMLImageElement  !== 'undefined') hookElementProperty(HTMLImageElement.prototype,  'src',  'img'); } catch {}
    try { if (typeof HTMLLinkElement   !== 'undefined') hookElementProperty(HTMLLinkElement.prototype,   'href', 'link'); } catch {}
    try {
        const OrigImage = window.Image;
        if (OrigImage && OrigImage.prototype && (typeof HTMLImageElement === 'undefined' || OrigImage.prototype !== HTMLImageElement.prototype)) {
            hookElementProperty(OrigImage.prototype, 'src', 'img');
        }
    } catch {}

    function isSrcOrHref(name) {
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

    try {
        const origSetAttribute = Element.prototype.setAttribute;
        const patchedSetAttribute = ({
            setAttribute(qualifiedName, value) {
                if (settings.blockDomElements && isSrcOrHref(qualifiedName)) {
                    const m = matchTelemetryService(value);
                    if (m) {
                        bumpStat('blocked');
                        reportBlock(`setAttribute("${qualifiedName}")`, toUrlString(value), {
                            element: this.tagName ? this.tagName.toLowerCase() : 'unknown',
                        }, m);
                        return;
                    }
                }
                if (arguments.length === 2) return origSetAttribute.call(this, qualifiedName, value);
                return reflectApply(origSetAttribute, this, arguments);
            }
        }).setAttribute;
        patchMethod(Element.prototype, 'setAttribute', patchedSetAttribute, 'setAttribute');
    } catch (e) { WARN('setAttribute patch failed', e); }

    function isRelevantQuestionMutationNode(node) {
        if (!node || node.nodeType !== 1) return false;
        if (node === uiState.hostEl) return false;
        const tid = node.id;
        if (tid === MANUAL_BUTTON_ID || (typeof tid === 'string' && tid.includes('__ul-'))) return false;

        const tag = node.tagName;
        if (tag === 'BUTTON' || tag === 'INPUT') return true;

        const role = typeof node.getAttribute === 'function' ? node.getAttribute('role') : null;
        if (role === 'button' || role === 'dialog') return true;

        const cls = typeof node.className === 'string' ? node.className : '';
        if (cls.includes('quiz') || cls.includes('question') || cls.includes('modal') || cls.includes('dialog')) return true;

        // Short-circuit on the first matching descendant without counting the full subtree.
        if (node.childElementCount > 0 && typeof node.querySelector === 'function') {
            if (node.querySelector('button, input') !== null) return true;
        }
        return false;
    }

    // Trailing debounce (~300ms) when no submit button is currently attached,
    // and prompt ~100ms sync when an attached button changes or is removed.
    function scheduleEnsureButton() {
        if (!settings.manualTimeButtonEnabled) return;
        const hasAttachedSubmit = !!(uiState.lastResolvedSubmitBtn && uiState.lastResolvedSubmitBtn.isConnected);
        if (uiState.manualBtnTimer !== null) {
            if (hasAttachedSubmit) return;
            clearTimeout(uiState.manualBtnTimer);
        }
        const delay = hasAttachedSubmit ? 100 : 300;
        uiState.manualBtnTimer = setTimeout(() => {
            uiState.manualBtnTimer = null;
            ensureButton();
        }, delay);
    }

    function syncDomObserver() {
        if (!uiState.domObserver) return;
        const shouldObserve = !!(settings.blockDomElements || settings.manualTimeButtonEnabled);
        if (shouldObserve && !uiState.domObserverConnected) {
            try {
                uiState.domObserver.observe(document.documentElement || document, { childList: true, subtree: true });
                uiState.domObserverConnected = true;
                VLOG('DOM observer connected');
            } catch (e) {
                WARN('DOM observer connect failed', e);
            }
        } else if (!shouldObserve && uiState.domObserverConnected) {
            try {
                uiState.domObserver.disconnect();
                uiState.domObserverConnected = false;
                VLOG('DOM observer disconnected');
            } catch (e) {
                WARN('DOM observer disconnect failed', e);
            }
        }
    }

    try {
        function checkAndBlockTelemetryElement(el) {
            const rawTag = el.tagName;
            if (rawTag === 'SCRIPT' || rawTag === 'IFRAME') {
                const src = el.src || (typeof el.getAttribute === 'function' ? el.getAttribute('src') : '');
                const m = matchTelemetryService(src);
                if (m) {
                    bumpStat('blocked');
                    const tag = rawTag.toLowerCase();
                    reportBlock(`DOM injection (<${tag}>)`, src, {
                        element: tag,
                        nodeId: el.id || '(none)',
                    }, m);
                    el.remove();
                    return true;
                }
            }
            return false;
        }

        uiState.domObserver = new MutationObserver((mutations) => {
            const blockDom = settings.blockDomElements;
            let needButtonCheck = settings.manualTimeButtonEnabled;
            if (!blockDom && !needButtonCheck) return;

            for (let i = 0; i < mutations.length; i++) {
                const m = mutations[i];
                if (m.type !== 'childList') continue;

                const added = m.addedNodes;
                for (let j = 0; j < added.length; j++) {
                    const node = added[j];
                    if (!node || node.nodeType !== 1 || node === uiState.hostEl || node.id === MANUAL_BUTTON_ID) continue;
                    const isHtmlNode = !node.namespaceURI || node.namespaceURI === 'http://www.w3.org/1999/xhtml';
                    if (!isHtmlNode) continue;

                    if (blockDom) {
                        if (!checkAndBlockTelemetryElement(node)) {
                            if (node.firstElementChild !== null && typeof node.getElementsByTagName === 'function') {
                                const iframes = node.getElementsByTagName('iframe');
                                for (let k = 0; k < iframes.length; k++) {
                                    checkAndBlockTelemetryElement(iframes[k]);
                                }
                            }
                        }
                    }

                    if (needButtonCheck && isRelevantQuestionMutationNode(node)) {
                        needButtonCheck = false;
                        scheduleEnsureButton();
                    }
                }

                if (needButtonCheck) {
                    const removed = m.removedNodes;
                    for (let j = 0; j < removed.length; j++) {
                        const node = removed[j];
                        if (!node || node.nodeType !== 1 || node === uiState.hostEl || node.id === MANUAL_BUTTON_ID) continue;
                        const isHtmlNode = !node.namespaceURI || node.namespaceURI === 'http://www.w3.org/1999/xhtml';
                        if (isHtmlNode && isRelevantQuestionMutationNode(node)) {
                            needButtonCheck = false;
                            scheduleEnsureButton();
                            break;
                        }
                    }
                }

                if (!blockDom && !needButtonCheck) break;
            }
        });
        syncDomObserver();
        VLOG('DOM observer installed');
    } catch (e) { WARN('DOM observer failed', e); }

    // ============================================================
    // 8. WEBSOCKET, BLOB & WEB WORKER BLOCKER
    // ============================================================
    const EVENT_TARGET_FALLBACK_DESCS = typeof EventTarget !== 'undefined' && EventTarget.prototype ? {
        addEventListener:    { value: EventTarget.prototype.addEventListener, writable: true, configurable: true },
        removeEventListener: { value: EventTarget.prototype.removeEventListener, writable: true, configurable: true },
        dispatchEvent:       { value: EventTarget.prototype.dispatchEvent, writable: true, configurable: true },
    } : null;

    function ensureDummyEventTarget(dummy) {
        if (typeof dummy.dispatchEvent !== 'function' && EVENT_TARGET_FALLBACK_DESCS) {
            origDefineProperties(dummy, EVENT_TARGET_FALLBACK_DESCS);
        }
    }

    try {
        const OrigWebSocket = window.WebSocket;
        if (OrigWebSocket) {
            const dummyWsSend = cloak(({ send() {} }).send, 'send');
            const dummyWsClose = cloak(({ close() {} }).close, 'close');
            const wsClosedState = OrigWebSocket.CLOSED !== undefined ? OrigWebSocket.CLOSED : 3;

            const PatchedWebSocket = function WebSocket(url, protocols = undefined) {
                if (!new.target) {
                    throw new TypeError("Failed to construct 'WebSocket': Please use the 'new' operator");
                }
                const urlStr = toUrlString(url);
                const wsMatch = settings.blockWebSockets ? matchTelemetryService(urlStr) : null;
                if (wsMatch) {
                    bumpStat('blocked');
                    reportBlock('WebSocket', urlStr, { protocols: protocols || '(none)' }, wsMatch);
                    const dummy = reflectConstruct(EventTarget, [], new.target || OrigWebSocket);
                    origDefineProperties(dummy, {
                        readyState:     { value: wsClosedState, enumerable: true, configurable: true },
                        url:            { value: urlStr, enumerable: true, configurable: true },
                        protocol:       { value: '', enumerable: true, configurable: true },
                        extensions:     { value: '', enumerable: true, configurable: true },
                        bufferedAmount: { value: 0, enumerable: true, configurable: true },
                        binaryType:     { value: 'blob', writable: true, enumerable: true, configurable: true },
                        send:           { value: dummyWsSend, writable: true, enumerable: true, configurable: true },
                        close:          { value: dummyWsClose, writable: true, enumerable: true, configurable: true },
                        onopen:         { value: null, writable: true, enumerable: true, configurable: true },
                        onerror:        { value: null, writable: true, enumerable: true, configurable: true },
                        onclose:        { value: null, writable: true, enumerable: true, configurable: true },
                        onmessage:      { value: null, writable: true, enumerable: true, configurable: true },
                    });
                    ensureDummyEventTarget(dummy);
                    setTimeout(() => {
                        try {
                            const errEv = new Event('error');
                            if (typeof dummy.onerror === 'function') {
                                try { dummy.onerror.call(dummy, errEv); } catch {}
                            }
                            dummy.dispatchEvent(errEv);
                            const closeEv = typeof CloseEvent !== 'undefined'
                                ? new CloseEvent('close', { code: 1006, reason: 'Blocked', wasClean: false })
                                : Object.assign(new Event('close'), { code: 1006, reason: 'Blocked', wasClean: false });
                            if (typeof dummy.onclose === 'function') {
                                try { dummy.onclose.call(dummy, closeEv); } catch {}
                            }
                            dummy.dispatchEvent(closeEv);
                        } catch {}
                    }, 0);
                    return dummy;
                }
                return reflectConstruct(OrigWebSocket, arguments, new.target);
            };

            window.WebSocket = patchConstructor(OrigWebSocket, PatchedWebSocket, 'WebSocket');
            VLOG('WebSocket hook installed');
        }
    } catch (e) { WARN('websocket patch failed', e); }

    const TELEMETRY_CODE_RE   = /openreplay|sentry|sessionReplay|replayUploader/i;
    const BINARY_BLOB_MIME_RE = /^(?:video|audio|image|font)\//i;
    const telemetryBlobUrls   = new Set();
    const telemetryBlobs      = new WeakSet();
    let hasTelemetryBlobs     = false;

    function isTelemetryBlobPart(part, scanText) {
        if (scanText && typeof part === 'string') {
            return TELEMETRY_CODE_RE.test(part);
        }
        if (hasTelemetryBlobs && part && typeof part === 'object') {
            return wsHas.call(telemetryBlobs, part);
        }
        return false;
    }

    function isTelemetryDataUrl(urlStr) {
        if (!urlStr || urlStr.length < 6) return false;
        if (
            (urlStr.charCodeAt(0) | 32) !== 100 ||
            (urlStr.charCodeAt(1) | 32) !== 97 ||
            (urlStr.charCodeAt(2) | 32) !== 116 ||
            (urlStr.charCodeAt(3) | 32) !== 97 ||
            urlStr.charCodeAt(4) !== 58
        ) {
            return false;
        }
        const commaIdx = urlStr.indexOf(',', 5);
        if (commaIdx === -1) return false;
        const meta = urlStr.slice(5, commaIdx);
        let payload = urlStr.slice(commaIdx + 1);
        if (/;base64/i.test(meta) && typeof atob === 'function') {
            if (payload.length <= 1048576) {
                try { payload = atob(payload); } catch { return false; }
            }
        } else {
            if (TELEMETRY_CODE_RE.test(payload)) return true;
            try { payload = decodeURIComponent(payload); } catch {}
        }
        return TELEMETRY_CODE_RE.test(payload);
    }

    try {
        if (origCreateObjectURL) {
            const patchedCreateObjectURL = ({
                createObjectURL(obj) {
                    const url = arguments.length === 1
                        ? origCreateObjectURL.call(this, obj)
                        : reflectApply(origCreateObjectURL, this, arguments);
                    if (hasTelemetryBlobs && obj && wsHas.call(telemetryBlobs, obj)) {
                        setAdd.call(telemetryBlobUrls, url);
                    }
                    return url;
                }
            }).createObjectURL;
            URL.createObjectURL = cloak(patchedCreateObjectURL, 'createObjectURL');
        }

        if (origRevokeObjectURL) {
            const patchedRevokeObjectURL = ({
                revokeObjectURL(url) {
                    if (url != null) setDel.call(telemetryBlobUrls, toUrlString(url));
                    if (arguments.length === 1) return origRevokeObjectURL.call(this, url);
                    return reflectApply(origRevokeObjectURL, this, arguments);
                }
            }).revokeObjectURL;
            URL.revokeObjectURL = cloak(patchedRevokeObjectURL, 'revokeObjectURL');
        }

        const OrigBlob = window.Blob;
        if (OrigBlob) {
            const PatchedBlob = function Blob(blobParts = undefined, options = undefined) {
                if (!new.target) {
                    throw new TypeError("Failed to construct 'Blob': Please use the 'new' operator");
                }
                const blob = reflectConstruct(OrigBlob, arguments, new.target);
                if (settings.telemetryPreset === 'off') return blob;
                try {
                    if (blobParts != null) {
                        const type = options && typeof options.type === 'string' ? options.type : '';
                        const scanText = blob.size < 1e6 &&
                            !BINARY_BLOB_MIME_RE.test(type) &&
                            (!type || type.includes('javascript') || type.includes('text'));
                        if (Array.isArray(blobParts)) {
                            for (let i = 0; i < blobParts.length; i++) {
                                if (isTelemetryBlobPart(blobParts[i], scanText)) {
                                    wsAdd.call(telemetryBlobs, blob);
                                    hasTelemetryBlobs = true;
                                    break;
                                }
                            }
                        } else if (typeof blobParts[Symbol.iterator] === 'function') {
                            for (const part of blobParts) {
                                if (isTelemetryBlobPart(part, scanText)) {
                                    wsAdd.call(telemetryBlobs, blob);
                                    hasTelemetryBlobs = true;
                                    break;
                                }
                            }
                        }
                    }
                } catch {}
                return blob;
            };
            window.Blob = patchConstructor(OrigBlob, PatchedBlob, 'Blob');
        }

        const OrigWorker = window.Worker;
        if (OrigWorker) {
            const dummyWorkerPost = cloak(({ postMessage() {} }).postMessage, 'postMessage');
            const dummyWorkerTerm = cloak(({ terminate() {} }).terminate, 'terminate');
            const WORKER_DUMMY_DESCS = {
                postMessage:    { value: dummyWorkerPost, writable: true, configurable: true },
                terminate:      { value: dummyWorkerTerm, writable: true, configurable: true },
                onerror:        { value: null, writable: true, configurable: true },
                onmessage:      { value: null, writable: true, configurable: true },
                onmessageerror: { value: null, writable: true, configurable: true },
            };

            const PatchedWorker = function Worker(scriptURL, options = undefined) {
                if (!new.target) {
                    throw new TypeError("Failed to construct 'Worker': Please use the 'new' operator");
                }
                const urlStr = toUrlString(scriptURL);
                if (
                    settings.telemetryPreset !== 'off' &&
                    (setHas.call(telemetryBlobUrls, urlStr) || isTelemetryUrl(urlStr) || isTelemetryDataUrl(urlStr))
                ) {
                    bumpStat('blocked');
                    reportBlock('WebWorker', urlStr);
                    const dummy = reflectConstruct(EventTarget, [], new.target || OrigWorker);
                    origDefineProperties(dummy, WORKER_DUMMY_DESCS);
                    ensureDummyEventTarget(dummy);
                    return dummy;
                }
                return reflectConstruct(OrigWorker, arguments, new.target);
            };
            window.Worker = patchConstructor(OrigWorker, PatchedWorker, 'Worker');
        }
    } catch (e) { WARN('worker/blob patch failed', e); }

    // ============================================================
    // 9. SOFT DARK MODE (AUTO-DISCONNECTING OBSERVER)
    // ============================================================
    const PARENT_INVERT      = 0.88;
    const CHILD_CONTRAST     = 1.3158;
    const DARK_BASE_COLOR    = '#1f1f1f';
    const DARK_PRE_INVERT_BG = '#ffffff';

    function ensureDarkModeStyles() {
        try {
            if (document.getElementById(DARK_MODE_STYLE_ID)) return;
            const root = document.head || document.documentElement;
            if (!root) return;
            const style = document.createElement('style');
            style.id = DARK_MODE_STYLE_ID;
            style.textContent = `
            html.ul-dark-mode,
            html.ul-dark-mode body { background-color: ${DARK_BASE_COLOR} !important; }
            html.ul-dark-mode #root {
                filter: invert(${PARENT_INVERT}) hue-rotate(180deg);
                background-color: ${DARK_PRE_INVERT_BG} !important;
                min-height: 100vh;
            }
            html.ul-dark-mode #root nav {
                filter: invert(1) hue-rotate(180deg) contrast(${CHILD_CONTRAST});
            }
            html.ul-dark-mode #root nav img,
            html.ul-dark-mode #root nav picture,
            html.ul-dark-mode #root nav video,
            html.ul-dark-mode #root nav iframe,
            html.ul-dark-mode #root nav canvas,
            html.ul-dark-mode #root nav embed,
            html.ul-dark-mode #root nav object,
            html.ul-dark-mode #root nav svg { filter: none; }
            html.ul-dark-mode #root img,
            html.ul-dark-mode #root video,
            html.ul-dark-mode #root picture,
            html.ul-dark-mode #root iframe,
            html.ul-dark-mode #root canvas,
            html.ul-dark-mode #root embed,
            html.ul-dark-mode #root object,
            html.ul-dark-mode #root svg[role="img"] {
                filter: invert(1) hue-rotate(180deg) contrast(${CHILD_CONTRAST});
            }
        `;
            root.appendChild(style);
        } catch {}
    }

    function syncDarkObserver() {
        if (!document.documentElement) return;
        if (settings.darkMode) {
            if (!uiState.darkObserver) {
                try {
                    uiState.darkObserver = new MutationObserver(applyDarkMode);
                } catch {
                    return;
                }
            }
            if (!uiState.darkObserverConnected) {
                try {
                    uiState.darkObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
                    uiState.darkObserverConnected = true;
                } catch {}
            }
        } else if (uiState.darkObserver && uiState.darkObserverConnected) {
            try {
                uiState.darkObserver.disconnect();
                uiState.darkObserverConnected = false;
            } catch {}
        }
    }

    function applyDarkMode() {
        try {
            const htmlEl = document.documentElement;
            if (!htmlEl) return;
            syncDarkObserver();
            if (settings.darkMode) ensureDarkModeStyles();
            const has = htmlEl.classList.contains('ul-dark-mode');
            if (settings.darkMode && !has) htmlEl.classList.add('ul-dark-mode');
            else if (!settings.darkMode && has) htmlEl.classList.remove('ul-dark-mode');
        } catch (e) { WARN('dark mode apply failed', e); }
    }

    if (settings.darkMode) ensureDarkModeStyles();
    applyDarkMode();

    // ============================================================
    // 10. SINGLE-PASS GRAPHQL OPERATION DISPATCH & SHARED PIPELINES
    // ============================================================
    const OP_NAME_HEAD_RE  = /"operationName"\s*:\s*"([^"]+)"/;
    const BLOCKED_OPS_RE   = /\b(logImproperUse|logEvent|logLessonSearch|logVideoSearchRequest)\b/i;
    const REQ_TRANSFORM_RE = /\b(?:GetFeatureFlags|GetFeatureFlagsEnabledGlobally|currentUser)\b/i;
    const REQ_INGEST_RE    = /\b(?:GetVideoLesson|GetProgressQuizGroup|GetStrengthenQuiz|GetSpacedPracticeQuizGroup|GetSubsectionDiagnosticQuiz|GetExamHowToLesson|GetExamPaper|GetExamPracticeSessionReview|GetExamQuestion|GetSubsectionSummary|GetSubsectionOverviewData|GetSubsectionActivity|GetCurrentActivityDetails|GetQuizContent|GetStandaloneQuestion|StartExamPracticeSession|AnswerProgressQuizQuestion|AnswerStrengthenQuizQuestion|AnswerSpacedPracticeQuizQuestion|AnswerDiagnosticQuestion|AnswerPreVideoQuestion|AnswerInVideoQuestion|AnswerExamQuestion|SaveExamQuestionMarks|SaveExamPracticeAnswers|SaveExamPracticeQuestionMarks|EvaluateQuizContentResponses|EvaluateStandaloneQuestionResponses|videoLesson|progressQuizGroup|spacedPracticeQuiz|strengthenQuiz|diagnosticQuiz|examHowToLesson|examPaper|examQuestion|subsection|quizContent|standaloneQuestion)\b/i;
    const TIME_SPENT_RE    = /timeSpent|completeVideoLesson|completeSubsectionSummary|completeArticleLesson|completeExamQuestionWalkthrough|completeProgressQuizGroup|completeStrengthenQuiz|completeSpacedPracticeQuiz|completeDiagnosticQuizSession|saveExamPractice|completeExamPracticeSession/i;

    // Consolidated single-pass dispatch table keyed by lowercased operationName.
    // Eliminates redundant full-body regex scans when operationName is known.
    const OP_DISPATCH = new Map([
        // Blocked mutations
        ['logimproperuse',                     { blockedKind: 'improper' }],
        ['logevent',                           { blockedKind: 'event' }],
        ['loglessonsearch',                    { blockedKind: 'search' }],
        ['logvideosearchrequest',              { blockedKind: 'search' }],

        // Response transform operations
        ['getfeatureflags',                    { reqKind: 'transform' }],
        ['getfeatureflagsenabledglobally',     { reqKind: 'transform' }],
        ['currentuser',                        { reqKind: 'transform' }],

        // Passive response ingest operations
        ['getvideolesson',                     { reqKind: 'ingest' }],
        ['getprogressquizgroup',               { reqKind: 'ingest' }],
        ['getstrengthenquiz',                  { reqKind: 'ingest' }],
        ['getspacedpracticequizgroup',         { reqKind: 'ingest' }],
        ['getsubsectiondiagnosticquiz',        { reqKind: 'ingest' }],
        ['getexamhowtolesson',                 { reqKind: 'ingest' }],
        ['getexampaper',                       { reqKind: 'ingest' }],
        ['getexampracticesessionreview',       { reqKind: 'ingest' }],
        ['getexamquestion',                    { reqKind: 'ingest' }],
        ['getsubsectionsummary',               { reqKind: 'ingest' }],
        ['getsubsectionoverviewdata',          { reqKind: 'ingest' }],
        ['getsubsectionactivity',              { reqKind: 'ingest' }],
        ['getcurrentactivitydetails',          { reqKind: 'ingest' }],
        ['getquizcontent',                     { reqKind: 'ingest' }],
        ['getstandalonequestion',              { reqKind: 'ingest' }],
        ['startexampracticesession',           { reqKind: 'ingest' }],
        ['videolesson',                        { reqKind: 'ingest' }],
        ['progressquizgroup',                  { reqKind: 'ingest' }],
        ['spacedpracticequiz',                 { reqKind: 'ingest' }],
        ['strengthenquiz',                     { reqKind: 'ingest' }],
        ['diagnosticquiz',                     { reqKind: 'ingest' }],
        ['examhowtolesson',                    { reqKind: 'ingest' }],
        ['exampaper',                          { reqKind: 'ingest' }],
        ['examquestion',                       { reqKind: 'ingest' }],
        ['subsection',                         { reqKind: 'ingest' }],
        ['quizcontent',                        { reqKind: 'ingest' }],
        ['standalonequestion',                 { reqKind: 'ingest' }],

        // Answer / marking operations (both ingest feedback & rewrite timeSpent)
        ['answerprogressquizquestion',         { reqKind: 'ingest', timeSpent: true }],
        ['answerstrengthenquizquestion',       { reqKind: 'ingest', timeSpent: true }],
        ['answerspacedpracticequizquestion',   { reqKind: 'ingest', timeSpent: true }],
        ['answerdiagnosticquestion',           { reqKind: 'ingest', timeSpent: true }],
        ['answerprevideoquestion',             { reqKind: 'ingest', timeSpent: true }],
        ['answerinvideoquestion',              { reqKind: 'ingest', timeSpent: true }],
        ['answerexamquestion',                 { reqKind: 'ingest', timeSpent: true }],
        ['saveexamquestionmarks',              { reqKind: 'ingest', timeSpent: true }],
        ['saveexampracticeanswers',            { reqKind: 'ingest', timeSpent: true }],
        ['saveexampracticequestionmarks',      { reqKind: 'ingest', timeSpent: true }],
        ['evaluatequizcontentresponses',       { reqKind: 'ingest', timeSpent: true }],
        ['evaluatestandalonequestionresponses', { reqKind: 'ingest', timeSpent: true }],

        // Lesson & session completion operations (rewrite timeSpent / percentWatched)
        ['completevideolesson',                { timeSpent: true }],
        ['completesubsectionsummary',          { timeSpent: true }],
        ['completearticlelesson',              { timeSpent: true }],
        ['completeexamquestionwalkthrough',    { timeSpent: true }],
        ['completeprogressquizgroup',          { timeSpent: true }],
        ['completestrengthenquiz',             { timeSpent: true }],
        ['completespacedpracticequiz',         { timeSpent: true }],
        ['completediagnosticquizsession',      { timeSpent: true }],
        ['saveexampractice',                   { timeSpent: true }],
        ['completeexampracticesession',        { timeSpent: true }],
    ]);

    function extractFastOperationName(body) {
        if (!body || typeof body !== 'string') return null;
        const len = body.length;
        let start = 0;
        while (start < len && body.charCodeAt(start) <= 32) start++;
        if (start >= len || body.charCodeAt(start) === 91) return null; // '[' batched array
        const head = body.slice(start, start + 256);
        const m = OP_NAME_HEAD_RE.exec(head);
        return m ? m[1] : null;
    }

    function extractSyncBodyText(data) {
        if (!data) return null;
        if (typeof data === 'string') return data.length <= MAX_SCAN ? data : null;
        try {
            if (typeof URLSearchParams !== 'undefined' && data instanceof URLSearchParams) {
                const s = data.toString();
                return s.length <= MAX_SCAN ? s : null;
            }
            if (sharedTextDecoder && typeof ArrayBuffer !== 'undefined' && (data instanceof ArrayBuffer || ArrayBuffer.isView(data))) {
                const byteLen = data.byteLength;
                if (typeof byteLen === 'number' && byteLen <= MAX_SCAN) {
                    return sharedTextDecoder.decode(data);
                }
                return null;
            }
        } catch {}
        return null;
    }

    function reencodeBodyLike(originalBody, newText) {
        const wasBuffer = typeof ArrayBuffer !== 'undefined' &&
            (originalBody instanceof ArrayBuffer || ArrayBuffer.isView(originalBody));
        return (wasBuffer && sharedTextEncoder) ? sharedTextEncoder.encode(newText) : newText;
    }

    const MOCKED_MUTATIONS = {
        improper: {
            name: 'LogImproperUse',
            payload: '{"data":{"logImproperUse":true}}',
            json: () => ({ data: { logImproperUse: true } }),
            shouldBlock: () => settings.blockLogImproperUse,
            report: reportLogImproperUse,
        },
        event: {
            name: 'LogEvent',
            payload: '{"data":{"logEvent":{"id":"mock"}}}',
            json: () => ({ data: { logEvent: { id: 'mock' } } }),
            shouldBlock: () => settings.blockLogEvent !== false,
            report: reportLogEvent,
        },
        search: {
            name: 'PrivateSearch',
            payload: '{"data":{"logVideoSearchRequest":{"id":"mock"},"logLessonSearch":{"id":"mock"}}}',
            json: () => ({
                data: {
                    logVideoSearchRequest: { id: 'mock' },
                    logLessonSearch: { id: 'mock' },
                },
            }),
            shouldBlock: () => settings.privateSearchMode !== false,
            report: reportLogLessonSearch,
        },
    };

    function getBlockedMutationKind(bodyText, dispatch) {
        if (dispatch) return dispatch.blockedKind || null;
        const m = BLOCKED_OPS_RE.exec(bodyText);
        if (!m) return null;
        const op = m[1].toLowerCase();
        if (op === 'logimproperuse') return 'improper';
        if (op === 'logevent') return 'event';
        if (op === 'loglessonsearch' || op === 'logvideosearchrequest') return 'search';
        return null;
    }

    function interceptBlockedMutation(body, url, source, fastOpName, dispatch) {
        const bodyText = extractSyncBodyText(body);
        if (!bodyText) return null;
        const resolvedDispatch = dispatch !== undefined
            ? dispatch
            : (fastOpName ? OP_DISPATCH.get(fastOpName.toLowerCase()) : null);
        const kind = getBlockedMutationKind(bodyText, resolvedDispatch);
        if (!kind) return null;
        const config = MOCKED_MUTATIONS[kind];
        if (!config || !config.shouldBlock()) return null;
        config.report(source, url, bodyText);
        bumpStat('blocked');
        return config;
    }

    function classifyApiRequest(body, dispatch) {
        if (!body || typeof body !== 'string' || body.length > MAX_SCAN) return 'none';
        if (dispatch) return dispatch.reqKind || 'none';
        if (REQ_TRANSFORM_RE.test(body)) return 'transform';
        if (REQ_INGEST_RE.test(body)) return 'ingest';
        return 'none';
    }

    // Feature Flags Response Transformer (gated on user settings)
    function isFlagStrippedBySettings(flagName) {
        if (flagName === 'course_activity_fullscreen_mode' || flagName === 'course_activity_fullscreen_exit_modal') {
            return !!settings.disableAutoFullscreen;
        }
        if (flagName === 'course_activity_record_improper_use') {
            return !!settings.blockLogImproperUse;
        }
        return false;
    }

    function shouldTransformFeatureFlags(text) {
        if (!settings.disableAutoFullscreen && !settings.blockLogImproperUse) return false;
        return typeof text === 'string' && text.includes('course_activity_');
    }

    function stripFullscreenFeatureFlags(obj, tracker) {
        if (!obj || typeof obj !== 'object') return obj;
        if (Array.isArray(obj)) {
            let writeIdx = 0;
            for (let i = 0; i < obj.length; i++) {
                const item = obj[i];
                if (typeof item === 'string' && isFlagStrippedBySettings(item)) {
                    if (tracker) {
                        tracker.stripped = true;
                        if (tracker.flags) tracker.flags.add(item);
                    }
                    continue;
                }
                if (item && typeof item === 'object') {
                    stripFullscreenFeatureFlags(item, tracker);
                }
                obj[writeIdx++] = item;
            }
            if (obj.length !== writeIdx && tracker) {
                tracker.stripped = true;
            }
            obj.length = writeIdx;
            return obj;
        }
        for (const k of Object.keys(obj)) {
            if (isFlagStrippedBySettings(k)) {
                delete obj[k];
                if (tracker) {
                    tracker.stripped = true;
                    if (tracker.flags) tracker.flags.add(k);
                }
            } else {
                const v = obj[k];
                if (v && typeof v === 'object') {
                    stripFullscreenFeatureFlags(v, tracker);
                }
            }
        }
        return obj;
    }

    const GRAPHQL_INGEST_RE = /\b(?:videoLessons?|answerInVideoQuestion|answerPreVideoQuestion|progressQuizGroup|answerProgressQuizQuestion|spacedPracticeQuiz|answerSpacedPracticeQuizQuestion|strengthenQuiz|diagnosticQuiz|answerDiagnosticQuestion|examHowToLesson|answerExamQuestion|saveExamQuestionMarks|examPaper|startExamPracticeSession|examPracticeSession|saveExamPracticeAnswers|saveExamPracticeQuestionMarks|examQuestion|quizContent|evaluateQuizContentResponses|standaloneQuestion|evaluateStandaloneQuestionResponses|subsection|experimentGroup|featureFlagsEnabledGlobally|featureFlags|currentUser)\b/;

    function shouldIngestGraphQLResponse(rt) {
        return typeof rt === 'string' && GRAPHQL_INGEST_RE.test(rt);
    }

    // Unified outgoing GraphQL request pipeline shared by fetch & XHR
    function processOutgoingApiPayload(bodyText, url, source) {
        const fastOp = extractFastOperationName(bodyText);
        const dispatch = fastOp ? (OP_DISPATCH.get(fastOp.toLowerCase()) || null) : null;
        const mocked = interceptBlockedMutation(bodyText, url, source, fastOp, dispatch);
        if (mocked) {
            return { blocked: true, mocked };
        }
        const reqKind = classifyApiRequest(bodyText, dispatch);
        const bumped = maybeBumpTimeSpent(bodyText, source, fastOp, dispatch);
        return {
            blocked: false,
            reqKind,
            body: bumped.body,
            changed: bumped.changed,
        };
    }

    // Shared parsed-payload ingest & conditional feature-flag transformer (fetch + XHR)
    function transformParsedApiPayload(parsed, reqKind, source, url, shouldIngest = true) {
        if (shouldIngest) handleApiResponse(parsed);
        if (reqKind === 'transform' && (settings.disableAutoFullscreen || settings.blockLogImproperUse)) {
            const tracker = { stripped: false, flags: new Set() };
            const modifiedJson = stripFullscreenFeatureFlags(parsed, tracker);
            if (tracker.stripped) {
                reportFeatureFlagsTransformed(source, url || 'API', Array.from(tracker.flags));
                return { transformed: true, json: modifiedJson };
            }
        }
        return { transformed: false, json: parsed };
    }

    // Unified incoming GraphQL response pipeline shared by fetch & XHR
    function processIncomingApiPayload(rt, reqKind, source, url) {
        const ingest = shouldIngestGraphQLResponse(rt);
        const transform = reqKind === 'transform' && shouldTransformFeatureFlags(rt);
        if (!ingest && !transform) {
            return { transformed: false, text: rt, json: null };
        }
        try {
            const parsed = JSON.parse(rt);
            const res = transformParsedApiPayload(parsed, transform ? 'transform' : 'none', source, url, ingest);
            if (res.transformed) {
                return {
                    transformed: true,
                    text: JSON.stringify(res.json),
                    json: res.json,
                };
            }
            return { transformed: false, text: rt, json: parsed };
        } catch (e) {
            if (transform) WARN(`Failed to transform feature flags response (${source}):`, e);
            return { transformed: false, text: rt, json: null };
        }
    }

    // ============================================================
    // 11. TIME BOOST, QUESTION ANALYZER & SESSION PREDICTOR
    // ============================================================
    const round3 = (n) => Math.round(n * 1000) / 1000;

    function toIso(seconds) {
        return 'PT' + round3(seconds) + 'S';
    }

    function formatSeconds(seconds) {
        seconds = round3(seconds);
        if (seconds < 60) return seconds + 's';
        const mm = Math.floor(seconds / 60);
        const ss = round3(seconds % 60);
        if (mm < 60) return `${mm}m ${ss}s`;
        const hh = Math.floor(mm / 60);
        return `${hh}h ${mm % 60}m ${ss}s`;
    }

    const ISO_DURATION_RE = /^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i;
    const COLON_TIME_RE   = /^\d+(?::[0-5]?\d){1,2}(?:\.\d+)?$/;
    const UNIT_TIME_RE    = /(\d+(?:\.\d+)?)\s*(hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)\b/gi;
    const BARE_NUM_RE     = /^\d+(\.\d+)?$/;

    function parseDurationToSeconds(raw) {
        if (raw == null) return null;
        if (typeof raw === 'number') {
            return isFinite(raw) ? raw : null;
        }
        const s = String(raw).trim();
        if (!s) return null;

        if (s.charCodeAt(0) === 80 || s.charCodeAt(0) === 112) {
            const m = ISO_DURATION_RE.exec(s);
            if (!m) return null;
            const d  = parseFloat(m[1] || 0);
            const h  = parseFloat(m[2] || 0);
            const mi = parseFloat(m[3] || 0);
            const se = parseFloat(m[4] || 0);
            return d * 86400 + h * 3600 + mi * 60 + se;
        }

        if (COLON_TIME_RE.test(s)) {
            const parts = s.split(':');
            let secs = 0;
            for (let i = 0; i < parts.length; i++) secs = secs * 60 + parseFloat(parts[i]);
            return secs;
        }

        UNIT_TIME_RE.lastIndex = 0;
        let total = 0;
        let matched = false;
        let m;
        while ((m = UNIT_TIME_RE.exec(s)) !== null) {
            matched = true;
            const value = parseFloat(m[1]);
            const c = m[2].charCodeAt(0) | 32;
            if (c === 104)      total += value * 3600;
            else if (c === 109) total += value * 60;
            else                total += value;
        }
        if (matched) return total;

        if (BARE_NUM_RE.test(s)) return parseFloat(s);
        return null;
    }

    function pickExtraSeconds() {
        const min = Math.min(settings.extraSecondsMin, settings.extraSecondsMax);
        const max = Math.max(settings.extraSecondsMin, settings.extraSecondsMax);
        if (min === max) return min;
        return Math.floor(min + Math.random() * (max - min + 1));
    }

    function bumpContextRevision() {
        sessionState.contextRevision += 1;
        sessionState.cachedContextSnapshot = null;
        notifyStatsChange();
    }

    const HTML_TAG_RE       = /<[^>]*>/g;
    const HTML_ENTITY_RE    = /&(?:nbsp|amp|lt|gt|quot|#39);/gi;
    const LATEX_CMD_RE      = /\\(?:frac|sqrt|times|div|cdot|pm|text|mathrm|mathbf)\b/g;
    const LATEX_MARKER_RE   = /[$\\{}[\]]/g;
    const MATH_TOKEN_RE     = /(\$\$[\s\S]*?\$\$|\$[^$]+\$|\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]|\\(?:frac|sqrt|int|sum|cdot|times|div|pm|leq|geq|neq|approx|theta|alpha|beta|gamma|Delta|pi|sin|cos|tan|log|ln|lim|vec|hat|bar|overline)\b|\^[{\w-]|\b\d+(?:\.\d+)?\s*[×÷+\-=]\s*\d+)/g;
    const HTML_ENTITY_MAP   = { '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" };
    const replaceHtmlEntity = (m) => HTML_ENTITY_MAP[m.toLowerCase()] || m;

    function stripMarkupToPlainText(str) {
        if (str == null) return '';
        let s = String(str);
        if (!s) return '';
        if (s.indexOf('<') !== -1) s = s.replace(HTML_TAG_RE, ' ');
        if (s.indexOf('&') !== -1) s = s.replace(HTML_ENTITY_RE, replaceHtmlEntity);
        if (s.indexOf('\\') !== -1) s = s.replace(LATEX_CMD_RE, ' ');
        return s.replace(LATEX_MARKER_RE, ' ').replace(/\s+/g, ' ').trim();
    }

    function countWordsInClean(clean) {
        const len = clean.length;
        if (len === 0) return 0;
        let words = 1;
        for (let i = 0; i < len; i++) {
            if (clean.charCodeAt(i) === 32) words++;
        }
        return words;
    }

    function countWords(str) {
        return countWordsInClean(stripMarkupToPlainText(str));
    }

    function countMathTokens(str) {
        if (str == null) return 0;
        const noTags = String(str).replace(HTML_TAG_RE, ' ');
        MATH_TOKEN_RE.lastIndex = 0;
        let count = 0;
        while (MATH_TOKEN_RE.exec(noTags) !== null) count++;
        return count;
    }

    function countDropdownOptions(raw) {
        if (!raw) return 0;
        if (Array.isArray(raw)) {
            let n = 0;
            for (let i = 0; i < raw.length; i++) {
                n += Array.isArray(raw[i]) ? raw[i].length : 1;
            }
            return n;
        }
        if (typeof raw === 'string') {
            try {
                const parsed = JSON.parse(raw);
                return countDropdownOptions(parsed);
            } catch {
                return raw.split(',').filter(Boolean).length;
            }
        }
        if (typeof raw === 'object') {
            return Object.keys(raw).length;
        }
        return 0;
    }

    function setBoundedMapEntry(map, key, value, maxSize) {
        if (key == null) return;
        const k = String(key);
        if (map.has(k)) {
            map.delete(k);
        } else if (map.size >= maxSize) {
            map.delete(map.keys().next().value);
        }
        map.set(k, value);
    }

    function lookupQuestion(id) {
        if (id == null) return null;
        const key = String(id);
        if (!key) return null;
        const direct = sessionState.questionRegistry.get(key);
        if (direct) return direct;
        const aliased = sessionState.questionAliasMap.get(key);
        if (aliased) return sessionState.questionRegistry.get(aliased) || null;
        return null;
    }

    const ORIGIN_MULTIPLIER_MAP = {
        pre_video: 0.75,
        in_video: 0.75,
        diagnostic: 0.95,
        strengthen: 1.05,
        spaced: 1.05,
        progress: 1.0,
        exam_walkthrough: 1.0,
        exam_paper: 1.0,
        exam_question: 1.0,
        standalone: 1.0,
    };

    function computeExamPartWork(answerType, marks, lines) {
        const aType = String(answerType || '').toUpperCase();
        if (aType === 'MULTIPLE_CHOICE') return 32 * marks;
        if (aType === 'MATH') return 68 * marks;
        return 62 * marks + lines * 2.5;
    }

    function computeQuizPartWork(type, optionCount, blankFieldCount, mathCount) {
        switch (type) {
            case 'EngageQuestion':              return 14;
            case 'DropdownQuestion':            return 20 + (optionCount || 0) * 2.5;
            case 'MultipleChoiceQuestion':      return 24 + (optionCount || 0) * 3.5;
            case 'MultiMultipleChoiceQuestion': return 34 + (optionCount || 0) * 4.5;
            case 'TextQuestion':                return 32;
            case 'MultipleInputQuestion':       return 22 + Math.max(1, blankFieldCount || 0) * 11;
            case 'ChemistryQuestion':           return 48 + (mathCount || 0) * 4;
            case 'NumericalQuestion':           return 52 + (mathCount || 0) * 4;
            case 'MathsQuestion':               return 58 + (mathCount || 0) * 5;
            case 'DrawQuestion':                return 54;
            default:                            return 35;
        }
    }

    function computeBaseQuestionSeconds(desc) {
        if (!desc) return 35;
        const readingTime = Math.min(45, Math.ceil((desc.wordCount || 0) / 3.0)) + (desc.imageCount || 0) * 7;
        let workTime = 0;

        if ((desc.marksAvailable || 0) > 0) {
            const parts = Array.isArray(desc.examParts) && desc.examParts.length > 0 ? desc.examParts : null;
            if (parts) {
                let partsSum = 0;
                for (let i = 0; i < parts.length; i++) {
                    const p = parts[i];
                    const m = (typeof p.marksAvailable === 'number' && p.marksAvailable > 0) ? p.marksAvailable : 0;
                    const lines = Number(p.linesForAnswer) || 0;
                    partsSum += computeExamPartWork(p.answerType, m || 1, lines);
                }
                workTime = partsSum > 0 ? partsSum : (62 * desc.marksAvailable + (desc.linesForAnswer || 0) * 2.5);
            } else {
                workTime = computeExamPartWork(
                    desc.answerTypes && desc.answerTypes[0],
                    desc.marksAvailable,
                    desc.linesForAnswer || 0
                );
            }
            const extraPct = Number(desc.additionalExamTimePercentage) || 0;
            const totalExam = (readingTime + workTime) * (1 + extraPct / 100);
            return Math.max(8, Math.round(totalExam));
        }

        const partDetails = Array.isArray(desc.quizParts) && desc.quizParts.length > 0 ? desc.quizParts : null;
        if (partDetails) {
            for (let i = 0; i < partDetails.length; i++) {
                const p = partDetails[i];
                workTime += computeQuizPartWork(p.type, p.optionCount, p.blankFieldCount, p.mathCount);
            }
        } else {
            workTime = computeQuizPartWork(desc.primaryType || '', desc.optionCount, desc.blankFieldCount, desc.mathCount);
        }

        const mult = ORIGIN_MULTIPLIER_MAP[desc.origin] || 1.0;
        return Math.max(8, Math.round((readingTime + workTime) * mult));
    }

    function analyzeQuestionNode(q, meta = {}) {
        if (!q || typeof q !== 'object') return null;

        const isExam = Array.isArray(q.parts) && !q.quizContent && !q.quizDefinition;
        const quizContent = (!isExam && q.quizContent && typeof q.quizContent === 'object')
            ? q.quizContent
            : (!isExam ? q : null);

        const primaryIdRaw = q.id || (quizContent && quizContent.id) || meta.lessonId;
        if (!primaryIdRaw) return null;
        const primaryId = String(primaryIdRaw);
        const quizContentId = (quizContent && quizContent.id) ? String(quizContent.id) : null;

        let wordCount = 0;
        let charCount = 0;
        let imageCount = 0;
        let optionCount = 0;
        let blankFieldCount = 0;
        let partCount = 0;
        let marksAvailable = 0;
        let linesForAnswer = 0;
        let mathCount = 0;
        const partTypes = [];
        const answerTypes = [];
        const quizParts = [];
        const examParts = [];
        const textChunks = [];

        const ingestRawText = (raw) => {
            if (!raw) return 0;
            const s = String(raw);
            const clean = stripMarkupToPlainText(s);
            if (clean) {
                textChunks.push(clean);
                wordCount += countWordsInClean(clean);
                charCount += clean.length;
            }
            const mCount = countMathTokens(s);
            mathCount += mCount;
            return mCount;
        };

        if (isExam) {
            partTypes.push('ExamQuestion');
            if (q.name) ingestRawText(q.name);
            if (q.content) ingestRawText(q.content);
            if (typeof q.marksAvailable === 'number' && q.marksAvailable > 0) {
                marksAvailable = q.marksAvailable;
            }
            const parts = Array.isArray(q.parts) ? q.parts : [];
            partCount = parts.length || 1;
            let summedMarks = 0;
            for (let i = 0; i < parts.length; i++) {
                const p = parts[i];
                if (!p || typeof p !== 'object') continue;
                if (p.content) ingestRawText(p.content);
                if (p.multipleChoiceAnswer) optionCount += 4;
                const pm = Number(p.marksAvailable) || 0;
                const pl = Number(p.linesForAnswer) || 0;
                summedMarks += pm;
                linesForAnswer += pl;
                if (p.answerType) answerTypes.push(String(p.answerType));
                examParts.push({
                    marksAvailable: pm,
                    linesForAnswer: pl,
                    answerType: p.answerType || 'LINES_OF_TEXT',
                });
            }
            if (marksAvailable <= 0) marksAvailable = summedMarks;
        } else {
            if (quizContent && quizContent.stem) ingestRawText(quizContent.stem);
            const qList = (quizContent && quizContent.quizDefinition && Array.isArray(quizContent.quizDefinition.questions))
                ? quizContent.quizDefinition.questions
                : [];
            partCount = qList.length || 1;

            for (let i = 0; i < qList.length; i++) {
                const part = qList[i];
                if (!part || typeof part !== 'object') continue;
                const pType = part.__typename || 'QuizQuestion';
                partTypes.push(pType);

                let pMath = 0;
                if (part.question) pMath += ingestRawText(part.question);
                if (part.description) pMath += ingestRawText(part.description);
                if (part.beforeText) ingestRawText(part.beforeText);
                if (part.afterText) ingestRawText(part.afterText);

                if (part.image) imageCount += 1;
                if (part.topImage) imageCount += 1;
                if (part.drawOn) imageCount += 1;

                let pOpts = 0;
                if (Array.isArray(part.options)) {
                    pOpts = part.options.length;
                    optionCount += pOpts;
                    for (let j = 0; j < part.options.length; j++) {
                        const opt = part.options[j];
                        if (!opt) continue;
                        if (opt.text) ingestRawText(opt.text);
                        if (opt.image) imageCount += 1;
                    }
                }
                if (part.dropdownOptions != null) {
                    const dCount = countDropdownOptions(part.dropdownOptions);
                    pOpts += dCount;
                    optionCount += dCount;
                }

                let pBlanks = 0;
                if (Array.isArray(part.questionSegments)) {
                    for (let j = 0; j < part.questionSegments.length; j++) {
                        const seg = part.questionSegments[j];
                        if (!seg) continue;
                        if (seg.text) ingestRawText(seg.text);
                        if (seg.type === 'MultipleInputQuestionBlank' || seg.__typename === 'MultipleInputQuestionBlank' || seg.fieldIndex != null) {
                            pBlanks += 1;
                        }
                    }
                    blankFieldCount += pBlanks;
                }

                quizParts.push({
                    type: pType,
                    optionCount: pOpts,
                    blankFieldCount: pBlanks,
                    mathCount: pMath,
                });
            }
        }

        const fullText = textChunks.join(' ').replace(/\s+/g, ' ').trim();
        const stemText = fullText.slice(0, 260);
        const stemSnippet = fullText.slice(0, 72);
        const stemNeedle = stemText.toLowerCase().slice(0, 64).trim();

        const existing = sessionState.questionRegistry.get(primaryId);
        const parsedTrigger = parseDurationToSeconds(q.triggerTime != null ? q.triggerTime : meta.triggerTime);
        const parsedResume = parseDurationToSeconds(q.postQuestionResumeTime != null ? q.postQuestionResumeTime : meta.postQuestionResumeTime);

        const desc = {
            id: primaryId,
            quizContentId,
            lessonId: meta.lessonId ? String(meta.lessonId) : (existing ? existing.lessonId : null),
            origin: meta.origin || (existing ? existing.origin : 'unknown'),
            sessionId: meta.sessionId ? String(meta.sessionId) : (existing ? existing.sessionId : null),
            questionNumber: q.questionNumber != null ? q.questionNumber : (meta.questionNumber != null ? meta.questionNumber : (existing ? existing.questionNumber : null)),
            indexInSession: meta.indexInSession != null ? meta.indexInSession : (existing ? existing.indexInSession : null),
            triggerTime: (parsedTrigger != null && isFinite(parsedTrigger)) ? parsedTrigger : (existing ? existing.triggerTime : null),
            postQuestionResumeTime: (parsedResume != null && isFinite(parsedResume)) ? parsedResume : (existing ? existing.postQuestionResumeTime : null),
            partTypes,
            primaryType: partTypes[0] || (isExam ? 'ExamQuestion' : 'QuizQuestion'),
            answerTypes,
            quizParts,
            examParts,
            wordCount,
            charCount,
            imageCount,
            optionCount,
            blankFieldCount,
            partCount,
            marksAvailable,
            linesForAnswer,
            mathCount,
            additionalExamTimePercentage: Number(meta.additionalExamTimePercentage) || (existing ? existing.additionalExamTimePercentage : 0),
            stemText,
            stemSnippet,
            stemNeedle,
            recommendedSeconds: 0,
            attempts: existing ? existing.attempts : 0,
            answered: existing ? existing.answered : false,
            correct: existing ? existing.correct : null,
            skipped: existing ? existing.skipped : false,
            lastSubmittedTimeSeconds: existing ? existing.lastSubmittedTimeSeconds : 0,
            lastExtraTimeSeconds: existing ? existing.lastExtraTimeSeconds : 0,
            lastAnsweredAt: existing ? existing.lastAnsweredAt : 0,
            _countedIdentified: existing ? existing._countedIdentified : false,
        };

        desc.recommendedSeconds = computeBaseQuestionSeconds(desc);

        setBoundedMapEntry(sessionState.questionRegistry, primaryId, desc, QUESTION_REGISTRY_MAX);
        if (quizContentId && quizContentId !== primaryId) {
            setBoundedMapEntry(sessionState.questionAliasMap, quizContentId, primaryId, QUESTION_REGISTRY_MAX);
        }
        if (desc.lessonId && desc.lessonId !== primaryId) {
            setBoundedMapEntry(sessionState.questionAliasMap, desc.lessonId, primaryId, QUESTION_REGISTRY_MAX);
        }

        if (!desc._countedIdentified) {
            desc._countedIdentified = true;
            bumpStat('questionsIdentified');
        }
        return desc;
    }

    function updatePredictedFinalCall(session) {
        if (!session) return null;
        let predictedOp = session.predictedOp || null;
        let varsPreview = Object.assign({}, session.variablesTemplate || {});
        let predictedSeconds = 0;

        if (session.sessionType === 'VideoLesson') {
            predictedOp = 'CompleteVideoLesson';
            const dur = session.durationSeconds || sessionState.knownLessonDurations.get(session.sessionId) || 0;
            const qExtra = settings.predictFinalCallEnabled ? (session.totalExtraQuestionSeconds || 0) : 0;
            predictedSeconds = round3((settings.addVideoDurationToTimeSpent ? dur : 0) + qExtra + (sessionState.queuedSeconds || 0));
            varsPreview.lessonId = session.sessionId;
            varsPreview.timeSpent = predictedSeconds;
            varsPreview.percentWatched = settings.fullVideoWatchedEnabled ? 1 : 0;
        } else if (session.sessionType === 'SubsectionSummary') {
            predictedOp = 'CompleteSubsectionSummary';
            const dur = session.durationSeconds || sessionState.knownLessonDurations.get(session.sessionId) || 0;
            predictedSeconds = round3((settings.addVideoDurationToTimeSpent ? dur : 0) + (sessionState.queuedSeconds || 0));
            varsPreview.subsectionSummaryId = session.sessionId;
            varsPreview.timeSpent = predictedSeconds;
            varsPreview.percentWatched = settings.fullVideoWatchedEnabled ? 1 : 0;
        } else if (session.sessionType === 'ArticleLesson') {
            predictedOp = 'CompleteArticleLesson';
            const dur = session.durationSeconds || sessionState.knownLessonDurations.get(session.sessionId) || 0;
            predictedSeconds = round3(dur + (sessionState.queuedSeconds || 0));
            varsPreview.lessonId = session.sessionId;
            varsPreview.timeSpent = predictedSeconds;
        } else if (session.sessionType === 'ExamQuestionWalkthrough') {
            predictedOp = 'CompleteExamQuestionWalkthrough';
            const dur = session.durationSeconds || sessionState.knownLessonDurations.get(session.sessionId) || 0;
            const ans = round3(session.answeringSubmittedSeconds || 0);
            const mark = round3(session.markingSubmittedSeconds || 0);
            const watch = settings.addVideoDurationToTimeSpent ? dur : 0;
            predictedSeconds = round3(ans + mark + watch + (sessionState.queuedSeconds || 0));
            varsPreview.lessonId = session.sessionId;
            varsPreview.timeSpentAnswering = toIso(ans);
            varsPreview.timeSpentMarking = toIso(mark);
            if (watch > 0) varsPreview.timeSpentWatching = toIso(watch);
            if (settings.fullVideoWatchedEnabled) varsPreview.percentWatched = 1;
        } else if (session.sessionType === 'ExamPracticeSession') {
            predictedOp = session.phase === 'answers_saved' ? 'CompleteExamPracticeSession' : 'SaveExamPracticeAnswers';
            const bonus = (session.totalExtraQuestionSeconds || sessionState.accumulatedExtraSeconds || 0) + (sessionState.queuedSeconds || 0);
            predictedSeconds = round3(Math.max(session.totalSubmittedQuestionSeconds || 0, bonus));
            if (session.sessionId) varsPreview.sessionId = session.sessionId;
            if (predictedOp === 'SaveExamPracticeAnswers') {
                varsPreview.timeSpent = toIso(predictedSeconds);
            } else {
                varsPreview = { id: session.sessionId || null };
            }
        } else {
            const bonus = (session.totalExtraQuestionSeconds || sessionState.accumulatedExtraSeconds || 0) + (sessionState.queuedSeconds || 0);
            predictedSeconds = round3(Math.max(session.totalSubmittedQuestionSeconds || 0, bonus));
            varsPreview.timeSpent = toIso(predictedSeconds);
        }

        session.predictedOp = predictedOp;
        session.predictedFinalCall = {
            operationName: predictedOp,
            sessionType: session.sessionType,
            sessionId: session.sessionId || null,
            predictedTotalSeconds: predictedSeconds,
            totalExtraQuestionSeconds: round3(session.totalExtraQuestionSeconds || 0),
            totalSubmittedQuestionSeconds: round3(session.totalSubmittedQuestionSeconds || 0),
            variablesPreview: varsPreview,
        };
        return session.predictedFinalCall;
    }

    function initOrUpdateSession(cfg) {
        const prev = sessionState.activeSession;
        const sameSession = prev && prev.sessionType === cfg.sessionType && prev.sessionId === cfg.sessionId && !prev.completed;

        const session = {
            sessionType: cfg.sessionType,
            sessionId: cfg.sessionId ? String(cfg.sessionId) : '',
            title: cfg.title || (sameSession ? prev.title : ''),
            moduleUniqueCode: cfg.moduleUniqueCode || (sameSession ? prev.moduleUniqueCode : ''),
            subsectionUniqueCode: cfg.subsectionUniqueCode || (sameSession ? prev.subsectionUniqueCode : ''),
            durationSeconds: Number(cfg.durationSeconds) || (sameSession ? prev.durationSeconds : 0),
            additionalExamTimePercentage: Number(cfg.additionalExamTimePercentage) || 0,
            questionIds: Array.isArray(cfg.questionIds) ? cfg.questionIds : [],
            preVideoQuestionIds: Array.isArray(cfg.preVideoQuestionIds) ? cfg.preVideoQuestionIds : [],
            inVideoQuestions: Array.isArray(cfg.inVideoQuestions) ? cfg.inVideoQuestions : [],
            currentQuestionIndex: sameSession ? prev.currentQuestionIndex : 0,
            currentQuestionId: sameSession ? prev.currentQuestionId : (cfg.questionIds && cfg.questionIds[0]) || null,
            predictedOp: cfg.predictedOp || null,
            variablesTemplate: cfg.variablesTemplate || {},
            predictedFinalCall: null,
            totalOriginalQuestionSeconds: sameSession ? prev.totalOriginalQuestionSeconds : 0,
            totalExtraQuestionSeconds: sameSession ? prev.totalExtraQuestionSeconds : 0,
            totalSubmittedQuestionSeconds: sameSession ? prev.totalSubmittedQuestionSeconds : 0,
            answeringSubmittedSeconds: sameSession ? prev.answeringSubmittedSeconds : 0,
            answeringExtraSeconds: sameSession ? prev.answeringExtraSeconds : 0,
            markingSubmittedSeconds: sameSession ? prev.markingSubmittedSeconds : 0,
            markingExtraSeconds: sameSession ? prev.markingExtraSeconds : 0,
            phase: sameSession ? prev.phase : (cfg.phase || 'answering'),
            completed: false,
            updatedAt: Date.now(),
        };

        if (session.questionIds.length > 0 && (!session.currentQuestionId || !session.questionIds.includes(session.currentQuestionId))) {
            session.currentQuestionIndex = 0;
            session.currentQuestionId = session.questionIds[0];
        }

        if (!sameSession) {
            sessionState.accumulatedExtraSeconds = 0;
            sessionState.accumulatedQuestionCount = 0;
            sessionState.lastSubmittedQuestionId = null;
        }

        sessionState.activeSession = session;
        updatePredictedFinalCall(session);
        bumpContextRevision();
        if (!sessionState.editing) updateLabel();
        VLOG(`[session] ${session.sessionType} (${session.sessionId || 'anon'}) · ${session.questionIds.length} q · predicted final: ${session.predictedOp}`);
        return session;
    }

    function cleanDomText(str) {
        if (str == null) return '';
        let s = String(str);
        if (!s) return '';
        if (s.indexOf('\\') !== -1) s = s.replace(LATEX_CMD_RE, ' ');
        return s.replace(LATEX_MARKER_RE, ' ').replace(/\s+/g, ' ').trim();
    }

    function extractVisibleQuizTextFromDom() {
        try {
            if (typeof document === 'undefined' || typeof document.querySelectorAll !== 'function') return '';
            const containers = document.querySelectorAll('[role="dialog"], .quiz-content, [data-testid*="question"], [data-testid*="quiz"], .question');
            let combined = '';
            for (let i = 0; i < containers.length; i++) {
                const el = containers[i];
                if (!el || (uiState.hostEl && (el === uiState.hostEl || uiState.hostEl.contains(el)))) continue;
                if (!isElementVisible(el)) continue;
                const txt = cleanDomText(el.textContent || '');
                if (txt.length > combined.length) combined = txt;
            }
            return combined.toLowerCase();
        } catch {
            return '';
        }
    }

    function identifyCurrentQuestion(vars, opName, qStr, allowDomScan = true) {
        const session = sessionState.activeSession;

        // Mode 1: Request interception with explicit GraphQL variables
        if (vars && typeof vars === 'object') {
            const candidates = [];
            if (vars.questionId != null) candidates.push(vars.questionId);
            if (vars.question != null) {
                if (typeof vars.question === 'string' || typeof vars.question === 'number') {
                    candidates.push(vars.question);
                } else if (typeof vars.question === 'object') {
                    if (vars.question.id != null) candidates.push(vars.question.id);
                    if (vars.question.questionId != null) candidates.push(vars.question.questionId);
                    if (vars.question.quizContent && vars.question.quizContent.id != null) candidates.push(vars.question.quizContent.id);
                }
            }
            if (vars.quizContentId != null) candidates.push(vars.quizContentId);
            if (vars.standaloneQuestionId != null) candidates.push(vars.standaloneQuestionId);
            if (vars.lessonId != null) candidates.push(vars.lessonId);

            for (let i = 0; i < candidates.length; i++) {
                const desc = lookupQuestion(candidates[i]);
                if (desc) {
                    if (session) {
                        session.currentQuestionId = desc.id;
                        const idx = session.questionIds.indexOf(desc.id);
                        if (idx !== -1) session.currentQuestionIndex = idx;
                    }
                    return desc;
                }
            }
            return null;
        }

        // Mode 2: Live page inspection
        if (!session) return null;

        if (session.sessionType === 'VideoLesson') {
            const video = findActiveVideoElement();
            if (video && isFinite(video.currentTime)) {
                const ct = video.currentTime;
                if (ct < 1.0 && session.preVideoQuestionIds.length > 0) {
                    for (let i = 0; i < session.preVideoQuestionIds.length; i++) {
                        const pq = lookupQuestion(session.preVideoQuestionIds[i]);
                        if (pq && !pq.answered) return pq;
                    }
                }
                const ivqs = session.inVideoQuestions || [];
                for (let i = 0; i < ivqs.length; i++) {
                    const iq = ivqs[i];
                    if (iq && iq.triggerTime != null && Math.abs(ct - iq.triggerTime) <= 4.0) {
                        const qDesc = lookupQuestion(iq.id);
                        if (qDesc && !qDesc.answered) return qDesc;
                    }
                }
            }
        }

        const qIds = session.questionIds || [];
        if (qIds.length > 0) {
            if (allowDomScan) {
                const domText = extractVisibleQuizTextFromDom();
                if (domText.length >= 16) {
                    let bestMatch = null;
                    let bestScore = 0;
                    for (let i = 0; i < qIds.length; i++) {
                        const qDesc = lookupQuestion(qIds[i]);
                        if (!qDesc || !qDesc.stemText) continue;
                        const needle = qDesc.stemNeedle ?? qDesc.stemText.toLowerCase().slice(0, 64).trim();
                        if (needle.length >= 16 && domText.includes(needle)) {
                            if (needle.length > bestScore) {
                                bestScore = needle.length;
                                bestMatch = qDesc;
                            }
                        } else if (needle.length >= 24) {
                            const prefix = needle.slice(0, 24);
                            if (domText.includes(prefix) && prefix.length > bestScore) {
                                bestScore = prefix.length;
                                bestMatch = qDesc;
                            }
                        }
                    }
                    if (bestMatch) {
                        const idx = qIds.indexOf(bestMatch.id);
                        if (idx !== -1) session.currentQuestionIndex = idx;
                        session.currentQuestionId = bestMatch.id;
                        return bestMatch;
                    }
                }
            }

            const idx = Math.max(0, Math.min(session.currentQuestionIndex || 0, qIds.length - 1));
            const indexedQ = lookupQuestion(qIds[idx]);
            if (indexedQ) return indexedQ;
            for (let i = 0; i < qIds.length; i++) {
                const candidate = lookupQuestion(qIds[i]);
                if (candidate && !candidate.answered && !candidate.skipped) return candidate;
            }
            return lookupQuestion(qIds[qIds.length - 1]);
        }

        return session.currentQuestionId ? lookupQuestion(session.currentQuestionId) : null;
    }

    function inspectDomQuestionComplexity() {
        try {
            if (typeof document === 'undefined' || typeof document.querySelectorAll !== 'function') return null;
            const domText = extractVisibleQuizTextFromDom();
            const wc = countWordsInClean(domText);
            const radios = document.querySelectorAll('input[type="radio"]').length;
            const checks = document.querySelectorAll('input[type="checkbox"]').length;
            const textInputs = document.querySelectorAll('input[type="text"], input[type="number"], textarea, math-field').length;
            let primaryType = 'QuizQuestion';
            if (checks > 1) primaryType = 'MultiMultipleChoiceQuestion';
            else if (radios > 1) primaryType = 'MultipleChoiceQuestion';
            else if (textInputs > 1) primaryType = 'MultipleInputQuestion';
            else if (textInputs === 1) primaryType = 'TextQuestion';

            const fallbackDesc = {
                id: 'dom-fallback',
                primaryType,
                wordCount: wc,
                imageCount: 0,
                optionCount: radios + checks,
                blankFieldCount: textInputs,
                partCount: 1,
                marksAvailable: 0,
                linesForAnswer: 0,
                mathCount: countMathTokens(domText),
                origin: 'progress',
                attempts: 0,
            };
            fallbackDesc.recommendedSeconds = computeBaseQuestionSeconds(fallbackDesc);
            return fallbackDesc;
        } catch {
            return null;
        }
    }

    const OP_ANSWER_QUESTION_RE    = /^Answer.*Question$/i;
    const OP_SAVE_EXAM_RE          = /^SaveExam.*Marks$/i;
    const QSTR_ANSWER_QUESTION_RE  = /answer[A-Za-z0-9]*Question/i;
    const QSTR_SAVE_EXAM_RE        = /saveExam[A-Za-z0-9]*Marks/i;

    const OP_COMPLETE_GROUP_RE     = /^Complete.*(Quiz|Group|Session|Walkthrough)$/i;
    const QSTR_COMPLETE_GROUP_RE   = /complete[A-Za-z0-9]*(Quiz|Group|Session|Walkthrough)|saveExamPracticeAnswers/i;

    const OP_COMPLETE_LESSON_RE    = /^Complete(VideoLesson|SubsectionSummary|ArticleLesson)$/i;
    const QSTR_COMPLETE_LESSON_RE  = /\bcomplete(VideoLesson|SubsectionSummary|ArticleLesson)\b/i;

    function computeDynamicExtraSeconds(questionDesc, origSeconds, opName, qStr) {
        const isMarking = OP_SAVE_EXAM_RE.test(opName || '') || QSTR_SAVE_EXAM_RE.test(qStr || '');
        const desc = questionDesc || inspectDomQuestionComplexity();

        let baseTarget = 35;
        if (isMarking) {
            const marks = (desc && desc.marksAvailable) ? desc.marksAvailable : 2;
            const parts = (desc && desc.partCount) ? desc.partCount : 1;
            baseTarget = Math.max(18, marks * 18 + parts * 6);
        } else {
            const rec = (desc && desc.recommendedSeconds > 0) ? desc.recommendedSeconds : 35;
            const attempts = (desc && desc.attempts) ? desc.attempts : 0;
            const retryFactor = attempts > 0 ? Math.max(0.35, Math.pow(0.55, attempts)) : 1.0;
            baseTarget = rec * retryFactor;
        }

        const minRange = Math.min(settings.extraSecondsMin, settings.extraSecondsMax);
        const maxRange = Math.max(settings.extraSecondsMin, settings.extraSecondsMax);
        const avgRange = (minRange + maxRange) / 2;
        const scale = Math.min(4.0, Math.max(0.35, avgRange / 60));
        const jitter = 0.88 + Math.random() * 0.24;
        const targetSeconds = baseTarget * scale * jitter;

        const orig = Math.max(0, Number(origSeconds) || 0);
        let extra;
        if (orig < targetSeconds) {
            const minFloor = Math.min(minRange, Math.max(8, Math.round(targetSeconds * 0.35)));
            extra = Math.max(targetSeconds - orig, minFloor);
        } else {
            extra = Math.max(5, Math.round(targetSeconds * (0.18 + Math.random() * 0.12)));
        }
        return round3(extra);
    }

    function processAnswerMutationResponse(mutationKey, payload) {
        if (!payload) return;
        const session = sessionState.activeSession;
        if (settings.logLevel === 'verbose') {
            sessionState.latestQuizFeedback = { type: mutationKey, timestamp: Date.now(), payload };
        }

        if (mutationKey === 'answerInVideoQuestion') {
            videoState.lastQuestionAnsweredAt = Date.now();
            videoState.waitingForPostAnswerResume = true;
        }

        if (mutationKey === 'answerExamQuestion') {
            if (session && session.sessionType === 'ExamQuestionWalkthrough') {
                session.phase = 'marking';
                updatePredictedFinalCall(session);
            }
            bumpContextRevision();
            if (!sessionState.editing) updateLabel();
            return;
        }

        if (mutationKey === 'saveExamQuestionMarks') {
            if (session && session.sessionType === 'ExamQuestionWalkthrough') {
                session.phase = 'marked';
                updatePredictedFinalCall(session);
            }
            bumpContextRevision();
            if (!sessionState.editing) updateLabel();
            return;
        }

        if (mutationKey === 'saveExamPracticeAnswers') {
            if (session && session.sessionType === 'ExamPracticeSession') {
                session.phase = 'answers_saved';
                updatePredictedFinalCall(session);
            }
            bumpContextRevision();
            if (!sessionState.editing) updateLabel();
            return;
        }

        if (mutationKey === 'saveExamPracticeQuestionMarks') {
            if (session && session.sessionType === 'ExamPracticeSession') {
                updatePredictedFinalCall(session);
            }
            bumpContextRevision();
            if (!sessionState.editing) updateLabel();
            return;
        }

        const responses = Array.isArray(payload.responses) ? payload.responses : [];
        const allCorrect = responses.length > 0 && responses.every((r) => r && (r.correct === true || r.correct === 'CORRECT'));

        const qId = sessionState.lastSubmittedQuestionId || (session && session.currentQuestionId);
        const qDesc = qId ? lookupQuestion(qId) : null;
        if (qDesc) {
            qDesc.answered = true;
            if (allCorrect) qDesc.correct = true;
            else if (responses.length > 0 && qDesc.correct !== true) qDesc.correct = false;
        }

        if (session && session.questionIds.length > 0) {
            const qIds = session.questionIds;
            let curIdx = qDesc ? qIds.indexOf(qDesc.id) : session.currentQuestionIndex;
            if (curIdx < 0) curIdx = session.currentQuestionIndex || 0;

            if (payload.questionToSkipTo != null) {
                let targetIdx = -1;
                for (let i = 0; i < qIds.length; i++) {
                    const candidate = lookupQuestion(qIds[i]);
                    if (candidate && candidate.questionNumber === payload.questionToSkipTo) {
                        targetIdx = i;
                        break;
                    }
                }
                if (targetIdx === -1 && typeof payload.questionToSkipTo === 'number') {
                    const fallbackIdx = payload.questionToSkipTo - 1;
                    if (fallbackIdx >= 0 && fallbackIdx < qIds.length) targetIdx = fallbackIdx;
                }
                if (targetIdx !== -1) {
                    for (let i = curIdx + 1; i < targetIdx; i++) {
                        const midQ = lookupQuestion(qIds[i]);
                        if (midQ) midQ.skipped = true;
                    }
                    session.currentQuestionIndex = targetIdx;
                    session.currentQuestionId = qIds[targetIdx];
                }
            } else if (
                allCorrect ||
                session.sessionType === 'DiagnosticQuiz' ||
                mutationKey === 'answerInVideoQuestion' ||
                mutationKey === 'answerPreVideoQuestion'
            ) {
                let nextIdx = -1;
                for (let i = curIdx + 1; i < qIds.length; i++) {
                    const cand = lookupQuestion(qIds[i]);
                    if (!cand || (!cand.answered && !cand.skipped)) {
                        nextIdx = i;
                        break;
                    }
                }
                if (nextIdx === -1) {
                    for (let i = 0; i < qIds.length; i++) {
                        const cand = lookupQuestion(qIds[i]);
                        if (!cand || (!cand.answered && !cand.skipped)) {
                            nextIdx = i;
                            break;
                        }
                    }
                }
                if (nextIdx !== -1) {
                    session.currentQuestionIndex = nextIdx;
                    session.currentQuestionId = qIds[nextIdx];
                }
            }

            updatePredictedFinalCall(session);
        }

        bumpContextRevision();
        if (!sessionState.editing) updateLabel();
    }

    function recordLessonDuration(id, dur) {
        if (!id || !dur) return;
        setBoundedMapEntry(sessionState.knownLessonDurations, id, dur, 200);
    }

    const ANSWER_RESPONSE_KEYS = [
        'answerProgressQuizQuestion',
        'answerSpacedPracticeQuizQuestion',
        'answerDiagnosticQuestion',
        'answerPreVideoQuestion',
        'answerInVideoQuestion',
        'answerExamQuestion',
        'saveExamQuestionMarks',
        'saveExamPracticeAnswers',
        'saveExamPracticeQuestionMarks',
        'evaluateQuizContentResponses',
        'evaluateStandaloneQuestionResponses',
    ];

    function handleSubsectionOverview(sub) {
        const lessonLists = [sub.videoLessons, sub.articleLessons, sub.examHowToLessons];
        for (let l = 0; l < lessonLists.length; l++) {
            const list = lessonLists[l];
            if (!Array.isArray(list)) continue;
            for (let i = 0; i < list.length; i++) {
                const item = list[i];
                if (!item || !item.id) continue;
                const itemDur = parseDurationToSeconds(item.length) || parseDurationToSeconds(item.duration) || 0;
                if (itemDur > 0) recordLessonDuration(item.id, itemDur);
            }
        }
        if (sub.summary && sub.summary.id) {
            const sumVidDur = parseDurationToSeconds(sub.summary.wistiaVideoDuration) || 0;
            if (sumVidDur > 0) recordLessonDuration(sub.summary.id, sumVidDur);
        }
    }

    function handleExperimentGroup(eg) {
        for (const actWrap of eg.activities) {
            const act = actWrap && actWrap.activity;
            if (!act || !act.id) continue;
            const dur = parseDurationToSeconds(act.length) || 0;
            if (dur > 0) recordLessonDuration(act.id, dur);
            if (act.__typename === 'ArticleLesson') {
                const artDur = dur || Math.max(45, Math.ceil(countWords(act.extraContent) / 3.0));
                recordLessonDuration(act.id, artDur);
                initOrUpdateSession({
                    sessionType: 'ArticleLesson',
                    sessionId: act.id,
                    title: act.title || 'Article Lesson',
                    durationSeconds: artDur,
                    predictedOp: 'CompleteArticleLesson',
                    variablesTemplate: { lessonId: String(act.id) },
                });
            }
        }
    }

    function handleProgressQuizGroup(pg) {
        const rawQs = Array.isArray(pg.progressQuizQuestions) ? pg.progressQuizQuestions : [];
        const qIds = [];
        for (let i = 0; i < rawQs.length; i++) {
            const desc = analyzeQuestionNode(rawQs[i], {
                origin: 'progress',
                sessionId: pg.id,
                indexInSession: i,
                questionNumber: i + 1,
            });
            if (desc) qIds.push(desc.id);
        }
        initOrUpdateSession({
            sessionType: 'ProgressQuizGroup',
            sessionId: pg.id,
            title: pg.name || 'Progress Quiz',
            moduleUniqueCode: (pg.module && pg.module.uniqueCode) || pg.moduleUniqueCode,
            subsectionUniqueCode: (pg.subsection && pg.subsection.uniqueCode) || pg.subsectionUniqueCode,
            questionIds: qIds,
            predictedOp: 'CompleteProgressQuizGroup',
            variablesTemplate: { progressQuizGroupId: String(pg.id) },
        });
    }

    function handleStrengthenQuiz(sq, sub) {
        const rawQs = Array.isArray(sq.questions) ? sq.questions : [];
        const qIds = [];
        for (let i = 0; i < rawQs.length; i++) {
            const desc = analyzeQuestionNode(rawQs[i], {
                origin: 'strengthen',
                sessionId: sq.id,
                indexInSession: i,
                questionNumber: i + 1,
            });
            if (desc) qIds.push(desc.id);
        }
        initOrUpdateSession({
            sessionType: 'StrengthenQuiz',
            sessionId: sq.id,
            title: sub.name ? `${sub.name} (Strengthen)` : 'Strengthen Quiz',
            moduleUniqueCode: sub.module && sub.module.uniqueCode,
            subsectionUniqueCode: sub.uniqueCode,
            questionIds: qIds,
            predictedOp: 'CompleteStrengthenQuiz',
            variablesTemplate: { strengthenQuizSessionId: String(sq.id) },
        });
    }

    function handleSpacedPracticeQuiz(sp) {
        if (!sp || !Array.isArray(sp.questions)) return;
        const modCode = (sp.module && sp.module.uniqueCode) || '';
        const subCode = (sp.subsection && sp.subsection.uniqueCode) || '';
        const spSessionId = `${modCode}:${subCode}` || 'spaced-practice';
        const qIds = [];
        for (let i = 0; i < sp.questions.length; i++) {
            const desc = analyzeQuestionNode(sp.questions[i], {
                origin: 'spaced',
                sessionId: spSessionId,
                indexInSession: i,
                questionNumber: i + 1,
            });
            if (desc) qIds.push(desc.id);
        }
        initOrUpdateSession({
            sessionType: 'SpacedPracticeQuiz',
            sessionId: spSessionId,
            title: (sp.subsection && sp.subsection.name) ? `${sp.subsection.name} (Spaced)` : 'Spaced Practice Quiz',
            moduleUniqueCode: modCode,
            subsectionUniqueCode: subCode,
            questionIds: qIds,
            predictedOp: 'CompleteSpacedPracticeQuiz',
            variablesTemplate: { moduleUniqueCode: modCode, subsectionUniqueCode: subCode },
        });
    }

    function handleDiagnosticQuiz(dq, sub) {
        const rawQs = Array.isArray(dq.questions) ? dq.questions : [];
        const qIds = [];
        for (let i = 0; i < rawQs.length; i++) {
            const desc = analyzeQuestionNode(rawQs[i], {
                origin: 'diagnostic',
                sessionId: dq.id,
                indexInSession: i,
                questionNumber: i + 1,
            });
            if (desc) qIds.push(desc.id);
        }
        initOrUpdateSession({
            sessionType: 'DiagnosticQuiz',
            sessionId: dq.id,
            title: sub.name ? `${sub.name} (Diagnostic)` : 'Diagnostic Quiz',
            moduleUniqueCode: sub.module && sub.module.uniqueCode,
            subsectionUniqueCode: sub.uniqueCode,
            questionIds: qIds,
            predictedOp: 'CompleteDiagnosticQuizSession',
            variablesTemplate: { diagnosticQuizSessionId: String(dq.id) },
        });
    }

    function handleVideoLesson(vl) {
        if (!vl || !vl.id) return;
        const dur = parseDurationToSeconds(vl.length || vl.duration) || 0;
        if (dur > 0) {
            recordLessonDuration(vl.id, dur);
            vl.duration = dur;
        }
        const preQs = Array.isArray(vl.preVideoQuestions) ? vl.preVideoQuestions : [];
        const rawInQs = Array.isArray(vl.inVideoQuizQuestions) ? vl.inVideoQuizQuestions : [];
        const inQs = rawInQs.slice().sort((a, b) => {
            const ta = parseDurationToSeconds(a && a.triggerTime) || 0;
            const tb = parseDurationToSeconds(b && b.triggerTime) || 0;
            return ta - tb;
        });
        const allQIds = [];
        const preQIds = [];
        const inVideoList = [];
        for (let i = 0; i < preQs.length; i++) {
            const desc = analyzeQuestionNode(preQs[i], {
                origin: 'pre_video',
                sessionId: vl.id,
                lessonId: String(vl.id),
                indexInSession: i,
                questionNumber: i + 1,
            });
            if (desc) {
                preQIds.push(desc.id);
                allQIds.push(desc.id);
            }
        }
        for (let i = 0; i < inQs.length; i++) {
            const item = inQs[i];
            const qNode = (item && item.question) || item;
            const inMeta = {
                origin: 'in_video',
                sessionId: vl.id,
                lessonId: String(vl.id),
                indexInSession: preQs.length + i,
                questionNumber: preQs.length + i + 1,
                triggerTime: item && item.triggerTime,
                postQuestionResumeTime: item && item.postQuestionResumeTime,
            };
            const desc = analyzeQuestionNode(qNode, inMeta);
            if (desc) {
                allQIds.push(desc.id);
                inVideoList.push({
                    id: desc.id,
                    triggerTime: item && item.triggerTime,
                    postQuestionResumeTime: item && item.postQuestionResumeTime,
                    answered: false,
                });
            }
        }
        videoState.currentVideoLesson = {
            id: vl.id,
            uniqueCode: vl.uniqueCode,
            title: vl.title,
            duration: dur,
            preVideoQuestionIds: preQIds,
            inVideoQuestions: inVideoList,
        };
        initOrUpdateSession({
            sessionType: 'VideoLesson',
            sessionId: vl.id,
            title: vl.title || 'Video Lesson',
            moduleUniqueCode: vl.module && vl.module.uniqueCode,
            subsectionUniqueCode: vl.subsection && vl.subsection.uniqueCode,
            durationSeconds: dur,
            questionIds: allQIds,
            preVideoQuestionIds: preQIds,
            inVideoQuestions: inVideoList,
            predictedOp: VIDEO_OP,
            variablesTemplate: { lessonId: String(vl.id), percentWatched: 1 },
        });
        VLOG('GetVideoLesson captured:', vl.id, 'duration:', dur, 'preQs:', preQs.length, 'inQs:', inQs.length);
        if (settings.autoSkipVideoEnabled) {
            requestAnimationFrame(() => checkAndAutoSkipVideo(false));
        }
    }

    function handleExamHowToLesson(ehl) {
        const dur = parseDurationToSeconds(ehl.duration) || 0;
        if (dur > 0) recordLessonDuration(ehl.id, dur);
        const extraTimePct = (ehl.module && ehl.module.currentUserEnrolment && ehl.module.currentUserEnrolment.additionalExamTimePercentage) || ehl.additionalExamTimePercentage || 0;
        let qDesc = null;
        if (ehl.examQuestion) {
            qDesc = analyzeQuestionNode(ehl.examQuestion, {
                origin: 'exam_walkthrough',
                sessionId: ehl.id,
                lessonId: String(ehl.id),
                indexInSession: 0,
                questionNumber: 1,
                additionalExamTimePercentage: extraTimePct,
            });
        }
        initOrUpdateSession({
            sessionType: 'ExamQuestionWalkthrough',
            sessionId: ehl.id,
            title: ehl.title || 'Exam Question Walkthrough',
            moduleUniqueCode: ehl.module && ehl.module.uniqueCode,
            subsectionUniqueCode: ehl.subsection && ehl.subsection.uniqueCode,
            durationSeconds: dur,
            additionalExamTimePercentage: extraTimePct,
            questionIds: qDesc ? [qDesc.id] : [],
            predictedOp: 'CompleteExamQuestionWalkthrough',
            variablesTemplate: {
                lessonId: String(ehl.id),
                percentWatched: 1,
            },
        });
    }

    function handleExamPaper(ep) {
        if (settings.logLevel === 'verbose') {
            sessionState.latestExamPaperData = ep;
        }
        const dur = parseDurationToSeconds(ep.duration) || 0;
        const extraTimePct = (ep.module && ep.module.currentUserEnrolment && ep.module.currentUserEnrolment.additionalExamTimePercentage) || 0;
        const rawQs = Array.isArray(ep.questions) ? ep.questions : [];
        const qIds = [];
        for (let i = 0; i < rawQs.length; i++) {
            const desc = analyzeQuestionNode(rawQs[i], {
                origin: 'exam_paper',
                sessionId: ep.id,
                indexInSession: i,
                questionNumber: i + 1,
                additionalExamTimePercentage: extraTimePct,
            });
            if (desc) qIds.push(desc.id);
        }
        const curSession = sessionState.activeSession;
        const existingSessionId = (curSession && curSession.sessionType === 'ExamPracticeSession' && curSession.sessionId)
            ? curSession.sessionId
            : ep.id;
        initOrUpdateSession({
            sessionType: 'ExamPracticeSession',
            sessionId: existingSessionId,
            title: ep.name || 'Exam Paper',
            moduleUniqueCode: ep.module && ep.module.uniqueCode,
            durationSeconds: dur,
            additionalExamTimePercentage: extraTimePct,
            questionIds: qIds,
            predictedOp: 'SaveExamPracticeAnswers',
            variablesTemplate: { sessionId: String(existingSessionId) },
        });
    }

    function handleStartExamPracticeSession(seps) {
        const sid = String(seps.id);
        const curSession = sessionState.activeSession;
        if (curSession && curSession.sessionType === 'ExamPracticeSession') {
            curSession.sessionId = sid;
            curSession.variablesTemplate = { sessionId: sid };
            updatePredictedFinalCall(curSession);
            bumpContextRevision();
        } else {
            initOrUpdateSession({
                sessionType: 'ExamPracticeSession',
                sessionId: sid,
                title: 'Exam Practice Session',
                questionIds: [],
                predictedOp: 'SaveExamPracticeAnswers',
                variablesTemplate: { sessionId: sid },
            });
        }
    }

    function handleSubsectionSummary(sub) {
        const sum = sub.summary;
        let dur = parseDurationToSeconds(sum.wistiaVideoDuration) || 0;
        if (dur <= 0 && sum.article && Array.isArray(sum.article.parts)) {
            let words = 0;
            for (let i = 0; i < sum.article.parts.length; i++) {
                words += countWords(sum.article.parts[i] && sum.article.parts[i].content);
            }
            if (words > 0) dur = Math.max(45, Math.ceil(words / 3.0));
        }
        if (dur > 0) recordLessonDuration(sum.id, dur);
        initOrUpdateSession({
            sessionType: 'SubsectionSummary',
            sessionId: sum.id,
            title: sub.name ? `${sub.name} (Summary)` : 'Subsection Summary',
            moduleUniqueCode: sub.module && sub.module.uniqueCode,
            subsectionUniqueCode: sub.uniqueCode,
            durationSeconds: dur,
            predictedOp: 'CompleteSubsectionSummary',
            variablesTemplate: { subsectionSummaryId: String(sum.id), percentWatched: 1 },
        });
    }

    function handleSubsectionActivity(sub) {
        const act = sub.activity;
        let dur = sessionState.knownLessonDurations.get(String(act.id)) || 0;
        if (dur <= 0 && act.extraContent) {
            const words = countWords(act.extraContent);
            if (words > 0) dur = Math.max(45, Math.ceil(words / 3.0));
        }
        if (dur > 0) recordLessonDuration(act.id, dur);
        initOrUpdateSession({
            sessionType: 'ArticleLesson',
            sessionId: act.id,
            title: act.title || 'Article Lesson',
            moduleUniqueCode: sub.module && sub.module.uniqueCode,
            subsectionUniqueCode: sub.uniqueCode,
            durationSeconds: dur,
            predictedOp: 'CompleteArticleLesson',
            variablesTemplate: { lessonId: String(act.id) },
        });
    }

    function handleSubsectionNode(sub) {
        if (!sub || typeof sub !== 'object') return;
        handleSubsectionOverview(sub);
        if (sub.strengthenQuiz && sub.strengthenQuiz.id) {
            handleStrengthenQuiz(sub.strengthenQuiz, sub);
        }
        if (sub.diagnosticQuiz && sub.diagnosticQuiz.id) {
            handleDiagnosticQuiz(sub.diagnosticQuiz, sub);
        }
        if (
            sub.summary &&
            sub.summary.id &&
            ('article' in sub.summary || 'wistiaVideoId' in sub.summary || 'summaryOnly' in sub.summary)
        ) {
            handleSubsectionSummary(sub);
        }
        if (sub.activity && sub.activity.__typename === 'ArticleLesson' && sub.activity.id) {
            handleSubsectionActivity(sub);
        }
    }

    // O(keys in d) GraphQL response dispatch table
    const GRAPHQL_RESPONSE_HANDLERS = Object.assign(Object.create(null), {
        featureFlagsEnabledGlobally: (val) => {
            if (settings.logLevel === 'verbose') {
                sessionState.latestGlobalFeatureFlags = val;
            }
        },
        currentUser: (user) => {
            if (!user || typeof user !== 'object' || settings.logLevel !== 'verbose') return;
            if (user.email || user.roles || user.enrolments) {
                sessionState.latestUserProfile = user;
            }
            if (user.featureFlags !== undefined || user.student || user.managedSchool) {
                sessionState.latestFeatureFlags = user.featureFlags !== undefined ? user.featureFlags : user;
            }
        },
        subsection: handleSubsectionNode,
        experimentGroup: (eg) => {
            if (eg && Array.isArray(eg.activities)) handleExperimentGroup(eg);
        },
        progressQuizGroup: (pg) => {
            if (pg && pg.id) handleProgressQuizGroup(pg);
        },
        spacedPracticeQuiz: handleSpacedPracticeQuiz,
        spacedPracticeQuizGroup: handleSpacedPracticeQuiz,
        videoLesson: handleVideoLesson,
        examHowToLesson: (ehl) => {
            if (ehl && ehl.id) handleExamHowToLesson(ehl);
        },
        examPaper: (ep) => {
            if (ep && ep.id) handleExamPaper(ep);
        },
        startExamPracticeSession: (seps) => {
            if (seps && seps.id) handleStartExamPracticeSession(seps);
        },
        examQuestion: (eq) => {
            if (eq && eq.id) analyzeQuestionNode(eq, { origin: 'exam_question' });
        },
        quizContent: (qc) => {
            if (qc && qc.id) analyzeQuestionNode(qc, { origin: 'standalone' });
        },
        standaloneQuestion: (sq) => {
            if (sq && sq.id) analyzeQuestionNode(sq, { origin: 'standalone' });
        },
    });
    for (let i = 0; i < ANSWER_RESPONSE_KEYS.length; i++) {
        const key = ANSWER_RESPONSE_KEYS[i];
        GRAPHQL_RESPONSE_HANDLERS[key] = (payload) => {
            if (payload) processAnswerMutationResponse(key, payload);
        };
    }

    function handleApiResponse(data) {
        if (!data || typeof data !== 'object') return;
        if (Array.isArray(data)) {
            for (let i = 0; i < data.length; i++) handleApiResponse(data[i]);
            return;
        }
        const d = data.data || data;
        if (!d || typeof d !== 'object') return;

        const keys = Object.keys(d);
        for (let i = 0; i < keys.length; i++) {
            const k = keys[i];
            const handler = GRAPHQL_RESPONSE_HANDLERS[k];
            if (handler) handler(d[k]);
        }
    }

    // Body rewriting helpers for timeSpent & percentWatched
    const KNOWN_QUESTION_OPS = new Set([
        'AnswerProgressQuizQuestion',
        'AnswerInVideoQuestion',
        'AnswerPreVideoQuestion',
        'AnswerDiagnosticQuestion',
        'AnswerSpacedPracticeQuizQuestion',
        'AnswerStrengthenQuizQuestion',
        'AnswerExamQuestion',
        'SaveExamQuestionMarks',
        'SaveExamPracticeQuestionMarks',
    ]);

    const KNOWN_GROUP_OPS = new Set([
        'CompleteProgressQuizGroup',
        'CompleteSpacedPracticeQuiz',
        'CompleteStrengthenQuiz',
        'CompleteDiagnosticQuizSession',
        'CompleteExamQuestionWalkthrough',
        'CompleteExamPracticeSession',
        'SaveExamPracticeAnswers',
    ]);

    const KNOWN_LESSON_OPS = new Set([
        'CompleteVideoLesson',
        'CompleteSubsectionSummary',
        'CompleteArticleLesson',
    ]);

    function isQuestionAnswerOp(opName, qStr) {
        if (KNOWN_QUESTION_OPS.has(opName)) return true;
        if (OP_ANSWER_QUESTION_RE.test(opName)) return true;
        if (OP_SAVE_EXAM_RE.test(opName)) return true;
        if (qStr) {
            if (QSTR_ANSWER_QUESTION_RE.test(qStr)) return true;
            if (QSTR_SAVE_EXAM_RE.test(qStr)) return true;
        }
        return false;
    }

    function isQuizGroupOp(opName, qStr) {
        if (KNOWN_GROUP_OPS.has(opName)) return true;
        if (OP_COMPLETE_GROUP_RE.test(opName)) return true;
        if (qStr && QSTR_COMPLETE_GROUP_RE.test(qStr)) return true;
        return false;
    }

    function isLessonCompletionOp(opName, qStr) {
        if (KNOWN_LESSON_OPS.has(opName)) return true;
        if (OP_COMPLETE_LESSON_RE.test(opName)) return true;
        if (qStr && QSTR_COMPLETE_LESSON_RE.test(qStr)) return true;
        return false;
    }

    function resolveTimeField(vars) {
        if (vars.timeSpent != null) return 'timeSpent';
        if (vars.timeSpentAnswering != null) return 'timeSpentAnswering';
        if (vars.timeSpentMarking != null) return 'timeSpentMarking';
        return null;
    }

    function formatUpdatedDuration(rawVal, newTotal) {
        if (typeof rawVal === 'string') {
            const c0 = rawVal.charCodeAt(0);
            return (c0 === 80 || c0 === 112) ? toIso(newTotal) : String(round3(newTotal));
        }
        return typeof rawVal === 'number' ? round3(newTotal) : String(round3(newTotal));
    }

    function computeManualExtra(questionDesc, origSeconds, opName, qStr) {
        if (settings.manualTimeStacksWithAuto && settings.timeBoostEnabled) {
            const autoExtra = settings.dynamicTimeEnabled
                ? computeDynamicExtraSeconds(questionDesc, origSeconds, opName, qStr)
                : pickExtraSeconds();
            return sessionState.queuedSeconds + autoExtra;
        }
        return sessionState.queuedSeconds;
    }

    function estimateArticleDurationSeconds() {
        try {
            if (typeof document !== 'undefined' && typeof document.querySelector === 'function') {
                const el = document.querySelector('main, article, [class*="article"], #react-content');
                if (el && el.textContent) {
                    const words = countWords(el.textContent);
                    if (words > 20) return Math.min(420, Math.max(45, Math.ceil(words / 3.0)));
                }
            }
        } catch {}
        return 0;
    }

    function completeSessionAccumulators(sessionToComplete) {
        if (sessionToComplete) {
            sessionToComplete.completed = true;
            sessionToComplete.totalExtraQuestionSeconds = 0;
            sessionToComplete.totalSubmittedQuestionSeconds = 0;
        }
        sessionState.accumulatedExtraSeconds = 0;
        sessionState.accumulatedQuestionCount = 0;
    }

    function applyPercentWatched(vars) {
        if (!settings.fullVideoWatchedEnabled || vars.percentWatched === undefined) return false;
        const beforePercent = vars.percentWatched;
        const targetPercent = (typeof beforePercent === 'string') ? '1' : 1;
        if (beforePercent !== targetPercent) {
            vars.percentWatched = targetPercent;
            bumpStat('videosMaxed');
            return true;
        }
        return false;
    }

    function resolveLessonDuration(lessonId, isVideo, isArticle, session) {
        let knownDur = (lessonId && sessionState.knownLessonDurations.get(lessonId)) || 0;
        if (knownDur <= 0 && session && (!lessonId || session.sessionId === lessonId)) {
            knownDur = session.durationSeconds || 0;
        }
        const curVid = videoState.currentVideoLesson;
        if (isVideo) {
            if (knownDur <= 0 && curVid && (curVid.id === lessonId || !lessonId)) {
                knownDur = curVid.duration || 0;
            }
            if (knownDur <= 0) {
                const activeVid = findActiveVideoElement();
                if (activeVid && isFinite(activeVid.duration) && activeVid.duration > 0) {
                    knownDur = Math.round(activeVid.duration);
                }
            }
            if (knownDur <= 0 && curVid && curVid.duration > 0) {
                knownDur = curVid.duration;
            }
        } else if (isArticle && knownDur <= 0) {
            knownDur = estimateArticleDurationSeconds();
        }
        return knownDur;
    }

    // Deduplicated helper for walkthrough answering & marking time fields
    function applyWalkthroughPhaseTime(vars, fieldName, sessionSubmitted, sessionExtra, opLabel, qDesc, allowManual) {
        if (vars[fieldName] == null) {
            return { delta: 0, changed: false, manualUsed: false };
        }
        const rawVal = vars[fieldName];
        const origVal = parseDurationToSeconds(rawVal);
        if (origVal === null) {
            return { delta: 0, changed: false, manualUsed: false };
        }

        let targetVal = origVal;
        if (sessionSubmitted > 0) {
            targetVal = origVal + (sessionExtra || 0);
            if (settings.predictFinalCallEnabled !== false) {
                targetVal = Math.max(targetVal, sessionSubmitted);
            }
        } else if (settings.timeBoostEnabled) {
            const extra = settings.dynamicTimeEnabled
                ? computeDynamicExtraSeconds(qDesc, origVal, opLabel, '')
                : pickExtraSeconds();
            targetVal = origVal + extra;
        }

        let manualUsed = false;
        if (allowManual && sessionState.queuedSeconds !== null) {
            targetVal += computeManualExtra(qDesc, origVal, opLabel, '');
            manualUsed = true;
        }

        targetVal = round3(targetVal);
        if (targetVal > origVal) {
            vars[fieldName] = formatUpdatedDuration(rawVal, targetVal);
            return { delta: targetVal - origVal, changed: true, manualUsed };
        }
        return { delta: 0, changed: false, manualUsed };
    }

    function patchWalkthroughOp(vars, opName, qStr, source) {
        let changed = false;
        let manualResetNeeded = false;
        const lessonId = String(vars.lessonId || '');
        const qDesc = lookupQuestion(lessonId) || identifyCurrentQuestion();
        const curSession = sessionState.activeSession;
        const matchSession = (curSession && curSession.sessionType === 'ExamQuestionWalkthrough' && (!lessonId || curSession.sessionId === lessonId))
            ? curSession
            : null;

        let vidDuration = (lessonId && sessionState.knownLessonDurations.get(lessonId)) || (matchSession ? matchSession.durationSeconds : 0) || 0;
        if (vidDuration <= 0) {
            const activeVid = findActiveVideoElement();
            if (activeVid && isFinite(activeVid.duration) && activeVid.duration > 0) {
                vidDuration = Math.round(activeVid.duration);
            }
        }

        let totalAdded = 0;
        const ansRes = applyWalkthroughPhaseTime(
            vars,
            'timeSpentAnswering',
            matchSession ? matchSession.answeringSubmittedSeconds : 0,
            matchSession ? matchSession.answeringExtraSeconds : 0,
            'AnswerExamQuestion',
            qDesc,
            vars.timeSpentMarking == null
        );
        if (ansRes.changed) {
            totalAdded += ansRes.delta;
            changed = true;
        }
        if (ansRes.manualUsed) manualResetNeeded = true;

        const markRes = applyWalkthroughPhaseTime(
            vars,
            'timeSpentMarking',
            matchSession ? matchSession.markingSubmittedSeconds : 0,
            matchSession ? matchSession.markingExtraSeconds : 0,
            'SaveExamQuestionMarks',
            qDesc,
            !ansRes.manualUsed
        );
        if (markRes.changed) {
            totalAdded += markRes.delta;
            changed = true;
        }
        if (markRes.manualUsed) manualResetNeeded = true;

        if (settings.addVideoDurationToTimeSpent && vidDuration > 0) {
            if (vars.timeSpentWatching != null) {
                const rawWatch = vars.timeSpentWatching;
                const origWatch = parseDurationToSeconds(rawWatch) || 0;
                vars.timeSpentWatching = formatUpdatedDuration(rawWatch, origWatch + vidDuration);
                bumpStat('videoTimeAdded', vidDuration);
                changed = true;
            } else if (!qStr || qStr.includes('$timeSpentWatching')) {
                vars.timeSpentWatching = toIso(vidDuration);
                bumpStat('videoTimeAdded', vidDuration);
                changed = true;
            }
        }

        if (applyPercentWatched(vars)) {
            changed = true;
        }

        if (totalAdded > 0) {
            bumpStat('groupExtra', round3(totalAdded));
        }
        if (changed) {
            bumpStat('seen');
            bumpStat('finalCallsModified');
            LOG(`[${source}] CompleteExamQuestionWalkthrough synced: ans=${vars.timeSpentAnswering}, mark=${vars.timeSpentMarking}, watch=${vars.timeSpentWatching}, pct=${vars.percentWatched}`);
        }
        completeSessionAccumulators(matchSession);
        bumpContextRevision();
        return { changed, manualResetNeeded };
    }

    function patchLessonCompletionOp(vars, opName, qStr, source) {
        let changed = false;
        let manualResetNeeded = false;
        const isVideo = opName === VIDEO_OP || qStr.includes(VIDEO_OP) || qStr.includes('completeVideoLesson');
        const isSummary = opName === 'CompleteSubsectionSummary' || qStr.includes('completeSubsectionSummary');
        const isArticle = opName === 'CompleteArticleLesson' || qStr.includes('completeArticleLesson');
        const lessonId = String(vars.lessonId || vars.subsectionSummaryId || '');
        const displayOp = opName || (isVideo ? VIDEO_OP : (isSummary ? 'CompleteSubsectionSummary' : 'CompleteArticleLesson'));
        const curSession = sessionState.activeSession;

        let lessonTouched = false;

        if ((isVideo || isSummary) && settings.fullVideoWatchedEnabled && vars.percentWatched !== undefined) {
            const beforePercent = vars.percentWatched;
            if (applyPercentWatched(vars)) {
                lessonTouched = true;
                changed = true;
                LOG(`[${source}] ${displayOp}: percentWatched ${beforePercent} → ${vars.percentWatched} (id: ${lessonId || 'unknown'})`);
            }
        }

        const knownDur = resolveLessonDuration(lessonId, isVideo, isArticle, curSession);
        const rawTimeSpent = vars.timeSpent;
        const origTimeSpent = (typeof rawTimeSpent === 'number' && isFinite(rawTimeSpent))
            ? rawTimeSpent
            : (parseDurationToSeconds(rawTimeSpent) || 0);

        let extraTime = 0;
        if ((isVideo || isSummary) && settings.addVideoDurationToTimeSpent && knownDur > 0) {
            extraTime += knownDur;
        } else if (isArticle && settings.timeBoostEnabled) {
            extraTime += (knownDur > 0)
                ? knownDur
                : (settings.dynamicTimeEnabled ? computeDynamicExtraSeconds(null, origTimeSpent, displayOp, qStr) : pickExtraSeconds());
        }

        const matchVidSession = (isVideo && curSession && curSession.sessionType === 'VideoLesson' && (!lessonId || curSession.sessionId === lessonId))
            ? curSession
            : null;
        if (isVideo && settings.predictFinalCallEnabled !== false) {
            const qExtra = matchVidSession ? (matchVidSession.totalExtraQuestionSeconds || 0) : sessionState.accumulatedExtraSeconds;
            if (qExtra > 0) {
                extraTime += qExtra;
            }
        }

        if (sessionState.queuedSeconds !== null) {
            extraTime += computeManualExtra(null, origTimeSpent, displayOp, qStr);
            manualResetNeeded = true;
        }

        let newTimeSpent = round3(origTimeSpent + extraTime);
        if (matchVidSession && settings.predictFinalCallEnabled !== false && matchVidSession.totalSubmittedQuestionSeconds > 0) {
            const floorTotal = round3(matchVidSession.totalSubmittedQuestionSeconds + (settings.addVideoDurationToTimeSpent ? knownDur : 0));
            if (newTimeSpent < floorTotal) {
                newTimeSpent = floorTotal;
            }
        }

        if (rawTimeSpent !== undefined && newTimeSpent > origTimeSpent) {
            vars.timeSpent = formatUpdatedDuration(rawTimeSpent, newTimeSpent);

            if ((isVideo || isSummary) && settings.addVideoDurationToTimeSpent && knownDur > 0) {
                bumpStat('videoTimeAdded', knownDur);
            }
            lessonTouched = true;
            changed = true;

            const deltaLogged = round3(newTimeSpent - origTimeSpent);
            LOG(`[${source}] ${displayOp}: timeSpent ${rawTimeSpent} (+${formatSeconds(deltaLogged)}) → ${vars.timeSpent} (id: ${lessonId || 'unknown'})`);
        }

        if (lessonTouched) {
            bumpStat('seen');
            bumpStat('finalCallsModified');
        }
        completeSessionAccumulators(curSession && (!lessonId || curSession.sessionId === lessonId) ? curSession : null);
        bumpContextRevision();
        return { changed, manualResetNeeded };
    }

    function patchQuizGroupOp(vars, timeField, opName, qStr, source, boostActive, predictActive) {
        let changed = false;
        let manualResetNeeded = false;
        const curSession = sessionState.activeSession;
        const isExamPracticeComplete = opName === 'CompleteExamPracticeSession' || qStr.includes('completeExamPracticeSession');
        const isSaveExamAnswers = opName === 'SaveExamPracticeAnswers' || qStr.includes('saveExamPracticeAnswers');

        if (isExamPracticeComplete && !timeField) {
            completeSessionAccumulators(curSession && curSession.sessionType === 'ExamPracticeSession' ? curSession : null);
            bumpContextRevision();
            return { changed, manualResetNeeded };
        }

        if (timeField && (boostActive || predictActive)) {
            const rawVal = vars[timeField];
            const total = parseDurationToSeconds(rawVal);
            if (total !== null) {
                const useSessionBonus = curSession && (curSession.totalExtraQuestionSeconds > 0 || curSession.totalSubmittedQuestionSeconds > 0);
                let bonus = useSessionBonus ? curSession.totalExtraQuestionSeconds : sessionState.accumulatedExtraSeconds;
                let isManual = false;

                if (bonus === 0 && settings.timeBoostEnabled && settings.predictFinalCallEnabled !== false) {
                    const activeQ = identifyCurrentQuestion();
                    bonus = settings.dynamicTimeEnabled
                        ? computeDynamicExtraSeconds(activeQ, total, opName, qStr)
                        : pickExtraSeconds();
                }

                if (sessionState.queuedSeconds !== null) {
                    isManual = true;
                    bonus += computeManualExtra(identifyCurrentQuestion(), total, opName, qStr);
                    manualResetNeeded = true;
                }

                if (bonus > 0) {
                    let finalTotal = round3(total + bonus);
                    if (settings.predictFinalCallEnabled !== false && curSession && curSession.totalSubmittedQuestionSeconds > 0) {
                        const minTotal = round3(curSession.totalSubmittedQuestionSeconds + Math.min(bonus, 12));
                        if (finalTotal < minTotal) finalTotal = minTotal;
                    }
                    const addedDelta = round3(finalTotal - total);
                    if (addedDelta > 0) {
                        vars[timeField] = formatUpdatedDuration(rawVal, finalTotal);
                        bumpStat('groupExtra', addedDelta);
                        bumpStat('finalCallsModified');
                        changed = true;
                        const count = sessionState.accumulatedQuestionCount;
                        LOG(`[${source}] ${opName || 'QuizGroup'}: ${rawVal} → ${vars[timeField]} ` +
                            `(+${addedDelta}s${count > 0 ? ` from ${count} question(s)` : ''}${isManual ? ' [manual]' : ''})`);
                        VLOG('group bonus applied; per-question accumulator reset', { bonus: addedDelta, count, opName });
                    }
                }
            }

            const prevAcc = sessionState.accumulatedExtraSeconds;
            if (curSession && isSaveExamAnswers) {
                sessionState.accumulatedExtraSeconds = 0;
                sessionState.accumulatedQuestionCount = 0;
                curSession.phase = 'answers_saved';
                updatePredictedFinalCall(curSession);
            } else {
                completeSessionAccumulators(curSession);
            }
            if (!changed && prevAcc > 0) notifyStatsChange();
            bumpContextRevision();
        }
        return { changed, manualResetNeeded };
    }

    function patchQuestionOp(vars, timeField, opName, qStr, source, isQuestion, identifiedQ) {
        let changed = false;
        let manualResetNeeded = false;
        const hasManual = sessionState.queuedSeconds !== null;
        if (!hasManual && !isQuestion && !KNOWN_LESSON_OPS.has(opName)) {
            return { changed, manualResetNeeded };
        }

        const rawVal = vars[timeField];
        const total = parseDurationToSeconds(rawVal);
        if (total === null) return { changed, manualResetNeeded };

        let extra = 0;
        const isManual = hasManual;
        if (hasManual) {
            extra = computeManualExtra(identifiedQ, total, opName, qStr);
            // Always reset manual override after consumption, including explicit +0s
            manualResetNeeded = true;
        } else if (settings.timeBoostEnabled) {
            extra = settings.dynamicTimeEnabled
                ? computeDynamicExtraSeconds(identifiedQ, total, opName, qStr)
                : pickExtraSeconds();
        } else {
            return { changed, manualResetNeeded };
        }

        if (extra > 0) {
            const newSubmitted = round3(total + extra);
            vars[timeField] = formatUpdatedDuration(rawVal, newSubmitted);
            sessionState.accumulatedExtraSeconds = round3(sessionState.accumulatedExtraSeconds + extra);
            sessionState.accumulatedQuestionCount += 1;

            if (identifiedQ) {
                identifiedQ.attempts = (identifiedQ.attempts || 0) + 1;
                identifiedQ.lastSubmittedTimeSeconds = newSubmitted;
                identifiedQ.lastExtraTimeSeconds = extra;
                identifiedQ.lastAnsweredAt = Date.now();
            }

            const curSession = sessionState.activeSession;
            if (curSession) {
                curSession.totalOriginalQuestionSeconds = round3((curSession.totalOriginalQuestionSeconds || 0) + total);
                curSession.totalExtraQuestionSeconds = round3((curSession.totalExtraQuestionSeconds || 0) + extra);
                curSession.totalSubmittedQuestionSeconds = round3((curSession.totalSubmittedQuestionSeconds || 0) + newSubmitted);

                if (opName === 'AnswerExamQuestion' || qStr.includes('answerExamQuestion')) {
                    curSession.answeringSubmittedSeconds = round3((curSession.answeringSubmittedSeconds || 0) + newSubmitted);
                    curSession.answeringExtraSeconds = round3((curSession.answeringExtraSeconds || 0) + extra);
                } else if (opName === 'SaveExamQuestionMarks' || qStr.includes('saveExamQuestionMarks')) {
                    curSession.markingSubmittedSeconds = round3((curSession.markingSubmittedSeconds || 0) + newSubmitted);
                    curSession.markingExtraSeconds = round3((curSession.markingExtraSeconds || 0) + extra);
                }
                updatePredictedFinalCall(curSession);
            }

            bumpStat('seen');
            bumpStat('boosted');
            if (isManual) {
                bumpStat('manualBoosted');
            }
            bumpContextRevision();
            changed = true;

            const displayOp = opName || 'Question';
            const qLabel = identifiedQ ? ` [${identifiedQ.primaryType}, rec ${identifiedQ.recommendedSeconds}s]` : '';
            if (isManual) {
                LOG(`[${source}] ${displayOp}${qLabel} (manual time): ${rawVal} (+${formatSeconds(sessionState.queuedSeconds)}${settings.manualTimeStacksWithAuto && settings.timeBoostEnabled ? ' + auto' : ''}) → ${vars[timeField]} ` +
                    `(accumulated ${sessionState.accumulatedExtraSeconds}s / ${sessionState.accumulatedQuestionCount} q)`);
            } else {
                LOG(`[${source}] ${displayOp}${qLabel}: ${rawVal} → ${vars[timeField]} ` +
                    `(+${extra}s, accumulated ${sessionState.accumulatedExtraSeconds}s / ${sessionState.accumulatedQuestionCount} q)`);
                VLOG('boost roll', {
                    opName: displayOp,
                    questionId: identifiedQ ? identifiedQ.id : null,
                    questionType: identifiedQ ? identifiedQ.primaryType : null,
                    dynamic: settings.dynamicTimeEnabled,
                    rolled: extra,
                    range: `[${settings.extraSecondsMin}–${settings.extraSecondsMax}]`,
                    newAccumulated: sessionState.accumulatedExtraSeconds,
                    questionCount: sessionState.accumulatedQuestionCount,
                });
            }
        }
        return { changed, manualResetNeeded };
    }

    function maybeBumpTimeSpent(body, source, fastOpName, dispatch) {
        if (typeof body !== 'string' || body.length > MAX_SCAN) return { body, changed: false };

        const boostActive = settings.timeBoostEnabled || sessionState.queuedSeconds !== null || sessionState.accumulatedExtraSeconds > 0;
        const videoActive = settings.fullVideoWatchedEnabled || settings.addVideoDurationToTimeSpent;
        const predictActive = settings.predictFinalCallEnabled !== false;
        if (!boostActive && !videoActive && !predictActive) return { body, changed: false };

        const resolvedDispatch = dispatch !== undefined
            ? dispatch
            : (fastOpName ? (OP_DISPATCH.get(fastOpName.toLowerCase()) || null) : null);
        if (resolvedDispatch) {
            if (!resolvedDispatch.timeSpent) return { body, changed: false };
        } else if (!TIME_SPENT_RE.test(body)) {
            return { body, changed: false };
        }

        let json;
        try { json = JSON.parse(body); }
        catch { return { body, changed: false }; }

        let changed = false;
        let manualResetNeeded = false;

        const patch = (obj) => {
            if (!obj || !obj.variables) return;
            const vars = obj.variables;

            const opName = obj.operationName || '';
            const qStr = typeof obj.query === 'string'
                ? obj.query
                : (typeof obj.mutation === 'string' ? obj.mutation : '');

            const isQuestion = isQuestionAnswerOp(opName, qStr);
            const identifiedQ = isQuestion ? identifyCurrentQuestion(vars, opName, qStr) : null;
            if (identifiedQ) {
                sessionState.lastSubmittedQuestionId = identifiedQ.id;
            }

            if (opName === 'CompleteExamQuestionWalkthrough' || qStr.includes('completeExamQuestionWalkthrough')) {
                const res = patchWalkthroughOp(vars, opName, qStr, source);
                if (res.changed) changed = true;
                if (res.manualResetNeeded) manualResetNeeded = true;
                return;
            }

            if (isLessonCompletionOp(opName, qStr)) {
                const res = patchLessonCompletionOp(vars, opName, qStr, source);
                if (res.changed) changed = true;
                if (res.manualResetNeeded) manualResetNeeded = true;
                return;
            }

            const timeField = resolveTimeField(vars);

            if (isQuizGroupOp(opName, qStr)) {
                const res = patchQuizGroupOp(vars, timeField, opName, qStr, source, boostActive, predictActive);
                if (res.changed) changed = true;
                if (res.manualResetNeeded) manualResetNeeded = true;
                return;
            }

            if (boostActive && timeField) {
                const res = patchQuestionOp(vars, timeField, opName, qStr, source, isQuestion, identifiedQ);
                if (res.changed) changed = true;
                if (res.manualResetNeeded) manualResetNeeded = true;
            }
        };

        if (Array.isArray(json)) json.forEach(patch);
        else patch(json);

        if (manualResetNeeded && sessionState.queuedSeconds !== null) {
            scheduleReset();
        }
        if (changed) {
            return { body: JSON.stringify(json), changed: true };
        }
        return { body, changed: false };
    }

    function rewriteBodyText(text) {
        return maybeBumpTimeSpent(text, 'rewriteBodyText').body;
    }

    // ============================================================
    // 12. VIDEO LESSON STATE & AUTO-SKIP PROGRESSION
    // ============================================================
    function throttleAutoSkip() {
        videoState.autoSkipThrottled = true;
        if (videoState.autoSkipThrottleTimer) clearTimeout(videoState.autoSkipThrottleTimer);
        videoState.autoSkipThrottleTimer = setTimeout(() => {
            videoState.autoSkipThrottleTimer = null;
            videoState.autoSkipThrottled = false;
        }, 1500);
    }

    function findActiveVideoElement() {
        try {
            const videos = document.querySelectorAll('video');
            for (let i = 0; i < videos.length; i++) {
                const v = videos[i];
                if (v && v.isConnected && (v.offsetWidth > 0 || v.offsetHeight > 0 || (isFinite(v.duration) && v.duration > 0))) {
                    return v;
                }
            }
            if (videos.length > 0 && videos[0].isConnected) return videos[0];

            const muxPlayers = document.querySelectorAll('mux-player');
            for (let i = 0; i < muxPlayers.length; i++) {
                const mp = muxPlayers[i];
                if (mp.shadowRoot) {
                    const sv = mp.shadowRoot.querySelector('video');
                    if (sv && sv.isConnected) return sv;
                }
                if (typeof mp.currentTime === 'number') return mp;
            }

            const wistiaPlayers = document.querySelectorAll('wistia-player, .wistia_embed');
            for (let i = 0; i < wistiaPlayers.length; i++) {
                const wp = wistiaPlayers[i];
                if (wp.shadowRoot) {
                    const sv = wp.shadowRoot.querySelector('video');
                    if (sv && sv.isConnected) return sv;
                }
                const inner = wp.querySelector('video');
                if (inner && inner.isConnected) return inner;
            }
        } catch (e) {
            WARN('findActiveVideoElement error', e);
        }
        return null;
    }

    function isElementVisible(el) {
        if (!el || !el.isConnected) return false;
        if (el.offsetParent !== null && el.offsetParent !== undefined) return true;
        if ((el.offsetWidth > 0) || (el.offsetHeight > 0)) return true;
        if (typeof el.getClientRects === 'function') {
            try {
                const rects = el.getClientRects();
                if (rects && rects.length > 0) return true;
            } catch {}
        }
        return false;
    }

    const QUIZ_ACTION_LABELS = new Set([
        'submit',
        'submit answer',
        'check',
        'check answer',
        'continue',
        'continue video',
        'resume',
        'resume video',
        'try again',
        'next',
        'next question',
    ]);

    const QUESTION_SUBMIT_LABELS = new Set([
        'submit',
        'submit answer',
        'submit answers',
        'submit response',
        'check',
        'check answer',
        'check answers',
        'save',
        'save answer',
        'save answers',
        'save marks',
        'submit marks',
        'mark',
        'confirm',
        'confirm answer',
        'done',
    ]);

    const QUESTION_SUBMIT_RE  = /^(submit|check|save|confirm|mark)(\s+(answer|answers|marks|response|part))?$/i;
    const NON_SUBMIT_LABEL_RE = /search|find|filter|menu|login|sign|logout|cancel|close/i;

    function isSubmitLabel(txt) {
        return Boolean(txt) && (QUESTION_SUBMIT_LABELS.has(txt) || QUESTION_SUBMIT_RE.test(txt));
    }

    function isQuestionActiveOnPage() {
        try {
            if (uiState.lastResolvedSubmitBtn && uiState.lastResolvedSubmitBtn.isConnected && isCandidateSubmitButton(uiState.lastResolvedSubmitBtn)) {
                return true;
            }

            if (typeof document.querySelectorAll === 'function') {
                const modals = document.querySelectorAll('[role="dialog"], .quiz-content, [data-testid*="question"]');
                for (let i = 0; i < modals.length; i++) {
                    if (isElementVisible(modals[i])) return true;
                }

                const inputs = document.querySelectorAll('input[type="radio"], input[type="checkbox"]');
                for (let i = 0; i < inputs.length; i++) {
                    if (isElementVisible(inputs[i])) return true;
                }

                const buttons = document.querySelectorAll('button, [role="button"], input[type="submit"]');
                for (let i = 0; i < buttons.length; i++) {
                    const btn = buttons[i];
                    if (btn.id === MANUAL_BUTTON_ID) continue;
                    const txt = getCleanElementText(btn);
                    if (!txt) continue;
                    const submitMatch = isSubmitLabel(txt);
                    if ((submitMatch || QUIZ_ACTION_LABELS.has(txt)) && isElementVisible(btn)) {
                        if (submitMatch) uiState.lastResolvedSubmitBtn = btn;
                        return true;
                    }
                }
            }
        } catch {}
        return false;
    }

    const boundVideoElements = new WeakSet();

    function bindVideoEvents(video) {
        if (!video || boundVideoElements.has(video)) return;
        boundVideoElements.add(video);
        const triggerSkip = () => {
            if (settings.autoSkipVideoEnabled) checkAndAutoSkipVideo(false);
        };
        video.addEventListener('play', triggerSkip);
        video.addEventListener('loadedmetadata', triggerSkip);
    }

    function checkAndAutoSkipVideo(force = false) {
        if (!settings.autoSkipVideoEnabled && !force) return;
        if (videoState.autoSkipThrottled && !force) return;

        if (
            !force &&
            videoState.lastSkippedTarget === 'end-1s' &&
            videoState.lastActiveVideoElement &&
            videoState.lastActiveVideoElement.isConnected &&
            !videoState.lastActiveVideoElement.ended
        ) {
            return;
        }

        const video = findActiveVideoElement();
        if (!video || !video.isConnected || video.ended) return;

        if (video !== videoState.lastActiveVideoElement) {
            videoState.lastActiveVideoElement = video;
            videoState.lastSkippedTarget = null;
            // Light-DOM <video> events are already caught by document capture listeners;
            // only attach direct element listeners when the video lives inside a ShadowRoot.
            if (typeof video.getRootNode === 'function' && video.getRootNode() !== document) {
                bindVideoEvents(video);
            }
        }

        if (!force && (video.seeking || (typeof video.readyState === 'number' && video.readyState < 1))) {
            return;
        }

        const curVid = videoState.currentVideoLesson;
        const duration = (isFinite(video.duration) && video.duration > 0)
            ? video.duration
            : (curVid?.duration || 0);

        if (duration > 0 && curVid && curVid.duration <= 0) {
            curVid.duration = duration;
            if (curVid.id) {
                recordLessonDuration(curVid.id, duration);
            }
        }

        if (isQuestionActiveOnPage()) {
            return;
        }

        if (!force && videoState.waitingForPostAnswerResume) {
            if (video.paused || (Date.now() - videoState.lastQuestionAnsweredAt < 1500)) {
                return;
            }
            videoState.waitingForPostAnswerResume = false;
        }

        if (!force) {
            if (!curVid) return;
            if (
                curVid.uniqueCode &&
                typeof location !== 'undefined' &&
                location.pathname &&
                location.pathname.length > 1 &&
                !location.pathname.includes(curVid.uniqueCode)
            ) {
                return;
            }
        }

        const currentTime = video.currentTime || 0;

        if (duration > 2.0) {
            const target = Math.max(0, duration - 1.0);
            if (force || (currentTime < target - 0.2 && videoState.lastSkippedTarget !== 'end-1s')) {
                videoState.lastSkippedTarget = 'end-1s';
                throttleAutoSkip();

                LOG(`[autoSkip] Skipping straight to 1s before video ends (${formatSeconds(target)} / ${formatSeconds(duration)})`);
                try {
                    video.currentTime = target;
                    video.dispatchEvent(new Event('timeupdate', { bubbles: true }));
                    bumpStat('videosSkipped');
                    if (video.paused && typeof video.play === 'function') {
                        video.play().catch(() => {});
                    }
                    setTimeout(() => {
                        try {
                            if (video.currentTime >= duration - 0.5 && !video.ended && !isQuestionActiveOnPage()) {
                                video.dispatchEvent(new Event('ended', { bubbles: true }));
                            }
                        } catch {}
                    }, 1200);
                } catch (e) {
                    WARN('autoSkip completion seek failed', e);
                }
            }
        }
    }

    function onVideoMediaEvent(e) {
        if (!settings.autoSkipVideoEnabled) return;
        const el = (typeof e.composedPath === 'function' && e.composedPath()[0]) || e.target;
        const tag = el && el.tagName;
        if (tag === 'VIDEO' || tag === 'MUX-PLAYER' || tag === 'WISTIA-PLAYER') {
            checkAndAutoSkipVideo(false);
        }
    }

    function installVideoMediaListeners() {
        if (videoState.mediaListenersInstalled) return;
        videoState.mediaListenersInstalled = true;
        safeDocAdd('loadedmetadata', onVideoMediaEvent, true);
        safeDocAdd('play', onVideoMediaEvent, true);
        safeDocAdd('playing', onVideoMediaEvent, true);
    }

    function initVideoAutoSkipController() {
        installVideoMediaListeners();
        if (settings.autoSkipVideoEnabled) {
            checkAndAutoSkipVideo(false);
        }
    }

    // ============================================================
    // 13. MANUAL "ADD TIME" BUTTON (SINGLE-PASS FINDER & INLINE UI)
    // ============================================================
    const MANUAL_BUTTON_CSS = `
#${MANUAL_BUTTON_ID} {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    margin: 0 0 0 10px !important;
    padding: 0 16px;
    height: 40px;
    border-radius: 20px;
    border: none;
    background-color: var(--lg-glass, rgba(255, 255, 255, 0.72));
    -webkit-backdrop-filter: blur(18px) saturate(1.8);
    backdrop-filter: blur(18px) saturate(1.8);
    box-shadow: inset 0 0 0 0.5px var(--lg-edge, rgba(0, 0, 0, 0.08)), 0 1px 3px var(--lg-drop, rgba(0, 0, 0, 0.06));
    color: var(--lg-foreground, #1d1d1f);
    font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro", "Helvetica Neue", Helvetica, Arial, sans-serif;
    font-size: 14px;
    font-weight: 500;
    line-height: 1;
    cursor: pointer;
    white-space: nowrap;
    vertical-align: middle;
    user-select: none;
    outline: none;
    position: relative;
    overflow: hidden;
    transition: background-color 200ms ease, transform 150ms cubic-bezier(0.16, 1, 0.3, 1), box-shadow 200ms ease;
    box-sizing: border-box;
    min-width: 110px;
}
html.ul-dark-mode #${MANUAL_BUTTON_ID} {
    background-color: var(--lg-glass, rgba(40, 40, 40, 0.72));
    box-shadow: inset 0 0 0 0.5px var(--lg-edge, rgba(255, 255, 255, 0.12));
    color: var(--lg-foreground, #ffffff);
}
#${MANUAL_BUTTON_ID}::after {
    content: "";
    position: absolute;
    inset: 0;
    border-radius: inherit;
    pointer-events: none;
    background: radial-gradient(circle 200px at var(--lg-x, 50%) var(--lg-y, 50%), rgba(255, 255, 255, 0.14), rgba(255, 255, 255, 0.02) 60%, transparent);
    opacity: 0;
    transition: opacity 200ms ease-in-out;
}
#${MANUAL_BUTTON_ID}:hover {
    background-color: var(--lg-glass-active, rgba(236, 236, 240, 0.88));
    transform: translateY(-0.5px);
}
html.ul-dark-mode #${MANUAL_BUTTON_ID}:hover {
    background-color: var(--lg-glass-active, rgba(70, 70, 70, 0.72));
}
#${MANUAL_BUTTON_ID}:active {
    transform: scale(0.97);
    background-color: var(--lg-glass-active, rgba(220, 220, 226, 0.92));
}
html.ul-dark-mode #${MANUAL_BUTTON_ID}:active {
    background-color: var(--lg-glass-active, rgba(85, 85, 85, 0.78));
}
#${MANUAL_BUTTON_ID}:active::after {
    opacity: 1;
}
#${MANUAL_BUTTON_ID}.us-active {
    background-color: var(--ul-accent, #007aff) !important;
    color: #ffffff !important;
    box-shadow: 0 2px 10px color-mix(in srgb, var(--ul-accent, #007aff) 35%, transparent), inset 0 0 0 0.5px rgba(255, 255, 255, 0.25) !important;
}
#${MANUAL_BUTTON_ID}.us-error {
    background-color: #ff3b30 !important;
    color: #ffffff !important;
    box-shadow: 0 2px 10px rgba(255, 59, 48, 0.35), inset 0 0 0 0.5px rgba(255, 255, 255, 0.25) !important;
    animation: us-pop .35s ease;
}
#${MANUAL_BUTTON_ID}.us-editing {
    padding: 0;
    background-color: var(--lg-surface, rgba(255, 255, 255, 0.95));
    box-shadow: 0 0 0 2px var(--ul-accent, #007aff);
    cursor: text;
}
html.ul-dark-mode #${MANUAL_BUTTON_ID}.us-editing {
    background-color: var(--lg-surface, rgba(28, 28, 32, 0.95));
}
#${MANUAL_BUTTON_ID} input.us-input {
    border: none;
    outline: none;
    background: transparent;
    font: inherit;
    font-size: 14px;
    font-weight: 500;
    color: inherit;
    padding: 0 16px;
    height: 40px;
    width: 110px;
    text-align: center;
    box-sizing: border-box;
}
#${MANUAL_BUTTON_ID}.us-reset {
    animation: us-pop .35s ease;
}
@keyframes us-pop {
    0%   { transform: scale(1);    }
    40%  { transform: scale(1.06); }
    100% { transform: scale(1);    }
}
`;

    function injectButtonStyles() {
        if (document.getElementById(MANUAL_BUTTON_ID + '-style')) return;
        const style = document.createElement('style');
        style.id = MANUAL_BUTTON_ID + '-style';
        style.textContent = MANUAL_BUTTON_CSS;
        (document.head || document.documentElement).appendChild(style);
    }

    const cleanedTextCache = new WeakMap();

    function getCleanElementText(el) {
        if (!el) return '';
        if (el.tagName !== 'BUTTON' && el.childElementCount > 12) return '';
        const raw = el.textContent || el.value || (typeof el.getAttribute === 'function' ? el.getAttribute('aria-label') : '') || '';
        if (!raw) return '';
        const cached = wmGet.call(cleanedTextCache, el);
        if (cached && cached.raw === raw) return cached.cleaned;
        const cleaned = raw.trim().toLowerCase().replace(/\s+/g, ' ');
        wmSet.call(cleanedTextCache, el, { raw, cleaned });
        return cleaned;
    }

    function matchesSubmitCandidateFast(btn) {
        if (!btn || btn.id === MANUAL_BUTTON_ID) return false;
        const txt = getCleanElementText(btn);
        if (isSubmitLabel(txt)) return true;
        if (
            typeof btn.getAttribute === 'function' &&
            btn.getAttribute('type') === 'submit' &&
            txt.length > 0 &&
            txt.length < 30 &&
            !NON_SUBMIT_LABEL_RE.test(txt)
        ) {
            return true;
        }
        return false;
    }

    function isCandidateSubmitButton(btn) {
        if (!btn || !btn.isConnected || !matchesSubmitCandidateFast(btn)) return false;
        // Layout visibility check runs ONLY after fast tag/text checks confirm candidate status
        return isElementVisible(btn);
    }

    // Consolidated single-pass submit button finder with zero Set allocations
    // and zero layout reads on non-matching buttons.
    function findSubmitButton() {
        if (uiState.lastResolvedSubmitBtn && uiState.lastResolvedSubmitBtn.isConnected && isCandidateSubmitButton(uiState.lastResolvedSubmitBtn)) {
            return uiState.lastResolvedSubmitBtn;
        }

        const allButtons = document.querySelectorAll('button, input[type="submit"], [role="button"]');
        let fallbackCandidate = null;

        for (let i = 0; i < allButtons.length; i++) {
            const b = allButtons[i];
            if (!matchesSubmitCandidateFast(b)) continue;
            if (!isElementVisible(b)) continue;

            if (typeof b.closest === 'function' && b.closest('[role="dialog"], .quiz-content, [data-testid*="question"], [data-testid*="quiz"], .question')) {
                uiState.lastResolvedSubmitBtn = b;
                return b;
            }
            if (!fallbackCandidate) {
                fallbackCandidate = b;
            }
        }

        uiState.lastResolvedSubmitBtn = fallbackCandidate;
        return fallbackCandidate;
    }

    const stopPropagation = (e) => e.stopPropagation();

    function buildButtonContextSuffix() {
        const q = identifyCurrentQuestion();
        const session = sessionState.activeSession;
        const pred = session && session.predictedFinalCall;
        const parts = [];
        if (q) {
            const idxNum = (session && session.questionIds && session.questionIds.length > 0)
                ? (session.questionIds.indexOf(q.id) + 1) || ((session.currentQuestionIndex || 0) + 1)
                : 0;
            const totalQ = (session && session.questionIds) ? session.questionIds.length : 0;
            const prefix = (idxNum > 0 && totalQ > 0) ? `Q${idxNum}/${totalQ} ` : '';
            parts.push(`Active: ${prefix}${q.primaryType || 'Question'} (~${q.recommendedSeconds}s)`);
        }
        if (pred && pred.operationName) {
            parts.push(`Predicted final: ${pred.operationName}`);
        }
        return parts.length > 0 ? ` [${parts.join(' · ')}]` : '';
    }

    function updateLabel(btn, pulse) {
        if (sessionState.editing) return;
        btn = btn || document.getElementById(MANUAL_BUTTON_ID);
        if (!btn) return;

        const qSec = sessionState.queuedSeconds;
        const nextText = (qSec !== null) ? ('\u23F1 +' + formatSeconds(qSec)) : '\u23F1 Add time';
        if (btn.textContent !== nextText) {
            btn.textContent = nextText;
        }

        const nextActive = qSec !== null;
        if (btn.classList.contains('us-active') !== nextActive) {
            btn.classList.toggle('us-active', nextActive);
        }

        const baseTitle = (qSec !== null)
            ? 'Extra: +' + toIso(qSec) + ' (added on top of UpLearn\'s own timeSpent). Click to edit.'
            : 'Set extra time added on top of UpLearn\'s own timeSpent';
        if (btn.title !== baseTitle) {
            btn.title = baseTitle;
        }

        if (pulse) {
            if (sessionState.pulseTimer) clearTimeout(sessionState.pulseTimer);
            btn.classList.remove('us-reset');
            void btn.offsetWidth;
            btn.classList.add('us-reset');
            sessionState.pulseTimer = setTimeout(() => {
                sessionState.pulseTimer = null;
                btn.classList.remove('us-reset');
            }, 500);
        }
    }

    function enterEditMode() {
        const btn = document.getElementById(MANUAL_BUTTON_ID);
        if (!btn || sessionState.editing) return;

        if (sessionState.errorTimer) {
            clearTimeout(sessionState.errorTimer);
            sessionState.errorTimer = null;
            btn.classList.remove('us-error');
        }

        sessionState.editing = true;
        btn.classList.add('us-editing');
        btn.textContent = '';

        const input = document.createElement('input');
        input.type         = 'text';
        input.inputMode    = 'numeric';
        input.autocomplete = 'off';
        input.spellcheck   = false;
        input.className    = 'us-input';
        input.placeholder  = 'seconds';
        input.value        = sessionState.queuedSeconds !== null ? String(round3(sessionState.queuedSeconds)) : '';

        input.addEventListener('click',     stopPropagation);
        input.addEventListener('mousedown', stopPropagation);
        input.addEventListener('mouseup',   stopPropagation);
        input.addEventListener('keydown',   onInputKeyDown);
        input.addEventListener('blur',      onInputBlur);

        btn.appendChild(input);
        input.focus();
        input.select();
    }

    function onInputKeyDown(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            commitEdit(e.target.value);
        } else if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            cancelEdit();
        }
    }

    function onInputBlur(e) {
        if (!sessionState.editing) return;
        commitEdit(e.target.value);
    }

    function teardownInput() {
        sessionState.editing = false;
        const btn = document.getElementById(MANUAL_BUTTON_ID);
        if (!btn) return null;
        btn.classList.remove('us-editing');
        const input = btn.querySelector('input.us-input');
        if (input && input.parentNode === btn) btn.removeChild(input);
        return btn;
    }

    function commitEdit(rawValue) {
        if (!sessionState.editing) return;
        const btn = teardownInput();

        const raw = (rawValue || '').trim();

        if (!raw) {
            sessionState.queuedSeconds = null;
            if (sessionState.activeSession) updatePredictedFinalCall(sessionState.activeSession);
            bumpContextRevision();
            updateLabel();
            return;
        }

        const secs = parseDurationToSeconds(raw);
        if (secs == null || secs < 0) {
            WARN(`[timeSpent] Invalid manual duration "${raw}". Try seconds (e.g. 120), 1:30, 2m30s, or PT45S.`);
            if (btn) {
                btn.classList.add('us-error');
                btn.textContent = '⚠ Invalid';
                btn.title = `Could not parse "${raw}". Enter seconds (e.g. 120), 1:30, 2m30s, or PT45S.`;
                if (sessionState.errorTimer) clearTimeout(sessionState.errorTimer);
                sessionState.errorTimer = setTimeout(() => {
                    sessionState.errorTimer = null;
                    btn.classList.remove('us-error');
                    updateLabel(btn);
                }, 1600);
            }
            return;
        }

        sessionState.queuedSeconds = secs;
        if (sessionState.activeSession) updatePredictedFinalCall(sessionState.activeSession);
        bumpContextRevision();
        updateLabel(null, true);
        LOG(
            '[timeSpent] manual extra set to +' + formatSeconds(secs) +
            ' (' + toIso(secs) + ')'
        );
    }

    function cancelEdit() {
        if (!sessionState.editing) return;
        teardownInput();
        updateLabel();
    }

    function onButtonClick(e) {
        e.preventDefault();
        e.stopPropagation();
        if (sessionState.editing) return;
        enterEditMode();
    }

    function onButtonKeyDown(e) {
        if (sessionState.editing) return;
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            enterEditMode();
        }
    }

    function createButton() {
        const btn = document.createElement('div');
        btn.id = MANUAL_BUTTON_ID;
        btn.setAttribute('role', 'button');
        btn.setAttribute('tabindex', '0');
        btn.addEventListener('click',   onButtonClick,   true);
        btn.addEventListener('keydown', onButtonKeyDown, false);
        let btnRect = null;
        const refreshRect = () => { btnRect = btn.getBoundingClientRect(); };
        const updateTitleWithContext = () => {
            const qSec = sessionState.queuedSeconds;
            const baseTitle = (qSec !== null)
                ? 'Extra: +' + toIso(qSec) + ' (added on top of UpLearn\'s own timeSpent). Click to edit.'
                : 'Set extra time added on top of UpLearn\'s own timeSpent';
            btn.title = baseTitle + buildButtonContextSuffix();
        };
        btn.addEventListener('pointerenter', () => { refreshRect(); updateTitleWithContext(); });
        btn.addEventListener('focus', updateTitleWithContext);
        btn.addEventListener('pointerdown', refreshRect);
        btn.addEventListener('pointerleave', () => { btnRect = null; });
        btn.addEventListener('pointermove', (e) => {
            const r = btnRect || (btnRect = btn.getBoundingClientRect());
            if (!r.width || !r.height) return;
            btn.style.setProperty('--lg-x', `${((e.clientX - r.left) / r.width) * 100}%`);
            btn.style.setProperty('--lg-y', `${((e.clientY - r.top) / r.height) * 100}%`);
        });
        return btn;
    }

    function removeButton() {
        const mine = document.getElementById(MANUAL_BUTTON_ID);
        if (mine && mine.isConnected) mine.remove();
        sessionState.editing = false;
    }

    function clearManualButtonState() {
        if (uiState.manualBtnTimer !== null) {
            clearTimeout(uiState.manualBtnTimer);
            uiState.manualBtnTimer = null;
        }
        uiState.lastResolvedSubmitBtn = null;
        removeButton();
        sessionState.queuedSeconds = null;
        sessionState.editing = false;
    }

    function ensureButton() {
        if (!settings.manualTimeButtonEnabled) {
            clearManualButtonState();
            return;
        }

        const submit = findSubmitButton();
        if (!submit) {
            if (!sessionState.editing) {
                removeButton();
            }
            return;
        }

        injectButtonStyles();

        let mine = document.getElementById(MANUAL_BUTTON_ID);
        if (mine && mine.isConnected && submit.nextElementSibling === mine) {
            updateLabel(mine);
            return;
        }

        if (sessionState.editing) return;
        if (!mine) mine = createButton();

        if (submit.parentNode) {
            submit.parentNode.insertBefore(mine, submit.nextSibling);
        }
        updateLabel(mine);
    }

    function scheduleReset() {
        if (sessionState.resetScheduled) return;
        sessionState.resetScheduled = true;
        setTimeout(() => {
            sessionState.queuedSeconds = null;
            sessionState.resetScheduled = false;
            if (sessionState.activeSession) updatePredictedFinalCall(sessionState.activeSession);
            bumpContextRevision();
            updateLabel();
        }, 0);
    }

    // ============================================================
    // 14. NETWORK INTERCEPTORS (FETCH, XHR, SENDBEACON)
    // ============================================================
    const origFetch = window.fetch;
    const JSON_OK_INIT = {
        status: 200,
        statusText: 'OK',
        headers: { 'Content-Type': 'application/json' },
    };

    function withCapturedFetchBody(input, init, onBody, onFallback) {
        if (settings.logLevel === 'silent') return onBody(null);
        const bodyStr = init && init.body != null ? extractSyncBodyText(init.body) : null;
        if (bodyStr == null && typeof Request !== 'undefined' && input instanceof Request) {
            try {
                const ct = (input.headers.get('content-type') || '').toLowerCase();
                if (ct.includes('application/json') || ct.includes('text/')) {
                    const cl = Number(input.headers.get('content-length'));
                    if (!cl || cl <= MAX_SCAN) {
                        return input.clone().text().then(onBody, onFallback || (() => onBody(null)));
                    }
                }
            } catch {}
        }
        return onBody(bodyStr);
    }

    function processFetchResponse(fetchPromise, url, reqKind = 'none') {
        if (reqKind === 'ingest') {
            fetchPromise.then((res) => {
                if (res && res.ok && typeof res.clone === 'function') {
                    res.clone().json().then(handleApiResponse).catch(() => {});
                }
            }).catch(() => {});
            return fetchPromise;
        }

        if (reqKind !== 'transform') {
            return fetchPromise;
        }

        return fetchPromise.then((res) => {
            try {
                if (res && res.ok && typeof res.clone === 'function') {
                    const cloned = res.clone();
                    if (typeof cloned.text === 'function') {
                        return cloned.text().then((rt) => {
                            const incoming = processIncomingApiPayload(rt, reqKind, 'fetch', url);
                            if (incoming.transformed) {
                                const newHeaders = new Headers();
                                res.headers.forEach((v, k) => {
                                    const lk = k.toLowerCase();
                                    if (lk !== 'content-encoding' && lk !== 'content-length') {
                                        newHeaders.set(k, v);
                                    }
                                });
                                newHeaders.set('content-type', 'application/json');
                                return new Response(incoming.text, {
                                    status: res.status,
                                    statusText: res.statusText,
                                    headers: newHeaders,
                                });
                            }
                            return res;
                        }).catch(() => res);
                    }
                }
            } catch (e) {
                WARN('fetch response processing error:', e);
            }
            return res;
        });
    }

    if (origFetch) {
        const patchedFetch = ({
            fetch(input, init = undefined) {
                const self = this;
                let url = '';
                let method = 'GET';
                let targetApi = false;
                let reqKind = 'none';
                let bodyChanged = false;
                try {
                    url = toUrlString(input);
                    method = ((init && init.method) || (typeof input === 'object' && input !== null && input.method) || 'GET').toUpperCase();

                    const anyMatch = matchAnyTelemetryService(url);
                    if (anyMatch) {
                        if (isServiceMatchBlocked(anyMatch)) {
                            bumpStat('blocked');
                            const isJitsu = anyMatch.key === 'jitsu';
                            return Promise.resolve(withCapturedFetchBody(input, init, (capturedBody) => {
                                if (isJitsu) {
                                    bumpStat('jitsuPackets');
                                    reportJitsuPacket('fetch · BLOCKED', url, capturedBody);
                                } else {
                                    reportBlock('fetch', url, { method, body: capturedBody }, anyMatch);
                                }
                                return new Response('{}', JSON_OK_INIT);
                            }));
                        }

                        if (anyMatch.key === 'jitsu') {
                            bumpStat('jitsuPackets');
                            return withCapturedFetchBody(
                                input,
                                init,
                                (capturedBody) => {
                                    reportJitsuPacket('fetch', url, capturedBody);
                                    return origFetch.call(self, input, init);
                                },
                                () => origFetch.call(self, input, init)
                            );
                        }

                        if (settings.logLevel === 'verbose' && !settings.telemetryServices[anyMatch.key]) {
                            reportAllow('fetch', url, `service "${anyMatch.label}" disabled in settings`);
                        }
                    } else {
                        targetApi = isTargetApi(url);
                        if (method === 'POST' && targetApi) {
                            bumpStat('apiPosts');
                            const hasInitBody = !!(init && init.body != null);
                            const body = hasInitBody ? extractSyncBodyText(init.body) : null;

                            if (!hasInitBody && typeof Request !== 'undefined' && input instanceof Request) {
                                const ct = (input.headers.get('content-type') || '').toLowerCase();
                                const cl = Number(input.headers.get('content-length'));
                                if (ct.includes('application/json') && (!cl || cl <= MAX_SCAN)) {
                                    const passInit = init;
                                    return input.clone().text().then((text) => {
                                        const out = processOutgoingApiPayload(text, url, 'fetch-Req');
                                        if (out.blocked) {
                                            return new Response(out.mocked.payload, JSON_OK_INIT);
                                        }
                                        const reqToFetch = out.changed
                                            ? new Request(input, { body: out.body, method: input.method })
                                            : input;
                                        const fetchPromise = origFetch.call(self, reqToFetch, passInit);
                                        return processFetchResponse(fetchPromise, url, out.reqKind);
                                    }, () => origFetch.call(self, input, passInit));
                                }
                            }

                            if (body != null) {
                                const out = processOutgoingApiPayload(body, url, 'fetch');
                                if (out.blocked) {
                                    return Promise.resolve(new Response(out.mocked.payload, JSON_OK_INIT));
                                }
                                reqKind = out.reqKind;
                                if (out.changed) {
                                    init = Object.assign({}, init, { body: reencodeBodyLike(init.body, out.body) });
                                    bodyChanged = true;
                                }
                            }
                        } else if (settings.logLevel === 'verbose' && targetApi) {
                            VLOG('API request (non-POST, passing through):', method, url);
                        }
                    }
                } catch (e) {
                    WARN('fetch interceptor error:', e);
                }

                let fetchPromise;
                if (bodyChanged || arguments.length === 2) {
                    fetchPromise = origFetch.call(self, input, init);
                } else if (arguments.length === 1) {
                    fetchPromise = origFetch.call(self, input);
                } else {
                    fetchPromise = reflectApply(origFetch, self, arguments);
                }
                if (targetApi) {
                    return processFetchResponse(fetchPromise, url, reqKind);
                }
                return fetchPromise;
            }
        }).fetch;
        window.fetch = cloak(patchedFetch, 'fetch');
        VLOG('fetch hook installed');
    }

    // XHR Interceptor
    const SPOOFED_XHR_PROPS = ['readyState', 'status', 'statusText', 'responseText', 'response'];
    function saveAndDefineSpoofedXHRProps(xhr, info, descs) {
        if (info) {
            info.spoofed = true;
            if (!info.savedDescs) {
                const saved = {};
                for (let i = 0; i < SPOOFED_XHR_PROPS.length; i++) {
                    const prop = SPOOFED_XHR_PROPS[i];
                    if (prop in descs) {
                        const prev = origGetOwnPropDesc(xhr, prop);
                        if (prev) saved[prop] = prev;
                    }
                }
                info.savedDescs = saved;
            }
        }
        origDefineProperties(xhr, descs);
    }

    function clearSpoofedXHRProps(xhr, info) {
        const saved = info && info.savedDescs;
        for (let i = 0; i < SPOOFED_XHR_PROPS.length; i++) {
            const prop = SPOOFED_XHR_PROPS[i];
            if (saved && saved[prop]) {
                try { origDefineProperty(xhr, prop, saved[prop]); } catch {}
            } else {
                try { delete xhr[prop]; } catch {}
            }
        }
    }

    function mockBlockedXHR(self, responseText, jsonFn, info, sentSeq) {
        saveAndDefineSpoofedXHRProps(self, info, {
            readyState:   { value: 4,            configurable: true },
            status:       { value: 200,          configurable: true },
            statusText:   { value: 'OK',         configurable: true },
            responseText: { value: responseText, configurable: true },
            response: {
                get() { return self.responseType === 'json' ? jsonFn() : responseText; },
                configurable: true,
            },
        });
        setTimeout(() => {
            if (info && info.seq !== sentSeq) return;
            try {
                self.dispatchEvent(new Event('readystatechange'));
                self.dispatchEvent(typeof ProgressEvent !== 'undefined' ? new ProgressEvent('load') : new Event('load'));
                self.dispatchEvent(typeof ProgressEvent !== 'undefined' ? new ProgressEvent('loadend') : new Event('loadend'));
            } catch {}
        }, 0);
    }

    function handleSyncTelemetryMatch(anyMatch, source, url, method, rawBody, allowBlock) {
        const silent = settings.logLevel === 'silent';
        if (allowBlock && isServiceMatchBlocked(anyMatch)) {
            const bodyStr = silent ? '' : describeBody(rawBody);
            if (anyMatch.key === 'jitsu') {
                bumpStat('jitsuPackets');
                if (!silent) reportJitsuPacket(`${source} · BLOCKED`, url, bodyStr);
            } else if (!silent) {
                const details = method ? { method, body: bodyStr } : { body: bodyStr };
                reportBlock(source, url, details, anyMatch);
            }
            bumpStat('blocked');
            return true;
        }

        if (anyMatch.key === 'jitsu') {
            bumpStat('jitsuPackets');
            if (!silent) reportJitsuPacket(source, url, describeBody(rawBody));
        } else if (settings.logLevel === 'verbose' && !settings.telemetryServices[anyMatch.key]) {
            reportAllow(source, url, `service "${anyMatch.label}" disabled in settings`);
        }
        return false;
    }

    const OrigXHR = window.XMLHttpRequest;
    const xhrInfoMap = new WeakMap();

    if (OrigXHR) {
        const origOpen = OrigXHR.prototype.open;
        const origSend = OrigXHR.prototype.send;
        const origAbort = OrigXHR.prototype.abort;

        const patchedOpen = ({
            open(method, url, async = undefined) {
                const prev = wmGet.call(xhrInfoMap, this);
                if (prev && prev.spoofed) clearSpoofedXHRProps(this, prev);
                wmSet.call(xhrInfoMap, this, {
                    method,
                    url: toUrlString(url),
                    seq: prev ? prev.seq + 1 : 1,
                    spoofed: false,
                    savedDescs: null,
                });
                if (arguments.length === 2) return origOpen.call(this, method, url);
                if (arguments.length === 3) return origOpen.call(this, method, url, async);
                return reflectApply(origOpen, this, arguments);
            }
        }).open;
        patchMethod(OrigXHR.prototype, 'open', patchedOpen, 'open');

        if (typeof origAbort === 'function') {
            const patchedAbort = ({
                abort() {
                    const info = wmGet.call(xhrInfoMap, this);
                    if (info) info.seq++;
                    if (arguments.length === 0) return origAbort.call(this);
                    return reflectApply(origAbort, this, arguments);
                }
            }).abort;
            patchMethod(OrigXHR.prototype, 'abort', patchedAbort, 'abort');
        }

        const patchedSend = ({
            send(body = undefined) {
                let bodyChanged = false;
                try {
                    const info = wmGet.call(xhrInfoMap, this);
                    const sentSeq = info ? info.seq : 0;
                    const method = (info && info.method ? String(info.method) : '').toUpperCase();
                    const url = (info && info.url) || '';

                    const anyMatch = matchAnyTelemetryService(url);
                    if (anyMatch) {
                        if (handleSyncTelemetryMatch(anyMatch, 'XHR', url, method, body, true)) {
                            mockBlockedXHR(this, '{}', () => ({}), info, sentSeq);
                            return;
                        }
                    } else if (isTargetApi(url)) {
                        if (method === 'POST') bumpStat('apiPosts');

                        const bodyText = extractSyncBodyText(body);
                        let reqKind = 'none';
                        if (bodyText !== null) {
                            const out = processOutgoingApiPayload(bodyText, url, 'XHR');
                            if (out.blocked) {
                                mockBlockedXHR(this, out.mocked.payload, out.mocked.json, info, sentSeq);
                                return;
                            }
                            reqKind = out.reqKind;
                            if (out.changed) {
                                body = reencodeBodyLike(body, out.body);
                                bodyChanged = true;
                            }
                        }

                        if (reqKind !== 'none') {
                            const selfXhr = this;
                            let xhrHandled = false;
                            const cleanupXhrListeners = function () {
                                try {
                                    selfXhr.removeEventListener('readystatechange', handleXhrResponse, true);
                                    selfXhr.removeEventListener('loadend', handleXhrResponse, true);
                                } catch {}
                            };
                            const handleXhrResponse = function () {
                                if (xhrHandled) return;
                                if (info && info.seq !== sentSeq) {
                                    xhrHandled = true;
                                    cleanupXhrListeners();
                                    return;
                                }
                                try {
                                    if (selfXhr.readyState === 4) {
                                        xhrHandled = true;
                                        cleanupXhrListeners();
                                        if (selfXhr.status === 200) {
                                            if (selfXhr.responseType === 'json') {
                                                if (selfXhr.response && typeof selfXhr.response === 'object') {
                                                    const res = transformParsedApiPayload(selfXhr.response, reqKind, 'XHR', url, true);
                                                    if (res.transformed) {
                                                        saveAndDefineSpoofedXHRProps(selfXhr, info, {
                                                            response: {
                                                                get() { return res.json; },
                                                                configurable: true,
                                                            },
                                                        });
                                                    }
                                                }
                                                return;
                                            }
                                            if (!selfXhr.responseType || selfXhr.responseType === 'text') {
                                                const incoming = processIncomingApiPayload(selfXhr.responseText, reqKind, 'XHR', url);
                                                if (incoming.transformed) {
                                                    const modifiedText = incoming.text;
                                                    const modifiedJson = incoming.json;
                                                    saveAndDefineSpoofedXHRProps(selfXhr, info, {
                                                        responseText: {
                                                            get() { return modifiedText; },
                                                            configurable: true,
                                                        },
                                                        response: {
                                                            get() {
                                                                return selfXhr.responseType === 'json' ? modifiedJson : modifiedText;
                                                            },
                                                            configurable: true,
                                                        },
                                                    });
                                                }
                                            }
                                        }
                                    }
                                } catch {
                                    cleanupXhrListeners();
                                }
                            };
                            this.addEventListener('readystatechange', handleXhrResponse, true);
                            this.addEventListener('loadend', handleXhrResponse, { once: true, capture: true });
                        }
                    }
                } catch (e) {
                    WARN('xhr interceptor error:', e);
                }
                if (bodyChanged) return origSend.call(this, body);
                if (arguments.length === 0) return origSend.call(this);
                if (arguments.length === 1) return origSend.call(this, body);
                return reflectApply(origSend, this, arguments);
            }
        }).send;
        patchMethod(OrigXHR.prototype, 'send', patchedSend, 'send');
        VLOG('XHR hook installed');
    }

    // sendBeacon Interceptor
    if (navigator.sendBeacon) {
        const origBeacon = navigator.sendBeacon;
        const patchedBeacon = ({
            sendBeacon(url, data = undefined) {
                try {
                    const urlStr = toUrlString(url);
                    const anyMatch = matchAnyTelemetryService(urlStr);
                    if (anyMatch) {
                        if (handleSyncTelemetryMatch(anyMatch, 'sendBeacon', urlStr, null, data, settings.blockSendBeacon)) {
                            return true;
                        }
                    } else if (isTargetApi(urlStr)) {
                        const bodyText = extractSyncBodyText(data);
                        if (bodyText) {
                            const mocked = interceptBlockedMutation(bodyText, urlStr, 'sendBeacon');
                            if (mocked) {
                                return true;
                            }
                        }
                    }
                } catch {}
                const navThis = this || navigator;
                if (arguments.length === 1) return origBeacon.call(navThis, url);
                if (arguments.length === 2) return origBeacon.call(navThis, url, data);
                return reflectApply(origBeacon, navThis, arguments);
            }
        }).sendBeacon;
        const navProto = typeof Navigator !== 'undefined' && Navigator.prototype ? Navigator.prototype : null;
        const beaconTarget = (navProto && !origGetOwnPropDesc(navigator, 'sendBeacon') && origGetOwnPropDesc(navProto, 'sendBeacon'))
            ? navProto
            : navigator;
        try {
            patchMethod(beaconTarget, 'sendBeacon', patchedBeacon, 'sendBeacon');
        } catch {
            navigator.sendBeacon = cloak(patchedBeacon, 'sendBeacon');
        }
        VLOG('sendBeacon hook installed');
    }

    // ============================================================
    // 15. VISIBILITY / FOCUS SPOOFING & AUTO-FULLSCREEN BLOCKER
    // ============================================================
    const ORIG_VIS = (() => {
        try {
            const d = (typeof Document !== 'undefined' && origGetOwnPropDesc(Document.prototype, 'visibilityState'))
                   || (typeof HTMLDocument !== 'undefined' && origGetOwnPropDesc(HTMLDocument.prototype, 'visibilityState'));
            return d && d.get ? d.get : null;
        } catch { return null; }
    })();
    const ORIG_HIDDEN = (() => {
        try {
            const d = (typeof Document !== 'undefined' && origGetOwnPropDesc(Document.prototype, 'hidden'))
                   || (typeof HTMLDocument !== 'undefined' && origGetOwnPropDesc(HTMLDocument.prototype, 'hidden'));
            return d && d.get ? d.get : null;
        } catch { return null; }
    })();
    const ORIG_HAS_FOCUS = typeof document.hasFocus === 'function' ? document.hasFocus : null;

    const VISIBILITY_PROPS = ['visibilityState', 'webkitVisibilityState', 'mozVisibilityState', 'msVisibilityState'];
    const HIDDEN_PROPS     = ['hidden', 'webkitHidden', 'mozHidden', 'msHidden'];

    const VISIBILITY_DESCS = VISIBILITY_PROPS.map((prop) => {
        const getterName = 'get ' + prop;
        const get = ({
            [getterName]() {
                return settings.spoofVisibility ? 'visible' : (ORIG_VIS ? ORIG_VIS.call(this) : 'visible');
            }
        })[getterName];
        cloak(get, getterName);
        return [prop, { get, enumerable: true, configurable: true }];
    });

    const HIDDEN_DESCS = HIDDEN_PROPS.map((prop) => {
        const getterName = 'get ' + prop;
        const get = ({
            [getterName]() {
                return settings.spoofVisibility ? false : (ORIG_HIDDEN ? ORIG_HIDDEN.call(this) : false);
            }
        })[getterName];
        cloak(get, getterName);
        return [prop, { get, enumerable: true, configurable: true }];
    });

    const SPOOFED_HAS_FOCUS = ({
        hasFocus() {
            return settings.spoofVisibility ? true : (ORIG_HAS_FOCUS ? ORIG_HAS_FOCUS.call(this || document) : true);
        }
    }).hasFocus;
    cloak(SPOOFED_HAS_FOCUS, 'hasFocus');

    function patchVisibilityProps() {
        try {
            const docProto = (typeof Document !== 'undefined' && Document.prototype) ? Document.prototype : null;
            const htmlDocProto = (typeof HTMLDocument !== 'undefined' && HTMLDocument.prototype) ? HTMLDocument.prototype : null;
            const targets = [docProto, htmlDocProto].filter(Boolean);

            for (let i = 0; i < VISIBILITY_DESCS.length; i++) {
                const [prop, desc] = VISIBILITY_DESCS[i];
                try { delete document[prop]; } catch {}
                for (let t = 0; t < targets.length; t++) {
                    try { origDefineProperty(targets[t], prop, desc); } catch {}
                }
            }
            for (let i = 0; i < HIDDEN_DESCS.length; i++) {
                const [prop, desc] = HIDDEN_DESCS[i];
                try { delete document[prop]; } catch {}
                for (let t = 0; t < targets.length; t++) {
                    try { origDefineProperty(targets[t], prop, desc); } catch {}
                }
            }
        } catch (e) { WARN('visibility patch failed', e); }
    }
    patchVisibilityProps();

    function installHasFocusPatch() {
        try {
            try { delete document.hasFocus; } catch {}
            if (typeof Document !== 'undefined' && Document.prototype && Document.prototype.hasFocus !== SPOOFED_HAS_FOCUS) {
                const desc = origGetOwnPropDesc(Document.prototype, 'hasFocus');
                patchMethod(Document.prototype, 'hasFocus', SPOOFED_HAS_FOCUS, 'hasFocus', desc ? desc.enumerable : true);
            }
        } catch {}
    }
    installHasFocusPatch();
    VLOG('visibility/focus spoofing installed (live-toggleable)');

    const SUPPRESSED_EVENTS = new Set([
        'visibilitychange', 'webkitvisibilitychange', 'mozvisibilitychange', 'msvisibilitychange',
        'blur', 'pagehide', 'freeze', 'resume'
    ]);

    // Internal hooks invoked before KILL stops propagation, so Glisse UI
    // press/drag cleanups always run even while spoofVisibility is active.
    const internalBlurListeners = new Set();
    const internalVisListeners  = new Set();
    function addInternalBlurListener(fn) {
        internalBlurListeners.add(fn);
        return () => internalBlurListeners.delete(fn);
    }
    function addInternalVisListener(fn) {
        internalVisListeners.add(fn);
        return () => internalVisListeners.delete(fn);
    }

    const __ul_seenKilled = new Set();
    const KILL = (e) => {
        if (e.type === 'blur' && e.currentTarget === window && (e.target === window || e.target === rawWin)) {
            for (const fn of internalBlurListeners) {
                try { fn(e); } catch {}
            }
        } else if (e.type === 'visibilitychange' && e.currentTarget === document) {
            for (const fn of internalVisListeners) {
                try { fn(e); } catch {}
            }
        }
        if (!settings.spoofVisibility) return;
        if (e.type === 'blur' || e.type === 'focusout') {
            if (
                e.target &&
                e.target !== window &&
                e.target !== rawWin &&
                e.target !== document &&
                e.target !== document.documentElement &&
                e.target !== document.body
            ) {
                return;
            }
        }
        if (settings.logLevel === 'verbose' && !setHas.call(__ul_seenKilled, e.type)) {
            setAdd.call(__ul_seenKilled, e.type);
            VLOG(`intercepted "${e.type}" event (further ${e.type}s will be silenced from logs)`);
        }
        if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
        if (typeof e.stopPropagation === 'function') e.stopPropagation();
    };

    ['visibilitychange', 'webkitvisibilitychange', 'mozvisibilitychange', 'msvisibilitychange', 'blur', 'focusout', 'pagehide', 'freeze'].forEach((evt) => {
        let winRegistered = false;
        try {
            safeWinAdd(evt, KILL, true);
            winRegistered = true;
        } catch {}
        if (evt === 'focusout' && winRegistered) return;
        try {
            safeDocAdd(evt, KILL, true);
        } catch {}
    });

    try {
        if (origProtoAdd) {
            const patchedAddEventListener = ({
                addEventListener(type, listener, options = undefined) {
                    if (settings.spoofVisibility &&
                        (this === window || this === rawWin || this === document || this == null) &&
                        setHas.call(SUPPRESSED_EVENTS, type)) {
                        VLOG(`suppressed "${type}" listener via EventTarget prototype`);
                        return;
                    }
                    if (arguments.length >= 2 && arguments.length <= 3) {
                        return origProtoAdd.call(this, type, listener, options);
                    }
                    return reflectApply(origProtoAdd, this, arguments);
                }
            }).addEventListener;
            patchMethod(EventTarget.prototype, 'addEventListener', patchedAddEventListener, 'addEventListener');
        }
    } catch {}

    function findPropertyDescriptor(obj, prop) {
        let cur = obj;
        while (cur) {
            try {
                const d = origGetOwnPropDesc(cur, prop);
                if (d) return d;
            } catch {}
            try { cur = origGetPrototypeOf(cur); } catch { break; }
        }
        return null;
    }

    ['onpagehide', 'onvisibilitychange', 'onblur', 'onfocusout'].forEach((prop) => {
        const getterName = 'get ' + prop;
        const setterName = 'set ' + prop;
        [window, document].forEach((target) => {
            try {
                const desc = findPropertyDescriptor(target, prop);
                let fallbackVal = null;
                const getter = ({
                    [getterName]() {
                        if (settings.spoofVisibility) return null;
                        if (desc && desc.get) return desc.get.call(this);
                        return fallbackVal;
                    }
                })[getterName];
                const setter = ({
                    [setterName](v) {
                        if (settings.spoofVisibility) {
                            VLOG(`suppressed assignment to "${prop}"`);
                            return;
                        }
                        if (desc && desc.set) desc.set.call(this, v);
                        else fallbackVal = v;
                    }
                })[setterName];
                cloak(getter, getterName);
                cloak(setter, setterName);
                origDefineProperty(target, prop, {
                    get: getter,
                    set: setter,
                    enumerable: desc ? desc.enumerable : true,
                    configurable: true,
                });
            } catch {}
        });
    });

    // Auto Fullscreen Blocker
    const FULLSCREEN_METHODS = [
        'requestFullscreen', 'webkitRequestFullscreen', 'webkitRequestFullScreen',
        'mozRequestFullScreen', 'msRequestFullscreen',
    ];
    const patchedFullscreenFns = new WeakSet();

    function installFullscreenBlocker() {
        FULLSCREEN_METHODS.forEach((name) => {
            const proto = Element.prototype;
            if (!proto[name] || wsHas.call(patchedFullscreenFns, proto[name])) return;
            const orig = proto[name];
            const wrapped = ({
                [name](options = undefined) {
                    if (settings.disableAutoFullscreen) {
                        bumpStat('fullscreenBlocked');
                        reportBlock('Fullscreen request', '(browser API)', {
                            element: this.tagName ? this.tagName.toLowerCase() : String(this),
                            method: name,
                        });
                        try {
                            if (document.fullscreenElement && document.exitFullscreen) {
                                document.exitFullscreen().catch(() => {});
                            }
                        } catch {}
                        return Promise.reject(new DOMException(
                            'Fullscreen request blocked by userscript',
                            'NotAllowedError'
                        ));
                    }
                    return reflectApply(orig, this, arguments);
                }
            })[name];
            wsAdd.call(patchedFullscreenFns, wrapped);
            try {
                patchMethod(proto, name, wrapped, name);
            } catch {
                proto[name] = cloak(wrapped, name);
            }
        });
    }
    installFullscreenBlocker();
    VLOG('fullscreen blocker installed');

    // ============================================================
    // 16. KEYBIND HELPERS
    // ============================================================
    const KEY_DISPLAY_MAP = {
        'ControlRight': 'Right Ctrl', 'ControlLeft': 'Left Ctrl',
        'ShiftRight': 'Right Shift', 'ShiftLeft': 'Left Shift',
        'AltRight': 'Right Alt', 'AltLeft': 'Left Alt',
        'MetaRight': 'Right Meta', 'MetaLeft': 'Left Meta',
        'Space': 'Space', 'Enter': 'Enter', 'NumpadEnter': 'Num Enter',
        'Tab': 'Tab', 'Backspace': 'Backspace', 'Delete': 'Delete',
        'Escape': 'Escape', 'ArrowUp': '↑', 'ArrowDown': '↓',
        'ArrowLeft': '←', 'ArrowRight': '→', 'Home': 'Home', 'End': 'End',
        'PageUp': 'Page Up', 'PageDown': 'Page Down', 'Insert': 'Insert',
        'CapsLock': 'Caps Lock', 'ScrollLock': 'Scroll Lock',
        'Pause': 'Pause', 'NumLock': 'Num Lock',
    };

    function formatKeyCode(code) {
        if (!code) return 'None';
        if (KEY_DISPLAY_MAP[code]) return KEY_DISPLAY_MAP[code];
        if (/^Key[A-Z]$/.test(code)) return code.slice(3);
        if (/^Digit\d$/.test(code)) return code.slice(5);
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
        const kb = { code: e.code, ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey, meta: e.metaKey };
        if (e.code === 'ControlLeft' || e.code === 'ControlRight') kb.ctrl  = false;
        if (e.code === 'ShiftLeft'   || e.code === 'ShiftRight')   kb.shift = false;
        if (e.code === 'AltLeft'     || e.code === 'AltRight')     kb.alt   = false;
        if (e.code === 'MetaLeft'    || e.code === 'MetaRight')    kb.meta  = false;
        return kb;
    }

    function matchesKeybind(e, kb) {
        if (!kb || !kb.code) return false;
        if (isModifierCode(kb.code)) return e.code === kb.code;
        return e.code === kb.code
            && !!e.ctrlKey  === !!kb.ctrl
            && !!e.shiftKey === !!kb.shift
            && !!e.altKey   === !!kb.alt
            && !!e.metaKey  === !!kb.meta;
    }

    // ============================================================
    // 17. ZERO-DEPENDENCY VANILLA DOM GLISSE ENGINE & CONTROL PANEL
    // ============================================================
    const POSITION_STYLES = {
        'bottom-right': { right: '15px', bottom: '15px', left: 'auto', top: 'auto' },
        'bottom-left':  { left: '15px',  bottom: '15px', right: 'auto', top: 'auto' },
        'top-right':    { right: '15px', top: '15px',    left: 'auto', bottom: 'auto' },
        'top-left':     { left: '15px',  top: '15px',    right: 'auto', bottom: 'auto' },
    };

    const QUICK_RANGE_PRESETS = [
        { label: '+15–30s (Quick)', min: 15, max: 30 },
        { label: '+30–90s (Balanced)', min: 30, max: 90 },
        { label: '+60–120s (Generous)', min: 60, max: 120 },
        { label: '+120–180s (Aggressive)', min: 120, max: 180 },
    ];

    const QUICK_COLOR_SWATCHES = [
        { name: 'Apple Blue',   hex: '#007aff' },
        { name: 'Apple Green',  hex: '#34c759' },
        { name: 'Apple Indigo', hex: '#5856d6' },
        { name: 'Apple Cyan',   hex: '#32ade6' },
        { name: 'Apple Orange', hex: '#ff9500' },
        { name: 'Apple Red',    hex: '#ff3b30' },
    ];

    const PRESET_OPTIONS = [
        { id: 'off', label: 'Off', desc: 'Allows all telemetry traffic without blocking' },
        { id: 'simple', label: 'Simple', desc: 'Silently blocks LogImproperUse only' },
        { id: 'harsh', label: 'Harsh', desc: 'Aggressive network & script suppression' },
        { id: 'custom', label: 'Custom', desc: 'Individually selected tracker blockers' },
    ];

    const PILL_MODE_OPTIONS = [
        { id: 'minimal', label: 'Settings Button Only', desc: 'Cleanest floating circle button (Default)' },
        { id: 'boost', label: 'Time Boost & Settings', desc: 'Shows active boost status & settings' },
        { id: 'compact', label: 'Compact Details', desc: 'Shows boost status & blocked network count' },
        { id: 'full', label: 'Full Details', desc: 'Shows full metrics and boosted questions' },
    ];

    const PILL_POS_OPTIONS = [
        { id: 'bottom-right', label: 'Bottom Right', desc: 'Floats in the bottom-right corner' },
        { id: 'bottom-left', label: 'Bottom Left', desc: 'Floats in the bottom-left corner' },
        { id: 'top-right', label: 'Top Right', desc: 'Floats in the top-right corner' },
        { id: 'top-left', label: 'Top Left', desc: 'Floats in the top-left corner' },
    ];

    const THEME_OPTIONS = [
        { id: 'dark', label: 'Dark', desc: 'Apple deep translucent dark glass' },
        { id: 'light', label: 'Light', desc: 'Apple pure frosted light glass' },
        { id: 'auto', label: 'Auto (System)', desc: 'Matches macOS / iOS system dark or light preference' },
    ];

    const LOG_LEVEL_OPTIONS = [
        { id: 'silent', label: 'Silent', desc: 'Mutes all console logs' },
        { id: 'normal', label: 'Normal', desc: 'Logs key operations and warnings' },
        { id: 'verbose', label: 'Verbose', desc: 'Full network packets and grouped reports' },
    ];

    const KEYBIND_ACTION_OPTIONS = [
        { id: 'toggle-pill', label: 'Toggle Floating Button', desc: 'Closes open settings first, then hides/shows the floating button' },
        { id: 'open-modal',  label: 'Open Settings Directly',  desc: 'Opens the Control Panel directly without showing the button' },
    ];

    const SETTINGS_TAB_ITEMS = [
        { value: 'telemetry', label: '🛡 Telemetry' },
        { value: 'timeboost', label: '⏱ Time Boost' },
        { value: 'preferences', label: '🎨 Preferences' },
        { value: 'stats', label: '📊 Statistics' },
    ];

    function getEffectiveTheme(thm) {
        const t = thm || settings.theme;
        if (t === 'auto') {
            try { return (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) ? 'light' : 'dark'; }
            catch { return 'dark'; }
        }
        return t;
    }

    let cachedHeroUIStyles = null;
    function getHeroUIStyles() {
        if (cachedHeroUIStyles !== null) return cachedHeroUIStyles;
        return (cachedHeroUIStyles = `
:where(:root, [data-theme="light"], .heroui-root[data-theme="light"]) {
  --lg-foreground: #1c1c1e;
  --lg-muted: #525257;
  --lg-glass: rgba(255, 255, 255, 0.65);
  --lg-glass-active: rgba(236, 236, 240, 0.88);
  --lg-edge: rgba(0, 0, 0, 0.08);
  --lg-drop: rgba(0, 0, 0, 0.06);
  --lg-selection: rgba(0, 0, 0, 0.1);
  --lg-lens: rgba(255, 255, 255, 0.3);
  --lg-surface: rgba(250, 250, 252, 0.90);
  --lg-surface-edge: rgba(0, 0, 0, 0.09);
  --lg-shadow: rgba(25, 25, 35, 0.14);
  --lg-highlight: rgba(60, 60, 67, 0.09);
  --lg-separator: rgba(60, 60, 67, 0.18);
  --lg-destructive: #ff383c;
  --lg-track: rgba(59, 59, 66, 0.3);
  --lg-rail: rgba(0, 0, 0, 0.1);
  --lg-on: #34c759;
  --lg-fill: #0088ff;
  --lg-ring: rgba(0, 0, 0, 0.4);
  --lg-blur: 1px;
  --lg-bezel: 8px;
  --lg-thickness: 16px;
  --lg-zoom: 1.02;
  --lg-rim-saturation: 1.6;
  --lg-refraction: 1.05;
  --lg-dialog-tint: rgba(240, 240, 246, 0.92);
  --lg-pill-tint: rgba(240, 240, 245, 0.82);
}

:where([data-theme="dark"], .heroui-root[data-theme="dark"]) {
  --lg-foreground: #ffffff;
  --lg-muted: #b8b8c2;
  --lg-glass: rgba(40, 40, 40, 0.65);
  --lg-glass-active: rgba(70, 70, 70, 0.65);
  --lg-edge: rgba(255, 255, 255, 0.09);
  --lg-drop: transparent;
  --lg-selection: rgba(255, 255, 255, 0.15);
  --lg-lens: rgba(255, 255, 255, 0.06);
  --lg-surface: rgba(18, 18, 22, 0.92);
  --lg-surface-edge: rgba(255, 255, 255, 0.14);
  --lg-shadow: rgba(0, 0, 0, 0.42);
  --lg-highlight: rgba(235, 235, 245, 0.14);
  --lg-separator: rgba(235, 235, 245, 0.20);
  --lg-destructive: #ff4245;
  --lg-track: rgba(235, 235, 245, 0.3);
  --lg-rail: rgba(255, 255, 255, 0.1);
  --lg-on: #30d158;
  --lg-fill: #0091ff;
  --lg-ring: rgba(255, 255, 255, 0.5);
  --lg-blur: 1px;
  --lg-bezel: 8px;
  --lg-thickness: 16px;
  --lg-zoom: 1.02;
  --lg-rim-saturation: 1.6;
  --lg-refraction: 1.05;
  --lg-dialog-tint: rgba(14, 14, 18, 0.88);
  --lg-pill-tint: rgba(18, 18, 22, 0.72);
}

/* Glass */
.lg-glass {
  position: relative;
  background-color: var(--lg-glass);
  background-image: var(--lg-rim, none);
  background-size: 100% 100%;
  -webkit-backdrop-filter: blur(var(--lg-blur, 1px)) var(--lg-filter, saturate(1.8));
  backdrop-filter: blur(var(--lg-blur, 1px)) var(--lg-filter, saturate(1.8));
  box-shadow:
    inset 0 0 0 0.5px var(--lg-edge),
    0 1px 3px var(--lg-drop);
}

.lg-glass::after {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: inherit;
  pointer-events: none;
  background: radial-gradient(
    circle 240px at var(--lg-x, 50%) var(--lg-y, 50%),
    rgb(255 255 255 / 0.035),
    rgb(255 255 255 / 0.025) 50%,
    transparent
  );
  opacity: 0;
  transition: opacity 220ms ease-in-out;
}

.lg-glass[data-pressed]::after {
  opacity: 1;
  transition-duration: 0s;
}

/* Button */
.lg-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  white-space: nowrap;
  flex-shrink: 0;
  gap: 8px;
  height: 34px;
  padding: 0 16px;
  border: 0.5px solid var(--lg-edge);
  border-radius: 17px;
  font: inherit;
  font-size: 12.5px;
  font-weight: 550;
  letter-spacing: -0.01em;
  box-sizing: border-box;
  color: var(--lg-foreground);
  background-color: var(--lg-highlight);
  box-shadow: 0 1px 2px var(--lg-drop);
  cursor: pointer;
  touch-action: manipulation;
  -webkit-tap-highlight-color: transparent;
  -webkit-touch-callout: none;
  user-select: none;
  -webkit-user-select: none;
  transition: background-color 140ms ease, border-color 140ms ease, transform 100ms ease, box-shadow 140ms ease;
}

.lg-button:hover {
  background-color: var(--lg-glass-active);
  border-color: rgba(255, 255, 255, 0.22);
  transform: translateY(-0.5px);
}

.lg-button:is(:active, [data-pressed]) {
  background-color: var(--lg-glass-active);
  transform: scale(0.98);
  transition-duration: 0s;
}

.lg-button[data-icon] {
  padding-left: 12px;
}

.lg-button[data-icon="only"] {
  width: 40px;
  height: 34px;
  min-width: 34px;
  padding: 0;
  border-radius: 17px;
}

.lg-button[data-destructive] {
  background-color: rgba(255, 59, 48, 0.12);
  border: 0.5px solid rgba(255, 59, 48, 0.35);
  color: var(--lg-destructive);
  font-weight: 590;
}

.lg-button[data-destructive]:hover {
  background-color: rgba(255, 59, 48, 0.22);
  border-color: rgba(255, 59, 48, 0.6);
  box-shadow: 0 2px 8px rgba(255, 59, 48, 0.2);
}

.lg-button[data-variant="filled"] {
  --lg-button-fill: var(--lg-tint, var(--accent, var(--lg-fill)));
  background-color: var(--lg-button-fill);
  border-color: transparent;
  color: #ffffff;
  box-shadow: 0 2px 6px color-mix(in srgb, var(--lg-button-fill) 35%, transparent);
}

.lg-button[data-variant="filled"]:hover {
  background-color: color-mix(in srgb, var(--lg-button-fill) 90%, #ffffff);
}

.lg-button > svg {
  flex: none;
  width: 20px;
  height: 20px;
}

.lg-button:disabled {
  background-color: var(--lg-glass);
  opacity: 0.35;
  cursor: default;
}

.lg-button:focus-visible,
.lg-tab:focus-visible,
.lg-switch:focus-visible,
.lg-menu-item:focus-visible {
  outline: 2px solid var(--lg-ring);
  outline-offset: 2px;
}

/* Tab bar */
.lg-tab-bar {
  --lg-tab-width: 84px;
  --lg-tab-height: 32px;
  --lg-lens-grow-x: 27px;
  --lg-lens-grow-y: 20px;
  position: relative;
  display: inline-flex;
  padding: 4px;
  border-radius: calc(var(--lg-tab-height) / 2 + 4px);
  touch-action: pan-y;
  -webkit-tap-highlight-color: transparent;
  user-select: none;
  -webkit-user-select: none;
}

.lg-tab-bar-glass {
  position: absolute;
  inset: 0;
  border-radius: inherit;
  pointer-events: none;
}

.lg-tab-bar-glass::before {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: radial-gradient(
    circle 260px at var(--lg-x, 20%) 50%,
    rgb(255 255 255 / 0.09),
    rgb(255 255 255 / 0.045) 60%,
    transparent
  );
  opacity: 0;
  transition: opacity 160ms ease;
}

.lg-tab-bar[data-lifted] .lg-tab-bar-glass::before {
  opacity: 1;
  transition-duration: 120ms;
}

.lg-tab,
.lg-tab-copy {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: var(--lg-tab-width);
  height: var(--lg-tab-height);
  padding: 0;
  border: 0;
  font: inherit;
  font-size: 14px;
  line-height: 1;
  white-space: nowrap;
  text-align: center;
  box-sizing: border-box;
}

.lg-tab {
  position: relative;
  z-index: 1;
  border-radius: calc(var(--lg-tab-height) / 2);
  color: var(--lg-muted);
  background: none;
  cursor: pointer;
  -webkit-touch-callout: none;
  transition: color 200ms ease;
}

.lg-tab:focus-visible {
  outline-offset: -2px;
}

@media (hover: hover) and (pointer: fine) {
  .lg-tab:hover {
    color: var(--lg-foreground);
  }
}

.lg-tab-lens,
.lg-tab-tint {
  position: absolute;
  top: 4px;
  left: 4px;
  width: var(--lg-tab-width);
  height: var(--lg-tab-height);
  border-radius: calc(var(--lg-tab-height) / 2);
  pointer-events: none;
  transform: translateX(calc(var(--lg-tab-width) * var(--lg-index, 0)));
  transition: opacity 140ms ease;
  will-change: transform;
}

.lg-tab-tint {
  z-index: 1;
  overflow: hidden;
  color: var(--lg-foreground);
}

.lg-tab-row {
  display: flex;
  height: 100%;
  transform: translateX(calc(var(--lg-tab-width) * var(--lg-index, 0) * -1));
  transform-origin: 0 0;
  will-change: transform;
}

.lg-tab-lens.lg-glass {
  z-index: 2;
  background-color: transparent;
  background-image: none;
  -webkit-backdrop-filter: none;
  backdrop-filter: none;
  box-shadow: none;
  transition: opacity 140ms ease, background-color 140ms ease;
}

.lg-tab-bar[data-lifted] .lg-tab-lens.lg-glass {
  background-color: var(--lg-lens);
  transition-duration: 100ms;
}

.lg-tab-lens::before {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: var(--lg-selection);
  transition: opacity 140ms ease;
}

.lg-tab-lens[data-pressed]::after {
  opacity: 0.2;
}

.lg-tab-bar[data-lifted] .lg-tab-lens::before {
  opacity: 0;
  transition-duration: 100ms;
}

.lg-tab-bar[data-refracting] .lg-tab-lens.lg-glass {
  background-image: var(--lg-rim, none);
  -webkit-backdrop-filter: var(--lg-filter, none);
  backdrop-filter: var(--lg-filter, none);
}

.lg-tab-bar[data-hidden] :is(.lg-tab-lens, .lg-tab-tint),
.lg-tab-bar:not([data-ready]):not(:has([data-selected])) :is(.lg-tab-lens, .lg-tab-tint) {
  opacity: 0;
}

/* Input */
.lg-input {
  display: flex;
  align-items: center;
  gap: 10px;
  box-sizing: border-box;
  width: 100%;
  max-width: 360px;
  height: 40px;
  padding: 0 14px;
  border-radius: 20px;
  color: var(--lg-foreground);
  transition: background-color 200ms ease;
}

.lg-input:focus-within {
  background-color: var(--lg-glass-active);
}

.lg-input input {
  flex: 1;
  min-width: 0;
  height: 100%;
  padding: 0;
  border: 0;
  outline: 0;
  color: inherit;
  background: none;
  font: inherit;
  font-size: 14px;
}

.lg-input input::placeholder {
  color: var(--lg-muted);
}

.lg-input input::-webkit-search-cancel-button {
  display: none;
}

.lg-input input[type="number"] {
  text-align: center;
  font-weight: 600;
  -moz-appearance: textfield;
}

.lg-input input[type="number"]::-webkit-outer-spin-button,
.lg-input input[type="number"]::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

.lg-input-icon {
  display: grid;
  place-items: center;
  flex: none;
  width: 16px;
  height: 16px;
  color: var(--lg-muted);
}

.lg-input-icon > svg {
  width: 100%;
  height: 100%;
}

.lg-input-clear {
  display: grid;
  flex: none;
  place-items: center;
  width: 32px;
  height: 32px;
  margin-right: -8px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  color: var(--lg-muted);
  background: none;
  cursor: pointer;
}

.lg-input-clear svg {
  width: 14px;
  height: 14px;
}

/* Switch and slider thumbs */
.lg-switch-thumb,
.lg-slider-thumb {
  position: absolute;
  border-radius: 999px;
  pointer-events: none;
  -webkit-backdrop-filter: blur(2px) brightness(1.15) saturate(1.5);
  backdrop-filter: blur(2px) brightness(1.15) saturate(1.5);
  box-shadow:
    0 6px 24px rgb(0 0 0 / 0.2),
    inset 0 0 0 1.5px rgb(255 255 255 / 0.5),
    inset 0 2px 1px rgb(255 255 255 / 0.45),
    inset 2px 7px 24px rgb(0 0 0 / 0.09),
    inset -2px -7px 24px rgb(255 255 255 / 0.16);
}

.lg-thumb-face {
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: #fff;
}

/* Switch */
.lg-switch {
  --lg-scale: 0.375;
  position: relative;
  flex: none;
  width: calc(160px * var(--lg-scale));
  height: calc(67px * var(--lg-scale));
  padding: 0;
  border: 0;
  border-radius: 999px;
  background: var(--lg-track);
  cursor: pointer;
  touch-action: pan-y;
  -webkit-tap-highlight-color: transparent;
  box-shadow:
    inset 0 1px 2px rgba(0, 0, 0, 0.25),
    inset 0 0 0 0.5px var(--lg-edge),
    0 1px 2px rgba(0, 0, 0, 0.08);
  transition: box-shadow 150ms ease, opacity 150ms ease;
}

.lg-switch:hover {
  box-shadow:
    inset 0 1px 2px rgba(0, 0, 0, 0.35),
    inset 0 0 0 0.5px rgba(255, 255, 255, 0.25),
    0 2px 6px rgba(0, 0, 0, 0.12);
}

.lg-switch::before {
  content: "";
  position: absolute;
  inset: min(0px, calc((67px * var(--lg-scale) - 44px) / 2)) -8px;
}

.lg-switch-fill {
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: var(--lg-on);
  opacity: 0;
}

.lg-switch-thumb {
  top: 50%;
  left: calc(-21.95px * var(--lg-scale));
  width: calc(146px * var(--lg-scale));
  height: calc(92px * var(--lg-scale));
  transform: translate(0, -50%) scale(0.65);
  box-shadow:
    0 3px 8px rgba(0, 0, 0, 0.22),
    inset 0 1px 1px rgba(255, 255, 255, 0.8),
    inset 0 -1px 1px rgba(0, 0, 0, 0.1),
    inset 0 0 0 0.5px rgba(255, 255, 255, 0.4);
  -webkit-backdrop-filter: blur(2px) saturate(1.3);
  backdrop-filter: blur(2px) saturate(1.3);
}

.lg-switch[aria-checked="true"] .lg-switch-fill {
  opacity: 1;
}

.lg-switch[aria-checked="true"] .lg-switch-thumb {
  transform: translate(calc(57.9px * var(--lg-scale)), -50%) scale(0.65);
}

.lg-switch:disabled {
  opacity: 0.35;
  cursor: default;
}

/* Slider */
.lg-slider {
  position: relative;
  width: 100%;
  height: 40px;
}

.lg-slider-track {
  position: absolute;
  inset: 17px 0 auto;
  height: 6px;
  overflow: hidden;
  border-radius: 3px;
  background: var(--lg-rail);
  pointer-events: none;
}

.lg-slider-fill {
  display: block;
  height: 100%;
  background: var(--accent, var(--lg-fill));
  transform: scaleX(var(--lg-progress));
  transform-origin: left;
}

.lg-slider-thumb {
  top: 0;
  left: calc((100% - 36px) * var(--lg-progress) - 12px);
  width: 60px;
  height: 40px;
  scale: 0.6;
}

.lg-slider input {
  position: relative;
  z-index: 1;
  display: block;
  width: 100%;
  height: 40px;
  margin: 0;
  background: transparent;
  outline: none;
  cursor: pointer;
  appearance: none;
  -webkit-appearance: none;
  touch-action: pan-y;
  -webkit-tap-highlight-color: transparent;
}

.lg-slider input::-webkit-slider-runnable-track,
.lg-slider input::-moz-range-track {
  height: 6px;
  background: transparent;
}

.lg-slider input::-webkit-slider-thumb {
  width: 36px;
  height: 40px;
  margin-top: -17px;
  border: 0;
  background: transparent;
  box-shadow: none;
  opacity: 0;
  touch-action: none;
  appearance: none;
  -webkit-appearance: none;
}

.lg-slider input::-moz-range-thumb {
  width: 36px;
  height: 40px;
  border: 0;
  background: transparent;
  box-shadow: none;
  opacity: 0;
}

.lg-slider:has(input:focus-visible) .lg-slider-thumb {
  outline: 2px solid var(--lg-ring);
  outline-offset: 3px;
}

/* Menu & Select Dropdown */
.lg-menu {
  position: relative;
  display: inline-flex;
}

.lg-menu-card {
  position: absolute;
  top: 0;
  right: 0;
  z-index: 100000;
  box-sizing: border-box;
  min-width: 240px;
  max-width: 340px;
  width: max-content;
  border-radius: 18px;
  color: var(--lg-foreground);
  font-size: 14px;
  transform-origin: calc(100% - 20px) 20px;
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
}

.lg-menu-card[data-phase="leaving"] {
  pointer-events: none;
}

.lg-menu-surface {
  position: absolute;
  top: 0;
  right: 0;
  width: 100%;
  height: 100%;
  border-radius: inherit;
  background: var(--lg-surface);
  -webkit-backdrop-filter: blur(28px) saturate(2);
  backdrop-filter: blur(28px) saturate(2);
  box-shadow:
    inset 0 0 0 0.5px var(--lg-surface-edge),
    0 20px 60px var(--lg-shadow);
  pointer-events: none;
  z-index: -1;
}

.lg-menu-content {
  position: relative;
  display: flex;
  flex-direction: column;
  padding: 6px;
}

.lg-menu-card::after {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: inherit;
  pointer-events: none;
  background: linear-gradient(135deg, rgb(255 255 255 / 0.11), rgb(255 255 255 / 0.025));
  opacity: 0;
  transition: opacity 120ms ease-out;
}

.lg-menu-card[data-pressed]::after {
  opacity: 1;
}

.lg-menu-plate {
  position: absolute;
  top: 0;
  left: 0;
  border-radius: 14px;
  background: var(--lg-highlight);
  opacity: 0;
  pointer-events: none;
  transition: transform 100ms cubic-bezier(0.2, 0.8, 0.2, 1), opacity 80ms ease-out;
}

.lg-menu-item {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-height: 38px;
  padding: 8px 12px;
  border: 0;
  border-radius: 12px;
  color: inherit;
  background: transparent;
  font: inherit;
  text-align: left;
  cursor: pointer;
  box-sizing: border-box;
}

.lg-menu-item:focus-visible {
  outline-offset: -2px;
  background: var(--lg-highlight);
}

@media (hover: hover) and (pointer: fine) {
  .lg-menu-item:hover {
    background: var(--lg-highlight);
  }
}

.lg-menu-card[data-scrubbing] .lg-menu-item {
  background: transparent;
  outline: none;
}

@media (prefers-reduced-motion: reduce) {
  .lg-menu-plate {
    transition: opacity 80ms ease-out;
  }
  .lg-menu-card {
    animation: lg-menu-fade 100ms ease-out;
  }
}

@keyframes lg-menu-fade {
  from { opacity: 0; }
}

/* ============================================================
   UpLearn Bypass Layout & App Styling (built on Glisse)
   ============================================================ */
:host, .heroui-root {
    font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "SF Pro", -system-ui, "Helvetica Neue", Helvetica, Arial, sans-serif;
    font-feature-settings: "cv02", "cv03", "cv04", "cv11";
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
    text-rendering: optimizeLegibility;
    box-sizing: border-box;
    color: var(--lg-foreground);
    --accent: var(--lg-fill);
}

*, *::before, *::after {
    box-sizing: inherit;
}

::-webkit-scrollbar {
    width: 6px;
    height: 6px;
}
::-webkit-scrollbar-track {
    background: transparent;
}
::-webkit-scrollbar-thumb {
    background: var(--lg-separator);
    border-radius: 9999px;
}
::-webkit-scrollbar-thumb:hover {
    background: var(--lg-muted);
}

/* Opacity-only backdrop dim avoids stacked full-screen backdrop-filter GPU cost */
.modal__backdrop {
    position: fixed;
    inset: 0;
    z-index: 2147483647;
    background: rgba(0, 0, 0, 0.48);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
    box-sizing: border-box;
    pointer-events: auto;
    animation: lg-fade-in 180ms cubic-bezier(0.16, 1, 0.3, 1) forwards;
}

.modal__backdrop--closing {
    pointer-events: none;
    animation: lg-fade-out 160ms cubic-bezier(0.4, 0, 0.2, 1) forwards;
}

.modal__backdrop--draggable {
    background: transparent;
    pointer-events: none;
}

@keyframes lg-fade-in {
    from { opacity: 0; }
    to { opacity: 1; }
}
@keyframes lg-fade-out {
    from { opacity: 1; }
    to { opacity: 0; }
}

.modal__container {
    display: flex;
    align-items: center;
    justify-content: center;
    width: min(940px, 95vw);
    height: min(700px, 88vh);
    min-height: 520px;
}

.modal__container--draggable {
    pointer-events: none;
    position: fixed;
    inset: 0;
    width: 100vw;
    height: 100vh;
    display: block;
    padding: 0;
}

.modal__dialog {
    width: 100%;
    height: 100%;
    border-radius: 24px;
    color: var(--lg-foreground);
    background-color: var(--lg-dialog-tint, rgba(14, 14, 18, 0.88));
    -webkit-backdrop-filter: blur(32px) saturate(1.8);
    backdrop-filter: blur(32px) saturate(1.8);
    border: 0.5px solid var(--lg-surface-edge, rgba(255, 255, 255, 0.14));
    box-shadow:
        inset 0 1px 1.5px 0 rgba(255, 255, 255, 0.20),
        inset 0 0 0 0.5px var(--lg-surface-edge, rgba(255, 255, 255, 0.14)),
        0 28px 72px rgba(0, 0, 0, 0.60),
        0 6px 24px rgba(0, 0, 0, 0.35);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    position: relative;
    animation: lg-scale-in 200ms cubic-bezier(0.16, 1, 0.3, 1) forwards;
}

.modal__dialog--draggable {
    pointer-events: auto;
    position: absolute;
    margin: 0;
    width: min(920px, 92vw);
    height: min(680px, 86vh);
    min-height: 480px;
    box-sizing: border-box;
    transition: none;
}

:where([data-theme="light"], .heroui-root[data-theme="light"]) .modal__dialog {
    background-color: var(--lg-dialog-tint, rgba(240, 240, 246, 0.92));
    border-color: rgba(0, 0, 0, 0.12);
    box-shadow:
        inset 0 1px 1.5px 0 rgba(255, 255, 255, 0.85),
        inset 0 0 0 0.5px rgba(255, 255, 255, 0.50),
        0 24px 64px rgba(20, 20, 30, 0.22),
        0 4px 16px rgba(20, 20, 30, 0.10);
}

.modal__dialog::before {
    content: "";
    position: absolute;
    inset: 0;
    border-radius: inherit;
    pointer-events: none;
    background: linear-gradient(
        135deg,
        rgba(255, 255, 255, 0.24) 0%,
        rgba(255, 255, 255, 0.08) 22%,
        rgba(255, 255, 255, 0.01) 50%,
        rgba(255, 255, 255, 0.06) 78%,
        rgba(255, 255, 255, 0.18) 100%
    );
    -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
    -webkit-mask-composite: xor;
    mask-composite: exclude;
    padding: 1px;
    z-index: 2;
}

.modal__backdrop--closing .modal__dialog {
    animation: lg-scale-out 160ms cubic-bezier(0.4, 0, 0.2, 1) forwards;
}

@keyframes lg-scale-in {
    from { opacity: 0; transform: scale(0.96) translateY(8px); }
    to { opacity: 1; transform: scale(1) translateY(0); }
}
@keyframes lg-scale-out {
    from { opacity: 1; transform: scale(1) translateY(0); }
    to { opacity: 0; transform: scale(0.97) translateY(6px); }
}

.modal__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 18px;
    border-bottom: 0.5px solid var(--lg-separator);
    flex-shrink: 0;
    gap: 16px;
    position: relative;
    z-index: 4;
}

.modal__header--draggable {
    cursor: grab;
    user-select: none;
    -webkit-user-select: none;
    touch-action: none;
}

.modal__header--draggable:active,
.modal__header--dragging {
    cursor: grabbing;
}

.modal__header--draggable .modal__header-nav,
.modal__header--draggable .lg-tab-bar,
.modal__header--draggable .lg-button,
.modal__header--draggable button {
    cursor: default;
    pointer-events: auto;
}

.modal__brand {
    display: flex;
    align-items: center;
    gap: 10px;
}

.modal__icon {
    width: 32px;
    height: 32px;
    border-radius: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: color-mix(in srgb, var(--accent, var(--lg-fill)) 18%, transparent);
    color: var(--accent, var(--lg-fill));
    flex-shrink: 0;
    box-shadow: inset 0 0 0 0.5px color-mix(in srgb, var(--accent, var(--lg-fill)) 30%, transparent);
}

.modal__heading {
    margin: 0;
    font-size: 15px;
    font-weight: 600;
    letter-spacing: -0.015em;
    color: var(--lg-foreground);
    white-space: nowrap;
}

.modal__header-nav {
    display: flex;
    align-items: center;
    justify-content: center;
    flex: 1;
}

.modal__body {
    position: relative;
    padding: 16px 20px 20px 20px;
    overflow: hidden;
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    z-index: 3;
}

.tabs__panel {
    display: none;
    flex-direction: column;
    gap: 14px;
    width: 100%;
    height: 100%;
    min-height: 0;
    overflow-y: auto;
    padding: 2px 6px 80px 2px;
    scrollbar-width: thin;
    scrollbar-color: var(--lg-separator) transparent;
}
.tabs__panel[data-active="true"] {
    display: flex;
}

.grid-2col {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 14px;
    align-items: start;
    width: 100%;
}
.col-stack {
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-width: 0;
}
@media (max-width: 840px) {
    .grid-2col {
        grid-template-columns: 1fr;
    }
}

.card {
    display: flex;
    flex-direction: column;
    border-radius: 20px;
    background-color: var(--card-bg, rgba(255, 255, 255, 0.035));
    border: 0.5px solid var(--lg-edge);
    box-shadow:
        inset 0 1px 1px 0 rgba(255, 255, 255, 0.08),
        0 2px 8px -2px var(--lg-drop);
    overflow: visible;
    padding: 0;
    position: relative;
}
:where([data-theme="light"], .heroui-root[data-theme="light"]) .card {
    --card-bg: rgba(0, 0, 0, 0.025);
    box-shadow:
        inset 0 1px 1px 0 rgba(255, 255, 255, 0.6),
        0 2px 8px -2px rgba(0, 0, 0, 0.04);
}
:where([data-theme="dark"], .heroui-root[data-theme="dark"]) .card {
    --card-bg: rgba(255, 255, 255, 0.035);
}

:is(.card, .col-stack)[data-menu-open="true"] {
    z-index: 9000;
}
:is(.field-row, .field-switch-row, .field-box)[data-menu-open="true"] {
    z-index: 9200;
}
.lg-menu-select[data-menu-open="true"],
.lg-menu[data-phase="open"],
.lg-menu[data-open="true"] {
    z-index: 9500;
}
[data-has-menu-open="true"] :is(.field-row, .field-switch-row, .field-box):not([data-menu-open="true"]):hover {
    transform: none;
    z-index: 1;
}

.card__header {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 12px 16px 10px 16px;
    border-bottom: 0.5px solid var(--lg-separator);
    border-top-left-radius: 18px;
    border-top-right-radius: 18px;
}

.card__title {
    font-size: 13.5px;
    font-weight: 600;
    letter-spacing: -0.01em;
    color: var(--lg-foreground);
    display: flex;
    align-items: center;
    justify-content: space-between;
}

.card__description {
    font-size: 11.5px;
    color: var(--lg-muted);
    line-height: 1.35;
}

.card__content {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px 12px 14px 12px;
}

.field-row, .field-switch-row, .field-box {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 14px;
    min-height: 48px;
    padding: 12px 16px;
    border-radius: 14px;
    background-color: var(--row-bg, rgba(255, 255, 255, 0.045));
    border: 0.5px solid var(--lg-edge);
    color: var(--lg-foreground);
    box-shadow:
        inset 0 1px 1px 0 rgba(255, 255, 255, 0.08),
        0 1px 3px var(--lg-drop);
    transition: background-color 140ms ease, border-color 140ms ease, transform 100ms ease, box-shadow 140ms ease;
    box-sizing: border-box;
    position: relative;
}
.field-switch-row {
    cursor: pointer;
}
.field-switch-row[data-disabled="true"] {
    cursor: default;
}
:where([data-theme="light"], .heroui-root[data-theme="light"]) :is(.field-row, .field-switch-row, .field-box) {
    --row-bg: rgba(0, 0, 0, 0.035);
    box-shadow:
        inset 0 1px 1px 0 rgba(255, 255, 255, 0.6),
        0 1px 2px rgba(0, 0, 0, 0.04);
}
:where([data-theme="dark"], .heroui-root[data-theme="dark"]) :is(.field-row, .field-switch-row, .field-box) {
    --row-bg: rgba(255, 255, 255, 0.045);
}
.field-row:hover, .field-switch-row:hover, .field-box:hover {
    background-color: var(--lg-highlight);
    border-color: rgba(255, 255, 255, 0.22);
    transform: translateY(-0.5px);
    box-shadow: 0 3px 10px -1px var(--lg-drop);
}
.field-row:active, .field-switch-row:active, .field-box:active {
    transform: scale(0.995);
}
.field-row--danger {
    border-color: rgba(255, 56, 60, 0.32);
}
.field-row--danger:hover {
    border-color: rgba(255, 56, 60, 0.5);
    background-color: rgba(255, 56, 60, 0.08);
}

.field-row > label,
.field-row > div:first-child:not([class*="btn"]):not([class*="button"]) {
    flex: 1 1 auto;
    min-width: 0;
    padding-right: 12px;
}
.field-row > :last-child:not(label) {
    flex-shrink: 0;
}

.field-box .lg-button {
    height: 30px;
    padding: 0 13px;
    font-size: 12px;
    border-radius: 9999px;
}

.keybind-btn {
    min-width: 104px;
    font-variant-numeric: tabular-nums;
    border-color: var(--lg-separator);
    font-weight: 600;
}
.keybind-btn--capturing {
    border-color: var(--accent, var(--lg-fill));
    background-color: color-mix(in srgb, var(--accent, var(--lg-fill)) 18%, transparent);
    color: var(--accent, var(--lg-fill));
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent, var(--lg-fill)) 28%, transparent);
    animation: keybind-pulse 1.2s infinite ease-in-out;
}
@keyframes keybind-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.7; }
}

.field-callout {
    padding: 10px 14px;
    border-radius: 14px;
    background: var(--lg-highlight);
    border: 0.5px solid var(--lg-separator);
    color: var(--lg-muted);
    font-size: 12px;
    display: flex;
    align-items: center;
    gap: 10px;
    line-height: 1.4;
    box-sizing: border-box;
}

.field-switch-content {
    display: flex;
    flex-direction: column;
    gap: 3px;
    flex: 1;
    min-width: 0;
}

.field-switch-content [data-slot="label"],
.field-row > label {
    font-size: 13.5px;
    font-weight: 590;
    letter-spacing: -0.01em;
    color: var(--lg-foreground);
    line-height: 1.3;
    display: flex;
    flex-direction: column;
    gap: 2px;
}

.field-switch-content [data-slot="description"],
.field-row small {
    font-size: 12px;
    color: var(--lg-muted);
    font-weight: 450;
    line-height: 1.45;
    display: block;
    margin-top: 2px;
}

.field-slider-wrapper {
    display: inline-flex;
    align-items: center;
    gap: 12px;
    width: 260px;
}
.slider__output {
    font-size: 13px;
    font-weight: 600;
    letter-spacing: -0.01em;
    color: var(--lg-foreground);
    min-width: 44px;
    text-align: right;
    font-variant-numeric: tabular-nums;
}

.color-swatches {
    display: flex;
    align-items: center;
    gap: 8px;
}
.color-swatch {
    width: 26px;
    height: 26px;
    border-radius: 50%;
    border: 2px solid transparent;
    cursor: pointer;
    position: relative;
    transition: transform 180ms cubic-bezier(0.16, 1, 0.3, 1), box-shadow 180ms ease;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
    display: flex;
    align-items: center;
    justify-content: center;
    color: #ffffff;
}
.color-swatch:hover {
    transform: scale(1.15);
}
.color-swatch[data-active="true"] {
    transform: scale(1.1);
    box-shadow: 0 0 0 2px var(--lg-surface), 0 0 0 4px var(--accent, var(--lg-fill));
}

.services-toolbar {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    box-sizing: border-box;
    margin-bottom: 4px;
}
.services-search-field {
    flex: 1 1 auto;
    min-width: 0;
}
.services-search-field.lg-input {
    width: 100%;
    max-width: 100%;
    height: 34px;
    padding: 0 12px;
    border-radius: 17px;
    background-color: var(--row-bg, rgba(255, 255, 255, 0.045));
    border: 0.5px solid var(--lg-edge);
    box-shadow: inset 0 1px 1px 0 rgba(255, 255, 255, 0.08), 0 1px 2px var(--lg-drop);
    box-sizing: border-box;
}
.services-search-field.lg-input:focus-within {
    border-color: var(--accent, var(--lg-fill));
    background-color: var(--lg-highlight);
}
.services-search-field input {
    font-size: 12.5px;
}
.services-actions {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
}
.services-action-btn {
    height: 34px;
    padding: 0 11px;
    font-size: 12px;
    font-weight: 550;
    border-radius: 17px;
}

.services-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
    gap: 8px;
    max-height: 420px;
    overflow-y: auto;
    padding: 8px 0 2px 0;
}

.service-tile {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
    min-height: 42px;
    border-radius: 14px;
    background-color: var(--row-bg, rgba(255, 255, 255, 0.04));
    border: 0.5px solid var(--lg-edge);
    box-shadow: 0 1px 3px var(--lg-drop);
    font-size: 12.5px;
    cursor: pointer;
    user-select: none;
    transition: background-color 140ms ease, border-color 140ms ease, transform 100ms ease;
}
.service-tile:hover {
    background-color: var(--lg-highlight);
    border-color: rgba(255, 255, 255, 0.22);
    transform: translateY(-0.5px);
}
.service-tile:active {
    transform: scale(0.98);
}
.service-tile__label {
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    padding-right: 8px;
    flex: 1;
    color: var(--lg-foreground);
}

.stats-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
    gap: 10px;
    padding: 4px 0 8px 0;
}
.stat-card {
    background-color: var(--row-bg, rgba(255, 255, 255, 0.04));
    border: 0.5px solid var(--lg-edge);
    border-radius: 14px;
    padding: 12px 14px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    box-shadow: 0 1px 3px var(--lg-drop);
    transition: transform 140ms ease, background-color 140ms ease, box-shadow 140ms ease;
}
.stat-card:hover {
    background-color: var(--lg-highlight);
    border-color: rgba(255, 255, 255, 0.22);
    transform: translateY(-1px);
    box-shadow: 0 4px 12px -2px var(--lg-drop);
}
.stat-card__label {
    font-size: 10.5px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--lg-muted);
}
.stat-card__value {
    font-size: 20px;
    font-weight: 650;
    letter-spacing: -0.02em;
    font-variant-numeric: tabular-nums;
    color: var(--lg-foreground);
}

.badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    font-weight: 590;
    border-radius: 9999px;
    padding: 2.5px 9px;
    font-size: 11.5px;
    letter-spacing: 0.1px;
    line-height: 1.25;
}
.badge--sm {
    font-size: 10.5px;
    padding: 2px 7px;
}
.badge--primary, .badge--accent {
    background: var(--accent, var(--lg-fill));
    color: #ffffff;
}
.badge--soft.badge--accent {
    background: color-mix(in srgb, var(--accent, var(--lg-fill)) 16%, transparent);
    color: var(--accent, var(--lg-fill));
    box-shadow: inset 0 0 0 0.5px color-mix(in srgb, var(--accent, var(--lg-fill)) 30%, transparent);
}
.badge--soft.badge--success {
    background: rgba(52, 199, 89, 0.16);
    color: #34c759;
}
.badge--secondary, .badge--default {
    background: var(--lg-highlight);
    color: var(--lg-foreground);
}

.heroui-pill.lg-glass {
    position: fixed;
    z-index: 2147483646;
    display: flex;
    align-items: center;
    gap: 8px;
    width: auto;
    height: 38px;
    padding: 0 8px 0 12px;
    border-radius: 19px;
    background-color: var(--lg-pill-tint, rgba(18, 18, 22, 0.72));
    background-image: var(--lg-rim, none);
    background-size: 100% 100%;
    --lg-blur: 1px;
    --lg-bezel: 8px;
    --lg-thickness: 14px;
    --lg-zoom: 1.02;
    --lg-rim-saturation: 1.6;
    --lg-refraction: 1.05;
    -webkit-backdrop-filter: blur(var(--lg-blur, 12px)) var(--lg-filter, saturate(1.4));
    backdrop-filter: blur(var(--lg-blur, 12px)) var(--lg-filter, saturate(1.4));
    color: var(--lg-foreground);
    box-shadow:
        inset 0 1px 1px 0 rgba(255, 255, 255, 0.35),
        inset 0 0 0 0.5px var(--lg-edge),
        0 8px 32px -4px var(--lg-shadow);
    transform: translateZ(0);
    user-select: none;
    font-size: 13px;
    font-weight: 500;
    line-height: 1.3;
    pointer-events: auto;
    cursor: pointer;
    transition: transform 200ms cubic-bezier(0.16, 1, 0.3, 1),
                box-shadow 200ms ease,
                opacity 150ms ease,
                width 280ms cubic-bezier(0.16, 1, 0.3, 1),
                height 280ms cubic-bezier(0.16, 1, 0.3, 1),
                padding 280ms cubic-bezier(0.16, 1, 0.3, 1);
}

.heroui-pill.lg-glass:hover {
    transform: translateY(-1.5px) scale(1.03);
    box-shadow: 0 16px 42px -4px var(--lg-shadow), inset 0 1px 1px 0 rgba(255, 255, 255, 0.3);
}

.heroui-pill.lg-glass:active {
    transform: scale(0.96);
}

.heroui-pill.heroui-pill--minimal {
    width: 44px;
    height: 44px;
    padding: 0;
    border-radius: 22px;
    --lg-bezel: 10px;
    --lg-thickness: 18px;
    background-color: transparent;
    justify-content: center;
    gap: 0;
}

.heroui-pill--minimal .heroui-pill__main {
    display: none;
}

.heroui-pill--minimal .heroui-pill__gear {
    width: 100%;
    height: 100%;
    border-radius: 50%;
    background: transparent;
    border: none;
}

.heroui-pill__main {
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
}

.heroui-pill__badge {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 3px 9px;
    border-radius: 9999px;
    font-weight: 600;
    font-size: 11px;
    letter-spacing: 0.1px;
}

.heroui-pill__dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: currentColor;
    box-shadow: 0 0 8px currentColor;
    animation: heroui-pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
}

@keyframes heroui-pulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.35; transform: scale(0.8); }
}

.heroui-pill__stats {
    font-size: 12px;
    color: var(--lg-foreground);
    font-weight: 550;
    display: flex;
    align-items: center;
    gap: 8px;
}

.heroui-pill__stat-item {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    font-variant-numeric: tabular-nums;
}

.heroui-pill__gear {
    position: relative;
    background: transparent;
    border: none;
    color: var(--lg-muted);
    cursor: pointer;
    border-radius: 50%;
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    transition: background-color 150ms, color 150ms, transform 240ms cubic-bezier(0.16, 1, 0.3, 1);
}

.heroui-pill__gear:hover {
    background: var(--lg-highlight);
    color: var(--lg-foreground);
    transform: rotate(60deg);
}

.heroui-pill__gear:active {
    transform: scale(0.92);
}

.heroui-pill__indicator-dot {
    position: absolute;
    top: 3px;
    right: 3px;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--accent, var(--lg-on));
    box-shadow: 0 0 6px var(--accent, var(--lg-on));
    display: none;
    animation: heroui-pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
}

/* Pop-up Options powered by Glisse Menu */
.lg-menu-select {
    display: inline-flex;
    position: relative;
}
.lg-menu-select .lg-button {
    width: auto;
    min-width: 140px;
    height: 34px;
    padding: 0 12px 0 14px;
    justify-content: space-between;
}
.lg-select-trigger-content {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    width: 100%;
}
.lg-select-current-label {
    font-size: 13px;
    font-weight: 500;
    color: var(--lg-foreground);
    white-space: nowrap;
}
.lg-select-chevron {
    width: 12px;
    height: 12px;
    color: var(--lg-muted);
    flex-shrink: 0;
    transition: transform 180ms ease;
}
.lg-menu-select[data-menu-open="true"] .lg-select-chevron {
    transform: rotate(180deg);
}
.lg-select-item-inner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    gap: 12px;
}
.lg-select-item-text {
    display: flex;
    flex-direction: column;
    gap: 1px;
    text-align: left;
}
.lg-select-item-title {
    font-size: 13px;
    font-weight: 500;
    color: var(--lg-foreground);
}
.lg-select-item-desc {
    font-size: 11px;
    color: var(--lg-muted);
    font-weight: 400;
    line-height: 1.3;
}
.lg-select-item-check {
    color: var(--accent, var(--lg-fill));
    flex-shrink: 0;
}
`);
    }

    // ------------------------------------------------------------
    // Glisse Spring Physics Engine & Press Physics (Native Listeners)
    // ------------------------------------------------------------
    const isRealDocHidden = () => (ORIG_HIDDEN ? ORIG_HIDDEN.call(document) : document.hidden);
    const movingSprings = new Set();
    let springFrame = 0;
    let springLastTime = 0;

    function advanceSpring(s, dt) {
        const x = s.value - s.target;
        const v = s.velocity;
        const half = s.damping / 2;
        const discriminant = half * half - s.stiffness;
        if (Math.abs(discriminant) < 1e-4) {
            const decay = Math.exp(-half * dt);
            const b = v + half * x;
            s.value = s.target + decay * (x + b * dt);
            s.velocity = decay * (v - half * b * dt);
        } else if (discriminant > 0) {
            const root = Math.sqrt(discriminant);
            const r1 = -half + root;
            const r2 = -half - root;
            const a = (v - r2 * x) / (r1 - r2);
            const b = x - a;
            s.value = s.target + a * Math.exp(r1 * dt) + b * Math.exp(r2 * dt);
            s.velocity = a * r1 * Math.exp(r1 * dt) + b * r2 * Math.exp(r2 * dt);
        } else {
            const omega = Math.sqrt(-discriminant);
            const decay = Math.exp(-half * dt);
            const cos = Math.cos(omega * dt);
            const sin = Math.sin(omega * dt);
            s.value = s.target + decay * (x * cos + (v + half * x) / omega * sin);
            s.velocity = decay * (v * cos - (half * v + s.stiffness * x) / omega * sin);
        }
    }

    function tickSprings(time) {
        springFrame = 0;
        const dt = Math.min(0.1, Math.max(0, (time - springLastTime) / 1e3));
        springLastTime = time;
        for (const s of movingSprings) {
            advanceSpring(s, dt);
            if (Math.abs(s.value - s.target) < 1e-4 && Math.abs(s.velocity) < 1e-3) {
                s.value = s.target;
                s.velocity = 0;
                movingSprings.delete(s);
            }
            s.paint(s.value);
        }
        if (movingSprings.size) springFrame = requestAnimationFrame(tickSprings);
    }

    let cachedPrefersReducedMotion = false;
    try {
        if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
            const mql = window.matchMedia('(prefers-reduced-motion: reduce)');
            cachedPrefersReducedMotion = !!mql.matches;
            if (typeof mql.addEventListener === 'function') {
                mql.addEventListener('change', (e) => { cachedPrefersReducedMotion = !!e.matches; });
            } else if (typeof mql.addListener === 'function') {
                mql.addListener((e) => { cachedPrefersReducedMotion = !!e.matches; });
            }
        }
    } catch {}

    function createSpring(value, stiffness, damping, paint) {
        const s = { value, target: value, velocity: 0, stiffness, damping, paint };
        return {
            paint: () => paint(s.value),
            set(target, instant = false) {
                s.target = target;
                if (instant || isRealDocHidden() || cachedPrefersReducedMotion) {
                    s.value = target;
                    s.velocity = 0;
                    movingSprings.delete(s);
                    paint(target);
                    return;
                }
                if (s.value === target && s.velocity === 0 && !movingSprings.has(s)) return;
                movingSprings.add(s);
                if (!springFrame) {
                    springLastTime = Number((document.timeline && document.timeline.currentTime) ?? performance.now());
                    springFrame = requestAnimationFrame(tickSprings);
                }
            },
            tune(nextStiffness, nextDamping) {
                s.stiffness = nextStiffness;
                s.damping = nextDamping;
            },
            stop: () => { movingSprings.delete(s); },
        };
    }

    const PRESS_POINTER = { grow: 6, press: [417.6, 29.2], release: [230, 23.7] };
    const PRESS_TOUCH   = { grow: 15, press: [515, 27.3], release: [250, 11.8] };

    function attachPressPhysics(elNode) {
        if (!elNode) return () => {};
        const value = [1, 1, 0, 0];
        const paint = () => {
            elNode.style.scale = `${value[0]} ${value[1]}`;
            elNode.style.translate = `${value[2]}px ${value[3]}px`;
        };
        const springs = value.map((initial, i) => createSpring(initial, ...PRESS_POINTER.release, (next) => {
            value[i] = next;
            paint();
        }));
        let pointer = null;
        const target = (next, [stiffness, damping]) => {
            springs.forEach((spring, i) => {
                spring.tune(stiffness, damping);
                spring.set(next[i] ?? 0);
            });
        };
        const track = (event) => {
            if (!pointer) return;
            const { box, feel } = pointer;
            elNode.style.setProperty('--lg-x', `${(event.clientX - box.left) / box.width * 100}%`);
            elNode.style.setProperty('--lg-y', `${(event.clientY - box.top) / box.height * 100}%`);
            const { width, height } = box;
            const base = 1 + feel.grow / Math.max(width, height);
            const aspect = width / height;
            const dx = (event.clientX - pointer.x) / aspect;
            const dy = event.clientY - pointer.y;
            const length = Math.hypot(dx, dy);
            if (!length) return target([base, base, 0, 0], feel.press);
            const nx = dx / length;
            const ny = dy / length;
            const rubber = 1 - 1 / (1 + length / height / (5 * aspect));
            const stretch = 1 + 6 / height * rubber * Math.abs(Math.abs(nx) - Math.abs(ny));
            const horizontal = Math.abs(nx) > Math.abs(ny);
            target([
                base * (horizontal ? stretch : 1 / stretch),
                base * (horizontal ? 1 / stretch : stretch),
                nx * 8 * rubber,
                ny * 8 * rubber,
            ], feel.press);
        };
        const move = (event) => { if (event.pointerId === pointer?.id) track(event); };
        const end = (event) => {
            if (event && event.pointerId !== pointer?.id) return;
            const feel = pointer?.feel ?? PRESS_POINTER;
            pointer = null;
            delete elNode.dataset.pressed;
            safeWinRem('pointermove', move);
            safeWinRem('pointerup', end);
            safeWinRem('pointercancel', end);
            target([1, 1, 0, 0], feel.release);
        };
        const down = (event) => {
            if (!event.isPrimary || event.button !== 0 || pointer || elNode.matches(':disabled')) return;
            pointer = {
                id: event.pointerId,
                x: event.clientX,
                y: event.clientY,
                box: elNode.getBoundingClientRect(),
                feel: event.pointerType === 'mouse' ? PRESS_POINTER : PRESS_TOUCH,
            };
            elNode.dataset.pressed = '';
            safeWinAdd('pointermove', move);
            safeWinAdd('pointerup', end);
            safeWinAdd('pointercancel', end);
            track(event);
        };
        const reset = () => end();
        elNode.addEventListener('pointerdown', down);
        const offBlur = addInternalBlurListener(reset);
        return () => {
            end();
            springs.forEach((spring) => spring.stop());
            elNode.removeEventListener('pointerdown', down);
            offBlur();
            elNode.style.removeProperty('scale');
            elNode.style.removeProperty('translate');
        };
    }

    // Async Glisse Optical Refraction & Specular Rim Engine
    // Reuses a single scratch canvas + native URL.createObjectURL(blob) (zero base64/FileReader overhead)
    // and prunes unused SVG filters & blob URLs on eviction and modal unmount.
    const SVG_REFRACT_NS = 'http://www.w3.org/2000/svg';
    const REFRACTS_BACKDROP = typeof navigator !== 'undefined' && /Chrom(?:e|ium)\//.test(navigator.userAgent);
    const lenses = new Map();
    const elementLensKeys = new WeakMap();
    const profileCache = new Map();
    let refractDefs = null;
    let lensIdCounter = 0;
    let scratchCanvas = null;
    let scratchCtx = null;

    function revokeObjectUrls(urls) {
        if (!urls || !urls.length) return;
        const revokeFn = origRevokeObjectURL
            ? (u) => origRevokeObjectURL.call(URL, u)
            : (typeof URL !== 'undefined' && URL.revokeObjectURL ? (u) => URL.revokeObjectURL(u) : null);
        if (!revokeFn) return;
        for (let i = 0; i < urls.length; i++) {
            try { revokeFn(urls[i]); } catch {}
        }
    }

    function disposeLensEntry(key, entry) {
        if (entry) {
            if (entry.filterNode && entry.filterNode.parentNode) {
                entry.filterNode.remove();
            }
            if (entry.objectUrls) {
                revokeObjectUrls(entry.objectUrls);
                entry.objectUrls = null;
            }
            if (entry.subscribers) entry.subscribers.clear();
        }
        lenses.delete(key);
    }

    function pruneUnusedLenses() {
        for (const [k, entry] of lenses.entries()) {
            if (!entry || (entry.refCount || 0) === 0) {
                disposeLensEntry(k, entry);
            }
        }
    }

    function createSvgEl(name, attrs) {
        const element = document.createElementNS(SVG_REFRACT_NS, name);
        for (const k in attrs) element.setAttribute(k, String(attrs[k]));
        return element;
    }

    function ensureRefractDefs() {
        if (refractDefs && refractDefs.isConnected) return refractDefs;
        const root = createSvgEl('svg', { width: 0, height: 0, 'aria-hidden': 'true' });
        root.style.cssText = 'position:absolute;pointer-events:none;width:0;height:0;';
        refractDefs = createSvgEl('defs', {});
        root.appendChild(refractDefs);
        const target = uiState.shadowRoot || document.body || document.documentElement;
        if (target) target.appendChild(root);
        return refractDefs;
    }

    function getBezelProfile(bezel, thickness) {
        const key = `${bezel}-${thickness}`;
        const cached = profileCache.get(key);
        if (cached) return cached;
        const samples = new Float32Array(128);
        let maximum = 0;
        for (let i = 0; i < samples.length; i++) {
            const t = Math.max(1e-3, i / (samples.length - 1));
            const surface = (1 - (1 - t) ** 4) ** 0.25;
            const incident = Math.atan((1 - t) ** 3 / surface ** 3);
            const refracted = Math.asin(Math.sin(incident) / 1.5);
            samples[i] = Math.tan(incident - refracted) * (thickness + surface * bezel);
            maximum = Math.max(maximum, samples[i]);
        }
        const result = { samples, maximum };
        profileCache.set(key, result);
        return result;
    }

    function imageDataToUrlAsync(imageData, w, h, createdUrls) {
        return new Promise((resolve) => {
            try {
                if (!scratchCanvas) {
                    scratchCanvas = document.createElement('canvas');
                    scratchCtx = scratchCanvas.getContext('2d');
                }
                if (!scratchCtx) return resolve(null);
                if (scratchCanvas.width !== w) scratchCanvas.width = w;
                if (scratchCanvas.height !== h) scratchCanvas.height = h;
                scratchCtx.putImageData(imageData, 0, 0);
                if (typeof scratchCanvas.toBlob === 'function') {
                    scratchCanvas.toBlob((blob) => {
                        if (!blob) return resolve(null);
                        if (origCreateObjectURL || (typeof URL !== 'undefined' && URL.createObjectURL)) {
                            const objUrl = origCreateObjectURL
                                ? origCreateObjectURL.call(URL, blob)
                                : URL.createObjectURL(blob);
                            if (createdUrls) createdUrls.push(objUrl);
                            return resolve(objUrl);
                        }
                        const reader = new FileReader();
                        reader.onloadend = () => resolve(typeof reader.result === 'string' ? reader.result : null);
                        reader.onerror = () => resolve(null);
                        reader.readAsDataURL(blob);
                    }, 'image/png');
                } else {
                    resolve(scratchCanvas.toDataURL('image/png'));
                }
            } catch {
                resolve(null);
            }
        });
    }

    function computeGlisseMapsAsync(width, height, radius, selection, shape, needDisplacement, createdUrls) {
        const bezel = shape.bezel ?? Math.min(10, Math.max(4, Math.min(width, height) * 0.12));
        const thickness = shape.thickness ?? Math.min(24, Math.max(8, Math.min(width, height) * 0.2));
        const { samples, maximum } = getBezelProfile(bezel, thickness);
        const w = Math.ceil(width);
        const h = Math.ceil(height);

        const field = needDisplacement ? new ImageData(w, h) : null;
        const fieldU32 = field ? new Uint32Array(field.data.buffer) : null;
        if (fieldU32) fieldU32.fill(0xFF808080);

        const shine = new ImageData(w, h);
        const shineU32 = new Uint32Array(shine.data.buffer);
        const useMagnify = needDisplacement && !selection && shape.zoom > 1;
        const magnify = useMagnify ? new ImageData(w, h) : null;
        const magnifyU32 = magnify ? new Uint32Array(magnify.data.buffer) : null;

        const halfW = width / 2;
        const halfH = height / 2;
        const innerW = halfW - radius;
        const innerH = halfH - radius;
        const maxSampleIdx = samples.length - 1;
        const reach = Math.max(width, height) / 2;
        const direction = selection ? 1 : -1;
        const bloomDenom = bezel * 0.22;
        const radiusSqLimit = radius * radius + 1e-9;
        const sqrt1_2 = Math.SQRT1_2;

        if (magnifyU32) {
            const magX = new Uint8Array(w);
            for (let x = 0; x < w; x++) magX[x] = Math.round(127.5 - ((x + 0.5) - halfW) / reach * 127.5);
            for (let y = 0; y < h; y++) {
                const magYBits = 0xFF800000 | (Math.round(127.5 - ((y + 0.5) - halfH) / reach * 127.5) << 8);
                const off = y * w;
                for (let x = 0; x < w; x++) magnifyU32[off + x] = magYBits | magX[x];
            }
        }

        let outShine = 0;
        let outField = 0xFF808080;
        function evalPixel(distance, nx, ny) {
            outField = 0xFF808080;
            if (distance < bezel && fieldU32) {
                const sample = distance / bezel * maxSampleIdx;
                const lower = Math.floor(sample);
                const a = samples[lower];
                const shift = a + (samples[Math.min(lower + 1, maxSampleIdx)] - a) * (sample - lower);
                const rF = Math.round(127.5 + direction * nx * shift / maximum * 127.5);
                const gF = Math.round(127.5 + direction * ny * shift / maximum * 127.5);
                const rc = rF < 0 ? 0 : rF > 255 ? 255 : rF;
                const gc = gF < 0 ? 0 : gF > 255 ? 255 : gF;
                outField = (0xFF800000 | (gc << 8) | rc) >>> 0;
            }

            const light = -(nx + ny) * sqrt1_2;
            const glint = light > 0 ? light ** 3 : 0;
            const reflected = light < 0 ? (-light) ** 3 : 0;
            let r = 255, g = 255, b = 255, alpha = 0;

            if (selection) {
                const d0 = (distance - 0.18) / 0.22;
                const d1 = (distance - 0.42) / 0.22;
                const d2 = (distance - 0.66) / 0.22;
                const b0 = Math.exp(-(d0 * d0));
                const b1 = Math.exp(-(d1 * d1));
                const b2 = Math.exp(-(d2 * d2));
                const peak = Math.max(b0, b1, b2);
                alpha = peak * (0.06 + 0.8 * glint + 0.35 * reflected) * 0.85;
                const invPeak = peak ? 0.35 / peak : 0;
                r = Math.round(255 * (0.65 + b0 * invPeak));
                g = Math.round(255 * (0.65 + b1 * invPeak));
                b = Math.round(255 * (0.65 + b2 * invPeak));
                r = r >= 255 ? 255 : r > 0 ? r : 0;
                g = g >= 255 ? 255 : g > 0 ? g : 0;
                b = b >= 255 ? 255 : b > 0 ? b : 0;
            } else {
                const rim = Math.exp(-(((distance - 0.4) / 0.38) ** 2));
                const bloom = Math.exp(-((distance / bloomDenom) ** 2));
                alpha = rim * (0.045 + 0.52 * glint + 0.2 * reflected) + bloom * 0.02 * glint;
            }

            const aByte = Math.round((alpha < 0 ? 0 : alpha > 1 ? 1 : alpha) * 255);
            outShine = ((aByte << 24) | (b << 16) | (g << 8) | r) >>> 0;
        }

        let templateBezelRowOffset = -1;
        for (let y = 0; y < h; y++) {
            const py = (y + 0.5) - halfH;
            const qy = Math.abs(py) - innerH;
            const signPy = py > 0 ? 1 : py < 0 ? -1 : 0;
            const rowPixelOffset = y * w;
            const qyNegBezel = qy < -bezel;

            const spanLimit = qyNegBezel ? (innerW - bezel - 1e-9) : (innerW + (qy < 0 ? qy : 0) - 1e-9);
            let flatStart = 0;
            let flatEnd = 0;
            if (spanLimit >= 0) {
                flatStart = Math.max(0, Math.ceil(halfW - spanLimit - 0.5));
                flatEnd = Math.min(w, Math.floor(halfW + spanLimit - 0.5) + 1);
                if (flatEnd > flatStart) {
                    if (!qyNegBezel) {
                        const flatDist = radius - qy;
                        if (flatDist < 0) {
                            shineU32.fill(0x00FFFFFF, rowPixelOffset + flatStart, rowPixelOffset + flatEnd);
                        } else {
                            evalPixel(flatDist, 0, signPy);
                            shineU32.fill(outShine, rowPixelOffset + flatStart, rowPixelOffset + flatEnd);
                            if (fieldU32 && outField !== 0xFF808080) {
                                fieldU32.fill(outField, rowPixelOffset + flatStart, rowPixelOffset + flatEnd);
                            }
                        }
                    }
                } else {
                    flatStart = 0;
                    flatEnd = 0;
                }
            }

            if (qyNegBezel && templateBezelRowOffset !== -1) {
                if (flatStart > 0) {
                    shineU32.copyWithin(rowPixelOffset, templateBezelRowOffset, templateBezelRowOffset + flatStart);
                    if (fieldU32) fieldU32.copyWithin(rowPixelOffset, templateBezelRowOffset, templateBezelRowOffset + flatStart);
                }
                if (flatEnd < w) {
                    shineU32.copyWithin(rowPixelOffset + flatEnd, templateBezelRowOffset + flatEnd, templateBezelRowOffset + w);
                    if (fieldU32) fieldU32.copyWithin(rowPixelOffset + flatEnd, templateBezelRowOffset + flatEnd, templateBezelRowOffset + w);
                }
                continue;
            }

            for (let seg = 0; seg < 2; seg++) {
                const xStart = seg === 0 ? 0 : flatEnd;
                const xEnd = seg === 0 ? flatStart : w;
                for (let x = xStart; x < xEnd; x++) {
                    const px = (x + 0.5) - halfW;
                    const absPx = px < 0 ? -px : px;
                    const qx = absPx - innerW;
                    if (qx < -bezel && qyNegBezel) continue;

                    let distance, nx, ny;
                    if (qx <= 0) {
                        distance = radius - (qy < 0 ? qx : qy);
                        nx = qx > qy ? (px > 0 ? 1 : px < 0 ? -1 : 0) : 0;
                        ny = qx > qy ? 0 : signPy;
                    } else if (qy <= 0) {
                        distance = radius - qx;
                        nx = px > 0 ? 1 : px < 0 ? -1 : 0;
                        ny = 0;
                    } else {
                        if (qx * qx + qy * qy > radiusSqLimit) {
                            shineU32[rowPixelOffset + x] = 0x00FFFFFF;
                            continue;
                        }
                        const length = Math.hypot(qx, qy);
                        distance = radius - length;
                        nx = qx / length * (px > 0 ? 1 : px < 0 ? -1 : 0);
                        ny = qy / length * signPy;
                    }

                    const pixelIdx = rowPixelOffset + x;
                    if (distance < 0) {
                        shineU32[pixelIdx] = 0x00FFFFFF;
                        continue;
                    }
                    evalPixel(distance, nx, ny);
                    shineU32[pixelIdx] = outShine;
                    if (fieldU32 && outField !== 0xFF808080) fieldU32[pixelIdx] = outField;
                }
            }
            if (qyNegBezel && templateBezelRowOffset === -1) {
                templateBezelRowOffset = rowPixelOffset;
            }
        }

        const scale = maximum * 2 * shape.level;
        const zoomScale = magnify ? 2 * reach * (1 - 1 / shape.zoom) : 0;

        return Promise.all([
            field ? imageDataToUrlAsync(field, w, h, createdUrls) : Promise.resolve(null),
            imageDataToUrlAsync(shine, w, h, createdUrls),
            magnify ? imageDataToUrlAsync(magnify, w, h, createdUrls) : Promise.resolve(null),
        ]).then(([displacement, highlight, zoomMap]) => ({
            displacement,
            highlight,
            zoom: zoomMap ? { map: zoomMap, scale: zoomScale } : null,
            scale,
        }));
    }

    function buildSvgFilterNode(width, height, selection, shape, mapsResult) {
        const { displacement, highlight, zoom, scale } = mapsResult;
        if (!displacement) return null;
        const id = `glisse-${++lensIdCounter}`;
        const box = { x: 0, y: 0, width, height };
        const filter = createSvgEl('filter', {
            id,
            ...box,
            filterUnits: 'userSpaceOnUse',
            primitiveUnits: 'userSpaceOnUse',
            'color-interpolation-filters': 'sRGB',
        });
        filter.appendChild(createSvgEl('feImage', {
            href: displacement,
            ...box,
            preserveAspectRatio: 'none',
            result: 'field',
        }));

        if (selection) {
            // Single-pass optical displacement for TabBar droplet lens (keeps 60-120fps drag smoothness)
            filter.appendChild(createSvgEl('feDisplacementMap', {
                in: 'SourceGraphic',
                in2: 'field',
                scale,
                xChannelSelector: 'R',
                yChannelSelector: 'G',
            }));
        } else {
            if (zoom) {
                filter.appendChild(createSvgEl('feImage', {
                    href: zoom.map,
                    ...box,
                    preserveAspectRatio: 'none',
                    result: 'zoom',
                }));
                filter.appendChild(createSvgEl('feDisplacementMap', {
                    in: 'SourceGraphic',
                    in2: 'zoom',
                    scale: zoom.scale,
                    xChannelSelector: 'R',
                    yChannelSelector: 'G',
                    result: 'magnified',
                }));
            }
            filter.appendChild(createSvgEl('feDisplacementMap', {
                in: zoom ? 'magnified' : 'SourceGraphic',
                in2: 'field',
                scale,
                xChannelSelector: 'R',
                yChannelSelector: 'G',
                result: 'bent',
            }));
            filter.appendChild(createSvgEl('feGaussianBlur', {
                in: 'bent',
                stdDeviation: 0.4,
                result: 'displaced',
            }));
            filter.appendChild(createSvgEl('feColorMatrix', {
                in: 'displaced',
                type: 'saturate',
                values: 1.5,
                result: 'face',
            }));
            if (shape.saturation > 1 && highlight) {
                const mask = createSvgEl('feComponentTransfer', { in: 'shine', result: 'mask' });
                mask.appendChild(createSvgEl('feFuncA', { type: 'linear', slope: 1.8 }));
                filter.appendChild(createSvgEl('feColorMatrix', {
                    in: 'displaced',
                    type: 'saturate',
                    values: shape.saturation,
                    result: 'vivid',
                }));
                filter.appendChild(createSvgEl('feImage', {
                    href: highlight,
                    ...box,
                    preserveAspectRatio: 'none',
                    result: 'shine',
                }));
                filter.appendChild(mask);
                filter.appendChild(createSvgEl('feComposite', {
                    in: 'vivid',
                    in2: 'mask',
                    operator: 'in',
                    result: 'edge',
                }));
                filter.appendChild(createSvgEl('feBlend', {
                    in: 'edge',
                    in2: 'face',
                    mode: 'normal',
                }));
            }
        }

        ensureRefractDefs().appendChild(filter);
        return { id, node: filter };
    }

    let cachedRootShape = null;
    function getRootShape() {
        if (cachedRootShape) return cachedRootShape;
        const rootEl = uiState.containerEl || uiState.hostEl || document.documentElement;
        if (!rootEl) return { bezel: 8, thickness: 16, level: 1.05, zoom: 1.02, saturation: 1.6 };
        try {
            const style = getComputedStyle(rootEl);
            const parseVal = (name, def) => {
                const v = parseFloat(style.getPropertyValue(name));
                return Number.isFinite(v) ? v : def;
            };
            cachedRootShape = {
                bezel: parseVal('--lg-bezel', 8),
                thickness: parseVal('--lg-thickness', 16),
                level: parseVal('--lg-refraction', 1.05),
                zoom: Math.max(1, parseVal('--lg-zoom', 1.02)),
                saturation: Math.max(1, parseVal('--lg-rim-saturation', 1.6)),
            };
            return cachedRootShape;
        } catch {
            return { bezel: 8, thickness: 16, level: 1.05, zoom: 1.02, saturation: 1.6 };
        }
    }

    function applyLensEntry(element, entry, filtered) {
        const prevKey = elementLensKeys.get(element);
        if (prevKey !== entry.key) {
            if (prevKey) {
                const prevEntry = lenses.get(prevKey);
                if (prevEntry && prevEntry.refCount > 0) prevEntry.refCount--;
            }
            elementLensKeys.set(element, entry.key);
            entry.refCount = (entry.refCount || 0) + 1;
        }
        if (filtered && entry.filter) {
            element.style.setProperty('--lg-filter', entry.filter);
        }
        if (entry.rim) {
            element.style.setProperty('--lg-rim', entry.rim);
        }
    }

    function evictUnusedLensIfNeeded() {
        if (lenses.size < 64) return;
        for (const [k, entry] of lenses.entries()) {
            if (!entry || (entry.refCount || 0) === 0) {
                disposeLensEntry(k, entry);
                break;
            }
        }
    }

    const refractResizeCallbacks = new WeakMap();
    let sharedRefractResizeObserver = null;
    function getSharedRefractResizeObserver() {
        if (!sharedRefractResizeObserver && typeof ResizeObserver !== 'undefined') {
            sharedRefractResizeObserver = new ResizeObserver((entries) => {
                for (let i = 0; i < entries.length; i++) {
                    const cb = refractResizeCallbacks.get(entries[i].target);
                    if (cb) cb();
                }
            });
        }
        return sharedRefractResizeObserver;
    }

    function attachRefraction(element, selection = false) {
        let rafId = 0;
        const filtered = REFRACTS_BACKDROP;

        const update = () => {
            rafId = 0;
            if (!element.isConnected) return;
            const rawW = element.offsetWidth;
            const rawH = element.offsetHeight;
            if (!rawW || !rawH) return;

            const width = Math.round(rawW / 4) * 4;
            const height = Math.round(rawH / 4) * 4;
            let compStyle = null;
            try { compStyle = getComputedStyle(element); } catch {}
            let corner = element.style.borderRadius;
            if (!corner) {
                if (element.classList.contains('heroui-pill')) corner = '9999px';
                else corner = (compStyle && compStyle.borderTopLeftRadius) || '16px';
            }
            const radius = Math.min(
                width / 2,
                height / 2,
                corner.endsWith('%') ? Math.min(width, height) * parseFloat(corner) / 100 : (parseFloat(corner) || 16)
            );

            const rootShape = getRootShape();
            const readShapeVal = (prop, fallback) => {
                const raw = (compStyle && compStyle.getPropertyValue(prop)) || element.style.getPropertyValue(prop);
                const parsed = parseFloat(raw);
                return Number.isFinite(parsed) ? parsed : fallback;
            };
            const shape = {
                bezel: readShapeVal('--lg-bezel', rootShape.bezel),
                thickness: readShapeVal('--lg-thickness', rootShape.thickness),
                level: readShapeVal('--lg-refraction', rootShape.level),
                zoom: Math.max(1, readShapeVal('--lg-zoom', rootShape.zoom)),
                saturation: Math.max(1, readShapeVal('--lg-rim-saturation', rootShape.saturation)),
            };

            const key = `${width}-${height}-${radius}-${selection}-${filtered}-${shape.bezel}-${shape.thickness}-${shape.level}-${shape.zoom}-${shape.saturation}`;

            let entry = lenses.get(key);
            if (entry) {
                lenses.delete(key);
                lenses.set(key, entry);
                if (!entry.ready) entry.subscribers.add(element);
                applyLensEntry(element, entry, filtered);
                return;
            }

            evictUnusedLensIfNeeded();
            entry = { key, filter: null, rim: null, filterNode: null, objectUrls: null, ready: false, refCount: 0, subscribers: new Set([element]) };
            lenses.set(key, entry);
            applyLensEntry(element, entry, filtered);

            const createdUrls = [];
            computeGlisseMapsAsync(width, height, radius, selection, shape, filtered, createdUrls).then((mapsResult) => {
                const currentEntry = lenses.get(key);
                if (!currentEntry || currentEntry !== entry) {
                    revokeObjectUrls(createdUrls);
                    return;
                }
                currentEntry.ready = true;
                currentEntry.objectUrls = createdUrls;
                if (mapsResult.highlight) {
                    currentEntry.rim = `url("${mapsResult.highlight}")`;
                }
                if (filtered && mapsResult.displacement) {
                    const built = buildSvgFilterNode(width, height, selection, shape, mapsResult);
                    if (built) {
                        currentEntry.filter = `url("#${built.id}")`;
                        currentEntry.filterNode = built.node;
                    }
                } else {
                    currentEntry.filter = 'none';
                }
                for (const subEl of currentEntry.subscribers) {
                    if (subEl.isConnected && elementLensKeys.get(subEl) === key) {
                        if (filtered && currentEntry.filter) subEl.style.setProperty('--lg-filter', currentEntry.filter);
                        if (currentEntry.rim) subEl.style.setProperty('--lg-rim', currentEntry.rim);
                    }
                }
                currentEntry.subscribers.clear();
            });
        };

        const scheduleUpdate = () => {
            if (!rafId) rafId = requestAnimationFrame(update);
        };

        const observer = getSharedRefractResizeObserver();
        if (observer) {
            refractResizeCallbacks.set(element, scheduleUpdate);
            observer.observe(element);
        }
        scheduleUpdate();

        return () => {
            if (rafId) cancelAnimationFrame(rafId);
            if (observer) observer.unobserve(element);
            refractResizeCallbacks.delete(element);
            const appliedKey = elementLensKeys.get(element);
            if (appliedKey) {
                elementLensKeys.delete(element);
                const entry = lenses.get(appliedKey);
                if (entry) {
                    entry.subscribers.delete(element);
                    if (entry.refCount > 0) entry.refCount--;
                }
            }
            element.style.removeProperty('--lg-filter');
            element.style.removeProperty('--lg-rim');
        };
    }

    // ------------------------------------------------------------
    // Vanilla DOM Element & Glisse Component Builders
    // ------------------------------------------------------------
    function el(tag, attrs, children) {
        const node = document.createElement(tag);
        if (attrs) {
            for (const k in attrs) {
                const v = attrs[k];
                if (v == null || v === false) continue;
                if (k === 'className') node.className = v;
                else if (k === 'style' && typeof v === 'object') {
                    for (const sk in v) {
                        const sv = v[sk];
                        if (sv == null) continue;
                        if (sk.startsWith('--')) node.style.setProperty(sk, String(sv));
                        else node.style[sk] = sv;
                    }
                }
                else if (k === 'dataset' && typeof v === 'object') {
                    for (const dk in v) {
                        if (v[dk] !== undefined && v[dk] !== null) node.dataset[dk] = v[dk];
                    }
                } else if (k.startsWith('on') && typeof v === 'function') {
                    node.addEventListener(k.slice(2).toLowerCase(), v);
                } else if (v === true) {
                    node.setAttribute(k, '');
                } else {
                    node.setAttribute(k, String(v));
                }
            }
        }
        if (children != null) {
            const append = (item) => {
                if (item == null || item === false) return;
                if (Array.isArray(item)) item.forEach(append);
                else if (item instanceof Node) node.appendChild(item);
                else node.appendChild(document.createTextNode(String(item)));
            };
            append(children);
        }
        return node;
    }

    const SVG_NS = 'http://www.w3.org/2000/svg';
    function svgNode(tag, attrs, children) {
        const node = document.createElementNS(SVG_NS, tag);
        if (attrs) {
            for (const k in attrs) {
                if (attrs[k] != null) node.setAttribute(k, String(attrs[k]));
            }
        }
        if (children) children.forEach((c) => c && node.appendChild(c));
        return node;
    }

    function createChevronIcon() {
        return svgNode('svg', {
            class: 'lg-select-chevron', width: 12, height: 12, viewBox: '0 0 24 24',
            fill: 'none', stroke: 'currentColor', 'stroke-width': 2.4,
            'stroke-linecap': 'round', 'stroke-linejoin': 'round',
        }, [svgNode('path', { d: 'm6 9 6 6 6-6' })]);
    }

    function createCheckIcon(className = 'lg-select-item-check', size = 14, strokeWidth = 2.5) {
        return svgNode('svg', {
            class: className, width: size, height: size, viewBox: '0 0 24 24',
            fill: 'none', stroke: 'currentColor', 'stroke-width': strokeWidth,
            'stroke-linecap': 'round', 'stroke-linejoin': 'round',
        }, [svgNode('polyline', { points: '20 6 9 17 4 12' })]);
    }

    function createGearIcon(size = 20) {
        return svgNode('svg', {
            width: size, height: size, viewBox: '0 0 24 24',
            fill: 'none', stroke: 'currentColor', 'stroke-width': 2.2,
            'stroke-linecap': 'round', 'stroke-linejoin': 'round',
        }, [
            svgNode('circle', { cx: 12, cy: 12, r: 3 }),
            svgNode('path', { d: 'M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z' }),
        ]);
    }

    function createCloseIcon() {
        return svgNode('svg', {
            width: 15, height: 15, viewBox: '0 0 24 24',
            fill: 'none', stroke: 'currentColor', 'stroke-width': 2.4,
            'stroke-linecap': 'round', 'stroke-linejoin': 'round',
        }, [
            svgNode('line', { x1: 18, y1: 6, x2: 6, y2: 18 }),
            svgNode('line', { x1: 6, y1: 6, x2: 18, y2: 18 }),
        ]);
    }

    function createInfoIcon() {
        return svgNode('svg', {
            width: 15, height: 15, viewBox: '0 0 24 24',
            fill: 'none', stroke: 'currentColor', 'stroke-width': 2.2,
            'stroke-linecap': 'round', 'stroke-linejoin': 'round',
            style: 'flex-shrink:0',
        }, [
            svgNode('circle', { cx: 12, cy: 12, r: 10 }),
            svgNode('line', { x1: 12, y1: 16, x2: 12, y2: 12 }),
            svgNode('line', { x1: 12, y1: 8, x2: 12.01, y2: 8 }),
        ]);
    }

    function createDragIcon() {
        return svgNode('svg', {
            width: 10, height: 10, viewBox: '0 0 24 24',
            fill: 'none', stroke: 'currentColor', 'stroke-width': 2.5,
            'stroke-linecap': 'round', 'stroke-linejoin': 'round',
        }, [
            svgNode('polyline', { points: '5 9 2 12 5 15' }),
            svgNode('polyline', { points: '9 5 12 2 15 5' }),
            svgNode('polyline', { points: '15 19 12 22 9 19' }),
            svgNode('polyline', { points: '19 9 22 12 19 15' }),
            svgNode('line', { x1: 2, y1: 12, x2: 22, y2: 12 }),
            svgNode('line', { x1: 12, y1: 2, x2: 12, y2: 22 }),
        ]);
    }

    function createResetIcon() {
        return svgNode('svg', {
            width: 13, height: 13, viewBox: '0 0 24 24',
            fill: 'none', stroke: 'currentColor', 'stroke-width': 2.2,
            'stroke-linecap': 'round', 'stroke-linejoin': 'round',
            style: 'margin-right:5px',
        }, [
            svgNode('path', { d: 'M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8' }),
            svgNode('path', { d: 'M21 3v5h-5' }),
            svgNode('path', { d: 'M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16' }),
            svgNode('path', { d: 'M3 21v-5h5' }),
        ]);
    }

    function createMagnifierIcon() {
        return svgNode('svg', {
            viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor',
            'stroke-width': 1.5, 'stroke-linecap': 'round', 'aria-hidden': 'true',
        }, [
            svgNode('circle', { cx: 7, cy: 7, r: 4.75 }),
            svgNode('path', { d: 'm10.5 10.5 3.25 3.25' }),
        ]);
    }

    function createGlisseButton({ icon, variant = 'glass', destructive = false, label = '', className = '', style = null, title = '', ariaLabel = '', onClick }) {
        const btn = el('button', {
            type: 'button',
            className: `lg-glass lg-button ${className}`.trim(),
            title: title || undefined,
            'aria-label': ariaLabel || undefined,
            style,
        });
        if (icon != null) btn.dataset.icon = label ? '' : 'only';
        if (variant && variant !== 'glass') btn.dataset.variant = variant;
        if (destructive) {
            btn.dataset.destructive = '';
            btn.style.setProperty('--lg-tint', 'var(--lg-destructive)');
        }
        let labelNode = null;
        if (icon) btn.appendChild(icon);
        if (label) {
            labelNode = el('span', null, label);
            btn.appendChild(labelNode);
        }
        if (onClick) btn.addEventListener('click', onClick);
        const destroyPress = attachPressPhysics(btn);
        return {
            el: btn,
            setLabel(next) {
                if (labelNode) labelNode.textContent = next;
                else btn.textContent = next;
            },
            setVariant(next) {
                if (!next || next === 'glass') delete btn.dataset.variant;
                else btn.dataset.variant = next;
            },
            destroy: destroyPress,
        };
    }

    function createGlisseInput({ value = '', placeholder = '', type = 'text', icon = null, className = '', style = null, min, max, onInput, onBlur, onKeyDown }) {
        const wrapper = el('div', {
            className: `lg-glass lg-input ${className}`.trim(),
            style,
        });
        if (icon) {
            wrapper.appendChild(el('span', { className: 'lg-input-icon' }, icon));
        }
        const input = el('input', {
            type,
            placeholder: placeholder || undefined,
            value: String(value),
            min: min != null ? String(min) : undefined,
            max: max != null ? String(max) : undefined,
        });
        wrapper.appendChild(input);

        let clearBtn = null;
        if (type === 'search') {
            clearBtn = el('button', {
                type: 'button',
                className: 'lg-input-clear',
                'aria-label': 'Clear',
                style: { display: value ? 'grid' : 'none' },
            }, svgNode('svg', {
                viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor',
                'stroke-width': 1.5, 'stroke-linecap': 'round',
            }, [svgNode('path', { d: 'm4.5 4.5 7 7m0-7-7 7' })]));
            clearBtn.addEventListener('pointerdown', (e) => e.preventDefault());
            clearBtn.addEventListener('click', () => {
                input.value = '';
                clearBtn.style.display = 'none';
                input.focus();
                if (onInput) onInput('');
            });
            wrapper.appendChild(clearBtn);
        }

        wrapper.addEventListener('pointerdown', (e) => {
            if (e.target !== input && e.target !== clearBtn) input.focus();
        });
        input.addEventListener('input', () => {
            if (clearBtn) clearBtn.style.display = input.value ? 'grid' : 'none';
            if (onInput) onInput(input.value);
        });
        if (onBlur) input.addEventListener('blur', () => onBlur(input.value));
        if (onKeyDown) input.addEventListener('keydown', onKeyDown);

        return {
            el: wrapper,
            input,
            getValue: () => input.value,
            setValue(next) {
                input.value = String(next);
                if (clearBtn) clearBtn.style.display = input.value ? 'grid' : 'none';
            },
        };
    }

    function createGlisseSearchField(opts) {
        return createGlisseInput(Object.assign({ type: 'search', icon: createMagnifierIcon() }, opts));
    }

    // Imperative Glisse Switch with full spring physics & pointer drag
    const SWITCH_TRAVEL = 21.7125;
    const clamp01 = (v) => Math.min(1, Math.max(0, v));
    const gestureHeld = (at, moved) => moved || performance.now() - at >= 150;

    function createGlisseSwitch({ checked = false, disabled = false, onChange }) {
        let isChecked = Boolean(checked);
        let isDisabled = Boolean(disabled);

        const fillEl = el('span', { className: 'lg-switch-fill', 'aria-hidden': 'true' });
        const faceEl = el('span', { className: 'lg-thumb-face' });
        const thumbEl = el('span', { className: 'lg-switch-thumb', 'aria-hidden': 'true' }, faceEl);
        const btn = el('button', {
            type: 'button',
            role: 'switch',
            'aria-checked': String(isChecked),
            className: 'lg-switch',
            disabled: isDisabled,
        }, [fillEl, thumbEl]);

        let x = 0;
        let scale = 0.65;
        const paint = () => {
            thumbEl.style.transform = `translate(${x}px, -50%) scale(${scale})`;
        };

        const initial = isChecked ? 1 : 0;
        const posSpring = createSpring(initial, 1000, 80, (val) => {
            x = val * SWITCH_TRAVEL;
            paint();
        });
        const colorSpring = createSpring(initial, 1000, 80, (val) => {
            fillEl.style.opacity = String(clamp01(val));
        });
        const liftSpring = createSpring(0, 2000, 80, (val) => {
            scale = 0.65 + 0.25 * val;
            faceEl.style.opacity = String(1 - 0.85 * clamp01(val));
            paint();
        });
        posSpring.paint();
        colorSpring.paint();
        liftSpring.paint();

        const syncSprings = (instant = false) => {
            btn.setAttribute('aria-checked', String(isChecked));
            posSpring.set(isChecked ? 1 : 0, instant);
            colorSpring.set(isChecked ? 1 : 0, instant);
        };

        let gesture = null;
        let ignoreClick = false;

        const settle = (next) => {
            const old = gesture;
            gesture = null;
            liftSpring.set(0);
            if (old && btn.hasPointerCapture(old.id)) btn.releasePointerCapture(old.id);
            if (next === undefined || next === isChecked) return syncSprings();
            isChecked = next;
            syncSprings();
            if (onChange) onChange(isChecked);
        };

        const onDown = (event) => {
            if (!event.isPrimary || event.button !== 0 || isDisabled) return;
            event.preventDefault();
            ignoreClick = false;
            gesture = {
                id: event.pointerId,
                x: event.clientX,
                y: event.clientY,
                from: isChecked ? 1 : 0,
                moved: false,
                at: performance.now(),
                box: btn.getBoundingClientRect(),
            };
            btn.setPointerCapture(event.pointerId);
            liftSpring.set(1);
        };
        const onMove = (event) => {
            if (event.pointerId !== gesture?.id) return;
            const dx = event.clientX - gesture.x;
            const dy = Math.abs(event.clientY - gesture.y);
            if (!gestureHeld(gesture.at, gesture.moved) && dy > 10 && dy > Math.abs(dx) + 4) {
                ignoreClick = true;
                return settle();
            }
            if (!gesture.moved && Math.abs(dx) < 4) return;
            gesture.moved = true;
            const val = gesture.from + dx / SWITCH_TRAVEL;
            const overshoot = val < 0 ? val : val > 1 ? val - 1 : 0;
            posSpring.set(clamp01(val) + overshoot / 22);
            colorSpring.set(val > 0.5 ? 1 : 0);
        };
        const onUp = (event) => {
            if (event.pointerId !== gesture?.id) return;
            ignoreClick = true;
            const { from, x: startX, moved, box } = gesture;
            const val = from + (event.clientX - startX) / SWITCH_TRAVEL;
            const near = event.clientY >= box.top - 24 && event.clientY <= box.bottom + 24;
            settle(moved ? val > 0.5 : near ? !isChecked : undefined);
        };
        const onTouchMove = (event) => {
            if (gesture && event.cancelable && gestureHeld(gesture.at, gesture.moved)) event.preventDefault();
        };
        const onCancel = () => {
            if (!gesture) return;
            ignoreClick = true;
            settle();
        };
        const onClick = () => {
            if (ignoreClick) ignoreClick = false;
            else if (!isDisabled) {
                isChecked = !isChecked;
                syncSprings();
                if (onChange) onChange(isChecked);
            }
        };

        btn.addEventListener('pointerdown', onDown);
        btn.addEventListener('pointermove', onMove);
        btn.addEventListener('pointerup', onUp);
        btn.addEventListener('pointercancel', onCancel);
        btn.addEventListener('lostpointercapture', onCancel);
        btn.addEventListener('touchmove', onTouchMove, { passive: false });
        btn.addEventListener('click', onClick);

        return {
            el: btn,
            setChecked(next) {
                const boolNext = Boolean(next);
                if (boolNext === isChecked) return;
                isChecked = boolNext;
                syncSprings();
            },
            setDisabled(next) {
                isDisabled = Boolean(next);
                btn.disabled = isDisabled;
            },
            destroy() {
                posSpring.stop();
                colorSpring.stop();
                liftSpring.stop();
            },
        };
    }

    // Imperative Glisse Slider
    function createGlisseSlider({ value = 1, min = 0.2, max = 1, step = 0.05, disabled = false, onChange }) {
        let curVal = Number(value);
        const calcProgress = (v) => (max > min ? Math.min(1, Math.max(0, (v - min) / (max - min))) : 0);

        const fillEl = el('span', { className: 'lg-slider-fill' });
        const trackEl = el('span', { className: 'lg-slider-track', 'aria-hidden': 'true' }, fillEl);
        const faceEl = el('span', { className: 'lg-thumb-face' });
        const thumbEl = el('span', { className: 'lg-slider-thumb', 'aria-hidden': 'true' }, faceEl);
        const input = el('input', {
            type: 'range',
            min: String(min),
            max: String(max),
            step: String(step),
            value: String(curVal),
            disabled: Boolean(disabled),
        });
        const sliderEl = el('div', {
            className: 'lg-slider',
            style: { '--lg-progress': String(calcProgress(curVal)) },
        }, [trackEl, thumbEl, input]);

        const outputEl = el('span', { className: 'slider__output' }, `${Math.round(curVal * 100)}%`);
        const wrapper = el('div', {
            className: 'field-slider-wrapper',
            dataset: disabled ? { disabled: 'true' } : undefined,
        }, [sliderEl, outputEl]);

        const liftSpring = createSpring(0, 2000, 80, (amount) => {
            thumbEl.style.scale = String(0.6 + 0.4 * amount);
            faceEl.style.opacity = String(1 - 0.85 * clamp01(amount));
        });
        let winUpAttached = false;
        const release = () => {
            if (winUpAttached) {
                safeWinRem('pointerup', release);
                winUpAttached = false;
            }
            liftSpring.set(0);
        };
        const hold = () => {
            if (input.disabled) return;
            liftSpring.set(1);
            if (!winUpAttached) {
                safeWinAdd('pointerup', release);
                winUpAttached = true;
            }
        };

        input.addEventListener('pointerdown', hold);
        ['pointerup', 'pointercancel', 'lostpointercapture', 'blur'].forEach((t) => input.addEventListener(t, release));

        input.addEventListener('input', () => {
            curVal = input.valueAsNumber;
            sliderEl.style.setProperty('--lg-progress', String(calcProgress(curVal)));
            outputEl.textContent = `${Math.round(curVal * 100)}%`;
            if (onChange) onChange(curVal);
        });

        return {
            el: wrapper,
            setValue(next) {
                curVal = Number(next);
                input.value = String(curVal);
                sliderEl.style.setProperty('--lg-progress', String(calcProgress(curVal)));
                outputEl.textContent = `${Math.round(curVal * 100)}%`;
            },
            setDisabled(next) {
                input.disabled = Boolean(next);
                if (next) wrapper.dataset.disabled = 'true';
                else delete wrapper.dataset.disabled;
            },
            destroy() {
                release();
                liftSpring.stop();
            },
        };
    }

    // Imperative Glisse Select (Morphing Menu with spring physics & scrubbing)
    const menuResistance = (value) => Math.sign(value) * 7 * (1 - Math.exp(-Math.abs(value) * 0.12 / 7));

    function createGlisseSelect({ options, selectedKey, ariaLabel = 'Options', align = 'end', onChange }) {
        let currentKey = selectedKey;
        let phase = 'closed';
        let activeMenuCleanup = null;

        const findOption = (k) => (options && options.find((o) => o.id === k)) || (options && options[0]) || { id: '', label: '' };

        const currentLabelEl = el('span', { className: 'lg-select-current-label' }, findOption(currentKey).label);
        const triggerContent = el('span', { className: 'lg-select-trigger-content' }, [
            currentLabelEl,
            createChevronIcon(),
        ]);

        const triggerBtn = el('button', {
            type: 'button',
            className: 'lg-glass lg-button',
            'aria-label': ariaLabel,
            'aria-haspopup': 'menu',
            'aria-expanded': 'false',
            dataset: { icon: '' },
        }, triggerContent);
        const destroyTriggerPress = attachPressPhysics(triggerBtn);

        const root = el('div', {
            className: 'lg-menu lg-menu-select',
            dataset: { phase: 'closed' },
        }, triggerBtn);

        let morphController = null;

        const closeMenu = (restoreFocus = true) => {
            if (phase === 'closed' || phase === 'leaving') return;
            phase = 'leaving';
            uiState.openMenuClosers.delete(closeMenu);
            root.dataset.phase = 'leaving';
            delete root.dataset.open;
            triggerBtn.setAttribute('aria-expanded', 'false');
            if (morphController) morphController.set(0);
            if (restoreFocus) triggerBtn.focus({ preventScroll: true });
        };

        const openMenu = () => {
            if (phase !== 'closed') return;
            phase = 'open';
            uiState.openMenuClosers.add(closeMenu);
            uiState.openMenuCount += 1;
            root.dataset.phase = 'open';
            root.dataset.open = 'true';
            root.classList.add('lg-menu--open', 'lg-menu--active');
            triggerBtn.setAttribute('aria-expanded', 'true');

            const surface = el('span', { className: 'lg-menu-surface', 'aria-hidden': 'true' });
            const plate = el('span', { className: 'lg-menu-plate', 'aria-hidden': 'true' });
            const content = el('div', { role: 'none', className: 'lg-menu-content' }, plate);

            options.forEach((opt, index) => {
                const isSelected = opt.id === currentKey;
                const textWrap = el('span', { className: 'lg-select-item-text' }, [
                    el('span', { className: 'lg-select-item-title' }, opt.label),
                    opt.desc ? el('span', { className: 'lg-select-item-desc' }, opt.desc) : null,
                ]);
                const inner = el('span', { className: 'lg-select-item-inner' }, [
                    textWrap,
                    isSelected ? createCheckIcon() : null,
                ]);
                const itemBtn = el('button', {
                    type: 'button',
                    role: 'menuitem',
                    className: 'lg-menu-item',
                    dataset: { index: String(index) },
                }, inner);
                content.appendChild(itemBtn);
            });

            const card = el('div', {
                role: 'menu',
                'aria-label': ariaLabel,
                className: 'lg-menu-card',
                dataset: { phase: 'open', align },
            }, [surface, content]);
            root.appendChild(card);

            const parentRow = root.closest('.field-row, .field-switch-row, .field-box, .switch');
            const parentCard = root.closest('.card, .col-stack');
            const modalEl = uiState.containerEl;
            if (parentRow) parentRow.setAttribute('data-menu-open', 'true');
            if (parentCard) parentCard.setAttribute('data-menu-open', 'true');
            root.setAttribute('data-menu-open', 'true');
            if (modalEl) modalEl.setAttribute('data-has-menu-open', 'true');

            const from = { width: triggerBtn.offsetWidth, height: triggerBtn.offsetHeight };
            const to = { width: card.offsetWidth, height: card.offsetHeight };
            const radius = parseFloat(getComputedStyle(surface).borderTopLeftRadius) || 18;
            const trailing = align !== 'start';
            const origin = {
                x: trailing ? to.width - from.width / 2 : from.width / 2,
                y: from.height / 2,
            };
            content.style.transformOrigin = `${origin.x}px ${origin.y}px`;

            let leaving = false;
            const unmountCard = () => {
                if (activeMenuCleanup) {
                    activeMenuCleanup();
                    activeMenuCleanup = null;
                }
                if (card.parentNode === root) root.removeChild(card);
                phase = 'closed';
                root.dataset.phase = 'closed';
                root.classList.remove('lg-menu--open', 'lg-menu--active');
            };

            const shape = createSpring(0, 600, 46, (value) => {
                const t = clamp01(value);
                const settled = t === 1;
                const w = from.width + (to.width - from.width) * t;
                const h = from.height + (to.height - from.height) * t;
                const s = 0.5 + 0.5 * t;
                const local = (edge, centre) => centre + (edge - centre) / s;
                const left = local(trailing ? to.width - w : 0, origin.x);
                const right = local(trailing ? to.width : w, origin.x);
                const bottom = local(h, origin.y);
                const top = local(0, origin.y);

                surface.style.width = settled ? '' : `${w}px`;
                surface.style.height = settled ? '' : `${h}px`;
                surface.style.opacity = String(clamp01(t / 0.2));
                triggerBtn.style.opacity = t === 0 ? '' : String(1 - clamp01(t / 0.2));

                content.style.opacity = String(leaving ? clamp01((t - 0.55) / 0.45) : clamp01((t - 0.15) / 0.6));
                content.style.transform = settled ? '' : `scale(${s})`;
                content.style.filter = settled ? '' : `blur(${6 * (1 - t)}px)`;
                content.style.clipPath = settled ? '' : `inset(${top}px ${to.width - right}px ${to.height - bottom}px ${left}px round ${radius / s}px)`;

                if (leaving && value === 0) unmountCard();
            });

            morphController = {
                set(target) {
                    leaving = target === 0;
                    card.dataset.phase = leaving ? 'leaving' : 'open';
                    if (leaving) shape.tune(900, 57);
                    else shape.tune(600, 46);
                    shape.set(target);
                },
            };
            shape.paint();
            morphController.set(1);

            const rows = () => [...card.querySelectorAll('.lg-menu-item:not(:disabled)')];
            rows()[0]?.focus({ preventScroll: true });

            const offset = { scale: 1, x: 0, y: 0 };
            const paintCard = () => {
                card.style.scale = String(offset.scale);
                card.style.translate = `${offset.x}px ${offset.y}px`;
            };
            const scaleSpring = createSpring(1, 650, 36, (v) => { offset.scale = v; paintCard(); });
            const xSpring = createSpring(0, 600, 30, (v) => { offset.x = v; paintCard(); });
            const ySpring = createSpring(0, 600, 30, (v) => { offset.y = v; paintCard(); });

            let gesture = null;
            let currentRow = null;
            let selectHandled = false;

            const highlight = (row) => {
                if (currentRow === row) return;
                const first = !currentRow;
                currentRow = row;
                if (!row) {
                    delete card.dataset.scrubbing;
                    plate.style.opacity = '0';
                    return;
                }
                card.dataset.scrubbing = '';
                plate.style.width = `${row.offsetWidth}px`;
                plate.style.height = `${row.offsetHeight}px`;
                if (first) plate.style.transition = 'none';
                plate.style.transform = `translate(${row.offsetLeft}px, ${row.offsetTop}px)`;
                plate.style.opacity = '1';
                if (first) {
                    void plate.offsetWidth;
                    plate.style.transition = '';
                }
            };

            const rowAt = (clientX, clientY) => {
                const rootNode = card.getRootNode ? card.getRootNode() : document;
                const hit = (rootNode && rootNode.elementFromPoint) ? rootNode.elementFromPoint(clientX, clientY) : document.elementFromPoint(clientX, clientY);
                const row = hit?.closest('.lg-menu-item');
                return row && !row.disabled && card.contains(row) ? row : null;
            };

            const selectIndex = (idx) => {
                const opt = options[idx];
                if (!opt) return;
                currentKey = opt.id;
                currentLabelEl.textContent = opt.label;
                closeMenu();
                if (onChange) onChange(opt.id);
            };

            const onDown = (event) => {
                if (!event.isPrimary || event.button !== 0) return;
                gesture = { id: event.pointerId, x: event.clientX, y: event.clientY };
                card.setPointerCapture(event.pointerId);
                card.dataset.pressed = '';
                scaleSpring.set(1 + 5 / Math.max(card.offsetWidth, card.offsetHeight, 200));
                highlight(rowAt(event.clientX, event.clientY));
            };
            const onMove = (event) => {
                if (!gesture) {
                    const row = event.pointerType === 'mouse' ? rowAt(event.clientX, event.clientY) : null;
                    if (row) highlight(row);
                    return;
                }
                if (event.pointerId !== gesture.id) return;
                highlight(rowAt(event.clientX, event.clientY));
                xSpring.set(menuResistance(event.clientX - gesture.x), true);
                ySpring.set(menuResistance(event.clientY - gesture.y), true);
            };
            const onEnd = (event) => {
                if (event.pointerId !== gesture?.id) return;
                const chosen = event.type === 'pointerup' ? rowAt(event.clientX, event.clientY) : null;
                highlight(null);
                gesture = null;
                delete card.dataset.pressed;
                scaleSpring.set(1);
                xSpring.set(0);
                ySpring.set(0);
                if (chosen) {
                    selectHandled = true;
                    selectIndex(Number(chosen.dataset.index));
                }
            };
            const onLeave = (event) => {
                if (!gesture && event.pointerType === 'mouse') highlight(null);
            };
            const onClick = (event) => {
                if (selectHandled) {
                    selectHandled = false;
                    return;
                }
                const row = event.target.closest('.lg-menu-item');
                if (row) selectIndex(Number(row.dataset.index));
            };
            const onKeyDown = (event) => {
                if (event.key === 'Escape') {
                    event.preventDefault();
                    event.stopPropagation();
                    closeMenu();
                } else if (event.key === 'Tab') {
                    closeMenu(false);
                } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
                    event.preventDefault();
                    if (!gesture) highlight(null);
                    const list = rows();
                    const activeEl = (card.getRootNode && card.getRootNode().activeElement) || document.activeElement;
                    const idx = list.indexOf(activeEl);
                    const nextIdx = event.key === 'Home' ? 0 : event.key === 'End' ? list.length - 1 : (idx + (event.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length;
                    list[nextIdx]?.focus();
                }
            };
            const onOutside = (event) => {
                const path = typeof event.composedPath === 'function' ? event.composedPath() : [event.target];
                if (path.includes(card) || path.includes(triggerBtn)) return;
                closeMenu(false);
            };

            card.addEventListener('pointerdown', onDown);
            card.addEventListener('pointermove', onMove);
            card.addEventListener('pointerleave', onLeave);
            card.addEventListener('pointerup', onEnd);
            card.addEventListener('pointercancel', onEnd);
            card.addEventListener('lostpointercapture', onEnd);
            card.addEventListener('click', onClick);
            card.addEventListener('keydown', onKeyDown);
            safeDocAdd('pointerdown', onOutside, true);

            activeMenuCleanup = () => {
                uiState.openMenuClosers.delete(closeMenu);
                uiState.openMenuCount = Math.max(0, uiState.openMenuCount - 1);
                if (parentRow) parentRow.removeAttribute('data-menu-open');
                if (parentCard) parentCard.removeAttribute('data-menu-open');
                root.removeAttribute('data-menu-open');
                if (modalEl && uiState.openMenuCount === 0) modalEl.removeAttribute('data-has-menu-open');
                [shape, scaleSpring, xSpring, ySpring].forEach((s) => s.stop());
                morphController = null;
                triggerBtn.style.opacity = '';
                safeDocRem('pointerdown', onOutside, true);
            };
        };

        triggerBtn.addEventListener('click', () => {
            if (phase === 'open') closeMenu();
            else if (phase === 'closed') openMenu();
        });

        return {
            el: root,
            setSelectedKey(nextKey) {
                currentKey = nextKey;
                currentLabelEl.textContent = findOption(nextKey).label;
            },
            destroy() {
                if (activeMenuCleanup) {
                    activeMenuCleanup();
                    activeMenuCleanup = null;
                }
                destroyTriggerPress();
            },
        };
    }

    // Imperative Glisse TabBar (GPU-composited lens + spring physics + native listeners)
    const TAB_REST = [1024, 58.9, 676, 47.8];
    const TAB_DRAG = [2500, 94, 576, 44.2];
    const TAB_KEYS = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
    const clampRange = (v, min, max) => Math.min(max, Math.max(min, v));

    function createGlisseTabBar({ items, value, onChange, style }) {
        let selectedIdx = items.findIndex((i) => i.value === value);
        const glassEl = el('span', { className: 'lg-glass lg-tab-bar-glass', 'aria-hidden': 'true' });
        const lensEl = el('span', { className: 'lg-glass lg-tab-lens', 'aria-hidden': 'true' });
        const rowEl = el('span', { className: 'lg-tab-row' }, items.map((item) =>
            el('span', { className: 'lg-tab-copy' }, item.label)
        ));
        const tintEl = el('span', { className: 'lg-tab-tint', 'aria-hidden': 'true' }, rowEl);

        const tabButtons = items.map((item, idx) => el('button', {
            type: 'button',
            role: 'tab',
            className: 'lg-tab',
            dataset: idx === selectedIdx ? { selected: '' } : undefined,
            'aria-selected': String(idx === selectedIdx),
            tabIndex: (idx === selectedIdx || (selectedIdx < 0 && idx === 0)) ? 0 : -1,
        }, item.label));

        const barEl = el('div', {
            role: 'tablist',
            className: 'lg-tab-bar',
            style: Object.assign({}, style, {
                '--lg-index': String(Math.max(selectedIdx, 0)),
                '--lg-tabs': String(items.length),
            }),
        }, [glassEl, ...tabButtons, tintEl, lensEl]);

        let slot = 0;
        let height = 0;
        let growX = 16;
        let growY = 12;
        let active = selectedIdx;
        let shown = false;
        let settleFrame = 0;
        let gesture = null;
        const state = { x: 0, lift: 0 };

        const measure = () => {
            const compStyle = getComputedStyle(barEl);
            slot = (barEl.clientWidth - parseFloat(compStyle.paddingLeft) - parseFloat(compStyle.paddingRight)) / tabButtons.length;
            height = lensEl.offsetHeight;
            growX = parseFloat(compStyle.getPropertyValue('--lg-lens-grow-x')) || 0;
            growY = parseFloat(compStyle.getPropertyValue('--lg-lens-grow-y')) || 0;
        };

        const paint = () => {
            if (!slot || !height) return;
            const { x, lift } = state;
            const sx = 1 + growX / slot * lift;
            const sy = 1 + growY / height * lift;
            lensEl.style.transform = tintEl.style.transform = `translateX(${x}px) scale(${sx}, ${sy})`;
            rowEl.style.transform = `scale(${1 / sx}, ${1 / sy}) translate(${-x + (sx - 1) * slot / 2}px, ${(sy - 1) * height / 2}px)`;
            if (!gesture && lift < 0.01) delete barEl.dataset.refracting;
        };

        const xSpring = createSpring(0, TAB_REST[0], TAB_REST[1], (v) => { state.x = v; paint(); });
        const liftSpring = createSpring(0, TAB_REST[2], TAB_REST[3], (v) => { state.lift = v; paint(); });

        const move = (target, lifted, instant = false) => {
            const [sK, sD, lK, lD] = gesture ? TAB_DRAG : TAB_REST;
            xSpring.tune(sK, sD);
            liftSpring.tune(lK, lD);
            xSpring.set(target, instant);
            liftSpring.set(lifted ? 1 : 0, instant);
        };

        const settle = (instant = false) => {
            if (gesture) return;
            const show = active >= 0;
            if (show) delete barEl.dataset.hidden;
            else barEl.dataset.hidden = '';
            if (show) move(active * slot, false, instant || !shown);
            shown = show;
        };

        const selectTabIndex = (idx) => {
            if (idx < 0 || idx >= items.length) return;
            cancelAnimationFrame(settleFrame);
            settleFrame = 0;
            selectedIdx = idx;
            active = idx;
            barEl.style.setProperty('--lg-index', String(idx));
            tabButtons.forEach((b, i) => {
                const sel = i === idx;
                if (sel) b.dataset.selected = '';
                else delete b.dataset.selected;
                b.setAttribute('aria-selected', String(sel));
                b.tabIndex = sel ? 0 : -1;
            });
            settle();
            if (onChange) onChange(items[idx].value);
        };

        const position = (event) => clampRange(gesture.anchor + event.clientX - gesture.x, 0, slot * (tabButtons.length - 1));
        const light = (event, box) => {
            glassEl.style.setProperty('--lg-x', `${clampRange((event.clientX - box.left) / box.width * 100, 0, 100)}%`);
            lensEl.style.setProperty('--lg-x', `${clampRange((event.clientX - box.left - 4 - state.x) / slot * 100, 0, 100)}%`);
        };
        const release = () => {
            const old = gesture;
            gesture = null;
            delete barEl.dataset.lifted;
            delete lensEl.dataset.pressed;
            if (old && barEl.hasPointerCapture(old.id)) barEl.releasePointerCapture(old.id);
            return old;
        };

        let suppressClick = false;
        let globalPointerAttached = false;

        const onPointerMove = (event) => {
            if (event.pointerId !== gesture?.id) return;
            if (!gesture.moved && Math.abs(event.clientX - gesture.x) > 6) {
                gesture.moved = true;
                barEl.setPointerCapture(event.pointerId);
            }
            if (gesture.moved) move(position(event), true);
            light(event, gesture.box);
        };

        const onPointerEnd = (event) => {
            if (event.pointerId !== gesture?.id) return;
            if (event.type === 'lostpointercapture' && event.target !== barEl) return;
            detachGlobalPointer();
            const idx = Math.round(position(event) / slot);
            const { moved, box } = release();
            const near = event.clientY >= box.top - 24 && event.clientY <= box.bottom + 24;
            if (event.type === 'pointerup' && (moved || near)) {
                suppressClick = true;
                settleFrame = requestAnimationFrame(() => {
                    settleFrame = 0;
                    settle();
                });
                tabButtons[idx]?.click();
            } else {
                suppressClick = moved;
                settle();
            }
        };

        const attachGlobalPointer = () => {
            if (!globalPointerAttached) {
                safeWinAdd('pointermove', onPointerMove);
                safeWinAdd('pointerup', onPointerEnd);
                safeWinAdd('pointercancel', onPointerEnd);
                globalPointerAttached = true;
            }
        };

        const detachGlobalPointer = () => {
            if (globalPointerAttached) {
                safeWinRem('pointermove', onPointerMove);
                safeWinRem('pointerup', onPointerEnd);
                safeWinRem('pointercancel', onPointerEnd);
                globalPointerAttached = false;
            }
        };

        const onPointerDown = (event) => {
            const tab = event.target.closest('.lg-tab');
            if (!event.isPrimary || event.button !== 0 || gesture || !tab) return;
            if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            cancelAnimationFrame(settleFrame);
            settleFrame = 0;
            measure();
            const box = barEl.getBoundingClientRect();
            gesture = {
                id: event.pointerId,
                x: event.clientX,
                anchor: tabButtons.indexOf(tab) * slot,
                moved: false,
                box,
                at: performance.now(),
            };
            suppressClick = false;
            barEl.dataset.lifted = '';
            barEl.dataset.refracting = '';
            delete barEl.dataset.hidden;
            lensEl.dataset.pressed = '';
            light(event, box);
            move(gesture.anchor, true, !shown);
            shown = true;
            attachGlobalPointer();
        };

        const onTouchMove = (event) => {
            if (gesture && event.cancelable && gestureHeld(gesture.at, gesture.moved)) event.preventDefault();
        };

        const onClick = (event) => {
            if (event.isTrusted && suppressClick && event.detail !== 0) {
                suppressClick = false;
                event.preventDefault();
                return;
            }
            const tab = event.target.closest('.lg-tab');
            if (!tab || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            selectTabIndex(tabButtons.indexOf(tab));
        };

        const onKeyDown = (event) => {
            const tab = event.target.closest('.lg-tab');
            if (!tab || !TAB_KEYS.includes(event.key)) return;
            event.preventDefault();
            const current = tabButtons.indexOf(tab);
            const idx = event.key === 'Home' ? 0 : event.key === 'End' ? tabButtons.length - 1 : (current + (event.key === 'ArrowRight' ? 1 : tabButtons.length - 1)) % tabButtons.length;
            selectTabIndex(idx);
            tabButtons[idx]?.focus();
        };

        const reset = () => {
            cancelAnimationFrame(settleFrame);
            settleFrame = 0;
            detachGlobalPointer();
            release();
            settle(true);
        };
        const onVisChange = () => { if (isRealDocHidden()) reset(); };

        const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => {
            measure();
            if (!gesture) settle(true);
        }) : null;
        if (observer) observer.observe(barEl);

        const destroyGlassRefract = attachRefraction(glassEl, false);
        const destroyLensRefract = attachRefraction(lensEl, true);

        barEl.dataset.ready = '';
        barEl.addEventListener('pointerdown', onPointerDown);
        barEl.addEventListener('lostpointercapture', onPointerEnd);
        barEl.addEventListener('touchmove', onTouchMove, { passive: false });
        barEl.addEventListener('click', onClick, true);
        barEl.addEventListener('keydown', onKeyDown);
        const offVis = addInternalVisListener(onVisChange);
        const offBlur = addInternalBlurListener(reset);

        requestAnimationFrame(() => {
            measure();
            settle(true);
        });

        return {
            el: barEl,
            setValue(nextVal) {
                const idx = items.findIndex((i) => i.value === nextVal);
                if (idx !== -1) selectTabIndex(idx);
            },
            destroy() {
                cancelAnimationFrame(settleFrame);
                detachGlobalPointer();
                xSpring.stop();
                liftSpring.stop();
                destroyGlassRefract();
                destroyLensRefract();
                if (observer) observer.disconnect();
                for (const key of ['ready', 'hidden', 'lifted', 'refracting']) delete barEl.dataset[key];
                barEl.removeEventListener('pointerdown', onPointerDown);
                barEl.removeEventListener('lostpointercapture', onPointerEnd);
                barEl.removeEventListener('touchmove', onTouchMove);
                barEl.removeEventListener('click', onClick, true);
                barEl.removeEventListener('keydown', onKeyDown);
                offVis();
                offBlur();
            },
        };
    }

    // ------------------------------------------------------------
    // Pure Session Context Snapshot (Zero DOM side effects)
    // ------------------------------------------------------------
    function buildSessionContextSnapshot() {
        if (sessionState.cachedContextSnapshot && sessionState.cachedContextRevision === sessionState.contextRevision) {
            return sessionState.cachedContextSnapshot;
        }
        const session = sessionState.activeSession;
        if (!session) {
            const emptySnap = {
                hasSession: false,
                sessionType: '',
                sessionId: '',
                sessionTitle: '',
                completed: false,
                questionId: null,
                questionLabel: '',
                questionType: '',
                questionRecommendedSeconds: 0,
                questionSnippet: '',
                predictedOp: null,
                predictedTotalSeconds: 0,
                contextRevision: sessionState.contextRevision,
            };
            sessionState.cachedContextSnapshot = emptySnap;
            sessionState.cachedContextRevision = sessionState.contextRevision;
            return emptySnap;
        }

        // Pure lookup without full-DOM query scanning on every stat bump
        const q = !session.completed ? identifyCurrentQuestion(null, null, null, false) : null;
        const pred = session.predictedFinalCall;
        let questionLabel = '';
        if (q) {
            const totalQ = Array.isArray(session.questionIds) ? session.questionIds.length : 0;
            const rawIdx = Array.isArray(session.questionIds) ? session.questionIds.indexOf(q.id) : -1;
            const num = rawIdx !== -1 ? (rawIdx + 1) : ((session.currentQuestionIndex || 0) + 1);
            questionLabel = totalQ > 0 ? `Q${num}/${totalQ}` : (q.id ? `Q#${q.id}` : '');
        } else if (Array.isArray(session.questionIds) && session.questionIds.length > 0 && !session.completed) {
            questionLabel = `0/${session.questionIds.length}`;
        }

        const snap = {
            hasSession: true,
            sessionType: session.sessionType || '',
            sessionId: session.sessionId || '',
            sessionTitle: session.title || '',
            completed: !!session.completed,
            questionId: q ? q.id : null,
            questionLabel,
            questionType: q ? (q.primaryType || 'Question') : '',
            questionRecommendedSeconds: q ? (q.recommendedSeconds || 0) : 0,
            questionSnippet: q ? (q.stemSnippet || '') : '',
            predictedOp: pred ? pred.operationName : (session.predictedOp || null),
            predictedTotalSeconds: pred ? (pred.predictedTotalSeconds || 0) : 0,
            contextRevision: sessionState.contextRevision,
        };
        sessionState.cachedContextSnapshot = snap;
        sessionState.cachedContextRevision = sessionState.contextRevision;
        return snap;
    }

    // ------------------------------------------------------------
    // Shadow DOM Host & Reactive Status Pill
    // ------------------------------------------------------------
    function syncRootThemeAndAccent() {
        try {
            if (document.documentElement && document.documentElement.style.getPropertyValue('--ul-accent') !== settings.accentColor) {
                document.documentElement.style.setProperty('--ul-accent', settings.accentColor);
            }
        } catch {}
        if (!uiState.containerEl) return;
        const effectiveTheme = getEffectiveTheme(settings.theme);
        if (uiState.containerEl.getAttribute('data-theme') !== effectiveTheme) {
            uiState.containerEl.setAttribute('data-theme', effectiveTheme);
        }
        if (uiState.containerEl.style.getPropertyValue('--accent') !== settings.accentColor) {
            uiState.containerEl.style.setProperty('--accent', settings.accentColor);
        }
    }

    function ensureUIHost() {
        if (uiState.shadowRoot && document.getElementById('__ul-heroui-host')) {
            return uiState.shadowRoot;
        }

        let host = document.getElementById('__ul-heroui-host');
        if (!host) {
            host = document.createElement('div');
            host.id = '__ul-heroui-host';
            host.setAttribute('data-glisse-backdrop', '');
            host.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:2147483647;';
            (document.body || document.documentElement).appendChild(host);
        }
        uiState.hostEl = host;

        if (!host.shadowRoot) {
            uiState.shadowRoot = host.attachShadow({ mode: 'open' });
        } else {
            uiState.shadowRoot = host.shadowRoot;
        }

        let styleEl = uiState.shadowRoot.getElementById('__ul-heroui-styles');
        if (!styleEl) {
            styleEl = document.createElement('style');
            styleEl.id = '__ul-heroui-styles';
            styleEl.textContent = getHeroUIStyles();
            uiState.shadowRoot.appendChild(styleEl);
        }

        let container = uiState.shadowRoot.getElementById('__ul-root');
        if (!container) {
            container = document.createElement('div');
            container.id = '__ul-root';
            container.className = 'heroui-root';
            container.setAttribute('data-glisse-backdrop', '');
            uiState.shadowRoot.appendChild(container);
        }
        uiState.containerEl = container;
        syncRootThemeAndAccent();
        renderStatusPill();
        return uiState.shadowRoot;
    }

    function removeStatusPill() {
        if (uiState.pillStatsUnsub) {
            uiState.pillStatsUnsub();
            uiState.pillStatsUnsub = null;
        }
        if (uiState.pillCleanup) {
            uiState.pillCleanup();
            uiState.pillCleanup = null;
        }
        if (uiState.pillEl) {
            uiState.pillEl.remove();
            uiState.pillEl = null;
            uiState.pillRefs = null;
        }
    }

    function renderStatusPill() {
        const shouldShow = settings.pillVisible && settings.keybindAction !== 'open-modal';
        if (!shouldShow) {
            removeStatusPill();
            return;
        }
        if (!uiState.containerEl) return;
        syncRootThemeAndAccent();

        if (!uiState.pillEl) {
            const dotSpan = el('span', { className: 'heroui-pill__dot' });
            const labelSpan = el('span', { className: 'heroui-pill__label' });
            const badgeEl = el('span', { className: 'heroui-pill__badge badge badge--sm' }, [dotSpan, labelSpan]);

            const blockedStatEl = el('span', { className: 'heroui-pill__stat-item' });
            const boostedStatEl = el('span', { className: 'heroui-pill__stat-item' });
            const statsWrapEl = el('span', { className: 'heroui-pill__stats' }, [blockedStatEl, boostedStatEl]);

            const mainEl = el('div', { className: 'heroui-pill__main' }, [badgeEl, statsWrapEl]);

            const gearIcon = createGearIcon(20);
            const indicatorDot = el('span', { className: 'heroui-pill__indicator-dot' });
            const gearBtn = el('button', {
                type: 'button',
                className: 'heroui-pill__gear',
                title: 'Open UpLearn Settings (Ctrl+Shift+U)',
            }, [gearIcon, indicatorDot]);

            const pill = el('div', {
                id: '__ul-pill',
                className: 'lg-glass heroui-pill',
            }, [mainEl, gearBtn]);

            pill.addEventListener('click', (e) => {
                if ((settings.pillMode || 'minimal') === 'minimal') {
                    e.preventDefault();
                    e.stopPropagation();
                    if (uiState.modalIsOpen) closeSettingsModal();
                    else openSettingsModal();
                }
            });

            mainEl.addEventListener('click', (e) => {
                if ((settings.pillMode || 'minimal') !== 'minimal') {
                    e.preventDefault();
                    e.stopPropagation();
                    applySettingChange('timeBoostEnabled', !settings.timeBoostEnabled);
                }
            });

            gearBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (uiState.modalIsOpen) closeSettingsModal();
                else openSettingsModal();
            });

            uiState.pillEl = pill;
            uiState.pillRefs = { badgeEl, labelSpan, blockedStatEl, boostedStatEl, gearIcon, indicatorDot };
            uiState.containerEl.appendChild(pill);
        }

        updateStatusPill();
    }

    function updateStatusPill() {
        const pill = uiState.pillEl;
        const refs = uiState.pillRefs;
        if (!pill || !refs) return;

        const mode = settings.pillMode || 'minimal';
        const isMinimal = mode === 'minimal';
        const isCompact = mode === 'compact';
        const isFull    = mode === 'full';
        const enabled   = settings.timeBoostEnabled;

        pill.className = `lg-glass heroui-pill ${isMinimal ? 'heroui-pill--minimal' : ''}`.trim();
        pill.dataset.mode = mode;

        const pos = POSITION_STYLES[settings.pillPosition] || POSITION_STYLES['bottom-right'];
        pill.style.left = pos.left || '';
        pill.style.right = pos.right || '';
        pill.style.top = pos.top || '';
        pill.style.bottom = pos.bottom || '';
        pill.style.opacity = String(settings.pillOpacity);

        if (isMinimal && !uiState.pillCleanup) {
            uiState.pillCleanup = attachRefraction(pill, false);
        } else if (!isMinimal && uiState.pillCleanup) {
            uiState.pillCleanup();
            uiState.pillCleanup = null;
        }

        const rangeLabel = settings.extraSecondsMin === settings.extraSecondsMax
            ? `+${settings.extraSecondsMin}s`
            : `+${settings.extraSecondsMin}–${settings.extraSecondsMax}s`;

        const kbText = formatKeybind(settings.uiToggleKeybind);
        const actionDesc = settings.keybindAction === 'open-modal' ? 'open/close settings' : 'hide/show';
        pill.title = isMinimal
            ? `UpLearn Control Panel (${kbText}) | Boost: ${enabled ? 'ON' : 'OFF'}`
            : `Click badge: toggle time boost | Click gear: Control Panel | ${kbText}: ${actionDesc}`;

        refs.badgeEl.className = `heroui-pill__badge badge badge--sm ${enabled ? 'badge--primary badge--accent' : 'badge--secondary'}`;
        refs.labelSpan.textContent = `${rangeLabel} ${enabled ? 'Active' : 'Paused'}`;

        const iconSize = isMinimal ? '20' : '18';
        refs.gearIcon.setAttribute('width', iconSize);
        refs.gearIcon.setAttribute('height', iconSize);
        refs.indicatorDot.style.display = enabled ? 'block' : 'none';

        refs.blockedStatEl.style.display = (isCompact || isFull) ? 'inline-flex' : 'none';
        refs.boostedStatEl.style.display = isFull ? 'inline-flex' : 'none';

        if (isCompact || isFull) {
            refs.blockedStatEl.textContent = `🛡 ${stats.blocked}`;
        }
        if (isFull) {
            const acc = sessionState.accumulatedExtraSeconds;
            refs.boostedStatEl.textContent = `⚡ ${stats.boosted}${acc > 0 ? ` (+${acc}s)` : ''}`;
        }

        // Subscribe to stats ONLY when pill is in compact or full mode
        if ((isCompact || isFull) && !uiState.pillStatsUnsub) {
            uiState.pillStatsUnsub = subscribeStats(() => {
                if (!uiState.pillRefs) return;
                const m = settings.pillMode || 'minimal';
                if (m === 'compact' || m === 'full') {
                    uiState.pillRefs.blockedStatEl.textContent = `🛡 ${stats.blocked}`;
                }
                if (m === 'full') {
                    const acc = sessionState.accumulatedExtraSeconds;
                    uiState.pillRefs.boostedStatEl.textContent = `⚡ ${stats.boosted}${acc > 0 ? ` (+${acc}s)` : ''}`;
                }
            });
        } else if (!isCompact && !isFull && uiState.pillStatsUnsub) {
            uiState.pillStatsUnsub();
            uiState.pillStatsUnsub = null;
        }
    }

    // ------------------------------------------------------------
    // Lazy Modal & Reactive Control Panel Tabs (Zero React)
    // ------------------------------------------------------------
    function registerBinding(key, updater) {
        if (!uiState.bindings[key]) uiState.bindings[key] = [];
        uiState.bindings[key].push(updater);
    }

    function runBindings(key, value) {
        const list = uiState.bindings[key];
        if (!list) return;
        for (let i = 0; i < list.length; i++) {
            try { list[i](value); } catch {}
        }
    }

    function createCard(titleText, badgeText, badgeColor, descriptionText, headerRightEl = null) {
        const titleLeft = el('span', null, titleText);
        const badgeEl = badgeText ? el('span', { className: `badge badge--sm badge--soft badge--${badgeColor || 'accent'}` }, badgeText) : null;
        const titleEl = el('div', { className: 'card__title' }, [titleLeft, badgeEl]);
        const descEl = descriptionText ? el('div', { className: 'card__description' }, descriptionText) : null;

        let headerEl;
        if (headerRightEl) {
            headerEl = el('div', { className: 'card__header' },
                el('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' } }, [
                    el('div', null, [titleEl, descEl]),
                    headerRightEl,
                ])
            );
        } else {
            headerEl = el('div', { className: 'card__header' }, [titleEl, descEl]);
        }

        const contentEl = el('div', { className: 'card__content' });
        const cardEl = el('div', { className: 'card card--secondary' }, [headerEl, contentEl]);
        return { cardEl, contentEl, badgeEl };
    }

    function createSwitchRow({ label, description, checked, disabled = false, settingKey, onChange }) {
        const sw = createGlisseSwitch({
            checked,
            disabled,
            onChange: (next) => {
                row.dataset.selected = next ? 'true' : 'false';
                if (onChange) onChange(next);
                else if (settingKey) applySettingChange(settingKey, next);
            },
        });
        uiState.modalCleanupFns.push(sw.destroy);

        const row = el('div', {
            className: 'field-switch-row',
            dataset: Object.assign({ selected: checked ? 'true' : 'false' }, disabled ? { disabled: 'true' } : null),
        }, [
            el('div', { className: 'field-switch-content' }, [
                el('div', { dataset: { slot: 'label' } }, label),
                description ? el('div', { dataset: { slot: 'description' } }, description) : null,
            ]),
            el('div', { style: { display: 'inline-flex', flexShrink: '0' }, onClick: (e) => e.stopPropagation() }, sw.el),
        ]);

        row.addEventListener('click', () => {
            if (row.dataset.disabled === 'true') return;
            const next = row.dataset.selected !== 'true';
            sw.setChecked(next);
            row.dataset.selected = next ? 'true' : 'false';
            if (onChange) onChange(next);
            else if (settingKey) applySettingChange(settingKey, next);
        });

        const api = {
            row,
            setChecked(next) {
                const boolNext = Boolean(next);
                row.dataset.selected = boolNext ? 'true' : 'false';
                sw.setChecked(boolNext);
            },
            setDisabled(next) {
                if (next) row.dataset.disabled = 'true';
                else delete row.dataset.disabled;
                sw.setDisabled(next);
            },
        };

        if (settingKey) {
            registerBinding(settingKey, (val) => api.setChecked(val));
        }
        return api;
    }

    function createFieldRow(labelText, subText, rightEl, extraClass = '', extraStyle = null) {
        const labelEl = el('label', null, [
            labelText,
            subText ? el('small', null, subText) : null,
        ]);
        const row = el('div', {
            className: `field-row ${extraClass}`.trim(),
            style: extraStyle,
        }, [labelEl, rightEl]);
        return { row, labelEl, smallEl: labelEl.querySelector('small') };
    }

    // --- TAB 1: TELEMETRY ---
    function buildTelemetryTab() {
        const panel = el('div', { className: 'tabs__panel', dataset: { tab: 'telemetry' } });
        const grid = el('div', { className: 'grid-2col' });
        const leftCol = el('div', { className: 'col-stack' });
        const rightCol = el('div', { className: 'col-stack' });
        grid.append(leftCol, rightCol);
        panel.appendChild(grid);

        // Left Column: Core Telemetry Intercepts
        const coreCard = createCard(
            'Core Telemetry Intercepts',
            'Protection Active',
            'accent',
            'Configure network intercepts, telemetry blocking presets, and client-side privacy cloaks.'
        );
        leftCol.appendChild(coreCard.cardEl);

        const presetSelect = createGlisseSelect({
            options: PRESET_OPTIONS,
            selectedKey: settings.telemetryPreset,
            ariaLabel: 'Active Preset',
            onChange: (val) => applySettingChange('telemetryPreset', val),
        });
        uiState.modalCleanupFns.push(presetSelect.destroy);
        registerBinding('telemetryPreset', (val) => presetSelect.setSelectedKey(val));
        coreCard.contentEl.appendChild(createFieldRow(
            'Active Preset',
            'Off · Simple (LogImproperUse only) · Harsh (Block all) · Custom',
            presetSelect.el
        ).row);

        const coreSwitches = [
            { key: 'blockLogImproperUse', label: 'Block LogImproperUse requests', desc: 'Silently drops UpLearn improper-use telemetry sent to API' },
            { key: 'blockLogEvent', label: 'Mock LogEvent mutations', desc: 'Resolves UI interaction logging locally to prevent client telemetry', val: settings.blockLogEvent !== false },
            { key: 'privateSearchMode', label: 'Private Search Mode', desc: 'Resolves LogLessonSearch mutations locally so search queries remain private', val: settings.privateSearchMode !== false },
            { key: 'suppressJitsu', label: 'Suppress Jitsu telemetry', desc: 'Checked: blocks jitsu.uplearn.co.uk. Unchecked: logs inspected packets.' },
            { key: 'blockWebSockets', label: 'Block telemetry WebSockets', desc: 'Terminates analytics & Intercom WebSocket connections' },
            { key: 'blockSendBeacon', label: 'Block telemetry sendBeacon', desc: 'Drops background beacon-style telemetry packets' },
            { key: 'blockDomElements', label: 'Block DOM telemetry injection', desc: 'Hooks script/iframe src and purges blocked tracker nodes' },
            { key: 'spoofVisibility', label: 'Spoof visibility & focus', desc: 'Ensures page always believes it is focused & visible' },
            { key: 'suppressConsoleNoise', label: "Suppress site's console noise", desc: 'Mutes [J-ERROR], Jitsu send errors, and blocked-host spam' },
        ];

        coreSwitches.forEach((swCfg) => {
            const swRow = createSwitchRow({
                label: swCfg.label,
                description: swCfg.desc,
                checked: swCfg.val !== undefined ? swCfg.val : Boolean(settings[swCfg.key]),
                settingKey: swCfg.key,
            });
            coreCard.contentEl.appendChild(swRow.row);
        });

        // Right Column: Third-Party Telemetry Services
        const svcKeys = Object.keys(TELEMETRY_SERVICES);
        const countActiveServices = () => {
            let active = 0;
            for (let i = 0; i < svcKeys.length; i++) {
                if (isServiceEnabledIn(settings, svcKeys[i])) active++;
            }
            return active;
        };

        const svcCard = createCard(
            'Third-Party Telemetry Services',
            `${countActiveServices()}/${svcKeys.length} Active`,
            'accent',
            'Toggle individual analytics trackers. Changes auto-switch preset to Custom.'
        );
        rightCol.appendChild(svcCard.cardEl);

        const updateSvcBadge = () => {
            if (svcCard.badgeEl) svcCard.badgeEl.textContent = `${countActiveServices()}/${svcKeys.length} Active`;
        };
        registerBinding('__telemetryServicesUI', updateSvcBadge);

        const servicesGrid = el('div', { className: 'services-grid' });
        const serviceTiles = [];

        const toggleSingleService = (key) => {
            const current = settings.telemetryServices || {};
            const next = !isServiceEnabledIn(settings, key);
            const updated = Object.assign({}, current, { [key]: next });
            LOG(`service "${TELEMETRY_SERVICES[key].label}" ${next ? 'ENABLED' : 'DISABLED'}`);
            applySettingChange('telemetryServices', updated);
        };

        svcKeys.forEach((key) => {
            const svc = TELEMETRY_SERVICES[key];
            const isChecked = isServiceEnabledIn(settings, key);
            const sw = createGlisseSwitch({
                checked: isChecked,
                onChange: () => toggleSingleService(key),
            });
            uiState.modalCleanupFns.push(sw.destroy);

            const tile = el('div', {
                className: 'service-tile',
                dataset: { checked: isChecked ? 'true' : 'false' },
            }, [
                el('span', { className: 'service-tile__label', title: svc.label }, svc.label),
                el('div', { style: { display: 'inline-flex', flexShrink: '0' }, onClick: (e) => e.stopPropagation() }, sw.el),
            ]);
            tile.addEventListener('click', () => toggleSingleService(key));
            servicesGrid.appendChild(tile);
            serviceTiles.push({ key, svc, tile, sw });
        });

        const syncAllServiceTiles = () => {
            for (let i = 0; i < serviceTiles.length; i++) {
                const item = serviceTiles[i];
                const chk = isServiceEnabledIn(settings, item.key);
                item.tile.dataset.checked = chk ? 'true' : 'false';
                item.sw.setChecked(chk);
            }
        };
        registerBinding('__telemetryServicesUI', syncAllServiceTiles);

        const searchField = createGlisseSearchField({
            placeholder: 'Search services…',
            className: 'services-search-field',
            onInput: (query) => {
                const q = query.toLowerCase().trim();
                for (let i = 0; i < serviceTiles.length; i++) {
                    const item = serviceTiles[i];
                    const match = !q || item.svc.label.toLowerCase().includes(q) || item.svc.hosts.some((h) => h.includes(q));
                    item.tile.style.display = match ? 'flex' : 'none';
                }
            },
        });

        const enableAllBtn = createGlisseButton({
            variant: 'glass',
            label: 'Enable All',
            className: 'services-action-btn',
            onClick: () => {
                const updated = {};
                for (const k in TELEMETRY_SERVICES) updated[k] = true;
                applySettingChange('telemetryServices', updated);
            },
        });
        const disableAllBtn = createGlisseButton({
            variant: 'glass',
            label: 'Disable All',
            className: 'services-action-btn',
            onClick: () => {
                const updated = {};
                for (const k in TELEMETRY_SERVICES) updated[k] = false;
                applySettingChange('telemetryServices', updated);
            },
        });
        uiState.modalCleanupFns.push(enableAllBtn.destroy, disableAllBtn.destroy);

        const toolbar = el('div', { className: 'services-toolbar' }, [
            searchField.el,
            el('div', { className: 'services-actions' }, [enableAllBtn.el, disableAllBtn.el]),
        ]);

        svcCard.contentEl.append(toolbar, servicesGrid);
        return panel;
    }

    // --- TAB 2: TIME BOOST ---
    function buildTimeBoostTab() {
        const panel = el('div', { className: 'tabs__panel', dataset: { tab: 'timeboost' } });
        const grid = el('div', { className: 'grid-2col' });
        const leftCol = el('div', { className: 'col-stack' });
        const rightCol = el('div', { className: 'col-stack' });
        grid.append(leftCol, rightCol);
        panel.appendChild(grid);

        // Left Column: Question Time Boost
        const boostCard = createCard(
            'Question Time Boost',
            settings.timeBoostEnabled ? 'Active' : 'Paused',
            settings.timeBoostEnabled ? 'success' : 'default',
            'Automatically injects extra time spent into question submissions and quiz completions.'
        );
        leftCol.appendChild(boostCard.cardEl);

        const dynamicTimeRow = createSwitchRow({
            label: 'Dynamic question time calculation',
            description: 'Adapts time per question based on type, word count, math/blanks, marks, and retries',
            checked: settings.dynamicTimeEnabled !== false,
            disabled: !settings.timeBoostEnabled,
            settingKey: 'dynamicTimeEnabled',
        });

        const timeBoostRow = createSwitchRow({
            label: 'Enable question time boost',
            description: 'Injects calculated time bonuses into question answering and quiz completion API calls',
            checked: settings.timeBoostEnabled,
            settingKey: 'timeBoostEnabled',
        });
        registerBinding('timeBoostEnabled', (enabled) => {
            dynamicTimeRow.setDisabled(!enabled);
            if (boostCard.badgeEl) {
                boostCard.badgeEl.textContent = enabled ? 'Active' : 'Paused';
                boostCard.badgeEl.className = `badge badge--sm badge--soft badge--${enabled ? 'success' : 'default'}`;
            }
        });

        const predictFinalRow = createSwitchRow({
            label: 'Predict & sync final completion call',
            description: 'Tracks active session and syncs final quiz, walkthrough, and video completion payloads',
            checked: settings.predictFinalCallEnabled !== false,
            settingKey: 'predictFinalCallEnabled',
        });

        boostCard.contentEl.append(timeBoostRow.row, dynamicTimeRow.row, predictFinalRow.row);

        // Extra Seconds Range
        const getRangeHint = () => (settings.extraSecondsMin === settings.extraSecondsMax)
            ? `Every question receives +${settings.extraSecondsMin}s bonus.`
            : `Each question rolls a random +${settings.extraSecondsMin}–${settings.extraSecondsMax}s bonus.`;

        const minInput = createGlisseInput({
            type: 'number',
            value: settings.extraSecondsMin,
            min: 1,
            max: 3600,
            style: { width: '88px', height: '34px' },
            onBlur: (val) => {
                const n = parseInt(val, 10);
                if (!isNaN(n) && n >= 1) applySettingChange('extraSecondsRange', { min: n, max: settings.extraSecondsMax });
                else minInput.setValue(settings.extraSecondsMin);
            },
            onKeyDown: (e) => { if (e.key === 'Enter') minInput.input.blur(); },
        });
        const maxInput = createGlisseInput({
            type: 'number',
            value: settings.extraSecondsMax,
            min: 1,
            max: 3600,
            style: { width: '88px', height: '34px' },
            onBlur: (val) => {
                const n = parseInt(val, 10);
                if (!isNaN(n) && n >= 1) applySettingChange('extraSecondsRange', { min: settings.extraSecondsMin, max: n });
                else maxInput.setValue(settings.extraSecondsMax);
            },
            onKeyDown: (e) => { if (e.key === 'Enter') maxInput.input.blur(); },
        });

        const rangeRow = createFieldRow(
            'Extra Seconds Range',
            getRangeHint(),
            el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } }, [
                minInput.el,
                el('span', { style: { color: 'var(--lg-muted)', fontWeight: '600' } }, 'to'),
                maxInput.el,
                el('span', { style: { color: 'var(--lg-muted)', fontWeight: '600' } }, 's'),
            ])
        );
        boostCard.contentEl.appendChild(rangeRow.row);

        // Quick Range Presets
        const presetButtons = QUICK_RANGE_PRESETS.map((p) => {
            const isSelected = p.min === settings.extraSecondsMin && p.max === settings.extraSecondsMax;
            const btn = createGlisseButton({
                variant: isSelected ? 'filled' : 'glass',
                label: p.label,
                style: { height: '30px', padding: '0 13px', fontSize: '12px', borderRadius: '9999px', fontWeight: isSelected ? '600' : '500' },
                onClick: () => applySettingChange('extraSecondsRange', { min: p.min, max: p.max }),
            });
            uiState.modalCleanupFns.push(btn.destroy);
            return { preset: p, btn };
        });

        const syncRangeUI = () => {
            minInput.setValue(settings.extraSecondsMin);
            maxInput.setValue(settings.extraSecondsMax);
            if (rangeRow.smallEl) rangeRow.smallEl.textContent = getRangeHint();
            presetButtons.forEach(({ preset, btn }) => {
                const sel = preset.min === settings.extraSecondsMin && preset.max === settings.extraSecondsMax;
                btn.setVariant(sel ? 'filled' : 'glass');
                btn.el.style.fontWeight = sel ? '600' : '500';
            });
        };
        registerBinding('extraSecondsRange', syncRangeUI);
        registerBinding('extraSecondsMin', syncRangeUI);
        registerBinding('extraSecondsMax', syncRangeUI);

        const presetsBox = el('div', {
            className: 'field-box',
            style: { padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: '10px' },
        }, [
            el('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' } }, [
                el('span', { style: { fontSize: '13px', fontWeight: '590', color: 'var(--lg-foreground)' } }, 'Quick Range Presets'),
                el('span', { style: { fontSize: '11px', color: 'var(--lg-muted)' } }, 'Tap to apply duration'),
            ]),
            el('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '8px', width: '100%' } }, presetButtons.map((x) => x.btn.el)),
        ]);
        boostCard.contentEl.appendChild(presetsBox);

        // Left Bottom Card: Interactive Quiz Page Button
        const quizBtnCard = createCard(
            'Interactive Quiz Page Button',
            'Quiz Button',
            settings.manualTimeButtonEnabled ? 'accent' : 'default',
            "Injects an interactive \"+Add time\" button right next to UpLearn's submit button."
        );
        leftCol.appendChild(quizBtnCard.cardEl);

        const manualStackRow = createSwitchRow({
            label: 'Manual time stacks with auto-boost',
            description: 'Checked: manual extra adds on top of auto-boost. Unchecked: manual extra replaces auto-boost for that submission.',
            checked: settings.manualTimeStacksWithAuto,
            disabled: !settings.manualTimeButtonEnabled,
            settingKey: 'manualTimeStacksWithAuto',
        });

        const manualBtnRow = createSwitchRow({
            label: 'Enable question page "+Add time" button',
            description: 'Displays button next to Submit on question pages. Click to enter custom seconds (e.g. 120 or 2m).',
            checked: settings.manualTimeButtonEnabled,
            settingKey: 'manualTimeButtonEnabled',
        });
        registerBinding('manualTimeButtonEnabled', (enabled) => {
            manualStackRow.setDisabled(!enabled);
            if (quizBtnCard.badgeEl) {
                quizBtnCard.badgeEl.className = `badge badge--sm badge--soft badge--${enabled ? 'accent' : 'default'}`;
            }
        });
        quizBtnCard.contentEl.append(manualBtnRow.row, manualStackRow.row);

        // Right Column: Video Lesson Automation
        const isVideoAutoActive = () => settings.fullVideoWatchedEnabled || settings.autoSkipVideoEnabled || settings.addVideoDurationToTimeSpent;
        const videoCard = createCard(
            'Video Lesson Automation',
            'Video Auto',
            isVideoAutoActive() ? 'success' : 'default',
            'Automate video lesson playback, skip straight to completion, and credit full duration.'
        );
        rightCol.appendChild(videoCard.cardEl);

        const syncVideoBadge = () => {
            if (videoCard.badgeEl) {
                videoCard.badgeEl.className = `badge badge--sm badge--soft badge--${isVideoAutoActive() ? 'success' : 'default'}`;
            }
        };
        registerBinding('fullVideoWatchedEnabled', syncVideoBadge);
        registerBinding('autoSkipVideoEnabled', syncVideoBadge);
        registerBinding('addVideoDurationToTimeSpent', syncVideoBadge);

        videoCard.contentEl.append(
            createSwitchRow({
                label: 'Always mark videos as fully watched (100%)',
                description: 'Sets percentWatched to 1 on CompleteVideoLesson mutations so every video registers as fully completed',
                checked: settings.fullVideoWatchedEnabled,
                settingKey: 'fullVideoWatchedEnabled',
            }).row,
            createSwitchRow({
                label: 'Auto-skip video (skips to 1s before end)',
                description: 'Automatically seeks straight to 1 second before the end so it completes immediately',
                checked: settings.autoSkipVideoEnabled,
                settingKey: 'autoSkipVideoEnabled',
            }).row,
            createSwitchRow({
                label: 'Add video duration to timeSpent',
                description: 'In CompleteVideoLesson payload, rewrites timeSpent to equal full duration (e.g. 17m33s = PT1053S)',
                checked: settings.addVideoDurationToTimeSpent,
                settingKey: 'addVideoDurationToTimeSpent',
            }).row
        );

        // Right Bottom Card: Live Session Bonus Activity
        const sessionCard = createCard(
            'Live Session Bonus Activity',
            sessionState.accumulatedExtraSeconds > 0 ? `+${sessionState.accumulatedExtraSeconds}s Active` : '0s Pending',
            sessionState.accumulatedExtraSeconds > 0 ? 'accent' : 'default',
            'Real-time quiz bonus accumulated in this session to inject into UpLearn summaries.'
        );
        rightCol.appendChild(sessionCard.cardEl);

        const qBadge = el('span', { className: 'badge badge--sm badge--soft badge--default' }, 'None');
        const qRow = createFieldRow('Active Question Context', 'Open a quiz, video, summary, or exam lesson to detect active questions', qBadge);

        const predBadge = el('span', { className: 'badge badge--sm badge--soft badge--default' }, 'None');
        const predRow = createFieldRow(
            'Predicted Final API Call',
            'Waiting for an active quiz, lesson, or exam session',
            el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', flexShrink: '0' } }, predBadge)
        );

        const accValueEl = el('span', {
            style: { fontSize: '15px', fontWeight: '700', color: 'var(--accent, var(--lg-fill))', fontVariantNumeric: 'tabular-nums' },
        }, `+${sessionState.accumulatedExtraSeconds}s`);
        const accRow = createFieldRow(
            'Accumulated Time Bonus',
            'Currently queued bonus to be credited on submission',
            el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } }, accValueEl)
        );

        const updateLiveSessionCard = () => {
            const acc = sessionState.accumulatedExtraSeconds;
            if (sessionCard.badgeEl) {
                sessionCard.badgeEl.textContent = acc > 0 ? `+${acc}s Active` : '0s Pending';
                sessionCard.badgeEl.className = `badge badge--sm badge--soft badge--${acc > 0 ? 'accent' : 'default'}`;
            }
            accValueEl.textContent = `+${acc}s`;

            const ctx = buildSessionContextSnapshot();
            if (qRow.smallEl) {
                qRow.smallEl.textContent = ctx.hasSession
                    ? `${ctx.sessionTitle || ctx.sessionType}${ctx.questionLabel ? ` · ${ctx.questionLabel}` : ''}${ctx.questionSnippet ? ` — "${ctx.questionSnippet}"` : ''}`
                    : 'Open a quiz, video, summary, or exam lesson to detect active questions';
            }
            qBadge.textContent = ctx.questionType
                ? `${ctx.questionType}${ctx.questionRecommendedSeconds ? ` · ~${ctx.questionRecommendedSeconds}s` : ''}`
                : (ctx.hasSession ? (ctx.completed ? 'Completed' : 'Standby') : 'None');
            qBadge.className = `badge badge--sm badge--soft badge--${ctx.questionType ? 'accent' : 'default'}`;

            if (predRow.smallEl) {
                predRow.smallEl.textContent = ctx.predictedOp
                    ? `Intercepts and syncs ${ctx.predictedOp} when this ${ctx.sessionType || 'activity'} finishes`
                    : 'Waiting for an active quiz, lesson, or exam session';
            }
            predBadge.textContent = ctx.predictedOp
                ? `${ctx.predictedOp}${ctx.predictedTotalSeconds > 0 ? ` (~${formatSeconds(ctx.predictedTotalSeconds)})` : ''}`
                : 'None';
            predBadge.className = `badge badge--sm badge--soft badge--${ctx.predictedOp ? 'success' : 'default'}`;
        };

        const addBonus = (sec) => {
            sessionState.accumulatedExtraSeconds += sec;
            if (sessionState.activeSession) updatePredictedFinalCall(sessionState.activeSession);
            bumpContextRevision();
            bumpStat('manualBoosted');
            updateLiveSessionCard();
            LOG('manual bonus added: +' + sec + 's (total ' + sessionState.accumulatedExtraSeconds + 's)');
        };

        const btn30 = createGlisseButton({ variant: 'glass', label: '+30s', onClick: () => addBonus(30) });
        const btn60 = createGlisseButton({ variant: 'glass', label: '+60s', onClick: () => addBonus(60) });
        const btnClear = createGlisseButton({
            variant: 'glass',
            destructive: true,
            label: 'Clear',
            title: 'Clear accumulated bonus',
            onClick: () => {
                sessionState.accumulatedExtraSeconds = 0;
                sessionState.accumulatedQuestionCount = 0;
                if (sessionState.activeSession) updatePredictedFinalCall(sessionState.activeSession);
                bumpContextRevision();
                updateLiveSessionCard();
                LOG('manual bonus cleared');
            },
        });
        uiState.modalCleanupFns.push(btn30.destroy, btn60.destroy, btnClear.destroy);

        const manualBoostRow = createFieldRow(
            'Manual Session Boost',
            'Quickly queue additional bonus seconds or clear pending bonus',
            el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', flexShrink: '0' } }, [btn30.el, btn60.el, btnClear.el])
        );

        sessionCard.contentEl.append(qRow.row, predRow.row, accRow.row, manualBoostRow.row);
        updateLiveSessionCard();
        registerBinding('__liveSessionSync', updateLiveSessionCard);
        return panel;
    }

    // --- TAB 3: PREFERENCES ---
    function buildPreferencesTab() {
        const panel = el('div', { className: 'tabs__panel', dataset: { tab: 'preferences' } });
        const grid = el('div', { className: 'grid-2col' });
        const leftCol = el('div', { className: 'col-stack' });
        const rightCol = el('div', { className: 'col-stack' });
        grid.append(leftCol, rightCol);
        panel.appendChild(grid);

        // Left Column: Control Panel Window & Theme
        const themeCard = createCard(
            'Control Panel Window & Theme',
            'Visuals',
            'accent',
            'Configure floating window mode, color theme, and liquid glass refraction.'
        );
        leftCol.appendChild(themeCard.cardEl);

        themeCard.contentEl.appendChild(createSwitchRow({
            label: 'Draggable Glass Window',
            description: 'Float the Control Panel as a movable window with liquid glass refraction over the page',
            checked: settings.draggableUI,
            settingKey: 'draggableUI',
        }).row);

        const themeSelect = createGlisseSelect({
            options: THEME_OPTIONS,
            selectedKey: settings.theme,
            ariaLabel: 'Control Panel Theme',
            onChange: (val) => applySettingChange('theme', val),
        });
        uiState.modalCleanupFns.push(themeSelect.destroy);
        registerBinding('theme', (val) => themeSelect.setSelectedKey(val));
        themeCard.contentEl.appendChild(createFieldRow(
            'Control Panel Theme',
            'Translucent dark, frosted light, or system matching',
            themeSelect.el
        ).row);

        // Accent Swatches + Custom Color Picker
        const swatchNodes = QUICK_COLOR_SWATCHES.map((c) => {
            const isSelected = c.hex.toLowerCase() === settings.accentColor.toLowerCase();
            const swEl = el('div', {
                className: 'color-swatch',
                dataset: { active: isSelected ? 'true' : 'false' },
                style: { backgroundColor: c.hex },
                title: c.name,
                onClick: () => applySettingChange('accentColor', c.hex),
            }, isSelected ? createCheckIcon('', 14, 3) : null);
            return { hex: c.hex.toLowerCase(), el: swEl };
        });

        const colorPickerInput = el('input', {
            type: 'color',
            value: settings.accentColor,
            style: { opacity: '0', position: 'absolute', inset: '0', width: '100%', height: '100%', cursor: 'pointer' },
            onInput: (e) => applySettingChange('accentColor', e.target.value),
        });
        const colorWheelLabel = el('label', {
            title: 'Custom hex color',
            style: {
                width: '26px', height: '26px', borderRadius: '50%',
                background: 'conic-gradient(from 180deg at 50% 50%, #FF0000 0deg, #FFA500 60deg, #FFFF00 120deg, #008000 180deg, #0000FF 240deg, #EE82EE 300deg, #FF0000 360deg)',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', boxShadow: '0 2px 6px rgba(0, 0, 0, 0.2)',
                position: 'relative', overflow: 'hidden', flexShrink: '0',
            },
        }, colorPickerInput);

        registerBinding('accentColor', (hex) => {
            const lower = String(hex).toLowerCase();
            colorPickerInput.value = hex;
            swatchNodes.forEach((s) => {
                const active = s.hex === lower;
                s.el.dataset.active = active ? 'true' : 'false';
                if (active && !s.el.firstChild) s.el.appendChild(createCheckIcon('', 14, 3));
                else if (!active && s.el.firstChild) s.el.textContent = '';
            });
        });

        themeCard.contentEl.appendChild(createFieldRow(
            'Theme Accent Color',
            'Primary tint for switches, badges, and controls',
            el('div', { style: { display: 'flex', alignItems: 'center', gap: '12px' } }, [
                el('div', { className: 'color-swatches' }, swatchNodes.map((s) => s.el)),
                colorWheelLabel,
            ])
        ).row);

        // Left Bottom Card: UpLearn Webpage Tweaks
        const tweaksCard = createCard(
            'UpLearn Webpage Tweaks',
            'Page Tweaks',
            'accent',
            'Enhance your UpLearn browsing experience with soft dark mode and screen controls.'
        );
        leftCol.appendChild(tweaksCard.cardEl);
        tweaksCard.contentEl.append(
            createSwitchRow({
                label: 'UpLearn Soft Dark Mode',
                description: 'Soft high-contrast dark theme across all lesson and quiz pages',
                checked: settings.darkMode,
                settingKey: 'darkMode',
            }).row,
            createSwitchRow({
                label: 'Prevent auto fullscreen',
                description: 'Blocks the website from silently forcing fullscreen mode',
                checked: settings.disableAutoFullscreen,
                settingKey: 'disableAutoFullscreen',
            }).row
        );

        // Right Column: Hotkeys & Floating Status Button
        const hotkeyCard = createCard(
            'Hotkeys & Floating Status Button',
            'Shortcuts',
            'accent',
            'Configure keyboard triggers and floating island button behavior.'
        );
        rightCol.appendChild(hotkeyCard.cardEl);

        const kbActionSelect = createGlisseSelect({
            options: KEYBIND_ACTION_OPTIONS,
            selectedKey: settings.keybindAction || 'toggle-pill',
            ariaLabel: 'Keybind Action',
            onChange: (val) => applySettingChange('keybindAction', val),
        });
        uiState.modalCleanupFns.push(kbActionSelect.destroy);
        registerBinding('keybindAction', (val) => kbActionSelect.setSelectedKey(val));
        hotkeyCard.contentEl.appendChild(createFieldRow(
            'Keybind Action',
            'Behavior when pressing your global keyboard shortcut',
            kbActionSelect.el
        ).row);

        const recordBtn = createGlisseButton({
            variant: 'glass',
            className: 'keybind-btn',
            label: formatKeybind(settings.uiToggleKeybind),
            title: 'Click to record new keybind',
            onClick: () => {
                uiState.capturingKeybind = !uiState.capturingKeybind;
                syncKeybindButtonUI();
                LOG('keybind capture ' + (uiState.capturingKeybind ? 'started' : 'cancelled'));
            },
        });
        const clearKbBtn = createGlisseButton({
            variant: 'glass',
            label: '✕',
            title: 'Clear keybind',
            ariaLabel: 'Clear keybind',
            onClick: () => {
                if (uiState.capturingKeybind) {
                    uiState.capturingKeybind = false;
                    syncKeybindButtonUI();
                    return;
                }
                applySettingChange('uiToggleKeybind', { code: null, ctrl: false, shift: false, alt: false, meta: false });
                LOG('keybind cleared');
            },
        });
        clearKbBtn.el.dataset.icon = 'only';
        uiState.modalCleanupFns.push(recordBtn.destroy, clearKbBtn.destroy);

        const syncKeybindButtonUI = () => {
            if (uiState.capturingKeybind) {
                recordBtn.el.classList.add('keybind-btn--capturing');
                recordBtn.setLabel('Press any key…');
            } else {
                recordBtn.el.classList.remove('keybind-btn--capturing');
                recordBtn.setLabel(formatKeybind(settings.uiToggleKeybind));
            }
        };
        registerBinding('__capturingKeybind', syncKeybindButtonUI);
        registerBinding('uiToggleKeybind', syncKeybindButtonUI);

        const kbRow = createFieldRow(
            'Global Shortcut Keybind',
            settings.keybindAction === 'open-modal'
                ? 'Keyboard shortcut to directly open or close the Control Panel'
                : 'Keyboard shortcut to show or hide the floating status pill',
            el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', flexShrink: '0' } }, [recordBtn.el, clearKbBtn.el])
        );
        hotkeyCard.contentEl.appendChild(kbRow.row);

        const openModalCallout = el('div', {
            className: 'field-callout',
            style: { margin: '4px 0', display: settings.keybindAction === 'open-modal' ? 'flex' : 'none' },
        }, [
            createInfoIcon(),
            el('span', null, 'Floating button is hidden because Keybind Action is set to "Open Settings Directly". Press your shortcut to toggle settings.'),
        ]);

        const pillModeSelect = createGlisseSelect({
            options: PILL_MODE_OPTIONS,
            selectedKey: settings.pillMode,
            ariaLabel: 'Pill Information Display',
            onChange: (val) => applySettingChange('pillMode', val),
        });
        const pillPosSelect = createGlisseSelect({
            options: PILL_POS_OPTIONS,
            selectedKey: settings.pillPosition,
            ariaLabel: 'Pill Dock Position',
            onChange: (val) => applySettingChange('pillPosition', val),
        });
        const pillOpacitySlider = createGlisseSlider({
            value: settings.pillOpacity,
            min: 0.2,
            max: 1,
            step: 0.05,
            onChange: (val) => applySettingChange('pillOpacity', val),
        });
        uiState.modalCleanupFns.push(pillModeSelect.destroy, pillPosSelect.destroy, pillOpacitySlider.destroy);
        registerBinding('pillMode', (v) => pillModeSelect.setSelectedKey(v));
        registerBinding('pillPosition', (v) => pillPosSelect.setSelectedKey(v));
        registerBinding('pillOpacity', (v) => pillOpacitySlider.setValue(v));

        const pillModeRow = createFieldRow('Pill Information Display', 'Select how much info is displayed on the floating pill', pillModeSelect.el).row;
        const pillPosRow = createFieldRow('Pill Dock Position', 'Corner of the screen where the status pill floats', pillPosSelect.el).row;
        const pillOpacityRow = createFieldRow('Pill Opacity', 'Adjust background transparency', pillOpacitySlider.el).row;

        const syncKeybindActionRows = () => {
            const isOpenModal = settings.keybindAction === 'open-modal';
            if (kbRow.smallEl) {
                kbRow.smallEl.textContent = isOpenModal
                    ? 'Keyboard shortcut to directly open or close the Control Panel'
                    : 'Keyboard shortcut to show or hide the floating status pill';
            }
            openModalCallout.style.display = isOpenModal ? 'flex' : 'none';
            pillModeRow.style.display = isOpenModal ? 'none' : 'flex';
            pillPosRow.style.display = isOpenModal ? 'none' : 'flex';
            pillOpacityRow.style.display = isOpenModal ? 'none' : 'flex';
        };
        syncKeybindActionRows();
        registerBinding('keybindAction', syncKeybindActionRows);

        hotkeyCard.contentEl.append(openModalCallout, pillModeRow, pillPosRow, pillOpacityRow);

        // Right Bottom Card: Diagnostics & Maintenance
        const diagCard = createCard(
            'Diagnostics & Maintenance',
            'System',
            'accent',
            'Developer console diagnostics and factory settings reset.'
        );
        rightCol.appendChild(diagCard.cardEl);

        const logSelect = createGlisseSelect({
            options: LOG_LEVEL_OPTIONS,
            selectedKey: settings.logLevel,
            ariaLabel: 'Console Logging Level',
            onChange: (val) => applySettingChange('logLevel', val),
        });
        uiState.modalCleanupFns.push(logSelect.destroy);
        registerBinding('logLevel', (v) => logSelect.setSelectedKey(v));
        diagCard.contentEl.appendChild(createFieldRow(
            'Console Logging Level',
            'Verbose inspects bodies and prints grouped block reports',
            logSelect.el
        ).row);

        // Non-blocking two-step reset confirmation (zero window.confirm calls)
        let resetConfirmArmed = false;
        let resetConfirmTimer = null;
        let resetDoneTimer = null;
        const resetAllBtn = createGlisseButton({
            variant: 'glass',
            destructive: true,
            label: 'Reset All Settings',
            onClick: () => {
                if (!resetConfirmArmed) {
                    resetConfirmArmed = true;
                    resetAllBtn.setLabel('Click again to confirm');
                    if (resetConfirmTimer) clearTimeout(resetConfirmTimer);
                    resetConfirmTimer = setTimeout(() => {
                        resetConfirmArmed = false;
                        resetConfirmTimer = null;
                        resetAllBtn.setLabel('Reset All Settings');
                    }, 3500);
                    return;
                }
                if (resetConfirmTimer) {
                    clearTimeout(resetConfirmTimer);
                    resetConfirmTimer = null;
                }
                resetConfirmArmed = false;
                resetAllSettings();
                resetAllBtn.setLabel('✓ Reset');
                if (resetDoneTimer) clearTimeout(resetDoneTimer);
                resetDoneTimer = setTimeout(() => {
                    resetDoneTimer = null;
                    resetAllBtn.setLabel('Reset All Settings');
                }, 1400);
            },
        });
        uiState.modalCleanupFns.push(() => {
            if (resetConfirmTimer) clearTimeout(resetConfirmTimer);
            if (resetDoneTimer) clearTimeout(resetDoneTimer);
            resetAllBtn.destroy();
        });

        const dangerRow = el('div', {
            className: 'field-row field-row--danger',
            style: { marginTop: '2px' },
        }, [
            el('div', null, [
                el('div', { style: { fontSize: '13px', fontWeight: '600', color: 'var(--lg-foreground)' } }, 'Reset All Preferences'),
                el('div', { style: { fontSize: '11.5px', color: 'var(--lg-muted)', marginTop: '2px' } }, 'Restore all settings & services to factory defaults'),
            ]),
            resetAllBtn.el,
        ]);
        diagCard.contentEl.appendChild(dangerRow);

        return panel;
    }

    // --- TAB 4: STATISTICS ---
    function buildStatsTab() {
        const panel = el('div', { className: 'tabs__panel', dataset: { tab: 'stats' } });

        const clearStatsBtn = createGlisseButton({
            variant: 'glass',
            icon: createResetIcon(),
            label: 'Clear Session Metrics',
            onClick: () => {
                resetAllStats();
                LOG('stats reset');
            },
        });
        uiState.modalCleanupFns.push(clearStatsBtn.destroy);

        const statsCard = createCard(
            'Session Activity & Shields',
            'Real-Time',
            'accent',
            'Live metric counters accumulated in this browser session.',
            clearStatsBtn.el
        );
        panel.appendChild(statsCard.cardEl);

        const createStatTile = (labelText, getter) => {
            const valEl = el('span', { className: 'stat-card__value' }, getter());
            const tileEl = el('div', { className: 'stat-card' }, [
                el('span', { className: 'stat-card__label' }, labelText),
                valEl,
            ]);
            return { tileEl, valEl, getter };
        };

        const statTiles = [
            // Privacy & Telemetry Shields
            createStatTile('Trackers Blocked', () => String(stats.blocked)),
            createStatTile('Improper Use', () => String(stats.logImproperUseBlocked)),
            createStatTile('Jitsu Packets', () => String(stats.jitsuPackets)),
            createStatTile('FS Blocked', () => String(stats.fullscreenBlocked)),
            createStatTile('Console Muted', () => String(stats.consoleSuppressed)),
            createStatTile('API Posts', () => String(stats.apiPosts)),
            // Time Boost & Video Automation
            createStatTile('Boosted Qs', () => String(stats.boosted)),
            createStatTile('Pending Bonus', () => `${sessionState.accumulatedExtraSeconds}s`),
            createStatTile('Group Bonus', () => `${stats.groupExtra}s`),
            createStatTile('Manual Boosts', () => String(stats.manualBoosted || 0)),
            createStatTile('Videos 100%', () => String(stats.videosMaxed || 0)),
            createStatTile('Videos Skipped', () => String(stats.videosSkipped || 0)),
            createStatTile('Video Time Added', () => `+${formatSeconds(stats.videoTimeAdded || 0)}`),
            createStatTile('Qs Identified', () => String(stats.questionsIdentified || 0)),
            createStatTile('Final Calls Synced', () => String(stats.finalCallsModified || 0)),
        ];

        const privacyGrid = el('div', { className: 'stats-grid' }, statTiles.slice(0, 6).map((t) => t.tileEl));
        const boostGrid = el('div', { className: 'stats-grid' }, statTiles.slice(6).map((t) => t.tileEl));

        const sectionsWrap = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '14px' } }, [
            el('div', null, [
                el('div', {
                    style: { fontSize: '12px', fontWeight: '600', color: 'var(--lg-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '8px' },
                }, '🛡 Privacy & Telemetry Shields'),
                privacyGrid,
            ]),
            el('div', null, [
                el('div', {
                    style: { fontSize: '12px', fontWeight: '600', color: 'var(--lg-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '8px' },
                }, '⚡ Time Boost & Video Automation'),
                boostGrid,
            ]),
        ]);
        statsCard.contentEl.appendChild(sectionsWrap);

        const refreshStatTiles = () => {
            for (let i = 0; i < statTiles.length; i++) {
                const next = statTiles[i].getter();
                if (statTiles[i].valEl.textContent !== next) {
                    statTiles[i].valEl.textContent = next;
                }
            }
        };
        registerBinding('__statsSync', refreshStatTiles);
        return panel;
    }

    // Modal Window Geometry Helpers
    const getDefaultModalDims = () => ({
        w: Math.min(920, window.innerWidth * 0.92),
        h: Math.min(680, window.innerHeight * 0.86),
    });
    const clampModalCoord = (val, size, viewport) =>
        Math.min(Math.max(10, Math.round(val)), Math.max(10, viewport - size - 10));

    function loadSavedModalPos() {
        const { w, h } = getDefaultModalDims();
        try {
            const saved = localStorage.getItem(WINDOW_POS_KEY);
            if (saved) {
                const p = JSON.parse(saved);
                if (typeof p.x === 'number' && typeof p.y === 'number') {
                    return {
                        x: clampModalCoord(p.x, w, window.innerWidth),
                        y: clampModalCoord(p.y, h, window.innerHeight),
                    };
                }
            }
        } catch {}
        return {
            x: Math.max(10, Math.round((window.innerWidth - w) / 2)),
            y: Math.max(10, Math.round((window.innerHeight - h) / 2)),
        };
    }

    function openSettingsModal() {
        ensureUIHost();
        if (uiState.modalCloseTimer) {
            clearTimeout(uiState.modalCloseTimer);
            uiState.modalCloseTimer = null;
        }
        if (uiState.modalIsOpen && !uiState.modalIsClosing) return;

        // If reopening mid-close animation, tear down previous DOM first
        if (uiState.modalBackdropEl) {
            unmountModalImmediate();
        }

        uiState.modalIsOpen = true;
        uiState.modalIsClosing = false;
        uiState.bindings = {};
        uiState.tabPanels = {};
        uiState.openMenuCount = 0;
        uiState.openMenuClosers.clear();

        let modalPos = loadSavedModalPos();
        const isDraggable = Boolean(settings.draggableUI);

        const backdrop = el('div', {
            id: '__ul-settings-overlay',
            className: `modal__backdrop ${isDraggable ? 'modal__backdrop--draggable' : ''}`.trim(),
            dataset: { glisseBackdrop: '' },
        });
        backdrop.addEventListener('click', (e) => {
            if (!settings.draggableUI && e.target && e.target.id === '__ul-settings-overlay') {
                closeSettingsModal();
            }
        });

        const container = el('div', {
            className: `modal__container ${isDraggable ? 'modal__container--draggable' : ''}`.trim(),
        });

        const dialog = el('div', {
            className: `modal__dialog ${isDraggable ? 'modal__dialog--draggable' : ''}`.trim(),
            role: 'dialog',
            'aria-modal': isDraggable ? 'false' : 'true',
            style: isDraggable ? { left: `${modalPos.x}px`, top: `${modalPos.y}px` } : null,
        });
        dialog.addEventListener('click', (e) => e.stopPropagation());

        const dragHintRow = el('div', {
            style: {
                fontSize: '10.5px', color: 'var(--lg-muted)',
                display: isDraggable ? 'flex' : 'none',
                alignItems: 'center', gap: '4px', marginTop: '1px',
            },
        }, [createDragIcon(), el('span', null, 'Draggable Liquid Glass')]);

        const brand = el('div', { className: 'modal__brand' }, [
            el('div', { className: 'modal__icon' }, createGearIcon(20)),
            el('div', null, [
                el('div', { className: 'modal__title-box' }, el('h2', { className: 'modal__heading' }, 'UpLearn Control Panel')),
                dragHintRow,
            ]),
        ]);

        const bodyEl = el('div', { className: 'modal__body' });

        const ensureTabBuilt = (tabId) => {
            if (uiState.tabPanels[tabId]) return uiState.tabPanels[tabId];
            let panel;
            if (tabId === 'telemetry') panel = buildTelemetryTab();
            else if (tabId === 'timeboost') panel = buildTimeBoostTab();
            else if (tabId === 'preferences') panel = buildPreferencesTab();
            else panel = buildStatsTab();
            uiState.tabPanels[tabId] = panel;
            bodyEl.appendChild(panel);
            return panel;
        };

        const activateTab = (tabId) => {
            uiState.activeTab = tabId;
            ensureTabBuilt(tabId);
            for (const key in uiState.tabPanels) {
                const p = uiState.tabPanels[key];
                const active = key === tabId;
                if (active) p.dataset.active = 'true';
                else delete p.dataset.active;
                p.style.display = active ? 'flex' : 'none';
            }
            if (tabId === 'stats') runBindings('__statsSync');
            if (tabId === 'timeboost') runBindings('__liveSessionSync');
        };

        const tabBar = createGlisseTabBar({
            items: SETTINGS_TAB_ITEMS,
            value: uiState.activeTab,
            style: { '--lg-tab-width': '124px', '--lg-tab-height': '34px' },
            onChange: activateTab,
        });
        uiState.tabBarApi = tabBar;
        uiState.modalCleanupFns.push(tabBar.destroy);

        const closeBtn = createGlisseButton({
            variant: 'glass',
            icon: createCloseIcon(),
            title: 'Close (Esc)',
            ariaLabel: 'Close modal',
            style: { width: '36px', height: '36px', padding: '0' },
            onClick: closeSettingsModal,
        });
        uiState.modalCleanupFns.push(closeBtn.destroy);

        const header = el('header', {
            className: `modal__header ${isDraggable ? 'modal__header--draggable' : ''}`.trim(),
        }, [
            brand,
            el('div', { className: 'modal__header-nav' }, tabBar.el),
            closeBtn.el,
        ]);

        // Draggable window pointer handling
        let dragState = null;
        const onDragMove = (moveEvt) => {
            if (!dragState) return;
            const dx = moveEvt.clientX - dragState.startX;
            const dy = moveEvt.clientY - dragState.startY;
            const nextX = clampModalCoord(dragState.initX + dx, dragState.dialogW, window.innerWidth);
            const nextY = clampModalCoord(dragState.initY + dy, dragState.dialogH, window.innerHeight);
            if (nextX === modalPos.x && nextY === modalPos.y) return;
            modalPos = { x: nextX, y: nextY };
            dialog.style.left = `${nextX}px`;
            dialog.style.top = `${nextY}px`;
        };
        const onDragEnd = () => {
            if (!dragState) return;
            dragState = null;
            header.classList.remove('modal__header--dragging');
            safeWinRem('pointermove', onDragMove);
            safeWinRem('pointerup', onDragEnd);
            safeWinRem('pointercancel', onDragEnd);
            try { localStorage.setItem(WINDOW_POS_KEY, JSON.stringify(modalPos)); } catch {}
        };
        header.addEventListener('pointerdown', (e) => {
            if (!settings.draggableUI || e.button !== 0) return;
            const t = e.target;
            if (t && t.closest && t.closest('button, a, input, select, textarea, .lg-tab, .lg-tab-bar, .lg-button')) return;
            e.preventDefault();
            const rect = dialog.getBoundingClientRect();
            dragState = {
                startX: e.clientX,
                startY: e.clientY,
                initX: modalPos.x,
                initY: modalPos.y,
                dialogW: rect.width,
                dialogH: rect.height,
            };
            header.classList.add('modal__header--dragging');
            safeWinAdd('pointermove', onDragMove, { passive: true });
            safeWinAdd('pointerup', onDragEnd);
            safeWinAdd('pointercancel', onDragEnd);
        });

        const onViewportResize = () => {
            if (!settings.draggableUI) return;
            const { w, h } = getDefaultModalDims();
            const nextX = clampModalCoord(modalPos.x, w, window.innerWidth);
            const nextY = clampModalCoord(modalPos.y, h, window.innerHeight);
            if (nextX !== modalPos.x || nextY !== modalPos.y) {
                modalPos = { x: nextX, y: nextY };
                dialog.style.left = `${nextX}px`;
                dialog.style.top = `${nextY}px`;
            }
        };
        safeWinAdd('resize', onViewportResize);

        registerBinding('draggableUI', (enabled) => {
            backdrop.classList.toggle('modal__backdrop--draggable', !!enabled);
            container.classList.toggle('modal__container--draggable', !!enabled);
            dialog.classList.toggle('modal__dialog--draggable', !!enabled);
            header.classList.toggle('modal__header--draggable', !!enabled);
            dialog.setAttribute('aria-modal', enabled ? 'false' : 'true');
            dragHintRow.style.display = enabled ? 'flex' : 'none';
            if (enabled) {
                modalPos = loadSavedModalPos();
                dialog.style.left = `${modalPos.x}px`;
                dialog.style.top = `${modalPos.y}px`;
            } else {
                dialog.style.left = '';
                dialog.style.top = '';
            }
        });

        uiState.modalCleanupFns.push(() => {
            onDragEnd();
            safeWinRem('resize', onViewportResize);
        });

        dialog.append(header, bodyEl);
        container.appendChild(dialog);
        backdrop.appendChild(container);
        uiState.modalBackdropEl = backdrop;
        uiState.containerEl.appendChild(backdrop);

        activateTab(uiState.activeTab);

        // Subscribe to reactive stats updates while modal is open
        uiState.statsUnsub = subscribeStats(() => {
            if (uiState.activeTab === 'stats') runBindings('__statsSync');
            if (uiState.activeTab === 'timeboost') runBindings('__liveSessionSync');
        });
    }

    function unmountModalImmediate() {
        if (uiState.statsUnsub) {
            uiState.statsUnsub();
            uiState.statsUnsub = null;
        }
        for (let i = 0; i < uiState.modalCleanupFns.length; i++) {
            try { uiState.modalCleanupFns[i](); } catch {}
        }
        uiState.modalCleanupFns = [];
        uiState.bindings = {};
        uiState.tabPanels = {};
        uiState.tabBarApi = null;
        uiState.openMenuCount = 0;
        uiState.openMenuClosers.clear();
        if (uiState.containerEl) uiState.containerEl.removeAttribute('data-has-menu-open');
        if (uiState.modalBackdropEl) {
            uiState.modalBackdropEl.remove();
            uiState.modalBackdropEl = null;
        }
        pruneUnusedLenses();
        uiState.modalIsOpen = false;
        uiState.modalIsClosing = false;
    }

    function closeSettingsModal() {
        if (uiState.capturingKeybind) {
            uiState.capturingKeybind = false;
            runBindings('__capturingKeybind');
        }
        if (!uiState.modalIsOpen || uiState.modalIsClosing) return;

        uiState.modalIsOpen = false;
        uiState.modalIsClosing = true;
        if (uiState.modalBackdropEl) {
            uiState.modalBackdropEl.classList.add('modal__backdrop--closing');
        }
        if (uiState.modalCloseTimer) clearTimeout(uiState.modalCloseTimer);
        uiState.modalCloseTimer = setTimeout(() => {
            uiState.modalCloseTimer = null;
            unmountModalImmediate();
        }, 190);
    }

    function resetAllStats() {
        for (const k in stats) stats[k] = 0;
        sessionState.accumulatedExtraSeconds = 0;
        sessionState.accumulatedQuestionCount = 0;
        if (sessionState.activeSession) updatePredictedFinalCall(sessionState.activeSession);
        bumpContextRevision();
        updateStatusPill();
        runBindings('__statsSync');
        runBindings('__liveSessionSync');
    }

    function resetAllSettings() {
        Object.assign(settings, DEFAULT_SETTINGS);
        settings.telemetryServices = buildDefaultTelemetryServices();
        settings.uiToggleKeybind = Object.assign({}, DEFAULT_KEYBIND);
        normalizeRange(settings);
        saveSettings(true);
        syncDomObserver();
        if (settings.logLevel !== 'verbose') {
            sessionState.latestExamPaperData = null;
            sessionState.latestUserProfile = null;
            sessionState.latestFeatureFlags = null;
            sessionState.latestGlobalFeatureFlags = null;
            sessionState.latestQuizFeedback = null;
        }
        applyDarkMode();
        ensureButton();
        patchVisibilityProps();
        installHasFocusPatch();
        initVideoAutoSkipController();
        syncRootThemeAndAccent();
        renderStatusPill();
        for (const key in settings) {
            runBindings(key, settings[key]);
        }
        runBindings('__telemetryServicesUI');
        LOG('settings reset to defaults');
    }

    // ------------------------------------------------------------
    // Central Setting Mutator (Consolidated SETTING_EFFECTS Map)
    // ------------------------------------------------------------
    const syncLiveSessionEffect = () => {
        if (sessionState.activeSession) updatePredictedFinalCall(sessionState.activeSession);
        bumpContextRevision();
        runBindings('__liveSessionSync');
    };

    const SETTING_EFFECTS = {
        blockDomElements: () => { syncDomObserver(); },
        dynamicTimeEnabled: (v) => {
            LOG('dynamic question time calculation ' + (v ? 'ENABLED' : 'DISABLED'));
            updateLabel();
        },
        predictFinalCallEnabled: (v) => {
            LOG('final API call prediction & sync ' + (v ? 'ENABLED' : 'DISABLED'));
            syncLiveSessionEffect();
            updateLabel();
        },
        manualTimeButtonEnabled: (v) => {
            syncDomObserver();
            LOG('manual "Add time" button ' + (v ? 'ENABLED' : 'DISABLED'));
            if (!v) clearManualButtonState();
            else ensureButton();
        },
        manualTimeStacksWithAuto: (v) => {
            LOG('manual time stacking with auto-boost ' + (v ? 'ENABLED' : 'DISABLED'));
        },
        fullVideoWatchedEnabled: (v) => {
            LOG('full video watch toggle (percentWatched=1) ' + (v ? 'ENABLED' : 'DISABLED'));
            syncLiveSessionEffect();
        },
        autoSkipVideoEnabled: (v) => {
            if (v) initVideoAutoSkipController();
            LOG('auto-skip video to questions / completion ' + (v ? 'ENABLED' : 'DISABLED'));
        },
        addVideoDurationToTimeSpent: (v) => {
            LOG('add full video duration to timeSpent ' + (v ? 'ENABLED' : 'DISABLED'));
            syncLiveSessionEffect();
        },
        suppressJitsu: (v) => {
            LOG('Jitsu telemetry ' + (v ? 'SUPPRESSED (blocked + logged)' : 'ALLOWED (passed through + logged)'));
            runBindings('__telemetryServicesUI');
        },
        blockLogEvent: (v) => {
            LOG('LogEvent local mocking ' + (v ? 'ENABLED' : 'DISABLED'));
        },
        privateSearchMode: (v) => {
            LOG('Private search mode ' + (v ? 'ENABLED' : 'DISABLED'));
        },
        disableAutoFullscreen: (v) => {
            LOG('auto-fullscreen blocking ' + (v ? 'ENABLED' : 'DISABLED'));
        },
        spoofVisibility: (v) => {
            patchVisibilityProps();
            installHasFocusPatch();
            LOG('visibility spoofing ' + (v ? 'ENABLED' : 'DISABLED'));
        },
        darkMode: () => {
            applyDarkMode();
        },
        logLevel: (v) => {
            if (v !== 'verbose') {
                sessionState.latestExamPaperData = null;
                sessionState.latestUserProfile = null;
                sessionState.latestFeatureFlags = null;
                sessionState.latestGlobalFeatureFlags = null;
                sessionState.latestQuizFeedback = null;
            }
            if (publicApi) {
                if (v === 'verbose') window.__ul = publicApi;
                else try { delete window.__ul; } catch {}
            }
            LOG('log level set to:', v);
        },
        keybindAction: (v) => {
            if (v === 'open-modal') settings.pillVisible = false;
            else if (v === 'toggle-pill') settings.pillVisible = true;
            LOG('keybind action set to:', v, '| pillVisible:', settings.pillVisible);
        },
        theme: () => { syncRootThemeAndAccent(); },
        accentColor: () => { syncRootThemeAndAccent(); },
    };

    function applySettingChange(key, value) {
        if (key === 'telemetryPreset') {
            if (value === settings.telemetryPreset && value !== 'custom') return;
            if (value !== 'custom') {
                applyingPreset = true;
                applyTelemetryPreset(value);
                applyingPreset = false;
            } else {
                settings.telemetryPreset = 'custom';
            }
            syncDomObserver();
            saveSettings();
            LOG('telemetry preset:', value);
            for (let i = 0; i < PRESET_SYNC_KEYS.length; i++) {
                const k = PRESET_SYNC_KEYS[i];
                runBindings(k, settings[k]);
            }
            runBindings('__telemetryServicesUI');
            return;
        }

        if (key === 'extraSecondsRange') {
            settings.extraSecondsMin = value && value.min;
            settings.extraSecondsMax = value && value.max;
            normalizeRange(settings);
            saveSettings();
            updateStatusPill();
            LOG('range set to:', settings.extraSecondsMin, '–', settings.extraSecondsMax);
            runBindings('extraSecondsRange');
            return;
        }

        if (key === 'telemetryServices') {
            const prevJitsu = settings.suppressJitsu;
            settings.telemetryServices = Object.assign({}, value);
            if (typeof settings.telemetryServices.jitsu === 'boolean') {
                settings.suppressJitsu = settings.telemetryServices.jitsu;
            }
            settings.telemetryPreset = 'custom';
            saveSettings();
            if (settings.suppressJitsu !== prevJitsu) {
                LOG('Jitsu telemetry ' + (settings.suppressJitsu ? 'SUPPRESSED (blocked + logged)' : 'ALLOWED (passed through + logged)'));
                runBindings('suppressJitsu', settings.suppressJitsu);
            }
            runBindings('__telemetryServicesUI');
            runBindings('telemetryPreset', settings.telemetryPreset);
            return;
        }

        if (settings[key] === value) return;

        settings[key] = value;

        if (key === 'suppressJitsu' && settings.telemetryServices) {
            settings.telemetryServices.jitsu = !!value;
        }

        if (key === 'extraSecondsMin' || key === 'extraSecondsMax') {
            normalizeRange(settings);
        }

        if (!applyingPreset && INDIVIDUAL_TELEMETRY_SETTINGS.has(key)) {
            settings.telemetryPreset = 'custom';
        }

        if (key === 'pillOpacity') {
            if (uiState.pillOpacityLogTimer) clearTimeout(uiState.pillOpacityLogTimer);
            uiState.pillOpacityLogTimer = setTimeout(() => {
                uiState.pillOpacityLogTimer = null;
                LOG('setting changed: pillOpacity =', settings.pillOpacity);
            }, 300);
        } else {
            LOG('setting changed:', key, '=', value);
        }

        const effect = SETTING_EFFECTS[key];
        if (effect) effect(value);

        // Persist AFTER all side-effect mutations complete
        saveSettings();

        // Sync floating pill & bound modal controls
        renderStatusPill();
        runBindings(key, settings[key]);
        if (settings.telemetryPreset === 'custom' && INDIVIDUAL_TELEMETRY_SETTINGS.has(key)) {
            runBindings('telemetryPreset', 'custom');
        }
    }

    // Listen to OS color-scheme changes when theme === 'auto'
    try {
        if (typeof window.matchMedia === 'function') {
            const mql = window.matchMedia('(prefers-color-scheme: light)');
            if (typeof mql.addEventListener === 'function') {
                mql.addEventListener('change', () => {
                    if (settings.theme === 'auto') syncRootThemeAndAccent();
                });
            }
        }
    } catch {}

    // ============================================================
    // 18. GLOBAL KEYBOARD SHORTCUTS, BOOTSTRAP & PUBLIC API
    // ============================================================
    const globalKeydownHandler = (e) => {
        if (uiState.capturingKeybind) {
            e.preventDefault();
            e.stopPropagation();
            if (e.code === 'Escape') {
                uiState.capturingKeybind = false;
                runBindings('__capturingKeybind');
                LOG('keybind capture cancelled');
                return;
            }
            const kb = captureKeybindFromEvent(e);
            uiState.capturingKeybind = false;
            applySettingChange('uiToggleKeybind', kb);
            runBindings('__capturingKeybind');
            LOG('keybind set to:', formatKeybind(kb));
            return;
        }
        if (e.key === 'Escape' && uiState.modalIsOpen && !uiState.capturingKeybind) {
            e.preventDefault();
            if (uiState.openMenuClosers.size > 0) {
                e.stopPropagation();
                for (const closeFn of Array.from(uiState.openMenuClosers)) {
                    try { closeFn(true); } catch {}
                }
                return;
            }
            closeSettingsModal();
            return;
        }
        if (matchesKeybind(e, settings.uiToggleKeybind) && !e.repeat) {
            e.preventDefault();
            if (settings.keybindAction === 'open-modal') {
                if (uiState.modalIsOpen) closeSettingsModal();
                else openSettingsModal();
            } else {
                if (uiState.modalIsOpen) {
                    closeSettingsModal();
                    if (!settings.pillVisible) {
                        settings.pillVisible = true;
                        saveSettings();
                        renderStatusPill();
                    }
                    LOG('settings UI closed via keybind; floating button remains visible');
                } else {
                    settings.pillVisible = !settings.pillVisible;
                    saveSettings();
                    renderStatusPill();
                    LOG('pill ' + (settings.pillVisible ? 'SHOWN' : 'HIDDEN'));
                }
            }
            return;
        }
        if (e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey && e.code === 'KeyU') {
            e.preventDefault();
            if (uiState.modalIsOpen) closeSettingsModal();
            else openSettingsModal();
            return;
        }
    };

    safeWinAdd('keydown', globalKeydownHandler, true);

    function bootstrap() {
        syncRootThemeAndAccent();
        applyDarkMode();
        ensureUIHost();
        ensureButton();
        initVideoAutoSkipController();
    }

    if (document.readyState === 'loading') {
        safeDocAdd('DOMContentLoaded', bootstrap, { once: true });
    } else {
        bootstrap();
    }

    // Public DevTools API (preserved 100% backward-compatible)
    publicApi = {
        settings, saveSettings, stats,
        openSettings: openSettingsModal,
        closeSettings: closeSettingsModal,
        toggleDarkMode: () => { applySettingChange('darkMode', !settings.darkMode); },
        setTelemetryPreset: (p) => { applySettingChange('telemetryPreset', p); },
        setLogLevel: (lvl) => { applySettingChange('logLevel', lvl); },
        setSuppressJitsu: (v) => { applySettingChange('suppressJitsu', !!v); },
        setManualTimeButtonEnabled: (v) => { applySettingChange('manualTimeButtonEnabled', !!v); },
        setManualTimeStacksWithAuto: (v) => { applySettingChange('manualTimeStacksWithAuto', !!v); },
        setDynamicTimeEnabled: (v) => { applySettingChange('dynamicTimeEnabled', !!v); },
        setPredictFinalCallEnabled: (v) => { applySettingChange('predictFinalCallEnabled', !!v); },
        setFullVideoWatchedEnabled: (v) => { applySettingChange('fullVideoWatchedEnabled', !!v); },
        setAutoSkipVideoEnabled: (v) => { applySettingChange('autoSkipVideoEnabled', !!v); },
        setAddVideoDurationToTimeSpent: (v) => { applySettingChange('addVideoDurationToTimeSpent', !!v); },
        getKnownLessonDurations: () => sessionState.knownLessonDurations,
        getCurrentVideoLesson: () => videoState.currentVideoLesson,
        getActiveSession: () => sessionState.activeSession,
        getCurrentQuestion: (vars, opName, qStr) => identifyCurrentQuestion(vars, opName, qStr),
        getPredictedFinalCall: () => sessionState.activeSession ? updatePredictedFinalCall(sessionState.activeSession) : null,
        getQuestionRegistry: () => Array.from(sessionState.questionRegistry.values()),
        calculateDynamicTime: (qOrId, origSeconds, opName, qStr) => {
            const desc = (qOrId && typeof qOrId === 'object')
                ? qOrId
                : (qOrId != null ? lookupQuestion(qOrId) : identifyCurrentQuestion(null, opName, qStr));
            return computeDynamicExtraSeconds(desc, origSeconds || 0, opName || '', qStr || '');
        },
        getSessionContextSnapshot: buildSessionContextSnapshot,
        skipVideoNow: (force = true) => checkAndAutoSkipVideo(force),
        handleApiResponse,
        getLatestExamPaperData: () => sessionState.latestExamPaperData,
        getLatestUserProfile: () => sessionState.latestUserProfile,
        getLatestFeatureFlags: () => sessionState.latestFeatureFlags,
        getLatestGlobalFeatureFlags: () => sessionState.latestGlobalFeatureFlags,
        getLatestQuizFeedback: () => sessionState.latestQuizFeedback,
        getQueuedSeconds: () => sessionState.queuedSeconds,
        setQueuedSeconds: (secs) => {
            sessionState.queuedSeconds = secs;
            if (sessionState.activeSession) updatePredictedFinalCall(sessionState.activeSession);
            bumpContextRevision();
            updateLabel();
        },
        ensureManualTimeButton: ensureButton,
        removeManualTimeButton: removeButton,
        rewriteBodyText,
        telemetryServices: TELEMETRY_SERVICES,
        resetStats: resetAllStats,
        getAccumulated: () => sessionState.accumulatedExtraSeconds,
        getAccumulatedCount: () => sessionState.accumulatedQuestionCount,
        pickExtraSeconds,
        _match: (url) => matchTelemetryService(url),
    };

    if (settings.logLevel === 'verbose') {
        window.__ul = publicApi;
    }

    // Consolidated single startup summary
    LOG('=== READY on', location.host,
        '| timeBoost:', settings.timeBoostEnabled,
        '| dynamicTime:', settings.dynamicTimeEnabled,
        '| predictFinal:', settings.predictFinalCallEnabled,
        '| range:', settings.extraSecondsMin + '–' + settings.extraSecondsMax + 's',
        '| manualTimeBtn:', settings.manualTimeButtonEnabled ? 'ON' : 'OFF',
        '| fullVideoWatched:', settings.fullVideoWatchedEnabled ? 'ON' : 'OFF',
        '| autoSkipVideo:', settings.autoSkipVideoEnabled ? 'ON' : 'OFF',
        '| addVideoDuration:', settings.addVideoDurationToTimeSpent ? 'ON' : 'OFF',
        '| keybind:', formatKeybind(settings.uiToggleKeybind),
        '| auto-fullscreen blocked:', settings.disableAutoFullscreen ? 'ON' : 'OFF',
        '| dark mode:', settings.darkMode ? 'ON' : 'OFF',
        '| telemetry preset:', settings.telemetryPreset,
        '| suppress jitsu:', settings.suppressJitsu ? 'YES' : 'no',
        '===');
    if (settings.logLevel === 'verbose') {
        nativeConsole.groupCollapsed('%c[UL · verbose] 🟢 Startup summary — active blockers & settings', CSS.verbose);
        const enabledServices = Object.keys(TELEMETRY_SERVICES)
            .filter((k) => k !== 'jitsu' && settings.telemetryServices[k])
            .map((k) => TELEMETRY_SERVICES[k].label);
        nativeConsole.log('%cThird-party services:   ', CSS.muted, enabledServices.length ? enabledServices.join(', ') : '(none)');
        nativeConsole.log('%cSuppress Jitsu:         ', CSS.muted, settings.suppressJitsu ? 'YES (blocked + logged)' : 'no (allowed + logged)');
        nativeConsole.log('%cLogImproperUse:         ', CSS.muted, settings.blockLogImproperUse ? 'ON' : 'OFF');
        nativeConsole.log('%cLogEvent handler:       ', CSS.muted, settings.blockLogEvent !== false ? 'ON' : 'OFF');
        nativeConsole.log('%cPrivate search mode:    ', CSS.muted, settings.privateSearchMode !== false ? 'ON' : 'OFF');
        nativeConsole.log('%cFunction cloaking:      ', CSS.muted, 'ON');
        nativeConsole.log('%cTime boost:             ', CSS.muted, settings.timeBoostEnabled ? `ON (+${settings.extraSecondsMin}–${settings.extraSecondsMax}s)` : 'OFF');
        nativeConsole.log('%cDynamic question time:  ', CSS.muted, settings.dynamicTimeEnabled ? 'ON' : 'OFF');
        nativeConsole.log('%cPredict final API call: ', CSS.muted, settings.predictFinalCallEnabled ? 'ON' : 'OFF');
        nativeConsole.log('%cManual time button:     ', CSS.muted, settings.manualTimeButtonEnabled ? 'ON' : 'OFF');
        nativeConsole.log('%cFull video watch:       ', CSS.muted, settings.fullVideoWatchedEnabled ? 'ON' : 'OFF');
        nativeConsole.log('%cAuto-skip video:        ', CSS.muted, settings.autoSkipVideoEnabled ? 'ON' : 'OFF');
        nativeConsole.log('%cAdd video duration:     ', CSS.muted, settings.addVideoDurationToTimeSpent ? 'ON' : 'OFF');
        nativeConsole.log('%cDOM injection:          ', CSS.muted, settings.blockDomElements ? 'ON' : 'OFF');
        nativeConsole.log('%cWebSockets:             ', CSS.muted, settings.blockWebSockets ? 'ON' : 'OFF');
        nativeConsole.log('%csendBeacon:             ', CSS.muted, settings.blockSendBeacon ? 'ON' : 'OFF');
        nativeConsole.log('%cVisibility spoofing:    ', CSS.muted, settings.spoofVisibility ? 'ON' : 'OFF');
        nativeConsole.log('%cConsole noise filter:   ', CSS.muted, settings.suppressConsoleNoise ? 'ON' : 'OFF');
        nativeConsole.log('%cFullscreen block:       ', CSS.muted, settings.disableAutoFullscreen ? 'ON' : 'OFF');
        nativeConsole.log('%cDark mode:              ', CSS.muted, settings.darkMode ? 'ON' : 'OFF');
        nativeConsole.groupEnd();
    }
})();
