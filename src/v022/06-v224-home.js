(function () {
  'use strict';

  const C = window.VA224;
  if (!C) return;

  const HOME_ID = 'va224-home';
  const TONIGHT_ID = 'va22-tonight';
  const FAST_TTL = 3 * 60 * 1000;
  const FAST_FIELDS = [
    'Overview','Genres','DateCreated','ProviderIds','PrimaryImageAspectRatio',
    'ParentBackdropImageTags','ParentBackdropItemId','BackdropImageTags'
  ].join(',');

  const state = {
    data: null,
    fetchedAt: 0,
    promise: null,
    renderToken: 0
  };

  function detailsHash(id) {
    const server = C.sid();
    return '#/details?id=' + encodeURIComponent(id) + (server ? '&serverId=' + encodeURIComponent(server) : '');
  }
  function openDetails(id) {
    if (id) location.hash = detailsHash(id).slice(1);
  }
  function queuePlay(id) {
    if (!id) return;
    try { sessionStorage.setItem('velvet-antenna-v021:pending-local-play', JSON.stringify({ id: String(id), created: Date.now() })); }
    catch (e) {}
    openDetails(id);
  }

  function formatRuntime(ticks) {
    const value = Number(ticks || 0);
    if (!value) return '';
    const mins = Math.max(1, Math.round(value / 600000000));
    if (mins < 60) return mins + ' min';
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m ? h + 'h ' + m + 'm' : h + 'h';
  }
  function remainingMinutes(item) {
    const total = Number(item?.RunTimeTicks || 0);
    const pos = Number(item?.UserData?.PlaybackPositionTicks || 0);
    return total ? Math.max(1, Math.ceil(Math.max(0, total - pos) / 600000000)) : 0;
  }
  function finishClock(minutes) {
    const end = new Date(Date.now() + Math.max(0, Number(minutes || 0)) * 60000);
    return end.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  function unique(items) {
    const seen = new Set();
    return (items || []).filter(item => {
      const id = String(item?.Id || '');
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  }

  function imageUrl(item, type, width) {
    const client = C.api();
    if (!client || !item || typeof client.getImageUrl !== 'function') return '';
    const imageType = type || 'Primary';
    let id = item.Id;
    let tag = '';
    if (imageType === 'Backdrop') {
      tag = Array.isArray(item.BackdropImageTags) ? item.BackdropImageTags[0] : '';
      if (!tag && item.ParentBackdropItemId && Array.isArray(item.ParentBackdropImageTags)) {
        id = item.ParentBackdropItemId;
        tag = item.ParentBackdropImageTags[0] || '';
      }
    } else tag = item.ImageTags?.[imageType] || '';
    if (!id || !tag) return '';
    try { return client.getImageUrl(id, { type: imageType, index: 0, tag, maxWidth: width || 900, quality: 84 }); }
    catch (e) { return ''; }
  }

  async function waitForApi(timeout) {
    const start = Date.now();
    while (Date.now() - start < (timeout || 3500)) {
      if (C.api() && C.uid()) return true;
      await new Promise(resolve => setTimeout(resolve, 120));
    }
    return Boolean(C.api() && C.uid());
  }

  async function getItems(options) {
    const client = C.api();
    const user = C.uid();
    if (!client || !user || typeof client.getItems !== 'function') return [];
    try {
      const result = await client.getItems(user, Object.assign({ Fields: FAST_FIELDS, EnableTotalRecordCount: false }, options || {}));
      return Array.isArray(result?.Items) ? result.Items : [];
    } catch (e) {
      console.debug('[Velvet Antenna v0.22.4] fast getItems failed', e);
      return [];
    }
  }

  async function getNextUp(limit) {
    const client = C.api();
    const user = C.uid();
    if (!client || !user || typeof client.getNextUpEpisodes !== 'function') return [];
    try {
      const result = await client.getNextUpEpisodes({ UserId: user, Limit: limit || 12, Fields: FAST_FIELDS });
      return Array.isArray(result?.Items) ? result.Items : [];
    } catch (e) {
      console.debug('[Velvet Antenna v0.22.4] fast Next Up failed', e);
      return [];
    }
  }

  async function loadFastData(force) {
    if (!force && state.data && Date.now() - state.fetchedAt < FAST_TTL) return state.data;
    if (!force && state.promise) return state.promise;
    state.promise = (async () => {
      if (!(await waitForApi(3500))) return null;
      const [resume, nextUp, unwatched] = await Promise.all([
        getItems({ Recursive: true, IncludeItemTypes: 'Movie,Episode', Filters: 'IsResumable', SortBy: 'DatePlayed', SortOrder: 'Descending', Limit: 12 }),
        getNextUp(12),
        getItems({ Recursive: true, IncludeItemTypes: 'Movie', IsPlayed: false, SortBy: 'DateCreated', SortOrder: 'Descending', Limit: 30 })
      ]);
      const data = {
        resume,
        nextUp,
        unwatched,
        continueStory: unique([...resume, ...nextUp]).slice(0, 12),
        oneMore: unique(nextUp).filter(item => {
          const mins = remainingMinutes(item);
          return mins > 0 && mins <= 50;
        }).slice(0, 10)
      };
      state.data = data;
      state.fetchedAt = Date.now();
      return data;
    })();
    try { return await state.promise; }
    finally { state.promise = null; }
  }

  function signalScore(item, budget) {
    let score = 45;
    const reasons = [];
    const rating = Number(item?.CommunityRating || 0);
    if (rating) {
      score += Math.min(22, rating * 2.2);
      if (rating >= 7.5) reasons.push('highly rated');
    }
    const userData = item?.UserData || {};
    if (userData.PlaybackPositionTicks > 0 && !userData.Played) {
      score += 20;
      reasons.unshift('already in progress');
    } else if (!userData.Played) {
      score += 8;
      reasons.push('unwatched');
    }
    const mins = remainingMinutes(item);
    if (budget && mins && mins <= budget) {
      score += 14;
      reasons.unshift('fits your time');
    }
    return { score: Math.max(1, Math.min(99, Math.round(score))), reasons: reasons.slice(0, 3) };
  }

  function itemLabel(item) {
    if (!item) return '';
    if (item.Type === 'Episode') {
      const bits = [];
      if (item.SeriesName) bits.push(item.SeriesName);
      if (Number.isFinite(Number(item.ParentIndexNumber)) && Number.isFinite(Number(item.IndexNumber))) {
        bits.push('S' + String(item.ParentIndexNumber).padStart(2, '0') + 'E' + String(item.IndexNumber).padStart(2, '0'));
      }
      return bits.join(' • ');
    }
    return item.ProductionYear ? String(item.ProductionYear) : (item.Type || '');
  }

  function makeCard(item) {
    const card = document.createElement('article');
    card.className = 'va22-card va224-card';
    card.tabIndex = 0;
    card.dataset.va224Id = item.Id || '';
    const art = imageUrl(item, 'Backdrop', 900) || imageUrl(item, 'Primary', 560);
    const mins = remainingMinutes(item);
    const match = signalScore(item);
    card.innerHTML = '<div class="va22-card__art"></div><div class="va22-card__shade"></div><div class="va22-card__copy"><div class="va22-card__topline"><span class="va22-signal-match"></span><span class="va224-card-finish"></span></div><h3></h3><p class="va22-card__meta"></p><p class="va22-card__why"></p><div class="va22-card__actions"><button type="button" data-va224-card-action="open">DETAILS</button><button type="button" class="is-primary" data-va224-card-action="play">▶ PLAY</button></div></div>';
    if (art) card.querySelector('.va22-card__art').style.backgroundImage = 'url("' + art.replace(/"/g, '%22') + '")';
    card.querySelector('.va22-signal-match').textContent = match.score + '% MATCH';
    card.querySelector('.va224-card-finish').textContent = mins ? 'ENDS ' + finishClock(mins) : '';
    card.querySelector('h3').textContent = item.Name || item.SeriesName || 'Untitled';
    card.querySelector('.va22-card__meta').textContent = [itemLabel(item), mins ? formatRuntime(mins * 600000000) : formatRuntime(item.RunTimeTicks)].filter(Boolean).join(' • ');
    card.querySelector('.va22-card__why').textContent = match.reasons.length ? match.reasons.join(' • ') : 'from your library';
    if (!/^(Movie|Episode|Video|Audio)$/i.test(item.Type || '')) card.querySelector('[data-va224-card-action="play"]')?.remove();
    return card;
  }

  function makeSection(kicker, title, description, items) {
    if (!items?.length) return null;
    const section = document.createElement('section');
    section.className = 'va22-flow-section';
    section.innerHTML = '<header class="va22-flow-section__head"><div><span></span><h2></h2><p></p></div><b></b></header><div class="va22-rail"></div>';
    section.querySelector('span').textContent = kicker;
    section.querySelector('h2').textContent = title;
    section.querySelector('p').textContent = description;
    section.querySelector('b').textContent = String(items.length).padStart(2, '0');
    const rail = section.querySelector('.va22-rail');
    items.forEach(item => rail.appendChild(makeCard(item)));
    return section;
  }

  function createHome() {
    const home = document.createElement('main');
    home.id = HOME_ID;
    home.innerHTML = '<section class="va224-home-hero is-loading"><div class="va224-home-hero__art"></div><div class="va224-home-hero__shade"></div><div class="va224-home-hero__copy"><span>VA / ANTENNA FLOW</span><h1>Tuning your library.</h1><div class="va224-home-hero__meta">Building a fast signal from Jellyfin…</div><p>Velvet Antenna is preparing what matters now without scanning the whole library first.</p><div class="va224-home-hero__actions"></div></div><div class="va224-home-hero__signal"><i></i><i></i><i></i><i></i></div></section><section class="va22-tonight-teaser va224-tonight-teaser"><div class="va22-tonight-teaser__signal"><i></i><i></i><i></i><i></i></div><div class="va22-tonight-teaser__copy"><span>VA / TONIGHT</span><h2>Stop browsing. Start watching.</h2><p>Pick a time window and Velvet Antenna will cut the library down to a handful of sensible choices.</p></div><button type="button" data-va224-open-tonight>BUILD TONIGHT <b>→</b></button></section><div class="va224-home-sections"><section class="va224-skeleton"><span>VA / CONTINUITY</span><h2>Continue the story</h2><p>Loading your next useful choices…</p></section></div>';
    return home;
  }

  function ensureHome() {
    if (C.routeKind() !== 'home' || !document.body) {
      document.getElementById(HOME_ID)?.remove();
      return null;
    }
    let home = document.getElementById(HOME_ID);
    if (!home) {
      home = createHome();
      document.body.appendChild(home);
    }
    return home;
  }

  function renderHome(data) {
    const home = ensureHome();
    if (!home || !data) return;
    const heroItem = data.resume?.[0] || data.nextUp?.[0] || data.unwatched?.[0];
    const hero = home.querySelector('.va224-home-hero');
    if (heroItem && hero) {
      hero.classList.remove('is-loading');
      hero.dataset.va224Id = heroItem.Id;
      const art = imageUrl(heroItem, 'Backdrop', 1900) || imageUrl(heroItem, 'Primary', 900);
      if (art) hero.querySelector('.va224-home-hero__art').style.backgroundImage = 'url("' + art.replace(/"/g, '%22') + '")';
      const mins = remainingMinutes(heroItem);
      hero.querySelector('h1').textContent = heroItem.Name || heroItem.SeriesName || 'Tonight';
      hero.querySelector('.va224-home-hero__meta').textContent = [itemLabel(heroItem), mins ? formatRuntime(mins * 600000000) : formatRuntime(heroItem.RunTimeTicks), mins ? 'ENDS ' + finishClock(mins) : ''].filter(Boolean).join(' / ');
      hero.querySelector('p').textContent = heroItem.Overview || 'Continue where you left off, or open the details.';
      hero.querySelector('.va224-home-hero__actions').innerHTML = '<button type="button" class="is-primary" data-va224-hero-action="play">▶ PLAY</button><button type="button" data-va224-hero-action="open">DETAILS</button>';
    }
    const host = home.querySelector('.va224-home-sections');
    host.innerHTML = '';
    [
      makeSection('VA / CONTINUITY', 'Continue the story', 'Resume what matters, then move naturally to what comes next.', data.continueStory),
      makeSection('VA / SHORT SIGNAL', 'One more episode', 'Episodes that fit comfortably into the next hour.', data.oneMore),
      makeSection('VA / LOST & FOUND', 'Fresh from the library', 'Unwatched films surfaced quickly without scanning thousands of files.', data.unwatched.slice(0, 12))
    ].filter(Boolean).forEach(section => host.appendChild(section));
  }

  async function mountHome() {
    const home = ensureHome();
    if (!home) return;
    const token = ++state.renderToken;
    const data = await loadFastData(false);
    if (token !== state.renderToken || C.routeKind() !== 'home') return;
    if (data) renderHome(data);
    else home.querySelector('.va224-home-hero__meta').textContent = 'Jellyfin is still starting. Navigation is already available.';
  }

  function budgetFromFinishTime(value) {
    if (!/^\d{2}:\d{2}$/.test(String(value || ''))) return 120;
    const [hours, minutes] = value.split(':').map(Number);
    const now = new Date();
    const target = new Date(now);
    target.setHours(hours, minutes, 0, 0);
    if (target.getTime() <= now.getTime() + 5 * 60000) target.setDate(target.getDate() + 1);
    return Math.max(10, Math.min(480, Math.floor((target.getTime() - now.getTime()) / 60000)));
  }

  function candidates(data, budget) {
    return unique([...(data?.resume || []), ...(data?.nextUp || []), ...(data?.unwatched || [])])
      .filter(item => {
        const mins = remainingMinutes(item);
        return mins > 0 && mins <= budget;
      })
      .map(item => ({ item, match: signalScore(item, budget) }))
      .sort((a, b) => b.match.score - a.match.score || remainingMinutes(a.item) - remainingMinutes(b.item))
      .slice(0, 8);
  }

  function renderTonight(panel, data, budget) {
    const resultHost = panel.querySelector('.va22-tonight__results');
    const picks = candidates(data, budget);
    panel.querySelector('.va22-tonight__summary').textContent = formatRuntime(budget * 600000000) + ' available • ' + (picks.length ? 'best matches first' : 'no strong matches yet');
    resultHost.innerHTML = '';
    if (!picks.length) return resultHost.innerHTML = '<div class="va22-empty">Nothing cleanly fits that window. Try a little more time.</div>';
    picks.forEach(({ item, match }, index) => {
      const card = makeCard(item);
      card.classList.add('va22-tonight-card');
      card.querySelector('.va22-signal-match').textContent = match.score + '% MATCH';
      const rank = document.createElement('span');
      rank.className = 'va22-tonight-card__rank';
      rank.textContent = String(index + 1).padStart(2, '0');
      card.appendChild(rank);
      resultHost.appendChild(card);
    });
  }

  async function openTonight() {
    if (document.getElementById(TONIGHT_ID)) return;
    const panel = document.createElement('section');
    panel.id = TONIGHT_ID;
    panel.className = 'va22-tonight';
    const finish = new Date(Date.now() + 120 * 60000);
    const timeValue = String(finish.getHours()).padStart(2, '0') + ':' + String(finish.getMinutes()).padStart(2, '0');
    panel.dataset.va224Budget = '120';
    panel.innerHTML = '<div class="va22-tonight__backdrop" data-va224-tonight-action="close"></div><div class="va22-tonight__panel"><header><div><span>VA / TONIGHT</span><h1>How much evening do you have?</h1><p>This opens immediately and uses a small fast dataset rather than waiting on a whole-library scan.</p></div><button type="button" class="va22-tonight__close" data-va224-tonight-action="close" aria-label="Close">×</button></header><div class="va22-tonight__controls"><button type="button" data-va224-budget="30">30 MIN</button><button type="button" data-va224-budget="60">1 HOUR</button><button type="button" data-va224-budget="90">90 MIN</button><button type="button" class="is-active" data-va224-budget="120">2 HOURS</button><label><span>FINISH BY</span><input type="time" value="' + timeValue + '"></label><button type="button" data-va224-tonight-action="surprise">SURPRISE ME</button></div><div class="va22-tonight__summary">TUNING A FAST SIGNAL…</div><div class="va22-tonight__results"><div class="va22-empty">Loading a small candidate set from Jellyfin…</div></div></div>';
    document.body.appendChild(panel);
    document.body.classList.add('va22-tonight-open');
    const data = await loadFastData(false);
    if (!panel.isConnected) return;
    if (!data) {
      panel.querySelector('.va22-tonight__summary').textContent = 'Jellyfin is still starting';
      panel.querySelector('.va22-tonight__results').innerHTML = '<div class="va22-empty">Try again in a moment. The rest of Velvet Antenna remains usable.</div>';
      return;
    }
    renderTonight(panel, data, 120);
  }

  function closeTonight() {
    document.getElementById(TONIGHT_ID)?.remove();
    document.body.classList.remove('va22-tonight-open');
  }

  function click(event) {
    const target = event.target;
    if (!target?.closest) return;
    if (target.closest('[data-va224-open-tonight]')) {
      event.preventDefault();
      return openTonight();
    }
    const tonightAction = target.closest('[data-va224-tonight-action]');
    if (tonightAction) {
      event.preventDefault();
      const action = tonightAction.dataset.va224TonightAction;
      if (action === 'close') return closeTonight();
      if (action === 'surprise') {
        const panel = document.getElementById(TONIGHT_ID);
        const budget = Number(panel?.dataset.va224Budget || 120);
        const picks = candidates(state.data, budget);
        if (!panel || !picks.length) return;
        const pick = picks[Math.floor(Math.random() * Math.min(5, picks.length))];
        const host = panel.querySelector('.va22-tonight__results');
        host.innerHTML = '';
        host.appendChild(makeCard(pick.item));
        panel.querySelector('.va22-tonight__summary').textContent = 'SURPRISE SIGNAL • ' + pick.match.score + '% MATCH';
        return;
      }
    }
    const budgetButton = target.closest('[data-va224-budget]');
    if (budgetButton) {
      const panel = budgetButton.closest('#' + TONIGHT_ID);
      if (!panel || !state.data) return;
      const budget = Number(budgetButton.dataset.va224Budget || 120);
      panel.dataset.va224Budget = String(budget);
      panel.querySelectorAll('[data-va224-budget]').forEach(button => button.classList.toggle('is-active', button === budgetButton));
      return renderTonight(panel, state.data, budget);
    }
    const cardAction = target.closest('[data-va224-card-action]');
    if (cardAction) {
      const id = cardAction.closest('[data-va224-id]')?.dataset.va224Id;
      if (!id) return;
      event.preventDefault();
      return cardAction.dataset.va224CardAction === 'play' ? queuePlay(id) : openDetails(id);
    }
    const card = target.closest('.va224-card[data-va224-id]');
    if (card && event.button === 0 && !target.closest('button,a,input,select')) {
      event.preventDefault();
      return openDetails(card.dataset.va224Id);
    }
    const heroAction = target.closest('[data-va224-hero-action]');
    if (heroAction) {
      const id = heroAction.closest('[data-va224-id]')?.dataset.va224Id;
      if (!id) return;
      event.preventDefault();
      return heroAction.dataset.va224HeroAction === 'play' ? queuePlay(id) : openDetails(id);
    }
  }

  function change(event) {
    const input = event.target;
    if (!input?.matches?.('#' + TONIGHT_ID + ' input[type="time"]')) return;
    const panel = document.getElementById(TONIGHT_ID);
    if (!panel || !state.data) return;
    const budget = budgetFromFinishTime(input.value);
    panel.dataset.va224Budget = String(budget);
    panel.querySelectorAll('[data-va224-budget]').forEach(button => button.classList.remove('is-active'));
    renderTonight(panel, state.data, budget);
  }

  function routeChanged() {
    state.renderToken += 1;
    if (C.routeKind() === 'home') mountHome(); else document.getElementById(HOME_ID)?.remove();
  }

  C.openTonight = openTonight;
  C.loadFastData = loadFastData;
  C.getItems = getItems;
  C.imageUrl = imageUrl;
  C.formatRuntime = formatRuntime;
  C.openDetails = openDetails;
  C.queuePlay = queuePlay;

  addEventListener('va224:route', routeChanged);
  addEventListener('click', click, true);
  addEventListener('change', change, true);
  if (C.routeKind() === 'home') mountHome();

  console.log('[Velvet Antenna] v0.22.4 fast Antenna Flow loaded');
})();
