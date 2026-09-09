(function () {
  'use strict';

  const VERSION = '0.22.13';
  const PANEL_ID = 'va2213-series-audit';
  const BUTTON_CLASS = 'va2213-audit-launcher';
  const RETRIES = [0, 100, 280, 650, 1200, 2200, 3600];
  const CONCURRENCY = 3;
  const CACHE_TTL = 10 * 60 * 1000;

  const state = {
    token: 0,
    running: false,
    results: [],
    total: 0,
    done: 0,
    includeSpecials: false,
    showAll: false,
    cachedAt: 0,
    bridgeFailures: 0
  };

  function C() { return window.VA224 || null; }
  function api() { return C()?.api?.() || window.ApiClient || null; }
  function uid() {
    const client = api();
    try { return C()?.uid?.() || client?.getCurrentUserId?.() || ''; }
    catch (e) { return ''; }
  }
  function sid() {
    const client = api();
    try { return C()?.sid?.() || client?.serverId?.() || client?.serverInfo?.()?.Id || ''; }
    catch (e) { return ''; }
  }
  function isSeriesLibrary() {
    const helper = C();
    if (helper?.routeKind) return helper.routeKind() === 'series';
    const route = String(location.hash || '').toLowerCase();
    return route.startsWith('#/tv') || route.includes('collectiontype=tvshows');
  }
  function seriesParent() {
    const helper = C();
    return helper?.parseParent?.(location.hash) || helper?.parentFor?.('series') || '';
  }
  function detailsHash(id) {
    const server = sid();
    return '#/details?id=' + encodeURIComponent(id) + (server ? '&serverId=' + encodeURIComponent(server) : '');
  }
  function pad(value) { return String(value).padStart(2, '0'); }
  function todayIso() { return new Date().toISOString().slice(0, 10); }
  function isAired(date) { return Boolean(date && String(date).slice(0, 10) <= todayIso()); }
  function providerId(item, provider) {
    const ids = item?.ProviderIds || {};
    const key = Object.keys(ids).find(name => name.toLowerCase() === String(provider || '').toLowerCase());
    return key ? String(ids[key] || '') : '';
  }

  async function getItems(options) {
    const client = api();
    const user = uid();
    if (!client || !user || typeof client.getItems !== 'function') throw new Error('Jellyfin library API is not ready.');
    const result = await client.getItems(user, Object.assign({ EnableTotalRecordCount: false }, options || {}));
    return Array.isArray(result?.Items) ? result.Items : [];
  }

  async function bridgeJson(path) {
    const client = api();
    if (!client || typeof client.getJSON !== 'function' || typeof client.getUrl !== 'function') {
      throw new Error('Jellyfin API client is not ready.');
    }
    return client.getJSON(client.getUrl(path));
  }

  async function getSeriesSource(tmdbId) {
    return bridgeJson('VelvetAntennaBridge/TmdbSeries/' + encodeURIComponent(tmdbId));
  }

  async function getSeasonSource(tmdbId, seasonNumber) {
    return bridgeJson('VelvetAntennaBridge/TmdbSeries/' + encodeURIComponent(tmdbId) + '/Season/' + encodeURIComponent(seasonNumber));
  }

  function localCoverage(episodes, includeSpecials) {
    const seasons = new Map();
    for (const episode of episodes || []) {
      if (episode?.IsVirtualItem) continue;
      const seasonNumber = Number(episode?.ParentIndexNumber);
      const first = Number(episode?.IndexNumber);
      if (!Number.isFinite(seasonNumber) || !Number.isFinite(first) || first <= 0) continue;
      if (seasonNumber === 0 && !includeSpecials) continue;
      if (!seasons.has(seasonNumber)) seasons.set(seasonNumber, new Set());
      const set = seasons.get(seasonNumber);
      const rawEnd = Number(episode?.IndexNumberEnd);
      const last = Number.isFinite(rawEnd) && rawEnd >= first ? Math.min(rawEnd, first + 50) : first;
      for (let number = first; number <= last; number += 1) set.add(number);
    }
    return seasons;
  }

  function looksCompleteByCount(set, expectedCount) {
    if (!set || expectedCount <= 0 || set.size < expectedCount) return false;
    for (let number = 1; number <= expectedCount; number += 1) {
      if (!set.has(number)) return false;
    }
    return true;
  }

  function resultBase(series) {
    return {
      id: String(series?.Id || ''),
      name: series?.Name || 'Untitled Series',
      year: series?.ProductionYear || '',
      tmdbId: providerId(series, 'Tmdb'),
      sourceName: '',
      status: 'complete',
      reason: '',
      missingSeasons: [],
      missingEpisodes: [],
      sourceSeasonCount: 0,
      localSeasonCount: 0,
      expectedAiredEpisodes: 0,
      localCoveredEpisodes: 0
    };
  }

  async function auditOne(series, token, includeSpecials) {
    const result = resultBase(series);
    if (!result.tmdbId) {
      result.status = 'unverifiable';
      result.reason = 'No TMDb Series ID. Edit or identify this Series first.';
      return result;
    }

    let source;
    try {
      source = await getSeriesSource(result.tmdbId);
    } catch (error) {
      state.bridgeFailures += 1;
      result.status = 'unverifiable';
      result.reason = 'Series source unavailable. Velvet Antenna Bridge 0.2.0.0 is required.';
      return result;
    }
    if (token !== state.token) return null;

    result.sourceName = source?.name || '';
    const canonical = (Array.isArray(source?.seasons) ? source.seasons : [])
      .filter(season => Number.isFinite(Number(season?.seasonNumber)))
      .filter(season => includeSpecials || Number(season.seasonNumber) !== 0)
      .filter(season => Number(season?.episodeCount || 0) > 0)
      .sort((a, b) => Number(a.seasonNumber) - Number(b.seasonNumber));

    let localEpisodes;
    try {
      localEpisodes = await getItems({
        ParentId: result.id,
        Recursive: true,
        IncludeItemTypes: 'Episode',
        Fields: 'ProviderIds,PremiereDate,Path',
        Limit: 10000
      });
    } catch (error) {
      result.status = 'unverifiable';
      result.reason = 'Could not read this Series from the local Jellyfin library.';
      return result;
    }
    if (token !== state.token) return null;

    const local = localCoverage(localEpisodes, includeSpecials);
    result.localSeasonCount = Array.from(local.values()).filter(set => set.size > 0).length;
    result.localCoveredEpisodes = Array.from(local.values()).reduce((sum, set) => sum + set.size, 0);

    for (const season of canonical) {
      if (token !== state.token) return null;
      const seasonNumber = Number(season.seasonNumber);
      const expectedCount = Number(season.episodeCount || 0);
      const set = local.get(seasonNumber) || new Set();

      if (seasonNumber !== 0 && season?.airDate && !isAired(season.airDate) && set.size === 0) continue;

      if (looksCompleteByCount(set, expectedCount)) {
        result.sourceSeasonCount += 1;
        result.expectedAiredEpisodes += expectedCount;
        continue;
      }

      let detail;
      try {
        detail = await getSeasonSource(result.tmdbId, seasonNumber);
      } catch (error) {
        result.status = 'unverifiable';
        result.reason = 'TMDb season detail could not be verified for Season ' + seasonNumber + '.';
        continue;
      }
      if (token !== state.token) return null;

      const aired = (Array.isArray(detail?.episodes) ? detail.episodes : [])
        .filter(episode => Number(episode?.episodeNumber || 0) > 0)
        .filter(episode => isAired(episode?.airDate));
      if (!aired.length) continue;

      result.sourceSeasonCount += 1;
      result.expectedAiredEpisodes += aired.length;
      const requiredNumbers = Array.from(new Set(aired.map(episode => Number(episode.episodeNumber)))).sort((a, b) => a - b);
      const missing = requiredNumbers.filter(number => !set.has(number));
      if (!missing.length) continue;

      if (set.size === 0 && missing.length === requiredNumbers.length) {
        result.missingSeasons.push({
          seasonNumber,
          name: detail?.name || season?.name || ('Season ' + seasonNumber),
          episodeCount: requiredNumbers.length
        });
      } else {
        result.missingEpisodes.push({ seasonNumber, numbers: missing });
      }
    }

    if (result.missingSeasons.length) result.status = 'missing_season';
    else if (result.missingEpisodes.length) result.status = 'missing_episode';
    else if (result.status !== 'unverifiable') result.status = 'complete';
    return result;
  }

  function severity(result) {
    if (result.status === 'missing_season') return 4;
    if (result.status === 'missing_episode') return 3;
    if (result.status === 'unverifiable') return 2;
    return 1;
  }

  function createPanel() {
    const panel = document.createElement('section');
    panel.id = PANEL_ID;
    panel.innerHTML = '<div class="va2213-audit__shade" data-va2213-close></div><div class="va2213-audit__panel"><header><div><span>VA / LIBRARY INTEGRITY</span><h1>Series Integrity Audit</h1><p>Compare your physical Jellyfin episodes with the canonical TMDb season and episode structure.</p></div><button type="button" class="va2213-audit__close" data-va2213-close aria-label="Close Series audit">×</button></header><div class="va2213-audit__controls"><label><input type="checkbox" data-va2213-specials> INCLUDE SPECIALS / SEASON 0</label><button type="button" data-va2213-run>RUN AUDIT</button><button type="button" data-va2213-filter>SHOW ALL</button></div><div class="va2213-audit__progress"><div><i></i></div><span>Ready to audit.</span></div><div class="va2213-audit__summary"></div><div class="va2213-audit__notice"></div><div class="va2213-audit__results"></div></div>';
    document.body.appendChild(panel);
    panel.querySelector('[data-va2213-specials]').checked = state.includeSpecials;
    renderPanel();
    return panel;
  }

  function ensurePanel() {
    return document.getElementById(PANEL_ID) || createPanel();
  }

  function closePanel() {
    state.token += 1;
    state.running = false;
    document.getElementById(PANEL_ID)?.remove();
  }

  function summaryCounts() {
    return state.results.reduce((counts, result) => {
      counts.total += 1;
      if (result.status === 'missing_season') counts.missingSeason += 1;
      else if (result.status === 'missing_episode') counts.missingEpisode += 1;
      else if (result.status === 'unverifiable') counts.unverifiable += 1;
      else counts.complete += 1;
      return counts;
    }, { total: 0, missingSeason: 0, missingEpisode: 0, unverifiable: 0, complete: 0 });
  }

  function stat(label, value, kind) {
    const el = document.createElement('div');
    el.className = 'va2213-stat va2213-stat--' + kind;
    const strong = document.createElement('strong');
    strong.textContent = String(value);
    const span = document.createElement('span');
    span.textContent = label;
    el.append(strong, span);
    return el;
  }

  function formatEpisodeList(seasonNumber, numbers) {
    return numbers.map(number => 'S' + pad(seasonNumber) + 'E' + pad(number)).join(', ');
  }

  function makeResultRow(result) {
    const row = document.createElement('article');
    row.className = 'va2213-result va2213-result--' + result.status;
    row.dataset.va2213SeriesId = result.id;

    const head = document.createElement('div');
    head.className = 'va2213-result__head';
    const identity = document.createElement('div');
    const title = document.createElement('h3');
    title.textContent = result.name;
    const meta = document.createElement('p');
    meta.textContent = [result.year || '', result.sourceName ? 'TMDb: ' + result.sourceName : '', result.tmdbId ? 'ID ' + result.tmdbId : ''].filter(Boolean).join(' • ');
    identity.append(title, meta);
    const badge = document.createElement('b');
    badge.textContent = result.status === 'missing_season' ? 'MISSING SEASON' : result.status === 'missing_episode' ? 'MISSING EPISODES' : result.status === 'unverifiable' ? 'VERIFY ID' : 'COMPLETE';
    head.append(identity, badge);
    row.appendChild(head);

    const facts = document.createElement('div');
    facts.className = 'va2213-result__facts';
    if (result.status !== 'unverifiable') {
      facts.textContent = result.sourceSeasonCount + ' aired season' + (result.sourceSeasonCount === 1 ? '' : 's') + ' checked • ' + result.expectedAiredEpisodes + ' aired episodes expected • ' + result.localCoveredEpisodes + ' local episode numbers found';
    } else facts.textContent = result.reason || 'This Series could not be verified.';
    row.appendChild(facts);

    if (result.missingSeasons.length || result.missingEpisodes.length) {
      const issues = document.createElement('ul');
      result.missingSeasons.forEach(issue => {
        const li = document.createElement('li');
        li.innerHTML = '<strong>Season ' + issue.seasonNumber + ' missing entirely</strong><span></span>';
        li.querySelector('span').textContent = issue.episodeCount + ' aired episode' + (issue.episodeCount === 1 ? '' : 's') + ' expected';
        issues.appendChild(li);
      });
      result.missingEpisodes.forEach(issue => {
        const li = document.createElement('li');
        const strong = document.createElement('strong');
        strong.textContent = 'Season ' + issue.seasonNumber + ' incomplete';
        const span = document.createElement('span');
        span.textContent = formatEpisodeList(issue.seasonNumber, issue.numbers);
        li.append(strong, span);
        issues.appendChild(li);
      });
      row.appendChild(issues);
    }

    const actions = document.createElement('div');
    actions.className = 'va2213-result__actions';
    const open = document.createElement('button');
    open.type = 'button';
    open.dataset.va2213OpenSeries = result.id;
    open.textContent = 'OPEN SERIES';
    actions.appendChild(open);
    row.appendChild(actions);
    return row;
  }

  function renderPanel() {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;
    const counts = summaryCounts();
    const summary = panel.querySelector('.va2213-audit__summary');
    summary.innerHTML = '';
    summary.append(
      stat('Missing seasons', counts.missingSeason, 'bad'),
      stat('Missing episodes', counts.missingEpisode, 'warn'),
      stat('Verify ID', counts.unverifiable, 'unknown'),
      stat('Complete', counts.complete, 'good')
    );

    const progress = panel.querySelector('.va2213-audit__progress');
    const pct = state.total ? Math.round((state.done / state.total) * 100) : 0;
    progress.querySelector('i').style.width = pct + '%';
    progress.querySelector('span').textContent = state.running
      ? 'Checking ' + state.done + ' of ' + state.total + ' Series…'
      : state.results.length ? 'Audit complete. ' + state.results.length + ' Series checked.' : 'Ready to audit.';

    const notice = panel.querySelector('.va2213-audit__notice');
    notice.textContent = state.bridgeFailures && state.results.length && state.results.every(result => result.status === 'unverifiable')
      ? 'The Series source endpoint is unavailable. Update Velvet Antenna Bridge to 0.2.0.0 and restart Jellyfin Server.'
      : 'Only aired episodes are treated as required. Jellyfin virtual placeholders do not count as files you own.';

    const filter = panel.querySelector('[data-va2213-filter]');
    filter.textContent = state.showAll ? 'ISSUES ONLY' : 'SHOW ALL';
    const run = panel.querySelector('[data-va2213-run]');
    run.textContent = state.running ? 'AUDITING…' : state.results.length ? 'RUN AGAIN' : 'RUN AUDIT';
    run.disabled = state.running;

    const host = panel.querySelector('.va2213-audit__results');
    host.innerHTML = '';
    state.results
      .slice()
      .sort((a, b) => severity(b) - severity(a) || a.name.localeCompare(b.name))
      .filter(result => state.showAll || result.status !== 'complete')
      .forEach(result => host.appendChild(makeResultRow(result)));

    if (!host.children.length && state.results.length && !state.showAll) {
      const clean = document.createElement('div');
      clean.className = 'va2213-audit__clean';
      clean.textContent = 'No integrity problems found in the Series that could be verified.';
      host.appendChild(clean);
    }
  }

  async function mapLimit(items, limit, worker, token) {
    let index = 0;
    const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (index < items.length && token === state.token) {
        const current = items[index++];
        let result;
        try { result = await worker(current); }
        catch (error) {
          result = resultBase(current);
          result.status = 'unverifiable';
          result.reason = error?.message || 'Audit failed for this Series.';
        }
        if (token !== state.token) return;
        if (result) state.results.push(result);
        state.done += 1;
        renderPanel();
      }
    });
    await Promise.all(runners);
  }

  async function runAudit(force) {
    const panel = ensurePanel();
    if (!force && state.results.length && Date.now() - state.cachedAt < CACHE_TTL && state.includeSpecials === panel.querySelector('[data-va2213-specials]').checked) {
      renderPanel();
      return;
    }

    const parent = seriesParent();
    if (!parent) {
      panel.querySelector('.va2213-audit__notice').textContent = 'The Series library ID is not available yet. Reopen Series and try again.';
      return;
    }

    const token = ++state.token;
    state.running = true;
    state.results = [];
    state.done = 0;
    state.total = 0;
    state.bridgeFailures = 0;
    state.includeSpecials = Boolean(panel.querySelector('[data-va2213-specials]').checked);
    renderPanel();

    let series;
    try {
      series = await getItems({
        ParentId: parent,
        Recursive: true,
        IncludeItemTypes: 'Series',
        Fields: 'ProviderIds,ProductionYear,PremiereDate,Path',
        SortBy: 'SortName',
        SortOrder: 'Ascending',
        Limit: 5000
      });
    } catch (error) {
      if (token !== state.token) return;
      state.running = false;
      panel.querySelector('.va2213-audit__notice').textContent = 'Could not load the Series library from Jellyfin.';
      renderPanel();
      return;
    }
    if (token !== state.token) return;

    state.total = series.length;
    renderPanel();
    await mapLimit(series, CONCURRENCY, item => auditOne(item, token, state.includeSpecials), token);
    if (token !== state.token) return;
    state.running = false;
    state.cachedAt = Date.now();
    renderPanel();
  }

  function openAudit() {
    const panel = ensurePanel();
    state.showAll = false;
    renderPanel();
    runAudit(false);
    panel.querySelector('.va2213-audit__panel')?.focus?.();
  }

  function makeLauncher() {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = BUTTON_CLASS;
    button.dataset.va2213OpenAudit = 'true';
    button.textContent = 'AUDIT SERIES';
    return button;
  }

  function ensureLauncher() {
    document.querySelectorAll('.' + BUTTON_CLASS).forEach(button => {
      if (!isSeriesLibrary() || !button.closest('#va224-library-stage')) button.remove();
    });
    if (!isSeriesLibrary()) return;
    const actions = document.querySelector('#va224-library-stage .va224-stage__actions');
    if (!actions || actions.querySelector('.' + BUTTON_CLASS)) return;
    actions.appendChild(makeLauncher());
  }

  function scheduleLauncher() {
    RETRIES.forEach(delay => setTimeout(ensureLauncher, delay));
  }

  function click(event) {
    const open = event.target?.closest?.('[data-va2213-open-audit]');
    if (open) {
      event.preventDefault();
      event.stopPropagation();
      openAudit();
      return;
    }
    if (event.target?.closest?.('[data-va2213-close]')) {
      event.preventDefault();
      closePanel();
      return;
    }
    if (event.target?.closest?.('[data-va2213-run]')) {
      event.preventDefault();
      runAudit(true);
      return;
    }
    if (event.target?.closest?.('[data-va2213-filter]')) {
      event.preventDefault();
      state.showAll = !state.showAll;
      renderPanel();
      return;
    }
    const seriesButton = event.target?.closest?.('[data-va2213-open-series]');
    if (seriesButton) {
      const id = seriesButton.dataset.va2213OpenSeries;
      closePanel();
      if (id) location.hash = detailsHash(id).slice(1);
    }
  }

  function routeChanged() {
    if (!isSeriesLibrary()) {
      document.querySelectorAll('.' + BUTTON_CLASS).forEach(button => button.remove());
      if (document.getElementById(PANEL_ID)) closePanel();
      return;
    }
    scheduleLauncher();
  }

  addEventListener('va224:route', routeChanged);
  addEventListener('hashchange', routeChanged);
  addEventListener('pageshow', routeChanged);
  addEventListener('focus', scheduleLauncher);
  document.addEventListener('click', click, true);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', routeChanged, { once: true });
  else routeChanged();

  console.log('[Velvet Antenna] v0.22.13 Series Integrity Audit loaded');
})();
