// GSAP helpers per doc §6 timing/easing conventions. All animations respect
// prefers-reduced-motion (skip -> elements stay at their natural, visible state).
//
// IMPORTANT: use gsap.fromTo() with EXPLICIT end values (never gsap.from()).
// React StrictMode runs effects twice in dev; gsap.from() called twice can
// capture a mid-animation value as its target and leave elements stuck at
// partial opacity. fromTo() + killTweensOf() is idempotent and always lands
// at the final state.
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

export const reduced = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Standard UI transition (0.3s / power2.out)
export function fadeIn(el, opts = {}) {
  if (!el || reduced()) return;
  gsap.killTweensOf(el);
  gsap.fromTo(el, { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.3, ease: 'power2.out', ...opts });
}

// Inbox list / card stagger (0.05s stagger, power1.out)
export function staggerIn(els, opts = {}) {
  if (!els || (Array.isArray(els) && els.length === 0) || reduced()) return;
  gsap.killTweensOf(els);
  gsap.fromTo(
    els,
    { opacity: 0, y: 10 },
    { opacity: 1, y: 0, duration: 0.3, ease: 'power1.out', stagger: 0.05, ...opts },
  );
}

// Modal enter (0.35s / power3.out)
export function modalIn(el) {
  if (!el) return;
  if (reduced()) return gsap.set(el, { opacity: 1, scale: 1 });
  gsap.killTweensOf(el);
  gsap.fromTo(el, { opacity: 0, scale: 0.96 }, { opacity: 1, scale: 1, duration: 0.35, ease: 'power3.out' });
}

// Drawer slide-in from right (0.35s / power3.out)
export function drawerIn(el) {
  if (!el) return;
  if (reduced()) return gsap.set(el, { x: 0, opacity: 1 });
  gsap.killTweensOf(el);
  gsap.fromTo(el, { x: '100%', opacity: 1 }, { x: 0, opacity: 1, duration: 0.35, ease: 'power3.out' });
}

// Red-flag attention pulse — restrained (0.4s, 1–2 repeats) per §6
export function pulse(el) {
  if (!el || reduced()) return;
  gsap.fromTo(el, { scale: 1 }, { scale: 1.18, duration: 0.4, ease: 'power1.inOut', yoyo: true, repeat: 1 });
}

// Dashboard metric count-up
export function countUp(el, end, opts = {}) {
  if (!el) return;
  const target = Number(end) || 0;
  if (reduced()) {
    el.textContent = target.toLocaleString();
    return;
  }
  const obj = { v: 0 };
  gsap.killTweensOf(obj);
  gsap.to(obj, {
    v: target,
    duration: 1,
    ease: 'power2.out',
    onUpdate: () => {
      el.textContent = Math.round(obj.v).toLocaleString();
    },
    ...opts,
  });
}

// Scroll-triggered reveal for dashboard sections (§6 ScrollTrigger)
export function scrollReveal(el) {
  if (!el || reduced()) return;
  gsap.killTweensOf(el);
  gsap.fromTo(
    el,
    { opacity: 0, y: 24 },
    { opacity: 1, y: 0, duration: 0.5, ease: 'power2.out', scrollTrigger: { trigger: el, start: 'top 85%' } },
  );
}

export { gsap, ScrollTrigger };
