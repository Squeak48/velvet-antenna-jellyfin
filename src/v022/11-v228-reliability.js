(function () {
  'use strict';

  const VERSION = '0.22.8';
  const NAV_ID = 'va224-nav';
  const PLAYER_EXIT_ID = 'va228-player-exit';
  const ARTWORK_ID = 'va228-collection-artwork';
  const ARTWORK_INPUT_ID = 'va228-artwork-input';
  const CORE = ['movies', 'series', 'collections'];
  const LABELS = { movies: 'MOVIES', series: 'SERIES', collections: 'COLLECTIONS' };
  const state = { views: null, viewsPromise: null, viewsUser: '', healTimers: [], routePulseAt: 0 };

  function C() { return window.VA224 || null; }
  function api() { return C()?.api?.() || window.ApiClient || null; }
  function uid() {
    const client = api();
    try { return C()?.uid?.() || client?.getCurrentUserId?.() || ''; }
    catch (e) { return ''; }
  }
  function route() { return String(location.hash || ''); }
  function routeLower() { return route().toLowerCase(); }
  function detailsId() {
    const match = route().match(/[?&]id=([^&]+)/i) || route().match(/\/details\/([^?&/]+)/i);
    return match?.[1] ? decodeURIComponent(match[1]) : '';
  }
  function isPlayback() {
    return /videoosd|nowplaying|playback/i.test(routeLower()) || Boolean(document.querySelector('#videoOsdPage:not(.hide), .videoOsdPage:not(.hide), .videoPlayerContainer:not(.hide) video'));
  }
  function isAdmin() { return /dashboard|configurationpage|scheduledtasks|logs|networking|plugins|metadataeditor/i.test(routeLower()); }
  function viewerRoute() { return !isPlayback() && !isAdmin(); }
  function routeKind() {
    const helper = C();
    if (helper?.routeKind) return helper.routeKind();
    const value = routeLower();
    if (value === '' || value === '#' || value.startsWith('#/home')) return 'home';
    if (value.startsWith('#/movies')) return 'movies';
    if (value.startsWith('#/tv')) return 'series';
    if (value.startsWith('#/collections') || value.startsWith('#/boxsets')) return 'collections';
    if (value.startsWith('#/search')) return 'search';
    if (/details\?id=|\/details\//i.test(value)) return 'details';
    return '';
  }

  function navButton(label, kind, extra) {
    return '<button type="button" class="va224-nav__item' + (extra ? ' ' + extra : '') + '" data-va224-kind="' + kind + '">' + label + '</button>';
  }

  function buildReliableNav() {
    const nav = document.createElement('nav');
    nav.id = NAV_ID;
    nav.dataset.va228Owned = 'true';
    nav.innerHTML = '<div class="va224-nav__identity"><button type="button" class="va224-nav__back" aria-label="Back">←</button><button type="button" class="va224-nav__brand"><span class="va224-mark"><i></i><i></i><i></i><i></i></span><b>VELVET ANTENNA</b></button></div>' +
      '<div class="va224-nav__primary">' + navButton('HOME', 'home', '') + navButton('MOVIES', 'movies', '') + navButton('SERIES', 'series', '') + navButton('COLLECTIONS', 'collections', '') + navButton('TONIGHT', 'tonight', 'va224-nav__tonight') + '</div>' +
      '<div class="va224-nav__utility">' + navButton('SEARCH', 'search', '') + navButton('PROFILE', 'profile', '') + '</div>';
    return nav;
  }

  function ensureNav() {
    if (!document.body) return;
    if (!viewerRoute()) {
      document.getElementById(NAV_ID)?.remove();
      return;
    }
    let nav = document.getElementById(NAV_ID);
    if (!nav) {
      nav = buildReliableNav();
      document.body.insertBefore(nav, document.body.firstChild);
    }
    const active = routeKind();
    nav.querySelectorAll('[data-va224-kind]').forEach(button => button.classList.toggle('is-active', button.dataset.va224Kind === active));
    const back = nav.querySelector('.va224-nav__back');
    if (back) back.disabled = active === 'home';
  }

  async function getUserViews() {
    const client = api();
    const user = uid();
    if (!client || !user) return [];
    if (state.views?.length && state.viewsUser === user) return state.views;
    if (state.viewsPromise && state.viewsUser === user) return state.viewsPromise;
    state.viewsUser = user;
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
      if (items.length) state.views = items;
      return items;
    })();
    try { return await state.viewsPromise; }
    finally { state.viewsPromise = null; }
  }

  function classifyView(view) {
    const type = String(view?.CollectionType || '').toLowerCase();
    const name = String(view?.Name || '').trim().toLowerCase();
    if (type === 'movies' || /^movies?$/.test(name)) return 'movies';
    if (type === 'tvshows' || /^(shows?|series|tv shows?)$/.test(name)) return 'series';
    if (type === 'boxsets' || /^collections?$/.test(name)) return 'collections';
    return '';
  }

  async function routeForKind(kind) {
    const views = await getUserViews();
    const view = views.find(item => classifyView(item) === kind);
    if (view?.Id) {
      const id = encodeURIComponent(view.Id);
      if (kind === 'movies') return '#/movies?topParentId=' + id + '&collectionType=movies';
      if (kind === 'series') return '#/tv?topParentId=' + id + '&collectionType=tvshows';
      if (kind === 'collections') return '#/list?parentId=' + id;
    }
    const remembered = C()?.routeFor?.(kind);
    return remembered || '';
  }

  function navigateHash(value) {
    if (!value) return;
    const next = value.startsWith('#') ? value : ('#' + value.replace(/^#/, ''));
    if (location.hash === next) {
      pulseRoute(true);
      return;
    }
    location.hash = next.slice(1);
  }

  async function navigateKind(kind) {
    if (!CORE.includes(kind)) return;
    C()?.setLastKind?.(kind);
    const target = await routeForKind(kind);
    if (target) navigateHash(target);
  }

  function openProfile() {
    for (const selector of ['.headerUserButton', '.headerUserButtonRound', '[aria-label*="profile" i]', '[title*="profile" i]']) {
      const button = document.querySelector(selector);
      if (button && !button.closest('#' + NAV_ID) && typeof button.click === 'function') {
        button.click();
        return;
      }
    }
  }

  function handleNav(kind) {
    if (kind === 'home') navigateHash('#/home');
    else if (CORE.includes(kind)) navigateKind(kind);
    else if (kind === 'tonight') window.VA224?.openTonight?.();
    else if (kind === 'search') navigateHash('#/search');
    else if (kind === 'profile') openProfile();
  }

  function nativeBack() {
    const native = Array.from(document.querySelectorAll('.headerBackButton')).find(button => !button.closest('#' + NAV_ID));
    if (native && typeof native.click === 'function') {
      native.click();
      return true;
    }
    return false;
  }

  function exitPlayer() {
    if (nativeBack()) return;
    if (history.length > 1) history.back();
    else navigateHash('#/home');
  }

  function ensurePlayerExit() {
    const shouldShow = isPlayback();
    let button = document.getElementById(PLAYER_EXIT_ID);
    if (!shouldShow) {
      button?.remove();
      return;
    }
    if (!button && document.body) {
      button = document.createElement('button');
      button.id = PLAYER_EXIT_ID;
      button.type = 'button';
      button.setAttribute('aria-label', 'Close player');
      button.setAttribute('title', 'Close player');
      button.innerHTML = '<span aria-hidden="true">×</span><b>EXIT</b>';
      document.body.appendChild(button);
    }
  }

  function managerPanel() { return document.getElementById('va226-collection-manager'); }

  function ensureArtworkControls() {
    const panel = managerPanel();
    if (!panel || document.getElementById(ARTWORK_ID)) return;
    const header = panel.querySelector('.va225-collection-panel > header');
    if (!header) return;
    const actions = document.createElement('div');
    actions.id = ARTWORK_ID;
    actions.innerHTML = '<button type="button" data-va228-art="Primary">CHANGE POSTER</button><button type="button" data-va228-art="Backdrop">CHANGE BACKDROP</button>';
    const close = header.querySelector('.va225-collection-close');
    if (close) header.insertBefore(actions, close); else header.appendChild(actions);
    const input = document.createElement('input');
    input.id = ARTWORK_INPUT_ID;
    input.type = 'file';
    input.accept = 'image/*';
    input.hidden = true;
    panel.appendChild(input);
  }

  async function getItem(id) {
    const client = api();
    const user = uid();
    if (!client || !user || !id || typeof client.getItem !== 'function') return null;
    try { return await client.getItem(user, id); } catch (e) { return null; }
  }

  function setManagerSummary(text) {
    const summary = managerPanel()?.querySelector('.va225-collection-summary');
    if (summary) summary.textContent = text;
  }

  function updateVisibleArtwork(item, type) {
    const client = api();
    if (!client || !item || typeof client.getImageUrl !== 'function') return;
    let tag = '';
    let url = '';
    try {
      if (type === 'Primary') {
        tag = item.ImageTags?.Primary || item.PrimaryImageTag || '';
        if (tag) url = client.getImageUrl(item.Id, { type: 'Primary', tag, maxWidth: 1000, quality: 92 });
      } else {
        tag = item.BackdropImageTags?.[0] || '';
        if (tag) url = client.getImageUrl(item.Id, { type: 'Backdrop', index: 0, tag, maxWidth: 1920, quality: 92 });
      }
    } catch (e) { return; }
    if (!url) return;
    if (type === 'Primary') {
      document.querySelectorAll('.detailImageContainer .cardImageContainer, .itemDetailImage').forEach(el => { el.style.backgroundImage = 'url("' + url.replace(/"/g, '%22') + '")'; });
      document.querySelectorAll('.detailImageContainer img, img.itemDetailImage').forEach(el => { el.src = url; });
    } else {
      document.querySelectorAll('.itemBackdrop, .detailPageWrapperContainer .backdropImage').forEach(el => { el.style.backgroundImage = 'url("' + url.replace(/"/g, '%22') + '")'; });
    }
  }

  async function uploadArtwork(type, file) {
    const client = api();
    const id = detailsId();
    if (!client || !id || !file || typeof client.uploadItemImage !== 'function') {
      setManagerSummary('ARTWORK UPLOAD IS NOT AVAILABLE IN THIS CLIENT');
      return;
    }
    if (!String(file.type || '').startsWith('image/')) {
      setManagerSummary('PLEASE CHOOSE AN IMAGE FILE');
      return;
    }
    setManagerSummary(type === 'Primary' ? 'UPLOADING COLLECTION POSTER…' : 'UPLOADING COLLECTION BACKDROP…');
    try {
      await client.uploadItemImage(id, type, file);
      const fresh = await getItem(id);
      if (fresh) updateVisibleArtwork(fresh, type);
      setManagerSummary(type === 'Primary' ? 'COLLECTION POSTER UPDATED' : 'COLLECTION BACKDROP UPDATED');
    } catch (e) {
      console.warn('[Velvet Antenna v0.22.8] artwork upload failed', e);
      setManagerSummary('JELLYFIN COULD NOT UPDATE THE COLLECTION ARTWORK');
    }
  }

  function pulseRoute(force) {
    const now = Date.now();
    if (!force && now - state.routePulseAt < 350) return;
    state.routePulseAt = now;
    const kind = routeKind();
    window.dispatchEvent(new CustomEvent('va224:route', { detail: { kind, route: route(), source: 'v0.22.8-heal' } }));
  }

  function heal() {
    ensureNav();
    ensurePlayerExit();
    ensureArtworkControls();
    const kind = routeKind();
    if ((kind === 'home' && !document.getElementById('va224-home')) || (CORE.includes(kind) && !document.getElementById('va224-library-stage'))) pulseRoute(false);
  }

  function scheduleHeal() {
    state.healTimers.forEach(clearTimeout);
    state.healTimers = [];
    [0, 80, 220, 500, 1000, 1800, 3200].forEach(delay => state.healTimers.push(setTimeout(heal, delay)));
  }

  function clickCapture(event) {
    const target = event.target;
    if (!target?.closest) return;

    const exit = target.closest('#' + PLAYER_EXIT_ID);
    if (exit) {
      event.preventDefault();
      event.stopImmediatePropagation();
      exitPlayer();
      return;
    }

    const nav = target.closest('#' + NAV_ID);
    if (nav) {
      const back = target.closest('.va224-nav__back');
      const brand = target.closest('.va224-nav__brand');
      const item = target.closest('[data-va224-kind]');
      if (back || brand || item) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (back) {
          if (routeKind() !== 'home') {
            if (!nativeBack()) {
              if (history.length > 1) history.back(); else navigateHash('#/home');
            }
          }
        } else if (brand) navigateHash('#/home');
        else handleNav(item.dataset.va224Kind || '');
        return;
      }
    }

    const art = target.closest('[data-va228-art]');
    if (art) {
      event.preventDefault();
      event.stopImmediatePropagation();
      ensureArtworkControls();
      const input = document.getElementById(ARTWORK_INPUT_ID);
      if (input) {
        input.value = '';
        input.dataset.va228Type = art.dataset.va228Art || 'Primary';
        input.click();
      }
      return;
    }

    if (target.closest('#va226-manage-collection')) {
      setTimeout(ensureArtworkControls, 0);
      setTimeout(ensureArtworkControls, 120);
      setTimeout(ensureArtworkControls, 350);
    }
  }

  function changeCapture(event) {
    const input = event.target;
    if (!input?.matches?.('#' + ARTWORK_INPUT_ID)) return;
    const file = input.files?.[0];
    if (!file) return;
    uploadArtwork(input.dataset.va228Type || 'Primary', file);
  }

  addEventListener('click', clickCapture, true);
  addEventListener('change', changeCapture, true);
  addEventListener('hashchange', scheduleHeal);
  addEventListener('popstate', scheduleHeal);
  addEventListener('pageshow', scheduleHeal);
  addEventListener('focus', heal);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) scheduleHeal(); });
  document.addEventListener('play', () => setTimeout(ensurePlayerExit, 0), true);
  document.addEventListener('pointerdown', () => { if (viewerRoute() && !document.getElementById(NAV_ID)) heal(); }, true);

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scheduleHeal, { once: true });
  else scheduleHeal();

  console.log('[Velvet Antenna] v0.22.8 deterministic interaction layer loaded');
})();