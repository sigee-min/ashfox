// Motion is progressive enhancement: content stays visible without JavaScript.
const landingMotion = (() => {
  const root = document.querySelector('.world-landing');
  const preference = matchMedia('(prefers-reduced-motion: reduce)');
  const active = new Set();
  const play = (element, frames, options = {}) => {
    if (!element || preference.matches || !element.animate) return;
    for (const animation of element.getAnimations()) animation.cancel();
    const animation = element.animate(frames, { duration: 700, easing: 'cubic-bezier(.2,.8,.2,1)', ...options });
    active.add(animation);
    animation.finished.catch(() => {}).finally(() => active.delete(animation));
  };
  preference.addEventListener('change', () => {
    if (preference.matches) { for (const animation of active) animation.cancel(); active.clear(); }
  });
  if (root) {
    play(root.querySelector('.world-heading'), [{ opacity: .3, transform: 'translateY(22px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 950 });
    play(root.querySelector('.world-intro'), [{ opacity: .35, transform: 'translateY(14px)' }, { opacity: 1, transform: 'translateY(0)' }], { delay: 120 });
    const targets = root.querySelectorAll('.world-items > *, .world-sound > *, .world-source > *, .delivery-pair > a, .world-start h2');
    if ('IntersectionObserver' in window) {
      const observer = new IntersectionObserver(entries => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.dataset.entered = 'true';
          play(entry.target, [{ opacity: .15, transform: 'translateY(30px)' }, { opacity: 1, transform: 'translateY(0)' }]);
          observer.unobserve(entry.target);
        }
      }, { threshold: .15 });
      for (const target of targets) observer.observe(target);
    }
  }
  return { change: element => play(element, [{ opacity: .3, scale: '.94' }, { opacity: 1, scale: '1' }], { duration: 320 }) };
})();
