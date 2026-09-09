(function () {
    'use strict';

    const VERSION = '0.22.2';
    const ROUTE_PREFIX = 'velvet-antenna-v021:route:';
    const HUBS_ID = 'va22-tv-hubs';
    const CORE = ['movies', 'series', 'collections'];
    const OPTIONAL = ['anime', 'live'];
    const ORDER = ['home', 'movies', 'series', 'anime', 'collections', 'live', 'tonight'];
    const LABELS = {
        movies: 'MOVIES',
        series: 'SERIES',
        anime: 'ANIME',
        collections: 'COLLECTIONS',
        live: 'LIVE'
    };

    let viewsPromise = null;
    let resolvedViews = null;
    let timers = [];

    function api() { return window.ApiClient || null; }

    function userId() {
        const client = api();
        if (!client || typeof client.getCurrentUserId !== 'function') return '';
        try { return client.getCurrentUserId() || ''; }
        catch (error) { return ''; }
    }

    function normalise(value) { return String(value || '').trim().toLowerCase(); }

    function route() { return String(window.location.hash || ''); }

    function isPlayback() {
        return /videoosd|playback|nowplaying/i.test(route()) ||
            Boolean(document.querySelector('.videoPlayerContainer:not(.hide), .videoOsdPage:not(.hide)'));
    }

    function isAdminRoute() {
        return /dashboard|configurationpage|scheduledtasks|logs|networking|plugins|metadataeditor/i.test(route());
    }

    function viewerRoute() { return !isPlayback() && !isAdminRoute(); }

    function isTvLayout() {
        return Boolean(
            document.documentElement?.classList.contains('layout-tv') ||
            document.body?.classList.contains('layout-tv')
        );
    }

    function setStoredRoute(kind, value) {
        if (!kind || !value) return;
        try { sessionStorage.setItem(ROUTE_PREFIX + kind, value); }
        catch (error) { /* optional cache */ }
    }

    function storedRoute(kind) {
        try { return sessionStorage.getItem(ROUTE_PREFIX + kind) || ''; }
        catch (error) { return ''; }
    }

    async function fetchUserViews() {
        if (Array.isArray(resolvedViews) && resolvedViews.length) return resolvedViews;
        if (viewsPromise) return viewsPromise;

        const client = api();
        const uid = userId();
        if (!client || !uid) return [];

        viewsPromise = (async () => {
            let items = [];
            try {
                if (typeof client.getUserViews === 'function') {
                    const result = await client.getUserViews({}, uid);
                    items = Array.isArray(result?.Items) ? result.Items : [];
                }
            } catch (error) {
                console.debug('[Velvet Antenna v0.22.2] getUserViews failed, trying direct endpoint', error);
            }

            if (!items.length) {
                try {
                    if (typeof client.getJSON === 'function' && typeof client.getUrl === 'function') {
                        const result = await client.getJSON(client.getUrl('Users/' + encodeURIComponent(uid) + '/Views'));
                        items = Array.isArray(result?.Items) ? result.Items : [];
                    }
                } catch (error) {
                    console.debug('[Velvet Antenna v0.22.2] user views endpoint failed', error);
                }
            }

            if (items.length) resolvedViews = items;
            return items;
        })();

        try {
            return await viewsPromise;
        } finally {
            if (!resolvedViews?.length) viewsPromise = null;
        }
    }

    function classifyView(view) {
        const type = normalise(view?.CollectionType);
        const name = normalise(view?.Name);

        if (type === 'movies') {
            if (/\banime\b/.test(name)) return 'anime';
            return 'movies';
        }
        if (type === 'tvshows') {
            if (/\banime\b/.test(name)) return 'anime';
            return 'series';
        }
        if (type === 'boxsets') return 'collections';
        if (type === 'livetv') return 'live';

        if (/^collections?$/.test(name)) return 'collections';
        if (/^movies?$/.test(name)) return 'movies';
        if (/^(shows?|series|tv shows?)$/.test(name)) return 'series';
        if (/^anime$/.test(name)) return 'anime';
        return '';
    }

    function routeForView(view, kind) {
        if (!view || !view.Id) return '';
        const id = encodeURIComponent(view.Id);
        const type = normalise(view.CollectionType);

        if (kind === 'movies') return '#/movies?topParentId=' + id + '&collectionType=movies';
        if (kind === 'series') return '#/tv?topParentId=' + id + '&collectionType=tvshows';
        if (kind === 'collections') return '#/boxsets?topParentId=' + id + '&collectionType=boxsets';
        if (kind === 'live') return '#/livetv';
        if (kind === 'anime') {
            if (type === 'movies') return '#/movies?topParentId=' + id + '&collectionType=movies';
            if (type === 'tvshows') return '#/tv?topParentId=' + id + '&collectionType=tvshows';
            return '#/list?parentId=' + id;
        }
        return '';
    }

    function nativeRouteFallbacks(routes) {
        document.querySelectorAll('.libraryMenuOptions a[href], .navMenuOption[href]').forEach(link => {
            const href = link.getAttribute('href') || '';
            const label = normalise(link.textContent);
            let kind = '';
            if (/^movies?$/.test(label) || /#\/movies/i.test(href)) kind = 'movies';
            else if (/^(shows?|series|tv shows?)$/.test(label) || /#\/tv\?/i.test(href)) kind = 'series';
            else if (/^anime$/.test(label)) kind = 'anime';
            else if (/collections?/.test(label) || /#\/boxsets/i.test(href)) kind = 'collections';
            else if (/live tv|^live$/.test(label) || /#\/livetv/i.test(href)) kind = 'live';
            if (kind && !routes[kind] && href) routes[kind] = href;
        });
        return routes;
    }

    async function libraryRoutes() {
        const routes = {};

        [...CORE, ...OPTIONAL].forEach(kind => {
            const cached = storedRoute(kind);
            if (cached) routes[kind] = cached;
        });

        const views = await fetchUserViews();
        views.forEach(view => {
            const kind = classifyView(view);
            if (!kind) return;
            const value = routeForView(view, kind);
            if (value) routes[kind] = value;
        });

        nativeRouteFallbacks(routes);
        [...CORE, ...OPTIONAL].forEach(kind => {
            if (routes[kind]) setStoredRoute(kind, routes[kind]);
        });
        return routes;
    }

    function navigate(value) {
        if (!value) return;
        if (value.startsWith('#')) window.location.hash = value.slice(1);
        else if (value.includes('#/')) window.location.hash = value.slice(value.indexOf('#') + 1);
        else window.location.href = value;
    }

    async function resolveAndNavigate(kind, button) {
        let value = button?.getAttribute('data-va22-api-route') || storedRoute(kind);
        if (value) {
            navigate(value);
            return;
        }

        button?.classList.add('is-resolving');
        button?.setAttribute('aria-busy', 'true');
        const routes = await libraryRoutes();
        value = routes[kind] || '';
        button?.classList.remove('is-resolving');
        button?.removeAttribute('aria-busy');

        if (value) {
            button?.setAttribute('data-va22-api-route', value);
            navigate(value);
            return;
        }

        console.warn('[Velvet Antenna v0.22.2] No route resolved for', kind);
    }

    function mark() {
        const el = document.createElement('span');
        el.className = 'va21-mark';
        el.setAttribute('aria-hidden', 'true');
        el.innerHTML = '<i></i><i></i><i></i><i></i>';
        return el;
    }

    function goHome() { window.location.hash = '#/home'; }

    function goBack() {
        if (/^#\/home(?:\?|$)/i.test(route())) return;
        if (window.history.length > 1) window.history.back();
        else goHome();
    }

    function openProfile() {
        const selectors = ['.headerUserButton', '.headerUserButtonRound', '[aria-label*="profile" i]', '[title*="profile" i]'];
        for (const selector of selectors) {
            const el = document.querySelector(selector);
            if (el && typeof el.click === 'function') {
                el.click();
                return;
            }
        }
    }

    function makeImmediateButton(kind) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'va21-nav__item va22-api-library-link';
        button.setAttribute('data-va21-kind', kind);
        button.textContent = LABELS[kind] || kind.toUpperCase();
        const cached = storedRoute(kind);
        if (cached) button.setAttribute('data-va22-api-route', cached);
        else button.setAttribute('data-va22-route-pending', 'true');
        button.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            resolveAndNavigate(kind, button);
        });
        return button;
    }

    function makeTonightButton() {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'va21-nav__item va22-nav-tonight';
        button.setAttribute('data-va22-nav', 'tonight');
        button.textContent = 'TONIGHT';
        button.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            if (window.VelvetAntenna22?.openTonight) window.VelvetAntenna22.openTonight();
        });
        return button;
    }

    function makeSimpleButton(label, kind, handler) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'va21-nav__item';
        button.textContent = label;
        if (kind) button.setAttribute('data-va21-kind', kind);
        button.addEventListener('click', handler);
        return button;
    }

    function createImmediateNav() {
        const nav = document.createElement('nav');
        nav.id = 'va21-nav';
        nav.className = 'va21-nav';
        nav.setAttribute('aria-label', 'Velvet Antenna');
        nav.setAttribute('data-va22-owned', VERSION);

        const identity = document.createElement('div');
        identity.className = 'va21-nav__identity';

        const back = document.createElement('button');
        back.type = 'button';
        back.className = 'va21-nav__back';
        back.setAttribute('aria-label', 'Back');
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
        identity.append(back, brand);

        const primary = document.createElement('div');
        primary.className = 'va21-nav__primary';
        primary.appendChild(makeSimpleButton('HOME', 'home', goHome));
        CORE.forEach(kind => primary.appendChild(makeImmediateButton(kind)));
        primary.appendChild(makeTonightButton());

        const utility = document.createElement('div');
        utility.className = 'va21-nav__utility';
        utility.appendChild(makeSimpleButton('SEARCH', 'search', () => { window.location.hash = '#/search'; }));
        utility.appendChild(makeSimpleButton('PROFILE', 'profile', openProfile));

        nav.append(identity, primary, utility);
        return nav;
    }

    function ensureImmediateNav() {
        if (!viewerRoute() || !document.body) return null;
        let nav = document.getElementById('va21-nav');
        if (!nav) {
            nav = createImmediateNav();
            document.body.insertBefore(nav, document.body.firstChild);
        }

        let primary = nav.querySelector('.va21-nav__primary');
        if (!primary) return nav;

        if (!primary.querySelector('[data-va21-kind="home"]')) {
            primary.insertBefore(makeSimpleButton('HOME', 'home', goHome), primary.firstChild);
        }

        CORE.forEach(kind => {
            if (!primary.querySelector('[data-va21-kind="' + kind + '"]')) {
                const tonight = primary.querySelector('[data-va22-nav="tonight"]');
                primary.insertBefore(makeImmediateButton(kind), tonight || null);
            }
        });

        if (!primary.querySelector('[data-va22-nav="tonight"]')) primary.appendChild(makeTonightButton());
        nav.setAttribute('data-va22-navigation', VERSION);
        document.body?.setAttribute('data-va-build', VERSION);
        return nav;
    }

    function routeKindFromLocation() {
        const value = route().toLowerCase();
        if (value === '#/home' || value.startsWith('#/home?')) return 'home';
        if (value.startsWith('#/movies')) return 'movies';
        if (value.startsWith('#/tv')) return 'series';
        if (value.startsWith('#/boxsets')) return 'collections';
        if (value.startsWith('#/livetv')) return 'live';
        if (value.startsWith('#/search')) return 'search';
        return '';
    }

    function orderPrimary(primary) {
        const known = new Map();
        primary.querySelectorAll('[data-va21-kind], [data-va22-nav="tonight"]').forEach(button => {
            const kind = button.getAttribute('data-va21-kind') || (button.hasAttribute('data-va22-nav') ? 'tonight' : '');
            if (kind && !known.has(kind)) known.set(kind, button);
        });
        ORDER.forEach(kind => {
            const button = known.get(kind);
            if (button) primary.appendChild(button);
        });
    }

    function updateActiveState(primary) {
        const active = routeKindFromLocation();
        primary.querySelectorAll('[data-va21-kind]').forEach(button => {
            button.classList.toggle('is-active', button.getAttribute('data-va21-kind') === active);
        });
        const back = document.querySelector('#va21-nav .va21-nav__back');
        if (back) back.disabled = active === 'home';
    }

    function makeHub(kind, value) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'va22-tv-hub';
        if (value) button.setAttribute('data-va22-tv-route', value);
        else button.setAttribute('data-va22-route-pending', 'true');
        button.innerHTML = '<span>VA / LIBRARY</span><b></b><i>ENTER →</i>';
        button.querySelector('b').textContent = LABELS[kind] || kind.toUpperCase();
        button.addEventListener('click', () => resolveAndNavigate(kind, button));
        return button;
    }

    function mountTvHubs(routes) {
        const existing = document.getElementById(HUBS_ID);
        if (!isTvLayout() || !/^#\/home(?:\?|$)/i.test(route())) {
            existing?.remove();
            return;
        }

        const flow = document.getElementById('va22-flow');
        const hero = document.getElementById('va21-home-hero');
        const parent = flow || hero?.parentElement;
        if (!parent) return;

        let hubs = existing;
        if (!hubs) {
            hubs = document.createElement('section');
            hubs.id = HUBS_ID;
            hubs.className = 'va22-tv-hubs';
            hubs.innerHTML = '<header><span>VA / LIBRARIES</span><h2>Your collection, one move away.</h2></header><div class="va22-tv-hubs__grid"></div>';
            if (flow) flow.insertBefore(hubs, flow.firstChild);
            else hero.insertAdjacentElement('afterend', hubs);
        }

        const available = [...CORE];
        if (routes.anime) available.push('anime');
        const grid = hubs.querySelector('.va22-tv-hubs__grid');
        grid.innerHTML = '';
        available.forEach(kind => grid.appendChild(makeHub(kind, routes[kind] || storedRoute(kind))));
    }

    async function repairNavigation() {
        const nav = ensureImmediateNav();
        const primary = nav?.querySelector('.va21-nav__primary');
        if (!nav || !primary) return;

        const routes = await libraryRoutes();
        if (!nav.isConnected || !primary.isConnected) return;

        [...CORE, ...OPTIONAL].forEach(kind => {
            const value = routes[kind];
            let button = primary.querySelector('[data-va21-kind="' + kind + '"]');

            if (!button && value) {
                button = makeImmediateButton(kind);
                const tonight = primary.querySelector('[data-va22-nav="tonight"]');
                primary.insertBefore(button, tonight || null);
            }

            if (button && value) {
                button.setAttribute('data-va22-api-route', value);
                button.removeAttribute('data-va22-route-pending');
                button.setAttribute('data-va22-api-backed', 'true');
            }
        });

        orderPrimary(primary);
        updateActiveState(primary);

        if (!primary.hasAttribute('data-va22-focus-scroll')) {
            primary.setAttribute('data-va22-focus-scroll', 'true');
            primary.addEventListener('focusin', event => {
                const item = event.target?.closest?.('.va21-nav__item');
                if (item && typeof item.scrollIntoView === 'function') {
                    item.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
                }
            });
        }

        nav.setAttribute('data-va22-navigation', VERSION);
        document.body?.setAttribute('data-va-build', VERSION);
        mountTvHubs(routes);
    }

    function scheduleRepairs() {
        ensureImmediateNav();
        timers.forEach(id => window.clearTimeout(id));
        timers = [];
        [0, 100, 300, 700, 1500, 3000, 6000].forEach(delay => {
            timers.push(window.setTimeout(repairNavigation, delay));
        });
    }

    function routeChanged() {
        ensureImmediateNav();
        scheduleRepairs();
        window.setTimeout(() => {
            if (!/^#\/home(?:\?|$)/i.test(route())) document.getElementById(HUBS_ID)?.remove();
        }, 20);
    }

    window.addEventListener('hashchange', routeChanged);
    window.addEventListener('popstate', routeChanged);
    window.addEventListener('resize', scheduleRepairs);

    if (document.body) ensureImmediateNav();
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', scheduleRepairs, { once: true });
    } else {
        scheduleRepairs();
    }

    console.log('[Velvet Antenna] v' + VERSION + ' immediate API-backed navigation loaded');
})();