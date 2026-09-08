
(function () {
    'use strict';

    const DETAIL_PLAY_ID = 'va21-detail-playbar';
    const PLAY_RETRY_MS = 150;
    const MAX_PLAY_ATTEMPTS = 40;
    let routeTimers = [];
    let itemToken = 0;

    function route() {
        return window.location.hash || '';
    }

    function isDetails() {
        return /details\?id=|\/details\//i.test(route());
    }

    function currentDetailsId() {
        const match = route().match(/[?&]id=([^&]+)/i) || route().match(/\/details\/([^?&/]+)/i);
        return match && match[1] ? decodeURIComponent(match[1]) : '';
    }

    function text(el) {
        return el ? (el.textContent || '').trim() : '';
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

    function removeDetailPlay() {
        document.getElementById(DETAIL_PLAY_ID)?.remove();
    }

    function mountButton(item) {
        if (!isDetails() || !item || !/^(Movie|Episode|Video|Audio)$/i.test(item.Type || '')) {
            removeDetailPlay();
            return;
        }

        const title = document.querySelector('.itemName, .detailPagePrimaryContent h1, .detailPagePrimaryContainer h1');
        if (!title || !title.parentElement) return;

        let bar = document.getElementById(DETAIL_PLAY_ID);
        if (!bar) {
            bar = document.createElement('div');
            bar.id = DETAIL_PLAY_ID;
            bar.className = 'va21-detail-playbar';
            bar.innerHTML = '<button type="button" class="va21-button va21-button--primary va21-detail-play"><span aria-hidden="true">▶</span><b>PLAY</b></button>';
            title.insertAdjacentElement('afterend', bar);
        }

        const button = bar.querySelector('.va21-detail-play');
        const userData = item.UserData || {};
        button.querySelector('b').textContent = userData.PlaybackPositionTicks > 0 && !userData.Played ? 'CONTINUE' : 'PLAY';
        button.setAttribute('data-item-id', item.Id || currentDetailsId());
        button.disabled = false;
    }

    async function mountDetailPlay() {
        if (!isDetails()) {
            removeDetailPlay();
            return;
        }

        const id = currentDetailsId();
        const client = window.ApiClient;
        if (!id || !client || typeof client.getItem !== 'function' || typeof client.getCurrentUserId !== 'function') return;
        const token = ++itemToken;

        try {
            const item = await client.getItem(client.getCurrentUserId(), id);
            if (token !== itemToken || !isDetails() || currentDetailsId() !== id) return;
            mountButton(item);
        } catch (error) {
            console.debug('[Velvet Antenna v0.21.2] detail item lookup failed', error);
        }
    }

    function clickNativePlay(button, attempt) {
        if (!isDetails()) return;
        const nativePlay = genuineLocalPlayButton();
        if (nativePlay) {
            button.disabled = false;
            nativePlay.click();
            return;
        }

        if (attempt >= MAX_PLAY_ATTEMPTS) {
            button.disabled = false;
            button.querySelector('b').textContent = 'PLAY UNAVAILABLE';
            return;
        }

        button.disabled = true;
        button.querySelector('b').textContent = 'STARTING…';
        window.setTimeout(() => clickNativePlay(button, attempt + 1), PLAY_RETRY_MS);
    }

    function onClick(event) {
        const button = event.target && event.target.closest && event.target.closest('#' + DETAIL_PLAY_ID + ' .va21-detail-play');
        if (!button) return;
        event.preventDefault();
        event.stopPropagation();
        if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
        clickNativePlay(button, 0);
    }

    function scheduleMounts() {
        routeTimers.forEach(id => window.clearTimeout(id));
        routeTimers = [];
        [0, 160, 420, 850, 1500, 2600].forEach(delay => {
            routeTimers.push(window.setTimeout(mountDetailPlay, delay));
        });
    }

    function routeChanged() {
        itemToken += 1;
        removeDetailPlay();
        scheduleMounts();
    }

    window.addEventListener('click', onClick, true);
    window.addEventListener('hashchange', routeChanged);
    window.addEventListener('popstate', routeChanged);
    scheduleMounts();

    if (document.body) document.body.setAttribute('data-va21-version', '0.21.2');
    console.log('[Velvet Antenna] v0.21.2 detail playback surface loaded');
})();
