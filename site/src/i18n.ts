declare global {
  interface Window {
    RMM_I18N?: Record<string, string>;
  }
}

export const STORAGE_KEY = 'rmm.lang';

export const t = (key: string): string => window.RMM_I18N?.[key] ?? key;

export function languageMenu(): void {
  const button = document.getElementById('lang-button') as HTMLButtonElement | null;
  const menu = document.getElementById('lang-menu');
  const root = button?.parentElement;
  if (!button || !menu || !root) return;
  const links = Array.from(menu.querySelectorAll<HTMLAnchorElement>('a'));
  const current = () => links.find((l) => l.hasAttribute('aria-current')) ?? links[0];

  const open = (focus?: HTMLAnchorElement) => {
    menu.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    focus?.focus({ preventScroll: true });
  };
  const close = (returnFocus = false) => {
    if (menu.hidden) return;
    menu.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    if (returnFocus) button.focus({ preventScroll: true });
  };

  button.addEventListener('click', (e) => {
    if (!menu.hidden) close();
    else open(e.detail === 0 ? current() : undefined);
  });
  button.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      open(current());
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      open(links[links.length - 1]);
    } else if (e.key === 'Escape') close();
  });
  menu.addEventListener('keydown', (e) => {
    const i = links.indexOf(document.activeElement as HTMLAnchorElement);
    const move: Record<string, number> = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: links.length - 1 };
    if (e.key in move) {
      e.preventDefault();
      links[(move[e.key] + links.length) % links.length].focus({ preventScroll: true });
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close(true);
    } else if (e.key === 'Tab') close();
  });
  document.addEventListener('click', (e) => {
    if (!root.contains(e.target as Node)) close();
  });
  for (const link of links) {
    link.addEventListener('click', (e) => {
      try {
        localStorage.setItem(STORAGE_KEY, link.dataset.code ?? 'en');
      } catch {}
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
      e.preventDefault();
      location.href = (link.getAttribute('href') ?? '/') + location.hash;
    });
  }
}
