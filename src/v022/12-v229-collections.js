(function () {
  'use strict';

  const C = window.VA224;
  if (!C) return;

  const GRID_ID = 'va229-collections-grid';
  const ART_ID = 'va229-collection-artwork';
  const PICKER_ID = 'va229-artwork-picker';
  const state = { token: 0, gridParent: '', pickerType: 'Primary', pickerStart: 0 };

  function api() { return C.api?.() || window.ApiClient || null; }
  function uid() { return C.uid?.() || ''; }
  function routeKind() { return C.routeKind?.() || ''; }
  function detailsId() {
    const match = String(location.hash || '').match(/[?&]id=([^&]+)/i) || String(location.hash || '').match(/\/details\/([^?&/]+)/i);
    return match?.[1] ? decodeURIComponent(match[1]) : '';
  }
  function pageHost() {
    const pages = Array.from(document.querySelectorAll('.libraryPage, .page, [data-role="page"]'));
    return pages.find(el => el.offsetParent !== null && !el.closest('#va226-collection-manager')) || null;
  }
  function parentId() {
    return C.parseParent?.(C.route?.() || location.hash) || C.parentFor?.('collections') || '';
  }
  function escapeText(value) {
    return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }
  function imageUrl(item, type, width) {
    const client = api();
    if (!client || !item || typeof client.getImageUrl !== 'function') return '';
    try {
      if (type === 'Backdrop') {
        const tag = item.BackdropImageTags?.[0] || '';
        return tag ? client.getImageUrl(item.Id, { type: 'Backdrop', index: 0, tag, maxWidth: width || 1600, quality: 86 }) : '';
      }
      const tag = item.ImageTags?.Primary || item.PrimaryImageTag || '';
      return tag ? client.getImageUrl(item.Id, { type: 'Primary', tag, maxWidth: width || 520, quality: 88 }) : '';
    } catch (e) { return ''; }
  }

  async function getItems(options) {
    const client = api();
    const user = uid();
    if (!client || !user || typeof client.getItems !== 'function') return [];
    try {
      const result = await client.getItems(user, Object.assign({ Fields: 'Overview,ProviderIds,ImageTags,BackdropImageTags,PrimaryImageAspectRatio' }, options || {}));
      return Array.isArray(result?.Items) ? result.Items : [];
    } catch (e) {
      console.warn('[Velvet Antenna v0.22.9] collections query failed', e);
      return [];
    }
  }

  function collectionCard(item) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'va229-collection-card card';
    card.dataset.id = item.Id || '';
    card.dataset.va229Collection = item.Id || '';
    const art = imageUrl(item, 'Primary', 620) || imageUrl(item, 'Backdrop', 900);
    card.innerHTML = '<span class="va229-collection-card__art"></span><span class="va229-collection-card__shade"></span><span class="va229-collection-card__copy"><b></b><small></small></span>';
    if (art) card.querySelector('.va229-collection-card__art').style.backgroundImage = 'url("' + art.replace(/"/g, '%22') + '")';
    card.querySelector('b').textContent = item.Name || 'Untitled Collection';
    const count = Number(item.ChildCount || 0);
    card.querySelector('small').textContent = [count ? count + (count === 1 ? ' item' : ' items') : '', item.ProductionYear || ''].filter(Boolean).join(' • ');
    return card;
  }

  function ensureGridShell() {
    if (routeKind() !== 'collections') {
      document.getElementById(GRID_ID)?.remove();
      return null;
    }
    const host = pageHost();
    if (!host) return null;
    let grid = document.getElementById(GRID_ID);
    if (grid && !host.contains(grid)) { grid.remove(); grid = null; }
    if (!grid) {
      grid = document.createElement('section');
      grid.id = GRID_ID;
      grid.innerHTML = '<header><div><span>VA / COLLECTIONS</span><h2>All Collections</h2><p>Loading your BoxSets…</p></div><b></b></header><div class="va229-collections-grid__cards"></div>';
      const stage = document.getElementById('va224-library-stage');
      if (stage?.parentNode === host) stage.insertAdjacentElement('afterend', grid);
      else host.insertBefore(grid, host.firstChild);
    }
    return grid;
  }

  async function mountCollections() {
    if (routeKind() !== 'collections') {
      document.getElementById(GRID_ID)?.remove();
      return;
    }
    const parent = parentId();
    const grid = ensureGridShell();
    if (!grid || !parent) return;
    const token = ++state.token;
    state.gridParent = parent;
    grid.querySelector('p').textContent = 'Loading your BoxSets…';
    const items = await getItems({ ParentId: parent, Recursive: true, IncludeItemTypes: 'BoxSet', SortBy: 'SortName', SortOrder: 'Ascending', Limit: 1000, EnableTotalRecordCount: false });
    if (token !== state.token || routeKind() !== 'collections' || parentId() !== parent || !grid.isConnected) return;
    const cards = grid.querySelector('.va229-collections-grid__cards');
    cards.innerHTML = '';
    items.forEach(item => cards.appendChild(collectionCard(item)));
    grid.querySelector('header > b').textContent = String(items.length);
    grid.querySelector('p').textContent = items.length ? 'Every collection returned by Jellyfin, not just the first item in the Lens.' : 'No BoxSets were returned for this collection library.';
  }

  function managerPanel() { return document.getElementById('va226-collection-manager'); }
  function ensureArtworkControls() {
    const panel = managerPanel();
    if (!panel) return;
    document.getElementById('va228-collection-artwork')?.remove();
    if (document.getElementById(ART_ID)) return;
    const header = panel.querySelector('.va225-collection-panel > header');
    if (!header) return;
    const controls = document.createElement('div');
    controls.id = ART_ID;
    controls.innerHTML = '<button type="button" data-va229-pick="Primary">PICK POSTER</button><button type="button" data-va229-pick="Backdrop">PICK BACKDROP</button>';
    const close = header.querySelector('.va225-collection-close');
    if (close) header.insertBefore(controls, close); else header.appendChild(controls);
  }

  function closePicker() { document.getElementById(PICKER_ID)?.remove(); }

  function pickerShell(type) {
    closePicker();
    const picker = document.createElement('section');
    picker.id = PICKER_ID;
    picker.innerHTML = '<div class="va229-artwork-picker__backdrop" data-va229-close></div><div class="va229-artwork-picker__panel"><header><div><span>VA / COLLECTION ARTWORK</span><h2></h2><p>Loading curated artwork from Jellyfin providers…</p></div><button type="button" data-va229-close aria-label="Close">×</button></header><div class="va229-artwork-picker__providers"></div><div class="va229-artwork-picker__grid"></div><footer><button type="button" data-va229-prev>← PREVIOUS</button><span></span><button type="button" data-va229-next>NEXT →</button></footer></div>';
    picker.querySelector('h2').textContent = type === 'Backdrop' ? 'Choose a backdrop' : 'Choose a poster';
    document.body.appendChild(picker);
    return picker;
  }

  async function loadRemoteArtwork(type, startIndex) {
    const client = api();
    const id = detailsId();
    const picker = document.getElementById(PICKER_ID);
    if (!client || !id || !picker || typeof client.getAvailableRemoteImages !== 'function') return;
    const limit = 30;
    const provider = picker.dataset.va229Provider || '';
    picker.querySelector('header p').textContent = 'Loading curated artwork from Jellyfin providers…';
    picker.querySelector('.va229-artwork-picker__grid').innerHTML = '';
    try {
      const options = { itemId: id, type, startIndex, limit, IncludeAllLanguages: false };
      if (provider) options.ProviderName = provider;
      const result = await client.getAvailableRemoteImages(options);
      if (!picker.isConnected) return;
      const images = Array.isArray(result?.Images) ? result.Images : [];
      const providers = Array.isArray(result?.Providers) ? result.Providers : [];
      const providerHost = picker.querySelector('.va229-artwork-picker__providers');
      providerHost.innerHTML = '<button type="button" data-va229-provider="" class="' + (!provider ? 'is-active' : '') + '">ALL</button>' + providers.map(name => '<button type="button" data-va229-provider="' + escapeText(name) + '" class="' + (provider === name ? 'is-active' : '') + '">' + escapeText(name) + '</button>').join('');
      const grid = picker.querySelector('.va229-artwork-picker__grid');
      images.forEach((image, index) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'va229-artwork-choice ' + (type === 'Backdrop' ? 'is-backdrop' : 'is-poster');
        button.dataset.va229ImageIndex = String(index);
        button.dataset.va229ImageUrl = image.Url || '';
        button.dataset.va229ImageProvider = image.ProviderName || '';
        button.innerHTML = '<span class="va229-artwork-choice__art"></span><span class="va229-artwork-choice__copy"><b></b><small></small></span>';
        if (image.Url) button.querySelector('.va229-artwork-choice__art').style.backgroundImage = 'url("' + String(image.Url).replace(/"/g, '%22') + '")';
        button.querySelector('b').textContent = image.ProviderName || 'Remote artwork';
        button.querySelector('small').textContent = [image.Width && image.Height ? image.Width + '×' + image.Height : '', image.Language || '', image.CommunityRating ? Number(image.CommunityRating).toFixed(1) + ' ★' : ''].filter(Boolean).join(' • ');
        grid.appendChild(button);
      });
      const total = Number(result?.TotalRecordCount || images.length || 0);
      picker.querySelector('header p').textContent = images.length ? 'Pick an image and Jellyfin will apply it to this collection.' : 'No remote artwork was returned for this image type/provider.';
      picker.querySelector('footer span').textContent = total ? (startIndex + 1) + '–' + Math.min(startIndex + limit, total) + ' of ' + total : '0 results';
      picker.querySelector('[data-va229-prev]').disabled = startIndex <= 0;
      picker.querySelector('[data-va229-next]').disabled = startIndex + limit >= total;
      state.pickerStart = startIndex;
    } catch (e) {
      console.warn('[Velvet Antenna v0.22.9] remote artwork query failed', e);
      if (picker.isConnected) picker.querySelector('header p').textContent = 'Jellyfin could not load remote artwork for this collection.';
    }
  }

  async function applyRemoteArtwork(button) {
    const client = api();
    const id = detailsId();
    const url = button.dataset.va229ImageUrl || '';
    const provider = button.dataset.va229ImageProvider || '';
    const type = state.pickerType;
    if (!client || !id || !url || typeof client.downloadRemoteImage !== 'function') return;
    button.disabled = true;
    button.classList.add('is-applying');
    try {
      await client.downloadRemoteImage({ itemId: id, Type: type, ImageUrl: url, ProviderName: provider });
      closePicker();
      const summary = managerPanel()?.querySelector('.va225-collection-summary');
      if (summary) summary.textContent = type === 'Backdrop' ? 'COLLECTION BACKDROP UPDATED' : 'COLLECTION POSTER UPDATED';
      const fresh = typeof client.getItem === 'function' && uid() ? await client.getItem(uid(), id).catch(() => null) : null;
      if (fresh) {
        const tag = type === 'Backdrop' ? fresh.BackdropImageTags?.[0] : (fresh.ImageTags?.Primary || fresh.PrimaryImageTag);
        if (tag && typeof client.getImageUrl === 'function') {
          const freshUrl = type === 'Backdrop'
            ? client.getImageUrl(id, { type: 'Backdrop', index: 0, tag, maxWidth: 1920, quality: 92 })
            : client.getImageUrl(id, { type: 'Primary', tag, maxWidth: 1000, quality: 92 });
          if (type === 'Primary') {
            document.querySelectorAll('.detailImageContainer .cardImageContainer, .itemDetailImage').forEach(el => { el.style.backgroundImage = 'url("' + freshUrl.replace(/"/g, '%22') + '")'; });
            document.querySelectorAll('.detailImageContainer img, img.itemDetailImage').forEach(el => { el.src = freshUrl; });
          } else {
            document.querySelectorAll('.itemBackdrop, .detailPageWrapperContainer .backdropImage').forEach(el => { el.style.backgroundImage = 'url("' + freshUrl.replace(/"/g, '%22') + '")'; });
          }
        }
      }
    } catch (e) {
      console.warn('[Velvet Antenna v0.22.9] remote artwork apply failed', e);
      button.disabled = false;
      button.classList.remove('is-applying');
      const picker = document.getElementById(PICKER_ID);
      if (picker) picker.querySelector('header p').textContent = 'Jellyfin could not apply that artwork.';
    }
  }

  function click(event) {
    const target = event.target;
    if (!target?.closest) return;

    const collection = target.closest('[data-va229-collection]');
    if (collection) {
      event.preventDefault();
      const id = collection.dataset.va229Collection;
      if (id) C.openDetails?.(id);
      return;
    }

    const pick = target.closest('[data-va229-pick]');
    if (pick) {
      event.preventDefault();
      event.stopImmediatePropagation();
      state.pickerType = pick.dataset.va229Pick || 'Primary';
      state.pickerStart = 0;
      pickerShell(state.pickerType);
      loadRemoteArtwork(state.pickerType, 0);
      return;
    }
    if (target.closest('[data-va229-close]')) { event.preventDefault(); closePicker(); return; }
    const provider = target.closest('[data-va229-provider]');
    if (provider) {
      event.preventDefault();
      const picker = document.getElementById(PICKER_ID);
      if (picker) picker.dataset.va229Provider = provider.dataset.va229Provider || '';
      loadRemoteArtwork(state.pickerType, 0);
      return;
    }
    if (target.closest('[data-va229-prev]')) { event.preventDefault(); loadRemoteArtwork(state.pickerType, Math.max(0, state.pickerStart - 30)); return; }
    if (target.closest('[data-va229-next]')) { event.preventDefault(); loadRemoteArtwork(state.pickerType, state.pickerStart + 30); return; }
    const image = target.closest('.va229-artwork-choice');
    if (image) { event.preventDefault(); applyRemoteArtwork(image); return; }

    if (target.closest('#va226-manage-collection')) {
      [0,120,320].forEach(delay => setTimeout(ensureArtworkControls, delay));
    }
  }

  function routeChanged() {
    state.token += 1;
    closePicker();
    if (routeKind() === 'collections') [0,100,260,600,1200].forEach(delay => setTimeout(mountCollections, delay));
    else document.getElementById(GRID_ID)?.remove();
  }

  addEventListener('va224:route', routeChanged);
  addEventListener('hashchange', routeChanged);
  addEventListener('click', click, true);
  addEventListener('pageshow', () => { if (routeKind() === 'collections') mountCollections(); });
  routeChanged();

  console.log('[Velvet Antenna] v0.22.9 owned Collections grid and curated artwork picker loaded');
})();
