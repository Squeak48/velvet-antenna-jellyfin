(function () {
    'use strict';

    const VERSION = '0.8.0';
    const HERO_ID = 'va-home-hero';
    const NAV_ID = 'va-home-nav';
    const HOME_CLASS = 'va-home-active';
    const CACHE_PREFIX = 'velvet-antenna:v080:hero:';

    let timer = null;
    let lastHash = '';

    function isHome() {
        const hash = window.location.hash || '';
        return hash === '#/home' || hash.startsWith('#/home?');
    }

    function text(el) {
        return el ? (el.textContent || '').trim() : '';
    }

    function titleOf(card) {
        if (!card) return '';
        for (const selector of ['.cardText-first', '.cardText', '.itemName', '[title]']) {
            const el = card.querySelector(selector);
            const value = el && ((el.textContent || el.getAttribute('title') || '') + '').trim();
            if (value) return value;
        }
        return (card.getAttribute('aria-label') || card.getAttribute('title') || '').trim();
    }

    function secondaryOf(card) {
        const values = card ? Array.from(card.querySelectorAll('.cardText')).map(text).filter(Boolean) : [];
        return values.length > 1 ? values.slice(1, 3).join('  •  ') : '';
    }

    function imageOf(card) {
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

    function itemIdOf(card) {
        if (!card) return '';
        const candidates = [card, card.querySelector('[data-id]'), card.querySelector('[data-itemid]'), card.closest('[data-id]'), card.closest('[data-itemid]')].filter(Boolean);
        for (const el of candidates) {
            const value = (el.dataset && (el.dataset.id || el.dataset.itemid || el.dataset.itemId)) || el.getAttribute('data-id') || el.getAttribute('data-itemid');
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

    function api() {
        return window.ApiClient || null;
    }

    function homeContainer() {
        return document.querySelector('.homeSectionsContainer') || document.querySelector('.libraryPage') || document.querySelector('.page.homePage') || document.querySelector('#indexPage');
    }

    function headingOf(section) {
        return text(section && section.querySelector('.sectionTitle-cards, .sectionTitle, h2, h3'));
    }

    function sectionMatching(regexes) {
        for (const heading of document.querySelectorAll('.sectionTitle-cards, .sectionTitle, h2, h3')) {
            if (!regexes.some(regex => regex.test(text(heading)))) continue;
            const section = heading.closest('.verticalSection') || (heading.parentElement && heading.parentElement.parentElement);
            if (section) return section;
        }
        return null;
    }

    function myMediaSection() {
        return sectionMatching([/^my media$/i]);
    }

    function libraryCard(regexes) {
        const section = myMediaSection();
        if (!section) return null;
        return Array.from(section.querySelectorAll('.card')).find(card => regexes.some(regex => regex.test(titleOf(card)))) || null;
    }

    function isLibraryTile(card) {
        const value = titleOf(card).trim().toLowerCase();
        if (!value) return true;
        if (['collections', 'movies', 'shows', 'series', 'anime', 'music', 'books', 'photos', 'live tv', 'livetv'].includes(value)) return true;
        const section = card.closest('.verticalSection');
        return Boolean(section && /^my media$/i.test(headingOf(section)));
    }

    function usableCard(card) {
        return Boolean(card && card.offsetParent !== null && !isLibraryTile(card) && (imageOf(card) || itemIdOf(card)));
    }

    function cardFromSection(regexes) {
        const section = sectionMatching(regexes);
        return section ? Array.from(section.querySelectorAll('.card')).find(usableCard) || null : null;
    }

    function featuredCard() {
        return cardFromSection([/continue watching/i, /resume/i]) ||
            cardFromSection([/next up/i]) ||
            cardFromSection([/recently added.*movies/i, /latest.*movies/i]) ||
            Array.from(document.querySelectorAll('.card')).find(card => !card.closest('#' + HERO_ID) && usableCard(card)) || null;
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
        const play = card && card.querySelector('.cardOverlayButton-play, [data-action="play"], .btnPlay');
        if (play && typeof play.click === 'function') return play.click();
        clickCard(card);
    }

    function navigateLibrary(kind) {
        const map = {
            movies: [/^movies$/i],
            series: [/^shows$/i, /^series$/i],
            anime: [/^anime$/i],
            collections: [/^collections$/i],
            live: [/^live tv$/i, /^livetv$/i, /^live$/i]
        };
        const card = libraryCard(map[kind] || []);
        if (card && clickCard(card)) return;
        if (kind === 'live') {
            const live = document.querySelector('a[href*="live" i], [data-role="livetv"]');
            if (live && typeof live.click === 'function') live.click();
        }
    }

    function stockButton(kind) {
        const selectors = kind === 'search'
            ? ['.headerSearchButton', '[aria-label="Search"]', '[title="Search"]']
            : ['.headerUserButton', '.headerUserButtonRound', '[aria-label*="profile" i]', '[title*="profile" i]'];
        return selectors.map(selector => document.querySelector(selector)).find(Boolean) || null;
    }

    function navButton(label, handler, active) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'va-nav__item' + (active ? ' va-nav__item--active' : '');
        button.textContent = label;
        button.addEventListener('click', handler);
        return button;
    }

    function createNav() {
        const nav = document.createElement('nav');
        nav.id = NAV_ID;
        nav.className = 'va-nav';
        nav.setAttribute('data-va-version', VERSION);
        nav.setAttribute('aria-label', 'Velvet Antenna navigation');

        const brand = document.createElement('button');
        brand.type = 'button';
        brand.className = 'va-nav__brand';
        brand.title = 'Velvet Antenna v' + VERSION;
        brand.innerHTML = '<span class="va-nav__mark" aria-hidden="true"></span><span class="va-nav__brand-text">VELVET ANTENNA</span>';
        brand.addEventListener('click', () => { window.location.hash = '#/home'; });

        const primary = document.createElement('div');
        primary.className = 'va-nav__primary';
        primary.appendChild(navButton('HOME', () => { window.location.hash = '#/home'; }, true));
        primary.appendChild(navButton('MOVIES', () => navigateLibrary('movies')));
        primary.appendChild(navButton('SERIES', () => navigateLibrary('series')));
        if (libraryCard([/^anime$/i])) primary.appendChild(navButton('ANIME', () => navigateLibrary('anime')));
        if (libraryCard([/^live tv$/i, /^livetv$/i, /^live$/i]) || document.querySelector('a[href*="live" i]')) primary.appendChild(navButton('LIVE', () => navigateLibrary('live')));
        primary.appendChild(navButton('COLLECTIONS', () => navigateLibrary('collections')));

        const utility = document.createElement('div');
        utility.className = 'va-nav__utility';
        utility.appendChild(navButton('SEARCH', () => { const el = stockButton('search'); if (el) el.click(); }));
        utility.appendChild(navButton('PROFILE', () => { const el = stockButton('profile'); if (el) el.click(); }));

        nav.append(brand, primary, utility);
        return nav;
    }

    function mountNav(container) {
        if (!document.getElementById(NAV_ID)) container.insertBefore(createNav(), container.firstChild);
    }

    function runtime(ticks) {
        if (!ticks || !Number.isFinite(Number(ticks))) return '';
        const minutes = Math.round(Number(ticks) / 600000000);
        if (minutes < 60) return minutes + ' min';
        const h = Math.floor(minutes / 60);
        const m = minutes % 60;
        return m ? h + 'h ' + m + 'm' : h + 'h';
    }

    function metaOf(item, fallback) {
        if (!item) return fallback || 'FEATURED';
        const parts = [];
        if (item.ProductionYear) parts.push(String(item.ProductionYear));
        const run = runtime(item.RunTimeTicks);
        if (run) parts.push(run);
        if (item.OfficialRating) parts.push(item.OfficialRating);
        if (item.CommunityRating) parts.push('★ ' + Number(item.CommunityRating).toFixed(1));
        return parts.join('  •  ') || fallback || 'FEATURED';
    }

    function imageUrl(client, id, type, tag) {
        try {
            if (client && typeof client.getImageUrl === 'function') {
                return client.getImageUrl(id, { type: type, index: 0, tag: tag, maxWidth: 1600, quality: 82 });
            }
        } catch (error) {
            console.debug('[Velvet Antenna] image URL failed', error);
        }
        return '';
    }

    function readCache(id) {
        if (!id) return null;
        try { return JSON.parse(sessionStorage.getItem(CACHE_PREFIX + id) || 'null'); } catch (error) { return null; }
    }

    function writeCache(id, value) {
        if (!id) return;
        try { sessionStorage.setItem(CACHE_PREFIX + id, JSON.stringify(value)); } catch (error) { /* non-critical */ }
    }

    function preload(hero, url) {
        if (!url) return;
        const image = new Image();
        image.decoding = 'async';
        image.onload = function () {
            if (!hero.isConnected) return;
            hero.style.setProperty('--va-hero-image', 'url("' + url.replace(/"/g, '%22') + '")');
            hero.classList.add('va-hero--backdrop-ready');
        };
        image.src = url;
    }

    async function enrichHero(hero, card) {
        const client = api();
        const id = itemIdOf(card);
        if (!client || !id) return;

        const cached = readCache(id);
        if (cached) {
            if (cached.title) hero.querySelector('.va-hero__title').textContent = cached.title;
            if (cached.meta) hero.querySelector('.va-hero__meta').textContent = cached.meta;
            if (cached.overview) hero.querySelector('.va-hero__copy').textContent = cached.overview;
            if (cached.backdrop) preload(hero, cached.backdrop);
        }

        try {
            if (typeof client.getItem !== 'function' || typeof client.getCurrentUserId !== 'function') return;
            const item = await client.getItem(client.getCurrentUserId(), id);
            if (!item || !hero.isConnected) return;

            const heroTitle = item.Name || titleOf(card) || 'Featured';
            const heroMeta = metaOf(item, secondaryOf(card));
            const overview = (item.Overview || '').trim();
            hero.querySelector('.va-hero__title').textContent = heroTitle;
            hero.querySelector('.va-hero__meta').textContent = heroMeta;
            if (overview) hero.querySelector('.va-hero__copy').textContent = overview;

            if (item.UserData && item.UserData.PlaybackPositionTicks > 0 && !item.UserData.Played) {
                const label = hero.querySelector('.va-button__label');
                if (label) label.textContent = 'CONTINUE';
            }

            let backdrop = '';
            if (item.BackdropImageTags && item.BackdropImageTags.length) {
                backdrop = imageUrl(client, item.Id || id, 'Backdrop', item.BackdropImageTags[0]);
            } else if (item.ParentBackdropItemId && item.ParentBackdropImageTags && item.ParentBackdropImageTags.length) {
                backdrop = imageUrl(client, item.ParentBackdropItemId, 'Backdrop', item.ParentBackdropImageTags[0]);
            }
            if (backdrop) preload(hero, backdrop);
            writeCache(id, { title: heroTitle, meta: heroMeta, overview: overview, backdrop: backdrop });
        } catch (error) {
            console.debug('[Velvet Antenna] metadata enrichment failed', error);
        }
    }

    function createHero(card) {
        const hero = document.createElement('section');
        hero.id = HERO_ID;
        hero.className = 'va-hero';
        hero.setAttribute('data-va-version', VERSION);
        hero.setAttribute('aria-label', 'Velvet Antenna featured title');

        const base = imageOf(card);
        if (base) hero.style.setProperty('--va-hero-image-base', 'url("' + base.replace(/"/g, '%22') + '")');

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
                    <button class="va-button va-button--secondary" type="button" data-va-action="details">MORE INFO</button>
                </div>
            </div>
            <div class="va-hero__signal" aria-hidden="true"><span></span><span></span><span></span></div>`;

        hero.querySelector('.va-hero__title').textContent = titleOf(card) || 'Featured';
        hero.querySelector('.va-hero__meta').textContent = secondaryOf(card) || 'FEATURED';
        hero.querySelector('[data-va-action="play"]').addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); playCard(card); });
        hero.querySelector('[data-va-action="details"]').addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); clickCard(card); });
        enrichHero(hero, card);
        return hero;
    }

    function mountHero(container) {
        if (document.getElementById(HERO_ID)) return;
        const card = featuredCard();
        if (!card) return;
        const hero = createHero(card);
        const nav = document.getElementById(NAV_ID);
        if (nav && nav.parentElement === container) nav.insertAdjacentElement('afterend', hero);
        else container.insertBefore(hero, container.firstChild);
        console.log('[Velvet Antenna] v' + VERSION + ' hero mounted from:', titleOf(card));
    }

    function polishSections(container) {
        const sections = Array.from(document.querySelectorAll('.verticalSection'));
        sections.forEach(section => {
            const heading = headingOf(section);
            section.classList.remove('va-row-landscape', 'va-row-posters', 'va-row-wide', 'va-row-hidden');

            if (/^my media$/i.test(heading)) section.classList.add('va-row-hidden');
            else if (/continue watching|resume|next up/i.test(heading)) section.classList.add('va-row-landscape');
            else if (/collection/i.test(heading)) section.classList.add('va-row-wide');
            else if (/recently added|latest|movies|shows|series|anime/i.test(heading)) section.classList.add('va-row-posters');

            if (/recently added.*shows/i.test(heading)) {
                const title = section.querySelector('.sectionTitle-cards, .sectionTitle, h2, h3');
                if (title && text(title) !== 'Recently Added Series') title.textContent = 'Recently Added Series';
            }
        });

        if (!container) return;
        const current = Array.from(container.children).filter(el => el.classList && el.classList.contains('verticalSection'));
        const rank = section => {
            const heading = headingOf(section).toLowerCase();
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
        const sorted = current.slice().sort((a, b) => rank(a) - rank(b));
        if (sorted.some((section, index) => section !== current[index])) sorted.forEach(section => container.appendChild(section));
    }

    function clearHome() {
        document.body.classList.remove(HOME_CLASS);
        const nav = document.getElementById(NAV_ID);
        const hero = document.getElementById(HERO_ID);
        if (nav) nav.remove();
        if (hero) hero.remove();
    }

    function render() {
        document.documentElement.setAttribute('data-velvet-antenna-version', VERSION);
        if (!isHome()) return clearHome();
        const container = homeContainer();
        if (!container) return;
        document.body.classList.add(HOME_CLASS);
        mountNav(container);
        mountHero(container);
        polishSections(container);
    }

    function schedule(delay) {
        clearTimeout(timer);
        timer = setTimeout(render, typeof delay === 'number' ? delay : 140);
    }

    function routeChanged() {
        if (lastHash !== window.location.hash) {
            lastHash = window.location.hash;
            clearHome();
        }
        schedule(120);
    }

    function start() {
        lastHash = window.location.hash;
        window.addEventListener('hashchange', routeChanged);
        window.addEventListener('popstate', routeChanged);
        new MutationObserver(() => schedule(160)).observe(document.documentElement, { childList: true, subtree: true });
        schedule(20);
        setTimeout(() => schedule(0), 450);
        setTimeout(() => schedule(0), 1100);
        setTimeout(() => schedule(0), 2200);
        console.log('[Velvet Antenna] v' + VERSION + ' loaded');
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
    else start();
})();
