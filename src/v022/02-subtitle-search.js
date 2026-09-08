(function () {
    'use strict';

    const VERSION = '0.22.0';
    const PREFIX = 'va22:';
    const BUTTON_ID = 'va22-subtitle-search';
    const OVERLAY_ID = 'va22-subtitle-overlay';
    const RESTART_KEY = PREFIX + 'subtitle-restart';
    const LAST_ITEM_KEY = PREFIX + 'last-playing-id';
    const MAX_RESTART_AGE = 45000;
    const STATE = {
        timers: [],
        searchItem: null,
        cultures: [],
        results: [],
        restarting: false,
        selectAttempts: 0
    };

    function api() { return window.ApiClient || null; }
    function uid() {
        const client = api();
        try { return client && typeof client.getCurrentUserId === 'function' ? (client.getCurrentUserId() || '') : ''; }
        catch (error) { return ''; }
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
    function isDetails() { return /details\?id=|\/details\//i.test(route()); }
    function currentDetailsId() {
        const match = route().match(/[?&]id=([^&]+)/i) || route().match(/\/details\/([^?&/]+)/i);
        return match && match[1] ? decodeURIComponent(match[1]) : '';
    }
    function detailsHash(id) {
        const server = sid();
        return '#/details?id=' + encodeURIComponent(id) + (server ? '&serverId=' + encodeURIComponent(server) : '');
    }
    function playbackActive() {
        return /videoosd|playback|nowplaying/i.test(route()) ||
            Boolean(document.querySelector('.videoPlayerContainer:not(.hide), .videoOsdPage:not(.hide), video'));
    }
    function normalise(value) { return String(value || '').trim().toLowerCase(); }
    function getStored(key) {
        try { return sessionStorage.getItem(key); } catch (error) { return null; }
    }
    function setStored(key, value) {
        try { sessionStorage.setItem(key, String(value)); } catch (error) { /* optional */ }
    }
    function removeStored(key) {
        try { sessionStorage.removeItem(key); } catch (error) { /* optional */ }
    }
    function safeJson(value) {
        try { return value ? JSON.parse(value) : null; } catch (error) { return null; }
    }
    function formatTime(seconds) {
        const total = Math.max(0, Math.floor(Number(seconds || 0)));
        const h = Math.floor(total / 3600);
        const m = Math.floor((total % 3600) / 60);
        const s = total % 60;
        return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
    }

    function capturePlaybackIntent(event) {
        const target = event.target;
        if (!target || typeof target.closest !== 'function') return;
        const play = target.closest('.btnPlay, [data-va22-action="play"], [data-va22-series-play], [data-va21-action="play"], [data-va21-stage-action="play"]');
        if (!play) return;
        let id = '';
        if (play.hasAttribute('data-va22-series-play')) id = play.getAttribute('data-va22-series-play') || '';
        if (!id) id = play.closest('[data-va22-id]')?.getAttribute('data-va22-id') || '';
        if (!id) id = play.closest('[data-id]')?.getAttribute('data-id') || '';
        if (!id && isDetails()) id = currentDetailsId();
        if (id) setStored(LAST_ITEM_KEY, id);
        schedulePasses();
    }

    async function resolvePlaybackItemId() {
        const stored = getStored(LAST_ITEM_KEY);
        if (stored) return stored;
        const domId = document.querySelector('.videoOsdPage [data-id], .videoPlayerContainer [data-id]')?.getAttribute('data-id');
        if (domId) return domId;
        const client = api();
        const user = uid();
        if (!client || !user || typeof client.getSessions !== 'function') return '';
        try {
            const sessions = await client.getSessions({});
            const candidates = (sessions || []).filter(session => String(session.UserId || '') === String(user) && session.NowPlayingItem?.Id);
            if (!candidates.length) return '';
            candidates.sort((a, b) => Number(Boolean(b.PlayState?.PositionTicks)) - Number(Boolean(a.PlayState?.PositionTicks)));
            const id = candidates[0].NowPlayingItem.Id;
            if (id) setStored(LAST_ITEM_KEY, id);
            return id || '';
        } catch (error) {
            console.debug('[Velvet Antenna v0.22] unable to resolve playback session', error);
            return '';
        }
    }

    function playerControlsHost() {
        return document.querySelector('.videoOsdBottom:not(.hide)') ||
            document.querySelector('.videoOsdBottom') ||
            document.querySelector('.videoOsdPage:not(.hide) .osdControls') ||
            document.querySelector('.videoOsdPage:not(.hide)');
    }

    function mountSearchButton() {
        const existing = document.getElementById(BUTTON_ID);
        if (!playbackActive()) {
            existing?.remove();
            return;
        }
        if (existing) return;
        const native = document.querySelector('.videoOsdPage:not(.hide) .btnSubtitles, .videoOsdBottom .btnSubtitles, .btnSubtitles');
        const host = native?.parentElement || playerControlsHost();
        if (!host) return;
        const button = document.createElement('button');
        button.type = 'button';
        button.id = BUTTON_ID;
        button.className = 'va22-subtitle-search';
        button.setAttribute('aria-label', 'Find subtitles online');
        button.title = 'Find subtitles online';
        button.innerHTML = '<span aria-hidden="true">CC</span><b>+</b>';
        if (native?.parentElement) native.insertAdjacentElement('afterend', button);
        else host.appendChild(button);
    }

    async function fetchItem(id) {
        const client = api();
        const user = uid();
        if (!client || !user || !id || typeof client.getItem !== 'function') return null;
        try { return await client.getItem(user, id); } catch (error) { return null; }
    }

    async function loadCultures() {
        if (STATE.cultures.length) return STATE.cultures;
        const client = api();
        if (!client || typeof client.getCultures !== 'function') return [];
        try {
            const values = await client.getCultures();
            STATE.cultures = Array.isArray(values) ? values : [];
            return STATE.cultures;
        } catch (error) { return []; }
    }

    async function preferredLanguage() {
        const client = api();
        if (!client || typeof client.getCurrentUser !== 'function') return 'eng';
        try {
            const user = await client.getCurrentUser();
            return user?.Configuration?.SubtitleLanguagePreference || 'eng';
        } catch (error) { return 'eng'; }
    }

    function subtitleStreams(item) {
        const sources = Array.isArray(item?.MediaSources) ? item.MediaSources : [];
        const streams = sources.length && Array.isArray(sources[0].MediaStreams)
            ? sources[0].MediaStreams
            : (Array.isArray(item?.MediaStreams) ? item.MediaStreams : []);
        return streams.filter(stream => String(stream.Type || '').toLowerCase() === 'subtitle');
    }

    async function openOverlay() {
        closeOverlay();
        const itemId = await resolvePlaybackItemId();
        const overlay = document.createElement('section');
        overlay.id = OVERLAY_ID;
        overlay.className = 'va22-subtitle-overlay';
        overlay.innerHTML = `
            <div class="va22-subtitle-overlay__backdrop" data-va22-sub-action="close"></div>
            <div class="va22-subtitle-overlay__panel">
                <header>
                    <div><span>VA / LIVE SUBTITLES</span><h2>Find subtitles without leaving the show.</h2><p class="va22-subtitle-overlay__item"></p></div>
                    <button type="button" class="va22-subtitle-overlay__close" data-va22-sub-action="close" aria-label="Close">×</button>
                </header>
                <div class="va22-subtitle-current"></div>
                <form class="va22-subtitle-search-form">
                    <label><span>LANGUAGE</span><select></select></label>
                    <button type="submit">SEARCH PROVIDERS</button>
                </form>
                <div class="va22-subtitle-status"></div>
                <div class="va22-subtitle-results"></div>
            </div>
        `;
        document.body.appendChild(overlay);
        if (!itemId) {
            overlay.querySelector('.va22-subtitle-overlay__item').textContent = 'Could not identify the currently playing item.';
            overlay.querySelector('.va22-subtitle-status').textContent = 'Start playback from a Velvet Antenna or Jellyfin item page and try again.';
            overlay.querySelector('.va22-subtitle-search-form').hidden = true;
            return;
        }
        setStored(LAST_ITEM_KEY, itemId);
        const [item, cultures, preferred] = await Promise.all([fetchItem(itemId), loadCultures(), preferredLanguage()]);
        if (!overlay.isConnected) return;
        if (!item) {
            overlay.querySelector('.va22-subtitle-overlay__item').textContent = 'Jellyfin could not load this item.';
            overlay.querySelector('.va22-subtitle-search-form').hidden = true;
            return;
        }
        STATE.searchItem = item;
        STATE.results = [];
        overlay.querySelector('.va22-subtitle-overlay__item').textContent = [item.SeriesName, item.Name].filter(Boolean).join(' • ') || 'Now playing';
        renderCurrentSubtitles(overlay, item);
        fillLanguageSelect(overlay, cultures, preferred);
        overlay.querySelector('.va22-subtitle-status').textContent = 'Search your configured Jellyfin subtitle providers. Downloaded files are saved back to Jellyfin.';
    }

    function renderCurrentSubtitles(overlay, item) {
        const host = overlay.querySelector('.va22-subtitle-current');
        const subs = subtitleStreams(item);
        if (!subs.length) {
            host.innerHTML = '<span>NO LOCAL SUBTITLES</span><b>This is exactly what CC+ is for.</b>';
            return;
        }
        host.innerHTML = '<span>AVAILABLE NOW</span><div></div>';
        const list = host.querySelector('div');
        subs.slice(0, 8).forEach(stream => {
            const chip = document.createElement('i');
            chip.textContent = stream.DisplayTitle || stream.Language || 'Subtitle';
            list.appendChild(chip);
        });
    }

    function fillLanguageSelect(overlay, cultures, preferred) {
        const select = overlay.querySelector('select');
        select.innerHTML = '';
        const sorted = [...(cultures || [])].sort((a, b) => String(a.DisplayName || '').localeCompare(String(b.DisplayName || '')));
        if (!sorted.length) {
            select.innerHTML = '<option value="eng">English</option>';
            return;
        }
        sorted.forEach(culture => {
            const option = document.createElement('option');
            option.value = culture.ThreeLetterISOLanguageName || culture.TwoLetterISOLanguageName || '';
            option.textContent = culture.DisplayName || option.value;
            if (normalise(option.value) === normalise(preferred)) option.selected = true;
            select.appendChild(option);
        });
        if (![...select.options].some(option => option.selected) && select.options.length) select.selectedIndex = 0;
    }

    async function searchRemote(overlay) {
        const client = api();
        const item = STATE.searchItem;
        if (!client || !item || typeof client.getJSON !== 'function') return;
        const select = overlay.querySelector('select');
        const language = select.value;
        const label = select.options[select.selectedIndex]?.textContent || language;
        const status = overlay.querySelector('.va22-subtitle-status');
        const host = overlay.querySelector('.va22-subtitle-results');
        status.textContent = `Searching ${label} subtitles…`;
        host.innerHTML = '<div class="va22-subtitle-spinner">TUNING PROVIDERS…</div>';
        try {
            const url = client.getUrl('Items/' + item.Id + '/RemoteSearch/Subtitles/' + encodeURIComponent(language));
            const results = await client.getJSON(url);
            STATE.results = Array.isArray(results) ? results : [];
            renderResults(overlay, language, label);
        } catch (error) {
            console.error('[Velvet Antenna v0.22] subtitle search failed', error);
            host.innerHTML = '';
            status.textContent = 'Subtitle search failed. Check the provider plugin configuration and server logs.';
        }
    }

    function renderResults(overlay, language, languageLabel) {
        const status = overlay.querySelector('.va22-subtitle-status');
        const host = overlay.querySelector('.va22-subtitle-results');
        host.innerHTML = '';
        if (!STATE.results.length) {
            status.textContent = `No ${languageLabel} subtitle matches were returned by the configured providers.`;
            return;
        }
        status.textContent = `${STATE.results.length} matches found • strongest matches first when the provider supplies match data`;
        STATE.results.slice(0, 30).forEach((result, index) => {
            const row = document.createElement('article');
            row.className = 'va22-subtitle-result';
            const flags = [];
            if (result.IsHashMatch) flags.push('PERFECT MATCH');
            if (result.Forced) flags.push('FORCED');
            if (result.HearingImpaired) flags.push('SDH');
            if (result.AiTranslated) flags.push('AI TRANSLATED');
            if (result.MachineTranslated) flags.push('MACHINE');
            const meta = [result.ProviderName, result.Format?.toUpperCase(), result.DownloadCount != null ? result.DownloadCount + ' downloads' : '', result.FrameRate ? result.FrameRate + ' fps' : ''].filter(Boolean);
            row.innerHTML = `
                <div class="va22-subtitle-result__copy"><h3></h3><p></p><div class="va22-subtitle-result__flags"></div></div>
                <button type="button" data-va22-sub-action="download" data-index="${index}" data-language="${language}" data-language-label="${languageLabel.replace(/"/g, '&quot;')}">DOWNLOAD & USE</button>
            `;
            row.querySelector('h3').textContent = result.Name || `${languageLabel} subtitle`;
            row.querySelector('p').textContent = meta.join(' • ');
            const flagHost = row.querySelector('.va22-subtitle-result__flags');
            flags.forEach(flag => {
                const span = document.createElement('span');
                span.textContent = flag;
                flagHost.appendChild(span);
            });
            host.appendChild(row);
        });
    }

    async function downloadAndUse(button) {
        const client = api();
        const item = STATE.searchItem;
        const result = STATE.results[Number(button.getAttribute('data-index'))];
        if (!client || !item || !result || typeof client.ajax !== 'function') return;
        const language = button.getAttribute('data-language') || 'eng';
        const languageLabel = button.getAttribute('data-language-label') || language;
        const overlay = document.getElementById(OVERLAY_ID);
        const status = overlay?.querySelector('.va22-subtitle-status');
        const video = document.querySelector('video');
        const seconds = Number(video?.currentTime || 0);
        const before = new Set(subtitleStreams(item).map(stream => String(stream.Index)));
        button.disabled = true;
        button.textContent = 'DOWNLOADING…';
        if (status) status.textContent = `Downloading ${languageLabel} subtitles to Jellyfin…`;
        try {
            const url = client.getUrl('Items/' + item.Id + '/RemoteSearch/Subtitles/' + encodeURIComponent(result.Id));
            await client.ajax({ type: 'POST', url });
            if (status) status.textContent = 'Subtitle downloaded. Waiting for Jellyfin to index the new track…';
            const refreshed = await waitForNewSubtitle(item.Id, before, language);
            if (refreshed) STATE.searchItem = refreshed;
            const restart = {
                id: String(item.Id),
                seconds,
                language,
                languageLabel,
                resultName: result.Name || '',
                created: Date.now(),
                playClicked: false
            };
            setStored(RESTART_KEY, JSON.stringify(restart));
            setStored(LAST_ITEM_KEY, String(item.Id));
            closeOverlay();
            showToast(`Downloaded ${languageLabel}. Reloading the player at ${formatTime(seconds)}…`, 3200);
            beginSubtitleRestart(restart);
        } catch (error) {
            console.error('[Velvet Antenna v0.22] subtitle download failed', error);
            button.disabled = false;
            button.textContent = 'DOWNLOAD & USE';
            if (status) status.textContent = 'Jellyfin could not download that subtitle. Try another match or check the provider plugin.';
        }
    }

    async function waitForNewSubtitle(itemId, before, language) {
        for (let attempt = 0; attempt < 7; attempt += 1) {
            await new Promise(resolve => window.setTimeout(resolve, attempt === 0 ? 600 : 850));
            const item = await fetchItem(itemId);
            if (!item) continue;
            const subs = subtitleStreams(item);
            const added = subs.find(stream => !before.has(String(stream.Index))) ||
                subs.find(stream => normalise(stream.Language) === normalise(language));
            if (added) return item;
        }
        return await fetchItem(itemId);
    }

    function beginSubtitleRestart(restart) {
        if (!restart?.id) return;
        STATE.restarting = true;
        STATE.selectAttempts = 0;
        window.location.hash = detailsHash(restart.id).slice(1);
        scheduleRestartPasses();
    }

    function scheduleRestartPasses() {
        [100, 350, 800, 1400, 2300, 3600, 5200, 7500].forEach(delay => window.setTimeout(trySubtitleRestart, delay));
    }

    function readRestart() {
        const pending = safeJson(getStored(RESTART_KEY));
        if (!pending?.id) return null;
        if (Date.now() - Number(pending.created || 0) > MAX_RESTART_AGE) {
            removeStored(RESTART_KEY);
            return null;
        }
        return pending;
    }

    function writeRestart(pending) {
        setStored(RESTART_KEY, JSON.stringify(pending));
    }

    function safeNativePlay() {
        const blocked = /sync\s*play|watch\s*together|remote\s*play|play\s*to|join\s*group/i;
        const buttons = Array.from(document.querySelectorAll('.btnPlay')).filter(button => {
            const label = [button.textContent, button.getAttribute('aria-label'), button.getAttribute('title'), button.className].filter(Boolean).join(' ');
            return button.isConnected && !button.disabled && !blocked.test(label);
        });
        return buttons.find(button => button.offsetParent !== null) || buttons[0] || null;
    }

    function trySubtitleRestart() {
        const pending = readRestart();
        if (!pending) {
            STATE.restarting = false;
            return;
        }
        if (playbackActive() && document.querySelector('video')) {
            restorePlaybackPosition(pending);
            attemptSubtitleSelection(pending);
            return;
        }
        if (isDetails() && currentDetailsId() === String(pending.id)) {
            if (!pending.playClicked) {
                const play = safeNativePlay();
                if (play) {
                    pending.playClicked = true;
                    writeRestart(pending);
                    play.click();
                }
            }
            return;
        }
        if (!playbackActive()) window.location.hash = detailsHash(pending.id).slice(1);
    }

    function restorePlaybackPosition(pending) {
        const video = document.querySelector('video');
        if (!video || !Number.isFinite(Number(pending.seconds)) || Number(pending.seconds) <= 0) return;
        const target = Number(pending.seconds);
        const apply = () => {
            try {
                if (Number.isFinite(video.duration) && video.duration > target && Math.abs(Number(video.currentTime || 0) - target) > 4) {
                    video.currentTime = target;
                }
            } catch (error) { /* player may not be seekable yet */ }
        };
        if (video.readyState >= 1) apply();
        else video.addEventListener('loadedmetadata', apply, { once: true });
    }

    function attemptSubtitleSelection(pending) {
        const native = document.querySelector('.videoOsdPage:not(.hide) .btnSubtitles:not(.hide), .videoOsdBottom .btnSubtitles:not(.hide), .btnSubtitles:not(.hide)');
        if (!native) {
            if (STATE.selectAttempts++ < 18) window.setTimeout(() => attemptSubtitleSelection(pending), 450);
            else finishRestart(false, pending);
            return;
        }
        native.click();
        window.setTimeout(() => {
            const dialogs = Array.from(document.querySelectorAll('.dialog.opened, .actionSheet.opened, .dialogContainer .dialog'))
                .filter(dialog => dialog.offsetParent !== null);
            const dialog = dialogs[dialogs.length - 1];
            if (!dialog) {
                if (STATE.selectAttempts++ < 18) window.setTimeout(() => attemptSubtitleSelection(pending), 450);
                else finishRestart(false, pending);
                return;
            }
            const needle = normalise(pending.languageLabel).split(/\s+/)[0];
            const candidates = Array.from(dialog.querySelectorAll('button, .listItem, [role="button"]')).filter(node => {
                const value = normalise(node.textContent);
                return value && value !== 'off' && value.includes(needle);
            });
            if (candidates.length) {
                candidates[candidates.length - 1].click();
                finishRestart(true, pending);
            } else if (STATE.selectAttempts++ < 18) {
                window.setTimeout(() => attemptSubtitleSelection(pending), 450);
            } else {
                finishRestart(false, pending);
            }
        }, 250);
    }

    function finishRestart(selected, pending) {
        removeStored(RESTART_KEY);
        STATE.restarting = false;
        STATE.selectAttempts = 0;
        if (selected) showToast(`${pending.languageLabel} subtitles loaded.`, 3000);
        else showToast(`${pending.languageLabel} downloaded. Open CC to select it if Jellyfin did not select it automatically.`, 5200);
        schedulePasses();
    }

    function showToast(message, duration) {
        document.getElementById('va22-toast')?.remove();
        const toast = document.createElement('div');
        toast.id = 'va22-toast';
        toast.className = 'va22-toast';
        toast.textContent = message;
        document.body.appendChild(toast);
        window.setTimeout(() => toast.classList.add('is-visible'), 10);
        window.setTimeout(() => {
            toast.classList.remove('is-visible');
            window.setTimeout(() => toast.remove(), 260);
        }, duration || 3200);
    }

    function closeOverlay() {
        document.getElementById(OVERLAY_ID)?.remove();
        STATE.searchItem = null;
        STATE.results = [];
    }

    function onClick(event) {
        capturePlaybackIntent(event);
        const target = event.target;
        if (!target || typeof target.closest !== 'function') return;
        if (target.closest('#' + BUTTON_ID)) {
            event.preventDefault();
            event.stopPropagation();
            if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
            openOverlay();
            return;
        }
        const action = target.closest('[data-va22-sub-action]');
        if (!action) return;
        const kind = action.getAttribute('data-va22-sub-action');
        event.preventDefault();
        event.stopPropagation();
        if (kind === 'close') closeOverlay();
        if (kind === 'download') downloadAndUse(action);
    }

    function onSubmit(event) {
        if (!event.target?.matches('.va22-subtitle-search-form')) return;
        event.preventDefault();
        const overlay = document.getElementById(OVERLAY_ID);
        if (overlay) searchRemote(overlay);
    }

    function onKey(event) {
        if (event.key === 'Escape' && document.getElementById(OVERLAY_ID)) closeOverlay();
    }

    function schedulePasses() {
        STATE.timers.forEach(timer => window.clearTimeout(timer));
        STATE.timers = [];
        [0, 250, 700, 1400, 2600, 4300].forEach(delay => {
            STATE.timers.push(window.setTimeout(() => {
                mountSearchButton();
                if (readRestart()) trySubtitleRestart();
            }, delay));
        });
    }

    document.addEventListener('click', onClick, true);
    document.addEventListener('submit', onSubmit, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('hashchange', schedulePasses);
    window.addEventListener('popstate', schedulePasses);
    schedulePasses();

    window.VelvetAntenna22 = Object.assign(window.VelvetAntenna22 || {}, {
        openSubtitleSearch: openOverlay
    });

    console.log('[Velvet Antenna] v' + VERSION + ' live subtitle search loaded');
})();