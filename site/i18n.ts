import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';

export const SITE = 'https://route-map-matching.vercel.app';

export interface Language {
  code: string;
  tag: string;
  name: string;
  locale: string;
  rtl?: boolean;
}

export const LANGUAGES: Language[] = [
  { code: 'en', tag: 'en', name: 'English', locale: 'en_US' },
  { code: 'id', tag: 'id', name: 'Indonesia', locale: 'id_ID' },
  { code: 'zh', tag: 'zh-Hans', name: '中文', locale: 'zh_CN' },
  { code: 'hi', tag: 'hi', name: 'हिन्दी', locale: 'hi_IN' },
  { code: 'es', tag: 'es', name: 'Español', locale: 'es_ES' },
  { code: 'fr', tag: 'fr', name: 'Français', locale: 'fr_FR' },
  { code: 'ar', tag: 'ar', name: 'العربية', locale: 'ar_AR', rtl: true },
  { code: 'pt', tag: 'pt', name: 'Português', locale: 'pt_BR' },
];

const here = fileURLToPath(new URL('.', import.meta.url));
const repo = resolve(here, '..');

type Dict = Record<string, string>;

const pathOf = (code: string) => (code === 'en' ? '/' : `/${code}/`);
const urlOf = (code: string) => `${SITE}${pathOf(code)}`;
const escapeText = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escapeAttr = (s: string) => escapeText(s).replace(/"/g, '&quot;');

function dictionary(code: string): Dict {
  const read = (c: string): Dict => JSON.parse(readFileSync(join(here, 'locales', `${c}.json`), 'utf8'));
  const en = read('en');
  if (code === 'en') return en;
  try {
    return { ...en, ...read(code) };
  } catch {
    return en;
  }
}

function seo(lang: Language, t: Dict): string {
  const pkg = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8'));
  const url = urlOf(lang.code);
  const image = `${SITE}/og.png`;
  const graph = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebSite',
        '@id': `${SITE}/#website`,
        url: `${SITE}/`,
        name: 'route-map-matching',
        inLanguage: LANGUAGES.map((l) => l.tag),
      },
      {
        '@type': 'WebPage',
        '@id': `${url}#webpage`,
        url,
        name: t['meta.title'],
        description: t['meta.description'],
        inLanguage: lang.tag,
        isPartOf: { '@id': `${SITE}/#website` },
        about: { '@id': `${SITE}/#software` },
        primaryImageOfPage: image,
      },
      {
        '@type': 'SoftwareSourceCode',
        '@id': `${SITE}/#software`,
        name: 'route-map-matching',
        description: t['meta.description'],
        url: `${SITE}/`,
        codeRepository: 'https://github.com/rprasetya/route-map-matching',
        programmingLanguage: ['TypeScript', 'JavaScript', 'PHP'],
        runtimePlatform: ['Node.js 18+', 'Web browser', 'PHP 8.2+'],
        version: pkg.version,
        license: 'https://opensource.org/licenses/MIT',
        keywords: 'map matching, GPS, snap to road, hidden Markov model, Viterbi, vector tiles, MapLibre, TypeScript, JavaScript, PHP',
        author: { '@type': 'Person', name: 'Raya Prasetya', url: 'https://github.com/rprasetya' },
        sameAs: ['https://github.com/rprasetya/route-map-matching', 'https://www.npmjs.com/package/route-map-matching'],
      },
    ],
  };
  const lines = [
    `<link rel="canonical" href="${url}" />`,
    ...LANGUAGES.map((l) => `<link rel="alternate" hreflang="${l.tag}" href="${urlOf(l.code)}" />`),
    `<link rel="alternate" hreflang="x-default" href="${urlOf('en')}" />`,
    `<meta property="og:url" content="${url}" />`,
    `<meta property="og:locale" content="${lang.locale}" />`,
    ...LANGUAGES.filter((l) => l.code !== lang.code).map((l) => `<meta property="og:locale:alternate" content="${l.locale}" />`),
    `<meta property="og:image" content="${image}" />`,
    '<meta property="og:image:width" content="1200" />',
    '<meta property="og:image:height" content="630" />',
    `<meta property="og:image:alt" content="${escapeAttr(t['hero.title'])}" />`,
    '<meta name="twitter:card" content="summary_large_image" />',
    `<meta name="twitter:title" content="${escapeAttr(t['meta.title'])}" />`,
    `<meta name="twitter:description" content="${escapeAttr(t['meta.ogDescription'])}" />`,
    `<meta name="twitter:image" content="${image}" />`,
    `<script type="application/ld+json">${JSON.stringify(graph).replace(/</g, '\\u003c')}</script>`,
  ];
  return lines.join('\n    ');
}

function runtime(t: Dict): string {
  const subset: Dict = {};
  for (const [key, value] of Object.entries(t)) if (key.startsWith('common.') || key.startsWith('demo.')) subset[key] = value;
  return `<script>window.RMM_I18N=${JSON.stringify(subset).replace(/</g, '\\u003c')}</script>`;
}

function options(current: Language): string {
  const check = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>';
  return LANGUAGES.map((l) => {
    const active = l.code === current.code;
    return `<li><a href="${pathOf(l.code)}" hreflang="${l.tag}" lang="${l.tag}" data-code="${l.code}"${active ? ' aria-current="true"' : ''}><span>${l.name}</span>${active ? check : ''}</a></li>`;
  }).join('');
}

export function render(html: string, code: string): string {
  const lang = LANGUAGES.find((l) => l.code === code) ?? LANGUAGES[0];
  const t = dictionary(lang.code);
  const get = (key: string) => {
    const value = t[key];
    if (value === undefined) throw new Error(`Missing translation key ${key}`);
    return value;
  };
  let out = html
    .replace(/<html[^>]*>/, `<html lang="${lang.tag}" dir="${lang.rtl ? 'rtl' : 'ltr'}" data-page-lang="${lang.code}">`)
    .replace(/(<(\w+)\b[^>]*?\sdata-i18n="([^"]+)"[^>]*>)[\s\S]*?(<\/\2>)/g, (_m, open, _tag, key, close) => `${open}${escapeText(get(key))}${close}`)
    .replace(/(<(\w+)\b[^>]*?\sdata-i18n-html="([^"]+)"[^>]*>)[\s\S]*?(<\/\2>)/g, (_m, open, _tag, key, close) => `${open}${get(key)}${close}`)
    .replace(/<[^>]*\sdata-i18n-attr="([^"]+)"[^>]*>/g, (tag, spec: string) => {
      let result = tag;
      for (const pair of spec.split(';')) {
        const [attr, key] = pair.split(':');
        const value = escapeAttr(get(key));
        const pattern = new RegExp(`\\s${attr}="[^"]*"`);
        result = pattern.test(result) ? result.replace(pattern, ` ${attr}="${value}"`) : result.replace(/\s*\/?>$/, (end) => ` ${attr}="${value}"${end}`);
      }
      return result;
    })
    .replace('<!--lang-options-->', options(lang))
    .replace(/(<span class="lang-name"[^>]*>)[^<]*(<\/span>)/, `$1${lang.name}$2`)
    .replace(/(<span class="lang-code"[^>]*>)[^<]*(<\/span>)/, `$1${lang.code.toUpperCase()}$2`)
    .replace('<!--seo-->', seo(lang, t))
    .replace('</head>', `    ${runtime(t)}\n  </head>`)
    .replace(/\sdata-i18n(?:-html|-attr)?="[^"]*"/g, '');
  if (lang.code !== 'en') out = out.replace(/(=")\.\/(assets\/)/g, '$1../$2');
  return out;
}

function sitemap(): string {
  const day = new Date().toISOString().slice(0, 10);
  const urls = LANGUAGES.map((l) => `  <url>\n    <loc>${urlOf(l.code)}</loc>\n    <lastmod>${day}</lastmod>\n  </url>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

export function i18n(): Plugin {
  let outDir = '';
  let template = '';
  return {
    name: 'site-i18n',
    enforce: 'post',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        if (ctx.server) {
          const code = (ctx.originalUrl ?? '/').split('/')[1] ?? '';
          return render(html, LANGUAGES.some((l) => l.code === code) ? code : 'en');
        }
        template = html;
        return render(html, 'en');
      },
    },
    closeBundle() {
      if (!template) return;
      for (const lang of LANGUAGES) {
        if (lang.code === 'en') continue;
        mkdirSync(join(outDir, lang.code), { recursive: true });
        writeFileSync(join(outDir, lang.code, 'index.html'), render(template, lang.code));
      }
      writeFileSync(join(outDir, 'sitemap.xml'), sitemap());
      writeFileSync(join(outDir, 'llms-full.txt'), readFileSync(join(repo, 'README.md'), 'utf8'));
    },
  };
}
