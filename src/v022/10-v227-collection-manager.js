(function () {
  'use strict';

  const C = window.VA224;
  if (!C) return;

  const BUTTON_ID = 'va226-manage-collection';
  const OVERLAY_ID = 'va226-collection-manager';
  const RETRIES = [0, 120, 320, 700, 1300, 2200, 3600];
  const FIELDS = 'ProviderIds,ImageTags,PrimaryImageAspectRatio,SortName';
  const state = {
    routeId: '', routeToken: 0, timers: [], collection: null,
    items: [], itemIds: new Set(), tab: 'contents', searchTimer: null,
    source: null, localMovies: null
  };

  function route() { return String(location.hash || ''); }
  function detailsId() {
    const match = route().match(/[?&]id=([^&]+)/i) || route().match(/\/details\/([^?&/]+)/i);
    return match?.[1] ? decodeURIComponent(match[1]) : '';
  }
  function isDetails() { return /details\?id=|\/details\//i.test(route()); }
  function api() { return C.api?.() || window.ApiClient || null; }
  function uid() { return C.uid?.() || ''; }

  async function getItem(id) {
    const client = api();
    const user = uid();
    if (!client || !user || !id || typeof client.getItem !== 'function') return null;
    try { return await client.getItem(user, id); } catch (e) { return null; }
  }

  async function getItems(options) {
    const client = api();
    const user = uid();
    if (!client || !user || typeof client.getItems !== 'function') return { Items: [], TotalRecordCount: 0 };
    try {
      return await client.getItems(user, Object.assign({ Fields: FIELDS }, options || {})) || { Items: [], TotalRecordCount: 0 };
    } catch (e) {
      console.debug('[Velvet Antenna v0.22.7] collection query failed', e);
      return { Items: [], TotalRecordCount: 0 };
    }
  }

  async function canManage() {
    const client = api();
    if (!client || typeof client.getCurrentUser !== 'function') return true;
    try {
      const user = await client.getCurrentUser();
      const policy = user?.Policy || {};
      return Boolean(policy.IsAdministrator || policy.EnableCollectionManagement);
    } catch (e) { return true; }
  }

  function removeButton() { document.getElementById(BUTTON_ID)?.remove(); }
  function closeManager() {
    document.getElementById(OVERLAY_ID)?.remove();
    document.body?.classList.remove('va226-collection-open');
  }

  function ensureButton(collection) {
    let button = document.getElementById(BUTTON_ID);
    if (button) return button;
    button = document.createElement('button');
    button.id = BUTTON_ID;
    button.type = 'button';
    button.textContent = 'MANAGE COLLECTION';
    button.setAttribute('aria-label', 'Manage ' + (collection?.Name || 'collection'));
    button.addEventListener('click', () => openManager(collection));
    document.body.appendChild(button);
    return button;
  }

  async function tryMount(expectedId, token) {
    if (!isDetails() || detailsId() !== expectedId || token !== state.routeToken) return;
    if (document.getElementById(BUTTON_ID)) return;
    const item = await getItem(expectedId);
    if (!item || token !== state.routeToken || detailsId() !== expectedId) return;
    if (item.Type !== 'BoxSet' || !(await canManage())) return;
    if (token !== state.routeToken || detailsId() !== expectedId) return;
    state.collection = item;
    ensureButton(item);
  }

  function scheduleMount(force) {
    const id = isDetails() ? detailsId() : '';
    if (!id) {
      state.routeId = '';
      state.routeToken += 1;
      state.timers.forEach(clearTimeout);
      state.timers = [];
      removeButton(); closeManager();
      return;
    }
    if (!force && id === state.routeId) {
      if (!document.getElementById(BUTTON_ID)) tryMount(id, state.routeToken);
      return;
    }
    state.routeId = id;
    state.routeToken += 1;
    const token = state.routeToken;
    state.collection = null; state.source = null; state.localMovies = null;
    state.timers.forEach(clearTimeout); state.timers = [];
    removeButton(); closeManager();
    RETRIES.forEach(delay => state.timers.push(setTimeout(() => tryMount(id, token), delay)));
  }

  function escapeText(value) {
    return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  function providerId(item, key) {
    const ids = item?.ProviderIds || {};
    const wanted = String(key || '').toLowerCase();
    const hit = Object.keys(ids).find(name => name.toLowerCase() === wanted);
    return hit ? String(ids[hit] || '') : '';
  }

  function localImage(item) {
    const client = api();
    const tag = item?.ImageTags?.Primary;
    if (!client || !tag || typeof client.getImageUrl !== 'function') return '';
    try { return client.getImageUrl(item.Id, { type: 'Primary', index: 0, tag, maxWidth: 260, quality: 82 }); }
    catch (e) { return ''; }
  }

  async function loadCollectionItems() {
    const result = await getItems({ ParentId: state.collection?.Id, IncludeItemTypes: 'Movie,Series,BoxSet', SortBy: 'SortName', SortOrder: 'Ascending', Limit: 1000, EnableTotalRecordCount: false });
    state.items = Array.isArray(result?.Items) ? result.Items : [];
    state.itemIds = new Set(state.items.map(item => String(item.Id || '')));
  }

  async function loadLocalMovies() {
    if (state.localMovies) return state.localMovies;
    const map = new Map();
    let start = 0;
    let total = 1;
    let guard = 0;
    while (start < total && guard++ < 20) {
      const result = await getItems({ Recursive: true, IncludeItemTypes: 'Movie', StartIndex: start, Limit: 500, EnableTotalRecordCount: true });
      const items = Array.isArray(result?.Items) ? result.Items : [];
      items.forEach(item => {
        const tmdb = providerId(item, 'Tmdb');
        if (tmdb && !map.has(tmdb)) map.set(tmdb, item);
      });
      total = Number(result?.TotalRecordCount || items.length || 0);
      start += items.length;
      if (!items.length) break;
    }
    state.localMovies = map;
    return map;
  }

  async function loadSource() {
    const tmdbId = providerId(state.collection, 'Tmdb');
    if (!tmdbId) return { kind: 'no-source', tmdbId: '' };
    if (state.source?.collectionId && String(state.source.collectionId) === tmdbId) return { kind: 'ok', data: state.source, tmdbId };
    const client = api();
    if (!client || typeof client.ajax !== 'function' || typeof client.getUrl !== 'function') return { kind: 'bridge-unavailable', tmdbId };
    try {
      const data = await client.ajax({ type: 'GET', url: client.getUrl('VelvetAntennaBridge/TmdbCollection/' + encodeURIComponent(tmdbId)), dataType: 'json' });
      state.source = data;
      return { kind: 'ok', data, tmdbId };
    } catch (e) {
      console.debug('[Velvet Antenna v0.22.7] source bridge unavailable', e);
      return { kind: 'bridge-unavailable', tmdbId };
    }
  }

  function counts() {
    const movies = state.items.filter(item => item.Type === 'Movie').length;
    const series = state.items.filter(item => item.Type === 'Series').length;
    return `${state.items.length} ITEMS • ${movies} MOVIES • ${series} SERIES`;
  }

  function standardRow(item, mode) {
    const row = document.createElement('article');
    row.className = 'va225-collection-row';
    row.dataset.va227Id = item.Id || '';
    const art = localImage(item);
    const inCollection = state.itemIds.has(String(item.Id || ''));
    row.innerHTML = '<div class="va225-collection-row__art"></div><div class="va225-collection-row__copy"><span></span><h3></h3></div><div class="va225-collection-row__status"></div><div class="va225-collection-row__actions"></div>';
    if (art) row.querySelector('.va225-collection-row__art').style.backgroundImage = `url("${art.replace(/"/g, '%22')}")`;
    row.querySelector('.va225-collection-row__copy span').textContent = [item.Type, item.ProductionYear].filter(Boolean).join(' • ');
    row.querySelector('.va225-collection-row__copy h3').textContent = item.Name || 'Untitled';
    const status = row.querySelector('.va225-collection-row__status');
    const actions = row.querySelector('.va225-collection-row__actions');
    if (mode === 'contents') {
      status.textContent = 'IN COLLECTION';
      actions.innerHTML = '<button type="button" class="is-danger" data-va227-action="remove">REMOVE</button>';
    } else if (inCollection) {
      status.textContent = 'ALREADY INCLUDED';
      actions.innerHTML = '<button type="button" disabled>ADDED</button>';
    } else {
      status.textContent = 'IN LIBRARY';
      actions.innerHTML = '<button type="button" class="is-primary" data-va227-action="add">ADD</button>';
    }
    return row;
  }

  function sourceRow(part, localMap) {
    const tmdb = String(part?.tmdbId || '');
    const local = localMap.get(tmdb) || null;
    const inCollection = local ? state.itemIds.has(String(local.Id || '')) : false;
    const row = document.createElement('article');
    row.className = 'va225-collection-row va227-source-row ' + (inCollection ? 'is-owned' : local ? 'is-local' : 'is-missing');
    if (local?.Id) row.dataset.va227Id = local.Id;
    const art = local ? localImage(local) : String(part?.posterUrl || '');
    row.innerHTML = '<div class="va225-collection-row__art"></div><div class="va225-collection-row__copy"><span></span><h3></h3></div><div class="va225-collection-row__status"></div><div class="va225-collection-row__actions"></div>';
    if (art) row.querySelector('.va225-collection-row__art').style.backgroundImage = `url("${art.replace(/"/g, '%22')}")`;
    row.querySelector('.va225-collection-row__copy span').textContent = ['TMDb #' + tmdb, part?.year || ''].filter(Boolean).join(' • ');
    row.querySelector('.va225-collection-row__copy h3').textContent = part?.title || part?.originalTitle || ('TMDb #' + tmdb);
    const status = row.querySelector('.va225-collection-row__status');
    const actions = row.querySelector('.va225-collection-row__actions');
    if (inCollection) {
      status.textContent = 'IN COLLECTION';
      status.classList.add('is-good');
    } else if (local) {
      status.textContent = 'OWNED • NOT IN COLLECTION';
      status.classList.add('is-warn');
      actions.innerHTML = '<button type="button" class="is-primary" data-va227-action="add">ADD</button>';
    } else {
      status.textContent = 'MISSING FROM LIBRARY';
      status.classList.add('is-missing');
      actions.innerHTML = `<a class="va227-tmdb-link" href="https://www.themoviedb.org/movie/${encodeURIComponent(tmdb)}" target="_blank" rel="noopener">TMDB ↗</a>`;
    }
    return row;
  }

  function renderRows(panel, items, mode, emptyText) {
    const host = panel.querySelector('.va225-collection-results');
    host.innerHTML = '';
    if (!items.length) {
      host.innerHTML = `<div class="va225-collection-empty">${escapeText(emptyText)}</div>`;
      return;
    }
    items.forEach(item => host.appendChild(standardRow(item, mode)));
  }

  function setSummary(panel, value) {
    const el = panel.querySelector('.va225-collection-summary');
    if (el) el.textContent = value || counts();
  }

  async function searchLibrary(query) {
    const value = String(query || '').trim();
    if (value.length < 2) return [];
    const result = await getItems({ Recursive: true, IncludeItemTypes: 'Movie,Series', SearchTerm: value, SortBy: 'SortName', SortOrder: 'Ascending', Limit: 60, EnableTotalRecordCount: false });
    return Array.isArray(result?.Items) ? result.Items : [];
  }

  function createPanel() {
    const panel = document.createElement('section');
    panel.id = OVERLAY_ID;
    panel.className = 'va225-collection-manager';
    panel.innerHTML = `<div class="va225-collection-backdrop" data-va227-close></div><div class="va225-collection-panel"><header><div><span>VA / COLLECTION MANAGER</span><h1>${escapeText(state.collection?.Name || 'Collection')}</h1><p class="va225-collection-summary">LOADING COLLECTION…</p></div><button type="button" class="va225-collection-close" data-va227-close aria-label="Close">×</button></header><nav class="va225-collection-tabs"><button type="button" class="is-active" data-va227-tab="contents">CONTENTS</button><button type="button" data-va227-tab="add">ADD FROM LIBRARY</button><button type="button" data-va227-tab="source">SOURCE CHECK</button></nav><div class="va225-collection-tools"></div><div class="va225-collection-results"><div class="va225-collection-empty">Loading collection…</div></div></div>`;
    return panel;
  }

  function renderTools(panel) {
    const tools = panel.querySelector('.va225-collection-tools');
    if (state.tab === 'contents') {
      tools.innerHTML = '<p>Current Jellyfin collection membership. Removing an item here does not delete the media file.</p>';
    } else if (state.tab === 'add') {
      tools.innerHTML = '<label><span>SEARCH YOUR LIBRARY</span><input type="search" data-va227-search placeholder="Movie or series title" autocomplete="off"></label><p>Add an existing Movie or Series directly to this collection.</p>';
    } else {
      const tmdb = providerId(state.collection, 'Tmdb');
      tools.innerHTML = tmdb
        ? `<p><strong>Source check:</strong> compare this BoxSet with the canonical TMDb collection #${escapeText(tmdb)}. This checks what exists on TMDb, not just what is already in Jellyfin.</p>`
        : '<p><strong>No canonical source is linked to this collection.</strong> Source Check does not guess from the collection name.</p>';
    }
  }

  async function renderSource(panel) {
    setSummary(panel, 'READING CANONICAL COLLECTION SOURCE…');
    const sourceResult = await loadSource();
    if (!panel.isConnected || state.tab !== 'source') return;
    const host = panel.querySelector('.va225-collection-results');
    host.innerHTML = '';
    if (sourceResult.kind === 'no-source') {
      setSummary(panel, 'NO TMDB COLLECTION ID ATTACHED');
      host.innerHTML = '<div class="va225-collection-empty">This appears to be a manual or non-TMDb collection, so there is no canonical TMDb list to compare against.</div>';
      return;
    }
    if (sourceResult.kind !== 'ok') {
      setSummary(panel, 'VELVET ANTENNA BRIDGE REQUIRED');
      host.innerHTML = '<div class="va225-collection-empty">The BoxSet has a TMDb source ID, but the Velvet Antenna Bridge endpoint is not available. Install/enable the Bridge plugin and restart Jellyfin, then try Source Check again.</div>';
      return;
    }
    const parts = Array.isArray(sourceResult.data?.parts) ? sourceResult.data.parts : [];
    const localMap = await loadLocalMovies();
    if (!panel.isConnected || state.tab !== 'source') return;
    let owned = 0, inCollection = 0;
    parts.forEach(part => {
      const local = localMap.get(String(part?.tmdbId || ''));
      if (local) owned += 1;
      if (local && state.itemIds.has(String(local.Id || ''))) inCollection += 1;
    });
    const missing = Math.max(0, parts.length - owned);
    const ownedOutside = Math.max(0, owned - inCollection);
    setSummary(panel, `${parts.length} SOURCE TITLES • ${inCollection} IN COLLECTION • ${ownedOutside} OWNED OUTSIDE • ${missing} MISSING`);
    if (!parts.length) {
      host.innerHTML = '<div class="va225-collection-empty">TMDb returned no parts for this collection.</div>';
      return;
    }
    parts.forEach(part => host.appendChild(sourceRow(part, localMap)));
  }

  async function renderTab(panel) {
    if (!panel?.isConnected) return;
    renderTools(panel);
    panel.querySelectorAll('[data-va227-tab]').forEach(button => button.classList.toggle('is-active', button.dataset.va227Tab === state.tab));
    if (state.tab === 'contents') {
      setSummary(panel); renderRows(panel, state.items, 'contents', 'This collection is empty.'); return;
    }
    if (state.tab === 'add') {
      setSummary(panel, 'SEARCH MOVIES OR SERIES ALREADY IN YOUR JELLYFIN LIBRARY');
      renderRows(panel, [], 'add', 'Start typing a title above.');
      panel.querySelector('[data-va227-search]')?.focus();
      return;
    }
    await renderSource(panel);
  }

  async function openManager(collection) {
    state.collection = collection || state.collection;
    if (!state.collection) return;
    closeManager(); state.tab = 'contents'; state.source = null; state.localMovies = null;
    const panel = createPanel();
    document.body.appendChild(panel); document.body.classList.add('va226-collection-open');
    await loadCollectionItems();
    if (panel.isConnected) await renderTab(panel);
  }

  async function mutate(method, itemId, button) {
    const client = api();
    const collectionId = state.collection?.Id;
    if (!client || !collectionId || !itemId || typeof client.ajax !== 'function' || typeof client.getUrl !== 'function') return;
    const old = button.textContent; button.disabled = true; button.textContent = method === 'POST' ? 'ADDING…' : 'REMOVING…';
    try {
      await client.ajax({ type: method, url: client.getUrl('Collections/' + encodeURIComponent(collectionId) + '/Items', { Ids: itemId }) });
      await loadCollectionItems();
      const panel = document.getElementById(OVERLAY_ID);
      if (panel) await renderTab(panel);
    } catch (e) {
      button.disabled = false; button.textContent = old;
      alert('Jellyfin could not update this collection. Check collection-management permission and try again.');
    }
  }

  function click(event) {
    const target = event.target;
    if (!target?.closest) return;
    if (target.closest('[data-va227-close]')) { event.preventDefault(); closeManager(); return; }
    const tab = target.closest('[data-va227-tab]');
    if (tab) { event.preventDefault(); state.tab = tab.dataset.va227Tab || 'contents'; renderTab(document.getElementById(OVERLAY_ID)); return; }
    const action = target.closest('[data-va227-action]');
    if (action) {
      const row = action.closest('[data-va227-id]');
      const id = row?.dataset.va227Id;
      if (!id) return;
      event.preventDefault(); mutate(action.dataset.va227Action === 'add' ? 'POST' : 'DELETE', id, action);
    }
  }

  function input(event) {
    const field = event.target;
    if (!field?.matches?.('[data-va227-search]')) return;
    clearTimeout(state.searchTimer);
    const query = field.value;
    state.searchTimer = setTimeout(async () => {
      const panel = document.getElementById(OVERLAY_ID);
      if (!panel || state.tab !== 'add') return;
      if (String(query || '').trim().length < 2) {
        setSummary(panel, 'SEARCH MOVIES OR SERIES ALREADY IN YOUR JELLYFIN LIBRARY');
        renderRows(panel, [], 'add', 'Start typing a title above.'); return;
      }
      setSummary(panel, 'SEARCHING YOUR LIBRARY…');
      const results = await searchLibrary(query);
      if (!panel.isConnected || field.value !== query || state.tab !== 'add') return;
      const outside = results.filter(item => !state.itemIds.has(String(item.Id || '')));
      const inside = results.filter(item => state.itemIds.has(String(item.Id || '')));
      setSummary(panel, `${outside.length} NOT IN COLLECTION • ${inside.length} ALREADY INCLUDED`);
      renderRows(panel, [...outside, ...inside], 'add', 'No matching Movie or Series was found.');
    }, 220);
  }

  addEventListener('va224:route', () => scheduleMount(false));
  addEventListener('hashchange', () => scheduleMount(true));
  addEventListener('click', click, true);
  addEventListener('input', input, true);
  scheduleMount(true);

  console.log('[Velvet Antenna] v0.22.7 source-aware Collection Manager loaded');
})();
