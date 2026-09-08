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

    function closeWorkbench() {
        STATE.workbenchToken += 1;
        STATE.workbench = null;
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

    function workbenchRow(item, groupIndex) {
        const row = document.createElement('article');
        row.className = 'va21-wb-row';
        row.setAttribute('data-item-id', item.Id || '');
        const img = workbenchImage(item);
        const path = fileName(item);
        const quality = qualitySummary(item);
        row.innerHTML = `
            <div class="va21-wb-row__art"${img ? ` style="background-image:url('${img.replace(/'/g, '%27')}')"` : ''}></div>
            <div class="va21-wb-row__copy">
                <div class="va21-wb-row__group">${groupIndex ? 'DUPLICATE GROUP ' + groupIndex : 'NEEDS IDENTIFICATION'}</div>
                <h3></h3>
                <div class="va21-wb-row__meta"></div>
                <div class="va21-wb-row__path"></div>
            </div>
            <div class="va21-wb-row__actions">
                <button type="button" class="va21-button va21-button--ghost" data-va21-wb-action="open" data-id="${item.Id || ''}">OPEN</button>
                <button type="button" class="va21-button va21-button--quiet va21-wb-edit itemAction" data-action="edit" data-id="${item.Id || ''}" data-serverid="${serverId()}" data-type="${item.Type || 'Movie'}">EDIT</button>
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

    function handleWorkbenchAction(button) {
        const action = button.getAttribute('data-va21-wb-action');
        if (action === 'close') {
            closeWorkbench();
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
