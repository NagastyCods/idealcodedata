(function () {
  function initNavToggle() {
    var toggle = document.querySelector('.nav-toggle');
    var header = document.querySelector('.header');
    var nav = document.querySelector('.nav');
    if (!toggle || !header || !nav) return;

    function setOpen(open) {
      header.classList.toggle('nav-open', open);
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    }

    toggle.addEventListener('click', function () {
      setOpen(!header.classList.contains('nav-open'));
    });

    nav.querySelectorAll('a').forEach(function (link) {
      link.addEventListener('click', function () {
        setOpen(false);
      });
    });

    document.addEventListener('click', function (e) {
      if (header.classList.contains('nav-open') && !e.target.closest('.header')) {
        setOpen(false);
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initNavToggle);
  } else {
    initNavToggle();
  }
})();
