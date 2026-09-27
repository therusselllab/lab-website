/* ============================================================
   Russell Lab — main.js
   Nav scroll effect, mobile menu, scroll reveal animations
   ============================================================ */

(function () {
  'use strict';

  // --- Nav scroll effect ---
  const nav = document.querySelector('.nav');
  if (nav) {
    window.addEventListener('scroll', () => {
      nav.classList.toggle('scrolled', window.scrollY > 20);
    }, { passive: true });
  }

  // --- Mobile burger menu ---
  const burger = document.querySelector('.nav__burger');
  const navLinks = document.querySelector('.nav__links');
  if (burger && navLinks) {
    burger.addEventListener('click', () => {
      const open = navLinks.classList.toggle('open');
      burger.classList.toggle('open', open);
      burger.setAttribute('aria-expanded', open);
    });
    // Close on link click
    navLinks.querySelectorAll('a').forEach(a => {
      a.addEventListener('click', () => {
        navLinks.classList.remove('open');
        burger.classList.remove('open');
        burger.setAttribute('aria-expanded', false);
      });
    });
  }

  // --- Active nav link ---
  const currentPath = window.location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.nav__links a').forEach(a => {
    const href = a.getAttribute('href');
    if (href === currentPath || (currentPath === '' && href === 'index.html')) {
      a.classList.add('active');
    }
  });

  // --- Scroll reveal (Intersection Observer) ---
  const revealEls = document.querySelectorAll('.reveal');
  if (revealEls.length) {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            entry.target.classList.add('visible');
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: '0px 0px -40px 0px' }
    );
    revealEls.forEach(el => observer.observe(el));
  }

  // --- Analytics: record meaningful clicks as GoatCounter events ---
  // (page views are counted by the GoatCounter script itself; nothing is sent from localhost)
  document.addEventListener('click', e => {
    const a = e.target.closest('a');
    if (!a || !window.goatcounter || !window.goatcounter.count) return;
    const href = a.getAttribute('href') || '';
    const label = (a.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 80);
    const page = currentPath.replace('.html', '') || 'index';
    let event = null;
    if (/\.pdf(\?|$)|pdf=render|\/pdf\//i.test(href) || label === 'PDF' || label === 'Preprint PDF') {
      const pub = a.closest('.pub-item, .pub-selected')?.querySelector('.pub-item__title')?.textContent.trim();
      event = 'pdf: ' + (pub || href).slice(0, 100);
    } else if (href.startsWith('mailto:')) {
      event = 'email: ' + page;
    } else if (a.classList.contains('btn')) {
      event = 'button: ' + label + ' (' + page + ')';
    } else if (a.host && a.host !== location.host) {
      event = 'outbound: ' + a.host + a.pathname.replace(/\/$/, '');
    }
    if (event) window.goatcounter.count({ path: event, title: label, event: true });
  });

  // --- Hero background parallax ---
  const hero = document.querySelector('.hero');
  if (hero) {
    let animFrame;
    let isHovering = false;

    hero.addEventListener('mousemove', e => {
      isHovering = true;
      cancelAnimationFrame(animFrame);
      animFrame = requestAnimationFrame(() => {
        const rect = hero.getBoundingClientRect();
        const x = (e.clientX - rect.left) / rect.width;
        // Shift ±4% horizontally around the 5% anchor; vertical locked to top
        const bx = 5 + (x - 0.5) * 8;
        hero.style.backgroundPosition = `${bx}% 0%`;
      });
    });

    hero.addEventListener('mouseleave', () => {
      isHovering = false;
      hero.style.backgroundPosition = '';
    });
  }

})();
