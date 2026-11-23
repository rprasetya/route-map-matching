declare global {
  interface Window {
    RMM_I18N?: Record<string, string>;
  }
}

export const STORAGE_KEY = 'rmm.lang';

export const t = (key: string): string => window.RMM_I18N?.[key] ?? key;

export function languageMenu(): void {
  const select = document.getElementById('lang') as HTMLSelectElement | null;
  if (!select) return;
  select.addEventListener('change', () => {
    const code = select.selectedOptions[0]?.dataset.code ?? 'en';
    try {
      localStorage.setItem(STORAGE_KEY, code);
    } catch {}
    location.href = select.value + location.hash;
  });
}
