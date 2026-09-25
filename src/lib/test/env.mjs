/**
 * TEMPORARY — `.env` reading shared by the scripts in this folder.
 *
 * These run as plain Node scripts, outside Next, so they load `.env`
 * themselves. It is only ever read, never written.
 *
 * Plain `.mjs` for the same reason as ./smtp.mjs: `.mts` files cannot import
 * each other under `node --experimental-strip-types`.
 */

import path from 'node:path';
import process from 'node:process';
import dotenv from 'dotenv';

/** Loads `.env` once. Pre-set environment variables win, as dotenv defaults. */
export function loadEnv() {
  dotenv.config({ path: path.resolve(process.cwd(), '.env'), quiet: true });
}

/**
 * @param {string} name
 * @returns {string}
 */
export function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is missing from .env — this test cannot run without it.`);
  }
  return value;
}

/**
 * NEWSLETTER_TO may hold several addresses; one test email needs only the first.
 * @param {string} raw
 * @returns {string}
 */
export function firstRecipient(raw) {
  const first = raw
    .split(/[,;]/)
    .map((address) => address.trim())
    .filter(Boolean)[0];
  if (!first) throw new Error('NEWSLETTER_TO holds no usable address.');
  return first;
}

/**
 * The Gmail sender, recipient and App Password this folder sends with.
 * @returns {{ from: string, to: string, pass: string }}
 */
export function gmailCredentials() {
  return {
    from: requireEnv('NEWSLETTER_FROM_EMAIL'),
    to: firstRecipient(requireEnv('NEWSLETTER_TO')),
    // Google shows App Passwords as four space-separated groups; SMTP wants none.
    pass: requireEnv('NEWSLETTER_FROM_APP_PASSWORD').replace(/\s+/g, ''),
  };
}

/** Where the running Next app is, for the read-only HTTP calls. */
export function appBaseUrl() {
  const base =
    process.env.INTERNAL_BASE_URL?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    'http://localhost:3000';
  return base.replace(/\/+$/, '');
}

/**
 * The delivery routes accept `x-cron-secret`; unset means open in development.
 * @returns {Record<string, string>}
 */
export function cronHeaders() {
  const secret = process.env.CRON_SECRET?.trim();
  return secret ? { 'x-cron-secret': secret } : {};
}
