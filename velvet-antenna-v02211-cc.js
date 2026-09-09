(function () {
  'use strict';

  if (window.__VELVET_ANTENNA_V02211_CC_PERSIST__) return;
  window.__VELVET_ANTENNA_V02211_CC_PERSIST__ = true;

  const VERSION = '0.22.11';
  const BUTTON_ID = 'va2211-cc-search';
  const LEGACY_BUTTON_ID = 'va22-subtitle-search';
  const STYLE_ID = 'va2211-cc-style';
  const CHECKS = [0, 120, 300, 700, 1300, 2300, 3600, 5500, 8000];

  const state = {
    timer: null,
    observer: null,
    lastPlayback: false
  };

  function route() {
    return String(window.location.hash || '');
  }

  function playbackActive() {
    return /videoosd|playback|nowplaying/i.test(route()) ||
      Boolean(document.querySelector('.videoPlayerContainer:not(.hide), .videoOsdPage:not(.hide), video'));
  }

  function visible(el) {
    if (!el || !el.isConnected) return false;
    const style = window.getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) !== 0;
  }

  function playerHost() {
    return document.querySelector('.videoOsdBottom:not(.hide) .osdControls') ||
      document.querySelector('.videoOsdBottom:not(.hide)') ||
      document.querySelector('.videoOsdControls:not(.hide)') ||
      document.querySelector('.osdControls:not(.hide)') ||
      document.querySelector('.videoOsdPage:not(.hide)') ||
      document.querySelector('.videoPlayerContainer:not(.hide)') ||
      document.body;
  }

  function nativeSubtitleButton() {
    return document.querySelector('.videoOsdPage:not(.hide) .btnSubtitles:not(.hide), .videoOsdBottom .btnSubtitles:not(.hide), .btnSubtitles:not(.hide)');
  }

  function existingSearchButton() {
    return document.getElementById(LEGACY_BUTTON_ID) || document.getElementById(BUTTON_ID);
  }

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${BUTTON_ID} {
        appearance: none;
        border: 0;
        border-radius: 999px;
        min-width: 44px;
        height: 38px;
        padding: 0 10px;
        display: inline-flex !important;
        align-items: center;
        justify-content: center;
        gap: 2px;
        background: rgba(17, 13, 23, .82);
        color: #fff;
        font: inherit;
        font-size: .68rem;
        font-weight: 850;
        letter-spacing: .04em;
        line-height: 1;
        cursor: pointer;
        border: 1px solid rgba(198, 139, 255, .24);
        box-shadow: 0 10px 28px rgba(0,0,0,.28);
        pointer-events: auto !important;
        opacity: 1 !important;
        visibility: visible !important;
      }
      #${BUTTON_ID} b {
        color: var(--va20-highlight, #C68BFF);
        font-size: .88rem;
        line-height: 1;
      }
      #${BUTTON_ID}:hover,
      #${BUTTON_ID}:focus-visible {
        outline: none;
        background: rgba(108, 44, 191, .72);
        box-shadow: 0 0 0 2px rgba(198,139,255,.20), 0 14px 32px rgba(0,0,0,.34);
      }
      #${BUTTON_ID}.va2211-cc-floating {
        position: fixed;
        right: 92px;
        bottom: 26px;
        z-index: 999999;
      }
    `;
    document.head.appendChild(style);
  }

  function openSubtitleSearch() {
    if (window.VelvetAntenna22 && typeof window.VelvetAntenna22.openSubtitleSearch === 'function') {
      window.VelvetAntenna22.openSubtitleSearch();
      return true;
    }

    const legacy = document.getElementById(LEGACY_BUTTON_ID);
    if (legacy && typeof legacy.click === 'function') {
      legacy.click();
      return true;
    }

    const native = nativeSubtitleButton();
    if (native && typeof native.click === 'function') {
      native.click();
      return true;
    }

    console.warn('[Velvet Antenna] v' + VERSION + ' could not find a subtitle search handler yet');
    return false;
  }

  function createButton() {
    const button = document.createElement('button');
    button.type = 'button';
    button.id = BUTTON_ID;
    button.className = 'va2211-cc-search';
    button.setAttribute('aria-label', 'Find subtitles online');
    button.title = 'Find subtitles online';
    button.innerHTML = '<span aria-hidden="true">CC</span><b>+</b>';
    button.addEventListener('click', function (event) {
      event.preventDefault();
      event.stopPropagation();
      if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
      openSubtitleSearch();
    }, true);
    return button;
  }

  function mount() {
    injectStyle();
    const active = playbackActive();
    state.lastPlayback = active;

    const own = document.getElementById(BUTTON_ID);
    if (!active) {
      own?.remove();
      return;
    }

    const legacy = document.getElementById(LEGACY_BUTTON_ID);
    if (legacy && visible(legacy)) {
      own?.remove();
      return;
    }

    const native = nativeSubtitleButton();
    const host = native?.parentElement || playerHost();
    if (!host) return;

    let button = own || createButton();
    button.classList.toggle('va2211-cc-floating', host === document.body || host.classList.contains('videoPlayerContainer'));

    if (!button.isConnected) {
      if (native?.parentElement) native.insertAdjacentElement('afterend', button);
      else host.appendChild(button);
    } else if (native?.parentElement && button.parentElement !== native.parentElement) {
      native.insertAdjacentElement('afterend', button);
    }
  }

  function schedule() {
    window.clearTimeout(state.timer);
    CHECKS.forEach(delay => window.setTimeout(mount, delay));
  }

  function start() {
    injectStyle();
    document.addEventListener('mousemove', function () { if (playbackActive()) mount(); }, { passive: true });
    document.addEventListener('keydown', function () { if (playbackActive()) mount(); }, true);
    window.addEventListener('hashchange', schedule);
    window.addEventListener('popstate', schedule);
    state.observer = new MutationObserver(function () {
      const active = playbackActive();
      if (active || active !== state.lastPlayback) mount();
    });
    state.observer.observe(document.documentElement, { childList: true, subtree: true });
    schedule();
    console.log('[Velvet Antenna] v' + VERSION + ' persistent CC+ launcher loaded');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
