(function () {
    'use strict';

    const VERSION = '0.17.1';
    const HERO_ID = 'va-home-hero';
    const OVERLAY_ID = 'va17-overlay';
    const PENDING_PLAY_KEY = 'va17:pending-local-play';
    const SETTLE_MIN_MS = 1400;
    const SETTLE_QUIET_MS = 700;
    const SETTLE_MAX_MS = 4200;
    const SAMPLE_MS = 220;
    const PLAY_RETRY_MS = 250;
    const PLAY_RETRY_LIMIT = 40;

    const STATE = {
        route: '',
        lock: null,
        settleStarted: 0,
        lastSignature: '',
        lastChange: 0,
        settleTimer: null,
        playTimer: null,
        playAttempts: 0,
        observer: null,
        hydrateToken: 0
    };

    function route() {
        return window.location.hash || '';
    }

    function isHome() {
        const value = route().toLowerCase();
        return value === '#/home' || value.startsWith('#/home?');
    }

    function isDetails() {
        return /details\?id=|\/details\//i.test(route());
    }

    function text(el) {
        return el ? (el.textContent || '').trim() : '';
    }

    function api() {
        return window.ApiClient || null;
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
        const client = api();
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

    function currentDetailsId() {
        const match = route().match(/[?&]id=([^&]+)/i) || route().match(/\/details\/([^?&/]+)/i);
        return match && match[1] ? decodeURIComponent(match[1]) : '';
    }

    function looksLikeItemId(value) {
        return /^[a-f0-9]{16,}$/i.test((value || '').trim());
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

        for (const node of nodes) {
            const value =
                (node.dataset && (node.dataset.id || node.dataset.itemid || node.dataset.itemId)) ||
                node.getAttribute('data-id') ||
                node.getAttribute('data-itemid');
            if (value) return value;
        }

        const link = card.closest('a[href]') || card.querySelector('a[href]');
        const href = link && link.getAttribute('href');
        if (href) {
            const match = href.match(/[?&]id=([^&]+)/i) || href.match(/details\?id=([^&]+)/i);
            if (match && match[1]) return decodeURIComponent(match[1]);
        }
        return '';
    }

    function getCardTitle(card) {
        if (!card) return '';
        const selectors = ['.cardText-first', '.cardText', '.itemName', '[title]'];
        for (const selector of selectors) {
            const el = card.querySelector(selector);
            const value = el && ((el.textContent || el.getAttribute('title') || '') + '').trim();
            if (value) return value;
        }
        return (card.getAttribute('aria-label') || card.getAttribute('title') || '').trim();
    }

    function findCardByTitle(title) {
        const wanted = (title || '').trim().toLowerCase();
        if (!wanted) return null;
        return Array.from(document.querySelectorAll('.verticalSection .card')).find(card => {
            return card.offsetParent !== null && getCardTitle(card).toLowerCase() === wanted && Boolean(getItemId(card));
        }) || null;
    }

    function heroItemId(hero) {
        if (!hero) return '';
        const v15 = hero.getAttribute('data-va15-item-id') || '';
        if (v15) return v15;

        const v14 = hero.getAttribute('data-va14-hero') || '';
        if (looksLikeItemId(v14)) return v14;

        const card = findCardByTitle(text(hero.querySelector('.va-hero__title')));
        return getItemId(card);
    }

    function heroSignature(hero) {
        if (!hero) return '';
        return [
            heroItemId(hero),
            text(hero.querySelector('.va-hero__title')),
            text(hero.querySelector('.va-hero__eyebrow')),
            hero.style.getPropertyValue('--va-hero-image') || '',
            hero.style.getPropertyValue('--va-hero-image-base') || ''
        ].join('|');
    }

    function formatRuntime(ticks) {
        const value = Number(ticks || 0);
        if (!value) return '';
        const minutes = Math.round(value / 600000000);
        if (minutes < 60) return minutes + ' min';
        const hours = Math.floor(minutes / 60);
        const rest = minutes % 60;
        return rest ? hours + 'h ' + rest + 'm' : hours + 'h';
    }

    function imageUrl(client, itemId, type, tag, maxWidth) {
        if (!client || !itemId || !tag || typeof client.getImageUrl !== 'function') return '';
        try {
            return client.getImageUrl(itemId, {
                type: type,
                index: 0,
                tag: tag,
                maxWidth: maxWidth || 1700,
                quality: 84
            });
        } catch (error) {
            return '';
        }
    }

    function captureHero(hero, itemId) {
        const play = hero.querySelector('[data-va-action="play"]');
        const mode = (play && play.getAttribute('data-va15-mode')) || 'play';
        return {
            id: itemId,
            type: hero.getAttribute('data-va15-item-type') || '',
            mode: mode,
            title: text(hero.querySelector('.va-hero__title')) || 'Featured',
            eyebrow: text(hero.querySelector('.va-hero__eyebrow')) || 'FEATURED FOR YOU',
            meta: text(hero.querySelector('.va-hero__meta')),
            copy: text(hero.querySelector('.va-hero__copy')) || 'Featured from your library.',
            primaryLabel: play ? text(play.querySelector('.va-button__label') || play.querySelector('span:last-child')) : 'PLAY',
            image: hero.style.getPropertyValue('--va-hero-image') || hero.style.getPropertyValue('--va-hero-image-base') || ''
        };
    }

    function createOverlay(lock) {
        const overlay = document.createElement('div');
        overlay.id = OVERLAY_ID;
        overlay.className = 'va17-overlay';
        overlay.setAttribute('data-va17-item-id', lock.id);
        overlay.innerHTML = `
            <div class="va17-overlay__art" aria-hidden="true"></div>
            <div class="va17-overlay__shade" aria-hidden="true"></div>
            <div class="va17-overlay__content">
                <div class="va17-overlay__eyebrow"></div>
                <h1 class="va17-overlay__title"></h1>
                <div class="va17-overlay__meta"></div>
                <div class="va17-overlay__badges"></div>
                <p class="va17-overlay__copy"></p>
                <div class="va17-overlay__actions">
                    <button type="button" class="va-button va-button--primary" data-va17-action="primary"><span>▶</span><span class="va17-primary-label"></span></button>
                    <button type="button" class="va-button va-button--secondary" data-va17-action="details">MORE INFO</button>
                </div>
            </div>
        `;
        updateOverlay(overlay, lock);
        return overlay;
    }

    function updateOverlay(overlay, lock) {
        if (!overlay || !lock) return;
        overlay.setAttribute('data-va17-item-id', lock.id);
        overlay.querySelector('.va17-overlay__eyebrow').textContent = lock.eyebrow || 'FEATURED FOR YOU';
        overlay.querySelector('.va17-overlay__title').textContent = lock.title || 'Featured';
        overlay.querySelector('.va17-overlay__meta').textContent = lock.meta || '';
        overlay.querySelector('.va17-overlay__copy').textContent = lock.copy || 'Featured from your library.';
        overlay.querySelector('.va17-primary-label').textContent = lock.primaryLabel || (lock.mode === 'details' ? 'OPEN' : 'PLAY');
        if (lock.image) overlay.style.setProperty('--va17-image', lock.image);
    }

    function mountLockedOverlay() {
        if (!isHome() || !STATE.lock) return;
        const hero = document.getElementById(HERO_ID);
        if (!hero) return;

        let overlay = document.getElementById(OVERLAY_ID);
        if (!overlay || !hero.contains(overlay)) {
            if (overlay) overlay.remove();
            overlay = createOverlay(STATE.lock);
            hero.appendChild(overlay);
        } else {
            updateOverlay(overlay, STATE.lock);
        }

        hero.classList.add('va17-locked');
        if (document.body) {
            document.body.classList.remove('va17-hero-settling');
            document.body.classList.add('va17-hero-locked');
        }
    }

    async function hydrateLock(itemId, token) {
        const client = api();
        if (!client || typeof client.getItem !== 'function' || typeof client.getCurrentUserId !== 'function') return;

        try {
            const item = await client.getItem(client.getCurrentUserId(), itemId);
            if (!item || token !== STATE.hydrateToken || !STATE.lock || STATE.lock.id !== itemId) return;

            const lock = STATE.lock;
            const userData = item.UserData || {};
            lock.type = item.Type || lock.type;
            lock.mode = /^(Movie|Episode|Video|Audio)$/i.test(lock.type) ? 'play' : 'details';
            lock.title = item.Name || lock.title;
            lock.copy = item.Overview || lock.copy;

            if (lock.mode === 'play') {
                lock.primaryLabel = userData.PlaybackPositionTicks > 0 && !userData.Played ? 'CONTINUE' : 'PLAY';
            } else if (/^Series$/i.test(lock.type)) {
                lock.primaryLabel = 'VIEW SERIES';
            } else if (/^Season$/i.test(lock.type)) {
                lock.primaryLabel = 'VIEW SEASON';
            } else {
                lock.primaryLabel = 'OPEN';
            }

            const meta = [];
            if (item.ProductionYear) meta.push(String(item.ProductionYear));
            const runtime = formatRuntime(item.RunTimeTicks);
            if (runtime) meta.push(runtime);
            if (item.OfficialRating) meta.push(item.OfficialRating);
            if (item.CommunityRating) meta.push('★ ' + Number(item.CommunityRating).toFixed(1));
            lock.meta = meta.join('  •  ');

            let backdrop = '';
            if (Array.isArray(item.BackdropImageTags) && item.BackdropImageTags.length) {
                backdrop = imageUrl(client, item.Id || itemId, 'Backdrop', item.BackdropImageTags[0], 1700);
            } else if (item.ParentBackdropItemId && Array.isArray(item.ParentBackdropImageTags) && item.ParentBackdropImageTags.length) {
                backdrop = imageUrl(client, item.ParentBackdropItemId, 'Backdrop', item.ParentBackdropImageTags[0], 1700);
            }
            if (backdrop) lock.image = 'url("' + backdrop.replace(/"/g, '%22') + '")';

            mountLockedOverlay();
        } catch (error) {
            console.debug('[Velvet Antenna v0.17.1] hero hydration failed', error);
        }
    }

    function lockHero(hero, itemId) {
        if (!hero || !itemId || STATE.lock) return;
        STATE.lock = captureHero(hero, itemId);
        STATE.hydrateToken += 1;
        mountLockedOverlay();
        hydrateLock(itemId, STATE.hydrateToken);
        console.log('[Velvet Antenna v0.17.1] home hero locked to', itemId, STATE.lock.title || '');
    }

    function beginSettle() {
        window.clearTimeout(STATE.settleTimer);
        STATE.lock = null;
        STATE.settleStarted = Date.now();
        STATE.lastSignature = '';
        STATE.lastChange = STATE.settleStarted;
        STATE.hydrateToken += 1;

        const oldOverlay = document.getElementById(OVERLAY_ID);
        if (oldOverlay) oldOverlay.remove();
        const hero = document.getElementById(HERO_ID);
        if (hero) hero.classList.remove('va17-locked');

        if (document.body) {
            document.body.classList.add('va17-hero-settling');
            document.body.classList.remove('va17-hero-locked');
        }
        scheduleSettleSample(80);
    }

    function settleSample() {
        if (!isHome() || STATE.lock) return;
        const hero = document.getElementById(HERO_ID);
        const now = Date.now();

        if (!hero) {
            scheduleSettleSample(SAMPLE_MS);
            return;
        }

        const signature = heroSignature(hero);
        if (signature && signature !== STATE.lastSignature) {
            STATE.lastSignature = signature;
            STATE.lastChange = now;
        }

        const itemId = heroItemId(hero);
        const age = now - STATE.settleStarted;
        const quiet = now - STATE.lastChange;

        if (itemId && ((age >= SETTLE_MIN_MS && quiet >= SETTLE_QUIET_MS) || age >= SETTLE_MAX_MS)) {
            lockHero(hero, itemId);
            return;
        }

        scheduleSettleSample(SAMPLE_MS);
    }

    function scheduleSettleSample(delay) {
        window.clearTimeout(STATE.settleTimer);
        STATE.settleTimer = window.setTimeout(settleSample, typeof delay === 'number' ? delay : SAMPLE_MS);
    }

    function blockedPlaybackControl(el) {
        if (!el) return true;
        const blocked = /sync\s*play|syncplay|watch\s*together|join\s*(?:a\s*)?group|watch\s*session|group\s*watch|watch\s*party|play\s*to|remote\s*play/i;
        let node = el;
        let depth = 0;
        while (node && depth < 5) {
            const value = [
                text(node),
                node.id || '',
                typeof node.className === 'string' ? node.className : '',
                node.getAttribute && node.getAttribute('aria-label') || '',
                node.getAttribute && node.getAttribute('title') || ''
            ].join(' ');
            if (blocked.test(value)) return true;
            node = node.parentElement;
            depth += 1;
        }
        return false;
    }

    function localPlayButton() {
        if (!isDetails()) return null;
        const selectors = [
            '.mainDetailButtons .btnPlay',
            '.detailPagePrimaryContainer .btnPlay',
            '.detailPagePrimaryContent .btnPlay',
            '.detailPageContent .btnPlay'
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
        return candidates.find(el => el.isConnected && !el.disabled && el.offsetParent !== null && !blockedPlaybackControl(el)) || null;
    }

    function queuePendingPlay(itemId) {
        if (!itemId) return;
        sessionSet(PENDING_PLAY_KEY, JSON.stringify({ id: itemId, created: Date.now() }));
        STATE.playAttempts = 0;
    }

    function tryPendingPlay() {
        window.clearTimeout(STATE.playTimer);
        if (!isDetails()) return;

        const pending = safeJson(sessionGet(PENDING_PLAY_KEY));
        if (!pending || !pending.id) return;
        if (Date.now() - Number(pending.created || 0) > 15000) {
            sessionRemove(PENDING_PLAY_KEY);
            return;
        }
        if (currentDetailsId() !== pending.id) return;

        const button = localPlayButton();
        if (button) {
            sessionRemove(PENDING_PLAY_KEY);
            console.log('[Velvet Antenna v0.17.1] triggering genuine local .btnPlay for', pending.id);
            button.click();
            return;
        }

        STATE.playAttempts += 1;
        if (STATE.playAttempts < PLAY_RETRY_LIMIT) {
            STATE.playTimer = window.setTimeout(tryPendingPlay, PLAY_RETRY_MS);
        }
    }

    function detailMore() {
        const hero = document.getElementById('va12-detail-hero');
        const target =
            document.querySelector('.detailPageSecondaryContainer') ||
            document.querySelector('.details-additionalContent') ||
            document.querySelector('.itemDetailsGroup') ||
            Array.from(document.querySelectorAll('.verticalSection')).find(section => !hero || (!hero.contains(section) && section.offsetParent !== null));
        if (!target || typeof target.scrollIntoView !== 'function') return false;
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return true;
    }

    function stopEvent(event) {
        event.preventDefault();
        event.stopPropagation();
        if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
    }

    function captureVelvetActions(event) {
        const target = event.target;
        if (!target || typeof target.closest !== 'function') return;

        const overlay = target.closest('#' + OVERLAY_ID);
        if (overlay) {
            const primary = target.closest('[data-va17-action="primary"]');
            const details = target.closest('[data-va17-action="details"]');
            if (primary || details) {
                stopEvent(event);
                const itemId = overlay.getAttribute('data-va17-item-id') || (STATE.lock && STATE.lock.id) || '';
                if (!itemId) return;
                if (details || (STATE.lock && STATE.lock.mode !== 'play')) {
                    navigateDetails(itemId);
                    return;
                }
                queuePendingPlay(itemId);
                navigateDetails(itemId);
                return;
            }
        }

        const homeHero = target.closest('#' + HERO_ID);
        if (homeHero) {
            const play = target.closest('[data-va-action="play"]');
            const details = target.closest('[data-va-action="details"]');
            if (play || details) {
                stopEvent(event);
                const itemId = (STATE.lock && STATE.lock.id) || heroItemId(homeHero);
                if (!itemId) return;
                if (details || play.getAttribute('data-va15-mode') === 'details') {
                    navigateDetails(itemId);
                    return;
                }
                queuePendingPlay(itemId);
                navigateDetails(itemId);
                return;
            }
        }

        const detailHero = target.closest('#va12-detail-hero');
        if (detailHero) {
            const play = target.closest('[data-va12-action="play"]');
            const more = target.closest('[data-va12-action="more"]');
            if (play || more) {
                stopEvent(event);
                if (more) {
                    detailMore();
                    return;
                }
                const itemId = currentDetailsId() || detailHero.getAttribute('data-item-id') || '';
                if (!itemId) return;
                queuePendingPlay(itemId);
                tryPendingPlay();
            }
        }
    }

    function onRouteChange() {
        const wasHome = STATE.route.toLowerCase().startsWith('#/home');
        STATE.route = route();

        if (isHome() && !wasHome) beginSettle();
        if (!isHome() && wasHome) {
            window.clearTimeout(STATE.settleTimer);
            STATE.lock = null;
            STATE.hydrateToken += 1;
            if (document.body) document.body.classList.remove('va17-hero-settling', 'va17-hero-locked');
        }

        if (isDetails()) {
            STATE.playAttempts = 0;
            window.setTimeout(tryPendingPlay, 80);
        } else {
            window.clearTimeout(STATE.playTimer);
        }
    }

    function onStructuralMutation() {
        if (isHome()) {
            if (STATE.lock) {
                const hero = document.getElementById(HERO_ID);
                const overlay = document.getElementById(OVERLAY_ID);
                if (hero && (!overlay || !hero.contains(overlay))) mountLockedOverlay();
            } else {
                scheduleSettleSample(120);
            }
        }
    }

    function start() {
        STATE.route = route();
        window.addEventListener('click', captureVelvetActions, true);
        window.addEventListener('hashchange', onRouteChange);
        window.addEventListener('popstate', onRouteChange);

        STATE.observer = new MutationObserver(onStructuralMutation);
        STATE.observer.observe(document.documentElement, { childList: true, subtree: true });

        if (isHome()) beginSettle();
        if (isDetails()) window.setTimeout(tryPendingPlay, 100);

        console.log('[Velvet Antenna] v' + VERSION + ' safe functional hotfix loaded');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start, { once: true });
    } else {
        start();
    }
})();