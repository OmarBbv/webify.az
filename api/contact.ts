/**
 * Vercel Function: POST /api/contact
 *
 * "Məlumat əldə et" formundan gələn sorğunu Brevo vasitəsilə e-poçta göndərir.
 * Açar və ünvanlar koda yazılmır, Vercel-in mühit dəyişənlərindən oxunur:
 *   BREVO_API_KEY       Brevo → SMTP & API → API keys
 *   CONTACT_TO_EMAIL    sorğuların gedəcəyi ünvan
 *   CONTACT_FROM_EMAIL  Brevo-da təsdiqlənmiş göndərən ünvan (Senders)
 *   CONTACT_FROM_NAME   göndərənin adı (istəyə görə, default "Webify sayt")
 */

export interface ContactRequest {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  message: string;
  page: string;
}

export interface MailMessage {
  to: string;
  replyTo: { email: string; name: string };
  subject: string;
  html: string;
  text: string;
}

export interface IMailSender {
  send(message: MailMessage): Promise<void>;
}

export class BrevoMailSender implements IMailSender {
  private static readonly ENDPOINT = 'https://api.brevo.com/v3/smtp/email';

  private readonly apiKey: string;
  private readonly from: { email: string; name: string };
  private readonly fetchImpl: typeof fetch;

  constructor(apiKey: string, from: { email: string; name: string }, fetchImpl: typeof fetch = fetch) {
    this.apiKey = apiKey;
    this.from = from;
    this.fetchImpl = fetchImpl;
  }

  async send(message: MailMessage): Promise<void> {
    const response = await this.fetchImpl(BrevoMailSender.ENDPOINT, {
      method: 'POST',
      headers: {
        'api-key': this.apiKey,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        sender: this.from,
        to: [{ email: message.to }],
        replyTo: message.replyTo,
        subject: message.subject,
        htmlContent: message.html,
        textContent: message.text,
      }),
    });
    if (!response.ok) {
      // Brevo-nun cavabında açar olmur, amma səbəbi (məs. təsdiqlənməmiş göndərən) loga yazırıq.
      throw new Error(`Brevo ${response.status}: ${(await response.text()).slice(0, 300)}`);
    }
  }
}

const LIMITS = { name: 80, email: 120, phone: 40, message: 4000, page: 200 } as const;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[+()\d\s-]{7,40}$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const text = (value: unknown, max: number): string =>
  typeof value === 'string' ? value.trim().slice(0, max) : '';

export type ParseResult = { ok: true; data: ContactRequest } | { ok: false; spam: boolean };

/** Formun JSON-unu yoxlayır. `website` gizli sahədir: onu yalnız botlar doldurur. */
export function parseContact(body: unknown): ParseResult {
  if (!isRecord(body)) return { ok: false, spam: false };
  if (text(body.website, 200)) return { ok: false, spam: true };
  const data: ContactRequest = {
    firstName: text(body.fname, LIMITS.name),
    lastName: text(body.lname, LIMITS.name),
    email: text(body.email, LIMITS.email),
    phone: text(body.phone, LIMITS.phone),
    message: text(body.message, LIMITS.message),
    page: text(body.page, LIMITS.page),
  };
  const valid = data.firstName !== '' && EMAIL_RE.test(data.email) && PHONE_RE.test(data.phone);
  return valid ? { ok: true, data } : { ok: false, spam: false };
}

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function buildMessage(c: ContactRequest, to: string): MailMessage {
  const name = `${c.firstName} ${c.lastName}`.trim();
  const rows: Array<[string, string]> = [
    ['Ad, soyad', name],
    ['E-poçt', c.email],
    ['Telefon', c.phone],
    ['Mesaj', c.message || '—'],
    ['Səhifə', c.page || '/contact'],
  ];
  const html =
    '<h2>Saytdan yeni sorğu</h2><table cellpadding="6" style="border-collapse:collapse">' +
    rows
      .map(
        ([k, v]) =>
          `<tr><td style="vertical-align:top"><b>${k}</b></td><td style="white-space:pre-wrap">${escapeHtml(v)}</td></tr>`
      )
      .join('') +
    '</table>';
  return {
    to,
    replyTo: { email: c.email, name },
    subject: `Webify: yeni sorğu – ${name}`,
    html,
    text: rows.map(([k, v]) => `${k}: ${v}`).join('\n'),
  };
}

const json = (status: number, body: Record<string, unknown>): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export async function handleContact(request: Request, sender: IMailSender, to: string): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json(400, { ok: false, error: 'invalid' });
  }
  const parsed = parseContact(body);
  // Bot üçün uğurlu cavab qaytarırıq ki, yenidən cəhd etməsin, amma məktub göndərilmir.
  if (!parsed.ok) return parsed.spam ? json(200, { ok: true }) : json(400, { ok: false, error: 'invalid' });
  try {
    await sender.send(buildMessage(parsed.data, to));
    return json(200, { ok: true });
  } catch (error) {
    console.error('contact: göndərmə alınmadı', error);
    return json(502, { ok: false, error: 'send_failed' });
  }
}

// @types/node olmadan da tipli qalsın deyə mühit dəyişənlərini globalThis-dən oxuyuruq.
const env = (): Record<string, string | undefined> =>
  (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};

export async function POST(request: Request): Promise<Response> {
  const { BREVO_API_KEY: apiKey, CONTACT_TO_EMAIL: to, CONTACT_FROM_EMAIL: fromEmail, CONTACT_FROM_NAME: fromName } = env();
  if (!apiKey || !to || !fromEmail) {
    console.error('contact: BREVO_API_KEY, CONTACT_TO_EMAIL və ya CONTACT_FROM_EMAIL təyin olunmayıb');
    return json(500, { ok: false, error: 'not_configured' });
  }
  const sender = new BrevoMailSender(apiKey, { email: fromEmail, name: fromName || 'Webify sayt' });
  return handleContact(request, sender, to);
}
