/**
 * TEMPORARY — minimal Gmail SMTP transport, shared by the scripts in this
 * folder. Nothing outside `src/lib/test/` imports it.
 *
 * Just enough of the protocol to hand one message to Gmail over implicit TLS
 * (port 465): greeting, EHLO, AUTH LOGIN, MAIL FROM, RCPT TO, DATA, QUIT. No
 * STARTTLS, pooling, retries or attachments — this is a stand-in while the
 * production domain and Resend key are missing, not a `DeliveryProvider`.
 *
 * Plain `.mjs` with JSDoc types on purpose: Node's `--experimental-strip-types`
 * mode will not resolve an import from one `.mts` file to another, so a shared
 * module has to be real JavaScript for both scripts here to use it. It still
 * type-checks — `allowJs` is on in tsconfig.
 */

import tls from 'node:tls';

export const GMAIL_HOST = 'smtp.gmail.com';
export const GMAIL_TLS_PORT = 465;

const CRLF = '\r\n';

/**
 * @typedef {object} SmtpReply
 * @property {number} code
 * @property {string} text
 */

/**
 * A reply ends on the first line whose code is followed by a space, not '-'.
 * @param {string} buffer
 * @returns {{ reply: SmtpReply, rest: string } | null}
 */
function findCompleteReply(buffer) {
  const lines = buffer.split(CRLF);
  for (let i = 0; i < lines.length; i += 1) {
    if (/^\d{3} /.test(lines[i])) {
      return {
        reply: { code: Number(lines[i].slice(0, 3)), text: lines.slice(0, i + 1).join('\n') },
        rest: lines.slice(i + 1).join(CRLF),
      };
    }
  }
  return null;
}

class SmtpSession {
  /**
   * @param {import('node:tls').TLSSocket} socket
   * @param {boolean} debug
   */
  constructor(socket, debug) {
    this.socket = socket;
    this.debug = debug;
    this.buffer = '';
    /** @type {((reply: SmtpReply) => void) | null} */
    this.waiting = null;
    /** @type {Error | null} */
    this.failure = null;
    /** @type {((error: Error) => void) | null} */
    this.onFailure = null;

    socket.setEncoding('utf8');
    socket.on('data', (chunk) => this.consume(String(chunk)));
    socket.on('error', (error) => this.fail(error));
    socket.on('close', () => this.fail(new Error('SMTP connection closed unexpectedly')));
  }

  /**
   * @param {string} host
   * @param {number} port
   * @param {number} timeoutMs
   * @param {boolean} debug
   * @returns {Promise<SmtpSession>}
   */
  static connect(host, port, timeoutMs, debug) {
    return new Promise((resolve, reject) => {
      const socket = tls.connect({ host, port, servername: host }, () => {
        socket.setTimeout(timeoutMs);
        resolve(new SmtpSession(socket, debug));
      });
      socket.setTimeout(timeoutMs, () => socket.destroy(new Error('SMTP connect timed out')));
      socket.once('error', reject);
    });
  }

  /** @param {string} chunk */
  consume(chunk) {
    this.buffer += chunk;
    const found = findCompleteReply(this.buffer);
    if (!found || !this.waiting) return;
    this.buffer = found.rest;
    const resolve = this.waiting;
    this.waiting = null;
    if (this.debug) console.log(`S: ${found.reply.text}`);
    resolve(found.reply);
  }

  /** @param {Error} error */
  fail(error) {
    this.failure = error;
    if (this.onFailure) this.onFailure(error);
  }

  /** @returns {Promise<SmtpReply>} */
  read() {
    if (this.failure) return Promise.reject(this.failure);
    return new Promise((resolve, reject) => {
      this.onFailure = reject;
      this.waiting = (reply) => {
        this.onFailure = null;
        resolve(reply);
      };
      // The reply may already be sitting in the buffer from an earlier chunk.
      this.consume('');
    });
  }

  /**
   * Sends a line and asserts the reply code; `label` keeps errors readable.
   * @param {string} line
   * @param {number} expected
   * @param {string} label
   * @returns {Promise<SmtpReply>}
   */
  async command(line, expected, label) {
    if (this.debug) console.log(`C: ${label}`);
    this.socket.write(line + CRLF);
    const reply = await this.read();
    if (reply.code !== expected) {
      throw new Error(`SMTP ${label} failed (expected ${expected}): ${reply.text}`);
    }
    return reply;
  }

  /** @param {string} domain */
  async greet(domain) {
    const hello = await this.read();
    if (hello.code !== 220) throw new Error(`SMTP greeting failed: ${hello.text}`);
    await this.command(`EHLO ${domain}`, 250, 'EHLO');
  }

  /**
   * @param {string} user
   * @param {string} pass
   */
  async login(user, pass) {
    await this.command('AUTH LOGIN', 334, 'AUTH LOGIN');
    await this.command(Buffer.from(user, 'utf8').toString('base64'), 334, 'AUTH username');
    await this.command(Buffer.from(pass, 'utf8').toString('base64'), 235, 'AUTH password');
  }

  /**
   * @param {string} from
   * @param {string} to
   * @param {string} data
   * @returns {Promise<SmtpReply>}
   */
  async send(from, to, data) {
    await this.command(`MAIL FROM:<${from}>`, 250, 'MAIL FROM');
    await this.command(`RCPT TO:<${to}>`, 250, 'RCPT TO');
    await this.command('DATA', 354, 'DATA');
    // Dot-stuffing: a line of a single dot would otherwise end the message.
    const stuffed = data.split(CRLF).map((line) => (line.startsWith('.') ? `.${line}` : line));
    if (this.debug) console.log('C: <message body>');
    this.socket.write(`${stuffed.join(CRLF)}${CRLF}.${CRLF}`);
    const accepted = await this.read();
    if (accepted.code !== 250) throw new Error(`SMTP message rejected: ${accepted.text}`);
    return accepted;
  }

  async quit() {
    // The server closes the socket here, so a failed QUIT is not interesting.
    try {
      await this.command('QUIT', 221, 'QUIT');
    } catch {
      // ignored on purpose
    }
    this.close();
  }

  close() {
    this.onFailure = null;
    this.socket.destroy();
  }
}

/**
 * RFC 2047 encoded-word, so a non-ASCII (e.g. Hindi) subject survives the header.
 * @param {string} value
 * @returns {string}
 */
export function encodeHeader(value) {
  if (/^[\x20-\x7E]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

/**
 * Base64 body at 76 chars per line — sidesteps UTF-8 and line-length limits.
 * @param {string} html
 * @returns {string}
 */
function encodeBody(html) {
  const base64 = Buffer.from(html, 'utf8').toString('base64');
  return (base64.match(/.{1,76}/g) ?? []).join(CRLF);
}

/**
 * @param {{ from: string, to: string, subject: string, html: string }} message
 * @param {string} domain
 * @returns {string}
 */
export function buildMessage(message, domain) {
  const messageId = `<${Date.now()}.${Math.random().toString(36).slice(2)}@${domain}>`;
  const headers = [
    `From: ${message.from}`,
    `To: ${message.to}`,
    `Subject: ${encodeHeader(message.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: ${messageId}`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=utf-8',
    'Content-Transfer-Encoding: base64',
  ];
  return `${headers.join(CRLF)}${CRLF}${CRLF}${encodeBody(message.html)}`;
}

/**
 * Opens a connection, sends one message, closes. Throws on any SMTP error.
 * @param {{ user: string, pass: string, host?: string, port?: number, timeoutMs?: number, debug?: boolean }} config
 * @param {{ from: string, to: string, subject: string, html: string }} message
 * @returns {Promise<{ response: string }>}
 */
export async function sendMailViaSmtp(config, message) {
  const host = config.host ?? GMAIL_HOST;
  const port = config.port ?? GMAIL_TLS_PORT;
  const domain = config.user.split('@')[1] ?? 'localhost';

  const session = await SmtpSession.connect(host, port, config.timeoutMs ?? 20_000, config.debug ?? false);
  try {
    await session.greet(domain);
    await session.login(config.user, config.pass);
    const accepted = await session.send(message.from, message.to, buildMessage(message, domain));
    await session.quit();
    return { response: accepted.text };
  } catch (error) {
    session.close();
    throw error;
  }
}
