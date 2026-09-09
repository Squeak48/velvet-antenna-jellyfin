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
(function () {
    'use strict';

    const VERSION = '0.22.0';
    const PREFIX = 'va22:';
    const BUTTON_ID = 'va22-subtitle-search';
    const OVERLAY_ID = 'va22-subtitle-overlay';
    const RESTART_KEY = PREFIX + 'subtitle-restart';
    const LAST_ITEM_KEY = PREFIX + 'last-playing-id';
    const MAX_RESTART_AGE = 45000;
    const STATE = {
        timers: [],
        searchItem: null,
        cultures: [],
        results: [],
        restarting: false,
        selectAttempts: 0
    };

    function api() { return window.ApiClient || null; }
    function uid() {
        const client = api();
        try { return client && typeof client.getCurrentUserId === 'function' ? (client.getCurrentUserId() || '') : ''; }
        catch (error) { return ''; }
    }
    function sid() {
        const client = api();
        if (!client) return '';
        try {
            if (typeof client.serverId === 'function') return client.serverId() || '';
            if (typeof client.serverInfo === 'function') return client.serverInfo()?.Id || '';
            return client.serverId || client._serverId || '';
        } catch (error) { return ''; }
    }
    function route() { return window.location.hash || ''; }
    function isDetails() { return /details\?id=|\/details\//i.test(route()); }
    function currentDetailsId() {
        const match = route().match(/[?&]id=([^&]+)/i) || route().match(/\/details\/([^?&/]+)/i);
        return match && match[1] ? decodeURIComponent(match[1]) : '';
    }
    function detailsHash(id) {
        const server = sid();
        return '#/details?id=' + encodeURIComponent(id) + (server ? '&serverId=' + encodeURIComponent(server) : '');
    }
    function playbackActive() {
        return /videoosd|playback|nowplaying/i.test(route()) ||
            Boolean(document.querySelector('.videoPlayerContainer:not(.hide), .videoOsdPage:not(.hide), video'));
    }
    function normalise(value) { return String(value || '').trim().toLowerCase(); }
    function getStored(key) {
        try { return sessionStorage.getItem(key); } catch (error) { return null; }
    }
    function setStored(key, value) {
        try { sessionStorage.setItem(key, String(value)); } catch (error) { /* optional */ }
    }
    function removeStored(key) {
        try { sessionStorage.removeItem(key); } catch (error) { /* optional */ }
    }
    function safeJson(value) {
        try { return value ? JSON.parse(value) : null; } catch (error) { return null; }
    }
    function formatTime(seconds) {
        const total = Math.max(0, Math.floor(Number(seconds || 0)));
        const h = Math.floor(total / 3600);
        const m = Math.floor((total % 3600) / 60);
        const s = total % 60;
        return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
    }

    function capturePlaybackIntent(event) {
        const target = event.target;
        if (!target || typeof target.closest !== 'function') return;
        const play = target.closest('.btnPlay, [data-va22-action="play"], [data-va22-series-play], [data-va21-action="play"], [data-va21-stage-action="play"]');
        if (!play) return;
        let id = '';
        if (play.hasAttribute('data-va22-series-play')) id = play.getAttribute('data-va22-series-play') || '';
        if (!id) id = play.closest('[data-va22-id]')?.getAttribute('data-va22-id') || '';
        if (!id) id = play.closest('[data-id]')?.getAttribute('data-id') || '';
        if (!id && isDetails()) id = currentDetailsId();
        if (id) setStored(LAST_ITEM_KEY, id);
        schedulePasses();
    }

    async function resolvePlaybackItemId() {
        const stored = getStored(LAST_ITEM_KEY);
        if (stored) return stored;
        const domId = document.querySelector('.videoOsdPage [data-id], .videoPlayerContainer [data-id]')?.getAttribute('data-id');
        if (domId) return domId;
        const client = api();
        const user = uid();
        if (!client || !user || typeof client.getSessions !== 'function') return '';
        try {
            const sessions = await client.getSessions({});
            const candidates = (sessions || []).filter(session => String(session.UserId || '') === String(user) && session.NowPlayingItem?.Id);
            if (!candidates.length) return '';
            candidates.sort((a, b) => Number(Boolean(b.PlayState?.PositionTicks)) - Number(Boolean(a.PlayState?.PositionTicks)));
            const id = candidates[0].NowPlayingItem.Id;
            if (id) setStored(LAST_ITEM_KEY, id);
            return id || '';
        } catch (error) {
            console.debug('[Velvet Antenna v0.22] unable to resolve playback session', error);
            return '';
        }
    }

    function playerControlsHost() {
        return document.querySelector('.videoOsdBottom:not(.hide)') ||
            document.querySelector('.videoOsdBottom') ||
            document.querySelector('.videoOsdPage:not(.hide) .osdControls') ||
            document.querySelector('.videoOsdPage:not(.hide)');
    }

    function mountSearchButton() {
        const existing = document.getElementById(BUTTON_ID);
        if (!playbackActive()) {
            existing?.remove();
            return;
        }
        if (existing) return;
        const native = document.querySelector('.videoOsdPage:not(.hide) .btnSubtitles, .videoOsdBottom .btnSubtitles, .btnSubtitles');
        const host = native?.parentElement || playerControlsHost();
        if (!host) return;
        const button = document.createElement('button');
        button.type = 'button';
        button.id = BUTTON_ID;
        button.className = 'va22-subtitle-search';
        button.setAttribute('aria-label', 'Find subtitles online');
        button.title = 'Find subtitles online';
        button.innerHTML = '<span aria-hidden="true">CC</span><b>+</b>';
        if (native?.parentElement) native.insertAdjacentElement('afterend', button);
        else host.appendChild(button);
    }

    async function fetchItem(id) {
        const client = api();
        const user = uid();
        if (!client || !user || !id || typeof client.getItem !== 'function') return null;
        try { return await client.getItem(user, id); } catch (error) { return null; }
    }

    async function loadCultures() {
        if (STATE.cultures.length) return STATE.cultures;
        const client = api();
        if (!client || typeof client.getCultures !== 'function') return [];
        try {
            const values = await client.getCultures();
            STATE.cultures = Array.isArray(values) ? values : [];
            return STATE.cultures;
        } catch (error) { return []; }
    }

    async function preferredLanguage() {
        const client = api();
        if (!client || typeof client.getCurrentUser !== 'function') return 'eng';
        try {
            const user = await client.getCurrentUser();
            return user?.Configuration?.SubtitleLanguagePreference || 'eng';
        } catch (error) { return 'eng'; }
    }

    function subtitleStreams(item) {
        const sources = Array.isArray(item?.MediaSources) ? item.MediaSources : [];
        const streams = sources.length && Array.isArray(sources[0].MediaStreams)
            ? sources[0].MediaStreams
            : (Array.isArray(item?.MediaStreams) ? item.MediaStreams : []);
        return streams.filter(stream => String(stream.Type || '').toLowerCase() === 'subtitle');
    }

    async function openOverlay() {
        closeOverlay();
        const itemId = await resolvePlaybackItemId();
        const overlay = document.createElement('section');
        overlay.id = OVERLAY_ID;
        overlay.className = 'va22-subtitle-overlay';
        overlay.innerHTML = `
            <div class="va22-subtitle-overlay__backdrop" data-va22-sub-action="close"></div>
            <div class="va22-subtitle-overlay__panel">
                <header>
                    <div><span>VA / LIVE SUBTITLES</span><h2>Find subtitles without leaving the show.</h2><p class="va22-subtitle-overlay__item"></p></div>
                    <button type="button" class="va22-subtitle-overlay__close" data-va22-sub-action="close" aria-label="Close">×</button>
                </header>
                <div class="va22-subtitle-current"></div>
                <form class="va22-subtitle-search-form">
                    <label><span>LANGUAGE</span><select></select></label>
                    <button type="submit">SEARCH PROVIDERS</button>
                </form>
                <div class="va22-subtitle-status"></div>
                <div class="va22-subtitle-results"></div>
            </div>
        `;
        document.body.appendChild(overlay);
        if (!itemId) {
            overlay.querySelector('.va22-subtitle-overlay__item').textContent = 'Could not identify the currently playing item.';
            overlay.querySelector('.va22-subtitle-status').textContent = 'Start playback from a Velvet Antenna or Jellyfin item page and try again.';
            overlay.querySelector('.va22-subtitle-search-form').hidden = true;
            return;
        }
        setStored(LAST_ITEM_KEY, itemId);
        const [item, cultures, preferred] = await Promise.all([fetchItem(itemId), loadCultures(), preferredLanguage()]);
        if (!overlay.isConnected) return;
        if (!item) {
            overlay.querySelector('.va22-subtitle-overlay__item').textContent = 'Jellyfin could not load this item.';
            overlay.querySelector('.va22-subtitle-search-form').hidden = true;
            return;
        }
        STATE.searchItem = item;
        STATE.results = [];
        overlay.querySelector('.va22-subtitle-overlay__item').textContent = [item.SeriesName, item.Name].filter(Boolean).join(' • ') || 'Now playing';
        renderCurrentSubtitles(overlay, item);
        fillLanguageSelect(overlay, cultures, preferred);
        overlay.querySelector('.va22-subtitle-status').textContent = 'Search your configured Jellyfin subtitle providers. Downloaded files are saved back to Jellyfin.';
    }

    function renderCurrentSubtitles(overlay, item) {
        const host = overlay.querySelector('.va22-subtitle-current');
        const subs = subtitleStreams(item);
        if (!subs.length) {
            host.innerHTML = '<span>NO LOCAL SUBTITLES</span><b>This is exactly what CC+ is for.</b>';
            return;
        }
        host.innerHTML = '<span>AVAILABLE NOW</span><div></div>';
        const list = host.querySelector('div');
        subs.slice(0, 8).forEach(stream => {
            const chip = document.createElement('i');
            chip.textContent = stream.DisplayTitle || stream.Language || 'Subtitle';
            list.appendChild(chip);
        });
    }

    function fillLanguageSelect(overlay, cultures, preferred) {
        const select = overlay.querySelector('select');
        select.innerHTML = '';
        const sorted = [...(cultures || [])].sort((a, b) => String(a.DisplayName || '').localeCompare(String(b.DisplayName || '')));
        if (!sorted.length) {
            select.innerHTML = '<option value="eng">English</option>';
            return;
        }
        sorted.forEach(culture => {
            const option = document.createElement('option');
            option.value = culture.ThreeLetterISOLanguageName || culture.TwoLetterISOLanguageName || '';
            option.textContent = culture.DisplayName || option.value;
            if (normalise(option.value) === normalise(preferred)) option.selected = true;
            select.appendChild(option);
        });
        if (![...select.options].some(option => option.selected) && select.options.length) select.selectedIndex = 0;
    }

    async function searchRemote(overlay) {
        const client = api();
        const item = STATE.searchItem;
        if (!client || !item || typeof client.getJSON !== 'function') return;
        const select = overlay.querySelector('select');
        const language = select.value;
        const label = select.options[select.selectedIndex]?.textContent || language;
        const status = overlay.querySelector('.va22-subtitle-status');
        const host = overlay.querySelector('.va22-subtitle-results');
        status.textContent = `Searching ${label} subtitles…`;
        host.innerHTML = '<div class="va22-subtitle-spinner">TUNING PROVIDERS…</div>';
        try {
            const url = client.getUrl('Items/' + item.Id + '/RemoteSearch/Subtitles/' + encodeURIComponent(language));
            const results = await client.getJSON(url);
            STATE.results = Array.isArray(results) ? results : [];
            renderResults(overlay, language, label);
        } catch (error) {
            console.error('[Velvet Antenna v0.22] subtitle search failed', error);
            host.innerHTML = '';
            status.textContent = 'Subtitle search failed. Check the provider plugin configuration and server logs.';
        }
    }

    function renderResults(overlay, language, languageLabel) {
        const status = overlay.querySelector('.va22-subtitle-status');
        const host = overlay.querySelector('.va22-subtitle-results');
        host.innerHTML = '';
        if (!STATE.results.length) {
            status.textContent = `No ${languageLabel} subtitle matches were returned by the configured providers.`;
            return;
        }
        status.textContent = `${STATE.results.length} matches found • strongest matches first when the provider supplies match data`;
        STATE.results.slice(0, 30).forEach((result, index) => {
            const row = document.createElement('article');
            row.className = 'va22-subtitle-result';
            const flags = [];
            if (result.IsHashMatch) flags.push('PERFECT MATCH');
            if (result.Forced) flags.push('FORCED');
            if (result.HearingImpaired) flags.push('SDH');
            if (result.AiTranslated) flags.push('AI TRANSLATED');
            if (result.MachineTranslated) flags.push('MACHINE');
            const meta = [result.ProviderName, result.Format?.toUpperCase(), result.DownloadCount != null ? result.DownloadCount + ' downloads' : '', result.FrameRate ? result.FrameRate + ' fps' : ''].filter(Boolean);
            row.innerHTML = `
                <div class="va22-subtitle-result__copy"><h3></h3><p></p><div class="va22-subtitle-result__flags"></div></div>
                <button type="button" data-va22-sub-action="download" data-index="${index}" data-language="${language}" data-language-label="${languageLabel.replace(/"/g, '&quot;')}">DOWNLOAD & USE</button>
            `;
            row.querySelector('h3').textContent = result.Name || `${languageLabel} subtitle`;
            row.querySelector('p').textContent = meta.join(' • ');
            const flagHost = row.querySelector('.va22-subtitle-result__flags');
            flags.forEach(flag => {
                const span = document.createElement('span');
                span.textContent = flag;
                flagHost.appendChild(span);
            });
            host.appendChild(row);
        });
    }

    async function downloadAndUse(button) {
        const client = api();
        const item = STATE.searchItem;
        const result = STATE.results[Number(button.getAttribute('data-index'))];
        if (!client || !item || !result || typeof client.ajax !== 'function') return;
        const language = button.getAttribute('data-language') || 'eng';
        const languageLabel = button.getAttribute('data-language-label') || language;
        const overlay = document.getElementById(OVERLAY_ID);
        const status = overlay?.querySelector('.va22-subtitle-status');
        const video = document.querySelector('video');
        const seconds = Number(video?.currentTime || 0);
        const before = new Set(subtitleStreams(item).map(stream => String(stream.Index)));
        button.disabled = true;
        button.textContent = 'DOWNLOADING…';
        if (status) status.textContent = `Downloading ${languageLabel} subtitles to Jellyfin…`;
        try {
            const url = client.getUrl('Items/' + item.Id + '/RemoteSearch/Subtitles/' + encodeURIComponent(result.Id));
            await client.ajax({ type: 'POST', url });
            if (status) status.textContent = 'Subtitle downloaded. Waiting for Jellyfin to index the new track…';
            const refreshed = await waitForNewSubtitle(item.Id, before, language);
            if (refreshed) STATE.searchItem = refreshed;
            const restart = {
                id: String(item.Id),
                seconds,
                language,
                languageLabel,
                resultName: result.Name || '',
                created: Date.now(),
                playClicked: false
            };
            setStored(RESTART_KEY, JSON.stringify(restart));
            setStored(LAST_ITEM_KEY, String(item.Id));
            closeOverlay();
            showToast(`Downloaded ${languageLabel}. Reloading the player at ${formatTime(seconds)}…`, 3200);
            beginSubtitleRestart(restart);
        } catch (error) {
            console.error('[Velvet Antenna v0.22] subtitle download failed', error);
            button.disabled = false;
            button.textContent = 'DOWNLOAD & USE';
            if (status) status.textContent = 'Jellyfin could not download that subtitle. Try another match or check the provider plugin.';
        }
    }

    async function waitForNewSubtitle(itemId, before, language) {
        for (let attempt = 0; attempt < 7; attempt += 1) {
            await new Promise(resolve => window.setTimeout(resolve, attempt === 0 ? 600 : 850));
            const item = await fetchItem(itemId);
            if (!item) continue;
            const subs = subtitleStreams(item);
            const added = subs.find(stream => !before.has(String(stream.Index))) ||
                subs.find(stream => normalise(stream.Language) === normalise(language));
            if (added) return item;
        }
        return await fetchItem(itemId);
    }

    function beginSubtitleRestart(restart) {
        if (!restart?.id) return;
        STATE.restarting = true;
        STATE.selectAttempts = 0;
        window.location.hash = detailsHash(restart.id).slice(1);
        scheduleRestartPasses();
    }

    function scheduleRestartPasses() {
        [100, 350, 800, 1400, 2300, 3600, 5200, 7500].forEach(delay => window.setTimeout(trySubtitleRestart, delay));
    }

    function readRestart() {
        const pending = safeJson(getStored(RESTART_KEY));
        if (!pending?.id) return null;
        if (Date.now() - Number(pending.created || 0) > MAX_RESTART_AGE) {
            removeStored(RESTART_KEY);
            return null;
        }
        return pending;
    }

    function writeRestart(pending) {
        setStored(RESTART_KEY, JSON.stringify(pending));
    }

    function safeNativePlay() {
        const blocked = /sync\s*play|watch\s*together|remote\s*play|play\s*to|join\s*group/i;
        const buttons = Array.from(document.querySelectorAll('.btnPlay')).filter(button => {
            const label = [button.textContent, button.getAttribute('aria-label'), button.getAttribute('title'), button.className].filter(Boolean).join(' ');
            return button.isConnected && !button.disabled && !blocked.test(label);
        });
        return buttons.find(button => button.offsetParent !== null) || buttons[0] || null;
    }

    function trySubtitleRestart() {
        const pending = readRestart();
        if (!pending) {
            STATE.restarting = false;
            return;
        }
        if (playbackActive() && document.querySelector('video')) {
            restorePlaybackPosition(pending);
            attemptSubtitleSelection(pending);
            return;
        }
        if (isDetails() && currentDetailsId() === String(pending.id)) {
            if (!pending.playClicked) {
                const play = safeNativePlay();
                if (play) {
                    pending.playClicked = true;
                    writeRestart(pending);
                    play.click();
                }
            }
            return;
        }
        if (!playbackActive()) window.location.hash = detailsHash(pending.id).slice(1);
    }

    function restorePlaybackPosition(pending) {
        const video = document.querySelector('video');
        if (!video || !Number.isFinite(Number(pending.seconds)) || Number(pending.seconds) <= 0) return;
        const target = Number(pending.seconds);
        const apply = () => {
            try {
                if (Number.isFinite(video.duration) && video.duration > target && Math.abs(Number(video.currentTime || 0) - target) > 4) {
                    video.currentTime = target;
                }
            } catch (error) { /* player may not be seekable yet */ }
        };
        if (video.readyState >= 1) apply();
        else video.addEventListener('loadedmetadata', apply, { once: true });
    }

    function attemptSubtitleSelection(pending) {
        const native = document.querySelector('.videoOsdPage:not(.hide) .btnSubtitles:not(.hide), .videoOsdBottom .btnSubtitles:not(.hide), .btnSubtitles:not(.hide)');
        if (!native) {
            if (STATE.selectAttempts++ < 18) window.setTimeout(() => attemptSubtitleSelection(pending), 450);
            else finishRestart(false, pending);
            return;
        }
        native.click();
        window.setTimeout(() => {
            const dialogs = Array.from(document.querySelectorAll('.dialog.opened, .actionSheet.opened, .dialogContainer .dialog'))
                .filter(dialog => dialog.offsetParent !== null);
            const dialog = dialogs[dialogs.length - 1];
            if (!dialog) {
                if (STATE.selectAttempts++ < 18) window.setTimeout(() => attemptSubtitleSelection(pending), 450);
                else finishRestart(false, pending);
                return;
            }
            const needle = normalise(pending.languageLabel).split(/\s+/)[0];
            const candidates = Array.from(dialog.querySelectorAll('button, .listItem, [role="button"]')).filter(node => {
                const value = normalise(node.textContent);
                return value && value !== 'off' && value.includes(needle);
            });
            if (candidates.length) {
                candidates[candidates.length - 1].click();
                finishRestart(true, pending);
            } else if (STATE.selectAttempts++ < 18) {
                window.setTimeout(() => attemptSubtitleSelection(pending), 450);
            } else {
                finishRestart(false, pending);
            }
        }, 250);
    }

    function finishRestart(selected, pending) {
        removeStored(RESTART_KEY);
        STATE.restarting = false;
        STATE.selectAttempts = 0;
        if (selected) showToast(`${pending.languageLabel} subtitles loaded.`, 3000);
        else showToast(`${pending.languageLabel} downloaded. Open CC to select it if Jellyfin did not select it automatically.`, 5200);
        schedulePasses();
    }

    function showToast(message, duration) {
        document.getElementById('va22-toast')?.remove();
        const toast = document.createElement('div');
        toast.id = 'va22-toast';
        toast.className = 'va22-toast';
        toast.textContent = message;
        document.body.appendChild(toast);
        window.setTimeout(() => toast.classList.add('is-visible'), 10);
        window.setTimeout(() => {
            toast.classList.remove('is-visible');
            window.setTimeout(() => toast.remove(), 260);
        }, duration || 3200);
    }

    function closeOverlay() {
        document.getElementById(OVERLAY_ID)?.remove();
        STATE.searchItem = null;
        STATE.results = [];
    }

    function onClick(event) {
        capturePlaybackIntent(event);
        const target = event.target;
        if (!target || typeof target.closest !== 'function') return;
        if (target.closest('#' + BUTTON_ID)) {
            event.preventDefault();
            event.stopPropagation();
            if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
            openOverlay();
            return;
        }
        const action = target.closest('[data-va22-sub-action]');
        if (!action) return;
        const kind = action.getAttribute('data-va22-sub-action');
        event.preventDefault();
        event.stopPropagation();
        if (kind === 'close') closeOverlay();
        if (kind === 'download') downloadAndUse(action);
    }

    function onSubmit(event) {
        if (!event.target?.matches('.va22-subtitle-search-form')) return;
        event.preventDefault();
        const overlay = document.getElementById(OVERLAY_ID);
        if (overlay) searchRemote(overlay);
    }

    function onKey(event) {
        if (event.key === 'Escape' && document.getElementById(OVERLAY_ID)) closeOverlay();
    }

    function schedulePasses() {
        STATE.timers.forEach(timer => window.clearTimeout(timer));
        STATE.timers = [];
        [0, 250, 700, 1400, 2600, 4300].forEach(delay => {
            STATE.timers.push(window.setTimeout(() => {
                mountSearchButton();
                if (readRestart()) trySubtitleRestart();
            }, delay));
        });
    }

    document.addEventListener('click', onClick, true);
    document.addEventListener('submit', onSubmit, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('hashchange', schedulePasses);
    window.addEventListener('popstate', schedulePasses);
    schedulePasses();

    window.VelvetAntenna22 = Object.assign(window.VelvetAntenna22 || {}, {
        openSubtitleSearch: openOverlay
    });

    console.log('[Velvet Antenna] v' + VERSION + ' live subtitle search loaded');
})();(function () {
  'use strict';

  const VERSION = '0.22.4';
  const NAV_ID = 'va224-nav';
  const ROUTE_PREFIX = 'velvet-antenna-v0224:route:';
  const PARENT_PREFIX = 'velvet-antenna-v0224:parent:';
  const LAST_KIND_KEY = 'velvet-antenna-v0224:last-kind';
  const PENDING_KIND_KEY = 'velvet-antenna-v0224:pending-kind';
  const CORE = ['movies', 'series', 'collections'];
  const LABELS = { movies: 'MOVIES', series: 'SERIES', collections: 'COLLECTIONS' };

  const state = {
    routes: Object.create(null),
    parents: Object.create(null),
    userViews: null,
    viewsPromise: null,
    pendingKind: '',
    timers: [],
    pendingTimers: []
  };

  const api = () => window.ApiClient || null;
  const uid = () => {
    const client = api();
    try { return client && typeof client.getCurrentUserId === 'function' ? (client.getCurrentUserId() || '') : ''; }
    catch (e) { return ''; }
  };
  const sid = () => {
    const client = api();
    try {
      if (!client) return '';
      if (typeof client.serverId === 'function') return client.serverId() || '';
      if (typeof client.serverInfo === 'function') return client.serverInfo()?.Id || '';
      return client.serverId || client._serverId || '';
    } catch (e) { return ''; }
  };
  const route = () => String(location.hash || '');
  const normalise = value => String(value || '').trim().toLowerCase();
  const get = key => { try { return sessionStorage.getItem(key) || ''; } catch (e) { return ''; } };
  const set = (key, value) => { try { sessionStorage.setItem(key, String(value || '')); } catch (e) {} };
  const parseParent = value => {
    const match = String(value || '').match(/[?&](?:topParentId|parentId)=([^&]+)/i);
    return match?.[1] ? decodeURIComponent(match[1]) : '';
  };

  function isPlayback() {
    return /videoosd|nowplaying|playback/i.test(route()) ||
      Boolean(document.querySelector('.videoPlayerContainer:not(.hide), .videoOsdPage:not(.hide)'));
  }
  function isAdmin() { return /dashboard|configurationpage|scheduledtasks|logs|networking|plugins|metadataeditor/i.test(route()); }
  function viewerRoute() { return !isPlayback() && !isAdmin(); }

  function lastKind() { return get(LAST_KIND_KEY); }
  function setLastKind(kind) { set(LAST_KIND_KEY, kind); }
  function routeFor(kind) { return state.routes[kind] || get(ROUTE_PREFIX + kind); }
  function parentFor(kind) { return state.parents[kind] || get(PARENT_PREFIX + kind); }
  function rememberRoute(kind, value) {
    if (!kind || !value) return;
    state.routes[kind] = value;
    set(ROUTE_PREFIX + kind, value);
  }
  function rememberParent(kind, value) {
    if (!kind || !value) return;
    state.parents[kind] = value;
    set(PARENT_PREFIX + kind, value);
  }

  function routeKind() {
    const value = route().toLowerCase();
    if (value.startsWith('#/movies')) return 'movies';
    if (value.startsWith('#/tv')) return 'series';
    if (value.startsWith('#/collections') || value.startsWith('#/boxsets')) return 'collections';
    if (/[?&](?:topparentid|parentid)=/i.test(value) && CORE.includes(lastKind())) return lastKind();
    if (value === '#/home' || value.startsWith('#/home?')) return 'home';
    if (value.startsWith('#/search')) return 'search';
    if (/details\?id=|\/details\//i.test(value)) return 'details';
    return '';
  }

  function cardTitle(card) {
    if (!card) return '';
    for (const selector of ['.cardText-first', '.cardText', '.itemName', '[title]']) {
      const el = card.querySelector(selector);
      const value = String(el?.textContent || el?.getAttribute?.('title') || '').trim();
      if (value) return value;
    }
    return String(card.getAttribute('aria-label') || card.getAttribute('title') || '').trim();
  }
  function cardHref(card) {
    if (!card) return '';
    const link = card.closest('a[href]') || card.querySelector('a[href]');
    if (link) return link.getAttribute('href') || '';
    const node = card.querySelector('[data-href]') || (card.hasAttribute('data-href') ? card : null);
    return node?.getAttribute('data-href') || '';
  }
  function cardItemId(card) {
    if (!card) return '';
    for (const node of [card, card.querySelector('[data-id]'), card.querySelector('[data-itemid]')].filter(Boolean)) {
      const value = node.getAttribute('data-id') || node.getAttribute('data-itemid') || node.dataset?.id || node.dataset?.itemid || node.dataset?.itemId;
      if (value) return String(value);
    }
    const match = cardHref(card).match(/[?&]id=([^&]+)/i);
    return match?.[1] ? decodeURIComponent(match[1]) : '';
  }
  function kindForTitle(title) {
    const value = normalise(title);
    if (/^movies?$/.test(value)) return 'movies';
    if (/^(shows?|series|tv shows?)$/.test(value)) return 'series';
    if (/^collections?$/.test(value)) return 'collections';
    return '';
  }
  function nativeCards() {
    return Array.from(document.querySelectorAll('.card'))
      .map(card => ({ card, kind: kindForTitle(cardTitle(card)) }))
      .filter(entry => entry.kind);
  }
  function captureNative() {
    nativeCards().forEach(({ card, kind }) => {
      const href = cardHref(card);
      const id = cardItemId(card);
      if (href) rememberRoute(kind, href);
      if (id) rememberParent(kind, id);
    });
  }
  function nativeCard(kind) { return nativeCards().find(entry => entry.kind === kind)?.card || null; }

  async function userViews() {
    if (state.userViews?.length) return state.userViews;
    if (state.viewsPromise) return state.viewsPromise;
    const client = api();
    const user = uid();
    if (!client || !user) return [];
    state.viewsPromise = (async () => {
      let items = [];
      try {
        if (typeof client.getUserViews === 'function') {
          const result = await client.getUserViews({}, user);
          items = Array.isArray(result?.Items) ? result.Items : [];
        }
      } catch (e) {}
      if (!items.length && typeof client.getJSON === 'function' && typeof client.getUrl === 'function') {
        try {
          const result = await client.getJSON(client.getUrl('Users/' + encodeURIComponent(user) + '/Views'));
          items = Array.isArray(result?.Items) ? result.Items : [];
        } catch (e) {}
      }
      if (items.length) state.userViews = items;
      return items;
    })();
    try { return await state.viewsPromise; }
    finally { if (!state.userViews?.length) state.viewsPromise = null; }
  }

  function classifyView(view) {
    const type = normalise(view?.CollectionType);
    const name = normalise(view?.Name);
    if (type === 'movies') return 'movies';
    if (type === 'tvshows') return 'series';
    if (type === 'boxsets') return 'collections';
    if (/^movies?$/.test(name)) return 'movies';
    if (/^(shows?|series|tv shows?)$/.test(name)) return 'series';
    if (/^collections?$/.test(name)) return 'collections';
    return '';
  }

  async function resolveApiRoutes() {
    for (const view of await userViews()) {
      const kind = classifyView(view);
      if (!kind) continue;
      rememberParent(kind, view.Id);
      if (routeFor(kind)) continue;
      const id = encodeURIComponent(view.Id || '');
      const type = normalise(view.CollectionType);
      let value = '';
      if (kind === 'movies' && type === 'movies') value = '#/movies?topParentId=' + id + '&collectionType=movies';
      else if (kind === 'series' && type === 'tvshows') value = '#/tv?topParentId=' + id + '&collectionType=tvshows';
      else value = '#/list?parentId=' + id;
      if (value) rememberRoute(kind, value);
    }
  }

  function navigate(value) {
    if (!value) return;
    if (value.startsWith('#')) location.hash = value.slice(1);
    else if (value.includes('#/')) location.hash = value.slice(value.indexOf('#') + 1);
    else location.href = value;
  }

  function recordPendingRoute() {
    const pending = state.pendingKind || get(PENDING_KIND_KEY);
    if (!CORE.includes(pending)) return;
    const value = route();
    if (!value || value === '#/home') return;
    if (routeKind() === pending || parseParent(value)) {
      rememberRoute(pending, value);
      const parent = parseParent(value);
      if (parent) rememberParent(pending, parent);
      state.pendingKind = '';
      set(PENDING_KIND_KEY, '');
    }
  }

  function clickNativeWhenReady(kind) {
    state.pendingTimers.forEach(clearTimeout);
    state.pendingTimers = [];
    [100, 260, 550, 1000, 1800, 3000].forEach(delay => {
      state.pendingTimers.push(setTimeout(async () => {
        if ((state.pendingKind || get(PENDING_KIND_KEY)) !== kind) return;
        captureNative();
        const card = nativeCard(kind);
        if (card) {
          const id = cardItemId(card);
          if (id) rememberParent(kind, id);
          card.click();
          return;
        }
        if (delay >= 1000) {
          await resolveApiRoutes();
          if (routeFor(kind)) navigate(routeFor(kind));
        }
      }, delay));
    });
  }

  async function navigateKind(kind) {
    if (!CORE.includes(kind)) return;
    setLastKind(kind);
    if (routeFor(kind)) return navigate(routeFor(kind));
    captureNative();
    const card = nativeCard(kind);
    if (card) {
      const id = cardItemId(card);
      if (id) rememberParent(kind, id);
      state.pendingKind = kind;
      set(PENDING_KIND_KEY, kind);
      card.click();
      return;
    }
    await resolveApiRoutes();
    if (routeFor(kind)) return navigate(routeFor(kind));
    state.pendingKind = kind;
    set(PENDING_KIND_KEY, kind);
    location.hash = '#/home';
    clickNativeWhenReady(kind);
  }

  function openProfile() {
    for (const selector of ['.headerUserButton', '.headerUserButtonRound', '[aria-label*="profile" i]', '[title*="profile" i]']) {
      const el = document.querySelector(selector);
      if (el && typeof el.click === 'function') return el.click();
    }
  }

  function navButton(label, kind, handler) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'va224-nav__item';
    button.textContent = label;
    if (kind) button.dataset.va224Kind = kind;
    button.addEventListener('click', handler);
    return button;
  }

  function buildNav() {
    const nav = document.createElement('nav');
    nav.id = NAV_ID;
    nav.innerHTML = '<div class="va224-nav__identity"><button type="button" class="va224-nav__back" aria-label="Back">←</button><button type="button" class="va224-nav__brand"><span class="va224-mark"><i></i><i></i><i></i><i></i></span><b>VELVET ANTENNA</b></button></div><div class="va224-nav__primary"></div><div class="va224-nav__utility"></div>';
    nav.querySelector('.va224-nav__back').addEventListener('click', () => {
      if (routeKind() === 'home') return;
      if (history.length > 1) history.back(); else location.hash = '#/home';
    });
    nav.querySelector('.va224-nav__brand').addEventListener('click', () => { location.hash = '#/home'; });
    const primary = nav.querySelector('.va224-nav__primary');
    primary.appendChild(navButton('HOME', 'home', () => { location.hash = '#/home'; }));
    CORE.forEach(kind => primary.appendChild(navButton(LABELS[kind], kind, () => navigateKind(kind))));
    const tonight = navButton('TONIGHT', 'tonight', () => window.VA224?.openTonight?.());
    tonight.classList.add('va224-nav__tonight');
    primary.appendChild(tonight);
    const utility = nav.querySelector('.va224-nav__utility');
    utility.appendChild(navButton('SEARCH', 'search', () => { location.hash = '#/search'; }));
    utility.appendChild(navButton('PROFILE', 'profile', openProfile));
    return nav;
  }

  function ensureNav() {
    if (!viewerRoute() || !document.body) {
      document.getElementById(NAV_ID)?.remove();
      return;
    }
    let nav = document.getElementById(NAV_ID);
    if (!nav) {
      nav = buildNav();
      document.body.insertBefore(nav, document.body.firstChild);
    }
    const active = routeKind();
    nav.querySelectorAll('[data-va224-kind]').forEach(button => button.classList.toggle('is-active', button.dataset.va224Kind === active));
    nav.querySelector('.va224-nav__back').disabled = active === 'home';
  }

  function setRouteClass() {
    if (!document.body) return;
    ['home','library','search','details','other'].forEach(kind => document.body.classList.remove('va224-route-' + kind));
    const current = routeKind();
    const kind = current === 'home' ? 'home' : CORE.includes(current) ? 'library' : current === 'search' ? 'search' : current === 'details' ? 'details' : 'other';
    document.body.classList.add('va224-active', 'va224-route-' + kind);
    document.body.dataset.vaVersion = VERSION;
  }

  function dispatchRoute() {
    window.dispatchEvent(new CustomEvent('va224:route', { detail: { kind: routeKind(), route: route() } }));
  }

  function pass() {
    setRouteClass();
    ensureNav();
    captureNative();
    recordPendingRoute();
    if ((state.pendingKind || get(PENDING_KIND_KEY)) && routeKind() === 'home') clickNativeWhenReady(state.pendingKind || get(PENDING_KIND_KEY));
    dispatchRoute();
  }

  function schedule() {
    state.timers.forEach(clearTimeout);
    state.timers = [];
    [0, 80, 220, 500, 1000, 1800].forEach(delay => state.timers.push(setTimeout(pass, delay)));
  }

  function activate() {
    if (!document.body) return;
    pass();
    schedule();
    resolveApiRoutes();
  }

  window.VA224 = {
    VERSION, CORE, state, api, uid, sid, route, routeKind, parseParent,
    routeFor, parentFor, rememberRoute, rememberParent, cardItemId,
    navigateKind, navigate, setLastKind
  };

  addEventListener('hashchange', () => { recordPendingRoute(); schedule(); });
  addEventListener('popstate', schedule);
  addEventListener('resize', ensureNav);
  if (document.body) activate();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', activate, { once: true });
  else setTimeout(activate, 0);

  console.log('[Velvet Antenna] v0.22.4 clean shell loaded');
})();
(function () {
  'use strict';

  const C = window.VA224;
  if (!C) return;

  const HOME_ID = 'va224-home';
  const TONIGHT_ID = 'va22-tonight';
  const FAST_TTL = 3 * 60 * 1000;
  const FAST_FIELDS = [
    'Overview','Genres','DateCreated','ProviderIds','PrimaryImageAspectRatio',
    'ParentBackdropImageTags','ParentBackdropItemId','BackdropImageTags'
  ].join(',');

  const state = {
    data: null,
    fetchedAt: 0,
    promise: null,
    renderToken: 0
  };

  function detailsHash(id) {
    const server = C.sid();
    return '#/details?id=' + encodeURIComponent(id) + (server ? '&serverId=' + encodeURIComponent(server) : '');
  }
  function openDetails(id) {
    if (id) location.hash = detailsHash(id).slice(1);
  }
  function queuePlay(id) {
    if (!id) return;
    try { sessionStorage.setItem('velvet-antenna-v021:pending-local-play', JSON.stringify({ id: String(id), created: Date.now() })); }
    catch (e) {}
    openDetails(id);
  }

  function formatRuntime(ticks) {
    const value = Number(ticks || 0);
    if (!value) return '';
    const mins = Math.max(1, Math.round(value / 600000000));
    if (mins < 60) return mins + ' min';
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m ? h + 'h ' + m + 'm' : h + 'h';
  }
  function remainingMinutes(item) {
    const total = Number(item?.RunTimeTicks || 0);
    const pos = Number(item?.UserData?.PlaybackPositionTicks || 0);
    return total ? Math.max(1, Math.ceil(Math.max(0, total - pos) / 600000000)) : 0;
  }
  function finishClock(minutes) {
    const end = new Date(Date.now() + Math.max(0, Number(minutes || 0)) * 60000);
    return end.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  function unique(items) {
    const seen = new Set();
    return (items || []).filter(item => {
      const id = String(item?.Id || '');
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  }

  function imageUrl(item, type, width) {
    const client = C.api();
    if (!client || !item || typeof client.getImageUrl !== 'function') return '';
    const imageType = type || 'Primary';
    let id = item.Id;
    let tag = '';
    if (imageType === 'Backdrop') {
      tag = Array.isArray(item.BackdropImageTags) ? item.BackdropImageTags[0] : '';
      if (!tag && item.ParentBackdropItemId && Array.isArray(item.ParentBackdropImageTags)) {
        id = item.ParentBackdropItemId;
        tag = item.ParentBackdropImageTags[0] || '';
      }
    } else tag = item.ImageTags?.[imageType] || '';
    if (!id || !tag) return '';
    try { return client.getImageUrl(id, { type: imageType, index: 0, tag, maxWidth: width || 900, quality: 84 }); }
    catch (e) { return ''; }
  }

  async function waitForApi(timeout) {
    const start = Date.now();
    while (Date.now() - start < (timeout || 3500)) {
      if (C.api() && C.uid()) return true;
      await new Promise(resolve => setTimeout(resolve, 120));
    }
    return Boolean(C.api() && C.uid());
  }

  async function getItems(options) {
    const client = C.api();
    const user = C.uid();
    if (!client || !user || typeof client.getItems !== 'function') return [];
    try {
      const result = await client.getItems(user, Object.assign({ Fields: FAST_FIELDS, EnableTotalRecordCount: false }, options || {}));
      return Array.isArray(result?.Items) ? result.Items : [];
    } catch (e) {
      console.debug('[Velvet Antenna v0.22.4] fast getItems failed', e);
      return [];
    }
  }

  async function getNextUp(limit) {
    const client = C.api();
    const user = C.uid();
    if (!client || !user || typeof client.getNextUpEpisodes !== 'function') return [];
    try {
      const result = await client.getNextUpEpisodes({ UserId: user, Limit: limit || 12, Fields: FAST_FIELDS });
      return Array.isArray(result?.Items) ? result.Items : [];
    } catch (e) {
      console.debug('[Velvet Antenna v0.22.4] fast Next Up failed', e);
      return [];
    }
  }

  async function loadFastData(force) {
    if (!force && state.data && Date.now() - state.fetchedAt < FAST_TTL) return state.data;
    if (!force && state.promise) return state.promise;
    state.promise = (async () => {
      if (!(await waitForApi(3500))) return null;
      const [resume, nextUp, unwatched] = await Promise.all([
        getItems({ Recursive: true, IncludeItemTypes: 'Movie,Episode', Filters: 'IsResumable', SortBy: 'DatePlayed', SortOrder: 'Descending', Limit: 12 }),
        getNextUp(12),
        getItems({ Recursive: true, IncludeItemTypes: 'Movie', IsPlayed: false, SortBy: 'DateCreated', SortOrder: 'Descending', Limit: 30 })
      ]);
      const data = {
        resume,
        nextUp,
        unwatched,
        continueStory: unique([...resume, ...nextUp]).slice(0, 12),
        oneMore: unique(nextUp).filter(item => {
          const mins = remainingMinutes(item);
          return mins > 0 && mins <= 50;
        }).slice(0, 10)
      };
      state.data = data;
      state.fetchedAt = Date.now();
      return data;
    })();
    try { return await state.promise; }
    finally { state.promise = null; }
  }

  function signalScore(item, budget) {
    let score = 45;
    const reasons = [];
    const rating = Number(item?.CommunityRating || 0);
    if (rating) {
      score += Math.min(22, rating * 2.2);
      if (rating >= 7.5) reasons.push('highly rated');
    }
    const userData = item?.UserData || {};
    if (userData.PlaybackPositionTicks > 0 && !userData.Played) {
      score += 20;
      reasons.unshift('already in progress');
    } else if (!userData.Played) {
      score += 8;
      reasons.push('unwatched');
    }
    const mins = remainingMinutes(item);
    if (budget && mins && mins <= budget) {
      score += 14;
      reasons.unshift('fits your time');
    }
    return { score: Math.max(1, Math.min(99, Math.round(score))), reasons: reasons.slice(0, 3) };
  }

  function itemLabel(item) {
    if (!item) return '';
    if (item.Type === 'Episode') {
      const bits = [];
      if (item.SeriesName) bits.push(item.SeriesName);
      if (Number.isFinite(Number(item.ParentIndexNumber)) && Number.isFinite(Number(item.IndexNumber))) {
        bits.push('S' + String(item.ParentIndexNumber).padStart(2, '0') + 'E' + String(item.IndexNumber).padStart(2, '0'));
      }
      return bits.join(' • ');
    }
    return item.ProductionYear ? String(item.ProductionYear) : (item.Type || '');
  }

  function makeCard(item) {
    const card = document.createElement('article');
    card.className = 'va22-card va224-card';
    card.tabIndex = 0;
    card.dataset.va224Id = item.Id || '';
    const art = imageUrl(item, 'Backdrop', 900) || imageUrl(item, 'Primary', 560);
    const mins = remainingMinutes(item);
    const match = signalScore(item);
    card.innerHTML = '<div class="va22-card__art"></div><div class="va22-card__shade"></div><div class="va22-card__copy"><div class="va22-card__topline"><span class="va22-signal-match"></span><span class="va224-card-finish"></span></div><h3></h3><p class="va22-card__meta"></p><p class="va22-card__why"></p><div class="va22-card__actions"><button type="button" data-va224-card-action="open">DETAILS</button><button type="button" class="is-primary" data-va224-card-action="play">▶ PLAY</button></div></div>';
    if (art) card.querySelector('.va22-card__art').style.backgroundImage = 'url("' + art.replace(/"/g, '%22') + '")';
    card.querySelector('.va22-signal-match').textContent = match.score + '% MATCH';
    card.querySelector('.va224-card-finish').textContent = mins ? 'ENDS ' + finishClock(mins) : '';
    card.querySelector('h3').textContent = item.Name || item.SeriesName || 'Untitled';
    card.querySelector('.va22-card__meta').textContent = [itemLabel(item), mins ? formatRuntime(mins * 600000000) : formatRuntime(item.RunTimeTicks)].filter(Boolean).join(' • ');
    card.querySelector('.va22-card__why').textContent = match.reasons.length ? match.reasons.join(' • ') : 'from your library';
    if (!/^(Movie|Episode|Video|Audio)$/i.test(item.Type || '')) card.querySelector('[data-va224-card-action="play"]')?.remove();
    return card;
  }

  function makeSection(kicker, title, description, items) {
    if (!items?.length) return null;
    const section = document.createElement('section');
    section.className = 'va22-flow-section';
    section.innerHTML = '<header class="va22-flow-section__head"><div><span></span><h2></h2><p></p></div><b></b></header><div class="va22-rail"></div>';
    section.querySelector('span').textContent = kicker;
    section.querySelector('h2').textContent = title;
    section.querySelector('p').textContent = description;
    section.querySelector('b').textContent = String(items.length).padStart(2, '0');
    const rail = section.querySelector('.va22-rail');
    items.forEach(item => rail.appendChild(makeCard(item)));
    return section;
  }

  function createHome() {
    const home = document.createElement('main');
    home.id = HOME_ID;
    home.innerHTML = '<section class="va224-home-hero is-loading"><div class="va224-home-hero__art"></div><div class="va224-home-hero__shade"></div><div class="va224-home-hero__copy"><span>VA / ANTENNA FLOW</span><h1>Tuning your library.</h1><div class="va224-home-hero__meta">Building a fast signal from Jellyfin…</div><p>Velvet Antenna is preparing what matters now without scanning the whole library first.</p><div class="va224-home-hero__actions"></div></div><div class="va224-home-hero__signal"><i></i><i></i><i></i><i></i></div></section><section class="va22-tonight-teaser va224-tonight-teaser"><div class="va22-tonight-teaser__signal"><i></i><i></i><i></i><i></i></div><div class="va22-tonight-teaser__copy"><span>VA / TONIGHT</span><h2>Stop browsing. Start watching.</h2><p>Pick a time window and Velvet Antenna will cut the library down to a handful of sensible choices.</p></div><button type="button" data-va224-open-tonight>BUILD TONIGHT <b>→</b></button></section><div class="va224-home-sections"><section class="va224-skeleton"><span>VA / CONTINUITY</span><h2>Continue the story</h2><p>Loading your next useful choices…</p></section></div>';
    return home;
  }

  function ensureHome() {
    if (C.routeKind() !== 'home' || !document.body) {
      document.getElementById(HOME_ID)?.remove();
      return null;
    }
    let home = document.getElementById(HOME_ID);
    if (!home) {
      home = createHome();
      document.body.appendChild(home);
    }
    return home;
  }

  function renderHome(data) {
    const home = ensureHome();
    if (!home || !data) return;
    const heroItem = data.resume?.[0] || data.nextUp?.[0] || data.unwatched?.[0];
    const hero = home.querySelector('.va224-home-hero');
    if (heroItem && hero) {
      hero.classList.remove('is-loading');
      hero.dataset.va224Id = heroItem.Id;
      const art = imageUrl(heroItem, 'Backdrop', 1900) || imageUrl(heroItem, 'Primary', 900);
      if (art) hero.querySelector('.va224-home-hero__art').style.backgroundImage = 'url("' + art.replace(/"/g, '%22') + '")';
      const mins = remainingMinutes(heroItem);
      hero.querySelector('h1').textContent = heroItem.Name || heroItem.SeriesName || 'Tonight';
      hero.querySelector('.va224-home-hero__meta').textContent = [itemLabel(heroItem), mins ? formatRuntime(mins * 600000000) : formatRuntime(heroItem.RunTimeTicks), mins ? 'ENDS ' + finishClock(mins) : ''].filter(Boolean).join(' / ');
      hero.querySelector('p').textContent = heroItem.Overview || 'Continue where you left off, or open the details.';
      hero.querySelector('.va224-home-hero__actions').innerHTML = '<button type="button" class="is-primary" data-va224-hero-action="play">▶ PLAY</button><button type="button" data-va224-hero-action="open">DETAILS</button>';
    }
    const host = home.querySelector('.va224-home-sections');
    host.innerHTML = '';
    [
      makeSection('VA / CONTINUITY', 'Continue the story', 'Resume what matters, then move naturally to what comes next.', data.continueStory),
      makeSection('VA / SHORT SIGNAL', 'One more episode', 'Episodes that fit comfortably into the next hour.', data.oneMore),
      makeSection('VA / LOST & FOUND', 'Fresh from the library', 'Unwatched films surfaced quickly without scanning thousands of files.', data.unwatched.slice(0, 12))
    ].filter(Boolean).forEach(section => host.appendChild(section));
  }

  async function mountHome() {
    const home = ensureHome();
    if (!home) return;
    const token = ++state.renderToken;
    const data = await loadFastData(false);
    if (token !== state.renderToken || C.routeKind() !== 'home') return;
    if (data) renderHome(data);
    else home.querySelector('.va224-home-hero__meta').textContent = 'Jellyfin is still starting. Navigation is already available.';
  }

  function budgetFromFinishTime(value) {
    if (!/^\d{2}:\d{2}$/.test(String(value || ''))) return 120;
    const [hours, minutes] = value.split(':').map(Number);
    const now = new Date();
    const target = new Date(now);
    target.setHours(hours, minutes, 0, 0);
    if (target.getTime() <= now.getTime() + 5 * 60000) target.setDate(target.getDate() + 1);
    return Math.max(10, Math.min(480, Math.floor((target.getTime() - now.getTime()) / 60000)));
  }

  function candidates(data, budget) {
    return unique([...(data?.resume || []), ...(data?.nextUp || []), ...(data?.unwatched || [])])
      .filter(item => {
        const mins = remainingMinutes(item);
        return mins > 0 && mins <= budget;
      })
      .map(item => ({ item, match: signalScore(item, budget) }))
      .sort((a, b) => b.match.score - a.match.score || remainingMinutes(a.item) - remainingMinutes(b.item))
      .slice(0, 8);
  }

  function renderTonight(panel, data, budget) {
    const resultHost = panel.querySelector('.va22-tonight__results');
    const picks = candidates(data, budget);
    panel.querySelector('.va22-tonight__summary').textContent = formatRuntime(budget * 600000000) + ' available • ' + (picks.length ? 'best matches first' : 'no strong matches yet');
    resultHost.innerHTML = '';
    if (!picks.length) return resultHost.innerHTML = '<div class="va22-empty">Nothing cleanly fits that window. Try a little more time.</div>';
    picks.forEach(({ item, match }, index) => {
      const card = makeCard(item);
      card.classList.add('va22-tonight-card');
      card.querySelector('.va22-signal-match').textContent = match.score + '% MATCH';
      const rank = document.createElement('span');
      rank.className = 'va22-tonight-card__rank';
      rank.textContent = String(index + 1).padStart(2, '0');
      card.appendChild(rank);
      resultHost.appendChild(card);
    });
  }

  async function openTonight() {
    if (document.getElementById(TONIGHT_ID)) return;
    const panel = document.createElement('section');
    panel.id = TONIGHT_ID;
    panel.className = 'va22-tonight';
    const finish = new Date(Date.now() + 120 * 60000);
    const timeValue = String(finish.getHours()).padStart(2, '0') + ':' + String(finish.getMinutes()).padStart(2, '0');
    panel.dataset.va224Budget = '120';
    panel.innerHTML = '<div class="va22-tonight__backdrop" data-va224-tonight-action="close"></div><div class="va22-tonight__panel"><header><div><span>VA / TONIGHT</span><h1>How much evening do you have?</h1><p>This opens immediately and uses a small fast dataset rather than waiting on a whole-library scan.</p></div><button type="button" class="va22-tonight__close" data-va224-tonight-action="close" aria-label="Close">×</button></header><div class="va22-tonight__controls"><button type="button" data-va224-budget="30">30 MIN</button><button type="button" data-va224-budget="60">1 HOUR</button><button type="button" data-va224-budget="90">90 MIN</button><button type="button" class="is-active" data-va224-budget="120">2 HOURS</button><label><span>FINISH BY</span><input type="time" value="' + timeValue + '"></label><button type="button" data-va224-tonight-action="surprise">SURPRISE ME</button></div><div class="va22-tonight__summary">TUNING A FAST SIGNAL…</div><div class="va22-tonight__results"><div class="va22-empty">Loading a small candidate set from Jellyfin…</div></div></div>';
    document.body.appendChild(panel);
    document.body.classList.add('va22-tonight-open');
    const data = await loadFastData(false);
    if (!panel.isConnected) return;
    if (!data) {
      panel.querySelector('.va22-tonight__summary').textContent = 'Jellyfin is still starting';
      panel.querySelector('.va22-tonight__results').innerHTML = '<div class="va22-empty">Try again in a moment. The rest of Velvet Antenna remains usable.</div>';
      return;
    }
    renderTonight(panel, data, 120);
  }

  function closeTonight() {
    document.getElementById(TONIGHT_ID)?.remove();
    document.body.classList.remove('va22-tonight-open');
  }

  function click(event) {
    const target = event.target;
    if (!target?.closest) return;
    if (target.closest('[data-va224-open-tonight]')) {
      event.preventDefault();
      return openTonight();
    }
    const tonightAction = target.closest('[data-va224-tonight-action]');
    if (tonightAction) {
      event.preventDefault();
      const action = tonightAction.dataset.va224TonightAction;
      if (action === 'close') return closeTonight();
      if (action === 'surprise') {
        const panel = document.getElementById(TONIGHT_ID);
        const budget = Number(panel?.dataset.va224Budget || 120);
        const picks = candidates(state.data, budget);
        if (!panel || !picks.length) return;
        const pick = picks[Math.floor(Math.random() * Math.min(5, picks.length))];
        const host = panel.querySelector('.va22-tonight__results');
        host.innerHTML = '';
        host.appendChild(makeCard(pick.item));
        panel.querySelector('.va22-tonight__summary').textContent = 'SURPRISE SIGNAL • ' + pick.match.score + '% MATCH';
        return;
      }
    }
    const budgetButton = target.closest('[data-va224-budget]');
    if (budgetButton) {
      const panel = budgetButton.closest('#' + TONIGHT_ID);
      if (!panel || !state.data) return;
      const budget = Number(budgetButton.dataset.va224Budget || 120);
      panel.dataset.va224Budget = String(budget);
      panel.querySelectorAll('[data-va224-budget]').forEach(button => button.classList.toggle('is-active', button === budgetButton));
      return renderTonight(panel, state.data, budget);
    }
    const cardAction = target.closest('[data-va224-card-action]');
    if (cardAction) {
      const id = cardAction.closest('[data-va224-id]')?.dataset.va224Id;
      if (!id) return;
      event.preventDefault();
      return cardAction.dataset.va224CardAction === 'play' ? queuePlay(id) : openDetails(id);
    }
    const card = target.closest('.va224-card[data-va224-id]');
    if (card && event.button === 0 && !target.closest('button,a,input,select')) {
      event.preventDefault();
      return openDetails(card.dataset.va224Id);
    }
    const heroAction = target.closest('[data-va224-hero-action]');
    if (heroAction) {
      const id = heroAction.closest('[data-va224-id]')?.dataset.va224Id;
      if (!id) return;
      event.preventDefault();
      return heroAction.dataset.va224HeroAction === 'play' ? queuePlay(id) : openDetails(id);
    }
  }

  function change(event) {
    const input = event.target;
    if (!input?.matches?.('#' + TONIGHT_ID + ' input[type="time"]')) return;
    const panel = document.getElementById(TONIGHT_ID);
    if (!panel || !state.data) return;
    const budget = budgetFromFinishTime(input.value);
    panel.dataset.va224Budget = String(budget);
    panel.querySelectorAll('[data-va224-budget]').forEach(button => button.classList.remove('is-active'));
    renderTonight(panel, state.data, budget);
  }

  function routeChanged() {
    state.renderToken += 1;
    if (C.routeKind() === 'home') mountHome(); else document.getElementById(HOME_ID)?.remove();
  }

  C.openTonight = openTonight;
  C.loadFastData = loadFastData;
  C.getItems = getItems;
  C.imageUrl = imageUrl;
  C.formatRuntime = formatRuntime;
  C.openDetails = openDetails;
  C.queuePlay = queuePlay;

  addEventListener('va224:route', routeChanged);
  addEventListener('click', click, true);
  addEventListener('change', change, true);
  if (C.routeKind() === 'home') mountHome();

  console.log('[Velvet Antenna] v0.22.4 fast Antenna Flow loaded');
})();
(function () {
  'use strict';

  const C = window.VA224;
  if (!C) return;

  const STAGE_ID = 'va224-library-stage';
  const state = { token: 0, itemId: '', hoverTimer: null };

  function pageHost() {
    const pages = Array.from(document.querySelectorAll('.libraryPage, .page, [data-role="page"]'));
    return pages.find(el => el.offsetParent !== null && !el.closest('#va21-workbench')) || null;
  }

  function label(kind) {
    return {
      movies: ['MOVIES', 'Film without the filing cabinet.'],
      series: ['SERIES', 'Stories arranged around what you want to watch next.'],
      collections: ['COLLECTIONS', 'Franchises, worlds and curated sets.']
    }[kind] || ['LIBRARY', 'Your media, in focus.'];
  }

  function createStage(kind) {
    const copy = label(kind);
    const stage = document.createElement('section');
    stage.id = STAGE_ID;
    stage.innerHTML = '<div class="va224-stage__art"></div><div class="va224-stage__shade"></div><div class="va224-stage__copy"><div class="va224-stage__kicker"><span>VELVET LENS</span><b></b></div><h1></h1><div class="va224-stage__meta"></div><p></p><div class="va224-stage__actions"><button type="button" class="is-primary" data-va224-stage-action="open">OPEN</button><button type="button" data-va224-stage-action="play">PLAY</button></div></div><div class="va224-stage__side">IN THE LENS</div>';
    stage.querySelector('.va224-stage__kicker b').textContent = copy[0];
    stage.querySelector('h1').textContent = copy[0];
    stage.querySelector('.va224-stage__meta').textContent = 'LOCKING SIGNAL';
    stage.querySelector('p').textContent = copy[1];
    return stage;
  }

  function ensureStage() {
    const kind = C.routeKind();
    if (!C.CORE.includes(kind)) {
      document.getElementById(STAGE_ID)?.remove();
      return null;
    }
    const host = pageHost();
    if (!host) return null;
    let stage = document.getElementById(STAGE_ID);
    if (stage && !host.contains(stage)) {
      stage.remove();
      stage = null;
    }
    if (!stage) {
      stage = createStage(kind);
      host.insertBefore(stage, host.firstChild);
    }
    const copy = label(kind);
    stage.querySelector('.va224-stage__kicker b').textContent = copy[0];
    stage.dataset.va224Kind = kind;
    return stage;
  }

  async function getItem(id) {
    const client = C.api();
    const user = C.uid();
    if (!client || !user || !id || typeof client.getItem !== 'function') return null;
    try { return await client.getItem(user, id); }
    catch (e) { return null; }
  }

  async function firstItem(kind) {
    const parent = C.parseParent(C.route()) || C.parentFor(kind);
    if (!parent || typeof C.getItems !== 'function') return null;
    C.rememberParent(kind, parent);
    const types = kind === 'movies' ? 'Movie' : kind === 'series' ? 'Series' : 'BoxSet,Movie,Series';
    const items = await C.getItems({
      ParentId: parent,
      Recursive: kind !== 'collections',
      IncludeItemTypes: types,
      SortBy: 'SortName',
      SortOrder: 'Ascending',
      Limit: 1
    });
    return items[0] || null;
  }

  function render(stage, item, token) {
    if (!stage || !item || !stage.isConnected || token !== state.token) return;
    state.itemId = String(item.Id || '');
    stage.dataset.va224Id = state.itemId;
    stage.querySelector('h1').textContent = item.Name || 'Untitled';
    const bits = [];
    if (item.ProductionYear) bits.push(String(item.ProductionYear));
    const runtime = C.formatRuntime?.(item.RunTimeTicks);
    if (runtime) bits.push(runtime);
    if (item.OfficialRating) bits.push(item.OfficialRating);
    if (item.CommunityRating) bits.push('★ ' + Number(item.CommunityRating).toFixed(1));
    stage.querySelector('.va224-stage__meta').textContent = bits.join(' / ');
    stage.querySelector('p').textContent = item.Overview || 'No synopsis available.';
    const play = stage.querySelector('[data-va224-stage-action="play"]');
    if (play) play.hidden = !/^(Movie|Episode|Video|Audio)$/i.test(item.Type || '');
    const art = C.imageUrl?.(item, 'Backdrop', 1900) || C.imageUrl?.(item, 'Primary', 900) || '';
    stage.querySelector('.va224-stage__art').style.backgroundImage = art ? 'url("' + art.replace(/"/g, '%22') + '")' : '';
  }

  async function mount() {
    const kind = C.routeKind();
    if (!C.CORE.includes(kind)) {
      document.getElementById(STAGE_ID)?.remove();
      return;
    }
    const stage = ensureStage();
    if (!stage) return;
    const token = ++state.token;
    const item = await firstItem(kind);
    if (item) render(stage, item, token);
  }

  function focusCard(card, delay) {
    if (!card || !C.CORE.includes(C.routeKind())) return;
    const id = C.cardItemId(card);
    if (!id || id === state.itemId) return;
    clearTimeout(state.hoverTimer);
    state.hoverTimer = setTimeout(async () => {
      const stage = ensureStage();
      if (!stage) return;
      const token = ++state.token;
      const item = await getItem(id);
      if (item) render(stage, item, token);
    }, delay);
  }

  function pointer(event) {
    const card = event.target?.closest?.('.card');
    if (card && !card.closest('#' + STAGE_ID)) focusCard(card, 70);
  }
  function focus(event) {
    const card = event.target?.closest?.('.card');
    if (card && !card.closest('#' + STAGE_ID)) focusCard(card, 20);
  }
  function click(event) {
    const button = event.target?.closest?.('[data-va224-stage-action]');
    if (!button) return;
    const id = button.closest('#' + STAGE_ID)?.dataset.va224Id;
    if (!id) return;
    event.preventDefault();
    if (button.dataset.va224StageAction === 'play') C.queuePlay?.(id);
    else C.openDetails?.(id);
  }

  function routeChanged() {
    state.itemId = '';
    state.token += 1;
    if (C.CORE.includes(C.routeKind())) {
      [0,100,280,650,1200].forEach(delay => setTimeout(mount, delay));
    } else document.getElementById(STAGE_ID)?.remove();
  }

  addEventListener('va224:route', routeChanged);
  addEventListener('pointerover', pointer, true);
  addEventListener('focusin', focus, true);
  addEventListener('click', click, true);
  routeChanged();

  console.log('[Velvet Antenna] v0.22.4 deterministic Velvet Lens loaded');
})();
