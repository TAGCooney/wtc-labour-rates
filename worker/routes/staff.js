import { match } from "../router.js";
import { json, error } from "../http.js";
import {
  hashPassword,
  verifyPassword,
  makeCookie,
  clearCookie,
  readSession,
  requireRole,
  createInviteToken,
  hashInviteToken,
} from "../auth.js";

function staffRow(row) {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    mustChange: !!row.must_change,
    pendingInvite: !!row.invite_token_hash,
  };
}

export async function requireSession(request, env) {
  const session = await readSession(request, env);
  if (!session) return null;
  const row = await env.DB.prepare("SELECT * FROM staff_users WHERE id = ?").bind(session.id).first();
  if (!row) return null;
  return row;
}

export async function handleStaffAuth(request, env, url) {
  const { pathname } = url;
  const method = request.method;

  if (match("/api/staff/login", pathname) && method === "POST") {
    const body = await request.json().catch(() => ({}));
    const row = await env.DB.prepare("SELECT * FROM staff_users WHERE email = ?")
      .bind((body.email || "").trim().toLowerCase())
      .first();
    if (!row || !(await verifyPassword(body.password || "", row))) {
      return error("Invalid email or password", 401);
    }
    const cookie = await makeCookie(env, { id: row.id, role: row.role, exp: Date.now() + 12 * 3600 * 1000 });
    return new Response(JSON.stringify(staffRow(row)), {
      status: 200,
      headers: { "Content-Type": "application/json", "Set-Cookie": cookie },
    });
  }

  if (match("/api/staff/logout", pathname) && method === "POST") {
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json", "Set-Cookie": clearCookie() },
    });
  }

  // Account-setup invite link (unauthenticated -- the whole point is the new
  // person doesn't have a session or password yet).
  if (match("/api/staff/accept-invite", pathname) && method === "POST") {
    const body = await request.json().catch(() => ({}));
    if (!body.token || !body.password) return error("token and password required");
    if (body.password.length < 8) return error("Password must be at least 8 characters");
    const tokenHash = await hashInviteToken(body.token);
    const row = await env.DB.prepare(
      "SELECT * FROM staff_users WHERE invite_token_hash = ? AND invite_expires_at > datetime('now')"
    )
      .bind(tokenHash)
      .first();
    if (!row) return error("This setup link is invalid or has expired -- ask an admin to send a new one", 404);
    const { salt, hash, iter } = await hashPassword(body.password);
    const updated = await env.DB.prepare(
      `UPDATE staff_users SET pw_salt=?, pw_hash=?, pw_iter=?, must_change=0, invite_token_hash=NULL, invite_expires_at=NULL
       WHERE id=? RETURNING *`
    )
      .bind(salt, hash, iter, row.id)
      .first();
    const cookie = await makeCookie(env, { id: updated.id, role: updated.role, exp: Date.now() + 12 * 3600 * 1000 });
    return new Response(JSON.stringify(staffRow(updated)), {
      status: 200,
      headers: { "Content-Type": "application/json", "Set-Cookie": cookie },
    });
  }

  const staff = await requireSession(request, env);
  if (!staff) return error("Not authenticated", 401);
  const session = { id: staff.id, role: staff.role };

  if (match("/api/staff/me", pathname) && method === "GET") {
    return json(staffRow(staff));
  }

  if (match("/api/staff/password", pathname) && method === "POST") {
    const body = await request.json().catch(() => ({}));
    if (!body.password || body.password.length < 8) return error("Password must be at least 8 characters");
    const { salt, hash, iter } = await hashPassword(body.password);
    await env.DB.prepare("UPDATE staff_users SET pw_salt=?, pw_hash=?, pw_iter=?, must_change=0 WHERE id=?")
      .bind(salt, hash, iter, staff.id)
      .run();
    return json({ ok: true });
  }

  if (match("/api/staff/accounts", pathname) && method === "GET") {
    if (!requireRole(session, ["admin"])) return error("Forbidden", 403);
    const rows = await env.DB.prepare("SELECT * FROM staff_users ORDER BY name").all();
    return json(rows.results.map(staffRow));
  }
  if (match("/api/staff/accounts", pathname) && method === "POST") {
    if (!requireRole(session, ["admin"])) return error("Forbidden", 403);
    const body = await request.json().catch(() => ({}));
    if (!body.email || !body.name || !body.role) return error("email, name, role required");
    if (!["admin", "staff"].includes(body.role)) return error("role must be admin or staff");
    // Placeholder password nobody knows -- login stays impossible until the invite link is used.
    const { salt, hash, iter } = await hashPassword(crypto.randomUUID());
    const { token, hash: inviteHash, expiresAt } = await createInviteToken();
    const row = await env.DB.prepare(
      `INSERT INTO staff_users (email, name, role, pw_salt, pw_hash, pw_iter, must_change, invite_token_hash, invite_expires_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?) RETURNING *`
    )
      .bind(body.email.trim().toLowerCase(), body.name, body.role, salt, hash, iter, inviteHash, expiresAt)
      .first();
    const inviteLink = `${url.origin}/setup.html?token=${token}`;
    return json({ ...staffRow(row), inviteLink }, 201);
  }

  let m = match("/api/staff/accounts/:id", pathname);
  if (m && method === "PATCH") {
    if (!requireRole(session, ["admin"])) return error("Forbidden", 403);
    const body = await request.json().catch(() => ({}));
    const fields = [];
    const values = [];
    for (const [col, key] of [
      ["name", "name"],
      ["role", "role"],
    ]) {
      if (body[key] !== undefined) {
        fields.push(`${col} = ?`);
        values.push(body[key]);
      }
    }
    if (!fields.length) return error("Nothing to update");
    values.push(m.id);
    const row = await env.DB.prepare(`UPDATE staff_users SET ${fields.join(", ")} WHERE id = ? RETURNING *`)
      .bind(...values)
      .first();
    if (!row) return error("Not found", 404);
    return json(staffRow(row));
  }

  return error("Not found", 404);
}
