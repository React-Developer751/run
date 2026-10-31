import crypto from 'node:crypto';
import net from 'node:net';
import tls from 'node:tls';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { siteName } from './store.service.js';

interface Mail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
/** "HostX <no-reply@x.com>" -> "no-reply@x.com" */
const addressOf = (from: string) => /<([^>]+)>/.exec(from)?.[1] ?? from.trim();
const b64Lines = (text: string) => Buffer.from(text, 'utf8').toString('base64').replace(/.{1,76}/g, '$&\r\n');
const encodeHeader = (value: string) => (/^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value).toString('base64')}?=`);

/** Reads SMTP replies. A reply is complete on a line like "250 OK" (code + space); "250-..." lines continue it. */
class SmtpConnection {
  private buffer = '';
  private lines: string[] = [];
  private waiting: ((reply: { code: number; text: string }) => void) | null = null;
  private failed: Error | null = null;
  private failWaiting: ((err: Error) => void) | null = null;

  constructor(public socket: net.Socket | tls.TLSSocket) {
    this.listen(socket);
  }

  listen(socket: net.Socket | tls.TLSSocket): void {
    this.socket = socket;
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      this.buffer += chunk;
      let i: number;
      while ((i = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, i).replace(/\r$/, '');
        this.buffer = this.buffer.slice(i + 1);
        this.lines.push(line);
        if (/^\d{3}(?: |$)/.test(line)) {
          const reply = { code: Number(line.slice(0, 3)), text: this.lines.join('\n') };
          this.lines = [];
          const w = this.waiting;
          this.waiting = null;
          this.failWaiting = null;
          w?.(reply);
        }
      }
    });
    socket.on('error', (err) => this.fail(err));
    socket.on('close', () => this.fail(new Error('SMTP connection closed')));
  }

  private fail(err: Error): void {
    this.failed ??= err;
    const f = this.failWaiting;
    this.waiting = null;
    this.failWaiting = null;
    f?.(err);
  }

  /** Detaches the plain socket's listeners before a STARTTLS upgrade. */
  detach(): void {
    this.socket.removeAllListeners('data');
    this.socket.removeAllListeners('error');
    this.socket.removeAllListeners('close');
  }

  reply(): Promise<{ code: number; text: string }> {
    if (this.failed) return Promise.reject(this.failed);
    return new Promise((resolve, reject) => {
      this.waiting = resolve;
      this.failWaiting = reject;
    });
  }

  async command(line: string | null, expect: number[], label = line?.split(' ')[0] ?? 'greeting'): Promise<string> {
    const pending = this.reply();
    if (line !== null) this.socket.write(`${line}\r\n`);
    const { code, text } = await pending;
    if (!expect.includes(code)) throw new Error(`SMTP ${label} failed: ${text.slice(0, 200)}`);
    return text;
  }
}

function connect(url: URL): Promise<net.Socket | tls.TLSSocket> {
  const implicitTls = url.protocol === 'smtps:';
  const port = Number(url.port) || (implicitTls ? 465 : 587);
  return new Promise((resolve, reject) => {
    const socket = implicitTls
      ? tls.connect({ host: url.hostname, port, servername: url.hostname }, () => resolve(socket))
      : net.connect({ host: url.hostname, port }, () => resolve(socket));
    socket.setTimeout(20_000, () => socket.destroy(new Error('SMTP timeout')));
    socket.once('error', reject);
  });
}

/** Minimal SMTP client (implicit TLS or STARTTLS, AUTH PLAIN). Enough for any transactional email provider. */
async function sendSmtp(url: URL, from: string, mail: Mail): Promise<void> {
  const local = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  const conn = new SmtpConnection(await connect(url));
  try {
    await conn.command(null, [220]);
    let ehlo = await conn.command('EHLO hostx', [250]);
    if (url.protocol === 'smtp:') {
      if (/STARTTLS/i.test(ehlo)) {
        await conn.command('STARTTLS', [220]);
        conn.detach();
        const secure = await new Promise<tls.TLSSocket>((resolve, reject) => {
          const s = tls.connect({ socket: conn.socket as net.Socket, servername: url.hostname }, () => resolve(s));
          s.once('error', reject);
        });
        conn.listen(secure);
        ehlo = await conn.command('EHLO hostx', [250]);
      } else if (!local) {
        throw new Error('SMTP server does not offer STARTTLS; refusing to send credentials in clear text (use smtps://)');
      }
    }
    if (url.username) {
      const auth = Buffer.from(`\0${decodeURIComponent(url.username)}\0${decodeURIComponent(url.password)}`).toString('base64');
      await conn.command(`AUTH PLAIN ${auth}`, [235], 'AUTH');
    }
    await conn.command(`MAIL FROM:<${addressOf(from)}>`, [250]);
    await conn.command(`RCPT TO:<${mail.to}>`, [250, 251]);
    await conn.command('DATA', [354]);

    const boundary = `hostx-${crypto.randomBytes(8).toString('hex')}`;
    const message = [
      // Display name follows the platform name the admin chose; the address stays HOSTX_MAIL_FROM's.
      `From: ${encodeHeader(`"${siteName()}"`)} <${addressOf(from)}>`,
      `To: ${mail.to}`,
      `Subject: ${encodeHeader(mail.subject)}`,
      `Date: ${new Date().toUTCString()}`,
      `Message-ID: <${crypto.randomBytes(12).toString('hex')}@${addressOf(from).split('@')[1] ?? 'hostx'}>`,
      'MIME-Version: 1.0',
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      '',
      `--${boundary}`,
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: base64',
      '',
      b64Lines(mail.text),
      `--${boundary}`,
      'Content-Type: text/html; charset=utf-8',
      'Content-Transfer-Encoding: base64',
      '',
      b64Lines(mail.html),
      `--${boundary}--`,
      '',
    ].join('\r\n');
    // base64 bodies never start a line with ".", so no dot-stuffing is needed.
    await conn.command(`${message}\r\n.`, [250], 'DATA');
    await conn.command('QUIT', [221]).catch(() => undefined);
  } finally {
    conn.socket.destroy();
  }
}

function layout(title: string, intro: string, button: { label: string; url: string }, outro: string): { html: string; text: string } {
  const html = `<!doctype html><html><body style="margin:0;background:#f4f2ff;font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#1b1646">
<div style="max-width:520px;margin:32px auto;background:#fff;border-radius:16px;padding:32px;border:1px solid #e4e0fb">
<h1 style="font-size:22px;margin:0 0 12px">${escapeHtml(title)}</h1>
<p style="line-height:1.6;color:#58547f">${escapeHtml(intro)}</p>
<p style="margin:28px 0"><a href="${escapeHtml(button.url)}" style="background:#5b4bf0;color:#fff;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:600;display:inline-block">${escapeHtml(button.label)}</a></p>
<p style="line-height:1.6;color:#8681ad;font-size:13px">${escapeHtml(outro)}<br>If the button does not work, open this link:<br><span style="word-break:break-all">${escapeHtml(button.url)}</span></p>
</div></body></html>`;
  return { html, text: `${title}\n\n${intro}\n\n${button.label}: ${button.url}\n\n${outro}\n` };
}

export class MailService {
  static enabled(): boolean {
    return Boolean(config.mail.smtpUrl);
  }

  /** Never throws: a failing mail server must not break sign-up. Returns whether the mail was handed to the server. */
  static async send(mail: Mail): Promise<boolean> {
    if (!config.mail.smtpUrl) {
      if (config.isProduction) logger.warn(`Email to ${mail.to} not sent: HOSTX_SMTP_URL is not configured`);
      else logger.info(`[dev mail] To: ${mail.to} | ${mail.subject}\n${mail.text}`);
      return false;
    }
    try {
      await sendSmtp(new URL(config.mail.smtpUrl), config.mail.from, mail);
      return true;
    } catch (err) {
      logger.error(`Could not send email to ${mail.to}: ${(err as Error).message}`);
      return false;
    }
  }

  static verifyEmail(to: string, name: string, url: string): Promise<boolean> {
    const body = layout(
      'Confirm your email address',
      `Hi ${name}, welcome to ${siteName()}! Confirm that this is your email address to start deploying.`,
      { label: 'Confirm email', url },
      'This link expires in 24 hours. If you did not create an account, you can ignore this email.',
    );
    return this.send({ to, subject: `Confirm your ${siteName()} email address`, ...body });
  }

  /** Incident about one of the user's apps (crash, failed auto-deploy). */
  static appAlert(to: string, name: string, title: string, message: string, url: string): Promise<boolean> {
    const body = layout(title, `Hi ${name}, ${message}`, { label: 'Open the project', url }, 'You get at most one email like this per app per hour.');
    return this.send({ to, subject: `[${siteName()}] ${title}`, ...body });
  }

  /** Sent after an account is deleted: proof for the user, and an alarm if they did not do it. */
  static accountDeleted(to: string, name: string, byAdmin: boolean): Promise<boolean> {
    const site = siteName();
    const how = byAdmin ? `was deleted by the ${site} administrators` : 'was deleted at your request';
    const body = layout(
      `Your ${site} account was deleted`,
      `Hi ${name}, your ${site} account ${how}. Your apps, environment variables, custom domains, logs, support requests and feedback have been removed, and any subscription was cancelled. Payment records are kept as tax law requires.`,
      { label: `Open ${site}`, url: config.dashboardUrl },
      byAdmin ? 'If you think this is a mistake, reply to this email.' : 'If you did not do this, reply to this email right away.',
    );
    return this.send({ to, subject: `[${site}] Your account was deleted`, ...body });
  }

  /** Plan and payment news for a user (UPI payment approved/rejected, plan ending). */
  static billingNotice(to: string, name: string, title: string, message: string, url: string): Promise<boolean> {
    const body = layout(title, `Hi ${name}, ${message}`, { label: 'Open billing', url }, `You receive this because you have a ${siteName()} account.`);
    return this.send({ to, subject: `[${siteName()}] ${title}`, ...body });
  }

  /** Platform alert for administrators (failed deploys, storage running out). */
  static adminAlert(to: string, title: string, message: string, url: string, label = 'Open admin notifications'): Promise<boolean> {
    const body = layout(title, message, { label, url }, `You receive this because you are a ${siteName()} administrator.`);
    return this.send({ to, subject: `[${siteName()} admin] ${title}`, ...body });
  }

  /** An administrator answered a support request. The reply itself is only shown in the dashboard. */
  static supportReply(to: string, name: string, subject: string, url: string): Promise<boolean> {
    const body = layout(
      'Your support request has a reply',
      `Hi ${name}, the ${siteName()} team replied to your request "${subject}". Open it to read the answer and continue the conversation.`,
      { label: 'Read the reply', url },
      `You receive this because you contacted ${siteName()} support.`,
    );
    return this.send({ to, subject: `[${siteName()}] Re: ${subject}`, ...body });
  }

  static resetPassword(to: string, name: string, url: string): Promise<boolean> {
    const body = layout(
      'Reset your password',
      `Hi ${name}, somebody (hopefully you) asked to reset the password of your ${siteName()} account.`,
      { label: 'Choose a new password', url },
      'This link expires in 1 hour and works once. If you did not ask for it, ignore this email: your password stays the same.',
    );
    return this.send({ to, subject: `Reset your ${siteName()} password`, ...body });
  }
}
