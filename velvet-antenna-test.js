(() => {
    const id = 'velvet-antenna-test';

    function addVelvetAntennaTest() {
        if (!document.body) return;
        if (document.getElementById(id)) return;

        const banner = document.createElement('div');
        banner.id = id;
        banner.textContent = 'VELVET ANTENNA';

        Object.assign(banner.style, {
            position: 'fixed',
            top: '90px',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: '999999',
            padding: '18px 40px',
            background: 'rgba(17, 13, 23, 0.96)',
            color: '#C68BFF',
            border: '1px solid rgba(198,139,255,.45)',
            borderRadius: '12px',
            boxShadow: '0 12px 40px rgba(138,70,232,.65)',
            fontSize: '24px',
            fontWeight: '600',
            letterSpacing: '0.25em',
            pointerEvents: 'none'
        });

        document.body.appendChild(banner);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', addVelvetAntennaTest);
    } else {
        addVelvetAntennaTest();
    }

    new MutationObserver(addVelvetAntennaTest)
        .observe(document.documentElement, {
            childList: true,
            subtree: true
        });
})();
