(function () {
    'use strict';

    const VERSION = '0.22.3';
    const STAGE_ID = 'va21-library-stage';
    const LAST_KIND_KEY = 'velvet-antenna-v0223:last-kind';
    const STATE = {
        timers: [],
        routeToken: 0,
        hoverTimer: null,
        itemCache: new Map(),
        firstItemCache: new Map()
    };

    function api() { return window.ApiClient || null; }

    function userId() {
        const client = api();
        if (!client || typeof client.getCurrentUserId !== 'function') return '';
        try { return client.getCurrentUserId() || ''; }
        catch (error) { return ''; }
    }

    function serverId() {
        const client = api();
        if (!client) return '';
        try {
            if (typeof client.serverId === 'function') return client.serverId() || '';
            if (typeof client.serverInfo === 'function') return client.serverInfo()?.Id || '';
            return client.serverId || client._serverId || '';
        } catch (error) { return ''; }
    }

    function route() { return String(window.location.hash || ''); }

    function lastKind() {
        try { return sessionStorage.getItem(LAST_KIND_KEY) || ''; }
        catch (error) { return ''; }
    }

    function libraryKind() {
        const value = route().toLowerCase();
        if (value.startsWith('#/movies')) return 'movies';
        if (value.startsWith('#/tv')) return 'series';
        if (value.startsWith('#/boxsets')) return 'collections';
        if (value.startsWith('#/list?') || value.startsWith('#/mixed?')) {
            const kind = lastKind();
            if (['movies', 'series', 'collections', 'anime'].includes(kind)) return kind;
        }
        return '';
    }

    function parentId() {
        const value = route();
        const match = value.match(/[?&](?:topParentId|parentId)=([^&]+)/i);
        return match && match[1] ? decodeURIComponent(match[1]) : '';
    }

    function pageHost() {
        const candidates = Array.from(document.querySelectorAll('.libraryPage, .page, [data-role="page"]'));
        return candidates.find(el => el.offsetParent !== null && !el.closest('#va21-workbench')) || candidates[0] || null;
    }

    function forceLibrarySurface(kind) {
        if (!document.body || !kind) return;
        document.body.classList.remove('va21-page-other');
        document.body.classList.add('va21-viewer', 'va21-page-library');
        document.body.setAttribute('data-va223-library', kind);
    }

    function labelFor(kind) {
        return {
            movies: ['MOVIES', 'Film without the filing cabinet.'],
            series: ['SERIES', 'Stories arranged around what you want to watch next.'],
            collections: ['COLLECTIONS', 'Franchises, worlds and curated sets.'],
            anime: ['ANIME', 'Your animated library, brought into focus.']
        }[kind] || ['LIBRARY', 'Your media, in focus.'];
    }

    function createStage(kind) {
        const label = labelFor(kind);
        const stage = document.createElement('section');
        stage.id = STAGE_ID;
        stage.className = 'va21-stage';
        stage.setAttribute('data-va223-owned', VERSION);
        stage.innerHTML = `
            <div class="va21-stage__art" aria-hidden="true"></div>
            <div class="va21-stage__noise" aria-hidden="true"></div>
            <div class="va21-stage__shade" aria-hidden="true"></div>
            <div class="va21-stage__content">
                <div class="va21-kicker"><span>VELVET LENS</span><b class="va21-stage__library"></b></div>
                <h1 class="va21-stage__title"></h1>
                <div class="va21-stage__meta"></div>
                <p class="va21-stage__overview"></p>
                <div class="va21-stage__actions">
                    <button type="button" class="va21-button va21-button--primary" data-va223-action="open">OPEN</button>
                    <button type="button" class="va21-button va21-button--ghost" data-va223-action="play">PLAY</button>
                    <button type="button" hidden data-va21-stage-action="open" aria-hidden="true"></button>
                    <button type="button" hidden data-va21-stage-action="play" aria-hidden="true"></button>
                </div>
            </div>
            <div class="va21-stage__side">
                <span class="va21-stage__count">LOCKING SIGNAL</span>
            </div>
        `;
        stage.querySelector('.va21-stage__library').textContent = label[0];
        stage.querySelector('.va21-stage__title').textContent = label[0];
        stage.querySelector('.va21-stage__meta').textContent = 'LOADING LIBRARY SIGNAL';
        stage.querySelector('.va21-stage__overview').textContent = label[1];
        return stage;
    }

    function ensureStage(kind) {
        if (!kind) {
            document.body?.removeAttribute('data-va223-library');
            return null;
        }

        forceLibrarySurface(kind);
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

        const label = labelFor(kind);
        const library = stage.querySelector('.va21-stage__library');
        if (library) library.textContent = label[0];
        stage.setAttribute('data-va223-kind', kind);
        return stage;
    }

    function formatRuntime(ticks) {
        const value = Number(ticks || 0);
        if (!value) return '';
        const mins = Math.round(value / 600000000);
        if (mins < 60) return mins + ' min';
        const hours = Math.floor(mins / 60);
        const remaining = mins % 60;
        return remaining ? hours + 'h ' + remaining + 'm' : hours + 'h';
    }

    function imageUrl(item) {
        const client = api();
        if (!client || !item || typeof client.getImageUrl !== 'function') return '';
        try {
            const tag = Array.isArray(item.BackdropImageTags) && item.BackdropImageTags[0];
            if (tag) {
                return client.getImageUrl(item.Id, { type: 'Backdrop', index: 0, tag, maxWidth: 1900, quality: 86 });
            }
            const parentTag = Array.isArray(item.ParentBackdropImageTags) && item.ParentBackdropImageTags[0];
            if (parentTag && item.ParentBackdropItemId) {
                return client.getImageUrl(item.ParentBackdropItemId, { type: 'Backdrop', index: 0, tag: parentTag, maxWidth: 1900, quality: 86 });
            }
        } catch (error) { /* artwork is optional */ }
        return '';
    }

    async function getItem(id) {
        if (!id) return null;
        if (STATE.itemCache.has(id)) return STATE.itemCache.get(id);
        const client = api();
        const uid = userId();
        if (!client || !uid) return null;

        let item = null;
        try {
            if (typeof client.getItem === 'function') item = await client.getItem(uid, id);
            else if (typeof client.getItems === 'function') {
                const result = await client.getItems(uid, {
                    Ids: id,
                    Fields: 'Overview,ParentBackdropItemId,ParentBackdropImageTags',
                    EnableTotalRecordCount: false
                });
                item = result?.Items?.[0] || null;
            }
        } catch (error) {
            console.debug('[Velvet Antenna v0.22.3] Lens item fetch failed', id, error);
        }
        if (item) STATE.itemCache.set(id, item);
        return item;
    }

    function includeTypes(kind) {
        if (kind === 'movies') return 'Movie';
        if (kind === 'series' || kind === 'anime') return 'Series';
        if (kind === 'collections') return 'BoxSet,Movie,Series';
        return 'Movie,Series';
    }

    async function firstLibraryItem(kind, parent) {
        const key = kind + ':' + parent;
        if (STATE.firstItemCache.has(key)) return STATE.firstItemCache.get(key);
        const client = api();
        const uid = userId();
        if (!client || !uid || typeof client.getItems !== 'function' || !parent) return null;
        try {
            const result = await client.getItems(uid, {
                ParentId: parent,
                Recursive: kind !== 'collections',
                IncludeItemTypes: includeTypes(kind),
                Fields: 'Overview,ParentBackdropItemId,ParentBackdropImageTags',
                SortBy: 'SortName',
                SortOrder: 'Ascending',
                Limit: 1,
                EnableTotalRecordCount: false
            });
            const item = result?.Items?.[0] || null;
            if (item) {
                STATE.firstItemCache.set(key, item);
                STATE.itemCache.set(String(item.Id), item);
            }
            return item;
        } catch (error) {
            console.debug('[Velvet Antenna v0.22.3] Lens first-item fetch failed', error);
            return null;
        }
    }

    function renderItem(stage, item, token) {
        if (!stage || !item || token !== STATE.routeToken || !stage.isConnected) return;
        stage.classList.add('has-item');
        stage.setAttribute('data-va223-item-id', String(item.Id));
        stage.setAttribute('data-item-type', item.Type || '');

        const title = stage.querySelector('.va21-stage__title');
        const meta = stage.querySelector('.va21-stage__meta');
        const overview = stage.querySelector('.va21-stage__overview');
        const count = stage.querySelector('.va21-stage__count');
        const play = stage.querySelector('[data-va223-action="play"]');

        if (title) title.textContent = item.Name || 'Untitled';
        const parts = [];
        if (item.ProductionYear) parts.push(String(item.ProductionYear));
        const runtime = formatRuntime(item.RunTimeTicks);
        if (runtime) parts.push(runtime);
        if (item.OfficialRating) parts.push(item.OfficialRating);
        if (item.CommunityRating) parts.push('★ ' + Number(item.CommunityRating).toFixed(1));
        if (meta) meta.textContent = parts.join(' / ');
        if (overview) overview.textContent = item.Overview || 'No synopsis available.';
        if (count) count.textContent = 'IN THE LENS';
        if (play) play.hidden = !/^(Movie|Episode|Video|Audio)$/i.test(item.Type || '');

        const backdrop = imageUrl(item);
        if (!backdrop) {
            stage.classList.remove('art-ready');
            stage.style.removeProperty('--va21-stage-backdrop');
            return;
        }
        const image = new Image();
        image.onload = () => {
            if (!stage.isConnected || token !== STATE.routeToken || stage.getAttribute('data-va223-item-id') !== String(item.Id)) return;
            stage.style.setProperty('--va21-stage-backdrop', `url("${backdrop.replace(/"/g, '%22')}")`);
            stage.classList.add('art-ready');
        };
        image.src = backdrop;
    }

    function cardItemId(card) {
        if (!card) return '';
        const candidates = [
            card.getAttribute('data-id'),
            card.getAttribute('data-itemid'),
            card.dataset?.id,
            card.dataset?.itemid,
            card.querySelector('[data-id]')?.getAttribute('data-id'),
            card.querySelector('[data-itemid]')?.getAttribute('data-itemid')
        ];
        const direct = candidates.find(Boolean);
        if (direct) return String(direct);
        const link = card.closest('a[href]') || card.querySelector('a[href]');
        const href = link?.getAttribute('href') || '';
        const match = href.match(/[?&]id=([^&]+)/i) || href.match(/\/details\/([^?&/]+)/i);
        return match?.[1] ? decodeURIComponent(match[1]) : '';
    }

    async function focusItem(id) {
        const kind = libraryKind();
        if (!kind || !id) return;
        const token = STATE.routeToken;
        const stage = ensureStage(kind);
        if (!stage) return;
        const item = await getItem(id);
        renderItem(stage, item, token);
    }

    function scheduleCardFocus(card, delay) {
        const id = cardItemId(card);
        if (!id) return;
        if (STATE.hoverTimer) window.clearTimeout(STATE.hoverTimer);
        STATE.hoverTimer = window.setTimeout(() => focusItem(id), delay);
    }

    function onPointerOver(event) {
        if (!libraryKind()) return;
        const card = event.target?.closest?.('.card');
        if (card && !card.closest('#' + STAGE_ID)) scheduleCardFocus(card, 70);
    }

    function onFocusIn(event) {
        if (!libraryKind()) return;
        const card = event.target?.closest?.('.card');
        if (card && !card.closest('#' + STAGE_ID)) scheduleCardFocus(card, 20);
    }

    function detailsHash(id) {
        const sid = serverId();
        return '#/details?id=' + encodeURIComponent(id) + (sid ? '&serverId=' + encodeURIComponent(sid) : '');
    }

    function onStageClick(event) {
        const action = event.target?.closest?.('#' + STAGE_ID + ' [data-va223-action]');
        if (!action) return;
        const stage = action.closest('#' + STAGE_ID);
        const id = stage?.getAttribute('data-va223-item-id');
        if (!id) return;
        event.preventDefault();
        event.stopPropagation();
        const type = action.getAttribute('data-va223-action');
        if (type === 'play' && window.VelvetAntenna22?.queuePlay) {
            window.VelvetAntenna22.queuePlay(id);
            return;
        }
        window.location.hash = detailsHash(id).slice(1);
    }

    async function mountReliableStage() {
        const kind = libraryKind();
        if (!kind) return;
        const token = STATE.routeToken;
        const stage = ensureStage(kind);
        const parent = parentId();
        if (!stage || !parent) return;

        if (stage.getAttribute('data-va223-route') !== route()) {
            stage.setAttribute('data-va223-route', route());
            stage.removeAttribute('data-va223-item-id');
            stage.classList.remove('has-item', 'art-ready');
            const label = labelFor(kind);
            stage.querySelector('.va21-stage__title').textContent = label[0];
            stage.querySelector('.va21-stage__meta').textContent = 'LOCKING LIBRARY SIGNAL';
            stage.querySelector('.va21-stage__overview').textContent = label[1];
        }

        if (stage.getAttribute('data-va223-item-id')) return;
        const item = await firstLibraryItem(kind, parent);
        renderItem(stage, item, token);
    }

    function schedulePasses() {
        STATE.timers.forEach(id => window.clearTimeout(id));
        STATE.timers = [];
        [0, 80, 220, 500, 1000, 1800, 3200, 5200].forEach(delay => {
            STATE.timers.push(window.setTimeout(mountReliableStage, delay));
        });
    }

    function routeChanged() {
        STATE.routeToken += 1;
        if (STATE.hoverTimer) window.clearTimeout(STATE.hoverTimer);
        const kind = libraryKind();
        if (!kind) {
            document.body?.removeAttribute('data-va223-library');
        }
        schedulePasses();
    }

    document.addEventListener('pointerover', onPointerOver, true);
    document.addEventListener('focusin', onFocusIn, true);
    document.addEventListener('click', onStageClick, true);
    window.addEventListener('hashchange', routeChanged);
    window.addEventListener('popstate', routeChanged);
    window.addEventListener('resize', schedulePasses);

    routeChanged();
    console.log('[Velvet Antenna] v' + VERSION + ' deterministic library stage loaded');
})();