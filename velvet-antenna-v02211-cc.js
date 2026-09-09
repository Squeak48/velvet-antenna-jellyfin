(function () {
  'use strict';

  if (window.__VELVET_ANTENNA_V02212_CC_FIXED_OVERLAY__) return;
  window.__VELVET_ANTENNA_V02212_CC_FIXED_OVERLAY__ = true;

  const VERSION = '0.22.12';
  const BUTTON_ID = 'va2211-cc-search';
  const LEGACY_IDS = ['va22-subtitle-search', 'va2211-cc-search'];
  const STYLE_ID = 'va2211-cc-style';
  const CHECKS = [0, 80, 180, 360, 700, 1200, 2100, 3400, 5200, 8000];

  const state = {
    timer: null,
    observer: null,
    lastPlayback: false
  };

  function route() {
    return String(window.location.hash || '');
  }

  function playbackActive() {
    return /videoosd|playback|nowplaying|video/i.test(route()) ||
      Boolean(document.querySelector('.videoPlayerContainer:not(.hide), .videoOsdPage:not(.hide), video'));
  }

  function nativeSubtitleButton() {
    return document.querySelector('.videoOsdPage:not(.hide) .btnSubtitles:not(.hide), .videoOsdBottom .btnSubtitles:not(.hide), .btnSubtitles:not(.hide)');
  }

  function injectStyle() {
    const previous = document.getElementById(STYLE_ID);
    if (previous) previous.remove();

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${BUTTON_ID} {
        appearance: none !important;
        position: fixed !important;
        right: 154px !important;
        bottom: 64px !important;
        z-index: 2147483647 !important;
        width: auto !important;
        min-width: 48px !important;
        height: 40px !important;
        margin: 0 !important;
        padding: 0 11px !important;
        display: inline-flex !important;
        align-items: center !important;
        justify-content: center !important;
        gap: 2px !important;
        border: 1px solid rgba(198, 139, 255, .34) !important;
        border-radius: 999px !important;
        background: rgba(17, 13, 23, .92) !important;
        color: #fff !important;
        box-shadow: 0 12px 34px rgba(0,0,0,.42), 0 0 0 1px rgba(255,255,255,.05) inset !important;
        cursor: pointer !important;
        pointer-events: auto !important;
        opacity: 1 !important;
        visibility: visible !important;
        transform: none !important;
        font: inherit !important;
        font-size: .70rem !important;
        font-weight: 850 !important;
        letter-spacing: .04em !important;
        line-height: 1 !important;
        user-select: none !important;
      }
      #${BUTTON_ID} b {
        color: var(--va20-highlight, #C68BFF) !important;
        font-size: .92rem !important;
        line-height: 1 !important;
      }
      #${BUTTON_ID}:hover,
      #${BUTTON_ID}:focus-visible {
        outline: none !important;
        background: rgba(108, 44, 191, .82) !important;
        box-shadow: 0 0 0 2px rgba(198,139,255,.24), 0 16px 38px rgba(0,0,0,.46) !important;
      }
      body:not(.hideVideoOsd) #${BUTTON_ID},
      .videoOsdPage:not(.hide) ~ #${BUTTON_ID} {
        opacity: 1 !important;
      }
      #va22-subtitle-search[data-va2212-superseded="true"] {
        display: none !important;
        pointer-events: none !important;
      }
      @media (max-width: 760px) {
        #${BUTTON_ID} {
          right: 86px !important;
          bottom: 58px !important;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function hideSupersededButtons(button) {
    LEGACY_IDS.forEach(id => {
      document.querySelectorAll('#' + id).forEach(node => {
        if (node === button) return;
        node.setAttribute('data-va2212-superseded', 'true');
        node.style.setProperty('display', 'none', 'important');
        node.style.setProperty('pointer-events', 'none', 'important');
      });
    });
  }

  function openSubtitleSearch() {
    if (window.VelvetAntenna22 && typeof window.VelvetAntenna22.openSubtitleSearch === 'function') {
      window.VelvetAntenna22.openSubtitleSearch();
      return true;
    }

    const legacy = document.getElementById('va22-subtitle-search');
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
    button.className = 'va2212-cc-search';
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

  function ensureBodyButton() {
    let button = document.getElementById(BUTTON_ID);
    if (!button || button.getAttribute('data-va2212-ready') !== 'true') {
      button?.remove();
      button = createButton();
      button.setAttribute('data-va2212-ready', 'true');
    }

    hideSupersededButtons(button);

    if (button.parentElement !== document.body) {
      document.body.appendChild(button);
    }

    button.style.setProperty('position', 'fixed', 'important');
    button.style.setProperty('right', '154px', 'important');
    button.style.setProperty('bottom', '64px', 'important');
    button.style.setProperty('z-index', '2147483647', 'important');
    button.style.setProperty('pointer-events', 'auto', 'important');
    button.style.setProperty('display', 'inline-flex', 'important');
    button.style.setProperty('visibility', 'visible', 'important');
    button.style.setProperty('opacity', '1', 'important');

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

    ensureBodyButton();
  }

  function schedule() {
    window.clearTimeout(state.timer);
    CHECKS.forEach(delay => window.setTimeout(mount, delay));
  }

  function start() {
    injectStyle();

    document.addEventListener('click', function (event) {
      const target = event.target;
      if (!target || typeof target.closest !== 'function') return;
      if (!target.closest('#' + BUTTON_ID)) return;
      event.preventDefault();
      event.stopPropagation();
      if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
      openSubtitleSearch();
    }, true);

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
    console.log('[Velvet Antenna] v' + VERSION + ' fixed CC+ playback overlay loaded');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
