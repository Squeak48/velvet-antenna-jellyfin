(function () {
    'use strict';

    const VERSION = '0.17.0';
    const HERO_ID = 'va-home-hero';
    const PENDING_PLAY_KEY = 'va17:pending-local-play';
    const QUIET_MS = 800;
    const MIN_SETTLE_MS = 1500;
    const MAX_SETTLE_MS = 4500;
    const PENDING_TTL_MS = 15000;

    const STATE = {
        route: '',
        settleStarted: 0,
        lastSignature: '',
        lastHeroChange: 0,
        lock: null,
        hydrateToken: 0,
        settleTimer: null,
        observer: null
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

    function currentDetailsId() {
        const match = route().match(/[?&]id=([^&]+)/i) || route().match(/\/details\/([^?&/]+)/i);
        return match && match[1] ? decodeURIComponent(match[1]) : '';
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

    function getCardImage(card) {
        if (!card) return '';
        const img = card.querySelector('img');
        if (img && img.src) return img.src;

        for (const el of card.querySelectorAll('.cardImage, .cardImageContainer, .cardContent')) {
            const bg = window.getComputedStyle(el).backgroundImage;
            const match = bg && bg.match(/url\(["']?(.*?)["']?\)/i);
            if (match && match[1]) return match[1];
        }
        return '';
    }

    function findCardByTitle(title) {
        const wanted = (title || '').trim().toLowerCase();
        if (!wanted) return null;
        return Array.from(document.querySelectorAll('.verticalSection .card')).find(card => {
            return card.offsetParent !== null && getCardTitle(card).toLowerCase() === wanted && Boolean(getItemId(card));
        }) || null;
    }

    function looksLikeItemId(value) {
        return /^[a-f0-9]{16,}$/i.test((value || '').trim());
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
            hero.getAttribute('data-va15-item-id') || '',
            hero.getAttribute('data-va14-hero') || '',
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

    function mediaBadges(item) {
        const badges = [];
        const streams = Array.isArray(item && item.MediaStreams) ? item.MediaStreams : [];
        const video = streams.find(stream => /video/i.test(stream.Type || ''));
        const audio = streams.find(stream => /audio/i.test(stream.Type || ''));

        if (video) {
            const width = Number(video.Width || 0);
            if (width >= 3500) badges.push('4K');
            else if (width >= 1800) badges.push('1080P');

            const range = [
                video.VideoRange,
                video.VideoRangeType,
                video.Hdr10PlusPresent ? 'HDR10+' : '',
                video.DvVersionMajor ? 'DOLBY VISION' : ''
            ].filter(Boolean).join(' ').toUpperCase();

            if (/DOLBY|DOVI/.test(range)) badges.push('DOLBY VISION');
            else if (/HDR/.test(range)) badges.push('HDR');
        }

        if (audio) {
            const channels = Number(audio.Channels || 0);
            if (channels >= 8) badges.push('7.1');
            else if (channels >= 6) badges.push('5.1');
        }

        return Array.from(new Set(badges)).slice(0, 4);
    }

    function setTextIfChanged(el, value) {
        if (!el) return;
        const next = value == null ? '' : String(value);
        if (el.textContent !== next) el.textContent = next;
    }

    function setAttrIfChanged(el, name, value) {
        if (!el) return;
        const next = value == null ? '' : String(value);
        if (el.getAttribute(name) !== next) el.setAttribute(name, next);
    }

    function setStyleIfChanged(el, name, value) {
        if (!el) return;
        const next = value || '';
        if (el.style.getPropertyValue(name) !== next) el.style.setProperty(name, next);
    }

    function captureHeroModel(hero, itemId) {
        const play = hero.querySelector('[data-va-action="play"]');
        const card = findCardByTitle(text(hero.querySelector('.va-hero__title')));
        const progress = hero.querySelector('#va14-hero-progress');
        const progressBar = progress && progress.querySelector('i');
        const progressLabel = progress && progress.querySelector('.va14-hero-progress__label');
        const mode = (play && play.getAttribute('data-va15-mode')) ||
            (/^(Series|Season|BoxSet|CollectionFolder|Folder)$/i.test(hero.getAttribute('data-va15-item-type') || '') ? 'details' : 'play');

        return {
            id: itemId,
            type: hero.getAttribute('data-va15-item-type') || '',
            mode: mode,
            title: text(hero.querySelector('.va-hero__title')) || getCardTitle(card) || 'Featured',
            eyebrow: text(hero.querySelector('.va-hero__eyebrow')) || 'FEATURED FOR YOU',
            meta: text(hero.querySelector('.va-hero__meta')),
            copy: text(hero.querySelector('.va-hero__copy')),
            badges: hero.querySelector('#va14-hero-badges') ? hero.querySelector('#va14-hero-badges').innerHTML : '',
            progressHidden: progress ? progress.hidden : true,
            progressLabel: text(progressLabel),
            progressWidth: progressBar ? progressBar.style.width : '',
            primaryLabel: play ? text(play.querySelector('.va-button__label') || play.querySelector('span:last-child')) : 'PLAY',
            fallbackImage: hero.style.getPropertyValue('--va-hero-image-base') || (card ? 'url("' + getCardImage(card).replace(/"/g, '%22') + '")' : ''),
            backdropImage: hero.style.getPropertyValue('--va-hero-image') || ''
        };
    }

    function ensureHeroExtras(hero) {
        let badges = hero.querySelector('#va14-hero-badges');
        if (!badges) {
            badges = document.createElement('div');
            badges.id = 'va14-hero-badges';
            badges.className = 'va14-format-badges';
            const meta = hero.querySelector('.va-hero__meta');
            if (meta && meta.parentElement) meta.insertAdjacentElement('afterend', badges);
        }

        let progress = hero.querySelector('#va14-hero-progress');
        if (!progress) {
            progress = document.createElement('div');
            progress.id = 'va14-hero-progress';
            progress.className = 'va14-hero-progress';
            progress.innerHTML = '<div class="va14-hero-progress__label"></div><div class="va14-hero-progress__track"><i></i></div>';
            const copy = hero.querySelector('.va-hero__copy');
            if (copy && copy.parentElement) copy.insertAdjacentElement('afterend', progress);
        }
    }

    function applyLockedHero() {
        if (!isHome() || !STATE.lock || !STATE.lock.id) return;
        const hero = document.getElementById(HERO_ID);
        if (!hero) return;

        const lock = STATE.lock;
        ensureHeroExtras(hero);

        setAttrIfChanged(hero, 'data-va17-lock', lock.id);
        setAttrIfChanged(hero, 'data-va15-item-id', lock.id);
        setAttrIfChanged(hero, 'data-va15-details-href', detailsRoute(lock.id));
        if (lock.type) setAttrIfChanged(hero, 'data-va15-item-type', lock.type);

        hero.classList.add('va17-locked', 'va15-ready');
        document.body && document.body.classList.remove('va17-hero-settling');
        document.body && document.body.classList.add('va17-hero-locked');

        setTextIfChanged(hero.querySelector('.va-hero__title'), lock.title || 'Featured');
        setTextIfChanged(hero.querySelector('.va-hero__eyebrow'), lock.eyebrow || 'FEATURED FOR YOU');
        setTextIfChanged(hero.querySelector('.va-hero__meta'), lock.meta || '');
        setTextIfChanged(hero.querySelector('.va-hero__copy'), lock.copy || '');

        const badges = hero.querySelector('#va14-hero-badges');
        if (badges && badges.innerHTML !== (lock.badges || '')) badges.innerHTML = lock.badges || '';
        if (badges) badges.hidden = !badges.innerHTML.trim();

        const progress = hero.querySelector('#va14-hero-progress');
        if (progress) {
            if (progress.hidden !== Boolean(lock.progressHidden)) progress.hidden = Boolean(lock.progressHidden);
            setTextIfChanged(progress.querySelector('.va14-hero-progress__label'), lock.progressLabel || '');
            const bar = progress.querySelector('i');
            if (bar && bar.style.width !== (lock.progressWidth || '')) bar.style.width = lock.progressWidth || '';
        }

        if (lock.fallbackImage) {
            setStyleIfChanged(hero, '--va-hero-image-base', lock.fallbackImage);
            hero.classList.add('va-hero--has-base-art');
        }
        if (lock.backdropImage) {
            setStyleIfChanged(hero, '--va-hero-image', lock.backdropImage);
            hero.classList.add('va-hero--backdrop-ready');
        }

        const play = hero.querySelector('[data-va-action="play"]');
        if (play) {
            setAttrIfChanged(play, 'data-va15-mode', lock.mode || 'play');
            play.hidden = false;
            const label = play.querySelector('.va-button__label') || play.querySelector('span:last-child');
            setTextIfChanged(label, lock.primaryLabel || (lock.mode === 'details' ? 'OPEN' : 'PLAY'));
        }
    }

    async function hydrateLock(lockId, token) {
        const client = api();
        if (!client || typeof client.getItem !== 'function' || typeof client.getCurrentUserId !== 'function') return;

        try {
            const item = await client.getItem(client.getCurrentUserId(), lockId);
            if (!item || token !== STATE.hydrateToken || !STATE.lock || STATE.lock.id !== lockId) return;

            const lock = STATE.lock;
            const userData = item.UserData || {};
            lock.type = item.Type || lock.type;
            lock.title = item.Name || lock.title;
            lock.mode = /^(Movie|Episode|Video|Audio)$/i.test(lock.type) ? 'play' : 'details';

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
            if (item.Overview) lock.copy = item.Overview;

            const badges = mediaBadges(item);
            lock.badges = badges.map(value => '<span>' + value + '</span>').join('');

            if (item.RunTimeTicks > 0 && userData.PlaybackPositionTicks > 0 && !userData.Played) {
                const pct = Math.max(0, Math.min(100, (userData.PlaybackPositionTicks / item.RunTimeTicks) * 100));
                lock.progressHidden = false;
                lock.progressLabel = formatRuntime(Math.max(0, item.RunTimeTicks - userData.PlaybackPositionTicks)) + ' left';
                lock.progressWidth = pct + '%';
            } else {
                lock.progressHidden = true;
                lock.progressLabel = '';
                lock.progressWidth = '';
            }

            let backdrop = '';
            if (Array.isArray(item.BackdropImageTags) && item.BackdropImageTags.length) {
                backdrop = imageUrl(client, item.Id || lockId, 'Backdrop', item.BackdropImageTags[0], 1700);
            } else if (item.ParentBackdropItemId && Array.isArray(item.ParentBackdropImageTags) && item.ParentBackdropImageTags.length) {
                backdrop = imageUrl(client, item.ParentBackdropItemId, 'Backdrop', item.ParentBackdropImageTags[0], 1700);
            }

            if (backdrop) lock.backdropImage = 'url("' + backdrop.replace(/"/g, '%22') + '")';
            applyLockedHero();
        } catch (error) {
            console.debug('[Velvet Antenna v0.17] locked hero hydration failed', error);
        }
    }

    function lockHero(hero, itemId) {
        if (!hero || !itemId || STATE.lock) return;
        STATE.lock = captureHeroModel(hero, itemId);
        STATE.hydrateToken += 1;
        applyLockedHero();
        hydrateLock(itemId, STATE.hydrateToken);
        console.log('[Velvet Antenna v0.17] home hero locked to', itemId, STATE.lock.title || '');
    }

    function beginHomeSettle() {
        STATE.settleStarted = Date.now();
        STATE.lastSignature = '';
        STATE.lastHeroChange = STATE.settleStarted;
        STATE.lock = null;
        STATE.hydrateToken += 1;
        window.clearTimeout(STATE.settleTimer);

        if (document.body) {
            document.body.classList.add('va17-hero-settling');
            document.body.classList.remove('va17-hero-locked');
        }

        const hero = document.getElementById(HERO_ID);
        if (hero) hero.classList.remove('va17-locked');
    }

    function settleCheck() {
        if (!isHome() || STATE.lock) return;
        const hero = document.getElementById(HERO_ID);
        if (!hero) return;

        const now = Date.now();
        const signature = heroSignature(hero);
        if (signature && signature !== STATE.lastSignature) {
            STATE.lastSignature = signature;
            STATE.lastHeroChange = now;
        }

        const itemId = heroItemId(hero);
        if (!itemId) return;

        const age = now - STATE.settleStarted;
        const quiet = now - STATE.lastHeroChange;
        if ((age >= MIN_SETTLE_MS && quiet >= QUIET_MS) || age >= MAX_SETTLE_MS) {
            lockHero(hero, itemId);
        }
    }

    function scheduleSettleCheck(delay) {
        window.clearTimeout(STATE.settleTimer);
        STATE.settleTimer = window.setTimeout(settleCheck, typeof delay === 'number' ? delay : 120);
    }

    function blockedPlaybackControl(el) {
        if (!el) return true;
        const own = [
            text(el),
            el.getAttribute && el.getAttribute('aria-label'),
            el.getAttribute && el.getAttribute('title'),
            el.id,
            typeof el.className === 'string' ? el.className : ''
        ].filter(Boolean).join(' ');

        const blocked = /sync\s*play|syncplay|watch\s*together|join\s*(?:a\s*)?group|watch\s*session|group\s*watch|watch\s*party|play\s*to|remote\s*play/i;
        if (blocked.test(own)) return true;

        let node = el.parentElement;
        let depth = 0;
        while (node && depth < 4) {
            const attrs = [
                node.id || '',
                typeof node.className === 'string' ? node.className : '',
                node.getAttribute && node.getAttribute('aria-label') || '',
                node.getAttribute && node.getAttribute('title') || ''
            ].join(' ');
            if (blocked.test(attrs)) return true;
            node = node.parentElement;
            depth += 1;
        }
        return false;
    }

    function localPlayButton() {
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

        const usable = candidates.filter(el => el.isConnected && !el.disabled && !blockedPlaybackControl(el));
        return usable.find(el => el.offsetParent !== null) || usable[0] || null;
    }

    function queuePendingPlay(itemId) {
        if (!itemId) return;
        sessionSet(PENDING_PLAY_KEY, JSON.stringify({ id: itemId, created: Date.now() }));
    }

    function tryPendingPlay() {
        if (!isDetails()) return false;
        const pending = safeJson(sessionGet(PENDING_PLAY_KEY));
        if (!pending || !pending.id) return false;

        if (Date.now() - Number(pending.created || 0) > PENDING_TTL_MS) {
            sessionRemove(PENDING_PLAY_KEY);
            return false;
        }

        const current = currentDetailsId();
        if (!current || current !== pending.id) return false;

        const button = localPlayButton();
        if (!button) return false;

        sessionRemove(PENDING_PLAY_KEY);
        button.setAttribute('data-va17-local-play', '1');
        console.log('[Velvet Antenna v0.17] triggering genuine Jellyfin .btnPlay for', pending.id);
        button.click();
        return true;
    }

    function homeItemId(hero) {
        return (STATE.lock && STATE.lock.id) || heroItemId(hero);
    }

    function stopEvent(event) {
        event.preventDefault();
        event.stopPropagation();
        if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
    }

    function detailMore() {
        const hero = document.getElementById('va12-detail-hero');
        const candidates = [
            document.querySelector('.detailPageSecondaryContainer'),
            document.querySelector('.details-additionalContent'),
            document.querySelector('.itemDetailsGroup'),
            Array.from(document.querySelectorAll('.verticalSection')).find(section => !hero || (!hero.contains(section) && section.offsetParent !== null))
        ].filter(Boolean);

        const target = candidates[0];
        if (!target || typeof target.scrollIntoView !== 'function') return false;
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return true;
    }

    function captureVelvetActions(event) {
        const target = event.target;
        if (!target || typeof target.closest !== 'function') return;

        const homeHero = target.closest('#' + HERO_ID);
        if (homeHero) {
            const play = target.closest('[data-va-action="play"], [data-va16-action="primary"]');
            const details = target.closest('[data-va-action="details"], [data-va16-action="details"]');
            if (play || details) {
                stopEvent(event);

                const itemId = homeItemId(homeHero);
                if (!itemId) return;
                if (!STATE.lock) lockHero(homeHero, itemId);

                if (details) {
                    navigateDetails(itemId);
                    return;
                }

                const mode = (STATE.lock && STATE.lock.mode) || play.getAttribute('data-va15-mode') || 'play';
                if (mode !== 'play') {
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
        const now = route();
        const wasHome = STATE.route.toLowerCase().startsWith('#/home');
        const nowHome = isHome();
        STATE.route = now;

        if (nowHome && !wasHome) beginHomeSettle();
        if (!nowHome && wasHome) {
            window.clearTimeout(STATE.settleTimer);
            STATE.lock = null;
            STATE.hydrateToken += 1;
            if (document.body) {
                document.body.classList.remove('va17-hero-settling', 'va17-hero-locked');
            }
        }

        if (nowHome) scheduleSettleCheck(80);
        if (isDetails()) window.setTimeout(tryPendingPlay, 0);
    }

    function onMutations() {
        if (isHome()) {
            if (STATE.lock) applyLockedHero();
            else scheduleSettleCheck(80);
        }
        if (isDetails()) tryPendingPlay();
    }

    function start() {
        STATE.route = route();
        if (isHome()) beginHomeSettle();

        // Window capture runs before v0.15's document capture listener, so the
        // hotfix owns Velvet Antenna Play/More actions before older layers.
        window.addEventListener('click', captureVelvetActions, true);
        window.addEventListener('hashchange', onRouteChange);
        window.addEventListener('popstate', onRouteChange);

        STATE.observer = new MutationObserver(onMutations);
        STATE.observer.observe(document.documentElement, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['data-va14-hero', 'data-va15-item-id', 'data-va15-item-type', 'style', 'class']
        });

        window.setInterval(function () {
            if (isHome()) {
                if (STATE.lock) applyLockedHero();
                else settleCheck();
            }
            tryPendingPlay();
        }, 200);

        scheduleSettleCheck(120);
        console.log('[Velvet Antenna] v' + VERSION + ' functional hotfix loaded');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start, { once: true });
    } else {
        start();
    }
})();
