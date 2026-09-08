(function () {
    'use strict';

    const VERSION = '0.22.0';
    const PREFIX = 'va22:';
    const FLOW_ID = 'va22-flow';
    const TONIGHT_ID = 'va22-tonight';
    const SERIES_ID = 'va22-series-continuity';
    const FINISH_ID = 'va22-finish-chip';
    const PENDING_PLAY = PREFIX + 'pending-play';
    const CACHE_TTL = 5 * 60 * 1000;
    const API_FIELDS = [
        'Overview', 'Genres', 'People', 'DateCreated', 'ProviderIds',
        'PrimaryImageAspectRatio', 'MediaSources', 'MediaStreams',
        'ParentBackdropImageTags', 'ParentBackdropItemId', 'BackdropImageTags'
    ].join(',');

    const STATE = {
        route: '',
        token: 0,
        flowData: null,
        flowFetchedAt: 0,
        recentGenres: new Map(),
        timers: [],
        pendingPlayTimer: null,
        tonightBudget: 120,
        seriesToken: 0
    };

    function api() { return window.ApiClient || null; }
    function uid() {
        const client = api();
        if (!client || typeof client.getCurrentUserId !== 'function') return '';
        try { return client.getCurrentUserId() || ''; } catch (error) { return ''; }
    }
    function sid() {
        const client = api();
        if (!client) return '';
        try {
            if (typeof client.serverId === 'function') return client.serverId() || '';
            if (typeof client.serverInfo === 'function') return client.serverInfo()?.Id || '';
            return client.serverId || client._serverId || '';
        } catch (error) { return ''; }
    }
    function route() { return window.location.hash || ''; }
    function lowerRoute() { return route().toLowerCase(); }
    function isHome() { return lowerRoute() === '#/home' || lowerRoute().startsWith('#/home?'); }
    function isDetails() { return /details\?id=|\/details\//i.test(route()); }
    function isPlayback() {
        return /videoosd|playback|nowplaying/i.test(lowerRoute()) ||
            Boolean(document.querySelector('.videoPlayerContainer:not(.hide), .videoOsdPage:not(.hide)'));
    }
    function currentDetailsId() {
        const match = route().match(/[?&]id=([^&]+)/i) || route().match(/\/details\/([^?&/]+)/i);
        return match && match[1] ? decodeURIComponent(match[1]) : '';
    }
    function detailsHash(id) {
        const server = sid();
        return '#/details?id=' + encodeURIComponent(id) + (server ? '&serverId=' + encodeURIComponent(server) : '');
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
        if (!total) return 0;
        return Math.max(1, Math.ceil(Math.max(0, total - pos) / 600000000));
    }
    function finishClock(minutes) {
        const end = new Date(Date.now() + Math.max(0, Number(minutes || 0)) * 60000);
        return end.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    function lastPlayedAge(item) {
        const value = item?.UserData?.LastPlayedDate;
        if (!value) return Infinity;
        const parsed = new Date(value).getTime();
        if (!Number.isFinite(parsed)) return Infinity;
        return Math.max(0, (Date.now() - parsed) / 86400000);
    }
    function createdAge(item) {
        if (!item?.DateCreated) return Infinity;
        const parsed = new Date(item.DateCreated).getTime();
        if (!Number.isFinite(parsed)) return Infinity;
        return Math.max(0, (Date.now() - parsed) / 86400000);
    }
    function safeText(value) { return String(value || '').trim(); }
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
        const client = api();
        if (!client || !item || typeof client.getImageUrl !== 'function') return '';
        const imageType = type || 'Primary';
        let tag = '';
        let id = item.Id;
        if (imageType === 'Backdrop') {
            tag = Array.isArray(item.BackdropImageTags) ? item.BackdropImageTags[0] : '';
            if (!tag && item.ParentBackdropItemId && Array.isArray(item.ParentBackdropImageTags)) {
                tag = item.ParentBackdropImageTags[0] || '';
                id = item.ParentBackdropItemId;
            }
        } else {
            tag = item.ImageTags && item.ImageTags[imageType];
        }
        if (!tag || !id) return '';
        try {
            return client.getImageUrl(id, {
                type: imageType,
                index: 0,
                tag,
                maxWidth: width || 760,
                quality: 84
            });
        } catch (error) { return ''; }
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
    function playable(item) { return /^(Movie|Episode|Video|Audio)$/i.test(item?.Type || ''); }

    async function getItems(options) {
        const client = api();
        const user = uid();
        if (!client || !user || typeof client.getItems !== 'function') return [];
        try {
            const result = await client.getItems(user, Object.assign({
                Fields: API_FIELDS,
                EnableTotalRecordCount: false
            }, options || {}));
            return Array.isArray(result?.Items) ? result.Items : [];
        } catch (error) {
            console.debug('[Velvet Antenna v0.22] getItems failed', error);
            return [];
        }
    }

    async function getNextUp(options) {
        const client = api();
        const user = uid();
        if (!client || !user || typeof client.getNextUpEpisodes !== 'function') return [];
        try {
            const result = await client.getNextUpEpisodes(Object.assign({
                UserId: user,
                Limit: 18,
                Fields: API_FIELDS
            }, options || {}));
            return Array.isArray(result?.Items) ? result.Items : [];
        } catch (error) {
            console.debug('[Velvet Antenna v0.22] next up failed', error);
            return [];
        }
    }

    function buildRecentGenreMap(items) {
        const map = new Map();
        (items || []).forEach(item => {
            (item.Genres || []).forEach(genre => {
                const key = safeText(genre).toLowerCase();
                if (key) map.set(key, (map.get(key) || 0) + 1);
            });
        });
        STATE.recentGenres = map;
    }

    function signalScore(item, budget) {
        let score = 42;
        const reasons = [];
        const rating = Number(item?.CommunityRating || 0);
        if (rating) {
            score += Math.min(26, rating * 2.6);
            if (rating >= 7.5) reasons.push('highly rated');
        }
        const userData = item?.UserData || {};
        if (userData.PlaybackPositionTicks > 0 && !userData.Played) {
            score += 18;
            reasons.unshift('already in progress');
        } else if (!userData.Played) {
            score += 9;
            reasons.push('unwatched');
        }
        const overlap = (item?.Genres || []).filter(genre => STATE.recentGenres.has(String(genre).toLowerCase()));
        if (overlap.length) {
            score += Math.min(15, 5 + overlap.length * 3);
            reasons.push(overlap[0]);
        }
        const mins = remainingMinutes(item);
        if (budget && mins && mins <= budget) {
            score += 12;
            reasons.unshift('fits your time');
        }
        if (createdAge(item) > 365) score += 3;
        if (lastPlayedAge(item) > 730 && userData.Played) {
            score += 8;
            reasons.push('worth rediscovering');
        }
        return {
            score: Math.max(1, Math.min(99, Math.round(score))),
            reasons: uniqueStrings(reasons).slice(0, 3)
        };
    }

    function uniqueStrings(values) {
        const seen = new Set();
        return (values || []).filter(value => {
            const key = String(value || '').trim().toLowerCase();
            if (!key || seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }

    async function loadFlowData(force) {
        if (!force && STATE.flowData && Date.now() - STATE.flowFetchedAt < CACHE_TTL) return STATE.flowData;
        const token = ++STATE.token;
        const [resume, nextUp, topUnwatched, oldPlayed, recentPlayed] = await Promise.all([
            getItems({
                Recursive: true,
                IncludeItemTypes: 'Movie,Episode',
                Filters: 'IsResumable',
                SortBy: 'DatePlayed',
                SortOrder: 'Descending',
                Limit: 18
            }),
            getNextUp(),
            getItems({
                Recursive: true,
                IncludeItemTypes: 'Movie',
                IsPlayed: false,
                SortBy: 'CommunityRating',
                SortOrder: 'Descending',
                Limit: 90
            }),
            getItems({
                Recursive: true,
                IncludeItemTypes: 'Movie',
                Filters: 'IsPlayed',
                SortBy: 'DatePlayed',
                SortOrder: 'Ascending',
                Limit: 45
            }),
            getItems({
                Recursive: true,
                IncludeItemTypes: 'Movie,Episode',
                Filters: 'IsPlayed',
                SortBy: 'DatePlayed',
                SortOrder: 'Descending',
                Limit: 24
            })
        ]);
        if (token !== STATE.token) return STATE.flowData;

        buildRecentGenreMap(recentPlayed);
        const continueStory = unique([...resume, ...nextUp]).slice(0, 14);
        const oneMore = unique(nextUp)
            .filter(item => {
                const mins = remainingMinutes(item);
                return mins > 0 && mins <= 50;
            })
            .slice(0, 12);
        const forgotten = unique(topUnwatched)
            .filter(item => createdAge(item) > 45)
            .sort((a, b) => signalScore(b).score - signalScore(a).score)
            .slice(0, 14);
        const rediscover = unique(oldPlayed)
            .filter(item => lastPlayedAge(item) > 180)
            .sort((a, b) => lastPlayedAge(b) - lastPlayedAge(a))
            .slice(0, 12);

        STATE.flowData = { resume, nextUp, continueStory, oneMore, forgotten, rediscover, recentPlayed };
        STATE.flowFetchedAt = Date.now();
        return STATE.flowData;
    }

    function homeHost() {
        return document.querySelector('.homeSectionsContainer') ||
            document.querySelector('.page.homePage') ||
            document.querySelector('#indexPage') ||
            document.querySelector('.libraryPage');
    }

    function makeCard(item, context) {
        const card = document.createElement('article');
        card.className = 'va22-card';
        card.tabIndex = 0;
        card.setAttribute('data-va22-id', item.Id || '');
        card.setAttribute('data-va22-type', item.Type || '');
        const art = imageUrl(item, context === 'poster' ? 'Primary' : 'Backdrop', context === 'poster' ? 420 : 840) || imageUrl(item, 'Primary', 520);
        const mins = remainingMinutes(item);
        const match = signalScore(item);
        const meta = [itemLabel(item), mins ? formatRuntime(mins * 600000000) : formatRuntime(item.RunTimeTicks)].filter(Boolean).join(' • ');
        const finish = mins ? 'ENDS ' + finishClock(mins) : '';
        card.innerHTML = `
            <div class="va22-card__art"></div>
            <div class="va22-card__shade"></div>
            <div class="va22-card__copy">
                <div class="va22-card__topline"><span class="va22-signal-match">${match.score}% MATCH</span><span>${finish}</span></div>
                <h3></h3>
                <p class="va22-card__meta"></p>
                <p class="va22-card__why"></p>
                <div class="va22-card__actions">
                    <button type="button" data-va22-action="open">DETAILS</button>
                    ${playable(item) ? '<button type="button" class="is-primary" data-va22-action="play">▶ PLAY</button>' : ''}
                </div>
            </div>
        `;
        if (art) card.querySelector('.va22-card__art').style.backgroundImage = `url("${art.replace(/"/g, '%22')}")`;
        card.querySelector('h3').textContent = item.Name || item.SeriesName || 'Untitled';
        card.querySelector('.va22-card__meta').textContent = meta;
        card.querySelector('.va22-card__why').textContent = match.reasons.length ? match.reasons.join(' • ') : 'from your library';
        return card;
    }

    function makeSection(kicker, title, description, items, context) {
        if (!items || !items.length) return null;
        const section = document.createElement('section');
        section.className = 'va22-flow-section';
        section.innerHTML = `
            <header class="va22-flow-section__head">
                <div><span>${kicker}</span><h2></h2><p></p></div>
                <b>${String(items.length).padStart(2, '0')}</b>
            </header>
            <div class="va22-rail"></div>
        `;
        section.querySelector('h2').textContent = title;
        section.querySelector('p').textContent = description;
        const rail = section.querySelector('.va22-rail');
        items.forEach(item => rail.appendChild(makeCard(item, context)));
        return section;
    }

    function createTonightTeaser(data) {
        const teaser = document.createElement('section');
        teaser.className = 'va22-tonight-teaser';
        const candidate = unique([...(data.continueStory || []), ...(data.forgotten || [])])
            .filter(item => remainingMinutes(item) && remainingMinutes(item) <= 120)
            .sort((a, b) => signalScore(b, 120).score - signalScore(a, 120).score)[0];
        const title = candidate ? candidate.Name : 'Find something worth watching';
        const mins = candidate ? remainingMinutes(candidate) : 0;
        teaser.innerHTML = `
            <div class="va22-tonight-teaser__signal" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
            <div class="va22-tonight-teaser__copy">
                <span>VA / TONIGHT</span>
                <h2>Stop browsing. Start watching.</h2>
                <p></p>
            </div>
            <button type="button" data-va22-open-tonight>BUILD TONIGHT <b>→</b></button>
        `;
        teaser.querySelector('p').textContent = candidate
            ? `${title}${mins ? ' fits in ' + formatRuntime(mins * 600000000) : ''}. Or tell Velvet Antenna how much time you have.`
            : 'Tell Velvet Antenna how much time you have and get a small set of strong choices.';
        return teaser;
    }

    async function mountFlow() {
        if (!isHome()) return;
        const hero = document.getElementById('va21-home-hero');
        const host = homeHost();
        if (!hero || !host) return;
        hero.classList.add('va22-hero');
        const heroIndex = hero.querySelector('.va21-hero__index i');
        if (heroIndex) heroIndex.textContent = '022';
        if (document.getElementById(FLOW_ID)) {
            document.body.classList.add('va22-home-owned');
            return;
        }
        const data = await loadFlowData(false);
        if (!isHome() || !data || document.getElementById(FLOW_ID)) return;

        const flow = document.createElement('main');
        flow.id = FLOW_ID;
        flow.className = 'va22-flow';
        flow.appendChild(createTonightTeaser(data));

        const continueSection = makeSection(
            'VA / CONTINUITY',
            'Continue the story',
            'Resume what matters, then move naturally to what comes next.',
            data.continueStory,
            'landscape'
        );
        const episodeSection = makeSection(
            'VA / SHORT SIGNAL',
            'One more episode',
            'Episodes that fit easily into the next hour, with the finish time already calculated.',
            data.oneMore,
            'landscape'
        );
        const forgottenSection = makeSection(
            'VA / LOST & FOUND',
            'Forgotten signals',
            'Strong unwatched films that have been buried by the size of your own library.',
            data.forgotten,
            'landscape'
        );
        const rediscoverSection = makeSection(
            'VA / ARCHIVE',
            'Rediscover',
            'Things you watched long enough ago to feel new again.',
            data.rediscover,
            'landscape'
        );
        [continueSection, episodeSection, forgottenSection, rediscoverSection].filter(Boolean).forEach(section => flow.appendChild(section));

        hero.insertAdjacentElement('afterend', flow);
        document.body.classList.add('va22-home-owned');
        document.body.setAttribute('data-va-version', VERSION);
        removeMaintenanceSurface();
    }

    function removeMaintenanceSurface() {
        document.querySelectorAll('[data-va21-workbench], #va21-workbench, #va21-identify-overlay').forEach(node => node.remove());
        document.body.classList.remove('va21-workbench-open');
    }

    function addTonightNav() {
        const nav = document.getElementById('va21-nav');
        const primary = nav && nav.querySelector('.va21-nav__primary');
        if (!primary || primary.querySelector('[data-va22-nav="tonight"]')) return;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'va21-nav__item va22-nav-tonight';
        button.setAttribute('data-va22-nav', 'tonight');
        button.textContent = 'TONIGHT';
        primary.appendChild(button);
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

    function tonightCandidates(data, budget) {
        const pool = unique([...(data.resume || []), ...(data.nextUp || []), ...(data.forgotten || [])]);
        return pool
            .filter(item => {
                const mins = remainingMinutes(item);
                return mins > 0 && mins <= budget;
            })
            .map(item => ({ item, match: signalScore(item, budget) }))
            .sort((a, b) => b.match.score - a.match.score || remainingMinutes(a.item) - remainingMinutes(b.item))
            .slice(0, 8);
    }

    function renderTonightResults(panel, data, budget) {
        const host = panel.querySelector('.va22-tonight__results');
        const summary = panel.querySelector('.va22-tonight__summary');
        const candidates = tonightCandidates(data, budget);
        host.innerHTML = '';
        summary.textContent = `${formatRuntime(budget * 600000000)} available • ${candidates.length ? 'best matches first' : 'no strong matches in that window'}`;
        if (!candidates.length) {
            host.innerHTML = '<div class="va22-empty">Nothing cleanly fits that window. Give yourself a little more time or use Surprise Me.</div>';
            return;
        }
        candidates.forEach(({ item, match }, index) => {
            const card = makeCard(item, 'landscape');
            card.classList.add('va22-tonight-card');
            card.querySelector('.va22-signal-match').textContent = match.score + '% MATCH';
            const why = card.querySelector('.va22-card__why');
            why.textContent = match.reasons.length ? match.reasons.join(' • ') : 'selected for tonight';
            const rank = document.createElement('span');
            rank.className = 'va22-tonight-card__rank';
            rank.textContent = String(index + 1).padStart(2, '0');
            card.appendChild(rank);
            host.appendChild(card);
        });
    }

    async function openTonight() {
        if (document.getElementById(TONIGHT_ID)) return;
        const data = await loadFlowData(false);
        if (!data) return;
        const panel = document.createElement('section');
        panel.id = TONIGHT_ID;
        panel.className = 'va22-tonight';
        const now = new Date();
        const defaultFinish = new Date(now.getTime() + 120 * 60000);
        const timeValue = String(defaultFinish.getHours()).padStart(2, '0') + ':' + String(defaultFinish.getMinutes()).padStart(2, '0');
        panel.innerHTML = `
            <div class="va22-tonight__backdrop" data-va22-tonight-action="close"></div>
            <div class="va22-tonight__panel">
                <header>
                    <div><span>VA / TONIGHT</span><h1>How much evening do you have?</h1><p>Velvet Antenna reduces the library to a handful of choices that actually fit.</p></div>
                    <button type="button" class="va22-tonight__close" data-va22-tonight-action="close" aria-label="Close">×</button>
                </header>
                <div class="va22-tonight__controls">
                    <button type="button" data-budget="30">30 MIN</button>
                    <button type="button" data-budget="60">1 HOUR</button>
                    <button type="button" data-budget="90">90 MIN</button>
                    <button type="button" class="is-active" data-budget="120">2 HOURS</button>
                    <label><span>FINISH BY</span><input type="time" value="${timeValue}"></label>
                    <button type="button" data-va22-tonight-action="surprise">SURPRISE ME</button>
                </div>
                <div class="va22-tonight__summary"></div>
                <div class="va22-tonight__results"></div>
            </div>
        `;
        document.body.appendChild(panel);
        document.body.classList.add('va22-tonight-open');
        STATE.tonightBudget = 120;
        renderTonightResults(panel, data, STATE.tonightBudget);
    }

    function closeTonight() {
        document.getElementById(TONIGHT_ID)?.remove();
        document.body.classList.remove('va22-tonight-open');
    }

    function surpriseTonight() {
        const panel = document.getElementById(TONIGHT_ID);
        if (!panel || !STATE.flowData) return;
        const candidates = tonightCandidates(STATE.flowData, STATE.tonightBudget);
        if (!candidates.length) return;
        const top = candidates.slice(0, Math.min(5, candidates.length));
        const pick = top[Math.floor(Math.random() * top.length)];
        const host = panel.querySelector('.va22-tonight__results');
        host.innerHTML = '';
        const card = makeCard(pick.item, 'landscape');
        card.classList.add('va22-tonight-card', 'va22-surprise-card');
        card.querySelector('.va22-card__why').textContent = 'Velvet Antenna picked one. Stop browsing.';
        host.appendChild(card);
        panel.querySelector('.va22-tonight__summary').textContent = `SURPRISE SIGNAL • ${pick.match.score}% match • ends ${finishClock(remainingMinutes(pick.item))}`;
    }

    function queuePlay(id) {
        if (!id) return;
        try { sessionStorage.setItem(PENDING_PLAY, JSON.stringify({ id: String(id), created: Date.now() })); } catch (error) { /* optional */ }
        try { sessionStorage.setItem(PREFIX + 'last-playing-id', String(id)); } catch (error) { /* optional */ }
        window.location.hash = detailsHash(id).slice(1);
        schedulePendingPlay(100);
    }

    function schedulePendingPlay(delay) {
        if (STATE.pendingPlayTimer) window.clearTimeout(STATE.pendingPlayTimer);
        STATE.pendingPlayTimer = window.setTimeout(tryPendingPlay, delay || 120);
    }

    function blockedPlay(el) {
        const label = [el?.textContent, el?.getAttribute?.('aria-label'), el?.getAttribute?.('title'), el?.className].filter(Boolean).join(' ');
        return /sync\s*play|watch\s*together|join\s*(?:a\s*)?group|watch\s*party|remote\s*play|play\s*to/i.test(label);
    }

    function tryPendingPlay(attempt) {
        let pending = null;
        try { pending = JSON.parse(sessionStorage.getItem(PENDING_PLAY) || 'null'); } catch (error) { pending = null; }
        if (!pending?.id || Date.now() - Number(pending.created || 0) > 20000) return;
        if (!isDetails() || currentDetailsId() !== String(pending.id)) {
            if ((attempt || 0) < 40) STATE.pendingPlayTimer = window.setTimeout(() => tryPendingPlay((attempt || 0) + 1), 180);
            return;
        }
        const buttons = Array.from(document.querySelectorAll('.btnPlay')).filter(button => button.isConnected && !button.disabled && !blockedPlay(button));
        const button = buttons.find(candidate => candidate.offsetParent !== null) || buttons[0];
        if (button) {
            try { sessionStorage.removeItem(PENDING_PLAY); } catch (error) { /* optional */ }
            button.click();
            return;
        }
        if ((attempt || 0) < 40) STATE.pendingPlayTimer = window.setTimeout(() => tryPendingPlay((attempt || 0) + 1), 180);
    }

    function openItem(id) {
        if (!id) return;
        window.location.hash = detailsHash(id).slice(1);
    }

    function onClick(event) {
        const target = event.target;
        if (!target || typeof target.closest !== 'function') return;

        const tonightNav = target.closest('[data-va22-nav="tonight"], [data-va22-open-tonight]');
        if (tonightNav) {
            event.preventDefault();
            event.stopPropagation();
            openTonight();
            return;
        }

        const tonightAction = target.closest('[data-va22-tonight-action]');
        if (tonightAction) {
            const action = tonightAction.getAttribute('data-va22-tonight-action');
            event.preventDefault();
            event.stopPropagation();
            if (action === 'close') closeTonight();
            if (action === 'surprise') surpriseTonight();
            return;
        }

        const budget = target.closest('[data-budget]');
        if (budget && budget.closest('#' + TONIGHT_ID)) {
            const panel = budget.closest('#' + TONIGHT_ID);
            STATE.tonightBudget = Number(budget.getAttribute('data-budget')) || 120;
            panel.querySelectorAll('[data-budget]').forEach(button => button.classList.toggle('is-active', button === budget));
            renderTonightResults(panel, STATE.flowData, STATE.tonightBudget);
            return;
        }

        const action = target.closest('[data-va22-action]');
        if (action) {
            const card = action.closest('[data-va22-id]');
            const id = card?.getAttribute('data-va22-id');
            if (!id) return;
            event.preventDefault();
            event.stopPropagation();
            if (action.getAttribute('data-va22-action') === 'play') queuePlay(id);
            else openItem(id);
            return;
        }

        const card = target.closest('.va22-card[data-va22-id]');
        if (card && event.button === 0 && !target.closest('button, a, input, select')) {
            event.preventDefault();
            openItem(card.getAttribute('data-va22-id'));
            return;
        }

        const seriesPlay = target.closest('[data-va22-series-play]');
        if (seriesPlay) {
            event.preventDefault();
            event.stopPropagation();
            queuePlay(seriesPlay.getAttribute('data-va22-series-play'));
            return;
        }

        const nativePlay = target.closest('.btnPlay');
        if (nativePlay) {
            const id = currentDetailsId() || nativePlay.closest('[data-id]')?.getAttribute('data-id');
            if (id) {
                try { sessionStorage.setItem(PREFIX + 'last-playing-id', id); } catch (error) { /* optional */ }
            }
        }
    }

    function onChange(event) {
        const input = event.target;
        if (!input || !input.matches('#' + TONIGHT_ID + ' input[type="time"]')) return;
        const panel = document.getElementById(TONIGHT_ID);
        if (!panel || !STATE.flowData) return;
        STATE.tonightBudget = budgetFromFinishTime(input.value);
        panel.querySelectorAll('[data-budget]').forEach(button => button.classList.remove('is-active'));
        renderTonightResults(panel, STATE.flowData, STATE.tonightBudget);
    }

    async function mountSeriesContinuity() {
        if (!isDetails()) {
            document.getElementById(SERIES_ID)?.remove();
            document.getElementById(FINISH_ID)?.remove();
            return;
        }
        const id = currentDetailsId();
        const client = api();
        const user = uid();
        if (!id || !client || !user || typeof client.getItem !== 'function') return;
        const token = ++STATE.seriesToken;
        let item = null;
        try { item = await client.getItem(user, id); } catch (error) { return; }
        if (!item || token !== STATE.seriesToken || currentDetailsId() !== id) return;

        mountFinishTime(item);
        if (item.Type !== 'Series') {
            document.getElementById(SERIES_ID)?.remove();
            return;
        }

        const [next, allEpisodes, playedEpisodes] = await Promise.all([
            getNextUp({ SeriesId: id, Limit: 1 }),
            getItems({ ParentId: id, Recursive: true, IncludeItemTypes: 'Episode', Limit: 500 }),
            getItems({ ParentId: id, Recursive: true, IncludeItemTypes: 'Episode', Filters: 'IsPlayed', Limit: 500 })
        ]);
        if (token !== STATE.seriesToken || currentDetailsId() !== id) return;
        const nextEpisode = next[0] || null;
        let block = document.getElementById(SERIES_ID);
        if (!block) {
            block = document.createElement('section');
            block.id = SERIES_ID;
            block.className = 'va22-series-continuity';
            const anchor = document.getElementById('va21-detail-playbar') || document.querySelector('.itemName') || document.querySelector('.detailPagePrimaryContent');
            if (!anchor) return;
            anchor.insertAdjacentElement('afterend', block);
        }
        const total = allEpisodes.length;
        const played = playedEpisodes.length;
        const pct = total ? Math.round((played / total) * 100) : 0;
        block.innerHTML = `
            <div class="va22-series-continuity__copy">
                <span>VA / CONTINUE THE STORY</span>
                <h3></h3>
                <p></p>
                <div class="va22-series-progress"><i style="width:${pct}%"></i></div>
                <small>${total ? played + ' OF ' + total + ' EPISODES WATCHED' : 'SERIES CONTINUITY'}</small>
            </div>
            <div class="va22-series-continuity__action"></div>
        `;
        const title = block.querySelector('h3');
        const desc = block.querySelector('p');
        const action = block.querySelector('.va22-series-continuity__action');
        if (nextEpisode) {
            const mins = remainingMinutes(nextEpisode);
            title.textContent = `Next: ${nextEpisode.Name || 'Next episode'}`;
            desc.textContent = [itemLabel(nextEpisode), mins ? formatRuntime(mins * 600000000) : '', mins ? 'ENDS ' + finishClock(mins) : ''].filter(Boolean).join(' • ');
            action.innerHTML = `<button type="button" data-va22-series-play="${nextEpisode.Id}">▶ CONTINUE SERIES</button>`;
        } else {
            title.textContent = 'Series complete';
            desc.textContent = total ? `You have watched ${played} of ${total} episodes.` : 'No next episode is currently available.';
        }
    }

    function mountFinishTime(item) {
        document.getElementById(FINISH_ID)?.remove();
        if (!playable(item)) return;
        const mins = remainingMinutes(item);
        if (!mins) return;
        const chip = document.createElement('div');
        chip.id = FINISH_ID;
        chip.className = 'va22-finish-chip';
        const inProgress = Number(item?.UserData?.PlaybackPositionTicks || 0) > 0 && !item?.UserData?.Played;
        chip.innerHTML = `<span>${inProgress ? 'REMAINING' : 'RUNTIME'}</span><b>${formatRuntime(mins * 600000000)}</b><i>ENDS ${finishClock(mins)}</i>`;
        const anchor = document.getElementById('va21-detail-playbar') || document.querySelector('.itemName');
        if (anchor) anchor.insertAdjacentElement('afterend', chip);
    }

    function clearHome() {
        document.getElementById(FLOW_ID)?.remove();
        document.body.classList.remove('va22-home-owned');
    }

    function schedulePasses() {
        STATE.timers.forEach(timer => window.clearTimeout(timer));
        STATE.timers = [];
        [0, 220, 650, 1300, 2400, 4200].forEach(delay => {
            STATE.timers.push(window.setTimeout(() => {
                addTonightNav();
                removeMaintenanceSurface();
                if (isHome()) mountFlow();
                else clearHome();
                if (isDetails()) mountSeriesContinuity();
                else {
                    document.getElementById(SERIES_ID)?.remove();
                    document.getElementById(FINISH_ID)?.remove();
                }
                if (isDetails()) schedulePendingPlay(80);
                document.body?.setAttribute('data-va-version', VERSION);
            }, delay));
        });
    }

    function routeChanged() {
        STATE.route = route();
        STATE.seriesToken += 1;
        closeTonight();
        schedulePasses();
    }

    function keyHandler(event) {
        if (event.key === 'Escape' && document.getElementById(TONIGHT_ID)) {
            closeTonight();
            return;
        }
        if ((event.key === 'Enter' || event.key === ' ') && event.target?.matches?.('.va22-card[data-va22-id]')) {
            event.preventDefault();
            openItem(event.target.getAttribute('data-va22-id'));
        }
    }

    document.addEventListener('click', onClick, true);
    document.addEventListener('change', onChange, true);
    document.addEventListener('keydown', keyHandler, true);
    window.addEventListener('hashchange', routeChanged);
    window.addEventListener('popstate', routeChanged);
    STATE.route = route();
    schedulePasses();

    window.VelvetAntenna22 = Object.assign(window.VelvetAntenna22 || {}, {
        version: VERSION,
        openTonight,
        refreshFlow: () => { STATE.flowData = null; STATE.flowFetchedAt = 0; clearHome(); mountFlow(); },
        queuePlay,
        lastPlayingKey: PREFIX + 'last-playing-id'
    });

    console.log('[Velvet Antenna] v' + VERSION + ' Antenna Flow loaded');
})();