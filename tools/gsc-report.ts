#!/usr/bin/env node
/**
 * Search Console sıra hesabatı.
 *
 * İstifadəsi:
 *   node --experimental-strip-types tools/gsc-report.ts --dir <qovluq> [--backfill-days 120]
 *
 * Google Search Console API-dən hər gün üzrə sorğu × səhifə datasını çəkir və <qovluq>-a yazır:
 *   rankings.csv      date,query,page,clicks,impressions,ctr,position
 *   daily-totals.csv  date,clicks,impressions,ctr,position
 *   latest.md         izlənən sorğuların mövqeyi, fürsətlər, yeni sorğular
 *
 * Açar (service account JSON) mühit dəyişənindən oxunur:
 *   GSC_SA_KEY_B64  base64 ilə kodlanmış JSON  (və ya GSC_SA_KEY: xam JSON)
 *   GSC_SITE        istəyə bağlı; verilməsə hesabdakı webify.az property-si özü tapılır
 *
 * Skript asılılıqsızdır (yalnız Node), açarı heç yerə yazmır və çap etmir.
 */
import { createSign } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/** GSC_API_BASE yalnız lokal testdə saxta server üçündür. */
const API = process.env.GSC_API_BASE ?? 'https://searchconsole.googleapis.com/webmasters/v3';
const SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';
const ROW_LIMIT = 25000;
/** Search Console datası son 2–3 gün ərzində yenilənir, ona görə həmin günləri hər dəfə təzədən çəkirik. */
const REFRESH_DAYS = 4;

// ---------- tiplər ----------

interface ServiceAccountKey {
  client_email: string;
  private_key: string;
  token_uri: string;
}

interface Row {
  date: string;
  query: string;
  page: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

interface TotalRow {
  date: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

interface ApiRow {
  keys: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

interface Options {
  dir: string;
  backfillDays: number;
}

// ---------- köməkçilər ----------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isApiRow(value: unknown): value is ApiRow {
  return (
    isRecord(value) &&
    Array.isArray(value.keys) &&
    value.keys.every((k) => typeof k === 'string') &&
    typeof value.clicks === 'number' &&
    typeof value.impressions === 'number' &&
    typeof value.ctr === 'number' &&
    typeof value.position === 'number'
  );
}

function fail(message: string): never {
  console.error(`gsc-report: ${message}`);
  process.exit(1);
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function round(value: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

function parseArgs(argv: string[]): Options {
  let dir = '';
  let backfillDays = 120;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dir') dir = argv[++i] ?? '';
    else if (arg === '--backfill-days') backfillDays = Number(argv[++i]);
    else fail(`naməlum arqument: ${arg}`);
  }
  if (!dir) fail('--dir <qovluq> lazımdır');
  if (!Number.isInteger(backfillDays) || backfillDays < 1 || backfillDays > 480) {
    fail('--backfill-days 1 ilə 480 arasında tam ədəd olmalıdır');
  }
  return { dir, backfillDays };
}

// ---------- CSV ----------

class Csv {
  static escape(value: string | number): string {
    const s = String(value);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  static stringify(header: readonly string[], rows: ReadonlyArray<ReadonlyArray<string | number>>): string {
    return [header, ...rows].map((r) => r.map((v) => Csv.escape(v)).join(',')).join('\n') + '\n';
  }

  /** RFC 4180: dırnaqlı sahələr, dırnaq içində vergül, sətir sonu və "" qaçışı. */
  static parse(text: string): string[][] {
    const rows: string[][] = [];
    let row: string[] = [];
    let field = '';
    let quoted = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (quoted) {
        if (c === '"' && text[i + 1] === '"') {
          field += '"';
          i++;
        } else if (c === '"') quoted = false;
        else field += c;
      } else if (c === '"') quoted = true;
      else if (c === ',') {
        row.push(field);
        field = '';
      } else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
      } else field += c;
    }
    if (field !== '' || row.length > 0) {
      row.push(field);
      rows.push(row);
    }
    return rows;
  }
}

const ROW_HEADER = ['date', 'query', 'page', 'clicks', 'impressions', 'ctr', 'position'] as const;
const TOTAL_HEADER = ['date', 'clicks', 'impressions', 'ctr', 'position'] as const;

function readRows(file: string): Row[] {
  if (!existsSync(file)) return [];
  return Csv.parse(readFileSync(file, 'utf8'))
    .slice(1)
    .filter((r) => r.length === ROW_HEADER.length)
    .map(([date = '', query = '', page = '', clicks, impressions, ctr, position]) => ({
      date,
      query,
      page,
      clicks: Number(clicks),
      impressions: Number(impressions),
      ctr: Number(ctr),
      position: Number(position),
    }));
}

function readTotals(file: string): TotalRow[] {
  if (!existsSync(file)) return [];
  return Csv.parse(readFileSync(file, 'utf8'))
    .slice(1)
    .filter((r) => r.length === TOTAL_HEADER.length)
    .map(([date = '', clicks, impressions, ctr, position]) => ({
      date,
      clicks: Number(clicks),
      impressions: Number(impressions),
      ctr: Number(ctr),
      position: Number(position),
    }));
}

// ---------- Search Console ----------

class SearchConsoleClient {
  private token = '';
  private readonly key: ServiceAccountKey;

  constructor(key: ServiceAccountKey) {
    this.key = key;
  }

  static keyFromEnv(): ServiceAccountKey {
    const b64 = process.env.GSC_SA_KEY_B64;
    const raw = b64 ? Buffer.from(b64, 'base64').toString('utf8') : process.env.GSC_SA_KEY;
    if (!raw) fail('GSC_SA_KEY_B64 (və ya GSC_SA_KEY) mühit dəyişəni yoxdur');
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      fail('service account açarı JSON kimi oxunmadı');
    }
    if (!isRecord(parsed) || typeof parsed.client_email !== 'string' || typeof parsed.private_key !== 'string') {
      fail('service account açarında client_email və ya private_key yoxdur');
    }
    const tokenUri = typeof parsed.token_uri === 'string' ? parsed.token_uri : 'https://oauth2.googleapis.com/token';
    return { client_email: parsed.client_email, private_key: parsed.private_key, token_uri: tokenUri };
  }

  async authorize(): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    const b64url = (obj: Record<string, string | number>): string =>
      Buffer.from(JSON.stringify(obj)).toString('base64url');
    const unsigned = `${b64url({ alg: 'RS256', typ: 'JWT' })}.${b64url({
      iss: this.key.client_email,
      scope: SCOPE,
      aud: this.key.token_uri,
      iat: now,
      exp: now + 3600,
    })}`;
    const signature = createSign('RSA-SHA256').update(unsigned).sign(this.key.private_key).toString('base64url');
    const res = await fetch(this.key.token_uri, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: `${unsigned}.${signature}`,
      }),
    });
    const data: unknown = await res.json();
    if (!res.ok || !isRecord(data) || typeof data.access_token !== 'string') {
      fail(`token alınmadı (HTTP ${res.status})`);
    }
    this.token = data.access_token;
  }

  private async request(path: string, body?: Record<string, unknown>): Promise<unknown> {
    const res = await fetch(`${API}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data: unknown = await res.json();
    if (!res.ok) {
      const msg = isRecord(data) && isRecord(data.error) ? String(data.error.message) : '';
      fail(`API xətası ${res.status} ${path}: ${msg}`);
    }
    return data;
  }

  /** Hesabda görünən property-lər arasında webify.az-ı tapır; domen property-si üstündür. */
  async resolveSite(): Promise<string> {
    const fromEnv = process.env.GSC_SITE;
    if (fromEnv) return fromEnv;
    const data = await this.request('/sites');
    const sites =
      isRecord(data) && Array.isArray(data.siteEntry)
        ? data.siteEntry
            .filter(isRecord)
            .map((s) => s.siteUrl)
            .filter((u): u is string => typeof u === 'string')
        : [];
    const match =
      sites.find((s) => s === 'sc-domain:webify.az') ??
      sites.find((s) => s === 'https://www.webify.az/') ??
      sites.find((s) => s.includes('webify.az'));
    if (!match) {
      fail(
        `service account-un webify.az property-sinə girişi yoxdur. Görünənlər: ${sites.join(', ') || 'heç biri'}. ` +
          'Search Console → Settings → Users and permissions bölməsində service account e-poçtunu əlavə edin.',
      );
    }
    return match;
  }

  async query(site: string, startDate: string, endDate: string, dimensions: string[]): Promise<ApiRow[]> {
    const out: ApiRow[] = [];
    for (let startRow = 0; ; startRow += ROW_LIMIT) {
      const data = await this.request(`/sites/${encodeURIComponent(site)}/searchAnalytics/query`, {
        startDate,
        endDate,
        dimensions,
        dataState: 'all',
        rowLimit: ROW_LIMIT,
        startRow,
      });
      const rows = isRecord(data) && Array.isArray(data.rows) ? data.rows.filter(isApiRow) : [];
      out.push(...rows);
      if (rows.length < ROW_LIMIT) return out;
    }
  }
}

// ---------- hesabat ----------

class RankReport {
  private readonly byQuery = new Map<string, Row[]>();
  private readonly rows: Row[];
  private readonly totals: TotalRow[];
  private readonly keywords: string[];
  private readonly site: string;

  constructor(rows: Row[], totals: TotalRow[], keywords: string[], site: string) {
    this.rows = rows;
    this.totals = totals;
    this.keywords = keywords;
    this.site = site;
    for (const r of rows) {
      const key = r.query.toLowerCase();
      const list = this.byQuery.get(key) ?? [];
      list.push(r);
      this.byQuery.set(key, list);
    }
  }

  private get lastDate(): string {
    return this.totals.reduce((max, t) => (t.date > max ? t.date : max), '');
  }

  /** Bir gün üçün sorğunun ən yaxşı (ən kiçik) mövqeyi: istifadəçinin gördüyü səhifə. */
  private bestPosition(query: string, date: string): Row | undefined {
    return (this.byQuery.get(query) ?? [])
      .filter((r) => r.date === date && r.impressions > 0)
      .sort((a, b) => a.position - b.position)[0];
  }

  /** Dövr ərzində gündəlik ən yaxşı mövqelərin ortası. */
  private averagePosition(query: string, from: string, to: string): number | undefined {
    const days = new Map<string, number>();
    for (const r of this.byQuery.get(query) ?? []) {
      if (r.date < from || r.date > to || r.impressions === 0) continue;
      days.set(r.date, Math.min(days.get(r.date) ?? Infinity, r.position));
    }
    if (days.size === 0) return undefined;
    return [...days.values()].reduce((s, p) => s + p, 0) / days.size;
  }

  private impressions(query: string, from: string, to: string): number {
    return (this.byQuery.get(query) ?? [])
      .filter((r) => r.date >= from && r.date <= to)
      .reduce((s, r) => s + r.impressions, 0);
  }

  private static fmt(position: number | undefined): string {
    return position === undefined ? '—' : position.toFixed(1);
  }

  /** Sorğu mətnindəki | markdown cədvəlini pozmasın. */
  private static cell(text: string): string {
    return text.replace(/\|/g, '\\|');
  }

  private static path(page: string): string {
    return page.replace(/^https?:\/\/(www\.)?webify\.az/, '') || '/';
  }

  private totalsSection(): string[] {
    const end = this.lastDate;
    const sum = (from: string, to: string) => {
      const list = this.totals.filter((t) => t.date >= from && t.date <= to);
      const impressions = list.reduce((s, t) => s + t.impressions, 0);
      const clicks = list.reduce((s, t) => s + t.clicks, 0);
      const pos = impressions ? list.reduce((s, t) => s + t.position * t.impressions, 0) / impressions : undefined;
      return { clicks, impressions, pos };
    };
    const cur = sum(addDays(end, -6), end);
    const prev = sum(addDays(end, -13), addDays(end, -7));
    return [
      '## Saytın ümumi göstəriciləri',
      '',
      '| | Son 7 gün | Əvvəlki 7 gün |',
      '|---|---|---|',
      `| Klik | ${cur.clicks} | ${prev.clicks} |`,
      `| Göstərilmə | ${cur.impressions} | ${prev.impressions} |`,
      `| Orta mövqe | ${RankReport.fmt(cur.pos)} | ${RankReport.fmt(prev.pos)} |`,
      '',
    ];
  }

  private keywordSection(): string[] {
    const end = this.lastDate;
    const lines = [
      '## İzlənən sorğular',
      '',
      `Mövqe: Google-da ən yaxşı yerdə olan səhifəmiz. "—" bu gün göstərilmə yoxdur (ilk ~100-dən kənar və ya axtarılmayıb).`,
      '',
      `| Sorğu | ${end} | 7 gün əvvəl | 7 gün orta | 28 gün orta | Göstərilmə (7g) | Səhifə |`,
      '|---|---|---|---|---|---|---|',
    ];
    for (const raw of this.keywords) {
      const q = raw.toLowerCase();
      const best = this.bestPosition(q, end);
      lines.push(
        `| ${RankReport.cell(raw)} | ${RankReport.fmt(best?.position)} | ${RankReport.fmt(this.bestPosition(q, addDays(end, -7))?.position)} | ` +
          `${RankReport.fmt(this.averagePosition(q, addDays(end, -6), end))} | ` +
          `${RankReport.fmt(this.averagePosition(q, addDays(end, -27), end))} | ` +
          `${this.impressions(q, addDays(end, -6), end)} | ${best ? RankReport.path(best.page) : ''} |`,
      );
    }
    lines.push('');
    return lines;
  }

  /** Son 28 gündə görünən, amma ilk 3-dən kənarda qalan sorğular: ən tez irəli çəkilə bilənlər. */
  private opportunitySection(): string[] {
    const end = this.lastDate;
    const from = addDays(end, -27);
    const agg = new Map<string, { impressions: number; weighted: number; clicks: number; pages: Map<string, number> }>();
    for (const r of this.rows) {
      if (r.date < from || r.date > end) continue;
      const a = agg.get(r.query) ?? { impressions: 0, weighted: 0, clicks: 0, pages: new Map<string, number>() };
      a.impressions += r.impressions;
      a.weighted += r.position * r.impressions;
      a.clicks += r.clicks;
      a.pages.set(r.page, (a.pages.get(r.page) ?? 0) + r.impressions);
      agg.set(r.query, a);
    }
    const list = [...agg.entries()]
      .map(([query, a]) => ({
        query,
        impressions: a.impressions,
        clicks: a.clicks,
        position: a.impressions ? a.weighted / a.impressions : 0,
        page: [...a.pages.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ?? '',
        pageCount: a.pages.size,
      }))
      .filter((x) => x.impressions >= 3 && x.position >= 4 && x.position <= 30)
      .sort((a, b) => b.impressions - a.impressions)
      .slice(0, 20);
    const lines = [
      '## Fürsətlər (son 28 gün, mövqe 4–30)',
      '',
      'Birdən çox səhifə eyni sorğuda görünürsə, kannibalizasiya ola bilər.',
      '',
      '| Sorğu | Orta mövqe | Göstərilmə | Klik | Əsas səhifə | Səhifə sayı |',
      '|---|---|---|---|---|---|',
      ...list.map(
        (x) =>
          `| ${RankReport.cell(x.query)} | ${x.position.toFixed(1)} | ${x.impressions} | ${x.clicks} | ${RankReport.path(x.page)} | ${x.pageCount} |`,
      ),
      '',
    ];
    if (list.length === 0) lines.splice(4, 2, 'Hələ kifayət qədər data yoxdur.');
    return lines;
  }

  /** Son 7 gündə ilk dəfə görünən sorğular (əvvəlki 28 gündə yox idi). */
  private newQueriesSection(): string[] {
    const end = this.lastDate;
    const recentFrom = addDays(end, -6);
    const before = new Set(
      this.rows.filter((r) => r.date >= addDays(end, -34) && r.date < recentFrom).map((r) => r.query),
    );
    const recent = new Map<string, number>();
    for (const r of this.rows) {
      if (r.date < recentFrom || r.date > end || before.has(r.query)) continue;
      recent.set(r.query, (recent.get(r.query) ?? 0) + r.impressions);
    }
    const top = [...recent.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
    return [
      '## Yeni görünən sorğular (son 7 gün)',
      '',
      ...(top.length ? top.map(([q, n]) => `- ${q} (${n} göstərilmə)`) : ['Yoxdur.']),
      '',
    ];
  }

  render(): string {
    return [
      `# Search Console hesabatı: ${this.lastDate || 'data yoxdur'}`,
      '',
      `Property: \`${this.site}\`. Data Google-dan 2–3 gün gecikmə ilə gəlir; son günlər hələ dəyişə bilər.`,
      '',
      ...this.totalsSection(),
      ...this.keywordSection(),
      ...this.opportunitySection(),
      ...this.newQueriesSection(),
    ].join('\n');
  }
}

// ---------- əsas axın ----------

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  mkdirSync(opts.dir, { recursive: true });
  const rowsFile = join(opts.dir, 'rankings.csv');
  const totalsFile = join(opts.dir, 'daily-totals.csv');

  const keywordsFile = join(dirname(fileURLToPath(import.meta.url)), 'seo-keywords.json');
  const keywordsData: unknown = JSON.parse(readFileSync(keywordsFile, 'utf8'));
  const keywords =
    isRecord(keywordsData) && Array.isArray(keywordsData.keywords)
      ? keywordsData.keywords.filter((k): k is string => typeof k === 'string')
      : [];

  const client = new SearchConsoleClient(SearchConsoleClient.keyFromEnv());
  await client.authorize();
  const site = await client.resolveSite();

  const existing = readRows(rowsFile);
  const existingTotals = readTotals(totalsFile);
  const end = addDays(today(), -1);
  const lastKnown = existingTotals.reduce((max, t) => (t.date > max ? t.date : max), '');
  const start = lastKnown ? addDays(lastKnown, -REFRESH_DAYS) : addDays(end, -opts.backfillDays + 1);

  const fresh: Row[] = (await client.query(site, start, end, ['date', 'query', 'page'])).map((r) => ({
    date: r.keys[0] ?? '',
    query: r.keys[1] ?? '',
    page: r.keys[2] ?? '',
    clicks: r.clicks,
    impressions: r.impressions,
    ctr: round(r.ctr, 4),
    position: round(r.position, 2),
  }));
  const freshTotals: TotalRow[] = (await client.query(site, start, end, ['date'])).map((r) => ({
    date: r.keys[0] ?? '',
    clicks: r.clicks,
    impressions: r.impressions,
    ctr: round(r.ctr, 4),
    position: round(r.position, 2),
  }));

  const rows = [...existing.filter((r) => r.date < start), ...fresh].sort(
    (a, b) => a.date.localeCompare(b.date) || a.query.localeCompare(b.query) || a.page.localeCompare(b.page),
  );
  const totals = [...existingTotals.filter((t) => t.date < start), ...freshTotals].sort((a, b) =>
    a.date.localeCompare(b.date),
  );

  writeFileSync(
    rowsFile,
    Csv.stringify(
      ROW_HEADER,
      rows.map((r) => [r.date, r.query, r.page, r.clicks, r.impressions, r.ctr, r.position]),
    ),
  );
  writeFileSync(
    totalsFile,
    Csv.stringify(
      TOTAL_HEADER,
      totals.map((t) => [t.date, t.clicks, t.impressions, t.ctr, t.position]),
    ),
  );

  const report = new RankReport(rows, totals, keywords, site).render();
  writeFileSync(join(opts.dir, 'latest.md'), report);
  console.log(report);
  console.error(`gsc-report: ${start}..${end} yeniləndi, ${fresh.length} sətir, cəmi ${rows.length}.`);
}

main().catch((err: unknown) => fail(err instanceof Error ? err.message : String(err)));
