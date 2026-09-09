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
