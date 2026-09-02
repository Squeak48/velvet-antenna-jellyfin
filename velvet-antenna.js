(function () {
    'use strict';

    const VERSION = '0.6.3';
    const HERO_ID = 'va-home-hero';
    let timer = null;
    let lastHash = '';

    function isHomePage() {
        const hash = window.location.hash || '';
        return hash === '#/home' || hash.startsWith('#/home?');
    }

    function text(el) {
        return el ? (el.textContent || '').trim() : '';
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
        const values = Array.from(card.querySelectorAll('.cardText'))
            .map(text)
            .filter(Boolean);
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

    function isLibraryTile(card) {
        const title = getTitle(card).toLowerCase().trim();
        if (!title) return true;

        const blocked = new Set([
            'collections',
            'movies',
            'shows',
            'series',
            'anime',
            'music',
            'books',
            'photos',
            'livetv',
            'live tv'
        ]);

        if (blocked.has(title)) return true;

        const section = card.closest('.verticalSection, .section0, .section1, .section2, .section3, .section4, .section5');
        if (section) {
            const heading = section.querySelector('.sectionTitle-cards, .sectionTitle, h2, h3');
            if (/^my media$/i.test(text(heading))) return true;
        }

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

    function findBySectionHeading(regexes) {
        const headings = Array.from(document.querySelectorAll('.sectionTitle-cards, .sectionTitle, h2, h3'));

        for (const regex of regexes) {
            const heading = headings.find(el => regex.test(text(el)));
            if (!heading) continue;

            const section = heading.closest('.verticalSection') || heading.parentElement && heading.parentElement.parentElement;
            if (!section) continue;

            const card = Array.from(section.querySelectorAll('.card')).find(candidate => {
                return candidate.offsetParent !== null && !isLibraryTile(candidate) && Boolean(getImage(candidate) || getItemId(candidate));
            });

            if (card) return card;
        }

        return null;
    }

    function findFeaturedCard() {
        return (
            findBySectionHeading([/continue watching/i, /resume/i]) ||
            findBySectionHeading([/next up/i]) ||
            findBySectionHeading([/recently added.*movies/i, /latest.*movies/i]) ||
            visibleCards()[0] ||
            null
        );
    }

    function findHomeContainer() {
        return document.querySelector('.homeSectionsContainer') ||
               document.querySelector('.libraryPage') ||
               document.querySelector('.page.homePage') ||
               document.querySelector('#indexPage');
    }

    function getApiClient() {
        return window.ApiClient || null;
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

    function imageUrl(api, itemId, type, tag) {
        try {
            if (api && typeof api.getImageUrl === 'function') {
                return api.getImageUrl(itemId, {
                    type: type,
                    index: 0,
                    tag: tag,
                    maxWidth: 1920,
                    quality: 90
                });
            }
        } catch (error) {
            console.debug('[Velvet Antenna] image URL fallback', error);
        }
        return '';
    }

    async function enrichHero(hero, card) {
        const api = getApiClient();
        const itemId = getItemId(card);
        if (!api || !itemId) return;

        try {
            if (typeof api.getItem !== 'function' || typeof api.getCurrentUserId !== 'function') return;
            const item = await api.getItem(api.getCurrentUserId(), itemId);
            if (!item || !hero.isConnected) return;

            if (item.Name) hero.querySelector('.va-hero__title').textContent = item.Name;
            hero.querySelector('.va-hero__meta').textContent = buildMeta(item, getSecondary(card));

            if (item.Overview) {
                hero.querySelector('.va-hero__copy').textContent = item.Overview.trim();
            }

            let backdrop = '';
            if (Array.isArray(item.BackdropImageTags) && item.BackdropImageTags.length) {
                backdrop = imageUrl(api, item.Id || itemId, 'Backdrop', item.BackdropImageTags[0]);
            } else if (item.ParentBackdropItemId && Array.isArray(item.ParentBackdropImageTags) && item.ParentBackdropImageTags.length) {
                backdrop = imageUrl(api, item.ParentBackdropItemId, 'Backdrop', item.ParentBackdropImageTags[0]);
            }

            if (backdrop) {
                hero.style.setProperty('--va-hero-image', 'url("' + backdrop.replace(/"/g, '%22') + '")');
                hero.classList.add('va-hero--has-art');
            }
        } catch (error) {
            console.debug('[Velvet Antenna] hero metadata enrichment failed', error);
        }
    }

    function clickCard(card) {
        if (!card) return;
        const target = card.querySelector('a[href], .cardContent') || card;
        if (target && typeof target.click === 'function') target.click();
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

    function createHero(card) {
        const hero = document.createElement('section');
        hero.id = HERO_ID;
        hero.className = 'va-hero';
        hero.setAttribute('data-va-version', VERSION);
        hero.setAttribute('aria-label', 'Velvet Antenna featured title');

        const fallbackImage = getImage(card);
        if (fallbackImage) {
            hero.style.setProperty('--va-hero-image', 'url("' + fallbackImage.replace(/"/g, '%22') + '")');
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
                    <button class="va-button va-button--primary" type="button" data-va-action="play"><span class="va-button__icon">▶</span><span>PLAY</span></button>
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

    function removeHero() {
        const hero = document.getElementById(HERO_ID);
        if (hero) hero.remove();
    }

    function renderHero() {
        if (!isHomePage()) {
            removeHero();
            return;
        }

        if (document.getElementById(HERO_ID)) return;

        const container = findHomeContainer();
        const card = findFeaturedCard();
        if (!container || !card) {
            console.debug('[Velvet Antenna] v' + VERSION + ' waiting for usable home media card');
            return;
        }

        const hero = createHero(card);
        container.insertBefore(hero, container.firstChild);
        console.log('[Velvet Antenna] v' + VERSION + ' hero mounted from:', getTitle(card));
    }

    function schedule(delay) {
        clearTimeout(timer);
        timer = setTimeout(renderHero, typeof delay === 'number' ? delay : 120);
    }

    function routeChanged() {
        if (lastHash !== window.location.hash) {
            lastHash = window.location.hash;
            removeHero();
        }
        schedule(160);
    }

    function start() {
        lastHash = window.location.hash;
        window.addEventListener('hashchange', routeChanged);
        window.addEventListener('popstate', routeChanged);

        new MutationObserver(function () {
            schedule(120);
        }).observe(document.documentElement, { childList: true, subtree: true });

        schedule(20);
        setTimeout(function () { schedule(0); }, 500);
        setTimeout(function () { schedule(0); }, 1200);
        setTimeout(function () { schedule(0); }, 2500);

        console.log('[Velvet Antenna] v' + VERSION + ' loaded');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start, { once: true });
    } else {
        start();
    }
})();
