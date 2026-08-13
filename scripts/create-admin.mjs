#!/usr/bin/env node
// Bootstraps the first staff account (usually an admin). Needed because the in-app
// "create account" endpoint requires an existing admin session to call it.
//
// Usage:
//   node scripts/create-admin.mjs "you@example.com" "Your Name" admin
//
// Prints a `wrangler d1 execute` command — review it, then run it yourself against
// --local (for `wrangler dev`) or --remote (for the deployed database). A random
// temporary password is generated and printed once; the account is created with
// must_change=1 so it's forced to be replaced on first login.

import crypto from "node:crypto";

function b64url(buf) {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const [, , email, name, role = "admin"] = process.argv;
if (!email || !name) {
  console.error('Usage: node scripts/create-admin.mjs "you@example.com" "Your Name" [admin|staff]');
  process.exit(1);
}
if (!["admin", "staff"].includes(role)) {
  console.error("role must be admin or staff");
  process.exit(1);
}

const tempPassword = crypto.randomBytes(9).toString("base64url");
const salt = crypto.randomBytes(16);
const iter = 100000;
const hash = crypto.pbkdf2Sync(tempPassword, salt, iter, 32, "sha256");

const sql = `INSERT INTO staff_users (email, name, role, pw_salt, pw_hash, pw_iter, must_change) VALUES ('${email.toLowerCase().replace(/'/g, "''")}', '${name.replace(/'/g, "''")}', '${role}', '${b64url(salt)}', '${b64url(hash)}', ${iter}, 1);`;

console.log(`Temporary password (save this — shown once): ${tempPassword}\n`);
console.log("Run ONE of these:\n");
console.log(`  npx wrangler d1 execute wtc-labour-rates --local --command "${sql.replace(/"/g, '\\"')}"`);
console.log(`  npx wrangler d1 execute wtc-labour-rates --remote --command "${sql.replace(/"/g, '\\"')}"`);
