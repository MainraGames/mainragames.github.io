(function () {
    let currentSlideIndex = 0;
    let slides = [];
    let dots = [];
    let totalSlides = 0;
    let autoPlayInterval;
    let carouselPaused = false;
    let manualPause = false;
    let motionPreferenceBound = false;

    function setCurrentYear() {
        const year = document.getElementById('currentYear');
        if (year) year.textContent = new Date().getFullYear();
    }

    function initializeFaq() {
        document.querySelectorAll('.faq-item').forEach(item => {
            const question = item.querySelector('.faq-question');
            const answer = item.querySelector('.faq-answer');
            if (!question || !answer) return;

            question.addEventListener('click', () => {
                const isOpen = question.getAttribute('aria-expanded') === 'true';
                question.setAttribute('aria-expanded', String(!isOpen));
                answer.hidden = isOpen;
                item.classList.toggle('active', !isOpen);
            });
        });
    }

    function initializePricingCards() {
        document.querySelectorAll('.pricing-card').forEach(card => {
            card.addEventListener('mouseenter', () => {
                if (!card.classList.contains('featured')) card.style.transform = 'translateY(-10px)';
            });
            card.addEventListener('mouseleave', () => {
                if (!card.classList.contains('featured')) card.style.transform = 'translateY(0)';
            });
        });
    }

    function initializeRevealAnimations() {
        if (document.body.classList.contains('no-reveal')) return;

        const targets = document.querySelectorAll(
            '.section-title, .service-card, .game-item, .about-text, .contact-info, .contact-form, '
            + '.platform-card, .benefit-card, .activity-card, .process-step, .pricing-card, '
            + '.faq-item, .privacy-content, .highlight-text, .highlight-image'
        );
        if (!targets.length) return;

        document.body.classList.add('js-ready');
        targets.forEach((target, index) => {
            target.classList.add('reveal-target');
            target.style.setProperty('--reveal-delay', `${Math.min(index % 6, 5) * 60}ms`);
        });

        if (prefersReducedMotion() || !('IntersectionObserver' in window)) {
            targets.forEach(target => target.classList.add('is-visible'));
            return;
        }

        const observer = new IntersectionObserver(entries => {
            entries.forEach(entry => {
                if (!entry.isIntersecting) return;
                entry.target.classList.add('is-visible');
                observer.unobserve(entry.target);
            });
        }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });

        targets.forEach(target => observer.observe(target));
    }

    function prefersReducedMotion() {
        return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    }

    function initializeGameFeel() {
        if (prefersReducedMotion()) return;

        if (window.matchMedia?.('(pointer: fine)').matches) {
            document.querySelectorAll('.hero, .page-header').forEach(surface => {
                surface.addEventListener('pointermove', event => {
                    const bounds = surface.getBoundingClientRect();
                    surface.style.setProperty('--game-x', `${event.clientX - bounds.left}px`);
                    surface.style.setProperty('--game-y', `${event.clientY - bounds.top}px`);
                }, { passive: true });
                surface.addEventListener('pointerleave', () => {
                    surface.style.removeProperty('--game-x');
                    surface.style.removeProperty('--game-y');
                });
            });
        }

        document.addEventListener('pointerdown', event => {
            if (!event.target.closest('.btn, .game-item, .service-card, .platform-card, .activity-card')) return;

            const spark = document.createElement('span');
            spark.className = 'game-spark';
            spark.setAttribute('aria-hidden', 'true');
            spark.style.left = `${event.clientX}px`;
            spark.style.top = `${event.clientY}px`;
            spark.addEventListener('animationend', () => spark.remove(), { once: true });
            document.body.appendChild(spark);
        }, { passive: true });
    }

    function stopCarouselAutoplay() {
        clearInterval(autoPlayInterval);
        autoPlayInterval = undefined;
    }

    function startCarouselAutoplay() {
        stopCarouselAutoplay();
        if (carouselPaused || manualPause || prefersReducedMotion() || totalSlides < 2) return;
        autoPlayInterval = setInterval(() => changeSlide(1), 5000);
    }

    function updateCarouselToggle() {
        const toggle = document.querySelector('.carousel-toggle');
        if (!toggle) return;

        const motionReduced = prefersReducedMotion();
        const unavailable = totalSlides < 2 || motionReduced;
        toggle.hidden = unavailable;
        toggle.disabled = unavailable;
        if (unavailable) {
            stopCarouselAutoplay();
            return;
        }

        const isPaused = manualPause;
        toggle.setAttribute('aria-pressed', String(isPaused));
        toggle.setAttribute('aria-label', isPaused ? 'Play slideshow' : 'Pause slideshow');
        toggle.innerHTML = `<i class="fas fa-${isPaused ? 'play' : 'pause'}" aria-hidden="true"></i>`;
    }

    function bindMotionPreference() {
        if (motionPreferenceBound || !window.matchMedia) return;
        const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
        const handleChange = () => {
            updateCarouselToggle();
            if (mediaQuery.matches) stopCarouselAutoplay();
            else startCarouselAutoplay();
        };
        if (mediaQuery.addEventListener) mediaQuery.addEventListener('change', handleChange);
        else if (mediaQuery.addListener) mediaQuery.addListener(handleChange);
        motionPreferenceBound = true;
    }

    function changeSlide(direction) {
        if (!slides.length) return;

        slides[currentSlideIndex].classList.remove('active');
        if (dots[currentSlideIndex]) dots[currentSlideIndex].classList.remove('active');
        currentSlideIndex = (currentSlideIndex + direction + totalSlides) % totalSlides;
        slides[currentSlideIndex].classList.add('active');
        if (dots[currentSlideIndex]) dots[currentSlideIndex].classList.add('active');
    }

    function initializeCarousel() {
        slides = [...document.querySelectorAll('.carousel-slide')];
        dots = [...document.querySelectorAll('.dot')];
        totalSlides = slides.length;
        currentSlideIndex = 0;
        carouselPaused = false;
        manualPause = false;
        stopCarouselAutoplay();

        if (!totalSlides) return;

        const prev = document.querySelector('.prev-btn');
        const next = document.querySelector('.next-btn');
        const carousel = document.querySelector('.carousel-container');
        const toggle = document.querySelector('.carousel-toggle');
        bindMotionPreference();
        updateCarouselToggle();
        if (prev && !prev.dataset.carouselBound) {
            prev.addEventListener('click', () => changeSlide(-1));
            prev.dataset.carouselBound = 'true';
        }
        if (next && !next.dataset.carouselBound) {
            next.addEventListener('click', () => changeSlide(1));
            next.dataset.carouselBound = 'true';
        }
        if (toggle && !toggle.dataset.carouselBound) {
            toggle.addEventListener('click', () => {
                manualPause = !manualPause;
                carouselPaused = manualPause;
                if (manualPause) stopCarouselAutoplay();
                else startCarouselAutoplay();
                updateCarouselToggle();
            });
            toggle.dataset.carouselBound = 'true';
        }
        if (carousel && !carousel.dataset.autoplayBound) {
            const pause = () => {
                carouselPaused = true;
                stopCarouselAutoplay();
            };
            const resume = () => {
                if (manualPause) return;
                carouselPaused = false;
                startCarouselAutoplay();
            };
            carousel.addEventListener('mouseenter', pause);
            carousel.addEventListener('mouseleave', resume);
            carousel.addEventListener('focusin', pause);
            carousel.addEventListener('focusout', event => {
                if (!carousel.contains(event.relatedTarget)) resume();
            });
            carousel.dataset.autoplayBound = 'true';
        }
        updateCarouselToggle();
        startCarouselAutoplay();
    }

    function currentSlide(index) {
        if (!slides.length || index < 1 || index > totalSlides) return;

        slides[currentSlideIndex].classList.remove('active');
        if (dots[currentSlideIndex]) dots[currentSlideIndex].classList.remove('active');
        currentSlideIndex = index - 1;
        slides[currentSlideIndex].classList.add('active');
        if (dots[currentSlideIndex]) dots[currentSlideIndex].classList.add('active');
    }

    window.initializeCarousel = initializeCarousel;
    window.currentSlide = currentSlide;

    function initializeSite() {
        setCurrentYear();
        initializeFaq();
        initializePricingCards();
        initializeRevealAnimations();
        initializeGameFeel();
        updateCarouselToggle();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initializeSite);
    } else {
        initializeSite();
    }
})();
