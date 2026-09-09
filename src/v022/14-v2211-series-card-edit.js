(function () {
  'use strict';

  const VERSION = '0.22.11';
  const BUTTON_CLASS = 'va2211-series-card-edit';
  const RETRIES = [0, 100, 280, 650, 1200, 2200, 3600];
  let adminState = null;
  let adminPromise = null;
  let scrollTimer = null;

  function C() { return window.VA224 || null; }
  function api() { return C()?.api?.() || window.ApiClient || null; }
  function route() { return String(location.hash || ''); }
  function isSeriesLibrary() {
    const helper = C();
    if (helper?.routeKind) return helper.routeKind() === 'series';
    const value = route().toLowerCase();
    return value.startsWith('#/tv') || value.includes('collectiontype=tvshows');
  }
  function sid() {
    const client = api();
    try { return C()?.sid?.() || client?.serverId?.() || client?.serverInfo?.()?.Id || ''; }
    catch (e) { return ''; }
  }
  function cardId(card) {
    const helper = C();
    if (helper?.cardItemId) return helper.cardItemId(card) || '';
    if (!card) return '';
    const nodes = [card, card.querySelector('[data-id]'), card.querySelector('[data-itemid]')].filter(Boolean);
    for (const node of nodes) {
      const value = node.getAttribute('data-id') || node.getAttribute('data-itemid') || node.dataset?.id || node.dataset?.itemid || node.dataset?.itemId;
      if (value) return String(value);
    }
    const href = card.querySelector('a[href*="details" i]')?.getAttribute('href') || '';
    const match = href.match(/[?&]id=([^&]+)/i);
    return match?.[1] ? decodeURIComponent(match[1]) : '';
  }
  function cardTitle(card) {
    return (card?.querySelector('.cardText-first, .cardText, .itemName')?.textContent || card?.getAttribute('aria-label') || '').trim();
  }

  async function isAdmin() {
    if (adminState === true || adminState === false) return adminState;
    if (adminPromise) return adminPromise;
    const client = api();
    if (!client || typeof client.getCurrentUser !== 'function') return false;
    adminPromise = (async () => {
      try {
        const user = await client.getCurrentUser();
        adminState = Boolean(user?.Policy?.IsAdministrator);
        return adminState;
      } catch (e) {
        return false;
      } finally {
        adminPromise = null;
      }
    })();
    return adminPromise;
  }

  function eligibleCard(card) {
    if (!card || !isSeriesLibrary()) return false;
    if (card.closest('#va224-library-stage, #va224-home, #va22-tonight, #va226-collection-manager, #va229-artwork-picker, #va21-workbench, .selectionCommandsPanel')) return false;
    const explicitType = String(card.getAttribute('data-type') || card.querySelector('[data-type]')?.getAttribute('data-type') || '').toLowerCase();
    if (explicitType && explicitType !== 'series') return false;
    return Boolean(cardId(card));
  }

  function makeButton(card) {
    const id = cardId(card);
    if (!id) return null;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = BUTTON_CLASS + ' itemAction';
    button.setAttribute('data-action', 'edit');
    button.setAttribute('data-id', id);
    button.setAttribute('data-serverid', sid());
    button.setAttribute('data-type', 'Series');
    button.setAttribute('aria-label', 'Edit metadata for ' + (cardTitle(card) || 'series'));
    button.title = 'Edit metadata';
    button.innerHTML = '<span aria-hidden="true">✎</span><b>EDIT</b>';
    return button;
  }

  function decorateCard(card) {
    if (!eligibleCard(card) || card.querySelector('.' + BUTTON_CLASS)) return;
    card.classList.add('va2211-series-card');
    const button = makeButton(card);
    if (button) card.appendChild(button);
  }

  function clearButtons() {
    document.querySelectorAll('.' + BUTTON_CLASS).forEach(button => button.remove());
    document.querySelectorAll('.va2211-series-card').forEach(card => card.classList.remove('va2211-series-card'));
  }

  async function decorateAll() {
    if (!isSeriesLibrary()) {
      clearButtons();
      return;
    }
    if (!(await isAdmin())) {
      clearButtons();
      return;
    }
    document.querySelectorAll('.card').forEach(decorateCard);
  }

  async function decorateFromEvent(event) {
    if (!isSeriesLibrary() || !(await isAdmin())) return;
    const card = event.target?.closest?.('.card');
    if (card) decorateCard(card);
  }

  function schedule() {
    if (!isSeriesLibrary()) {
      clearButtons();
      return;
    }
    RETRIES.forEach(delay => setTimeout(decorateAll, delay));
  }

  function scheduleFromScroll() {
    if (!isSeriesLibrary()) return;
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(decorateAll, 120);
  }

  addEventListener('hashchange', schedule);
  addEventListener('popstate', schedule);
  addEventListener('pageshow', schedule);
  addEventListener('va224:route', schedule);
  addEventListener('pointerover', decorateFromEvent, true);
  addEventListener('focusin', decorateFromEvent, true);
  document.addEventListener('scroll', scheduleFromScroll, true);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) schedule(); });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', schedule, { once: true });
  else schedule();

  console.log('[Velvet Antenna] v0.22.11 per-Series card edit buttons loaded');
})();
