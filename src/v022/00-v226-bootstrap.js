(function () {
  'use strict';

  const BOOT_ID = 'va226-boot-screen';

  function isHome() {
    const value = String(location.hash || '').toLowerCase();
    return value === '#/home' || value.startsWith('#/home?') || value === '' || value === '#';
  }

  function boot() {
    if (!document.body || !isHome()) return;
    document.body.classList.add('va224-active', 'va224-route-home', 'va226-booting');
    if (document.getElementById(BOOT_ID)) return;
    const screen = document.createElement('div');
    screen.id = BOOT_ID;
    screen.innerHTML = '<div class="va226-boot__brand"><span class="va224-mark"><i></i><i></i><i></i><i></i></span><b>VELVET ANTENNA</b></div><div class="va226-boot__signal"><i></i><i></i><i></i><i></i></div><p>TUNING YOUR LIBRARY</p>';
    document.body.appendChild(screen);
  }

  function clearWhenLeavingHome() {
    if (isHome()) return;
    document.getElementById(BOOT_ID)?.remove();
    document.body?.classList.remove('va226-booting');
  }

  if (document.body) boot();
  else document.addEventListener('DOMContentLoaded', boot, { once: true });
  addEventListener('hashchange', clearWhenLeavingHome);

  window.VA226Bootstrap = {
    clear() {
      document.getElementById(BOOT_ID)?.remove();
      document.body?.classList.remove('va226-booting');
    }
  };

  console.log('[Velvet Antenna] v0.22.6 first-paint bootstrap loaded');
})();
