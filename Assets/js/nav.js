(function () {
  // Init after DOM ready to ensure elements exist
  document.addEventListener('DOMContentLoaded', function () {
    const hamburger = document.querySelector('.hamburger');
    const mobileNav = document.querySelector('.mobile-nav');
    const closeNav = document.querySelector('.close-nav');
    const mobileNavLinks = document.querySelectorAll('.mobile-nav-links a');

    function setAria(isOpen) {
      if (hamburger) hamburger.setAttribute('aria-expanded', String(isOpen));
      if (mobileNav) mobileNav.setAttribute('aria-hidden', String(!isOpen));
    }

    function openNav() {
      if (!mobileNav || !hamburger) return;
      mobileNav.classList.add('active');
      // Hide hamburger to avoid double X
      hamburger.classList.remove('active');
      hamburger.classList.add('is-hidden');
      document.body.style.overflow = 'hidden';
      setAria(true);
      // Focus on the first link for keyboard interaction
      const firstLink = mobileNav.querySelector('.mobile-nav-links a');
      if (firstLink) {
        try { firstLink.focus(); } catch(_) {}
      }
    }
    function closeNavMenu() {
      if (!mobileNav || !hamburger) return;
      mobileNav.classList.remove('active');
      // Show hamburger again
      hamburger.classList.remove('is-hidden');
      hamburger.classList.remove('active');
      document.body.style.overflow = '';
      setAria(false);
      // Return focus to hamburger for accessibility
      try { hamburger.focus(); } catch(_) {}
    }

    // Open/Close handlers (guarded)
    if (hamburger && mobileNav) {
      hamburger.setAttribute('aria-label', 'Open navigation');
      hamburger.setAttribute('aria-expanded', 'false');
      hamburger.addEventListener('click', function(){
        if (mobileNav.classList.contains('active')) {
          closeNavMenu();
        } else {
          openNav();
        }
      });
    }
    if (closeNav) {
      closeNav.setAttribute('aria-label', 'Close navigation');
      closeNav.addEventListener('click', closeNavMenu);
    }
    if (mobileNav) {
      mobileNav.setAttribute('aria-hidden', 'true');
      // click backdrop to close
      mobileNav.addEventListener('click', function (e) {
        if (e.target === mobileNav) closeNavMenu();
      });
    }
    if (mobileNavLinks && mobileNavLinks.length) {
      mobileNavLinks.forEach(link => {
        link.addEventListener('click', closeNavMenu);
      });
    }
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && mobileNav && mobileNav.classList.contains('active')) {
        closeNavMenu();
      }
    });

    // Smooth scrolling ONLY for same-page anchors
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
      anchor.addEventListener('click', function (e) {
        const href = this.getAttribute('href');
        if (!href || href === '#') return;
        const target = document.querySelector(href);
        if (target) {
          e.preventDefault();
          target.scrollIntoView({ behavior: 'smooth' });
        }
      });
    });

    // Header scroll effect
    const header = document.querySelector('header');
    if (header) {
      const onScroll = () => {
        if (window.scrollY > 100) {
          header.style.backgroundColor = 'rgba(15, 12, 41, 0.95)';
          header.style.boxShadow = '0 5px 20px rgba(0, 0, 0, 0.4)';
          header.style.padding = '0.7rem 0';
        } else {
          header.style.backgroundColor = 'rgba(15, 12, 41, 0.85)';
          header.style.boxShadow = '0 5px 25px rgba(0, 0, 0, 0.3)';
          header.style.padding = '1rem 0';
        }
      };
      window.addEventListener('scroll', onScroll, { passive: true });
      onScroll();
    }
  });
})();
