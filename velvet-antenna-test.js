(function () {
    'use strict';

    console.log('[Velvet Antenna] JavaScript loaded successfully');

    function createVelvetAntennaBanner() {
        if (!document.body) {
            return;
        }

        if (document.getElementById('velvet-antenna-js-test')) {
            return;
        }

        var banner = document.createElement('div');

        banner.id = 'velvet-antenna-js-test';

        banner.innerHTML =
            '<div style="font-size:12px;letter-spacing:.3em;opacity:.75;">JELLYFRAME TEST</div>' +
            '<div style="font-size:26px;font-weight:700;letter-spacing:.18em;margin-top:4px;">VELVET ANTENNA</div>' +
            '<div style="font-size:12px;margin-top:6px;opacity:.8;">JavaScript injection is working</div>';

        banner.style.position = 'fixed';
        banner.style.top = '90px';
        banner.style.left = '50%';
        banner.style.transform = 'translateX(-50%)';
        banner.style.zIndex = '2147483647';
        banner.style.padding = '18px 32px';
        banner.style.background = '#110D17';
        banner.style.color = '#F6F2F8';
        banner.style.border = '1px solid #C68BFF';
        banner.style.borderRadius = '12px';
        banner.style.boxShadow = '0 0 35px rgba(138, 70, 232, 0.85)';
        banner.style.textAlign = 'center';
        banner.style.pointerEvents = 'none';

        document.body.appendChild(banner);

        console.log('[Velvet Antenna] Banner inserted');
    }

    function initialiseVelvetAntennaTest() {
        createVelvetAntennaBanner();

        var observer = new MutationObserver(function () {
            createVelvetAntennaBanner();
        });

        observer.observe(document.documentElement, {
            childList: true,
            subtree: true
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener(
            'DOMContentLoaded',
            initialiseVelvetAntennaTest
        );
    } else {
        initialiseVelvetAntennaTest();
    }
})();
