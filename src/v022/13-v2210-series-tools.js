(function () {
  'use strict';

  const VERSION = '0.22.10';
  const DETAIL_CLASS = 'va2210-series-action';
  const LENS_CLASS = 'va2210-series-lens-action';
  const RETRIES = [0, 100, 260, 560, 1000, 1700, 2800];
  let token = 0;
  let hoverTimer = null;

  function C() { return window.VA224 || null; }
  function api() { return C()?.api?.() || window.ApiClient || null; }
  function uid() {
    const client = api();
    try { return C()?.uid?.() || client?.getCurrentUserId?.() || ''; }
    catch (e) { return ''; }
  }
  function sid() {
    const client = api();
    try { return C()?.sid?.() || client?.serverId?.() || client?.serverInfo?.()?.Id || ''; }
    catch (e) { return ''; }
  }
  function route() { return String(location.hash || ''); }
  function detailsId() {
    const value = route();
    const match = value.match(/[?&]id=([^&]+)/i) || value.match(/\/details\/([^?&/]+)/i);
    return match?.[1] ? decodeURIComponent(match[1]) : '';
  }
  function isSeriesLibrary() {
    const helper = C();
    if (helper?.routeKind) return helper.routeKind() === 'series';
    const value = route().toLowerCase();
    return value.startsWith('#/tv') || value.includes('collectiontype=tvshows');
  }

  async function getItem(id) {
    const client = api();
    const user = uid();
    if (!client || !user || !id || typeof client.getItem !== 'function') return null;
    try { return await client.getItem(user, id); }
    catch (e) { return null; }
  }

  async function isAdmin() {
    const client = api();
    if (!client) return false;
    try {
      if (typeof client.getCurrentUser === 'function') {
        const user = await client.getCurrentUser();
        return Boolean(user?.Policy?.IsAdministrator);
      }
    } catch (e) {}
    return false;
  }

  function nativeAction(action, label, id, extraClass) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'emby-button button-flat itemAction ' + (extraClass || '');
    button.setAttribute('data-action', action);
    button.setAttribute('data-id', String(id));
    button.setAttribute('data-serverid', sid());
    button.setAttribute('data-type', 'Series');
    button.title = label;
    button.innerHTML = '<span class="va2210-series-action__icon" aria-hidden="true">' + (action === 'identify' ? '⌕' : '✎') + '</span><span>' + label + '</span>';
    return button;
  }

  function clearDetailActions() {
    document.querySelectorAll('.' + DETAIL_CLASS).forEach(el => el.remove());
  }

  async function mountDetail(localToken) {
    const id = detailsId();
    if (!id) {
      clearDetailActions();
      return;
    }

    const [item, admin] = await Promise.all([getItem(id), isAdmin()]);
    if (localToken !== token) return;
    if (!item || item.Type !== 'Series' || !admin) {
      clearDetailActions();
      return;
    }

    const actions = document.querySelector('.mainDetailButtons, .detailPagePrimaryContainer .mainDetailButtons, .detailPagePrimaryContent .mainDetailButtons');
    if (!actions) return;

    actions.querySelector('.va21-detail-edit')?.remove();

    let edit = actions.querySelector('.' + DETAIL_CLASS + '[data-action="edit"]');
    if (!edit) {
      edit = nativeAction('edit', 'EDIT SERIES', id, DETAIL_CLASS);
      actions.appendChild(edit);
    }

    let identify = actions.querySelector('.' + DETAIL_CLASS + '[data-action="identify"]');
    if (!identify) {
      identify = nativeAction('identify', 'IDENTIFY SERIES', id, DETAIL_CLASS);
      actions.appendChild(identify);
    }

    [edit, identify].forEach(button => {
      button.setAttribute('data-id', id);
      button.setAttribute('data-serverid', sid());
      button.setAttribute('data-type', 'Series');
    });
  }

  function clearLensActions() {
    document.querySelectorAll('.' + LENS_CLASS).forEach(el => el.remove());
  }

  async function syncLensActions() {
    if (!isSeriesLibrary()) {
      clearLensActions();
      return;
    }
    if (!(await isAdmin())) {
      clearLensActions();
      return;
    }

    const stage = document.getElementById('va224-library-stage');
    const actions = stage?.querySelector('.va224-stage__actions');
    const id = String(stage?.dataset?.va224Id || '');
    if (!stage || !actions || !id) return;

    const item = await getItem(id);
    if (!item || item.Type !== 'Series' || !stage.isConnected || String(stage.dataset.va224Id || '') !== id) return;

    let edit = actions.querySelector('.' + LENS_CLASS + '[data-action="edit"]');
    if (!edit) {
      edit = nativeAction('edit', 'EDIT SERIES', id, LENS_CLASS);
      actions.appendChild(edit);
    }

    let identify = actions.querySelector('.' + LENS_CLASS + '[data-action="identify"]');
    if (!identify) {
      identify = nativeAction('identify', 'IDENTIFY SERIES', id, LENS_CLASS);
      actions.appendChild(identify);
    }

    [edit, identify].forEach(button => {
      button.setAttribute('data-id', id);
      button.setAttribute('data-serverid', sid());
      button.setAttribute('data-type', 'Series');
    });
  }

  function schedule() {
    const localToken = ++token;
    RETRIES.forEach(delay => setTimeout(() => {
      mountDetail(localToken);
      syncLensActions();
    }, delay));
  }

  function focusPulse(event) {
    if (!isSeriesLibrary() || !event.target?.closest?.('.card')) return;
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(syncLensActions, 140);
  }

  addEventListener('hashchange', schedule);
  addEventListener('popstate', schedule);
  addEventListener('pageshow', schedule);
  addEventListener('va224:route', schedule);
  addEventListener('pointerover', focusPulse, true);
  addEventListener('focusin', focusPulse, true);

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', schedule, { once: true });
  else schedule();

  console.log('[Velvet Antenna] v0.22.10 native Series edit and identify tools loaded');
})();
