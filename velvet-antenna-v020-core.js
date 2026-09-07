(function () {
    'use strict';

    const VERSION = '0.20.0';
    const CACHE_PREFIX = 'velvet-antenna-v020:';
    const PENDING_PLAY_KEY = CACHE_PREFIX + 'pending-local-play';
    const PLAY_TTL_MS = 15000;
    const PLAY_RETRY_MS = 150;
    const MAX_PLAY_ATTEMPTS = 40;
    const HERO_SETTLE_MAX_MS = 2600;
    const HERO_SETTLE_STABLE_MS = 500;

    const IDS = {
        nav: 'va20-nav',
        hero: 'va20-home-hero',
        libraryIntro: 'va20-library-intro',
        searchIntro: 'va20-search-intro',
        detailBrand: 'va20-detail-brand'
    };

    const PAGE_CLASSES = [
        'va20-page-home',
        'va20-page-library',
        'va20-page-search',
        'va20-page-details',
        'va20-page-live',
        'va20-page-other'
    ];

    const STATE = {
        lastRoute: '',
        renderTimer: null,
        observer: null,
        heroTimer: null,
        heroStart: 0,
        heroSignature: '',
        heroSignatureSince: 0,
        heroLock: null,
        heroFetchToken: 0,
        playTimer: null,
        playAttempts: 0,
        admin: false,
        adminResolved: false,
        metadataMode: false
    };

    function route() {
        return window.location.hash || '';
    }

    function lowerRoute() {
        return route().toLowerCase();
    }

    function text(el) {
        return el ? (el.textContent || '').trim() : '';
    }

    function normalise(value) {
        return String(value || '').trim().toLowerCase();
    }

    function isAdminRoute() {
        return /dashboard|configurationpage|scheduledtasks|logs|networking|plugins|metadataeditor/i.test(route());
    }

    function isPlayback() {
        return /videoosd|nowplaying|playback/i.test(route()) ||
            Boolean(document.querySelector('.videoPlayerContainer:not(.hide), .videoOsdPage:not(.hide)'));
    }

    function isDetails() {
        return /details\?id=|\/details\//i.test(route());
    }

    function pageKind() {
        const value = lowerRoute();
        if (value === '#/home' || value.startsWith('#/home?')) return 'home';
        if (value.startsWith('#/search')) return 'search';
        if (isDetails()) return 'details';
        if (/livetv|tvguide|recordings|scheduled/i.test(value)) return 'live';
        if (/\/movies|\/tv|\/collections|topparentid|collectiontype=/i.test(value)) return 'library';
        return 'other';
    }

    function isViewerRoute() {
        return !isAdminRoute() && !isPlayback();
    }

    function currentDetailsId() {
        const match = route().match(/[?&]id=([^&]+)/i) || route().match(/\/details\/([^?&/]+)/i);
        return match && match[1] ? decodeURIComponent(match[1]) : '';
    }

    function api() {
        return window.ApiClient || null;
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

    function storageGet(key) {
        try { return sessionStorage.getItem(CACHE_PREFIX + key); } catch (error) { return null; }
    }

    function storageSet(key, value) {
        try { sessionStorage.setItem(CACHE_PREFIX + key, String(value)); } catch (error) { /* optional */ }
    }

    function safeJson(value) {
        if (!value) return null;
        try { return JSON.parse(value); } catch (error) { return null; }
    }

    function idFromHref(href) {
        if (!href) return '';
        const match = String(href).match(/[?&]id=([^&]+)/i) || String(href).match(/details\?id=([^&]+)/i);
        return match && match[1] ? decodeURIComponent(match[1]) : '';
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

    function cardType(card) {
        if (!card) return '';
        const nodes = [card, card.querySelector('[data-type]'), card.closest('[data-type]')].filter(Boolean);
        for (const node of nodes) {
            const value = node.getAttribute('data-type') || (node.dataset && node.dataset.type);
            if (value) return value;
        }
        return '';
    }

    function cardServerId(card) {
        if (!card) return serverId();
        const nodes = [card, card.querySelector('[data-serverid]'), card.closest('[data-serverid]')].filter(Boolean);
        for (const node of nodes) {
            const value = node.getAttribute('data-serverid') || (node.dataset && node.dataset.serverid);
            if (value) return value;
        }
        return serverId();
    }

    function cardTitle(card) {
        if (!card) return '';
        const selectors = ['.cardText-first', '.cardText', '.itemName', '[title]'];
        for (const selector of selectors) {
            const el = card.querySelector(selector);
            if (!el) continue;
            const value = ((el.textContent || el.getAttribute('title') || '') + '').trim();
            if (value) return value;
        }
        return (card.getAttribute('aria-label') || card.getAttribute('title') || '').trim();
    }

    function cardSecondary(card) {
        if (!card) return '';
        const values = Array.from(card.querySelectorAll('.cardText')).map(text).filter(Boolean);
        return values.length > 1 ? values.slice(1, 3).join('  •  ') : '';
    }

    function cardImage(card) {
        if (!card) return '';
        const image = card.querySelector('img');
        if (image && image.src) return image.src;
        for (const el of card.querySelectorAll('.cardImage, .cardImageContainer, .cardContent')) {
            const bg = window.getComputedStyle(el).backgroundImage;
            const match = bg && bg.match(/url\(["']?(.*?)["']?\)/i);
            if (match && match[1]) return match[1];
        }
        return '';
    }

    function cardHref(card) {
        if (!card) return '';
        const link = card.closest('a[href]') || card.querySelector('a[href]');
        if (link) return link.getAttribute('href') || '';
        const content = card.querySelector('[data-href]');
        return content ? (content.getAttribute('data-href') || '') : '';
    }

    function sectionHeading(section) {
        return text(section && section.querySelector('.sectionTitle-cards, .sectionTitle, h2, h3'));
    }

    function findSection(regexes) {
        return Array.from(document.querySelectorAll('.verticalSection')).find(section => {
            const heading = sectionHeading(section);
            return regexes.some(regex => regex.test(heading));
        }) || null;
    }

    function visibleMediaCards(section) {
        if (!section) return [];
        return Array.from(section.querySelectorAll('.card')).filter(card => {
            if (card.offsetParent === null) return false;
            if (card.closest('#' + IDS.hero)) return false;
            const title = normalise(cardTitle(card));
            if (!title || ['movies', 'shows', 'series', 'collections', 'anime', 'music', 'books'].includes(title)) return false;
            return Boolean(cardItemId(card) || cardHref(card) || cardImage(card));
        });
    }

    function formatRuntime(ticks) {
        if (!ticks || !Number.isFinite(Number(ticks))) return '';
        const mins = Math.round(Number(ticks) / 600000000);
        if (mins < 60) return mins + ' min';
        const hours = Math.floor(mins / 60);
        const remaining = mins % 60;
        return remaining ? hours + 'h ' + remaining + 'm' : hours + 'h';
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

    async function resolveAdmin() {
        if (STATE.adminResolved) return STATE.admin;
        const client = api();
        if (!client || typeof client.getCurrentUser !== 'function') return false;
        try {
            const user = await client.getCurrentUser();
            STATE.admin = Boolean(user && user.Policy && user.Policy.IsAdministrator);
            STATE.adminResolved = true;
            document.body && document.body.classList.toggle('va20-admin', STATE.admin);
            scheduleRender(0);
            return STATE.admin;
        } catch (error) {
            return false;
        }
    }

    function setPageClass() {
        const body = document.body;
        if (!body) return;
        PAGE_CLASSES.forEach(cls => body.classList.remove(cls));
        body.classList.remove('va20-viewer', 'va20-player-active');
        body.removeAttribute('data-va20-version');

        if (!isViewerRoute()) {
            body.classList.toggle('va20-player-active', isPlayback());
            return;
        }

        body.classList.add('va20-viewer', 'va20-page-' + pageKind());
        body.setAttribute('data-va20-version', VERSION);
        body.classList.toggle('va20-metadata-mode', STATE.metadataMode && pageKind() === 'library');
    }

    function findMyMediaSection() {
        return Array.from(document.querySelectorAll('.verticalSection')).find(section => /^my media$/i.test(sectionHeading(section))) || null;
    }

    function findLibraryCard(patterns) {
        const scope = findMyMediaSection() || document;
        return Array.from(scope.querySelectorAll('.card')).find(card => patterns.some(pattern => pattern.test(cardTitle(card)))) || null;
    }

    function captureLibraryRoutes() {
        const map = {
            movies: [/^movies$/i],
            series: [/^shows$/i, /^series$/i],
            anime: [/^anime$/i],
            collections: [/^collections$/i],
            live: [/^live tv$/i, /^livetv$/i, /^live$/i]
        };

        Object.keys(map).forEach(kind => {
            const card = findLibraryCard(map[kind]);
            const href = cardHref(card);
            if (href) storageSet('route:' + kind, href);
        });

        const liveLink = document.querySelector('a[href*="livetv" i], a[href*="tvguide" i]');
        if (liveLink) storageSet('route:live', liveLink.getAttribute('href') || '');
    }

    function hasLibrary(kind) {
        if (storageGet('route:' + kind)) return true;
        const patterns = {
            movies: [/^movies$/i],
            series: [/^shows$/i, /^series$/i],
            anime: [/^anime$/i],
            collections: [/^collections$/i],
            live: [/^live tv$/i, /^livetv$/i, /^live$/i]
        };
        if (kind === 'live' && document.querySelector('a[href*="livetv" i], a[href*="tvguide" i]')) return true;
        return Boolean(findLibraryCard(patterns[kind] || []));
    }

    function navigateHref(href) {
        if (!href) return false;
        if (href.charAt(0) === '#') {
            window.location.hash = href.slice(1);
            return true;
        }
        if (href.includes('#/')) {
            window.location.hash = href.slice(href.indexOf('#') + 1);
            return true;
        }
        window.location.href = href;
        return true;
    }

    function navigateLibrary(kind) {
        const cached = storageGet('route:' + kind);
        if (cached && navigateHref(cached)) return;

        const patterns = {
            movies: [/^movies$/i],
            series: [/^shows$/i, /^series$/i],
            anime: [/^anime$/i],
            collections: [/^collections$/i],
            live: [/^live tv$/i, /^livetv$/i, /^live$/i]
        };
        const card = findLibraryCard(patterns[kind] || []);
        const href = cardHref(card);
        if (href) navigateHref(href);
    }

    function activeNavKind() {
        const kind = pageKind();
        const value = lowerRoute();
        if (kind === 'home') return 'home';
        if (kind === 'search') return 'search';
        if (kind === 'live') return 'live';
        if (value.includes('collectiontype=movies') || value.startsWith('#/movies')) return 'movies';
        if (value.includes('collectiontype=tvshows') || value.startsWith('#/tv')) return 'series';
        if (value.includes('collection')) return 'collections';
        return '';
    }

    function makeMark() {
        const mark = document.createElement('span');
        mark.className = 'va20-mark';
        mark.setAttribute('aria-hidden', 'true');
        mark.innerHTML = '<i></i><i></i><i></i>';
        return mark;
    }

    function navButton(label, kind, callback) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'va20-nav__item';
        button.textContent = label;
        button.setAttribute('data-va20-kind', kind);
        button.classList.toggle('is-active', activeNavKind() === kind);
        button.addEventListener('click', callback);
        return button;
    }

    function openStockUtility(kind) {
        const selectors = kind === 'search'
            ? ['.headerSearchButton', '[aria-label="Search"]', '[title="Search"]']
            : ['.headerUserButton', '.headerUserButtonRound', '[aria-label*="profile" i]', '[title*="profile" i]'];
        for (const selector of selectors) {
            const el = document.querySelector(selector);
            if (el && typeof el.click === 'function') {
                el.click();
                return;
            }
        }
        if (kind === 'search') window.location.hash = '#/search';
    }

    function createNav() {
        const nav = document.createElement('nav');
        nav.id = IDS.nav;
        nav.className = 'va20-nav';
        nav.setAttribute('aria-label', 'Velvet Antenna navigation');

        const brand = document.createElement('button');
        brand.type = 'button';
        brand.className = 'va20-nav__brand';
        brand.title = 'Velvet Antenna v' + VERSION;
        brand.appendChild(makeMark());
        const word = document.createElement('span');
        word.className = 'va20-nav__wordmark';
        word.textContent = 'VELVET ANTENNA';
        brand.appendChild(word);
        brand.addEventListener('click', function () { window.location.hash = '#/home'; });

        const primary = document.createElement('div');
        primary.className = 'va20-nav__primary';
        primary.appendChild(navButton('HOME', 'home', function () { window.location.hash = '#/home'; }));
        if (hasLibrary('movies')) primary.appendChild(navButton('MOVIES', 'movies', function () { navigateLibrary('movies'); }));
        if (hasLibrary('series')) primary.appendChild(navButton('SERIES', 'series', function () { navigateLibrary('series'); }));
        if (hasLibrary('anime')) primary.appendChild(navButton('ANIME', 'anime', function () { navigateLibrary('anime'); }));
        if (hasLibrary('live')) primary.appendChild(navButton('LIVE', 'live', function () { navigateLibrary('live'); }));
        if (hasLibrary('collections')) primary.appendChild(navButton('COLLECTIONS', 'collections', function () { navigateLibrary('collections'); }));

        const utility = document.createElement('div');
        utility.className = 'va20-nav__utility';
        utility.appendChild(navButton('SEARCH', 'search', function () { openStockUtility('search'); }));
        utility.appendChild(navButton('PROFILE', 'profile', function () { openStockUtility('profile'); }));

        nav.appendChild(brand);
        nav.appendChild(primary);
        nav.appendChild(utility);
        return nav;
    }

    function mountNav() {
        const existing = document.getElementById(IDS.nav);
        if (!isViewerRoute()) {
            if (existing) existing.remove();
            return;
        }
        if (!existing && document.body) document.body.insertBefore(createNav(), document.body.firstChild);
        const nav = document.getElementById(IDS.nav);
        if (nav) {
            nav.querySelectorAll('[data-va20-kind]').forEach(button => {
                button.classList.toggle('is-active', button.getAttribute('data-va20-kind') === activeNavKind());
            });
        }
    }

    function heroPool() {
        const resume = visibleMediaCards(findSection([/continue watching/i, /resume/i]));
        if (resume.length) return { cards: resume.slice(0, 8), source: 'CONTINUE WATCHING' };

        const next = visibleMediaCards(findSection([/next up/i]));
        if (next.length) return { cards: next.slice(0, 8), source: 'NEXT UP' };

        const movies = visibleMediaCards(findSection([/recently added.*movies/i, /latest.*movies/i]));
        if (movies.length) return { cards: movies.slice(0, 8), source: 'FEATURED FOR YOU' };

        const series = visibleMediaCards(findSection([/recently added.*series/i, /recently added.*shows/i]));
        if (series.length) return { cards: series.slice(0, 8), source: 'FEATURED FOR YOU' };

        return { cards: [], source: 'FEATURED FOR YOU' };
    }

    function heroPoolSignature(pool) {
        return pool.cards.map(card => cardItemId(card) || cardTitle(card)).filter(Boolean).join('|');
    }

    function clearHeroTimer() {
        if (STATE.heroTimer) window.clearTimeout(STATE.heroTimer);
        STATE.heroTimer = null;
    }

    function resetHeroState() {
        clearHeroTimer();
        STATE.heroStart = 0;
        STATE.heroSignature = '';
        STATE.heroSignatureSince = 0;
        STATE.heroLock = null;
        STATE.heroFetchToken += 1;
        const hero = document.getElementById(IDS.hero);
        if (hero) hero.remove();
    }

    function maybeStartHeroSettle() {
        if (pageKind() !== 'home' || STATE.heroLock || STATE.heroTimer) return;
        if (!STATE.heroStart) STATE.heroStart = Date.now();
        STATE.heroTimer = window.setTimeout(sampleHeroPool, 180);
    }

    function sampleHeroPool() {
        STATE.heroTimer = null;
        if (pageKind() !== 'home' || STATE.heroLock) return;

        const pool = heroPool();
        const signature = heroPoolSignature(pool);
        const now = Date.now();

        if (!signature) {
            if (now - STATE.heroStart < HERO_SETTLE_MAX_MS) {
                STATE.heroTimer = window.setTimeout(sampleHeroPool, 220);
            }
            return;
        }

        if (signature !== STATE.heroSignature) {
            STATE.heroSignature = signature;
            STATE.heroSignatureSince = now;
        }

        const stableFor = now - STATE.heroSignatureSince;
        const total = now - STATE.heroStart;
        if (stableFor >= HERO_SETTLE_STABLE_MS || total >= HERO_SETTLE_MAX_MS) {
            lockHero(pool);
            return;
        }

        STATE.heroTimer = window.setTimeout(sampleHeroPool, 180);
    }

    function lockHero(pool) {
        if (!pool || !pool.cards.length || STATE.heroLock) return;
        const card = pool.cards[0];
        const id = cardItemId(card);
        if (!id) return;

        STATE.heroLock = {
            id: id,
            title: cardTitle(card) || 'Featured',
            meta: cardSecondary(card) || '',
            source: pool.source,
            fallbackImage: cardImage(card) || '',
            type: cardType(card) || ''
        };
        mountHero();
        enrichHero(STATE.heroLock);
    }

    function createHero(lock) {
        const hero = document.createElement('section');
        hero.id = IDS.hero;
        hero.className = 'va20-hero';
        hero.setAttribute('data-item-id', lock.id);
        hero.setAttribute('data-item-type', lock.type || '');
        hero.innerHTML = `
            <div class="va20-hero__art va20-hero__art--fallback" aria-hidden="true"></div>
            <div class="va20-hero__art va20-hero__art--backdrop" aria-hidden="true"></div>
            <div class="va20-hero__shade" aria-hidden="true"></div>
            <div class="va20-hero__content">
                <div class="va20-kicker va20-hero__eyebrow"></div>
                <h1 class="va20-hero__title"></h1>
                <div class="va20-hero__meta"></div>
                <div class="va20-hero__badges"></div>
                <p class="va20-hero__overview"></p>
                <div class="va20-hero__progress" hidden><span></span><div><i></i></div></div>
                <div class="va20-hero__actions">
                    <button type="button" class="va20-button va20-button--primary" data-va20-action="play"><span>▶</span><b>PLAY</b></button>
                    <button type="button" class="va20-button va20-button--secondary" data-va20-action="details">MORE INFO</button>
                </div>
            </div>
        `;
        hero.querySelector('.va20-hero__eyebrow').textContent = lock.source;
        hero.querySelector('.va20-hero__title').textContent = lock.title;
        hero.querySelector('.va20-hero__meta').textContent = lock.meta;
        hero.querySelector('.va20-hero__overview').textContent = 'Featured from your library.';
        if (lock.fallbackImage) {
            hero.style.setProperty('--va20-hero-fallback', 'url("' + lock.fallbackImage.replace(/"/g, '%22') + '")');
            hero.classList.add('has-fallback');
        }
        return hero;
    }

    function homeContainer() {
        return document.querySelector('.homeSectionsContainer') ||
            document.querySelector('.page.homePage') ||
            document.querySelector('#indexPage') ||
            document.querySelector('.libraryPage');
    }

    function mountHero() {
        if (pageKind() !== 'home' || !STATE.heroLock) return;
        let hero = document.getElementById(IDS.hero);
        if (hero && hero.getAttribute('data-item-id') === STATE.heroLock.id) return;
        if (hero) hero.remove();
        const container = homeContainer();
        if (!container) return;
        hero = createHero(STATE.heroLock);
        container.insertBefore(hero, container.firstChild);
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
            const range = [video.VideoRange, video.VideoRangeType, video.Hdr10PlusPresent ? 'HDR10+' : '', video.DvVersionMajor ? 'DOLBY VISION' : '']
                .filter(Boolean).join(' ').toUpperCase();
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

    function preloadHeroBackdrop(hero, url, itemId) {
        if (!hero || !url) return;
        const image = new Image();
        image.decoding = 'async';
        image.onload = function () {
            if (!hero.isConnected || !STATE.heroLock || STATE.heroLock.id !== itemId) return;
            hero.style.setProperty('--va20-hero-backdrop', 'url("' + url.replace(/"/g, '%22') + '")');
            hero.classList.add('backdrop-ready');
        };
        image.src = url;
    }

    async function enrichHero(lock) {
        const client = api();
        if (!client || !lock || typeof client.getItem !== 'function' || typeof client.getCurrentUserId !== 'function') return;
        const token = ++STATE.heroFetchToken;
        try {
            const item = await client.getItem(client.getCurrentUserId(), lock.id);
            if (token !== STATE.heroFetchToken || !STATE.heroLock || STATE.heroLock.id !== lock.id) return;
            const hero = document.getElementById(IDS.hero);
            if (!hero) return;

            lock.type = item.Type || lock.type || '';
            hero.setAttribute('data-item-type', lock.type);
            hero.querySelector('.va20-hero__title').textContent = item.Name || lock.title;

            const meta = [];
            if (item.ProductionYear) meta.push(String(item.ProductionYear));
            const runtime = formatRuntime(item.RunTimeTicks);
            if (runtime) meta.push(runtime);
            if (item.OfficialRating) meta.push(item.OfficialRating);
            if (item.CommunityRating) meta.push('★ ' + Number(item.CommunityRating).toFixed(1));
            hero.querySelector('.va20-hero__meta').textContent = meta.join('  •  ') || lock.meta;

            const overview = (item.Overview || '').trim();
            if (overview) hero.querySelector('.va20-hero__overview').textContent = overview;

            const badges = mediaBadges(item);
            const badgesEl = hero.querySelector('.va20-hero__badges');
            badgesEl.innerHTML = badges.map(value => '<span>' + value + '</span>').join('');
            badgesEl.hidden = !badges.length;

            const play = hero.querySelector('[data-va20-action="play"] b');
            const userData = item.UserData || {};
            if (/Series/i.test(lock.type)) play.textContent = 'VIEW SERIES';
            else if (/Season/i.test(lock.type)) play.textContent = 'VIEW SEASON';
            else if (userData.PlaybackPositionTicks > 0 && !userData.Played) play.textContent = 'CONTINUE';
            else play.textContent = 'PLAY';

            const progress = hero.querySelector('.va20-hero__progress');
            if (userData.PlaybackPositionTicks > 0 && item.RunTimeTicks > 0 && !userData.Played) {
                const pct = Math.max(0, Math.min(100, (userData.PlaybackPositionTicks / item.RunTimeTicks) * 100));
                const remaining = Math.max(0, item.RunTimeTicks - userData.PlaybackPositionTicks);
                progress.querySelector('span').textContent = formatRuntime(remaining) + ' left';
                progress.querySelector('i').style.width = pct + '%';
                progress.hidden = false;
            } else {
                progress.hidden = true;
            }

            let backdrop = '';
            if (Array.isArray(item.BackdropImageTags) && item.BackdropImageTags.length) {
                backdrop = imageUrl(client, item.Id || lock.id, 'Backdrop', item.BackdropImageTags[0], 1800);
            } else if (item.ParentBackdropItemId && Array.isArray(item.ParentBackdropImageTags) && item.ParentBackdropImageTags.length) {
                backdrop = imageUrl(client, item.ParentBackdropItemId, 'Backdrop', item.ParentBackdropImageTags[0], 1800);
            }
            if (backdrop) preloadHeroBackdrop(hero, backdrop, lock.id);
        } catch (error) {
            console.debug('[Velvet Antenna v0.20] hero enrichment failed', error);
        }
    }

    function decorateHomeRows() {
        if (pageKind() !== 'home') return;
        document.querySelectorAll('.verticalSection').forEach(section => {
            const heading = sectionHeading(section);
            section.classList.remove('va20-row-landscape', 'va20-row-posters', 'va20-row-wide');
            if (/continue watching|next up/i.test(heading)) section.classList.add('va20-row-landscape');
            else if (/recently added.*movie|recently added.*series|recently added.*shows|anime/i.test(heading)) section.classList.add('va20-row-posters');
            else if (/collection/i.test(heading)) section.classList.add('va20-row-wide');

            const titleEl = section.querySelector('.sectionTitle-cards, .sectionTitle, h2, h3');
            if (titleEl && /recently added.*shows/i.test(text(titleEl))) titleEl.textContent = 'Recently Added Series';
        });
        const myMedia = findMyMediaSection();
        if (myMedia) myMedia.classList.add('va20-my-media-source');
    }

    function libraryKind() {
        const value = lowerRoute();
        if (value.includes('collectiontype=movies') || value.startsWith('#/movies')) return 'movies';
        if (value.includes('collectiontype=tvshows') || value.startsWith('#/tv')) return 'series';
        if (value.includes('collection')) return 'collections';
        const active = document.querySelector('#' + IDS.nav + ' .is-active');
        const kind = active && active.getAttribute('data-va20-kind');
        return kind || 'library';
    }

    function libraryCopy(kind) {
        return {
            movies: ['MOVIES', 'Your film library, without the clutter.'],
            series: ['SERIES', 'Series, seasons and episodes with Jellyfin functionality intact.'],
            anime: ['ANIME', 'Series, films, specials and everything in between.'],
            collections: ['COLLECTIONS', 'Curated worlds and franchises from your library.'],
            library: ['LIBRARY', 'Browse everything available to you.']
        }[kind] || ['LIBRARY', 'Browse everything available to you.'];
    }

    function toggleMetadataMode() {
        STATE.metadataMode = !STATE.metadataMode;
        document.body && document.body.classList.toggle('va20-metadata-mode', STATE.metadataMode);
        const button = document.querySelector('#' + IDS.libraryIntro + ' [data-va20-action="metadata-mode"]');
        if (button) button.textContent = STATE.metadataMode ? 'DONE' : 'MANAGE METADATA';
    }

    function mountLibraryIntro() {
        const existing = document.getElementById(IDS.libraryIntro);
        if (pageKind() !== 'library') {
            if (existing) existing.remove();
            return;
        }

        const page = Array.from(document.querySelectorAll('.libraryPage, .page')).find(el => el.offsetParent !== null) || document.querySelector('.libraryPage, .page');
        if (!page) return;

        const kind = libraryKind();
        const data = libraryCopy(kind);
        let intro = existing;
        if (!intro) {
            intro = document.createElement('section');
            intro.id = IDS.libraryIntro;
            intro.className = 'va20-library-intro';
            intro.innerHTML = '<div><div class="va20-kicker">VELVET ANTENNA</div><h1></h1><p></p></div><div class="va20-library-intro__tools"></div>';
            page.insertBefore(intro, page.firstChild);
        }
        intro.setAttribute('data-kind', kind);
        intro.querySelector('h1').textContent = data[0];
        intro.querySelector('p').textContent = data[1];

        const tools = intro.querySelector('.va20-library-intro__tools');
        if (STATE.admin && !tools.querySelector('[data-va20-action="metadata-mode"]')) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'va20-button va20-button--quiet';
            button.setAttribute('data-va20-action', 'metadata-mode');
            button.textContent = STATE.metadataMode ? 'DONE' : 'MANAGE METADATA';
            button.addEventListener('click', toggleMetadataMode);
            tools.appendChild(button);
        }
    }

    function makeNativeEditButton(card) {
        const id = cardItemId(card);
        if (!id) return null;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'va20-edit-metadata itemAction';
        button.setAttribute('data-action', 'edit');
        button.setAttribute('data-id', id);
        button.setAttribute('data-serverid', cardServerId(card));
        button.setAttribute('data-type', cardType(card) || 'Movie');
        button.setAttribute('aria-label', 'Edit metadata for ' + (cardTitle(card) || 'item'));
        button.setAttribute('title', 'Edit metadata');
        button.innerHTML = '<span aria-hidden="true">✎</span><b>EDIT</b>';
        return button;
    }

    function decorateLibraryCards() {
        if (pageKind() !== 'library') return;
        document.querySelectorAll('.card').forEach(card => {
            if (card.closest('#' + IDS.libraryIntro)) return;
            card.classList.add('va20-library-card');
            if (STATE.admin && cardItemId(card) && !card.querySelector('.va20-edit-metadata')) {
                const button = makeNativeEditButton(card);
                if (button) card.appendChild(button);
            }
        });
    }

    function mountSearchIntro() {
        const existing = document.getElementById(IDS.searchIntro);
        if (pageKind() !== 'search') {
            if (existing) existing.remove();
            return;
        }
        if (existing) return;
        const input = document.querySelector('.searchInput, input[type="search"], input[placeholder*="search" i]');
        if (!input) return;
        const intro = document.createElement('section');
        intro.id = IDS.searchIntro;
        intro.className = 'va20-search-intro';
        intro.innerHTML = '<div class="va20-kicker">VELVET ANTENNA</div><h1>Search your world.</h1><p>Movies, series, episodes, collections and people.</p>';
        const host = input.closest('.searchFields') || input.closest('.inputContainer') || input.parentElement;
        if (host && host.parentElement) host.parentElement.insertBefore(intro, host);
    }

    function decorateSearch() {
        if (pageKind() !== 'search') return;
        document.querySelectorAll('.verticalSection').forEach(section => section.classList.add('va20-search-section'));
    }

    function mountDetailBrand() {
        const existing = document.getElementById(IDS.detailBrand);
        if (pageKind() !== 'details') {
            if (existing) existing.remove();
            return;
        }
        if (existing) return;
        const title = document.querySelector('.itemName, .detailPagePrimaryContent h1, .detailPagePrimaryContainer h1');
        if (!title || !title.parentElement) return;
        const brand = document.createElement('div');
        brand.id = IDS.detailBrand;
        brand.className = 'va20-kicker va20-detail-brand';
        brand.textContent = 'VELVET ANTENNA';
        title.parentElement.insertBefore(brand, title);
    }

    function makeDetailEditButton() {
        const id = currentDetailsId();
        if (!id) return null;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'emby-button button-flat va20-detail-edit itemAction';
        button.setAttribute('data-action', 'edit');
        button.setAttribute('data-id', id);
        button.setAttribute('data-serverid', serverId());
        button.setAttribute('data-type', 'Movie');
        button.title = 'Edit metadata';
        button.innerHTML = '<span>✎</span><span>EDIT METADATA</span>';
        return button;
    }

    function decorateDetails() {
        if (pageKind() !== 'details') return;
        document.querySelectorAll('.peopleItems .card, .castContent .card').forEach(card => card.classList.add('va20-cast-card'));
        document.querySelectorAll('.childrenItemsContainer .card, .episodeCard, #listChildrenCollapsible .listItem').forEach(card => card.classList.add('va20-episode-card'));
        const actions = document.querySelector('.mainDetailButtons, .detailPagePrimaryContainer .mainDetailButtons');
        if (STATE.admin && actions && !actions.querySelector('.va20-detail-edit')) {
            const edit = makeDetailEditButton();
            if (edit) actions.appendChild(edit);
        }
    }

    function decorateLive() {
        if (pageKind() !== 'live') return;
        document.querySelectorAll('.programCell, .guideProgram, .channelProgram').forEach(el => el.classList.add('va20-live-program'));
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
        try { sessionStorage.setItem(PENDING_PLAY_KEY, JSON.stringify({ id: itemId, created: Date.now() })); } catch (error) { /* optional */ }
        STATE.playAttempts = 0;
    }

    function clearPlayTimer() {
        if (STATE.playTimer) window.clearTimeout(STATE.playTimer);
        STATE.playTimer = null;
    }

    function tryPendingPlay() {
        clearPlayTimer();
        if (!isDetails()) return false;
        let pending = null;
        try { pending = safeJson(sessionStorage.getItem(PENDING_PLAY_KEY)); } catch (error) { pending = null; }
        if (!pending || !pending.id) return false;
        if (Date.now() - Number(pending.created || 0) > PLAY_TTL_MS) {
            try { sessionStorage.removeItem(PENDING_PLAY_KEY); } catch (error) { /* optional */ }
            return false;
        }
        const current = currentDetailsId();
        if (!current || current !== pending.id) return false;
        const button = genuineLocalPlayButton();
        if (button) {
            try { sessionStorage.removeItem(PENDING_PLAY_KEY); } catch (error) { /* optional */ }
            button.click();
            return true;
        }
        STATE.playAttempts += 1;
        if (STATE.playAttempts < MAX_PLAY_ATTEMPTS) {
            STATE.playTimer = window.setTimeout(tryPendingPlay, PLAY_RETRY_MS);
        } else {
            try { sessionStorage.removeItem(PENDING_PLAY_KEY); } catch (error) { /* optional */ }
        }
        return false;
    }

    function stopEvent(event) {
        event.preventDefault();
        event.stopPropagation();
        if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
    }

    function isInteractive(target) {
        return Boolean(target.closest('button, a, input, select, textarea, [role="button"], .paper-icon-button-light, .cardOverlayButton'));
    }

    function captureClicks(event) {
        const target = event.target;
        if (!target || typeof target.closest !== 'function') return;

        if (target.closest('.va20-edit-metadata, .va20-detail-edit')) {
            // Leave Jellyfin's native ItemAction.Edit handler in control.
            return;
        }

        const hero = target.closest('#' + IDS.hero);
        if (hero) {
            const action = target.closest('[data-va20-action]');
            if (!action || !STATE.heroLock) return;
            const kind = action.getAttribute('data-va20-action');
            stopEvent(event);
            if (kind === 'details') {
                navigateDetails(STATE.heroLock.id);
                return;
            }
            if (kind === 'play') {
                if (/^(Movie|Episode|Video|Audio)$/i.test(STATE.heroLock.type || '')) {
                    queuePlay(STATE.heroLock.id);
                    navigateDetails(STATE.heroLock.id);
                } else {
                    // Unknown and container types open details rather than guessing playback.
                    navigateDetails(STATE.heroLock.id);
                }
            }
            return;
        }

        if (pageKind() === 'library') {
            const card = target.closest('.card');
            if (card && !isInteractive(target)) {
                const id = cardItemId(card);
                if (id) {
                    stopEvent(event);
                    navigateDetails(id);
                }
            }
        }
    }

    function clearOffRouteArtifacts() {
        if (pageKind() !== 'home') {
            const hero = document.getElementById(IDS.hero);
            if (hero) hero.remove();
        }
        if (pageKind() !== 'library') {
            const intro = document.getElementById(IDS.libraryIntro);
            if (intro) intro.remove();
            STATE.metadataMode = false;
            document.body && document.body.classList.remove('va20-metadata-mode');
        }
        if (pageKind() !== 'search') {
            const intro = document.getElementById(IDS.searchIntro);
            if (intro) intro.remove();
        }
        if (pageKind() !== 'details') {
            const brand = document.getElementById(IDS.detailBrand);
            if (brand) brand.remove();
        }
    }

    function render() {
        setPageClass();
        clearOffRouteArtifacts();
        if (!isViewerRoute()) {
            mountNav();
            return;
        }

        captureLibraryRoutes();
        mountNav();
        resolveAdmin();

        if (pageKind() === 'home') {
            decorateHomeRows();
            if (STATE.heroLock) mountHero();
            else maybeStartHeroSettle();
        }

        mountLibraryIntro();
        decorateLibraryCards();
        mountSearchIntro();
        decorateSearch();
        mountDetailBrand();
        decorateDetails();
        decorateLive();
    }

    function scheduleRender(delay) {
        clearTimeout(STATE.renderTimer);
        STATE.renderTimer = window.setTimeout(render, typeof delay === 'number' ? delay : 120);
    }

    function routeChanged() {
        const now = route();
        if (now !== STATE.lastRoute) {
            const wasHome = STATE.lastRoute === '#/home' || STATE.lastRoute.startsWith('#/home?');
            const isHome = now === '#/home' || now.startsWith('#/home?');
            if (wasHome || isHome) resetHeroState();
            clearPlayTimer();
            STATE.playAttempts = 0;
            STATE.lastRoute = now;
            if (isDetails()) window.setTimeout(tryPendingPlay, 100);
        }
        scheduleRender(70);
    }

    function removeLegacyArtifactsOnce() {
        [
            '#va-global-nav',
            '#va-home-hero',
            '#va12-search-intro',
            '#va12-library-intro',
            '#va12-detail-hero',
            '#va14-library-subnav',
            '#va14-search-keyboard',
            '#va14-detail-extras'
        ].forEach(selector => {
            const el = document.querySelector(selector);
            if (el) el.remove();
        });
        if (document.body) {
            document.body.classList.remove('va15-hero-settling', 'va12-detail-ready', 'va17-tv-library-native-tabs');
        }
    }

    function start() {
        STATE.lastRoute = route();
        removeLegacyArtifactsOnce();

        window.addEventListener('click', captureClicks, true);
        window.addEventListener('hashchange', routeChanged);
        window.addEventListener('popstate', routeChanged);

        STATE.observer = new MutationObserver(function () {
            scheduleRender(140);
            if (pageKind() === 'home' && !STATE.heroLock) maybeStartHeroSettle();
        });
        STATE.observer.observe(document.documentElement, { childList: true, subtree: true });

        render();
        window.setTimeout(function () { scheduleRender(0); }, 500);
        window.setTimeout(function () { scheduleRender(0); }, 1300);
        if (isDetails()) window.setTimeout(tryPendingPlay, 100);

        console.log('[Velvet Antenna] v' + VERSION + ' standalone loaded');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start, { once: true });
    } else {
        start();
    }
})();
