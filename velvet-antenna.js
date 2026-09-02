(function () {
    'use strict';

    const VERSION = '0.8.0';
    const HERO_ID = 'va-home-hero';
    const NAV_ID = 'va-home-nav';
    const HOME_CLASS = 'va-home-active';
    const CACHE_PREFIX = 'velvet-antenna:hero:';

    let timer = null;
    let lastHash = '';
    let observer = null;

    function isHomePage() {
        const hash = window.location.hash || '';
        return hash === '#/home' || hash.startsWith('#/home?');
    }

    function text(el) {
        return el ? (el.textContent || '').trim() : '';
    }

    function normalise(value) {
        return (value || '').trim().toLowerCase();
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

    function getApiClient() {
        return window.ApiClient || null;
    }

    function findHomeContainer() {
        return document.querySelector('.homeSectionsContainer') ||
               document.querySelector('.libraryPage') ||
               document.querySelector('.page.homePage') ||
               document.querySelector('#indexPage');
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

    function isLibraryTile(card) {
        const title = normalise(getTitle(card));
        if (!title) return true;

        const blocked = new Set([
            'collections', 'movies', 'shows', 'series', 'anime', 'music', 'books', 'photos', 'livetv', 'live tv'
        ]);
        if (blocked.has(title)) return true;

        const section = card.closest('.verticalSection');
        if (section && /^my media$/i.test(sectionHeading(section))) return true;

        return false;
    }

    function visibleCards() {
        return Array.from(document.querySelectorAll('.card')).filter(card => {
            if (card.closest('#' + HERO_ID)) return false;
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

    function findMyMediaSection() {
        return findSectionByHeading([/^my media$/i]);
    }

    function findLibraryCard(names) {
        const section = findMyMediaSection();
        const cards = Array.from((section || document).querySelectorAll('.card'));
        return cards.find(card => names.some(name => name.test(getTitle(card)))) || null;
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
        const play = card.querySelector('.cardOverlayButton-play, [data-action="play"], .btnPlay');
        if (play && typeof play.click === 'function') {
            play.click();
            return;
        }
        clickCard(card);
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
        const el = findStockButton(kind);
        if (el && typeof el.click === 'function') el.click();
    }

    function navigateLibrary(kind) {
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
            const live = document.querySelector('a[href*="live" i], [data-role="livetv"]');
            if (live && typeof live.click === 'function') live.click();
        }
    }

    function createNavButton(label, action, active) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'va-nav__item' + (active ? ' va-nav__item--active' : '');
        button.textContent = label;
        button.addEventListener('click', action);
        return button;
    }

    function createNav() {
        const nav = document.createElement('nav');
        nav.id = NAV_ID;
        nav.className = 'va-nav';
        nav.setAttribute('aria-label', 'Velvet Antenna navigation');
        nav.setAttribute('data-va-version', VERSION);

        const brand = document.createElement('button');
        brand.type = 'button';
        brand.className = 'va-nav__brand';
        brand.setAttribute('title', 'Velvet Antenna v' + VERSION);
        brand.innerHTML = '<span class="va-nav__mark" aria-hidden="true"></span><span class="va-nav__brand-text">VELVET ANTENNA</span>';
        brand.addEventListener('click', function () { window.location.hash = '#/home'; });

        const primary = document.createElement('div');
        primary.className = 'va-nav__primary';
        primary.appendChild(createNavButton('HOME', function () { window.location.hash = '#/home'; }, true));
        primary.appendChild(createNavButton('MOVIES', function () { navigateLibrary('movies'); }));
        primary.appendChild(createNavButton('SERIES', function () { navigateLibrary('series'); }));

        if (findLibraryCard([/^anime$/i])) {
            primary.appendChild(createNavButton('ANIME', function () { navigateLibrary('anime'); }));
        }

        if (findLibraryCard([/^live tv$/i, /^livetv$/i, /^live$/i]) || document.querySelector('a[href*="live" i]')) {
            primary.appendChild(createNavButton('LIVE', function () { navigateLibrary('live'); }));
        }

        primary.appendChild(createNavButton('COLLECTIONS', function () { navigateLibrary('collections'); }));

        const utility = document.createElement('div');
        utility.className = 'va-nav__utility';
        utility.appendChild(createNavButton('SEARCH', function () { openUtility('search'); }));
        utility.appendChild(createNavButton('PROFILE', function () { openUtility('profile'); }));

        nav.appendChild(brand);
        nav.appendChild(primary);
        nav.appendChild(utility);
        return nav;
    }

    function mountNav(container) {
        if (!container || document.getElementById(NAV_ID)) return;
        const nav = createNav();
        container.insertBefore(nav, container.firstChild);
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

    function cacheKey(itemId) {
        return CACHE_PREFIX + itemId;
    }

    function readHeroCache(itemId) {
        if (!itemId) return null;
        try {
            const raw = sessionStorage.getItem(cacheKey(itemId));
            return raw ? JSON.parse(raw) : null;
        } catch (error) {
            return null;
        }
    }

    function writeHeroCache(itemId, value) {
        if (!itemId || !value) return;
        try {
            sessionStorage.setItem(cacheKey(itemId), JSON.stringify(value));
        } catch (error) {
            // Cache failure should never block the UI.
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
        hero.id = HERO_ID;
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
            <div class="va-hero__signal" aria-hidden="true"><span></span><span></span><span></span></div>
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

    function mountHero(container) {
        if (!container || document.getElementById(HERO_ID)) return;

        const card = findFeaturedCard();
        if (!card) return;

        const hero = createHero(card);
        const nav = document.getElementById(NAV_ID);
        if (nav && nav.parentElement === container) {
            nav.insertAdjacentElement('afterend', hero);
        } else {
            container.insertBefore(hero, container.firstChild);
        }

        console.log('[Velvet Antenna] v' + VERSION + ' hero mounted from:', getTitle(card));
    }

    function classifyAndPolishSections(container) {
        const sections = Array.from(document.querySelectorAll('.verticalSection'));

        sections.forEach(section => {
            const heading = sectionHeading(section);
            const label = normalise(heading);

            section.classList.remove('va-row-landscape', 'va-row-posters', 'va-row-wide', 'va-row-hidden');

            if (/^my media$/i.test(heading)) {
                section.classList.add('va-row-hidden');
                return;
            }

            if (/continue watching|resume|next up/i.test(heading)) {
                section.classList.add('va-row-landscape');
            } else if (/collection/i.test(heading)) {
                section.classList.add('va-row-wide');
            } else if (/recently added|latest|movies|shows|series|anime/i.test(heading)) {
                section.classList.add('va-row-posters');
            }

            if (/recently added in shows/i.test(label) || /recently added.*shows/i.test(label)) {
                const titleEl = section.querySelector('.sectionTitle-cards, .sectionTitle, h2, h3');
                if (titleEl) titleEl.textContent = 'Recently Added Series';
            }
        });

        if (!container) return;

        const directSections = Array.from(container.children).filter(el => el.classList && el.classList.contains('verticalSection'));
        const rank = function (section) {
            const heading = normalise(sectionHeading(section));
            if (/^my media$/.test(heading)) return 0;
            if (/continue watching|resume/.test(heading)) return 10;
            if (/next up/.test(heading)) return 20;
            if (/recently added.*movies|latest.*movies/.test(heading)) return 30;
            if (/recently added.*shows|recently added.*series|latest.*series/.test(heading)) return 40;
            if (/collection/.test(heading)) return 50;
            if (/anime/.test(heading)) return 60;
            if (/live now|live tv/.test(heading)) return 70;
            if (/recording/.test(heading)) return 80;
            return 90;
        };

        directSections.sort((a, b) => rank(a) - rank(b)).forEach(section => container.appendChild(section));
    }

    function removeHomeChrome() {
        document.body.classList.remove(HOME_CLASS);
        const nav = document.getElementById(NAV_ID);
        const hero = document.getElementById(HERO_ID);
        if (nav) nav.remove();
        if (hero) hero.remove();
    }

    function renderHome() {
        document.documentElement.setAttribute('data-velvet-antenna-version', VERSION);

        if (!isHomePage()) {
            removeHomeChrome();
            return;
        }

        const container = findHomeContainer();
        if (!container) return;

        document.body.classList.add(HOME_CLASS);
        mountNav(container);
        mountHero(container);
        classifyAndPolishSections(container);
    }

    function schedule(delay) {
        clearTimeout(timer);
        timer = setTimeout(renderHome, typeof delay === 'number' ? delay : 140);
    }

    function routeChanged() {
        if (lastHash !== window.location.hash) {
            lastHash = window.location.hash;
            removeHomeChrome();
        }
        schedule(120);
    }

    function start() {
        lastHash = window.location.hash;
        window.addEventListener('hashchange', routeChanged);
        window.addEventListener('popstate', routeChanged);

        observer = new MutationObserver(function () {
            schedule(160);
        });
        observer.observe(document.documentElement, { childList: true, subtree: true });

        schedule(20);
        setTimeout(function () { schedule(0); }, 450);
        setTimeout(function () { schedule(0); }, 1100);
        setTimeout(function () { schedule(0); }, 2200);

        console.log('[Velvet Antenna] v' + VERSION + ' loaded');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start, { once: true });
    } else {
        start();
    }
})();
