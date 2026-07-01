'use strict';

// Mobile nav toggle
document.querySelectorAll('[data-nav-toggle]').forEach(function (btn) {
  btn.addEventListener('click', function () {
    var nav = document.getElementById('nav');
    if (nav) nav.classList.toggle('open');
  });
});

// Current year in footer
document.querySelectorAll('[data-year]').forEach(function (el) {
  el.textContent = new Date().getFullYear();
});

// Chip toggles (visual state mirrors the hidden checkbox)
document.querySelectorAll('.chip input').forEach(function (input) {
  var chip = input.closest('.chip');
  var sync = function () { chip.classList.toggle('on', input.checked); };
  input.addEventListener('change', sync);
  sync();
});

// Account-type-aware onboarding: show/hide partner 2 fields
(function () {
  var form = document.querySelector('[data-onboarding]');
  if (!form) return;
  var accountType = form.getAttribute('data-account-type');
  var p2 = form.querySelector('[data-partner2]');
  if (p2) {
    var isCouple = accountType === 'couple' || accountType === 'group';
    p2.style.display = isCouple ? '' : 'none';
  }
})();

// Gallery: click thumb to swap main image
(function () {
  var main = document.querySelector('[data-gallery-main]');
  if (!main) return;
  document.querySelectorAll('[data-thumb]').forEach(function (t) {
    t.addEventListener('click', function () {
      var src = t.getAttribute('data-full');
      if (src) main.src = src;
    });
  });
})();

// Membership cycle toggle updates the hidden input + price display
(function () {
  var radios = document.querySelectorAll('[data-cycle]');
  if (!radios.length) return;
  radios.forEach(function (r) {
    r.addEventListener('change', function () {
      document.querySelectorAll('[data-price]').forEach(function (el) {
        el.textContent = el.getAttribute(r.value === 'annual' ? 'data-annual' : 'data-monthly');
      });
      document.querySelectorAll('[data-cycle-input]').forEach(function (i) { i.value = r.value; });
    });
  });
})();

// Auto-scroll message thread to bottom
(function () {
  var body = document.querySelector('[data-thread-body]');
  if (body) body.scrollTop = body.scrollHeight;
})();

// Scroll-reveal
(function () {
  if (!('IntersectionObserver' in window)) return;
  var obs = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (e.isIntersecting) { e.target.classList.add('rise'); obs.unobserve(e.target); }
    });
  }, { threshold: 0.12 });
  document.querySelectorAll('[data-reveal]').forEach(function (el) { obs.observe(el); });
})();
