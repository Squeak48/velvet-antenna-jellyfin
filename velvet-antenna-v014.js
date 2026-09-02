(function () {
    'use strict';

    const VERSION = '0.14.0';
    const IDS = {
        keyboard: 'va14-search-keyboard',
        libraryNav: 'va14-library-subnav',
        heroBadges: 'va14-hero-badges',
        heroProgress: 'va14-hero-progress',
        detailExtras: 'va14-detail-extras'
    };

    let timer = null;
    let observer = null;

    function route() {
        return window.location.hash || '';
    }

    function txt(el) {
        return el ? (el.textContent || '').trim() : '';
    }

    function isHome() {
        return route() === '#/home' || route().startsWith('#/home?');
    }

    function isSearch() {
        return route().toLowerCase().startsWith('#/search');
    }

    function isDetails() {
        return /details\?id=|\/details\//i.test(route());
    }

    function isLibrary() {
        const value = route().toLowerCase();
        return !isSearch() && !isDetails() &&
            (/\/movies|\/tv|\/collections|topparentid|collectiontype=/i.test(value));
    }

    function isAdminOrPlayback() {
        return /dashboard|configurationpage|scheduledtasks|logs|networking|plugins|metadataeditor|videoosd|nowplaying|playback/i.test(route()) ||
            Boolean(document.querySelector('.videoPlayerContainer:not(.hide), .videoOsdPage:not(.hide)'));
    }

    function api() {
        return window.ApiClient || null;
    }

    function currentItemId() {
        const match = route().match(/[?&]id=([^&]+)/i) || route().match(/\/details\/([^?&/]+)/i);
        return match && match[1] ? decodeURIComponent(match[1]) : '';
    }

    function getItemId(card) {
        if (!card) return '';
        const nodes = [
            card,
            card.querySelector('[data-id]'),
            card.querySelector('[data-itemid]'),
            card.closest('[data-id]'),
            card.closest('[data-itemid]')
        ].filter(Boolean);

        for (const el of nodes) {
            const value =
                (el.dataset && (el.dataset.id || el.dataset.itemid || el.dataset.itemId)) ||
                el.getAttribute('data-id') ||
                el.getAttribute('data-itemid');
            if (value) return value;
        }

        const link = card.closest('a[href]') || card.querySelector('a[href]');
        const href = link && link.getAttribute('href');
        if (href) {
            const match = href.match(/[?&]id=([^&]+)/i) || href.match(/details\?id=([^&]+)/i);
            if (match && match[1]) return decodeURIComponent(match[1]);
        }
        return '';
    }

    function getCardImage(card) {
        if (!card) return '';
        const img = card.querySelector('img');
        if (img && img.src) return img.src;

        for (const el of card.querySelectorAll('.cardImage, .cardImageContainer, .cardContent')) {
            const bg = window.getComputedStyle(el).backgroundImage;
            const match = bg && bg.match(/url\(["']?(.*?)["']?\)/i);
            if (match && match[1]) return match[1];
        }
        return '';
    }

    function getCardTitle(card) {
        if (!card) return '';
        const selectors = ['.cardText-first', '.cardText', '.itemName', '[title]'];
        for (const selector of selectors) {
            const el = card.querySelector(selector);
            if (!el) continue;
            const value = (el.textContent || el.getAttribute('title') || '').trim();
            if (value) return value;
        }
        return (card.getAttribute('aria-label') || card.getAttribute('title') || '').trim();
    }

    function sectionHeading(section) {
        return txt(section && section.querySelector('.sectionTitle-cards, .sectionTitle, h2, h3'));
    }

    function findSection(regexes) {
        return Array.from(document.querySelectorAll('.verticalSection')).find(section => {
            const heading = sectionHeading(section);
            return regexes.some(regex => regex.test(heading));
        }) || null;
    }

    function visibleMediaCards(section) {
        if (!section) return [];
        return Array.from(section.querySelectorAll('.card')).filter(card => {
            if (card.offsetParent === null) return false;
            const title = getCardTitle(card).toLowerCase();
            if (!title || ['movies', 'shows', 'series', 'collections', 'anime'].includes(title)) return false;
            return Boolean(getItemId(card) || getCardImage(card));
        });
    }

    function heroPool() {
        const resume = visibleMediaCards(findSection([/continue watching/i, /resume/i]));
        if (resume.length) return { cards: resume.slice(0, 8), mode: 'resume' };

        const nextUp = visibleMediaCards(findSection([/next up/i]));
        if (nextUp.length) return { cards: nextUp.slice(0, 8), mode: 'next' };

        const movies = visibleMediaCards(findSection([/recently added.*movies/i, /latest.*movies/i]));
        const series = visibleMediaCards(findSection([/recently added.*series/i, /recently added.*shows/i]));
        const combined = movies.slice(0, 10).concat(series.slice(0, 6));
        return { cards: combined, mode: 'featured' };
    }

    function chooseHero() {
        const pool = heroPool();
        if (!pool.cards.length) return null;

        const bucket = Math.floor(Date.now() / (60 * 60 * 1000));
        let index = bucket % pool.cards.length;

        try {
            const last = localStorage.getItem('va14:lastHero');
            if (pool.cards.length > 1 && getItemId(pool.cards[index]) === last) {
                index = (index + 1) % pool.cards.length;
            }
        } catch (error) {
            // Optional.
        }

        return { card: pool.cards[index], mode: pool.mode };
    }

    function formatRuntime(ticks) {
        if (!ticks || !Number.isFinite(Number(ticks))) return '';
        const mins = Math.round(Number(ticks) / 600000000);
        if (mins < 60) return mins + ' min';
        const h = Math.floor(mins / 60);
        const m = mins % 60;
        return m ? h + 'h ' + m + 'm' : h + 'h';
    }

    function imageUrl(client, itemId, type, tag, maxWidth) {
        if (!client || !itemId || !tag || typeof client.getImageUrl !== 'function') return '';
        try {
            return client.getImageUrl(itemId, {
                type: type,
                index: 0,
                tag: tag,
                maxWidth: maxWidth || 1700,
                quality: 84
            });
        } catch (error) {
            return '';
        }
    }

    function mediaBadges(item) {
        const badges = [];
        const streams = Array.isArray(item && item.MediaStreams) ? item.MediaStreams : [];
        const video = streams.find(stream => /video/i.test(stream.Type || ''));
        const audio = streams.find(stream => /audio/i.test(stream.Type || ''));

        if (video) {
            const width = Number(video.Width || 0);
            if (width >= 3500) badges.push('4K');
            else if (width >= 1800) badges.push('1080P');

            const range = [
                video.VideoRange,
                video.VideoRangeType,
                video.Hdr10PlusPresent ? 'HDR10+' : '',
                video.DvVersionMajor ? 'DOLBY VISION' : ''
            ].filter(Boolean).join(' ').toUpperCase();

            if (/DOLBY|DOVI/.test(range)) badges.push('DOLBY VISION');
            else if (/HDR/.test(range)) badges.push('HDR');
        }

        if (audio) {
            const channels = Number(audio.Channels || 0);
            if (channels >= 8) badges.push('7.1');
            else if (channels >= 6) badges.push('5.1');
        }

        if (item && Array.isArray(item.MediaSources) && item.MediaSources.some(source => source.SupportsDirectPlay)) {
            badges.push('DIRECT PLAY');
        }

        return Array.from(new Set(badges)).slice(0, 4);
    }

    function clickCard(card) {
        if (!card) return false;
        const target = card.querySelector('a[href], .cardContent') || card;
        if (target && typeof target.click === 'function') {
            target.click();
            return true;
        }
        return false;
    }

    function playCard(card) {
        if (!card) return;
        const play = card.querySelector('.cardOverlayButton-play, [data-action="play"], .btnPlay, button[title*="play" i]');
        if (play && typeof play.click === 'function') {
            play.click();
            return;
        }
        clickCard(card);
    }

    function bindHeroButtons(hero, card) {
        const oldPlay = hero.querySelector('[data-va-action="play"]');
        const oldDetails = hero.querySelector('[data-va-action="details"]');

        if (oldPlay) {
            const play = oldPlay.cloneNode(true);
            oldPlay.replaceWith(play);
            play.addEventListener('click', function (event) {
                event.preventDefault();
                event.stopPropagation();
                playCard(card);
            });
        }

        if (oldDetails) {
            const details = oldDetails.cloneNode(true);
            oldDetails.replaceWith(details);
            details.addEventListener('click', function (event) {
                event.preventDefault();
                event.stopPropagation();
                clickCard(card);
            });
        }
    }

    function ensureHeroExtras(hero) {
        if (!hero.querySelector('#' + IDS.heroBadges)) {
            const badges = document.createElement('div');
            badges.id = IDS.heroBadges;
            badges.className = 'va14-format-badges';
            const meta = hero.querySelector('.va-hero__meta');
            if (meta && meta.parentElement) meta.insertAdjacentElement('afterend', badges);
        }

        if (!hero.querySelector('#' + IDS.heroProgress)) {
            const progress = document.createElement('div');
            progress.id = IDS.heroProgress;
            progress.className = 'va14-hero-progress';
            progress.innerHTML = '<div class="va14-hero-progress__label"></div><div class="va14-hero-progress__track"><i></i></div>';
            const copy = hero.querySelector('.va-hero__copy');
            if (copy && copy.parentElement) copy.insertAdjacentElement('afterend', progress);
        }
    }

    async function upgradeHero() {
        if (!isHome()) return;

        const hero = document.getElementById('va-home-hero');
        if (!hero) return;

        const choice = chooseHero();
        if (!choice || !choice.card) return;

        const card = choice.card;
        const itemId = getItemId(card);
        const marker = itemId || getCardTitle(card);

        if (hero.getAttribute('data-va14-hero') === marker) return;
        hero.setAttribute('data-va14-hero', marker);
        hero.classList.add('va14-hero-upgraded');
        ensureHeroExtras(hero);
        bindHeroButtons(hero, card);

        const title = getCardTitle(card);
        const titleEl = hero.querySelector('.va-hero__title');
        if (titleEl && title) titleEl.textContent = title;

        const eyebrow = hero.querySelector('.va-hero__eyebrow');
        if (eyebrow) {
            eyebrow.textContent =
                choice.mode === 'resume' ? 'CONTINUE WATCHING' :
                choice.mode === 'next' ? 'NEXT UP' :
                'FEATURED FOR YOU';
        }

        const fallback = getCardImage(card);
        if (fallback) {
            hero.style.setProperty('--va-hero-image-base', 'url("' + fallback.replace(/"/g, '%22') + '")');
            hero.classList.add('va-hero--has-base-art');
        }

        if (!itemId) return;

        try {
            localStorage.setItem('va14:lastHero', itemId);
        } catch (error) {
            // Optional.
        }

        const client = api();
        if (!client || typeof client.getItem !== 'function' || typeof client.getCurrentUserId !== 'function') return;

        try {
            const item = await client.getItem(client.getCurrentUserId(), itemId);
            if (!item || !hero.isConnected) return;

            if (titleEl) titleEl.textContent = item.Name || title || 'Featured';

            const meta = [];
            if (item.ProductionYear) meta.push(String(item.ProductionYear));
            const runtime = formatRuntime(item.RunTimeTicks);
            if (runtime) meta.push(runtime);
            if (item.OfficialRating) meta.push(item.OfficialRating);
            if (item.CommunityRating) meta.push('★ ' + Number(item.CommunityRating).toFixed(1));
            const metaEl = hero.querySelector('.va-hero__meta');
            if (metaEl) metaEl.textContent = meta.join('  •  ');

            const copy = hero.querySelector('.va-hero__copy');
            if (copy && item.Overview) copy.textContent = item.Overview;

            const badgesEl = hero.querySelector('#' + IDS.heroBadges);
            if (badgesEl) {
                const badges = mediaBadges(item);
                badgesEl.innerHTML = badges.map(value => '<span>' + value + '</span>').join('');
                badgesEl.hidden = !badges.length;
            }

            const progress = hero.querySelector('#' + IDS.heroProgress);
            const userData = item.UserData || {};
            if (progress && userData.PlaybackPositionTicks > 0 && item.RunTimeTicks > 0 && !userData.Played) {
                const pct = Math.max(0, Math.min(100, (userData.PlaybackPositionTicks / item.RunTimeTicks) * 100));
                const remaining = Math.max(0, item.RunTimeTicks - userData.PlaybackPositionTicks);
                progress.querySelector('.va14-hero-progress__label').textContent = formatRuntime(remaining) + ' left';
                progress.querySelector('i').style.width = pct + '%';
                progress.hidden = false;

                const label = hero.querySelector('[data-va-action="play"] .va-button__label');
                if (label) label.textContent = 'CONTINUE';
            } else if (progress) {
                progress.hidden = true;
            }

            let backdrop = '';
            if (Array.isArray(item.BackdropImageTags) && item.BackdropImageTags.length) {
                backdrop = imageUrl(client, item.Id || itemId, 'Backdrop', item.BackdropImageTags[0], 1700);
            } else if (item.ParentBackdropItemId && Array.isArray(item.ParentBackdropImageTags) && item.ParentBackdropImageTags.length) {
                backdrop = imageUrl(client, item.ParentBackdropItemId, 'Backdrop', item.ParentBackdropImageTags[0], 1700);
            }

            if (backdrop) {
                const image = new Image();
                image.decoding = 'async';
                image.onload = function () {
                    if (!hero.isConnected) return;
                    hero.style.setProperty('--va-hero-image', 'url("' + backdrop.replace(/"/g, '%22') + '")');
                    hero.classList.add('va-hero--backdrop-ready');
                };
                image.src = backdrop;
            }
        } catch (error) {
            console.debug('[Velvet Antenna v0.14] hero enrichment failed', error);
        }
    }

    function addSeeAll() {
        if (!isHome()) return;

        document.querySelectorAll('.verticalSection').forEach(section => {
            const heading = section.querySelector('.sectionTitle-cards, .sectionTitle, h2, h3');
            if (!heading || heading.querySelector('.va14-see-all')) return;

            const label = txt(heading);
            if (!/continue watching|next up|recently added|collection|anime/i.test(label)) return;

            const action = document.createElement('span');
            action.className = 'va14-see-all';
            action.textContent = 'SEE ALL ›';
            heading.appendChild(action);
        });
    }

    function makeKey(label, value, className) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'va14-key' + (className ? ' ' + className : '');
        button.textContent = label;
        button.setAttribute('data-value', value);
        return button;
    }

    function searchInput() {
        return document.querySelector('.searchInput, input[type="search"], input[placeholder*="search" i]');
    }

    function applySearchKey(input, value) {
        if (!input) return;

        if (value === 'DELETE') {
            input.value = input.value.slice(0, -1);
        } else if (value === 'SPACE') {
            input.value += ' ';
        } else {
            input.value += value.toLowerCase();
        }

        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        input.focus();
    }

    function mountKeyboard() {
        const existing = document.getElementById(IDS.keyboard);
        if (!isSearch()) {
            if (existing) existing.remove();
            return;
        }
        if (existing) return;

        const input = searchInput();
        if (!input) return;

        const keyboard = document.createElement('aside');
        keyboard.id = IDS.keyboard;
        keyboard.className = 'va14-search-keyboard';
        keyboard.innerHTML = '<div class="va14-keyboard-label">REMOTE KEYBOARD</div><div class="va14-key-grid"></div>';

        const grid = keyboard.querySelector('.va14-key-grid');
        'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').forEach(letter => grid.appendChild(makeKey(letter, letter)));
        grid.appendChild(makeKey('SPACE', 'SPACE', 'va14-key--wide'));
        grid.appendChild(makeKey('DELETE', 'DELETE', 'va14-key--wide'));

        keyboard.addEventListener('click', function (event) {
            const key = event.target.closest('.va14-key');
            if (!key) return;
            applySearchKey(input, key.getAttribute('data-value'));
        });

        const intro = document.getElementById('va12-search-intro') || document.getElementById('va-search-intro');
        if (intro && intro.parentElement) intro.parentElement.insertBefore(keyboard, intro.nextSibling);
        else document.body.appendChild(keyboard);
    }

    function mountLibrarySubnav() {
        const existing = document.getElementById(IDS.libraryNav);
        if (!isLibrary()) {
            if (existing) existing.remove();
            return;
        }

        const intro = document.getElementById('va12-library-intro');
        if (!intro || existing) return;

        const subnav = document.createElement('div');
        subnav.id = IDS.libraryNav;
        subnav.className = 'va14-library-subnav';

        const tabs = Array.from(document.querySelectorAll('.skinHeader .headerTabs .emby-tab-button, .skinHeader .emby-tab-button')).filter(tab => txt(tab));

        if (tabs.length) {
            const tabWrap = document.createElement('div');
            tabWrap.className = 'va14-library-tabs';

            tabs.forEach(tab => {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'va14-library-tab';
                button.textContent = txt(tab);
                if (tab.classList.contains('emby-tab-button-active')) button.classList.add('is-active');
                button.addEventListener('click', function () {
                    tab.click();
                });
                tabWrap.appendChild(button);
            });

            subnav.appendChild(tabWrap);
        }

        const tools = document.createElement('div');
        tools.className = 'va14-library-tools';

        const filter = document.querySelector('.btnFilter, button[title*="filter" i], button[aria-label*="filter" i]');
        const sort = document.querySelector('.btnSort, button[title*="sort" i], button[aria-label*="sort" i]');

        if (filter) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.textContent = 'FILTERS';
            btn.addEventListener('click', function () { filter.click(); });
            tools.appendChild(btn);
        }

        if (sort) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.textContent = 'SORT';
            btn.addEventListener('click', function () { sort.click(); });
            tools.appendChild(btn);
        }

        if (tools.children.length) subnav.appendChild(tools);
        intro.insertAdjacentElement('afterend', subnav);
    }

    function formatDetailExtras(item) {
        const extras = { badges: mediaBadges(item), director: '', cast: '' };

        if (Array.isArray(item.People)) {
            const director = item.People.find(person => /director/i.test(person.Type || ''));
            extras.director = director ? director.Name : '';

            extras.cast = item.People
                .filter(person => /actor/i.test(person.Type || ''))
                .slice(0, 3)
                .map(person => person.Name)
                .filter(Boolean)
                .join(' · ');
        }

        return extras;
    }

    async function upgradeDetails() {
        if (!isDetails()) return;

        const hero = document.getElementById('va12-detail-hero');
        const itemId = currentItemId();
        if (!hero || !itemId) return;

        let extras = document.getElementById(IDS.detailExtras);
        if (!extras) {
            extras = document.createElement('div');
            extras.id = IDS.detailExtras;
            extras.className = 'va14-detail-extras';
            extras.innerHTML = '<div class="va14-detail-badges"></div><div class="va14-detail-facts"><div data-va14-fact="director"><span>DIRECTOR</span><b></b></div><div data-va14-fact="cast"><span>CAST</span><b></b></div></div>';
            const overview = hero.querySelector('.va12-detail-overview');
            if (overview) overview.insertAdjacentElement('afterend', extras);
        }

        if (extras.getAttribute('data-item-id') === itemId) return;
        extras.setAttribute('data-item-id', itemId);

        const client = api();
        if (!client || typeof client.getItem !== 'function' || typeof client.getCurrentUserId !== 'function') return;

        try {
            const item = await client.getItem(client.getCurrentUserId(), itemId);
            if (!item || !extras.isConnected) return;

            const data = formatDetailExtras(item);
            const badges = extras.querySelector('.va14-detail-badges');
            badges.innerHTML = data.badges.map(value => '<span>' + value + '</span>').join('');
            badges.hidden = !data.badges.length;

            const director = extras.querySelector('[data-va14-fact="director"]');
            const cast = extras.querySelector('[data-va14-fact="cast"]');

            director.querySelector('b').textContent = data.director;
            director.hidden = !data.director;

            cast.querySelector('b').textContent = data.cast;
            cast.hidden = !data.cast;

            const trailer = document.querySelector('.btnTrailer, button[title*="trailer" i], button[aria-label*="trailer" i]');
            if (trailer && !hero.querySelector('[data-va14-action="trailer"]')) {
                const actions = hero.querySelector('.va12-detail-actions');
                if (actions) {
                    const button = document.createElement('button');
                    button.type = 'button';
                    button.className = 'va-button va-button--ghost';
                    button.setAttribute('data-va14-action', 'trailer');
                    button.textContent = 'TRAILER';
                    button.addEventListener('click', function () { trailer.click(); });
                    actions.appendChild(button);
                }
            }
        } catch (error) {
            console.debug('[Velvet Antenna v0.14] detail extras failed', error);
        }
    }

    function decoratePlayer() {
        const video = document.querySelector('.videoPlayerContainer:not(.hide), .videoOsdPage:not(.hide)');
        document.body && document.body.classList.toggle('va14-player-active', Boolean(video));
    }

    function render() {
        if (isAdminOrPlayback()) {
            decoratePlayer();
            return;
        }

        document.body && document.body.setAttribute('data-va14-version', VERSION);
        upgradeHero();
        addSeeAll();
        mountKeyboard();
        mountLibrarySubnav();
        upgradeDetails();
        decoratePlayer();
    }

    function schedule(delay) {
        clearTimeout(timer);
        timer = setTimeout(render, typeof delay === 'number' ? delay : 150);
    }

    function start() {
        window.addEventListener('hashchange', function () {
            [IDS.keyboard, IDS.libraryNav, IDS.detailExtras].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.remove();
            });
            schedule(90);
        });

        observer = new MutationObserver(function () {
            schedule(180);
        });

        observer.observe(document.documentElement, { childList: true, subtree: true });

        render();
        setTimeout(function () { schedule(0); }, 500);
        setTimeout(function () { schedule(0); }, 1300);

        console.log('[Velvet Antenna] v' + VERSION + ' design expansion loaded');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start, { once: true });
    } else {
        start();
    }
})();