    }

    async function openWorkbench(mode) {
        if (!STATE.admin || !['needs-id', 'duplicates'].includes(mode)) return;
        closeWorkbench();

        const panel = document.createElement('section');
        panel.id = IDS.workbench;
        panel.className = 'va21-workbench';
        panel.innerHTML = `
            <div class="va21-workbench__backdrop" data-va21-wb-action="close"></div>
            <div class="va21-workbench__panel">
                <header>
                    <div>
                        <div class="va21-kicker"><span>VA / ADMIN</span><b>${mode === 'needs-id' ? 'NEEDS ID' : 'DUPLICATES'}</b></div>
                        <h2>${mode === 'needs-id' ? 'Identification workbench' : 'Duplicate workbench'}</h2>
                        <p class="va21-workbench__status">Reading the whole library…</p>
                    </div>
                    <button type="button" class="va21-workbench__close" data-va21-wb-action="close" aria-label="Close">×</button>
                </header>
                <div class="va21-workbench__body"><div class="va21-spinner">TUNING…</div></div>
                <footer>
                    <button type="button" class="va21-button va21-button--ghost" data-va21-wb-action="prev">PREVIOUS</button>
                    <span class="va21-workbench__page"></span>
                    <button type="button" class="va21-button va21-button--ghost" data-va21-wb-action="next">NEXT</button>
                </footer>
            </div>
        `;
        document.body.appendChild(panel);
        document.body.classList.add('va21-workbench-open');

        const token = ++STATE.workbenchToken;
        STATE.workbench = { mode, page: 0, results: [], groups: null, token };

        try {
            const minimalFields = 'ProviderIds,Path,ImageTags,ProductionYear';
            const items = await fetchWholeLibrary(minimalFields);
            if (!STATE.workbench || STATE.workbench.token !== token) return;

            if (mode === 'needs-id') {
                STATE.workbench.results = items.filter(item => providerEntries(item).length === 0);
                renderWorkbench();
                return;
            }

            const groups = duplicateGroups(items);
            const ids = Array.from(new Set(groups.flat().map(item => String(item.Id))));
            const detailed = [];
            for (let i = 0; i < ids.length; i += 100) {
                const batch = ids.slice(i, i + 100);
                const client = api();
                const result = await client.getItems(userId(), {
                    Ids: batch.join(','),
                    Fields: 'ProviderIds,MediaSources,MediaStreams,Path,ImageTags,ProductionYear',
                    EnableTotalRecordCount: false
                });
                if (result && Array.isArray(result.Items)) detailed.push(...result.Items);
            }
            if (!STATE.workbench || STATE.workbench.token !== token) return;
            const detailMap = new Map(detailed.map(item => [String(item.Id), item]));
            STATE.workbench.groups = groups.map(group => group.map(item => detailMap.get(String(item.Id)) || item));
            STATE.workbench.results = STATE.workbench.groups.flat();
            renderWorkbench();
        } catch (error) {
            console.error('[Velvet Antenna] workbench failed', error);
            const status = panel.querySelector('.va21-workbench__status');
            const body = panel.querySelector('.va21-workbench__body');
            if (status) status.textContent = 'The library scan failed.';
            if (body) body.innerHTML = '<div class="va21-empty">Unable to read this library. Close the workbench and try again.</div>';
        }
    }

    function closeIdentifyOverlay() {
        document.getElementById('va21-identify-overlay')?.remove();
        STATE.identifySession = null;
    }

    function closeWorkbench() {
        STATE.workbenchToken += 1;
        STATE.workbench = null;
        closeIdentifyOverlay();
        document.getElementById(IDS.workbench)?.remove();
        document.body && document.body.classList.remove('va21-workbench-open');
    }

    function workbenchImage(item) {
        const client = api();
        if (!client || !item || !item.ImageTags || !item.ImageTags.Primary || typeof client.getImageUrl !== 'function') return '';
        try {
            return client.getImageUrl(item.Id, {
                type: 'Primary',
                tag: item.ImageTags.Primary,
                maxWidth: 220,
                quality: 78
            });
        } catch (error) { return ''; }
    }

    function workbenchResolution(item) {
        const source = item && Array.isArray(item.MediaSources) && item.MediaSources.length ? item.MediaSources[0] : null;
        const streams = source && Array.isArray(source.MediaStreams) && source.MediaStreams.length
            ? source.MediaStreams
            : (item && Array.isArray(item.MediaStreams) ? item.MediaStreams : []);
        const video = streams.find(stream => String(stream.Type || '').toLowerCase() === 'video');
        if (!video) return item && item.Type === 'Series' ? 'SERIES' : '';
        const height = Number(video.Height || 0);
        const width = Number(video.Width || 0);
        if (height >= 2000 || width >= 3500) return '2160P';
        if (height >= 1000 || width >= 1800) return '1080P';
        if (height >= 700 || width >= 1200) return '720P';
        return height ? height + 'P' : '';
    }

    function findWorkbenchItem(itemId) {
        if (!STATE.workbench) return null;
        const id = String(itemId || '');
        const direct = STATE.workbench.results.find(item => String(item.Id) === id);
        if (direct) return direct;
        if (Array.isArray(STATE.workbench.groups)) {
            for (const group of STATE.workbench.groups) {
                const found = group.find(item => String(item.Id) === id);
                if (found) return found;
            }
        }
        return null;
    }

    function workbenchRow(item, groupIndex) {
        const row = document.createElement('article');
        row.className = 'va21-wb-row';
        row.setAttribute('data-item-id', item.Id || '');
        const img = workbenchImage(item);
        const path = fileName(item);
        const quality = qualitySummary(item);
        const resolution = workbenchResolution(item);
        const needsId = Boolean(STATE.workbench && STATE.workbench.mode === 'needs-id');
        const duplicate = Boolean(STATE.workbench && STATE.workbench.mode === 'duplicates');

        row.innerHTML = `
            <div class="va21-wb-row__art"${img ? ` style="background-image:url('${img.replace(/'/g, '%27')}')"` : ''}>
                ${resolution ? `<span class="va21-wb-resolution">${resolution}</span>` : ''}
            </div>
            <div class="va21-wb-row__copy">
                <div class="va21-wb-row__group">${groupIndex ? 'DUPLICATE GROUP ' + groupIndex : 'NEEDS IDENTIFICATION'}</div>
                <h3></h3>
                <div class="va21-wb-row__meta"></div>
                <div class="va21-wb-row__path"></div>
            </div>
            <div class="va21-wb-row__actions">
                ${needsId ? `<button type="button" class="va21-button va21-button--identify" data-va21-wb-action="identify" data-id="${item.Id || ''}">IDENTIFY</button>` : ''}
                ${duplicate ? `<button type="button" class="va21-button va21-button--ghost" data-va21-wb-action="open" data-id="${item.Id || ''}">OPEN</button>` : ''}
                ${duplicate ? `<button type="button" class="va21-button va21-button--danger" data-va21-wb-action="delete" data-id="${item.Id || ''}">DELETE</button>` : ''}
            </div>
        `;
        row.querySelector('h3').textContent = item.Name || 'Untitled';
        row.querySelector('.va21-wb-row__meta').textContent = [item.ProductionYear || '', quality].filter(Boolean).join(' • ');
        row.querySelector('.va21-wb-row__path').textContent = path || item.Path || '';
        return row;
    }

    function renderWorkbench() {
        const panel = document.getElementById(IDS.workbench);
        if (!panel || !STATE.workbench) return;
        const body = panel.querySelector('.va21-workbench__body');
        const status = panel.querySelector('.va21-workbench__status');
        const pageEl = panel.querySelector('.va21-workbench__page');
        const prev = panel.querySelector('[data-va21-wb-action="prev"]');
        const next = panel.querySelector('[data-va21-wb-action="next"]');

        body.innerHTML = '';
        const flat = STATE.workbench.results;
        const totalPages = Math.max(1, Math.ceil(flat.length / WORKBENCH_PAGE_SIZE));
        STATE.workbench.page = Math.max(0, Math.min(STATE.workbench.page, totalPages - 1));
        const start = STATE.workbench.page * WORKBENCH_PAGE_SIZE;
        const slice = flat.slice(start, start + WORKBENCH_PAGE_SIZE);

        if (!slice.length) {
            body.innerHTML = `<div class="va21-empty">${STATE.workbench.mode === 'needs-id' ? 'No unidentified items found.' : 'No likely duplicates found.'}</div>`;
        } else if (STATE.workbench.mode === 'duplicates' && Array.isArray(STATE.workbench.groups)) {
            const membership = new Map();
            STATE.workbench.groups.forEach((group, index) => group.forEach(item => membership.set(String(item.Id), index + 1)));
            slice.forEach(item => body.appendChild(workbenchRow(item, membership.get(String(item.Id)))));
        } else {
            slice.forEach(item => body.appendChild(workbenchRow(item, 0)));
        }

        const noun = STATE.workbench.mode === 'needs-id' ? 'items need identification' : 'candidate duplicate files';
        status.textContent = flat.length + ' ' + noun + ' across the whole library';
        pageEl.textContent = 'PAGE ' + (STATE.workbench.page + 1) + ' / ' + totalPages;
        prev.disabled = STATE.workbench.page <= 0;
        next.disabled = STATE.workbench.page >= totalPages - 1;
    }

    async function resolveIdentifyItem(itemId) {
        let item = findWorkbenchItem(itemId);
        if (item && item.Type) return item;
        const client = api();
        if (!client || typeof client.getItem !== 'function') return item;
        try {
            const full = await client.getItem(userId(), itemId);
            return full || item;
        } catch (error) {
            return item;
        }
    }

    async function openIdentify(itemId) {
        closeIdentifyOverlay();
        const item = await resolveIdentifyItem(itemId);
        if (!item) return;

        const overlay = document.createElement('section');
        overlay.id = 'va21-identify-overlay';
        overlay.className = 'va21-identify';
        overlay.innerHTML = `
            <div class="va21-identify__backdrop" data-va21-wb-action="identify-cancel"></div>
            <div class="va21-identify__panel">
                <header>
                    <div>
                        <div class="va21-kicker"><span>VA / IDENTIFY</span><b>MATCH ITEM</b></div>
                        <h2>Identify media</h2>
                        <p class="va21-identify__path"></p>
                    </div>
                    <button type="button" class="va21-workbench__close" data-va21-wb-action="identify-cancel" aria-label="Close">×</button>
                </header>
                <form class="va21-identify__form">
                    <label><span>SEARCH NAME</span><input type="text" class="va21-identify__name" autocomplete="off"></label>
                    <label class="va21-identify__year-wrap"><span>YEAR</span><input type="number" class="va21-identify__year" min="1800" max="2200"></label>
                    <label class="va21-identify__replace"><input type="checkbox" class="va21-identify__replace-images" checked><span>Replace existing images</span></label>
                    <button type="submit" class="va21-button va21-button--identify">SEARCH</button>
                </form>
                <div class="va21-identify__status">Adjust the search terms if the filename-derived title is poor.</div>
                <div class="va21-identify__results"></div>
            </div>
        `;
        document.body.appendChild(overlay);
        overlay.querySelector('.va21-identify__name').value = item.Name || '';
        overlay.querySelector('.va21-identify__year').value = item.ProductionYear || '';
        overlay.querySelector('.va21-identify__path').textContent = fileName(item) || item.Path || '';
        if (item.Type === 'Person' || item.Type === 'BoxSet') overlay.querySelector('.va21-identify__year-wrap').hidden = true;

        STATE.identifySession = { item, results: [] };
        overlay.querySelector('.va21-identify__form').addEventListener('submit', event => {
            event.preventDefault();
            searchIdentify();
        });
        overlay.querySelector('.va21-identify__name').focus();
    }

    async function searchIdentify() {
        const overlay = document.getElementById('va21-identify-overlay');
        const session = STATE.identifySession;
        const client = api();
        if (!overlay || !session || !client || typeof client.ajax !== 'function') return;

        const name = overlay.querySelector('.va21-identify__name').value.trim();
        const yearValue = overlay.querySelector('.va21-identify__year').value.trim();
        const status = overlay.querySelector('.va21-identify__status');
        const resultsHost = overlay.querySelector('.va21-identify__results');
        const searchButton = overlay.querySelector('button[type="submit"]');

        if (!name) {
            status.textContent = 'Enter a title to search.';
            return;
        }

        const searchInfo = { Name: name, ProviderIds: {} };
        if (yearValue) searchInfo.Year = Number(yearValue);
        const itemType = session.item.Type || (libraryKind() === 'series' ? 'Series' : 'Movie');

        searchButton.disabled = true;
        searchButton.textContent = 'SEARCHING…';
        status.textContent = 'Searching Jellyfin metadata providers…';
        resultsHost.innerHTML = '';

        try {
            const results = await client.ajax({
                type: 'POST',
                url: client.getUrl('Items/RemoteSearch/' + itemType),
                data: JSON.stringify({ ItemId: session.item.Id, SearchInfo: searchInfo }),
                contentType: 'application/json',
                dataType: 'json'
            });
            session.results = Array.isArray(results) ? results : [];
            renderIdentifyResults();
        } catch (error) {
            console.error('[Velvet Antenna] identify search failed', error);
            status.textContent = 'Metadata search failed. Check the server metadata providers and try again.';
        } finally {
            searchButton.disabled = false;
            searchButton.textContent = 'SEARCH';
        }
    }

    function renderIdentifyResults() {
        const overlay = document.getElementById('va21-identify-overlay');
        const session = STATE.identifySession;
        if (!overlay || !session) return;
        const host = overlay.querySelector('.va21-identify__results');
        const status = overlay.querySelector('.va21-identify__status');
        host.innerHTML = '';

        if (!session.results.length) {
            status.textContent = 'No matches found. Change the title or year and search again.';
            return;
        }

        status.textContent = session.results.length + ' matches found. Choose the correct result.';
        session.results.slice(0, 30).forEach((result, index) => {
            const card = document.createElement('button');
            card.type = 'button';
            card.className = 'va21-identify-result';
            card.setAttribute('data-va21-wb-action', 'identify-apply');
            card.setAttribute('data-index', String(index));

            const art = document.createElement('span');
            art.className = 'va21-identify-result__art';
            if (result.ImageUrl) art.style.backgroundImage = `url('${String(result.ImageUrl).replace(/'/g, '%27')}')`;

            const copy = document.createElement('span');
            copy.className = 'va21-identify-result__copy';
            const title = document.createElement('b');
            title.textContent = result.Name || 'Unknown';
            const meta = document.createElement('span');
            meta.textContent = [result.ProductionYear || '', result.SearchProviderName || ''].filter(Boolean).join(' • ');
            const action = document.createElement('em');
            action.textContent = 'USE THIS MATCH';
            copy.append(title, meta, action);
            card.append(art, copy);
            host.appendChild(card);
        });
    }

    async function applyIdentify(index) {
        const overlay = document.getElementById('va21-identify-overlay');
        const session = STATE.identifySession;
        const client = api();
        if (!overlay || !session || !client || typeof client.ajax !== 'function') return;
        const result = session.results[Number(index)];
        if (!result) return;

        const currentName = session.item.Name || 'this item';
        const targetName = result.Name || 'the selected result';
        const targetYear = result.ProductionYear ? ' (' + result.ProductionYear + ')' : '';
        if (!window.confirm('Identify "' + currentName + '" as "' + targetName + '"' + targetYear + '?')) return;

        const replaceImages = overlay.querySelector('.va21-identify__replace-images').checked;
        const status = overlay.querySelector('.va21-identify__status');
        status.textContent = 'Applying metadata match…';
        overlay.classList.add('is-busy');

        try {
            await client.ajax({
                type: 'POST',
                url: client.getUrl('Items/RemoteSearch/Apply/' + session.item.Id, { ReplaceAllImages: replaceImages }),
                data: JSON.stringify(result),
                contentType: 'application/json'
            });
            const id = String(session.item.Id);
            STATE.libraryIndexCache.clear();
            STATE.itemCache.delete(id);
            if (STATE.workbench && STATE.workbench.mode === 'needs-id') {
                STATE.workbench.results = STATE.workbench.results.filter(item => String(item.Id) !== id);
            }
            closeIdentifyOverlay();
            renderWorkbench();
        } catch (error) {
            console.error('[Velvet Antenna] identify apply failed', error);
            overlay.classList.remove('is-busy');
            status.textContent = 'Could not apply that match. Try again or check the server metadata provider.';
        }
    }

    async function deleteWorkbenchItem(itemId, button) {
        const item = findWorkbenchItem(itemId) || await resolveIdentifyItem(itemId);
        const client = api();
        if (!item || !client || typeof client.deleteItem !== 'function') return;

        const quality = qualitySummary(item);
        const path = fileName(item) || item.Path || '';
        const typeWarning = item.Type === 'Series'
            ? 'This will delete the series and its media from the filesystem and Jellyfin library.'
            : 'This will delete the media file from the filesystem and Jellyfin library.';
        const detail = [quality, path].filter(Boolean).join('\n');
        const message = 'DELETE "' + (item.Name || 'this item') + '"?\n\n' + (detail ? detail + '\n\n' : '') + typeWarning + '\n\nThis cannot be undone from Velvet Antenna.';
        if (!window.confirm(message)) return;

        if (button) {
            button.disabled = true;
            button.textContent = 'DELETING…';
        }

        try {
            await client.deleteItem(String(item.Id));
            const id = String(item.Id);
            STATE.libraryIndexCache.clear();
            STATE.itemCache.delete(id);

            if (STATE.workbench && Array.isArray(STATE.workbench.groups)) {
                STATE.workbench.groups = STATE.workbench.groups
                    .map(group => group.filter(candidate => String(candidate.Id) !== id))
                    .filter(group => group.length > 1);
                STATE.workbench.results = STATE.workbench.groups.flat();
            } else if (STATE.workbench) {
                STATE.workbench.results = STATE.workbench.results.filter(candidate => String(candidate.Id) !== id);
            }
            renderWorkbench();
            scheduleRoutePasses();
        } catch (error) {
            console.error('[Velvet Antenna] delete failed', error);
            if (button) {
                button.disabled = false;
                button.textContent = 'DELETE';
            }
            window.alert('Jellyfin could not delete that item. Check the user delete permission and filesystem access.');
        }
    }

    function handleWorkbenchAction(button) {
        const action = button.getAttribute('data-va21-wb-action');
        if (action === 'close') {
            closeWorkbench();
            return;
        }
        if (action === 'identify-cancel') {
            closeIdentifyOverlay();
            return;
        }
        if (action === 'identify-apply') {
            applyIdentify(button.getAttribute('data-index'));
            return;
        }
        if (!STATE.workbench) return;
        if (action === 'prev') {
            STATE.workbench.page -= 1;
            renderWorkbench();
            return;
        }
        if (action === 'next') {
            STATE.workbench.page += 1;
            renderWorkbench();
            return;
        }
        if (action === 'open') {
            const id = button.getAttribute('data-id');
            closeWorkbench();
            navigateDetails(id);
            return;
        }
        if (action === 'identify') {
            openIdentify(button.getAttribute('data-id'));
            return;
        }
        if (action === 'delete') {
            deleteWorkbenchItem(button.getAttribute('data-id'), button);
        }
    }

    function clearRouteArtifacts() {
        if (pageKind() !== 'home') document.getElementById(IDS.hero)?.remove();
        if (pageKind() !== 'library') {
            document.getElementById(IDS.stage)?.remove();
            STATE.stageId = '';
            STATE.stageToken += 1;
        }
        if (pageKind() !== 'search') document.getElementById(IDS.search)?.remove();
        if (pageKind() !== 'details') document.getElementById(IDS.detailBrand)?.remove();
        if (pageKind() !== 'library') closeWorkbench();
    }

    function render() {
        setPageClass();
        clearRouteArtifacts();
        mountNav();
        if (!isViewerRoute()) return;

        resolveAdmin();
        captureLibraryRoutes();

        if (pageKind() === 'home') {
            decorateHome();
            if (STATE.heroLock) mountHero();
            else maybeStartHero();
        }

        if (pageKind() === 'library') {
            mountLibraryStage();
            ensureStageDefault();
        }

        if (pageKind() === 'search') mountSearchStage();

        if (pageKind() === 'details') {
            mountDetailBrand();
            if (STATE.admin) mountDetailEdit();
        }
    }

    function clearRouteTimers() {
        STATE.timers.forEach(id => window.clearTimeout(id));
        STATE.timers = [];
    }

    function scheduleRoutePasses() {
        clearRouteTimers();
        [0, 180, 520, 1100, 1900, 3200].forEach(delay => {
            STATE.timers.push(window.setTimeout(render, delay));
        });
    }

    function routeChanged() {
        const previous = STATE.route;
        const now = route();
        if (previous !== now) {
            const previousHome = previous === '#/home' || previous.startsWith('#/home?');
            const currentHome = now === '#/home' || now.startsWith('#/home?');
            if (previousHome || currentHome) resetHero();
            STATE.route = now;
            STATE.stageId = '';
            STATE.stageToken += 1;
            closeWorkbench();
            clearPlayTimer();
            STATE.playAttempts = 0;
            if (isDetails()) window.setTimeout(tryPendingPlay, 90);
        }
        scheduleRoutePasses();
    }

    function nativeUiChanged(event) {
        const target = event.target;
        if (!target || typeof target.closest !== 'function') return;
        if (target.closest('.emby-tab-button, .listPaging, .paper-icon-button-light, .alphaPicker, .selectContainer')) {
            window.setTimeout(() => {
                if (pageKind() === 'library') {
                    STATE.stageId = '';
                    STATE.stageToken += 1;
                }
                scheduleRoutePasses();
            }, 260);
        }
    }

    function start() {
        STATE.route = route();
        window.addEventListener('hashchange', routeChanged);
        window.addEventListener('popstate', routeChanged);
        window.addEventListener('click', onClick, true);
        window.addEventListener('click', nativeUiChanged, false);
        window.addEventListener('pointerover', onPointerOver, true);
        window.addEventListener('focusin', onFocusIn, true);

        scheduleRoutePasses();
        if (pageKind() === 'home') maybeStartHero();
        if (isDetails()) window.setTimeout(tryPendingPlay, 90);

        console.log('[Velvet Antenna] v' + VERSION + ' standalone loaded');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start, { once: true });
    } else {
        start();
    }
})();
