(function () {
    'use strict';

    if (window.__VELVET_ANTENNA_V0202_MAINTENANCE__) return;
    window.__VELVET_ANTENNA_V0202_MAINTENANCE__ = true;

    const VERSION = '0.20.2';
    const STYLE_ID = 'va20-maintenance-style';
    const TOOL_ATTR = 'data-va20-maintenance';
    const MAX_BATCH = 100;

    const STATE = {
        mode: '',
        busy: false,
        scanToken: 0,
        lastRoute: window.location.hash || '',
        itemMap: new Map(),
        observer: null,
        renderTimer: null,
        admin: false,
        adminResolved: false
    };

    function api() {
        return window.ApiClient || null;
    }

    function route() {
        return window.location.hash || '';
    }

    function isLibrary() {
        return Boolean(document.body && document.body.classList.contains('va20-page-library'));
    }

    function libraryKind() {
        const value = route().toLowerCase();
        if (value.includes('collectiontype=movies') || value.startsWith('#/movies')) return 'movies';
        if (value.includes('collectiontype=tvshows') || value.startsWith('#/tv')) return 'series';
        return '';
    }

    function maintenanceEligible() {
        const kind = libraryKind();
        return isLibrary() && (kind === 'movies' || kind === 'series');
    }

    function cardItemId(card) {
        if (!card) return '';
        const candidates = [
            card,
            card.querySelector('[data-id]'),
            card.querySelector('[data-itemid]'),
            card.closest('[data-id]'),
            card.closest('[data-itemid]')
        ].filter(Boolean);
        for (const node of candidates) {
            const value = (node.dataset && (node.dataset.id || node.dataset.itemid || node.dataset.itemId)) ||
                node.getAttribute('data-id') || node.getAttribute('data-itemid');
            if (value) return value;
        }
        const link = card.closest('a[href]') || card.querySelector('a[href]');
        const href = link && link.getAttribute('href');
        const match = href && (href.match(/[?&]id=([^&]+)/i) || href.match(/details\?id=([^&]+)/i));
        return match && match[1] ? decodeURIComponent(match[1]) : '';
    }

    function cardTitle(card) {
        if (!card) return '';
        const first = card.querySelector('.cardText-first, .cardText, .itemName, [title]');
        return ((first && (first.textContent || first.getAttribute('title'))) || card.getAttribute('aria-label') || '').trim();
    }

    function libraryCards() {
        const seen = new Set();
        return Array.from(document.querySelectorAll('.va20-library-card.card, body.va20-page-library .card')).filter(card => {
            if (card.closest('#va20-library-intro')) return false;
            const id = cardItemId(card);
            if (!id || seen.has(id)) return false;
            seen.add(id);
            return true;
        });
    }

    async function resolveAdmin() {
        if (STATE.adminResolved) return STATE.admin;
        const client = api();
        if (!client || typeof client.getCurrentUser !== 'function') return false;
        try {
            const user = await client.getCurrentUser();
            STATE.admin = Boolean(user && user.Policy && user.Policy.IsAdministrator);
            STATE.adminResolved = true;
            return STATE.admin;
        } catch (error) {
            return false;
        }
    }

    function chunks(values, size) {
        const out = [];
        for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size));
        return out;
    }

    async function fetchItems(ids) {
        const client = api();
        if (!client || typeof client.getItems !== 'function' || typeof client.getCurrentUserId !== 'function') return [];
        const unique = Array.from(new Set(ids.filter(Boolean)));
        const items = [];
        for (const batch of chunks(unique, MAX_BATCH)) {
            let result = null;
            try {
                result = await client.getItems(client.getCurrentUserId(), {
                    Ids: batch.join(','),
                    Fields: 'ProviderIds,MediaSources,MediaStreams,Path',
                    EnableTotalRecordCount: false
                });
            } catch (error) {
                console.warn('[Velvet Antenna] v0.20.2 batch metadata lookup failed', error);
            }
            if (result && Array.isArray(result.Items)) items.push(...result.Items);
        }
        return items;
    }

    function providerEntries(item) {
        const ids = item && item.ProviderIds && typeof item.ProviderIds === 'object' ? item.ProviderIds : {};
        return Object.entries(ids).filter(entry => String(entry[1] || '').trim());
    }

    function hasProviderId(item) {
        return providerEntries(item).length > 0;
    }

    function strongProviderKeys(item) {
        return providerEntries(item)
            .filter(entry => /^(imdb|tmdb|tvdb|anidb|tvmaze|trakt)$/i.test(String(entry[0] || '').replace(/[^a-z0-9]/gi, '')))
            .map(entry => String(entry[0]).toLowerCase() + ':' + String(entry[1]).trim().toLowerCase());
    }

    function titleKey(value) {
        return String(value || '')
            .normalize('NFKD')
            .toLowerCase()
            .replace(/&/g, ' and ')
            .replace(/[^a-z0-9]+/g, ' ')
            .replace(/\b(extended|unrated|directors cut|director s cut|theatrical|remastered|edition)\b/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function fileName(item) {
        const source = item && Array.isArray(item.MediaSources) && item.MediaSources.length ? item.MediaSources[0] : null;
        const path = (source && source.Path) || (item && item.Path) || '';
        return String(path).split(/[\\/]/).pop() || '';
    }

    function bytesLabel(bytes) {
        const value = Number(bytes || 0);
        if (!value) return '';
        const gb = value / 1073741824;
        if (gb >= 1) return gb.toFixed(gb >= 10 ? 1 : 2) + ' GB';
        return (value / 1048576).toFixed(0) + ' MB';
    }

    function bitrateLabel(value) {
        const bitrate = Number(value || 0);
        if (!bitrate) return '';
        return (bitrate / 1000000).toFixed(bitrate >= 10000000 ? 0 : 1) + ' Mbps';
    }

    function qualitySummary(item) {
        const source = item && Array.isArray(item.MediaSources) && item.MediaSources.length ? item.MediaSources[0] : null;
        const streams = (source && Array.isArray(source.MediaStreams) && source.MediaStreams.length)
            ? source.MediaStreams
            : (item && Array.isArray(item.MediaStreams) ? item.MediaStreams : []);
        const video = streams.find(stream => String(stream.Type || '').toLowerCase() === 'video');
        const audio = streams.find(stream => String(stream.Type || '').toLowerCase() === 'audio');
        const parts = [];
        if (video) {
            const height = Number(video.Height || 0);
            const width = Number(video.Width || 0);
            if (height >= 2000 || width >= 3500) parts.push('2160p');
            else if (height >= 1000 || width >= 1800) parts.push('1080p');
            else if (height >= 700 || width >= 1200) parts.push('720p');
            else if (height) parts.push(height + 'p');
            if (video.Codec) parts.push(String(video.Codec).toUpperCase());
            const range = [video.VideoRange, video.VideoRangeType, video.Hdr10PlusPresent ? 'HDR10+' : '', video.DvVersionMajor ? 'DV' : '']
                .filter(Boolean).join(' ').toUpperCase();
            if (/DOLBY|DOVI|\bDV\b/.test(range)) parts.push('DV');
            else if (/HDR/.test(range)) parts.push('HDR');
            const br = bitrateLabel(video.BitRate || (source && source.Bitrate));
            if (br) parts.push(br);
        }
        if (audio) {
            const channels = Number(audio.Channels || 0);
            if (channels >= 8) parts.push('7.1');
            else if (channels >= 6) parts.push('5.1');
            if (audio.Codec) parts.push(String(audio.Codec).toUpperCase());
        }
        const size = bytesLabel(source && source.Size);
        if (size) parts.push(size);
        return parts.slice(0, 6).join(' • ');
    }

    function clearCardAnnotations() {
        libraryCards().forEach(card => {
            card.classList.remove('va20-maint-hidden', 'va20-needs-id', 'va20-duplicate');
            card.removeAttribute('data-va20-duplicate-group');
            card.querySelectorAll('.va20-maint-card-info').forEach(el => el.remove());
        });
        if (document.body) document.body.classList.remove('va20-maint-needs-id', 'va20-maint-duplicates');
    }

    function annotateCard(card, badge, summary, detail) {
        if (!card) return;
        let info = card.querySelector('.va20-maint-card-info');
        if (!info) {
            info = document.createElement('div');
            info.className = 'va20-maint-card-info';
            card.appendChild(info);
        }
        info.innerHTML = '';
        const badgeEl = document.createElement('span');
        badgeEl.className = 'va20-maint-badge';
        badgeEl.textContent = badge;
        info.appendChild(badgeEl);
        if (summary) {
            const summaryEl = document.createElement('span');
            summaryEl.className = 'va20-maint-summary';
            summaryEl.textContent = summary;
            info.appendChild(summaryEl);
        }
        if (detail) info.title = detail;
    }

    function toolButton(mode) {
        return document.querySelector('#va20-library-intro [' + TOOL_ATTR + '="' + mode + '"]');
    }

    function statusEl() {
        return document.querySelector('#va20-library-intro .va20-maint-status');
    }

    function setStatus(message, busy) {
        const el = statusEl();
        if (!el) return;
        el.textContent = message || '';
        el.classList.toggle('is-busy', Boolean(busy));
    }

    function updateButtons() {
        ['needs-id', 'duplicates'].forEach(mode => {
            const button = toolButton(mode);
            if (button) button.classList.toggle('is-active', STATE.mode === mode);
        });
    }

    function setModeOff(message) {
        STATE.scanToken += 1;
        STATE.mode = '';
        STATE.busy = false;
        STATE.itemMap.clear();
        clearCardAnnotations();
        updateButtons();
        setStatus(message || '', false);
    }

    async function scanNeedsId(token) {
        const cards = libraryCards();
        const ids = cards.map(cardItemId).filter(Boolean);
        const items = await fetchItems(ids);
        if (token !== STATE.scanToken || STATE.mode !== 'needs-id') return;
        STATE.itemMap = new Map(items.map(item => [String(item.Id), item]));
        let count = 0;
        cards.forEach(card => {
            const id = cardItemId(card);
            const item = STATE.itemMap.get(String(id));
            const needsId = item ? !hasProviderId(item) : true;
            card.classList.toggle('va20-maint-hidden', !needsId);
            card.classList.toggle('va20-needs-id', needsId);
            if (needsId) {
                count += 1;
                annotateCard(card, 'NEEDS ID', qualitySummary(item), fileName(item));
            }
        });
        if (document.body) document.body.classList.add('va20-maint-needs-id');
        STATE.busy = false;
        setStatus(count + ' of ' + cards.length + ' loaded items need identification', false);
    }

    function duplicateComponents(items) {
        const ids = items.map(item => String(item.Id));
        const parent = new Map(ids.map(id => [id, id]));
        const reason = new Map();
        function find(id) {
            let root = parent.get(id) || id;
            while (root !== parent.get(root)) root = parent.get(root);
            let node = id;
            while (parent.get(node) && parent.get(node) !== root) {
                const next = parent.get(node);
                parent.set(node, root);
                node = next;
            }
            return root;
        }
        function union(a, b, why) {
            const ra = find(a);
            const rb = find(b);
            if (ra === rb) return;
            parent.set(rb, ra);
            const existing = reason.get(ra) || reason.get(rb);
            reason.set(ra, existing === 'provider' || why === 'provider' ? 'provider' : why);
        }
        function unionBucket(bucket, why) {
            if (bucket.length < 2) return;
            for (let i = 1; i < bucket.length; i += 1) union(bucket[0], bucket[i], why);
        }

        const providerBuckets = new Map();
        items.forEach(item => {
            strongProviderKeys(item).forEach(key => {
                if (!providerBuckets.has(key)) providerBuckets.set(key, []);
                providerBuckets.get(key).push(String(item.Id));
            });
        });
        providerBuckets.forEach(bucket => unionBucket(Array.from(new Set(bucket)), 'provider'));

        const titleBuckets = new Map();
        items.forEach(item => {
            const name = titleKey(item.Name);
            const year = Number(item.ProductionYear || 0);
            if (!name || !year) return;
            const key = name + '|' + year;
            if (!titleBuckets.has(key)) titleBuckets.set(key, []);
            titleBuckets.get(key).push(String(item.Id));
        });
        titleBuckets.forEach(bucket => unionBucket(Array.from(new Set(bucket)), 'title-year'));

        const groups = new Map();
        ids.forEach(id => {
            const root = find(id);
            if (!groups.has(root)) groups.set(root, []);
            groups.get(root).push(id);
        });
        return Array.from(groups.entries())
            .filter(entry => entry[1].length > 1)
            .map(entry => ({ ids: entry[1], reason: reason.get(find(entry[0])) || 'title-year' }));
    }

    async function scanDuplicates(token) {
        const cards = libraryCards();
        const ids = cards.map(cardItemId).filter(Boolean);
        const items = await fetchItems(ids);
        if (token !== STATE.scanToken || STATE.mode !== 'duplicates') return;
        STATE.itemMap = new Map(items.map(item => [String(item.Id), item]));
        const groups = duplicateComponents(items);
        const memberships = new Map();
        groups.forEach((group, index) => group.ids.forEach(id => memberships.set(String(id), { index: index + 1, reason: group.reason })));
        let visible = 0;
        cards.forEach(card => {
            const id = String(cardItemId(card));
            const membership = memberships.get(id);
            card.classList.toggle('va20-maint-hidden', !membership);
            card.classList.toggle('va20-duplicate', Boolean(membership));
            if (!membership) return;
            visible += 1;
            card.setAttribute('data-va20-duplicate-group', String(membership.index));
            const item = STATE.itemMap.get(id);
            const reason = membership.reason === 'provider' ? 'same provider ID' : 'same title/year';
            annotateCard(card, 'DUP ' + membership.index, qualitySummary(item), reason + (fileName(item) ? ' • ' + fileName(item) : ''));
        });
        if (document.body) document.body.classList.add('va20-maint-duplicates');
        STATE.busy = false;
        setStatus(groups.length + ' duplicate groups • ' + visible + ' items on this loaded page', false);
    }

    async function toggleMode(mode) {
        if (STATE.busy) return;
        if (STATE.mode === mode) {
            setModeOff('Showing all loaded items');
            return;
        }
        clearCardAnnotations();
        STATE.mode = mode;
        STATE.busy = true;
        STATE.itemMap.clear();
        updateButtons();
        const token = ++STATE.scanToken;
        setStatus(mode === 'needs-id' ? 'Checking provider IDs…' : 'Comparing provider IDs, titles and media…', true);
        try {
            if (mode === 'needs-id') await scanNeedsId(token);
            else await scanDuplicates(token);
        } catch (error) {
            console.error('[Velvet Antenna] v0.20.2 maintenance scan failed', error);
            if (token === STATE.scanToken) setModeOff('Scan failed. Toggle the tool to retry.');
        }
    }

    function createTool(label, mode) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'va20-button va20-button--quiet va20-maint-tool';
        button.setAttribute(TOOL_ATTR, mode);
        button.textContent = label;
        button.title = mode === 'needs-id'
            ? 'Show loaded Movies/Series with no external provider IDs'
            : 'Show likely duplicate Movies/Series on the current loaded page';
        button.addEventListener('click', function () { toggleMode(mode); });
        return button;
    }

    async function mountTools() {
        if (!maintenanceEligible()) {
            setModeOff('');
            document.querySelectorAll('.va20-maint-tool, .va20-maint-status').forEach(el => el.remove());
            return;
        }
        if (!(await resolveAdmin())) return;
        const tools = document.querySelector('#va20-library-intro .va20-library-intro__tools');
        if (!tools) return;
        if (!tools.querySelector('[' + TOOL_ATTR + '="needs-id"]')) tools.appendChild(createTool('NEEDS ID', 'needs-id'));
        if (!tools.querySelector('[' + TOOL_ATTR + '="duplicates"]')) tools.appendChild(createTool('DUPLICATES', 'duplicates'));
        if (!tools.querySelector('.va20-maint-status')) {
            const status = document.createElement('span');
            status.className = 'va20-maint-status';
            status.textContent = 'Admin cleanup • right-click an item for native multi-select';
            tools.appendChild(status);
        }
        updateButtons();
    }

    function selectionActive() {
        return Boolean(document.querySelector('.selectionCommandsPanel, .itemSelectionPanel, .withMultiSelect, .chkItemSelect'));
    }

    function syncSelectionCompatibility() {
        const active = selectionActive();
        if (document.body) document.body.classList.toggle('va20-selection-active', active);
        document.querySelectorAll('.va20-library-card.card, body.va20-page-library .card').forEach(card => {
            if (active) {
                if (!card.hasAttribute('role')) {
                    card.setAttribute('role', 'button');
                    card.setAttribute('data-va20-selection-role', '1');
                }
            } else if (card.getAttribute('data-va20-selection-role') === '1') {
                card.removeAttribute('role');
                card.removeAttribute('data-va20-selection-role');
            }
        });
    }

    function injectStyle() {
        if (document.getElementById(STYLE_ID)) return;
        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `
            .va20-maint-tool.is-active {
                background: rgba(108,44,191,.58) !important;
                color: #fff !important;
                border-color: rgba(198,139,255,.48) !important;
                box-shadow: 0 0 0 1px rgba(198,139,255,.10) inset, 0 10px 25px rgba(0,0,0,.24);
            }
            .va20-maint-status {
                max-width: 260px;
                color: rgba(246,242,248,.52);
                font-size: .62rem;
                line-height: 1.35;
                letter-spacing: .04em;
            }
            .va20-maint-status.is-busy { color: var(--va20-highlight, #C68BFF); }
            .va20-maint-hidden { display: none !important; }
            .va20-maint-card-info {
                position: absolute;
                z-index: 32;
                left: 8px;
                right: 8px;
                bottom: 46px;
                display: flex;
                align-items: center;
                gap: 6px;
                pointer-events: none;
                min-width: 0;
            }
            .va20-maint-badge {
                flex: 0 0 auto;
                display: inline-flex;
                align-items: center;
                min-height: 24px;
                padding: 0 7px;
                border-radius: 999px;
                background: rgba(108,44,191,.92);
                border: 1px solid rgba(198,139,255,.34);
                color: #fff;
                font-size: .55rem;
                font-weight: 800;
                letter-spacing: .08em;
                box-shadow: 0 8px 22px rgba(0,0,0,.34);
            }
            .va20-maint-summary {
                min-width: 0;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
                padding: 5px 7px;
                border-radius: 7px;
                background: rgba(8,6,12,.88);
                color: rgba(246,242,248,.82);
                font-size: .55rem;
                border: 1px solid rgba(255,255,255,.08);
            }
            body.va20-maint-needs-id .va20-needs-id .va20-edit-metadata,
            body.va20-maint-duplicates .va20-duplicate .va20-edit-metadata {
                opacity: 1 !important;
                transform: translateY(0) !important;
                pointer-events: auto !important;
            }
            body.va20-selection-active .va20-edit-metadata,
            body.va20-selection-active .va20-maint-card-info {
                display: none !important;
            }
            body.va20-selection-active .va20-library-card,
            body.va20-selection-active .card {
                transform: none !important;
            }
            @media (max-width: 900px) {
                .va20-library-intro__tools { flex-wrap: wrap; }
                .va20-maint-status { width: 100%; max-width: none; }
            }
        `;
        document.head.appendChild(style);
    }

    function render() {
        injectStyle();
        syncSelectionCompatibility();
        mountTools();
    }

    function scheduleRender(delay) {
        window.clearTimeout(STATE.renderTimer);
        STATE.renderTimer = window.setTimeout(render, typeof delay === 'number' ? delay : 80);
    }

    function routeChanged() {
        const now = route();
        if (now !== STATE.lastRoute) {
            STATE.lastRoute = now;
            setModeOff('');
        }
        scheduleRender(60);
    }

    function start() {
        injectStyle();
        window.addEventListener('hashchange', routeChanged);
        window.addEventListener('popstate', routeChanged);
        STATE.observer = new MutationObserver(function () {
            scheduleRender(40);
        });
        STATE.observer.observe(document.documentElement, { childList: true, subtree: true });
        render();
        window.setTimeout(render, 500);
        window.setTimeout(render, 1300);
        console.log('[Velvet Antenna] v' + VERSION + ' admin maintenance loaded');
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
    else start();
})();
