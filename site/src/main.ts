import 'maplibre-gl/dist/maplibre-gl.css';
import './style.css';
import maplibregl from 'maplibre-gl';
import { leftHandTrafficPolygons } from 'route-map-matching/traffic-side';
import { startDemo } from './demo';
import { languageMenu, t } from './i18n';

function copyButtons(): void {
  const flash = (el: HTMLElement) => {
    el.textContent = t('common.copied');
    setTimeout(() => (el.textContent = t('common.copy')), 1400);
  };
  document.querySelectorAll<HTMLButtonElement>('[data-copy]').forEach((b) => {
    b.addEventListener('click', async () => {
      await navigator.clipboard?.writeText(b.dataset.copy ?? '');
      const tag = b.querySelector('i');
      if (tag) flash(tag);
    });
  });
  document.querySelectorAll<HTMLButtonElement>('.copy-code').forEach((b) => {
    b.addEventListener('click', async () => {
      const code = b.closest('.code')?.querySelector('pre:not([hidden]) code')?.textContent ?? '';
      await navigator.clipboard?.writeText(code);
      flash(b);
    });
  });
}

function codeTabs(): void {
  document.querySelectorAll<HTMLElement>('[role="tablist"]').forEach((list) => {
    const tabs = Array.from(list.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
    const select = (tab: HTMLButtonElement) => {
      for (const t of tabs) {
        const active = t === tab;
        t.setAttribute('aria-selected', String(active));
        t.tabIndex = active ? 0 : -1;
        const panel = document.getElementById(t.getAttribute('aria-controls') ?? '');
        if (panel) panel.hidden = !active;
      }
    };
    tabs.forEach((tab, i) => {
      tab.addEventListener('click', () => select(tab));
      tab.addEventListener('keydown', (e) => {
        const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
        if (!step) return;
        e.preventDefault();
        const next = tabs[(i + step + tabs.length) % tabs.length];
        select(next);
        next.focus();
      });
    });
  });
}

function mobileMenu(): void {
  const button = document.getElementById('menu-button') as HTMLButtonElement | null;
  const menu = document.getElementById('mobile-menu');
  if (!button || !menu) return;
  const links = Array.from(menu.querySelectorAll<HTMLAnchorElement>('a'));
  const set = (open: boolean, returnFocus = false) => {
    menu.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
    document.documentElement.classList.toggle('menu-open', open);
    if (open) links[0]?.focus({ preventScroll: true });
    else if (returnFocus) button.focus({ preventScroll: true });
  };
  button.addEventListener('click', () => set(menu.hidden));
  menu.addEventListener('click', (e) => {
    if ((e.target as Element).closest('a')) set(false);
  });
  document.addEventListener('keydown', (e) => {
    if (menu.hidden) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      set(false, true);
    } else if (e.key === 'Tab') {
      const order = [button, ...links];
      const i = order.indexOf(document.activeElement as HTMLButtonElement | HTMLAnchorElement);
      const next = e.shiftKey ? (i <= 0 ? order.length - 1 : i - 1) : i === order.length - 1 ? 0 : i + 1;
      e.preventDefault();
      order[next].focus({ preventScroll: true });
    }
  });
  matchMedia('(min-width: 761px)').addEventListener('change', (e) => {
    if (e.matches) set(false);
  });
}

function currentSection(): void {
  const links = Array.from(document.querySelectorAll<HTMLAnchorElement>('.nav-links a[href^="#"], .mobile-menu a[href^="#"]'));
  const sections = Array.from(document.querySelectorAll<HTMLElement>('main > section[id]'));
  if (!links.length || !sections.length) return;
  const mark = (id: string | null) => {
    for (const link of links) {
      if (link.getAttribute('href') === `#${id}`) link.setAttribute('aria-current', 'true');
      else link.removeAttribute('aria-current');
    }
  };
  const io = new IntersectionObserver(
    (entries) => {
      const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (visible) mark(visible.target.id);
    },
    { rootMargin: '-40% 0px -55% 0px' },
  );
  for (const section of sections) io.observe(section);
}

function sideMap(): void {
  const container = document.getElementById('side-map');
  if (!container) return;
  const start = () => {
    const map = new maplibregl.Map({
      container,
      style: 'https://tiles.openfreemap.org/styles/positron',
      center: [100, 5],
      zoom: 1.4,
      attributionControl: { compact: true },
      maxPitch: 0,
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
    });
    map.touchZoomRotate.disableRotation();
    map.keyboard.disableRotation();
    map.on('load', () => {
      map.addSource('left', {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: leftHandTrafficPolygons().map((coordinates) => ({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates } })),
        },
      });
      map.addLayer({ id: 'left-fill', type: 'fill', source: 'left', paint: { 'fill-color': '#d4900f', 'fill-opacity': 0.32 } });
      map.addLayer({ id: 'left-line', type: 'line', source: 'left', paint: { 'line-color': '#b8780a', 'line-width': 0.8 } });
    });
  };
  const io = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) {
      io.disconnect();
      start();
    }
  }, { rootMargin: '400px' });
  io.observe(container);
}

copyButtons();
codeTabs();
languageMenu();
mobileMenu();
currentSection();
startDemo();
sideMap();
