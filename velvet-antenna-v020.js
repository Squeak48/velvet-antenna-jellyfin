(function () {
    'use strict';

    const VERSION = '0.20.2';
    const BASE = 'https://raw.githubusercontent.com/Squeak48/velvet-antenna-jellyfin/main/';

    function loadScript(src) {
        return new Promise(function (resolve, reject) {
            const script = document.createElement('script');
            script.src = src;
            script.async = false;
            script.onload = function () { resolve(); };
            script.onerror = function () { reject(new Error('Failed to load ' + src)); };
            document.head.appendChild(script);
        });
    }

    function start() {
        if (window.__VELVET_ANTENNA_V0202_LOADER__) return;
        window.__VELVET_ANTENNA_V0202_LOADER__ = true;
        loadScript(BASE + 'velvet-antenna-v020-core.js?v=' + VERSION)
            .then(function () {
                return loadScript(BASE + 'velvet-antenna-v020-maintenance.js?v=' + VERSION);
            })
            .catch(function (error) {
                console.error('[Velvet Antenna] v' + VERSION + ' loader failed', error);
            });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
    else start();
})();
