(function () {
    'use strict';

    const VERSION = '0.12.0';
    const IDS = {
        search: 'va12-search-intro',
        library: 'va12-library-intro',
        detail: 'va12-detail-hero'
    };

    let timer = null;
    let detailItemId = '';

    function txt(el) {
        return el ? (el.textContent || '').trim() : '';
    }

    function route() {
        return window.location.hash || '';
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

    function formatRuntime(ticks) {
        if (!ticks || !Number.isFinite(Number(ticks))) return '';
        const mins = Math.round(Number(ticks) / 600000000);
        if (mins < 60) return mins + ' min';
        const h = Math.floor(mins / 60);
        const m = mins % 60;
        return m ? h + 'h ' + m + 'm' : h + 'h';
    }

    function buildMeta(item) {
        if (!item) return '';
        const parts = [];
        if (item.ProductionYear) parts.push(String(item.ProductionYear));
        const runtime = formatRuntime(item.RunTimeTicks);
        if (runtime) parts.push(runtime);
        if (item.OfficialRating) parts.push(item.OfficialRating);
        if (item.CommunityRating) parts.push('★ ' + Number(item.CommunityRating).toFixed(1));
        return parts.join('  •  ');
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

    function preload(el, url, variable, readyClass) {
        if (!el || !url) return;
        const img = new Image();
        img.decoding = 'async';
        img.onload = function () {
            if (!el.isConnected) return;
            el.style.setProperty(variable, 'url("' + url.replace(/"/g, '%22') + '")');
            if (readyClass) el.classList.add(readyClass);
        };
        img.src = url;
    }

    function stopHomeRowShuffle() {
        if (Element.prototype.__va12InsertAdjacentElement) return;

        const original = Element.prototype.insertAdjacentElement;
        Element.prototype.__va12InsertAdjacentElement = original;

        Element.prototype.insertAdjacentElement = function (position, element) {
            const isReorder =
                isHome() &&
                position === 'afterend' &&
                element &&
                element.isConnected &&
                element.classList &&
                element.classList.contains('verticalSection') &&
                this &&
                this.isConnected &&
                (this.id === 'va-home-hero' ||
                    (this.classList && this.classList.contains('verticalSection')));

            if (isReorder) return element;
            return original.call(this, position, element);
        };
    }

    function navButton(kind) {
        return document.querySelector('#va-global-nav [data-va-kind="' + kind + '"]');
    }

    function clickNav(kind) {
        const button = navButton(kind);
        if (button && typeof button.click === 'function') button.click();
    }

    function removeIfOffRoute(id, enabled) {
        const el = document.getElementById(id);
        if (!enabled && el) el.remove();
    }

    function searchInput() {
        return document.querySelector('.searchInput, input[type="search"], input[placeholder*="search" i]');
    }

    function makeShortcut(label, kind) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'va12-search-shortcut';
        button.innerHTML = '<span>' + label + '</span><i>›</i>';
        button.addEventListener('click', function () {
            clickNav(kind);
        });
        return button;
    }

    function mountSearch() {
        removeIfOffRoute(IDS.search, isSearch());
        if (!isSearch()) {
            document.body && document.body.classList.remove('va12-search-query');
            return;
        }

        const input = searchInput();
        if (!input) return;

        let intro = document.getElementById(IDS.search);
        if (!intro) {
            intro = document.createElement('section');
            intro.id = IDS.search;
            intro.className = 'va12-search-intro';
            intro.innerHTML = `
                <div class="va12-search-copy">
                    <div class="va-kicker">VELVET ANTENNA</div>
                    <h1>Search your world.</h1>
                    <p>One search across films, series, episodes, collections and people.</p>
                </div>
                <div class="va12-search-shortcuts"></div>
            `;

            const shortcuts = intro.querySelector('.va12-search-shortcuts');
            if (navButton('movies')) shortcuts.appendChild(makeShortcut('MOVIES', 'movies'));
            if (navButton('series')) shortcuts.appendChild(makeShortcut('SERIES', 'series'));
            if (navButton('collections')) shortcuts.appendChild(makeShortcut('COLLECTIONS', 'collections'));

            const host = input.closest('.searchFields') || input.closest('.inputContainer') || input.parentElement;
            if (host && host.parentElement) host.parentElement.insertBefore(intro, host);

            const oldIntro = document.getElementById('va-search-intro');
            if (oldIntro) oldIntro.classList.add('va12-old-search-intro');
        }

        if (!input.dataset.va12Bound) {
            input.dataset.va12Bound = '1';
            input.addEventListener('input', function () {
                document.body && document.body.classList.toggle('va12-search-query', Boolean(input.value.trim()));
            });
        }
        document.body && document.body.classList.toggle('va12-search-query', Boolean(input.value.trim()));

        const headings = Array.from(document.querySelectorAll('h2, h3, .sectionTitle'));
        const suggestionHeading = headings.find(el => /suggestions/i.test(txt(el)));

        if (suggestionHeading) {
            suggestionHeading.classList.add('va12-suggestion-heading');
            let area =
                suggestionHeading.closest('.verticalSection') ||
                suggestionHeading.parentElement;

            if (area) {
                area.classList.add('va12-suggestion-area');
                const candidates = Array.from(area.querySelectorAll('a, button')).filter(el => {
                    const value = txt(el);
                    return value && value.length < 100;
                });

                candidates.forEach((el, index) => {
                    el.classList.add('va12-suggestion-chip');
                    el.classList.toggle('va12-suggestion-hidden', index > 11);
                });
            }
        }

        document.querySelectorAll('.verticalSection').forEach(section => {
            const heading = txt(section.querySelector('.sectionTitle, .sectionTitle-cards, h2, h3'));
            if (heading && !/suggestions/i.test(heading)) section.classList.add('va12-search-results');
        });
    }

    function libraryKind() {
        const active = document.querySelector('#va-global-nav .va-nav__item--active');
        const kind = active && active.getAttribute('data-va-kind');
        if (['movies', 'series', 'anime', 'collections'].includes(kind)) return kind;

        const value = route().toLowerCase();
        if (value.includes('collectiontype=movies')) return 'movies';
        if (value.includes('collectiontype=tvshows')) return 'series';
        if (value.includes('collection')) return 'collections';
        return 'library';
    }

    function libraryLabel(kind) {
        return {
            movies: 'Movies',
            series: 'Series',
            anime: 'Anime',
            collections: 'Collections',
            library: 'Library'
        }[kind] || 'Library';
    }

    function libraryCopy(kind) {
        return {
            movies: 'Your film library, without the clutter.',
            series: 'Pick up a series or find something new.',
            anime: 'Series, films, specials and everything in between.',
            collections: 'Curated worlds, franchises and favourites.',
            library: 'Browse everything available to you.'
        }[kind] || 'Browse your library.';
    }

    function visiblePage() {
        return Array.from(document.querySelectorAll('.libraryPage, .page')).find(el => el.offsetParent !== null) ||
            document.querySelector('.libraryPage, .page');
    }

    function libraryCount() {
        const paging = document.querySelector('.listPaging, .listPagingButton, .listPagingItems');
        const match = txt(paging).match(/of\s+([\d,]+)/i);
        return match && match[1] ? match[1] : '';
    }

    function mountLibrary() {
        removeIfOffRoute(IDS.library, isLibrary());
        if (!isLibrary()) return;

        const page = visiblePage();
        if (!page) return;

        const kind = libraryKind();
        const count = libraryCount();
        let intro = document.getElementById(IDS.library);

        if (!intro) {
            intro = document.createElement('section');
            intro.id = IDS.library;
            intro.className = 'va12-library-intro';
            intro.innerHTML = `
                <div class="va-kicker">VELVET ANTENNA</div>
                <div class="va12-library-heading">
                    <h1></h1>
                    <span class="va12-library-count"></span>
                </div>
                <p></p>
            `;
            page.insertBefore(intro, page.firstChild);
        }

        intro.setAttribute('data-kind', kind);
        intro.querySelector('h1').textContent = libraryLabel(kind);
        intro.querySelector('p').textContent = libraryCopy(kind);

        const countEl = intro.querySelector('.va12-library-count');
        countEl.textContent = count ? count + ' titles' : '';
        countEl.hidden = !count;

        const stockTitle = document.querySelector('.pageTitle');
        if (stockTitle) stockTitle.classList.add('va12-stock-title');

        const items = document.querySelector('.itemsContainer');
        if (items) items.classList.add('va12-library-grid');

        document.querySelectorAll('.card').forEach(card => card.classList.add('va12-library-card'));
    }

    function stockPlayButton() {
        return document.querySelector(
            '.mainDetailButtons .btnPlay, .detailPagePrimaryContainer .btnPlay, button[title*="play" i], button[aria-label*="play" i]'
        );
    }

    function stockFavoriteButton() {
        const selectors = [
            '.btnUserRating',
            '.btnFavorite',
            '[data-action="favorite"]',
            'button[title*="favorite" i]',
            'button[aria-label*="favorite" i]'
        ];

        for (const selector of selectors) {
            const el = document.querySelector(selector);
            if (el) return el;
        }
        return null;
    }

    function clickElement(el) {
        if (el && typeof el.click === 'function') {
            el.click();
            return true;
        }
        return false;
    }

    function detailBackdrop(client, item, itemId) {
        if (!client || !item) return '';

        if (Array.isArray(item.BackdropImageTags) && item.BackdropImageTags.length) {
            return imageUrl(client, item.Id || itemId, 'Backdrop', item.BackdropImageTags[0], 1700);
        }

        if (
            item.ParentBackdropItemId &&
            Array.isArray(item.ParentBackdropImageTags) &&
            item.ParentBackdropImageTags.length
        ) {
            return imageUrl(client, item.ParentBackdropItemId, 'Backdrop', item.ParentBackdropImageTags[0], 1700);
        }

        if (item.ImageTags && item.ImageTags.Primary) {
            return imageUrl(client, item.Id || itemId, 'Primary', item.ImageTags.Primary, 900);
        }

        return '';
    }

    function detailLogo(client, item, itemId) {
        if (!client || !item || !item.ImageTags || !item.ImageTags.Logo) return '';
        return imageUrl(client, item.Id || itemId, 'Logo', item.ImageTags.Logo, 700);
    }

    function createDetailHero(itemId) {
        const hero = document.createElement('section');
        hero.id = IDS.detail;
        hero.className = 'va12-detail-hero';
        hero.setAttribute('data-item-id', itemId);
        hero.innerHTML = `
            <div class="va12-detail-art" aria-hidden="true"></div>
            <div class="va12-detail-shade" aria-hidden="true"></div>
            <div class="va12-detail-content">
                <div class="va-kicker">VELVET ANTENNA</div>
                <img class="va12-detail-logo" alt="" hidden>
                <h1 class="va12-detail-title">Loading…</h1>
                <div class="va12-detail-meta"></div>
                <div class="va12-detail-genres"></div>
                <p class="va12-detail-overview"></p>
                <div class="va12-detail-actions">
                    <button type="button" class="va-button va-button--primary" data-va12-action="play"><span>▶</span><span>PLAY</span></button>
                    <button type="button" class="va-button va-button--secondary" data-va12-action="favorite"><span>＋</span><span>MY LIST</span></button>
                    <button type="button" class="va-button va-button--ghost" data-va12-action="more"><span>MORE</span></button>
                </div>
            </div>
        `;

        hero.querySelector('[data-va12-action="play"]').addEventListener('click', function () {
            clickElement(stockPlayButton());
        });

        hero.querySelector('[data-va12-action="favorite"]').addEventListener('click', function () {
            if (!clickElement(stockFavoriteButton())) {
                hero.querySelector('[data-va12-action="favorite"]').hidden = true;
            }
        });

        hero.querySelector('[data-va12-action="more"]').addEventListener('click', function () {
            const target =
                document.querySelector('.detailPageSecondaryContainer') ||
                document.querySelector('.verticalSection');
            if (target && typeof target.scrollIntoView === 'function') {
                target.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        });

        return hero;
    }

    async function fillDetailHero(hero, itemId) {
        const client = api();
        if (!client || typeof client.getItem !== 'function' || typeof client.getCurrentUserId !== 'function') return;

        try {
            const item = await client.getItem(client.getCurrentUserId(), itemId);
            if (!item || !hero.isConnected) return;

            hero.querySelector('.va12-detail-title').textContent = item.Name || 'Untitled';
            hero.querySelector('.va12-detail-meta').textContent = buildMeta(item);

            const overview = hero.querySelector('.va12-detail-overview');
            overview.textContent = (item.Overview || '').trim();
            overview.hidden = !overview.textContent;

            const genres = hero.querySelector('.va12-detail-genres');
            genres.innerHTML = '';
            (Array.isArray(item.Genres) ? item.Genres.slice(0, 4) : []).forEach(genre => {
                const chip = document.createElement('span');
                chip.textContent = genre;
                genres.appendChild(chip);
            });
            genres.hidden = !genres.children.length;

            const backdrop = detailBackdrop(client, item, itemId);
            if (backdrop) preload(hero, backdrop, '--va12-detail-image', 'va12-detail-art-ready');

            const logo = detailLogo(client, item, itemId);
            if (logo) {
                const logoEl = hero.querySelector('.va12-detail-logo');
                logoEl.src = logo;
                logoEl.hidden = false;
                hero.classList.add('va12-detail-has-logo');
            }

            if (!stockFavoriteButton()) {
                hero.querySelector('[data-va12-action="favorite"]').hidden = true;
            }

            document.body && document.body.classList.add('va12-detail-ready');
        } catch (error) {
            console.debug('[Velvet Antenna v0.12] detail enrichment failed', error);
        }
    }

    function mountDetails() {
        removeIfOffRoute(IDS.detail, isDetails());

        if (!isDetails()) {
            detailItemId = '';
            document.body && document.body.classList.remove('va12-detail-ready');
            return;
        }

        const itemId = currentItemId();
        if (!itemId) return;

        const current = document.getElementById(IDS.detail);
        if (current && current.getAttribute('data-item-id') === itemId) {
            document.body && document.body.classList.add('va12-detail-ready');
        } else {
            if (current) current.remove();

            const container =
                document.querySelector('.detailPageContent') ||
                visiblePage();

            if (!container) return;

            const hero = createDetailHero(itemId);
            container.insertBefore(hero, container.firstChild);
            detailItemId = itemId;
            fillDetailHero(hero, itemId);
        }

        const oldBrand = document.getElementById('va-detail-brand');
        if (oldBrand) oldBrand.classList.add('va12-old-detail-brand');

        document.querySelectorAll('.peopleItems .card, .castContent .card').forEach(card => card.classList.add('va12-cast-card'));
        document.querySelectorAll('.childrenItemsContainer .card, .episodeCard').forEach(card => card.classList.add('va12-episode-card'));
    }

    function decorateHome() {
        if (!isHome()) return;

        const recentlyAdded = Array.from(document.querySelectorAll('.verticalSection')).find(section => {
            return /recently added.*movies/i.test(txt(section.querySelector('.sectionTitle, .sectionTitle-cards, h2, h3')));
        });

        if (recentlyAdded) recentlyAdded.classList.add('va12-stable-row');
    }

    function render() {
        if (isAdminOrPlayback()) return;

        decorateHome();
        mountSearch();
        mountLibrary();
        mountDetails();
    }

    function schedule(delay) {
        clearTimeout(timer);
        timer = setTimeout(render, typeof delay === 'number' ? delay : 140);
    }

    function start() {
        stopHomeRowShuffle();

        window.addEventListener('hashchange', function () {
            document.body && document.body.classList.remove('va12-detail-ready', 'va12-search-query');
            [IDS.search, IDS.library, IDS.detail].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.remove();
            });
            schedule(100);
        });

        new MutationObserver(function () {
            schedule(160);
        }).observe(document.documentElement, { childList: true, subtree: true });

        render();
        setTimeout(function () { schedule(0); }, 450);
        setTimeout(function () { schedule(0); }, 1200);

        console.log('[Velvet Antenna] v' + VERSION + ' patch loaded');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start, { once: true });
    } else {
        start();
    }
})();