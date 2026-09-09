(function () {
  'use strict';

  const C = window.VA224;
  if (!C) return;

  const BUTTON_ID = 'va226-manage-collection';
  const OVERLAY_ID = 'va226-collection-manager';
  const FIELDS = 'Overview,ProviderIds,PrimaryImageAspectRatio,ImageTags,BackdropImageTags,SortName';
  const RETRIES = [0, 120, 320, 700, 1300, 2200, 3600];
  const state = {
    routeId: '',
    routeToken: 0,
    timers: [],
    collection: null,
    items: [],
    itemIds: new Set(),
    tab: 'contents',
    likely: [],
    searchTimer: null
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
    try { return await client.getItem(user, id); }
    catch (e) { return null; }
  }

  async function getItems(options) {
    const client = api();
    const user = uid();
    if (!client || !user || typeof client.getItems !== 'function') return [];
    try {
      const result = await client.getItems(user, Object.assign({ Fields: FIELDS, EnableTotalRecordCount: false }, options || {}));
      return Array.isArray(result?.Items) ? result.Items : [];
    } catch (e) {
      console.debug('[Velvet Antenna v0.22.6] collection query failed', e);
      return [];
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
      removeButton();
      closeManager();
      return;
    }
    if (!force && id === state.routeId) {
      if (!document.getElementById(BUTTON_ID)) tryMount(id, state.routeToken);
      return;
    }
    state.routeId = id;
    state.routeToken += 1;
    const token = state.routeToken;
    state.collection = null;
    state.timers.forEach(clearTimeout);
    state.timers = [];
    removeButton();
    closeManager();
    RETRIES.forEach(delay => state.timers.push(setTimeout(() => tryMount(id, token), delay)));
  }

  function escapeText(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function imageUrl(item) {
    const client = api();
    const tag = item?.ImageTags?.Primary;
    if (!client || !tag || typeof client.getImageUrl !== 'function') return '';
    try { return client.getImageUrl(item.Id, { type: 'Primary', index: 0, tag, maxWidth: 260, quality: 82 }); }
    catch (e) { return ''; }
  }

  async function loadCollectionItems() {
    const collectionId = state.collection?.Id;
    if (!collectionId) return [];
    const items = await getItems({
      ParentId: collectionId,
      IncludeItemTypes: 'Movie,Series,BoxSet',
      SortBy: 'SortName',
      SortOrder: 'Ascending',
      Limit: 1000
    });
    state.items = items;
    state.itemIds = new Set(items.map(item => String(item.Id || '')));
    return items;
  }

  function counts() {
    const movies = state.items.filter(item => item.Type === 'Movie').length;
    const series = state.items.filter(item => item.Type === 'Series').length;
    const nested = state.items.filter(item => item.Type === 'BoxSet').length;
    return `${state.items.length} ITEMS • ${movies} MOVIES • ${series} SERIES${nested ? ` • ${nested} NESTED` : ''}`;
  }

  function itemRow(item, mode) {
    const row = document.createElement('article');
    row.className = 'va225-collection-row';
    row.dataset.va226Id = item.Id || '';
    const inCollection = state.itemIds.has(String(item.Id || ''));
    const art = imageUrl(item);
    row.innerHTML = '<div class="va225-collection-row__art"></div><div class="va225-collection-row__copy"><span></span><h3></h3></div><div class="va225-collection-row__status"></div><div class="va225-collection-row__actions"></div>';
    if (art) row.querySelector('.va225-collection-row__art').style.backgroundImage = `url("${art.replace(/"/g, '%22')}")`;
    row.querySelector('.va225-collection-row__copy span').textContent = [item.Type, item.ProductionYear].filter(Boolean).join(' • ');
    row.querySelector('.va225-collection-row__copy h3').textContent = item.Name || 'Untitled';
    const status = row.querySelector('.va225-collection-row__status');
    const actions = row.querySelector('.va225-collection-row__actions');
    if (mode === 'contents') {
      status.textContent = 'IN COLLECTION';
      actions.innerHTML = '<button type="button" class="is-danger" data-va226-action="remove">REMOVE</button>';
    } else if (inCollection) {
      status.textContent = 'ALREADY INCLUDED';
      actions.innerHTML = '<button type="button" disabled>ADDED</button>';
    } else {
      status.textContent = mode === 'missing' ? 'LIKELY MISSING' : 'IN LIBRARY';
      actions.innerHTML = '<button type="button" class="is-primary" data-va226-action="add">ADD</button>';
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
    items.forEach(item => host.appendChild(itemRow(item, mode)));
  }

  function setSummary(panel, value) {
    const el = panel.querySelector('.va225-collection-summary');
    if (el) el.textContent = value || counts();
  }

  function normalisedStem(name) {
    return String(name || '')
      .replace(/\b(collection|box\s*set|saga|trilogy|quadrilogy|anthology)\b/gi, ' ')
      .replace(/[^a-z0-9]+/gi, ' ')
      .trim()
      .toLowerCase();
  }

  function similarity(item, stem) {
    const title = String(item?.Name || '').toLowerCase();
    if (!title || !stem) return 0;
    if (title.includes(stem)) return 100;
    const stop = new Set(['the','and','for','with','from','into','of','a','an']);
    const tokens = stem.split(/\s+/).filter(token => token.length > 2 && !stop.has(token));
    if (!tokens.length) return 0;
    return Math.round(tokens.filter(token => title.includes(token)).length / tokens.length * 100);
  }

  async function likelyMissing() {
    const stem = normalisedStem(state.collection?.Name);
    if (stem.length < 3) return [];
    const items = await getItems({ Recursive: true, IncludeItemTypes: 'Movie,Series', SearchTerm: stem, SortBy: 'SortName', SortOrder: 'Ascending', Limit: 80 });
    return items
      .filter(item => !state.itemIds.has(String(item.Id || '')))
      .map(item => ({ item, score: similarity(item, stem) }))
      .filter(entry => entry.score >= 45)
      .sort((a, b) => b.score - a.score || String(a.item.Name || '').localeCompare(String(b.item.Name || '')))
      .slice(0, 30)
      .map(entry => entry.item);
  }

  async function searchLibrary(query) {
    const value = String(query || '').trim();
    if (value.length < 2) return [];
    return getItems({ Recursive: true, IncludeItemTypes: 'Movie,Series', SearchTerm: value, SortBy: 'SortName', SortOrder: 'Ascending', Limit: 60 });
  }

  function createPanel() {
    const panel = document.createElement('section');
    panel.id = OVERLAY_ID;
    panel.className = 'va225-collection-manager';
    panel.innerHTML = `<div class="va225-collection-backdrop" data-va226-close></div><div class="va225-collection-panel"><header><div><span>VA / COLLECTION MANAGER</span><h1>${escapeText(state.collection?.Name || 'Collection')}</h1><p class="va225-collection-summary">LOADING COLLECTION…</p></div><button type="button" class="va225-collection-close" data-va226-close aria-label="Close">×</button></header><nav class="va225-collection-tabs"><button type="button" class="is-active" data-va226-tab="contents">CONTENTS</button><button type="button" data-va226-tab="add">ADD FROM LIBRARY</button><button type="button" data-va226-tab="missing">LIKELY MISSING</button></nav><div class="va225-collection-tools"></div><div class="va225-collection-results"><div class="va225-collection-empty">Loading collection…</div></div></div>`;
    return panel;
  }

  function renderTools(panel) {
    const tools = panel.querySelector('.va225-collection-tools');
    if (state.tab === 'contents') {
      tools.innerHTML = '<p>Movies, Series and nested Collections can all live here. Removing an item only removes collection membership. It does not delete the media.</p>';
    } else if (state.tab === 'add') {
      tools.innerHTML = '<label><span>SEARCH YOUR LIBRARY</span><input type="search" data-va226-search placeholder="Movie or series title" autocomplete="off"></label><p>Add a Movie or Series already present anywhere in Jellyfin.</p>';
    } else {
      tools.innerHTML = '<p><strong>Likely Missing</strong> means matching titles already in your Jellyfin library but outside this collection. It is not an internet-wide completeness claim.</p><label><span>CHECK A SPECIFIC TITLE</span><input type="search" data-va226-search placeholder="Search your library" autocomplete="off"></label>';
    }
  }

  async function renderTab(panel) {
    if (!panel?.isConnected) return;
    renderTools(panel);
    panel.querySelectorAll('[data-va226-tab]').forEach(button => button.classList.toggle('is-active', button.dataset.va226Tab === state.tab));
    if (state.tab === 'contents') {
      setSummary(panel);
      renderRows(panel, state.items, 'contents', 'This collection is empty.');
      return;
    }
    if (state.tab === 'add') {
      setSummary(panel, 'SEARCH MOVIES OR SERIES ALREADY IN YOUR JELLYFIN LIBRARY');
      renderRows(panel, [], 'add', 'Start typing a title above.');
      panel.querySelector('[data-va226-search]')?.focus();
      return;
    }
    setSummary(panel, 'CHECKING YOUR LIBRARY FOR OBVIOUS OMISSIONS…');
    state.likely = await likelyMissing();
    if (!panel.isConnected || state.tab !== 'missing') return;
    setSummary(panel, state.likely.length ? `${state.likely.length} POSSIBLE OMISSION${state.likely.length === 1 ? '' : 'S'} FOUND IN YOUR LIBRARY` : 'NO OBVIOUS LIBRARY OMISSIONS FOUND');
    renderRows(panel, state.likely, 'missing', 'No obvious matching titles were found outside this collection.');
  }

  async function openManager(collection) {
    state.collection = collection || state.collection;
    if (!state.collection) return;
    closeManager();
    state.tab = 'contents';
    const panel = createPanel();
    document.body.appendChild(panel);
    document.body.classList.add('va226-collection-open');
    await loadCollectionItems();
    if (panel.isConnected) await renderTab(panel);
  }

  async function mutate(method, itemId, button) {
    const client = api();
    const collectionId = state.collection?.Id;
    if (!client || !collectionId || !itemId || typeof client.ajax !== 'function' || typeof client.getUrl !== 'function') return;
    const old = button.textContent;
    button.disabled = true;
    button.textContent = method === 'POST' ? 'ADDING…' : 'REMOVING…';
    try {
      await client.ajax({ type: method, url: client.getUrl('Collections/' + encodeURIComponent(collectionId) + '/Items', { Ids: itemId }) });
      await loadCollectionItems();
      const panel = document.getElementById(OVERLAY_ID);
      if (panel) await renderTab(panel);
    } catch (e) {
      button.disabled = false;
      button.textContent = old;
      alert('Jellyfin could not update this collection. Check collection-management permission and try again.');
    }
  }

  function click(event) {
    const target = event.target;
    if (!target?.closest) return;
    if (target.closest('[data-va226-close]')) {
      event.preventDefault();
      closeManager();
      return;
    }
    const tab = target.closest('[data-va226-tab]');
    if (tab) {
      event.preventDefault();
      state.tab = tab.dataset.va226Tab || 'contents';
      renderTab(document.getElementById(OVERLAY_ID));
      return;
    }
    const action = target.closest('[data-va226-action]');
    if (action) {
      const row = action.closest('[data-va226-id]');
      const id = row?.dataset.va226Id;
      if (!id) return;
      event.preventDefault();
      mutate(action.dataset.va226Action === 'add' ? 'POST' : 'DELETE', id, action);
    }
  }

  function input(event) {
    const field = event.target;
    if (!field?.matches?.('[data-va226-search]')) return;
    clearTimeout(state.searchTimer);
    const query = field.value;
    state.searchTimer = setTimeout(async () => {
      const panel = document.getElementById(OVERLAY_ID);
      if (!panel || !field.isConnected || field.value !== query) return;
      if (String(query || '').trim().length < 2) {
        if (state.tab === 'missing') {
          setSummary(panel, state.likely.length ? `${state.likely.length} POSSIBLE OMISSIONS FOUND IN YOUR LIBRARY` : 'NO OBVIOUS LIBRARY OMISSIONS FOUND');
          renderRows(panel, state.likely, 'missing', 'No obvious matching titles were found outside this collection.');
        } else {
          setSummary(panel, 'SEARCH MOVIES OR SERIES ALREADY IN YOUR JELLYFIN LIBRARY');
          renderRows(panel, [], 'add', 'Start typing a title above.');
        }
        return;
      }
      setSummary(panel, 'SEARCHING YOUR LIBRARY…');
      const results = await searchLibrary(query);
      if (!panel.isConnected || field.value !== query) return;
      const outside = results.filter(item => !state.itemIds.has(String(item.Id || '')));
      const inside = results.filter(item => state.itemIds.has(String(item.Id || '')));
      setSummary(panel, results.length ? `${outside.length} NOT IN COLLECTION • ${inside.length} ALREADY INCLUDED` : 'TITLE NOT FOUND IN YOUR JELLYFIN LIBRARY');
      renderRows(panel, [...outside, ...inside], state.tab === 'missing' ? 'missing' : 'add', 'No matching Movie or Series was found.');
    }, 240);
  }

  addEventListener('va224:route', () => scheduleMount(false));
  addEventListener('hashchange', () => scheduleMount(true));
  addEventListener('click', click, true);
  addEventListener('input', input, true);
  scheduleMount(true);

  console.log('[Velvet Antenna] v0.22.6 deterministic Collection Manager loaded');
})();
