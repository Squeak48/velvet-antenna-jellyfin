(function () {
    'use strict';

    const VERSION = '0.15.0';
    const STATE = {
        settleTimer: null,
        renderTimer: null,
        autoPlayTimer: null,
        currentHeroId: '',
        currentHeroType: '',
        currentHeroHref: '',
        lastRoute: '',
        observer: null
    };

    function route() {
        return window.location.hash || '';
    }

    function isHome() {
        return route() === '#/home' || route().startsWith('#/home?');
    }

    function isDetails() {
        return /details\?id=|\/details\//i.test(route());
    }

    function isAdminOrPlayback() {
        return /dashboard|configurationpage|scheduledtasks|logs|networking|plugins|metadataeditor|videoosd|nowplaying|playback/i.test(route()) ||
            Boolean(document.querySelector('.videoPlayerContainer:not(.hide), .videoOsdPage:not(.hide)'));
    }

    function text(el) {
        return el ? (el.textContent || '').trim() : '';
    }

    function api() {
        return window.ApiClient || null;
    }

    function currentItemId() {
        const match = route().match(/[?&]id=([^&]+)/i) || route().match(/\/details\/([^?&/]+)/i);
        return match && match[1] ? decodeURIComponent(match[1]) : '';
    }

    function getCardTitle(card) {
        if (!card) return '';
        const selectors = ['.cardText-first', '.cardText', '.itemName', '[title]'];
        for (const selector of selectors) {
            const el = card.querySelector(selector);
            if (!el) continue;
            const value = (el.textContent || el.getAttribute('title') || '').trim();
            if (value) return value;
        }
        return (card.getAttribute('aria-label') || card.getAttribute('title') || '').trim();
    }

    function getItemId(card) {
        if (!card) return '';
        const nodes = [
            card,
            card.querySelector('[data-id]'),
            card.querySelector('[data-itemid]'),
            card.closest('[data-id]'),
            card.closest('[data-itemid]')
        ].filter(Boolean);

        for (const el of nodes) {
            const value =
                (el.dataset && (el.dataset.id || el.dataset.itemid || el.dataset.itemId)) ||
                el.getAttribute('data-id') ||
                el.getAttribute('data-itemid');
            if (value) return value;
        }

        const href = cardHref(card);
        const match = href && (href.match(/[?&]id=([^&]+)/i) || href.match(/details\?id=([^&]+)/i));
        return match && match[1] ? decodeURIComponent(match[1]) : '';
    }

    function cardHref(card) {
        if (!card) return '';
        const link = card.closest('a[href]') || card.querySelector('a[href]');
        if (link) return link.getAttribute('href') || '';

        const content = card.querySelector('.cardContent[href], [data-href]');
        if (content) return content.getAttribute('href') || content.getAttribute('data-href') || '';
        return '';
    }

    function serverId() {
        const client = api();
        if (!client) return '';
        try {
            if (typeof client.serverId === 'function') return client.serverId() || '';
            return client.serverId || client._serverId || '';
        } catch (error) {
            return '';
        }
    }

    function detailsHref(itemId, fallbackHref) {
        if (fallbackHref && /details\?id=/i.test(fallbackHref)) return fallbackHref;
        if (!itemId) return fallbackHref || '';

        const sid = serverId();
        return '#/details?id=' + encodeURIComponent(itemId) + (sid ? '&serverId=' + encodeURIComponent(sid) : '');
    }

    function navigate(href) {
        if (!href) return false;
        if (href.charAt(0) === '#') {
            window.location.hash = href.substring(1);
            return true;
        }
        if (/^https?:/i.test(href)) {
            window.location.href = href;
            return true;
        }
        if (href.indexOf('#/') >= 0) {
            window.location.hash = href.substring(href.indexOf('#') + 1);
            return true;
        }
        window.location.href = href;
        return true;
    }

    function visibleCards() {
        return Array.from(document.querySelectorAll('.verticalSection .card')).filter(card => {
            if (card.offsetParent === null) return false;
            if (card.closest('#va-home-hero')) return false;
            const title = getCardTitle(card).toLowerCase();
            if (!title || ['movies', 'shows', 'series', 'collections', 'anime', 'music', 'books'].includes(title)) return false;
            return Boolean(getItemId(card) || cardHref(card));
        });
    }

    function cardForHero(hero) {
        if (!hero) return null;

        const marker = hero.getAttribute('data-va14-hero') || '';
        const title = text(hero.querySelector('.va-hero__title'));
        const cards = visibleCards();

        if (marker) {
            const byId = cards.find(card => getItemId(card) === marker);
            if (byId) return byId;
        }

        if (title) {
            const normal = title.toLowerCase();
            const byTitle = cards.find(card => getCardTitle(card).toLowerCase() === normal);
            if (byTitle) return byTitle;
        }

        return null;
    }

    function setHeroSettling(enabled) {
        if (!document.body) return;
        document.body.classList.toggle('va15-hero-settling', Boolean(enabled));
    }

    function sessionGet(key) {
        try { return sessionStorage.getItem('va15:' + key); } catch (error) { return null; }
    }

    function sessionSet(key, value) {
        try { sessionStorage.setItem('va15:' + key, value); } catch (error) { /* optional */ }
    }

    function clearHeroState() {
        STATE.currentHeroId = '';
        STATE.currentHeroType = '';
        STATE.currentHeroHref = '';
        clearTimeout(STATE.settleTimer);
    }

    async function settleHero() {
        if (!isHome()) return;

        const hero = document.getElementById('va-home-hero');
        if (!hero) return;

        const card = cardForHero(hero);
        if (!card) {
            setHeroSettling(false);
            hero.classList.add('va15-ready');
            return;
        }

        const itemId = getItemId(card);
        const href = detailsHref(itemId, cardHref(card));

        STATE.currentHeroId = itemId;
        STATE.currentHeroHref = href;

        hero.setAttribute('data-va15-item-id', itemId || '');
        hero.setAttribute('data-va15-details-href', href || '');

        const client = api();
        if (client && itemId && typeof client.getItem === 'function' && typeof client.getCurrentUserId === 'function') {
            try {
                const item = await client.getItem(client.getCurrentUserId(), itemId);
                if (item && hero.isConnected) {
                    STATE.currentHeroType = item.Type || '';
                    hero.setAttribute('data-va15-item-type', STATE.currentHeroType);
                    configureHeroAction(hero, item);
                }
            } catch (error) {
                console.debug('[Velvet Antenna v0.15] hero item lookup failed', error);
            }
        }

        const lockKey = itemId || text(hero.querySelector('.va-hero__title'));
        if (lockKey) sessionSet('homeHero', lockKey);

        setHeroSettling(false);
        hero.classList.add('va15-ready');
        console.log('[Velvet Antenna] v0.15 hero settled:', lockKey || 'unknown');
    }

    function configureHeroAction(hero, item) {
        const button = hero.querySelector('[data-va-action="play"]');
        if (!button || !item) return;

        const label = button.querySelector('.va-button__label') || button.querySelector('span:last-child');
        const playable = /Movie|Episode|Video|Audio/i.test(item.Type || '');
        const resume = item.UserData && item.UserData.PlaybackPositionTicks > 0 && !item.UserData.Played;

        if (playable) {
            button.hidden = false;
            button.setAttribute('data-va15-mode', 'play');
            if (label) label.textContent = resume ? 'CONTINUE' : 'PLAY';
            return;
        }

        if (/Series/i.test(item.Type || '')) {
            button.hidden = false;
            button.setAttribute('data-va15-mode', 'details');
            if (label) label.textContent = 'VIEW SERIES';
            return;
        }

        if (/Season/i.test(item.Type || '')) {
            button.hidden = false;
            button.setAttribute('data-va15-mode', 'details');
            if (label) label.textContent = 'VIEW SEASON';
            return;
        }

        if (/BoxSet|CollectionFolder|Folder/i.test(item.Type || '')) {
            button.hidden = false;
            button.setAttribute('data-va15-mode', 'details');
            if (label) label.textContent = 'OPEN';
            return;
        }

        button.hidden = true;
    }

    function queueAutoPlay(itemId) {
        if (!itemId) return;
        sessionSet('autoplay', itemId);
    }

    function consumeAutoPlay() {
        if (!isDetails()) return;

        const wanted = sessionGet('autoplay');
        const current = currentItemId();
        if (!wanted || !current || wanted !== current) return;

        const button = document.querySelector(
            '.mainDetailButtons .btnPlay, .detailPagePrimaryContainer .btnPlay, button[title*="play" i], button[aria-label*="play" i]'
        );

        if (!button || button.offsetParent === null || button.dataset.va15AutoPlayed === '1') return;

        button.dataset.va15AutoPlayed = '1';
        try { sessionStorage.removeItem('va15:autoplay'); } catch (error) { /* optional */ }

        setTimeout(function () {
            if (button.isConnected && typeof button.click === 'function') button.click();
        }, 80);
    }

    function openHeroDetails(hero) {
        const itemId = hero && (hero.getAttribute('data-va15-item-id') || STATE.currentHeroId);
        const href = hero && (hero.getAttribute('data-va15-details-href') || STATE.currentHeroHref);
        return navigate(detailsHref(itemId, href));
    }

    function playHero(hero) {
        if (!hero) return;

        const mode = hero.querySelector('[data-va-action="play"]')?.getAttribute('data-va15-mode') || 'play';
        const itemId = hero.getAttribute('data-va15-item-id') || STATE.currentHeroId;

        if (mode !== 'play') {
            openHeroDetails(hero);
            return;
        }

        if (itemId) queueAutoPlay(itemId);
        openHeroDetails(hero);
    }

    function detailMore() {
        const hero = document.getElementById('va12-detail-hero');
        if (!hero) return false;

        const candidates = [
            document.querySelector('.detailPageSecondaryContainer'),
            document.querySelector('.details-additionalContent'),
            document.querySelector('.itemDetailsGroup'),
            Array.from(document.querySelectorAll('.verticalSection')).find(section => !hero.contains(section) && section.offsetParent !== null)
        ].filter(Boolean);

        const target = candidates[0];
        if (!target || typeof target.scrollIntoView !== 'function') return false;
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return true;
    }

    function stockDetailPlay() {
        return document.querySelector(
            '.mainDetailButtons .btnPlay, .detailPagePrimaryContainer .btnPlay, button[title*="play" i], button[aria-label*="play" i]'
        );
    }

    function captureActions(event) {
        const hero = event.target.closest && event.target.closest('#va-home-hero');
        if (hero) {
            const play = event.target.closest('[data-va-action="play"]');
            const details = event.target.closest('[data-va-action="details"]');
            if (play || details) {
                event.preventDefault();
                event.stopPropagation();
                if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
                if (play) playHero(hero);
                else openHeroDetails(hero);
                return;
            }
        }

        const detailHero = event.target.closest && event.target.closest('#va12-detail-hero');
        if (detailHero) {
            const play = event.target.closest('[data-va12-action="play"]');
            const more = event.target.closest('[data-va12-action="more"]');
            if (play || more) {
                event.preventDefault();
                event.stopPropagation();
                if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();

                if (play) {
                    const stock = stockDetailPlay();
                    if (stock && typeof stock.click === 'function') stock.click();
                } else {
                    detailMore();
                }
            }
        }
    }

    function scheduleSettle(delay) {
        if (!isHome()) return;
        setHeroSettling(true);
        clearTimeout(STATE.settleTimer);
        STATE.settleTimer = setTimeout(settleHero, typeof delay === 'number' ? delay : 850);
    }

    function render() {
        if (isAdminOrPlayback()) {
            setHeroSettling(false);
            return;
        }

        if (isHome()) {
            const hero = document.getElementById('va-home-hero');
            if (hero && !hero.classList.contains('va15-ready')) scheduleSettle(700);
        } else {
            setHeroSettling(false);
        }

        consumeAutoPlay();
    }

    function scheduleRender(delay) {
        clearTimeout(STATE.renderTimer);
        STATE.renderTimer = setTimeout(render, typeof delay === 'number' ? delay : 120);
    }

    function onRouteChange() {
        const now = route();
        if (now !== STATE.lastRoute) {
            if (!isHome()) clearHeroState();
            if (isHome()) {
                clearHeroState();
                setHeroSettling(true);
            }
            STATE.lastRoute = now;
        }
        scheduleRender(80);
    }

    function start() {
        STATE.lastRoute = route();
        if (isHome()) setHeroSettling(true);

        document.addEventListener('click', captureActions, true);
        window.addEventListener('hashchange', onRouteChange);
        window.addEventListener('popstate', onRouteChange);

        STATE.observer = new MutationObserver(function () {
            scheduleRender(120);
        });
        STATE.observer.observe(document.documentElement, { childList: true, subtree: true });

        render();
        setTimeout(function () { scheduleRender(0); }, 500);
        setTimeout(function () { scheduleRender(0); }, 1300);

        console.log('[Velvet Antenna] v' + VERSION + ' reliability patch loaded');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start, { once: true });
    } else {
        start();
    }
})();
