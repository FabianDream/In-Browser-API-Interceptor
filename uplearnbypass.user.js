// ==UserScript==
// @name         UpLearn Telemetry Blocker & TimeSpent Booster
// @namespace    https://github.com/local/uplearn-telemetry-blocker
// @version      3.3.0
// @description  Configurable telemetry blocking with detailed verbose logging, aggressive console-noise suppression, dedicated LogImproperUse logging, full request body capture; random-range time boost; dark mode; full control panel UI
// @author       you
// @match        https://web.uplearn.co.uk/*
// @run-at       document-start
// @grant        none
// @inject-into  page
// @noframes
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
        blockLogImproperUse:       true,
        spoofVisibility:           true,
        blockWebSockets:           true,
        blockSendBeacon:           true,
        blockDomElements:          true,
        suppressConsoleNoise:      true,
        timeBoostEnabled:          true,
        extraSecondsMin:           30,
        extraSecondsMax:           90,
        disableAutoFullscreen:     true,
        darkMode:                  false,
        pillVisible:               true,
        pillPosition:              'bottom-right',
        pillOpacity:               1,
        showStats:                 true,
        theme:                     'dark',
        accentColor:               '#16a34a',
        logLevel:                  'normal',
        uiToggleKeybind:           Object.assign({}, DEFAULT_KEYBIND),
    };

    const INDIVIDUAL_TELEMETRY_SETTINGS = new Set([
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

    function saveSettings() {
        try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch {}
    }

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

    function hostOf(url) {
        try { return new URL(url, location.href).hostname.toLowerCase(); }
        catch { return ''; }
    }

    function matchTelemetryService(url) {
        if (!url) return null;
        const h = hostOf(url);
        if (!h) return null;
        const enabled = settings.telemetryServices || {};
        for (const key in TELEMETRY_SERVICES) {
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
        try {
            const u = new URL(url, location.href);
            return u.host === API_HOST && API_PATH_RE.test(u.pathname);
        } catch { return false; }
    }

    // ============================================================
    // STATS (declared here so the console filter can increment)
    // ============================================================
    const stats = {
        apiPosts: 0, seen: 0, boosted: 0, blocked: 0,
        groupExtra: 0, fullscreenBlocked: 0, consoleSuppressed: 0,
        logImproperUseBlocked: 0,
    };

    // ============================================================
    // CONSOLE NOISE FILTER
    // ============================================================
    // Two sources of noise from the site's own libraries:
    //   1. Jitsu: "[J-ERROR] Dropping queued event after 4 attempts…",
    //             "Failed to send data to https://jitsu.uplearn.co.uk/…"
    //   2. Apollo Client: yellow warning referencing go.apollo.dev/c/err
    //             triggered by our synthetic 204 responses on blocked
    //             telemetry endpoints.
    // Both are console.error / console.warn calls we can intercept.
    //
    // NOTE: DevTools-native network error lines ("POST https://…  net::
    // ERR_BLOCKED_BY_CLIENT") are rendered by Chrome itself and CANNOT
    // be suppressed from JavaScript. They usually mean a browser
    // extension or Chrome's tracking protection is also blocking the
    // request (or a stale @webRequest rule from an older script version).
    // ============================================================
    const NOISE_PATTERNS = [
        // Jitsu internal logging
        /\[J-(?:ERROR|WARN|DEBUG|INFO|LOG)\]/i,
        /\[Jitsu\]/i,
        /Failed to send data to/i,
        /Dropping queued event after/i,
        /max send attempts/i,
        // Apollo Client complaining about blocked/synthetic responses
        /go\.apollo\.dev\/c\/err/i,
        // Sentry SDK self-logging (e.g. "[Sentry] …")
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
        for (let i = 0; i < NOISE_PATTERNS.length; i++) {
            if (NOISE_PATTERNS[i].test(text)) return true;
        }
        const lower = text.toLowerCase();
        for (let i = 0; i < ALL_TELEMETRY_HOSTS.length; i++) {
            if (lower.indexOf(ALL_TELEMETRY_HOSTS[i]) !== -1) return true;
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
    // BLOCK / ALLOW REPORTERS
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
                .filter((k) => settings.telemetryServices[k])
                .map((k) => TELEMETRY_SERVICES[k].label)
                .join(', ') || '(none)');
        nativeConsole.log('%cLogImproperUse:  ', CSS.muted, settings.blockLogImproperUse);
        nativeConsole.log('%cDOM inject:      ', CSS.muted, settings.blockDomElements);
        nativeConsole.log('%cWebSockets:      ', CSS.muted, settings.blockWebSockets);
        nativeConsole.log('%csendBeacon:      ', CSS.muted, settings.blockSendBeacon);
        nativeConsole.log('%cVisibility:      ', CSS.muted, settings.spoofVisibility);
        nativeConsole.log('%cConsole noise:   ', CSS.muted, settings.suppressConsoleNoise);
        nativeConsole.log('%cTime boost:      ', CSS.muted, settings.timeBoostEnabled,
            `(+${settings.extraSecondsMin}–${settings.extraSecondsMax}s)`);
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
    }, 500);

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
    // TIME BOOST
    // ============================================================
    const QUIZ_OP  = 'AnswerProgressQuizQuestion';
    const GROUP_OP = 'CompleteProgressQuizGroup';

    let accumulatedExtraSeconds  = 0;
    let accumulatedQuestionCount = 0;

    function parseISODuration(str) {
        const m = /^PT(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(str);
        if (!m) return null;
        return parseFloat(m[1] || 0) * 3600 + parseFloat(m[2] || 0) * 60 + parseFloat(m[3] || 0);
    }
    function toISODuration(totalSeconds) {
        return 'PT' + String(Math.round(totalSeconds * 1000) / 1000) + 'S';
    }
    function pickExtraSeconds() {
        const min = Math.min(settings.extraSecondsMin, settings.extraSecondsMax);
        const max = Math.max(settings.extraSecondsMin, settings.extraSecondsMax);
        if (min === max) return min;
        return Math.floor(min + Math.random() * (max - min + 1));
    }

    function maybeBumpTimeSpent(body, source) {
        if (!settings.timeBoostEnabled) return { body, changed: false };
        if (typeof body !== 'string')    return { body, changed: false };

        const hasQuiz  = body.includes(QUIZ_OP);
        const hasGroup = body.includes(GROUP_OP);
        if (!hasQuiz && !hasGroup) return { body, changed: false };

        let json;
        try { json = JSON.parse(body); }
        catch { return { body, changed: false }; }

        let changed = false;

        const patch = (obj) => {
            if (!obj || !obj.operationName || !obj.variables) return;

            if (obj.operationName === QUIZ_OP && typeof obj.variables.timeSpent === 'string') {
                const total = parseISODuration(obj.variables.timeSpent);
                if (total === null) return;
                const before = obj.variables.timeSpent;
                const extra  = pickExtraSeconds();
                obj.variables.timeSpent = toISODuration(total + extra);
                accumulatedExtraSeconds  += extra;
                accumulatedQuestionCount += 1;
                stats.seen++; stats.boosted++;
                changed = true;
                LOG(`[${source}] ${QUIZ_OP}: ${before} → ${obj.variables.timeSpent} ` +
                    `(+${extra}s, accumulated ${accumulatedExtraSeconds}s / ${accumulatedQuestionCount} q)`);
                VLOG('boost roll', {
                    rolled: extra,
                    range: `[${settings.extraSecondsMin}–${settings.extraSecondsMax}]`,
                    newAccumulated: accumulatedExtraSeconds,
                    questionCount: accumulatedQuestionCount,
                });
            }
            else if (obj.operationName === GROUP_OP && typeof obj.variables.timeSpent === 'string') {
                const total = parseISODuration(obj.variables.timeSpent);
                if (total === null) return;
                const before = obj.variables.timeSpent;
                const bonus  = accumulatedExtraSeconds;
                const count  = accumulatedQuestionCount;
                obj.variables.timeSpent = toISODuration(total + bonus);
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

        return changed ? { body: JSON.stringify(json), changed: true } : { body, changed: false };
    }

    // ============================================================
    // FETCH INTERCEPTOR
    // ============================================================
    const origFetch = window.fetch;
    if (origFetch) {
        window.fetch = function (input, init) {
            try {
                const url = typeof input === 'string' ? input
                          : (input && input.url) ? input.url
                          : String(input);
                const method = ((init && init.method) || (input && input.method) || 'GET').toUpperCase();

                // Telemetry URL hard block
                if (isTelemetryUrl(url)) {
                    const bodyForReport = init && typeof init.body === 'string' ? init.body : null;
                    reportBlock('fetch', url, { method, body: bodyForReport });
                    stats.blocked++;
                    // 200 with empty body avoids triggering library retry logic
                    // that a 204 does (e.g. Apollo treating 204 as an error).
                    return Promise.resolve(new Response('', {
                        status: 200, statusText: 'OK',
                        headers: { 'Content-Type': 'application/json' },
                    }));
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
                            const self = this;
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

            return origFetch.call(this, input, init);
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
                    reportBlock('XHR', this.__ul_url, { method, body: bodyStr });
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
                    reportBlock('sendBeacon', String(url), { body: bodyStr });
                    stats.blocked++;
                    return true;
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
    }, 2000);

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
    // STYLES
    // ============================================================
    function ensureStyles() {
        if (document.getElementById('__ul-styles')) return;
        const style = document.createElement('style');
        style.id = '__ul-styles';
        style.textContent = `
            #__ul-pill {
                position: fixed; z-index: 2147483646;
                font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
                font-size: 12px; font-weight: 600; line-height: 1.3;
                border-radius: 12px; box-shadow: 0 2px 12px rgba(0,0,0,0.35);
                user-select: none; display: flex; align-items: stretch; overflow: hidden;
                transition: transform 0.12s ease, opacity 0.15s ease;
                letter-spacing: 0.2px; border: 1px solid rgba(255,255,255,0.08);
            }
            #__ul-pill .ul-pill-main {
                padding: 8px 12px; cursor: pointer; text-align: center;
                transition: background 0.15s, color 0.15s;
                display: flex; flex-direction: column; justify-content: center; gap: 2px;
            }
            #__ul-pill .ul-pill-main:hover { filter: brightness(1.08); }
            #__ul-pill .ul-pill-row1 { font-weight: 700; }
            #__ul-pill .ul-pill-row2 { font-size: 10px; font-weight: 600; opacity: 0.88; letter-spacing: 0.3px; }
            #__ul-pill .ul-pill-gear {
                display: flex; align-items: center; justify-content: center;
                padding: 0 10px; cursor: pointer; background: rgba(0,0,0,0.22);
                color: inherit; font-size: 14px; transition: background 0.15s;
                border: none; font-family: inherit;
            }
            #__ul-pill .ul-pill-gear:hover { background: rgba(0,0,0,0.4); }

            #__ul-settings-overlay {
                position: fixed; inset: 0; z-index: 2147483647;
                background: rgba(0,0,0,0.55);
                backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
                display: flex; align-items: center; justify-content: center;
                font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
                animation: ul-fade-in 0.15s ease-out;
            }
            @keyframes ul-fade-in { from { opacity: 0; } to { opacity: 1; } }
            .ul-modal {
                --ul-bg: #0f172a; --ul-fg: #e2e8f0; --ul-muted: #94a3b8;
                --ul-border: rgba(148, 163, 184, 0.18); --ul-card: #1e293b;
                --ul-input-bg: #0b1220; --ul-accent: #16a34a; --ul-danger: #dc2626;
                width: min(760px, 94vw); max-height: 88vh;
                background: var(--ul-bg); color: var(--ul-fg);
                border-radius: 16px; border: 1px solid var(--ul-border);
                box-shadow: 0 24px 80px rgba(0,0,0,0.6);
                display: flex; flex-direction: column; overflow: hidden;
                animation: ul-pop 0.18s ease-out;
            }
            @keyframes ul-pop { from { transform: scale(0.96); opacity: 0; } to { transform: scale(1); opacity: 1; } }
            .ul-modal[data-theme="light"] {
                --ul-bg: #ffffff; --ul-fg: #0f172a; --ul-muted: #64748b;
                --ul-border: rgba(15, 23, 42, 0.12); --ul-card: #f1f5f9; --ul-input-bg: #ffffff;
            }
            .ul-modal .ul-header {
                display: flex; align-items: center; justify-content: space-between;
                padding: 16px 22px; border-bottom: 1px solid var(--ul-border);
                background: var(--ul-card); flex-shrink: 0;
            }
            .ul-modal .ul-title { display: flex; align-items: center; gap: 10px; }
            .ul-modal .ul-title h2 { margin: 0; font-size: 16px; font-weight: 700; letter-spacing: 0.2px; }
            .ul-modal .ul-logo { font-size: 20px; }
            .ul-modal .ul-close {
                background: transparent; border: none; color: var(--ul-muted);
                font-size: 20px; cursor: pointer; line-height: 1;
                padding: 4px 10px; border-radius: 8px;
                transition: background 0.15s, color 0.15s; font-family: inherit;
            }
            .ul-modal .ul-close:hover { background: rgba(148,163,184,0.18); color: var(--ul-fg); }
            .ul-modal .ul-body {
                padding: 4px 22px 20px; overflow-y: auto; flex: 1;
                scrollbar-width: thin; scrollbar-color: var(--ul-border) transparent;
            }
            .ul-modal .ul-body::-webkit-scrollbar { width: 8px; }
            .ul-modal .ul-body::-webkit-scrollbar-thumb { background: var(--ul-border); border-radius: 4px; }
            .ul-modal .ul-section { margin-top: 20px; }
            .ul-modal .ul-section h3 {
                margin: 0 0 4px 0; font-size: 12px; font-weight: 700;
                text-transform: uppercase; letter-spacing: 0.9px; color: var(--ul-muted);
            }
            .ul-modal .ul-desc { margin: 0 0 10px 0; font-size: 12px; color: var(--ul-muted); }
            .ul-modal .ul-row {
                display: flex; align-items: center; justify-content: space-between;
                gap: 16px; padding: 10px 14px; border-radius: 10px;
                background: var(--ul-card); margin-bottom: 6px;
                border: 1px solid transparent; transition: border-color 0.15s;
            }
            .ul-modal .ul-row:hover { border-color: var(--ul-border); }
            .ul-modal .ul-row > label { flex: 1; font-size: 13px; cursor: pointer; display: flex; flex-direction: column; }
            .ul-modal .ul-row > label small { display: block; color: var(--ul-muted); font-size: 11px; margin-top: 2px; font-weight: 400; }
            .ul-modal input[type="checkbox"] {
                appearance: none; -webkit-appearance: none;
                width: 40px; height: 22px; border-radius: 22px;
                background: #475569; position: relative; cursor: pointer;
                transition: background 0.15s; flex-shrink: 0; margin: 0;
            }
            .ul-modal input[type="checkbox"]::after {
                content: ''; position: absolute; top: 2px; left: 2px;
                width: 18px; height: 18px; border-radius: 50%;
                background: white; transition: transform 0.15s;
                box-shadow: 0 1px 3px rgba(0,0,0,0.3);
            }
            .ul-modal input[type="checkbox"]:checked { background: var(--ul-accent); }
            .ul-modal input[type="checkbox"]:checked::after { transform: translateX(18px); }
            .ul-modal input[type="number"], .ul-modal select {
                background: var(--ul-input-bg); color: var(--ul-fg);
                border: 1px solid var(--ul-border); border-radius: 8px;
                padding: 6px 10px; font-size: 13px; font-family: inherit;
                min-width: 120px; cursor: pointer;
            }
            .ul-modal input[type="number"] { cursor: text; }
            .ul-modal input[type="number"]:focus, .ul-modal select:focus {
                outline: 2px solid var(--ul-accent); outline-offset: 0;
            }
            .ul-modal input[type="number"]::-webkit-outer-spin-button,
            .ul-modal input[type="number"]::-webkit-inner-spin-button { -webkit-appearance: none; appearance: none; margin: 0; }
            .ul-modal input[type="number"] { -moz-appearance: textfield; appearance: textfield; }
            .ul-modal input[type="number"].ul-num-sm {
                min-width: 0; width: 74px; text-align: center;
                font-variant-numeric: tabular-nums; font-weight: 600;
            }
            .ul-modal input[type="color"] {
                width: 44px; height: 30px; border: 1px solid var(--ul-border);
                border-radius: 8px; background: transparent; cursor: pointer; padding: 2px;
            }
            .ul-modal input[type="range"] { width: 180px; accent-color: var(--ul-accent); cursor: pointer; margin: 0; }
            .ul-modal .ul-val { min-width: 52px; text-align: right; font-weight: 700; font-size: 13px; font-variant-numeric: tabular-nums; }
            .ul-modal .ul-range-group { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
            .ul-modal .ul-range-sep { color: var(--ul-muted); font-size: 12px; font-weight: 600; }
            .ul-modal .ul-range-unit { color: var(--ul-muted); font-size: 12px; font-weight: 600; }
            .ul-modal .ul-hint {
                display: block; font-size: 11px; color: var(--ul-muted);
                margin-top: 4px; text-align: right; font-weight: 500;
            }
            .ul-modal .ul-keybind-group { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
            .ul-modal .ul-keybind-btn {
                background: var(--ul-input-bg); color: var(--ul-fg);
                border: 1px solid var(--ul-border); border-radius: 8px;
                padding: 6px 14px; font-size: 13px; font-family: inherit;
                font-weight: 600; cursor: pointer; min-width: 118px;
                text-align: center; transition: background 0.15s, border-color 0.15s, color 0.15s;
            }
            .ul-modal .ul-keybind-btn:hover { background: rgba(148,163,184,0.14); }
            .ul-modal .ul-keybind-btn.ul-capturing {
                background: var(--ul-accent); color: #ffffff;
                border-color: transparent; animation: ul-pulse 1.2s ease-in-out infinite;
            }
            @keyframes ul-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.65; } }
            .ul-modal .ul-keybind-clear {
                background: transparent; color: var(--ul-muted);
                border: 1px solid var(--ul-border); border-radius: 8px;
                padding: 6px 10px; cursor: pointer; font-family: inherit;
                font-size: 12px; font-weight: 600; line-height: 1;
                transition: background 0.15s, color 0.15s, border-color 0.15s;
            }
            .ul-modal .ul-keybind-clear:hover {
                background: rgba(220,38,38,0.12); color: var(--ul-danger);
                border-color: var(--ul-danger);
            }
            .ul-modal .ul-footer {
                display: flex; align-items: center; gap: 10px;
                padding: 14px 22px; border-top: 1px solid var(--ul-border);
                background: var(--ul-card); flex-shrink: 0;
            }
            .ul-modal .ul-spacer { flex: 1; }
            .ul-modal .ul-btn {
                background: var(--ul-accent); color: #ffffff;
                border: 1px solid transparent; border-radius: 8px;
                padding: 8px 18px; font-size: 13px; font-weight: 600;
                cursor: pointer; font-family: inherit;
                transition: filter 0.15s, background 0.15s, border-color 0.15s;
            }
            .ul-modal .ul-btn:hover { filter: brightness(1.1); }
            .ul-modal .ul-btn-secondary { background: transparent; color: var(--ul-fg); border: 1px solid var(--ul-border); }
            .ul-modal .ul-btn-secondary:hover { background: rgba(148,163,184,0.12); }
            .ul-modal .ul-btn-danger { background: transparent; color: var(--ul-danger); border: 1px solid var(--ul-danger); }
            .ul-modal .ul-btn-danger:hover { background: rgba(220,38,38,0.12); }
            .ul-modal .ul-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 8px; }
            .ul-modal .ul-stat {
                background: var(--ul-card); border-radius: 10px; padding: 10px 12px;
                border: 1px solid var(--ul-border);
            }
            .ul-modal .ul-stat-label {
                font-size: 10px; color: var(--ul-muted);
                text-transform: uppercase; letter-spacing: 0.6px; font-weight: 600;
            }
            .ul-modal .ul-stat-value {
                font-size: 18px; font-weight: 700; margin-top: 3px;
                font-variant-numeric: tabular-nums;
            }
            .ul-modal .ul-details {
                margin-top: 8px; border: 1px solid var(--ul-border);
                border-radius: 10px; background: var(--ul-card); overflow: hidden;
            }
            .ul-modal .ul-details > summary {
                padding: 10px 14px; cursor: pointer; font-size: 13px;
                font-weight: 600; user-select: none; list-style: none;
                display: flex; align-items: center; gap: 8px; color: var(--ul-fg);
            }
            .ul-modal .ul-details > summary::-webkit-details-marker { display: none; }
            .ul-modal .ul-details > summary::before {
                content: '▸'; color: var(--ul-muted);
                transition: transform 0.15s; display: inline-block; font-size: 11px;
            }
            .ul-modal .ul-details[open] > summary::before { transform: rotate(90deg); }
            .ul-modal .ul-details > summary .ul-count {
                margin-left: auto; font-size: 11px; font-weight: 600;
                color: var(--ul-muted); background: rgba(148,163,184,0.14);
                padding: 2px 8px; border-radius: 10px; font-variant-numeric: tabular-nums;
            }
            .ul-modal .ul-services-list {
                display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
                gap: 2px; padding: 4px 10px 12px;
                border-top: 1px solid var(--ul-border);
            }
            .ul-modal .ul-service-item {
                display: flex; align-items: center; gap: 8px;
                padding: 7px 8px; border-radius: 6px; font-size: 12px;
                cursor: pointer; color: var(--ul-fg);
                transition: background 0.12s; user-select: none;
            }
            .ul-modal .ul-service-item:hover { background: rgba(148,163,184,0.1); }
            .ul-modal .ul-services-list input[type="checkbox"] {
                appearance: none; -webkit-appearance: none;
                width: 16px; height: 16px; min-width: 16px; max-width: 16px;
                border-radius: 4px; background: #475569; position: relative;
                cursor: pointer; margin: 0; padding: 0; flex-shrink: 0;
                transition: background 0.15s; box-shadow: none;
            }
            .ul-modal .ul-services-list input[type="checkbox"]::after {
                content: ''; position: absolute; top: 1px; left: 5px;
                width: 4px; height: 9px;
                border: solid white; border-width: 0 2px 2px 0;
                background: transparent; border-radius: 0; box-shadow: none;
                transform: rotate(45deg) scale(0); transition: transform 0.12s;
            }
            .ul-modal .ul-services-list input[type="checkbox"]:checked { background: var(--ul-accent); }
            .ul-modal .ul-services-list input[type="checkbox"]:checked::after { transform: rotate(45deg) scale(1); }
        `;
        (document.head || document.documentElement).appendChild(style);
    }

    // ============================================================
    // PILL UI
    // ============================================================
    const POSITION_STYLES = {
        'bottom-right': { right: '12px', bottom: '12px', left: 'auto', top: 'auto' },
        'bottom-left':  { left: '12px',  bottom: '12px', right: 'auto', top: 'auto' },
        'top-right':    { right: '12px', top: '12px',   left: 'auto', bottom: 'auto' },
        'top-left':     { left: '12px',  top: '12px',   right: 'auto', bottom: 'auto' },
    };

    let pillEl = null;
    let pillPaint = null;

    function applyPillPosition() {
        if (!pillEl) return;
        const pos = POSITION_STYLES[settings.pillPosition] || POSITION_STYLES['bottom-right'];
        Object.assign(pillEl.style, pos);
    }
    function applyPillVisibility() {
        if (!pillEl) return;
        pillEl.style.display = settings.pillVisible ? 'flex' : 'none';
    }
    function applyPillOpacity() {
        if (!pillEl) return;
        pillEl.style.opacity = String(settings.pillOpacity);
    }
    function applyPillAccent() {
        if (!pillEl) return;
        if (settings.timeBoostEnabled) {
            pillEl.style.background = settings.accentColor;
            pillEl.style.color      = '#ffffff';
        } else {
            pillEl.style.background = '#334155';
            pillEl.style.color      = '#cbd5e1';
        }
    }
    function formatRangeLabel() {
        const a = settings.extraSecondsMin;
        const b = settings.extraSecondsMax;
        if (a === b) return `+${a}s`;
        return `+${a}–${b}s`;
    }

    function installPillUI() {
        if (!document.body) { setTimeout(installPillUI, 100); return; }
        if (document.getElementById('__ul-pill')) return;

        ensureStyles();

        const pill = document.createElement('div');
        pill.id = '__ul-pill';

        const main = document.createElement('div');
        main.className = 'ul-pill-main';

        const row1 = document.createElement('div');
        row1.className = 'ul-pill-row1';
        const row2 = document.createElement('div');
        row2.className = 'ul-pill-row2';
        main.appendChild(row1);
        main.appendChild(row2);

        const gear = document.createElement('button');
        gear.className = 'ul-pill-gear';
        gear.type = 'button';
        gear.title = 'Open settings';
        gear.textContent = '⚙';

        pill.appendChild(main);
        pill.appendChild(gear);
        document.body.appendChild(pill);
        pillEl = pill;

        pillPaint = () => {
            const accent = settings.timeBoostEnabled ? settings.accentColor : '#334155';
            pill.style.background = accent;
            pill.style.color      = settings.timeBoostEnabled ? '#ffffff' : '#cbd5e1';
            pill.style.opacity    = String(settings.pillOpacity);

            if (settings.timeBoostEnabled) row1.textContent = `${formatRangeLabel()}  ON`;
            else row1.textContent = `${formatRangeLabel()}  OFF`;

            if (settings.showStats) {
                row2.textContent =
                    `🛡 blocked:${stats.blocked} · q:${stats.boosted}` +
                    (stats.logImproperUseBlocked > 0 ? ` · liu:${stats.logImproperUseBlocked}` : '') +
                    (accumulatedExtraSeconds > 0 ? ` · pending:+${accumulatedExtraSeconds}s` : '') +
                    (stats.groupExtra > 0 ? ` · grp:+${stats.groupExtra}s` : '');
            } else {
                row2.textContent = '🛡 always on';
            }

            const kbText = formatKeybind(settings.uiToggleKeybind);
            main.title = `Click: toggle time boost | ${kbText}: hide/show pill`;
        };

        main.addEventListener('click', (e) => {
            e.preventDefault(); e.stopPropagation();
            settings.timeBoostEnabled = !settings.timeBoostEnabled;
            saveSettings();
            LOG('time-boost ' + (settings.timeBoostEnabled ? 'ENABLED' : 'DISABLED'));
            pillPaint();
            syncModalIfOpen();
        });

        gear.addEventListener('click', (e) => {
            e.preventDefault(); e.stopPropagation();
            openSettingsModal();
        });

        pill.addEventListener('mouseenter', () => { pill.style.transform = 'scale(1.04)'; });
        pill.addEventListener('mouseleave', () => { pill.style.transform = 'scale(1)'; });

        applyPillPosition();
        applyPillVisibility();
        applyPillOpacity();
        pillPaint();
        setInterval(() => { if (pillPaint) pillPaint(); }, 500);
        LOG('Pill UI installed');
    }

    // ============================================================
    // SETTINGS MODAL
    // ============================================================
    let modalEl = null;
    let modalStatsInterval = null;
    let capturingKeybind = false;

    function getEffectiveTheme() {
        if (settings.theme === 'auto') {
            try { return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'; }
            catch { return 'dark'; }
        }
        return settings.theme;
    }

    function applyModalTheme() {
        if (!modalEl) return;
        modalEl.setAttribute('data-theme', getEffectiveTheme());
        modalEl.style.setProperty('--ul-accent', settings.accentColor);
    }

    function readInputValue(input) {
        if (input.type === 'checkbox') return input.checked;
        if (input.type === 'number' || input.type === 'range') {
            const n = parseFloat(input.value);
            return isNaN(n) ? null : n;
        }
        return input.value;
    }
    function writeInputValue(input, value) {
        if (input.type === 'checkbox') input.checked = !!value;
        else input.value = value;
    }

    function updateRangeLabels() {
        if (!modalEl) return;
        const po = modalEl.querySelector('#ul-val-pillOpacity');
        if (po) po.textContent = Math.round(settings.pillOpacity * 100) + '%';
        const hint = modalEl.querySelector('#ul-range-hint');
        if (hint) {
            const a = settings.extraSecondsMin;
            const b = settings.extraSecondsMax;
            hint.textContent = (a === b)
                ? `Every question gets +${a}s.`
                : `Each question rolls a random +${a}–${b}s.`;
        }
    }

    function updateKeybindBtn() {
        if (!modalEl) return;
        const btn = modalEl.querySelector('#ul-keybind-btn');
        if (!btn) return;
        if (capturingKeybind) {
            btn.textContent = 'Press a key…';
            btn.classList.add('ul-capturing');
        } else {
            btn.textContent = formatKeybind(settings.uiToggleKeybind);
            btn.classList.remove('ul-capturing');
        }
    }

    function updateServicesCount() {
        if (!modalEl) return;
        const el = modalEl.querySelector('#ul-services-count');
        if (!el) return;
        let on = 0, total = 0;
        for (const k in TELEMETRY_SERVICES) {
            total++;
            if (settings.telemetryServices[k]) on++;
        }
        el.textContent = `${on}/${total}`;
    }

    function buildServicesList() {
        if (!modalEl) return;
        const container = modalEl.querySelector('#ul-services-list');
        if (!container) return;
        container.innerHTML = '';

        for (const key in TELEMETRY_SERVICES) {
            const svc = TELEMETRY_SERVICES[key];
            const label = document.createElement('label');
            label.className = 'ul-service-item';
            label.title = svc.hosts.join(', ');

            const input = document.createElement('input');
            input.type = 'checkbox';
            input.dataset.service = key;
            input.checked = !!settings.telemetryServices[key];

            input.addEventListener('change', () => {
                settings.telemetryServices[key] = input.checked;
                if (!applyingPreset) settings.telemetryPreset = 'custom';
                saveSettings();
                updateServicesCount();
                const presetEl = modalEl.querySelector('[data-setting="telemetryPreset"]');
                if (presetEl) presetEl.value = settings.telemetryPreset;
                LOG(`service "${svc.label}" ${input.checked ? 'ENABLED' : 'DISABLED'}`,
                    `(${svc.hosts.join(', ')})`);
            });

            const span = document.createElement('span');
            span.textContent = svc.label;

            label.appendChild(input);
            label.appendChild(span);
            container.appendChild(label);
        }
    }

    function syncModalInputs() {
        if (!modalEl) return;
        modalEl.querySelectorAll('[data-setting]').forEach((input) => {
            const key = input.dataset.setting;
            if (!(key in settings)) return;
            writeInputValue(input, settings[key]);
        });
        modalEl.querySelectorAll('[data-service]').forEach((input) => {
            input.checked = !!settings.telemetryServices[input.dataset.service];
        });
        updateRangeLabels();
        updateKeybindBtn();
        updateServicesCount();
        applyModalTheme();
    }
    function syncModalIfOpen() { if (modalEl) syncModalInputs(); }

    function updateModalStats() {
        if (!modalEl) return;
        const set = (k, v) => {
            const el = modalEl.querySelector(`[data-stat="${k}"]`);
            if (el) el.textContent = v;
        };
        set('apiPosts',  stats.apiPosts);
        set('blocked',   stats.blocked);
        set('logImproperUseBlocked', stats.logImproperUseBlocked);
        set('boosted',   stats.boosted);
        set('pending',   accumulatedExtraSeconds + 's');
        set('groupExtra', stats.groupExtra + 's');
        set('fullscreenBlocked', stats.fullscreenBlocked);
        set('consoleSuppressed', stats.consoleSuppressed);
    }

    function applySettingChange(key, value) {
        if (key === 'telemetryPreset') {
            if (value !== 'custom') {
                applyingPreset = true;
                applyTelemetryPreset(value);
                applyingPreset = false;
            } else {
                settings.telemetryPreset = 'custom';
            }
            saveSettings();
            LOG('telemetry preset:', value);
            VLOG('preset expanded to:', {
                services: Object.keys(TELEMETRY_SERVICES).filter((k) => settings.telemetryServices[k]),
                blockLogImproperUse: settings.blockLogImproperUse,
                blockDomElements:    settings.blockDomElements,
                blockWebSockets:     settings.blockWebSockets,
                blockSendBeacon:     settings.blockSendBeacon,
                spoofVisibility:     settings.spoofVisibility,
                suppressConsoleNoise: settings.suppressConsoleNoise,
            });
            syncModalInputs();
            return;
        }

        settings[key] = value;

        if (key === 'extraSecondsMin' || key === 'extraSecondsMax') {
            normalizeRange(settings);
            if (modalEl) {
                const minEl = modalEl.querySelector('[data-setting="extraSecondsMin"]');
                const maxEl = modalEl.querySelector('[data-setting="extraSecondsMax"]');
                if (minEl) minEl.value = settings.extraSecondsMin;
                if (maxEl) maxEl.value = settings.extraSecondsMax;
            }
        }

        if (!applyingPreset && INDIVIDUAL_TELEMETRY_SETTINGS.has(key)) {
            settings.telemetryPreset = 'custom';
            if (modalEl) {
                const presetEl = modalEl.querySelector('[data-setting="telemetryPreset"]');
                if (presetEl) presetEl.value = 'custom';
            }
        }

        saveSettings();
        LOG('setting changed:', key, '=', value);

        switch (key) {
            case 'timeBoostEnabled':
                applyPillAccent();
                if (pillPaint) pillPaint();
                break;
            case 'extraSecondsMin':
            case 'extraSecondsMax':
                updateRangeLabels();
                if (pillPaint) pillPaint();
                break;
            case 'disableAutoFullscreen':
                LOG('auto-fullscreen blocking ' + (value ? 'ENABLED' : 'DISABLED'));
                break;
            case 'darkMode':
                ensureDarkModeStyles();
                applyDarkMode();
                break;
            case 'pillVisible':  applyPillVisibility(); break;
            case 'pillPosition': applyPillPosition();  break;
            case 'pillOpacity':  applyPillOpacity();   break;
            case 'showStats':    if (pillPaint) pillPaint(); break;
            case 'theme':
            case 'accentColor':
                applyModalTheme();
                if (pillPaint) pillPaint();
                break;
            case 'uiToggleKeybind':
                updateKeybindBtn();
                if (pillPaint) pillPaint();
                break;
            case 'logLevel':
                LOG('log level set to:', value);
                break;
        }
    }

    function openSettingsModal() {
        if (modalEl) return;
        if (!document.body) return;

        ensureStyles();
        capturingKeybind = false;

        const overlay = document.createElement('div');
        overlay.id = '__ul-settings-overlay';
        overlay.innerHTML = `
            <div class="ul-modal" id="__ul-modal" data-theme="dark">
                <header class="ul-header">
                    <div class="ul-title">
                        <span class="ul-logo">⚙️</span>
                        <h2>UpLearn Control Panel</h2>
                    </div>
                    <button class="ul-close" data-action="close" title="Close (Esc)" aria-label="Close">✕</button>
                </header>
                <div class="ul-body">

                    <section class="ul-section">
                        <h3>🛡 Telemetry Blocking</h3>
                        <p class="ul-desc">Pick a preset or fine-tune exactly what gets blocked. Changes apply instantly.</p>

                        <div class="ul-row">
                            <label for="ul-set-telemetryPreset">Preset
                                <small>Off · Simple (LogImproperUse only) · Harsh (block everything)</small>
                            </label>
                            <select id="ul-set-telemetryPreset" data-setting="telemetryPreset">
                                <option value="off">Off</option>
                                <option value="simple">Simple</option>
                                <option value="harsh">Harsh</option>
                                <option value="custom">Custom</option>
                            </select>
                        </div>

                        <div class="ul-row">
                            <label for="ul-set-blockLogImproperUse">Block LogImproperUse requests
                                <small>Drops UpLearn improper-use telemetry sent to the API (logged distinctly in console)</small>
                            </label>
                            <input type="checkbox" id="ul-set-blockLogImproperUse" data-setting="blockLogImproperUse">
                        </div>
                        <div class="ul-row">
                            <label for="ul-set-blockDomElements">Block DOM telemetry injection
                                <small>Hooks script/iframe src &amp; purges injected tags from blocked hosts</small>
                            </label>
                            <input type="checkbox" id="ul-set-blockDomElements" data-setting="blockDomElements">
                        </div>
                        <div class="ul-row">
                            <label for="ul-set-blockWebSockets">Block telemetry WebSockets
                                <small>Kills Intercom / analytics socket connections</small>
                            </label>
                            <input type="checkbox" id="ul-set-blockWebSockets" data-setting="blockWebSockets">
                        </div>
                        <div class="ul-row">
                            <label for="ul-set-blockSendBeacon">Block telemetry sendBeacon
                                <small>Drops beacon-style telemetry pings</small>
                            </label>
                            <input type="checkbox" id="ul-set-blockSendBeacon" data-setting="blockSendBeacon">
                        </div>
                        <div class="ul-row">
                            <label for="ul-set-spoofVisibility">Spoof visibility / focus
                                <small>Page always believes it is visible &amp; focused</small>
                            </label>
                            <input type="checkbox" id="ul-set-spoofVisibility" data-setting="spoofVisibility">
                        </div>
                        <div class="ul-row">
                            <label for="ul-set-suppressConsoleNoise">Suppress site's telemetry console noise
                                <small>Silences <code>[J-ERROR]</code>, Jitsu "Failed to send data", Apollo <code>go.apollo.dev/c/err</code> warnings, and any message mentioning a blocked host. DevTools network-tab errors cannot be suppressed.</small>
                            </label>
                            <input type="checkbox" id="ul-set-suppressConsoleNoise" data-setting="suppressConsoleNoise">
                        </div>

                        <details class="ul-details">
                            <summary>Third-party services <span class="ul-count" id="ul-services-count">0/0</span></summary>
                            <div class="ul-services-list" id="ul-services-list"></div>
                        </details>
                    </section>

                    <section class="ul-section">
                        <h3>⏱ Time Boost</h3>
                        <p class="ul-desc">Add extra time to your quiz answer submissions. Quiz questions and group completion are always boosted automatically.</p>
                        <div class="ul-row">
                            <label for="ul-set-timeBoostEnabled">Enable time boost
                                <small>Master switch for the +time feature</small>
                            </label>
                            <input type="checkbox" id="ul-set-timeBoostEnabled" data-setting="timeBoostEnabled">
                        </div>
                        <div class="ul-row">
                            <label for="ul-set-extraSecondsMin">Extra seconds range
                                <small>Random extra time added to each question</small>
                                <span class="ul-hint" id="ul-range-hint"></span>
                            </label>
                            <div class="ul-range-group">
                                <input type="number" class="ul-num-sm" id="ul-set-extraSecondsMin"
                                       data-setting="extraSecondsMin" min="1" max="3600" step="1" inputmode="numeric">
                                <span class="ul-range-sep">to</span>
                                <input type="number" class="ul-num-sm" id="ul-set-extraSecondsMax"
                                       data-setting="extraSecondsMax" min="1" max="3600" step="1" inputmode="numeric">
                                <span class="ul-range-unit">s</span>
                            </div>
                        </div>
                    </section>

                    <section class="ul-section">
                        <h3>🖥 Page Behaviour</h3>
                        <div class="ul-row">
                            <label for="ul-set-disableAutoFullscreen">Disable auto fullscreen
                                <small>Blocks the site from silently entering fullscreen mode</small>
                            </label>
                            <input type="checkbox" id="ul-set-disableAutoFullscreen" data-setting="disableAutoFullscreen">
                        </div>
                    </section>

                    <section class="ul-section">
                        <h3>🌙 Appearance</h3>
                        <div class="ul-row">
                            <label for="ul-set-darkMode">Dark mode
                                <small>Soft dark theme — consistent across all pages, top bar preserved</small>
                            </label>
                            <input type="checkbox" id="ul-set-darkMode" data-setting="darkMode">
                        </div>
                    </section>

                    <section class="ul-section">
                        <h3>🎨 Interface</h3>
                        <div class="ul-row">
                            <label for="ul-set-pillVisible">Show control pill
                                <small>Hide/show the floating status pill</small>
                            </label>
                            <input type="checkbox" id="ul-set-pillVisible" data-setting="pillVisible">
                        </div>
                        <div class="ul-row">
                            <label>Toggle-pill keybind
                                <small>Press to show/hide the pill. Click to record a new one.</small>
                            </label>
                            <div class="ul-keybind-group">
                                <button type="button" class="ul-keybind-btn" id="ul-keybind-btn">Right Ctrl</button>
                                <button type="button" class="ul-keybind-clear" id="ul-keybind-clear" title="Clear keybind">✕</button>
                            </div>
                        </div>
                        <div class="ul-row">
                            <label for="ul-set-pillPosition">Pill position</label>
                            <select id="ul-set-pillPosition" data-setting="pillPosition">
                                <option value="bottom-right">Bottom right</option>
                                <option value="bottom-left">Bottom left</option>
                                <option value="top-right">Top right</option>
                                <option value="top-left">Top left</option>
                            </select>
                        </div>
                        <div class="ul-row">
                            <label for="ul-set-pillOpacity">Pill opacity</label>
                            <div style="display:flex;align-items:center;gap:12px;">
                                <input type="range" id="ul-set-pillOpacity" data-setting="pillOpacity" min="0.2" max="1" step="0.05">
                                <span class="ul-val" id="ul-val-pillOpacity">100%</span>
                            </div>
                        </div>
                        <div class="ul-row">
                            <label for="ul-set-showStats">Show live stats on pill
                                <small>Displays blocked / boosted counts on the pill</small>
                            </label>
                            <input type="checkbox" id="ul-set-showStats" data-setting="showStats">
                        </div>
                        <div class="ul-row">
                            <label for="ul-set-theme">Panel theme</label>
                            <select id="ul-set-theme" data-setting="theme">
                                <option value="dark">Dark</option>
                                <option value="light">Light</option>
                                <option value="auto">Auto (follow system)</option>
                            </select>
                        </div>
                        <div class="ul-row">
                            <label for="ul-set-accentColor">Accent colour</label>
                            <input type="color" id="ul-set-accentColor" data-setting="accentColor">
                        </div>
                        <div class="ul-row">
                            <label for="ul-set-logLevel">Console logging
                                <small>Verbose shows grouped block reports with full details &amp; bodies</small>
                            </label>
                            <select id="ul-set-logLevel" data-setting="logLevel">
                                <option value="silent">Silent</option>
                                <option value="normal">Normal</option>
                                <option value="verbose">Verbose</option>
                            </select>
                        </div>
                    </section>

                    <section class="ul-section">
                        <h3>📊 Stats</h3>
                        <p class="ul-desc">Live counters for this session.</p>
                        <div class="ul-stats">
                            <div class="ul-stat"><div class="ul-stat-label">API POSTs</div><div class="ul-stat-value" data-stat="apiPosts">0</div></div>
                            <div class="ul-stat"><div class="ul-stat-label">Blocked</div><div class="ul-stat-value" data-stat="blocked">0</div></div>
                            <div class="ul-stat"><div class="ul-stat-label">LogImproperUse</div><div class="ul-stat-value" data-stat="logImproperUseBlocked">0</div></div>
                            <div class="ul-stat"><div class="ul-stat-label">Boosted</div><div class="ul-stat-value" data-stat="boosted">0</div></div>
                            <div class="ul-stat"><div class="ul-stat-label">Pending bonus</div><div class="ul-stat-value" data-stat="pending">0s</div></div>
                            <div class="ul-stat"><div class="ul-stat-label">Group bonus</div><div class="ul-stat-value" data-stat="groupExtra">0s</div></div>
                            <div class="ul-stat"><div class="ul-stat-label">FS Blocked</div><div class="ul-stat-value" data-stat="fullscreenBlocked">0</div></div>
                            <div class="ul-stat"><div class="ul-stat-label">Console muted</div><div class="ul-stat-value" data-stat="consoleSuppressed">0</div></div>
                        </div>
                        <div style="margin-top:10px;">
                            <button class="ul-btn ul-btn-secondary" data-action="reset-stats">Reset stats</button>
                        </div>
                    </section>

                </div>
                <footer class="ul-footer">
                    <button class="ul-btn ul-btn-danger" data-action="reset-all">Reset all settings</button>
                    <div class="ul-spacer"></div>
                    <button class="ul-btn" data-action="close">Done</button>
                </footer>
            </div>
        `;
        document.body.appendChild(overlay);
        modalEl = overlay.querySelector('#__ul-modal');

        buildServicesList();

        overlay.querySelectorAll('[data-setting]').forEach((input) => {
            const key = input.dataset.setting;
            const handler = () => {
                const val = readInputValue(input);
                if (val === null) return;
                applySettingChange(key, val);
            };
            input.addEventListener('change', handler);
            if (input.type === 'range') input.addEventListener('input', handler);
            if (input.type === 'number') {
                input.addEventListener('blur', () => {
                    applySettingChange(key, readInputValue(input));
                });
                input.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        applySettingChange(key, readInputValue(input));
                        input.blur();
                    }
                });
            }
        });

        const kbBtn   = overlay.querySelector('#ul-keybind-btn');
        const kbClear = overlay.querySelector('#ul-keybind-clear');

        kbBtn.addEventListener('click', (e) => {
            e.preventDefault(); e.stopPropagation();
            capturingKeybind = !capturingKeybind;
            updateKeybindBtn();
            LOG('keybind capture ' + (capturingKeybind ? 'started' : 'cancelled'));
        });
        kbClear.addEventListener('click', (e) => {
            e.preventDefault(); e.stopPropagation();
            if (capturingKeybind) { capturingKeybind = false; updateKeybindBtn(); return; }
            applySettingChange('uiToggleKeybind', { code: null, ctrl: false, shift: false, alt: false, meta: false });
            LOG('keybind cleared');
        });

        overlay.addEventListener('click', (e) => {
            const actionEl = e.target.closest('[data-action]');
            if (actionEl) {
                const action = actionEl.dataset.action;
                if (action === 'close') { closeSettingsModal(); return; }
                if (action === 'reset-all') {
                    if (confirm('Reset all settings to defaults?')) {
                        Object.assign(settings, DEFAULT_SETTINGS);
                        settings.telemetryServices = buildDefaultTelemetryServices();
                        settings.uiToggleKeybind = Object.assign({}, DEFAULT_KEYBIND);
                        normalizeRange(settings);
                        saveSettings();
                        buildServicesList();
                        syncModalInputs();
                        applyPillPosition();
                        applyPillVisibility();
                        applyPillOpacity();
                        applyDarkMode();
                        if (pillPaint) pillPaint();
                        LOG('settings reset to defaults');
                    }
                    return;
                }
                if (action === 'reset-stats') {
                    stats.apiPosts = 0; stats.seen = 0; stats.boosted = 0;
                    stats.blocked = 0; stats.groupExtra = 0; stats.fullscreenBlocked = 0;
                    stats.consoleSuppressed = 0; stats.logImproperUseBlocked = 0;
                    accumulatedExtraSeconds = 0; accumulatedQuestionCount = 0;
                    updateModalStats();
                    if (pillPaint) pillPaint();
                    LOG('stats reset');
                    return;
                }
                return;
            }
            if (e.target === overlay) closeSettingsModal();
        });

        overlay.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && !capturingKeybind) {
                e.stopPropagation();
                closeSettingsModal();
            }
        });
        overlay.tabIndex = -1;
        overlay.focus();

        syncModalInputs();
        updateModalStats();
        modalStatsInterval = setInterval(updateModalStats, 400);
        LOG('Settings modal opened');
    }

    function closeSettingsModal() {
        capturingKeybind = false;
        const overlay = document.getElementById('__ul-settings-overlay');
        if (overlay) overlay.remove();
        modalEl = null;
        if (modalStatsInterval) { clearInterval(modalStatsInterval); modalStatsInterval = null; }
        LOG('Settings modal closed');
    }

    // ============================================================
    // GLOBAL KEYBOARD SHORTCUTS
    // ============================================================
    window.addEventListener('keydown', (e) => {
        if (capturingKeybind) {
            e.preventDefault(); e.stopPropagation();
            if (e.code === 'Escape') {
                capturingKeybind = false;
                updateKeybindBtn();
                LOG('keybind capture cancelled');
                return;
            }
            const kb = captureKeybindFromEvent(e);
            applySettingChange('uiToggleKeybind', kb);
            capturingKeybind = false;
            updateKeybindBtn();
            LOG('keybind set to:', formatKeybind(kb));
            return;
        }
        if (e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey && e.code === 'KeyU') {
            e.preventDefault();
            openSettingsModal();
            return;
        }
        if (matchesKeybind(e, settings.uiToggleKeybind) && !e.repeat) {
            settings.pillVisible = !settings.pillVisible;
            saveSettings();
            applyPillVisibility();
            syncModalIfOpen();
            LOG('pill ' + (settings.pillVisible ? 'SHOWN' : 'HIDDEN'));
        }
    }, true);

    // ============================================================
    // BOOTSTRAP
    // ============================================================
    function bootstrap() { installPillUI(); }
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
        telemetryServices: TELEMETRY_SERVICES,
        resetStats: () => {
            stats.apiPosts = 0; stats.seen = 0; stats.boosted = 0;
            stats.blocked = 0; stats.groupExtra = 0; stats.fullscreenBlocked = 0;
            stats.consoleSuppressed = 0; stats.logImproperUseBlocked = 0;
            accumulatedExtraSeconds = 0; accumulatedQuestionCount = 0;
        },
        getAccumulated: () => accumulatedExtraSeconds,
        getAccumulatedCount: () => accumulatedQuestionCount,
        pickExtraSeconds,
        _match: (url) => matchTelemetryService(url),
    };

    LOG('=== READY | timeBoost:', settings.timeBoostEnabled,
        '| range:', settings.extraSecondsMin + '–' + settings.extraSecondsMax + 's',
        '| keybind:', formatKeybind(settings.uiToggleKeybind),
        '| auto-fullscreen blocked:', settings.disableAutoFullscreen ? 'ON' : 'OFF',
        '| dark mode:', settings.darkMode ? 'ON' : 'OFF',
        '| telemetry preset:', settings.telemetryPreset,
        '===');
    if (settings.logLevel === 'verbose') {
        nativeConsole.groupCollapsed('%c[UL · verbose] 🟢 Ready — active blockers', CSS.verbose);
        const anyServiceOn = Object.keys(TELEMETRY_SERVICES).some((k) => settings.telemetryServices[k]);
        nativeConsole.log('%cThird-party services:   ', CSS.muted, anyServiceOn ? 'ON' : 'OFF');
        nativeConsole.log('%cLogImproperUse:         ', CSS.muted, settings.blockLogImproperUse ? 'ON' : 'OFF');
        nativeConsole.log('%cDOM injection:          ', CSS.muted, settings.blockDomElements ? 'ON' : 'OFF');
        nativeConsole.log('%cWebSockets:             ', CSS.muted, settings.blockWebSockets ? 'ON' : 'OFF');
        nativeConsole.log('%csendBeacon:             ', CSS.muted, settings.blockSendBeacon ? 'ON' : 'OFF');
        nativeConsole.log('%cVisibility spoofing:    ', CSS.muted, settings.spoofVisibility ? 'ON' : 'OFF');
        nativeConsole.log('%cConsole noise filter:   ', CSS.muted, settings.suppressConsoleNoise ? 'ON' : 'OFF');
        nativeConsole.log('%cFullscreen block:       ', CSS.muted, settings.disableAutoFullscreen ? 'ON' : 'OFF');
        nativeConsole.groupEnd();
    }
})();