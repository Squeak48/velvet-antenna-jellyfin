(function () {
    'use strict';

    const VERSION = '0.21.0';
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

