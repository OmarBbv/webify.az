#!/usr/bin/env node
/**
 * Bloq generatoru.
 *
 * İstifadəsi:  node tools/build-blog.mjs
 *
 * `content/posts/*.json` fayllarındakı məqalələrdən hazır HTML səhifələr yaradır:
 *   bloq/index.html          — bloq siyahısı  (/bloq)
 *   bloq/<slug>.html         — məqalə         (/bloq/<slug>)
 * və `sitemap.xml` faylını yeniləyir.
 *
 * Səhifələr HTML kimi yaradılır (JS ilə render olunmur), çünki Google hər məqalənin
 * başlığını, təsvirini və schema-sını birbaşa mənbə kodunda görməlidir.
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = 'https://www.webify.az/';
const BLOG_TITLE = 'Bloq – Sayt yaradılması və rəqəmsal marketinq | Webify';
const BLOG_DESC =
  'Sayt yaradılması, qiymətlər, domen və hostinq, SEO və onlayn satış haqqında Azərbaycan dilində praktik məqalələr. Webify komandasının təcrübəsi.';

// Hər məqalə `content/posts/` qovluğunda ayrıca JSON faylıdır.
// Yeni məqalə üçün yeni fayl yaradıb bu skripti işə salmaq kifayətdir.
const POSTS_DIR = join(ROOT, 'content/posts');
const posts = readdirSync(POSTS_DIR)
  .filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(join(POSTS_DIR, f), 'utf8')))
  .sort((a, b) => (a.date === b.date ? a.slug.localeCompare(b.slug) : a.date < b.date ? 1 : -1));
const top = readFileSync(join(ROOT, 'tools/_template-top.html'), 'utf8');
const bottom = readFileSync(join(ROOT, 'tools/_template-bottom.html'), 'utf8');

const headEnd = top.indexOf('</head>');
const headRaw = top.slice(top.indexOf('<head>') + 6, headEnd);
const bodyStart = top.slice(headEnd + '</head>'.length);

// Şablonun head hissəsindən yalnız ortaq sətirləri (css, font, favicon) götürürük:
// əvvəlcə bütün <script> bloklarını (schema daxil) tam çıxarırıq, sonra səhifəyə xas
// meta sətirlərini atırıq. Qalan hissə hər səhifədə eyni olan resurslardır.
const sharedHead = headRaw
  // schema, inline skript və şablonun öz <style> bloku — bunları özümüz yazırıq
  .replace(/[ \t]*<script[\s\S]*?<\/script>[ \t]*\r?\n?/g, '')
  .replace(/[ \t]*<style[\s\S]*?<\/style>[ \t]*\r?\n?/g, '')
  // səhifəyə xas və ya özümüzün yazdığımız meta teqlər (bir və ya çox sətirli)
  .replace(/[ \t]*<meta\s+(charset|http-equiv|name="viewport")[\s\S]*?\/>[ \t]*\r?\n?/g, '')
  .split('\n')
  .filter((l) => {
    const t = l.trim();
    if (!t || t.startsWith('<!--')) return false;
    return !/<title>|rel="canonical"|name="description"|name="author"|property="og:|name="twitter:|name="robots"/.test(t);
  })
  .join('\n');
if (/"@type"|"@context"|<script|<title>/.test(sharedHead)) {
  console.error('XƏTA: şablonun head hissəsində artıq məzmun qaldı:\n' + sharedHead);
  process.exit(1);
}

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const AZ_MONTHS = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avqust', 'sentyabr', 'oktyabr', 'noyabr', 'dekabr'];
const azDate = (iso) => {
  const d = new Date(iso);
  return `${d.getDate()} ${AZ_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
};

function head({ title, desc, url, schemas, ogType = 'article' }) {
  const ld = schemas
    .map((s) => `    <script type="application/ld+json">\n${JSON.stringify(s, null, 2).split('\n').map((l) => '      ' + l).join('\n')}\n    </script>`)
    .join('\n');
  return `<!DOCTYPE html>
<html lang="az">
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="X-UA-Compatible" content="IE=edge" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1" />
    <meta name="description" content="${esc(desc)}" />
    <meta name="author" content="Webify" />
    <title>${esc(title)}</title>
    <link rel="canonical" href="${url}" />
${sharedHead}
    <meta property="og:type" content="${ogType}" />
    <meta property="og:site_name" content="Webify" />
    <meta property="og:locale" content="az_AZ" />
    <meta property="og:url" content="${url}" />
    <meta property="og:title" content="${esc(title)}" />
    <meta property="og:description" content="${esc(desc)}" />
    <meta property="og:image" content="${BASE}images/og-image.jpg" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta name="twitter:card" content="summary_large_image" />
${ld}
  </head>`;
}

function pageHeader({ h1, crumbs }) {
  const items = crumbs
    .map((c, i) =>
      i === crumbs.length - 1
        ? `                  <li class="breadcrumb-item active" aria-current="page">\n                    ${c.name}\n                  </li>`
        : `                  <li class="breadcrumb-item">\n                    <a href="${c.url}">${c.name}</a>\n                  </li>`
    )
    .join('\n');
  return `    <!-- Page Header Start -->
    <div class="page-header bg-section">
      <div class="container">
        <div class="row">
          <div class="col-lg-12">
            <div class="page-header-box">
              <h1 class="text-anime-style-2" data-cursor="-opaque">
                ${h1}
              </h1>
              <nav class="wow fadeInUp" data-wow-delay="0.25s">
                <ol class="breadcrumb">
${items}
                </ol>
              </nav>
            </div>
          </div>
        </div>
      </div>
    </div>
    <!-- Page Header End -->

`;
}

const BLOG_CSS = `    <style>
      .seo-landing { padding: 100px 0; }
      .seo-landing-alt { background: var(--secondary-color); }
      .seo-landing-text p { line-height: 1.7em; margin-bottom: 20px; }
      .seo-landing-text h2 { font-size: 30px; margin: 40px 0 18px; }
      .seo-landing-text h2:first-child { margin-top: 0; }
      .seo-landing-text a { color: var(--accent-color); text-decoration: underline; }
      .seo-landing-list { list-style: none; padding: 0; margin: 0 0 24px; }
      .seo-landing-list li { position: relative; padding: 0 0 14px 32px; line-height: 1.6em; }
      .seo-landing-list li::before { content: "\\2713"; position: absolute; left: 0; top: 0; color: var(--accent-color); font-weight: 700; }
      .post-meta { color: var(--text-color); font-size: 14px; margin-bottom: 30px; }
      .post-card { display: block; height: 100%; padding: 30px; border: 1px solid var(--divider-color); border-radius: 20px; text-decoration: none; transition: border-color 0.3s; }
      .post-card:hover { border-color: var(--accent-color); }
      .post-card h3 { color: var(--white-color); font-size: 20px; margin-bottom: 12px; line-height: 1.35em; }
      .post-card p { color: var(--text-color); line-height: 1.6em; margin: 0 0 14px; }
      .post-card .post-meta { margin: 0; font-size: 13px; }
      .seo-landing-cards > div { margin-bottom: 30px; }
      .seo-landing-btns { display: flex; flex-wrap: wrap; gap: 20px; margin-top: 10px; }
      @media (max-width: 991px) { .seo-landing { padding: 60px 0; } .seo-landing-text h2 { font-size: 24px; } }
    </style>
`;

const cta = (text) => `    <section class="seo-landing seo-landing-alt">
      <div class="container">
        <div class="row">
          <div class="col-lg-10">
            <div class="section-title">
              <h3 class="wow fadeInUp">Başlayaq</h3>
              <h2 class="text-anime-style-2" data-cursor="-opaque">${text}</h2>
            </div>
            <div class="seo-landing-text wow fadeInUp">
              <p>
                Layihənizi dinləyək, sizə uyğun həlli və qiyməti pulsuz
                konsultasiyada deyək. Zəng edin: +994 10 451 63 73.
              </p>
            </div>
            <div class="seo-landing-btns wow fadeInUp">
              <a href="/contact" class="btn-default">Pulsuz konsultasiya al</a>
              <a href="https://wa.me/994104516373" target="_blank" rel="noopener" class="btn-default">WhatsApp-da yaz</a>
            </div>
          </div>
        </div>
      </div>
    </section>
`;

function body(post) {
  const blocks = post.sections
    .map((s) => {
      let html = s.h2 ? `              <h2>${s.h2}</h2>\n` : '';
      for (const p of s.paras || []) html += `              <p>${p}</p>\n`;
      if (s.list) html += `              <ul class="seo-landing-list">\n${s.list.map((i) => `                <li>${i}</li>`).join('\n')}\n              </ul>\n`;
      return html;
    })
    .join('');

  const faq = (post.faq || [])
    .map(
      (f, i) => `                <div class="accordion-item wow fadeInUp">
                  <h2 class="accordion-header" id="heading${i + 1}">
                    <button class="accordion-button${i ? ' collapsed' : ''}" type="button" data-bs-toggle="collapse" data-bs-target="#collapse${i + 1}" aria-expanded="${i ? 'false' : 'true'}" aria-controls="collapse${i + 1}">
                      ${f.q}
                    </button>
                  </h2>
                  <div id="collapse${i + 1}" class="accordion-collapse collapse${i ? '' : ' show'}" aria-labelledby="heading${i + 1}" data-bs-parent="#accordion">
                    <div class="accordion-body"><p>${f.a}</p></div>
                  </div>
                </div>`
    )
    .join('\n');

  const faqBlock = faq
    ? `    <div class="our-faqs">
      <div class="container">
        <div class="row section-row align-items-center">
          <div class="col-lg-9">
            <div class="section-title">
              <h3 class="wow fadeInUp">FAQ</h3>
              <h2 class="text-anime-style-2" data-cursor="-opaque">Tez-tez verilən <span>suallar</span></h2>
            </div>
          </div>
        </div>
        <div class="row">
          <div class="col-lg-10">
            <div class="our-faq-section">
              <div class="faq-accordion" id="accordion">
${faq}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
`
    : '';

  const related = posts
    .filter((p) => p.slug !== post.slug)
    .slice(0, 3)
    .map(
      (p) => `          <div class="col-lg-4 col-md-6">
            <a class="post-card wow fadeInUp" href="/bloq/${p.slug}">
              <h3>${p.title}</h3>
              <p>${p.description}</p>
              <p class="post-meta">${azDate(p.date)}</p>
            </a>
          </div>`
    )
    .join('\n');

  const serviceLink = post.service
    ? `              <p><strong>Əlaqəli xidmət:</strong> <a href="${post.service.url}">${post.service.text}</a></p>\n`
    : '';

  return `    <section class="seo-landing">
      <div class="container">
        <div class="row">
          <div class="col-lg-10">
            <div class="seo-landing-text wow fadeInUp">
              <p class="post-meta">${azDate(post.date)} · Webify</p>
${blocks}${serviceLink}            </div>
          </div>
        </div>
      </div>
    </section>

${faqBlock}${cta(post.cta || 'Sayt yaratmaq istəyirsiniz?')}    <section class="seo-landing">
      <div class="container">
        <div class="row">
          <div class="col-lg-12">
            <div class="section-title">
              <h3 class="wow fadeInUp">Bloq</h3>
              <h2 class="text-anime-style-2" data-cursor="-opaque">Digər <span>məqalələr</span></h2>
            </div>
          </div>
        </div>
        <div class="row seo-landing-cards">
${related}
        </div>
      </div>
    </section>
`;
}

function articleSchemas(post) {
  const url = `${BASE}bloq/${post.slug}`;
  const schemas = [
    {
      '@context': 'https://schema.org',
      '@type': 'BlogPosting',
      headline: post.title,
      description: post.description,
      inLanguage: 'az',
      datePublished: post.date,
      dateModified: post.updated || post.date,
      image: `${BASE}images/og-image.jpg`,
      author: { '@id': `${BASE}#organization` },
      publisher: { '@id': `${BASE}#organization` },
      mainEntityOfPage: url,
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Ana səhifə', item: BASE },
        { '@type': 'ListItem', position: 2, name: 'Bloq', item: `${BASE}bloq` },
        { '@type': 'ListItem', position: 3, name: post.title, item: url },
      ],
    },
  ];
  if (post.faq?.length) {
    schemas.push({
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: post.faq.map((f) => ({
        '@type': 'Question',
        name: f.q,
        acceptedAnswer: { '@type': 'Answer', text: f.a.replace(/<[^>]+>/g, '') },
      })),
    });
  }
  return schemas;
}

// ---- məqalə səhifələri ----
for (const post of posts) {
  const url = `${BASE}bloq/${post.slug}`;
  const html =
    head({ title: post.metaTitle || `${post.title} | Webify`, desc: post.description, url, schemas: articleSchemas(post) }).replace('  </head>', BLOG_CSS + '  </head>') +
    bodyStart +
    pageHeader({
      h1: post.h1 || post.title,
      crumbs: [
        { name: 'Ana Səhifə', url: '/' },
        { name: 'Bloq', url: '/bloq' },
        { name: post.title },
      ],
    }) +
    body(post) +
    bottom;
  writeFileSync(join(ROOT, 'bloq', `${post.slug}.html`), html.replace(/\r?\n/g, '\r\n'));
}

// ---- bloq siyahısı ----
const cards = [...posts]
  .sort((a, b) => (a.date < b.date ? 1 : -1))
  .map(
    (p) => `          <div class="col-lg-4 col-md-6">
            <a class="post-card wow fadeInUp" href="/bloq/${p.slug}">
              <h3>${p.title}</h3>
              <p>${p.description}</p>
              <p class="post-meta">${azDate(p.date)}</p>
            </a>
          </div>`
  )
  .join('\n');

const indexHtml =
  head({
    title: BLOG_TITLE,
    desc: BLOG_DESC,
    url: `${BASE}bloq`,
    ogType: 'website',
    schemas: [
      {
        '@context': 'https://schema.org',
        '@type': 'Blog',
        name: 'Webify bloq',
        url: `${BASE}bloq`,
        inLanguage: 'az',
        publisher: { '@id': `${BASE}#organization` },
        blogPost: posts.map((p) => ({
          '@type': 'BlogPosting',
          headline: p.title,
          url: `${BASE}bloq/${p.slug}`,
          datePublished: p.date,
        })),
      },
      {
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Ana səhifə', item: BASE },
          { '@type': 'ListItem', position: 2, name: 'Bloq', item: `${BASE}bloq` },
        ],
      },
    ],
  }).replace('  </head>', BLOG_CSS + '  </head>') +
  bodyStart +
  pageHeader({ h1: 'Webify <span>bloq</span>', crumbs: [{ name: 'Ana Səhifə', url: '/' }, { name: 'Bloq' }] }) +
  `    <section class="seo-landing">
      <div class="container">
        <div class="row">
          <div class="col-lg-10">
            <div class="section-title">
              <h3 class="wow fadeInUp">Məqalələr</h3>
              <h2 class="text-anime-style-2" data-cursor="-opaque">Sayt, SEO və onlayn <span>satış</span> haqqında</h2>
            </div>
            <div class="seo-landing-text wow fadeInUp">
              <p>
                Sayt yaradılması, qiymətlər, domen və hostinq, SEO və onlayn satış
                haqqında praktik məqalələr. Hamısı Azərbaycan dilində və real
                layihə təcrübəmizə əsaslanır.
              </p>
            </div>
          </div>
        </div>
        <div class="row seo-landing-cards">
${cards}
        </div>
      </div>
    </section>

` +
  cta('Sayt yaratmaq istəyirsiniz?') +
  bottom;
writeFileSync(join(ROOT, 'bloq', 'index.html'), indexHtml.replace(/\r?\n/g, '\r\n'));

// ---- sitemap ----
const staticPages = [
  ['', '1.0'],
  ['sayt-yaradilmasi', '0.9'],
  ['korporativ-sayt', '0.8'],
  ['onlayn-magaza-yaradilmasi', '0.8'],
  ['seo-xidmeti', '0.8'],
  ['services', '0.8'],
  ['bloq', '0.8'],
  ['sayt-nece-yaradilir', '0.7'],
  ['portfolio', '0.7'],
  ['about', '0.6'],
  ['contact', '0.6'],
];
const today = new Date().toISOString().slice(0, 10);
const urls = [
  ...staticPages.map(([p, pr]) => [`${BASE}${p}`, today, pr]),
  ...posts.map((p) => [`${BASE}bloq/${p.slug}`, p.updated || p.date, '0.6']),
];
writeFileSync(
  join(ROOT, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls.map(([u, d, pr]) => `  <url>\n    <loc>${u}</loc>\n    <lastmod>${d}</lastmod>\n    <priority>${pr}</priority>\n  </url>`).join('\n') +
    `\n</urlset>\n`
);

console.log(`${posts.length} məqalə + bloq siyahısı yaradıldı, sitemap-də ${urls.length} ünvan var.`);
console.log(readdirSync(join(ROOT, 'bloq')).join(', '));
