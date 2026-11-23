import 'maplibre-gl/dist/maplibre-gl.css';
import './style.css';
import maplibregl from 'maplibre-gl';
import { leftHandTrafficPolygons } from 'route-map-matching/traffic-side';
import { startDemo } from './demo';

function copyButtons(): void {
  const flash = (el: HTMLElement, label: string) => {
    const old = el.textContent;
    el.textContent = label;
    setTimeout(() => (el.textContent = old), 1400);
  };
  document.querySelectorAll<HTMLButtonElement>('[data-copy]').forEach((b) => {
    b.addEventListener('click', async () => {
      await navigator.clipboard?.writeText(b.dataset.copy ?? '');
      const tag = b.querySelector('i');
      if (tag) flash(tag, 'Copied');
    });
  });
  document.querySelectorAll<HTMLButtonElement>('.copy-code').forEach((b) => {
    b.addEventListener('click', async () => {
      const code = b.closest('.code')?.querySelector('code')?.textContent ?? '';
      await navigator.clipboard?.writeText(code);
      flash(b, 'Copied');
    });
  });
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
      cooperativeGestures: true,
    });
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
startDemo();
sideMap();
