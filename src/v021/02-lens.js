    function heroPool() {
        const resume = visibleMediaCards(findSection([/continue watching/i, /resume/i]));
        if (resume.length) return { cards: resume.slice(0, 8), source: 'CONTINUE WATCHING' };
        const next = visibleMediaCards(findSection([/next up/i]));
        if (next.length) return { cards: next.slice(0, 8), source: 'NEXT UP' };
        const movies = visibleMediaCards(findSection([/recently added.*movies/i, /latest.*movies/i]));
        if (movies.length) return { cards: movies.slice(0, 8), source: 'FEATURED FOR YOU' };
        const series = visibleMediaCards(findSection([/recently added.*series/i, /recently added.*shows/i]));
        if (series.length) return { cards: series.slice(0, 8), source: 'FEATURED FOR YOU' };
        return { cards: [], source: 'FEATURED FOR YOU' };
    }

    function heroSignature(pool) {
        return pool.cards.map(card => cardItemId(card) || cardTitle(card)).filter(Boolean).join('|');
    }

    function resetHero() {
        if (STATE.heroTimer) window.clearTimeout(STATE.heroTimer);
        STATE.heroTimer = null;
        STATE.heroStarted = 0;
        STATE.heroSignature = '';
        STATE.heroSignatureSince = 0;
        STATE.heroLock = null;
        STATE.heroToken += 1;
        document.getElementById(IDS.hero)?.remove();
    }

    function maybeStartHero() {
        if (pageKind() !== 'home' || STATE.heroLock || STATE.heroTimer) return;
        if (!STATE.heroStarted) STATE.heroStarted = Date.now();
        STATE.heroTimer = window.setTimeout(sampleHero, 180);
    }

    function sampleHero() {
        STATE.heroTimer = null;
        if (pageKind() !== 'home' || STATE.heroLock) return;
        const pool = heroPool();
        const signature = heroSignature(pool);
        const now = Date.now();

        if (!signature) {
            if (now - STATE.heroStarted < HERO_SETTLE_MAX_MS) {
                STATE.heroTimer = window.setTimeout(sampleHero, 240);
            }
            return;
        }

        if (signature !== STATE.heroSignature) {
            STATE.heroSignature = signature;
            STATE.heroSignatureSince = now;
        }

        if (now - STATE.heroSignatureSince >= HERO_SETTLE_STABLE_MS ||
            now - STATE.heroStarted >= HERO_SETTLE_MAX_MS) {
            lockHero(pool);
            return;
        }

        STATE.heroTimer = window.setTimeout(sampleHero, 180);
    }

    function lockHero(pool) {
        if (!pool.cards.length || STATE.heroLock) return;
        const card = pool.cards[0];
        const id = cardItemId(card);
        if (!id) return;

        STATE.heroLock = {
            id,
            title: cardTitle(card) || 'Featured',
            meta: cardSecondary(card),
            source: pool.source,
            fallbackImage: cardImage(card),
            type: cardType(card)
        };
        mountHero();
        enrichHero(STATE.heroLock);
    }

    function homeContainer() {
        return document.querySelector('.homeSectionsContainer') ||
            document.querySelector('.page.homePage') ||
            document.querySelector('#indexPage') ||
            document.querySelector('.libraryPage');
    }

    function createHero(lock) {
        const hero = document.createElement('section');
        hero.id = IDS.hero;
        hero.className = 'va21-hero';
        hero.setAttribute('data-item-id', lock.id);
        hero.innerHTML = `
            <div class="va21-hero__signal" aria-hidden="true"><i></i><i></i><i></i></div>
            <div class="va21-hero__art va21-hero__art--fallback" aria-hidden="true"></div>
            <div class="va21-hero__art va21-hero__art--backdrop" aria-hidden="true"></div>
            <div class="va21-hero__shade" aria-hidden="true"></div>
            <div class="va21-hero__content">
                <div class="va21-kicker"><span>VA / SIGNAL 01</span><b class="va21-hero__eyebrow"></b></div>
                <h1 class="va21-hero__title"></h1>
                <div class="va21-hero__meta"></div>
                <p class="va21-hero__overview">Featured from your library.</p>
                <div class="va21-hero__progress" hidden><span></span><div><i></i></div></div>
                <div class="va21-hero__actions">
                    <button type="button" class="va21-button va21-button--primary" data-va21-action="play"><span>▶</span><b>PLAY</b></button>
                    <button type="button" class="va21-button va21-button--ghost" data-va21-action="details">OPEN FILE</button>
                </div>
            </div>
            <div class="va21-hero__index" aria-hidden="true"><span>VELVET</span><b>ANTENNA</b><i>021</i></div>
        `;
        hero.querySelector('.va21-hero__eyebrow').textContent = lock.source;
        hero.querySelector('.va21-hero__title').textContent = lock.title;
        hero.querySelector('.va21-hero__meta').textContent = lock.meta || '';
        if (lock.fallbackImage) {
            hero.style.setProperty('--va21-hero-fallback', `url("${lock.fallbackImage.replace(/"/g, '%22')}")`);
            hero.classList.add('has-fallback');
        }
        return hero;
    }

    function mountHero() {
        if (pageKind() !== 'home' || !STATE.heroLock) return;
        let hero = document.getElementById(IDS.hero);
        if (hero && hero.getAttribute('data-item-id') === STATE.heroLock.id) return;
        if (hero) hero.remove();
        const container = homeContainer();
        if (!container) return;
        hero = createHero(STATE.heroLock);
        container.insertBefore(hero, container.firstChild);
    }

    async function enrichHero(lock) {
        const token = ++STATE.heroToken;
        const item = await getItem(lock.id);
        if (!item || token !== STATE.heroToken || !STATE.heroLock || STATE.heroLock.id !== lock.id) return;
        const hero = document.getElementById(IDS.hero);
        if (!hero) return;

        lock.type = item.Type || lock.type || '';
        hero.querySelector('.va21-hero__title').textContent = item.Name || lock.title;
        const meta = [];
        if (item.ProductionYear) meta.push(String(item.ProductionYear));
        const runtime = formatRuntime(item.RunTimeTicks);
        if (runtime) meta.push(runtime);
        if (item.OfficialRating) meta.push(item.OfficialRating);
        if (item.CommunityRating) meta.push('★ ' + Number(item.CommunityRating).toFixed(1));
        hero.querySelector('.va21-hero__meta').textContent = meta.join(' / ') || lock.meta || '';
        if (item.Overview) hero.querySelector('.va21-hero__overview').textContent = item.Overview;

        const userData = item.UserData || {};
        const playLabel = hero.querySelector('[data-va21-action="play"] b');
        if (/Series/i.test(lock.type)) playLabel.textContent = 'OPEN SERIES';
        else if (/Season/i.test(lock.type)) playLabel.textContent = 'OPEN SEASON';
        else if (userData.PlaybackPositionTicks > 0 && !userData.Played) playLabel.textContent = 'CONTINUE';
        else playLabel.textContent = 'PLAY';

        const progress = hero.querySelector('.va21-hero__progress');
        if (userData.PlaybackPositionTicks > 0 && item.RunTimeTicks > 0 && !userData.Played) {
            const pct = Math.max(0, Math.min(100, (userData.PlaybackPositionTicks / item.RunTimeTicks) * 100));
            progress.querySelector('span').textContent = formatRuntime(item.RunTimeTicks - userData.PlaybackPositionTicks) + ' left';
            progress.querySelector('i').style.width = pct + '%';
            progress.hidden = false;
        } else {
            progress.hidden = true;
        }

        const backdrop = imageUrl(item, 'Backdrop', 1900) || parentBackdropUrl(item);
        if (backdrop) {
            const image = new Image();
            image.onload = () => {
                if (!hero.isConnected || !STATE.heroLock || STATE.heroLock.id !== lock.id) return;
                hero.style.setProperty('--va21-hero-backdrop', `url("${backdrop.replace(/"/g, '%22')}")`);
                hero.classList.add('backdrop-ready');
            };
            image.src = backdrop;
        }
    }

    function decorateHome() {
        if (pageKind() !== 'home') return;
        document.querySelectorAll('.verticalSection').forEach(section => {
            const heading = sectionHeading(section);
            section.classList.remove('va21-row-landscape', 'va21-row-posters');
            if (/continue watching|next up/i.test(heading)) section.classList.add('va21-row-landscape');
            else if (/recently added|anime|collection/i.test(heading)) section.classList.add('va21-row-posters');
        });
        const myMedia = findMyMediaSection();
        if (myMedia) myMedia.classList.add('va21-my-media-source');
    }

    function libraryKind() {
        const value = lowerRoute();
        if (value.includes('collectiontype=movies') || value.startsWith('#/movies')) return 'movies';
        if (value.includes('collectiontype=tvshows') || value.startsWith('#/tv')) return 'series';
        if (value.includes('collection')) return 'collections';
        return 'library';
    }

    function libraryLabel() {
        return {
            movies: ['MOVIES', 'Film without the filing cabinet.'],
            series: ['SERIES', 'Stories arranged around what you want to watch next.'],
            collections: ['COLLECTIONS', 'Franchises, worlds and curated sets.'],
            library: ['LIBRARY', 'Your media, in focus.']
        }[libraryKind()];
    }

    function mountLibraryStage() {
        const existing = document.getElementById(IDS.stage);
        if (pageKind() !== 'library') {
            if (existing) existing.remove();
            return;
        }

        const page = Array.from(document.querySelectorAll('.libraryPage, .page'))
            .find(el => el.offsetParent !== null) || document.querySelector('.libraryPage, .page');
        if (!page) return;

        let stage = existing;
        if (!stage) {
            stage = document.createElement('section');
            stage.id = IDS.stage;
            stage.className = 'va21-stage';
            stage.innerHTML = `
                <div class="va21-stage__art" aria-hidden="true"></div>
                <div class="va21-stage__noise" aria-hidden="true"></div>
                <div class="va21-stage__shade" aria-hidden="true"></div>
                <div class="va21-stage__content">
                    <div class="va21-kicker"><span>VELVET LENS</span><b class="va21-stage__library"></b></div>
                    <h1 class="va21-stage__title"></h1>
                    <div class="va21-stage__meta"></div>
                    <p class="va21-stage__overview"></p>
                    <div class="va21-stage__actions">
                        <button type="button" class="va21-button va21-button--primary" data-va21-stage-action="open">OPEN</button>
                        <button type="button" class="va21-button va21-button--ghost" data-va21-stage-action="play">PLAY</button>
                        <button type="button" class="va21-button va21-button--quiet va21-admin-only va21-stage-edit itemAction" data-va21-stage-action="edit" data-action="edit">EDIT METADATA</button>
                    </div>
                </div>
                <div class="va21-stage__side">
                    <span class="va21-stage__count">FOCUS A TITLE</span>
                    <div class="va21-stage__tools va21-admin-only">
                        <button type="button" class="va21-tool" data-va21-workbench="needs-id"><b>NEEDS ID</b><span>Scan the whole library</span></button>
                        <button type="button" class="va21-tool" data-va21-workbench="duplicates"><b>DUPLICATES</b><span>Find likely duplicate files</span></button>
                    </div>
                </div>
            `;
            page.insertBefore(stage, page.firstChild);
        }

        const label = libraryLabel();
        stage.querySelector('.va21-stage__library').textContent = label[0];
        if (!STATE.stageId) {
            stage.querySelector('.va21-stage__title').textContent = label[0];
            stage.querySelector('.va21-stage__overview').textContent = label[1];
            stage.querySelector('.va21-stage__meta').textContent = 'MOVE ACROSS THE LIBRARY TO CHANGE THE LENS';
            stage.classList.remove('has-item', 'art-ready');
        }
    }

    function libraryCards() {
        return Array.from(document.querySelectorAll('body.va21-page-library .card'))
            .filter(card => !card.closest('#' + IDS.stage) && !card.closest('#' + IDS.workbench));
    }

    function firstLibraryCard() {
        return libraryCards().find(card => card.offsetParent !== null && cardItemId(card)) || null;
    }

    function scheduleStageFromCard(card, delay) {
        if (!card || pageKind() !== 'library') return;
        const id = cardItemId(card);
        if (!id || id === STATE.stageId) return;
        window.clearTimeout(STATE.stageHoverTimer);
        STATE.stageHoverTimer = window.setTimeout(() => setStageItem(id, card), delay || 80);
    }

    async function setStageItem(itemId, card) {
        if (!itemId || pageKind() !== 'library') return;
        STATE.stageId = itemId;
        const previous = document.querySelector('.va21-card-in-lens');
        if (previous && previous !== card) previous.classList.remove('va21-card-in-lens');
        if (card) card.classList.add('va21-card-in-lens');

        const stage = document.getElementById(IDS.stage);
        if (!stage) return;

        stage.classList.add('has-item');
        stage.querySelector('.va21-stage__title').textContent = cardTitle(card) || 'Loading';
        stage.querySelector('.va21-stage__meta').textContent = cardSecondary(card) || '';
        stage.querySelector('.va21-stage__overview').textContent = 'Loading metadata…';
        stage.querySelector('.va21-stage__count').textContent = 'IN THE LENS';

        const edit = stage.querySelector('.va21-stage-edit');
        if (edit) {
            edit.setAttribute('data-id', itemId);
            edit.setAttribute('data-serverid', serverId());
            edit.setAttribute('data-type', cardType(card) || 'Movie');
        }

        const token = ++STATE.stageToken;
        const item = await getItem(itemId);
        if (!item || token !== STATE.stageToken || STATE.stageId !== itemId) return;

        stage.querySelector('.va21-stage__title').textContent = item.Name || cardTitle(card) || 'Untitled';
        const meta = [];
        if (item.ProductionYear) meta.push(item.ProductionYear);
        const runtime = formatRuntime(item.RunTimeTicks);
        if (runtime) meta.push(runtime);
        if (item.OfficialRating) meta.push(item.OfficialRating);
        if (item.CommunityRating) meta.push('★ ' + Number(item.CommunityRating).toFixed(1));
        stage.querySelector('.va21-stage__meta').textContent = meta.join(' / ');
        stage.querySelector('.va21-stage__overview').textContent = item.Overview || 'No synopsis available.';
        stage.setAttribute('data-item-type', item.Type || cardType(card) || '');
        if (edit) edit.setAttribute('data-type', item.Type || cardType(card) || 'Movie');

        const play = stage.querySelector('[data-va21-stage-action="play"]');
        play.hidden = !/^(Movie|Episode|Video|Audio)$/i.test(item.Type || '');

        const backdrop = imageUrl(item, 'Backdrop', 1900) || parentBackdropUrl(item);
        if (backdrop) {
            const image = new Image();
            image.onload = () => {
                if (!stage.isConnected || token !== STATE.stageToken || STATE.stageId !== itemId) return;
                stage.style.setProperty('--va21-stage-backdrop', `url("${backdrop.replace(/"/g, '%22')}")`);
                stage.classList.add('art-ready');
            };
            image.src = backdrop;
        } else {
            stage.classList.remove('art-ready');
        }
    }

    function ensureStageDefault() {
        if (pageKind() !== 'library' || STATE.stageId) return;
        const card = firstLibraryCard();
        if (card) scheduleStageFromCard(card, 0);
    }

    function mountSearchStage() {
        const existing = document.getElementById(IDS.search);
        if (pageKind() !== 'search') {
            if (existing) existing.remove();
            return;
        }
        if (existing) return;
        const input = document.querySelector('.searchInput, input[type="search"], input[placeholder*="search" i]');
        if (!input) return;
        const stage = document.createElement('section');
        stage.id = IDS.search;
        stage.className = 'va21-search-stage';
        stage.innerHTML = `
            <div class="va21-kicker"><span>VA / INDEX</span><b>SEARCH</b></div>
            <h1>Find the signal.</h1>
            <p>Search the library without leaving the Velvet Antenna surface.</p>
        `;
        const host = input.closest('.searchFields') || input.closest('.inputContainer') || input.parentElement;
        if (host && host.parentElement) host.parentElement.insertBefore(stage, host);
    }

    function mountDetailBrand() {
        const existing = document.getElementById(IDS.detailBrand);
        if (pageKind() !== 'details') {
            if (existing) existing.remove();
            return;
        }
        if (existing) return;
        const title = document.querySelector('.itemName, .detailPagePrimaryContent h1, .detailPagePrimaryContainer h1');
        if (!title || !title.parentElement) return;
        const brand = document.createElement('div');
        brand.id = IDS.detailBrand;
        brand.className = 'va21-detail-brand';
        brand.innerHTML = '<span>VELVET ANTENNA</span><b>NOW IN FOCUS</b>';
        title.parentElement.insertBefore(brand, title);
        if (STATE.admin) mountDetailEdit();
    }

    function mountDetailEdit() {
        const id = currentDetailsId();
        if (!id) return;
        const actions = document.querySelector('.mainDetailButtons, .detailPagePrimaryContainer .mainDetailButtons');
        if (!actions || actions.querySelector('.va21-detail-edit')) return;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'emby-button button-flat va21-detail-edit itemAction';
        button.setAttribute('data-action', 'edit');
        button.setAttribute('data-id', id);
        button.setAttribute('data-serverid', serverId());
        button.title = 'Edit metadata';
        button.innerHTML = '<span>✎</span><span>EDIT METADATA</span>';
        actions.appendChild(button);
    }

