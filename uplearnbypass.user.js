// ==UserScript==
// @name         UpLearn Telemetry Blocker & TimeSpent Booster
// @namespace    https://github.com/local/uplearn-telemetry-blocker
// @version      3.7.0
// @description  Configurable telemetry blocking with detailed verbose logging, aggressive console-noise suppression, dedicated LogImproperUse logging, full request body capture, Jitsu packet inspection, Jitsu suppress toggle; random-range time boost; inline manual "Add time" question button; full video watch completion toggle; dark mode; full control panel UI
// @author       you
// @match        https://web.uplearn.co.uk/*
// @run-at       document-start
// @grant        none
// @inject-into  page
// @noframes
// @require      https://unpkg.com/react@18.3.1/umd/react.production.min.js
// @require      https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js
// @require      https://unpkg.com/htm@3.1.1/dist/htm.umd.js
// ==/UserScript==

(function () {
    'use strict';

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
        disableAutoFullscreen:     true,
        darkMode:                  false,
        pillVisible:               true,
        pillPosition:              'bottom-right',
        pillOpacity:               1,
        showStats:                 true,
        pillMode:                  'minimal',
        theme:                     'dark',
        accentColor:               '#16a34a',
        logLevel:                  'normal',
        uiToggleKeybind:           Object.assign({}, DEFAULT_KEYBIND),
    };

    const INDIVIDUAL_TELEMETRY_SETTINGS = new Set([
        'telemetryServices',
        'blockLogImproperUse', 'spoofVisibility', 'blockWebSockets',
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

                Object.assign(s, parsed);
            } else {
                const b = localStorage.getItem(LEGACY_BOOST_KEY);
                if (b !== null) s.timeBoostEnabled = b === 'true';
                const u = localStorage.getItem(LEGACY_UI_KEY);
                if (u !== null) s.pillVisible = u === 'true';
            }
        } catch (e) { nativeConsole.warn('[UL] load settings failed', e); }

        s.telemetryServices = Object.assign({}, s.telemetryServices);
        normalizeRange(s);
        s.pillMode = s.pillMode || 'minimal';
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
    // PRESETS
    // ============================================================
    function applyTelemetryPreset(preset) {
        if (preset === 'off') {
            for (const k in settings.telemetryServices) settings.telemetryServices[k] = false;
            settings.blockLogImproperUse  = false;
            settings.spoofVisibility      = false;
            settings.blockWebSockets      = false;
            settings.blockSendBeacon      = false;
            settings.blockDomElements     = false;
            settings.suppressConsoleNoise = false;
        } else if (preset === 'simple') {
            for (const k in settings.telemetryServices) settings.telemetryServices[k] = false;
            settings.blockLogImproperUse  = true;
            settings.spoofVisibility      = false;
            settings.blockWebSockets      = false;
            settings.blockSendBeacon      = false;
            settings.blockDomElements     = false;
            settings.suppressConsoleNoise = true;
        } else if (preset === 'harsh') {
            for (const k in settings.telemetryServices) settings.telemetryServices[k] = true;
            settings.blockLogImproperUse  = true;
            settings.spoofVisibility      = true;
            settings.blockWebSockets      = true;
            settings.blockSendBeacon      = true;
            settings.blockDomElements     = true;
            settings.suppressConsoleNoise = true;
        }
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
    const JITSU_HOSTS = TELEMETRY_SERVICES.jitsu.hosts;

    const hostCache = new Map();
    function hostOf(url) {
        if (!url || typeof url !== 'string') return '';
        let h = hostCache.get(url);
        if (h !== undefined) return h;
        try { h = new URL(url, location.href).hostname.toLowerCase(); }
        catch { h = ''; }
        if (hostCache.size > 250) hostCache.clear();
        hostCache.set(url, h);
        return h;
    }

    function isJitsuHost(h) {
        if (!h) return false;
        for (let i = 0; i < JITSU_HOSTS.length; i++) {
            const t = JITSU_HOSTS[i];
            if (h === t || h.endsWith('.' + t) || h.includes(t)) return true;
        }
        return false;
    }

    function isJitsuUrl(url) {
        if (!url) return false;
        return isJitsuHost(hostOf(url));
    }

    function matchTelemetryService(url) {
        if (!url) return null;
        const h = hostOf(url);
        if (!h) return null;

        // Jitsu is controlled by its own dedicated toggle (settings.suppressJitsu),
        // independent of presets and the per-service checkbox.
        if (isJitsuHost(h)) {
            if (!settings.suppressJitsu) return null;
            return { key: 'jitsu', label: 'Jitsu', host: h, pattern: JITSU_HOSTS[0] };
        }

        const enabled = settings.telemetryServices || {};
        for (const key in TELEMETRY_SERVICES) {
            if (key === 'jitsu') continue;
            if (!enabled[key]) continue;
            const hosts = TELEMETRY_SERVICES[key].hosts;
            for (let i = 0; i < hosts.length; i++) {
                const t = hosts[i];
                if (h === t || h.endsWith('.' + t) || h.includes(t)) {
                    return { key, label: TELEMETRY_SERVICES[key].label, host: h, pattern: t };
                }
            }
        }
        return null;
    }

    function matchAnyTelemetryService(url) {
        if (!url) return null;
        const h = hostOf(url);
        if (!h) return null;
        for (const key in TELEMETRY_SERVICES) {
            const hosts = TELEMETRY_SERVICES[key].hosts;
            for (let i = 0; i < hosts.length; i++) {
                const t = hosts[i];
                if (h === t || h.endsWith('.' + t) || h.includes(t)) {
                    return { key, label: TELEMETRY_SERVICES[key].label, host: h, pattern: t };
                }
            }
        }
        return null;
    }

    function isTelemetryUrl(url) { return !!matchTelemetryService(url); }

    function isTargetApi(url) {
        if (!url || typeof url !== 'string') return false;
        if (!url.includes(API_HOST) && !url.startsWith('/api')) return false;
        try {
            const u = new URL(url, location.href);
            return u.host === API_HOST && API_PATH_RE.test(u.pathname);
        } catch { return false; }
    }

    // ============================================================
    // STATS
    // ============================================================
    const stats = {
        apiPosts: 0, seen: 0, boosted: 0, blocked: 0,
        groupExtra: 0, fullscreenBlocked: 0, consoleSuppressed: 0,
        logImproperUseBlocked: 0, jitsuPackets: 0, manualBoosted: 0,
        videosMaxed: 0,
    };

    // ============================================================
    // CONSOLE NOISE FILTER
    // ============================================================
    const NOISE_PATTERNS = [
        /\[J-(?:ERROR|WARN|DEBUG|INFO|LOG)\]/i,
        /\[Jitsu\]/i,
        /Failed to send data to/i,
        /Dropping queued event after/i,
        /max send attempts/i,
        /go\.apollo\.dev\/c\/err/i,
        /\[Sentry\]/i,
    ];

    const ALL_TELEMETRY_HOSTS = (() => {
        const arr = [];
        for (const k in TELEMETRY_SERVICES) {
            for (const h of TELEMETRY_SERVICES[k].hosts) arr.push(h);
        }
        return arr;
    })();

    function textMatchesNoise(text) {
        if (typeof text !== 'string' || !text) return false;
        // If Jitsu is being ALLOWED (suppressJitsu === false), don't silence its own
        // log lines — the user asked to see what it's doing.
        const showJitsuNoise = !settings.suppressJitsu;
        for (let i = 0; i < NOISE_PATTERNS.length; i++) {
            if (NOISE_PATTERNS[i].test(text)) {
                if (showJitsuNoise && i < 5) continue; // first 5 patterns are Jitsu-specific
                return true;
            }
        }
        const lower = text.toLowerCase();
        for (let i = 0; i < ALL_TELEMETRY_HOSTS.length; i++) {
            const h = ALL_TELEMETRY_HOSTS[i];
            if (lower.indexOf(h) !== -1) {
                if (showJitsuNoise && isJitsuHost(h)) continue;
                return true;
            }
        }
        return false;
    }

    function argsAreNoise(args) {
        for (let i = 0; i < args.length; i++) {
            const a = args[i];
            if (typeof a === 'string') {
                if (textMatchesNoise(a)) return true;
            } else if (a instanceof Error) {
                if (a.message && textMatchesNoise(a.message)) return true;
                if (a.stack   && textMatchesNoise(a.stack))   return true;
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
        ['log', 'warn', 'error', 'info', 'debug'].forEach((method) => {
            const orig = nativeConsole[method];
            console[method] = function (...args) {
                if (settings.suppressConsoleNoise && argsAreNoise(args)) {
                    stats.consoleSuppressed++;
                    return;
                }
                return orig.apply(console, args);
            };
        });
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

    // Dedicated reporter for LogImproperUse so it stands out from generic
    // telemetry blocks. Bumps its own counter and uses pink styling.
    function reportLogImproperUse(source, url, body) {
        if (settings.logLevel === 'silent') return;
        stats.logImproperUseBlocked++;

        let opName = 'LogImproperUse';
        let opType = '';
        let variableNames = [];
        try {
            const parsed = JSON.parse(body);
            if (parsed && typeof parsed === 'object') {
                if (typeof parsed.operationName === 'string' && parsed.operationName) {
                    opName = parsed.operationName;
                }
                if (parsed.variables && typeof parsed.variables === 'object') {
                    variableNames = Object.keys(parsed.variables);
                }
            }
        } catch {}
        try {
            const opTypeMatch = /^\s*(mutation|query|subscription)/i.exec(body);
            if (opTypeMatch) opType = opTypeMatch[1].toLowerCase();
        } catch {}

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
    // DOM / SCRIPT/IFRAME INJECTION BLOCKER
    // ============================================================
    function hookSrcProperty(proto, tag) {
        const desc = Object.getOwnPropertyDescriptor(proto, 'src');
        if (desc && desc.set) {
            Object.defineProperty(proto, 'src', {
                get: desc.get,
                set(val) {
                    if (settings.blockDomElements && isTelemetryUrl(val)) {
                        reportBlock(`<${tag}>.src assignment`, val, { element: tag });
                        return '';
                    }
                    if (settings.logLevel === 'verbose' && val) {
                        const m = matchAnyTelemetryService(val);
                        if (m && !settings.telemetryServices[m.key]) {
                            reportAllow(`<${tag}>.src`, val, `service "${m.label}" disabled`);
                        } else if (m && m.key === 'jitsu' && !settings.suppressJitsu) {
                            reportAllow(`<${tag}>.src`, val, `service "${m.label}" not suppressed`);
                        }
                    }
                    return desc.set.call(this, val);
                },
                configurable: true,
            });
        }
    }
    try { hookSrcProperty(HTMLScriptElement.prototype, 'script'); } catch {}
    try { hookSrcProperty(HTMLIFrameElement.prototype, 'iframe'); } catch {}

    try {
        const origSetAttribute = Element.prototype.setAttribute;
        Element.prototype.setAttribute = function (name, value) {
            if (settings.blockDomElements &&
                typeof name === 'string' &&
                name.toLowerCase() === 'src' &&
                isTelemetryUrl(value)) {
                reportBlock('setAttribute("src")', value, {
                    element: this.tagName ? this.tagName.toLowerCase() : 'unknown',
                });
                return;
            }
            return origSetAttribute.apply(this, arguments);
        };
    } catch (e) { WARN('setAttribute patch failed', e); }

    try {
        const domObserver = new MutationObserver((mutations) => {
            if (!settings.blockDomElements) return;
            for (const m of mutations) {
                for (const node of m.addedNodes) {
                    if (node.nodeType !== Node.ELEMENT_NODE) continue;
                    const tag = node.tagName.toLowerCase();
                    if (tag === 'script' || tag === 'iframe') {
                        const src = node.src || node.getAttribute('src');
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
            window.WebSocket = function (url, protocols) {
                if (settings.blockWebSockets && isTelemetryUrl(url)) {
                    reportBlock('WebSocket', String(url), { protocols: protocols || '(none)' });
                    const dummy = new EventTarget();
                    dummy.readyState = 3;
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
            };
            window.WebSocket.prototype = OrigWebSocket.prototype;
            VLOG('WebSocket hook installed');
        }
    } catch (e) { WARN('websocket patch failed', e); }

    // ============================================================
    // DARK MODE
    // ============================================================
    const DARK_MODE_STYLE_ID  = '__ul-dark-styles';
    const PARENT_INVERT       = 0.88;
    const CHILD_CONTRAST      = 1.3158;
    const DARK_BASE_COLOR     = '#1f1f1f';
    const DARK_PRE_INVERT_BG  = '#ffffff';

    function ensureDarkModeStyles() {
        if (document.getElementById(DARK_MODE_STYLE_ID)) return;
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
        (document.head || document.documentElement).appendChild(style);
    }

    function applyDarkMode() {
        try {
            const html = document.documentElement;
            if (!html) return;
            if (settings.darkMode) html.classList.add('ul-dark-mode');
            else html.classList.remove('ul-dark-mode');
        } catch (e) { WARN('dark mode apply failed', e); }
    }

    ensureDarkModeStyles();
    applyDarkMode();

    try {
        const obs = new MutationObserver(() => {
            const html = document.documentElement;
            if (!html) return;
            const has = html.classList.contains('ul-dark-mode');
            if (settings.darkMode && !has) html.classList.add('ul-dark-mode');
            else if (!settings.darkMode && has) html.classList.remove('ul-dark-mode');
        });
        obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    } catch {}

    setInterval(() => {
        const html = document.documentElement;
        if (!html) return;
        const has = html.classList.contains('ul-dark-mode');
        if (settings.darkMode && !has) html.classList.add('ul-dark-mode');
        else if (!settings.darkMode && has) html.classList.remove('ul-dark-mode');
    }, 3000);

    // ============================================================
    // LOGIMPROPERUSE DETECTION
    // ============================================================
    function bodyLooksLikeLogImproperUse(body) {
        if (body == null) return false;
        if (typeof body !== 'string') {
            try {
                if (body instanceof URLSearchParams) body = body.toString();
                else return false;
            } catch { return false; }
        }
        if (!/LogImproperUse|logImproperUse/i.test(body)) return false;
        try {
            const parsed = JSON.parse(body);
            const op = parsed && (parsed.operationName || '');
            if (/LogImproperUse/i.test(op)) return true;
            const q = parsed && parsed.query;
            if (typeof q === 'string' && /LogImproperUse|logImproperUse/i.test(q)) return true;
        } catch { /* not JSON */ }
        return true;
    }

    function logImproperUseSyntheticResponse() {
        const body = JSON.stringify({ data: { logImproperUse: true } });
        return new Response(body, {
            status: 200, statusText: 'OK',
            headers: { 'Content-Type': 'application/json' }
        });
    }

    // ============================================================
    // TIME BOOST & MANUAL "ADD TIME" QUESTION BUTTON
    // ============================================================
    const QUIZ_OP              = 'AnswerProgressQuizQuestion';
    const GROUP_OP             = 'CompleteProgressQuizGroup';
    const VIDEO_OP             = 'CompleteVideoLesson';
    const MANUAL_BUTTON_ID     = 'us-timespent-btn';
    const MANUAL_TRIGGER_LABEL = 'submit';

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
    const toISODuration = toIso;

    function formatSeconds(seconds) {
        seconds = round3(seconds);
        if (seconds < 60) return seconds + 's';
        const mm = Math.floor(seconds / 60);
        const ss = round3(seconds % 60);
        if (mm < 60) return `${mm}m ${ss}s`;
        const hh = Math.floor(mm / 60);
        return `${hh}h ${mm % 60}m ${ss}s`;
    }

    function parseDurationToSeconds(raw) {
        if (raw == null) return null;
        const s = String(raw).trim();
        if (!s) return null;

        // ISO-8601
        if (/^P/i.test(s)) {
            const m = /^PT(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?$/i.exec(s);
            if (!m) return null;
            const h  = parseFloat(m[1] || 0);
            const mi = parseFloat(m[2] || 0);
            const se = parseFloat(m[3] || 0);
            return h * 3600 + mi * 60 + se;
        }

        // mm:ss or hh:mm:ss
        if (/^\d+(:[0-5]?\d){1,2}$/.test(s)) {
            const parts = s.split(':').map(Number);
            let secs = 0;
            for (const p of parts) secs = secs * 60 + p;
            return secs;
        }

        // "1h 30m 20s", "90s", "1.5m", "2 min"
        const unitRe = /(\d+(?:\.\d+)?)\s*(hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)\b/gi;
        let total = 0;
        let matched = false;
        let m;
        while ((m = unitRe.exec(s)) !== null) {
            matched = true;
            const value = parseFloat(m[1]);
            const unit  = m[2].toLowerCase();
            if (unit[0] === 'h')      total += value * 3600;
            else if (unit[0] === 'm') total += value * 60;
            else                      total += value;
        }
        if (matched) return total;

        // Bare number => seconds
        if (/^\d+(\.\d+)?$/.test(s)) return parseFloat(s);

        return null;
    }
    const parseISODuration = parseDurationToSeconds;

    function pickExtraSeconds() {
        const min = Math.min(settings.extraSecondsMin, settings.extraSecondsMax);
        const max = Math.max(settings.extraSecondsMin, settings.extraSecondsMax);
        if (min === max) return min;
        return Math.floor(min + Math.random() * (max - min + 1));
    }

    /* ------------------------------------------------------------
     * Manual "Add Time" Button UI & Styles
     * ------------------------------------------------------------ */
    const MANUAL_BUTTON_CSS = `
#${MANUAL_BUTTON_ID} {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    margin: 0 0 0 8px !important;
    padding: 10px 14px;
    border-radius: 8px;
    border: 1px solid #cbd5e1;
    background: #f8fafc;
    color: #0f172a;
    font-family: inherit;
    font-size: 14px;
    font-weight: 600;
    line-height: 1;
    cursor: pointer;
    white-space: nowrap;
    vertical-align: middle;
    transition: background .15s, border-color .15s, color .15s;
    box-sizing: border-box;
    min-width: 110px;
    user-select: none;
    outline: none;
}
#${MANUAL_BUTTON_ID}:hover { background: #eef2f7; }
#${MANUAL_BUTTON_ID}.us-active {
    border-color: #2563eb;
    background: #eff6ff;
    color: #1d4ed8;
}
#${MANUAL_BUTTON_ID}.us-editing {
    padding: 0;
    background: #ffffff;
    border-color: #2563eb;
    box-shadow: 0 0 0 3px rgba(37,99,235,0.15);
    cursor: text;
}
#${MANUAL_BUTTON_ID}.us-editing:hover { background: #ffffff; }
#${MANUAL_BUTTON_ID} input.us-input {
    border: none;
    outline: none;
    background: transparent;
    font: inherit;
    color: inherit;
    padding: 10px 14px;
    width: 110px;
    text-align: center;
    box-sizing: border-box;
    letter-spacing: 0.3px;
}
#${MANUAL_BUTTON_ID}.us-reset {
    animation: us-pop .4s ease;
}
@keyframes us-pop {
    0%   { transform: scale(1);    }
    40%  { transform: scale(1.08); }
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

    function findSubmitButton() {
        const buttons = document.querySelectorAll('button[type="submit"]');
        for (const b of buttons) {
            const t = (b.textContent || '').trim().toLowerCase();
            if (t === MANUAL_TRIGGER_LABEL) return b;
        }
        const allButtons = document.querySelectorAll('button');
        for (const b of allButtons) {
            const t = (b.textContent || '').trim().toLowerCase();
            if (t === MANUAL_TRIGGER_LABEL) return b;
        }
        return null;
    }

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
            btn.classList.remove('us-reset');
            void btn.offsetWidth;
            btn.classList.add('us-reset');
            setTimeout(() => btn.classList.remove('us-reset'), 500);
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

        ['click', 'mousedown', 'mouseup'].forEach((ev) =>
            input.addEventListener(ev, (e) => e.stopPropagation())
        );
        input.addEventListener('keydown', onInputKeyDown);
        input.addEventListener('blur',    onInputBlur);

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
            removeButton();
            queuedSeconds = null;
            editing = false;
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
        if (!settings.manualTimeButtonEnabled) return;
        if (mutations && Array.isArray(mutations)) {
            let onlyOurHost = true;
            for (let i = 0; i < mutations.length; i++) {
                const target = mutations[i].target;
                if (!target || (!target.id?.includes('__ul-') && (!target.closest || !target.closest('#__ul-heroui-host')))) {
                    onlyOurHost = false;
                    break;
                }
            }
            if (onlyOurHost) return;
        }
        if (manualBtnScheduled) return;
        manualBtnScheduled = true;
        setTimeout(() => {
            manualBtnScheduled = false;
            ensureButton();
        }, 150);
    }

    function initManualButtonObserver() {
        try {
            const observer = new MutationObserver(scheduleEnsureButton);
            observer.observe(document.documentElement || document, {
                childList: true,
                subtree: true,
            });
            setInterval(ensureButton, 4000);
        } catch (e) {
            WARN('mutation observer for manual button failed', e);
        }
    }

    /* ------------------------------------------------------------
     * Body Rewriting & Network Injection
     * ------------------------------------------------------------ */
    function maybeBumpTimeSpent(body, source) {
        const boostActive = settings.timeBoostEnabled || queuedSeconds !== null;
        const videoActive = settings.fullVideoWatchedEnabled;
        if (!boostActive && !videoActive) return { body, changed: false };
        if (typeof body !== 'string')    return { body, changed: false };

        const hasQuiz  = boostActive && body.includes(QUIZ_OP);
        const hasGroup = boostActive && body.includes(GROUP_OP);
        const hasVideo = videoActive && body.includes(VIDEO_OP);
        if (!hasQuiz && !hasGroup && !hasVideo) return { body, changed: false };

        let json;
        try { json = JSON.parse(body); }
        catch { return { body, changed: false }; }

        let changed = false;
        let manualResetNeeded = false;

        const patch = (obj) => {
            if (!obj || !obj.variables) return;

            const opName = obj.operationName || '';
            const isVideo = opName === VIDEO_OP ||
                (typeof obj.query === 'string' && obj.query.includes(VIDEO_OP)) ||
                (typeof obj.mutation === 'string' && obj.mutation.includes(VIDEO_OP));

            if (videoActive && isVideo) {
                const beforePercent = obj.variables.percentWatched;
                const targetPercent = (typeof beforePercent === 'string') ? '1' : 1;
                obj.variables.percentWatched = targetPercent;
                stats.seen++;
                stats.videosMaxed = (stats.videosMaxed || 0) + 1;
                changed = true;

                LOG(`[${source}] ${VIDEO_OP}: percentWatched ${beforePercent} → ${targetPercent} (lessonId: ${obj.variables.lessonId || 'unknown'})`);
                nativeConsole.log(
                    `[UpLearn Video] ${VIDEO_OP} lessonId=${obj.variables.lessonId || 'unknown'} original percentWatched=${beforePercent} → ${targetPercent}`
                );
            }

            if (boostActive && opName === QUIZ_OP && typeof obj.variables.timeSpent === 'string') {
                const total = parseDurationToSeconds(obj.variables.timeSpent);
                if (total === null) return;
                const before = obj.variables.timeSpent;

                let extra = 0;
                let isManual = false;

                if (queuedSeconds !== null) {
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

                obj.variables.timeSpent = toIso(total + extra);
                accumulatedExtraSeconds  += extra;
                accumulatedQuestionCount += 1;
                stats.seen++;
                stats.boosted++;
                if (isManual) {
                    stats.manualBoosted = (stats.manualBoosted || 0) + 1;
                    manualResetNeeded = true;
                }
                changed = true;

                if (isManual) {
                    LOG(`[${source}] ${QUIZ_OP} (manual time): ${before} (+${formatSeconds(queuedSeconds)}${settings.manualTimeStacksWithAuto && settings.timeBoostEnabled ? ' + auto' : ''}) → ${obj.variables.timeSpent} ` +
                        `(accumulated ${accumulatedExtraSeconds}s / ${accumulatedQuestionCount} q)`);
                    nativeConsole.log(
                        '[UpLearn timeSpent] original=' + before +
                        ' (+' + formatSeconds(extra) + ')' +
                        ' → ' + obj.variables.timeSpent
                    );
                } else {
                    LOG(`[${source}] ${QUIZ_OP}: ${before} → ${obj.variables.timeSpent} ` +
                        `(+${extra}s, accumulated ${accumulatedExtraSeconds}s / ${accumulatedQuestionCount} q)`);
                    VLOG('boost roll', {
                        rolled: extra,
                        range: `[${settings.extraSecondsMin}–${settings.extraSecondsMax}]`,
                        newAccumulated: accumulatedExtraSeconds,
                        questionCount: accumulatedQuestionCount,
                    });
                }
            }
            else if (boostActive && opName === GROUP_OP && typeof obj.variables.timeSpent === 'string') {
                if (!settings.timeBoostEnabled && accumulatedExtraSeconds === 0) return;
                const total = parseDurationToSeconds(obj.variables.timeSpent);
                if (total === null) return;
                const before = obj.variables.timeSpent;
                const bonus  = accumulatedExtraSeconds;
                const count  = accumulatedQuestionCount;
                obj.variables.timeSpent = toIso(total + bonus);
                stats.groupExtra += bonus;
                changed = true;
                LOG(`[${source}] ${GROUP_OP}: ${before} → ${obj.variables.timeSpent} ` +
                    `(+${bonus}s from ${count} question(s))`);
                VLOG('group bonus applied; per-question accumulator reset', { bonus, count });
                accumulatedExtraSeconds  = 0;
                accumulatedQuestionCount = 0;
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
    if (origFetch) {
        window.fetch = function (input, init) {
            const self = this;
            try {
                const url = typeof input === 'string' ? input
                          : (input && input.url) ? input.url
                          : String(input);
                const method = ((init && init.method) || (input && input.method) || 'GET').toUpperCase();

                // ---- Telemetry block ----
                if (isTelemetryUrl(url)) {
                    stats.blocked++;
                    const m = matchTelemetryService(url);
                    const isJitsu = m && m.key === 'jitsu';

                    const doBlock = (capturedBody) => {
                        if (isJitsu) {
                            stats.jitsuPackets++;
                            reportJitsuPacket('fetch · BLOCKED', url, capturedBody);
                        } else {
                            reportBlock('fetch', url, { method, body: capturedBody });
                        }
                        return new Response('', {
                            status: 200, statusText: 'OK',
                            headers: { 'Content-Type': 'application/json' },
                        });
                    };

                    let bodyStr = init && typeof init.body === 'string' ? init.body : null;
                    if (bodyStr == null && input instanceof Request) {
                        try {
                            const ct = (input.headers.get('content-type') || '').toLowerCase();
                            if (ct.includes('application/json') || ct.includes('text/')) {
                                return input.clone().text().then(doBlock);
                            }
                        } catch {}
                    }
                    return Promise.resolve(doBlock(bodyStr));
                }

                // ---- Jitsu allowed: log the packet, then pass through ----
                if (isJitsuUrl(url)) {
                    stats.jitsuPackets++;
                    const doLogAndPass = (capturedBody) => {
                        reportJitsuPacket('fetch', url, capturedBody);
                        return origFetch.call(self, input, init);
                    };
                    let bodyStr = init && typeof init.body === 'string' ? init.body : null;
                    if (bodyStr == null && input instanceof Request) {
                        try {
                            const ct = (input.headers.get('content-type') || '').toLowerCase();
                            if (ct.includes('application/json') || ct.includes('text/')) {
                                return input.clone().text().then(doLogAndPass);
                            }
                        } catch {}
                    }
                    return doLogAndPass(bodyStr);
                }

                if (settings.logLevel === 'verbose') {
                    const m = matchAnyTelemetryService(url);
                    if (m && !settings.telemetryServices[m.key]) {
                        reportAllow('fetch', url, `service "${m.label}" disabled in settings`);
                    }
                }

                if (method === 'POST' && isTargetApi(url)) {
                    stats.apiPosts++;
                    let body = init && typeof init.body === 'string' ? init.body : null;

                    if (body == null && input instanceof Request) {
                        const ct = (input.headers.get('content-type') || '').toLowerCase();
                        if (ct.includes('application/json')) {
                            const passInit = init;
                            return input.clone().text().then((text) => {
                                if (settings.blockLogImproperUse && bodyLooksLikeLogImproperUse(text)) {
                                    reportLogImproperUse('fetch · Request body', url, text);
                                    stats.blocked++;
                                    return logImproperUseSyntheticResponse();
                                }
                                const { body: newBody, changed } = maybeBumpTimeSpent(text, 'fetch-Req');
                                const newReq = new Request(input, {
                                    body: changed ? newBody : text,
                                    method: input.method
                                });
                                return origFetch.call(self, newReq, passInit);
                            });
                        }
                    }

                    if (body != null && settings.blockLogImproperUse && bodyLooksLikeLogImproperUse(body)) {
                        reportLogImproperUse('fetch', url, body);
                        stats.blocked++;
                        return Promise.resolve(logImproperUseSyntheticResponse());
                    }

                    if (body != null) {
                        const { body: newBody, changed } = maybeBumpTimeSpent(body, 'fetch');
                        if (changed) init = Object.assign({}, init || {}, { body: newBody });
                    }
                } else if (settings.logLevel === 'verbose' && isTargetApi(url)) {
                    VLOG('API request (non-POST, passing through):', method, url);
                }
            } catch (e) {
                WARN('fetch interceptor error:', e);
            }

            return origFetch.call(self, input, init);
        };
        VLOG('fetch hook installed');
    }

    // ============================================================
    // XHR INTERCEPTOR
    // ============================================================
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
                const method = (this.__ul_method || '').toUpperCase();

                // ---- Telemetry block ----
                if (isTelemetryUrl(this.__ul_url)) {
                    let bodyStr = null;
                    try {
                        if (typeof body === 'string') bodyStr = body;
                        else if (body instanceof Document || body instanceof Blob || body instanceof FormData) {
                            bodyStr = `(${body.constructor ? body.constructor.name : 'non-string'} body)`;
                        } else if (body != null) {
                            bodyStr = `(${typeof body} body)`;
                        }
                    } catch {}
                    const m = matchTelemetryService(this.__ul_url);
                    const isJitsu = m && m.key === 'jitsu';
                    if (isJitsu) {
                        stats.jitsuPackets++;
                        reportJitsuPacket('XHR · BLOCKED', this.__ul_url, bodyStr);
                    } else {
                        reportBlock('XHR', this.__ul_url, { method, body: bodyStr });
                    }
                    stats.blocked++;
                    const self = this;
                    Object.defineProperty(self, 'readyState',   { value: 4, configurable: true });
                    Object.defineProperty(self, 'status',       { value: 200, configurable: true });
                    Object.defineProperty(self, 'statusText',   { value: 'OK', configurable: true });
                    Object.defineProperty(self, 'responseText', { value: '{}', configurable: true });
                    Object.defineProperty(self, 'response', {
                        get() { return self.responseType === 'json' ? {} : '{}'; },
                        configurable: true
                    });
                    setTimeout(() => {
                        try {
                            self.dispatchEvent(new Event('readystatechange'));
                            self.dispatchEvent(new ProgressEvent('load'));
                            self.dispatchEvent(new ProgressEvent('loadend'));
                        } catch {}
                    }, 0);
                    return;
                }

                // ---- Jitsu allowed: log packet, then pass through ----
                if (isJitsuUrl(this.__ul_url)) {
                    stats.jitsuPackets++;
                    let bodyStr = null;
                    try {
                        if (typeof body === 'string') bodyStr = body;
                        else if (body != null) bodyStr = `(${body.constructor ? body.constructor.name : typeof body} body)`;
                    } catch {}
                    reportJitsuPacket('XHR', this.__ul_url, bodyStr);
                    // fall through to origSend
                }

                if (settings.logLevel === 'verbose') {
                    const m = matchAnyTelemetryService(this.__ul_url);
                    if (m && !settings.telemetryServices[m.key]) {
                        reportAllow('XHR', this.__ul_url, `service "${m.label}" disabled in settings`);
                    }
                }

                if (method === 'POST' && isTargetApi(this.__ul_url)) {
                    stats.apiPosts++;

                    if (settings.blockLogImproperUse && bodyLooksLikeLogImproperUse(body)) {
                        reportLogImproperUse('XHR', this.__ul_url,
                            typeof body === 'string' ? body : '(non-string body)');
                        stats.blocked++;
                        const self = this;
                        const payload = JSON.stringify({ data: { logImproperUse: true } });
                        Object.defineProperty(self, 'readyState',   { value: 4,       configurable: true });
                        Object.defineProperty(self, 'status',       { value: 200,     configurable: true });
                        Object.defineProperty(self, 'statusText',   { value: 'OK',    configurable: true });
                        Object.defineProperty(self, 'responseText', { value: payload, configurable: true });
                        Object.defineProperty(self, 'response', {
                            get() {
                                if (self.responseType === 'json') return { data: { logImproperUse: true } };
                                return payload;
                            }, configurable: true
                        });
                        setTimeout(() => {
                            try {
                                self.dispatchEvent(new Event('readystatechange'));
                                self.dispatchEvent(new ProgressEvent('load'));
                                self.dispatchEvent(new ProgressEvent('loadend'));
                            } catch {}
                        }, 0);
                        return;
                    }

                    if (typeof body === 'string') {
                        const { body: newBody, changed } = maybeBumpTimeSpent(body, 'xhr');
                        if (changed) body = newBody;
                    }
                }
            } catch (e) {
                WARN('xhr interceptor error:', e);
            }
            return origSend.call(this, body);
        };
        VLOG('XHR hook installed');
    }

    // ============================================================
    // SEND-BEACON INTERCEPTOR
    // ============================================================
    if (navigator.sendBeacon) {
        const origBeacon = navigator.sendBeacon.bind(navigator);
        navigator.sendBeacon = function (url, data) {
            try {
                if (settings.blockSendBeacon && isTelemetryUrl(url)) {
                    let bodyStr = null;
                    try {
                        if (typeof data === 'string') bodyStr = data;
                        else if (data instanceof Blob) bodyStr = `(Blob · ${data.size} bytes)`;
                        else if (data instanceof ArrayBuffer) bodyStr = `(ArrayBuffer · ${data.byteLength} bytes)`;
                        else if (data != null) bodyStr = `(${typeof data} body)`;
                    } catch {}
                    const m = matchTelemetryService(url);
                    const isJitsu = m && m.key === 'jitsu';
                    if (isJitsu) {
                        stats.jitsuPackets++;
                        reportJitsuPacket('sendBeacon · BLOCKED', String(url), bodyStr);
                    } else {
                        reportBlock('sendBeacon', String(url), { body: bodyStr });
                    }
                    stats.blocked++;
                    return true;
                }

                if (isJitsuUrl(url)) {
                    stats.jitsuPackets++;
                    let bodyStr = null;
                    try {
                        if (typeof data === 'string') bodyStr = data;
                        else if (data instanceof Blob) bodyStr = `(Blob · ${data.size} bytes)`;
                        else if (data instanceof ArrayBuffer) bodyStr = `(ArrayBuffer · ${data.byteLength} bytes)`;
                        else if (data != null) bodyStr = `(${typeof data} body)`;
                    } catch {}
                    reportJitsuPacket('sendBeacon', String(url), bodyStr);
                    // fall through
                }

                if (settings.logLevel === 'verbose') {
                    const m = matchAnyTelemetryService(url);
                    if (m && !settings.telemetryServices[m.key]) {
                        reportAllow('sendBeacon', url, `service "${m.label}" disabled in settings`);
                    }
                }
            } catch {}
            return origBeacon(url, data);
        };
        VLOG('sendBeacon hook installed');
    }

    // ============================================================
    // VISIBILITY / FOCUS SPOOFING
    // ============================================================
    const ORIG_VIS = (() => {
        try {
            const d = Object.getOwnPropertyDescriptor(Document.prototype, 'visibilityState')
                   || Object.getOwnPropertyDescriptor(HTMLDocument.prototype, 'visibilityState');
            return d && d.get ? d.get : null;
        } catch { return null; }
    })();
    const ORIG_HIDDEN = (() => {
        try {
            const d = Object.getOwnPropertyDescriptor(Document.prototype, 'hidden')
                   || Object.getOwnPropertyDescriptor(HTMLDocument.prototype, 'hidden');
            return d && d.get ? d.get : null;
        } catch { return null; }
    })();
    const ORIG_HAS_FOCUS = document.hasFocus ? document.hasFocus.bind(document) : (() => true);

    function patchVisibilityProps() {
        try {
            Object.defineProperty(document, 'visibilityState', {
                get: () => settings.spoofVisibility ? 'visible'
                                                    : (ORIG_VIS ? ORIG_VIS.call(document) : 'visible'),
                configurable: true
            });
            Object.defineProperty(document, 'webkitVisibilityState', {
                get: () => settings.spoofVisibility ? 'visible'
                                                    : (ORIG_VIS ? ORIG_VIS.call(document) : 'visible'),
                configurable: true
            });
            Object.defineProperty(document, 'hidden', {
                get: () => settings.spoofVisibility ? false
                                                    : (ORIG_HIDDEN ? ORIG_HIDDEN.call(document) : false),
                configurable: true
            });
            Object.defineProperty(document, 'webkitHidden', {
                get: () => settings.spoofVisibility ? false
                                                    : (ORIG_HIDDEN ? ORIG_HIDDEN.call(document) : false),
                configurable: true
            });
        } catch (e) { WARN('visibility patch failed', e); }
    }
    patchVisibilityProps();

    function installHasFocusPatch() {
        try {
            document.hasFocus = function () {
                return settings.spoofVisibility ? true : ORIG_HAS_FOCUS();
            };
        } catch {}
    }
    installHasFocusPatch();
    VLOG('visibility/focus spoofing installed (live-toggleable)');

    const SUPPRESSED_EVENTS = new Set([
        'visibilitychange', 'webkitvisibilitychange', 'blur', 'focusout', 'pagehide'
    ]);

    function wrapAddEventListener(target) {
        const targetName = target === window ? 'window' : 'document';
        const origAdd = target.addEventListener;
        target.addEventListener = function (type, listener, options) {
            if (settings.spoofVisibility && SUPPRESSED_EVENTS.has(type)) {
                VLOG(`suppressed "${type}" listener registration on ${targetName}`);
                return;
            }
            return origAdd.call(this, type, listener, options);
        };
    }
    wrapAddEventListener(window);
    wrapAddEventListener(document);

    try {
        const origProtoAdd = EventTarget.prototype.addEventListener;
        EventTarget.prototype.addEventListener = function (type, listener, options) {
            if (settings.spoofVisibility &&
                (this === window || this === document) &&
                SUPPRESSED_EVENTS.has(type)) {
                VLOG(`suppressed "${type}" listener via EventTarget prototype`);
                return;
            }
            return origProtoAdd.call(this, type, listener, options);
        };
    } catch {}

    ['onblur', 'onfocusout', 'onpagehide', 'onvisibilitychange'].forEach((prop) => {
        [window, document].forEach((target) => {
            try {
                const desc = Object.getOwnPropertyDescriptor(target, prop);
                if (!desc) return;
                Object.defineProperty(target, prop, {
                    get() {
                        if (settings.spoofVisibility) return null;
                        return desc.get ? desc.get.call(this) : null;
                    },
                    set(v) {
                        if (settings.spoofVisibility) {
                            VLOG(`suppressed assignment to "${prop}"`);
                            return;
                        }
                        if (desc.set) desc.set.call(this, v);
                    },
                    configurable: true,
                });
            } catch {}
        });
    });

    const __ul_seenKilled = new Set();
    const KILL = (e) => {
        if (!settings.spoofVisibility) return;
        if (settings.logLevel === 'verbose' && !__ul_seenKilled.has(e.type)) {
            __ul_seenKilled.add(e.type);
            VLOG(`intercepted "${e.type}" event (further ${e.type}s will be silenced from logs)`);
        }
        e.stopImmediatePropagation();
        e.stopPropagation();
    };
    ['visibilitychange', 'webkitvisibilitychange', 'blur', 'focusout', 'pagehide'].forEach((evt) => {
        try {
            EventTarget.prototype.addEventListener.call(window,   evt, KILL, true);
            EventTarget.prototype.addEventListener.call(document, evt, KILL, true);
        } catch {}
    });

    setInterval(() => {
        patchVisibilityProps();
        installHasFocusPatch();
    }, 5000);

    // ============================================================
    // AUTO FULLSCREEN BLOCKER
    // ============================================================
    const FULLSCREEN_METHODS = [
        'requestFullscreen', 'webkitRequestFullscreen', 'webkitRequestFullScreen',
        'mozRequestFullScreen', 'msRequestFullscreen',
    ];

    function installFullscreenBlocker() {
        FULLSCREEN_METHODS.forEach((name) => {
            const proto = Element.prototype;
            if (!proto[name] || proto[name].__ul_patched) return;
            const orig = proto[name];
            const wrapped = function () {
                if (settings.disableAutoFullscreen) {
                    stats.fullscreenBlocked++;
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
            wrapped.__ul_patched = true;
            wrapped.__ul_orig    = orig;
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
        { name: 'Emerald', hex: '#16a34a' },
        { name: 'Blue', hex: '#006fee' },
        { name: 'Purple', hex: '#7828c8' },
        { name: 'Cyan', hex: '#06b6d4' },
        { name: 'Amber', hex: '#f5a524' },
        { name: 'Rose', hex: '#f43f5e' },
    ];

    function ensureUIHost() {
        if (uiShadowRoot && document.getElementById('__ul-heroui-host')) {
            return uiShadowRoot;
        }

        let host = document.getElementById('__ul-heroui-host');
        if (!host) {
            host = document.createElement('div');
            host.id = '__ul-heroui-host';
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
            uiShadowRoot.appendChild(styleEl);
        }
        styleEl.textContent = getHeroUIStyles();

        let container = uiShadowRoot.getElementById('__ul-root');
        if (!container) {
            container = document.createElement('div');
            container.id = '__ul-root';
            container.className = 'heroui-root';
            uiShadowRoot.appendChild(container);
        }
        uiContainerEl = container;

        mountReactUI();
        return uiShadowRoot;
    }

    function getHeroUIStyles() {
        return `
            /* HeroUI v3 CSS Architecture & OKLCH Theming */
            :host, .heroui-root {
                --ease-smooth: cubic-bezier(0.4, 0, 0.2, 1);
                --ease-out-quad: cubic-bezier(0.25, 0.46, 0.45, 0.94);
                --ease-out-quart: cubic-bezier(0.165, 0.84, 0.44, 1);
                --ease-out-fluid: cubic-bezier(0.16, 1, 0.3, 1);
                --cursor-interactive: pointer;
                --cursor-disabled: not-allowed;
                --disabled-opacity: 0.5;
                --focus: var(--accent);
                --radius-sm: 6px;
                --radius-md: 9px;
                --radius-lg: 13px;
                --radius-xl: 18px;
                --radius-2xl: 22px;
                --radius-3xl: 26px;
                --radius-full: 9999px;
                --field-radius: 11px;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
                font-feature-settings: "cv02", "cv03", "cv04", "cv11";
                -webkit-font-smoothing: antialiased;
                box-sizing: border-box;
            }

            *, *::before, *::after {
                box-sizing: inherit;
            }

            .heroui-root[data-theme="dark"] {
                --background: oklch(12% 0.005 285.823);
                --foreground: oklch(0.985 0 0);
                --surface: oklch(18% 0.006 285.89);
                --surface-foreground: var(--foreground);
                --surface-secondary: oklch(21.5% 0.006 286.14);
                --surface-secondary-foreground: var(--foreground);
                --surface-tertiary: oklch(25.5% 0.006 286.14);
                --overlay: oklch(16.5% 0.006 285.89);
                --overlay-foreground: var(--foreground);
                --muted: oklch(72% 0.015 286.067);
                --muted-foreground: oklch(56% 0.015 286);
                --default: oklch(27.5% 0.006 286.033);
                --default-foreground: oklch(0.98 0 0);
                --default-hover: oklch(33% 0.008 286);
                --default-soft: oklch(27.5% 0.006 286.033 / 0.55);
                --accent: #16a34a;
                --accent-hover: color-mix(in srgb, var(--accent) 84%, white);
                --accent-foreground: #ffffff;
                --accent-soft: color-mix(in srgb, var(--accent) 18%, transparent);
                --accent-soft-foreground: var(--accent);
                --success: #22c55e;
                --success-foreground: #ffffff;
                --success-soft: rgba(34, 197, 94, 0.16);
                --warning: #f59e0b;
                --warning-foreground: #111827;
                --warning-soft: rgba(245, 158, 11, 0.16);
                --danger: #ef4444;
                --danger-hover: #dc2626;
                --danger-foreground: #ffffff;
                --danger-soft: rgba(239, 68, 68, 0.16);
                --danger-soft-foreground: #ef4444;
                --border: oklch(28% 0.006 286.033);
                --border-hover: oklch(38% 0.008 286.033);
                --separator: oklch(24% 0.006 286.033);
                --field-background: oklch(14% 0.005 285.89);
                --field-foreground: var(--foreground);
                --field-border: oklch(30% 0.006 286.033);
                --backdrop: rgba(0, 0, 0, 0.68);
                --shadow-overlay: 0 24px 70px -12px rgba(0, 0, 0, 0.85), 0 0 0 1px rgba(255, 255, 255, 0.08);
                --shadow-surface: 0 4px 18px -2px rgba(0, 0, 0, 0.45);
                --shadow-pill: 0 10px 32px -4px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(255, 255, 255, 0.12);
                color-scheme: dark;
            }

            .heroui-root[data-theme="light"] {
                --background: oklch(0.985 0 0);
                --foreground: oklch(0.18 0.005 285.89);
                --surface: #ffffff;
                --surface-foreground: var(--foreground);
                --surface-secondary: #f8fafc;
                --surface-secondary-foreground: var(--foreground);
                --surface-tertiary: #f1f5f9;
                --overlay: #ffffff;
                --overlay-foreground: var(--foreground);
                --muted: oklch(50% 0.015 286);
                --muted-foreground: oklch(65% 0.015 286);
                --default: #e2e8f0;
                --default-foreground: #0f172a;
                --default-hover: #cbd5e1;
                --default-soft: rgba(226, 232, 240, 0.6);
                --accent: #16a34a;
                --accent-hover: color-mix(in srgb, var(--accent) 84%, black);
                --accent-foreground: #ffffff;
                --accent-soft: color-mix(in srgb, var(--accent) 14%, transparent);
                --accent-soft-foreground: var(--accent);
                --success: #16a34a;
                --success-foreground: #ffffff;
                --success-soft: rgba(22, 163, 74, 0.14);
                --warning: #d97706;
                --warning-foreground: #ffffff;
                --warning-soft: rgba(217, 119, 6, 0.14);
                --danger: #dc2626;
                --danger-hover: #b91c1c;
                --danger-foreground: #ffffff;
                --danger-soft: rgba(220, 38, 38, 0.12);
                --danger-soft-foreground: #dc2626;
                --border: #e2e8f0;
                --border-hover: #cbd5e1;
                --separator: #e2e8f0;
                --field-background: #ffffff;
                --field-foreground: var(--foreground);
                --field-border: #cbd5e1;
                --backdrop: rgba(15, 23, 42, 0.52);
                --shadow-overlay: 0 24px 64px -12px rgba(15, 23, 42, 0.22), 0 0 0 1px rgba(15, 23, 42, 0.08);
                --shadow-surface: 0 4px 16px -2px rgba(15, 23, 42, 0.06);
                --shadow-pill: 0 10px 32px -4px rgba(15, 23, 42, 0.16), 0 0 0 1px rgba(15, 23, 42, 0.08);
                color-scheme: light;
            }

            /* Floating Status Pill Component (Shape-Shifting) */
            .heroui-pill {
                position: fixed;
                z-index: 2147483646;
                display: flex;
                align-items: center;
                gap: 10px;
                padding: 6px 8px 6px 14px;
                border-radius: var(--radius-full);
                background: var(--surface);
                color: var(--foreground);
                border: 1px solid var(--border);
                box-shadow: var(--shadow-pill);
                transform: translateZ(0);
                user-select: none;
                font-size: 13px;
                font-weight: 500;
                line-height: 1.3;
                pointer-events: auto;
                cursor: pointer;
                transition: transform 200ms var(--ease-out-fluid),
                            box-shadow 200ms var(--ease-out),
                            opacity 150ms ease,
                            width 280ms cubic-bezier(0.16, 1, 0.3, 1),
                            height 280ms cubic-bezier(0.16, 1, 0.3, 1),
                            padding 280ms cubic-bezier(0.16, 1, 0.3, 1),
                            border-radius 280ms cubic-bezier(0.16, 1, 0.3, 1);
            }
            .heroui-pill:hover {
                transform: translateY(-2px) scale(1.03);
                box-shadow: 0 14px 40px -4px rgba(0, 0, 0, 0.45), 0 0 0 1px var(--border-hover);
            }
            .heroui-pill:active {
                transform: scale(0.96);
            }

            /* Minimal Mode: Compact circular button (Default) */
            .heroui-pill--minimal {
                width: 44px;
                height: 44px;
                padding: 0;
                border-radius: 50%;
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
            }

            .heroui-pill__main {
                display: flex;
                align-items: center;
                gap: 9px;
                cursor: pointer;
            }
            .heroui-pill__badge {
                display: inline-flex;
                align-items: center;
                gap: 6px;
                padding: 4px 10px;
                border-radius: var(--radius-full);
                font-weight: 600;
                font-size: 11.5px;
                letter-spacing: 0.2px;
                transition: background 150ms, color 150ms;
            }
            .heroui-pill__dot {
                width: 6.5px;
                height: 6.5px;
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
                font-size: 11.5px;
                color: var(--muted);
                font-weight: 500;
                display: flex;
                align-items: center;
                gap: 8px;
            }
            .heroui-pill__stat-item {
                display: inline-flex;
                align-items: center;
                gap: 4px;
            }

            /* Crisp Settings Gear Buttons */
            .heroui-pill__gear {
                position: relative;
                background: transparent;
                border: none;
                color: var(--muted);
                cursor: pointer;
                border-radius: var(--radius-full);
                width: 32px;
                height: 32px;
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 0;
                transition: background-color 150ms, color 150ms, transform 240ms var(--ease-out-fluid);
            }
            .heroui-pill__gear:hover {
                background: var(--default-soft);
                color: var(--foreground);
                transform: rotate(60deg);
            }
            .heroui-pill__gear:active {
                transform: scale(0.92);
            }
            .heroui-pill__indicator-dot {
                position: absolute;
                top: 4px;
                right: 4px;
                width: 8px;
                height: 8px;
                border-radius: 50%;
                background: var(--accent);
                box-shadow: 0 0 8px var(--accent);
                display: none;
                animation: heroui-pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
            }

            /* Modal Overlay & Fluid Open/Close Animations */
            .modal__backdrop {
                position: fixed;
                inset: 0;
                z-index: 2147483647;
                background: var(--backdrop);
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 16px;
                box-sizing: border-box;
                pointer-events: auto;
                animation: heroui-modal-fade-in 200ms cubic-bezier(0.16, 1, 0.3, 1) forwards;
                will-change: opacity;
                transform: translateZ(0);
            }
            .modal__backdrop--closing {
                pointer-events: none !important;
                animation: heroui-modal-fade-out 180ms cubic-bezier(0.4, 0, 0.2, 1) forwards !important;
            }
            @keyframes heroui-modal-fade-in {
                0% { opacity: 0; }
                100% { opacity: 1; }
            }
            @keyframes heroui-modal-fade-out {
                0% { opacity: 1; }
                100% { opacity: 0; }
            }

            .modal__container {
                display: flex;
                align-items: center;
                justify-content: center;
                width: min(1340px, 92vw);
                height: min(920px, 93vh);
            }

            .modal__dialog {
                width: 100%;
                height: 100%;
                max-height: 93vh;
                background: var(--overlay);
                color: var(--foreground);
                border-radius: min(24px, var(--radius-3xl));
                border: 1px solid var(--border);
                box-shadow: var(--shadow-overlay);
                display: flex;
                flex-direction: column;
                overflow: hidden;
                animation: heroui-modal-scale-in 200ms cubic-bezier(0.16, 1, 0.3, 1) forwards;
                will-change: transform, opacity;
                transform: translateZ(0);
            }
            .modal__backdrop--closing .modal__dialog {
                animation: heroui-modal-scale-out 180ms cubic-bezier(0.4, 0, 0.2, 1) forwards !important;
            }
            @keyframes heroui-modal-scale-in {
                0% {
                    opacity: 0;
                    transform: scale(0.96) translateY(10px);
                }
                100% {
                    opacity: 1;
                    transform: scale(1) translateY(0);
                }
            }
            @keyframes heroui-modal-scale-out {
                0% {
                    opacity: 1;
                    transform: scale(1) translateY(0);
                }
                100% {
                    opacity: 0;
                    transform: scale(0.97) translateY(6px);
                }
            }

            /* Modal Header */
            .modal__header {
                display: flex;
                flex-direction: column;
                padding: 20px 28px 14px 28px;
                background: var(--surface);
                border-bottom: 1px solid var(--border);
                flex-shrink: 0;
                gap: 14px;
            }
            .modal__header-top {
                display: flex;
                align-items: center;
                justify-content: space-between;
            }
            .modal__brand {
                display: flex;
                align-items: center;
                gap: 14px;
            }
            .modal__icon {
                width: 42px;
                height: 42px;
                border-radius: var(--radius-xl);
                display: flex;
                align-items: center;
                justify-content: center;
                background: var(--accent-soft);
                color: var(--accent);
                flex-shrink: 0;
                box-shadow: 0 2px 8px -2px rgba(0, 0, 0, 0.15);
            }
            .modal__title-box {
                display: flex;
                align-items: center;
                gap: 10px;
            }
            .modal__heading {
                margin: 0;
                font-size: 17px;
                font-weight: 700;
                letter-spacing: -0.2px;
                color: var(--foreground);
            }
            .modal__close-trigger {
                color: var(--muted) !important;
                border: none !important;
                background: transparent !important;
                flex-shrink: 0;
            }
            .modal__close-trigger:hover {
                background: var(--default-soft) !important;
                color: var(--foreground) !important;
            }

            .modal__footer {
                display: flex;
                align-items: center;
                justify-content: flex-end;
                gap: 10px;
                padding: 14px 24px;
                border-top: 1px solid var(--separator);
                background: var(--surface);
                border-bottom-left-radius: var(--radius-2xl);
                border-bottom-right-radius: var(--radius-2xl);
                flex-shrink: 0;
            }

            /* HeroUI Animated Tabs Component */
            .tabs {
                display: flex;
                flex-direction: column;
            }
            .tabs__list-container {
                display: flex;
                width: 100%;
            }
            .tabs__list {
                position: relative;
                display: flex;
                align-items: center;
                gap: 4px;
                padding: 4px;
                border-radius: var(--radius-xl);
                background: var(--surface-secondary);
                border: 1px solid var(--border);
                overflow-x: auto;
                scrollbar-width: none;
            }
            .tabs__list::-webkit-scrollbar {
                display: none;
            }
            .tabs__indicator {
                position: absolute;
                top: 4px;
                bottom: 4px;
                left: 0;
                border-radius: calc(var(--radius-xl) - 3px);
                background: var(--surface);
                border: 1px solid var(--border);
                box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08), 0 3px 10px -2px rgba(0, 0, 0, 0.18);
                pointer-events: none;
                z-index: 1;
                transition: transform 280ms cubic-bezier(0.16, 1, 0.3, 1),
                            width 280ms cubic-bezier(0.16, 1, 0.3, 1),
                            opacity 160ms ease;
                opacity: 0;
            }
            .tabs__tab {
                position: relative;
                z-index: 2;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                gap: 8px;
                padding: 8px 18px;
                font-size: 13.5px;
                font-weight: 500;
                color: var(--muted);
                background: transparent;
                border: none;
                border-radius: calc(var(--radius-xl) - 3px);
                cursor: pointer;
                transition: color 180ms ease, transform 120ms ease;
                white-space: nowrap;
                user-select: none;
                outline: none;
            }
            .tabs__tab:hover {
                color: var(--foreground);
            }
            .tabs__tab:active {
                transform: scale(0.96);
            }
            .tabs__tab[data-selected="true"] {
                color: var(--foreground);
                font-weight: 600;
            }

            /* Modal Body & Direction-Aware Panel Transitions */
            .modal__body {
                position: relative;
                padding: 16px 24px;
                overflow: hidden;
                flex: 1;
                min-height: 0;
                display: flex;
                flex-direction: column;
            }

            .tabs__panel {
                display: none;
                flex-direction: column;
                gap: 16px;
                width: 100%;
                height: 100%;
                min-height: 0;
                overflow-y: auto;
                padding-right: 6px;
                scrollbar-width: thin;
                scrollbar-color: var(--border) transparent;
                will-change: transform, opacity;
                transform: translateZ(0);
            }
            .tabs__panel::-webkit-scrollbar {
                width: 6px;
            }
            .tabs__panel::-webkit-scrollbar-thumb {
                background: var(--border);
                border-radius: 4px;
            }

            .tabs__panel[data-active="true"] {
                display: flex;
            }
            .tabs__panel[data-active="true"][data-direction="forward"] {
                animation: heroui-tab-forward 200ms cubic-bezier(0.16, 1, 0.3, 1) forwards;
            }
            .tabs__panel[data-active="true"][data-direction="backward"] {
                animation: heroui-tab-backward 200ms cubic-bezier(0.16, 1, 0.3, 1) forwards;
            }

            @keyframes heroui-tab-forward {
                0% {
                    opacity: 0;
                    transform: translateX(16px);
                }
                100% {
                    opacity: 1;
                    transform: translateX(0);
                }
            }

            @keyframes heroui-tab-backward {
                0% {
                    opacity: 0;
                    transform: translateX(-16px);
                }
                100% {
                    opacity: 1;
                    transform: translateX(0);
                }
            }

            /* Responsive 2-Column Dashboard Grid */
            .grid-2col {
                display: grid;
                grid-template-columns: repeat(2, minmax(0, 1fr));
                gap: 12px;
                align-items: start;
                width: 100%;
            }
            .col-stack {
                display: flex;
                flex-direction: column;
                gap: 10px;
                min-width: 0;
            }
            @media (max-width: 960px) {
                .grid-2col {
                    grid-template-columns: 1fr;
                }
            }

            /* Cards Component (Comfortable, Proportional Sizing) */
            .card {
                display: flex;
                flex-direction: column;
                gap: 12px;
                padding: 16px 18px;
                border-radius: var(--radius-xl);
                border: 1px solid var(--border);
                background: var(--surface);
                transition: border-color 150ms;
                flex-shrink: 0;
            }
            .card--compact {
                padding: 12px 15px;
                gap: 8px;
            }
            .card--compact .card__header {
                gap: 2px;
            }
            .card--compact .card__title {
                font-size: 13.5px;
            }
            .card--compact .card__description {
                font-size: 11px;
                line-height: 1.3;
            }
            .card--secondary {
                background: var(--surface-secondary);
            }
            .card__header {
                display: flex;
                flex-direction: column;
                gap: 3px;
            }
            .card__title {
                font-size: 14px;
                font-weight: 600;
                color: var(--foreground);
                display: flex;
                align-items: center;
                justify-content: space-between;
            }
            .card__description {
                font-size: 12.5px;
                color: var(--muted);
                line-height: 1.45;
            }
            .card__content {
                display: flex;
                flex-direction: column;
                gap: 10px;
            }

            /* Core Protection Compact Toggles */
            .core-toggles-list {
                display: flex;
                flex-direction: column;
                gap: 4px !important;
            }
            .core-toggles-list .switch,
            .core-toggle-item.switch {
                padding: 6px 12px;
                border-radius: var(--radius-md);
                gap: 10px;
                min-height: 38px;
                background: var(--surface);
            }
            .core-toggles-list .switch .switch__control,
            .core-toggle-item .switch__control {
                height: 19.5px;
                width: 34px;
            }
            .core-toggles-list .switch .switch__thumb,
            .core-toggle-item .switch__thumb {
                height: 14.5px;
                width: 14.5px;
                margin-left: 2.5px;
            }
            .core-toggles-list .switch[data-selected="true"] .switch__thumb,
            .core-toggle-item[data-selected="true"] .switch__thumb {
                margin-left: calc(34px - 14.5px - 2.5px);
            }
            .core-toggles-list .switch .switch__content,
            .core-toggle-item .switch__content {
                gap: 1px;
            }
            .core-toggles-list .switch [data-slot="label"],
            .core-toggle-item [data-slot="label"] {
                font-size: 12.5px;
                font-weight: 500;
                line-height: 1.25;
                color: var(--foreground);
            }
            .core-toggles-list .switch [data-slot="description"],
            .core-toggle-item [data-slot="description"] {
                font-size: 10.5px;
                color: var(--muted);
                line-height: 1.2;
            }

            /* Switch Component */
            .switch {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 12px;
                cursor: pointer;
                padding: 10px 14px;
                border-radius: var(--radius-lg);
                background: var(--surface);
                border: 1px solid var(--border);
                transition: background-color 150ms, border-color 150ms;
                user-select: none;
                outline: none;
            }
            .switch:hover {
                background: var(--surface-tertiary);
                border-color: var(--border-hover);
            }
            .switch:focus-visible {
                border-color: var(--accent);
                box-shadow: 0 0 0 2px var(--accent-soft);
            }
            .switch__control {
                position: relative;
                display: inline-flex;
                align-items: center;
                height: 20px;
                width: 36px;
                border-radius: 9999px;
                background-color: var(--default);
                transition: background-color 200ms var(--ease-smooth);
                flex-shrink: 0;
                order: 2;
            }
            .switch[data-selected="true"] .switch__control {
                background-color: var(--accent);
            }
            .switch__thumb {
                height: 15px;
                width: 15px;
                border-radius: 50%;
                background-color: #ffffff;
                box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
                margin-left: 2.5px;
                transition: margin-left 220ms var(--ease-out-fluid);
            }
            .switch[data-selected="true"] .switch__thumb {
                margin-left: calc(36px - 15px - 2.5px);
            }
            .switch--sm {
                padding: 6px 11px;
                gap: 9px;
                border-radius: var(--radius-md);
                min-height: 38px;
            }
            .switch--sm .switch__control {
                height: 19.5px;
                width: 34px;
            }
            .switch--sm .switch__thumb {
                height: 14.5px;
                width: 14.5px;
                margin-left: 2.5px;
            }
            .switch--sm[data-selected="true"] .switch__thumb {
                margin-left: calc(34px - 14.5px - 2.5px);
            }
            .switch--sm .switch__content {
                gap: 1px;
            }
            .switch--sm [data-slot="label"] {
                font-size: 12.5px;
                font-weight: 500;
                line-height: 1.25;
            }
            .switch--sm [data-slot="description"] {
                font-size: 10.5px;
                line-height: 1.2;
                color: var(--muted);
            }
            .switch__content {
                display: flex;
                flex-direction: column;
                gap: 2px;
                order: 1;
                flex: 1;
            }
            .switch [data-slot="label"] {
                font-size: 13px;
                font-weight: 500;
                color: var(--foreground);
            }
            .switch [data-slot="description"] {
                font-size: 11px;
                color: var(--muted);
                line-height: 1.3;
            }
            .switch[data-disabled="true"] {
                opacity: 0.55;
                cursor: not-allowed;
            }

            /* Badge Component */
            .badge {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                gap: 4px;
                font-weight: 600;
                border-radius: var(--radius-full);
                padding: 3px 9px;
                font-size: 12px;
                line-height: 1.25;
            }
            .badge--sm {
                font-size: 10.5px;
                padding: 2px 7px;
            }
            .badge--primary.badge--accent {
                background: var(--accent);
                color: var(--accent-foreground);
            }
            .badge--soft.badge--accent {
                background: var(--accent-soft);
                color: var(--accent-soft-foreground);
            }
            .badge--soft.badge--success {
                background: var(--success-soft);
                color: var(--success);
            }
            .badge--soft.badge--warning {
                background: var(--warning-soft);
                color: var(--warning);
            }
            .badge--soft.badge--danger {
                background: var(--danger-soft);
                color: var(--danger);
            }
            .badge--secondary {
                background: var(--default);
                color: var(--default-foreground);
            }

            /* ============================================================
               HeroUI v3 Button & ButtonGroup Components (https://heroui.com/docs/react/components/button)
               ============================================================ */
            .button {
                position: relative;
                isolation: isolate;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                gap: 8px;
                height: 36px;
                width: fit-content;
                transform-origin: center;
                border-radius: var(--radius-3xl, 24px);
                padding: 0 16px;
                font-size: 14px;
                line-height: 20px;
                font-weight: 500;
                font-family: inherit;
                white-space: nowrap;
                outline: none;
                user-select: none;
                -webkit-tap-highlight-color: transparent;
                cursor: var(--cursor-interactive, pointer);
                border: 1px solid transparent;
                transition:
                    transform 250ms var(--ease-smooth),
                    background-color 100ms var(--ease-out-quad),
                    box-shadow 100ms var(--ease-out-quad),
                    border-color 100ms var(--ease-out-quad),
                    color 100ms var(--ease-out-quad);

                /* Default tokens (fallback behavior) */
                --button-bg: transparent;
                --button-bg-hover: var(--button-bg);
                --button-bg-pressed: var(--button-bg-hover);
                --button-fg: currentColor;

                background-color: var(--button-bg);
                color: var(--button-fg);
            }

            @media (prefers-reduced-motion: reduce) {
                .button {
                    transition: none;
                }
            }

            /* Interactive States */
            @media (hover: hover) {
                .button:hover,
                .button[data-hovered="true"] {
                    background-color: var(--button-bg-hover);
                }
            }

            .button:active,
            .button[data-pressed="true"] {
                will-change: transform;
                background-color: var(--button-bg-pressed);
                transform: scale(0.97);
            }

            .button:focus-visible,
            .button[data-focus-visible="true"] {
                outline: none;
                box-shadow: 0 0 0 2px var(--background), 0 0 0 4px var(--focus, var(--accent));
                z-index: 2;
            }

            .button:disabled,
            .button[aria-disabled="true"] {
                opacity: var(--disabled-opacity, 0.5);
                cursor: var(--cursor-disabled, not-allowed);
                pointer-events: none;
                transform: none !important;
            }

            .button[data-pending="true"] {
                opacity: 0.75;
                pointer-events: none;
                cursor: default;
            }

            /* SVG Icon styling */
            .button svg:not([data-slot="spinner"] svg, [data-slot="link-icon"] svg) {
                pointer-events: none;
                margin-left: -2px;
                margin-right: -2px;
                width: 16px;
                height: 16px;
                flex-shrink: 0;
                align-self: center;
            }

            /* Size Variants */
            .button--sm {
                height: 32px;
                padding: 0 12px;
                font-size: 13px;
                gap: 6px;
                border-radius: var(--radius-3xl, 24px);
            }
            .button--sm:active,
            .button--sm[data-pressed="true"] {
                transform: scale(0.98);
            }
            .button--sm svg:not([data-slot="spinner"] svg, [data-slot="link-icon"] svg) {
                width: 14px;
                height: 14px;
            }

            .button--md {
                height: 36px;
                padding: 0 16px;
                font-size: 14px;
                gap: 8px;
                border-radius: var(--radius-3xl, 24px);
            }
            .button--md:active,
            .button--md[data-pressed="true"] {
                transform: scale(0.97);
            }

            .button--lg {
                height: 44px;
                padding: 0 20px;
                font-size: 15px;
                gap: 10px;
                border-radius: var(--radius-3xl, 24px);
            }
            .button--lg:active,
            .button--lg[data-pressed="true"] {
                transform: scale(0.96);
            }
            .button--lg svg:not([data-slot="spinner"] svg, [data-slot="link-icon"] svg) {
                width: 18px;
                height: 18px;
            }

            /* Variant Classes */
            .button--primary {
                --button-bg: var(--accent);
                --button-bg-hover: var(--accent-hover);
                --button-bg-pressed: var(--accent-hover);
                --button-fg: var(--accent-foreground, #ffffff);
                box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.08);
                border-color: transparent;
            }

            .button--secondary {
                --button-bg: var(--default);
                --button-bg-hover: var(--default-hover);
                --button-bg-pressed: var(--default-hover);
                --button-fg: var(--foreground);
                border-color: transparent;
            }

            .button--tertiary {
                --button-bg: var(--default);
                --button-bg-hover: var(--default-hover);
                --button-bg-pressed: var(--default-hover);
                --button-fg: var(--foreground);
                border-color: transparent;
            }

            .button--outline {
                --button-bg: transparent;
                --button-bg-hover: color-mix(in srgb, var(--default) 60%, transparent);
                --button-bg-pressed: var(--default);
                --button-fg: var(--foreground);
                border-color: var(--border);
            }
            .button--outline:hover,
            .button--outline[data-hovered="true"] {
                border-color: var(--border-hover, var(--border));
            }

            .button--ghost {
                --button-bg: transparent;
                --button-bg-hover: var(--default);
                --button-bg-pressed: var(--default);
                --button-fg: var(--foreground);
                border-color: transparent;
            }

            .button--danger {
                --button-bg: var(--danger);
                --button-bg-hover: var(--danger-hover);
                --button-bg-pressed: var(--danger-hover);
                --button-fg: var(--danger-foreground, #ffffff);
                box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.08);
                border-color: transparent;
            }

            .button--danger-soft {
                --button-bg: var(--danger-soft);
                --button-bg-hover: color-mix(in srgb, var(--danger) 24%, transparent);
                --button-bg-pressed: color-mix(in srgb, var(--danger) 28%, transparent);
                --button-fg: var(--danger);
                border-color: transparent;
            }

            /* Modifier Classes */
            .button--icon-only {
                padding: 0 !important;
                border-radius: var(--radius-full, 9999px) !important;
                width: 36px;
                min-width: 36px;
                height: 36px;
            }
            .button--icon-only.button--sm {
                width: 32px;
                min-width: 32px;
                height: 32px;
            }
            .button--icon-only.button--lg {
                width: 44px;
                min-width: 44px;
                height: 44px;
            }
            .button--icon-only svg:not([data-slot="spinner"] svg, [data-slot="link-icon"] svg) {
                margin: 0;
            }

            .button--full-width {
                width: 100%;
            }

            .button--capturing {
                background: var(--accent) !important;
                color: var(--accent-foreground, #ffffff) !important;
                border-color: transparent !important;
                animation: heroui-pulse 1.2s ease-in-out infinite;
            }

            /* Button Spinner */
            .button__spinner {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                animation: heroui-spin 0.8s linear infinite;
            }
            @keyframes heroui-spin {
                from { transform: rotate(0deg); }
                to { transform: rotate(360deg); }
            }

            /* HeroUI v3 ButtonGroup */
            .button-group {
                display: inline-flex;
                height: auto;
                align-items: center;
                justify-content: center;
                gap: 0;
            }
            .button-group--horizontal {
                flex-direction: row;
            }
            .button-group--vertical {
                flex-direction: column;
            }
            .button-group .button {
                border-radius: 0;
            }
            .button-group--horizontal .button:first-child {
                border-top-left-radius: var(--radius-3xl, 24px);
                border-bottom-left-radius: var(--radius-3xl, 24px);
            }
            .button-group--horizontal .button:last-child {
                border-top-right-radius: var(--radius-3xl, 24px);
                border-bottom-right-radius: var(--radius-3xl, 24px);
            }
            .button-group--horizontal .button:first-child:last-child {
                border-radius: var(--radius-3xl, 24px);
            }
            .button-group--vertical .button:first-child {
                border-top-left-radius: var(--radius-3xl, 24px);
                border-top-right-radius: var(--radius-3xl, 24px);
            }
            .button-group--vertical .button:last-child {
                border-bottom-left-radius: var(--radius-3xl, 24px);
                border-bottom-right-radius: var(--radius-3xl, 24px);
            }
            .button-group--vertical .button:first-child:last-child {
                border-radius: var(--radius-3xl, 24px);
            }
            .button-group .button:active,
            .button-group .button[data-pressed="true"] {
                transform: none;
            }
            .button-group .button:focus-visible,
            .button-group .button[data-focus-visible="true"] {
                z-index: 10;
            }
            .button-group--horizontal .button--outline:not(:first-child) {
                margin-left: -1px;
            }
            .button-group--vertical .button--outline:not(:first-child) {
                margin-top: -1px;
            }
            .button-group--full-width {
                width: 100%;
            }
            .button-group--full-width .button {
                flex: 1;
            }

            /* Form Elements */
            .field-row {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 16px;
                padding: 12px 16px;
                border-radius: var(--radius-lg);
                background: var(--surface);
                border: 1px solid var(--border);
            }
            .field-row > label {
                font-size: 13.5px;
                font-weight: 500;
                color: var(--foreground);
                display: flex;
                flex-direction: column;
                gap: 2px;
                flex: 1;
            }
            .field-row > label small {
                font-size: 11.5px;
                color: var(--muted);
                font-weight: 400;
            }
            .select, .input {
                background: var(--field-background);
                color: var(--field-foreground);
                border: 1px solid var(--field-border);
                border-radius: var(--field-radius);
                padding: 8px 14px;
                font-size: 13px;
                font-family: inherit;
                transition: border-color 150ms, box-shadow 150ms;
                outline: none;
                min-width: 150px;
                cursor: pointer;
            }
            .input {
                cursor: text;
            }
            .select:focus, .input:focus {
                border-color: var(--accent);
                box-shadow: 0 0 0 2px var(--accent-soft);
            }
            .input[type="number"] {
                -moz-appearance: textfield;
            }
            .input[type="number"]::-webkit-outer-spin-button,
            .input[type="number"]::-webkit-inner-spin-button {
                -webkit-appearance: none;
                margin: 0;
            }

            /* Range & Quick Presets */
            .preset-chips {
                display: flex;
                align-items: center;
                gap: 7px;
                flex-wrap: wrap;
                margin-top: 6px;
            }
            .preset-chip {
                padding: 5px 12px;
                font-size: 11.5px;
                font-weight: 600;
                border-radius: var(--radius-full);
                background: var(--default-soft);
                color: var(--muted);
                border: 1px solid var(--border);
                cursor: pointer;
                transition: background 150ms, color 150ms, border-color 150ms;
            }
            .preset-chip:hover {
                background: var(--default-hover);
                color: var(--foreground);
                border-color: var(--border-hover);
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
                transition: transform 150ms, border-color 150ms;
            }
            .color-swatch:hover {
                transform: scale(1.15);
            }
            .color-swatch[data-active="true"] {
                border-color: #ffffff;
                box-shadow: 0 0 0 2px var(--accent);
            }

            /* Services Filter & Grid */
            .services-search-bar {
                display: flex;
                align-items: center;
                gap: 8px;
                margin-bottom: 8px;
            }
            .services-search-input {
                flex: 1;
                background: var(--field-background);
                color: var(--field-foreground);
                border: 1px solid var(--field-border);
                border-radius: var(--field-radius);
                padding: 7px 13px;
                font-size: 12.5px;
                outline: none;
            }
            .services-search-input:focus {
                border-color: var(--accent);
            }
            .services-grid {
                display: grid;
                grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
                gap: 7px;
                max-height: 390px;
                overflow-y: auto;
                padding-right: 4px;
                scrollbar-width: thin;
                scrollbar-color: var(--border) transparent;
            }
            .service-tile {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 7px 12px;
                min-height: 38px;
                border-radius: var(--radius-md);
                background: var(--surface);
                border: 1px solid var(--border);
                font-size: 12.5px;
                cursor: pointer;
                transition: background 120ms, border-color 120ms;
                user-select: none;
            }
            .service-tile:hover {
                background: var(--surface-tertiary);
                border-color: var(--border-hover);
            }
            .service-tile__label {
                font-weight: 500;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
                padding-right: 8px;
                flex: 1;
            }
            .service-tile .switch {
                padding: 0;
                border: none;
                background: transparent;
                flex-shrink: 0;
                min-height: unset;
            }
            .service-tile .switch:hover {
                background: transparent;
            }
            .service-tile .switch .switch__control {
                height: 19.5px;
                width: 34px;
            }
            .service-tile .switch .switch__thumb {
                height: 14.5px;
                width: 14.5px;
                margin-left: 2.5px;
            }
            .service-tile .switch[data-selected="true"] .switch__thumb {
                margin-left: calc(34px - 14.5px - 2.5px);
            }
            .service-tile[data-disabled="true"] {
                opacity: 0.55;
                cursor: not-allowed;
            }

            /* Statistics Tiles Grid */
            .stats-grid {
                display: grid;
                grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
                gap: 12px;
            }
            .stat-card {
                background: var(--surface);
                border: 1px solid var(--border);
                border-radius: var(--radius-lg);
                padding: 16px 20px;
                display: flex;
                flex-direction: column;
                gap: 6px;
                transition: transform 150ms, border-color 150ms;
            }
            .stat-card:hover {
                transform: translateY(-2px);
                border-color: var(--border-hover);
            }
            .stat-card__label {
                font-size: 11px;
                font-weight: 700;
                text-transform: uppercase;
                letter-spacing: 0.6px;
                color: var(--muted);
            }
            .stat-card__value {
                font-size: 26px;
                font-weight: 700;
                color: var(--foreground);
                font-variant-numeric: tabular-nums;
            }

            /* HeroUI v3 Dropdown */
            .dropdown {
                position: relative;
                display: inline-flex;
                width: auto;
                flex-shrink: 0;
            }
            .dropdown__trigger-wrapper {
                display: inline-flex;
                width: auto;
            }
            .dropdown__trigger-btn {
                display: inline-flex !important;
                align-items: center;
                justify-content: space-between;
                gap: 8px;
                width: auto !important;
                min-width: 90px;
                max-width: 240px;
                height: 32px;
                padding: 0 12px !important;
                background: var(--surface) !important;
                border: 1px solid var(--border) !important;
                border-radius: var(--radius-3xl, 24px) !important;
                color: var(--foreground) !important;
                font-size: 13px !important;
                font-weight: 500 !important;
                cursor: pointer;
                transition: all 150ms var(--ease-smooth);
                text-align: left;
                white-space: nowrap;
            }
            .dropdown__trigger-btn > span {
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }
            .dropdown__trigger-btn:hover {
                background: var(--surface-tertiary) !important;
                border-color: var(--border-hover) !important;
            }
            .dropdown__trigger-chevron {
                width: 14px;
                height: 14px;
                flex-shrink: 0;
                margin-left: 6px;
                color: var(--muted);
                transition: transform 180ms var(--ease-smooth);
            }
            .dropdown[data-open="true"] .dropdown__trigger-chevron {
                transform: rotate(180deg);
                color: var(--foreground);
            }
            .dropdown__popover {
                position: absolute;
                top: calc(100% + 5px);
                right: 0;
                left: auto;
                min-width: 210px;
                width: max-content;
                max-width: 320px;
                background: var(--overlay);
                color: var(--overlay-foreground);
                border: 1px solid var(--border);
                border-radius: var(--radius-lg);
                box-shadow: 0 12px 30px -4px rgba(0, 0, 0, 0.45), 0 4px 12px -2px rgba(0, 0, 0, 0.25);
                z-index: 100;
                overflow: hidden;
                will-change: transform, opacity;
                transform: translateZ(0);
                animation: dropdownIn 160ms cubic-bezier(0.16, 1, 0.3, 1);
            }
            @keyframes dropdownIn {
                from { opacity: 0; transform: translateY(-5px) scale(0.98); }
                to { opacity: 1; transform: translateY(0) scale(1); }
            }
            .dropdown__menu {
                display: flex;
                flex-direction: column;
                padding: 5px;
                gap: 2px;
                max-height: 250px;
                overflow-y: auto;
            }
            .dropdown__item {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 7px 11px;
                border-radius: var(--radius-md);
                cursor: pointer;
                color: var(--foreground);
                transition: background 120ms, color 120ms;
                user-select: none;
            }
            .dropdown__item:hover {
                background: var(--surface-tertiary);
            }
            .dropdown__item[data-selected="true"] {
                background: var(--accent-soft);
                color: var(--accent);
            }
            .dropdown__item-content {
                display: flex;
                flex-direction: column;
                gap: 1px;
            }
            .dropdown__item-label {
                font-weight: 500;
                font-size: 12.5px;
            }
            .dropdown__item-description {
                font-size: 11px;
                color: var(--muted);
            }
            .dropdown__item-indicator {
                font-size: 12px;
                font-weight: 700;
                color: var(--accent);
                margin-left: 8px;
            }

            /* HeroUI v3 TagGroup & Tag */
            .tag-group {
                display: flex;
                flex-direction: column;
                gap: 6px;
            }
            .tag-group__label {
                font-size: 11.5px;
                font-weight: 600;
                color: var(--muted);
                text-transform: uppercase;
                letter-spacing: 0.5px;
            }
            .tag-group__list {
                display: flex;
                flex-wrap: wrap;
                gap: 6px;
            }
            .tag {
                display: inline-flex;
                align-items: center;
                gap: 6px;
                padding: 5px 12px;
                border-radius: var(--radius-full);
                font-size: 12px;
                font-weight: 500;
                background: var(--surface);
                color: var(--foreground);
                border: 1px solid var(--border);
                cursor: pointer;
                transition: all 140ms var(--ease-smooth);
                user-select: none;
                outline: none;
            }
            .tag:hover {
                background: var(--surface-tertiary);
                border-color: var(--border-hover);
                transform: translateY(-1px);
            }
            .tag[data-selected="true"] {
                background: var(--accent);
                color: var(--accent-foreground);
                border-color: var(--accent);
                box-shadow: 0 2px 8px color-mix(in srgb, var(--accent) 35%, transparent);
            }

            /* Modal Header TagGroup Tab Navigation */
            .modal__tab-group {
                margin-top: 6px;
                width: 100%;
            }
            .modal__tab-tags {
                display: flex;
                align-items: center;
                gap: 6px;
                padding: 4px;
                border-radius: var(--radius-xl);
                background: var(--surface-secondary);
                border: 1px solid var(--border);
                width: fit-content;
                max-width: 100%;
                overflow-x: auto;
                scrollbar-width: none;
            }
            .modal__tab-tags::-webkit-scrollbar {
                display: none;
            }
            .modal__tab-tags .tag {
                padding: 7px 16px;
                font-size: 13px;
                font-weight: 500;
                border-radius: calc(var(--radius-xl) - 4px);
                border: 1px solid transparent;
                background: transparent;
                color: var(--muted);
                cursor: pointer;
                transition: all 180ms var(--ease-smooth);
                white-space: nowrap;
            }
            .modal__tab-tags .tag:hover {
                color: var(--foreground);
                background: var(--surface-tertiary);
                border-color: transparent;
                transform: none;
            }
            .modal__tab-tags .tag[data-selected="true"] {
                background: var(--surface);
                color: var(--foreground);
                font-weight: 600;
                border: 1px solid var(--border);
                box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08), 0 3px 10px -2px rgba(0, 0, 0, 0.18);
            }
            .modal__tab-tags .tag[data-selected="true"]:hover {
                background: var(--surface);
                border-color: var(--border-hover);
            }

            /* HeroUI v3 Slider */
            .slider {
                display: flex;
                flex-direction: column;
                gap: 8px;
                width: 100%;
                user-select: none;
            }
            .slider--inline {
                display: inline-flex;
                flex-direction: row;
                align-items: center;
                gap: 12px;
                width: auto;
            }
            .slider-track {
                position: relative;
                height: 6px;
                width: 140px;
                border-radius: var(--radius-full);
                background: var(--surface-secondary);
                border: 1px solid var(--border);
                cursor: pointer;
                touch-action: none;
            }
            .slider-fill {
                position: absolute;
                top: 0;
                left: 0;
                height: 100%;
                border-radius: var(--radius-full);
                background: var(--accent);
                pointer-events: none;
            }
            .slider-thumb {
                position: absolute;
                top: 50%;
                width: 16px;
                height: 16px;
                border-radius: 50%;
                background: #ffffff;
                border: 2px solid var(--accent);
                box-shadow: 0 1px 4px rgba(0, 0, 0, 0.35);
                transform: translate(-50%, -50%);
                cursor: grab;
                transition: transform 120ms ease, box-shadow 120ms ease;
                outline: none;
            }
            .slider-thumb:hover {
                transform: translate(-50%, -50%) scale(1.18);
            }
            .slider-thumb[data-dragging="true"], .slider-thumb:active {
                cursor: grabbing;
                transform: translate(-50%, -50%) scale(1.22);
                box-shadow: 0 0 0 4px var(--accent-soft);
            }
            .slider__output {
                font-size: 13px;
                font-weight: 700;
                color: var(--foreground);
                min-width: 44px;
                text-align: right;
                font-variant-numeric: tabular-nums;
            }
        `;
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
            if (reactSetSettings) reactSetSettings(Object.assign({}, settings));
            return;
        }

        if (settings[key] === value) return;

        settings[key] = value;

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
            case 'suppressJitsu':
                LOG('Jitsu telemetry ' + (value ? 'SUPPRESSED (blocked + logged)' : 'ALLOWED (passed through + logged)'));
                break;
            case 'disableAutoFullscreen':
                LOG('auto-fullscreen blocking ' + (value ? 'ENABLED' : 'DISABLED'));
                break;
            case 'darkMode':
                ensureDarkModeStyles();
                applyDarkMode();
                break;
            case 'logLevel':
                LOG('log level set to:', value);
                break;
        }

        if (reactSetSettings) reactSetSettings(Object.assign({}, settings));
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
        if (reactSetSettings) reactSetSettings(Object.assign({}, settings));
    }

    // ============================================================
    // HEROUI v3 REACT COMPOUND COMPONENTS
    // ============================================================
    const html = (typeof htm !== 'undefined' && typeof React !== 'undefined')
        ? htm.bind(React.createElement)
        : null;

    // ============================================================
    // HEROUI V3 BUTTON & BUTTON GROUP COMPONENTS
    // Documentation: https://heroui.com/docs/react/components/button
    // ============================================================
    const Spinner = ({ size = 'sm', color = 'current', className = '' }) => {
        const px = size === 'sm' ? 14 : size === 'lg' ? 20 : 16;
        return html`
            <span className=${`button__spinner ${className}`} data-slot="spinner" style=${{ display: 'inline-flex', width: `${px}px`, height: `${px}px` }}>
                <svg width=${px} height=${px} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" style=${{ color: color === 'current' ? 'currentColor' : color }}>
                    <path d="M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83" opacity="0.3" />
                    <path d="M12 2a10 10 0 0 1 10 10" />
                </svg>
            </span>
        `;
    };

    const Button = React.memo(({
        variant = 'primary',
        size = 'md',
        fullWidth = false,
        isDisabled = false,
        disabled = false,
        isPending = false,
        isIconOnly = false,
        onPress,
        onClick,
        className = '',
        title = '',
        style = {},
        slot = '',
        type = 'button',
        children,
        ...restProps
    }) => {
        const effectiveDisabled = Boolean(isDisabled || disabled);

        const handlePress = (e) => {
            if (effectiveDisabled || isPending) {
                e.preventDefault();
                return;
            }
            if (onPress) onPress(e);
            else if (onClick) onClick(e);
        };

        const classes = [
            'button',
            `button--${variant}`,
            `button--${size}`,
            fullWidth ? 'button--full-width' : '',
            isIconOnly ? 'button--icon-only' : '',
            className
        ].filter(Boolean).join(' ');

        const content = typeof children === 'function' ? children({
            isPending,
            isDisabled: effectiveDisabled,
        }) : children;

        return html`
            <button
                type=${type}
                className=${classes}
                title=${title}
                disabled=${effectiveDisabled}
                data-slot="button"
                slot=${slot || undefined}
                data-pending=${isPending ? 'true' : undefined}
                aria-disabled=${effectiveDisabled ? 'true' : undefined}
                onClick=${handlePress}
                style=${style}
                ...${restProps}
            >
                ${isPending && (typeof children !== 'function') ? html`
                    <${Spinner} size=${size === 'lg' ? 'md' : 'sm'} color="current" />
                ` : null}
                ${content}
            </button>
        `;
    });

    const ButtonGroup = ({ orientation = 'horizontal', fullWidth = false, size = 'md', className = '', children }) => html`
        <div
            className=${`button-group button-group--${orientation} ${fullWidth ? 'button-group--full-width' : ''} ${className}`}
            role="group"
            data-slot="button-group"
        >
            ${children}
        </div>
    `;
    ButtonGroup.Separator = () => html`<span className="button-group__separator" aria-hidden="true"></span>`;

    // --- Modal Compound Component (HeroUI v3) ---
    const Modal = ({ isOpen, isClosing, onClose, children }) => {
        if (!isOpen && !isClosing) return null;
        return children;
    };
    Modal.Backdrop = ({ isClosing, onClose, children }) => html`
        <div
            id="__ul-settings-overlay"
            className=${`modal__backdrop modal__backdrop--blur ${isClosing ? 'modal__backdrop--closing' : ''}`}
            onClick=${(e) => {
                if (e.target && e.target.id === '__ul-settings-overlay') onClose();
            }}
        >
            ${children}
        </div>
    `;
    Modal.Container = ({ children }) => html`
        <div className="modal__container" data-placement="center">${children}</div>
    `;
    Modal.Dialog = ({ children }) => html`
        <div
            className="modal__dialog modal__dialog--lg modal__dialog--scroll-inside"
            role="dialog"
            aria-modal="true"
            onClick=${(e) => e.stopPropagation()}
        >
            ${children}
        </div>
    `;
    Modal.Header = ({ children }) => html`<header className="modal__header">${children}</header>`;
    Modal.Brand = ({ children }) => html`<div className="modal__brand">${children}</div>`;
    Modal.Icon = ({ children }) => html`<div className="modal__icon">${children}</div>`;
    Modal.Heading = ({ children }) => html`<div className="modal__title-box"><h2 className="modal__heading">${children}</h2></div>`;
    Modal.CloseTrigger = ({ onPress }) => html`
        <${Button}
            type="button"
            variant="ghost"
            size="sm"
            isIconOnly
            className="modal__close-trigger"
            onPress=${onPress}
            title="Close (Esc)"
            aria-label="Close modal"
        >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
        <//>
    `;
    Modal.Footer = ({ children }) => html`<footer className="modal__footer">${children}</footer>`;
    Modal.Body = ({ children }) => html`<div className="modal__body modal__body--scroll-inside">${children}</div>`;

    // --- Tabs Compound Component (HeroUI v3) ---
    const Tabs = ({ children }) => html`<div className="tabs tabs--secondary">${children}</div>`;
    Tabs.ListContainer = ({ children }) => html`<div className="tabs__list-container">${children}</div>`;
    Tabs.List = ({ innerRef, children }) => html`<div className="tabs__list" role="tablist" ref=${innerRef}>${children}</div>`;
    Tabs.Tab = ({ id, isSelected, onPress, innerRef, children }) => html`
        <button
            type="button"
            className="tabs__tab"
            role="tab"
            data-tab=${id}
            data-selected=${isSelected ? 'true' : 'false'}
            onClick=${onPress}
            ref=${innerRef}
        >
            ${children}
        </button>
    `;
    Tabs.Indicator = ({ style }) => html`<div className="tabs__indicator" style=${style}></div>`;
    Tabs.Panel = React.memo(({ id, activeTab, direction, children }) => {
        const isActive = id === activeTab;
        return html`
            <div
                className="tabs__panel"
                data-tab=${id}
                data-active=${isActive ? 'true' : undefined}
                data-direction=${direction}
                style=${isActive ? {} : { display: 'none' }}
            >
                ${children}
            </div>
        `;
    });

    // --- Switch Compound Component (HeroUI v3) ---
    const Switch = React.memo(({ isSelected, onChange, size = 'md', isDisabled = false, className = '', children, onClick }) => {
        const toggle = (e) => {
            if (isDisabled) return;
            if (e) e.stopPropagation();
            if (onClick) onClick(e);
            if (onChange) onChange(!isSelected);
        };
        const onKeyDown = (e) => {
            if (isDisabled) return;
            if (e.key === ' ' || e.key === 'Enter') {
                e.preventDefault();
                toggle(e);
            }
        };
        return html`
            <div
                className=${`switch switch--${size} ${className}`.trim()}
                role="switch"
                tabIndex=${isDisabled ? '-1' : '0'}
                data-selected=${isSelected ? 'true' : 'false'}
                data-disabled=${isDisabled ? 'true' : undefined}
                aria-checked=${isSelected ? 'true' : 'false'}
                aria-disabled=${isDisabled ? 'true' : undefined}
                onClick=${toggle}
                onKeyDown=${onKeyDown}
            >
                ${children}
            </div>
        `;
    });
    Switch.Control = ({ children }) => html`<div className="switch__control">${children || html`<div className="switch__thumb"></div>`}</div>`;
    Switch.Thumb = ({ children }) => html`<div className="switch__thumb">${children}</div>`;
    Switch.Content = ({ children }) => html`<div className="switch__content">${children}</div>`;
    Switch.Label = ({ children }) => html`<div data-slot="label">${children}</div>`;
    Switch.Description = ({ children }) => html`<div data-slot="description">${children}</div>`;

    // --- Card Compound Component (HeroUI v3) ---
    const Card = React.memo(({ variant = 'secondary', className = '', children }) => html`
        <div className=${`card card--${variant} ${className}`}>${children}</div>
    `);
    Card.Header = ({ className = '', children }) => html`<div className=${`card__header ${className}`.trim()}>${children}</div>`;
    Card.Title = ({ className = '', children }) => html`<div className=${`card__title ${className}`.trim()}>${children}</div>`;
    Card.Description = ({ className = '', children }) => html`<div className=${`card__description ${className}`.trim()}>${children}</div>`;
    Card.Content = ({ className = '', children }) => html`<div className=${`card__content ${className}`.trim()}>${children}</div>`;

    // --- Badge Component (HeroUI v3) ---
    const Badge = React.memo(({ size = 'sm', variant = 'primary', color = '', className = '', children }) => html`
        <span className=${`badge badge--${size} badge--${variant} ${color ? `badge--${color}` : ''} ${className}`}>
            ${children}
        </span>
    `);

    // --- Dropdown Compound Component (HeroUI v3) ---
    const DropdownContext = (typeof React !== 'undefined') ? React.createContext(null) : null;

    const Dropdown = React.memo(({ selectedKey, onSelectionChange, className = '', children }) => {
        const [isOpen, setIsOpen] = React.useState(false);
        const dropdownRef = React.useRef(null);

        React.useEffect(() => {
            if (!isOpen) return;
            const handleDocClick = (e) => {
                const target = (e.composedPath && e.composedPath()[0]) || e.target;
                if (dropdownRef.current && !dropdownRef.current.contains(target)) {
                    setIsOpen(false);
                }
            };
            window.addEventListener('click', handleDocClick);
            return () => window.removeEventListener('click', handleDocClick);
        }, [isOpen]);

        const contextValue = React.useMemo(() => ({
            isOpen,
            setIsOpen,
            selectedKey,
            onSelectionChange: (key) => {
                if (onSelectionChange) onSelectionChange(key);
                setIsOpen(false);
            }
        }), [isOpen, selectedKey, onSelectionChange]);

        return html`
            <div ref=${dropdownRef} className=${`dropdown ${className}`} data-open=${isOpen ? 'true' : 'false'}>
                <${DropdownContext.Provider} value=${contextValue}>
                    ${children}
                <//>
            </div>
        `;
    });

    Dropdown.Trigger = ({ children }) => {
        const ctx = React.useContext(DropdownContext);
        return html`
            <div
                className="dropdown__trigger-wrapper"
                onClick=${(e) => {
                    e.stopPropagation();
                    if (ctx) ctx.setIsOpen(!ctx.isOpen);
                }}
            >
                ${children}
            </div>
        `;
    };

    Dropdown.Popover = ({ children }) => {
        const ctx = React.useContext(DropdownContext);
        if (!ctx || !ctx.isOpen) return null;
        return html`
            <div className="dropdown__popover" onClick=${(e) => e.stopPropagation()}>
                ${children}
            </div>
        `;
    };

    Dropdown.Menu = ({ children }) => html`<div className="dropdown__menu" role="menu">${children}</div>`;

    Dropdown.Item = React.memo(({ id, variant, children }) => {
        const ctx = React.useContext(DropdownContext);
        const isSelected = ctx && ctx.selectedKey === id;
        return html`
            <div
                className=${`dropdown__item ${variant === 'danger' ? 'dropdown__item--danger' : ''}`}
                role="menuitem"
                data-selected=${isSelected ? 'true' : 'false'}
                onClick=${() => {
                    if (ctx && ctx.onSelectionChange) ctx.onSelectionChange(id);
                }}
            >
                <div className="dropdown__item-content">${children}</div>
                ${isSelected ? html`<span className="dropdown__item-indicator">✓</span>` : null}
            </div>
        `;
    });
    Dropdown.Item.Label = ({ children }) => html`<div className="dropdown__item-label">${children}</div>`;
    Dropdown.Item.Description = ({ children }) => html`<div className="dropdown__item-description">${children}</div>`;

    // --- TagGroup Compound Component (HeroUI v3) ---
    const TagGroupContext = (typeof React !== 'undefined') ? React.createContext(null) : null;

    const TagGroup = React.memo(({ ariaLabel, selectionMode = 'single', selectedKeys, onSelectionChange, className = '', children }) => {
        const contextValue = React.useMemo(() => ({
            selectedKeys: selectedKeys || [],
            selectionMode,
            onSelect: (id) => {
                if (onSelectionChange) onSelectionChange(id);
            }
        }), [selectedKeys, selectionMode, onSelectionChange]);

        return html`
            <div className=${`tag-group ${className}`.trim()} role="group" aria-label=${ariaLabel}>
                <${TagGroupContext.Provider} value=${contextValue}>
                    ${children}
                <//>
            </div>
        `;
    });
    TagGroup.Label = ({ className = '', children }) => html`<div className=${`tag-group__label ${className}`.trim()}>${children}</div>`;
    TagGroup.List = ({ className = '', children }) => html`<div className=${`tag-group__list ${className}`.trim()}>${children}</div>`;

    const Tag = React.memo(({ id, onPress, onClick, className = '', children }) => {
        const ctx = React.useContext(TagGroupContext);
        const isSelected = ctx ? ctx.selectedKeys.includes(id) : false;
        return html`
            <div
                className=${`tag ${className}`.trim()}
                role="button"
                tabIndex="0"
                data-id=${id}
                data-selected=${isSelected ? 'true' : 'false'}
                onClick=${() => {
                    if (onPress) onPress(id);
                    else if (onClick) onClick(id);
                    else if (ctx) ctx.onSelect(id);
                }}
                onKeyDown=${(e) => {
                    if (e.key === ' ' || e.key === 'Enter') {
                        e.preventDefault();
                        if (onPress) onPress(id);
                        else if (onClick) onClick(id);
                        else if (ctx) ctx.onSelect(id);
                    }
                }}
            >
                ${children}
            </div>
        `;
    });
    TagGroup.Tag = Tag;

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
        { id: 'dark', label: 'Dark', desc: 'HeroUI high-contrast dark theme' },
        { id: 'light', label: 'Light', desc: 'HeroUI clean light theme' },
        { id: 'auto', label: 'Auto (System)', desc: 'Matches system dark/light preference' },
    ];

    const LOG_LEVEL_OPTIONS = [
        { id: 'silent', label: 'Silent', desc: 'Mutes all console logs' },
        { id: 'normal', label: 'Normal', desc: 'Logs key operations and warnings' },
        { id: 'verbose', label: 'Verbose', desc: 'Full network packets and grouped reports' },
    ];

    // --- Slider Compound Component (HeroUI v3) ---
    const SliderContext = (typeof React !== 'undefined') ? React.createContext(null) : null;

    const Slider = React.memo(({
        value,
        defaultValue = 0,
        minValue = 0,
        maxValue = 100,
        step = 1,
        isDisabled = false,
        onChange,
        className = '',
        children,
    }) => {
        const [internalValue, setInternalValue] = React.useState(typeof value !== 'undefined' ? value : defaultValue);
        const [isDragging, setIsDragging] = React.useState(false);
        const trackRef = React.useRef(null);
        const isDraggingRef = React.useRef(false);
        const latestValRef = React.useRef(internalValue);

        // Keep internal value in sync with external value when not dragging
        React.useEffect(() => {
            if (!isDraggingRef.current && typeof value !== 'undefined') {
                setInternalValue(value);
                latestValRef.current = value;
            }
        }, [value]);

        const curVal = isDragging ? internalValue : (typeof value !== 'undefined' ? value : internalValue);
        const percentage = Math.max(0, Math.min(100, ((curVal - minValue) / (maxValue - minValue)) * 100));

        const triggerChange = React.useCallback((nextVal, commit = false) => {
            const clamped = Math.max(minValue, Math.min(maxValue, parseFloat(nextVal.toFixed(4))));
            latestValRef.current = clamped;
            setInternalValue(clamped);
            if (commit && onChange) {
                onChange(clamped);
            }
        }, [minValue, maxValue, onChange]);

        const handleKeyDown = (e) => {
            if (isDisabled) return;
            let next = null;
            if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = curVal + step;
            else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = curVal - step;
            else if (e.key === 'Home') next = minValue;
            else if (e.key === 'End') next = maxValue;
            if (next !== null) {
                e.preventDefault();
                triggerChange(next, true);
            }
        };

        const handlePointerDown = (e) => {
            if (isDisabled || !trackRef.current) return;
            e.preventDefault();
            isDraggingRef.current = true;
            setIsDragging(true);

            // Cache bounding rect ONCE on pointerdown to prevent layout reflows during move
            const rect = trackRef.current.getBoundingClientRect();
            const width = rect.width;
            const left = rect.left;

            const calcValFromClientX = (clientX) => {
                if (width <= 0) return minValue;
                const pos = Math.max(0, Math.min(1, (clientX - left) / width));
                let raw = minValue + pos * (maxValue - minValue);
                if (step) {
                    raw = Math.round((raw - minValue) / step) * step + minValue;
                }
                return Math.max(minValue, Math.min(maxValue, parseFloat(raw.toFixed(4))));
            };

            const initialVal = calcValFromClientX(e.clientX);
            triggerChange(initialVal, false);

            let rafId = null;
            let latestClientX = e.clientX;

            const onMove = (ev) => {
                latestClientX = ev.clientX;
                if (rafId) return;
                rafId = requestAnimationFrame(() => {
                    rafId = null;
                    if (!isDraggingRef.current) return;
                    const nextVal = calcValFromClientX(latestClientX);
                    triggerChange(nextVal, false);
                    // Live DOM fast-path preview on floating pill without whole-app React re-renders
                    try {
                        const pillEl = (uiShadowRoot && uiShadowRoot.getElementById('__ul-pill')) || document.getElementById('__ul-pill');
                        if (pillEl) pillEl.style.opacity = String(nextVal);
                    } catch {}
                });
            };

            const onUp = (ev) => {
                if (rafId) {
                    cancelAnimationFrame(rafId);
                    rafId = null;
                }
                isDraggingRef.current = false;
                setIsDragging(false);
                window.removeEventListener('pointermove', onMove);
                window.removeEventListener('pointerup', onUp);
                const finalVal = calcValFromClientX(ev.clientX);
                triggerChange(finalVal, true);
            };

            window.addEventListener('pointermove', onMove, { passive: true });
            window.addEventListener('pointerup', onUp, { passive: true });
        };

        const contextValue = React.useMemo(() => ({
            value: curVal,
            minValue,
            maxValue,
            percentage,
            isDragging,
            isDisabled,
            trackRef,
            handlePointerDown,
            handleKeyDown,
        }), [curVal, minValue, maxValue, percentage, isDragging, isDisabled]);

        return html`
            <div
                className=${`slider ${className}`.trim()}
                data-disabled=${isDisabled ? 'true' : undefined}
                data-dragging=${isDragging ? 'true' : undefined}
            >
                <${SliderContext.Provider} value=${contextValue}>
                    ${children}
                <//>
            </div>
        `;
    });

    Slider.Output = ({ className = '', children }) => {
        const ctx = React.useContext(SliderContext);
        const val = ctx ? ctx.value : 0;
        const display = typeof children === 'function'
            ? children(val)
            : (children || `${Math.round(ctx ? (ctx.value <= 1 && ctx.maxValue <= 1 ? ctx.value * 100 : ctx.percentage) : 0)}%`);
        return html`
            <output className=${`slider__output ${className}`.trim()}>
                ${display}
            </output>
        `;
    };

    Slider.Track = ({ className = '', children }) => {
        const ctx = React.useContext(SliderContext);
        return html`
            <div
                ref=${ctx ? ctx.trackRef : null}
                className=${`slider-track ${className}`.trim()}
                onPointerDown=${ctx ? ctx.handlePointerDown : null}
            >
                ${children}
            </div>
        `;
    };

    Slider.Fill = ({ className = '' }) => {
        const ctx = React.useContext(SliderContext);
        const width = ctx ? `${ctx.percentage}%` : '0%';
        return html`<div className=${`slider-fill ${className}`.trim()} style=${{ width }}></div>`;
    };

    Slider.Thumb = ({ className = '' }) => {
        const ctx = React.useContext(SliderContext);
        const left = ctx ? `${ctx.percentage}%` : '0%';
        return html`
            <div
                className=${`slider-thumb ${className}`.trim()}
                role="slider"
                tabIndex="0"
                aria-valuenow=${ctx ? ctx.value : 0}
                aria-valuemin=${ctx ? ctx.minValue : 0}
                aria-valuemax=${ctx ? ctx.maxValue : 100}
                data-dragging=${ctx && ctx.isDragging ? 'true' : undefined}
                onKeyDown=${ctx ? ctx.handleKeyDown : null}
                style=${{ left }}
            ></div>
        `;
    };

    // --- ServiceTile Component (HeroUI v3 Switch) ---
    const ServiceTile = React.memo(({ serviceKey, service, isChecked, onToggle }) => {
        const handleToggle = React.useCallback((e) => {
            if (e && e.stopPropagation) e.stopPropagation();
            if (onToggle) onToggle(serviceKey);
        }, [onToggle, serviceKey]);

        return html`
            <div
                className="service-tile"
                data-service=${serviceKey}
                data-checked=${isChecked ? 'true' : 'false'}
                title=${service.hosts.join(', ')}
                onClick=${handleToggle}
            >
                <span className="service-tile__label">${service.label}</span>
                <${Switch}
                    isSelected=${isChecked}
                    onChange=${handleToggle}
                    size="sm"
                    className="service-tile__switch"
                >
                    <${Switch.Control}>
                        <${Switch.Thumb} />
                    <//>
                <//>
            </div>
        `;
    });

    // --- StatusPill Component (Floating UI) ---
    const StatusPill = React.memo(({ currentSettings, currentStats, accumulatedBonus, onToggleBoost, onOpenSettings }) => {
        if (!currentSettings.pillVisible) return null;
        const mode = currentSettings.pillMode || 'minimal';
        const isMinimal = mode === 'minimal';
        const isCompact = mode === 'compact';
        const isFull    = mode === 'full';
        const enabled   = currentSettings.timeBoostEnabled;

        const pos = POSITION_STYLES[currentSettings.pillPosition] || POSITION_STYLES['bottom-right'];
        const pillStyle = Object.assign({}, pos, {
            opacity: String(currentSettings.pillOpacity),
            display: 'flex',
        });

        const rangeLabel = currentSettings.extraSecondsMin === currentSettings.extraSecondsMax
            ? `+${currentSettings.extraSecondsMin}s`
            : `+${currentSettings.extraSecondsMin}–${currentSettings.extraSecondsMax}s`;

        const kbText = formatKeybind(currentSettings.uiToggleKeybind);
        const tooltip = isMinimal
            ? `UpLearn Control Panel (${kbText}) | Boost: ${enabled ? 'ON' : 'OFF'}`
            : `Click badge: toggle time boost | Click gear: Control Panel | ${kbText}: hide/show`;

        return html`
            <div
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
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="3"></circle>
                        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
                    </svg>
                    <span className="heroui-pill__indicator-dot" style=${{ display: enabled ? 'block' : 'none' }}></span>
                </button>
            </div>
        `;
    });

    // --- SettingsModal Component (HeroUI v3 Dialog) ---
    // --- SettingsModal Component & Isolated Memoized Tabs ---
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
                if (key === 'jitsu') continue;
                total++;
                const svc = TELEMETRY_SERVICES[key];
                const checked = !!currentSettings.telemetryServices[key];
                if (checked) active++;
                if (!q || svc.label.toLowerCase().includes(q) || svc.hosts.some(h => h.toLowerCase().includes(q))) {
                    list.push({ key, svc, checked });
                }
            }
            return { filteredServicesList: list, activeServicesCount: active, totalServicesCount: total };
        }, [servicesFilter, currentSettings.telemetryServices]);

        const handleToggleService = useCallback((key) => {
            const next = !settings.telemetryServices[key];
            const updated = Object.assign({}, settings.telemetryServices, { [key]: next });
            settings.telemetryServices = updated;
            settings.telemetryPreset = 'custom';
            saveSettings();
            LOG(`service "${TELEMETRY_SERVICES[key].label}" ${next ? 'ENABLED' : 'DISABLED'}`);
            onUpdateSetting('telemetryServices', updated);
        }, [onUpdateSetting]);

        const handleEnableAllServices = useCallback(() => {
            const updated = {};
            for (const k in TELEMETRY_SERVICES) {
                if (k !== 'jitsu') {
                    settings.telemetryServices[k] = true;
                    updated[k] = true;
                }
            }
            settings.telemetryServices = updated;
            settings.telemetryPreset = 'custom';
            saveSettings();
            onUpdateSetting('telemetryServices', updated);
        }, [onUpdateSetting]);

        const handleDisableAllServices = useCallback(() => {
            const updated = {};
            for (const k in TELEMETRY_SERVICES) {
                if (k !== 'jitsu') {
                    settings.telemetryServices[k] = false;
                    updated[k] = false;
                }
            }
            settings.telemetryServices = updated;
            settings.telemetryPreset = 'custom';
            saveSettings();
            onUpdateSetting('telemetryServices', updated);
        }, [onUpdateSetting]);

        // Memoized switch handlers
        const updatePreset = useCallback((val) => onUpdateSetting('telemetryPreset', val), [onUpdateSetting]);
        const updateLogImproper = useCallback((v) => onUpdateSetting('blockLogImproperUse', v), [onUpdateSetting]);
        const updateBlockDom = useCallback((v) => onUpdateSetting('blockDomElements', v), [onUpdateSetting]);
        const updateBlockWs = useCallback((v) => onUpdateSetting('blockWebSockets', v), [onUpdateSetting]);
        const updateBlockBeacon = useCallback((v) => onUpdateSetting('blockSendBeacon', v), [onUpdateSetting]);
        const updateSpoofVis = useCallback((v) => onUpdateSetting('spoofVisibility', v), [onUpdateSetting]);
        const updateSuppressNoise = useCallback((v) => onUpdateSetting('suppressConsoleNoise', v), [onUpdateSetting]);
        const updateSuppressJitsu = useCallback((v) => onUpdateSetting('suppressJitsu', v), [onUpdateSetting]);

        return html`
            <div className="grid-2col">
                <div className="col-stack">
                    <${Card} className="card--compact">
                        <${Card.Header}>
                            <${Card.Title}>
                                <span>Blocking Preset</span>
                                <${Badge} variant="soft" color="accent">Smart Filters<//>
                            <//>
                            <${Card.Description}>Pick a ready-made preset or customize your active blockers.<//>
                        <//>
                        <${Card.Content}>
                            <div className="field-row">
                                <label>Active Preset
                                    <small>Off · Simple (LogImproperUse only) · Harsh (Block all) · Custom</small>
                                </label>
                                <${Dropdown}
                                    selectedKey=${currentSettings.telemetryPreset}
                                    onSelectionChange=${updatePreset}
                                >
                                    <${Dropdown.Trigger}>
                                        <${Button} variant="secondary" className="dropdown__trigger-btn">
                                            <span>${PRESET_OPTIONS.find(o => o.id === currentSettings.telemetryPreset)?.label || 'Custom'}</span>
                                            <svg className="dropdown__trigger-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6"/></svg>
                                        <//>
                                    <//>
                                    <${Dropdown.Popover}>
                                        <${Dropdown.Menu}>
                                            ${PRESET_OPTIONS.map(opt => html`
                                                <${Dropdown.Item} id=${opt.id} key=${opt.id}>
                                                    <${Dropdown.Item.Label}>${opt.label}<//>
                                                    <${Dropdown.Item.Description}>${opt.desc}<//>
                                                <//>
                                            `)}
                                        <//>
                                    <//>
                                <//>
                            </div>
                        <//>
                    <//>

                    <${Card} className="card--compact">
                        <${Card.Header}>
                            <${Card.Title}>Core Protection Toggles<//>
                            <${Card.Description}>Fine-grained control over network intercepts and client spoofing.<//>
                        <//>
                        <${Card.Content} className="core-toggles-list">
                            <${Switch}
                                size="sm"
                                isSelected=${currentSettings.blockLogImproperUse}
                                onChange=${updateLogImproper}
                            >
                                <${Switch.Control}>
                                    <${Switch.Thumb} />
                                <//>
                                <${Switch.Content}>
                                    <${Switch.Label}>Block LogImproperUse requests<//>
                                    <${Switch.Description}>Silently drops UpLearn improper-use telemetry sent to API<//>
                                <//>
                            <//>

                            <${Switch}
                                size="sm"
                                isSelected=${currentSettings.blockDomElements}
                                onChange=${updateBlockDom}
                            >
                                <${Switch.Control}>
                                    <${Switch.Thumb} />
                                <//>
                                <${Switch.Content}>
                                    <${Switch.Label}>Block DOM telemetry injection<//>
                                    <${Switch.Description}>Hooks script/iframe src and purges blocked tracker nodes<//>
                                <//>
                            <//>

                            <${Switch}
                                size="sm"
                                isSelected=${currentSettings.blockWebSockets}
                                onChange=${updateBlockWs}
                            >
                                <${Switch.Control}>
                                    <${Switch.Thumb} />
                                <//>
                                <${Switch.Content}>
                                    <${Switch.Label}>Block telemetry WebSockets<//>
                                    <${Switch.Description}>Terminates analytics & Intercom WebSocket connections<//>
                                <//>
                            <//>

                            <${Switch}
                                size="sm"
                                isSelected=${currentSettings.blockSendBeacon}
                                onChange=${updateBlockBeacon}
                            >
                                <${Switch.Control}>
                                    <${Switch.Thumb} />
                                <//>
                                <${Switch.Content}>
                                    <${Switch.Label}>Block telemetry sendBeacon<//>
                                    <${Switch.Description}>Drops background beacon-style telemetry packets<//>
                                <//>
                            <//>

                            <${Switch}
                                size="sm"
                                isSelected=${currentSettings.spoofVisibility}
                                onChange=${updateSpoofVis}
                            >
                                <${Switch.Control}>
                                    <${Switch.Thumb} />
                                <//>
                                <${Switch.Content}>
                                    <${Switch.Label}>Spoof visibility & focus<//>
                                    <${Switch.Description}>Ensures page always believes it is focused & visible<//>
                                <//>
                            <//>

                            <${Switch}
                                size="sm"
                                isSelected=${currentSettings.suppressConsoleNoise}
                                onChange=${updateSuppressNoise}
                            >
                                <${Switch.Control}>
                                    <${Switch.Thumb} />
                                <//>
                                <${Switch.Content}>
                                    <${Switch.Label}>Suppress site's console noise<//>
                                    <${Switch.Description}>Mutes [J-ERROR], Jitsu send errors, and blocked-host spam<//>
                                <//>
                            <//>

                            <${Switch}
                                size="sm"
                                isSelected=${currentSettings.suppressJitsu}
                                onChange=${updateSuppressJitsu}
                            >
                                <${Switch.Control}>
                                    <${Switch.Thumb} />
                                <//>
                                <${Switch.Content}>
                                    <${Switch.Label}>Suppress Jitsu telemetry<//>
                                    <${Switch.Description}>Checked: blocks jitsu.uplearn.co.uk. Unchecked: logs inspected packets.<//>
                                <//>
                            <//>
                        <//>
                    <//>
                </div>

                <div className="col-stack">
                    <${Card} className="card--compact">
                        <${Card.Header}>
                            <${Card.Title}>
                                <span>Third-Party Telemetry Services</span>
                                <${Badge} variant="soft" color="accent">${activeServicesCount}/${totalServicesCount} Active<//>
                            <//>
                            <${Card.Description}>Toggle individual analytics trackers. Changes auto-switch preset to Custom.<//>
                        <//>
                        <${Card.Content}>
                            <div className="services-search-bar">
                                <input
                                    type="text"
                                    className="services-search-input"
                                    placeholder="Search service name or hostname…"
                                    value=${servicesFilter}
                                    onInput=${(e) => setServicesFilter(e.target.value)}
                                />
                                <${Button} variant="secondary" size="sm" onPress=${handleEnableAllServices}>
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                                        <polyline points="20 6 9 17 4 12"></polyline>
                                    </svg>
                                    <span>Enable All</span>
                                <//>
                                <${Button} variant="outline" size="sm" onPress=${handleDisableAllServices}>
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                                        <line x1="18" y1="6" x2="6" y2="18"></line>
                                        <line x1="6" y1="6" x2="18" y2="18"></line>
                                    </svg>
                                    <span>Disable All</span>
                                <//>
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

    const TimeBoostTab = React.memo(({
        currentSettings,
        accumulatedBonus,
        onUpdateSetting,
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
            if (!isNaN(val) && val >= 1) onUpdateSetting('extraSecondsMin', val);
            else setMinStr(String(currentSettings.extraSecondsMin));
        }, [minStr, currentSettings.extraSecondsMin, onUpdateSetting]);

        const commitMax = useCallback(() => {
            const val = parseInt(maxStr, 10);
            if (!isNaN(val) && val >= 1) onUpdateSetting('extraSecondsMax', val);
            else setMaxStr(String(currentSettings.extraSecondsMax));
        }, [maxStr, currentSettings.extraSecondsMax, onUpdateSetting]);

        const updateTimeBoost = useCallback((v) => onUpdateSetting('timeBoostEnabled', v), [onUpdateSetting]);
        const updateManualBtn = useCallback((v) => onUpdateSetting('manualTimeButtonEnabled', v), [onUpdateSetting]);
        const updateManualStack = useCallback((v) => onUpdateSetting('manualTimeStacksWithAuto', v), [onUpdateSetting]);
        const updateFullVideo = useCallback((v) => onUpdateSetting('fullVideoWatchedEnabled', v), [onUpdateSetting]);

        const rangeHint = (currentSettings.extraSecondsMin === currentSettings.extraSecondsMax)
            ? `Every question receives +${currentSettings.extraSecondsMin}s.`
            : `Each question rolls random +${currentSettings.extraSecondsMin}–${currentSettings.extraSecondsMax}s.`;

        return html`
            <div className="grid-2col">
                <div className="col-stack">
                    <${Card}>
                        <${Card.Header}>
                            <${Card.Title}>
                                <span>Master Booster Switch</span>
                                <${Badge} variant="soft" color="success">TimeSpent<//>
                            <//>
                            <${Card.Description}>Automatically adds extra time spent to quiz submissions and group summaries.<//>
                        <//>
                        <${Card.Content}>
                            <${Switch}
                                isSelected=${currentSettings.timeBoostEnabled}
                                onChange=${updateTimeBoost}
                            >
                                <${Switch.Control}>
                                    <${Switch.Thumb} />
                                <//>
                                <${Switch.Content}>
                                    <${Switch.Label}>Enable time boost<//>
                                    <${Switch.Description}>Injects calculated time bonuses into AnswerProgressQuizQuestion API calls<//>
                                <//>
                            <//>
                        <//>
                    <//>

                    <${Card}>
                        <${Card.Header}>
                            <${Card.Title}>Random Duration Range<//>
                            <${Card.Description}>${rangeHint}<//>
                        <//>
                        <${Card.Content}>
                            <div className="field-row">
                                <label>Extra Seconds Range
                                    <small>Minimum and maximum extra seconds added per question</small>
                                </label>
                                <div style=${{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <input
                                        type="number"
                                        className="input"
                                        style=${{ width: '78px', textAlign: 'center' }}
                                        min="1"
                                        max="3600"
                                        value=${minStr}
                                        onInput=${(e) => setMinStr(e.target.value)}
                                        onBlur=${commitMin}
                                        onKeyDown=${(e) => { if (e.key === 'Enter') commitMin(); }}
                                    />
                                    <span style=${{ color: 'var(--muted)', fontWeight: 600 }}>to</span>
                                    <input
                                        type="number"
                                        className="input"
                                        style=${{ width: '78px', textAlign: 'center' }}
                                        min="1"
                                        max="3600"
                                        value=${maxStr}
                                        onInput=${(e) => setMaxStr(e.target.value)}
                                        onBlur=${commitMax}
                                        onKeyDown=${(e) => { if (e.key === 'Enter') commitMax(); }}
                                    />
                                    <span style=${{ color: 'var(--muted)', fontWeight: 600 }}>s</span>
                                </div>
                            </div>

                            <div style=${{ marginTop: '8px' }}>
                                <${TagGroup}
                                    ariaLabel="Quick Range Presets"
                                    selectedKeys=${[
                                        QUICK_RANGE_PRESETS.find(p => p.min === currentSettings.extraSecondsMin && p.max === currentSettings.extraSecondsMax)?.label
                                    ].filter(Boolean)}
                                    onSelectionChange=${(label) => {
                                        const p = QUICK_RANGE_PRESETS.find(item => item.label === label);
                                        if (p) {
                                            onUpdateSetting('extraSecondsMin', p.min);
                                            onUpdateSetting('extraSecondsMax', p.max);
                                        }
                                    }}
                                >
                                    <${TagGroup.Label}>Quick Range Presets<//>
                                    <${TagGroup.List}>
                                        ${QUICK_RANGE_PRESETS.map((p, idx) => html`
                                            <${Tag} id=${p.label} key=${idx}>
                                                <span>${p.label}</span>
                                            <//>
                                        `)}
                                    <//>
                                <//>
                            </div>
                        <//>
                    <//>

                    <${Card}>
                        <${Card.Header}>
                            <${Card.Title}>
                                <span>Video Completion</span>
                                <${Badge} variant="soft" color=${currentSettings.fullVideoWatchedEnabled ? 'success' : 'default'}>Videos<//>
                            <//>
                            <${Card.Description}>Always mark watched video lessons as 100% complete.<//>
                        <//>
                        <${Card.Content} className="core-toggles-list">
                            <${Switch}
                                size="sm"
                                isSelected=${currentSettings.fullVideoWatchedEnabled}
                                onChange=${updateFullVideo}
                            >
                                <${Switch.Control}>
                                    <${Switch.Thumb} />
                                <//>
                                <${Switch.Content}>
                                    <${Switch.Label}>Always mark videos as fully watched (100%)<//>
                                    <${Switch.Description}>Sets percentWatched to 1 on CompleteVideoLesson mutations so every video registers as fully completed<//>
                                <//>
                            <//>
                        <//>
                    <//>
                </div>

                <div className="col-stack">
                    <${Card}>
                        <${Card.Header}>
                            <${Card.Title}>
                                <span>Inline "Add Time" Button</span>
                                <${Badge} variant="soft" color=${currentSettings.manualTimeButtonEnabled ? 'success' : 'default'}>Interactive<//>
                            <//>
                            <${Card.Description}>Adds an interactive button beside the question Submit button.<//>
                        <//>
                        <${Card.Content} className="core-toggles-list">
                            <${Switch}
                                size="sm"
                                isSelected=${currentSettings.manualTimeButtonEnabled}
                                onChange=${updateManualBtn}
                            >
                                <${Switch.Control}>
                                    <${Switch.Thumb} />
                                <//>
                                <${Switch.Content}>
                                    <${Switch.Label}>Show "Add time" button<//>
                                    <${Switch.Description}>Adds a button right of "Submit". Click to enter seconds; Enter or blur commits.<//>
                                <//>
                            <//>

                            <${Switch}
                                size="sm"
                                isSelected=${currentSettings.manualTimeStacksWithAuto}
                                onChange=${updateManualStack}
                            >
                                <${Switch.Control}>
                                    <${Switch.Thumb} />
                                <//>
                                <${Switch.Content}>
                                    <${Switch.Label}>Stack with automatic boost<//>
                                    <${Switch.Description}>If enabled, adds manual time on top of random range boost (instead of setting the exact bonus)<//>
                                <//>
                            <//>

                            <div style=${{ padding: '10px 12px', background: 'var(--surface)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', fontSize: '12px', color: 'var(--muted)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                <span>Accepted formats:</span>
                                <span style=${{ fontWeight: 600, color: 'var(--foreground)' }}>120 · 1:30 · 2m 30s · PT45S</span>
                            </div>
                        <//>
                    <//>

                    <${Card}>
                        <${Card.Header}>
                            <${Card.Title}>
                                <span>Boost Automation Insights</span>
                                <${Badge} variant="soft" color="accent">Active Session<//>
                            <//>
                            <${Card.Description}>How UpLearn measures engagement and how the booster works.<//>
                        <//>
                        <${Card.Content}>
                            <div style=${{ fontSize: '12.5px', color: 'var(--muted)', lineHeight: '1.6' }}>
                                UpLearn logs seconds spent on each quiz question and sums them upon finishing a lesson or group. When active, every answered question receives a bonus (randomized or manually entered), maintaining realistic, organic engagement scores without tripping detection heuristics.
                            </div>
                            <div style=${{ marginTop: '8px', padding: '12px 14px', background: 'var(--surface)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                <span style=${{ fontSize: '12.5px', fontWeight: 500, color: 'var(--foreground)' }}>Cumulative Session Bonus</span>
                                <span style=${{ fontSize: '14px', fontWeight: 700, color: 'var(--accent)' }}>+${accumulatedBonus}s</span>
                            </div>
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
                style=${{ backgroundColor: color.hex }}
                title=${color.name}
                data-active=${isSelected ? 'true' : 'false'}
                onClick=${() => onSelect(color.hex)}
            ></div>
        `;
    });

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
        const updatePillOpacity = useCallback((val) => onUpdateSetting('pillOpacity', val), [onUpdateSetting]);
        const updateDisableAutoFullscreen = useCallback((val) => onUpdateSetting('disableAutoFullscreen', val), [onUpdateSetting]);
        const updateDarkMode = useCallback((val) => onUpdateSetting('darkMode', val), [onUpdateSetting]);
        const updateTheme = useCallback((val) => onUpdateSetting('theme', val), [onUpdateSetting]);
        const updateAccentColor = useCallback((val) => onUpdateSetting('accentColor', val), [onUpdateSetting]);
        const updateLogLevel = useCallback((val) => onUpdateSetting('logLevel', val), [onUpdateSetting]);

        return html`
            <div className="grid-2col">
                <div className="col-stack">
                    <${Card}>
                        <${Card.Header}>
                            <${Card.Title}>Status Pill Appearance & Detail<//>
                            <${Card.Description}>Control how much information shows on the floating pill and how it shapes itself.<//>
                        <//>
                        <${Card.Content}>
                            <div className="field-row">
                                <label>Pill Information Display
                                    <small>Select how much info is displayed. The pill dynamically adapts its shape.</small>
                                </label>
                                <${Dropdown}
                                    selectedKey=${currentSettings.pillMode}
                                    onSelectionChange=${updatePillMode}
                                >
                                    <${Dropdown.Trigger}>
                                        <${Button} variant="secondary" className="dropdown__trigger-btn">
                                            <span>${PILL_MODE_OPTIONS.find(o => o.id === currentSettings.pillMode)?.label || currentSettings.pillMode}</span>
                                            <svg className="dropdown__trigger-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6"/></svg>
                                        <//>
                                    <//>
                                    <${Dropdown.Popover}>
                                        <${Dropdown.Menu}>
                                            ${PILL_MODE_OPTIONS.map(opt => html`
                                                <${Dropdown.Item} id=${opt.id} key=${opt.id}>
                                                    <${Dropdown.Item.Label}>${opt.label}<//>
                                                    <${Dropdown.Item.Description}>${opt.desc}<//>
                                                <//>
                                            `)}
                                        <//>
                                    <//>
                                <//>
                            </div>

                            <div className="field-row">
                                <label>Pill Dock Position
                                    <small>Corner of the screen where the status pill floats</small>
                                </label>
                                <${Dropdown}
                                    selectedKey=${currentSettings.pillPosition}
                                    onSelectionChange=${updatePillPosition}
                                >
                                    <${Dropdown.Trigger}>
                                        <${Button} variant="secondary" className="dropdown__trigger-btn">
                                            <span>${PILL_POS_OPTIONS.find(o => o.id === currentSettings.pillPosition)?.label || currentSettings.pillPosition}</span>
                                            <svg className="dropdown__trigger-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6"/></svg>
                                        <//>
                                    <//>
                                    <${Dropdown.Popover}>
                                        <${Dropdown.Menu}>
                                            ${PILL_POS_OPTIONS.map(opt => html`
                                                <${Dropdown.Item} id=${opt.id} key=${opt.id}>
                                                    <${Dropdown.Item.Label}>${opt.label}<//>
                                                    <${Dropdown.Item.Description}>${opt.desc}<//>
                                                <//>
                                            `)}
                                        <//>
                                    <//>
                                <//>
                            </div>

                            <div className="field-row">
                                <label>Pill Opacity
                                    <small>Adjust background transparency</small>
                                </label>
                                <${Slider}
                                    value=${currentSettings.pillOpacity}
                                    minValue=${0.2}
                                    maxValue=${1}
                                    step=${0.05}
                                    onChange=${updatePillOpacity}
                                    className="slider--inline"
                                >
                                    <${Slider.Track}>
                                        <${Slider.Fill} />
                                        <${Slider.Thumb} />
                                    <//>
                                    <${Slider.Output}>
                                        ${Math.round(currentSettings.pillOpacity * 100)}%
                                    <//>
                                <//>
                            </div>
                        <//>
                    <//>

                    <${Card}>
                        <${Card.Header}>
                            <${Card.Title}>Page Experience<//>
                            <${Card.Description}>Quality of life tweaks for the UpLearn learning environment.<//>
                        <//>
                        <${Card.Content}>
                            <${Switch}
                                isSelected=${currentSettings.disableAutoFullscreen}
                                onChange=${updateDisableAutoFullscreen}
                            >
                                <${Switch.Control}>
                                    <${Switch.Thumb} />
                                <//>
                                <${Switch.Content}>
                                    <${Switch.Label}>Disable auto fullscreen<//>
                                    <${Switch.Description}>Blocks the website from silently forcing fullscreen mode<//>
                                <//>
                            <//>

                            <${Switch}
                                isSelected=${currentSettings.darkMode}
                                onChange=${updateDarkMode}
                            >
                                <${Switch.Control}>
                                    <${Switch.Thumb} />
                                <//>
                                <${Switch.Content}>
                                    <${Switch.Label}>UpLearn Dark Mode<//>
                                    <${Switch.Description}>Soft high-contrast dark theme across all lesson and quiz pages<//>
                                <//>
                            <//>
                        <//>
                    <//>
                </div>

                <div className="col-stack">
                    <${Card}>
                        <${Card.Header}>
                            <${Card.Title}>Theme & Accent Color<//>
                            <${Card.Description}>Customize color palette and visual styling.<//>
                        <//>
                        <${Card.Content}>
                            <div className="field-row">
                                <label>Control Panel Theme</label>
                                <${Dropdown}
                                    selectedKey=${currentSettings.theme}
                                    onSelectionChange=${updateTheme}
                                >
                                    <${Dropdown.Trigger}>
                                        <${Button} variant="secondary" className="dropdown__trigger-btn">
                                            <span>${THEME_OPTIONS.find(o => o.id === currentSettings.theme)?.label || currentSettings.theme}</span>
                                            <svg className="dropdown__trigger-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6"/></svg>
                                        <//>
                                    <//>
                                    <${Dropdown.Popover}>
                                        <${Dropdown.Menu}>
                                            ${THEME_OPTIONS.map(opt => html`
                                                <${Dropdown.Item} id=${opt.id} key=${opt.id}>
                                                    <${Dropdown.Item.Label}>${opt.label}<//>
                                                    <${Dropdown.Item.Description}>${opt.desc}<//>
                                                <//>
                                            `)}
                                        <//>
                                    <//>
                                <//>
                            </div>

                            <div className="field-row">
                                <label>Theme Accent Color
                                    <small>Primary color for switches, active badges, and highlights</small>
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
                                    <input
                                        type="color"
                                        style=${{ width: '36px', height: '28px', border: '1px solid var(--border)', borderRadius: '6px', background: 'transparent', cursor: 'pointer', padding: '1px' }}
                                        value=${currentSettings.accentColor}
                                        onChange=${(e) => updateAccentColor(e.target.value)}
                                    />
                                </div>
                            </div>
                        <//>
                    <//>

                    <${Card}>
                        <${Card.Header}>
                            <${Card.Title}>Shortcuts & Logging<//>
                            <${Card.Description}>Configure hotkeys and developer diagnostics.<//>
                        <//>
                        <${Card.Content}>
                            <div className="field-row">
                                <label>Toggle-Pill Keybind
                                    <small>Global keyboard shortcut to show or hide the pill</small>
                                </label>
                                <div style=${{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <${Button}
                                        variant="secondary"
                                        size="sm"
                                        className=${isCapturingKeybind ? 'button--capturing' : ''}
                                        onPress=${onStartCaptureKeybind}
                                    >
                                        ${isCapturingKeybind ? 'Press any key…' : formatKeybind(currentSettings.uiToggleKeybind)}
                                    <//>
                                    <${Button}
                                        variant="outline"
                                        size="sm"
                                        isIconOnly
                                        title="Clear keybind"
                                        aria-label="Clear keybind"
                                        onPress=${onClearKeybind}
                                    >
                                        ✕
                                    <//>
                                </div>
                            </div>

                            <div className="field-row">
                                <label>Console Logging Level
                                    <small>Verbose inspects bodies and prints grouped block reports</small>
                                </label>
                                <${Dropdown}
                                    selectedKey=${currentSettings.logLevel}
                                    onSelectionChange=${updateLogLevel}
                                >
                                    <${Dropdown.Trigger}>
                                        <${Button} variant="secondary" className="dropdown__trigger-btn">
                                            <span>${LOG_LEVEL_OPTIONS.find(o => o.id === currentSettings.logLevel)?.label || currentSettings.logLevel}</span>
                                            <svg className="dropdown__trigger-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6"/></svg>
                                        <//>
                                    <//>
                                    <${Dropdown.Popover}>
                                        <${Dropdown.Menu}>
                                            ${LOG_LEVEL_OPTIONS.map(opt => html`
                                                <${Dropdown.Item} id=${opt.id} key=${opt.id}>
                                                    <${Dropdown.Item.Label}>${opt.label}<//>
                                                    <${Dropdown.Item.Description}>${opt.desc}<//>
                                                <//>
                                            `)}
                                        <//>
                                    <//>
                                <//>
                            </div>

                            <div style=${{ marginTop: '6px', paddingTop: '12px', borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                <div>
                                    <div style=${{ fontSize: '12.5px', fontWeight: 600, color: 'var(--foreground)' }}>Reset All Preferences</div>
                                    <div style=${{ fontSize: '11px', color: 'var(--muted)' }}>Restore all settings & services to factory defaults</div>
                                </div>
                                <${Button} variant="danger-soft" size="sm" onPress=${onResetAllSettings}>
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"></path>
                                        <path d="M21 3v5h-5"></path>
                                        <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"></path>
                                        <path d="M8 16H3v5"></path>
                                    </svg>
                                    <span>Reset All Settings</span>
                                <//>
                            </div>
                        <//>
                    <//>
                </div>
            </div>
        `;
    });

    const StatsTab = React.memo(({
        accumulatedBonus,
        onResetStats,
        isActive,
    }) => {
        const { useState, useEffect, useCallback } = React;
        const [tabStats, setTabStats] = useState(Object.assign({}, stats));

        useEffect(() => {
            if (!isActive) return;
            const update = () => {
                setTabStats((prev) => {
                    if (
                        prev.apiPosts === stats.apiPosts &&
                        prev.seen === stats.seen &&
                        prev.boosted === stats.boosted &&
                        prev.blocked === stats.blocked &&
                        prev.groupExtra === stats.groupExtra &&
                        prev.fullscreenBlocked === stats.fullscreenBlocked &&
                        prev.consoleSuppressed === stats.consoleSuppressed &&
                        prev.logImproperUseBlocked === stats.logImproperUseBlocked &&
                        prev.jitsuPackets === stats.jitsuPackets &&
                        prev.manualBoosted === (stats.manualBoosted || 0) &&
                        prev.videosMaxed === (stats.videosMaxed || 0)
                    ) {
                        return prev;
                    }
                    return Object.assign({}, stats);
                });
            };
            update();
            const timer = setInterval(update, 800);
            return () => clearInterval(timer);
        }, [isActive]);

        const handleReset = useCallback(() => {
            onResetStats();
            setTabStats(Object.assign({}, stats));
        }, [onResetStats]);

        return html`
            <${Card}>
                <${Card.Header}>
                    <${Card.Title}>
                        <span>Session Telemetry & Boost Activity</span>
                        <${Badge} variant="soft" color="accent">Real-Time<//>
                    <//>
                    <${Card.Description}>Live metric counters accumulated in this browser session.<//>
                <//>
                <${Card.Content}>
                    <div className="stats-grid">
                        <div className="stat-card">
                            <span className="stat-card__label">Blocked</span>
                            <span className="stat-card__value">${tabStats.blocked}</span>
                        </div>
                        <div className="stat-card">
                            <span className="stat-card__label">Boosted Qs</span>
                            <span className="stat-card__value">${tabStats.boosted}</span>
                        </div>
                        <div className="stat-card">
                            <span className="stat-card__label">Videos 100%</span>
                            <span className="stat-card__value">${tabStats.videosMaxed || 0}</span>
                        </div>
                        <div className="stat-card">
                            <span className="stat-card__label">Manual Boosts</span>
                            <span className="stat-card__value">${tabStats.manualBoosted || 0}</span>
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
                            <span className="stat-card__label">Pending Bonus</span>
                            <span className="stat-card__value">${accumulatedBonus}s</span>
                        </div>
                        <div className="stat-card">
                            <span className="stat-card__label">Group Bonus</span>
                            <span className="stat-card__value">${tabStats.groupExtra}s</span>
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

                    <div style=${{ marginTop: '16px', display: 'flex', justifyContent: 'flex-end' }}>
                        <${Button} variant="secondary" size="sm" onPress=${handleReset}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"></path>
                                <path d="M21 3v5h-5"></path>
                                <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"></path>
                                <path d="M8 16H3v5"></path>
                            </svg>
                            <span>Reset Session Statistics</span>
                        <//>
                    </div>
                <//>
            <//>
        `;
    });

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
    }) => {
        if (!isOpen && !isClosing) return null;

        const { useState } = React;
        const [activeTab, setActiveTab] = useState('telemetry');
        const [tabDirection, setTabDirection] = useState('forward');
        const [visitedTabs, setVisitedTabs] = useState(() => new Set(['telemetry']));

        const TAB_KEYS = ['telemetry', 'timeboost', 'preferences', 'stats'];

        const handleTabClick = (targetTab) => {
            if (targetTab === activeTab) return;
            const curIdx = TAB_KEYS.indexOf(activeTab);
            const targetIdx = TAB_KEYS.indexOf(targetTab);
            setTabDirection(targetIdx > curIdx ? 'forward' : 'backward');
            setActiveTab(targetTab);
            setVisitedTabs(prev => {
                if (prev.has(targetTab)) return prev;
                const next = new Set(prev);
                next.add(targetTab);
                return next;
            });
        };

        return html`
            <${Modal} isOpen=${isOpen} isClosing=${isClosing} onClose=${onClose}>
                <${Modal.Backdrop} isClosing=${isClosing} onClose=${onClose}>
                    <${Modal.Container}>
                        <${Modal.Dialog}>

                            <!-- Header -->
                            <${Modal.Header}>
                                <div className="modal__header-top">
                                    <${Modal.Brand}>
                                        <${Modal.Icon}>
                                            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                                                <circle cx="12" cy="12" r="3"></circle>
                                                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
                                            </svg>
                                        <//>
                                        <${Modal.Heading}>UpLearn Control Panel<//>
                                    <//>
                                    <${Modal.CloseTrigger} onPress=${onClose} />
                                </div>

                                <!-- Tabs Navigation via TagGroup -->
                                <${TagGroup}
                                    ariaLabel="Panel Navigation"
                                    selectionMode="single"
                                    selectedKeys=${[activeTab]}
                                    onSelectionChange=${handleTabClick}
                                    className="modal__tab-group"
                                >
                                    <${TagGroup.List} className="modal__tab-tags">
                                        <${Tag} id="telemetry">
                                            <span>🛡 Telemetry</span>
                                        <//>
                                        <${Tag} id="timeboost">
                                            <span>⏱ Time Boost</span>
                                        <//>
                                        <${Tag} id="preferences">
                                            <span>🎨 Preferences</span>
                                        <//>
                                        <${Tag} id="stats">
                                            <span>📊 Statistics</span>
                                        <//>
                                    <//>
                                <//>
                            <//>

                            <!-- Body -->
                            <${Modal.Body}>
                                ${visitedTabs.has('telemetry') && html`
                                    <${Tabs.Panel} id="telemetry" activeTab=${activeTab} direction=${tabDirection}>
                                        <${TelemetryTab}
                                            currentSettings=${currentSettings}
                                            onUpdateSetting=${onUpdateSetting}
                                        />
                                    <//>
                                `}
                                ${visitedTabs.has('timeboost') && html`
                                    <${Tabs.Panel} id="timeboost" activeTab=${activeTab} direction=${tabDirection}>
                                        <${TimeBoostTab}
                                            currentSettings=${currentSettings}
                                            accumulatedBonus=${accumulatedBonus}
                                            onUpdateSetting=${onUpdateSetting}
                                        />
                                    <//>
                                `}
                                ${visitedTabs.has('preferences') && html`
                                    <${Tabs.Panel} id="preferences" activeTab=${activeTab} direction=${tabDirection}>
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
                                    <${Tabs.Panel} id="stats" activeTab=${activeTab} direction=${tabDirection}>
                                        <${StatsTab}
                                            accumulatedBonus=${accumulatedBonus}
                                            onResetStats=${onResetStats}
                                            isActive=${activeTab === 'stats'}
                                        />
                                    <//>
                                `}
                            <//>

                            <!-- Modal Footer with HeroUI v3 Actions -->
                            <${Modal.Footer}>
                                <${Button} variant="secondary" size="sm" onPress=${onClose}>Close<//>
                                <${Button} variant="primary" size="sm" onPress=${onClose}>Done<//>
                            <//>

                        <//>
                    <//>
                <//>
            <//>
        `;
    });

    // --- Root App Component ---
    const App = () => {
        const { useState, useEffect, useCallback } = React;
        const [appSettings, setAppSettings] = useState(Object.assign({}, settings));
        const [appStats, setAppStats] = useState(Object.assign({}, stats));
        const [accumulatedBonus, setAccumulatedBonus] = useState(accumulatedExtraSeconds);
        const [isModalOpen, setIsModalOpen] = useState(false);
        const [isClosing, setIsClosing] = useState(false);
        const [isCapturing, setIsCapturing] = useState(false);

        // Register bridges for global callbacks
        useEffect(() => {
            reactSetSettings = setAppSettings;
            reactSetStats = (st) => {
                setAppStats(Object.assign({}, st));
                if (typeof st.accumulated !== 'undefined') setAccumulatedBonus(st.accumulated);
            };
            reactSetModalOpen = (open) => {
                if (open) {
                    setIsClosing(false);
                    setIsModalOpen(true);
                    isModalOpenGlobal = true;
                } else {
                    setIsClosing(true);
                    setTimeout(() => {
                        setIsModalOpen(false);
                        setIsClosing(false);
                        isModalOpenGlobal = false;
                    }, 190);
                }
            };
            reactSetCapturingKeybind = setIsCapturing;

            return () => {
                reactSetSettings = null;
                reactSetStats = null;
                reactSetModalOpen = null;
                reactSetCapturingKeybind = null;
            };
        }, []);

        // Real-time live stats update interval with equality bail-out
        useEffect(() => {
            const interval = setInterval(() => {
                setAppStats((prev) => {
                    if (
                        prev.apiPosts === stats.apiPosts &&
                        prev.seen === stats.seen &&
                        prev.boosted === stats.boosted &&
                        prev.blocked === stats.blocked &&
                        prev.groupExtra === stats.groupExtra &&
                        prev.fullscreenBlocked === stats.fullscreenBlocked &&
                        prev.consoleSuppressed === stats.consoleSuppressed &&
                        prev.logImproperUseBlocked === stats.logImproperUseBlocked &&
                        prev.jitsuPackets === stats.jitsuPackets &&
                        prev.manualBoosted === (stats.manualBoosted || 0)
                    ) {
                        return prev; // exact same reference => React bails out of re-rendering!
                    }
                    return Object.assign({}, stats);
                });
                setAccumulatedBonus((prev) => (prev === accumulatedExtraSeconds ? prev : accumulatedExtraSeconds));
            }, 800);
            return () => clearInterval(interval);
        }, []);

        const handleCloseModal = useCallback(() => {
            if (isClosing) return;
            setIsClosing(true);
            setTimeout(() => {
                setIsModalOpen(false);
                setIsClosing(false);
                isModalOpenGlobal = false;
            }, 190);
        }, [isClosing]);

        const handleOpenSettings = useCallback(() => {
            if (reactSetModalOpen) reactSetModalOpen(true);
        }, []);

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
                setAppSettings(Object.assign({}, settings));
                LOG('settings reset to defaults');
            }
        }, []);

        const handleResetStats = useCallback(() => {
            stats.apiPosts = 0; stats.seen = 0; stats.boosted = 0;
            stats.blocked = 0; stats.groupExtra = 0; stats.fullscreenBlocked = 0;
            stats.consoleSuppressed = 0; stats.logImproperUseBlocked = 0;
            stats.jitsuPackets = 0; stats.manualBoosted = 0;
            accumulatedExtraSeconds = 0; accumulatedQuestionCount = 0;
            setAppStats(Object.assign({}, stats));
            setAccumulatedBonus(0);
            LOG('stats reset');
        }, []);

        // Sync theme attribute & accent CSS variable on root container
        const effectiveTheme = getEffectiveTheme(appSettings.theme);
        useEffect(() => {
            if (uiContainerEl) {
                uiContainerEl.setAttribute('data-theme', effectiveTheme);
                uiContainerEl.style.setProperty('--accent', appSettings.accentColor);
            }
        }, [effectiveTheme, appSettings.accentColor]);

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
            LOG('HeroUI v3 React UI mounted');
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
        if (e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey && e.code === 'KeyU') {
            e.preventDefault();
            if (isModalOpenGlobal) closeSettingsModal();
            else openSettingsModal();
            return;
        }
        if (matchesKeybind(e, settings.uiToggleKeybind) && !e.repeat) {
            settings.pillVisible = !settings.pillVisible;
            saveSettings();
            syncModalIfOpen();
            LOG('pill ' + (settings.pillVisible ? 'SHOWN' : 'HIDDEN'));
        }
    }, true);

    // ============================================================
    // BOOTSTRAP
    // ============================================================
    function bootstrap() {
        ensureUIHost();
        ensureButton();
        initManualButtonObserver();
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
    } else {
        bootstrap();
    }

    // ============================================================
    // PUBLIC API
    // ============================================================
    window.__ul = {
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
        getQueuedSeconds: () => queuedSeconds,
        setQueuedSeconds: (secs) => {
            queuedSeconds = secs;
            updateLabel();
        },
        ensureManualTimeButton: ensureButton,
        removeManualTimeButton: removeButton,
        rewriteBodyText,
        telemetryServices: TELEMETRY_SERVICES,
        resetStats: () => {
            stats.apiPosts = 0; stats.seen = 0; stats.boosted = 0;
            stats.blocked = 0; stats.groupExtra = 0; stats.fullscreenBlocked = 0;
            stats.consoleSuppressed = 0; stats.logImproperUseBlocked = 0;
            stats.jitsuPackets = 0; stats.manualBoosted = 0; stats.videosMaxed = 0;
            accumulatedExtraSeconds = 0; accumulatedQuestionCount = 0;
        },
        getAccumulated: () => accumulatedExtraSeconds,
        getAccumulatedCount: () => accumulatedQuestionCount,
        pickExtraSeconds,
        _match: (url) => matchTelemetryService(url),
    };

    LOG('=== READY | timeBoost:', settings.timeBoostEnabled,
        '| range:', settings.extraSecondsMin + '–' + settings.extraSecondsMax + 's',
        '| manualTimeBtn:', settings.manualTimeButtonEnabled ? 'ON' : 'OFF',
        '| fullVideoWatched:', settings.fullVideoWatchedEnabled ? 'ON' : 'OFF',
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
        nativeConsole.log('%cManual time button:     ', CSS.muted, settings.manualTimeButtonEnabled ? 'ON' : 'OFF');
        nativeConsole.log('%cFull video watch:       ', CSS.muted, settings.fullVideoWatchedEnabled ? 'ON' : 'OFF');
        nativeConsole.log('%cDOM injection:          ', CSS.muted, settings.blockDomElements ? 'ON' : 'OFF');
        nativeConsole.log('%cWebSockets:             ', CSS.muted, settings.blockWebSockets ? 'ON' : 'OFF');
        nativeConsole.log('%csendBeacon:             ', CSS.muted, settings.blockSendBeacon ? 'ON' : 'OFF');
        nativeConsole.log('%cVisibility spoofing:    ', CSS.muted, settings.spoofVisibility ? 'ON' : 'OFF');
        nativeConsole.log('%cConsole noise filter:   ', CSS.muted, settings.suppressConsoleNoise ? 'ON' : 'OFF');
        nativeConsole.log('%cFullscreen block:       ', CSS.muted, settings.disableAutoFullscreen ? 'ON' : 'OFF');
        nativeConsole.groupEnd();
    }
})();