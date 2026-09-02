(function () {
    'use strict';

    const VA = {
        heroId: 'va-home-hero',
        refreshTimer: null,
        observer: null,
        currentHash: ''
    };

    function isHomePage() {
        const hash = window.location.hash || '';
        return hash === '#/home' || hash.startsWith('#/home?');
    }

    function textOf(el) {
        return el && (el.textContent || '').trim();
    }

    function getCardTitle(card) {
        if (!card) return 'Featured';

        const selectors = [
            '.cardText-first',
            '.cardText',
            '.itemName',
            '[title]'
        ];

        for (const selector of selectors) {
            const el = card.querySelector(selector);
            const text = el && ((el.textContent || el.getAttribute('title') || '').trim());
            if (text) return text;
        }

        return (card.getAttribute('aria-label') || card.getAttribute('title') || 'Featured').trim();
    }

    function getCardSecondary(card) {
        if (!card) return '';

        const texts = Array.from(card.querySelectorAll('.cardText'))
            .map(textOf)
            .filter(Boolean);

        return texts.length > 1 ? texts.slice(1, 3).join('  •  ') : '';
    }

    function getCardImage(card) {
        if (!card) return '';

        const img = card.querySelector('img');
        if (img && img.src) return img.src;

        const imageEl = card.querySelector('.cardImage, .cardImageContainer, .cardContent');
        if (imageEl) {
            const bg = window.getComputedStyle(imageEl).backgroundImage;
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

    function getServerBase() {
        const api = getApiClient();
        try {
            if (api && typeof api.serverAddress === 'function') {
                return api.serverAddress().replace(/\/$/, '');
            }
        } catch (error) {
            console.debug('[Velvet Antenna] Could not read server address', error);
        }

        return window.location.origin;
    }

    function apiImageUrl(itemId, type, options) {
        const api = getApiClient();
        const settings = Object.assign({
            type: type,
            maxWidth: 1920,
            quality: 90
        }, options || {});

        try {
            if (api && typeof api.getImageUrl === 'function') {
                return api.getImageUrl(itemId, settings);
            }
        } catch (error) {
            console.debug('[Velvet Antenna] ApiClient image URL failed', error);
        }

        const index = typeof settings.index === 'number' ? settings.index : 0;
        return `${getServerBase()}/Items/${encodeURIComponent(itemId)}/Images/${encodeURIComponent(type)}/${index}?maxWidth=${settings.maxWidth || 1920}&quality=${settings.quality || 90}`;
    }

    function findSectionByHeading(patterns) {
        const sections = Array.from(document.querySelectorAll('.verticalSection'));

        for (const pattern of patterns) {
            const section = sections.find(el => {
                const heading = el.querySelector('.sectionTitle-cards, .sectionTitle, h2, h3');
                const label = textOf(heading).toLowerCase();
                return label && pattern.test(label);
            });

            if (section) return section;
        }

        return null;
    }

    function firstRealCard(section) {
        if (!section) return null;

        const cards = Array.from(section.querySelectorAll('.card')).filter(card => {
            if (card.closest(`#${VA.heroId}`)) return false;
            if (card.offsetParent === null) return false;

            const title = getCardTitle(card).toLowerCase();
            if (!title) return false;
            if (['collections', 'movies', 'shows', 'series', 'anime'].includes(title)) return false;

            return Boolean(getItemId(card) || getCardImage(card));
        });

        return cards[0] || null;
    }

    function findFeaturedCard() {
        const priorities = [
            [/continue watching/i, /resume/i],
            [/next up/i],
            [/recently added.*movies/i, /latest.*movies/i],
            [/recently added.*shows/i, /recently added.*series/i],
            [/recently added/i]
        ];

        for (const patterns of priorities) {
            const card = firstRealCard(findSectionByHeading(patterns));
            if (card) return card;
        }

        const fallback = Array.from(document.querySelectorAll('.homeSectionsContainer .card, .libraryPage .card'))
            .find(card => {
                if (card.offsetParent === null || card.closest(`#${VA.heroId}`)) return false;
                const title = getCardTitle(card).toLowerCase();
                if (['collections', 'movies', 'shows', 'series', 'anime'].includes(title)) return false;
                return Boolean(getItemId(card));
            });

        return fallback || null;
    }

    function findHomeContainer() {
        const selectors = [
            '.homeSectionsContainer',
            '.libraryPage',
            '.page.homePage',
            '#indexPage'
        ];

        for (const selector of selectors) {
            const el = document.querySelector(selector);
            if (el) return el;
        }

        return null;
    }

    function openDetails(card) {
        if (!card) return;
        const clickable = card.querySelector('a[href], .cardContent') || card;
        if (clickable && typeof clickable.click === 'function') clickable.click();
    }

    function playCard(card) {
        if (!card) return;

        const playButton = card.querySelector('.cardOverlayButton-play, [data-action="play"], .btnPlay');
        if (playButton && typeof playButton.click === 'function') {
            playButton.click();
            return;
        }

        openDetails(card);
    }

    function removeHero() {
        const existing = document.getElementById(VA.heroId);
        if (existing) existing.remove();
    }

    function formatRuntime(ticks) {
        if (!ticks || !Number.isFinite(Number(ticks))) return '';
        const minutes = Math.round(Number(ticks) / 600000000);
        if (minutes < 60) return `${minutes} min`;
        const hours = Math.floor(minutes / 60);
        const rest = minutes % 60;
        return rest ? `${hours}h ${rest}m` : `${hours}h`;
    }

    function createMeta(item, fallback) {
        if (!item) return fallback || 'FEATURED';

        const parts = [];
        if (item.ProductionYear) parts.push(String(item.ProductionYear));
        const runtime = formatRuntime(item.RunTimeTicks);
        if (runtime) parts.push(runtime);
        if (item.OfficialRating) parts.push(item.OfficialRating);
        if (item.CommunityRating) parts.push(`★ ${Number(item.CommunityRating).toFixed(1)}`);

        return parts.join('  •  ') || fallback || 'FEATURED';
    }

    async function enrichHero(hero, card) {
        const itemId = getItemId(card);
        const api = getApiClient();
        if (!itemId || !api) return;

        try {
            let item = null;
            if (typeof api.getItem === 'function' && typeof api.getCurrentUserId === 'function') {
                item = await api.getItem(api.getCurrentUserId(), itemId);
            }

            if (!item || !hero.isConnected) return;

            if (item.Name) hero.querySelector('.va-hero__title').textContent = item.Name;
            hero.querySelector('.va-hero__meta').textContent = createMeta(item, getCardSecondary(card));

            const overview = (item.Overview || '').trim();
            if (overview) hero.querySelector('.va-hero__copy').textContent = overview;

            let backdropUrl = '';
            if (Array.isArray(item.BackdropImageTags) && item.BackdropImageTags.length) {
                backdropUrl = apiImageUrl(item.Id || itemId, 'Backdrop', {
                    index: 0,
                    tag: item.BackdropImageTags[0],
                    maxWidth: 1920,
                    quality: 90
                });
            } else if (item.ParentBackdropItemId && Array.isArray(item.ParentBackdropImageTags) && item.ParentBackdropImageTags.length) {
                backdropUrl = apiImageUrl(item.ParentBackdropItemId, 'Backdrop', {
                    index: 0,
                    tag: item.ParentBackdropImageTags[0],
                    maxWidth: 1920,
                    quality: 90
                });
            }

            if (!backdropUrl) {
                backdropUrl = apiImageUrl(item.Id || itemId, 'Backdrop', {
                    index: 0,
                    maxWidth: 1920,
                    quality: 90
                });
            }

            if (backdropUrl) {
                hero.style.setProperty('--va-hero-image', `url("${backdropUrl.replace(/"/g, '%22')}")`);
                hero.classList.add('va-hero--has-art');
            }
        } catch (error) {
            console.debug('[Velvet Antenna] Could not enrich hero metadata', error);
        }
    }

    function createHero(card) {
        const hero = document.createElement('section');
        hero.id = VA.heroId;
        hero.className = 'va-hero';
        hero.setAttribute('aria-label', 'Velvet Antenna featured title');

        const title = getCardTitle(card);
        const secondary = getCardSecondary(card);
        const fallbackImage = getCardImage(card);

        if (fallbackImage) {
            hero.style.setProperty('--va-hero-image', `url("${fallbackImage.replace(/"/g, '%22')}")`);
            hero.classList.add('va-hero--has-art');
        }

        hero.innerHTML = `
            <div class="va-hero__art" aria-hidden="true"></div>
            <div class="va-hero__shade" aria-hidden="true"></div>
            <div class="va-hero__content">
                <div class="va-hero__eyebrow">VELVET ANTENNA</div>
                <h1 class="va-hero__title"></h1>
                <div class="va-hero__meta"></div>
                <p class="va-hero__copy">Featured from your library.</p>
                <div class="va-hero__actions">
                    <button class="va-button va-button--primary" type="button" data-va-action="play">
                        <span class="va-button__icon">▶</span>
                        <span>PLAY</span>
                    </button>
                    <button class="va-button va-button--secondary" type="button" data-va-action="details">
                        <span>MORE INFO</span>
                    </button>
                </div>
            </div>
        `;

        hero.querySelector('.va-hero__title').textContent = title;
        hero.querySelector('.va-hero__meta').textContent = secondary || 'FEATURED';

        hero.querySelector('[data-va-action="play"]').addEventListener('click', function (event) {
            event.preventDefault();
            event.stopPropagation();
            playCard(card);
        });

        hero.querySelector('[data-va-action="details"]').addEventListener('click', function (event) {
            event.preventDefault();
            event.stopPropagation();
            openDetails(card);
        });

        enrichHero(hero, card);
        return hero;
    }

    function renderHomeHero() {
        if (!isHomePage()) {
            removeHero();
            return;
        }

        if (document.getElementById(VA.heroId)) return;

        const container = findHomeContainer();
        const card = findFeaturedCard();
        if (!container || !card) return;

        const hero = createHero(card);
        container.insertBefore(hero, container.firstChild);
        console.log('[Velvet Antenna] v0.6.1 home hero mounted from:', getCardTitle(card));
    }

    function scheduleRender(delay) {
        window.clearTimeout(VA.refreshTimer);
        VA.refreshTimer = window.setTimeout(renderHomeHero, typeof delay === 'number' ? delay : 120);
    }

    function handleRouteChange() {
        if (VA.currentHash !== window.location.hash) {
            VA.currentHash = window.location.hash;
            removeHero();
        }
        scheduleRender(200);
    }

    function start() {
        VA.currentHash = window.location.hash;
        window.addEventListener('hashchange', handleRouteChange);
        window.addEventListener('popstate', handleRouteChange);

        VA.observer = new MutationObserver(function () {
            scheduleRender(140);
        });

        VA.observer.observe(document.documentElement, {
            childList: true,
            subtree: true
        });

        scheduleRender(50);
        window.setTimeout(function () { scheduleRender(0); }, 750);
        window.setTimeout(function () { scheduleRender(0); }, 1800);

        console.log('[Velvet Antenna] v0.6.1 loaded');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start, { once: true });
    } else {
        start();
    }
})();
