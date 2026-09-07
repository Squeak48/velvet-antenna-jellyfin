(function () {
    'use strict';

    const VERSION = '0.16.0';
    const HERO_ID = 'va-home-hero';
    const OVERLAY_ID = 'va16-hero-overlay';
    const STORAGE_KEY = 'va16:hero-lock';
    const PENDING_PLAY_KEY = 'va16:pending-play';
    const SETTLE_MS = 1400;

    let renderTimer = null;
    let observer = null;
    let runtimeLock = null;

    function text(el) {
        return el ? (el.textContent || '').trim() : '';
    }

    function hash() {
        return window.location.hash || '';
    }

    function isHome() {
        const value = hash().toLowerCase();
        return value === '#/home' || value.startsWith('#/home?');
    }

    function isDetails() {
        return /details\?id=|\/details\//i.test(hash());
    }

    function api() {
        return window.ApiClient || null;
    }

    function safeJsonParse(value) {
        if (!value) return null;
        try { return JSON.parse(value); } catch (error) { return null; }
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

    function getTitle(card) {
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

    function sectionHeading(section) {
        return text(section && section.querySelector('.sectionTitle-cards, .sectionTitle, h2, h3'));
    }

    function sectionCards(regexes) {
        const sections = Array.from(document.querySelectorAll('.verticalSection'));
        const section = sections.find(candidate => {
            const heading = sectionHeading(candidate);
            return regexes.some(regex => regex.test(heading));
        });
        if (!section) return [];

        return Array.from(section.querySelectorAll('.card')).filter(card => {
            return card.offsetParent !== null && Boolean(getItemId(card));
        });
    }

    function candidatePool() {
        const resume = sectionCards([/continue watching/i, /resume/i]);
        if (resume.length) return { cards: resume, mode: 'CONTINUE WATCHING', priority: true };

        const next = sectionCards([/next up/i]);
        if (next.length) return { cards: next, mode: 'NEXT UP', priority: true };

        const movies = sectionCards([/recently added.*movies/i, /latest.*movies/i]);
        const series = sectionCards([/recently added.*series/i, /recently added.*shows/i, /latest.*series/i]);
        const combined = movies.concat(series);
        if (combined.length) return { cards: combined.slice(0, 20), mode: 'FEATURED FOR YOU', priority: false };

        return { cards: [], mode: 'FEATURED FOR YOU', priority: false };
    }

    function findCardById(itemId) {
        if (!itemId) return null;
        return Array.from(document.querySelectorAll('.card')).find(card => getItemId(card) === itemId) || null;
    }

    function chooseLock() {
        if (runtimeLock && runtimeLock.id) return runtimeLock;

        const saved = safeJsonParse(sessionGet(STORAGE_KEY));
        if (saved && saved.id) {
            runtimeLock = saved;
            return runtimeLock;
        }

        const pool = candidatePool();
        if (!pool.cards.length) return null;

        let card;
        if (pool.priority) {
            card = pool.cards[0];
        } else {
            const index = Math.floor(Math.random() * pool.cards.length);
            card = pool.cards[index];
        }

        const id = getItemId(card);
        if (!id) return null;

        runtimeLock = {
            id: id,
            mode: pool.mode,
            title: getTitle(card) || 'Featured',
            fallbackImage: getCardImage(card) || '',
            created: Date.now()
        };
        sessionSet(STORAGE_KEY, JSON.stringify(runtimeLock));
        return runtimeLock;
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

    function imageUrl(client, itemId, type, tag, width) {
        try {
            if (client && typeof client.getImageUrl === 'function') {
                return client.getImageUrl(itemId, {
                    type: type,
                    index: 0,
                    tag: tag,
                    maxWidth: width || 1700,
                    quality: 82
                });
            }
        } catch (error) {
            console.debug('[Velvet Antenna v0.16] image URL failed', error);
        }
        return '';
    }

    function detailsRoute(itemId) {
        return '#/details?id=' + encodeURIComponent(itemId);
    }

    function goDetails(itemId) {
        if (!itemId) return;
        window.location.hash = detailsRoute(itemId).slice(1);
    }

    function pendingPlay(itemId) {
        sessionSet(PENDING_PLAY_KEY, JSON.stringify({ id: itemId, created: Date.now() }));
        goDetails(itemId);
    }

    function visible(el) {
        return Boolean(el && el.offsetParent !== null && !el.disabled);
    }

    function strictPlayButton() {
        const preferred = [
            '.mainDetailButtons .btnPlay',
            '.detailPagePrimaryContainer .btnPlay',
            '.detailPagePrimaryContent .btnPlay',
            'button.btnPlay',
            'button.btnResume'
        ];

        for (const selector of preferred) {
            const el = document.querySelector(selector);
            if (visible(el)) return el;
        }

        const buttons = Array.from(document.querySelectorAll('button')).filter(visible);
        return buttons.find(button => {
            const label = [
                text(button),
                button.getAttribute('aria-label') || '',
                button.getAttribute('title') || ''
            ].join(' ').trim();

            if (/watch\s*together|sync\s*play|watch\s*session|session|play\s*to/i.test(label)) return false;
            return /^(play|resume|continue|continue watching)$/i.test(text(button)) ||
                   /^(play|resume|continue|continue watching)$/i.test(button.getAttribute('aria-label') || '');
        }) || null;
    }

    function currentDetailsId() {
        const match = hash().match(/[?&]id=([^&]+)/i);
        return match && match[1] ? decodeURIComponent(match[1]) : '';
    }

    function tryPendingPlay() {
        if (!isDetails()) return;
        const pending = safeJsonParse(sessionGet(PENDING_PLAY_KEY));
        if (!pending || !pending.id) return;
        if (Date.now() - Number(pending.created || 0) > 15000) {
            sessionRemove(PENDING_PLAY_KEY);
            return;
        }
        if (currentDetailsId() && currentDetailsId() !== pending.id) return;

        const button = strictPlayButton();
        if (!button) return;

        sessionRemove(PENDING_PLAY_KEY);
        console.log('[Velvet Antenna v0.16] triggering Jellyfin local Play button for', pending.id);
        button.click();
    }

    function createOverlay(lock) {
        const overlay = document.createElement('div');
        overlay.id = OVERLAY_ID;
        overlay.className = 'va16-hero-overlay';
        overlay.innerHTML = `
            <div class="va16-hero-art" aria-hidden="true"></div>
            <div class="va16-hero-shade" aria-hidden="true"></div>
            <div class="va16-hero-content">
                <div class="va16-hero-eyebrow"></div>
                <h1 class="va16-hero-title"></h1>
                <div class="va16-hero-meta"></div>
                <div class="va16-hero-badges"></div>
                <p class="va16-hero-copy">Featured from your library.</p>
                <div class="va16-hero-progress" hidden><div class="va16-hero-progress-label"></div><div class="va16-hero-progress-track"><i></i></div></div>
                <div class="va16-hero-actions">
                    <button type="button" class="va16-button va16-button-primary" data-va16-action="primary"><span>▶</span><b>OPEN</b></button>
                    <button type="button" class="va16-button va16-button-secondary" data-va16-action="details">MORE INFO</button>
                </div>
            </div>
        `;

        overlay.querySelector('.va16-hero-eyebrow').textContent = lock.mode || 'FEATURED FOR YOU';
        overlay.querySelector('.va16-hero-title').textContent = lock.title || 'Featured';
        if (lock.fallbackImage) overlay.style.setProperty('--va16-image', 'url("' + lock.fallbackImage.replace(/"/g, '%22') + '")');
        return overlay;
    }

    function bindOverlay(overlay, state) {
        const primary = overlay.querySelector('[data-va16-action="primary"]');
        const details = overlay.querySelector('[data-va16-action="details"]');

        primary.addEventListener('click', function (event) {
            event.preventDefault();
            event.stopImmediatePropagation();
            if (state.playable) pendingPlay(state.id);
            else goDetails(state.id);
        }, true);

        details.addEventListener('click', function (event) {
            event.preventDefault();
            event.stopImmediatePropagation();
            goDetails(state.id);
        }, true);
    }

    async function hydrateOverlay(overlay, state) {
        const client = api();
        if (!client || typeof client.getItem !== 'function' || typeof client.getCurrentUserId !== 'function') {
            bindOverlay(overlay, state);
            return;
        }

        try {
            const item = await client.getItem(client.getCurrentUserId(), state.id);
            if (!item || !overlay.isConnected) return;

            state.type = item.Type || '';
            state.playable = /^(Movie|Episode|Video|Audio)$/i.test(state.type);
            state.title = item.Name || state.title;

            const title = overlay.querySelector('.va16-hero-title');
            const meta = overlay.querySelector('.va16-hero-meta');
            const copy = overlay.querySelector('.va16-hero-copy');
            const badges = overlay.querySelector('.va16-hero-badges');
            const primaryLabel = overlay.querySelector('[data-va16-action="primary"] b');
            const primaryIcon = overlay.querySelector('[data-va16-action="primary"] span');

            if (title) title.textContent = state.title;

            const metaParts = [];
            if (item.ProductionYear) metaParts.push(String(item.ProductionYear));
            const runtime = formatRuntime(item.RunTimeTicks);
            if (runtime) metaParts.push(runtime);
            if (item.OfficialRating) metaParts.push(item.OfficialRating);
            if (item.CommunityRating) metaParts.push('★ ' + Number(item.CommunityRating).toFixed(1));
            if (meta) meta.textContent = metaParts.join('  •  ');
            if (copy && item.Overview) copy.textContent = item.Overview;

            const badgeValues = [];
            const sources = Array.isArray(item.MediaSources) ? item.MediaSources : [];
            sources.forEach(source => {
                const width = Number(source.Width || 0);
                if (width >= 3000 && !badgeValues.includes('4K')) badgeValues.push('4K');
                else if (width >= 1800 && !badgeValues.includes('1080p')) badgeValues.push('1080p');
                const videoRange = (source.VideoRangeType || source.VideoRange || '').toString();
                if (/dolby.?vision/i.test(videoRange) && !badgeValues.includes('DOLBY VISION')) badgeValues.push('DOLBY VISION');
                else if (/hdr/i.test(videoRange) && !badgeValues.includes('HDR')) badgeValues.push('HDR');
            });
            if (badges) badges.innerHTML = badgeValues.slice(0, 3).map(value => '<span>' + value + '</span>').join('');

            const userData = item.UserData || {};
            if (state.playable) {
                primaryIcon.textContent = '▶';
                primaryLabel.textContent = userData.PlaybackPositionTicks > 0 && !userData.Played ? 'CONTINUE' : 'PLAY';
            } else if (/^Series$/i.test(state.type)) {
                primaryIcon.textContent = '›';
                primaryLabel.textContent = 'VIEW SERIES';
            } else if (/^Season$/i.test(state.type)) {
                primaryIcon.textContent = '›';
                primaryLabel.textContent = 'VIEW SEASON';
            } else if (/BoxSet|CollectionFolder|Folder/i.test(state.type)) {
                primaryIcon.textContent = '›';
                primaryLabel.textContent = 'OPEN COLLECTION';
            } else {
                primaryIcon.textContent = '›';
                primaryLabel.textContent = 'OPEN';
            }

            const progress = overlay.querySelector('.va16-hero-progress');
            if (progress && item.RunTimeTicks > 0 && userData.PlaybackPositionTicks > 0 && !userData.Played) {
                const pct = Math.max(0, Math.min(100, (userData.PlaybackPositionTicks / item.RunTimeTicks) * 100));
                const remaining = Math.max(0, item.RunTimeTicks - userData.PlaybackPositionTicks);
                progress.hidden = false;
                progress.querySelector('.va16-hero-progress-label').textContent = formatRuntime(remaining) + ' left';
                progress.querySelector('i').style.width = pct + '%';
            }

            let backdrop = '';
            if (Array.isArray(item.BackdropImageTags) && item.BackdropImageTags.length) {
                backdrop = imageUrl(client, item.Id || state.id, 'Backdrop', item.BackdropImageTags[0], 1700);
            } else if (item.ParentBackdropItemId && Array.isArray(item.ParentBackdropImageTags) && item.ParentBackdropImageTags.length) {
                backdrop = imageUrl(client, item.ParentBackdropItemId, 'Backdrop', item.ParentBackdropImageTags[0], 1700);
            }

            if (backdrop) {
                const image = new Image();
                image.decoding = 'async';
                image.onload = function () {
                    if (!overlay.isConnected) return;
                    overlay.style.setProperty('--va16-image', 'url("' + backdrop.replace(/"/g, '%22') + '")');
                    overlay.classList.add('va16-backdrop-ready');
                };
                image.src = backdrop;
            }

            runtimeLock = Object.assign({}, state);
            sessionSet(STORAGE_KEY, JSON.stringify(runtimeLock));
            bindOverlay(overlay, state);
        } catch (error) {
            console.debug('[Velvet Antenna v0.16] hero hydration failed', error);
            bindOverlay(overlay, state);
        }
    }

    function mountLockedHero() {
        if (!isHome()) return;
        const hero = document.getElementById(HERO_ID);
        if (!hero) return;

        let lock = chooseLock();
        if (!lock || !lock.id) return;

        let overlay = document.getElementById(OVERLAY_ID);
        if (overlay && overlay.getAttribute('data-va16-id') === lock.id) {
            hero.classList.add('va16-locked');
            return;
        }

        if (overlay) overlay.remove();
        overlay = createOverlay(lock);
        overlay.setAttribute('data-va16-id', lock.id);
        hero.appendChild(overlay);
        hero.classList.add('va16-locked');
        hero.setAttribute('data-va16-version', VERSION);

        hydrateOverlay(overlay, Object.assign({}, lock));
        console.log('[Velvet Antenna v0.16] hero locked to', lock.id, lock.title || '');
    }

    function clearOverlayWhenLeavingHome() {
        if (isHome()) return;
        const overlay = document.getElementById(OVERLAY_ID);
        if (overlay) overlay.remove();
    }

    function scheduleRender(delay) {
        window.clearTimeout(renderTimer);
        renderTimer = window.setTimeout(function () {
            clearOverlayWhenLeavingHome();
            mountLockedHero();
            tryPendingPlay();
        }, typeof delay === 'number' ? delay : 100);
    }

    function onRouteChange() {
        scheduleRender(isHome() ? SETTLE_MS : 120);
    }

    function start() {
        window.addEventListener('hashchange', onRouteChange);
        window.addEventListener('popstate', onRouteChange);

        observer = new MutationObserver(function () {
            scheduleRender(isHome() && !runtimeLock ? 300 : 80);
        });
        observer.observe(document.documentElement, { childList: true, subtree: true });

        scheduleRender(isHome() ? SETTLE_MS : 100);
        window.setTimeout(function () { scheduleRender(0); }, 2200);
        window.setInterval(tryPendingPlay, 250);

        console.log('[Velvet Antenna] v0.16 reliability patch loaded');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start, { once: true });
    } else {
        start();
    }
})();
