// ==UserScript==
// @name         UpLearn Telemetry Blocker & TimeSpent Booster
// @namespace    https://github.com/local/uplearn-telemetry-blocker
// @version      3.9.0
// @description  Configurable telemetry blocking with detailed verbose logging, aggressive console-noise suppression, dedicated LogImproperUse logging, full request body capture, Jitsu packet inspection, Jitsu suppress toggle; unified GraphQL data stream, windowed multitasking feature flag transformer, local LogEvent & private search handlers, native stealth cloaking; random-range time boost; inline manual "Add time" question button for all question types; full video watch completion toggle; auto-skip video to 1 second before completion; add full video duration to timeSpent; dark mode; full control panel UI
// @author       you
// @match        https://web.uplearn.co.uk/*
// @run-at       document-start
// @grant        none
// @inject-into  page
// @noframes
//
// @webRequest   [{"selector":"*://*.openreplay.uplearn.co.uk/*","action":"cancel"},{"selector":"*://*.sentry.io/*","action":"cancel"},{"selector":"*://static.cloudflareinsights.com/*","action":"cancel"},{"selector":"*://*.intercom.io/*","action":"cancel"},{"selector":"*://*.intercomcdn.com/*","action":"cancel"},{"selector":"*://*.googletagmanager.com/*","action":"cancel"},{"selector":"*://*.google-analytics.com/*","action":"cancel"},{"selector":"*://analytics.google.com/*","action":"cancel"},{"selector":"*://*.googleadservices.com/*","action":"cancel"},{"selector":"*://*.doubleclick.net/*","action":"cancel"},{"selector":"*://*.facebook.net/*","action":"cancel"},{"selector":"*://*.sc-static.net/*","action":"cancel"},{"selector":"*://bat.bing.com/*","action":"cancel"},{"selector":"*://bzrcdn.openai.com/*","action":"cancel"},{"selector":"*://*.posthog.com/*","action":"cancel"},{"selector":"*://*.fullstory.com/*","action":"cancel"},{"selector":"*://*.hotjar.com/*","action":"cancel"},{"selector":"*://*.mixpanel.com/*","action":"cancel"},{"selector":"*://*.segment.io/*","action":"cancel"},{"selector":"*://*.amplitude.com/*","action":"cancel"}]
//
// @require      https://unpkg.com/react@18.3.1/umd/react.production.min.js
// @require      https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js
// @require      https://unpkg.com/htm@3.1.1/dist/htm.umd.js
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

    // ============================================================
    // NATIVE CONSOLE PRESERVED (before any patching)
    // ============================================================
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
    // TELEMETRY SERVICE REGISTRY
    // ============================================================
    const TELEMETRY_SERVICES = {
        openreplay:      { label: 'OpenReplay',                     hosts: ['openreplay.uplearn.co.uk'] },
        jitsu:           { label: 'Jitsu',                          hosts: ['jitsu.uplearn.co.uk'] },
        sentry:          { label: 'Sentry',                         hosts: ['ingest.us.sentry.io', 'sentry.io'] },
        cloudflare:      { label: 'Cloudflare Insights',            hosts: ['static.cloudflareinsights.com', 'cloudflareinsights.com'] },
        intercom:        { label: 'Intercom',                       hosts: ['api-iam.intercom.io', 'widget.intercom.io', 'js.intercomcdn.com', 'nexus-websocket-.intercom.io', 'intercom.io', 'intercomcdn.com'] },
        googleAnalytics: { label: 'Google Tag Manager / Analytics', hosts: ['googletagmanager.com', 'google-analytics.com', 'analytics.google.com'] },
        facebook:        { label: 'Facebook Pixel',                 hosts: ['connect.facebook.net', 'facebook.net'] },
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

    function buildDefaultTelemetryServices() {
        const o = {};
        for (const k in TELEMETRY_SERVICES) o[k] = true;
        return o;
    }

    // ============================================================
    // SETTINGS
    // ============================================================
    const SETTINGS_KEY      = 'uplearn_settings_v2';
    const LEGACY_BOOST_KEY  = 'uplearn_time_boost_enabled';
    const LEGACY_UI_KEY     = 'uplearn_time_boost_ui_visible';
    let publicApi           = null;

    const IS_MAC = /Mac|iPhone|iPad|iPod/i.test(
        (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || navigator.userAgent
    );

    const DEFAULT_KEYBIND = {
        code: IS_MAC ? 'MetaRight' : 'ControlRight',
        ctrl: false, shift: false, alt: false, meta: false,
    };

    const DEFAULT_SETTINGS = {
        telemetryPreset:           'harsh',
        telemetryServices:         buildDefaultTelemetryServices(),
        suppressJitsu:             true,   // true = block Jitsu, false = allow + log
        blockLogImproperUse:       true,
        blockLogEvent:             true,
        privateSearchMode:         true,
        spoofVisibility:           true,
        blockWebSockets:           true,
        blockSendBeacon:           true,
        blockDomElements:          true,
        suppressConsoleNoise:      true,
        timeBoostEnabled:          true,
        extraSecondsMin:           30,
        extraSecondsMax:           90,
        manualTimeButtonEnabled:   true,
        manualTimeStacksWithAuto:  false,
        fullVideoWatchedEnabled:   true,
        autoSkipVideoEnabled:      true,
        addVideoDurationToTimeSpent: true,
        disableAutoFullscreen:     true,
        darkMode:                  false,
        pillVisible:               true,
        pillPosition:              'bottom-right',
        pillOpacity:               1,
        pillMode:                  'minimal',
        theme:                     'dark',
        accentColor:               '#007aff',
        logLevel:                  'normal',
        keybindAction:             'toggle-pill',
        draggableUI:               false,
        uiToggleKeybind:           Object.assign({}, DEFAULT_KEYBIND),
    };

    const INDIVIDUAL_TELEMETRY_SETTINGS = new Set([
        'telemetryServices',
        'suppressJitsu',
        'blockLogImproperUse', 'blockLogEvent', 'privateSearchMode', 'spoofVisibility', 'blockWebSockets',
        'blockSendBeacon', 'blockDomElements', 'suppressConsoleNoise',
    ]);

    let applyingPreset = false;

    function normalizeKeybind(kb) {
        if (!kb) return Object.assign({}, DEFAULT_KEYBIND);
        if (typeof kb === 'string') return { code: kb, ctrl: false, shift: false, alt: false, meta: false };
        if (typeof kb !== 'object') return Object.assign({}, DEFAULT_KEYBIND);
        return { code: kb.code || null, ctrl: !!kb.ctrl, shift: !!kb.shift, alt: !!kb.alt, meta: !!kb.meta };
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
                // Migration: old allowJitsu (true = allow) → new suppressJitsu (true = block)
                if (typeof parsed.suppressJitsu !== 'boolean') {
                    if (typeof parsed.allowJitsu === 'boolean') {
                        parsed.suppressJitsu = !parsed.allowJitsu;
                    } else {
                        parsed.suppressJitsu = DEFAULT_SETTINGS.suppressJitsu;
                    }
                }
                delete parsed.allowJitsu;

                if (typeof parsed.manualTimeButtonEnabled !== 'boolean') {
                    parsed.manualTimeButtonEnabled = DEFAULT_SETTINGS.manualTimeButtonEnabled;
                }
                if (typeof parsed.manualTimeStacksWithAuto !== 'boolean') {
                    parsed.manualTimeStacksWithAuto = DEFAULT_SETTINGS.manualTimeStacksWithAuto;
                }
                if (typeof parsed.fullVideoWatchedEnabled !== 'boolean') {
                    parsed.fullVideoWatchedEnabled = DEFAULT_SETTINGS.fullVideoWatchedEnabled;
                }
                if (typeof parsed.autoSkipVideoEnabled !== 'boolean') {
                    parsed.autoSkipVideoEnabled = DEFAULT_SETTINGS.autoSkipVideoEnabled;
                }
                if (typeof parsed.addVideoDurationToTimeSpent !== 'boolean') {
                    parsed.addVideoDurationToTimeSpent = DEFAULT_SETTINGS.addVideoDurationToTimeSpent;
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
        if (typeof s.draggableUI !== 'boolean') {
            s.draggableUI = false;
        }
        s.uiToggleKeybind = normalizeKeybind(s.uiToggleKeybind);
        return s;
    }

    function normalizeRange(s) {
        let min = Number(s.extraSecondsMin);
        let max = Number(s.extraSecondsMax);
        if (!isFinite(min) || min < 1) min = DEFAULT_SETTINGS.extraSecondsMin;
        if (!isFinite(max) || max < 1) max = DEFAULT_SETTINGS.extraSecondsMax;
        min = Math.round(min); max = Math.round(max);
        if (min > max) { const t = min; min = max; max = t; }
        s.extraSecondsMin = min;
        s.extraSecondsMax = max;
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
        window.addEventListener('beforeunload', () => saveSettings(true));
        window.addEventListener('pagehide', () => saveSettings(true));
    } catch {}

    // ============================================================
    // CLONING & PRESETS
    // ============================================================
    function cloneSettings(s) {
        if (!s) return s;
        return Object.assign({}, s, {
            telemetryServices: Object.assign({}, s.telemetryServices),
            uiToggleKeybind: Object.assign({}, s.uiToggleKeybind),
        });
    }

    function applyTelemetryPreset(preset) {
        const nextServices = Object.assign({}, settings.telemetryServices);
        if (preset === 'off') {
            for (const k in nextServices) nextServices[k] = false;
            settings.suppressJitsu        = false;
            settings.blockLogImproperUse  = false;
            settings.blockLogEvent        = false;
            settings.privateSearchMode    = false;
            settings.spoofVisibility      = false;
            settings.blockWebSockets      = false;
            settings.blockSendBeacon      = false;
            settings.blockDomElements     = false;
            settings.suppressConsoleNoise = false;
        } else if (preset === 'simple') {
            for (const k in nextServices) nextServices[k] = false;
            settings.suppressJitsu        = false;
            settings.blockLogImproperUse  = true;
            settings.blockLogEvent        = true;
            settings.privateSearchMode    = true;
            settings.spoofVisibility      = false;
            settings.blockWebSockets      = false;
            settings.blockSendBeacon      = false;
            settings.blockDomElements     = false;
            settings.suppressConsoleNoise = true;
        } else if (preset === 'harsh') {
            for (const k in nextServices) nextServices[k] = true;
            settings.suppressJitsu        = true;
            settings.blockLogImproperUse  = true;
            settings.blockLogEvent        = true;
            settings.privateSearchMode    = true;
            settings.spoofVisibility      = true;
            settings.blockWebSockets      = true;
            settings.blockSendBeacon      = true;
            settings.blockDomElements     = true;
            settings.suppressConsoleNoise = true;
        }
        settings.telemetryServices = nextServices;
        settings.telemetryPreset = preset;
    }

    // ============================================================
    // LOGGING
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

    // ============================================================
    // URL / SERVICE MATCHING
    // ============================================================
    const API_HOST    = 'web.uplearn.co.uk';
    const API_PATH_RE = /\/api\/?$/;

    const hostCache = new Map();
    const hostServiceCache = new Map();

    function fastHostOf(url) {
        if (!url || typeof url !== 'string') return '';
        const len = url.length;
        if (len === 0) return '';
        const c0 = url.charCodeAt(0);
        if (c0 === 47) {
            if (len > 1 && url.charCodeAt(1) === 47) {
                const start = 2;
                let end = start;
                while (end < len) {
                    const c = url.charCodeAt(end);
                    if (c === 47 || c === 63 || c === 35 || c === 58) break;
                    end++;
                }
                return url.slice(start, end).toLowerCase();
            }
            return (typeof location !== 'undefined' && location.hostname) ? location.hostname.toLowerCase() : API_HOST;
        }
        const protoIdx = url.indexOf('://');
        if (protoIdx !== -1) {
            const start = protoIdx + 3;
            let end = start;
            while (end < len) {
                const c = url.charCodeAt(end);
                if (c === 47 || c === 63 || c === 35 || c === 58) break;
                end++;
            }
            return url.slice(start, end).toLowerCase();
        }
        try { return new URL(url, (typeof location !== 'undefined' && location.href) ? location.href : undefined).hostname.toLowerCase(); }
        catch { return ''; }
    }

    function hostOf(url) {
        if (!url || typeof url !== 'string') return '';
        if (url.charCodeAt(0) === 47 && url.charCodeAt(1) !== 47) {
            return (typeof location !== 'undefined' && location.hostname) ? location.hostname.toLowerCase() : API_HOST;
        }
        let h = hostCache.get(url);
        if (h !== undefined) return h;
        h = fastHostOf(url);
        if (hostCache.size >= 250) {
            hostCache.delete(hostCache.keys().next().value);
        }
        hostCache.set(url, h);
        return h;
    }

    function matchAnyTelemetryService(url) {
        if (!url) return null;
        const h = hostOf(url);
        if (!h) return null;
        if (h === API_HOST || (typeof location !== 'undefined' && h === location.hostname)) return null;
        let cached = hostServiceCache.get(h);
        if (cached !== undefined) return cached;

        let found = null;
        outer: for (const key in TELEMETRY_SERVICES) {
            const hosts = TELEMETRY_SERVICES[key].hosts;
            for (let i = 0; i < hosts.length; i++) {
                const t = hosts[i];
                if (h === t || h.endsWith('.' + t)) {
                    found = { key, label: TELEMETRY_SERVICES[key].label, host: h, pattern: t };
                    break outer;
                }
            }
        }
        if (hostServiceCache.size >= 250) {
            hostServiceCache.delete(hostServiceCache.keys().next().value);
        }
        hostServiceCache.set(h, found);
        return found;
    }

    function isServiceMatchBlocked(m) {
        if (!m) return false;
        // Jitsu is controlled by settings.suppressJitsu (synced with telemetryServices.jitsu and presets)
        if (m.key === 'jitsu') {
            return !!(settings.suppressJitsu && (!settings.telemetryServices || settings.telemetryServices.jitsu !== false));
        }
        return !!(settings.telemetryServices && settings.telemetryServices[m.key]);
    }

    function matchTelemetryService(url) {
        const m = matchAnyTelemetryService(url);
        return isServiceMatchBlocked(m) ? m : null;
    }

    function isTelemetryUrl(url) { return !!matchTelemetryService(url); }

    function isTargetApi(url) {
        if (!url || typeof url !== 'string') return false;
        if (
            url === '/api' ||
            url === '/api/' ||
            url === 'https://web.uplearn.co.uk/api' ||
            url === 'https://web.uplearn.co.uk/api/'
        ) {
            return true;
        }
        if (!url.includes('/api')) return false;
        if (url.charCodeAt(0) === 47 && url.charCodeAt(1) !== 47) {
            return API_PATH_RE.test(url.split('?')[0]);
        }
        const h = hostOf(url);
        if (h !== API_HOST) return false;
        const apiIdx = url.indexOf('/api');
        if (apiIdx !== -1) {
            const cleanPath = url.slice(apiIdx).split('?')[0];
            return API_PATH_RE.test(cleanPath);
        }
        return false;
    }

    // ============================================================
    // STATS & REACTIVE SUBSCRIBERS
    // ============================================================
    const stats = {
        apiPosts: 0, seen: 0, boosted: 0, blocked: 0,
        groupExtra: 0, fullscreenBlocked: 0, consoleSuppressed: 0,
        logImproperUseBlocked: 0, jitsuPackets: 0, manualBoosted: 0,
        videosMaxed: 0, videosSkipped: 0, videoTimeAdded: 0,
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

    // ============================================================
    // CONSOLE NOISE FILTER
    // ============================================================
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
        for (const h of JITSU_SERVICES_HOSTS_REF()) parts.push(escapeRegExp(h));
        return new RegExp(parts.join('|'), 'i');
        function JITSU_SERVICES_HOSTS_REF() { return TELEMETRY_SERVICES.jitsu.hosts; }
    })();

    function textMatchesNoise(text) {
        if (typeof text !== 'string' || !text) return false;
        if (ALWAYS_NOISE_RE.test(text)) return true;
        // If Jitsu is being ALLOWED (suppressJitsu === false), don't silence its own
        // log lines — the user asked to see what it's doing.
        if (settings.suppressJitsu && JITSU_NOISE_RE.test(text)) return true;
        return false;
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
            console[method] = function () {
                if (!settings.suppressConsoleNoise) {
                    return orig.apply(console, arguments);
                }
                const len = arguments.length;
                if (len === 0) return orig.apply(console, arguments);
                const first = arguments[0];
                const firstIsString = typeof first === 'string';
                if (firstIsString && textMatchesNoise(first)) {
                    bumpStat('consoleSuppressed');
                    return;
                }
                if (len === 1 && firstIsString) {
                    return orig.apply(console, arguments);
                }
                if (argsAreNoise(arguments, firstIsString ? 1 : 0)) {
                    bumpStat('consoleSuppressed');
                    return;
                }
                return orig.apply(console, arguments);
            };
            cloak(console[method], method);
        }
        VLOG('console noise filter installed (Jitsu / Apollo / Sentry / host matches)');
    }
    installConsoleNoiseFilter();

    // ============================================================
    // REPORTING
    // ============================================================
    function truncateBody(b, max) {
        if (b == null) return null;
        if (typeof b !== 'string') return '(non-string body)';
        if (b.length <= max) return b;
        return b.slice(0, max) + `… [+${b.length - max} more chars]`;
    }

    function reportBlock(kind, url, details) {
        if (settings.logLevel === 'silent') return;
        const m = matchTelemetryService(url);
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
            let line = `%c[UL] 🛡 Blocked%c ${kind}%c → ${svcLabel}%c (${host})`;
            const args = [line, CSS.block, CSS.url, CSS.service, CSS.muted];
            if (bodyPreview) {
                args[0] += `%c · body: ${bodyPreview}`;
                args.push(CSS.body);
            }
            nativeConsole.log(...args);
        }
    }

    // Dedicated reporter for Jitsu packets so the user can inspect exactly what
    // the UpLearn tracker is trying to send (allowed OR blocked).
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
            // Try to pretty-print JSON for readability
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

    // Dedicated reporter for LogImproperUse so it stands out from generic
    // telemetry blocks. Bumps its own counter and uses pink styling.
    function reportLogImproperUse(source, url, body) {
        bumpStat('logImproperUseBlocked');
        if (settings.logLevel === 'silent') return;

        let opName = 'LogImproperUse';
        let opType = '';
        let variableNames = [];
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
            nativeConsole.log('%cResponse:  ', CSS.muted,
                '→ synthetic 200 OK  { data: { logImproperUse: true } }');
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

    function reportLogEvent(source, url, body) {
        bumpStat('blocked');
        if (settings.logLevel === 'silent') return;
        if (settings.logLevel === 'verbose') {
            nativeConsole.groupCollapsed(
                `%c🚫 LOGEVENT MOCKED%c · ${source}%c · LogEvent`,
                CSS.improper, CSS.url, CSS.service
            );
            nativeConsole.log('%cURL:       ', CSS.muted, url);
            nativeConsole.log('%cResponse:  ', CSS.muted, '→ synthetic 200 OK  { data: { logEvent: { id: "mock" } } }');
            nativeConsole.log('%cBody:      ', CSS.body, truncateBody(body, 2400));
            nativeConsole.groupEnd();
        } else {
            nativeConsole.log(
                `%c[UL] 🚫 LOGEVENT MOCKED%c · ${source}%c · LogEvent`,
                CSS.improper, CSS.url, CSS.service
            );
        }
    }

    function reportLogLessonSearch(source, url, body) {
        bumpStat('blocked');
        if (settings.logLevel === 'silent') return;
        if (settings.logLevel === 'verbose') {
            nativeConsole.groupCollapsed(
                `%c🔒 PRIVATE SEARCH MOCKED%c · ${source}%c · LogLessonSearch`,
                CSS.improper, CSS.url, CSS.service
            );
            nativeConsole.log('%cURL:       ', CSS.muted, url);
            nativeConsole.log('%cResponse:  ', CSS.muted, '→ synthetic 200 OK  { data: { logVideoSearchRequest: { id: "mock" } } }');
            nativeConsole.log('%cBody:      ', CSS.body, truncateBody(body, 2400));
            nativeConsole.groupEnd();
        } else {
            nativeConsole.log(
                `%c[UL] 🔒 PRIVATE SEARCH MOCKED%c · ${source}%c · LogLessonSearch`,
                CSS.improper, CSS.url, CSS.service
            );
        }
    }

    function reportFeatureFlagsTransformed(source, url) {
        if (settings.logLevel === 'silent') return;
        if (settings.logLevel === 'verbose') {
            nativeConsole.groupCollapsed(
                `%c🪟 WINDOWED MODE%c · Feature flags stripped%c · ${source}`,
                CSS.improper, CSS.url, CSS.service
            );
            nativeConsole.log('%cURL:       ', CSS.muted, url);
            nativeConsole.log('%cStripped:  ', CSS.muted, 'course_activity_fullscreen_mode, course_activity_fullscreen_exit_modal, course_activity_record_improper_use');
            nativeConsole.log('%cResult:    ', CSS.muted, 'Activity session initializes in standard windowed mode without fullscreen prompts or improper use listeners');
            nativeConsole.groupEnd();
        } else {
            nativeConsole.log(
                `%c[UL] 🪟 WINDOWED MODE%c · Feature flags stripped (${source})`,
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
    // BOOT BANNER
    // ============================================================
    LOG('=== SCRIPT LOADED on', location.host, '===');
    if (settings.logLevel === 'verbose') {
        nativeConsole.groupCollapsed('%c[UL · verbose] 🚀 Startup summary', CSS.verbose);
        nativeConsole.log('%cLog level:       ', CSS.muted, settings.logLevel);
        nativeConsole.log('%cTelemetry:       ', CSS.muted, settings.telemetryPreset);
        nativeConsole.log('%cServices on:     ', CSS.muted,
            Object.keys(TELEMETRY_SERVICES)
                .filter((k) => k !== 'jitsu' && settings.telemetryServices[k])
                .map((k) => TELEMETRY_SERVICES[k].label)
                .join(', ') || '(none)');
        nativeConsole.log('%cSuppress Jitsu:  ', CSS.muted, settings.suppressJitsu ? 'YES (blocked + logged)' : 'no (allowed + logged)');
        nativeConsole.log('%cLogImproperUse:  ', CSS.muted, settings.blockLogImproperUse);
        nativeConsole.log('%cDOM inject:      ', CSS.muted, settings.blockDomElements);
        nativeConsole.log('%cWebSockets:      ', CSS.muted, settings.blockWebSockets);
        nativeConsole.log('%csendBeacon:      ', CSS.muted, settings.blockSendBeacon);
        nativeConsole.log('%cVisibility:      ', CSS.muted, settings.spoofVisibility);
        nativeConsole.log('%cConsole noise:   ', CSS.muted, settings.suppressConsoleNoise);
        nativeConsole.log('%cTime boost:      ', CSS.muted, settings.timeBoostEnabled,
            `(+${settings.extraSecondsMin}–${settings.extraSecondsMax}s)`);
        nativeConsole.log('%cManual time btn: ', CSS.muted, settings.manualTimeButtonEnabled ? 'ON' : 'OFF');
        nativeConsole.log('%cFull video watch: ', CSS.muted, settings.fullVideoWatchedEnabled ? 'ON' : 'OFF');
        nativeConsole.log('%cFullscreen:      ', CSS.muted, settings.disableAutoFullscreen ? 'blocked' : 'allowed');
        nativeConsole.log('%cDark mode:       ', CSS.muted, settings.darkMode);
        nativeConsole.groupEnd();
    }

    // ============================================================
    // DOM / SCRIPT/IFRAME/IMG/LINK INJECTION BLOCKER
    // ============================================================
    function hookElementProperty(proto, prop, tag) {
        const desc = Object.getOwnPropertyDescriptor(proto, prop);
        if (desc && desc.set) {
            const setter = function (val) {
                if (settings.blockDomElements && isTelemetryUrl(val)) {
                    reportBlock(`<${tag}>.${prop} assignment`, val, { element: tag });
                    return '';
                }
                if (settings.logLevel === 'verbose' && val) {
                    const m = matchAnyTelemetryService(val);
                    if (m && !settings.telemetryServices[m.key]) {
                        reportAllow(`<${tag}>.${prop}`, val, `service "${m.label}" disabled`);
                    } else if (m && m.key === 'jitsu' && !settings.suppressJitsu) {
                        reportAllow(`<${tag}>.${prop}`, val, `service "${m.label}" not suppressed`);
                    }
                }
                return desc.set.call(this, val);
            };
            cloak(setter, 'set ' + prop);
            Object.defineProperty(proto, prop, {
                get: desc.get,
                set: setter,
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
                   (name.charCodeAt(2) | 32) === 99; // 'src'
        }
        if (len === 4) {
            return (name.charCodeAt(0) | 32) === 104 &&
                   (name.charCodeAt(1) | 32) === 114 &&
                   (name.charCodeAt(2) | 32) === 101 &&
                   (name.charCodeAt(3) | 32) === 102; // 'href'
        }
        return false;
    }

    try {
        const origSetAttribute = Element.prototype.setAttribute;
        Element.prototype.setAttribute = function (name, value) {
            if (settings.blockDomElements && isSrcOrHref(name) && isTelemetryUrl(value)) {
                reportBlock(`setAttribute("${name}")`, value, {
                    element: this.tagName ? this.tagName.toLowerCase() : 'unknown',
                });
                return;
            }
            return origSetAttribute.apply(this, arguments);
        };
        cloak(Element.prototype.setAttribute, 'setAttribute');
    } catch (e) { WARN('setAttribute patch failed', e); }

    try {
        const domObserver = new MutationObserver((mutations) => {
            if (settings.blockDomElements) {
                for (let i = 0; i < mutations.length; i++) {
                    const added = mutations[i].addedNodes;
                    for (let j = 0; j < added.length; j++) {
                        const node = added[j];
                        if (node.nodeType !== 1) continue;
                        const rawTag = node.tagName;
                        if (
                            rawTag === 'SCRIPT' ||
                            rawTag === 'IFRAME' ||
                            (typeof rawTag === 'string' && rawTag.length === 6 && (rawTag.toLowerCase() === 'script' || rawTag.toLowerCase() === 'iframe'))
                        ) {
                            const tag = rawTag.toLowerCase();
                            const src = node.src || (typeof node.getAttribute === 'function' ? node.getAttribute('src') : '');
                            if (isTelemetryUrl(src)) {
                                reportBlock(`DOM injection (<${tag}>)`, src, {
                                    element: tag,
                                    nodeId: node.id || '(none)',
                                });
                                node.remove();
                            }
                        }
                    }
                }
            }
            scheduleEnsureButton(mutations);
        });
        domObserver.observe(document.documentElement || document, { childList: true, subtree: true });
        VLOG('DOM observer installed');
    } catch (e) { WARN('DOM observer failed', e); }

    // ============================================================
    // WEBSOCKET BLOCKER
    // ============================================================
    try {
        const OrigWebSocket = window.WebSocket;
        if (OrigWebSocket) {
            function PatchedWebSocket(url, protocols) {
                if (settings.blockWebSockets && isTelemetryUrl(url)) {
                    reportBlock('WebSocket', String(url), { protocols: protocols || '(none)' });
                    const dummy = new EventTarget();
                    dummy.readyState = OrigWebSocket.CLOSED !== undefined ? OrigWebSocket.CLOSED : 3;
                    dummy.send = () => {};
                    dummy.close = () => {};
                    setTimeout(() => {
                        try {
                            dummy.dispatchEvent(new Event('error'));
                            dummy.dispatchEvent(new CloseEvent('close', { code: 1006, reason: 'Blocked' }));
                        } catch {}
                    }, 0);
                    return dummy;
                }
                return new OrigWebSocket(url, protocols);
            }
            PatchedWebSocket.prototype = OrigWebSocket.prototype;
            // Preserve all static properties (CONNECTING, OPEN, CLOSING, CLOSED) and descriptors
            const staticProps = Object.getOwnPropertyNames(OrigWebSocket);
            for (let i = 0; i < staticProps.length; i++) {
                const prop = staticProps[i];
                if (!(prop in PatchedWebSocket)) {
                    try {
                        const desc = Object.getOwnPropertyDescriptor(OrigWebSocket, prop);
                        if (desc) Object.defineProperty(PatchedWebSocket, prop, desc);
                    } catch {}
                }
            }
            window.WebSocket = PatchedWebSocket;
            cloak(PatchedWebSocket, 'WebSocket');
            VLOG('WebSocket hook installed');
        }
    } catch (e) { WARN('websocket patch failed', e); }

    // ============================================================
    // WEB WORKER & BLOB TARGETED NEUTER
    // ============================================================
    const TELEMETRY_CODE_RE = /openreplay|sentry|sessionReplay|replayUploader/i;
    const telemetryBlobUrls = new Set();
    const telemetryBlobs = new WeakSet();
    try {
        const origCreateObjectURL = (typeof URL !== 'undefined' && URL.createObjectURL) ? URL.createObjectURL : null;
        if (origCreateObjectURL) {
            URL.createObjectURL = function (blob) {
                const url = origCreateObjectURL.apply(this, arguments);
                if (blob && telemetryBlobs.has(blob)) {
                    telemetryBlobUrls.add(url);
                } else if (blob instanceof Blob && blob.size < 1e6 && (!blob.type || blob.type.includes('javascript') || blob.type.includes('text'))) {
                    try {
                        if (typeof blob.text === 'function') {
                            blob.text().then((code) => {
                                if (TELEMETRY_CODE_RE.test(code)) {
                                    telemetryBlobUrls.add(url);
                                }
                            }).catch(() => {});
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
                    const type = (options && options.type) || '';
                    if (blob.size < 1e6 && (!type || type.includes('javascript') || type.includes('text'))) {
                        if (blobParts && (Array.isArray(blobParts) || typeof blobParts[Symbol.iterator] === 'function')) {
                            for (const part of blobParts) {
                                if (typeof part === 'string' && TELEMETRY_CODE_RE.test(part)) {
                                    telemetryBlobs.add(blob);
                                    break;
                                }
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
            const dummyNoop = () => {};
            const WORKER_DUMMY_DESCS = {
                postMessage:    { value: dummyNoop, writable: true, configurable: true },
                terminate:      { value: dummyNoop, writable: true, configurable: true },
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
                    reportBlock('WebWorker', urlStr);
                    const dummy = new EventTarget();
                    Object.setPrototypeOf(dummy, (new.target && new.target.prototype) || OrigWorker.prototype);
                    Object.defineProperties(dummy, WORKER_DUMMY_DESCS);
                    return dummy;
                }
                return Reflect.construct(OrigWorker, arguments, new.target);
            };
            PatchedWorker.prototype = OrigWorker.prototype;
            Object.setPrototypeOf(PatchedWorker, OrigWorker);
            window.Worker = PatchedWorker;
            cloak(PatchedWorker, 'Worker');
        }
    } catch (e) { WARN('worker/blob patch failed', e); }

    // ============================================================
    // DARK MODE
    // ============================================================
    const DARK_MODE_STYLE_ID  = '__ul-dark-styles';
    const PARENT_INVERT       = 0.88;
    const CHILD_CONTRAST      = 1.3158;
    const DARK_BASE_COLOR     = '#1f1f1f';
    const DARK_PRE_INVERT_BG  = '#ffffff';

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

    function applyDarkMode() {
        try {
            const html = document.documentElement;
            if (!html) return;
            if (settings.darkMode) ensureDarkModeStyles();
            const has = html.classList.contains('ul-dark-mode');
            if (settings.darkMode && !has) html.classList.add('ul-dark-mode');
            else if (!settings.darkMode && has) html.classList.remove('ul-dark-mode');
        } catch (e) { WARN('dark mode apply failed', e); }
    }

    ensureDarkModeStyles();
    applyDarkMode();

    try {
        const obs = new MutationObserver(applyDarkMode);
        obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    } catch {}

    // ============================================================
    // REQUEST BODY CLASSIFICATION & MUTATION INTERCEPTION
    // ============================================================
    const MAX_SCAN = 65536;
    const BLOCKED_OPS_RE = /\b(logImproperUse|logEvent|logLessonSearch|logVideoSearchRequest)\b/i;

    function getBlockedMutationKind(body) {
        if (!body) return null;
        if (typeof body !== 'string') {
            try {
                if (body instanceof URLSearchParams) body = body.toString();
                else return null;
            } catch { return null; }
        }
        if (body.length > MAX_SCAN) return null;
        const m = BLOCKED_OPS_RE.exec(body);
        if (!m) return null;
        const op = m[1].toLowerCase();
        if (op === 'logimproperuse') return 'improper';
        if (op === 'logevent') return 'event';
        if (op === 'loglessonsearch' || op === 'logvideosearchrequest') return 'search';
        return null;
    }

    const REQ_TRANSFORM_RE = /\b(?:GetFeatureFlags|GetFeatureFlagsEnabledGlobally|currentUser)\b/i;
    const REQ_INGEST_RE = /\b(?:GetVideoLesson|GetExamPaper|GetExamQuestion|GetExamPracticeSession|Answer[A-Za-z]+Question|SaveExamAnswer|CompleteExamPracticeSession|SubmitQuestionAttempt|videoLesson|examPaper|subsection|feedback)\b/i;

    function classifyApiRequest(body) {
        if (!body || typeof body !== 'string' || body.length > MAX_SCAN) return 'none';
        if (REQ_TRANSFORM_RE.test(body)) return 'transform';
        if (REQ_INGEST_RE.test(body)) return 'ingest';
        return 'none';
    }

    // ============================================================
    // LOGIMPROPERUSE DETECTION
    // ============================================================
    const LOG_IMPROPER_PAYLOAD = JSON.stringify({ data: { logImproperUse: true } });

    function bodyLooksLikeLogImproperUse(body) {
        return getBlockedMutationKind(body) === 'improper';
    }

    function logImproperUseSyntheticResponse() {
        return new Response(LOG_IMPROPER_PAYLOAD, {
            status: 200, statusText: 'OK',
            headers: { 'Content-Type': 'application/json' }
        });
    }

    // ============================================================
    // LOGEVENT DETECTION (Local Interaction Logging)
    // ============================================================
    const LOG_EVENT_PAYLOAD = JSON.stringify({ data: { logEvent: { id: "mock" } } });

    function bodyLooksLikeLogEvent(body) {
        return getBlockedMutationKind(body) === 'event';
    }

    function logEventSyntheticResponse() {
        return new Response(LOG_EVENT_PAYLOAD, {
            status: 200, statusText: 'OK',
            headers: { 'Content-Type': 'application/json' }
        });
    }

    // ============================================================
    // LOGLESSONSEARCH DETECTION (Private Search Mode)
    // ============================================================
    const LOG_LESSON_SEARCH_PAYLOAD = JSON.stringify({
        data: {
            logVideoSearchRequest: { id: "mock" },
            logLessonSearch: { id: "mock" }
        }
    });

    function bodyLooksLikeLogLessonSearch(body) {
        return getBlockedMutationKind(body) === 'search';
    }

    function logLessonSearchSyntheticResponse() {
        return new Response(LOG_LESSON_SEARCH_PAYLOAD, {
            status: 200, statusText: 'OK',
            headers: { 'Content-Type': 'application/json' }
        });
    }

    // ============================================================
    // FEATURE FLAGS RESPONSE TRANSFORMER (Windowed Multitasking)
    // ============================================================
    const STRIPPED_FEATURE_FLAGS = new Set([
        'course_activity_fullscreen_mode',
        'course_activity_fullscreen_exit_modal',
        'course_activity_record_improper_use',
    ]);

    const FEATURE_FLAGS_RE = /course_activity_(?:fullscreen_mode|fullscreen_exit_modal|record_improper_use)|(?:featureFlags.*currentUser|currentUser.*featureFlags)/s;

    function shouldTransformFeatureFlags(text) {
        if (!text || typeof text !== 'string') return false;
        return FEATURE_FLAGS_RE.test(text);
    }

    function stripFullscreenFeatureFlags(obj) {
        if (!obj || typeof obj !== 'object') return obj;
        if (Array.isArray(obj)) {
            let writeIdx = 0;
            for (let i = 0; i < obj.length; i++) {
                const item = obj[i];
                if (typeof item === 'string' && STRIPPED_FEATURE_FLAGS.has(item)) {
                    continue;
                }
                if (item && typeof item === 'object') {
                    stripFullscreenFeatureFlags(item);
                }
                obj[writeIdx++] = item;
            }
            obj.length = writeIdx;
            return obj;
        }
        for (const k of Object.keys(obj)) {
            if (STRIPPED_FEATURE_FLAGS.has(k)) {
                delete obj[k];
            } else {
                const v = obj[k];
                if (v && typeof v === 'object') {
                    stripFullscreenFeatureFlags(v);
                }
            }
        }
        return obj;
    }

    // ============================================================
    // UNIFIED GRAPHQL DATA STREAM FILTER
    // ============================================================
    const GRAPHQL_INGEST_RE = /(?:videoLesson|VideoQuestion|answer(?:In|Pre)VideoQuestion|exam(?:Paper|PracticeSession|Question)|featureFlags|GetFeatureFlags|feedback|currentUser|userProfile)/i;

    function shouldIngestGraphQLResponse(rt) {
        if (!rt || typeof rt !== 'string') return false;
        return GRAPHQL_INGEST_RE.test(rt);
    }

    // ============================================================
    // TIME BOOST & MANUAL "ADD TIME" QUESTION BUTTON
    // ============================================================
    const VIDEO_OP             = 'CompleteVideoLesson';
    const MANUAL_BUTTON_ID     = 'us-timespent-btn';

    const KNOWN_QUESTION_OPS = new Set([
        'AnswerProgressQuizQuestion',
        'AnswerInVideoQuestion',
        'AnswerPreVideoQuestion',
        'AnswerDiagnosticQuestion',
        'AnswerSpacedPracticeQuizQuestion',
        'AnswerStrengthenQuizQuestion',
        'AnswerExamQuestion',
        'SaveExamQuestionMarks',
        'SaveExamPracticeAnswers',
        'SaveExamPracticeQuestionMarks',
    ]);

    const KNOWN_GROUP_OPS = new Set([
        'CompleteProgressQuizGroup',
        'CompleteSpacedPracticeQuiz',
        'CompleteStrengthenQuiz',
        'CompleteDiagnosticQuizSession',
        'CompleteExamQuestionWalkthrough',
        'CompleteExamPracticeSession',
    ]);

    const KNOWN_LESSON_OPS = new Set([
        'CompleteVideoLesson',
        'CompleteSubsectionSummary',
        'CompleteArticleLesson',
    ]);

    function isQuestionAnswerOp(opName, qStr) {
        if (KNOWN_QUESTION_OPS.has(opName)) return true;
        if (/^Answer.*Question$/i.test(opName)) return true;
        if (/^SaveExam/i.test(opName)) return true;
        if (qStr) {
            if (/answer[A-Za-z0-9]*Question/i.test(qStr)) return true;
            if (/saveExam[A-Za-z0-9]*/i.test(qStr)) return true;
        }
        return false;
    }

    function isQuizGroupOp(opName, qStr) {
        if (KNOWN_GROUP_OPS.has(opName)) return true;
        if (/^Complete.*(Quiz|Group|Session|Walkthrough)$/i.test(opName)) return true;
        if (qStr) {
            if (/complete[A-Za-z0-9]*(Quiz|Group|Session|Walkthrough)/i.test(qStr)) return true;
        }
        return false;
    }

    let accumulatedExtraSeconds  = 0;
    let accumulatedQuestionCount = 0;

    /**
     * Extra seconds queued to ADD on top of UpLearn's own timeSpent.
     *   null  → user hasn't set anything (button shows "Add time")
     *   0     → user explicitly set 0 (button shows "+0s")
     *   N > 0 → user set N seconds (button shows "+Xm Ys")
     * This is SET, not accumulated — each entry replaces the previous one.
     */
    let queuedSeconds  = null;
    let editing        = false;
    let resetScheduled = false;

    /* ------------------------------------------------------------
     * Helpers
     * ------------------------------------------------------------ */
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

        // ISO-8601 (e.g. PT1M15S, PT45.5S, P0DT1M15S)
        if (s.charCodeAt(0) === 80 || s.charCodeAt(0) === 112) {
            const m = ISO_DURATION_RE.exec(s);
            if (!m) return null;
            const d  = parseFloat(m[1] || 0);
            const h  = parseFloat(m[2] || 0);
            const mi = parseFloat(m[3] || 0);
            const se = parseFloat(m[4] || 0);
            return d * 86400 + h * 3600 + mi * 60 + se;
        }

        // mm:ss or hh:mm:ss (including optional fractional seconds like 00:01:15.5)
        if (COLON_TIME_RE.test(s)) {
            const parts = s.split(':');
            let secs = 0;
            for (let i = 0; i < parts.length; i++) secs = secs * 60 + parseFloat(parts[i]);
            return secs;
        }

        // "1h 30m 20s", "90s", "1.5m", "2 min"
        UNIT_TIME_RE.lastIndex = 0;
        let total = 0;
        let matched = false;
        let m;
        while ((m = UNIT_TIME_RE.exec(s)) !== null) {
            matched = true;
            const value = parseFloat(m[1]);
            const c = m[2].charCodeAt(0) | 32; // fast lowercase ASCII char
            if (c === 104)      total += value * 3600; // 'h'
            else if (c === 109) total += value * 60;   // 'm'
            else                total += value;
        }
        if (matched) return total;

        // Bare number => seconds
        if (BARE_NUM_RE.test(s)) return parseFloat(s);

        return null;
    }

    function pickExtraSeconds() {
        const min = Math.min(settings.extraSecondsMin, settings.extraSecondsMax);
        const max = Math.max(settings.extraSecondsMin, settings.extraSecondsMax);
        if (min === max) return min;
        return Math.floor(min + Math.random() * (max - min + 1));
    }

    /* ------------------------------------------------------------
     * Video Lesson State & Auto-Skip Progression
     * ------------------------------------------------------------ */
    const knownLessonDurations = new Map();
    let currentVideoLesson                 = null;
    let lastSkippedTarget                  = null;
    let autoSkipThrottled                  = false;
    let autoSkipThrottleTimer              = null;
    let lastActiveVideoElement             = null;
    let lastQuestionAnsweredAt             = 0;
    let waitingForPostAnswerResume         = false;

    /* ------------------------------------------------------------
     * Unified GraphQL State Storage (In-flight Ingestion)
     * ------------------------------------------------------------ */
    let latestExamPaperData                = null;
    let latestUserProfile                  = null;
    let latestFeatureFlags                 = null;
    let latestGlobalFeatureFlags           = null;
    let latestQuizFeedback                 = null;

    function throttleAutoSkip() {
        autoSkipThrottled = true;
        if (autoSkipThrottleTimer) clearTimeout(autoSkipThrottleTimer);
        autoSkipThrottleTimer = setTimeout(() => {
            autoSkipThrottleTimer = null;
            autoSkipThrottled = false;
        }, 1500);
    }

    function handleApiResponse(data) {
        if (!data || typeof data !== 'object') return;
        if (Array.isArray(data)) {
            data.forEach(handleApiResponse);
            return;
        }
        const d = data.data || data;
        if (!d || typeof d !== 'object') return;

        // 0. Subsection overview videoLessons durations
        if (d.subsection && Array.isArray(d.subsection.videoLessons)) {
            for (const item of d.subsection.videoLessons) {
                if (!item || !item.id) continue;
                const itemDur = parseDurationToSeconds(item.length) || parseDurationToSeconds(item.duration) || 0;
                if (itemDur > 0) {
                    knownLessonDurations.set(String(item.id), itemDur);
                }
            }
        }

        // 1. GetVideoLesson response
        if (d.videoLesson) {
            const vl = d.videoLesson;
            if (vl && vl.id) {
                const lessonId = String(vl.id);
                let dur = 0;
                if (vl.length != null) {
                    dur = parseDurationToSeconds(vl.length) || 0;
                }
                if (dur <= 0 && vl.duration != null) {
                    dur = parseDurationToSeconds(vl.duration) || 0;
                }
                if (dur > 0) {
                    knownLessonDurations.set(lessonId, dur);
                }

                const rawQuestions = Array.isArray(vl.inVideoQuizQuestions)
                    ? vl.inVideoQuizQuestions.filter(Boolean)
                    : [];
                const questions = [];
                for (let idx = 0; idx < rawQuestions.length; idx++) {
                    const q = rawQuestions[idx];
                    const parsedTrig = parseDurationToSeconds(q.triggerTime);
                    const trig = (parsedTrig != null && isFinite(parsedTrig) && parsedTrig >= 0)
                        ? parsedTrig
                        : (isFinite(Number(q.triggerTime)) && Number(q.triggerTime) >= 0 ? Number(q.triggerTime) : null);
                    const parsedResume = parseDurationToSeconds(q.postQuestionResumeTime);
                    const resume = (parsedResume != null && isFinite(parsedResume) && parsedResume >= 0)
                        ? parsedResume
                        : (trig != null ? trig + 1 : null);

                    questions.push({
                        id: String(q.id || `q-idx-${idx}`),
                        quizContentId: (q.quizContent && q.quizContent.id) ? String(q.quizContent.id) : null,
                        triggerTime: trig,
                        resumeTime: resume,
                    });
                }
                questions.sort((a, b) => {
                    if (a.triggerTime == null && b.triggerTime == null) return 0;
                    if (a.triggerTime == null) return 1;
                    if (b.triggerTime == null) return -1;
                    return a.triggerTime - b.triggerTime;
                });

                const preQuestions = [];
                if (Array.isArray(vl.preVideoQuestions)) {
                    for (const pq of vl.preVideoQuestions) {
                        if (pq && pq.id) {
                            preQuestions.push(String(pq.id));
                        }
                    }
                }

                lastSkippedTarget = null;
                lastQuestionAnsweredAt = 0;
                waitingForPostAnswerResume = false;
                currentVideoLesson = {
                    id: lessonId,
                    uniqueCode: vl.uniqueCode ? String(vl.uniqueCode) : '',
                    title: vl.title || '',
                    duration: dur,
                    questions: questions,
                    totalExpectedQuestions: rawQuestions.length,
                    preQuestions: preQuestions,
                    answeredQuestionIds: new Set(),
                    answeredPreQuestionIds: new Set(),
                    completed: false,
                    receivedAt: Date.now(),
                };

                LOG(`[videoLesson] Intercepted "${vl.title || lessonId}" (duration: ${formatSeconds(dur)}, ${questions.length} in-video question(s))`);
                VLOG('videoLesson intercepted', { lessonId, dur, questions, preQuestions });
                if (settings.autoSkipVideoEnabled) {
                    checkAndAutoSkipVideo(false);
                }
            }
        }

        // 2. In-video question response
        if (d.answerInVideoQuestion) {
            const ai = d.answerInVideoQuestion;
            const q = ai.question;
            const responses = Array.isArray(ai.responses) ? ai.responses : [];
            // A question is completed when:
            // - All response items are marked correct, OR
            // - MarkedQuestion solution/explanation is returned (final attempt completed), OR
            // - Direct mock/test response without responses array has question.id / question.quizContent
            const allCorrect = responses.length > 0 && responses.every((r) => r && r.correct);
            const hasMarkedSolution = Boolean(
                q && q.quizContent && (q.quizContent.quizDefinition || q.quizContent.explanation)
            );
            const isDirectMock = Boolean(
                (!ai.responses || responses.length === 0) && q && (q.id || q.quizContent)
            );
            const isCompleted = allCorrect || hasMarkedSolution || isDirectMock;

            if (currentVideoLesson && isCompleted) {
                let targetId = null;
                if (q && q.id) {
                    targetId = String(q.id);
                } else if (q && q.quizContent && q.quizContent.id) {
                    targetId = String(q.quizContent.id);
                }

                if (targetId) {
                    currentVideoLesson.answeredQuestionIds.add(targetId);
                    const matchedQ = currentVideoLesson.questions.find(
                        (item) => item.id === targetId || item.quizContentId === targetId
                    );
                    if (matchedQ) {
                        if (matchedQ.id) currentVideoLesson.answeredQuestionIds.add(matchedQ.id);
                        if (matchedQ.quizContentId) currentVideoLesson.answeredQuestionIds.add(matchedQ.quizContentId);
                    }
                    VLOG('in-video question marked answered', targetId);
                } else {
                    // Fallback: mark the earliest unanswered question near current playback time
                    const video = findActiveVideoElement();
                    const curT = video ? (video.currentTime || 0) : 0;
                    const answered = currentVideoLesson.answeredQuestionIds;
                    const candidate = currentVideoLesson.questions.find(
                        (item) => !answered.has(String(item.id)) && item.triggerTime != null && item.triggerTime <= curT + 2.5
                    ) || currentVideoLesson.questions.find((item) => !answered.has(String(item.id)));
                    if (candidate) {
                        if (candidate.id) currentVideoLesson.answeredQuestionIds.add(candidate.id);
                        if (candidate.quizContentId) currentVideoLesson.answeredQuestionIds.add(candidate.quizContentId);
                        VLOG('in-video question marked answered via timeline fallback', candidate.id);
                    }
                }
                lastQuestionAnsweredAt = Date.now();
                waitingForPostAnswerResume = true;
            }
        }

        // 3. Pre-video question response
        if (d.answerPreVideoQuestion) {
            const ap = d.answerPreVideoQuestion;
            const pq = ap.question;
            const preId = (pq && pq.id) ? String(pq.id) : null;
            if (currentVideoLesson) {
                if (preId) {
                    currentVideoLesson.answeredPreQuestionIds.add(preId);
                } else if (Array.isArray(currentVideoLesson.preQuestions)) {
                    const nextPre = currentVideoLesson.preQuestions.find((id) => !currentVideoLesson.answeredPreQuestionIds.has(id));
                    if (nextPre) currentVideoLesson.answeredPreQuestionIds.add(nextPre);
                }
            }
        }

        // 4. Exam paper & practice session payloads
        if (d.examPaper || d.examPracticeSession || (d.module && (d.module.examPapers || d.module.currentUserEnrolment))) {
            const ep = d.examPaper || d.examPracticeSession || d.module;
            latestExamPaperData = ep;
            VLOG('exam paper / practice session intercepted', ep);
        }

        // 5. Feature flags & user profile payloads
        if (d.currentUser) {
            latestUserProfile = d.currentUser;
            if (d.currentUser.featureFlags) {
                latestFeatureFlags = d.currentUser.featureFlags;
            }
            VLOG('currentUser / featureFlags intercepted', d.currentUser);
        }
        if (d.featureFlagsEnabledGlobally) {
            latestGlobalFeatureFlags = d.featureFlagsEnabledGlobally;
            VLOG('featureFlagsEnabledGlobally intercepted', d.featureFlagsEnabledGlobally);
        }

        // 6. Quiz feedback payloads
        const feedbackObj = d.feedback || d.feedbackMessages || d.feedbacks || d.quizFeedback ||
            (d.answerProgressQuizQuestion && (d.answerProgressQuizQuestion.feedback || d.answerProgressQuizQuestion.responses)) ||
            (d.answerSpacedPracticeQuizQuestion && (d.answerSpacedPracticeQuizQuestion.feedback || d.answerSpacedPracticeQuizQuestion.responses)) ||
            (d.answerDiagnosticQuestion && (d.answerDiagnosticQuestion.feedback || d.answerDiagnosticQuestion.responses)) ||
            (d.answerExamQuestion && (d.answerExamQuestion.feedback || d.answerExamQuestion.responses)) ||
            (d.answerStrengthenQuizQuestion && (d.answerStrengthenQuizQuestion.feedback || d.answerStrengthenQuizQuestion.responses));
        if (feedbackObj) {
            latestQuizFeedback = feedbackObj;
            VLOG('quiz feedback intercepted', latestQuizFeedback);
        }
    }

    function findActiveVideoElement() {
        try {
            // 1. Standard HTML5 video elements in main document
            const videos = document.querySelectorAll('video');
            for (let i = 0; i < videos.length; i++) {
                const v = videos[i];
                if (v && v.isConnected && (v.offsetWidth > 0 || v.offsetHeight > 0 || (isFinite(v.duration) && v.duration > 0))) {
                    return v;
                }
            }
            if (videos.length > 0 && videos[0].isConnected) return videos[0];

            // 2. Mux player custom elements
            const muxPlayers = document.querySelectorAll('mux-player');
            for (let i = 0; i < muxPlayers.length; i++) {
                const mp = muxPlayers[i];
                if (mp.shadowRoot) {
                    const sv = mp.shadowRoot.querySelector('video');
                    if (sv && sv.isConnected) return sv;
                }
                if (typeof mp.currentTime === 'number') return mp;
            }

            // 3. Wistia player custom elements or embed containers
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

    function isQuestionActiveOnPage() {
        try {
            // Fast path: Check lastResolvedSubmitBtn first
            if (lastResolvedSubmitBtn && lastResolvedSubmitBtn.isConnected && isCandidateSubmitButton(lastResolvedSubmitBtn)) {
                return true;
            }

            if (typeof document.querySelectorAll === 'function') {
                // Check question modals / overlays first (very fast, only a few elements)
                const modals = document.querySelectorAll('[role="dialog"], .quiz-content, [data-testid*="question"]');
                for (let i = 0; i < modals.length; i++) {
                    if (isElementVisible(modals[i])) return true;
                }

                // Check visible quiz option inputs
                const inputs = document.querySelectorAll('input[type="radio"], input[type="checkbox"]');
                for (let i = 0; i < inputs.length; i++) {
                    if (isElementVisible(inputs[i])) return true;
                }

                // Single consolidated button loop checking quiz action labels and candidate submit buttons
                const buttons = document.querySelectorAll('button, [role="button"], input[type="submit"]');
                for (let i = 0; i < buttons.length; i++) {
                    const btn = buttons[i];
                    if (btn.id === MANUAL_BUTTON_ID) continue;
                    const txt = getCleanElementText(btn);
                    if (!txt) continue;
                    if (QUIZ_ACTION_LABELS.has(txt) || QUESTION_SUBMIT_LABELS.has(txt) || QUESTION_SUBMIT_RE.test(txt)) {
                        if (isElementVisible(btn)) {
                            lastResolvedSubmitBtn = btn;
                            return true;
                        }
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
        if (autoSkipThrottled && !force) return;

        // If already skipped to end-1s and on same active video, avoid redundant layout checks
        if (!force && lastSkippedTarget === 'end-1s' && lastActiveVideoElement && lastActiveVideoElement.isConnected && !lastActiveVideoElement.ended) {
            return;
        }

        const video = findActiveVideoElement();
        if (!video || !video.isConnected || video.ended) return;

        if (video !== lastActiveVideoElement) {
            lastActiveVideoElement = video;
            lastSkippedTarget = null;
            bindVideoEvents(video);
        }

        // In real browser playback, wait if video is mid-seek or hasn't loaded metadata yet
        if (!force && (video.seeking || (typeof video.readyState === 'number' && video.readyState < 1))) {
            return;
        }

        const duration = (isFinite(video.duration) && video.duration > 0)
            ? video.duration
            : (currentVideoLesson?.duration || 0);

        if (duration > 0 && currentVideoLesson && currentVideoLesson.duration <= 0) {
            currentVideoLesson.duration = duration;
            if (currentVideoLesson.id) {
                knownLessonDurations.set(currentVideoLesson.id, duration);
            }
        }

        // If an in-video question or feedback overlay is active on screen, wait for user to answer & click Continue
        if (isQuestionActiveOnPage()) {
            return;
        }

        // If a question was just answered, wait until the user clicks Continue and the video resumes playing
        if (!force && waitingForPostAnswerResume) {
            if (video.paused || (Date.now() - lastQuestionAnsweredAt < 1500)) {
                return;
            }
            waitingForPostAnswerResume = false;
        }

        // In automatic mode, verify that GetVideoLesson metadata has arrived and matches the current lesson URL
        if (!force) {
            if (!currentVideoLesson) {
                return;
            }
            if (
                currentVideoLesson.uniqueCode &&
                typeof location !== 'undefined' &&
                location.pathname &&
                location.pathname.length > 1 &&
                !location.pathname.includes(currentVideoLesson.uniqueCode)
            ) {
                return;
            }
        }

        const currentTime = video.currentTime || 0;

        // Skip straight to one second before the video ends (guard duration > 2.0 to avoid seeking 0-duration clips)
        if (duration > 2.0) {
            const target = Math.max(0, duration - 1.0);
            if (force || (currentTime < target - 0.2 && lastSkippedTarget !== 'end-1s')) {
                lastSkippedTarget = 'end-1s';
                throttleAutoSkip();

                LOG(`[autoSkip] Skipping straight to 1s before video ends (${formatSeconds(target)} / ${formatSeconds(duration)})`);
                nativeConsole.log(`[UpLearn Video] Auto-skipping video from ${formatSeconds(currentTime)} to 1 second before end (${formatSeconds(target)} / ${formatSeconds(duration)})`);
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

    let mediaListenersInstalled = false;
    function installVideoMediaListeners() {
        if (mediaListenersInstalled) return;
        mediaListenersInstalled = true;
        document.addEventListener('loadedmetadata', onVideoMediaEvent, true);
        document.addEventListener('play', onVideoMediaEvent, true);
        document.addEventListener('playing', onVideoMediaEvent, true);
    }

    function startVideoAutoSkipController() {
        installVideoMediaListeners();
        checkAndAutoSkipVideo(false);
    }

    function stopVideoAutoSkipController() {
        // Media listeners are zero-overhead no-ops when settings.autoSkipVideoEnabled === false
    }

    function initVideoAutoSkipController() {
        installVideoMediaListeners();
        if (settings.autoSkipVideoEnabled) {
            checkAndAutoSkipVideo(false);
        }
    }

    /* ------------------------------------------------------------
     * Manual "Add Time" Button UI & Styles
     * ------------------------------------------------------------ */
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
    background-color: var(--lg-glass, rgba(255, 255, 255, 0.65));
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
    background-color: var(--lg-glass, rgba(40, 40, 40, 0.65));
    box-shadow: inset 0 0 0 0.5px var(--lg-edge, rgba(255, 255, 255, 0.08));
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
    background-color: var(--lg-glass-active, rgba(236, 236, 240, 0.85));
    transform: translateY(-0.5px);
}
html.ul-dark-mode #${MANUAL_BUTTON_ID}:hover {
    background-color: var(--lg-glass-active, rgba(70, 70, 70, 0.62));
}
#${MANUAL_BUTTON_ID}:active {
    transform: scale(0.97);
    background-color: var(--lg-glass-active);
}
#${MANUAL_BUTTON_ID}:active::after {
    opacity: 1;
}
#${MANUAL_BUTTON_ID}.us-active {
    background-color: var(--lg-fill, #0088ff) !important;
    color: #ffffff !important;
    box-shadow: 0 2px 10px rgba(0, 136, 255, 0.35), inset 0 0 0 0.5px rgba(255, 255, 255, 0.25) !important;
}
#${MANUAL_BUTTON_ID}.us-editing {
    padding: 0;
    background-color: var(--lg-surface, rgba(255, 255, 255, 0.95));
    box-shadow: 0 0 0 2px var(--lg-fill, #0088ff);
    cursor: text;
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

    const QUESTION_SUBMIT_RE = /^(submit|check|save|confirm|mark)(\s+(answer|answers|marks|response|part))?$/i;

    const cleanedTextCache = new WeakMap();

    function getCleanElementText(el) {
        if (!el) return '';
        const raw = el.textContent || el.value || (typeof el.getAttribute === 'function' ? el.getAttribute('aria-label') : '') || '';
        if (!raw) return '';
        const cached = cleanedTextCache.get(el);
        if (cached && cached.raw === raw) return cached.cleaned;
        const cleaned = raw.trim().toLowerCase().replace(/\s+/g, ' ');
        cleanedTextCache.set(el, { raw, cleaned });
        return cleaned;
    }

    let lastResolvedSubmitBtn = null;

    function isCandidateSubmitButton(btn) {
        if (!btn || !btn.isConnected) return false;
        if (btn.id === MANUAL_BUTTON_ID) return false;

        const txt = getCleanElementText(btn);
        let matches = QUESTION_SUBMIT_LABELS.has(txt) || QUESTION_SUBMIT_RE.test(txt);
        if (!matches && btn.getAttribute('type') === 'submit' && txt.length > 0 && txt.length < 30) {
            if (!/search|find|filter|menu|login|sign|logout|cancel|close/i.test(txt)) {
                matches = true;
            }
        }
        if (!matches) return false;

        // Check layout visibility ONLY after text confirms candidate status (avoids forced layout reflows)
        return isElementVisible(btn);
    }

    function findSubmitButton() {
        // Fast-path: Check previously resolved button if still connected and valid
        if (lastResolvedSubmitBtn && lastResolvedSubmitBtn.isConnected && isCandidateSubmitButton(lastResolvedSubmitBtn)) {
            return lastResolvedSubmitBtn;
        }

        // 1. Search inside active question/quiz containers first
        const containers = document.querySelectorAll('[role="dialog"], .quiz-content, [data-testid*="question"], [data-testid*="quiz"], .question');
        for (let c = 0; c < containers.length; c++) {
            const container = containers[c];
            if (!isElementVisible(container)) continue;

            const btns = container.querySelectorAll('button, input[type="submit"], [role="button"]');
            for (let i = 0; i < btns.length; i++) {
                const b = btns[i];
                if (isCandidateSubmitButton(b)) {
                    lastResolvedSubmitBtn = b;
                    return b;
                }
            }
        }

        // 2. Global search across all buttons in document
        const allButtons = document.querySelectorAll('button, input[type="submit"], [role="button"]');
        for (let i = 0; i < allButtons.length; i++) {
            const b = allButtons[i];
            if (isCandidateSubmitButton(b)) {
                lastResolvedSubmitBtn = b;
                return b;
            }
        }

        lastResolvedSubmitBtn = null;
        return null;
    }

    let pulseTimer = null;
    const stopPropagation = (e) => e.stopPropagation();

    function updateLabel(btn, pulse) {
        if (editing) return;          // never clobber the input
        btn = btn || document.getElementById(MANUAL_BUTTON_ID);
        if (!btn) return;

        const nextText = (queuedSeconds !== null) ? ('\u23F1 +' + formatSeconds(queuedSeconds)) : '\u23F1 Add time';
        if (btn.textContent !== nextText) {
            btn.textContent = nextText;
        }

        const nextActive = queuedSeconds !== null;
        if (btn.classList.contains('us-active') !== nextActive) {
            btn.classList.toggle('us-active', nextActive);
        }

        const nextTitle = (queuedSeconds !== null)
            ? 'Extra: +' + toIso(queuedSeconds) + ' (added on top of UpLearn\'s own timeSpent). Click to edit.'
            : 'Set extra time added on top of UpLearn\'s own timeSpent';
        if (btn.title !== nextTitle) {
            btn.title = nextTitle;
        }

        if (pulse) {
            if (pulseTimer) clearTimeout(pulseTimer);
            btn.classList.remove('us-reset');
            void btn.offsetWidth;
            btn.classList.add('us-reset');
            pulseTimer = setTimeout(() => {
                pulseTimer = null;
                btn.classList.remove('us-reset');
            }, 500);
        }
    }

    function enterEditMode() {
        const btn = document.getElementById(MANUAL_BUTTON_ID);
        if (!btn || editing) return;

        editing = true;
        btn.classList.add('us-editing');
        btn.textContent = '';

        const input = document.createElement('input');
        input.type         = 'text';
        input.inputMode    = 'numeric';
        input.autocomplete = 'off';
        input.spellcheck   = false;
        input.className    = 'us-input';
        input.placeholder  = 'seconds';
        input.value        = queuedSeconds !== null ? String(round3(queuedSeconds)) : '';

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
        if (!editing) return;
        commitEdit(e.target.value);
    }

    function teardownInput() {
        editing = false;
        const btn = document.getElementById(MANUAL_BUTTON_ID);
        if (!btn) return null;
        btn.classList.remove('us-editing');
        const input = btn.querySelector('input.us-input');
        if (input && input.parentNode === btn) btn.removeChild(input);
        return btn;
    }

    function commitEdit(rawValue) {
        if (!editing) return;
        teardownInput();

        const raw = (rawValue || '').trim();

        if (!raw) {
            queuedSeconds = null;
            updateLabel();
            return;
        }

        const secs = parseDurationToSeconds(raw);
        if (secs == null || secs < 0) {
            window.alert(
                'Could not understand "' + raw + '".\n\n' +
                'Enter a number of seconds (e.g. 120), or 1:30, 2m30s, PT45S.'
            );
            updateLabel();
            return;
        }

        queuedSeconds = secs;
        updateLabel(null, true);
        LOG(
            '[timeSpent] manual extra set to +' + formatSeconds(secs) +
            ' (' + toIso(secs) + ')'
        );
        nativeConsole.log(
            '[UpLearn timeSpent] extra set to +' + formatSeconds(secs) +
            ' (' + toIso(secs) + ')'
        );
    }

    function cancelEdit() {
        if (!editing) return;
        teardownInput();
        updateLabel();
    }

    function onButtonClick(e) {
        e.preventDefault();
        e.stopPropagation();
        if (editing) return;
        enterEditMode();
    }

    function onButtonKeyDown(e) {
        if (editing) return;
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
        btn.addEventListener('pointermove', (e) => {
            const r = btn.getBoundingClientRect();
            btn.style.setProperty('--lg-x', `${((e.clientX - r.left) / r.width) * 100}%`);
            btn.style.setProperty('--lg-y', `${((e.clientY - r.top) / r.height) * 100}%`);
        });
        return btn;
    }

    function removeButton() {
        const mine = document.getElementById(MANUAL_BUTTON_ID);
        if (mine && mine.isConnected) mine.remove();
        editing = false;
    }

    function ensureButton() {
        if (!settings.manualTimeButtonEnabled) {
            removeButton();
            queuedSeconds = null;
            editing = false;
            return;
        }

        const submit = findSubmitButton();

        if (!submit) {
            if (!editing) {
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

        if (editing) return;

        if (!mine) mine = createButton();

        if (submit.parentNode) {
            submit.parentNode.insertBefore(mine, submit.nextSibling);
        }
        updateLabel(mine);
    }

    function scheduleReset() {
        if (resetScheduled) return;
        resetScheduled = true;
        setTimeout(() => {
            queuedSeconds = null;
            resetScheduled = false;
            updateLabel();
        }, 0);
    }

    let manualBtnScheduled = false;
    function scheduleEnsureButton(mutations) {
        if (!settings.manualTimeButtonEnabled || manualBtnScheduled) return;
        if (mutations && Array.isArray(mutations)) {
            let hasRelevantElementChange = false;
            for (let i = 0; i < mutations.length; i++) {
                const m = mutations[i];
                if (m.type === 'childList') {
                    const added = m.addedNodes;
                    for (let j = 0; j < added.length; j++) {
                        if (added[j].nodeType === 1) {
                            const node = added[j];
                            const tid = node.id;
                            const isOurs = node === uiHostEl ||
                                tid === MANUAL_BUTTON_ID ||
                                (typeof tid === 'string' && tid.includes('__ul-')) ||
                                (uiHostEl && typeof uiHostEl.contains === 'function' && uiHostEl.contains(node));
                            if (!isOurs) {
                                hasRelevantElementChange = true;
                                break;
                            }
                        }
                    }
                    if (hasRelevantElementChange) break;
                    const removed = m.removedNodes;
                    for (let j = 0; j < removed.length; j++) {
                        if (removed[j].nodeType === 1) {
                            const node = removed[j];
                            const tid = node.id;
                            const isOurs = node === uiHostEl ||
                                tid === MANUAL_BUTTON_ID ||
                                (typeof tid === 'string' && tid.includes('__ul-')) ||
                                (uiHostEl && typeof uiHostEl.contains === 'function' && uiHostEl.contains(node));
                            if (!isOurs) {
                                hasRelevantElementChange = true;
                                break;
                            }
                        }
                    }
                    if (hasRelevantElementChange) break;
                }
            }
            if (!hasRelevantElementChange) return;
        }
        manualBtnScheduled = true;
        setTimeout(() => {
            manualBtnScheduled = false;
            ensureButton();
        }, 150);
    }

    function initManualButtonObserver() {
        // Merged into root domObserver to prevent redundant document subtree observers
    }

    /* ------------------------------------------------------------
     * Body Rewriting & Network Injection
     * ------------------------------------------------------------ */
    const TIME_SPENT_RE = /timeSpent(?:Answering|Marking)?|completeVideoLesson|updateVideoLessonWatchPercent|Answer|SaveExam|Complete/i;

    function maybeBumpTimeSpent(body, source) {
        if (typeof body !== 'string' || body.length > MAX_SCAN) return { body, changed: false };

        const boostActive = settings.timeBoostEnabled || queuedSeconds !== null || accumulatedExtraSeconds > 0;
        const videoActive = settings.fullVideoWatchedEnabled || settings.addVideoDurationToTimeSpent;
        if (!boostActive && !videoActive) return { body, changed: false };

        if (!TIME_SPENT_RE.test(body)) return { body, changed: false };

        let json;
        try { json = JSON.parse(body); }
        catch { return { body, changed: false }; }

        let changed = false;
        let manualResetNeeded = false;

        const patch = (obj) => {
            if (!obj || !obj.variables) return;

            const opName = obj.operationName || '';
            const qStr = typeof obj.query === 'string'
                ? obj.query
                : (typeof obj.mutation === 'string' ? obj.mutation : '');

            const isVideo = opName === VIDEO_OP ||
                qStr.includes(VIDEO_OP) ||
                qStr.includes('completeVideoLesson');

            if (isVideo) {
                let videoTouched = false;
                const lessonId = String(obj.variables.lessonId || '');

                // 1. Force 100% full watched
                if (settings.fullVideoWatchedEnabled) {
                    const beforePercent = obj.variables.percentWatched;
                    const targetPercent = (typeof beforePercent === 'string') ? '1' : 1;
                    if (beforePercent !== targetPercent) {
                        obj.variables.percentWatched = targetPercent;
                        bumpStat('videosMaxed');
                        videoTouched = true;
                        changed = true;

                        LOG(`[${source}] ${VIDEO_OP}: percentWatched ${beforePercent} → ${targetPercent} (lessonId: ${lessonId || 'unknown'})`);
                        nativeConsole.log(
                            `[UpLearn Video] ${VIDEO_OP} lessonId=${lessonId || 'unknown'} original percentWatched=${beforePercent} → ${targetPercent}`
                        );
                    }
                }

                // 2. Add video duration to timeSpent
                let vidDuration = 0;
                if (lessonId && knownLessonDurations.has(lessonId)) {
                    vidDuration = knownLessonDurations.get(lessonId);
                }
                if (vidDuration <= 0 && currentVideoLesson && (currentVideoLesson.id === lessonId || !lessonId)) {
                    vidDuration = currentVideoLesson.duration || 0;
                }
                if (vidDuration <= 0) {
                    const activeVid = findActiveVideoElement();
                    if (activeVid && isFinite(activeVid.duration) && activeVid.duration > 0) {
                        vidDuration = Math.round(activeVid.duration);
                    }
                }
                if (vidDuration <= 0 && currentVideoLesson && currentVideoLesson.duration > 0) {
                    vidDuration = currentVideoLesson.duration;
                }

                const rawTimeSpent = obj.variables.timeSpent;
                const origTimeSpent = Number(rawTimeSpent) || 0;
                let extraTime = 0;

                if (settings.addVideoDurationToTimeSpent && vidDuration > 0) {
                    extraTime += vidDuration;
                }

                if (queuedSeconds !== null) {
                    if (settings.manualTimeStacksWithAuto && settings.timeBoostEnabled) {
                        extraTime += queuedSeconds + pickExtraSeconds();
                    } else {
                        extraTime += queuedSeconds;
                    }
                    manualResetNeeded = true;
                }

                if (extraTime > 0) {
                    const newTimeSpent = round3(origTimeSpent + extraTime);
                    obj.variables.timeSpent = (typeof rawTimeSpent === 'string') ? String(newTimeSpent) : newTimeSpent;
                    if (settings.addVideoDurationToTimeSpent && vidDuration > 0) {
                        bumpStat('videoTimeAdded', vidDuration);
                    }
                    videoTouched = true;
                    changed = true;

                    LOG(`[${source}] ${VIDEO_OP}: timeSpent ${rawTimeSpent} (+${formatSeconds(extraTime)}) → ${obj.variables.timeSpent} (lessonId: ${lessonId || 'unknown'})`);
                    nativeConsole.log(
                        `[UpLearn Video] ${VIDEO_OP} lessonId=${lessonId || 'unknown'} original timeSpent=${rawTimeSpent} (+${formatSeconds(extraTime)}) → ${obj.variables.timeSpent}`
                    );
                }

                if (videoTouched) {
                    bumpStat('seen');
                }
                return;
            }

            // Group / Session completion operations
            const isGroup = isQuizGroupOp(opName, qStr);
            if (boostActive && isGroup) {
                let timeField = 'timeSpent';
                if (obj.variables.timeSpent == null) {
                    if (obj.variables.timeSpentAnswering != null) timeField = 'timeSpentAnswering';
                    else if (obj.variables.timeSpentMarking != null) timeField = 'timeSpentMarking';
                }

                if (obj.variables[timeField] != null) {
                    const rawVal = obj.variables[timeField];
                    const total = parseDurationToSeconds(rawVal);
                    if (total !== null) {
                        let bonus = accumulatedExtraSeconds;
                        let isManual = false;
                        if (queuedSeconds !== null) {
                            isManual = true;
                            if (settings.manualTimeStacksWithAuto && settings.timeBoostEnabled) {
                                bonus += queuedSeconds + pickExtraSeconds();
                            } else {
                                bonus += queuedSeconds;
                            }
                            manualResetNeeded = true;
                        }

                        if (bonus > 0) {
                            const newTotal = total + bonus;
                            if (typeof rawVal === 'string' && (rawVal.startsWith('P') || rawVal.startsWith('p'))) {
                                obj.variables[timeField] = toIso(newTotal);
                            } else if (typeof rawVal === 'number') {
                                obj.variables[timeField] = round3(newTotal);
                            } else {
                                obj.variables[timeField] = String(round3(newTotal));
                            }
                            bumpStat('groupExtra', bonus);
                            changed = true;
                            const count = accumulatedQuestionCount;
                            LOG(`[${source}] ${opName || 'QuizGroup'}: ${rawVal} → ${obj.variables[timeField]} ` +
                                `(+${bonus}s${count > 0 ? ` from ${count} question(s)` : ''}${isManual ? ' [manual]' : ''})`);
                            VLOG('group bonus applied; per-question accumulator reset', { bonus, count, opName });
                        }
                    }
                    accumulatedExtraSeconds = 0;
                    accumulatedQuestionCount = 0;
                    notifyStatsChange();
                }
                return;
            }

            // Per-question operations (and any other question/lesson operation with timeSpent)
            let timeField = 'timeSpent';
            if (obj.variables.timeSpent == null) {
                if (obj.variables.timeSpentAnswering != null) timeField = 'timeSpentAnswering';
                else if (obj.variables.timeSpentMarking != null) timeField = 'timeSpentMarking';
            }

            if (boostActive && obj.variables[timeField] != null) {
                const isQuestion = isQuestionAnswerOp(opName, qStr);
                const hasManual = queuedSeconds !== null;
                if (!hasManual && !isQuestion && !KNOWN_LESSON_OPS.has(opName)) {
                    return;
                }

                const rawVal = obj.variables[timeField];
                const total = parseDurationToSeconds(rawVal);
                if (total === null) return;

                let extra = 0;
                let isManual = false;

                if (hasManual) {
                    isManual = true;
                    if (settings.manualTimeStacksWithAuto && settings.timeBoostEnabled) {
                        const autoExtra = pickExtraSeconds();
                        extra = queuedSeconds + autoExtra;
                    } else {
                        extra = queuedSeconds;
                    }
                } else if (settings.timeBoostEnabled) {
                    extra = pickExtraSeconds();
                } else {
                    return;
                }

                if (extra > 0) {
                    const newTotal = total + extra;
                    if (typeof rawVal === 'string' && (rawVal.startsWith('P') || rawVal.startsWith('p'))) {
                        obj.variables[timeField] = toIso(newTotal);
                    } else if (typeof rawVal === 'number') {
                        obj.variables[timeField] = round3(newTotal);
                    } else {
                        obj.variables[timeField] = String(round3(newTotal));
                    }

                    accumulatedExtraSeconds += extra;
                    accumulatedQuestionCount += 1;
                    bumpStat('seen');
                    bumpStat('boosted');
                    if (isManual) {
                        bumpStat('manualBoosted');
                        manualResetNeeded = true;
                    }
                    notifyStatsChange();
                    changed = true;

                    const displayOp = opName || 'Question';
                    if (isManual) {
                        LOG(`[${source}] ${displayOp} (manual time): ${rawVal} (+${formatSeconds(queuedSeconds)}${settings.manualTimeStacksWithAuto && settings.timeBoostEnabled ? ' + auto' : ''}) → ${obj.variables[timeField]} ` +
                            `(accumulated ${accumulatedExtraSeconds}s / ${accumulatedQuestionCount} q)`);
                        nativeConsole.log(
                            `[UpLearn timeSpent] ${displayOp} original=${rawVal} (+${formatSeconds(extra)}) → ${obj.variables[timeField]}`
                        );
                    } else {
                        LOG(`[${source}] ${displayOp}: ${rawVal} → ${obj.variables[timeField]} ` +
                            `(+${extra}s, accumulated ${accumulatedExtraSeconds}s / ${accumulatedQuestionCount} q)`);
                        VLOG('boost roll', {
                            opName: displayOp,
                            rolled: extra,
                            range: `[${settings.extraSecondsMin}–${settings.extraSecondsMax}]`,
                            newAccumulated: accumulatedExtraSeconds,
                            questionCount: accumulatedQuestionCount,
                        });
                    }
                }
            }
        };

        if (Array.isArray(json)) json.forEach(patch);
        else patch(json);

        if (changed) {
            if (manualResetNeeded && queuedSeconds !== null) {
                scheduleReset();
            }
            return { body: JSON.stringify(json), changed: true };
        }
        return { body, changed: false };
    }

    function rewriteBodyText(text) {
        return maybeBumpTimeSpent(text, 'rewriteBodyText').body;
    }

    // ============================================================
    // FETCH INTERCEPTOR
    // ============================================================
    const origFetch = window.fetch;
    function processFetchResponse(fetchPromise, url, reqKind = 'none') {
        if (reqKind === 'ingest') {
            // Passive ingestion: zero added latency, handle in background asynchronously
            fetchPromise.then((res) => {
                if (res && res.ok && typeof res.clone === 'function') {
                    res.clone().json().then(handleApiResponse).catch(() => {});
                }
            }).catch(() => {});
            return fetchPromise;
        }

        if (reqKind !== 'transform') {
            // Unrelated operations: do not clone or delay response
            return fetchPromise;
        }

        // Only await cloned.text() for feature flags transformation
        return fetchPromise.then((res) => {
            try {
                if (res && res.ok && typeof res.clone === 'function') {
                    const cloned = res.clone();
                    if (typeof cloned.text === 'function') {
                        return cloned.text().then((rt) => {
                            const ingest = shouldIngestGraphQLResponse(rt);
                            const transform = shouldTransformFeatureFlags(rt);
                            if (ingest || transform) {
                                try {
                                    const parsed = JSON.parse(rt);
                                    handleApiResponse(parsed);
                                    if (transform) {
                                        const transformed = stripFullscreenFeatureFlags(parsed);
                                        const transformedText = JSON.stringify(transformed);
                                        reportFeatureFlagsTransformed('fetch', url || 'API');
                                        const newHeaders = new Headers();
                                        res.headers.forEach((v, k) => {
                                            const lk = k.toLowerCase();
                                            if (lk !== 'content-encoding' && lk !== 'content-length') {
                                                newHeaders.set(k, v);
                                            }
                                        });
                                        newHeaders.set('content-type', 'application/json');
                                        return new Response(transformedText, {
                                            status: res.status,
                                            statusText: res.statusText,
                                            headers: newHeaders,
                                        });
                                    }
                                } catch (e) {
                                    WARN('Failed to transform feature flags response:', e);
                                }
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
        window.fetch = function (input, init) {
            const self = this;
            let url = '';
            let method = 'GET';
            let targetApi = false;
            let reqKind = 'none';
            try {
                url = typeof input === 'string' ? input
                          : (input && input.url) ? input.url
                          : String(input || '');
                method = ((init && init.method) || (input && input.method) || 'GET').toUpperCase();

                const anyMatch = matchAnyTelemetryService(url);
                if (anyMatch) {
                    // ---- Telemetry block ----
                    if (isServiceMatchBlocked(anyMatch)) {
                        bumpStat('blocked');
                        const isJitsu = anyMatch.key === 'jitsu';

                        const doBlock = (capturedBody) => {
                            if (isJitsu) {
                                bumpStat('jitsuPackets');
                                reportJitsuPacket('fetch · BLOCKED', url, capturedBody);
                            } else {
                                reportBlock('fetch', url, { method, body: capturedBody });
                            }
                            return new Response('{}', {
                                status: 200, statusText: 'OK',
                                headers: { 'Content-Type': 'application/json' },
                            });
                        };

                        let bodyStr = init && typeof init.body === 'string' ? init.body : null;
                        if (bodyStr == null && typeof Request !== 'undefined' && input instanceof Request) {
                            try {
                                const ct = (input.headers.get('content-type') || '').toLowerCase();
                                if (ct.includes('application/json') || ct.includes('text/')) {
                                    return input.clone().text().then(doBlock, () => doBlock(null));
                                }
                            } catch {}
                        }
                        return Promise.resolve(doBlock(bodyStr));
                    }

                    // ---- Jitsu allowed: log the packet, then pass through ----
                    if (anyMatch.key === 'jitsu') {
                        bumpStat('jitsuPackets');
                        const doLogAndPass = (capturedBody) => {
                            reportJitsuPacket('fetch', url, capturedBody);
                            return origFetch.call(self, input, init);
                        };
                        let bodyStr = init && typeof init.body === 'string' ? init.body : null;
                        if (bodyStr == null && typeof Request !== 'undefined' && input instanceof Request) {
                            try {
                                const ct = (input.headers.get('content-type') || '').toLowerCase();
                                if (ct.includes('application/json') || ct.includes('text/')) {
                                    return input.clone().text().then(doLogAndPass, () => origFetch.call(self, input, init));
                                }
                            } catch {}
                        }
                        return doLogAndPass(bodyStr);
                    }

                    if (settings.logLevel === 'verbose' && !settings.telemetryServices[anyMatch.key]) {
                        reportAllow('fetch', url, `service "${anyMatch.label}" disabled in settings`);
                    }
                } else {
                    targetApi = isTargetApi(url);
                    if (method === 'POST' && targetApi) {
                        bumpStat('apiPosts');
                        let body = init && typeof init.body === 'string' ? init.body : null;

                        if (body == null && typeof Request !== 'undefined' && input instanceof Request) {
                            const ct = (input.headers.get('content-type') || '').toLowerCase();
                            if (ct.includes('application/json')) {
                                const passInit = init;
                                return input.clone().text().then((text) => {
                                    const blockedKind = getBlockedMutationKind(text);
                                    if (blockedKind === 'improper' && settings.blockLogImproperUse) {
                                        reportLogImproperUse('fetch · Request body', url, text);
                                        bumpStat('blocked');
                                        return logImproperUseSyntheticResponse();
                                    }
                                    if (blockedKind === 'event' && settings.blockLogEvent !== false) {
                                        reportLogEvent('fetch · Request body', url, text);
                                        return logEventSyntheticResponse();
                                    }
                                    if (blockedKind === 'search' && settings.privateSearchMode !== false) {
                                        reportLogLessonSearch('fetch · Request body', url, text);
                                        return logLessonSearchSyntheticResponse();
                                    }
                                    const reqK = classifyApiRequest(text);
                                    const { body: newBody, changed } = maybeBumpTimeSpent(text, 'fetch-Req');
                                    const reqToFetch = changed
                                        ? new Request(input, { body: newBody, method: input.method })
                                        : input;
                                    const fetchPromise = origFetch.call(self, reqToFetch, passInit);
                                    return processFetchResponse(fetchPromise, url, reqK);
                                }, () => {
                                    // Rejection handler fallback if input stream was disturbed/locked
                                    return origFetch.call(self, input, passInit);
                                });
                            }
                        }

                        if (body != null) {
                            const blockedKind = getBlockedMutationKind(body);
                            if (blockedKind === 'improper' && settings.blockLogImproperUse) {
                                reportLogImproperUse('fetch', url, body);
                                bumpStat('blocked');
                                return Promise.resolve(logImproperUseSyntheticResponse());
                            }
                            if (blockedKind === 'event' && settings.blockLogEvent !== false) {
                                reportLogEvent('fetch', url, body);
                                return Promise.resolve(logEventSyntheticResponse());
                            }
                            if (blockedKind === 'search' && settings.privateSearchMode !== false) {
                                reportLogLessonSearch('fetch', url, body);
                                return Promise.resolve(logLessonSearchSyntheticResponse());
                            }

                            reqKind = classifyApiRequest(body);
                            const { body: newBody, changed } = maybeBumpTimeSpent(body, 'fetch');
                            if (changed) init = Object.assign({}, init || {}, { body: newBody });
                        }
                    } else if (settings.logLevel === 'verbose' && targetApi) {
                        VLOG('API request (non-POST, passing through):', method, url);
                    }
                }
            } catch (e) {
                WARN('fetch interceptor error:', e);
            }

            const fetchPromise = origFetch.call(self, input, init);
            if (targetApi) {
                return processFetchResponse(fetchPromise, url, reqKind);
            }
            return fetchPromise;
        };
        cloak(window.fetch, 'fetch');
        VLOG('fetch hook installed');
    }

    // ============================================================
    // XHR INTERCEPTOR
    // ============================================================
    function mockBlockedXHR(self, responseText, jsonFn) {
        Object.defineProperty(self, 'readyState',   { value: 4,            configurable: true });
        Object.defineProperty(self, 'status',       { value: 200,          configurable: true });
        Object.defineProperty(self, 'statusText',   { value: 'OK',         configurable: true });
        Object.defineProperty(self, 'responseText', { value: responseText, configurable: true });
        Object.defineProperty(self, 'response', {
            get() { return self.responseType === 'json' ? jsonFn() : responseText; },
            configurable: true,
        });
        setTimeout(() => {
            try {
                self.dispatchEvent(new Event('readystatechange'));
                self.dispatchEvent(new ProgressEvent('load'));
                self.dispatchEvent(new ProgressEvent('loadend'));
            } catch {}
        }, 0);
    }

    const OrigXHR = window.XMLHttpRequest;
    const xhrInfoMap = new WeakMap();

    if (OrigXHR) {
        const origOpen = OrigXHR.prototype.open;
        const origSend = OrigXHR.prototype.send;

        OrigXHR.prototype.open = function (method, url) {
            xhrInfoMap.set(this, { method, url });
            return origOpen.apply(this, arguments);
        };
        cloak(OrigXHR.prototype.open, 'open');

        OrigXHR.prototype.send = function (body) {
            try {
                const info = xhrInfoMap.get(this);
                const method = (info?.method || '').toUpperCase();
                const url = info?.url || '';

                const anyMatch = matchAnyTelemetryService(url);
                if (anyMatch) {
                    // ---- Telemetry block ----
                    if (isServiceMatchBlocked(anyMatch)) {
                        let bodyStr = null;
                        try {
                            if (typeof body === 'string') bodyStr = body;
                            else if (body instanceof Document || body instanceof Blob || body instanceof FormData) {
                                bodyStr = `(${body.constructor ? body.constructor.name : 'non-string'} body)`;
                            } else if (body != null) {
                                bodyStr = `(${typeof body} body)`;
                            }
                        } catch {}
                        if (anyMatch.key === 'jitsu') {
                            bumpStat('jitsuPackets');
                            reportJitsuPacket('XHR · BLOCKED', url, bodyStr);
                        } else {
                            reportBlock('XHR', url, { method, body: bodyStr });
                        }
                        bumpStat('blocked');
                        mockBlockedXHR(this, '{}', () => ({}));
                        return;
                    }

                    // ---- Jitsu allowed: log packet, then pass through ----
                    if (anyMatch.key === 'jitsu') {
                        bumpStat('jitsuPackets');
                        let bodyStr = null;
                        try {
                            if (typeof body === 'string') bodyStr = body;
                            else if (body != null) bodyStr = `(${body.constructor ? body.constructor.name : typeof body} body)`;
                        } catch {}
                        reportJitsuPacket('XHR', url, bodyStr);
                    } else if (settings.logLevel === 'verbose' && !settings.telemetryServices[anyMatch.key]) {
                        reportAllow('XHR', url, `service "${anyMatch.label}" disabled in settings`);
                    }
                } else if (isTargetApi(url)) {
                    if (method === 'POST') bumpStat('apiPosts');

                    const blockedKind = getBlockedMutationKind(body);
                    if (blockedKind === 'improper' && settings.blockLogImproperUse) {
                        reportLogImproperUse('XHR', url,
                            typeof body === 'string' ? body : '(non-string body)');
                        bumpStat('blocked');
                        mockBlockedXHR(this, LOG_IMPROPER_PAYLOAD, () => ({ data: { logImproperUse: true } }));
                        return;
                    }

                    if (blockedKind === 'event' && settings.blockLogEvent !== false) {
                        reportLogEvent('XHR', url,
                            typeof body === 'string' ? body : '(non-string body)');
                        mockBlockedXHR(this, LOG_EVENT_PAYLOAD, () => ({ data: { logEvent: { id: "mock" } } }));
                        return;
                    }

                    if (blockedKind === 'search' && settings.privateSearchMode !== false) {
                        reportLogLessonSearch('XHR', url,
                            typeof body === 'string' ? body : '(non-string body)');
                        mockBlockedXHR(this, LOG_LESSON_SEARCH_PAYLOAD, () => ({ data: { logVideoSearchRequest: { id: "mock" }, logLessonSearch: { id: "mock" } } }));
                        return;
                    }

                    if (typeof body === 'string') {
                        const { body: newBody, changed } = maybeBumpTimeSpent(body, 'xhr');
                        if (changed) body = newBody;
                    }

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
                        try {
                            if (selfXhr.readyState === 4) {
                                xhrHandled = true;
                                cleanupXhrListeners();
                                if (selfXhr.status === 200) {
                                    const rt = selfXhr.responseText;
                                    const ingest = shouldIngestGraphQLResponse(rt);
                                    const transform = shouldTransformFeatureFlags(rt);
                                    if (ingest || transform) {
                                        try {
                                            const parsed = JSON.parse(rt);
                                            if (ingest) handleApiResponse(parsed);
                                            if (transform) {
                                                const modifiedJson = stripFullscreenFeatureFlags(parsed);
                                                const modifiedText = JSON.stringify(modifiedJson);
                                                reportFeatureFlagsTransformed('XHR', url || 'API');
                                                Object.defineProperty(selfXhr, 'responseText', {
                                                    get() { return modifiedText; },
                                                    configurable: true,
                                                });
                                                Object.defineProperty(selfXhr, 'response', {
                                                    get() {
                                                        return selfXhr.responseType === 'json' ? modifiedJson : modifiedText;
                                                    },
                                                    configurable: true,
                                                });
                                            }
                                        } catch {}
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
            } catch (e) {
                WARN('xhr interceptor error:', e);
            }
            return origSend.call(this, body);
        };
        cloak(OrigXHR.prototype.send, 'send');
        VLOG('XHR hook installed');
    }

    // ============================================================
    // SEND-BEACON INTERCEPTOR
    // ============================================================
    if (navigator.sendBeacon) {
        const origBeacon = navigator.sendBeacon.bind(navigator);
        navigator.sendBeacon = function (url, data) {
            try {
                const anyMatch = matchAnyTelemetryService(url);
                if (anyMatch) {
                    if (settings.blockSendBeacon && isServiceMatchBlocked(anyMatch)) {
                        let bodyStr = null;
                        try {
                            if (typeof data === 'string') bodyStr = data;
                            else if (data instanceof Blob) bodyStr = `(Blob · ${data.size} bytes)`;
                            else if (data instanceof ArrayBuffer) bodyStr = `(ArrayBuffer · ${data.byteLength} bytes)`;
                            else if (data != null) bodyStr = `(${typeof data} body)`;
                        } catch {}
                        if (anyMatch.key === 'jitsu') {
                            bumpStat('jitsuPackets');
                            reportJitsuPacket('sendBeacon · BLOCKED', String(url), bodyStr);
                        } else {
                            reportBlock('sendBeacon', String(url), { body: bodyStr });
                        }
                        bumpStat('blocked');
                        return true;
                    }

                    if (anyMatch.key === 'jitsu') {
                        bumpStat('jitsuPackets');
                        let bodyStr = null;
                        try {
                            if (typeof data === 'string') bodyStr = data;
                            else if (data instanceof Blob) bodyStr = `(Blob · ${data.size} bytes)`;
                            else if (data instanceof ArrayBuffer) bodyStr = `(ArrayBuffer · ${data.byteLength} bytes)`;
                            else if (data != null) bodyStr = `(${typeof data} body)`;
                        } catch {}
                        reportJitsuPacket('sendBeacon', String(url), bodyStr);
                    } else if (settings.logLevel === 'verbose' && !settings.telemetryServices[anyMatch.key]) {
                        reportAllow('sendBeacon', url, `service "${anyMatch.label}" disabled in settings`);
                    }
                }
            } catch {}
            return origBeacon(url, data);
        };
        cloak(navigator.sendBeacon, 'sendBeacon');
        VLOG('sendBeacon hook installed');
    }

    // ============================================================
    // VISIBILITY / FOCUS / ANTI-BLUR SPOOFING
    // ============================================================
    const ORIG_VIS = (() => {
        try {
            const d = (typeof Document !== 'undefined' && Object.getOwnPropertyDescriptor(Document.prototype, 'visibilityState'))
                   || (typeof HTMLDocument !== 'undefined' && Object.getOwnPropertyDescriptor(HTMLDocument.prototype, 'visibilityState'));
            return d && d.get ? d.get : null;
        } catch { return null; }
    })();
    const ORIG_HIDDEN = (() => {
        try {
            const d = (typeof Document !== 'undefined' && Object.getOwnPropertyDescriptor(Document.prototype, 'hidden'))
                   || (typeof HTMLDocument !== 'undefined' && Object.getOwnPropertyDescriptor(HTMLDocument.prototype, 'hidden'));
            return d && d.get ? d.get : null;
        } catch { return null; }
    })();
    const ORIG_HAS_FOCUS = document.hasFocus ? document.hasFocus.bind(document) : (() => true);

    const VISIBILITY_PROPS = ['visibilityState', 'webkitVisibilityState', 'mozVisibilityState', 'msVisibilityState'];
    const HIDDEN_PROPS     = ['hidden', 'webkitHidden', 'mozHidden', 'msHidden'];
    const VIS_DESC = {
        get: function () {
            return settings.spoofVisibility ? 'visible' : (ORIG_VIS ? ORIG_VIS.call(document) : 'visible');
        },
        configurable: true,
    };
    cloak(VIS_DESC.get, 'get');

    const HIDDEN_DESC = {
        get: function () {
            return settings.spoofVisibility ? false : (ORIG_HIDDEN ? ORIG_HIDDEN.call(document) : false);
        },
        configurable: true,
    };
    cloak(HIDDEN_DESC.get, 'get');

    const SPOOFED_HAS_FOCUS = function () {
        return settings.spoofVisibility ? true : ORIG_HAS_FOCUS();
    };
    cloak(SPOOFED_HAS_FOCUS, 'hasFocus');

    function patchVisibilityProps() {
        try {
            const docProto = (typeof Document !== 'undefined' && Document.prototype) ? Document.prototype : null;
            const htmlDocProto = (typeof HTMLDocument !== 'undefined' && HTMLDocument.prototype) ? HTMLDocument.prototype : null;
            const targets = [docProto, htmlDocProto].filter(Boolean);

            for (let i = 0; i < VISIBILITY_PROPS.length; i++) {
                const prop = VISIBILITY_PROPS[i];
                try { delete document[prop]; } catch {}
                for (let t = 0; t < targets.length; t++) {
                    try { Object.defineProperty(targets[t], prop, VIS_DESC); } catch {}
                }
            }
            for (let i = 0; i < HIDDEN_PROPS.length; i++) {
                const prop = HIDDEN_PROPS[i];
                try { delete document[prop]; } catch {}
                for (let t = 0; t < targets.length; t++) {
                    try { Object.defineProperty(targets[t], prop, HIDDEN_DESC); } catch {}
                }
            }
        } catch (e) { WARN('visibility patch failed', e); }
    }
    patchVisibilityProps();

    function installHasFocusPatch() {
        try {
            try { delete document.hasFocus; } catch {}
            if (typeof Document !== 'undefined' && Document.prototype && Document.prototype.hasFocus !== SPOOFED_HAS_FOCUS) {
                Document.prototype.hasFocus = SPOOFED_HAS_FOCUS;
            }
        } catch {}
    }
    installHasFocusPatch();
    VLOG('visibility/focus spoofing installed (live-toggleable)');

    const SUPPRESSED_EVENTS = new Set([
        'visibilitychange', 'webkitvisibilitychange', 'mozvisibilitychange', 'msvisibilitychange',
        'blur', 'pagehide', 'freeze', 'resume'
    ]);

    const origWinAdd = window.addEventListener ? window.addEventListener.bind(window) : null;
    const origDocAdd = document.addEventListener ? document.addEventListener.bind(document) : null;
    const origProtoAdd = (typeof EventTarget !== 'undefined' && EventTarget.prototype && EventTarget.prototype.addEventListener)
        ? EventTarget.prototype.addEventListener
        : null;

    const __ul_seenKilled = new Set();
    const KILL = (e) => {
        if (!settings.spoofVisibility) return;
        if (e.type === 'blur' || e.type === 'focusout') {
            if (
                e.target &&
                e.target !== window &&
                e.target !== document &&
                e.target !== document.documentElement &&
                e.target !== document.body &&
                ORIG_HAS_FOCUS()
            ) {
                return;
            }
        }
        if (settings.logLevel === 'verbose' && !__ul_seenKilled.has(e.type)) {
            __ul_seenKilled.add(e.type);
            VLOG(`intercepted "${e.type}" event (further ${e.type}s will be silenced from logs)`);
        }
        if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
        if (typeof e.stopPropagation === 'function') e.stopPropagation();
    };

    // Register capture-phase KILL listeners BEFORE wrapping addEventListener so they are never blocked by our own wrapper
    ['visibilitychange', 'webkitvisibilitychange', 'mozvisibilitychange', 'msvisibilitychange', 'blur', 'focusout', 'pagehide', 'freeze'].forEach((evt) => {
        try {
            if (origWinAdd) origWinAdd(evt, KILL, true);
            else if (origProtoAdd) origProtoAdd.call(window, evt, KILL, true);
        } catch {}
        try {
            if (origDocAdd) origDocAdd(evt, KILL, true);
            else if (origProtoAdd) origProtoAdd.call(document, evt, KILL, true);
        } catch {}
    });

    function wrapAddEventListener(target) {
        const targetName = target === window ? 'window' : 'document';
        const origAdd = target.addEventListener;
        if (!origAdd) return;
        target.addEventListener = function (type, listener, options) {
            if (settings.spoofVisibility && SUPPRESSED_EVENTS.has(type)) {
                VLOG(`suppressed "${type}" listener registration on ${targetName}`);
                return;
            }
            return origAdd.call(this, type, listener, options);
        };
        cloak(target.addEventListener, 'addEventListener');
    }
    wrapAddEventListener(window);
    wrapAddEventListener(document);

    try {
        if (origProtoAdd) {
            EventTarget.prototype.addEventListener = function (type, listener, options) {
                if (settings.spoofVisibility &&
                    (this === window || this === document) &&
                    SUPPRESSED_EVENTS.has(type)) {
                    VLOG(`suppressed "${type}" listener via EventTarget prototype`);
                    return;
                }
                return origProtoAdd.call(this, type, listener, options);
            };
            cloak(EventTarget.prototype.addEventListener, 'addEventListener');
        }
    } catch {}

    function findPropertyDescriptor(obj, prop) {
        let cur = obj;
        while (cur) {
            try {
                const d = Object.getOwnPropertyDescriptor(cur, prop);
                if (d) return d;
            } catch {}
            try { cur = Object.getPrototypeOf(cur); } catch { break; }
        }
        return null;
    }

    ['onpagehide', 'onvisibilitychange', 'onblur', 'onfocusout'].forEach((prop) => {
        [window, document].forEach((target) => {
            try {
                const desc = findPropertyDescriptor(target, prop);
                let fallbackVal = null;
                const getter = function () {
                    if (settings.spoofVisibility) return null;
                    if (desc && desc.get) return desc.get.call(this);
                    return fallbackVal;
                };
                const setter = function (v) {
                    if (settings.spoofVisibility) {
                        VLOG(`suppressed assignment to "${prop}"`);
                        return;
                    }
                    if (desc && desc.set) desc.set.call(this, v);
                    else fallbackVal = v;
                };
                cloak(getter, 'get ' + prop);
                cloak(setter, 'set ' + prop);
                Object.defineProperty(target, prop, {
                    get: getter,
                    set: setter,
                    configurable: true,
                });
            } catch {}
        });
    });

    // ============================================================
    // AUTO FULLSCREEN BLOCKER
    // ============================================================
    const FULLSCREEN_METHODS = [
        'requestFullscreen', 'webkitRequestFullscreen', 'webkitRequestFullScreen',
        'mozRequestFullScreen', 'msRequestFullscreen',
    ];
    const patchedFullscreenFns = new WeakSet();
    const origFullscreenFns = new WeakMap();

    function installFullscreenBlocker() {
        FULLSCREEN_METHODS.forEach((name) => {
            const proto = Element.prototype;
            if (!proto[name] || patchedFullscreenFns.has(proto[name])) return;
            const orig = proto[name];
            const wrapped = function () {
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
                return orig.apply(this, arguments);
            };
            patchedFullscreenFns.add(wrapped);
            origFullscreenFns.set(wrapped, orig);
            cloak(wrapped, name);
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
    VLOG('fullscreen blocker installed');

    // ============================================================
    // KEYBIND HELPERS
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
        if (/^Numpad\d$/.test(code)) return 'Num ' + code.slice(6);
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
    // HEROUI v3 DESIGN SYSTEM & UI COMPONENTS
    // ============================================================
    let uiHostEl = null;
    let uiShadowRoot = null;
    let uiContainerEl = null;
    let reactRootInstance = null;
    let capturingKeybind = false;
    let isModalOpenGlobal = false;
    let reactSetSettings = null;
    let reactSetStats = null;
    let reactSetModalOpen = null;
    let reactSetCapturingKeybind = null;

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

    function ensureUIHost() {
        if (uiShadowRoot && document.getElementById('__ul-heroui-host')) {
            return uiShadowRoot;
        }

        let host = document.getElementById('__ul-heroui-host');
        if (!host) {
            host = document.createElement('div');
            host.id = '__ul-heroui-host';
            host.setAttribute('data-glisse-backdrop', '');
            host.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:2147483645;';
            (document.body || document.documentElement).appendChild(host);
        }
        uiHostEl = host;

        if (!host.shadowRoot) {
            uiShadowRoot = host.attachShadow({ mode: 'open' });
        } else {
            uiShadowRoot = host.shadowRoot;
        }

        let styleEl = uiShadowRoot.getElementById('__ul-heroui-styles');
        if (!styleEl) {
            styleEl = document.createElement('style');
            styleEl.id = '__ul-heroui-styles';
            styleEl.textContent = getHeroUIStyles();
            uiShadowRoot.appendChild(styleEl);
        }

        let container = uiShadowRoot.getElementById('__ul-root');
        if (!container) {
            container = document.createElement('div');
            container.id = '__ul-root';
            container.className = 'heroui-root';
            container.setAttribute('data-glisse-backdrop', '');
            uiShadowRoot.appendChild(container);
        }
        uiContainerEl = container;

        mountReactUI();
        return uiShadowRoot;
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
  --lg-ease: cubic-bezier(0.25, 0.1, 0.25, 1);
  --lg-blur: 1px;
  --lg-bezel: 8px;
  --lg-thickness: 16px;
  --lg-zoom: 1.02;
  --lg-rim-saturation: 1.6;
  --lg-refraction: 1.05;
  --lg-row-tint: rgba(0, 0, 0, 0.035);
  --lg-card-tint: rgba(0, 0, 0, 0.02);
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
  --lg-row-tint: rgba(255, 255, 255, 0.045);
  --lg-card-tint: rgba(255, 255, 255, 0.025);
  --lg-dialog-tint: rgba(14, 14, 18, 0.88);
  --lg-pill-tint: rgba(18, 18, 22, 0.72);
}

@media (prefers-color-scheme: dark) {
  :where(:root:not([data-theme="light"]), .heroui-root:not([data-theme="light"])) {
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
    --lg-row-tint: rgba(255, 255, 255, 0.045);
    --lg-card-tint: rgba(255, 255, 255, 0.025);
    --lg-dialog-tint: rgba(14, 14, 18, 0.88);
    --lg-pill-tint: rgba(18, 18, 22, 0.72);
  }
}

/* Glass */

.lg-glass {
  position: relative;
  background-color: var(--lg-glass);
  background-image: var(--lg-rim, none);
  background-size: 100% 100%;
  --lg-blur: 1px;
  --lg-bezel: 8px;
  --lg-thickness: 16px;
  --lg-zoom: 1.02;
  --lg-rim-saturation: 1.6;
  -webkit-backdrop-filter: blur(var(--lg-blur, 0px)) var(--lg-filter, saturate(1.8));
  backdrop-filter: blur(var(--lg-blur, 0px)) var(--lg-filter, saturate(1.8));
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

/* Glass refracting a copy of its backdrop, where the live one can't be filtered */

.lg-glass[data-copy] {
  -webkit-backdrop-filter: none;
  backdrop-filter: none;
}

.lg-glass-copy {
  position: absolute;
  top: 0;
  left: 0;
  margin: 0;
  overflow: hidden;
  transform-origin: 0 0;
  pointer-events: none;
}

.lg-glass-copy > div {
  position: absolute;
  top: 0;
  left: 0;
  transform-origin: 0 0;
}

/* Button */

.lg-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 40px;
  padding: 0 16px;
  border: 0;
  border-radius: 20px;
  color: var(--lg-foreground);
  font: inherit;
  font-size: 14px;
  cursor: pointer;
  /* A long press keeps pressing, as on iOS, rather than selecting the label. */
  touch-action: manipulation;
  -webkit-tap-highlight-color: transparent;
  -webkit-touch-callout: none;
  user-select: none;
  -webkit-user-select: none;
  transition: background-color 200ms ease;
}

.lg-button[data-icon] {
  padding-left: 12px;
}

.lg-button[data-icon="only"] {
  width: 40px;
  padding: 0;
}

.lg-button > svg {
  flex: none;
  width: 20px;
  height: 20px;
}

/* Lights up at once when pressed, as on iOS, and fades on release. */
.lg-button:is(:active, [data-pressed]) {
  background-color: var(--lg-glass-active);
  transition-duration: 0s;
}

@media (hover: hover) and (pointer: fine) {
  .lg-button:hover {
    background-color: var(--lg-glass-active);
  }
}

.lg-button:disabled {
  background-color: var(--lg-glass);
  opacity: 0.35;
  cursor: default;
}

.lg-button[data-destructive]:not([data-tint]) {
  --lg-tint: var(--lg-destructive);
}

.lg-button:is([data-tint], [data-destructive]) {
  color: var(--lg-tint);
}

.lg-button[data-variant="filled"] {
  --lg-button-fill: var(--lg-tint, var(--lg-fill));
  color: #fff;
}

.lg-button[data-variant="filled"],
.lg-button[data-variant="filled"]:disabled {
  background-color: var(--lg-button-fill);
}

.lg-button[data-variant="filled"]:is(:active, [data-pressed]) {
  background-color: color-mix(in srgb, var(--lg-button-fill) 85%, #000);
}

@media (hover: hover) and (pointer: fine) {
  .lg-button[data-variant="filled"]:hover {
    background-color: color-mix(in srgb, var(--lg-button-fill) 88%, #fff);
  }

  .lg-button[data-variant="filled"]:hover:is(:active, [data-pressed]) {
    background-color: color-mix(in srgb, var(--lg-button-fill) 85%, #000);
  }
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
  font: inherit;
  font-size: 14px;
}

.lg-tab {
  position: relative;
  z-index: 1;
  padding: 0;
  border: 0;
  border-radius: calc(var(--lg-tab-height) / 2);
  color: var(--lg-muted);
  background: none;
  text-decoration: none;
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
  transition:
    opacity 140ms ease,
    background-color 140ms ease;
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

.lg-input-icon {
  flex: none;
  width: 16px;
  height: 16px;
  color: var(--lg-muted);
}

.lg-input-icon {
  display: grid;
  place-items: center;
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

.lg-input:has(input:disabled) {
  opacity: 0.35;
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
  background: var(--lg-fill);
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

.lg-slider input::-webkit-slider-runnable-track {
  height: 6px;
  background: transparent;
}

/* The native thumb only takes the touch; the glass thumb is drawn beneath.
   iOS shades the native one even without its appearance, so hide it. */
.lg-slider input::-webkit-slider-thumb {
  width: 36px;
  height: 40px;
  margin-top: -17px;
  border: 0;
  background: transparent;
  box-shadow: none;
  opacity: 0;
  /* A touch on the thumb drags it rather than scrolling the page; the rest of
     the track still scrolls. Blocking touchmove instead would stop Safari's
     own drag. */
  touch-action: none;
  appearance: none;
  -webkit-appearance: none;
}

.lg-slider input::-moz-range-track {
  height: 6px;
  background: transparent;
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

.lg-slider:has(input:disabled) {
  opacity: 0.35;
}

.lg-slider input:disabled {
  cursor: default;
}

/* Menu */

.lg-menu {
  position: relative;
  display: inline-flex;
}

.lg-menu-card {
  position: absolute;
  top: 0;
  right: 0;
  z-index: 10;
  box-sizing: border-box;
  width: 200px;
  border-radius: 20px;
  color: var(--lg-foreground);
  font-size: 14px;
  transform-origin: calc(100% - 20px) 20px;
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
}

.lg-menu-card[data-align="start"] {
  right: auto;
  left: 0;
  transform-origin: 20px 20px;
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
  -webkit-backdrop-filter: blur(22px) saturate(1.9);
  backdrop-filter: blur(22px) saturate(1.9);
  box-shadow:
    inset 0 0 0 0.5px var(--lg-surface-edge),
    0 12px 40px var(--lg-shadow);
  pointer-events: none;
}

.lg-menu-card[data-align="start"] .lg-menu-surface {
  right: auto;
  left: 0;
}

.lg-menu-glyph {
  position: absolute;
  top: 0;
  right: 0;
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  pointer-events: none;
}

.lg-menu-card[data-align="start"] .lg-menu-glyph {
  right: auto;
  left: 0;
}

.lg-menu-glyph > svg {
  width: 20px;
  height: 20px;
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
  transition:
    transform 100ms cubic-bezier(0.2, 0.8, 0.2, 1),
    opacity 80ms ease-out;
}

.lg-menu-item {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 32px;
  padding: 6px 12px;
  border: 0;
  border-radius: 14px;
  color: inherit;
  background: transparent;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.lg-menu-item > svg {
  flex: none;
  width: 16px;
  height: 16px;
}

.lg-menu-item:focus-visible {
  outline-offset: -2px;
  background: var(--lg-highlight);
}

@media (hover: hover) and (pointer: fine) {
  .lg-menu-item:hover:not(:disabled) {
    background: var(--lg-highlight);
  }
}

.lg-menu-card[data-scrubbing] .lg-menu-item {
  background: transparent;
  outline: none;
}

.lg-menu-item[data-destructive] {
  color: var(--lg-destructive);
}

.lg-menu-item:disabled {
  opacity: 0.38;
  cursor: default;
}

.lg-menu-separator {
  flex: none;
  margin: 7px 11px;
  border-top: 0.5px solid var(--lg-separator);
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
  from {
    opacity: 0;
  }
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

            /* Custom Glisse Scrollbars */
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

            /* Glisse Modal Container & Window */
            .modal__backdrop {
                position: fixed;
                inset: 0;
                z-index: 2147483647;
                background: rgba(0, 0, 0, 0.45);
                -webkit-backdrop-filter: blur(16px);
                backdrop-filter: blur(16px);
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 20px;
                box-sizing: border-box;
                pointer-events: auto;
                animation: lg-fade-in 180ms cubic-bezier(0.16, 1, 0.3, 1) forwards;
            }

            .modal__backdrop--closing {
                pointer-events: none !important;
                animation: lg-fade-out 160ms cubic-bezier(0.4, 0, 0.2, 1) forwards !important;
            }

            .modal__backdrop--draggable {
                background: transparent !important;
                backdrop-filter: none !important;
                -webkit-backdrop-filter: none !important;
                pointer-events: none !important;
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
                pointer-events: none !important;
                position: fixed !important;
                inset: 0 !important;
                width: 100vw !important;
                height: 100vh !important;
                max-width: none !important;
                max-height: none !important;
                display: block !important;
                padding: 0 !important;
            }

            .modal__dialog {
                width: 100%;
                height: 100%;
                border-radius: 24px;
                color: var(--lg-foreground);
                background-color: var(--lg-dialog-tint, rgba(14, 14, 18, 0.88)) !important;
                -webkit-backdrop-filter: blur(36px) saturate(1.8) !important;
                backdrop-filter: blur(36px) saturate(1.8) !important;
                border: 0.5px solid var(--lg-surface-edge, rgba(255, 255, 255, 0.14));
                box-shadow:
                    inset 0 1px 1.5px 0 rgba(255, 255, 255, 0.20),
                    inset 0 0 0 0.5px var(--lg-surface-edge, rgba(255, 255, 255, 0.14)),
                    0 28px 72px rgba(0, 0, 0, 0.60),
                    0 6px 24px rgba(0, 0, 0, 0.35) !important;
                display: flex;
                flex-direction: column;
                overflow: hidden;
                animation: lg-scale-in 200ms cubic-bezier(0.16, 1, 0.3, 1) forwards;
            }

            .modal__dialog--draggable {
                pointer-events: auto !important;
                position: absolute !important;
                margin: 0 !important;
                width: min(920px, 92vw);
                height: min(680px, 86vh);
                min-height: 480px;
                box-sizing: border-box;
                will-change: left, top;
                transition: none !important;
            }

            :where([data-theme="light"], .heroui-root[data-theme="light"]) .modal__dialog {
                background-color: var(--lg-dialog-tint, rgba(240, 240, 246, 0.92)) !important;
                border-color: rgba(0, 0, 0, 0.12);
                box-shadow:
                    inset 0 1px 1.5px 0 rgba(255, 255, 255, 0.85),
                    inset 0 0 0 0.5px rgba(255, 255, 255, 0.50),
                    0 24px 64px rgba(20, 20, 30, 0.22),
                    0 4px 16px rgba(20, 20, 30, 0.10) !important;
            }

            :where([data-theme="dark"], .heroui-root[data-theme="dark"]) .modal__dialog {
                background-color: var(--lg-dialog-tint, rgba(14, 14, 18, 0.88)) !important;
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
                animation: lg-scale-out 160ms cubic-bezier(0.4, 0, 0.2, 1) forwards !important;
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
                cursor: grabbing !important;
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

            .modal__footer {
                display: flex;
                align-items: center;
                justify-content: flex-end;
                gap: 10px;
                padding: 12px 20px;
                border-top: 0.5px solid var(--lg-separator);
                background: transparent;
                flex-shrink: 0;
            }

            /* Tabs Panels */
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

            /* Responsive 2-Column Grid */
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

            /* Clean Uniform Inset Cards (Lightweight & Smooth) */
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
            /* ============================================================
               Dropdown Menus Z-Index Stacking & Popover Elevation
               Ensures dropdown menus ALWAYS stay on top of all other cards,
               rows, switches, sliders, and buttons in both static and floating mode
               ============================================================ */
            :is(.card, .col-stack):has(.lg-menu-card),
            :is(.card, .col-stack):has(.lg-menu--active),
            :is(.card, .col-stack):has([data-phase="open"]),
            :is(.card, .col-stack):has([aria-expanded="true"]) {
                z-index: 9000 !important;
            }

            :is(.card__content):has(.lg-menu-card),
            :is(.card__content):has(.lg-menu--active),
            :is(.card__content):has([data-phase="open"]),
            :is(.card__content):has([aria-expanded="true"]) {
                z-index: 9100 !important;
            }

            :is(.field-row, .field-switch-row, .field-box, .switch):has(.lg-menu-card),
            :is(.field-row, .field-switch-row, .field-box, .switch):has(.lg-menu--active),
            :is(.field-row, .field-switch-row, .field-box, .switch):has([data-phase="open"]),
            :is(.field-row, .field-switch-row, .field-box, .switch):has([aria-expanded="true"]) {
                z-index: 9200 !important;
            }

            .lg-menu-select:has(.lg-menu-card),
            .lg-menu-select:has(.lg-menu--active),
            .lg-menu-select:has([data-phase="open"]),
            .lg-menu-select:has([aria-expanded="true"]),
            .lg-menu:has(.lg-menu-card),
            .lg-menu:has(.lg-menu--active),
            .lg-menu[data-phase="open"],
            .lg-menu[data-open="true"] {
                z-index: 9500 !important;
            }

            /* Prevent other rows/buttons from elevating on hover above open dropdown menus */
            .tabs__panel:has(.lg-menu-card) :is(.field-row, .field-switch-row, .field-box, .switch):not(:has(.lg-menu-card)):hover,
            .modal__body:has(.lg-menu-card) :is(.field-row, .field-switch-row, .field-box, .switch):not(:has(.lg-menu-card)):hover {
                transform: none !important;
                z-index: 1 !important;
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

            /* Uniform Clean Setting Rows (Lightweight & Smooth) */
            .field-row, .field-switch-row, .field-box, .switch {
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
            :where([data-theme="light"], .heroui-root[data-theme="light"]) :is(.field-row, .field-switch-row, .field-box, .switch) {
                --row-bg: rgba(0, 0, 0, 0.035);
                box-shadow:
                    inset 0 1px 1px 0 rgba(255, 255, 255, 0.6),
                    0 1px 2px rgba(0, 0, 0, 0.04);
            }
            :where([data-theme="dark"], .heroui-root[data-theme="dark"]) :is(.field-row, .field-switch-row, .field-box, .switch) {
                --row-bg: rgba(255, 255, 255, 0.045);
            }
            .field-row:hover, .field-switch-row:hover, .field-box:hover, .switch:hover {
                background-color: var(--lg-highlight);
                border-color: rgba(255, 255, 255, 0.22);
                transform: translateY(-0.5px);
                box-shadow: 0 3px 10px -1px var(--lg-drop);
            }
            .field-row:active, .field-switch-row:active, .field-box:active, .switch:active {
                transform: scale(0.995);
            }
            .field-row--danger {
                border-color: rgba(255, 56, 60, 0.32);
            }
            .field-row--danger:hover {
                border-color: rgba(255, 56, 60, 0.5);
                background-color: rgba(255, 56, 60, 0.08);
            }

            /* Uniform Action Buttons System (Clean, Legible & Never-Wrap) */
            .field-row > label,
            .field-row > div:first-child:not([class*="btn"]):not([class*="button"]) {
                flex: 1 1 auto;
                min-width: 0;
                padding-right: 12px;
            }
            .field-row > :last-child:not(label) {
                flex-shrink: 0;
            }

            .lg-button {
                display: inline-flex !important;
                align-items: center !important;
                justify-content: center !important;
                white-space: nowrap !important;
                flex-shrink: 0 !important;
                height: 34px !important;
                padding: 0 16px !important;
                border-radius: 17px !important;
                font-size: 12.5px !important;
                font-weight: 550 !important;
                letter-spacing: -0.01em !important;
                box-sizing: border-box !important;
                background-color: var(--lg-highlight) !important;
                border: 0.5px solid var(--lg-edge) !important;
                color: var(--lg-foreground) !important;
                box-shadow: 0 1px 2px var(--lg-drop) !important;
                transition: background-color 140ms ease, border-color 140ms ease, transform 100ms ease, box-shadow 140ms ease !important;
            }
            .lg-button:hover {
                background-color: var(--lg-glass-active) !important;
                border-color: rgba(255, 255, 255, 0.22) !important;
                transform: translateY(-0.5px) !important;
            }
            .lg-button:active {
                transform: scale(0.98) !important;
            }

            .lg-button[data-icon="only"] {
                width: 34px !important;
                height: 34px !important;
                min-width: 34px !important;
                padding: 0 !important;
                border-radius: 17px !important;
            }

            /* Destructive Action Buttons (e.g. Reset All Preferences) */
            .lg-button[data-destructive] {
                background-color: rgba(255, 59, 48, 0.12) !important;
                border: 0.5px solid rgba(255, 59, 48, 0.35) !important;
                color: #ff453a !important;
                font-weight: 590 !important;
            }
            .lg-button[data-destructive]:hover {
                background-color: rgba(255, 59, 48, 0.22) !important;
                border-color: rgba(255, 59, 48, 0.6) !important;
                box-shadow: 0 2px 8px rgba(255, 59, 48, 0.2) !important;
            }

            /* Filled Accent Buttons */
            .lg-button[data-variant="filled"] {
                background-color: var(--accent, var(--lg-fill)) !important;
                border-color: transparent !important;
                color: #ffffff !important;
                box-shadow: 0 2px 6px color-mix(in srgb, var(--accent, var(--lg-fill)) 35%, transparent) !important;
            }
            .lg-button[data-variant="filled"]:hover {
                background-color: color-mix(in srgb, var(--accent, var(--lg-fill)) 90%, #ffffff) !important;
            }

            /* Quick Range Presets Chips in TimeBoost */
            .field-box .lg-button {
                height: 30px !important;
                padding: 0 13px !important;
                font-size: 12px !important;
                border-radius: 9999px !important;
            }

            /* Keybind Recorder Button */
            .keybind-btn {
                min-width: 104px !important;
                font-variant-numeric: tabular-nums !important;
                border-color: var(--lg-separator) !important;
                font-weight: 600 !important;
            }
            .keybind-btn--capturing {
                border-color: var(--accent, var(--lg-fill)) !important;
                background-color: color-mix(in srgb, var(--accent, var(--lg-fill)) 18%, transparent) !important;
                color: var(--accent, var(--lg-fill)) !important;
                box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent, var(--lg-fill)) 28%, transparent) !important;
                animation: keybind-pulse 1.2s infinite ease-in-out !important;
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

            .field-switch-content, .switch__content {
                display: flex;
                flex-direction: column;
                gap: 3px;
                flex: 1;
                min-width: 0;
            }

            .field-switch-content [data-slot="label"],
            .field-switch-row [data-slot="label"],
            .field-row > label,
            .switch [data-slot="label"] {
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
            .field-switch-row [data-slot="description"],
            .field-row > label small,
            .field-row small,
            .switch [data-slot="description"] {
                font-size: 12px;
                color: var(--lg-muted);
                font-weight: 450;
                line-height: 1.45;
                display: block;
                margin-top: 2px;
                opacity: 1;
            }

            /* Glisse Slider Container */
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

            /* Color Swatches */
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
            }
            .color-swatch:hover {
                transform: scale(1.15);
            }
            .color-swatch[data-active="true"] {
                transform: scale(1.1);
                box-shadow: 0 0 0 2px var(--lg-surface), 0 0 0 4px var(--accent, var(--lg-fill));
            }

            /* Services Search & Grid */
            .services-search-bar,
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
                min-width: 0 !important;
            }
            .services-search-field .lg-input,
            .services-search-field.lg-input {
                width: 100% !important;
                max-width: 100% !important;
                height: 34px !important;
                padding: 0 12px !important;
                border-radius: 17px !important;
                background-color: var(--row-bg, rgba(255, 255, 255, 0.045)) !important;
                border: 0.5px solid var(--lg-edge) !important;
                box-shadow: inset 0 1px 1px 0 rgba(255, 255, 255, 0.08), 0 1px 2px var(--lg-drop) !important;
                box-sizing: border-box !important;
            }
            .services-search-field .lg-input:focus-within,
            .services-search-field.lg-input:focus-within {
                border-color: var(--accent, var(--lg-fill)) !important;
                background-color: var(--lg-highlight) !important;
            }
            .services-search-field input {
                font-size: 12.5px !important;
                min-width: 0 !important;
            }
            .services-actions {
                display: inline-flex;
                align-items: center;
                gap: 6px;
                flex-shrink: 0;
            }
            .services-actions .lg-button,
            .services-action-btn {
                height: 34px !important;
                padding: 0 11px !important;
                font-size: 12px !important;
                font-weight: 550 !important;
                border-radius: 17px !important;
                white-space: nowrap !important;
                flex-shrink: 0 !important;
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

            /* Glisse Liquid Glass Switch Controls (Subtle & Drag-Responsive) */
            .lg-switch {
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
            .lg-switch-thumb {
                box-shadow:
                    0 3px 8px rgba(0, 0, 0, 0.22),
                    inset 0 1px 1px rgba(255, 255, 255, 0.8),
                    inset 0 -1px 1px rgba(0, 0, 0, 0.1),
                    inset 0 0 0 0.5px rgba(255, 255, 255, 0.4) !important;
                background-image: var(--lg-rim, none) !important;
                background-size: 100% 100% !important;
                -webkit-backdrop-filter: blur(2px) saturate(1.3) !important;
                backdrop-filter: blur(2px) saturate(1.3) !important;
            }

            /* Statistics Tiles Grid */
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

            /* Badges */
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
            .badge--soft.badge--warning {
                background: rgba(255, 149, 0, 0.16);
                color: #ff9500;
            }
            .badge--soft.badge--danger {
                background: rgba(255, 59, 48, 0.16);
                color: #ff3b30;
            }
            .badge--secondary {
                background: var(--lg-highlight);
                color: var(--lg-foreground);
            }

            /* Glisse Dynamic Island Status Pill (Subtle Refraction Lens) */
            .heroui-pill {
                position: fixed;
                z-index: 2147483646;
                display: flex;
                align-items: center;
                gap: 8px;
                height: 38px;
                padding: 0 8px 0 12px;
                border-radius: 9999px;
                background: none !important;
                background-color: var(--lg-pill-tint, rgba(18, 18, 22, 0.72)) !important;
                background-image: var(--lg-rim, none) !important;
                background-size: 100% 100% !important;
                --lg-blur: 1px !important;
                --lg-bezel: 8px !important;
                --lg-thickness: 16px !important;
                --lg-zoom: 1.02 !important;
                --lg-rim-saturation: 1.6 !important;
                -webkit-backdrop-filter: blur(12px) saturate(1.4) !important;
                backdrop-filter: blur(12px) saturate(1.4) !important;
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

            .heroui-pill:hover {
                transform: translateY(-1.5px) scale(1.03);
                box-shadow: 0 16px 42px -4px var(--lg-shadow), inset 0 1px 1px 0 rgba(255, 255, 255, 0.3);
            }

            .heroui-pill:active {
                transform: scale(0.96);
            }

            .heroui-pill--minimal {
                width: 44px !important;
                height: 44px !important;
                padding: 0 !important;
                border-radius: 50% !important;
                background-color: transparent !important;
                background: none !important;
                justify-content: center;
                gap: 0;
            }

            .heroui-pill--minimal .heroui-pill__main {
                display: none !important;
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

            .input {
                background: var(--lg-glass);
                color: var(--lg-foreground);
                border: 0.5px solid var(--lg-separator);
                border-radius: 9999px;
                height: 32px;
                padding: 0 12px;
                font-size: 13px;
                font-family: inherit;
                outline: none;
                transition: border-color 150ms, box-shadow 150ms;
            }
            .input:focus {
                border-color: var(--accent, var(--lg-fill));
                box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent, var(--lg-fill)) 25%, transparent);
            }

            /* Pop-up Options powered by Glisse.Menu */
            .lg-menu-select {
                display: inline-flex;
                position: relative;
            }
            .lg-menu-select .lg-button {
                width: auto !important;
                min-width: 140px;
                height: 34px !important;
                padding: 0 12px 0 14px !important;
                display: inline-flex !important;
                align-items: center !important;
                justify-content: space-between !important;
                border-radius: 17px !important;
                box-sizing: border-box !important;
            }
            .lg-menu-select .lg-button[data-icon="only"] {
                width: auto !important;
                padding: 0 12px 0 14px !important;
            }
            .lg-menu-select .lg-select-trigger-content {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 8px;
                width: 100%;
            }
            .lg-menu-select .lg-select-current-label {
                font-size: 13px;
                font-weight: 500;
                color: var(--lg-foreground);
                white-space: nowrap;
            }
            .lg-menu-select .lg-select-chevron {
                width: 12px;
                height: 12px;
                color: var(--lg-muted);
                flex-shrink: 0;
                transition: transform 180ms ease;
            }
            .lg-menu-select:has(.lg-menu-card[data-phase="open"]) .lg-select-chevron {
                transform: rotate(180deg);
            }
            .lg-menu-select .lg-menu-glyph {
                display: none !important;
            }
            .lg-menu-select .lg-menu-card {
                min-width: 240px !important;
                max-width: 340px !important;
                width: max-content !important;
                border-radius: 18px !important;
                background: transparent !important;
                box-shadow: none !important;
                border: none !important;
                outline: none !important;
                z-index: 100000 !important;
            }
            .lg-menu-select .lg-menu-surface {
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
            .lg-menu-select .lg-menu-content {
                padding: 6px !important;
            }
            .lg-menu-select .lg-menu-item {
                padding: 8px 12px !important;
                min-height: 38px !important;
                border-radius: 12px !important;
                width: 100% !important;
                box-sizing: border-box !important;
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
        `);
    }
function getEffectiveTheme(thm) {
        const t = thm || settings.theme;
        if (t === 'auto') {
            try { return (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) ? 'light' : 'dark'; }
            catch { return 'dark'; }
        }
        return t;
    }

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
            saveSettings();
            LOG('telemetry preset:', value);
            if (reactSetSettings) reactSetSettings(cloneSettings(settings));
            return;
        }

        if (key === 'extraSecondsRange') {
            let min = Number(value && value.min);
            let max = Number(value && value.max);
            if (!isFinite(min) || min < 1) min = DEFAULT_SETTINGS.extraSecondsMin;
            if (!isFinite(max) || max < 1) max = DEFAULT_SETTINGS.extraSecondsMax;
            min = Math.round(min); max = Math.round(max);
            if (min > max) { const t = min; min = max; max = t; }
            settings.extraSecondsMin = min;
            settings.extraSecondsMax = max;
            saveSettings();
            LOG('range set to:', settings.extraSecondsMin, '–', settings.extraSecondsMax);
            if (reactSetSettings) reactSetSettings(cloneSettings(settings));
            return;
        }

        if (key === 'telemetryServices') {
            settings.telemetryServices = Object.assign({}, value);
            if (typeof settings.telemetryServices.jitsu === 'boolean') {
                settings.suppressJitsu = settings.telemetryServices.jitsu;
            }
            settings.telemetryPreset = 'custom';
            saveSettings();
            if (reactSetSettings) reactSetSettings(cloneSettings(settings));
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

        saveSettings();
        LOG('setting changed:', key, '=', value);

        switch (key) {
            case 'manualTimeButtonEnabled':
                LOG('manual "Add time" button ' + (value ? 'ENABLED' : 'DISABLED'));
                if (!value) removeButton();
                else ensureButton();
                break;
            case 'manualTimeStacksWithAuto':
                LOG('manual time stacking with auto-boost ' + (value ? 'ENABLED' : 'DISABLED'));
                break;
            case 'fullVideoWatchedEnabled':
                LOG('full video watch toggle (percentWatched=1) ' + (value ? 'ENABLED' : 'DISABLED'));
                break;
            case 'autoSkipVideoEnabled':
                if (value) {
                    startVideoAutoSkipController();
                } else {
                    stopVideoAutoSkipController();
                }
                LOG('auto-skip video to questions / completion ' + (value ? 'ENABLED' : 'DISABLED'));
                break;
            case 'addVideoDurationToTimeSpent':
                LOG('add full video duration to timeSpent ' + (value ? 'ENABLED' : 'DISABLED'));
                break;
            case 'suppressJitsu':
                LOG('Jitsu telemetry ' + (value ? 'SUPPRESSED (blocked + logged)' : 'ALLOWED (passed through + logged)'));
                break;
            case 'blockLogEvent':
                LOG('LogEvent local mocking ' + (value ? 'ENABLED' : 'DISABLED'));
                break;
            case 'privateSearchMode':
                LOG('Private search mode ' + (value ? 'ENABLED' : 'DISABLED'));
                break;
            case 'disableAutoFullscreen':
                LOG('auto-fullscreen blocking ' + (value ? 'ENABLED' : 'DISABLED'));
                break;
            case 'spoofVisibility':
                patchVisibilityProps();
                installHasFocusPatch();
                LOG('visibility spoofing ' + (value ? 'ENABLED' : 'DISABLED'));
                break;
            case 'darkMode':
                ensureDarkModeStyles();
                applyDarkMode();
                break;
            case 'logLevel':
                if (publicApi) {
                    if (value === 'verbose') window.__ul = publicApi;
                    else try { delete window.__ul; } catch {}
                }
                LOG('log level set to:', value);
                break;
            case 'keybindAction':
                if (value === 'open-modal') {
                    settings.pillVisible = false;
                } else if (value === 'toggle-pill') {
                    settings.pillVisible = true;
                }
                LOG('keybind action set to:', value, '| pillVisible:', settings.pillVisible);
                break;
        }

        if (reactSetSettings) reactSetSettings(cloneSettings(settings));
    }

    function openSettingsModal() {
        if (reactSetModalOpen) {
            reactSetModalOpen(true);
        } else {
            ensureUIHost();
            setTimeout(() => { if (reactSetModalOpen) reactSetModalOpen(true); }, 50);
        }
    }

    function closeSettingsModal() {
        if (reactSetModalOpen) reactSetModalOpen(false);
    }

    function syncModalIfOpen() {
        if (reactSetSettings) reactSetSettings(cloneSettings(settings));
    }

    
    // ============================================================
    // OFFICIAL KELVIN ZHANG GLISSE ENGINE (https://glisse.kelvinzhang.com/)
    // Directly bundled from official npm package glisse@0.4.3
    // Exports: Button, Glass, Input, Menu, SearchField, Slider, Switch, TabBar
    // ============================================================
var Glisse = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // ../../../../../../private/tmp/glisse_pkg/entry.js
  var entry_exports = {};
  __export(entry_exports, {
    Button: () => Button,
    Glass: () => Glass,
    Input: () => Input,
    Menu: () => Menu,
    SearchField: () => SearchField,
    Slider: () => Slider,
    Switch: () => Switch,
    TabBar: () => TabBar
  });

  // ../../../../../../private/tmp/glisse_pkg/react-shim.js
  var React = typeof window !== "undefined" && window.React ? window.React : typeof globalThis !== "undefined" && globalThis.React ? globalThis.React : {};
  var forwardRef = React.forwardRef ? React.forwardRef.bind(React) : (fn) => fn;
  var useCallback = (...args) => (window.React || React).useCallback(...args);
  var useEffect = (...args) => (window.React || React).useEffect(...args);
  var useImperativeHandle = (...args) => (window.React || React).useImperativeHandle(...args);
  var useLayoutEffect = (...args) => (window.React || React).useLayoutEffect(...args);
  var useRef = (...args) => (window.React || React).useRef(...args);
  var useState = (...args) => (window.React || React).useState(...args);

  // ../../../../../../private/tmp/glisse_pkg/jsx-shim.js
  function jsx(type, props, key) {
    const R = typeof window !== "undefined" && window.React ? window.React : globalThis.React;
    if (!props) return R.createElement(type, key !== void 0 ? { key } : null);
    const { children, ...rest } = props;
    const finalProps = key !== void 0 ? { ...rest, key } : rest;
    return R.createElement(type, finalProps, children);
  }
  function jsxs(type, props, key) {
    const R = typeof window !== "undefined" && window.React ? window.React : globalThis.React;
    if (!props) return R.createElement(type, key !== void 0 ? { key } : null);
    const { children, ...rest } = props;
    const finalProps = key !== void 0 ? { ...rest, key } : rest;
    if (Array.isArray(children)) {
      return R.createElement(type, finalProps, ...children);
    }
    return R.createElement(type, finalProps, children);
  }

  // ../../../../../../private/tmp/glisse_pkg/package/dist/index.js
  function cx(...names) {
    return names.filter(Boolean).join(" ");
  }
  var moving = /* @__PURE__ */ new Set();
  var frame = 0;
  var last = 0;
  function advance(s, dt) {
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
  function tick(time) {
    frame = 0;
    const dt = Math.min(0.1, Math.max(0, (time - last) / 1e3));
    last = time;
    for (const s of moving) {
      advance(s, dt);
      if (Math.abs(s.value - s.target) < 1e-4 && Math.abs(s.velocity) < 1e-3) {
        s.value = s.target;
        s.velocity = 0;
        moving.delete(s);
      }
      s.paint(s.value);
    }
    if (moving.size) frame = requestAnimationFrame(tick);
  }
  function prefersReducedMotion() {
    return matchMedia("(prefers-reduced-motion: reduce)").matches;
  }
  function createSpring(value, stiffness, damping, paint) {
    const s = {
      value,
      target: value,
      velocity: 0,
      stiffness,
      damping,
      paint
    };
    return {
      paint: () => paint(s.value),
      set(target, instant = false) {
        s.target = target;
        if (instant || document.hidden || prefersReducedMotion()) {
          s.value = target;
          s.velocity = 0;
          moving.delete(s);
          paint(target);
          return;
        }
        moving.add(s);
        if (!frame) {
          last = Number(document.timeline?.currentTime ?? performance.now());
          frame = requestAnimationFrame(tick);
        }
      },
      tune(nextStiffness, nextDamping) {
        s.stiffness = nextStiffness;
        s.damping = nextDamping;
      },
      stop: () => {
        moving.delete(s);
      }
    };
  }
  var POINTER = {
    grow: 6,
    press: [417.6, 29.2],
    release: [230, 23.7]
  };
  var TOUCH = {
    grow: 15,
    press: [515, 27.3],
    release: [250, 11.8]
  };
  function usePress(ref) {
    useEffect(() => {
      const el = ref.current;
      if (!el) return;
      const value = [
        1,
        1,
        0,
        0
      ];
      const paint = () => {
        el.style.scale = `${value[0]} ${value[1]}`;
        el.style.translate = `${value[2]}px ${value[3]}px`;
      };
      const springs = value.map((initial, i) => createSpring(initial, ...POINTER.release, (next) => {
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
        el.style.setProperty("--lg-x", `${(event.clientX - box.left) / box.width * 100}%`);
        el.style.setProperty("--lg-y", `${(event.clientY - box.top) / box.height * 100}%`);
        const { width, height } = box;
        const base = 1 + feel.grow / Math.max(width, height);
        const aspect = width / height;
        const dx = (event.clientX - pointer.x) / aspect;
        const dy = event.clientY - pointer.y;
        const length = Math.hypot(dx, dy);
        if (!length) return target([
          base,
          base,
          0,
          0
        ], feel.press);
        const nx = dx / length;
        const ny = dy / length;
        const rubber = 1 - 1 / (1 + length / height / (5 * aspect));
        const stretch = 1 + 6 / height * rubber * Math.abs(Math.abs(nx) - Math.abs(ny));
        const horizontal = Math.abs(nx) > Math.abs(ny);
        target([
          base * (horizontal ? stretch : 1 / stretch),
          base * (horizontal ? 1 / stretch : stretch),
          nx * 8 * rubber,
          ny * 8 * rubber
        ], feel.press);
      };
      const move = (event) => {
        if (event.pointerId === pointer?.id) track(event);
      };
      const end = (event) => {
        if (event && event.pointerId !== pointer?.id) return;
        const feel = pointer?.feel ?? POINTER;
        pointer = null;
        delete el.dataset.pressed;
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", end);
        window.removeEventListener("pointercancel", end);
        target([
          1,
          1,
          0,
          0
        ], feel.release);
      };
      const down = (event) => {
        if (!event.isPrimary || event.button !== 0 || pointer || el.matches(":disabled")) return;
        pointer = {
          id: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          box: el.getBoundingClientRect(),
          feel: event.pointerType === "mouse" ? POINTER : TOUCH
        };
        el.dataset.pressed = "";
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", end);
        window.addEventListener("pointercancel", end);
        track(event);
      };
      const reset = () => end();
      el.addEventListener("pointerdown", down);
      window.addEventListener("blur", reset);
      return () => {
        end();
        springs.forEach((spring) => spring.stop());
        el.removeEventListener("pointerdown", down);
        window.removeEventListener("blur", reset);
        el.style.removeProperty("scale");
        el.style.removeProperty("translate");
      };
    }, [ref]);
  }
  var SVG = "http://www.w3.org/2000/svg";
  var lenses = /* @__PURE__ */ new Map();
  var defs;
  var clamp$2 = (value, min, max) => Math.min(max, Math.max(min, value));
  function svg(name, attributes) {
    const element = document.createElementNS(SVG, name);
    for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
    return element;
  }
  function container() {
    if (defs?.isConnected) return defs;
    const root = svg("svg", {
      width: 0,
      height: 0,
      "aria-hidden": "true"
    });
    root.style.cssText = "position:absolute;pointer-events:none;width:0;height:0;";
    defs = svg("defs", {});
    root.append(defs);
    const target = (typeof uiShadowRoot !== "undefined" && uiShadowRoot) || document.body || document.documentElement;
    if (target) target.append(root);
    return defs;
  }
  function profile(bezel, thickness) {
    const samples = /* @__PURE__ */ new Float32Array(128);
    let maximum = 0;
    for (let i = 0; i < samples.length; i++) {
      const t = Math.max(1e-3, i / (samples.length - 1));
      const surface = (1 - (1 - t) ** 4) ** 0.25;
      const incident = Math.atan((1 - t) ** 3 / surface ** 3);
      const refracted = Math.asin(Math.sin(incident) / 1.5);
      samples[i] = Math.tan(incident - refracted) * (thickness + surface * bezel);
      maximum = Math.max(maximum, samples[i]);
    }
    return {
      samples,
      maximum
    };
  }
  function maps(width, height, radius, selection, shape) {
    const density = 1;
    const bezel = shape.bezel ?? clamp$2(Math.min(width, height) * 0.12, 4, 10);
    const { samples, maximum } = profile(bezel, shape.thickness ?? clamp$2(Math.min(width, height) * 0.2, 8, 24));
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(width * density);
    canvas.height = Math.ceil(height * density);
    const context = canvas.getContext("2d");
    const field = context.createImageData(canvas.width, canvas.height);
    const shine = context.createImageData(canvas.width, canvas.height);
    const magnify = shape.zoom > 1 ? context.createImageData(canvas.width, canvas.height) : void 0;
    const reach = Math.max(width, height) / 2;
    const direction = selection ? 1 : -1;
    for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
      const px = (x + 0.5) * width / canvas.width - width / 2;
      const py = (y + 0.5) * height / canvas.height - height / 2;
      const qx = Math.abs(px) - (width / 2 - radius);
      const qy = Math.abs(py) - (height / 2 - radius);
      const ox = Math.max(qx, 0);
      const oy = Math.max(qy, 0);
      const length = Math.hypot(ox, oy);
      const distance = radius - (length + Math.min(Math.max(qx, qy), 0));
      const nx = length > 0 ? ox / length * Math.sign(px) : qx > qy ? Math.sign(px) : 0;
      const ny = length > 0 ? oy / length * Math.sign(py) : qx > qy ? 0 : Math.sign(py);
      let shift = 0;
      if (distance >= 0 && distance < bezel) {
        const sample = distance / bezel * (samples.length - 1);
        const lower = Math.floor(sample);
        const a = samples[lower];
        shift = a + (samples[Math.min(lower + 1, samples.length - 1)] - a) * (sample - lower);
      }
      const i = (y * canvas.width + x) * 4;
      field.data[i] = Math.round(127.5 + direction * nx * shift / maximum * 127.5);
      field.data[i + 1] = Math.round(127.5 + direction * ny * shift / maximum * 127.5);
      field.data[i + 2] = 128;
      field.data[i + 3] = 255;
      if (magnify) {
        magnify.data[i] = Math.round(127.5 - px / reach * 127.5);
        magnify.data[i + 1] = Math.round(127.5 - py / reach * 127.5);
        magnify.data[i + 2] = 128;
        magnify.data[i + 3] = 255;
      }
      const light = -(nx + ny) * Math.SQRT1_2;
      const glint = Math.max(light, 0) ** 3;
      const reflected = Math.max(-light, 0) ** 3;
      shine.data[i] = shine.data[i + 1] = shine.data[i + 2] = 255;
      let alpha = 0;
      if (distance >= 0 && selection) {
        const d0 = (distance - 0.18) / 0.22;
        const d1 = (distance - 0.42) / 0.22;
        const d2 = (distance - 0.66) / 0.22;
        const b0 = Math.exp(-(d0 * d0));
        const b1 = Math.exp(-(d1 * d1));
        const b2 = Math.exp(-(d2 * d2));
        const peak = Math.max(b0, b1, b2);
        alpha = peak * (0.06 + 0.8 * glint + 0.35 * reflected) * 0.85;
        const invPeak = peak ? 0.35 / peak : 0;
        shine.data[i] = Math.round(255 * (0.65 + b0 * invPeak));
        shine.data[i + 1] = Math.round(255 * (0.65 + b1 * invPeak));
        shine.data[i + 2] = Math.round(255 * (0.65 + b2 * invPeak));
      } else if (distance >= 0) {
        const rim = Math.exp(-(((distance - 0.4) / 0.38) ** 2));
        const bloom = Math.exp(-((distance / (bezel * 0.22)) ** 2));
        alpha = rim * (0.045 + 0.52 * glint + 0.2 * reflected) + bloom * 0.02 * glint;
      }
      shine.data[i + 3] = Math.round(clamp$2(alpha, 0, 1) * 255);
    }
    context.putImageData(field, 0, 0);
    const displacement = canvas.toDataURL();
    context.putImageData(shine, 0, 0);
    const highlight = canvas.toDataURL();
    let zoom;
    if (magnify) {
      context.putImageData(magnify, 0, 0);
      zoom = {
        map: canvas.toDataURL(),
        scale: 2 * reach * (1 - 1 / shape.zoom)
      };
    }
    return {
      displacement,
      highlight,
      zoom,
      scale: maximum * 2 * shape.level
    };
  }
  function lens(width, height, radius, selection, shape) {
    const key = Object.values({
      width,
      height,
      radius,
      selection,
      ...shape
    }).join("-");
    const cached = lenses.get(key);
    if (cached) return cached;
    const { displacement, highlight, zoom, scale } = maps(width, height, radius, selection, shape);
    const id2 = `glisse-${lenses.size}`;
    const box = {
      x: 0,
      y: 0,
      width,
      height
    };
    const filter = svg("filter", {
      id: id2,
      ...box,
      filterUnits: "userSpaceOnUse",
      primitiveUnits: "userSpaceOnUse",
      "color-interpolation-filters": "sRGB"
    });
    filter.append(svg("feImage", {
      href: displacement,
      ...box,
      preserveAspectRatio: "none",
      result: "field"
    }));
    if (selection) {
      for (const [name, factor, values] of [
        [
          "r",
          1.035,
          "1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0"
        ],
        [
          "g",
          1,
          "0 0 0 0 0 0 1 0 0 0 0 0 0 0 0 0 0 0 1 0"
        ],
        [
          "b",
          0.965,
          "0 0 0 0 0 0 0 0 0 0 0 0 1 0 0 0 0 0 1 0"
        ]
      ]) filter.append(svg("feDisplacementMap", {
        in: "SourceGraphic",
        in2: "field",
        scale: scale * factor,
        xChannelSelector: "R",
        yChannelSelector: "G",
        result: `${name}-ray`
      }), svg("feColorMatrix", {
        in: `${name}-ray`,
        type: "matrix",
        values,
        result: name
      }));
      filter.append(svg("feComposite", {
        in: "r",
        in2: "g",
        operator: "arithmetic",
        k2: 1,
        k3: 1,
        result: "rg"
      }), svg("feComposite", {
        in: "rg",
        in2: "b",
        operator: "arithmetic",
        k2: 1,
        k3: 1
      }));
    } else {
      if (zoom) filter.append(svg("feImage", {
        href: zoom.map,
        ...box,
        preserveAspectRatio: "none",
        result: "zoom"
      }), svg("feDisplacementMap", {
        in: "SourceGraphic",
        in2: "zoom",
        scale: zoom.scale,
        xChannelSelector: "R",
        yChannelSelector: "G",
        result: "magnified"
      }));
      filter.append(svg("feDisplacementMap", {
        in: zoom ? "magnified" : "SourceGraphic",
        in2: "field",
        scale,
        xChannelSelector: "R",
        yChannelSelector: "G",
        result: "bent"
      }), svg("feGaussianBlur", {
        in: "bent",
        stdDeviation: 0.4,
        result: "displaced"
      }), svg("feColorMatrix", {
        in: "displaced",
        type: "saturate",
        values: 1.5,
        result: "face"
      }));
      if (shape.saturation > 1) {
        const mask = svg("feComponentTransfer", {
          in: "shine",
          result: "mask"
        });
        mask.append(svg("feFuncA", {
          type: "linear",
          slope: 1.8
        }));
        filter.append(svg("feColorMatrix", {
          in: "displaced",
          type: "saturate",
          values: shape.saturation,
          result: "vivid"
        }), svg("feImage", {
          href: highlight,
          ...box,
          preserveAspectRatio: "none",
          result: "shine"
        }), mask, svg("feComposite", {
          in: "vivid",
          in2: "mask",
          operator: "in",
          result: "edge"
        }), svg("feBlend", {
          in: "edge",
          in2: "face",
          mode: "normal"
        }));
      }
    }
    if (lenses.size >= 50) {
      const oldestKey = lenses.keys().next().value;
      const oldest = lenses.get(oldestKey);
      if (oldest && oldest.filterNode && oldest.filterNode.parentNode) {
        oldest.filterNode.remove();
      }
      lenses.delete(oldestKey);
    }
    container().append(filter);
    const result = {
      filter: `url("#${id2}")`,
      rim: `url("${highlight}")`,
      filterNode: filter
    };
    lenses.set(key, result);
    return result;
  }
  function fit(element, selection, filtered) {
    const width = element.offsetWidth;
    const height = element.offsetHeight;
    if (!width || !height) return;
    const style = getComputedStyle(element);
    const corner = style.borderTopLeftRadius;
    const radius = Math.min(width / 2, height / 2, corner.endsWith("%") ? Math.min(width, height) * parseFloat(corner) / 100 : parseFloat(corner));
    const length = (name) => {
      const value = parseFloat(style.getPropertyValue(name));
      return Number.isFinite(value) ? value : void 0;
    };
    const { filter, rim } = lens(width, height, radius, selection, {
      bezel: length("--lg-bezel"),
      thickness: length("--lg-thickness"),
      level: length("--lg-refraction") ?? 1,
      zoom: Math.max(1, length("--lg-zoom") ?? 1),
      saturation: Math.max(1, length("--lg-rim-saturation") ?? 1)
    });
    if (filtered) element.style.setProperty("--lg-filter", filter);
    element.style.setProperty("--lg-rim", rim);
  }
  function whenIdle(callback) {
    if ("requestIdleCallback" in window) {
      const handle2 = requestIdleCallback(callback, { timeout: 500 });
      return () => cancelIdleCallback(handle2);
    }
    const handle = setTimeout(callback, 50);
    return () => clearTimeout(handle);
  }
  var refractsBackdrop = () => /Chrom(?:e|ium)\//.test(navigator.userAgent);
  const refractCallbacks = new WeakMap();
  let sharedRefractObserver = null;
  function getSharedRefractObserver() {
    if (!sharedRefractObserver && typeof ResizeObserver !== "undefined") {
      sharedRefractObserver = new ResizeObserver((entries) => {
        for (let i = 0; i < entries.length; i++) {
          const cb = refractCallbacks.get(entries[i].target);
          if (cb) cb();
        }
      });
    }
    return sharedRefractObserver;
  }

  function refract(element, selection, filtered) {
    let cancel;
    const onResize = () => {
      cancel?.();
      cancel = whenIdle(() => fit(element, selection, filtered));
    };
    refractCallbacks.set(element, onResize);
    const observer = getSharedRefractObserver();
    if (observer) observer.observe(element);
    return () => {
      cancel?.();
      if (observer) observer.unobserve(element);
      refractCallbacks.delete(element);
      element.style.removeProperty("--lg-filter");
      element.style.removeProperty("--lg-rim");
    };
  }
  function useRefraction(ref, selection = false) {
    useEffect(() => {
      const element = ref.current;
      if (!element) return;
      return refract(element, selection, refractsBackdrop());
    }, [ref, selection]);
  }
  var Button = /* @__PURE__ */ forwardRef(function Button2({ icon, variant = "glass", destructive, tint, children, className, style, type = "button", ...props }, forwardedRef) {
    const ref = useRef(null);
    useImperativeHandle(forwardedRef, () => ref.current);
    usePress(ref);
    useRefraction(ref);
    return /* @__PURE__ */ jsxs("button", {
      ref,
      type,
      className: cx("lg-glass lg-button", className),
      "data-icon": icon == null ? void 0 : children == null ? "only" : "",
      "data-variant": variant === "glass" ? void 0 : variant,
      "data-destructive": destructive ? "" : void 0,
      "data-tint": tint ? "" : void 0,
      style: tint ? {
        ...style,
        "--lg-tint": tint
      } : style,
      ...props,
      children: [icon, children]
    });
  });
  var Glass = /* @__PURE__ */ forwardRef(function Glass2({ className, ...props }, forwardedRef) {
    const ref = useRef(null);
    useImperativeHandle(forwardedRef, () => ref.current);
    useRefraction(ref);
    return /* @__PURE__ */ jsx("div", {
      ref,
      className: cx("lg-glass", className),
      ...props
    });
  });
  function useControllable(value, defaultValue, onChange) {
    const [uncontrolled, setUncontrolled] = useState(defaultValue);
    const controlled = value !== void 0;
    const handler = useRef(onChange);
    useEffect(() => {
      handler.current = onChange;
    });
    const set = useCallback((next) => {
      if (!controlled) setUncontrolled(next);
      handler.current?.(next);
    }, [controlled]);
    return [controlled ? value : uncontrolled, set];
  }
  var Input = /* @__PURE__ */ forwardRef(function Input2({ value: valueProp, defaultValue = "", onValueChange, icon, className, style, ...props }, forwardedRef) {
    const rootRef = useRef(null);
    const inputRef = useRef(null);
    const [value, setValue] = useControllable(valueProp, defaultValue, onValueChange);
    useImperativeHandle(forwardedRef, () => inputRef.current);
    useRefraction(rootRef);
    return /* @__PURE__ */ jsxs("div", {
      ref: rootRef,
      className: cx("lg-glass lg-input", className),
      style,
      onPointerDown: (event) => {
        if (event.target !== inputRef.current) inputRef.current?.focus();
      },
      children: [
        icon == null ? null : /* @__PURE__ */ jsx("span", {
          className: "lg-input-icon",
          children: icon
        }),
        /* @__PURE__ */ jsx("input", {
          ref: inputRef,
          value,
          onChange: (event) => setValue(event.currentTarget.value),
          ...props
        }),
        props.type === "search" && value && !props.disabled ? /* @__PURE__ */ jsx("button", {
          type: "button",
          className: "lg-input-clear",
          "aria-label": "Clear",
          onPointerDown: (event) => event.preventDefault(),
          onClick: () => {
            setValue("");
            inputRef.current?.focus();
          },
          children: /* @__PURE__ */ jsx("svg", {
            viewBox: "0 0 16 16",
            fill: "none",
            stroke: "currentColor",
            strokeWidth: 1.5,
            strokeLinecap: "round",
            "aria-hidden": true,
            children: /* @__PURE__ */ jsx("path", { d: "m4.5 4.5 7 7m0-7-7 7" })
          })
        }) : null
      ]
    });
  });
  var clamp$1 = (value) => Math.min(1, Math.max(0, value));
  var resistance = (value) => Math.sign(value) * 7 * (1 - Math.exp(-Math.abs(value) * 0.12 / 7));
  var ellipsis = /* @__PURE__ */ jsxs("svg", {
    viewBox: "0 0 16 16",
    fill: "currentColor",
    "aria-hidden": true,
    children: [
      /* @__PURE__ */ jsx("circle", {
        cx: "3",
        cy: "8",
        r: "1.4"
      }),
      /* @__PURE__ */ jsx("circle", {
        cx: "8",
        cy: "8",
        r: "1.4"
      }),
      /* @__PURE__ */ jsx("circle", {
        cx: "13",
        cy: "8",
        r: "1.4"
      })
    ]
  });
  function Menu({ items, "aria-label": label, icon = ellipsis, align = "end", className, style }) {
    const [phase, setPhase] = useState("closed");
    const triggerRef = useRef(null);
    const cardRef = useRef(null);
    const surfaceRef = useRef(null);
    const glyphRef = useRef(null);
    const contentRef = useRef(null);
    const plateRef = useRef(null);
    const morphRef = useRef(null);
    const latest = useRef(items);
    const mounted = phase !== "closed";
    useEffect(() => {
      latest.current = items;
    });
    useEffect(() => {
      if (phase === "open") morphRef.current?.set(1);
      if (phase === "leaving") morphRef.current?.set(0);
    }, [phase]);
    useEffect(() => {
      if (!mounted) return;
      const trigger = triggerRef.current;
      const card = cardRef.current;
      const surface = surfaceRef.current;
      const glyph = glyphRef.current;
      const content = contentRef.current;
      const plate = plateRef.current;
      const from = {
        width: trigger.offsetWidth,
        height: trigger.offsetHeight
      };
      const to = {
        width: card.offsetWidth,
        height: card.offsetHeight
      };
      const radius = parseFloat(getComputedStyle(surface).borderTopLeftRadius);
      const trailing = card.dataset.align !== "start";
      const origin = {
        x: trailing ? to.width - from.width / 2 : from.width / 2,
        y: from.height / 2
      };
      content.style.transformOrigin = `${origin.x}px ${origin.y}px`;
      glyph.style.width = `${from.width}px`;
      glyph.style.height = `${from.height}px`;
      let leaving = false;
      const shape = createSpring(0, 600, 46, (value) => {
        const t = clamp$1(value);
        const settled = t === 1;
        const width = from.width + (to.width - from.width) * t;
        const height = from.height + (to.height - from.height) * t;
        const scale2 = 0.5 + 0.5 * t;
        const local = (edge, centre) => centre + (edge - centre) / scale2;
        const left = local(trailing ? to.width - width : 0, origin.x);
        const right = local(trailing ? to.width : width, origin.x);
        const bottom = local(height, origin.y);
        const top = local(0, origin.y);
        surface.style.width = settled ? "" : `${width}px`;
        surface.style.height = settled ? "" : `${height}px`;
        surface.style.opacity = String(clamp$1(t / 0.2));
        trigger.style.opacity = t === 0 ? "" : String(1 - clamp$1(t / 0.2));
        const drift = 0.3 * t;
        const dx = ((trailing ? to.width - width / 2 : width / 2) - origin.x) * drift;
        const dy = (height / 2 - origin.y) * drift;
        glyph.style.opacity = String(1 - clamp$1(t / 0.45));
        glyph.style.transform = `translate(${dx}px, ${dy}px) scale(${1 + 0.6 * t})`;
        glyph.style.filter = `blur(${8 * t}px)`;
        content.style.opacity = String(leaving ? clamp$1((t - 0.55) / 0.45) : clamp$1((t - 0.15) / 0.6));
        content.style.transform = settled ? "" : `scale(${scale2})`;
        content.style.filter = settled ? "" : `blur(${6 * (1 - t)}px)`;
        content.style.clipPath = settled ? "" : `inset(${top}px ${to.width - right}px ${to.height - bottom}px ${left}px round ${radius / scale2}px)`;
        if (leaving && value === 0) setPhase("closed");
      });
      const morph = {
        ...shape,
        set(target, instant) {
          leaving = target === 0;
          if (leaving) shape.tune(900, 57);
          else shape.tune(600, 46);
          shape.set(target, instant);
        }
      };
      morphRef.current = morph;
      shape.paint();
      morph.set(1);
      const rows = () => [...card.querySelectorAll(".lg-menu-item:not(:disabled)")];
      rows()[0]?.focus({ preventScroll: true });
      const offset = {
        scale: 1,
        x: 0,
        y: 0
      };
      const paint = () => {
        card.style.scale = String(offset.scale);
        card.style.translate = `${offset.x}px ${offset.y}px`;
      };
      const scale = createSpring(1, 650, 36, (value) => {
        offset.scale = value;
        paint();
      });
      const x = createSpring(0, 600, 30, (value) => {
        offset.x = value;
        paint();
      });
      const y = createSpring(0, 600, 30, (value) => {
        offset.y = value;
        paint();
      });
      let gesture = null;
      let current = null;
      let suppressClickUntil = 0;
      const close = (restoreFocus = true) => {
        setPhase("leaving");
        if (restoreFocus) triggerRef.current?.focus({ preventScroll: true });
      };
      const highlight = (row) => {
        if (current === row) return;
        const first = !current;
        current = row;
        if (!row) {
          delete card.dataset.scrubbing;
          plate.style.opacity = "0";
          return;
        }
        card.dataset.scrubbing = "";
        plate.style.width = `${row.offsetWidth}px`;
        plate.style.height = `${row.offsetHeight}px`;
        if (first) plate.style.transition = "none";
        plate.style.transform = `translate(${row.offsetLeft}px, ${row.offsetTop}px)`;
        plate.style.opacity = "1";
        if (first) {
          plate.offsetWidth;
          plate.style.transition = "";
        }
      };
      let selectHandled = false;
      const rowAt = (clientX, clientY) => {
        const root = (card && card.getRootNode) ? card.getRootNode() : document;
        const target = (root && root.elementFromPoint) ? root.elementFromPoint(clientX, clientY) : document.elementFromPoint(clientX, clientY);
        const row = target?.closest(".lg-menu-item");
        return row && !row.disabled && card.contains(row) ? row : null;
      };
      const down = (event) => {
        if (!event.isPrimary || event.button !== 0) return;
        gesture = {
          id: event.pointerId,
          x: event.clientX,
          y: event.clientY
        };
        card.setPointerCapture(event.pointerId);
        card.dataset.pressed = "";
        scale.set(1 + 5 / Math.max(card.offsetWidth, card.offsetHeight, 200));
        highlight(rowAt(event.clientX, event.clientY));
      };
      const move = (event) => {
        if (!gesture) {
          const row = event.pointerType === "mouse" ? rowAt(event.clientX, event.clientY) : null;
          if (row) highlight(row);
          return;
        }
        if (event.pointerId !== gesture.id) return;
        highlight(rowAt(event.clientX, event.clientY));
        x.set(resistance(event.clientX - gesture.x), true);
        y.set(resistance(event.clientY - gesture.y), true);
      };
      const end = (event) => {
        if (event.pointerId !== gesture?.id) return;
        const chosen = event.type === "pointerup" ? rowAt(event.clientX, event.clientY) : null;
        highlight(null);
        gesture = null;
        delete card.dataset.pressed;
        scale.set(1);
        x.set(0);
        y.set(0);
        suppressClickUntil = performance.now() + 500;
        if (chosen) {
          selectHandled = true;
          const item = latest.current[Number(chosen.dataset.index)];
          if (item && item !== "separator") {
            close();
            item.onSelect?.();
          }
        }
      };
      const leave = (event) => {
        if (!gesture && event.pointerType === "mouse") highlight(null);
      };
      const click = (event) => {
        if (selectHandled) {
          selectHandled = false;
          return;
        }
        const row = event.target.closest(".lg-menu-item");
        if (!row) return;
        const item = latest.current[Number(row.dataset.index)];
        if (!item || item === "separator") return;
        close();
        item.onSelect?.();
      };
      const key = (event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          close();
        } else if (event.key === "Tab") close(false);
        else if ([
          "ArrowDown",
          "ArrowUp",
          "Home",
          "End"
        ].includes(event.key)) {
          event.preventDefault();
          if (!gesture) highlight(null);
          const list = rows();
          const index = list.indexOf(((card.getRootNode && card.getRootNode().activeElement) || document.activeElement));
          list[event.key === "Home" ? 0 : event.key === "End" ? list.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + list.length) % list.length]?.focus();
        }
      };
      const outside = (event) => {
        const path = typeof event.composedPath === "function" ? event.composedPath() : [event.target];
        if (card && path.includes(card)) return;
        if (triggerRef.current && path.includes(triggerRef.current)) return;
        close(false);
      };
      card.addEventListener("pointerdown", down);
      card.addEventListener("pointermove", move);
      card.addEventListener("pointerleave", leave);
      card.addEventListener("pointerup", end);
      card.addEventListener("pointercancel", end);
      card.addEventListener("lostpointercapture", end);
      card.addEventListener("click", click);
      card.addEventListener("keydown", key);
      document.addEventListener("pointerdown", outside, true);
      return () => {
        [
          shape,
          scale,
          x,
          y
        ].forEach((spring) => spring.stop());
        morphRef.current = null;
        trigger.style.opacity = "";
        card.removeEventListener("pointerdown", down);
        card.removeEventListener("pointermove", move);
        card.removeEventListener("pointerleave", leave);
        card.removeEventListener("pointerup", end);
        card.removeEventListener("pointercancel", end);
        card.removeEventListener("lostpointercapture", end);
        card.removeEventListener("click", click);
        card.removeEventListener("keydown", key);
        document.removeEventListener("pointerdown", outside, true);
      };
    }, [mounted]);
    const open = phase === "open";
    return /* @__PURE__ */ jsxs("div", {
      className: cx("lg-menu", className, open && "lg-menu--open", mounted && "lg-menu--active"),
      "data-phase": phase,
      "data-open": open ? "true" : undefined,
      style,
      children: [/* @__PURE__ */ jsx(Button, {
        ref: triggerRef,
        icon,
        "aria-label": label,
        "aria-haspopup": "menu",
        "aria-expanded": open,
        onClick: () => setPhase(open ? "leaving" : "open")
      }), mounted ? /* @__PURE__ */ jsxs("div", {
        ref: cardRef,
        role: "menu",
        "aria-label": label,
        className: "lg-menu-card",
        "data-phase": phase,
        "data-align": align,
        children: [
          /* @__PURE__ */ jsx("span", {
            ref: surfaceRef,
            className: "lg-menu-surface",
            "aria-hidden": true
          }),
          /* @__PURE__ */ jsx("span", {
            ref: glyphRef,
            className: "lg-menu-glyph",
            "aria-hidden": true,
            children: icon
          }),
          /* @__PURE__ */ jsxs("div", {
            ref: contentRef,
            role: "none",
            className: "lg-menu-content",
            children: [/* @__PURE__ */ jsx("span", {
              ref: plateRef,
              className: "lg-menu-plate",
              "aria-hidden": true
            }), items.map((item, index) => item === "separator" ? /* @__PURE__ */ jsx("div", {
              role: "separator",
              className: "lg-menu-separator"
            }, index) : /* @__PURE__ */ jsxs("button", {
              type: "button",
              role: "menuitem",
              className: "lg-menu-item",
              "data-index": index,
              "data-destructive": item.destructive ? "" : void 0,
              disabled: item.disabled,
              children: [item.icon, item.label]
            }, index))]
          })
        ]
      }) : null]
    });
  }
  var magnifier = /* @__PURE__ */ jsxs("svg", {
    viewBox: "0 0 16 16",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.5,
    strokeLinecap: "round",
    "aria-hidden": true,
    children: [/* @__PURE__ */ jsx("circle", {
      cx: "7",
      cy: "7",
      r: "4.75"
    }), /* @__PURE__ */ jsx("path", { d: "m10.5 10.5 3.25 3.25" })]
  });
  var SearchField = /* @__PURE__ */ forwardRef(function SearchField2({ icon = magnifier, placeholder = "Search", ...props }, ref) {
    return /* @__PURE__ */ jsx(Input, {
      ref,
      type: "search",
      icon,
      placeholder,
      ...props
    });
  });
  var Slider = /* @__PURE__ */ forwardRef(function Slider2({ value: valueProp, defaultValue, onValueChange, min = 0, max = 100, step = 1, className, style, ...props }, forwardedRef) {
    const inputRef = useRef(null);
    const thumbRef = useRef(null);
    const faceRef = useRef(null);
    const [value, setValue] = useControllable(valueProp, defaultValue ?? min, onValueChange);
    const progress = max > min ? Math.min(1, Math.max(0, (value - min) / (max - min))) : 0;
    useImperativeHandle(forwardedRef, () => inputRef.current);
    useEffect(() => {
      const input = inputRef.current;
      const thumb = thumbRef.current;
      const face = faceRef.current;
      const lift = createSpring(0, 2e3, 80, (amount) => {
        thumb.style.scale = String(0.6 + 0.4 * amount);
        face.style.opacity = String(1 - 0.85 * Math.min(1, Math.max(0, amount)));
      });
      const hold = () => {
        if (!input.disabled) lift.set(1);
      };
      const release = () => lift.set(0);
      const ends = [
        "pointerup",
        "pointercancel",
        "lostpointercapture",
        "blur"
      ];
      input.addEventListener("pointerdown", hold);
      ends.forEach((type) => input.addEventListener(type, release));
      window.addEventListener("pointerup", release);
      return () => {
        lift.stop();
        input.removeEventListener("pointerdown", hold);
        ends.forEach((type) => input.removeEventListener(type, release));
        window.removeEventListener("pointerup", release);
      };
    }, []);
    return /* @__PURE__ */ jsxs("div", {
      className: cx("lg-slider", className),
      style: {
        ...style,
        "--lg-progress": progress
      },
      children: [
        /* @__PURE__ */ jsx("span", {
          className: "lg-slider-track",
          "aria-hidden": true,
          children: /* @__PURE__ */ jsx("span", { className: "lg-slider-fill" })
        }),
        /* @__PURE__ */ jsx("span", {
          ref: thumbRef,
          className: "lg-slider-thumb",
          "aria-hidden": true,
          children: /* @__PURE__ */ jsx("span", {
            ref: faceRef,
            className: "lg-thumb-face"
          })
        }),
        /* @__PURE__ */ jsx("input", {
          ref: inputRef,
          type: "range",
          min,
          max,
          step,
          value,
          onChange: (event) => setValue(event.currentTarget.valueAsNumber),
          ...props
        })
      ]
    });
  });
  var held = (at, moved) => moved || performance.now() - at >= 150;
  var TRAVEL = 21.7125;
  var unit = (value) => Math.min(1, Math.max(0, value));
  var Switch = /* @__PURE__ */ forwardRef(function Switch2({ checked: checkedProp, defaultChecked = false, onCheckedChange, className, ...props }, forwardedRef) {
    const ref = useRef(null);
    const fillRef = useRef(null);
    const thumbRef = useRef(null);
    const faceRef = useRef(null);
    const [checked, setChecked] = useControllable(checkedProp, defaultChecked, onCheckedChange);
    const travel = TRAVEL;
    const latest = useRef({
      checked,
      setChecked,
      travel
    });
    const springs = useRef(null);
    useImperativeHandle(forwardedRef, () => ref.current);
    useEffect(() => {
      latest.current = {
        checked,
        setChecked,
        travel
      };
      springs.current?.position.set(checked ? 1 : 0);
      springs.current?.color.set(checked ? 1 : 0);
    }, [
      checked,
      setChecked,
      travel
    ]);
    useEffect(() => {
      springs.current?.position.paint();
    }, [travel]);
    useEffect(() => {
      const el = ref.current;
      const fill = fillRef.current;
      const thumb = thumbRef.current;
      const face = faceRef.current;
      let x = 0;
      let scale = 0.65;
      const paint = () => {
        thumb.style.transform = `translate(${x}px, -50%) scale(${scale})`;
      };
      const initial = latest.current.checked ? 1 : 0;
      const position = createSpring(initial, 1e3, 80, (value) => {
        x = value * latest.current.travel;
        paint();
      });
      const color = createSpring(initial, 1e3, 80, (value) => {
        fill.style.opacity = String(unit(value));
      });
      const lift = createSpring(0, 2e3, 80, (value) => {
        scale = 0.65 + 0.25 * value;
        face.style.opacity = String(1 - 0.85 * unit(value));
        paint();
      });
      springs.current = {
        position,
        color
      };
      position.paint();
      color.paint();
      lift.paint();
      let gesture = null;
      let ignoreClick = false;
      const sync = () => {
        position.set(latest.current.checked ? 1 : 0);
        color.set(latest.current.checked ? 1 : 0);
      };
      const settle = (next) => {
        const old = gesture;
        gesture = null;
        lift.set(0);
        if (old && el.hasPointerCapture(old.id)) el.releasePointerCapture(old.id);
        if (next === void 0 || next === latest.current.checked) return sync();
        latest.current.setChecked(next);
        requestAnimationFrame(sync);
      };
      const down = (event) => {
        if (!event.isPrimary || event.button !== 0 || el.disabled) return;
        event.preventDefault();
        ignoreClick = false;
        gesture = {
          id: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          from: latest.current.checked ? 1 : 0,
          moved: false,
          at: performance.now(),
          box: el.getBoundingClientRect()
        };
        el.setPointerCapture(event.pointerId);
        lift.set(1);
      };
      const move = (event) => {
        if (event.pointerId !== gesture?.id) return;
        const dx = event.clientX - gesture.x;
        const dy = Math.abs(event.clientY - gesture.y);
        if (!held(gesture.at, gesture.moved) && dy > 10 && dy > Math.abs(dx) + 4) {
          ignoreClick = true;
          return settle();
        }
        if (!gesture.moved && Math.abs(dx) < 4) return;
        gesture.moved = true;
        const value = gesture.from + dx / latest.current.travel;
        const overshoot = value < 0 ? value : value > 1 ? value - 1 : 0;
        position.set(unit(value) + overshoot / 22);
        color.set(value > 0.5 ? 1 : 0);
      };
      const up = (event) => {
        if (event.pointerId !== gesture?.id) return;
        ignoreClick = true;
        const { from, x: x2, moved, box } = gesture;
        const value = from + (event.clientX - x2) / latest.current.travel;
        const near = event.clientY >= box.top - 24 && event.clientY <= box.bottom + 24;
        settle(moved ? value > 0.5 : near ? !latest.current.checked : void 0);
      };
      const keep = (event) => {
        if (gesture && event.cancelable && held(gesture.at, gesture.moved)) event.preventDefault();
      };
      const cancel = () => {
        if (!gesture) return;
        ignoreClick = true;
        settle();
      };
      const click = () => {
        if (ignoreClick) ignoreClick = false;
        else if (!el.disabled) latest.current.setChecked(!latest.current.checked);
      };
      el.addEventListener("pointerdown", down);
      el.addEventListener("pointermove", move);
      el.addEventListener("pointerup", up);
      el.addEventListener("pointercancel", cancel);
      el.addEventListener("lostpointercapture", cancel);
      el.addEventListener("touchmove", keep, { passive: false });
      el.addEventListener("click", click);
      return () => {
        springs.current = null;
        [
          position,
          color,
          lift
        ].forEach((spring) => spring.stop());
        el.removeEventListener("pointerdown", down);
        el.removeEventListener("pointermove", move);
        el.removeEventListener("pointerup", up);
        el.removeEventListener("pointercancel", cancel);
        el.removeEventListener("lostpointercapture", cancel);
        el.removeEventListener("touchmove", keep);
        el.removeEventListener("click", click);
      };
    }, []);
    return /* @__PURE__ */ jsxs("button", {
      ref,
      type: "button",
      role: "switch",
      "aria-checked": checked,
      className: cx("lg-switch", className),
      ...props,
      children: [/* @__PURE__ */ jsx("span", {
        ref: fillRef,
        className: "lg-switch-fill",
        "aria-hidden": true
      }), /* @__PURE__ */ jsx("span", {
        ref: thumbRef,
        className: "lg-switch-thumb",
        "aria-hidden": true,
        children: /* @__PURE__ */ jsx("span", {
          ref: faceRef,
          className: "lg-thumb-face"
        })
      })]
    });
  });
  var clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  var keys = [
    "ArrowLeft",
    "ArrowRight",
    "Home",
    "End"
  ];
  var REST = [
    1024,
    58.9,
    676,
    47.8
  ];
  var DRAG = [
    2500,
    94,
    576,
    44.2
  ];
  function attach({ bar, glass, lens: lens2, tint, row }, select) {
    const tabs = [...bar.querySelectorAll(".lg-tab")];
    let slot = 0;
    let height = 0;
    let growX = 16;
    let growY = 12;
    let active = -1;
    let shown = false;
    let settleFrame = 0;
    let gesture = null;
    const state = {
      x: 0,
      lift: 0
    };
    const measure = () => {
      const style = getComputedStyle(bar);
      slot = (bar.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)) / tabs.length;
      height = lens2.offsetHeight;
      growX = parseFloat(style.getPropertyValue("--lg-lens-grow-x")) || 0;
      growY = parseFloat(style.getPropertyValue("--lg-lens-grow-y")) || 0;
    };
    const paint = () => {
      const { x: x2, lift: lift2 } = state;
      const sx = 1 + growX / slot * lift2;
      const sy = 1 + growY / height * lift2;
      lens2.style.transform = tint.style.transform = `translateX(${x2}px) scale(${sx}, ${sy})`;
      row.style.transform = `scale(${1 / sx}, ${1 / sy}) translate(${-x2 + (sx - 1) * slot / 2}px, ${(sy - 1) * height / 2}px)`;
      if (!gesture && lift2 < 0.01) delete bar.dataset.refracting;
    };
    const x = createSpring(0, REST[0], REST[1], (value) => {
      state.x = value;
      paint();
    });
    const lift = createSpring(0, REST[2], REST[3], (value) => {
      state.lift = value;
      paint();
    });
    const move = (target, lifted, instant = false) => {
      const [slideStiffness, slideDamping, liftStiffness, liftDamping] = gesture ? DRAG : REST;
      x.tune(slideStiffness, slideDamping);
      lift.tune(liftStiffness, liftDamping);
      x.set(target, instant);
      lift.set(lifted ? 1 : 0, instant);
    };
    const settle = (instant = false) => {
      if (gesture) return;
      const show = active >= 0;
      if (show) delete bar.dataset.hidden;
      else bar.dataset.hidden = "";
      if (show) move(active * slot, false, instant || !shown);
      shown = show;
    };
    const position = (event) => clamp(gesture.anchor + event.clientX - gesture.x, 0, slot * (tabs.length - 1));
    const light = (event, box) => {
      glass.style.setProperty("--lg-x", `${clamp((event.clientX - box.left) / box.width * 100, 0, 100)}%`);
      lens2.style.setProperty("--lg-x", `${clamp((event.clientX - box.left - 4 - state.x) / slot * 100, 0, 100)}%`);
    };
    const release = () => {
      const old = gesture;
      gesture = null;
      delete bar.dataset.lifted;
      delete lens2.dataset.pressed;
      if (old && bar.hasPointerCapture(old.id)) bar.releasePointerCapture(old.id);
      return old;
    };
    let suppressClick = false;
    const onPointerDown = (event) => {
      const tab = event.target.closest(".lg-tab");
      if (!event.isPrimary || event.button !== 0 || gesture || !tab) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      cancelAnimationFrame(settleFrame);
      settleFrame = 0;
      measure();
      const box = bar.getBoundingClientRect();
      gesture = {
        id: event.pointerId,
        x: event.clientX,
        anchor: tabs.indexOf(tab) * slot,
        moved: false,
        box,
        at: performance.now()
      };
      suppressClick = false;
      bar.dataset.lifted = "";
      bar.dataset.refracting = "";
      delete bar.dataset.hidden;
      lens2.dataset.pressed = "";
      light(event, box);
      move(gesture.anchor, true, !shown);
      shown = true;
    };
    const onPointerMove = (event) => {
      if (event.pointerId !== gesture?.id) return;
      if (!gesture.moved && Math.abs(event.clientX - gesture.x) > 6) {
        gesture.moved = true;
        bar.setPointerCapture(event.pointerId);
      }
      if (gesture.moved) move(position(event), true);
      light(event, gesture.box);
    };
    const onPointerEnd = (event) => {
      if (event.pointerId !== gesture?.id) return;
      if (event.type === "lostpointercapture" && event.target !== bar) return;
      const index = Math.round(position(event) / slot);
      const { moved, box } = release();
      const near = event.clientY >= box.top - 24 && event.clientY <= box.bottom + 24;
      if (event.type === "pointerup" && (moved || near)) {
        suppressClick = true;
        settleFrame = requestAnimationFrame(() => {
          settleFrame = 0;
          settle();
        });
        tabs[index]?.click();
      } else {
        suppressClick = moved;
        settle();
      }
    };
    const onTouchMove = (event) => {
      if (gesture && event.cancelable && held(gesture.at, gesture.moved)) event.preventDefault();
    };
    const onClick = (event) => {
      if (event.isTrusted && suppressClick && event.detail !== 0) {
        suppressClick = false;
        event.preventDefault();
        return;
      }
      const tab = event.target.closest(".lg-tab");
      if (!tab || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const index = tabs.indexOf(tab);
      if (tab instanceof HTMLAnchorElement) {
        active = index;
        settle();
      }
      select(index);
    };
    const onKeyDown = (event) => {
      const tab = event.target.closest(".lg-tab");
      if (!tab || tab instanceof HTMLAnchorElement || !keys.includes(event.key)) return;
      event.preventDefault();
      const current = tabs.indexOf(tab);
      const index = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (current + (event.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length;
      select(index);
      tabs[index]?.focus();
    };
    const reset = () => {
      cancelAnimationFrame(settleFrame);
      settleFrame = 0;
      release();
      settle(true);
    };
    const onVisibilityChange = () => {
      if (document.hidden) reset();
    };
    const observer = new ResizeObserver(() => {
      measure();
      if (!gesture) settle(true);
    });
    measure();
    bar.dataset.ready = "";
    bar.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerEnd);
    window.addEventListener("pointercancel", onPointerEnd);
    bar.addEventListener("lostpointercapture", onPointerEnd);
    bar.addEventListener("touchmove", onTouchMove, { passive: false });
    bar.addEventListener("click", onClick, true);
    bar.addEventListener("keydown", onKeyDown);
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("blur", reset);
    observer.observe(bar);
    return {
      setActive(index) {
        cancelAnimationFrame(settleFrame);
        settleFrame = 0;
        active = index;
        settle();
      },
      destroy() {
        cancelAnimationFrame(settleFrame);
        x.stop();
        lift.stop();
        observer.disconnect();
        for (const key of [
          "ready",
          "hidden",
          "lifted",
          "refracting"
        ]) delete bar.dataset[key];
        bar.removeEventListener("pointerdown", onPointerDown);
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", onPointerEnd);
        window.removeEventListener("pointercancel", onPointerEnd);
        bar.removeEventListener("lostpointercapture", onPointerEnd);
        bar.removeEventListener("touchmove", onTouchMove);
        bar.removeEventListener("click", onClick, true);
        bar.removeEventListener("keydown", onKeyDown);
        document.removeEventListener("visibilitychange", onVisibilityChange);
        window.removeEventListener("blur", reset);
      }
    };
  }
  function TabBar({ items, value: valueProp, defaultValue = null, onValueChange, link: Link = "a", className, style, ...props }) {
    const barRef = useRef(null);
    const glassRef = useRef(null);
    const lensRef = useRef(null);
    const tintRef = useRef(null);
    const rowRef = useRef(null);
    const controller = useRef(null);
    const [value, setValue] = useControllable(valueProp, defaultValue, onValueChange);
    const selected = items.findIndex((item) => item.value === value);
    const latest = useRef({
      items,
      selected,
      setValue
    });
    const signature = items.map((item) => item.value).join("\n");
    const navigation = items.every((item) => item.href !== void 0);
    useRefraction(glassRef);
    useRefraction(lensRef, true);
    useEffect(() => {
      latest.current = {
        items,
        selected,
        setValue
      };
    });
    useEffect(() => {
      const instance = attach({
        bar: barRef.current,
        glass: glassRef.current,
        lens: lensRef.current,
        tint: tintRef.current,
        row: rowRef.current
      }, (index) => {
        const item = latest.current.items[index];
        if (item) latest.current.setValue(item.value);
      });
      instance.setActive(latest.current.selected);
      controller.current = instance;
      return () => {
        instance.destroy();
        controller.current = null;
      };
    }, [signature]);
    useLayoutEffect(() => {
      controller.current?.setActive(selected);
    }, [selected]);
    return /* @__PURE__ */ jsxs("div", {
      ref: barRef,
      role: navigation ? "navigation" : "tablist",
      className: cx("lg-tab-bar", className),
      style: {
        ...style,
        "--lg-index": Math.max(selected, 0),
        "--lg-tabs": items.length
      },
      ...props,
      children: [
        /* @__PURE__ */ jsx("span", {
          ref: glassRef,
          className: "lg-glass lg-tab-bar-glass",
          "aria-hidden": true
        }),
        items.map((item, index) => item.href !== void 0 ? /* @__PURE__ */ jsx(Link, {
          href: item.href,
          className: "lg-tab",
          "data-selected": index === selected ? "" : void 0,
          "aria-current": index === selected ? "page" : void 0,
          draggable: false,
          children: item.label
        }, item.value) : /* @__PURE__ */ jsx("button", {
          type: "button",
          role: "tab",
          className: "lg-tab",
          "data-selected": index === selected ? "" : void 0,
          "aria-selected": index === selected,
          tabIndex: index === selected || selected < 0 && index === 0 ? 0 : -1,
          children: item.label
        }, item.value)),
        /* @__PURE__ */ jsx("span", {
          ref: tintRef,
          className: "lg-tab-tint",
          "aria-hidden": true,
          children: /* @__PURE__ */ jsx("span", {
            ref: rowRef,
            className: "lg-tab-row",
            children: items.map((item) => /* @__PURE__ */ jsx("span", {
              className: "lg-tab-copy",
              children: item.label
            }, item.value))
          })
        }),
        /* @__PURE__ */ jsx("span", {
          ref: lensRef,
          className: "lg-glass lg-tab-lens",
          "aria-hidden": true
        })
      ]
    });
  }
  return __toCommonJS(entry_exports);
})();


// ============================================================
    // REACT COMPONENTS POWERED BY GLISSE (https://glisse.kelvinzhang.com/)
    // ============================================================
    const html = (typeof htm !== 'undefined' && typeof React !== 'undefined')
        ? htm.bind(React.createElement)
        : null;

    // Modal Compound Component (Glisse Liquid Glass Window)
    const Modal = ({ isOpen, isClosing, onClose, children }) => {
        if (!isOpen && !isClosing) return null;
        return children;
    };
    Modal.Backdrop = ({ isClosing, onClose, isDraggable, children }) => html`
        <div 
            id="__ul-settings-overlay"
            data-glisse-backdrop=""
            className=${`modal__backdrop ${isClosing ? 'modal__backdrop--closing' : ''} ${isDraggable ? 'modal__backdrop--draggable' : ''}`}
            onClick=${(e) => {
                if (!isDraggable && e.target && e.target.id === '__ul-settings-overlay') onClose();
            }}
        >
            ${children}
        </div>
    `;
    Modal.Container = ({ isDraggable, children }) => html`
        <div className=${`modal__container ${isDraggable ? 'modal__container--draggable' : ''}`}>
            ${children}
        </div>
    `;
    Modal.Dialog = ({ isDraggable, style, dialogRef, children }) => html`
        <div 
            ref=${dialogRef}
            className=${`modal__dialog ${isDraggable ? 'modal__dialog--draggable' : ''}`} 
            role="dialog" 
            aria-modal=${isDraggable ? 'false' : 'true'}
            style=${style}
            onClick=${(e) => e.stopPropagation()}
        >
            ${children}
        </div>
    `;
    Modal.Header = ({ isDraggable, isDragging, onPointerDown, children }) => html`
        <header 
            className=${`modal__header ${isDraggable ? 'modal__header--draggable' : ''} ${isDragging ? 'modal__header--dragging' : ''}`}
            onPointerDown=${onPointerDown}
        >
            ${children}
        </header>
    `;
    Modal.Icon = ({ children }) => html`<div className="modal__icon">${children}</div>`;
    Modal.Heading = ({ children }) => html`<div className="modal__title-box"><h2 className="modal__heading">${children}</h2></div>`;
    Modal.Body = ({ children }) => html`
        <div className="modal__body">
            ${children}
        </div>
    `;

    // Tabs Compound Component
    const Tabs = ({ children }) => html`<div className="tabs">${children}</div>`;
    Tabs.Panel = React.memo(({ id, activeTab, children }) => {
        const isActive = id === activeTab;
        return html`
            <div 
                className="tabs__panel" 
                data-tab=${id} 
                data-active=${isActive ? 'true' : undefined}
                style=${isActive ? {} : { display: 'none' }}
            >
                ${children}
            </div>
        `;
    });

    // Switch Row Component with Glisse Liquid Glass Switch
    const Switch = React.memo(({ isSelected, onChange, disabled, isDisabled, size = 'md', className = '', children, onClick }) => {
        const effectiveChecked = Boolean(isSelected);
        const effectiveDisabled = Boolean(disabled || isDisabled);

        const handleToggle = (nextVal) => {
            if (effectiveDisabled) return;
            if (onChange) onChange(typeof nextVal === 'boolean' ? nextVal : !effectiveChecked);
        };

        return html`
            <div 
                className=${`field-switch-row ${className}`.trim()} 
                data-selected=${effectiveChecked ? 'true' : 'false'}
                data-disabled=${effectiveDisabled ? 'true' : undefined}
                onClick=${(e) => {
                    if (onClick) onClick(e);
                    else handleToggle(!effectiveChecked);
                }}
            >
                <div className="field-switch-content">
                    ${children}
                </div>
                <div onClick=${(e) => e.stopPropagation()} style=${{ display: 'inline-flex', flexShrink: 0 }}>
                    <${Glisse.Switch}
                        checked=${effectiveChecked}
                        onCheckedChange=${handleToggle}
                        disabled=${effectiveDisabled}
                    />
                </div>
            </div>
        `;
    });
    Switch.Label = ({ children }) => html`<div data-slot="label">${children}</div>`;
    Switch.Description = ({ children }) => html`<div data-slot="description">${children}</div>`;

    // FieldRow Component (Clean Uniform Box)
    const FieldRow = React.memo(({ className = '', style = {}, onClick, children, ...restProps }) => html`
        <div
            className=${`field-row ${className}`.trim()}
            style=${style}
            onClick=${onClick}
            ...${restProps}
        >
            ${children}
        </div>
    `);

    // Card Compound Component (Clean Uniform Card)
    const Card = React.memo(({ variant = 'secondary', className = '', children }) => html`
        <div className=${`card card--${variant} ${className}`.trim()}>${children}</div>
    `);
    Card.Header = ({ className = '', children }) => html`<div className=${`card__header ${className}`.trim()}>${children}</div>`;
    Card.Title = ({ className = '', children }) => html`<div className=${`card__title ${className}`.trim()}>${children}</div>`;
    Card.Description = ({ className = '', children }) => html`<div className=${`card__description ${className}`.trim()}>${children}</div>`;
    Card.Content = ({ className = '', children }) => html`<div className=${`card__content ${className}`.trim()}>${children}</div>`;

    // Badge Component
    const Badge = React.memo(({ size = 'sm', variant = 'primary', color = '', className = '', children }) => html`
        <span className=${`badge badge--${size} badge--${variant} ${color ? `badge--${color}` : ''} ${className}`}>
            ${children}
        </span>
    `);

    // GlisseSelect Component (Powered by official Kelvin Zhang Glisse.Menu)
    const GlisseSelect = React.memo(({ options, selectedKey, onSelectionChange, ariaLabel = "Options", align = "end" }) => {
        const selectedOption = (options && options.find(o => o.id === selectedKey)) || (options && options[0]) || { label: '' };
        const triggerIcon = html`
            <span className="lg-select-trigger-content">
                <span className="lg-select-current-label">${selectedOption.label}</span>
                <svg className="lg-select-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m6 9 6 6 6-6"/>
                </svg>
            </span>
        `;

        const menuItems = (options || []).map((opt) => {
            const isSelected = opt.id === selectedKey;
            return {
                label: html`
                    <span className="lg-select-item-inner">
                        <span className="lg-select-item-text">
                            <span className="lg-select-item-title">${opt.label}</span>
                            ${opt.desc ? html`<span className="lg-select-item-desc">${opt.desc}</span>` : null}
                        </span>
                        ${isSelected ? html`
                            <svg className="lg-select-item-check" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="20 6 9 17 4 12"></polyline>
                            </svg>
                        ` : null}
                    </span>
                `,
                onSelect: () => {
                    if (onSelectionChange) onSelectionChange(opt.id);
                }
            };
        });

        return html`
            <${Glisse.Menu}
                className="lg-menu-select"
                items=${menuItems}
                aria-label=${ariaLabel}
                icon=${triggerIcon}
                align=${align}
            />
        `;
    });

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

    // Glisse Slider Wrapper
    const Slider = React.memo(({
        value,
        defaultValue = 0,
        minValue = 0,
        maxValue = 100,
        step = 1,
        isDisabled = false,
        disabled = false,
        onChange,
        className = '',
        children,
    }) => {
        const curVal = typeof value !== 'undefined' ? value : defaultValue;
        const effectiveDisabled = Boolean(isDisabled || disabled);

        return html`
            <div className=${`field-slider-wrapper ${className}`.trim()} data-disabled=${effectiveDisabled ? 'true' : undefined}>
                <${Glisse.Slider}
                    value=${curVal}
                    min=${minValue}
                    max=${maxValue}
                    step=${step}
                    disabled=${effectiveDisabled}
                    onValueChange=${(val) => {
                        if (onChange) onChange(val);
                    }}
                />
                <span className="slider__output">
                    ${Math.round((curVal <= 1 && maxValue <= 1) ? curVal * 100 : curVal)}%
                </span>
            </div>
        `;
    });

    // ServiceTile with Glisse Liquid Glass Switch
    const ServiceTile = React.memo(({ serviceKey, service, isChecked, onToggle }) => {
        return html`
            <div 
                className="service-tile"
                data-checked=${isChecked ? 'true' : 'false'}
                onClick=${() => onToggle(serviceKey)}
            >
                <span className="service-tile__label" title=${service.label}>
                    ${service.label}
                </span>
                <div onClick=${(e) => e.stopPropagation()} style=${{ display: 'inline-flex', flexShrink: 0 }}>
                    <${Glisse.Switch}
                        checked=${isChecked}
                        onCheckedChange=${() => onToggle(serviceKey)}
                    />
                </div>
            </div>
        `;
    });

    const StatusPill = React.memo(({ currentSettings, currentStats, accumulatedBonus, onToggleBoost, onOpenSettings }) => {
        if (currentSettings.keybindAction === 'open-modal' || !currentSettings.pillVisible) return null;
        const mode = currentSettings.pillMode || 'minimal';
        const isMinimal = mode === 'minimal';
        const isCompact = mode === 'compact';
        const isFull    = mode === 'full';
        const enabled   = currentSettings.timeBoostEnabled;

        const pos = POSITION_STYLES[currentSettings.pillPosition] || POSITION_STYLES['bottom-right'];
        const pillStyle = Object.assign({}, pos, {
            opacity: String(currentSettings.pillOpacity),
            display: 'flex',
            width: isMinimal ? '44px' : 'auto',
            height: isMinimal ? '44px' : '38px',
            borderRadius: isMinimal ? '22px' : '19px',
            background: isMinimal ? 'none' : undefined,
            '--lg-blur': '1px',
            '--lg-bezel': isMinimal ? '10px' : '8px',
            '--lg-thickness': isMinimal ? '18px' : '14px',
            '--lg-zoom': 1.02,
            '--lg-rim-saturation': 1.6,
            '--lg-refraction': 1.05,
        });

        const rangeLabel = currentSettings.extraSecondsMin === currentSettings.extraSecondsMax
            ? `+${currentSettings.extraSecondsMin}s`
            : `+${currentSettings.extraSecondsMin}–${currentSettings.extraSecondsMax}s`;

        const kbText = formatKeybind(currentSettings.uiToggleKeybind);
        const actionDesc = currentSettings.keybindAction === 'open-modal' ? 'open/close settings' : 'hide/show';
        const tooltip = isMinimal
            ? `UpLearn Control Panel (${kbText}) | Boost: ${enabled ? 'ON' : 'OFF'}`
            : `Click badge: toggle time boost | Click gear: Control Panel | ${kbText}: ${actionDesc}`;

        return html`
            <${Glisse.Glass} 
                id="__ul-pill"
                className=${`heroui-pill ${isMinimal ? 'heroui-pill--minimal' : ''}`}
                data-mode=${mode}
                style=${pillStyle}
                title=${tooltip}
                onClick=${(e) => {
                    if (isMinimal) {
                        e.preventDefault(); e.stopPropagation();
                        onOpenSettings();
                    }
                }}
            >
                <div 
                    className="heroui-pill__main"
                    onClick=${(e) => {
                        if (!isMinimal) {
                            e.preventDefault(); e.stopPropagation();
                            onToggleBoost();
                        }
                    }}
                >
                    <span className=${`heroui-pill__badge badge badge--sm ${enabled ? 'badge--primary badge--accent' : 'badge--secondary'}`}>
                        <span className="heroui-pill__dot"></span>
                        <span className="heroui-pill__label">${rangeLabel} ${enabled ? 'Active' : 'Paused'}</span>
                    </span>
                    <span className="heroui-pill__stats">
                        <span 
                            className="heroui-pill__stat-item" 
                            style=${{ display: (isCompact || isFull) ? 'inline-flex' : 'none' }}
                        >
                            🛡 ${currentStats.blocked}
                        </span>
                        <span 
                            className="heroui-pill__stat-item"
                            style=${{ display: isFull ? 'inline-flex' : 'none' }}
                        >
                            ⚡ ${currentStats.boosted}${accumulatedBonus > 0 ? ` (+${accumulatedBonus}s)` : ''}
                        </span>
                    </span>
                </div>
                <button 
                    type="button" 
                    className="heroui-pill__gear" 
                    title="Open UpLearn Settings (Ctrl+Shift+U)"
                    onClick=${(e) => {
                        e.preventDefault(); e.stopPropagation();
                        onOpenSettings();
                    }}
                >
                    <svg width=${isMinimal ? "20" : "18"} height=${isMinimal ? "20" : "18"} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="3"></circle>
                        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
                    </svg>
                    <span className="heroui-pill__indicator-dot" style=${{ display: enabled ? 'block' : 'none' }}></span>
                </button>
            <//>
        `;
    });

    // TelemetryTab
    const TelemetryTab = React.memo(({
        currentSettings,
        onUpdateSetting,
    }) => {
        const { useState, useMemo, useCallback } = React;
        const [servicesFilter, setServicesFilter] = useState('');

        const { filteredServicesList, activeServicesCount, totalServicesCount } = useMemo(() => {
            const q = servicesFilter.toLowerCase().trim();
            let active = 0, total = 0;
            const list = [];
            for (const key in TELEMETRY_SERVICES) {
                total++;
                const svc = TELEMETRY_SERVICES[key];
                const checked = key === 'jitsu'
                    ? !!(currentSettings.suppressJitsu && (!currentSettings.telemetryServices || currentSettings.telemetryServices.jitsu !== false))
                    : !!(currentSettings.telemetryServices && currentSettings.telemetryServices[key]);
                if (checked) active++;
                if (!q || svc.label.toLowerCase().includes(q) || svc.hosts.some(h => h.includes(q))) {
                    list.push({ key, svc, checked });
                }
            }
            return { filteredServicesList: list, activeServicesCount: active, totalServicesCount: total };
        }, [servicesFilter, currentSettings.telemetryServices, currentSettings.suppressJitsu]);

        const handleToggleService = useCallback((key) => {
            const current = currentSettings.telemetryServices || {};
            const curVal = key === 'jitsu'
                ? !!(currentSettings.suppressJitsu && current[key] !== false)
                : !!current[key];
            const next = !curVal;
            const updated = Object.assign({}, current, { [key]: next });
            LOG(`service "${TELEMETRY_SERVICES[key].label}" ${next ? 'ENABLED' : 'DISABLED'}`);
            onUpdateSetting('telemetryServices', updated);
        }, [currentSettings.telemetryServices, currentSettings.suppressJitsu, onUpdateSetting]);

        const handleEnableAllServices = useCallback(() => {
            const updated = {};
            for (const k in TELEMETRY_SERVICES) updated[k] = true;
            onUpdateSetting('telemetryServices', updated);
        }, [onUpdateSetting]);

        const handleDisableAllServices = useCallback(() => {
            const updated = {};
            for (const k in TELEMETRY_SERVICES) updated[k] = false;
            onUpdateSetting('telemetryServices', updated);
        }, [onUpdateSetting]);

        const updatePreset = useCallback((val) => onUpdateSetting('telemetryPreset', val), [onUpdateSetting]);
        const updateLogImproper = useCallback((v) => onUpdateSetting('blockLogImproperUse', v), [onUpdateSetting]);
        const updateBlockLogEvent = useCallback((v) => onUpdateSetting('blockLogEvent', v), [onUpdateSetting]);
        const updatePrivateSearch = useCallback((v) => onUpdateSetting('privateSearchMode', v), [onUpdateSetting]);
        const updateBlockDom = useCallback((v) => onUpdateSetting('blockDomElements', v), [onUpdateSetting]);
        const updateBlockWs = useCallback((v) => onUpdateSetting('blockWebSockets', v), [onUpdateSetting]);
        const updateBlockBeacon = useCallback((v) => onUpdateSetting('blockSendBeacon', v), [onUpdateSetting]);
        const updateSpoofVis = useCallback((v) => onUpdateSetting('spoofVisibility', v), [onUpdateSetting]);
        const updateSuppressNoise = useCallback((v) => onUpdateSetting('suppressConsoleNoise', v), [onUpdateSetting]);
        const updateSuppressJitsu = useCallback((v) => onUpdateSetting('suppressJitsu', v), [onUpdateSetting]);

        return html`
            <div className="grid-2col">
                <div className="col-stack">
                    <${Card}>
                        <${Card.Header}>
                            <${Card.Title}>
                                <span>Core Telemetry Intercepts</span>
                                <${Badge} variant="soft" color="accent">Protection Active<//>
                            <//>
                            <${Card.Description}>Configure network intercepts, telemetry blocking presets, and client-side privacy cloaks.<//>
                        <//>
                        <${Card.Content}>
                            <${FieldRow}>
                                <label>Active Preset
                                    <small>Off · Simple (LogImproperUse only) · Harsh (Block all) · Custom</small>
                                </label>
                                <${GlisseSelect} 
                                    options=${PRESET_OPTIONS}
                                    selectedKey=${currentSettings.telemetryPreset}
                                    onSelectionChange=${updatePreset}
                                    ariaLabel="Active Preset"
                                />
                            <//>

                            <${Switch} 
                                isSelected=${currentSettings.blockLogImproperUse}
                                onChange=${updateLogImproper}
                            >
                                <${Switch.Label}>Block LogImproperUse requests<//>
                                <${Switch.Description}>Silently drops UpLearn improper-use telemetry sent to API<//>
                            <//>

                            <${Switch} 
                                isSelected=${currentSettings.blockLogEvent !== false}
                                onChange=${updateBlockLogEvent}
                            >
                                <${Switch.Label}>Mock LogEvent mutations<//>
                                <${Switch.Description}>Resolves UI interaction logging locally to prevent client telemetry<//>
                            <//>

                            <${Switch} 
                                isSelected=${currentSettings.privateSearchMode !== false}
                                onChange=${updatePrivateSearch}
                            >
                                <${Switch.Label}>Private Search Mode<//>
                                <${Switch.Description}>Resolves LogLessonSearch mutations locally so search queries remain private<//>
                            <//>

                            <${Switch} 
                                isSelected=${currentSettings.suppressJitsu}
                                onChange=${updateSuppressJitsu}
                            >
                                <${Switch.Label}>Suppress Jitsu telemetry<//>
                                <${Switch.Description}>Checked: blocks jitsu.uplearn.co.uk. Unchecked: logs inspected packets.<//>
                            <//>

                            <${Switch} 
                                isSelected=${currentSettings.blockWebSockets}
                                onChange=${updateBlockWs}
                            >
                                <${Switch.Label}>Block telemetry WebSockets<//>
                                <${Switch.Description}>Terminates analytics & Intercom WebSocket connections<//>
                            <//>

                            <${Switch} 
                                isSelected=${currentSettings.blockSendBeacon}
                                onChange=${updateBlockBeacon}
                            >
                                <${Switch.Label}>Block telemetry sendBeacon<//>
                                <${Switch.Description}>Drops background beacon-style telemetry packets<//>
                            <//>

                            <${Switch} 
                                isSelected=${currentSettings.blockDomElements}
                                onChange=${updateBlockDom}
                            >
                                <${Switch.Label}>Block DOM telemetry injection<//>
                                <${Switch.Description}>Hooks script/iframe src and purges blocked tracker nodes<//>
                            <//>

                            <${Switch} 
                                isSelected=${currentSettings.spoofVisibility}
                                onChange=${updateSpoofVis}
                            >
                                <${Switch.Label}>Spoof visibility & focus<//>
                                <${Switch.Description}>Ensures page always believes it is focused & visible<//>
                            <//>

                            <${Switch} 
                                isSelected=${currentSettings.suppressConsoleNoise}
                                onChange=${updateSuppressNoise}
                            >
                                <${Switch.Label}>Suppress site's console noise<//>
                                <${Switch.Description}>Mutes [J-ERROR], Jitsu send errors, and blocked-host spam<//>
                            <//>
                        <//>
                    <//>
                </div>

                <div className="col-stack">
                    <${Card}>
                        <${Card.Header}>
                            <${Card.Title}>
                                <span>Third-Party Telemetry Services</span>
                                <${Badge} variant="soft" color="accent">${activeServicesCount}/${totalServicesCount} Active<//>
                            <//>
                            <${Card.Description}>Toggle individual analytics trackers. Changes auto-switch preset to Custom.<//>
                        <//>
                        <${Card.Content}>
                            <div className="services-toolbar">
                                <${Glisse.SearchField} 
                                    value=${servicesFilter}
                                    onValueChange=${setServicesFilter}
                                    placeholder="Search services…"
                                    className="services-search-field"
                                />
                                <div className="services-actions">
                                    <${Glisse.Button} variant="glass" onClick=${handleEnableAllServices} className="services-action-btn">
                                        Enable All
                                    <//>
                                    <${Glisse.Button} variant="glass" onClick=${handleDisableAllServices} className="services-action-btn">
                                        Disable All
                                    <//>
                                </div>
                            </div>
                            <div className="services-grid">
                                ${filteredServicesList.map(({ key, svc, checked }) => html`
                                    <${ServiceTile} 
                                        key=${key}
                                        serviceKey=${key} 
                                        service=${svc} 
                                        isChecked=${checked} 
                                        onToggle=${handleToggleService}
                                    />
                                `)}
                            </div>
                        <//>
                    <//>
                </div>
            </div>
        `;
    });

    // TimeBoostTab
    const TimeBoostTab = React.memo(({
        currentSettings,
        accumulatedBonus,
        onUpdateSetting,
        onAddManualBonus,
        onClearBonus,
    }) => {
        const { useState, useEffect, useCallback } = React;
        const [minStr, setMinStr] = useState(() => String(currentSettings.extraSecondsMin));
        const [maxStr, setMaxStr] = useState(() => String(currentSettings.extraSecondsMax));

        useEffect(() => {
            setMinStr(String(currentSettings.extraSecondsMin));
        }, [currentSettings.extraSecondsMin]);

        useEffect(() => {
            setMaxStr(String(currentSettings.extraSecondsMax));
        }, [currentSettings.extraSecondsMax]);

        const commitMin = useCallback(() => {
            const val = parseInt(minStr, 10);
            if (!isNaN(val) && val >= 1) {
                onUpdateSetting('extraSecondsRange', { min: val, max: currentSettings.extraSecondsMax });
            } else {
                setMinStr(String(currentSettings.extraSecondsMin));
            }
        }, [minStr, currentSettings.extraSecondsMin, currentSettings.extraSecondsMax, onUpdateSetting]);

        const commitMax = useCallback(() => {
            const val = parseInt(maxStr, 10);
            if (!isNaN(val) && val >= 1) {
                onUpdateSetting('extraSecondsRange', { min: currentSettings.extraSecondsMin, max: val });
            } else {
                setMaxStr(String(currentSettings.extraSecondsMax));
            }
        }, [maxStr, currentSettings.extraSecondsMin, currentSettings.extraSecondsMax, onUpdateSetting]);

        const updateTimeBoost = useCallback((v) => onUpdateSetting('timeBoostEnabled', v), [onUpdateSetting]);
        const updateManualBtn = useCallback((v) => onUpdateSetting('manualTimeButtonEnabled', v), [onUpdateSetting]);
        const updateManualStack = useCallback((v) => onUpdateSetting('manualTimeStacksWithAuto', v), [onUpdateSetting]);
        const updateFullVideo = useCallback((v) => onUpdateSetting('fullVideoWatchedEnabled', v), [onUpdateSetting]);
        const updateAutoSkipVideo = useCallback((v) => onUpdateSetting('autoSkipVideoEnabled', v), [onUpdateSetting]);
        const updateAddVideoDuration = useCallback((v) => onUpdateSetting('addVideoDurationToTimeSpent', v), [onUpdateSetting]);

        const handleRangePresetChange = useCallback((preset) => {
            if (!preset) return;
            setMinStr(String(preset.min));
            setMaxStr(String(preset.max));
            onUpdateSetting('extraSecondsRange', { min: preset.min, max: preset.max });
        }, [onUpdateSetting]);

        const rangeHint = (currentSettings.extraSecondsMin === currentSettings.extraSecondsMax)
            ? `Every question receives +${currentSettings.extraSecondsMin}s bonus.`
            : `Each question rolls a random +${currentSettings.extraSecondsMin}–${currentSettings.extraSecondsMax}s bonus.`;

        return html`
            <div className="grid-2col">
                <div className="col-stack">
                    <${Card}>
                        <${Card.Header}>
                            <${Card.Title}>
                                <span>Question Time Boost</span>
                                <${Badge} variant="soft" color=${currentSettings.timeBoostEnabled ? 'success' : 'default'}>
                                    ${currentSettings.timeBoostEnabled ? 'Active' : 'Paused'}
                                <//>
                            <//>
                            <${Card.Description}>Automatically injects extra time spent into question submissions and quiz completions.<//>
                        <//>
                        <${Card.Content}>
                            <${Switch} 
                                isSelected=${currentSettings.timeBoostEnabled}
                                onChange=${updateTimeBoost}
                            >
                                <${Switch.Label}>Enable question time boost<//>
                                <${Switch.Description}>Injects calculated time bonuses into question answering and quiz completion API calls<//>
                            <//>

                            <${FieldRow}>
                                <label>Extra Seconds Range
                                    <small>${rangeHint}</small>
                                </label>
                                <div style=${{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <${Glisse.Input} 
                                        type="number" 
                                        style=${{ width: '88px', height: '34px' }} 
                                        min="1" 
                                        max="3600"
                                        value=${minStr}
                                        onValueChange=${setMinStr}
                                        onBlur=${commitMin}
                                        onKeyDown=${(e) => { if (e.key === 'Enter') commitMin(); }}
                                    />
                                    <span style=${{ color: 'var(--lg-muted)', fontWeight: 600 }}>to</span>
                                    <${Glisse.Input} 
                                        type="number" 
                                        style=${{ width: '88px', height: '34px' }} 
                                        min="1" 
                                        max="3600"
                                        value=${maxStr}
                                        onValueChange=${setMaxStr}
                                        onBlur=${commitMax}
                                        onKeyDown=${(e) => { if (e.key === 'Enter') commitMax(); }}
                                    />
                                    <span style=${{ color: 'var(--lg-muted)', fontWeight: 600 }}>s</span>
                                </div>
                            <//>

                            <div className="field-box" style=${{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                <div style=${{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                                    <span style=${{ fontSize: '13px', fontWeight: 590, color: 'var(--lg-foreground)' }}>Quick Range Presets</span>
                                    <span style=${{ fontSize: '11px', color: 'var(--lg-muted)' }}>Tap to apply duration</span>
                                </div>
                                <div style=${{ display: 'flex', flexWrap: 'wrap', gap: '8px', width: '100%' }}>
                                    ${QUICK_RANGE_PRESETS.map((p, idx) => {
                                        const isSelected = p.min === currentSettings.extraSecondsMin && p.max === currentSettings.extraSecondsMax;
                                        return html`
                                            <${Glisse.Button}
                                                key=${idx}
                                                variant=${isSelected ? 'filled' : 'glass'}
                                                onClick=${() => handleRangePresetChange(p)}
                                                style=${{ height: '30px', padding: '0 13px', fontSize: '12px', borderRadius: '9999px', fontWeight: isSelected ? 600 : 500 }}
                                            >
                                                ${p.label}
                                            <//>
                                        `;
                                    })}
                                </div>
                            </div>
                        <//>
                    <//>

                    <${Card}>
                        <${Card.Header}>
                            <${Card.Title}>
                                <span>Interactive Quiz Page Button</span>
                                <${Badge} variant="soft" color=${currentSettings.manualTimeButtonEnabled ? 'accent' : 'default'}>Quiz Button<//>
                            <//>
                            <${Card.Description}>Injects an interactive "+Add time" button right next to UpLearn's submit button.<//>
                        <//>
                        <${Card.Content}>
                            <${Switch} 
                                isSelected=${currentSettings.manualTimeButtonEnabled}
                                onChange=${updateManualBtn}
                            >
                                <${Switch.Label}>Enable question page "+Add time" button<//>
                                <${Switch.Description}>Displays button next to Submit on question pages. Click to enter custom seconds (e.g. 120 or 2m).<//>
                            <//>

                            <${Switch} 
                                isSelected=${currentSettings.manualTimeStacksWithAuto}
                                onChange=${updateManualStack}
                                isDisabled=${!currentSettings.manualTimeButtonEnabled}
                            >
                                <${Switch.Label}>Manual time stacks with auto-boost<//>
                                <${Switch.Description}>Checked: manual extra adds on top of auto-boost. Unchecked: manual extra replaces auto-boost for that submission.<//>
                            <//>
                        <//>
                    <//>
                </div>

                <div className="col-stack">
                    <${Card}>
                        <${Card.Header}>
                            <${Card.Title}>
                                <span>Video Lesson Automation</span>
                                <${Badge} variant="soft" color=${(currentSettings.fullVideoWatchedEnabled || currentSettings.autoSkipVideoEnabled || currentSettings.addVideoDurationToTimeSpent) ? 'success' : 'default'}>Video Auto<//>
                            <//>
                            <${Card.Description}>Automate video lesson playback, skip straight to completion, and credit full duration.<//>
                        <//>
                        <${Card.Content}>
                            <${Switch} 
                                isSelected=${currentSettings.fullVideoWatchedEnabled}
                                onChange=${updateFullVideo}
                            >
                                <${Switch.Label}>Always mark videos as fully watched (100%)<//>
                                <${Switch.Description}>Sets percentWatched to 1 on CompleteVideoLesson mutations so every video registers as fully completed<//>
                            <//>

                            <${Switch} 
                                isSelected=${currentSettings.autoSkipVideoEnabled}
                                onChange=${updateAutoSkipVideo}
                            >
                                <${Switch.Label}>Auto-skip video (skips to 1s before end)<//>
                                <${Switch.Description}>Automatically seeks straight to 1 second before the end so it completes immediately<//>
                            <//>

                            <${Switch} 
                                isSelected=${currentSettings.addVideoDurationToTimeSpent}
                                onChange=${updateAddVideoDuration}
                            >
                                <${Switch.Label}>Add video duration to timeSpent<//>
                                <${Switch.Description}>In CompleteVideoLesson payload, rewrites timeSpent to equal full duration (e.g. 17m33s = PT1053S)<//>
                            <//>
                        <//>
                    <//>

                    <${Card}>
                        <${Card.Header}>
                            <${Card.Title}>
                                <span>Live Session Bonus Activity</span>
                                <${Badge} variant="soft" color=${accumulatedBonus > 0 ? "accent" : "default"}>
                                    ${accumulatedBonus > 0 ? `+${accumulatedBonus}s Active` : '0s Pending'}
                                <//>
                            <//>
                            <${Card.Description}>Real-time quiz bonus accumulated in this session to inject into UpLearn summaries.<//>
                        <//>
                        <${Card.Content}>
                            <${FieldRow}>
                                <label>Accumulated Time Bonus
                                    <small>Currently queued bonus to be credited on submission</small>
                                </label>
                                <div style=${{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <span style=${{ fontSize: '15px', fontWeight: 700, color: 'var(--accent, var(--lg-fill))', fontVariantNumeric: 'tabular-nums' }}>
                                        +${accumulatedBonus}s
                                    </span>
                                </div>
                            <//>
                            <${FieldRow}>
                                <label>Manual Session Boost
                                    <small>Quickly queue additional bonus seconds or clear pending bonus</small>
                                </label>
                                <div style=${{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                                    <${Glisse.Button} 
                                        variant="glass" 
                                        onClick=${() => onAddManualBonus && onAddManualBonus(30)}
                                    >
                                        +30s
                                    <//>
                                    <${Glisse.Button} 
                                        variant="glass" 
                                        onClick=${() => onAddManualBonus && onAddManualBonus(60)}
                                    >
                                        +60s
                                    <//>
                                    <${Glisse.Button} 
                                        variant="glass" 
                                        destructive
                                        onClick=${onClearBonus}
                                        title="Clear accumulated bonus"
                                    >
                                        Clear
                                    <//>
                                </div>
                            <//>
                        <//>
                    <//>
                </div>
            </div>
        `;
    });

    const ColorSwatch = React.memo(({ color, isSelected, onSelect }) => {
        return html`
            <div 
                className="color-swatch"
                data-active=${isSelected ? 'true' : 'false'}
                style=${{ backgroundColor: color.hex }}
                title=${color.name}
                onClick=${() => onSelect(color.hex)}
            >
                ${isSelected ? html`
                    <span style=${{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#ffffff' }}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="20 6 9 17 4 12"></polyline>
                        </svg>
                    </span>
                ` : null}
            </div>
        `;
    });

    // PreferencesTab
    const PreferencesTab = React.memo(({
        currentSettings,
        isCapturingKeybind,
        onStartCaptureKeybind,
        onClearKeybind,
        onUpdateSetting,
        onResetAllSettings,
    }) => {
        const { useCallback } = React;
        const updatePillMode = useCallback((val) => onUpdateSetting('pillMode', val), [onUpdateSetting]);
        const updatePillPosition = useCallback((val) => onUpdateSetting('pillPosition', val), [onUpdateSetting]);
        const updatePillOpacity = useCallback((val) => {
            onUpdateSetting('pillOpacity', val);
            try {
                const pillEl = (uiShadowRoot && uiShadowRoot.getElementById('__ul-pill')) || document.getElementById('__ul-pill');
                if (pillEl) pillEl.style.opacity = String(val);
            } catch {}
        }, [onUpdateSetting]);
        const updateDisableAutoFullscreen = useCallback((val) => onUpdateSetting('disableAutoFullscreen', val), [onUpdateSetting]);
        const updateDarkMode = useCallback((val) => onUpdateSetting('darkMode', val), [onUpdateSetting]);
        const updateDraggableUI = useCallback((val) => onUpdateSetting('draggableUI', val), [onUpdateSetting]);
        const updateTheme = useCallback((val) => onUpdateSetting('theme', val), [onUpdateSetting]);
        const updateAccentColor = useCallback((val) => onUpdateSetting('accentColor', val), [onUpdateSetting]);
        const updateKeybindAction = useCallback((val) => onUpdateSetting('keybindAction', val), [onUpdateSetting]);
        const updateLogLevel = useCallback((val) => onUpdateSetting('logLevel', val), [onUpdateSetting]);

        const isOpenModalAction = currentSettings.keybindAction === 'open-modal';

        return html`
            <div className="grid-2col">
                <div className="col-stack">
                    <${Card}>
                        <${Card.Header}>
                            <${Card.Title}>
                                <span>Control Panel Window & Theme</span>
                                <${Badge} variant="soft" color="accent">Visuals<//>
                            <//>
                            <${Card.Description}>Configure floating window mode, color theme, and liquid glass refraction.<//>
                        <//>
                        <${Card.Content}>
                            <${Switch} 
                                isSelected=${currentSettings.draggableUI}
                                onChange=${updateDraggableUI}
                            >
                                <${Switch.Label}>Draggable Glass Window<//>
                                <${Switch.Description}>Float the Control Panel as a movable window with liquid glass refraction over the page<//>
                            <//>

                            <${FieldRow}>
                                <label>Control Panel Theme
                                    <small>Translucent dark, frosted light, or system matching</small>
                                </label>
                                <${GlisseSelect} 
                                    options=${THEME_OPTIONS}
                                    selectedKey=${currentSettings.theme}
                                    onSelectionChange=${updateTheme}
                                    ariaLabel="Control Panel Theme"
                                />
                            <//>

                            <${FieldRow}>
                                <label>Theme Accent Color
                                    <small>Primary tint for switches, badges, and controls</small>
                                </label>
                                <div style=${{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                    <div className="color-swatches">
                                        ${QUICK_COLOR_SWATCHES.map((c) => html`
                                            <${ColorSwatch}
                                                key=${c.hex}
                                                color=${c}
                                                isSelected=${c.hex.toLowerCase() === currentSettings.accentColor.toLowerCase()}
                                                onSelect=${updateAccentColor}
                                            />
                                        `)}
                                    </div>
                                    <label title="Custom hex color" style=${{
                                        width: '26px',
                                        height: '26px',
                                        borderRadius: '50%',
                                        background: 'conic-gradient(from 180deg at 50% 50%, #FF0000 0deg, #FFA500 60deg, #FFFF00 120deg, #008000 180deg, #0000FF 240deg, #EE82EE 300deg, #FF0000 360deg)',
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        cursor: 'pointer',
                                        boxShadow: '0 2px 6px rgba(0, 0, 0, 0.2)',
                                        position: 'relative',
                                        overflow: 'hidden',
                                        flexShrink: 0
                                    }}>
                                        <input 
                                            type="color" 
                                            style=${{ opacity: 0, position: 'absolute', inset: 0, width: '100%', height: '100%', cursor: 'pointer' }}
                                            value=${currentSettings.accentColor}
                                            onChange=${(e) => updateAccentColor(e.target.value)}
                                        />
                                    </label>
                                </div>
                            <//>
                        <//>
                    <//>

                    <${Card}>
                        <${Card.Header}>
                            <${Card.Title}>
                                <span>UpLearn Webpage Tweaks</span>
                                <${Badge} variant="soft" color="accent">Page Tweaks<//>
                            <//>
                            <${Card.Description}>Enhance your UpLearn browsing experience with soft dark mode and screen controls.<//>
                        <//>
                        <${Card.Content}>
                            <${Switch} 
                                isSelected=${currentSettings.darkMode}
                                onChange=${updateDarkMode}
                            >
                                <${Switch.Label}>UpLearn Soft Dark Mode<//>
                                <${Switch.Description}>Soft high-contrast dark theme across all lesson and quiz pages<//>
                            <//>

                            <${Switch} 
                                isSelected=${currentSettings.disableAutoFullscreen}
                                onChange=${updateDisableAutoFullscreen}
                            >
                                <${Switch.Label}>Prevent auto fullscreen<//>
                                <${Switch.Description}>Blocks the website from silently forcing fullscreen mode<//>
                            <//>
                        <//>
                    <//>
                </div>

                <div className="col-stack">
                    <${Card}>
                        <${Card.Header}>
                            <${Card.Title}>
                                <span>Hotkeys & Floating Status Button</span>
                                <${Badge} variant="soft" color="accent">Shortcuts<//>
                            <//>
                            <${Card.Description}>Configure keyboard triggers and floating island button behavior.<//>
                        <//>
                        <${Card.Content}>
                            <${FieldRow}>
                                <label>Keybind Action
                                    <small>Behavior when pressing your global keyboard shortcut</small>
                                </label>
                                <${GlisseSelect} 
                                    options=${KEYBIND_ACTION_OPTIONS}
                                    selectedKey=${currentSettings.keybindAction || 'toggle-pill'}
                                    onSelectionChange=${updateKeybindAction}
                                    ariaLabel="Keybind Action"
                                />
                            <//>

                            <${FieldRow}>
                                <label>Global Shortcut Keybind
                                    <small>${isOpenModalAction ? 'Keyboard shortcut to directly open or close the Control Panel' : 'Keyboard shortcut to show or hide the floating status pill'}</small>
                                </label>
                                <div style=${{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                                    <${Glisse.Button} 
                                        variant="glass" 
                                        className=${isCapturingKeybind ? 'keybind-btn keybind-btn--capturing' : 'keybind-btn'}
                                        onClick=${onStartCaptureKeybind}
                                        title="Click to record new keybind"
                                    >
                                        ${isCapturingKeybind ? 'Press any key…' : formatKeybind(currentSettings.uiToggleKeybind)}
                                    <//>
                                    <${Glisse.Button} 
                                        variant="glass" 
                                        data-icon="only"
                                        title="Clear keybind"
                                        aria-label="Clear keybind"
                                        onClick=${onClearKeybind}
                                    >
                                        ✕
                                    <//>
                                </div>
                            <//>

                            ${isOpenModalAction ? html`
                                <div className="field-callout" style=${{ margin: '4px 0' }}>
                                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style=${{ flexShrink: 0 }}>
                                        <circle cx="12" cy="12" r="10"></circle>
                                        <line x1="12" y1="16" x2="12" y2="12"></line>
                                        <line x1="12" y1="8" x2="12.01" y2="8"></line>
                                    </svg>
                                    <span>Floating button is hidden because Keybind Action is set to "Open Settings Directly". Press your shortcut to toggle settings.</span>
                                </div>
                            ` : html`
                                <${FieldRow}>
                                    <label>Pill Information Display
                                        <small>Select how much info is displayed on the floating pill</small>
                                    </label>
                                    <${GlisseSelect} 
                                        options=${PILL_MODE_OPTIONS}
                                        selectedKey=${currentSettings.pillMode}
                                        onSelectionChange=${updatePillMode}
                                        ariaLabel="Pill Information Display"
                                    />
                                <//>

                                <${FieldRow}>
                                    <label>Pill Dock Position
                                        <small>Corner of the screen where the status pill floats</small>
                                    </label>
                                    <${GlisseSelect} 
                                        options=${PILL_POS_OPTIONS}
                                        selectedKey=${currentSettings.pillPosition}
                                        onSelectionChange=${updatePillPosition}
                                        ariaLabel="Pill Dock Position"
                                    />
                                <//>

                                <${FieldRow}>
                                    <label>Pill Opacity
                                        <small>Adjust background transparency</small>
                                    </label>
                                    <${Slider} 
                                        value=${currentSettings.pillOpacity}
                                        minValue=${0.2}
                                        maxValue=${1}
                                        step=${0.05}
                                        onChange=${updatePillOpacity}
                                    />
                                <//>
                            `}
                        <//>
                    <//>

                    <${Card}>
                        <${Card.Header}>
                            <${Card.Title}>
                                <span>Diagnostics & Maintenance</span>
                                <${Badge} variant="soft" color="accent">System<//>
                            <//>
                            <${Card.Description}>Developer console diagnostics and factory settings reset.<//>
                        <//>
                        <${Card.Content}>
                            <${FieldRow}>
                                <label>Console Logging Level
                                    <small>Verbose inspects bodies and prints grouped block reports</small>
                                </label>
                                <${GlisseSelect} 
                                    options=${LOG_LEVEL_OPTIONS}
                                    selectedKey=${currentSettings.logLevel}
                                    onSelectionChange=${updateLogLevel}
                                    ariaLabel="Console Logging Level"
                                />
                            <//>

                            <${FieldRow} className="field-row--danger" style=${{ marginTop: '2px' }}>
                                <div>
                                    <div style=${{ fontSize: '13px', fontWeight: 600, color: 'var(--lg-foreground)' }}>Reset All Preferences</div>
                                    <div style=${{ fontSize: '11.5px', color: 'var(--lg-muted)', marginTop: '2px' }}>Restore all settings & services to factory defaults</div>
                                </div>
                                <${Glisse.Button} 
                                    variant="glass" 
                                    destructive 
                                    onClick=${onResetAllSettings}
                                >
                                    <span>Reset All Settings</span>
                                <//>
                            <//>
                        <//>
                    <//>
                </div>
            </div>
        `;
    });

    // StatsTab
    const StatsTab = React.memo(({
        accumulatedBonus,
        onResetStats,
        isActive,
    }) => {
        const { useState, useEffect, useCallback } = React;
        const [tabStats, setTabStats] = useState(() => Object.assign({}, stats));

        useEffect(() => {
            if (!isActive) return;
            setTabStats(Object.assign({}, stats));
            return subscribeStats((st) => {
                setTabStats(Object.assign({}, st));
            });
        }, [isActive]);

        const handleReset = useCallback(() => {
            onResetStats();
            setTabStats(Object.assign({}, stats));
        }, [onResetStats]);

        return html`
            <${Card}>
                <${Card.Header}>
                    <div style=${{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                        <div>
                            <${Card.Title}>
                                <span>Session Activity & Shields</span>
                                <${Badge} variant="soft" color="accent">Real-Time<//>
                            <//>
                            <${Card.Description}>Live metric counters accumulated in this browser session.<//>
                        </div>
                        <${Glisse.Button} variant="glass" onClick=${handleReset}>
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style=${{ marginRight: '5px' }}>
                                <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/>
                                <path d="M21 3v5h-5"/>
                                <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/>
                                <path d="M3 21v-5h5"/>
                            </svg>
                            <span>Clear Session Metrics</span>
                        <//>
                    </div>
                <//>
                <${Card.Content}>
                    <div style=${{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                        <div>
                            <div style=${{ fontSize: '12px', fontWeight: 600, color: 'var(--lg-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '8px' }}>
                                🛡 Privacy & Telemetry Shields
                            </div>
                            <div className="stats-grid">
                                <div className="stat-card">
                                    <span className="stat-card__label">Trackers Blocked</span>
                                    <span className="stat-card__value">${tabStats.blocked}</span>
                                </div>
                                <div className="stat-card">
                                    <span className="stat-card__label">Improper Use</span>
                                    <span className="stat-card__value">${tabStats.logImproperUseBlocked}</span>
                                </div>
                                <div className="stat-card">
                                    <span className="stat-card__label">Jitsu Packets</span>
                                    <span className="stat-card__value">${tabStats.jitsuPackets}</span>
                                </div>
                                <div className="stat-card">
                                    <span className="stat-card__label">FS Blocked</span>
                                    <span className="stat-card__value">${tabStats.fullscreenBlocked}</span>
                                </div>
                                <div className="stat-card">
                                    <span className="stat-card__label">Console Muted</span>
                                    <span className="stat-card__value">${tabStats.consoleSuppressed}</span>
                                </div>
                                <div className="stat-card">
                                    <span className="stat-card__label">API Posts</span>
                                    <span className="stat-card__value">${tabStats.apiPosts}</span>
                                </div>
                            </div>
                        </div>

                        <div>
                            <div style=${{ fontSize: '12px', fontWeight: 600, color: 'var(--lg-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '8px' }}>
                                ⚡ Time Boost & Video Automation
                            </div>
                            <div className="stats-grid">
                                <div className="stat-card">
                                    <span className="stat-card__label">Boosted Qs</span>
                                    <span className="stat-card__value">${tabStats.boosted}</span>
                                </div>
                                <div className="stat-card">
                                    <span className="stat-card__label">Pending Bonus</span>
                                    <span className="stat-card__value">${accumulatedBonus}s</span>
                                </div>
                                <div className="stat-card">
                                    <span className="stat-card__label">Group Bonus</span>
                                    <span className="stat-card__value">${tabStats.groupExtra}s</span>
                                </div>
                                <div className="stat-card">
                                    <span className="stat-card__label">Manual Boosts</span>
                                    <span className="stat-card__value">${tabStats.manualBoosted || 0}</span>
                                </div>
                                <div className="stat-card">
                                    <span className="stat-card__label">Videos 100%</span>
                                    <span className="stat-card__value">${tabStats.videosMaxed || 0}</span>
                                </div>
                                <div className="stat-card">
                                    <span className="stat-card__label">Videos Skipped</span>
                                    <span className="stat-card__value">${tabStats.videosSkipped || 0}</span>
                                </div>
                                <div className="stat-card">
                                    <span className="stat-card__label">Video Time Added</span>
                                    <span className="stat-card__value">+${formatSeconds(tabStats.videoTimeAdded || 0)}</span>
                                </div>
                            </div>
                        </div>
                    </div>
                <//>
            <//>
        `;
    });

    // Glisse SettingsModal (No traffic lights, authentic Glisse TabBar & Buttons)
    const SettingsModal = React.memo(({
        isOpen,
        isClosing,
        onClose,
        currentSettings,
        accumulatedBonus,
        isCapturingKeybind,
        onStartCaptureKeybind,
        onClearKeybind,
        onUpdateSetting,
        onResetAllSettings,
        onResetStats,
        onAddManualBonus,
        onClearBonus,
    }) => {
        const { useState, useEffect, useRef, useCallback } = React;
        const [activeTab, setActiveTab] = useState('telemetry');
        const [visitedTabs, setVisitedTabs] = useState(() => new Set(['telemetry']));

        const isDraggable = Boolean(currentSettings && currentSettings.draggableUI);

        const [pos, setPos] = useState(() => {
            try {
                const saved = localStorage.getItem('__ul_win_pos');
                if (saved) {
                    const p = JSON.parse(saved);
                    if (typeof p.x === 'number' && typeof p.y === 'number') {
                        const w = Math.min(920, window.innerWidth * 0.92);
                        const h = Math.min(680, window.innerHeight * 0.86);
                        const maxX = Math.max(10, window.innerWidth - w - 10);
                        const maxY = Math.max(10, window.innerHeight - h - 10);
                        return {
                            x: Math.min(Math.max(10, Math.round(p.x)), maxX),
                            y: Math.min(Math.max(10, Math.round(p.y)), maxY),
                        };
                    }
                }
            } catch {}
            const w = Math.min(920, window.innerWidth * 0.92);
            const h = Math.min(680, window.innerHeight * 0.86);
            return {
                x: Math.max(10, Math.round((window.innerWidth - w) / 2)),
                y: Math.max(10, Math.round((window.innerHeight - h) / 2)),
            };
        });

        const [isDragging, setIsDragging] = useState(false);
        const dragRef = useRef(null);
        const dialogRef = useRef(null);
        const posRef = useRef(pos);
        posRef.current = pos;

        // Clamping on viewport resize
        useEffect(() => {
            if (!isDraggable) return;
            const handleResize = () => {
                setPos((prev) => {
                    const w = Math.min(920, window.innerWidth * 0.92);
                    const h = Math.min(680, window.innerHeight * 0.86);
                    const maxX = Math.max(10, window.innerWidth - w - 10);
                    const maxY = Math.max(10, window.innerHeight - h - 10);
                    const nextX = Math.min(Math.max(10, prev.x), maxX);
                    const nextY = Math.min(Math.max(10, prev.y), maxY);
                    if (nextX !== prev.x || nextY !== prev.y) {
                        return { x: nextX, y: nextY };
                    }
                    return prev;
                });
            };
            window.addEventListener('resize', handleResize);
            return () => window.removeEventListener('resize', handleResize);
        }, [isDraggable]);

        const handleHeaderPointerDown = useCallback((e) => {
            if (!isDraggable) return;
            if (e.button !== 0) return; // Left click only
            const target = e.target;
            if (target && target.closest && target.closest('button, a, input, select, textarea, .lg-tab, .lg-tab-bar, .lg-button')) {
                return;
            }
            e.preventDefault();

            const dialogEl = dialogRef.current;
            const dialogRect = dialogEl ? dialogEl.getBoundingClientRect() : null;
            const curW = dialogRect ? dialogRect.width : Math.min(920, window.innerWidth * 0.92);
            const curH = dialogRect ? dialogRect.height : Math.min(680, window.innerHeight * 0.86);

            dragRef.current = {
                startX: e.clientX,
                startY: e.clientY,
                initX: posRef.current.x,
                initY: posRef.current.y,
                dialogW: curW,
                dialogH: curH,
            };
            setIsDragging(true);

            const onPointerMove = (moveEvt) => {
                if (!dragRef.current) return;
                const dx = moveEvt.clientX - dragRef.current.startX;
                const dy = moveEvt.clientY - dragRef.current.startY;
                const maxX = Math.max(10, window.innerWidth - dragRef.current.dialogW - 10);
                const maxY = Math.max(10, window.innerHeight - dragRef.current.dialogH - 10);
                const nextX = Math.min(Math.max(10, Math.round(dragRef.current.initX + dx)), maxX);
                const nextY = Math.min(Math.max(10, Math.round(dragRef.current.initY + dy)), maxY);
                posRef.current = { x: nextX, y: nextY };
                if (dialogRef.current) {
                    dialogRef.current.style.left = nextX + 'px';
                    dialogRef.current.style.top = nextY + 'px';
                }
            };

            const onPointerUp = () => {
                window.removeEventListener('pointermove', onPointerMove);
                window.removeEventListener('pointerup', onPointerUp);
                window.removeEventListener('pointercancel', onPointerUp);
                setIsDragging(false);
                if (dragRef.current) {
                    dragRef.current = null;
                    const finalPos = posRef.current;
                    setPos(finalPos);
                    try {
                        localStorage.setItem('__ul_win_pos', JSON.stringify(finalPos));
                    } catch {}
                }
            };

            window.addEventListener('pointermove', onPointerMove, { passive: true });
            window.addEventListener('pointerup', onPointerUp);
            window.addEventListener('pointercancel', onPointerUp);
        }, [isDraggable]);

        const handleTabClick = useCallback((targetTab) => {
            setActiveTab(targetTab);
            setVisitedTabs((prev) => {
                if (prev.has(targetTab)) return prev;
                const next = new Set(prev);
                next.add(targetTab);
                return next;
            });
        }, []);

        if (!isOpen && !isClosing) return null;

        const tabItems = [
            { value: 'telemetry', label: '🛡 Telemetry' },
            { value: 'timeboost', label: '⏱ Time Boost' },
            { value: 'preferences', label: '🎨 Preferences' },
            { value: 'stats', label: '📊 Statistics' },
        ];

        const dialogStyle = isDraggable ? {
            left: `${pos.x}px`,
            top: `${pos.y}px`,
        } : {};

        return html`
            <${Modal} isOpen=${isOpen} isClosing=${isClosing} onClose=${onClose}>
                <${Modal.Backdrop} isClosing=${isClosing} onClose=${onClose} isDraggable=${isDraggable}>
                    <${Modal.Container} isDraggable=${isDraggable}>
                        <${Modal.Dialog} 
                            isDraggable=${isDraggable}
                            dialogRef=${dialogRef}
                            style=${dialogStyle}
                        >
                            
                            <!-- Glisse Header with Title, TabBar & Close Button -->
                            <${Modal.Header}
                                isDraggable=${isDraggable}
                                isDragging=${isDragging}
                                onPointerDown=${handleHeaderPointerDown}
                            >
                                <div className="modal__brand">
                                    <${Modal.Icon}>
                                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                                            <circle cx="12" cy="12" r="3"></circle>
                                            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
                                        </svg>
                                    <//>
                                    <div>
                                        <${Modal.Heading}>UpLearn Control Panel<//>
                                        ${isDraggable ? html`
                                            <div style=${{ fontSize: '10.5px', color: 'var(--lg-muted)', display: 'flex', alignItems: 'center', gap: '4px', marginTop: '1px' }}>
                                                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                                    <polyline points="5 9 2 12 5 15"></polyline>
                                                    <polyline points="9 5 12 2 15 5"></polyline>
                                                    <polyline points="15 19 12 22 9 19"></polyline>
                                                    <polyline points="19 9 22 12 19 15"></polyline>
                                                    <line x1="2" y1="12" x2="22" y2="12"></line>
                                                    <line x1="12" y1="2" x2="12" y2="22"></line>
                                                </svg>
                                                <span>Draggable Liquid Glass</span>
                                            </div>
                                        ` : null}
                                    </div>
                                </div>

                                <div className="modal__header-nav">
                                    <${Glisse.TabBar} 
                                        items=${tabItems}
                                        value=${activeTab}
                                        onValueChange=${handleTabClick}
                                        style=${{ '--lg-tab-width': '124px', '--lg-tab-height': '34px' }}
                                    />
                                </div>

                                <${Glisse.Button} 
                                    variant="glass" 
                                    data-icon="only"
                                    onClick=${onClose} 
                                    title="Close (Esc)"
                                    aria-label="Close modal"
                                    style=${{ width: '36px', height: '36px', padding: 0 }}
                                >
                                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                                        <line x1="18" y1="6" x2="6" y2="18"></line>
                                        <line x1="6" y1="6" x2="18" y2="18"></line>
                                    </svg>
                                <//>
                            <//>

                            <!-- Body -->
                            <${Modal.Body}>
                                ${visitedTabs.has('telemetry') && html`
                                    <${Tabs.Panel} id="telemetry" activeTab=${activeTab}>
                                        <${TelemetryTab} 
                                            currentSettings=${currentSettings}
                                            onUpdateSetting=${onUpdateSetting}
                                        />
                                    <//>
                                `}
                                ${visitedTabs.has('timeboost') && html`
                                    <${Tabs.Panel} id="timeboost" activeTab=${activeTab}>
                                        <${TimeBoostTab} 
                                            currentSettings=${currentSettings}
                                            accumulatedBonus=${accumulatedBonus}
                                            onUpdateSetting=${onUpdateSetting}
                                            onAddManualBonus=${onAddManualBonus}
                                            onClearBonus=${onClearBonus}
                                        />
                                    <//>
                                `}
                                ${visitedTabs.has('preferences') && html`
                                    <${Tabs.Panel} id="preferences" activeTab=${activeTab}>
                                        <${PreferencesTab} 
                                            currentSettings=${currentSettings}
                                            isCapturingKeybind=${isCapturingKeybind}
                                            onStartCaptureKeybind=${onStartCaptureKeybind}
                                            onClearKeybind=${onClearKeybind}
                                            onUpdateSetting=${onUpdateSetting}
                                            onResetAllSettings=${onResetAllSettings}
                                        />
                                    <//>
                                `}
                                ${visitedTabs.has('stats') && html`
                                    <${Tabs.Panel} id="stats" activeTab=${activeTab}>
                                        <${StatsTab} 
                                            accumulatedBonus=${accumulatedBonus}
                                            onResetStats=${onResetStats}
                                            isActive=${activeTab === 'stats'}
                                        />
                                    <//>
                                `}
                            <//>

                        <//>
                    <//>
                <//>
            <//>
        `;
    });

    function resetAllStats() {
        stats.apiPosts = 0; stats.seen = 0; stats.boosted = 0;
        stats.blocked = 0; stats.groupExtra = 0; stats.fullscreenBlocked = 0;
        stats.consoleSuppressed = 0; stats.logImproperUseBlocked = 0;
        stats.jitsuPackets = 0; stats.manualBoosted = 0; stats.videosMaxed = 0;
        stats.videosSkipped = 0; stats.videoTimeAdded = 0;
        accumulatedExtraSeconds = 0; accumulatedQuestionCount = 0;
        notifyStatsChange();
        if (reactSetStats) {
            reactSetStats(Object.assign({}, stats, { accumulated: 0 }));
        }
    }

    // --- Root App Component ---
    const App = () => {
        const { useState, useEffect, useCallback, useRef } = React;
        const [appSettings, setAppSettings] = useState(() => cloneSettings(settings));
        const [appStats, setAppStats] = useState(() => Object.assign({}, stats));
        const [accumulatedBonus, setAccumulatedBonus] = useState(accumulatedExtraSeconds);
        const [isModalOpen, setIsModalOpen] = useState(false);
        const [isClosing, setIsClosing] = useState(false);
        const [isCapturing, setIsCapturing] = useState(false);
        const closeTimerRef = useRef(null);
        const modalStateRef = useRef({ open: false, closing: false });

        const setModalOpenState = useCallback((open) => {
            if (open) {
                if (closeTimerRef.current) {
                    clearTimeout(closeTimerRef.current);
                    closeTimerRef.current = null;
                }
                modalStateRef.current.open = true;
                modalStateRef.current.closing = false;
                isModalOpenGlobal = true;
                setIsClosing(false);
                setIsModalOpen(true);
            } else {
                if (capturingKeybind) {
                    capturingKeybind = false;
                    setIsCapturing(false);
                }
                if ((!modalStateRef.current.open && !isModalOpenGlobal) || modalStateRef.current.closing) {
                    return;
                }
                modalStateRef.current.open = false;
                modalStateRef.current.closing = true;
                isModalOpenGlobal = false;
                if (closeTimerRef.current) {
                    clearTimeout(closeTimerRef.current);
                }
                setIsClosing(true);
                closeTimerRef.current = setTimeout(() => {
                    closeTimerRef.current = null;
                    modalStateRef.current.closing = false;
                    setIsModalOpen(false);
                    setIsClosing(false);
                }, 190);
            }
        }, []);

        // Register bridges for global callbacks
        useEffect(() => {
            reactSetSettings = setAppSettings;
            reactSetStats = (st) => {
                setAppStats(Object.assign({}, st));
                if (typeof st.accumulated !== 'undefined') setAccumulatedBonus(st.accumulated);
            };
            reactSetModalOpen = setModalOpenState;
            reactSetCapturingKeybind = setIsCapturing;

            return () => {
                if (closeTimerRef.current) {
                    clearTimeout(closeTimerRef.current);
                    closeTimerRef.current = null;
                }
                reactSetSettings = null;
                reactSetStats = null;
                reactSetModalOpen = null;
                reactSetCapturingKeybind = null;
            };
        }, [setModalOpenState]);

        // Real-time reactive live stats subscription for StatusPill (zero polling)
        useEffect(() => {
            if (settings.pillMode === 'compact' || settings.pillMode === 'full') {
                setAppStats(Object.assign({}, stats));
                setAccumulatedBonus(accumulatedExtraSeconds);
            }
            let lastBlocked = stats.blocked;
            let lastBoosted = stats.boosted;
            let lastAcc = accumulatedExtraSeconds;

            return subscribeStats((st) => {
                if (settings.pillMode === 'compact' || settings.pillMode === 'full') {
                    const acc = accumulatedExtraSeconds;
                    if (st.blocked !== lastBlocked || st.boosted !== lastBoosted || acc !== lastAcc) {
                        lastBlocked = st.blocked;
                        lastBoosted = st.boosted;
                        lastAcc = acc;
                        setAppStats(Object.assign({}, st));
                        setAccumulatedBonus(acc);
                    }
                }
            });
        }, [appSettings.pillMode]);

        const handleCloseModal = useCallback(() => {
            setModalOpenState(false);
        }, [setModalOpenState]);

        const handleOpenSettings = useCallback(() => {
            if (isModalOpenGlobal) {
                setModalOpenState(false);
            } else {
                setModalOpenState(true);
            }
        }, [setModalOpenState]);

        const handleToggleBoost = useCallback(() => {
            const next = !settings.timeBoostEnabled;
            applySettingChange('timeBoostEnabled', next);
            LOG('time-boost ' + (next ? 'ENABLED' : 'DISABLED'));
        }, []);

        const handleStartCaptureKeybind = useCallback(() => {
            capturingKeybind = !capturingKeybind;
            setIsCapturing(capturingKeybind);
            LOG('keybind capture ' + (capturingKeybind ? 'started' : 'cancelled'));
        }, []);

        const handleClearKeybind = useCallback(() => {
            if (capturingKeybind) {
                capturingKeybind = false;
                setIsCapturing(false);
                return;
            }
            applySettingChange('uiToggleKeybind', { code: null, ctrl: false, shift: false, alt: false, meta: false });
            LOG('keybind cleared');
        }, []);

        const handleResetAllSettings = useCallback(() => {
            if (confirm('Reset all UpLearn settings to defaults?')) {
                Object.assign(settings, DEFAULT_SETTINGS);
                settings.telemetryServices = buildDefaultTelemetryServices();
                settings.uiToggleKeybind = Object.assign({}, DEFAULT_KEYBIND);
                normalizeRange(settings);
                saveSettings(true);
                applyDarkMode();
                ensureButton();
                patchVisibilityProps();
                installHasFocusPatch();
                initVideoAutoSkipController();
                setAppSettings(cloneSettings(settings));
                LOG('settings reset to defaults');
            }
        }, []);

        const handleResetStats = useCallback(() => {
            resetAllStats();
            LOG('stats reset');
        }, []);

        const handleAddManualBonus = useCallback((sec) => {
            accumulatedExtraSeconds += sec;
            setAccumulatedBonus(accumulatedExtraSeconds);
            bumpStat('manualBoosted');
            if (reactSetStats) {
                reactSetStats(Object.assign({}, stats, { accumulated: accumulatedExtraSeconds }));
            }
            LOG('manual bonus added: +' + sec + 's (total ' + accumulatedExtraSeconds + 's)');
        }, []);

        const handleClearBonus = useCallback(() => {
            accumulatedExtraSeconds = 0;
            accumulatedQuestionCount = 0;
            setAccumulatedBonus(0);
            notifyStatsChange();
            if (reactSetStats) {
                reactSetStats(Object.assign({}, stats, { accumulated: 0 }));
            }
            LOG('manual bonus cleared');
        }, []);

        // Sync theme attribute & accent CSS variable on root container
        useEffect(() => {
            const syncThemeAndAccent = () => {
                if (uiContainerEl) {
                    uiContainerEl.setAttribute('data-theme', getEffectiveTheme(appSettings.theme));
                    uiContainerEl.style.setProperty('--accent', appSettings.accentColor);
                }
            };
            syncThemeAndAccent();
            if (appSettings.theme === 'auto' && typeof window.matchMedia === 'function') {
                try {
                    const mql = window.matchMedia('(prefers-color-scheme: light)');
                    if (typeof mql.addEventListener === 'function') {
                        mql.addEventListener('change', syncThemeAndAccent);
                        return () => mql.removeEventListener('change', syncThemeAndAccent);
                    }
                } catch {}
            }
        }, [appSettings.theme, appSettings.accentColor]);

        return html`
            <div className="heroui-react-wrapper">
                <${StatusPill} 
                    currentSettings=${appSettings}
                    currentStats=${appStats}
                    accumulatedBonus=${accumulatedBonus}
                    onToggleBoost=${handleToggleBoost}
                    onOpenSettings=${handleOpenSettings}
                />
                ${(isModalOpen || isClosing) ? html`
                    <${SettingsModal} 
                        isOpen=${isModalOpen}
                        isClosing=${isClosing}
                        onClose=${handleCloseModal}
                        currentSettings=${appSettings}
                        accumulatedBonus=${accumulatedBonus}
                        isCapturingKeybind=${isCapturing}
                        onStartCaptureKeybind=${handleStartCaptureKeybind}
                        onClearKeybind=${handleClearKeybind}
                        onUpdateSetting=${applySettingChange}
                        onResetAllSettings=${handleResetAllSettings}
                        onResetStats=${handleResetStats}
                        onAddManualBonus=${handleAddManualBonus}
                        onClearBonus=${handleClearBonus}
                    />
                ` : null}
            </div>
        `;
    };

    function mountReactUI() {
        if (reactRootInstance || !uiContainerEl) return;
        if (typeof ReactDOM === 'undefined' || typeof React === 'undefined' || typeof htm === 'undefined') {
            nativeConsole.error('[UL] React, ReactDOM, or HTM not loaded from @require.');
            return;
        }
        try {
            reactRootInstance = ReactDOM.createRoot(uiContainerEl);
            reactRootInstance.render(html`<${App} />`);
            LOG('Glisse & Apple Liquid Glass UI mounted');
        } catch (err) {
            nativeConsole.error('[UL] Error mounting React UI:', err);
        }
    }

    // ============================================================
    // GLOBAL KEYBOARD SHORTCUTS
    // ============================================================
    window.addEventListener('keydown', (e) => {
        if (capturingKeybind) {
            e.preventDefault(); e.stopPropagation();
            if (e.code === 'Escape') {
                capturingKeybind = false;
                if (reactSetCapturingKeybind) reactSetCapturingKeybind(false);
                LOG('keybind capture cancelled');
                return;
            }
            const kb = captureKeybindFromEvent(e);
            applySettingChange('uiToggleKeybind', kb);
            capturingKeybind = false;
            if (reactSetCapturingKeybind) reactSetCapturingKeybind(false);
            LOG('keybind set to:', formatKeybind(kb));
            return;
        }
        if (e.key === 'Escape' && isModalOpenGlobal && !capturingKeybind) {
            e.preventDefault();
            closeSettingsModal();
            return;
        }
        if (matchesKeybind(e, settings.uiToggleKeybind) && !e.repeat) {
            e.preventDefault();
            if (settings.keybindAction === 'open-modal') {
                if (isModalOpenGlobal) closeSettingsModal();
                else openSettingsModal();
            } else {
                if (isModalOpenGlobal) {
                    // First press closes settings UI, leaving button visible
                    closeSettingsModal();
                    if (!settings.pillVisible) {
                        settings.pillVisible = true;
                        saveSettings();
                        syncModalIfOpen();
                    }
                    LOG('settings UI closed via keybind; floating button remains visible');
                } else {
                    // Second press (or single press when settings UI is closed) toggles button visibility
                    settings.pillVisible = !settings.pillVisible;
                    saveSettings();
                    syncModalIfOpen();
                    LOG('pill ' + (settings.pillVisible ? 'SHOWN' : 'HIDDEN'));
                }
            }
            return;
        }
        if (e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey && e.code === 'KeyU') {
            e.preventDefault();
            if (isModalOpenGlobal) closeSettingsModal();
            else openSettingsModal();
            return;
        }
    }, true);

    // ============================================================
    // BOOTSTRAP
    // ============================================================
    function bootstrap() {
        ensureUIHost();
        ensureButton();
        initManualButtonObserver();
        initVideoAutoSkipController();
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
    } else {
        bootstrap();
    }

    // ============================================================
    // PUBLIC API (Exposed in verbose mode for DevTools debugging)
    // ============================================================
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
        setFullVideoWatchedEnabled: (v) => { applySettingChange('fullVideoWatchedEnabled', !!v); },
        setAutoSkipVideoEnabled: (v) => { applySettingChange('autoSkipVideoEnabled', !!v); },
        setAddVideoDurationToTimeSpent: (v) => { applySettingChange('addVideoDurationToTimeSpent', !!v); },
        getKnownLessonDurations: () => knownLessonDurations,
        getCurrentVideoLesson: () => currentVideoLesson,
        skipVideoNow: (force = true) => checkAndAutoSkipVideo(force),
        handleApiResponse,
        getLatestExamPaperData: () => latestExamPaperData,
        getLatestUserProfile: () => latestUserProfile,
        getLatestFeatureFlags: () => latestFeatureFlags,
        getLatestGlobalFeatureFlags: () => latestGlobalFeatureFlags,
        getLatestQuizFeedback: () => latestQuizFeedback,
        getQueuedSeconds: () => queuedSeconds,
        setQueuedSeconds: (secs) => {
            queuedSeconds = secs;
            updateLabel();
        },
        ensureManualTimeButton: ensureButton,
        removeManualTimeButton: removeButton,
        rewriteBodyText,
        telemetryServices: TELEMETRY_SERVICES,
        resetStats: resetAllStats,
        getAccumulated: () => accumulatedExtraSeconds,
        getAccumulatedCount: () => accumulatedQuestionCount,
        pickExtraSeconds,
        _match: (url) => matchTelemetryService(url),
    };

    if (settings.logLevel === 'verbose') {
        window.__ul = publicApi;
    }

    LOG('=== READY | timeBoost:', settings.timeBoostEnabled,
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
        nativeConsole.groupCollapsed('%c[UL · verbose] 🟢 Ready — active blockers', CSS.verbose);
        const anyServiceOn = Object.keys(TELEMETRY_SERVICES).some(
            (k) => k !== 'jitsu' && settings.telemetryServices[k]
        );
        nativeConsole.log('%cThird-party services:   ', CSS.muted, anyServiceOn ? 'ON' : 'OFF');
        nativeConsole.log('%cSuppress Jitsu:         ', CSS.muted, settings.suppressJitsu ? 'YES (blocked + logged)' : 'no (allowed + logged)');
        nativeConsole.log('%cLogImproperUse:         ', CSS.muted, settings.blockLogImproperUse ? 'ON' : 'OFF');
        nativeConsole.log('%cLogEvent handler:       ', CSS.muted, settings.blockLogEvent !== false ? 'ON' : 'OFF');
        nativeConsole.log('%cPrivate search mode:    ', CSS.muted, settings.privateSearchMode !== false ? 'ON' : 'OFF');
        nativeConsole.log('%cFunction cloaking:       ', CSS.muted, 'ON');
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
        nativeConsole.groupEnd();
    }
})();
