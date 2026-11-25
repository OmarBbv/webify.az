#!/usr/bin/env node
/**
 * Saytın SEO və bütövlük yoxlaması.
 *
 * İstifadəsi:  node --experimental-strip-types tools/seo-check.ts
 *
 * Bütün yayımlanan HTML səhifələri yoxlayır (test.html istisna). Xəta tapılsa, exit kodu 1 olur;
 * gündəlik SEO agenti bu halda main-ə push etmir.
 *   Xəta:        title/description yoxdur, H1 sayı 1 deyil, JSON-LD parse olunmur, daxili link
 *                mövcud olmayan səhifəyə gedir, sitemap-dəki URL-in faylı yoxdur.
 *   Xəbərdarlıq: title/description uzunluğu, şəkildə alt yoxdur.
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SKIP_FILES = new Set(['test.html']);
const SKIP_DIRS = new Set(['node_modules', 'tools', 'content', 'tests', '.git', '.claude', 'images', 'css', 'js', 'webfonts']);

interface Issue {
  file: string;
  message: string;
}

class SiteChecker {
  readonly errors: Issue[] = [];
  readonly warnings: Issue[] = [];

  /** Yayımlanan bütün .html faylları (kök, bloq/, ru/ və s.). */
  listPages(dir: string = ROOT): string[] {
    const out: string[] = [];
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        if (!SKIP_DIRS.has(name) && !name.startsWith('.')) out.push(...this.listPages(full));
      } else if (name.endsWith('.html') && !SKIP_FILES.has(name)) out.push(full);
    }
    return out;
  }

  /** cleanUrls: /bloq/x → bloq/x.html və ya bloq/x/index.html; / → index.html. */
  static resolvesToFile(urlPath: string): boolean {
    const clean = decodeURIComponent(urlPath.split(/[?#]/)[0] ?? '').replace(/^\/+/, '').replace(/\/+$/, '');
    if (clean === '') return existsSync(join(ROOT, 'index.html'));
    const candidates = [clean, `${clean}.html`, join(clean, 'index.html')];
    return candidates.some((c) => existsSync(join(ROOT, c)) && statSync(join(ROOT, c)).isFile());
  }

  private error(file: string, message: string): void {
    this.errors.push({ file, message });
  }

  private warn(file: string, message: string): void {
    this.warnings.push({ file, message });
  }

  checkPage(full: string): void {
    const file = relative(ROOT, full);
    const html = readFileSync(full, 'utf8');
    const isErrorPage = file === '404.html';

    const title = /<title>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim() ?? '';
    if (!title) this.error(file, 'title yoxdur');
    else if (title.length > 70) this.warn(file, `title uzundur (${title.length})`);

    const desc = /<meta\s+name="description"\s+content="([^"]*)"/i.exec(html)?.[1] ?? '';
    if (!desc && !isErrorPage) this.error(file, 'meta description yoxdur');
    else if (desc && (desc.length < 70 || desc.length > 170)) this.warn(file, `description uzunluğu ${desc.length}`);

    const h1Count = (html.match(/<h1[\s>]/gi) ?? []).length;
    if (h1Count !== 1 && !isErrorPage) this.error(file, `H1 sayı ${h1Count}`);

    for (const m of html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)) {
      try {
        JSON.parse(m[1] ?? '');
      } catch {
        this.error(file, 'JSON-LD parse olunmur');
      }
    }

    // HTML şərhlərindəki və <script> içindəki (JS şablonları) linkləri saymırıq.
    const body = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<script[\s\S]*?<\/script>/gi, '');
    for (const m of body.matchAll(/<a\s[^>]*href="([^"]+)"/gi)) {
      const href = m[1] ?? '';
      if (/^(https?:|mailto:|tel:|#|javascript:|\/\/)/i.test(href)) {
        const internal = /^https?:\/\/(www\.)?webify\.az(\/[^"]*)?$/i.exec(href);
        if (internal && !SiteChecker.resolvesToFile(internal[2] ?? '/')) this.error(file, `sınıq link: ${href}`);
        continue;
      }
      const target = href.startsWith('/') ? href : `/${join(dirname(file), href)}`;
      if (!SiteChecker.resolvesToFile(target)) this.error(file, `sınıq link: ${href}`);
    }

    for (const m of body.matchAll(/<img\s[^>]*>/gi)) {
      if (!/\salt="/i.test(m[0])) this.warn(file, `alt atributu yoxdur: ${m[0].slice(0, 80)}`);
    }
  }

  checkSitemap(): void {
    const file = 'sitemap.xml';
    const xml = readFileSync(join(ROOT, file), 'utf8');
    for (const m of xml.matchAll(/<loc>https:\/\/www\.webify\.az(\/[^<]*)<\/loc>/g)) {
      if (!SiteChecker.resolvesToFile(m[1] ?? '/')) this.error(file, `faylı olmayan URL: ${m[1]}`);
    }
  }

  run(): number {
    const pages = this.listPages();
    for (const page of pages) this.checkPage(page);
    this.checkSitemap();
    for (const w of this.warnings) console.log(`xəbərdarlıq  ${w.file}: ${w.message}`);
    for (const e of this.errors) console.log(`XƏTA         ${e.file}: ${e.message}`);
    console.log(`\n${pages.length} səhifə yoxlandı: ${this.errors.length} xəta, ${this.warnings.length} xəbərdarlıq.`);
    return this.errors.length ? 1 : 0;
  }
}

process.exit(new SiteChecker().run());
