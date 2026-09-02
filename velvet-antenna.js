(function () {
    'use strict';

    const VERSION = '0.10.0';
    const IDS = {
        nav: 'va-global-nav',
        hero: 'va-home-hero',
        searchIntro: 'va-search-intro',
        detailBrand: 'va-detail-brand'
    };
    const CACHE_PREFIX = 'velvet-antenna:';
    const PAGE_CLASSES = [
        'va-page-home',
        'va-page-search',
        'va-page-library',
        'va-page-details',
        'va-page-live',
        'va-page-other'
    ];

    let observer = null;
    let renderTimer = null;
    let lastHash = '';

    function text(el) {
        return el ? (el.textContent || '').trim() : '';
    }

    function normalise(value) {
        return (value || '').trim().toLowerCase();
    }

    function hash() {
        return window.location.hash || '';
    }

    function isAdminRoute() {
        return /dashboard|configurationpage|scheduledtasks|logs|networking|plugins|metadataeditor/i.test(hash());
    }

    function isPlaybackRoute() {
        return /videoosd|nowplaying|playback/i.test(hash()) || Boolean(document.querySelector('.videoOsdPage:not(.hide), .videoPlayerContainer:not(.hide)'));
    }

    function pageType() {
        const value = hash().toLowerCase();
        if (value === '#/home' || value.startsWith('#/home?')) return 'home';
        if (value.startsWith('#/search')) return 'search';
        if (/details\?id=|\/details\//i.test(value)) return 'details';
        if (/livetv|tvguide|recordings|scheduled/i.test(value)) return 'live';
        if (/\/movies|\/tv|\/collections|topparentid|collectiontype=/i.test(value)) return 'library';
        return 'other';
    }

    function setPageClass() {
        const body = document.body;
        if (!body) return;

        PAGE_CLASSES.forEach(cls => body.classList.remove(cls));
        body.classList.remove('va-viewer');
        body.removeAttribute('data-va-version');

        if (isAdminRoute() || isPlaybackRoute()) return;

        const type = pageType();
        body.classList.add('va-viewer', 'va-page-' + type);
        body.setAttribute('data-va-version', VERSION);
    }

    function getApiClient() {
        return window.ApiClient || null;
    }

    function sessionGet(key) {
        try {
            return sessionStorage.getItem(CACHE_PREFIX + key);
        } catch (error) {
            return null;
        }
    }

    function sessionSet(key, value) {
        try {
            if (value !== undefined && value !== null) {
                sessionStorage.setItem(CACHE_PREFIX + key, String(value));
            }
        } catch (error) {
            // Storage is optional.
        }
    }

    function getTitle(card) {
        if (!card) return '';
        const selectors = ['.cardText-first', '.cardText', '.itemName', '[title]'];
        for (const selector of selectors) {
            const el = card.querySelector(selector);
            if (!el) continue;
            const value = ((el.textContent || el.getAttribute('title') || '') + '').trim();
            if (value) return value;
        }
        return (card.getAttribute('aria-label') || card.getAttribute('title') || '').trim();
    }

    function getSecondary(card) {
        if (!card) return '';
        const values = Array.from(card.querySelectorAll('.cardText')).map(text).filter(Boolean);
        return values.length > 1 ? values.slice(1, 3).join('  •  ') : '';
    }

    function getImage(card) {
        if (!card) return '';

        const img = card.querySelector('img');
        if (img && img.src) return img.src;

        const candidates = card.querySelectorAll('.cardImage, .cardImageContainer, .cardContent');
        for (const el of candidates) {
            const bg = window.getComputedStyle(el).backgroundImage;
            const match = bg && bg.match(/url\(["']?(.*?)["']?\)/i);
            if (match && match[1]) return match[1];
        }
        return '';
    }

    function getItemId(card) {
        if (!card) return '';

        const candidates = [
            card,
            card.querySelector('[data-id]'),
            card.querySelector('[data-itemid]'),
            card.closest('[data-id]'),
            card.closest('[data-itemid]')
        ].filter(Boolean);

        for (const el of candidates) {
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

    function cardHref(card) {
        if (!card) return '';
        const link = card.closest('a[href]') || card.querySelector('a[href]');
        return link ? (link.getAttribute('href') || '') : '';
    }

    function sectionHeading(section) {
        if (!section) return '';
        return text(section.querySelector('.sectionTitle-cards, .sectionTitle, h2, h3'));
    }

    function findSectionByHeading(regexes) {
        const headings = Array.from(document.querySelectorAll('.sectionTitle-cards, .sectionTitle, h2, h3'));
        for (const regex of regexes) {
            const heading = headings.find(el => regex.test(text(el)));
            if (!heading) continue;
            const section = heading.closest('.verticalSection') || (heading.parentElement && heading.parentElement.parentElement);
            if (section) return section;
        }
        return null;
    }

    function findHomeContainer() {
        return document.querySelector('.homeSectionsContainer') ||
               document.querySelector('.libraryPage') ||
               document.querySelector('.page.homePage') ||
               document.querySelector('#indexPage');
    }

    function findMyMediaSection() {
        return findSectionByHeading([/^my media$/i]);
    }

    function findLibraryCard(patterns) {
        const myMedia = findMyMediaSection();
        const scope = myMedia || document;
        const cards = Array.from(scope.querySelectorAll('.card'));
        return cards.find(card => patterns.some(pattern => pattern.test(getTitle(card)))) || null;
    }

    function captureLibraryRoutes() {
        const routes = {
            movies: [/^movies$/i],
            series: [/^shows$/i, /^series$/i],
            anime: [/^anime$/i],
            collections: [/^collections$/i],
            live: [/^live tv$/i, /^livetv$/i, /^live$/i]
        };

        Object.keys(routes).forEach(kind => {
            const card = findLibraryCard(routes[kind]);
            const href = cardHref(card);
            if (href) sessionSet('route:' + kind, href);
        });

        const liveLink = document.querySelector('a[href*="livetv" i], a[href*="live" i]');
        if (liveLink && liveLink.getAttribute('href')) {
            sessionSet('route:live', liveLink.getAttribute('href'));
        }
    }

    function hasLibrary(kind) {
        if (sessionGet('route:' + kind)) return true;

        const patterns = {
            movies: [/^movies$/i],
            series: [/^shows$/i, /^series$/i],
            anime: [/^anime$/i],
            collections: [/^collections$/i],
            live: [/^live tv$/i, /^livetv$/i, /^live$/i]
        };

        if (kind === 'live' && document.querySelector('a[href*="livetv" i], a[href*="live" i]')) return true;
        return Boolean(findLibraryCard(patterns[kind] || []));
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

    function navigateLibrary(kind) {
        const cached = sessionGet('route:' + kind);
        if (cached) {
            if (cached.charAt(0) === '#') {
                window.location.hash = cached;
            } else {
                window.location.href = cached;
            }
            return;
        }

        const patterns = {
            movies: [/^movies$/i],
            series: [/^shows$/i, /^series$/i],
            anime: [/^anime$/i],
            collections: [/^collections$/i],
            live: [/^live tv$/i, /^livetv$/i, /^live$/i]
        };

        const card = findLibraryCard(patterns[kind] || []);
        if (card && clickCard(card)) return;

        if (kind === 'live') {
            const live = document.querySelector('a[href*="livetv" i], a[href*="live" i]');
            if (live && typeof live.click === 'function') live.click();
        }
    }

    function findStockButton(kind) {
        const selectors = kind === 'search'
            ? ['.headerSearchButton', '[aria-label="Search"]', '[title="Search"]']
            : ['.headerUserButton', '.headerUserButtonRound', '[aria-label*="profile" i]', '[title*="profile" i]'];

        for (const selector of selectors) {
            const el = document.querySelector(selector);
            if (el) return el;
        }
        return null;
    }

    function openUtility(kind) {
        const target = findStockButton(kind);
        if (target && typeof target.click === 'function') {
            target.click();
            return;
        }

        if (kind === 'search') window.location.hash = '#/search';
    }

    function activeNavKind() {
        const type = pageType();
        const value = hash().toLowerCase();
        if (type === 'home') return 'home';
        if (type === 'search') return 'search';
        if (type === 'live') return 'live';
        if (value.includes('collectiontype=movies') || value.startsWith('#/movies')) return 'movies';
        if (value.includes('collectiontype=tvshows') || value.startsWith('#/tv')) return 'series';
        if (value.includes('collection')) return 'collections';
        return '';
    }

    function makeMark() {
        const mark = document.createElement('span');
        mark.className = 'va-mark';
        mark.setAttribute('aria-hidden', 'true');
        mark.innerHTML = '<span></span><span></span><span></span>';
        return mark;
    }

    function createNavButton(label, kind, action) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'va-nav__item';
        button.textContent = label;
        button.setAttribute('data-va-kind', kind);
        if (activeNavKind() === kind) button.classList.add('va-nav__item--active');
        button.addEventListener('click', action);
        return button;
    }

    function createGlobalNav() {
        const nav = document.createElement('nav');
        nav.id = IDS.nav;
        nav.className = 'va-nav';
        nav.setAttribute('aria-label', 'Velvet Antenna navigation');
        nav.setAttribute('data-va-version', VERSION);

        const brand = document.createElement('button');
        brand.type = 'button';
        brand.className = 'va-nav__brand';
        brand.title = 'Velvet Antenna v' + VERSION;
        brand.appendChild(makeMark());
        const wordmark = document.createElement('span');
        wordmark.className = 'va-nav__brand-text';
        wordmark.textContent = 'VELVET ANTENNA';
        brand.appendChild(wordmark);
        brand.addEventListener('click', function () { window.location.hash = '#/home'; });

        const primary = document.createElement('div');
        primary.className = 'va-nav__primary';
        primary.appendChild(createNavButton('HOME', 'home', function () { window.location.hash = '#/home'; }));
        if (hasLibrary('movies')) primary.appendChild(createNavButton('MOVIES', 'movies', function () { navigateLibrary('movies'); }));
        if (hasLibrary('series')) primary.appendChild(createNavButton('SERIES', 'series', function () { navigateLibrary('series'); }));
        if (hasLibrary('anime')) primary.appendChild(createNavButton('ANIME', 'anime', function () { navigateLibrary('anime'); }));
        if (hasLibrary('live')) primary.appendChild(createNavButton('LIVE', 'live', function () { navigateLibrary('live'); }));
        if (hasLibrary('collections')) primary.appendChild(createNavButton('COLLECTIONS', 'collections', function () { navigateLibrary('collections'); }));

        const utility = document.createElement('div');
        utility.className = 'va-nav__utility';
        utility.appendChild(createNavButton('SEARCH', 'search', function () { openUtility('search'); }));
        utility.appendChild(createNavButton('PROFILE', 'profile', function () { openUtility('profile'); }));

        nav.appendChild(brand);
        nav.appendChild(primary);
        nav.appendChild(utility);
        return nav;
    }

    function mountGlobalNav() {
        const existing = document.getElementById(IDS.nav);

        if (isAdminRoute() || isPlaybackRoute()) {
            if (existing) existing.remove();
            return;
        }

        if (!document.body) return;

        if (!existing) {
            document.body.insertBefore(createGlobalNav(), document.body.firstChild);
        } else {
            existing.querySelectorAll('.va-nav__item').forEach(button => {
                button.classList.toggle('va-nav__item--active', button.getAttribute('data-va-kind') === activeNavKind());
            });
        }
    }

    function isLibraryTile(card) {
        const title = normalise(getTitle(card));
        if (!title) return true;

        const blocked = new Set(['collections', 'movies', 'shows', 'series', 'anime', 'music', 'books', 'photos', 'livetv', 'live tv']);
        if (blocked.has(title)) return true;

        const section = card.closest('.verticalSection');
        if (section && /^my media$/i.test(sectionHeading(section))) return true;
        return false;
    }

    function visibleCards() {
        return Array.from(document.querySelectorAll('.card')).filter(card => {
            if (card.closest('#' + IDS.hero)) return false;
            if (card.offsetParent === null) return false;
            if (isLibraryTile(card)) return false;
            return Boolean(getImage(card) || getItemId(card));
        });
    }

    function findCardInSection(regexes) {
        const section = findSectionByHeading(regexes);
        if (!section) return null;
        return Array.from(section.querySelectorAll('.card')).find(card => {
            return card.offsetParent !== null && !isLibraryTile(card) && Boolean(getImage(card) || getItemId(card));
        }) || null;
    }

    function findFeaturedCard() {
        return (
            findCardInSection([/continue watching/i, /resume/i]) ||
            findCardInSection([/next up/i]) ||
            findCardInSection([/recently added.*movies/i, /latest.*movies/i]) ||
            visibleCards()[0] ||
            null
        );
    }

    function formatRuntime(ticks) {
        if (!ticks || !Number.isFinite(Number(ticks))) return '';
        const minutes = Math.round(Number(ticks) / 600000000);
        if (minutes < 60) return minutes + ' min';
        const hours = Math.floor(minutes / 60);
        const rest = minutes % 60;
        return rest ? hours + 'h ' + rest + 'm' : hours + 'h';
    }

    function buildMeta(item, fallback) {
        if (!item) return fallback || 'FEATURED';
        const parts = [];
        if (item.ProductionYear) parts.push(String(item.ProductionYear));
        const runtime = formatRuntime(item.RunTimeTicks);
        if (runtime) parts.push(runtime);
        if (item.OfficialRating) parts.push(item.OfficialRating);
        if (item.CommunityRating) parts.push('★ ' + Number(item.CommunityRating).toFixed(1));
        return parts.join('  •  ') || fallback || 'FEATURED';
    }

    function imageUrl(api, itemId, type, tag, width, quality) {
        try {
            if (api && typeof api.getImageUrl === 'function') {
                return api.getImageUrl(itemId, {
                    type: type,
                    index: 0,
                    tag: tag,
                    maxWidth: width || 1600,
                    quality: quality || 82
                });
            }
        } catch (error) {
            console.debug('[Velvet Antenna] image URL fallback', error);
        }
        return '';
    }

    function heroCacheKey(itemId) {
        return 'hero:' + itemId;
    }

    function readHeroCache(itemId) {
        if (!itemId) return null;
        const raw = sessionGet(heroCacheKey(itemId));
        if (!raw) return null;
        try {
            return JSON.parse(raw);
        } catch (error) {
            return null;
        }
    }

    function writeHeroCache(itemId, value) {
        if (!itemId || !value) return;
        try {
            sessionSet(heroCacheKey(itemId), JSON.stringify(value));
        } catch (error) {
            // Ignore cache failures.
        }
    }

    function preloadBackdrop(hero, url) {
        if (!hero || !url) return;
        const image = new Image();
        image.decoding = 'async';
        image.onload = function () {
            if (!hero.isConnected) return;
            hero.style.setProperty('--va-hero-image', 'url("' + url.replace(/"/g, '%22') + '")');
            hero.classList.add('va-hero--backdrop-ready');
        };
        image.src = url;
    }

    function applyCachedHero(hero, cached) {
        if (!hero || !cached) return;
        if (cached.title) hero.querySelector('.va-hero__title').textContent = cached.title;
        if (cached.meta) hero.querySelector('.va-hero__meta').textContent = cached.meta;
        if (cached.overview) hero.querySelector('.va-hero__copy').textContent = cached.overview;
        if (cached.backdrop) preloadBackdrop(hero, cached.backdrop);
    }

    function playCard(card) {
        if (!card) return;
        const play = card.querySelector('.cardOverlayButton-play, [data-action="play"], .btnPlay');
        if (play && typeof play.click === 'function') {
            play.click();
            return;
        }
        clickCard(card);
    }

    async function enrichHero(hero, card) {
        const api = getApiClient();
        const itemId = getItemId(card);
        if (!api || !itemId) return;

        const cached = readHeroCache(itemId);
        if (cached) applyCachedHero(hero, cached);

        try {
            if (typeof api.getItem !== 'function' || typeof api.getCurrentUserId !== 'function') return;
            const item = await api.getItem(api.getCurrentUserId(), itemId);
            if (!item || !hero.isConnected) return;

            const title = item.Name || getTitle(card) || 'Featured';
            const meta = buildMeta(item, getSecondary(card));
            const overview = (item.Overview || '').trim();

            hero.querySelector('.va-hero__title').textContent = title;
            hero.querySelector('.va-hero__meta').textContent = meta;
            if (overview) hero.querySelector('.va-hero__copy').textContent = overview;

            const userData = item.UserData || {};
            if (userData.PlaybackPositionTicks > 0 && !userData.Played) {
                const label = hero.querySelector('[data-va-action="play"] .va-button__label');
                if (label) label.textContent = 'CONTINUE';
            }

            let backdrop = '';
            if (Array.isArray(item.BackdropImageTags) && item.BackdropImageTags.length) {
                backdrop = imageUrl(api, item.Id || itemId, 'Backdrop', item.BackdropImageTags[0], 1600, 82);
            } else if (item.ParentBackdropItemId && Array.isArray(item.ParentBackdropImageTags) && item.ParentBackdropImageTags.length) {
                backdrop = imageUrl(api, item.ParentBackdropItemId, 'Backdrop', item.ParentBackdropImageTags[0], 1600, 82);
            }

            if (backdrop) preloadBackdrop(hero, backdrop);
            writeHeroCache(itemId, { title: title, meta: meta, overview: overview, backdrop: backdrop });
        } catch (error) {
            console.debug('[Velvet Antenna] hero metadata enrichment failed', error);
        }
    }

    function createHero(card) {
        const hero = document.createElement('section');
        hero.id = IDS.hero;
        hero.className = 'va-hero';
        hero.setAttribute('data-va-version', VERSION);
        hero.setAttribute('aria-label', 'Velvet Antenna featured title');

        const fallbackImage = getImage(card);
        if (fallbackImage) {
            hero.style.setProperty('--va-hero-image-base', 'url("' + fallbackImage.replace(/"/g, '%22') + '")');
            hero.classList.add('va-hero--has-base-art');
        }

        hero.innerHTML = `
            <div class="va-hero__art va-hero__art--base" aria-hidden="true"></div>
            <div class="va-hero__art va-hero__art--backdrop" aria-hidden="true"></div>
            <div class="va-hero__shade" aria-hidden="true"></div>
            <div class="va-hero__signal" aria-hidden="true"><i></i><i></i><i></i></div>
            <div class="va-hero__content">
                <div class="va-hero__eyebrow">VELVET ANTENNA</div>
                <h1 class="va-hero__title"></h1>
                <div class="va-hero__meta"></div>
                <p class="va-hero__copy">Featured from your library.</p>
                <div class="va-hero__actions">
                    <button class="va-button va-button--primary" type="button" data-va-action="play"><span class="va-button__icon">▶</span><span class="va-button__label">PLAY</span></button>
                    <button class="va-button va-button--secondary" type="button" data-va-action="details"><span>MORE INFO</span></button>
                </div>
            </div>
        `;

        hero.querySelector('.va-hero__title').textContent = getTitle(card) || 'Featured';
        hero.querySelector('.va-hero__meta').textContent = getSecondary(card) || 'FEATURED';

        hero.querySelector('[data-va-action="play"]').addEventListener('click', function (event) {
            event.preventDefault();
            event.stopPropagation();
            playCard(card);
        });

        hero.querySelector('[data-va-action="details"]').addEventListener('click', function (event) {
            event.preventDefault();
            event.stopPropagation();
            clickCard(card);
        });

        enrichHero(hero, card);
        return hero;
    }

    function removeHomeHero() {
        const hero = document.getElementById(IDS.hero);
        if (hero) hero.remove();
    }

    function decorateHomeSections() {
        const sections = Array.from(document.querySelectorAll('.verticalSection'));
        sections.forEach(section => {
            const heading = sectionHeading(section);
            section.classList.remove('va-row-landscape', 'va-row-posters', 'va-row-wide');

            if (/continue watching|next up/i.test(heading)) section.classList.add('va-row-landscape');
            if (/recently added.*movie/i.test(heading)) section.classList.add('va-row-posters');
            if (/recently added.*show|recently added.*series/i.test(heading)) {
                section.classList.add('va-row-posters');
                const titleEl = section.querySelector('.sectionTitle-cards, .sectionTitle, h2, h3');
                if (titleEl && /shows/i.test(text(titleEl))) titleEl.textContent = 'Recently Added Series';
            }
            if (/collection/i.test(heading)) section.classList.add('va-row-wide');
        });

        const myMedia = findMyMediaSection();
        if (myMedia) myMedia.classList.add('va-my-media-source');
    }

    function reorderHomeSections() {
        const container = findHomeContainer();
        if (!container) return;

        const sections = Array.from(container.querySelectorAll(':scope > .verticalSection, :scope > div > .verticalSection'));
        if (!sections.length) return;

        const priorities = [
            [/continue watching/i, /resume/i],
            [/next up/i],
            [/recently added.*movies/i],
            [/recently added.*series/i, /recently added.*shows/i],
            [/collections?/i],
            [/anime/i],
            [/live now/i],
            [/recordings/i]
        ];

        let anchor = document.getElementById(IDS.hero);
        priorities.forEach(group => {
            const section = sections.find(candidate => {
                const heading = sectionHeading(candidate);
                return group.some(regex => regex.test(heading));
            });
            if (!section || section.classList.contains('va-my-media-source')) return;
            if (anchor && anchor.parentElement === container) {
                anchor.insertAdjacentElement('afterend', section);
                anchor = section;
            }
        });
    }

    function renderHome() {
        if (pageType() !== 'home') {
            removeHomeHero();
            return;
        }

        captureLibraryRoutes();
        decorateHomeSections();

        const container = findHomeContainer();
        if (!container) return;

        if (!document.getElementById(IDS.hero)) {
            const card = findFeaturedCard();
            if (card) {
                container.insertBefore(createHero(card), container.firstChild);
            }
        }

        reorderHomeSections();
    }

    function mountSearchIntro() {
        const existing = document.getElementById(IDS.searchIntro);
        if (pageType() !== 'search') {
            if (existing) existing.remove();
            return;
        }
        if (existing) return;

        const input = document.querySelector('.searchInput, input[type="search"], input[placeholder*="search" i]');
        if (!input) return;

        const intro = document.createElement('section');
        intro.id = IDS.searchIntro;
        intro.className = 'va-search-intro';
        intro.innerHTML = '<div class="va-kicker">VELVET ANTENNA</div><h1>Search everything.</h1><p>Movies, series, episodes, collections and more.</p>';

        const host = input.closest('.searchFields') || input.parentElement || document.querySelector('.libraryPage');
        if (host && host.parentElement) host.parentElement.insertBefore(intro, host);
    }

    function decorateSearchResults() {
        if (pageType() !== 'search') return;

        const suggestionsHeading = Array.from(document.querySelectorAll('h2, h3, .sectionTitle')).find(el => /suggestions/i.test(text(el)));
        if (suggestionsHeading) suggestionsHeading.classList.add('va-search-suggestions-title');

        const links = Array.from(document.querySelectorAll('a')).filter(el => {
            const value = text(el);
            if (!value || value.length > 90) return false;
            const parent = suggestionsHeading && suggestionsHeading.parentElement;
            return parent ? parent.contains(el) : false;
        });
        links.forEach(link => link.classList.add('va-search-chip'));
    }

    function mountDetailBrand() {
        const existing = document.getElementById(IDS.detailBrand);
        if (pageType() !== 'details') {
            if (existing) existing.remove();
            return;
        }
        if (existing) return;

        const title = document.querySelector('.itemName, .detailPagePrimaryContent h1, .detailPagePrimaryContainer h1');
        if (!title) return;

        const brand = document.createElement('div');
        brand.id = IDS.detailBrand;
        brand.className = 'va-detail-brand';
        brand.textContent = 'VELVET ANTENNA';
        title.parentElement.insertBefore(brand, title);
    }

    function decorateDetails() {
        if (pageType() !== 'details') return;

        const title = document.querySelector('.itemName, .detailPagePrimaryContent h1, .detailPagePrimaryContainer h1');
        if (title) title.classList.add('va-detail-title');

        document.querySelectorAll('.mainDetailButtons button, .detailButton').forEach(button => {
            button.classList.add('va-detail-action');
        });

        document.querySelectorAll('.peopleItems .card, .castContent .card').forEach(card => card.classList.add('va-cast-card'));
        document.querySelectorAll('.childrenItemsContainer .card, .episodeCard').forEach(card => card.classList.add('va-episode-card'));
    }

    function decorateLibrary() {
        if (pageType() !== 'library') return;
        document.querySelectorAll('.card').forEach(card => card.classList.add('va-library-card'));

        const title = document.querySelector('.pageTitle, .sectionTitle:first-of-type, h1');
        if (title) title.classList.add('va-library-title');
    }

    function decorateLive() {
        if (pageType() !== 'live') return;
        document.querySelectorAll('.programCell, .guideProgram, .channelProgram').forEach(el => el.classList.add('va-live-program'));
        document.querySelectorAll('.recordingIndicator, .liveTvIndicator').forEach(el => el.classList.add('va-live-indicator'));
    }

    function cleanupViewerArtifacts() {
        if (isAdminRoute() || isPlaybackRoute()) {
            const nav = document.getElementById(IDS.nav);
            if (nav) nav.remove();
            PAGE_CLASSES.forEach(cls => document.body && document.body.classList.remove(cls));
            if (document.body) document.body.classList.remove('va-viewer');
        }
    }

    function renderAll() {
        setPageClass();
        cleanupViewerArtifacts();
        if (isAdminRoute() || isPlaybackRoute()) return;

        captureLibraryRoutes();
        mountGlobalNav();
        renderHome();
        mountSearchIntro();
        decorateSearchResults();
        mountDetailBrand();
        decorateDetails();
        decorateLibrary();
        decorateLive();
    }

    function scheduleRender(delay) {
        clearTimeout(renderTimer);
        renderTimer = setTimeout(renderAll, typeof delay === 'number' ? delay : 100);
    }

    function routeChanged() {
        const current = hash();
        if (current !== lastHash) {
            lastHash = current;
            removeHomeHero();
            const searchIntro = document.getElementById(IDS.searchIntro);
            if (searchIntro) searchIntro.remove();
            const detailBrand = document.getElementById(IDS.detailBrand);
            if (detailBrand) detailBrand.remove();
            document.body && document.body.classList.add('va-route-transition');
            setTimeout(function () {
                document.body && document.body.classList.remove('va-route-transition');
            }, 220);
        }
        scheduleRender(80);
    }

    function start() {
        lastHash = hash();
        window.addEventListener('hashchange', routeChanged);
        window.addEventListener('popstate', routeChanged);

        observer = new MutationObserver(function () {
            scheduleRender(90);
        });
        observer.observe(document.documentElement, { childList: true, subtree: true });

        renderAll();
        setTimeout(function () { scheduleRender(0); }, 350);
        setTimeout(function () { scheduleRender(0); }, 900);
        setTimeout(function () { scheduleRender(0); }, 1800);

        console.log('[Velvet Antenna] v' + VERSION + ' loaded');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start, { once: true });
    } else {
        start();
    }
})();
