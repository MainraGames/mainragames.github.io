(function () {
  document.addEventListener('DOMContentLoaded', function () {
    const root = document.documentElement;
    const body = document.body;
    const hamburger = document.querySelector('.hamburger');
    const mobileNav = document.querySelector('.mobile-nav');
    const closeNav = document.querySelector('.close-nav');
    const mobileNavLinks = document.querySelectorAll('.mobile-nav-links a');
    let lastFocusedElement = null;
    let lockedScrollY = 0;
    let bodyScrollStyles = null;

    if (!hamburger || !mobileNav) return;

    function setAria(isOpen) {
      hamburger.setAttribute('aria-expanded', String(isOpen));
      hamburger.setAttribute('aria-label', isOpen ? 'Close navigation' : 'Open navigation');
      mobileNav.setAttribute('aria-hidden', String(!isOpen));
      mobileNav.inert = !isOpen;
    }

    function setScrollLock(isLocked) {
      if (isLocked) {
        lockedScrollY = window.scrollY;
        bodyScrollStyles = {
          position: body.style.position,
          top: body.style.top,
          left: body.style.left,
          right: body.style.right,
          width: body.style.width
        };
        body.style.position = 'fixed';
        body.style.top = `-${lockedScrollY}px`;
        body.style.left = '0';
        body.style.right = '0';
        body.style.width = '100%';
      } else if (bodyScrollStyles) {
        body.style.position = bodyScrollStyles.position;
        body.style.top = bodyScrollStyles.top;
        body.style.left = bodyScrollStyles.left;
        body.style.right = bodyScrollStyles.right;
        body.style.width = bodyScrollStyles.width;
        window.scrollTo(0, lockedScrollY);
        bodyScrollStyles = null;
      }
      root.classList.toggle('nav-open', isLocked);
      body.classList.toggle('nav-open', isLocked);
    }

    function getFocusableElements() {
      return Array.from(mobileNav.querySelectorAll('a[href], button:not([disabled])'));
    }

    function openNav() {
      if (mobileNav.classList.contains('active')) return;
      lastFocusedElement = document.activeElement;
      mobileNav.classList.add('active');
      hamburger.classList.add('is-hidden');
      setScrollLock(true);
      setAria(true);

      const firstFocusable = getFocusableElements()[0];
      if (firstFocusable) firstFocusable.focus();
    }

    function closeNavMenu(restoreFocus = true) {
      if (!mobileNav.classList.contains('active')) return;
      mobileNav.classList.remove('active');
      hamburger.classList.remove('is-hidden');
      setScrollLock(false);
      setAria(false);

      if (restoreFocus) {
        const focusTarget = lastFocusedElement && typeof lastFocusedElement.focus === 'function'
          ? lastFocusedElement
          : hamburger;
        focusTarget.focus();
      }
      lastFocusedElement = null;
    }

    setAria(false);

    hamburger.addEventListener('click', function () {
      if (mobileNav.classList.contains('active')) {
        closeNavMenu();
      } else {
        openNav();
      }
    });

    if (closeNav) {
      closeNav.addEventListener('click', function () {
        closeNavMenu();
      });
    }

    mobileNav.addEventListener('click', function (event) {
      if (event.target === mobileNav) closeNavMenu();
    });

    mobileNavLinks.forEach(function (link) {
      link.addEventListener('click', function () {
        closeNavMenu(false);
      });
    });

    document.addEventListener('focusin', function (event) {
      if (!mobileNav.classList.contains('active') || mobileNav.contains(event.target)) return;
      const firstFocusable = getFocusableElements()[0];
      if (firstFocusable) firstFocusable.focus();
    });

    document.addEventListener('keydown', function (event) {
      if (!mobileNav.classList.contains('active')) return;

      if (event.key === 'Escape') {
        event.preventDefault();
        closeNavMenu();
        return;
      }

      if (event.key !== 'Tab') return;
      const focusableElements = getFocusableElements();
      if (!focusableElements.length) return;

      const firstFocusable = focusableElements[0];
      const lastFocusable = focusableElements[focusableElements.length - 1];
      if (event.shiftKey && document.activeElement === firstFocusable) {
        event.preventDefault();
        lastFocusable.focus();
      } else if (!event.shiftKey && document.activeElement === lastFocusable) {
        event.preventDefault();
        firstFocusable.focus();
      }
    });

    const desktopQuery = window.matchMedia('(min-width: 769px)');
    const closeOnDesktop = function (event) {
      if (event.matches) closeNavMenu(false);
    };
    if (desktopQuery.addEventListener) {
      desktopQuery.addEventListener('change', closeOnDesktop);
    } else {
      desktopQuery.addListener(closeOnDesktop);
    }

    // Smooth scrolling only for same-page anchors.
    document.querySelectorAll('a[href^="#"]').forEach(function (anchor) {
      anchor.addEventListener('click', function (event) {
        const href = this.getAttribute('href');
        if (!href || href === '#') return;
        const target = document.querySelector(href);
        if (!target) return;
        event.preventDefault();
        target.scrollIntoView({ behavior: 'smooth' });
      });
    });

    // Header scroll effect.
    const header = document.querySelector('header');
    if (header) {
      const onScroll = function () {
        header.classList.toggle('is-scrolled', window.scrollY > 100);
      };
      window.addEventListener('scroll', onScroll, { passive: true });
      onScroll();
    }
  });
})();
