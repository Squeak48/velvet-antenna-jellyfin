(function () {
    'use strict';

    const VERSION = '0.22.1';
    const ROUTE_PREFIX = 'velvet-antenna-v021:route:';
    const HUBS_ID = 'va22-tv-hubs';
    const ORDER = ['home', 'movies', 'series', 'anime', 'collections', 'live', 'tonight'];
    const LABELS = {
        movies: 'MOVIES',
        series: 'SERIES',
        anime: 'ANIME',
        collections: 'COLLECTIONS',
        live: 'LIVE'
    };

    let viewsPromise = null;
    let timers = [];

    function api() {
        return window.ApiClient || null;
    }

    function userId() {
        const client = api();
        if (!client || typeof client.getCurrentUserId !== 'function') return '';
        try { return client.getCurrentUserId() || ''; }
        catch (error) { return ''; }
    }

    function isTvLayout() {
        return Boolean(
            document.documentElement?.classList.contains('layout-tv') ||
            document.body?.classList.contains('layout-tv')
        );
    }

    function normalise(value) {
        return String(value || '').trim().toLowerCase();
    }

    function setStoredRoute(kind, route) {
        if (!kind || !route) return;
        try { sessionStorage.setItem(ROUTE_PREFIX + kind, route); }
        catch (error) { /* optional cache */ }
    }

    function storedRoute(kind) {
        try { return sessionStorage.getItem(ROUTE_PREFIX + kind) || ''; }
        catch (error) { return ''; }
    }

    async function fetchUserViews() {
        if (viewsPromise) return viewsPromise;
        viewsPromise = (async () => {
            const client = api();
            const uid = userId();
            if (!client || !uid) return [];

            try {
                if (typeof client.getUserViews === 'function') {
                    const result = await client.getUserViews({}, uid);
                    return Array.isArray(result?.Items) ? result.Items : [];
                }
            } catch (error) {
                console.debug('[Velvet Antenna v0.22.1] getUserViews failed, trying direct endpoint', error);
            }

            try {
                if (typeof client.getJSON === 'function' && typeof client.getUrl === 'function') {
                    const result = await client.getJSON(client.getUrl('Users/' + encodeURIComponent(uid) + '/Views'));
                    return Array.isArray(result?.Items) ? result.Items : [];
                }
            } catch (error) {
                console.debug('[Velvet Antenna v0.22.1] user views endpoint failed', error);
            }
            return [];
        })();
        return viewsPromise;
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
        const views = await fetchUserViews();
        views.forEach(view => {
            const kind = classifyView(view);
            if (!kind || routes[kind]) return;
            const route = routeForView(view, kind);
            if (route) routes[kind] = route;
        });

        nativeRouteFallbacks(routes);
        ['movies', 'series', 'anime', 'collections', 'live'].forEach(kind => {
            if (!routes[kind]) routes[kind] = storedRoute(kind);
            if (routes[kind]) setStoredRoute(kind, routes[kind]);
        });
        return routes;
    }

    function navigate(route) {
        if (!route) return;
        if (route.startsWith('#')) window.location.hash = route.slice(1);
        else if (route.includes('#/')) window.location.hash = route.slice(route.indexOf('#') + 1);
        else window.location.href = route;
    }

    function makeButton(kind, route) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'va21-nav__item va22-api-library-link';
        button.setAttribute('data-va21-kind', kind);
        button.setAttribute('data-va22-api-route', route);
        button.textContent = LABELS[kind] || kind.toUpperCase();
        button.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            navigate(route);
        });
        return button;
    }

    function routeKindFromLocation() {
        const value = String(window.location.hash || '').toLowerCase();
        if (value === '#/home' || value.startsWith('#/home?')) return 'home';
        if (value.startsWith('#/movies')) return 'movies';
        if (value.startsWith('#/tv')) return 'series';
        if (value.startsWith('#/boxsets')) return 'collections';
        if (value.startsWith('#/livetv')) return 'live';
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
    }

    function makeHub(kind, route) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'va22-tv-hub';
        button.setAttribute('data-va22-tv-route', route);
        button.innerHTML = '<span>VA / LIBRARY</span><b></b><i>ENTER →</i>';
        button.querySelector('b').textContent = LABELS[kind] || kind.toUpperCase();
        button.addEventListener('click', () => navigate(route));
        return button;
    }

    function mountTvHubs(routes) {
        const existing = document.getElementById(HUBS_ID);
        if (!isTvLayout() || !/^#\/home(?:\?|$)/i.test(window.location.hash || '')) {
            existing?.remove();
            return;
        }

        const available = ['movies', 'series', 'collections', 'anime']
            .filter(kind => routes[kind]);
        if (!available.length) {
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

        const grid = hubs.querySelector('.va22-tv-hubs__grid');
        grid.innerHTML = '';
        available.forEach(kind => grid.appendChild(makeHub(kind, routes[kind])));
    }

    async function repairNavigation() {
        const nav = document.getElementById('va21-nav');
        const primary = nav?.querySelector('.va21-nav__primary');
        if (!nav || !primary) return;

        const routes = await libraryRoutes();
        if (!nav.isConnected || !primary.isConnected) return;

        ['movies', 'series', 'anime', 'collections', 'live'].forEach(kind => {
            const route = routes[kind];
            if (!route) return;
            let button = primary.querySelector('[data-va21-kind="' + kind + '"]');
            if (!button) {
                button = makeButton(kind, route);
                const tonight = primary.querySelector('[data-va22-nav="tonight"]');
                primary.insertBefore(button, tonight || null);
            }
            button.setAttribute('data-va22-api-backed', 'true');
        });

        orderPrimary(primary);
        updateActiveState(primary);
        primary.addEventListener('focusin', event => {
            const item = event.target?.closest?.('.va21-nav__item');
            if (item && typeof item.scrollIntoView === 'function') {
                item.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
            }
        }, { once: true });

        nav.setAttribute('data-va22-navigation', VERSION);
        document.body?.setAttribute('data-va-build', VERSION);
        mountTvHubs(routes);
    }

    function scheduleRepairs() {
        timers.forEach(id => window.clearTimeout(id));
        timers = [];
        [0, 180, 500, 1100, 2200, 4000].forEach(delay => {
            timers.push(window.setTimeout(repairNavigation, delay));
        });
    }

    function routeChanged() {
        scheduleRepairs();
        window.setTimeout(() => {
            if (!/^#\/home(?:\?|$)/i.test(window.location.hash || '')) document.getElementById(HUBS_ID)?.remove();
        }, 20);
    }

    window.addEventListener('hashchange', routeChanged);
    window.addEventListener('popstate', routeChanged);
    window.addEventListener('resize', scheduleRepairs);

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', scheduleRepairs, { once: true });
    } else {
        scheduleRepairs();
    }

    console.log('[Velvet Antenna] v' + VERSION + ' API-backed library navigation loaded');
})();