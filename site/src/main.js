import './style.css';
import 'lenis/dist/lenis.css';
import Lenis from 'lenis';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { createStage } from './stage.js';

gsap.registerPlugin(ScrollTrigger);
document.body.classList.add('is-loading');
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
scrollTo(0, 0);

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const clamp01 = (v) => Math.min(1, Math.max(0, v));

/* ---------------- smooth scroll ---------------- */
const lenis = new Lenis({ lerp: 0.085, wheelMultiplier: 0.9 });
lenis.stop();
lenis.on('scroll', ScrollTrigger.update);
gsap.ticker.add((t) => lenis.raf(t * 1000));
gsap.ticker.lagSmoothing(0);
if (import.meta.env.DEV) window.__lenis = lenis;

$$('a[href^="#"]').forEach((a) =>
  a.addEventListener('click', (e) => {
    const id = a.getAttribute('href');
    const el = id === '#top' ? 0 : $(id);
    if (el === null) return;
    e.preventDefault();
    closeMenu();
    lenis.scrollTo(el, { duration: 1.8 });
  })
);

/* ---------------- nav ---------------- */
const nav = $('#nav');
let lastY = 0;
lenis.on('scroll', ({ scroll }) => {
  nav.classList.toggle('is-solid', scroll > 40);
  nav.classList.toggle('is-hidden', scroll > lastY && scroll > 300 && !menu.classList.contains('is-open'));
  lastY = scroll;
});
const menu = $('#menu');
const menuBtn = $('#menuBtn');
function closeMenu() {
  menu.classList.remove('is-open');
  menu.setAttribute('aria-hidden', 'true');
  menuBtn.setAttribute('aria-expanded', 'false');
}
menuBtn.addEventListener('click', () => {
  const open = !menu.classList.contains('is-open');
  menu.classList.toggle('is-open', open);
  menu.setAttribute('aria-hidden', String(!open));
  menuBtn.setAttribute('aria-expanded', String(open));
  $$('.menu__card').forEach((c, i) => (c.style.transitionDelay = open ? `${0.08 + i * 0.05}s` : '0s'));
});
addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeMenu(); closeFilm(); } });

$$('.nav__links a').forEach((a) => {
  const sec = $(a.getAttribute('href'));
  ScrollTrigger.create({ trigger: sec, start: 'top 50%', end: 'bottom 50%', onToggle: (s) => a.classList.toggle('is-active', s.isActive) });
});

/* ---------------- 3D stage ---------------- */
const stage = createStage($('#stage'));
const pctEl = $('#loaderPct');
const fill = $('.loader__logo-fill');
let shown = 0;
function setLoad(p) {
  shown = Math.max(shown, p);
  pctEl.textContent = String(Math.round(shown * 100)).padStart(3, '0');
  fill.style.clipPath = `inset(0 ${100 - shown * 100}% 0 0)`;
}

const sceneSections = $$('.scene3d');
const stageCanvas = $('#stage');
// Which 3D scene owns the canvas, and how visible it is. Each 3D section fades
// the canvas to black at its edges, so scene swaps always happen in darkness.
function pickScene() {
  let best = null, bestA = 0, bestEl = null;
  const h = innerHeight;
  sceneSections.forEach((s) => {
    const r = s.getBoundingClientRect();
    const a = Math.max(0, Math.min(r.bottom, h) - Math.max(r.top, 0));
    if (a > bestA) { bestA = a; best = s.dataset.scene; bestEl = s; }
  });
  stage.setActive(bestA > 2 ? best : null);
  if (!bestEl) return;
  const r = bestEl.getBoundingClientRect();
  const isFirst = bestEl.id === 'hero';
  const enter = isFirst ? 1 : clamp01((h * 0.65 - r.top) / (h * 0.55));
  const leave = clamp01((r.bottom - h * 0.35) / (h * 0.55));
  const v = Math.min(enter, leave);
  stageCanvas.style.opacity = (v * v * (3 - 2 * v)).toFixed(3);
}
lenis.on('scroll', pickScene);
addEventListener('resize', pickScene);

stage
  .loadHero((p) => setLoad(p * 0.96))
  .then((hero) => {
    setLoad(1);
    stage.start();
    pickScene();
    intro(hero);
    // lazy load the other two models once the hero is up
    stage.loadXray().then(pickScene);
    stage.loadInspect($('#inspect')).then(setupInspect);
  })
  .catch((err) => {
    console.error(err);
    setLoad(1);
    intro(null);
  });

function intro(hero) {
  const tl = gsap.timeline({
    onStart: () => { if (!location.hash) { scrollTo(0, 0); lenis.scrollTo(0, { immediate: true, force: true }); } },
    onComplete: () => {
      if (!location.hash && scrollY !== 0) { scrollTo(0, 0); lenis.scrollTo(0, { immediate: true, force: true }); }
      document.body.classList.remove('is-loading');
      lenis.start();
    },
  });
  tl.to('.loader__meta', { opacity: 0, duration: 0.4 }, 0.3)
    .to('.loader', { opacity: 0, duration: 1.0, ease: 'power2.inOut' }, 0.5)
    .set('.loader', { display: 'none' });
  if (hero) {
    const o = { v: 0 };
    tl.to(o, { v: 1, duration: 3.2, ease: 'power3.out', onUpdate: () => hero.intro(o.v) }, 0.5);
  }
  tl.fromTo('.hero__cap--intro', { autoAlpha: 0, y: 30 }, { autoAlpha: 1, y: 0, duration: 1.6, ease: 'power3.out' }, 1.1)
    .fromTo('.hero__logo img', { clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0% 0 0)', duration: 1.8, ease: 'power3.inOut' }, 1.0)
    .from('.nav', { y: -30, autoAlpha: 0, duration: 1, ease: 'power3.out' }, 1.6)
    .from('.hero__scroll', { autoAlpha: 0, duration: 1 }, 2);
}

/* ---------------- hero scroll ---------------- */
const caps = $$('.hero__cap');
ScrollTrigger.create({
  trigger: '#hero',
  start: 'top top',
  end: 'bottom bottom',
  onUpdate: (s) => {
    const p = s.progress;
    stage.scenes.hero?.setProgress(p);
    if (document.body.classList.contains('is-loading')) return;
    caps.forEach((c, i) => {
      const a = +c.dataset.from, b = +c.dataset.to;
      const v = i === 0
        ? clamp01((b - p) / 0.05)
        : Math.min(clamp01((p - a) / 0.04), clamp01((b - p) / 0.04));
      gsap.set(c, { autoAlpha: v, y: (1 - v) * (p < (a + b) / 2 ? 40 : -40) });
    });
    $('.hero__scroll').style.opacity = p > 0.02 ? 0 : 1;
  },
});
/* ---------------- film ---------------- */
const teaser = $('#filmTeaser');
const filmTl = gsap.timeline({ scrollTrigger: { trigger: '#film', start: 'top top', end: 'bottom bottom', scrub: true } });
filmTl
  .fromTo('#filmFrame', { clipPath: 'inset(22% 26% 22% 26% round 4px)' }, { clipPath: 'inset(0% 0% 0% 0% round 0px)', ease: 'none', duration: 0.6 })
  .fromTo('.film__video', { scale: 1.18 }, { scale: 1, ease: 'none', duration: 0.6 }, 0)
  .fromTo('.film__title', { y: 60, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.3 }, 0.25)
  .to({}, { duration: 0.4 });
ScrollTrigger.create({
  trigger: '#film', start: 'top bottom', end: 'bottom top',
  onToggle: (s) => (s.isActive ? teaser.play().catch(() => {}) : teaser.pause()),
});

const modal = $('#filmModal');
const full = $('#filmFull');
function openFilm() {
  modal.classList.add('is-open');
  modal.setAttribute('aria-hidden', 'false');
  lenis.stop();
  full.currentTime = 0;
  full.play().catch(() => {});
}
function closeFilm() {
  if (!modal.classList.contains('is-open')) return;
  modal.classList.remove('is-open');
  modal.setAttribute('aria-hidden', 'true');
  full.pause();
  lenis.start();
}
$('#filmPlay').addEventListener('click', openFilm);
$('#filmPlay2').addEventListener('click', openFilm);
$('#filmClose').addEventListener('click', closeFilm);

/* ---------------- aero modes ---------------- */
const aeroV = $('#aeroVideo');
const segs = $$('.seg');
ScrollTrigger.create({
  trigger: '.aero__stage', start: 'top 70%', end: 'bottom top',
  onToggle: (s) => (s.isActive ? aeroV.play().catch(() => {}) : aeroV.pause()),
});
segs.forEach((m) => m.addEventListener('click', () => { aeroV.currentTime = +m.dataset.t + 0.05; aeroV.play().catch(() => {}); }));
gsap.ticker.add(() => {
  if (aeroV.paused) return;
  const t = aeroV.currentTime;
  segs.forEach((m) => {
    const a = +m.dataset.t, b = +m.dataset.end;
    const on = t >= a && t < b;
    m.classList.toggle('is-active', on);
    m.setAttribute('aria-selected', String(on));
    m.querySelector('i').style.transform = `scaleX(${t >= b ? 1 : on ? (t - a) / (b - a) : 0})`;
  });
});
gsap.from('.aero__top > *', { scrollTrigger: { trigger: '.aero__stage', start: 'top 60%' }, y: 50, autoAlpha: 0, duration: 1.3, stagger: 0.08, ease: 'power3.out' });
gsap.from('.seg', { scrollTrigger: { trigger: '.aero__stage', start: 'top 40%' }, y: 30, autoAlpha: 0, duration: 1.1, stagger: 0.1, ease: 'power3.out' });
gsap.fromTo('.aero__video', { scale: 1.12 }, { scale: 1, ease: 'none', scrollTrigger: { trigger: '.aero__stage', start: 'top bottom', end: 'top top', scrub: true } });

/* ---------------- image reveals + parallax ---------------- */
$$('.reveal-img').forEach((fig) => {
  gsap.to(fig, { clipPath: 'inset(0% 0 0 0)', duration: 1.6, ease: 'expo.inOut', scrollTrigger: { trigger: fig, start: 'top 85%' } });
  const img = fig.querySelector('img');
  if (img && !reduced) gsap.fromTo(img, { yPercent: -8 }, { yPercent: 0, ease: 'none', scrollTrigger: { trigger: fig, start: 'top bottom', end: 'bottom top', scrub: true } });
});
$$('.detail__text').forEach((t) => {
  gsap.from(t.children, { scrollTrigger: { trigger: t, start: 'top 80%' }, y: 40, autoAlpha: 0, duration: 1.2, stagger: 0.07, ease: 'power3.out' });
});
$$('.section-head, .film__title h2, .cabin__cap').forEach((h) => {
  gsap.from(h.children, { scrollTrigger: { trigger: h, start: 'top 80%' }, y: 50, autoAlpha: 0, duration: 1.3, stagger: 0.08, ease: 'power3.out' });
});
gsap.fromTo('.cabin__img img', { yPercent: -10 }, { yPercent: 0, ease: 'none', scrollTrigger: { trigger: '.cabin', start: 'top bottom', end: 'bottom top', scrub: true } });
gsap.from('.cabin__strip img', { scrollTrigger: { trigger: '.cabin__strip', start: 'top 85%' }, y: 60, autoAlpha: 0, duration: 1.2, stagger: 0.08, ease: 'power3.out' });

/* ---------------- xray ---------------- */
const xrayItems = $$('#xrayList li');
const xrayPct = $('#xrayPct');
ScrollTrigger.create({
  trigger: '#xray', start: 'top top', end: 'bottom bottom',
  onUpdate: (s) => stage.scenes.xray?.setProgress(s.progress),
});
gsap.fromTo('.xray__sticky > *', { autoAlpha: 1, y: 0 }, { autoAlpha: 0, y: -30, ease: 'power1.in', stagger: 0.03, scrollTrigger: { trigger: '#xray', start: 'bottom 135%', end: 'bottom 95%', scrub: true } });
gsap.from('.xray__sticky > *', { autoAlpha: 0, y: 30, stagger: 0.05, duration: 1.1, ease: 'power3.out', scrollTrigger: { trigger: '#xray', start: 'top 55%' } });
gsap.from('.inspect__ui > *', { autoAlpha: 0, y: 30, stagger: 0.08, duration: 1.2, ease: 'power3.out', scrollTrigger: { trigger: '#inspect', start: 'top 35%' } });
gsap.ticker.add(() => {
  const x = stage.scenes.xray;
  if (!x) return;
  const s = x.scan();
  xrayPct.textContent = Math.round(s * 100) + '%';
  xrayItems.forEach((li, i) => {
    const a = +li.dataset.x, b = xrayItems[i + 1] ? +xrayItems[i + 1].dataset.x : 1.01;
    li.classList.toggle('is-on', s > 0.001 && s >= a && s < b);
  });
});

/* ---------------- inspect ---------------- */
function setupInspect(ins) {
  const wrap = $('#inspectViews');
  // OrbitControls listens on the whole section and captures the pointer on press,
  // which would swallow the button click. Keep UI presses away from it.
  $$('.inspect__views, .inspect__head').forEach((el) => el.addEventListener('pointerdown', (e) => e.stopPropagation()));
  ins.views.forEach((v, i) => {
    const b = document.createElement('button');
    b.className = 'view-btn' + (i === 0 ? ' is-active' : '');
    b.textContent = v.label;
    b.addEventListener('click', () => {
      $$('.view-btn', wrap).forEach((x) => x.classList.remove('is-active'));
      b.classList.add('is-active');
      ins.go(i);
    });
    wrap.appendChild(b);
  });
  ins.controls.addEventListener('start', () => $$('.view-btn', wrap).forEach((x) => x.classList.remove('is-active')));
  pickScene();
}

/* ---------------- studio flipbook ---------------- */
const frames = $$('#studioFrames img');
const ticks = $('#studioTicks');
frames.forEach(() => ticks.appendChild(document.createElement('i')));
const tickEls = $$('i', ticks);
let lastIdx = -1;
ScrollTrigger.create({
  trigger: '#studio', start: 'top top', end: 'bottom bottom',
  onUpdate: (s) => {
    const idx = Math.min(frames.length - 1, Math.floor(s.progress * frames.length));
    if (idx === lastIdx) return;
    lastIdx = idx;
    frames.forEach((f, i) => f.classList.toggle('is-on', i === idx));
    tickEls.forEach((t, i) => t.classList.toggle('is-on', i <= idx));
    $('#studioIdx').textContent = String(idx + 1).padStart(2, '0');
  },
});
frames[0].classList.add('is-on');
tickEls[0].classList.add('is-on');

/* ---------------- gravity ---------------- */
const loopV = $('#loopVideo');
ScrollTrigger.create({
  trigger: '.gravity__video', start: 'top 80%', end: 'bottom top',
  onToggle: (s) => (s.isActive ? loopV.play().catch(() => {}) : loopV.pause()),
});
$('#loopSound').addEventListener('click', (e) => {
  loopV.muted = !loopV.muted;
  e.currentTarget.classList.toggle('is-sound', !loopV.muted);
  $('#loopSoundLabel').textContent = loopV.muted ? 'Sound on' : 'Sound off';
  if (!loopV.muted) loopV.play().catch(() => {});
});
gsap.from('.gravity__copy > *', { scrollTrigger: { trigger: '.gravity__copy', start: 'top 85%' }, y: 60, autoAlpha: 0, duration: 1.4, stagger: 0.1, ease: 'power3.out' });

/* ---------------- world horizontal ---------------- */
const track = $('#worldTrack');
const worldTween = gsap.to(track, {
  x: () => -(track.scrollWidth - innerWidth),
  ease: 'none',
  scrollTrigger: { trigger: '#world', start: 'top top', end: () => '+=' + (track.scrollWidth - innerWidth), pin: '.world__sticky', scrub: 0.6, invalidateOnRefresh: true },
});
$$('.wcard img').forEach((img) => {
  gsap.fromTo(img, { scale: 1.15 }, { scale: 1, ease: 'none', scrollTrigger: { trigger: img, containerAnimation: worldTween, start: 'left right', end: 'right left', scrub: true } });
});

/* ---------------- orbit + reserve: one continuous ending ---------------- */
// orbit: pull back from the close-up, raise the headline, then dissolve to black
const orbitTl = gsap.timeline({ scrollTrigger: { trigger: '#orbit', start: 'top top', end: 'bottom bottom', scrub: 0.8 } });
orbitTl
  .fromTo('.orbit__bg', { scale: 1.45, filter: 'brightness(0.35)' }, { scale: 1, filter: 'brightness(1)', ease: 'power2.out', duration: 0.55 }, 0)
  .fromTo('.orbit__eyebrow', { autoAlpha: 0, y: 20 }, { autoAlpha: 1, y: 0, duration: 0.1 }, 0.12)
  .fromTo('.orbit__copy .line > span', { yPercent: 110 }, { yPercent: 0, ease: 'power3.out', duration: 0.22, stagger: 0.06 }, 0.15)
  .fromTo('.orbit__body', { autoAlpha: 0, y: 24 }, { autoAlpha: 1, y: 0, duration: 0.12 }, 0.32)
  .to('.orbit__copy', { y: -60, autoAlpha: 0, ease: 'power2.in', duration: 0.18 }, 0.72)
  .to('.orbit__bg', { scale: 0.92, ease: 'power1.in', duration: 0.28 }, 0.72)
  .to('.orbit__black', { opacity: 1, ease: 'none', duration: 0.2 }, 0.8);
// gentle drift so the frame is never fully still
gsap.to('.orbit__bg img', { rotate: 1.2, duration: 18, ease: 'sine.inOut', yoyo: true, repeat: -1 });

// reserve: the light beam ignites out of black, the wordmark wipes in, CTAs settle
const resTl = gsap.timeline({ scrollTrigger: { trigger: '#reserve', start: 'top top', end: 'bottom bottom', scrub: 0.8 } });
resTl
  .fromTo('.reserve__bg', { autoAlpha: 0, scale: 1.18, filter: 'brightness(0.2) contrast(1.2)' }, { autoAlpha: 0.85, scale: 1, filter: 'brightness(1) contrast(1)', ease: 'power2.out', duration: 0.45 }, 0)
  .fromTo('.reserve__eyebrow', { autoAlpha: 0, y: 16 }, { autoAlpha: 1, y: 0, duration: 0.1 }, 0.3)
  .fromTo('.reserve__logo', { clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0% 0 0)', ease: 'power2.inOut', duration: 0.3 }, 0.32)
  .fromTo('.reserve__tag', { autoAlpha: 0, y: 20 }, { autoAlpha: 1, y: 0, duration: 0.12 }, 0.55)
  .fromTo('.reserve__ctas', { autoAlpha: 0, y: 24 }, { autoAlpha: 1, y: 0, duration: 0.14 }, 0.62)
  .to({}, { duration: 0.24 });
gsap.from('.footer__inner > *', { scrollTrigger: { trigger: '.footer', start: 'top 95%' }, y: 20, autoAlpha: 0, duration: 1, stagger: 0.08, ease: 'power3.out' });

addEventListener('load', () => {
  // browsers may restore an old position after load; the intro always starts at the top
  if (!location.hash && document.body.classList.contains('is-loading')) lenis.scrollTo(0, { immediate: true, force: true });
  ScrollTrigger.refresh();
});
