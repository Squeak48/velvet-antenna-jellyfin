    }

    function blockedPlaybackControl(el) {
        if (!el) return true;
        const blocked = /sync\s*play|syncplay|watch\s*together|join\s*(?:a\s*)?group|watch\s*session|group\s*watch|watch\s*party|play\s*to|remote\s*play/i;
        let node = el;
        let depth = 0;
        while (node && depth < 5) {
            const label = [
                text(node),
                node.getAttribute && node.getAttribute('aria-label') || '',
                node.getAttribute && node.getAttribute('title') || '',
                node.id || '',
                typeof node.className === 'string' ? node.className : ''
            ].join(' ');
            if (blocked.test(label)) return true;
            node = node.parentElement;
            depth += 1;
        }
        return false;
    }

    function genuineLocalPlayButton() {
        const selectors = [
            '.mainDetailButtons .btnPlay',
            '.detailPagePrimaryContainer .btnPlay',
            '.detailPagePrimaryContent .btnPlay',
            'button.btnPlay',
            '.btnPlay'
        ];
        const seen = new Set();
        const candidates = [];
        selectors.forEach(selector => {
            document.querySelectorAll(selector).forEach(el => {
                if (!seen.has(el)) {
                    seen.add(el);
                    candidates.push(el);
                }
            });
        });
        const safe = candidates.filter(el => el.isConnected && !el.disabled && !blockedPlaybackControl(el));
        return safe.find(el => el.offsetParent !== null) || safe[0] || null;
    }

    function queuePlay(itemId) {
        if (!itemId) return;
        try { sessionStorage.setItem(PENDING_PLAY_KEY, JSON.stringify({ id: itemId, created: Date.now() })); }
        catch (error) { /* optional */ }
        STATE.playAttempts = 0;
    }

    function clearPlayTimer() {
        if (STATE.playTimer) window.clearTimeout(STATE.playTimer);
        STATE.playTimer = null;
    }

    function tryPendingPlay() {
        clearPlayTimer();
        if (!isDetails()) return false;
        let pending = null;
        try { pending = safeJson(sessionStorage.getItem(PENDING_PLAY_KEY)); } catch (error) { pending = null; }
        if (!pending || !pending.id) return false;

        if (Date.now() - Number(pending.created || 0) > PLAY_TTL_MS) {
            try { sessionStorage.removeItem(PENDING_PLAY_KEY); } catch (error) { /* optional */ }
            return false;
        }

        const current = currentDetailsId();
        if (!current || current !== pending.id) return false;
        const button = genuineLocalPlayButton();
        if (button) {
            try { sessionStorage.removeItem(PENDING_PLAY_KEY); } catch (error) { /* optional */ }
            button.click();
            return true;
        }

        STATE.playAttempts += 1;
        if (STATE.playAttempts < MAX_PLAY_ATTEMPTS) {
            STATE.playTimer = window.setTimeout(tryPendingPlay, PLAY_RETRY_MS);
        } else {
            try { sessionStorage.removeItem(PENDING_PLAY_KEY); } catch (error) { /* optional */ }
        }
        return false;
    }

    function selectionActive() {
        return Boolean(document.querySelector('.selectionCommandsPanel, .itemSelectionPanel, .withMultiSelect, .chkItemSelect'));
    }

    function isInteractive(target) {
        return Boolean(target.closest('button, a, input, select, textarea, [role="button"], .paper-icon-button-light, .cardOverlayButton'));
    }

    function stopEvent(event) {
        event.preventDefault();
        event.stopPropagation();
        if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
    }

    function onPointerOver(event) {
        if (pageKind() !== 'library') return;
        const card = event.target && event.target.closest && event.target.closest('.card');
        if (!card || card.closest('#' + IDS.stage) || card.closest('#' + IDS.workbench)) return;
        scheduleStageFromCard(card, 90);
    }

    function onFocusIn(event) {
        if (pageKind() !== 'library') return;
        const card = event.target && event.target.closest && event.target.closest('.card');
        if (!card || card.closest('#' + IDS.stage) || card.closest('#' + IDS.workbench)) return;
        scheduleStageFromCard(card, 30);
    }

    function onClick(event) {
        const target = event.target;
        if (!target || typeof target.closest !== 'function') return;

        const hero = target.closest('#' + IDS.hero);
        if (hero && STATE.heroLock) {
            const action = target.closest('[data-va21-action]');
            if (!action) return;
            const kind = action.getAttribute('data-va21-action');
            stopEvent(event);
            if (kind === 'details') {
                navigateDetails(STATE.heroLock.id);
            } else if (kind === 'play') {
                if (/^(Movie|Episode|Video|Audio)$/i.test(STATE.heroLock.type || '')) {
                    queuePlay(STATE.heroLock.id);
                    navigateDetails(STATE.heroLock.id);
                } else {
                    navigateDetails(STATE.heroLock.id);
                }
            }
            return;
        }

        const stageAction = target.closest('[data-va21-stage-action]');
        if (stageAction && STATE.stageId) {
            const action = stageAction.getAttribute('data-va21-stage-action');
            if (action === 'edit') return;
            stopEvent(event);
            if (action === 'open') navigateDetails(STATE.stageId);
            if (action === 'play') {
                queuePlay(STATE.stageId);
                navigateDetails(STATE.stageId);
            }
            return;
        }

        const workbenchButton = target.closest('[data-va21-workbench]');
        if (workbenchButton) {
            stopEvent(event);
            openWorkbench(workbenchButton.getAttribute('data-va21-workbench'));
            return;
        }

        const workbenchAction = target.closest('[data-va21-wb-action]');
        if (workbenchAction) {
            if (workbenchAction.classList.contains('itemAction')) return;
            stopEvent(event);
            handleWorkbenchAction(workbenchAction);
            return;
        }

        if (target.closest('.va21-detail-edit, .va21-wb-edit, .va21-stage-edit')) return;

        if (pageKind() === 'library') {
            if (selectionActive()) return;
            const card = target.closest('.card');
            if (card && !card.closest('#' + IDS.workbench) && !isInteractive(target)) {
                const id = cardItemId(card);
                if (id) {
                    stopEvent(event);
                    navigateDetails(id);
                }
            }
        }
    }

    function providerEntries(item) {
        const ids = item && item.ProviderIds && typeof item.ProviderIds === 'object' ? item.ProviderIds : {};
        return Object.entries(ids).filter(entry => String(entry[1] || '').trim());
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

    function includeItemTypes() {
        const kind = libraryKind();
        if (kind === 'movies') return 'Movie';
        if (kind === 'series') return 'Series';
        return 'Movie,Series';
    }

    async function fetchWholeLibrary(fields) {
        const parent = libraryParentId();
        const client = api();
        const uid = userId();
        if (!parent || !client || !uid || typeof client.getItems !== 'function') return [];
        const key = parent + '|' + includeItemTypes() + '|' + fields;
        if (STATE.libraryIndexCache.has(key)) return STATE.libraryIndexCache.get(key);

        const items = [];
        let start = 0;
        let total = Infinity;
        let guard = 0;

        while (start < total && guard < 30) {
            guard += 1;
            const result = await client.getItems(uid, {
                ParentId: parent,
                Recursive: true,
                IncludeItemTypes: includeItemTypes(),
                Fields: fields,
                StartIndex: start,
                Limit: LIBRARY_BATCH_SIZE,
                SortBy: 'SortName',
                EnableTotalRecordCount: true
            });
            const batch = result && Array.isArray(result.Items) ? result.Items : [];
            items.push(...batch);
            total = Number(result && result.TotalRecordCount);
            if (!Number.isFinite(total)) total = items.length + (batch.length === LIBRARY_BATCH_SIZE ? 1 : 0);
            if (!batch.length || batch.length < LIBRARY_BATCH_SIZE) break;
            start += batch.length;
        }

        STATE.libraryIndexCache.set(key, items);
        return items;
    }

    function duplicateGroups(items) {
        const buckets = new Map();
        items.forEach(item => {
            const name = titleKey(item.Name);
            if (!name) return;
            if (!buckets.has(name)) buckets.set(name, []);
            buckets.get(name).push(item);
        });

        const groups = [];
        buckets.forEach(bucket => {
            if (bucket.length < 2) return;
            const candidates = [];
            for (let i = 0; i < bucket.length; i += 1) {
                for (let j = i + 1; j < bucket.length; j += 1) {
                    const a = bucket[i];
                    const b = bucket[j];
                    const ya = Number(a.ProductionYear || 0);
                    const yb = Number(b.ProductionYear || 0);
                    const sameYear = Boolean(ya && yb && ya === yb);
                    const compatibleYear = !ya || !yb || sameYear;
                    const providersA = new Set(strongProviderKeys(a));
                    const providerMatch = strongProviderKeys(b).some(key => providersA.has(key));
                    if (compatibleYear && (sameYear || providerMatch)) candidates.push(a, b);
                }
            }
            const unique = Array.from(new Map(candidates.map(item => [String(item.Id), item])).values());
            if (unique.length > 1) groups.push(unique);
        });
        return groups;
