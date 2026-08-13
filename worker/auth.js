// Staff auth: PBKDF2-HMAC-SHA256 password hashing + HMAC-signed httpOnly session cookie.
// Same shape as nomads-compendium / meetme-loop (same org, same pattern).

import { getCookie } from "./cookies.js";

const COOKIE_NAME = "wtcsess";
const SESSION_HOURS = 12;

function b64url(bytes) {
  let bin = "";
  for (const b of new Uint8Array(bytes)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlToBytes(str) {
  str = str.replace(/-/g, "+").replace(/_/g, "/");
  while (str.length % 4) str += "=";
  const bin = atob(str);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function eqTime(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function pbkdf2(password, saltBytes, iterations) {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: saltBytes, iterations, hash: "SHA-256" },
    keyMaterial,
    256
  );
  return b64url(bits);
}

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iter = 100000;
  const hash = await pbkdf2(password, salt, iter);
  return { salt: b64url(salt), hash, iter };
}

export async function verifyPassword(password, stored) {
  const salt = b64urlToBytes(stored.pw_salt);
  const hash = await pbkdf2(password, salt, stored.pw_iter);
  return eqTime(hash, stored.pw_hash);
}

async function hmac(env, data) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.SESSION_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return b64url(sig);
}

export async function makeCookie(env, payload) {
  const body = b64url(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = await hmac(env, body);
  const token = `${body}.${sig}`;
  return `${COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_HOURS * 3600}`;
}

export function clearCookie() {
  return `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

export async function readSession(request, env) {
  const token = getCookie(request, COOKIE_NAME);
  if (!token) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = await hmac(env, body);
  if (!eqTime(sig, expected)) return null;
  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(body)));
  } catch {
    return null;
  }
  if (!payload.exp || Date.now() > payload.exp) return null;
  return payload; // { id, role, exp }
}

export function requireRole(session, roles) {
  if (!session) return false;
  if (!roles) return true;
  return roles.includes(session.role);
}
