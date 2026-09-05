/* Diario FIT API - Step 1
 * Cloudflare Worker + D1
 *
 * Deliberatamente NON contiene password o chiavi Gemini.
 * Le credenziali vengono ricevute dal client, la password viene hashata
 * sul server con PBKDF2 e il database conserva solo hash + salt.
 */

const SESSION_DAYS = 30;
const PBKDF2_ITERATIONS = 310000;
const PASSWORD_MIN_LENGTH = 8;
const MAX_JSON_BYTES = 250000;

export default {
  async fetch(request, env) {
    try {
      const cors = corsHeaders(request, env);

      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: cors });
      }

      const url = new URL(request.url);
      if (!url.pathname.startsWith("/api/")) {
        return json({ ok: true, service: "Diario FIT API", version: 1 }, 200, cors);
      }

      const route = url.pathname.replace(/\/+$/, "") || "/";

      if (request.method === "GET" && route === "/api/health") {
        return json({ ok: true, service: "diario-fit-api", time: new Date().toISOString() }, 200, cors);
      }

      if (request.method === "POST" && route === "/api/auth/register") {
        return await register(request, env, cors);
      }

      if (request.method === "POST" && route === "/api/auth/login") {
        return await login(request, env, cors);
      }

      if (request.method === "POST" && route === "/api/auth/logout") {
        return await logout(request, env, cors);
      }

      const auth = await authenticate(request, env);
      if (!auth) {
        return json({ ok: false, error: "AUTH_REQUIRED" }, 401, cors);
      }

      if (request.method === "GET" && route === "/api/me") {
        return json({ ok: true, user: publicUser(auth.user) }, 200, cors);
      }

      if (request.method === "GET" && route === "/api/user/profile") {
        return await getProfile(auth.user.id, env, cors);
      }

      if (request.method === "PUT" && route === "/api/user/profile") {
        return await putProfile(auth.user.id, request, env, cors);
      }

      if (request.method === "GET" && route === "/api/user/settings") {
        return await getSettings(auth.user.id, env, cors);
      }

      if (request.method === "PUT" && route === "/api/user/settings") {
        return await putSettings(auth.user.id, request, env, cors);
      }

      if (request.method === "GET" && route === "/api/user/diary") {
        return await getDiaryDay(auth.user.id, url.searchParams.get("date"), env, cors);
      }

      if (request.method === "PUT" && route === "/api/user/diary") {
        return await putDiaryDay(auth.user.id, request, env, cors);
      }

      if (request.method === "GET" && route === "/api/user/history") {
        return await getHistory(auth.user.id, url.searchParams, env, cors);
      }

      if (request.method === "POST" && route === "/api/user/migrate") {
        return await migrateLegacy(auth.user.id, request, env, cors);
      }

      if (route.startsWith("/api/admin/") && auth.user.role !== "admin") {
        return json({ ok: false, error: "ADMIN_REQUIRED" }, 403, cors);
      }

      if (request.method === "GET" && route === "/api/admin/users") {
        return await adminListUsers(env, cors);
      }

      if (request.method === "POST" && route === "/api/admin/users") {
        return await adminCreateUser(request, env, cors);
      }

      if (request.method === "PATCH" && /^\/api\/admin\/users\/[^/]+$/.test(route)) {
        return await adminUpdateUser(route.split("/").pop(), request, env, cors);
      }

      if (request.method === "DELETE" && /^\/api\/admin\/users\/[^/]+$/.test(route)) {
        return await adminDeleteUser(route.split("/").pop(), auth.user.id, env, cors);
      }

      return json({ ok: false, error: "NOT_FOUND" }, 404, cors);
    } catch (err) {
      console.error(err);
      return json({ ok: false, error: "INTERNAL_ERROR" }, 500, corsHeaders(request, env));
    }
  }
};

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin") || "";
  const allowed = env.ALLOWED_ORIGIN || "";
  const headers = {
    "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
  if (origin && allowed && origin === allowed) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

function json(data, status, cors = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...cors }
  });
}

async function readJson(request) {
  const contentLength = Number(request.headers.get("Content-Length") || 0);
  if (contentLength > MAX_JSON_BYTES) throw new Error("PAYLOAD_TOO_LARGE");
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_JSON_BYTES) throw new Error("PAYLOAD_TOO_LARGE");
  if (!text) return {};
  return JSON.parse(text);
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function cleanName(value) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, 80);
}

function validDateKey(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
}

function id(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function now() {
  return new Date().toISOString();
}

function futureIso(days) {
  return new Date(Date.now() + days * 86400000).toISOString();
}

function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    status: user.status,
    created_at: user.created_at,
    last_login_at: user.last_login_at
  };
}

function bytesToB64(bytes) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function b64ToBytes(value) {
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

async function hashPassword(password, saltBytes) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: saltBytes, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    key,
    256
  );
  return new Uint8Array(bits);
}

async function createPasswordHash(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await hashPassword(password, salt);
  return { salt: bytesToB64(salt), hash: bytesToB64(hash) };
}

async function verifyPassword(password, storedHash, storedSalt) {
  const hash = await hashPassword(password, b64ToBytes(storedSalt));
  const expected = b64ToBytes(storedHash);
  if (hash.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < hash.length; i++) diff |= hash[i] ^ expected[i];
  return diff === 0;
}

async function hashToken(token) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return bytesToB64(new Uint8Array(digest));
}

async function createSession(userId, env) {
  const tokenBytes = crypto.getRandomValues(new Uint8Array(32));
  const token = bytesToB64(tokenBytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const tokenHash = await hashToken(token);
  const timestamp = now();
  await env.DB.prepare(
    `INSERT INTO sessions (id,user_id,token_hash,created_at,expires_at,last_seen_at) VALUES (?,?,?,?,?,?)`
  ).bind(id("sess"), userId, tokenHash, timestamp, futureIso(SESSION_DAYS), timestamp).run();
  return token;
}

async function authenticate(request, env) {
  const header = request.headers.get("Authorization") || "";
  if (!header.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  if (!token) return null;
  const tokenHash = await hashToken(token);
  const row = await env.DB.prepare(
    `SELECT s.id AS session_id, s.expires_at, u.*
     FROM sessions s JOIN users u ON u.id=s.user_id
     WHERE s.token_hash=? LIMIT 1`
  ).bind(tokenHash).first();
  if (!row) return null;
  if (row.expires_at <= now() || row.status !== "active") return null;
  await env.DB.prepare(`UPDATE sessions SET last_seen_at=? WHERE id=?`).bind(now(), row.session_id).run();
  return { tokenHash, user: row };
}

async function register(request, env, cors) {
  const body = await readJson(request);
  const email = normalizeEmail(body.email);
  const name = cleanName(body.name);
  const password = String(body.password || "");
  if (!email || !email.includes("@") || email.length > 190) return json({ ok:false, error:"INVALID_EMAIL" }, 400, cors);
  if (!name) return json({ ok:false, error:"INVALID_NAME" }, 400, cors);
  if (password.length < PASSWORD_MIN_LENGTH) return json({ ok:false, error:"PASSWORD_TOO_SHORT" }, 400, cors);

  const count = await env.DB.prepare(`SELECT COUNT(*) AS n FROM users`).first();
  const role = Number(count?.n || 0) === 0 ? "admin" : "user";
  if (role === "user" && body.inviteCode !== env.REGISTRATION_INVITE_CODE) {
    return json({ ok:false, error:"REGISTRATION_DISABLED" }, 403, cors);
  }

  const existing = await env.DB.prepare(`SELECT id FROM users WHERE email=?`).bind(email).first();
  if (existing) return json({ ok:false, error:"EMAIL_ALREADY_EXISTS" }, 409, cors);

  const { salt, hash } = await createPasswordHash(password);
  const timestamp = now();
  const userId = id("usr");
  await env.DB.prepare(
    `INSERT INTO users (id,email,name,password_hash,password_salt,role,status,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?)`
  ).bind(userId, email, name, hash, salt, role, "active", timestamp, timestamp).run();

  await ensureUserSettings(userId, env);
  const token = await createSession(userId, env);
  return json({ ok:true, user: { id:userId,email,name,role,status:"active" }, token }, 201, cors);
}

async function login(request, env, cors) {
  const body = await readJson(request);
  const email = normalizeEmail(body.email);
  const password = String(body.password || "");
  const user = await env.DB.prepare(`SELECT * FROM users WHERE email=? LIMIT 1`).bind(email).first();
  if (!user || user.status !== "active") return json({ ok:false, error:"INVALID_CREDENTIALS" }, 401, cors);
  const valid = await verifyPassword(password, user.password_hash, user.password_salt);
  if (!valid) return json({ ok:false, error:"INVALID_CREDENTIALS" }, 401, cors);

  const timestamp = now();
  await env.DB.prepare(`UPDATE users SET last_login_at=?,updated_at=? WHERE id=?`).bind(timestamp,timestamp,user.id).run();
  const token = await createSession(user.id, env);
  return json({ ok:true, user: publicUser({ ...user, last_login_at: timestamp }), token }, 200, cors);
}

async function logout(request, env, cors) {
  const header = request.headers.get("Authorization") || "";
  if (header.startsWith("Bearer ")) {
    const tokenHash = await hashToken(header.slice(7).trim());
    await env.DB.prepare(`DELETE FROM sessions WHERE token_hash=?`).bind(tokenHash).run();
  }
  return json({ ok:true }, 200, cors);
}

async function ensureUserSettings(userId, env) {
  const existing = await env.DB.prepare(`SELECT user_id FROM user_settings WHERE user_id=?`).bind(userId).first();
  if (!existing) {
    await env.DB.prepare(
      `INSERT INTO user_settings (user_id,targets_json,saved_foods_json,quick_items_json,settings_json,updated_at)
       VALUES (?,?,?,?,?,?)`
    ).bind(userId, JSON.stringify({kcal:2000,pro:160,fat:65,carb:180,water:2500}), "[]", "[]", "{}", now()).run();
  }
}

async function getProfile(userId, env, cors) {
  const user = await env.DB.prepare(`SELECT id,email,name,role,status,profile_json FROM users WHERE id=?`).bind(userId).first();
  await ensureUserSettings(userId, env);
  return json({ ok:true, user:publicUser(user), profile:JSON.parse(user.profile_json || "{}") }, 200, cors);
}

async function putProfile(userId, request, env, cors) {
  const body = await readJson(request);
  const profile = body.profile && typeof body.profile === "object" ? body.profile : {};
  const name = cleanName(body.name ?? profile.name);
  if (name) {
    await env.DB.prepare(`UPDATE users SET name=?,profile_json=?,updated_at=? WHERE id=?`).bind(name,JSON.stringify(profile),now(),userId).run();
  } else {
    await env.DB.prepare(`UPDATE users SET profile_json=?,updated_at=? WHERE id=?`).bind(JSON.stringify(profile),now(),userId).run();
  }
  return json({ok:true},200,cors);
}

async function getSettings(userId, env, cors) {
  await ensureUserSettings(userId, env);
  const row = await env.DB.prepare(`SELECT * FROM user_settings WHERE user_id=?`).bind(userId).first();
  return json({
    ok:true,
    targets:JSON.parse(row.targets_json || "{}"),
    savedFoods:JSON.parse(row.saved_foods_json || "[]"),
    quickItems:JSON.parse(row.quick_items_json || "[]"),
    settings:JSON.parse(row.settings_json || "{}")
  },200,cors);
}

async function putSettings(userId, request, env, cors) {
  const body = await readJson(request);
  await ensureUserSettings(userId, env);
  const row = await env.DB.prepare(`SELECT * FROM user_settings WHERE user_id=?`).bind(userId).first();
  const targets = body.targets ?? JSON.parse(row.targets_json || "{}");
  const savedFoods = body.savedFoods ?? JSON.parse(row.saved_foods_json || "[]");
  const quickItems = body.quickItems ?? JSON.parse(row.quick_items_json || "[]");
  const settings = body.settings ?? JSON.parse(row.settings_json || "{}");
  await env.DB.prepare(
    `UPDATE user_settings SET targets_json=?,saved_foods_json=?,quick_items_json=?,settings_json=?,updated_at=? WHERE user_id=?`
  ).bind(JSON.stringify(targets),JSON.stringify(savedFoods),JSON.stringify(quickItems),JSON.stringify(settings),now(),userId).run();
  return json({ok:true},200,cors);
}

async function getDiaryDay(userId, dateKey, env, cors) {
  if (!validDateKey(dateKey)) return json({ok:false,error:"INVALID_DATE"},400,cors);
  const row = await env.DB.prepare(`SELECT date_key,log_json,summary_json,updated_at FROM diary_days WHERE user_id=? AND date_key=?`).bind(userId,dateKey).first();
  if (!row) return json({ok:true,date:dateKey,log:[],summary:{},exists:false},200,cors);
  return json({ok:true,date:row.date_key,log:JSON.parse(row.log_json||"[]"),summary:JSON.parse(row.summary_json||"{}"),updated_at:row.updated_at,exists:true},200,cors);
}

async function putDiaryDay(userId, request, env, cors) {
  const body = await readJson(request);
  const dateKey = body.date;
  if (!validDateKey(dateKey)) return json({ok:false,error:"INVALID_DATE"},400,cors);
  const log = Array.isArray(body.log) ? body.log : [];
  const summary = body.summary && typeof body.summary === "object" ? body.summary : {};
  const timestamp = now();
  await env.DB.prepare(
    `INSERT INTO diary_days (id,user_id,date_key,log_json,summary_json,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?)
     ON CONFLICT(user_id,date_key) DO UPDATE SET log_json=excluded.log_json,summary_json=excluded.summary_json,updated_at=excluded.updated_at`
  ).bind(id("day"),userId,dateKey,JSON.stringify(log),JSON.stringify(summary),timestamp,timestamp).run();
  return json({ok:true,date:dateKey,updated_at:timestamp},200,cors);
}

async function getHistory(userId, params, env, cors) {
  const limit = Math.min(Math.max(Number(params.get("limit") || 365),1),1000);
  const rows = await env.DB.prepare(
    `SELECT date_key,log_json,summary_json,updated_at FROM diary_days WHERE user_id=? ORDER BY date_key DESC LIMIT ?`
  ).bind(userId,limit).all();
  const history = (rows.results || []).map(row => ({
    date:row.date_key,
    log:JSON.parse(row.log_json||"[]"),
    summary:JSON.parse(row.summary_json||"{}"),
    updated_at:row.updated_at
  }));
  return json({ok:true,history},200,cors);
}

async function migrateLegacy(userId, request, env, cors) {
  const body = await readJson(request);
  if (body.version !== 1) return json({ok:false,error:"UNSUPPORTED_MIGRATION_VERSION"},400,cors);
  const settings = body.settings || {};
  const history = body.history && typeof body.history === "object" ? body.history : {};
  const currentDate = body.currentDate;
  const currentLog = Array.isArray(body.currentLog) ? body.currentLog : [];

  await ensureUserSettings(userId, env);
  await putSettingsInternal(userId, settings, env);

  const entries = Object.entries(history).filter(([date]) => validDateKey(date));
  for (const [dateKey, value] of entries) {
    const log = Array.isArray(value?.log) ? value.log : [];
    const summary = value?.summary && typeof value.summary === "object" ? value.summary : {};
    const timestamp = now();
    await env.DB.prepare(
      `INSERT INTO diary_days (id,user_id,date_key,log_json,summary_json,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?)
       ON CONFLICT(user_id,date_key) DO UPDATE SET log_json=excluded.log_json,summary_json=excluded.summary_json,updated_at=excluded.updated_at`
    ).bind(id("day"),userId,dateKey,JSON.stringify(log),JSON.stringify(summary),timestamp,timestamp).run();
  }

  if (validDateKey(currentDate)) {
    const timestamp = now();
    await env.DB.prepare(
      `INSERT INTO diary_days (id,user_id,date_key,log_json,summary_json,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?)
       ON CONFLICT(user_id,date_key) DO UPDATE SET log_json=excluded.log_json,updated_at=excluded.updated_at`
    ).bind(id("day"),userId,currentDate,JSON.stringify(currentLog),JSON.stringify({}),timestamp,timestamp).run();
  }

  await env.DB.prepare(`INSERT INTO audit_log (id,user_id,action,details_json,created_at) VALUES (?,?,?,?,?)`)
    .bind(id("audit"),userId,"legacy_migration",JSON.stringify({historyDays:entries.length,currentDate:currentDate||null}),now()).run();

  return json({ok:true,importedHistoryDays:entries.length},200,cors);
}

async function putSettingsInternal(userId, settings, env) {
  const targets = settings.targets ?? {kcal:2000,pro:160,fat:65,carb:180,water:2500};
  const savedFoods = Array.isArray(settings.savedFoods) ? settings.savedFoods : [];
  const quickItems = Array.isArray(settings.quickItems) ? settings.quickItems : [];
  const extra = settings.settings && typeof settings.settings === "object" ? settings.settings : {};
  await env.DB.prepare(
    `UPDATE user_settings SET targets_json=?,saved_foods_json=?,quick_items_json=?,settings_json=?,updated_at=? WHERE user_id=?`
  ).bind(JSON.stringify(targets),JSON.stringify(savedFoods),JSON.stringify(quickItems),JSON.stringify(extra),now(),userId).run();
}

async function adminListUsers(env, cors) {
  const rows = await env.DB.prepare(
    `SELECT id,email,name,role,status,created_at,updated_at,last_login_at FROM users ORDER BY created_at ASC`
  ).all();
  return json({ok:true,users:rows.results||[]},200,cors);
}

async function adminCreateUser(request, env, cors) {
  const body = await readJson(request);
  const email = normalizeEmail(body.email);
  const name = cleanName(body.name);
  const password = String(body.password || "");
  const role = body.role === "admin" ? "admin" : "user";
  if (!email || !email.includes("@") || !name || password.length < PASSWORD_MIN_LENGTH) {
    return json({ok:false,error:"INVALID_USER_DATA"},400,cors);
  }
  const existing = await env.DB.prepare(`SELECT id FROM users WHERE email=?`).bind(email).first();
  if (existing) return json({ok:false,error:"EMAIL_ALREADY_EXISTS"},409,cors);
  const {salt,hash} = await createPasswordHash(password);
  const timestamp = now();
  const userId = id("usr");
  await env.DB.prepare(
    `INSERT INTO users (id,email,name,password_hash,password_salt,role,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)`
  ).bind(userId,email,name,hash,salt,role,"active",timestamp,timestamp).run();
  await ensureUserSettings(userId,env);
  return json({ok:true,user:{id:userId,email,name,role,status:"active"}},201,cors);
}

async function adminUpdateUser(userId, request, env, cors) {
  const body = await readJson(request);
  const current = await env.DB.prepare(`SELECT * FROM users WHERE id=?`).bind(userId).first();
  if (!current) return json({ok:false,error:"USER_NOT_FOUND"},404,cors);
  const name = body.name !== undefined ? cleanName(body.name) : current.name;
  const role = body.role === "admin" ? "admin" : body.role === "user" ? "user" : current.role;
  const status = body.status === "disabled" ? "disabled" : body.status === "active" ? "active" : current.status;
  await env.DB.prepare(`UPDATE users SET name=?,role=?,status=?,updated_at=? WHERE id=?`).bind(name,role,status,now(),userId).run();
  if (status === "disabled") await env.DB.prepare(`DELETE FROM sessions WHERE user_id=?`).bind(userId).run();
  return json({ok:true},200,cors);
}

async function adminDeleteUser(userId, requesterId, env, cors) {
  if (userId === requesterId) return json({ok:false,error:"CANNOT_DELETE_SELF"},400,cors);
  const user = await env.DB.prepare(`SELECT id FROM users WHERE id=?`).bind(userId).first();
  if (!user) return json({ok:false,error:"USER_NOT_FOUND"},404,cors);
  await env.DB.prepare(`DELETE FROM users WHERE id=?`).bind(userId).run();
  return json({ok:true},200,cors);
}
