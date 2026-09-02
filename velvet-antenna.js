(function () {
    'use strict';

    const VA = {
        heroId: 'va-home-hero',
        styleMarker: 'velvet-antenna',
        refreshTimer: null,
        observer: null,
        currentHash: ''
    };

    function isHomePage() {
        const hash = window.location.hash || '';
        return hash === '#/home' || hash.startsWith('#/home?');
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
            const text = el && (el.textContent || el.getAttribute('title'));
            if (text && text.trim()) return text.trim();
        }

        return (card.getAttribute('aria-label') || card.getAttribute('title') || 'Featured').trim();
    }

    function getCardSecondary(card) {
        if (!card) return '';

        const texts = Array.from(card.querySelectorAll('.cardText'))
            .map(el => (el.textContent || '').trim())
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

        const direct = card.dataset && (card.dataset.id || card.dataset.itemid || card.dataset.itemId);
        if (direct) return direct;

        const dataId = card.getAttribute('data-id') || card.getAttribute('data-itemid');
        if (dataId) return dataId;

        const link = card.closest('a[href]') || card.querySelector('a[href]');
        const href = link && link.getAttribute('href');
        if (href) {
            const match = href.match(/[?&]id=([^&]+)/i) || href.match(/details\?id=([^&]+)/i);
            if (match && match[1]) return decodeURIComponent(match[1]);
        }

        return '';
    }

    function getServerBase() {
        try {
            if (window.ApiClient && typeof window.ApiClient.serverAddress === 'function') {
                return window.ApiClient.serverAddress().replace(/\/$/, '');
            }
        } catch (e) {
            console.debug('[Velvet Antenna] Could not read ApiClient server address', e);
        }

        return window.location.origin;
    }

    function buildBackdropUrl(card) {
        const itemId = getItemId(card);
        if (itemId) {
            return `${getServerBase()}/Items/${encodeURIComponent(itemId)}/Images/Backdrop/0?fillWidth=1920&quality=90`;
        }

        return getCardImage(card);
    }

    function findFeaturedCard() {
        const preferredSelectors = [
            '.resumeSection .card',
            '.continueWatchingSection .card',
            '.nextUpSection .card',
            '.homeSectionsContainer .verticalSection .card',
            '.homeSectionsContainer .card',
            '.libraryPage .card'
        ];

        for (const selector of preferredSelectors) {
            const cards = Array.from(document.querySelectorAll(selector));
            const card = cards.find(el => !el.closest(`#${VA.heroId}`) && el.offsetParent !== null);
            if (card) return card;
        }

        return null;
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

    function createHero(card) {
        const hero = document.createElement('section');
        hero.id = VA.heroId;
        hero.className = 'va-hero';
        hero.setAttribute('aria-label', 'Velvet Antenna featured title');

        const backdrop = buildBackdropUrl(card);
        const title = getCardTitle(card);
        const secondary = getCardSecondary(card);

        if (backdrop) {
            hero.style.setProperty('--va-hero-image', `url("${backdrop.replace(/"/g, '%22')}")`);
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
        const meta = hero.querySelector('.va-hero__meta');
        meta.textContent = secondary || 'FEATURED';

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
        console.log('[Velvet Antenna] v0.6 home hero mounted');
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

        console.log('[Velvet Antenna] v0.6 loaded');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start, { once: true });
    } else {
        start();
    }
})();
