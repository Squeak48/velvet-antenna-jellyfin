(function () {
    'use strict';

    const VERSION = '0.21.5';
    const CACHE_PREFIX = 'velvet-antenna-v021:';
    const PENDING_PLAY_KEY = CACHE_PREFIX + 'pending-local-play';
    const PLAY_TTL_MS = 15000;
    const PLAY_RETRY_MS = 150;
    const MAX_PLAY_ATTEMPTS = 40;
    const HERO_SETTLE_MAX_MS = 3200;
    const HERO_SETTLE_STABLE_MS = 550;
    const WORKBENCH_PAGE_SIZE = 60;
    const LIBRARY_BATCH_SIZE = 400;

    const IDS = {
        nav: 'va21-nav',
        hero: 'va21-home-hero',
        stage: 'va21-library-stage',
        search: 'va21-search-stage',
        detailBrand: 'va21-detail-brand',
        workbench: 'va21-workbench'
    };

    const PAGE_CLASSES = [
        'va21-page-home',
        'va21-page-library',
        'va21-page-search',
        'va21-page-details',
        'va21-page-live',
        'va21-page-other'
    ];

    const STATE = {
        route: '',
        timers: [],
        heroTimer: null,
        heroStarted: 0,
        heroSignature: '',
        heroSignatureSince: 0,
        heroLock: null,
        heroToken: 0,
        playTimer: null,
        playAttempts: 0,
        admin: false,
        adminResolved: false,
        stageId: '',
        stageToken: 0,
        stageHoverTimer: null,
        itemCache: new Map(),
        libraryIndexCache: new Map(),
        workbench: null,
        workbenchToken: 0
    };

    function route() { return window.location.hash || ''; }
    function lowerRoute() { return route().toLowerCase(); }
    function text(el) { return el ? (el.textContent || '').trim() : ''; }
    function normalise(value) { return String(value || '').trim().toLowerCase(); }

    function isAdminRoute() {
        return /dashboard|configurationpage|scheduledtasks|logs|networking|plugins|metadataeditor/i.test(route());
    }

    function isPlayback() {
        return /videoosd|nowplaying|playback/i.test(route()) ||
            Boolean(document.querySelector('.videoPlayerContainer:not(.hide), .videoOsdPage:not(.hide)'));
    }

    function isDetails() { return /details\?id=|\/details\//i.test(route()); }

    function pageKind() {
        const value = lowerRoute();
        if (value === '#/home' || value.startsWith('#/home?')) return 'home';
        if (value.startsWith('#/search')) return 'search';
        if (isDetails()) return 'details';
        if (/livetv|tvguide|recordings|scheduled/i.test(value)) return 'live';
        if (/\/movies|\/tv|\/collections|topparentid|collectiontype=/i.test(value)) return 'library';
        return 'other';
    }

    function isViewerRoute() { return !isAdminRoute() && !isPlayback(); }
    function api() { return window.ApiClient || null; }

    function serverId() {
        const client = api();
        if (!client) return '';
        try {
            if (typeof client.serverId === 'function') return client.serverId() || '';
            return client.serverId || client._serverId || '';
        } catch (error) { return ''; }
    }

    function userId() {
        const client = api();
        if (!client) return '';
        try { return typeof client.getCurrentUserId === 'function' ? (client.getCurrentUserId() || '') : ''; }
        catch (error) { return ''; }
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

    function currentDetailsId() {
        const match = route().match(/[?&]id=([^&]+)/i) || route().match(/\/details\/([^?&/]+)/i);
        return match && match[1] ? decodeURIComponent(match[1]) : '';
    }

    function libraryParentId() {
        const match = route().match(/[?&](?:topParentId|parentId)=([^&]+)/i);
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

    function goHome() { window.location.hash = '#/home'; }

    function goBack() {
        if (pageKind() === 'home') return;
        if (window.history.length > 1) window.history.back();
        else goHome();
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
                node.getAttribute('data-id') || node.getAttribute('data-itemid');
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

    function cardTitle(card) {
        if (!card) return '';
        const selectors = ['.cardText-first', '.cardText', '.itemName', '[title]'];
        for (const selector of selectors) {
            const el = card.querySelector(selector);
            if (!el) continue;
            const value = String(el.textContent || el.getAttribute('title') || '').trim();
            if (value) return value;
        }
        return (card.getAttribute('aria-label') || card.getAttribute('title') || '').trim();
    }

    function cardSecondary(card) {
        if (!card) return '';
        const values = Array.from(card.querySelectorAll('.cardText')).map(text).filter(Boolean);
        return values.length > 1 ? values.slice(1, 3).join(' • ') : '';
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
        return content ? content.getAttribute('data-href') || '' : '';
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
        const value = Number(ticks || 0);
        if (!value) return '';
        const mins = Math.round(value / 600000000);
        if (mins < 60) return mins + ' min';
        const hours = Math.floor(mins / 60);
        const remaining = mins % 60;
        return remaining ? hours + 'h ' + remaining + 'm' : hours + 'h';
    }

    function imageUrl(item, type, maxWidth) {
        const client = api();
        if (!client || !item || typeof client.getImageUrl !== 'function') return '';
        const tags = type === 'Backdrop' ? item.BackdropImageTags : (item.ImageTags && [item.ImageTags[type]]);
        const tag = tags && tags[0];
        if (!tag) return '';
        try {
            return client.getImageUrl(item.Id, { type, index: 0, tag, maxWidth: maxWidth || 1800, quality: 86 });
        } catch (error) { return ''; }
    }

    function parentBackdropUrl(item) {
        const client = api();
        if (!client || !item || !item.ParentBackdropItemId ||
            !Array.isArray(item.ParentBackdropImageTags) || !item.ParentBackdropImageTags.length ||
            typeof client.getImageUrl !== 'function') return '';
        try {
            return client.getImageUrl(item.ParentBackdropItemId, {
                type: 'Backdrop',
                index: 0,
                tag: item.ParentBackdropImageTags[0],
                maxWidth: 1800,
                quality: 86
            });
        } catch (error) { return ''; }
    }

    async function getItem(itemId, fields) {
        if (!itemId) return null;
        const key = itemId + '|' + (fields || 'default');
        if (STATE.itemCache.has(key)) return STATE.itemCache.get(key);
        const client = api();
        const uid = userId();
        if (!client || !uid) return null;

        let item = null;
        try {
            if (!fields && typeof client.getItem === 'function') {
                item = await client.getItem(uid, itemId);
            } else if (typeof client.getItems === 'function') {
                const result = await client.getItems(uid, {
                    Ids: itemId,
                    Fields: fields || 'ProviderIds,MediaSources,MediaStreams,Path',
                    EnableTotalRecordCount: false
                });
                item = result && result.Items && result.Items[0];
            }
        } catch (error) {
            console.debug('[Velvet Antenna] item fetch failed', itemId, error);
        }

        if (item) STATE.itemCache.set(key, item);
        return item;
    }

    async function resolveAdmin() {
        if (STATE.adminResolved) return STATE.admin;
        const client = api();
        if (!client || typeof client.getCurrentUser !== 'function') return false;
        try {
            const user = await client.getCurrentUser();
            STATE.admin = Boolean(user && user.Policy && user.Policy.IsAdministrator);
            STATE.adminResolved = true;
            document.body && document.body.classList.toggle('va21-admin', STATE.admin);
            scheduleRoutePasses();
            return STATE.admin;
        } catch (error) { return false; }
    }

    function setPageClass() {
        const body = document.body;
        if (!body) return;
        PAGE_CLASSES.forEach(cls => body.classList.remove(cls));
        body.classList.remove('va21-viewer', 'va21-player-active');
        body.removeAttribute('data-va21-version');

        if (!isViewerRoute()) {
            body.classList.toggle('va21-player-active', isPlayback());
            return;
        }

        body.classList.add('va21-viewer', 'va21-page-' + pageKind());
        body.setAttribute('data-va21-version', VERSION);
    }

    function findMyMediaSection() {
        return Array.from(document.querySelectorAll('.verticalSection'))
            .find(section => /^my media$/i.test(sectionHeading(section))) || null;
    }

    function findLibraryCard(patterns) {
        const scope = findMyMediaSection() || document;
        return Array.from(scope.querySelectorAll('.card'))
            .find(card => patterns.some(pattern => pattern.test(cardTitle(card)))) || null;
    }

    function captureLibraryRoutes() {
        if (pageKind() !== 'home') return;
        const map = {
            movies: [/^movies$/i],
            series: [/^shows$/i, /^series$/i],
            anime: [/^anime$/i],
            collections: [/^collections$/i],
            live: [/^live tv$/i, /^livetv$/i, /^live$/i]
        };
        Object.keys(map).forEach(kind => {
            if (storageGet('route:' + kind)) return;
            const card = findLibraryCard(map[kind]);
            const href = cardHref(card);
            if (href) storageSet('route:' + kind, href);
        });
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

    function mark() {
        const el = document.createElement('span');
        el.className = 'va21-mark';
        el.setAttribute('aria-hidden', 'true');
        el.innerHTML = '<i></i><i></i><i></i><i></i>';
        return el;
    }

    function navButton(label, kind, callback) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'va21-nav__item';
        button.textContent = label;
        button.setAttribute('data-va21-kind', kind);
        button.classList.toggle('is-active', activeNavKind() === kind);
        button.addEventListener('click', callback);
        return button;
    }

    function openProfile() {
        const selectors = [
            '.headerUserButton',
            '.headerUserButtonRound',
            '[aria-label*="profile" i]',
            '[title*="profile" i]'
        ];
        for (const selector of selectors) {
            const el = document.querySelector(selector);
            if (el && typeof el.click === 'function') {
                el.click();
                return;
            }
        }
    }

    function createNav() {
        const nav = document.createElement('nav');
        nav.id = IDS.nav;
        nav.className = 'va21-nav';
        nav.setAttribute('aria-label', 'Velvet Antenna');

        const identity = document.createElement('div');
        identity.className = 'va21-nav__identity';

        const back = document.createElement('button');
        back.type = 'button';
        back.className = 'va21-nav__back';
        back.setAttribute('aria-label', 'Back');
        back.title = 'Back';
        back.innerHTML = '<span aria-hidden="true">←</span>';
        back.addEventListener('click', goBack);

        const brand = document.createElement('button');
        brand.type = 'button';
        brand.className = 'va21-nav__brand';
        brand.title = 'Velvet Antenna v' + VERSION;
        brand.appendChild(mark());
        const wordmark = document.createElement('span');
        wordmark.className = 'va21-nav__wordmark';
        wordmark.textContent = 'VELVET ANTENNA';
        brand.appendChild(wordmark);
        brand.addEventListener('click', goHome);

        identity.appendChild(back);
        identity.appendChild(brand);

        const primary = document.createElement('div');
        primary.className = 'va21-nav__primary';
        primary.appendChild(navButton('HOME', 'home', goHome));
        if (hasLibrary('movies')) primary.appendChild(navButton('MOVIES', 'movies', () => navigateLibrary('movies')));
        if (hasLibrary('series')) primary.appendChild(navButton('SERIES', 'series', () => navigateLibrary('series')));
        if (hasLibrary('anime')) primary.appendChild(navButton('ANIME', 'anime', () => navigateLibrary('anime')));
        if (hasLibrary('live')) primary.appendChild(navButton('LIVE', 'live', () => navigateLibrary('live')));
        if (hasLibrary('collections')) primary.appendChild(navButton('COLLECTIONS', 'collections', () => navigateLibrary('collections')));

        const utility = document.createElement('div');
        utility.className = 'va21-nav__utility';
        utility.appendChild(navButton('SEARCH', 'search', () => window.location.hash = '#/search'));
        utility.appendChild(navButton('PROFILE', 'profile', openProfile));

        nav.appendChild(identity);
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
        if (!nav) return;
        nav.querySelectorAll('[data-va21-kind]').forEach(button => {
            button.classList.toggle('is-active', button.getAttribute('data-va21-kind') === activeNavKind());
        });
        const back = nav.querySelector('.va21-nav__back');
        if (back) back.disabled = pageKind() === 'home';
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

    function heroSignature(pool) {
        return pool.cards.map(card => cardItemId(card) || cardTitle(card)).filter(Boolean).join('|');
    }

    function resetHero() {
        if (STATE.heroTimer) window.clearTimeout(STATE.heroTimer);
        STATE.heroTimer = null;
        STATE.heroStarted = 0;
        STATE.heroSignature = '';
        STATE.heroSignatureSince = 0;
        STATE.heroLock = null;
        STATE.heroToken += 1;
        document.getElementById(IDS.hero)?.remove();
    }

    function maybeStartHero() {
        if (pageKind() !== 'home' || STATE.heroLock || STATE.heroTimer) return;
        if (!STATE.heroStarted) STATE.heroStarted = Date.now();
        STATE.heroTimer = window.setTimeout(sampleHero, 180);
    }

    function sampleHero() {
        STATE.heroTimer = null;
        if (pageKind() !== 'home' || STATE.heroLock) return;
        const pool = heroPool();
        const signature = heroSignature(pool);
        const now = Date.now();

        if (!signature) {
            if (now - STATE.heroStarted < HERO_SETTLE_MAX_MS) {
                STATE.heroTimer = window.setTimeout(sampleHero, 240);
            }
            return;
        }

        if (signature !== STATE.heroSignature) {
            STATE.heroSignature = signature;
            STATE.heroSignatureSince = now;
        }

        if (now - STATE.heroSignatureSince >= HERO_SETTLE_STABLE_MS ||
            now - STATE.heroStarted >= HERO_SETTLE_MAX_MS) {
            lockHero(pool);
            return;
        }

        STATE.heroTimer = window.setTimeout(sampleHero, 180);
    }

    function lockHero(pool) {
        if (!pool.cards.length || STATE.heroLock) return;
        const card = pool.cards[0];
        const id = cardItemId(card);
        if (!id) return;

        STATE.heroLock = {
            id,
            title: cardTitle(card) || 'Featured',
            meta: cardSecondary(card),
            source: pool.source,
            fallbackImage: cardImage(card),
            type: cardType(card)
        };
        mountHero();
        enrichHero(STATE.heroLock);
    }

    function homeContainer() {
        return document.querySelector('.homeSectionsContainer') ||
            document.querySelector('.page.homePage') ||
            document.querySelector('#indexPage') ||
            document.querySelector('.libraryPage');
    }

    function createHero(lock) {
        const hero = document.createElement('section');
        hero.id = IDS.hero;
        hero.className = 'va21-hero';
        hero.setAttribute('data-item-id', lock.id);
        hero.innerHTML = `
            <div class="va21-hero__signal" aria-hidden="true"><i></i><i></i><i></i></div>
            <div class="va21-hero__art va21-hero__art--fallback" aria-hidden="true"></div>
            <div class="va21-hero__art va21-hero__art--backdrop" aria-hidden="true"></div>
            <div class="va21-hero__shade" aria-hidden="true"></div>
            <div class="va21-hero__content">
                <div class="va21-kicker"><span>VA / SIGNAL 01</span><b class="va21-hero__eyebrow"></b></div>
                <h1 class="va21-hero__title"></h1>
                <div class="va21-hero__meta"></div>
                <p class="va21-hero__overview">Featured from your library.</p>
                <div class="va21-hero__progress" hidden><span></span><div><i></i></div></div>
                <div class="va21-hero__actions">
                    <button type="button" class="va21-button va21-button--primary" data-va21-action="play"><span>▶</span><b>PLAY</b></button>
                    <button type="button" class="va21-button va21-button--ghost" data-va21-action="details">OPEN FILE</button>
                </div>
            </div>
            <div class="va21-hero__index" aria-hidden="true"><span>VELVET</span><b>ANTENNA</b><i>021</i></div>
        `;
        hero.querySelector('.va21-hero__eyebrow').textContent = lock.source;
        hero.querySelector('.va21-hero__title').textContent = lock.title;
        hero.querySelector('.va21-hero__meta').textContent = lock.meta || '';
        if (lock.fallbackImage) {
            hero.style.setProperty('--va21-hero-fallback', `url("${lock.fallbackImage.replace(/"/g, '%22')}")`);
            hero.classList.add('has-fallback');
        }
        return hero;
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

    async function enrichHero(lock) {
        const token = ++STATE.heroToken;
        const item = await getItem(lock.id);
        if (!item || token !== STATE.heroToken || !STATE.heroLock || STATE.heroLock.id !== lock.id) return;
        const hero = document.getElementById(IDS.hero);
        if (!hero) return;

        lock.type = item.Type || lock.type || '';
        hero.querySelector('.va21-hero__title').textContent = item.Name || lock.title;
        const meta = [];
        if (item.ProductionYear) meta.push(String(item.ProductionYear));
        const runtime = formatRuntime(item.RunTimeTicks);
        if (runtime) meta.push(runtime);
        if (item.OfficialRating) meta.push(item.OfficialRating);
        if (item.CommunityRating) meta.push('★ ' + Number(item.CommunityRating).toFixed(1));
        hero.querySelector('.va21-hero__meta').textContent = meta.join(' / ') || lock.meta || '';
        if (item.Overview) hero.querySelector('.va21-hero__overview').textContent = item.Overview;

        const userData = item.UserData || {};
        const playLabel = hero.querySelector('[data-va21-action="play"] b');
        if (/Series/i.test(lock.type)) playLabel.textContent = 'OPEN SERIES';
        else if (/Season/i.test(lock.type)) playLabel.textContent = 'OPEN SEASON';
        else if (userData.PlaybackPositionTicks > 0 && !userData.Played) playLabel.textContent = 'CONTINUE';
        else playLabel.textContent = 'PLAY';

        const progress = hero.querySelector('.va21-hero__progress');
        if (userData.PlaybackPositionTicks > 0 && item.RunTimeTicks > 0 && !userData.Played) {
            const pct = Math.max(0, Math.min(100, (userData.PlaybackPositionTicks / item.RunTimeTicks) * 100));
            progress.querySelector('span').textContent = formatRuntime(item.RunTimeTicks - userData.PlaybackPositionTicks) + ' left';
            progress.querySelector('i').style.width = pct + '%';
            progress.hidden = false;
        } else {
            progress.hidden = true;
        }

        const backdrop = imageUrl(item, 'Backdrop', 1900) || parentBackdropUrl(item);
        if (backdrop) {
            const image = new Image();
            image.onload = () => {
                if (!hero.isConnected || !STATE.heroLock || STATE.heroLock.id !== lock.id) return;
                hero.style.setProperty('--va21-hero-backdrop', `url("${backdrop.replace(/"/g, '%22')}")`);
                hero.classList.add('backdrop-ready');
            };
            image.src = backdrop;
        }
    }

    function decorateHome() {
        if (pageKind() !== 'home') return;
        document.querySelectorAll('.verticalSection').forEach(section => {
            const heading = sectionHeading(section);
            section.classList.remove('va21-row-landscape', 'va21-row-posters');
            if (/continue watching|next up/i.test(heading)) section.classList.add('va21-row-landscape');
            else if (/recently added|anime|collection/i.test(heading)) section.classList.add('va21-row-posters');
        });
        const myMedia = findMyMediaSection();
        if (myMedia) myMedia.classList.add('va21-my-media-source');
    }

    function libraryKind() {
        const value = lowerRoute();
        if (value.includes('collectiontype=movies') || value.startsWith('#/movies')) return 'movies';
        if (value.includes('collectiontype=tvshows') || value.startsWith('#/tv')) return 'series';
        if (value.includes('collection')) return 'collections';
        return 'library';
    }

    function libraryLabel() {
        return {
            movies: ['MOVIES', 'Film without the filing cabinet.'],
            series: ['SERIES', 'Stories arranged around what you want to watch next.'],
            collections: ['COLLECTIONS', 'Franchises, worlds and curated sets.'],
            library: ['LIBRARY', 'Your media, in focus.']
        }[libraryKind()];
    }

    function mountLibraryStage() {
        const existing = document.getElementById(IDS.stage);
        if (pageKind() !== 'library') {
            if (existing) existing.remove();
            return;
        }

        const page = Array.from(document.querySelectorAll('.libraryPage, .page'))
            .find(el => el.offsetParent !== null) || document.querySelector('.libraryPage, .page');
        if (!page) return;

        let stage = existing;
        if (!stage) {
            stage = document.createElement('section');
            stage.id = IDS.stage;
            stage.className = 'va21-stage';
            stage.innerHTML = `
                <div class="va21-stage__art" aria-hidden="true"></div>
                <div class="va21-stage__noise" aria-hidden="true"></div>
                <div class="va21-stage__shade" aria-hidden="true"></div>
                <div class="va21-stage__content">
                    <div class="va21-kicker"><span>VELVET LENS</span><b class="va21-stage__library"></b></div>
                    <h1 class="va21-stage__title"></h1>
                    <div class="va21-stage__meta"></div>
                    <p class="va21-stage__overview"></p>
                    <div class="va21-stage__actions">
                        <button type="button" class="va21-button va21-button--primary" data-va21-stage-action="open">OPEN</button>
                        <button type="button" class="va21-button va21-button--ghost" data-va21-stage-action="play">PLAY</button>
                        <button type="button" class="va21-button va21-button--quiet va21-admin-only va21-stage-edit itemAction" data-va21-stage-action="edit" data-action="edit">EDIT METADATA</button>
                    </div>
                </div>
                <div class="va21-stage__side">
                    <span class="va21-stage__count">FOCUS A TITLE</span>
                    <div class="va21-stage__tools va21-admin-only">
                        <button type="button" class="va21-tool" data-va21-workbench="needs-id"><b>NEEDS ID</b><span>Scan the whole library</span></button>
                        <button type="button" class="va21-tool" data-va21-workbench="duplicates"><b>DUPLICATES</b><span>Find likely duplicate files</span></button>
                    </div>
                </div>
            `;
            page.insertBefore(stage, page.firstChild);
        }

        const label = libraryLabel();
        stage.querySelector('.va21-stage__library').textContent = label[0];
        if (!STATE.stageId) {
            stage.querySelector('.va21-stage__title').textContent = label[0];
            stage.querySelector('.va21-stage__overview').textContent = label[1];
            stage.querySelector('.va21-stage__meta').textContent = 'MOVE ACROSS THE LIBRARY TO CHANGE THE LENS';
            stage.classList.remove('has-item', 'art-ready');
        }
    }

    function libraryCards() {
        return Array.from(document.querySelectorAll('body.va21-page-library .card'))
            .filter(card => !card.closest('#' + IDS.stage) && !card.closest('#' + IDS.workbench));
    }

    function firstLibraryCard() {
        return libraryCards().find(card => card.offsetParent !== null && cardItemId(card)) || null;
    }

    function scheduleStageFromCard(card, delay) {
        if (!card || pageKind() !== 'library') return;
        const id = cardItemId(card);
        if (!id || id === STATE.stageId) return;
        window.clearTimeout(STATE.stageHoverTimer);
        STATE.stageHoverTimer = window.setTimeout(() => setStageItem(id, card), delay || 80);
    }

    async function setStageItem(itemId, card) {
        if (!itemId || pageKind() !== 'library') return;
        STATE.stageId = itemId;
        const previous = document.querySelector('.va21-card-in-lens');
        if (previous && previous !== card) previous.classList.remove('va21-card-in-lens');
        if (card) card.classList.add('va21-card-in-lens');

        const stage = document.getElementById(IDS.stage);
        if (!stage) return;

        stage.classList.add('has-item');
        stage.querySelector('.va21-stage__title').textContent = cardTitle(card) || 'Loading';
        stage.querySelector('.va21-stage__meta').textContent = cardSecondary(card) || '';
        stage.querySelector('.va21-stage__overview').textContent = 'Loading metadata…';
        stage.querySelector('.va21-stage__count').textContent = 'IN THE LENS';

        const edit = stage.querySelector('.va21-stage-edit');
        if (edit) {
            edit.setAttribute('data-id', itemId);
            edit.setAttribute('data-serverid', serverId());
            edit.setAttribute('data-type', cardType(card) || 'Movie');
        }

        const token = ++STATE.stageToken;
        const item = await getItem(itemId);
        if (!item || token !== STATE.stageToken || STATE.stageId !== itemId) return;

        stage.querySelector('.va21-stage__title').textContent = item.Name || cardTitle(card) || 'Untitled';
        const meta = [];
        if (item.ProductionYear) meta.push(item.ProductionYear);
        const runtime = formatRuntime(item.RunTimeTicks);
        if (runtime) meta.push(runtime);
        if (item.OfficialRating) meta.push(item.OfficialRating);
        if (item.CommunityRating) meta.push('★ ' + Number(item.CommunityRating).toFixed(1));
        stage.querySelector('.va21-stage__meta').textContent = meta.join(' / ');
        stage.querySelector('.va21-stage__overview').textContent = item.Overview || 'No synopsis available.';
        stage.setAttribute('data-item-type', item.Type || cardType(card) || '');
        if (edit) edit.setAttribute('data-type', item.Type || cardType(card) || 'Movie');

        const play = stage.querySelector('[data-va21-stage-action="play"]');
        play.hidden = !/^(Movie|Episode|Video|Audio)$/i.test(item.Type || '');

        const backdrop = imageUrl(item, 'Backdrop', 1900) || parentBackdropUrl(item);
        if (backdrop) {
            const image = new Image();
            image.onload = () => {
                if (!stage.isConnected || token !== STATE.stageToken || STATE.stageId !== itemId) return;
                stage.style.setProperty('--va21-stage-backdrop', `url("${backdrop.replace(/"/g, '%22')}")`);
                stage.classList.add('art-ready');
            };
            image.src = backdrop;
        } else {
            stage.classList.remove('art-ready');
        }
    }

    function ensureStageDefault() {
        if (pageKind() !== 'library' || STATE.stageId) return;
        const card = firstLibraryCard();
        if (card) scheduleStageFromCard(card, 0);
    }

    function mountSearchStage() {
        const existing = document.getElementById(IDS.search);
        if (pageKind() !== 'search') {
            if (existing) existing.remove();
            return;
        }
        if (existing) return;
        const input = document.querySelector('.searchInput, input[type="search"], input[placeholder*="search" i]');
        if (!input) return;
        const stage = document.createElement('section');
        stage.id = IDS.search;
        stage.className = 'va21-search-stage';
        stage.innerHTML = `
            <div class="va21-kicker"><span>VA / INDEX</span><b>SEARCH</b></div>
            <h1>Find the signal.</h1>
            <p>Search the library without leaving the Velvet Antenna surface.</p>
        `;
        const host = input.closest('.searchFields') || input.closest('.inputContainer') || input.parentElement;
        if (host && host.parentElement) host.parentElement.insertBefore(stage, host);
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
        brand.className = 'va21-detail-brand';
        brand.innerHTML = '<span>VELVET ANTENNA</span><b>NOW IN FOCUS</b>';
        title.parentElement.insertBefore(brand, title);
        if (STATE.admin) mountDetailEdit();
    }

    function mountDetailEdit() {
        const id = currentDetailsId();
        if (!id) return;
        const actions = document.querySelector('.mainDetailButtons, .detailPagePrimaryContainer .mainDetailButtons');
        if (!actions || actions.querySelector('.va21-detail-edit')) return;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'emby-button button-flat va21-detail-edit itemAction';
        button.setAttribute('data-action', 'edit');
        button.setAttribute('data-id', id);
        button.setAttribute('data-serverid', serverId());
        button.title = 'Edit metadata';
        button.innerHTML = '<span>✎</span><span>EDIT METADATA</span>';
        actions.appendChild(button);
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
        try { sessionStorage.setItem(PENDING_PLAY_KEY, JSON.stringify({ id: itemId, created: Date.now() })); }
        catch (error) { /* optional */ }
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

    function selectionActive() {
        return Boolean(document.querySelector('.selectionCommandsPanel, .itemSelectionPanel, .withMultiSelect, .chkItemSelect'));
    }

    function isInteractive(target) {
        return Boolean(target.closest('button, a, input, select, textarea, [role="button"], .paper-icon-button-light, .cardOverlayButton'));
    }

    function stopEvent(event) {
        event.preventDefault();
        event.stopPropagation();
        if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
    }

    function onPointerOver(event) {
        if (pageKind() !== 'library') return;
        const card = event.target && event.target.closest && event.target.closest('.card');
        if (!card || card.closest('#' + IDS.stage) || card.closest('#' + IDS.workbench)) return;
        scheduleStageFromCard(card, 90);
    }

    function onFocusIn(event) {
        if (pageKind() !== 'library') return;
        const card = event.target && event.target.closest && event.target.closest('.card');
        if (!card || card.closest('#' + IDS.stage) || card.closest('#' + IDS.workbench)) return;
        scheduleStageFromCard(card, 30);
    }

    function onClick(event) {
        const target = event.target;
        if (!target || typeof target.closest !== 'function') return;

        const hero = target.closest('#' + IDS.hero);
        if (hero && STATE.heroLock) {
            const action = target.closest('[data-va21-action]');
            if (!action) return;
            const kind = action.getAttribute('data-va21-action');
            stopEvent(event);
            if (kind === 'details') {
                navigateDetails(STATE.heroLock.id);
            } else if (kind === 'play') {
                if (/^(Movie|Episode|Video|Audio)$/i.test(STATE.heroLock.type || '')) {
                    queuePlay(STATE.heroLock.id);
                    navigateDetails(STATE.heroLock.id);
                } else {
                    navigateDetails(STATE.heroLock.id);
                }
            }
            return;
        }

        const stageAction = target.closest('[data-va21-stage-action]');
        if (stageAction && STATE.stageId) {
            const action = stageAction.getAttribute('data-va21-stage-action');
            if (action === 'edit') return;
            stopEvent(event);
            if (action === 'open') navigateDetails(STATE.stageId);
            if (action === 'play') {
                queuePlay(STATE.stageId);
                navigateDetails(STATE.stageId);
            }
            return;
        }

        const workbenchButton = target.closest('[data-va21-workbench]');
        if (workbenchButton) {
            stopEvent(event);
            openWorkbench(workbenchButton.getAttribute('data-va21-workbench'));
            return;
        }

        const workbenchAction = target.closest('[data-va21-wb-action]');
        if (workbenchAction) {
            if (workbenchAction.classList.contains('itemAction')) return;
            stopEvent(event);
            handleWorkbenchAction(workbenchAction);
            return;
        }

        if (target.closest('.va21-detail-edit, .va21-wb-edit, .va21-stage-edit')) return;

        if (pageKind() === 'library') {
            if (selectionActive()) return;
            const card = target.closest('.card');
            if (card && !card.closest('#' + IDS.workbench) && !isInteractive(target)) {
                const id = cardItemId(card);
                if (id) {
                    stopEvent(event);
                    navigateDetails(id);
                }
            }
        }
    }

    function providerEntries(item) {
        const ids = item && item.ProviderIds && typeof item.ProviderIds === 'object' ? item.ProviderIds : {};
        return Object.entries(ids).filter(entry => String(entry[1] || '').trim());
    }

    function strongProviderKeys(item) {
        return providerEntries(item)
            .filter(entry => /^(imdb|tmdb|tvdb|anidb|tvmaze|trakt)$/i.test(String(entry[0] || '').replace(/[^a-z0-9]/gi, '')))
            .map(entry => String(entry[0]).toLowerCase() + ':' + String(entry[1]).trim().toLowerCase());
    }

    function titleKey(value) {
        return String(value || '')
            .normalize('NFKD')
            .toLowerCase()
            .replace(/&/g, ' and ')
            .replace(/[^a-z0-9]+/g, ' ')
            .replace(/\b(extended|unrated|directors cut|director s cut|theatrical|remastered|edition)\b/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function fileName(item) {
        const source = item && Array.isArray(item.MediaSources) && item.MediaSources.length ? item.MediaSources[0] : null;
        const path = (source && source.Path) || (item && item.Path) || '';
        return String(path).split(/[\\/]/).pop() || '';
    }

    function bytesLabel(bytes) {
        const value = Number(bytes || 0);
        if (!value) return '';
        const gb = value / 1073741824;
        if (gb >= 1) return gb.toFixed(gb >= 10 ? 1 : 2) + ' GB';
        return (value / 1048576).toFixed(0) + ' MB';
    }

    function bitrateLabel(value) {
        const bitrate = Number(value || 0);
        if (!bitrate) return '';
        return (bitrate / 1000000).toFixed(bitrate >= 10000000 ? 0 : 1) + ' Mbps';
    }

    function qualitySummary(item) {
        const source = item && Array.isArray(item.MediaSources) && item.MediaSources.length ? item.MediaSources[0] : null;
        const streams = (source && Array.isArray(source.MediaStreams) && source.MediaStreams.length)
            ? source.MediaStreams
            : (item && Array.isArray(item.MediaStreams) ? item.MediaStreams : []);
        const video = streams.find(stream => String(stream.Type || '').toLowerCase() === 'video');
        const audio = streams.find(stream => String(stream.Type || '').toLowerCase() === 'audio');
        const parts = [];

        if (video) {
            const height = Number(video.Height || 0);
            const width = Number(video.Width || 0);
            if (height >= 2000 || width >= 3500) parts.push('2160p');
            else if (height >= 1000 || width >= 1800) parts.push('1080p');
            else if (height >= 700 || width >= 1200) parts.push('720p');
            else if (height) parts.push(height + 'p');
            if (video.Codec) parts.push(String(video.Codec).toUpperCase());
            const range = [video.VideoRange, video.VideoRangeType, video.Hdr10PlusPresent ? 'HDR10+' : '', video.DvVersionMajor ? 'DV' : '']
                .filter(Boolean).join(' ').toUpperCase();
            if (/DOLBY|DOVI|\bDV\b/.test(range)) parts.push('DV');
            else if (/HDR/.test(range)) parts.push('HDR');
            const br = bitrateLabel(video.BitRate || (source && source.Bitrate));
            if (br) parts.push(br);
        }

        if (audio) {
            const channels = Number(audio.Channels || 0);
            if (channels >= 8) parts.push('7.1');
            else if (channels >= 6) parts.push('5.1');
            if (audio.Codec) parts.push(String(audio.Codec).toUpperCase());
        }

        const size = bytesLabel(source && source.Size);
        if (size) parts.push(size);
        return parts.slice(0, 6).join(' • ');
    }

    function includeItemTypes() {
        const kind = libraryKind();
        if (kind === 'movies') return 'Movie';
        if (kind === 'series') return 'Series';
        return 'Movie,Series';
    }

    async function fetchWholeLibrary(fields) {
        const parent = libraryParentId();
        const client = api();
        const uid = userId();
        if (!parent || !client || !uid || typeof client.getItems !== 'function') return [];
        const key = parent + '|' + includeItemTypes() + '|' + fields;
        if (STATE.libraryIndexCache.has(key)) return STATE.libraryIndexCache.get(key);

        const items = [];
        let start = 0;
        let total = Infinity;
        let guard = 0;

        while (start < total && guard < 30) {
            guard += 1;
            const result = await client.getItems(uid, {
                ParentId: parent,
                Recursive: true,
                IncludeItemTypes: includeItemTypes(),
                Fields: fields,
                StartIndex: start,
                Limit: LIBRARY_BATCH_SIZE,
                SortBy: 'SortName',
                EnableTotalRecordCount: true
            });
            const batch = result && Array.isArray(result.Items) ? result.Items : [];
            items.push(...batch);
            total = Number(result && result.TotalRecordCount);
            if (!Number.isFinite(total)) total = items.length + (batch.length === LIBRARY_BATCH_SIZE ? 1 : 0);
            if (!batch.length || batch.length < LIBRARY_BATCH_SIZE) break;
            start += batch.length;
        }

        STATE.libraryIndexCache.set(key, items);
        return items;
    }

    function duplicateGroups(items) {
        const buckets = new Map();
        items.forEach(item => {
            const name = titleKey(item.Name);
            if (!name) return;
            if (!buckets.has(name)) buckets.set(name, []);
            buckets.get(name).push(item);
        });

        const groups = [];
        buckets.forEach(bucket => {
            if (bucket.length < 2) return;
            const candidates = [];
            for (let i = 0; i < bucket.length; i += 1) {
                for (let j = i + 1; j < bucket.length; j += 1) {
                    const a = bucket[i];
                    const b = bucket[j];
                    const ya = Number(a.ProductionYear || 0);
                    const yb = Number(b.ProductionYear || 0);
                    const sameYear = Boolean(ya && yb && ya === yb);
                    const compatibleYear = !ya || !yb || sameYear;
                    const providersA = new Set(strongProviderKeys(a));
                    const providerMatch = strongProviderKeys(b).some(key => providersA.has(key));
                    if (compatibleYear && (sameYear || providerMatch)) candidates.push(a, b);
                }
            }
            const unique = Array.from(new Map(candidates.map(item => [String(item.Id), item])).values());
            if (unique.length > 1) groups.push(unique);
        });
        return groups;
    }

    async function openWorkbench(mode) {
        if (!STATE.admin || !['needs-id', 'duplicates'].includes(mode)) return;
        closeWorkbench();

        const panel = document.createElement('section');
        panel.id = IDS.workbench;
        panel.className = 'va21-workbench';
        panel.innerHTML = `
            <div class="va21-workbench__backdrop" data-va21-wb-action="close"></div>
            <div class="va21-workbench__panel">
                <header>
                    <div>
                        <div class="va21-kicker"><span>VA / ADMIN</span><b>${mode === 'needs-id' ? 'NEEDS ID' : 'DUPLICATES'}</b></div>
                        <h2>${mode === 'needs-id' ? 'Identification workbench' : 'Duplicate workbench'}</h2>
                        <p class="va21-workbench__status">Reading the whole library…</p>
                    </div>
                    <button type="button" class="va21-workbench__close" data-va21-wb-action="close" aria-label="Close">×</button>
                </header>
                <div class="va21-workbench__body"><div class="va21-spinner">TUNING…</div></div>
                <footer>
                    <button type="button" class="va21-button va21-button--ghost" data-va21-wb-action="prev">PREVIOUS</button>
                    <span class="va21-workbench__page"></span>
                    <button type="button" class="va21-button va21-button--ghost" data-va21-wb-action="next">NEXT</button>
                </footer>
            </div>
        `;
        document.body.appendChild(panel);
        document.body.classList.add('va21-workbench-open');

        const token = ++STATE.workbenchToken;
        STATE.workbench = { mode, page: 0, results: [], groups: null, token };

        try {
            const minimalFields = 'ProviderIds,Path,ImageTags,ProductionYear';
            const items = await fetchWholeLibrary(minimalFields);
            if (!STATE.workbench || STATE.workbench.token !== token) return;

            if (mode === 'needs-id') {
                STATE.workbench.results = items.filter(item => providerEntries(item).length === 0);
                renderWorkbench();
                return;
            }

            const groups = duplicateGroups(items);
            const ids = Array.from(new Set(groups.flat().map(item => String(item.Id))));
            const detailed = [];
            for (let i = 0; i < ids.length; i += 100) {
                const batch = ids.slice(i, i + 100);
                const client = api();
                const result = await client.getItems(userId(), {
                    Ids: batch.join(','),
                    Fields: 'ProviderIds,MediaSources,MediaStreams,Path,ImageTags,ProductionYear',
                    EnableTotalRecordCount: false
                });
                if (result && Array.isArray(result.Items)) detailed.push(...result.Items);
            }
            if (!STATE.workbench || STATE.workbench.token !== token) return;
            const detailMap = new Map(detailed.map(item => [String(item.Id), item]));
            STATE.workbench.groups = groups.map(group => group.map(item => detailMap.get(String(item.Id)) || item));
            STATE.workbench.results = STATE.workbench.groups.flat();
            renderWorkbench();
        } catch (error) {
            console.error('[Velvet Antenna] workbench failed', error);
            const status = panel.querySelector('.va21-workbench__status');
            const body = panel.querySelector('.va21-workbench__body');
            if (status) status.textContent = 'The library scan failed.';
            if (body) body.innerHTML = '<div class="va21-empty">Unable to read this library. Close the workbench and try again.</div>';
        }
    }

    function closeIdentifyOverlay() {
        document.getElementById('va21-identify-overlay')?.remove();
        STATE.identifySession = null;
    }

    function closeWorkbench() {
        STATE.workbenchToken += 1;
        STATE.workbench = null;
        closeIdentifyOverlay();
        document.getElementById(IDS.workbench)?.remove();
        document.body && document.body.classList.remove('va21-workbench-open');
    }

    function workbenchImage(item) {
        const client = api();
        if (!client || !item || !item.ImageTags || !item.ImageTags.Primary || typeof client.getImageUrl !== 'function') return '';
        try {
            return client.getImageUrl(item.Id, {
                type: 'Primary',
                tag: item.ImageTags.Primary,
                maxWidth: 220,
                quality: 78
            });
        } catch (error) { return ''; }
    }

    function workbenchResolution(item) {
        const source = item && Array.isArray(item.MediaSources) && item.MediaSources.length ? item.MediaSources[0] : null;
        const streams = source && Array.isArray(source.MediaStreams) && source.MediaStreams.length
            ? source.MediaStreams
            : (item && Array.isArray(item.MediaStreams) ? item.MediaStreams : []);
        const video = streams.find(stream => String(stream.Type || '').toLowerCase() === 'video');
        if (!video) return item && item.Type === 'Series' ? 'SERIES' : '';
        const height = Number(video.Height || 0);
        const width = Number(video.Width || 0);
        if (height >= 2000 || width >= 3500) return '2160P';
        if (height >= 1000 || width >= 1800) return '1080P';
        if (height >= 700 || width >= 1200) return '720P';
        return height ? height + 'P' : '';
    }

    function findWorkbenchItem(itemId) {
        if (!STATE.workbench) return null;
        const id = String(itemId || '');
        const direct = STATE.workbench.results.find(item => String(item.Id) === id);
        if (direct) return direct;
        if (Array.isArray(STATE.workbench.groups)) {
            for (const group of STATE.workbench.groups) {
                const found = group.find(item => String(item.Id) === id);
                if (found) return found;
            }
        }
        return null;
    }

    function workbenchRow(item, groupIndex) {
        const row = document.createElement('article');
        row.className = 'va21-wb-row';
        row.setAttribute('data-item-id', item.Id || '');
        const img = workbenchImage(item);
        const path = fileName(item);
        const quality = qualitySummary(item);
        const resolution = workbenchResolution(item);
        const needsId = Boolean(STATE.workbench && STATE.workbench.mode === 'needs-id');
        const duplicate = Boolean(STATE.workbench && STATE.workbench.mode === 'duplicates');

        row.innerHTML = `
            <div class="va21-wb-row__art"${img ? ` style="background-image:url('${img.replace(/'/g, '%27')}')"` : ''}>
                ${resolution ? `<span class="va21-wb-resolution">${resolution}</span>` : ''}
            </div>
            <div class="va21-wb-row__copy">
                <div class="va21-wb-row__group">${groupIndex ? 'DUPLICATE GROUP ' + groupIndex : 'NEEDS IDENTIFICATION'}</div>
                <h3></h3>
                <div class="va21-wb-row__meta"></div>
                <div class="va21-wb-row__path"></div>
            </div>
            <div class="va21-wb-row__actions">
                ${needsId ? `<button type="button" class="va21-button va21-button--identify" data-va21-wb-action="identify" data-id="${item.Id || ''}">IDENTIFY</button>` : ''}
                ${duplicate ? `<button type="button" class="va21-button va21-button--ghost" data-va21-wb-action="open" data-id="${item.Id || ''}">OPEN</button>` : ''}
                ${duplicate ? `<button type="button" class="va21-button va21-button--danger" data-va21-wb-action="delete" data-id="${item.Id || ''}">DELETE</button>` : ''}
            </div>
        `;
        row.querySelector('h3').textContent = item.Name || 'Untitled';
        row.querySelector('.va21-wb-row__meta').textContent = [item.ProductionYear || '', quality].filter(Boolean).join(' • ');
        row.querySelector('.va21-wb-row__path').textContent = path || item.Path || '';
        return row;
    }

    function renderWorkbench() {
        const panel = document.getElementById(IDS.workbench);
        if (!panel || !STATE.workbench) return;
        const body = panel.querySelector('.va21-workbench__body');
        const status = panel.querySelector('.va21-workbench__status');
        const pageEl = panel.querySelector('.va21-workbench__page');
        const prev = panel.querySelector('[data-va21-wb-action="prev"]');
        const next = panel.querySelector('[data-va21-wb-action="next"]');

        body.innerHTML = '';
        const flat = STATE.workbench.results;
        const totalPages = Math.max(1, Math.ceil(flat.length / WORKBENCH_PAGE_SIZE));
        STATE.workbench.page = Math.max(0, Math.min(STATE.workbench.page, totalPages - 1));
        const start = STATE.workbench.page * WORKBENCH_PAGE_SIZE;
        const slice = flat.slice(start, start + WORKBENCH_PAGE_SIZE);

        if (!slice.length) {
            body.innerHTML = `<div class="va21-empty">${STATE.workbench.mode === 'needs-id' ? 'No unidentified items found.' : 'No likely duplicates found.'}</div>`;
        } else if (STATE.workbench.mode === 'duplicates' && Array.isArray(STATE.workbench.groups)) {
            const membership = new Map();
            STATE.workbench.groups.forEach((group, index) => group.forEach(item => membership.set(String(item.Id), index + 1)));
            slice.forEach(item => body.appendChild(workbenchRow(item, membership.get(String(item.Id)))));
        } else {
            slice.forEach(item => body.appendChild(workbenchRow(item, 0)));
        }

        const noun = STATE.workbench.mode === 'needs-id' ? 'items need identification' : 'candidate duplicate files';
        status.textContent = flat.length + ' ' + noun + ' across the whole library';
        pageEl.textContent = 'PAGE ' + (STATE.workbench.page + 1) + ' / ' + totalPages;
        prev.disabled = STATE.workbench.page <= 0;
        next.disabled = STATE.workbench.page >= totalPages - 1;
    }

    async function resolveIdentifyItem(itemId) {
        let item = findWorkbenchItem(itemId);
        if (item && item.Type) return item;
        const client = api();
        if (!client || typeof client.getItem !== 'function') return item;
        try {
            const full = await client.getItem(userId(), itemId);
            return full || item;
        } catch (error) {
            return item;
        }
    }

    async function openIdentify(itemId) {
        closeIdentifyOverlay();
        const item = await resolveIdentifyItem(itemId);
        if (!item) return;

        const overlay = document.createElement('section');
        overlay.id = 'va21-identify-overlay';
        overlay.className = 'va21-identify';
        overlay.innerHTML = `
            <div class="va21-identify__backdrop" data-va21-wb-action="identify-cancel"></div>
            <div class="va21-identify__panel">
                <header>
                    <div>
                        <div class="va21-kicker"><span>VA / IDENTIFY</span><b>MATCH ITEM</b></div>
                        <h2>Identify media</h2>
                        <p class="va21-identify__path"></p>
                    </div>
                    <button type="button" class="va21-workbench__close" data-va21-wb-action="identify-cancel" aria-label="Close">×</button>
                </header>
                <form class="va21-identify__form">
                    <label><span>SEARCH NAME</span><input type="text" class="va21-identify__name" autocomplete="off"></label>
                    <label class="va21-identify__year-wrap"><span>YEAR</span><input type="number" class="va21-identify__year" min="1800" max="2200"></label>
                    <label class="va21-identify__replace"><input type="checkbox" class="va21-identify__replace-images" checked><span>Replace existing images</span></label>
                    <button type="submit" class="va21-button va21-button--identify">SEARCH</button>
                </form>
                <div class="va21-identify__status">Adjust the search terms if the filename-derived title is poor.</div>
                <div class="va21-identify__results"></div>
            </div>
        `;
        document.body.appendChild(overlay);
        overlay.querySelector('.va21-identify__name').value = item.Name || '';
        overlay.querySelector('.va21-identify__year').value = item.ProductionYear || '';
        overlay.querySelector('.va21-identify__path').textContent = fileName(item) || item.Path || '';
        if (item.Type === 'Person' || item.Type === 'BoxSet') overlay.querySelector('.va21-identify__year-wrap').hidden = true;

        STATE.identifySession = { item, results: [] };
        overlay.querySelector('.va21-identify__form').addEventListener('submit', event => {
            event.preventDefault();
            searchIdentify();
        });
        overlay.querySelector('.va21-identify__name').focus();
    }

    async function searchIdentify() {
        const overlay = document.getElementById('va21-identify-overlay');
        const session = STATE.identifySession;
        const client = api();
        if (!overlay || !session || !client || typeof client.ajax !== 'function') return;

        const name = overlay.querySelector('.va21-identify__name').value.trim();
        const yearValue = overlay.querySelector('.va21-identify__year').value.trim();
        const status = overlay.querySelector('.va21-identify__status');
        const resultsHost = overlay.querySelector('.va21-identify__results');
        const searchButton = overlay.querySelector('button[type="submit"]');

        if (!name) {
            status.textContent = 'Enter a title to search.';
            return;
        }

        const searchInfo = { Name: name, ProviderIds: {} };
        if (yearValue) searchInfo.Year = Number(yearValue);
        const itemType = session.item.Type || (libraryKind() === 'series' ? 'Series' : 'Movie');

        searchButton.disabled = true;
        searchButton.textContent = 'SEARCHING…';
        status.textContent = 'Searching Jellyfin metadata providers…';
        resultsHost.innerHTML = '';

        try {
            const results = await client.ajax({
                type: 'POST',
                url: client.getUrl('Items/RemoteSearch/' + itemType),
                data: JSON.stringify({ ItemId: session.item.Id, SearchInfo: searchInfo }),
                contentType: 'application/json',
                dataType: 'json'
            });
            session.results = Array.isArray(results) ? results : [];
            renderIdentifyResults();
        } catch (error) {
            console.error('[Velvet Antenna] identify search failed', error);
            status.textContent = 'Metadata search failed. Check the server metadata providers and try again.';
        } finally {
            searchButton.disabled = false;
            searchButton.textContent = 'SEARCH';
        }
    }

    function renderIdentifyResults() {
        const overlay = document.getElementById('va21-identify-overlay');
        const session = STATE.identifySession;
        if (!overlay || !session) return;
        const host = overlay.querySelector('.va21-identify__results');
        const status = overlay.querySelector('.va21-identify__status');
        host.innerHTML = '';

        if (!session.results.length) {
            status.textContent = 'No matches found. Change the title or year and search again.';
            return;
        }

        status.textContent = session.results.length + ' matches found. Choose the correct result.';
        session.results.slice(0, 30).forEach((result, index) => {
            const card = document.createElement('button');
            card.type = 'button';
            card.className = 'va21-identify-result';
            card.setAttribute('data-va21-wb-action', 'identify-apply');
            card.setAttribute('data-index', String(index));

            const art = document.createElement('span');
            art.className = 'va21-identify-result__art';
            if (result.ImageUrl) art.style.backgroundImage = `url('${String(result.ImageUrl).replace(/'/g, '%27')}')`;

            const copy = document.createElement('span');
            copy.className = 'va21-identify-result__copy';
            const title = document.createElement('b');
            title.textContent = result.Name || 'Unknown';
            const meta = document.createElement('span');
            meta.textContent = [result.ProductionYear || '', result.SearchProviderName || ''].filter(Boolean).join(' • ');
            const action = document.createElement('em');
            action.textContent = 'USE THIS MATCH';
            copy.append(title, meta, action);
            card.append(art, copy);
            host.appendChild(card);
        });
    }

    async function applyIdentify(index) {
        const overlay = document.getElementById('va21-identify-overlay');
        const session = STATE.identifySession;
        const client = api();
        if (!overlay || !session || !client || typeof client.ajax !== 'function') return;
        const result = session.results[Number(index)];
        if (!result) return;

        const currentName = session.item.Name || 'this item';
        const targetName = result.Name || 'the selected result';
        const targetYear = result.ProductionYear ? ' (' + result.ProductionYear + ')' : '';
        if (!window.confirm('Identify "' + currentName + '" as "' + targetName + '"' + targetYear + '?')) return;

        const replaceImages = overlay.querySelector('.va21-identify__replace-images').checked;
        const status = overlay.querySelector('.va21-identify__status');
        status.textContent = 'Applying metadata match…';
        overlay.classList.add('is-busy');

        try {
            await client.ajax({
                type: 'POST',
                url: client.getUrl('Items/RemoteSearch/Apply/' + session.item.Id, { ReplaceAllImages: replaceImages }),
                data: JSON.stringify(result),
                contentType: 'application/json'
            });
            const id = String(session.item.Id);
            STATE.libraryIndexCache.clear();
            STATE.itemCache.delete(id);
            if (STATE.workbench && STATE.workbench.mode === 'needs-id') {
                STATE.workbench.results = STATE.workbench.results.filter(item => String(item.Id) !== id);
            }
            closeIdentifyOverlay();
            renderWorkbench();
        } catch (error) {
            console.error('[Velvet Antenna] identify apply failed', error);
            overlay.classList.remove('is-busy');
            status.textContent = 'Could not apply that match. Try again or check the server metadata provider.';
        }
    }

    async function deleteWorkbenchItem(itemId, button) {
        const item = findWorkbenchItem(itemId) || await resolveIdentifyItem(itemId);
        const client = api();
        if (!item || !client || typeof client.deleteItem !== 'function') return;

        const quality = qualitySummary(item);
        const path = fileName(item) || item.Path || '';
        const typeWarning = item.Type === 'Series'
            ? 'This will delete the series and its media from the filesystem and Jellyfin library.'
            : 'This will delete the media file from the filesystem and Jellyfin library.';
        const detail = [quality, path].filter(Boolean).join('\n');
        const message = 'DELETE "' + (item.Name || 'this item') + '"?\n\n' + (detail ? detail + '\n\n' : '') + typeWarning + '\n\nThis cannot be undone from Velvet Antenna.';
        if (!window.confirm(message)) return;

        if (button) {
            button.disabled = true;
            button.textContent = 'DELETING…';
        }

        try {
            await client.deleteItem(String(item.Id));
            const id = String(item.Id);
            STATE.libraryIndexCache.clear();
            STATE.itemCache.delete(id);

            if (STATE.workbench && Array.isArray(STATE.workbench.groups)) {
                STATE.workbench.groups = STATE.workbench.groups
                    .map(group => group.filter(candidate => String(candidate.Id) !== id))
                    .filter(group => group.length > 1);
                STATE.workbench.results = STATE.workbench.groups.flat();
            } else if (STATE.workbench) {
                STATE.workbench.results = STATE.workbench.results.filter(candidate => String(candidate.Id) !== id);
            }
            renderWorkbench();
            scheduleRoutePasses();
        } catch (error) {
            console.error('[Velvet Antenna] delete failed', error);
            if (button) {
                button.disabled = false;
                button.textContent = 'DELETE';
            }
            window.alert('Jellyfin could not delete that item. Check the user delete permission and filesystem access.');
        }
    }

    function handleWorkbenchAction(button) {
        const action = button.getAttribute('data-va21-wb-action');
        if (action === 'close') {
            closeWorkbench();
            return;
        }
        if (action === 'identify-cancel') {
            closeIdentifyOverlay();
            return;
        }
        if (action === 'identify-apply') {
            applyIdentify(button.getAttribute('data-index'));
            return;
        }
        if (!STATE.workbench) return;
        if (action === 'prev') {
            STATE.workbench.page -= 1;
            renderWorkbench();
            return;
        }
        if (action === 'next') {
            STATE.workbench.page += 1;
            renderWorkbench();
            return;
        }
        if (action === 'open') {
            const id = button.getAttribute('data-id');
            closeWorkbench();
            navigateDetails(id);
            return;
        }
        if (action === 'identify') {
            openIdentify(button.getAttribute('data-id'));
            return;
        }
        if (action === 'delete') {
            deleteWorkbenchItem(button.getAttribute('data-id'), button);
        }
    }

    function clearRouteArtifacts() {
        if (pageKind() !== 'home') document.getElementById(IDS.hero)?.remove();
        if (pageKind() !== 'library') {
            document.getElementById(IDS.stage)?.remove();
            STATE.stageId = '';
            STATE.stageToken += 1;
        }
        if (pageKind() !== 'search') document.getElementById(IDS.search)?.remove();
        if (pageKind() !== 'details') document.getElementById(IDS.detailBrand)?.remove();
        if (pageKind() !== 'library') closeWorkbench();
    }

    function render() {
        setPageClass();
        clearRouteArtifacts();
        mountNav();
        if (!isViewerRoute()) return;

        resolveAdmin();
        captureLibraryRoutes();

        if (pageKind() === 'home') {
            decorateHome();
            if (STATE.heroLock) mountHero();
            else maybeStartHero();
        }

        if (pageKind() === 'library') {
            mountLibraryStage();
            ensureStageDefault();
        }

        if (pageKind() === 'search') mountSearchStage();

        if (pageKind() === 'details') {
            mountDetailBrand();
            if (STATE.admin) mountDetailEdit();
        }
    }

    function clearRouteTimers() {
        STATE.timers.forEach(id => window.clearTimeout(id));
        STATE.timers = [];
    }

    function scheduleRoutePasses() {
        clearRouteTimers();
        [0, 180, 520, 1100, 1900, 3200].forEach(delay => {
            STATE.timers.push(window.setTimeout(render, delay));
        });
    }

    function routeChanged() {
        const previous = STATE.route;
        const now = route();
        if (previous !== now) {
            const previousHome = previous === '#/home' || previous.startsWith('#/home?');
            const currentHome = now === '#/home' || now.startsWith('#/home?');
            if (previousHome || currentHome) resetHero();
            STATE.route = now;
            STATE.stageId = '';
            STATE.stageToken += 1;
            closeWorkbench();
            clearPlayTimer();
            STATE.playAttempts = 0;
            if (isDetails()) window.setTimeout(tryPendingPlay, 90);
        }
        scheduleRoutePasses();
    }

    function nativeUiChanged(event) {
        const target = event.target;
        if (!target || typeof target.closest !== 'function') return;
        if (target.closest('.emby-tab-button, .listPaging, .paper-icon-button-light, .alphaPicker, .selectContainer')) {
            window.setTimeout(() => {
                if (pageKind() === 'library') {
                    STATE.stageId = '';
                    STATE.stageToken += 1;
                }
                scheduleRoutePasses();
            }, 260);
        }
    }

    function start() {
        STATE.route = route();
        window.addEventListener('hashchange', routeChanged);
        window.addEventListener('popstate', routeChanged);
        window.addEventListener('click', onClick, true);
        window.addEventListener('click', nativeUiChanged, false);
        window.addEventListener('pointerover', onPointerOver, true);
        window.addEventListener('focusin', onFocusIn, true);

        scheduleRoutePasses();
        if (pageKind() === 'home') maybeStartHero();
        if (isDetails()) window.setTimeout(tryPendingPlay, 90);

        console.log('[Velvet Antenna] v' + VERSION + ' standalone loaded');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start, { once: true });
    } else {
        start();
    }
})();

(function () {
    'use strict';

    const DETAIL_PLAY_ID = 'va21-detail-playbar';
    const PLAY_RETRY_MS = 150;
    const MAX_PLAY_ATTEMPTS = 40;
    let routeTimers = [];
    let itemToken = 0;

    function route() {
        return window.location.hash || '';
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

    function removeDetailPlay() {
        document.getElementById(DETAIL_PLAY_ID)?.remove();
    }

    function mountButton(item) {
        if (!isDetails() || !item || !/^(Movie|Episode|Video|Audio)$/i.test(item.Type || '')) {
            removeDetailPlay();
            return;
        }

        const title = document.querySelector('.itemName, .detailPagePrimaryContent h1, .detailPagePrimaryContainer h1');
        if (!title || !title.parentElement) return;

        let bar = document.getElementById(DETAIL_PLAY_ID);
        if (!bar) {
            bar = document.createElement('div');
            bar.id = DETAIL_PLAY_ID;
            bar.className = 'va21-detail-playbar';
            bar.innerHTML = '<button type="button" class="va21-button va21-button--primary va21-detail-play"><span aria-hidden="true">▶</span><b>PLAY</b></button>';
            title.insertAdjacentElement('afterend', bar);
        }

        const button = bar.querySelector('.va21-detail-play');
        const userData = item.UserData || {};
        button.querySelector('b').textContent = userData.PlaybackPositionTicks > 0 && !userData.Played ? 'CONTINUE' : 'PLAY';
        button.setAttribute('data-item-id', item.Id || currentDetailsId());
        button.disabled = false;
    }

    async function mountDetailPlay() {
        if (!isDetails()) {
            removeDetailPlay();
            return;
        }

        const id = currentDetailsId();
        const client = window.ApiClient;
        if (!id || !client || typeof client.getItem !== 'function' || typeof client.getCurrentUserId !== 'function') return;
        const token = ++itemToken;

        try {
            const item = await client.getItem(client.getCurrentUserId(), id);
            if (token !== itemToken || !isDetails() || currentDetailsId() !== id) return;
            mountButton(item);
        } catch (error) {
            console.debug('[Velvet Antenna v0.21.2] detail item lookup failed', error);
        }
    }

    function clickNativePlay(button, attempt) {
        if (!isDetails()) return;
        const nativePlay = genuineLocalPlayButton();
        if (nativePlay) {
            button.disabled = false;
            nativePlay.click();
            return;
        }

        if (attempt >= MAX_PLAY_ATTEMPTS) {
            button.disabled = false;
            button.querySelector('b').textContent = 'PLAY UNAVAILABLE';
            return;
        }

        button.disabled = true;
        button.querySelector('b').textContent = 'STARTING…';
        window.setTimeout(() => clickNativePlay(button, attempt + 1), PLAY_RETRY_MS);
    }

    function onClick(event) {
        const button = event.target && event.target.closest && event.target.closest('#' + DETAIL_PLAY_ID + ' .va21-detail-play');
        if (!button) return;
        event.preventDefault();
        event.stopPropagation();
        if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
        clickNativePlay(button, 0);
    }

    function scheduleMounts() {
        routeTimers.forEach(id => window.clearTimeout(id));
        routeTimers = [];
        [0, 160, 420, 850, 1500, 2600].forEach(delay => {
            routeTimers.push(window.setTimeout(mountDetailPlay, delay));
        });
    }

    function routeChanged() {
        itemToken += 1;
        removeDetailPlay();
        scheduleMounts();
    }

    window.addEventListener('click', onClick, true);
    window.addEventListener('hashchange', routeChanged);
    window.addEventListener('popstate', routeChanged);
    scheduleMounts();

    if (document.body) document.body.setAttribute('data-va21-version', '0.21.2');
    console.log('[Velvet Antenna] v0.21.2 detail playback surface loaded');
})();
