// ========================================
// Dr. Eberle Clever Chemistry - Scripts
// ========================================

document.addEventListener('DOMContentLoaded', () => {

    // --- Enable scroll animations ---
    document.body.classList.add('js-animated');

    // --- Header scroll effect ---
    const header = document.getElementById('header');
    const handleScroll = () => {
        header.classList.toggle('scrolled', window.scrollY > 50);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll();

    // --- Mobile menu ---
    const hamburger = document.getElementById('hamburger');
    const nav = document.getElementById('nav');

    hamburger.addEventListener('click', () => {
        hamburger.classList.toggle('active');
        nav.classList.toggle('open');
        document.body.style.overflow = nav.classList.contains('open') ? 'hidden' : '';
    });

    nav.querySelectorAll('.nav-link').forEach(link => {
        link.addEventListener('click', () => {
            hamburger.classList.remove('active');
            nav.classList.remove('open');
            document.body.style.overflow = '';
        });
    });

    // --- Active nav link on scroll ---
    const sections = document.querySelectorAll('section[id]');
    const navLinks = document.querySelectorAll('.nav-link');

    const updateActiveNav = () => {
        const scrollY = window.scrollY + 120;
        sections.forEach(section => {
            const top = section.offsetTop;
            const height = section.offsetHeight;
            const id = section.getAttribute('id');
            if (scrollY >= top && scrollY < top + height) {
                navLinks.forEach(link => {
                    link.classList.toggle('active', link.getAttribute('href') === `#${id}`);
                });
            }
        });
    };
    window.addEventListener('scroll', updateActiveNav, { passive: true });

    // --- Animated counter ---
    const statNumbers = document.querySelectorAll('.stat-number');
    let statsAnimated = false;

    const animateCounters = () => {
        if (statsAnimated) return;
        const statsBar = document.querySelector('.stats-bar');
        if (!statsBar) return;

        const rect = statsBar.getBoundingClientRect();
        if (rect.top < window.innerHeight && rect.bottom > 0) {
            statsAnimated = true;
            statNumbers.forEach(num => {
                const target = parseInt(num.getAttribute('data-target'));
                const duration = 2000;
                const start = performance.now();

                const update = (now) => {
                    const elapsed = now - start;
                    const progress = Math.min(elapsed / duration, 1);
                    const eased = 1 - Math.pow(1 - progress, 3);
                    num.textContent = Math.floor(eased * target);
                    if (progress < 1) requestAnimationFrame(update);
                };
                requestAnimationFrame(update);
            });
        }
    };
    window.addEventListener('scroll', animateCounters, { passive: true });

    // --- Scroll animations with IntersectionObserver ---
    const observerOptions = { threshold: 0.05, rootMargin: '0px 0px -30px 0px' };
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('visible');
                observer.unobserve(entry.target);
            }
        });
    }, observerOptions);

    const animateElements = () => {
        document.querySelectorAll('.fade-in, .fade-in-left, .fade-in-right, .timeline-item').forEach(el => {
            observer.observe(el);
        });
    };

    // --- Add animation classes to elements ---
    const addAnimClasses = () => {
        // Section headers
        document.querySelectorAll('.section-header, .section-label, .section-title').forEach(el => {
            if (!el.closest('.hero')) el.classList.add('fade-in');
        });

        // Cards
        document.querySelectorAll('.product-card, .service-card, .env-card').forEach((el, i) => {
            el.classList.add('fade-in');
            el.style.transitionDelay = `${(i % 4) * 0.1}s`;
        });

        // Grid items
        document.querySelectorAll('.about-content, .quality-content, .innovation-content').forEach(el => {
            el.classList.add('fade-in-left');
        });

        document.querySelectorAll('.about-image, .quality-image, .innovation-image').forEach(el => {
            el.classList.add('fade-in-right');
        });

        // Contact
        document.querySelectorAll('.contact-info').forEach(el => el.classList.add('fade-in-left'));
        document.querySelectorAll('.contact-form-wrapper').forEach(el => el.classList.add('fade-in-right'));

        // Stats
        document.querySelectorAll('.stat-item').forEach((el, i) => {
            el.classList.add('fade-in');
            el.style.transitionDelay = `${i * 0.15}s`;
        });

        // Cert badges
        document.querySelectorAll('.cert-badge').forEach((el, i) => {
            el.classList.add('fade-in');
            el.style.transitionDelay = `${i * 0.1}s`;
        });
    };

    addAnimClasses();

    // Initial check
    setTimeout(animateElements, 100);
    animateCounters();

    // --- Contact form ---
    const form = document.getElementById('contactForm');
    if (form) {
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            const btn = form.querySelector('.btn-submit');
            const originalText = btn.textContent;
            btn.textContent = 'Message Sent!';
            btn.style.background = 'var(--green)';
            btn.style.borderColor = 'var(--green)';
            setTimeout(() => {
                btn.textContent = originalText;
                btn.style.background = '';
                btn.style.borderColor = '';
                form.reset();
            }, 3000);
        });
    }

    // --- Smooth scroll for anchor links ---
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', (e) => {
            const target = document.querySelector(anchor.getAttribute('href'));
            if (target) {
                e.preventDefault();
                target.scrollIntoView({ behavior: 'smooth' });
            }
        });
    });
});
