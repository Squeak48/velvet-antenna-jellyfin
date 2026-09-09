(function () {
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
