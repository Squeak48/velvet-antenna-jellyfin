(function () {
  'use strict';

  const C = window.VA224;
  if (!C) return;

  const VERSION = '0.22.5';
  const BUTTON_ID = 'va225-manage-collection';
  const OVERLAY_ID = 'va225-collection-manager';
  const FIELDS = 'Overview,ProviderIds,PrimaryImageAspectRatio,ImageTags,BackdropImageTags,SortName';
  const state = {
    token: 0,
    collection: null,
    items: [],
    itemIds: new Set(),
    tab: 'contents',
    searchTimer: null,
    likely: []
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
      const result = await client.getItems(user, Object.assign({
        Fields: FIELDS,
        EnableTotalRecordCount: false
      }, options || {}));
      return Array.isArray(result?.Items) ? result.Items : [];
    } catch (e) {
      console.debug('[Velvet Antenna v0.22.5] collection query failed', e);
      return [];
    }
  }

  async function loadCollectionItems(collectionId) {
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

  function canManagePolicy(user) {
    const policy = user?.Policy || {};
    return Boolean(policy.IsAdministrator || policy.EnableCollectionManagement);
  }

  async function canManage() {
    const client = api();
    if (!client || typeof client.getCurrentUser !== 'function') return true;
    try { return canManagePolicy(await client.getCurrentUser()); }
    catch (e) { return true; }
  }

  function buttonAnchor() {
    return document.querySelector('.mainDetailButtons') ||
      document.querySelector('.detailPagePrimaryContainer .mainDetailButtons') ||
      document.getElementById('va21-detail-playbar') ||
      document.querySelector('.itemName') ||
      document.querySelector('.detailPagePrimaryContent h1');
  }

  function removeButton() { document.getElementById(BUTTON_ID)?.remove(); }
  function closeManager() {
    document.getElementById(OVERLAY_ID)?.remove();
    document.body?.classList.remove('va225-collection-open');
  }

  function createManageButton(collection) {
    const button = document.createElement('button');
    button.id = BUTTON_ID;
    button.type = 'button';
    button.className = 'va21-button va21-button--ghost va225-manage-button';
    button.textContent = 'MANAGE COLLECTION';
    button.setAttribute('aria-label', 'Manage ' + (collection.Name || 'collection'));
    button.addEventListener('click', () => openManager(collection));
    return button;
  }

  async function mountButton() {
    if (!isDetails()) {
      removeButton();
      closeManager();
      return;
    }
    const id = detailsId();
    if (!id) return;
    const token = ++state.token;
    const item = await getItem(id);
    if (!item || token !== state.token || detailsId() !== id) return;
    if (item.Type !== 'BoxSet' || !(await canManage())) {
      removeButton();
      return;
    }
    state.collection = item;
    if (document.getElementById(BUTTON_ID)) return;
    const anchor = buttonAnchor();
    if (!anchor) return;
    const button = createManageButton(item);
    if (anchor.matches('.mainDetailButtons')) anchor.appendChild(button);
    else anchor.insertAdjacentElement('afterend', button);
  }

  function imageUrl(item) {
    const client = api();
    if (!client || !item || typeof client.getImageUrl !== 'function') return '';
    const tag = item.ImageTags?.Primary;
    if (!tag) return '';
    try {
      return client.getImageUrl(item.Id, { type: 'Primary', index: 0, tag, maxWidth: 260, quality: 82 });
    } catch (e) { return ''; }
  }

  function escapeText(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function itemMeta(item) {
    return [item.Type, item.ProductionYear].filter(Boolean).join(' • ');
  }

  function itemRow(item, mode) {
    const inCollection = state.itemIds.has(String(item.Id || ''));
    const art = imageUrl(item);
    const row = document.createElement('article');
    row.className = 'va225-collection-row';
    row.dataset.va225Id = item.Id || '';
    row.innerHTML = `
      <div class="va225-collection-row__art"></div>
      <div class="va225-collection-row__copy">
        <span>${escapeText(itemMeta(item))}</span>
        <h3>${escapeText(item.Name || 'Untitled')}</h3>
      </div>
      <div class="va225-collection-row__status"></div>
      <div class="va225-collection-row__actions"></div>
    `;
    if (art) row.querySelector('.va225-collection-row__art').style.backgroundImage = `url("${art.replace(/"/g, '%22')}")`;
    const status = row.querySelector('.va225-collection-row__status');
    const actions = row.querySelector('.va225-collection-row__actions');

    if (mode === 'contents') {
      status.textContent = 'IN COLLECTION';
      actions.innerHTML = '<button type="button" class="is-danger" data-va225-action="remove">REMOVE</button>';
    } else if (inCollection) {
      status.textContent = 'ALREADY INCLUDED';
      actions.innerHTML = '<button type="button" disabled>ADDED</button>';
    } else {
      status.textContent = mode === 'missing' ? 'LIKELY MISSING' : 'IN LIBRARY';
      actions.innerHTML = '<button type="button" class="is-primary" data-va225-action="add">ADD</button>';
    }
    return row;
  }

  function collectionCounts() {
    const movies = state.items.filter(item => item.Type === 'Movie').length;
    const series = state.items.filter(item => item.Type === 'Series').length;
    return `${state.items.length} ITEMS • ${movies} MOVIES • ${series} SERIES`;
  }

  function setSummary(panel, text) {
    const el = panel.querySelector('.va225-collection-summary');
    if (el) el.textContent = text || collectionCounts();
  }

  function renderRows(panel, items, mode, emptyText) {
    const host = panel.querySelector('.va225-collection-results');
    host.innerHTML = '';
    if (!items.length) {
      host.innerHTML = `<div class="va225-collection-empty">${escapeText(emptyText || 'Nothing found.')}</div>`;
      return;
    }
    items.forEach(item => host.appendChild(itemRow(item, mode)));
  }

  function normalisedCollectionStem(name) {
    return String(name || '')
      .replace(/\b(collection|box\s*set|saga|trilogy|quadrilogy|anthology)\b/gi, ' ')
      .replace(/[^a-z0-9]+/gi, ' ')
      .trim()
      .toLowerCase();
  }

  function similarityScore(item, stem) {
    const title = String(item?.Name || '').toLowerCase();
    if (!title || !stem) return 0;
    if (title.includes(stem)) return 100;
    const stop = new Set(['the','and','for','with','from','into','of','a','an']);
    const tokens = stem.split(/\s+/).filter(token => token.length > 2 && !stop.has(token));
    if (!tokens.length) return 0;
    const matched = tokens.filter(token => title.includes(token)).length;
    return Math.round((matched / tokens.length) * 100);
  }

  async function likelyMissing() {
    const stem = normalisedCollectionStem(state.collection?.Name);
    if (stem.length < 3) return [];
    const candidates = await getItems({
      Recursive: true,
      IncludeItemTypes: 'Movie,Series',
      SearchTerm: stem,
      SortBy: 'SortName',
      SortOrder: 'Ascending',
      Limit: 80
    });
    return candidates
      .filter(item => !state.itemIds.has(String(item.Id || '')))
      .map(item => ({ item, score: similarityScore(item, stem) }))
      .filter(entry => entry.score >= 45)
      .sort((a, b) => b.score - a.score || String(a.item.Name || '').localeCompare(String(b.item.Name || '')))
      .slice(0, 30)
      .map(entry => entry.item);
  }

  async function searchLibrary(query) {
    const value = String(query || '').trim();
    if (value.length < 2) return [];
    return getItems({
      Recursive: true,
      IncludeItemTypes: 'Movie,Series',
      SearchTerm: value,
      SortBy: 'SortName',
      SortOrder: 'Ascending',
      Limit: 60
    });
  }

  function createPanel(collection) {
    const panel = document.createElement('section');
    panel.id = OVERLAY_ID;
    panel.className = 'va225-collection-manager';
    panel.innerHTML = `
      <div class="va225-collection-backdrop" data-va225-close></div>
      <div class="va225-collection-panel">
        <header>
          <div>
            <span>VA / COLLECTION MANAGER</span>
            <h1>${escapeText(collection.Name || 'Collection')}</h1>
            <p class="va225-collection-summary">LOADING COLLECTION…</p>
          </div>
          <button type="button" class="va225-collection-close" data-va225-close aria-label="Close">×</button>
        </header>
        <nav class="va225-collection-tabs">
          <button type="button" class="is-active" data-va225-tab="contents">CONTENTS</button>
          <button type="button" data-va225-tab="add">ADD FROM LIBRARY</button>
          <button type="button" data-va225-tab="missing">LIKELY MISSING</button>
        </nav>
        <div class="va225-collection-tools"></div>
        <div class="va225-collection-results"><div class="va225-collection-empty">Loading collection…</div></div>
      </div>
    `;
    return panel;
  }

  function renderTools(panel) {
    const tools = panel.querySelector('.va225-collection-tools');
    if (state.tab === 'contents') {
      tools.innerHTML = '<p>Movies, Series and nested Box Sets can all live in the same Jellyfin collection. Removing an item here only removes collection membership, not the media file.</p>';
      return;
    }
    if (state.tab === 'add') {
      tools.innerHTML = '<label><span>SEARCH YOUR LIBRARY</span><input type="search" data-va225-search placeholder="Movie or series title" autocomplete="off"></label><p>Search your existing Jellyfin library and add a Movie or Series without leaving this screen.</p>';
      setTimeout(() => tools.querySelector('[data-va225-search]')?.focus(), 0);
      return;
    }
    tools.innerHTML = '<p><strong>Likely Missing</strong> only means items already in your Jellyfin library whose titles strongly match this collection but are not currently members. It does not claim the franchise is complete on the internet.</p><label><span>CHECK A SPECIFIC TITLE</span><input type="search" data-va225-search placeholder="Search your library to verify a title" autocomplete="off"></label>';
  }

  async function renderTab(panel) {
    renderTools(panel);
    panel.querySelectorAll('[data-va225-tab]').forEach(button => button.classList.toggle('is-active', button.dataset.va225Tab === state.tab));
    if (state.tab === 'contents') {
      setSummary(panel);
      renderRows(panel, state.items, 'contents', 'This collection is empty.');
      return;
    }
    if (state.tab === 'add') {
      setSummary(panel, 'SEARCH MOVIES OR SERIES ALREADY IN YOUR JELLYFIN LIBRARY');
      renderRows(panel, [], 'add', 'Start typing a title above.');
      return;
    }
    setSummary(panel, 'CHECKING YOUR LIBRARY FOR OBVIOUS OMISSIONS…');
    state.likely = await likelyMissing();
    if (!panel.isConnected || state.tab !== 'missing') return;
    setSummary(panel, state.likely.length ? `${state.likely.length} POSSIBLE OMISSION${state.likely.length === 1 ? '' : 'S'} FOUND IN YOUR LIBRARY` : 'NO OBVIOUS LIBRARY OMISSIONS FOUND');
    renderRows(panel, state.likely, 'missing', 'No obvious matching titles were found outside this collection. This does not prove the franchise itself is complete.');
  }

  async function openManager(collection) {
    closeManager();
    state.collection = collection;
    state.tab = 'contents';
    const panel = createPanel(collection);
    document.body.appendChild(panel);
    document.body.classList.add('va225-collection-open');
    await loadCollectionItems(collection.Id);
    if (!panel.isConnected) return;
    await renderTab(panel);
  }

  async function mutateMembership(method, itemId, button) {
    const client = api();
    const collectionId = state.collection?.Id;
    if (!client || !collectionId || !itemId || typeof client.ajax !== 'function' || typeof client.getUrl !== 'function') return;
    const old = button?.textContent || '';
    if (button) { button.disabled = true; button.textContent = method === 'POST' ? 'ADDING…' : 'REMOVING…'; }
    try {
      await client.ajax({
        type: method,
        url: client.getUrl('Collections/' + encodeURIComponent(collectionId) + '/Items', { Ids: itemId })
      });
      await loadCollectionItems(collectionId);
      const panel = document.getElementById(OVERLAY_ID);
      if (panel) await renderTab(panel);
    } catch (e) {
      console.error('[Velvet Antenna v0.22.5] collection membership update failed', e);
      if (button) { button.disabled = false; button.textContent = old; }
      alert('Jellyfin could not update this collection. Check collection-management permission and try again.');
    }
  }

  function click(event) {
    const target = event.target;
    if (!target?.closest) return;
    if (target.closest('[data-va225-close]')) {
      event.preventDefault();
      return closeManager();
    }
    const tab = target.closest('[data-va225-tab]');
    if (tab) {
      event.preventDefault();
      state.tab = tab.dataset.va225Tab || 'contents';
      const panel = document.getElementById(OVERLAY_ID);
      if (panel) renderTab(panel);
      return;
    }
    const action = target.closest('[data-va225-action]');
    if (action) {
      const row = action.closest('[data-va225-id]');
      const itemId = row?.dataset.va225Id;
      if (!itemId) return;
      event.preventDefault();
      if (action.dataset.va225Action === 'add') return mutateMembership('POST', itemId, action);
      if (action.dataset.va225Action === 'remove') return mutateMembership('DELETE', itemId, action);
    }
  }

  function input(event) {
    const field = event.target;
    if (!field?.matches?.('[data-va225-search]')) return;
    clearTimeout(state.searchTimer);
    const query = field.value;
    state.searchTimer = setTimeout(async () => {
      const panel = document.getElementById(OVERLAY_ID);
      if (!panel || !field.isConnected) return;
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
      const ordered = [...outside, ...inside];
      setSummary(panel, results.length ? `${outside.length} NOT IN COLLECTION • ${inside.length} ALREADY INCLUDED` : 'TITLE NOT FOUND IN YOUR JELLYFIN LIBRARY');
      renderRows(panel, ordered, state.tab === 'missing' ? 'missing' : 'add', 'No matching Movie or Series was found in your Jellyfin library.');
    }, 260);
  }

  function routeChanged() {
    state.token += 1;
    removeButton();
    closeManager();
    if (!isDetails()) return;
    [0, 160, 420, 850, 1500, 2600].forEach(delay => setTimeout(mountButton, delay));
  }

  addEventListener('va224:route', routeChanged);
  addEventListener('hashchange', routeChanged);
  addEventListener('click', click, true);
  addEventListener('input', input, true);
  routeChanged();

  console.log('[Velvet Antenna] v0.22.5 Collection Manager loaded');
})();
