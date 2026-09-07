(function () {
    'use strict';

    const VERSION = '0.17.3';
    const PENDING_PLAY_KEY = 'va17:pending-local-play';
    const TV_LIBRARY_CLASS = 'va17-tv-library-native-tabs';
    const PLAY_TTL_MS = 15000;
    const MAX_PLAY_ATTEMPTS = 40;
    const PLAY_RETRY_MS = 150;

    let playTimer = null;
    let playAttempts = 0;
    let routeTimers = [];

    function route() {
        return window.location.hash || '';
    }

    function isDetails() {
        return /details\?id=|\/details\//i.test(route());
    }

    function isTvLibrary() {
        const value = route().toLowerCase();
        if (value.startsWith('#/tv') || value.includes('collectiontype=tvshows')) return true;

        const body = document.body;
        const seriesNav = document.querySelector('#va-global-nav [data-va-kind="series"].va-nav__item--active');
        return Boolean(body && body.classList.contains('va-page-library') && seriesNav);
    }

    function currentDetailsId() {
        const match = route().match(/[?&]id=([^&]+)/i) || route().match(/\/details\/([^?&/]+)/i);
        return match && match[1] ? decodeURIComponent(match[1]) : '';
    }

    function text(el) {
        return el ? (el.textContent || '').trim() : '';
    }

    function sessionGet(key) {
        try { return sessionStorage.getItem(key); } catch (error) { return null; }
    }

    function sessionSet(key, value) {
        try { sessionStorage.setItem(key, value); } catch (error) { /* optional */ }
    }

    function sessionRemove(key) {
        try { sessionStorage.removeItem(key); } catch (error) { /* optional */ }
    }

    function safeJson(value) {
        if (!value) return null;
        try { return JSON.parse(value); } catch (error) { return null; }
    }

    function serverId() {
        const client = window.ApiClient || null;
        if (!client) return '';
        try {
            if (typeof client.serverId === 'function') return client.serverId() || '';
            return client.serverId || client._serverId || '';
        } catch (error) {
            return '';
        }
    }

    function detailsRoute(itemId) {
        const sid = serverId();
        return '#/details?id=' + encodeURIComponent(itemId) + (sid ? '&serverId=' + encodeURIComponent(sid) : '');
    }

    function navigateDetails(itemId) {
        if (!itemId) return false;
        window.location.hash = detailsRoute(itemId).slice(1);
        return true;
    }

    function idFromHref(href) {
        if (!href) return '';
        const match = String(href).match(/[?&]id=([^&]+)/i) || String(href).match(/details\?id=([^&]+)/i);
        return match && match[1] ? decodeURIComponent(match[1]) : '';
    }

    function looksLikeItemId(value) {
        return /^[a-f0-9]{16,}$/i.test((value || '').trim());
    }

    function cardItemId(card) {
        if (!card) return '';
        const nodes = [
            card,
            card.querySelector('[data-id]'),
            card.querySelector('[data-itemid]'),
            card.closest('[data-id]'),
            card.closest('[data-itemid]')
        ].filter(Boolean);

        for (const node of nodes) {
            const value =
                (node.dataset && (node.dataset.id || node.dataset.itemid || node.dataset.itemId)) ||
                node.getAttribute('data-id') ||
                node.getAttribute('data-itemid');
            if (value) return value;
        }

        const link = card.closest('a[href]') || card.querySelector('a[href]');
        return idFromHref(link && link.getAttribute('href'));
    }

    function cardTitle(card) {
        if (!card) return '';
        const selectors = ['.cardText-first', '.cardText', '.itemName', '[title]'];
        for (const selector of selectors) {
            const el = card.querySelector(selector);
            const value = el && ((el.textContent || el.getAttribute('title') || '') + '').trim();
            if (value) return value;
        }
        return (card.getAttribute('aria-label') || card.getAttribute('title') || '').trim();
    }

    function exactHeroItemId(hero) {
        if (!hero) return '';

        const direct = hero.getAttribute('data-va15-item-id') || hero.getAttribute('data-item-id') || '';
        if (direct) return direct;

        const hrefId = idFromHref(hero.getAttribute('data-va15-details-href') || '');
        if (hrefId) return hrefId;

        const marker = hero.getAttribute('data-va14-hero') || '';
        if (looksLikeItemId(marker)) return marker;

        const title = text(hero.querySelector('.va-hero__title, .va16-hero-title'));
        if (!title) return '';

        const ids = Array.from(document.querySelectorAll('.verticalSection .card'))
            .filter(card => card.offsetParent !== null && cardTitle(card).toLowerCase() === title.toLowerCase())
            .map(cardItemId)
            .filter(Boolean);

        const unique = Array.from(new Set(ids));
        return unique.length === 1 ? unique[0] : '';
    }

    function blockedPlaybackControl(el) {
        if (!el) return true;
        const blocked = /sync\s*play|syncplay|watch\s*together|join\s*(?:a\s*)?group|watch\s*session|group\s*watch|watch\s*party|play\s*to|remote\s*play/i;
        let node = el;
        let depth = 0;

        while (node && depth < 5) {
            const label = [
                text(node),
                node.getAttribute && node.getAttribute('aria-label') || '',
                node.getAttribute && node.getAttribute('title') || '',
                node.id || '',
                typeof node.className === 'string' ? node.className : ''
            ].join(' ');
            if (blocked.test(label)) return true;
            node = node.parentElement;
            depth += 1;
        }
        return false;
    }

    function genuineLocalPlayButton() {
        const selectors = [
            '.mainDetailButtons .btnPlay',
            '.detailPagePrimaryContainer .btnPlay',
            '.detailPagePrimaryContent .btnPlay',
            'button.btnPlay',
            '.btnPlay'
        ];
        const seen = new Set();
        const candidates = [];

        selectors.forEach(selector => {
            document.querySelectorAll(selector).forEach(el => {
                if (!seen.has(el)) {
                    seen.add(el);
                    candidates.push(el);
                }
            });
        });

        const safe = candidates.filter(el => el.isConnected && !el.disabled && !blockedPlaybackControl(el));
        return safe.find(el => el.offsetParent !== null) || safe[0] || null;
    }

    function queuePlay(itemId) {
        if (!itemId) return;
        sessionSet(PENDING_PLAY_KEY, JSON.stringify({ id: itemId, created: Date.now() }));
        playAttempts = 0;
    }

    function clearPlayTimer() {
        if (playTimer) window.clearTimeout(playTimer);
        playTimer = null;
    }

    function tryPendingPlay() {
        clearPlayTimer();
        if (!isDetails()) return false;

        const pending = safeJson(sessionGet(PENDING_PLAY_KEY));
        if (!pending || !pending.id) return false;

        if (Date.now() - Number(pending.created || 0) > PLAY_TTL_MS) {
            sessionRemove(PENDING_PLAY_KEY);
            return false;
        }

        const current = currentDetailsId();
        if (!current || current !== pending.id) return false;

        const button = genuineLocalPlayButton();
        if (button) {
            sessionRemove(PENDING_PLAY_KEY);
            clearPlayTimer();
            console.log('[Velvet Antenna v0.17.3] using Jellyfin local .btnPlay for', pending.id);
            button.click();
            return true;
        }

        playAttempts += 1;
        if (playAttempts < MAX_PLAY_ATTEMPTS) {
            playTimer = window.setTimeout(tryPendingPlay, PLAY_RETRY_MS);
        } else {
            console.warn('[Velvet Antenna v0.17.3] no genuine local .btnPlay found for', pending.id);
            sessionRemove(PENDING_PLAY_KEY);
        }
        return false;
    }

    function stopEvent(event) {
        event.preventDefault();
        event.stopPropagation();
        if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
    }

    function captureVelvetActions(event) {
        const target = event.target;
        if (!target || typeof target.closest !== 'function') return;

        const homeHero = target.closest('#va-home-hero');
        if (homeHero) {
            const play = target.closest('[data-va-action="play"], [data-va16-action="primary"]');
            const more = target.closest('[data-va-action="details"], [data-va16-action="details"]');
            if (play || more) {
                const itemId = exactHeroItemId(homeHero);
                if (!itemId) return;

                stopEvent(event);
                if (more) {
                    navigateDetails(itemId);
                    return;
                }

                const mode = play.getAttribute('data-va15-mode') || 'play';
                if (mode !== 'play') {
                    navigateDetails(itemId);
                    return;
                }

                queuePlay(itemId);
                navigateDetails(itemId);
                return;
            }
        }

        const detailHero = target.closest('#va12-detail-hero');
        if (detailHero) {
            const play = target.closest('[data-va12-action="play"]');
            if (!play) return;

            const itemId = currentDetailsId() || detailHero.getAttribute('data-item-id') || '';
            if (!itemId) return;

            stopEvent(event);
            queuePlay(itemId);
            tryPendingPlay();
        }
    }

    function syncRouteClasses() {
        if (!document.body) return;
        document.body.classList.toggle(TV_LIBRARY_CLASS, isTvLibrary());
    }

    function clearRouteTimers() {
        routeTimers.forEach(timer => window.clearTimeout(timer));
        routeTimers = [];
    }

    function scheduleRouteClassSync() {
        clearRouteTimers();
        [0, 250, 900].forEach(delay => {
            routeTimers.push(window.setTimeout(syncRouteClasses, delay));
        });
    }

    function onRouteChange() {
        clearPlayTimer();
        playAttempts = 0;
        scheduleRouteClassSync();
        if (isDetails()) window.setTimeout(tryPendingPlay, 100);
    }

    function start() {
        // Intentionally no MutationObserver and no hero/detail DOM rewriting.
        // v0.17.3 owns action routing plus narrow compatibility restores for
        // Jellyfin's genuine TV library tabs and subtitle control.
        window.addEventListener('click', captureVelvetActions, true);
        window.addEventListener('hashchange', onRouteChange);
        window.addEventListener('popstate', onRouteChange);

        scheduleRouteClassSync();
        if (isDetails()) window.setTimeout(tryPendingPlay, 100);
        console.log('[Velvet Antenna] v' + VERSION + ' compatibility hotfix loaded');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start, { once: true });
    } else {
        start();
    }
})();