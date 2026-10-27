"use strict";
/**
 * Servidor de SMG Soluciones Tecnológicas.
 * - Sirve el sitio desde /public
 * - Guarda los mensajes del formulario en data/mensajes.json
 * - Ofrece un panel de administrador protegido con usuario y clave (validados aquí, en el servidor)
 * Sin dependencias externas: solo Node.js 18 o superior.
 */
const http = require("node:http");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");

// ---------- Configuración (.env opcional) ----------
function loadEnvFile(file) {
  try {
    for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (!m || line.trim().startsWith("#")) continue;
      let value = m[2];
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
      if (process.env[m[1]] === undefined) process.env[m[1]] = value;
    }
  } catch { /* sin .env: se usan los valores por defecto */ }
}
loadEnvFile(path.join(__dirname, ".env"));

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || "0.0.0.0";
const ADMIN_USER = process.env.ADMIN_USER || "Admin";
const ADMIN_PASS = process.env.ADMIN_PASS || "Admin";
const TRUST_PROXY = process.env.TRUST_PROXY === "1";
const COOKIE_SECURE = process.env.COOKIE_SECURE === "1";
const PUBLIC_DIR = path.join(__dirname, "public");
const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "mensajes.json");
const SESSION_TTL_MS = 2 * 60 * 60 * 1000; // 2 horas
const MAX_BODY = 32 * 1024;

const MIME = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".webp": "image/webp", ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8", ".woff2": "font/woff2"
};

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "same-origin",
  "Content-Security-Policy": [
    "default-src 'self'",
    "style-src 'self' https://fonts.googleapis.com",
    "font-src https://fonts.gstatic.com",
    "img-src 'self' data:",
    "script-src 'self'",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'"
  ].join("; ")
};

// ---------- Utilidades ----------
function send(res, status, body, headers = {}) {
  res.writeHead(status, { ...SECURITY_HEADERS, ...headers });
  res.end(body);
}
function sendJson(res, status, obj, headers = {}) {
  send(res, status, JSON.stringify(obj), { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers });
}
function clientIp(req) {
  if (TRUST_PROXY) {
    const xff = req.headers["x-forwarded-for"];
    if (xff) return String(xff).split(",")[0].trim();
  }
  return req.socket.remoteAddress || "unknown";
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on("data", chunk => {
      size += chunk.length;
      if (size > MAX_BODY) { reject(Object.assign(new Error("Cuerpo demasiado grande"), { status: 413 })); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}
async function readJson(req) {
  if (!(req.headers["content-type"] || "").toLowerCase().startsWith("application/json")) {
    throw Object.assign(new Error("Tipo de contenido no válido"), { status: 415 });
  }
  try { return JSON.parse((await readBody(req)) || "{}"); }
  catch (e) { if (e.status) throw e; throw Object.assign(new Error("JSON no válido"), { status: 400 }); }
}
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try { return new URL(origin).host === req.headers.host; } catch { return false; }
}
function safeEqual(a, b) {
  const ha = crypto.createHash("sha256").update(String(a)).digest();
  const hb = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}
const clean = (s, max) => String(s ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim().slice(0, max);

// Límite de intentos por IP (en memoria)
function makeLimiter(limit, windowMs) {
  const hits = new Map();
  return {
    check(key) {
      const now = Date.now();
      const arr = (hits.get(key) || []).filter(t => now - t < windowMs);
      hits.set(key, arr);
      return arr.length < limit;
    },
    add(key) { const arr = hits.get(key) || []; arr.push(Date.now()); hits.set(key, arr); },
    sweep() { const now = Date.now(); for (const [k, v] of hits) { if (!v.some(t => now - t < windowMs)) hits.delete(k); } }
  };
}
const contactLimiter = makeLimiter(5, 10 * 60 * 1000);   // 5 mensajes / 10 min por IP
const loginLimiter = makeLimiter(5, 15 * 60 * 1000);     // 5 intentos fallidos / 15 min por IP

// ---------- Sesiones de administrador ----------
const sessions = new Map(); // token -> expira
function createSession() {
  const token = crypto.randomBytes(32).toString("hex");
  sessions.set(token, Date.now() + SESSION_TTL_MS);
  return token;
}
function getToken(req) {
  const m = /(?:^|;\s*)sid=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || "");
  return m ? m[1] : null;
}
function isAuthed(req) {
  const token = getToken(req);
  if (!token) return false;
  const exp = sessions.get(token);
  if (!exp || exp < Date.now()) { sessions.delete(token); return false; }
  return true;
}
function cookie(token, maxAgeSec, req) {
  const secure = COOKIE_SECURE || (TRUST_PROXY && req.headers["x-forwarded-proto"] === "https");
  return `sid=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAgeSec}${secure ? "; Secure" : ""}`;
}
setInterval(() => {
  const now = Date.now();
  for (const [t, exp] of sessions) if (exp < now) sessions.delete(t);
  contactLimiter.sweep(); loginLimiter.sweep();
}, 10 * 60 * 1000).unref();

// ---------- Almacenamiento en archivo ----------
let writeQueue = Promise.resolve();
async function readMessages() {
  try {
    const raw = await fsp.readFile(DATA_FILE, "utf8");
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) throw new Error("Formato inesperado");
    return list;
  } catch (e) {
    if (e.code === "ENOENT") return [];
    // Archivo dañado: se conserva una copia y se sigue funcionando.
    const backup = `${DATA_FILE}.dañado-${Date.now()}`;
    try { await fsp.rename(DATA_FILE, backup); console.error(`mensajes.json estaba dañado; copia en ${backup}`); } catch { /* ignorar */ }
    return [];
  }
}
function saveMessage(entry) {
  const job = writeQueue.then(async () => {
    await fsp.mkdir(DATA_DIR, { recursive: true });
    const list = await readMessages();
    list.push(entry);
    const tmp = `${DATA_FILE}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(list, null, 2), "utf8");
    await fsp.rename(tmp, DATA_FILE);
  });
  writeQueue = job.catch(() => {});
  return job;
}

function csvCell(value) {
  let s = String(value ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // evita fórmulas al abrir en Excel
  return `"${s.replace(/"/g, '""')}"`;
}

// ---------- Rutas de la API ----------
async function handleApi(req, res, pathname) {
  try {
    if (pathname === "/api/contact" && req.method === "POST") {
      const ip = clientIp(req);
      if (!sameOrigin(req)) return sendJson(res, 403, { error: "Origen no permitido" });
      if (!contactLimiter.check(ip)) return sendJson(res, 429, { error: "Has enviado muchos mensajes. Inténtalo más tarde." });
      const body = await readJson(req);
      if (clean(body.website, 200)) return sendJson(res, 200, { ok: true }); // campo trampa: un bot lo llenó
      const name = clean(body.name, 120);
      const email = clean(body.email, 254);
      const message = clean(body.message, 5000);
      if (name.length < 2) return sendJson(res, 400, { error: "Escribe un nombre válido." });
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return sendJson(res, 400, { error: "Escribe un correo electrónico válido." });
      if (message.length < 5) return sendJson(res, 400, { error: "Escribe un mensaje de al menos 5 caracteres." });
      contactLimiter.add(ip);
      await saveMessage({ id: crypto.randomUUID(), createdAt: new Date().toISOString(), name, email, message });
      return sendJson(res, 201, { ok: true });
    }

    if (pathname === "/api/admin/login" && req.method === "POST") {
      const ip = clientIp(req);
      if (!sameOrigin(req)) return sendJson(res, 403, { error: "Origen no permitido" });
      if (!loginLimiter.check(ip)) return sendJson(res, 429, { error: "Demasiados intentos. Espera unos minutos." });
      const body = await readJson(req);
      const okUser = safeEqual(body.user ?? "", ADMIN_USER);
      const okPass = safeEqual(body.pass ?? "", ADMIN_PASS);
      if (!(okUser && okPass)) {
        loginLimiter.add(ip);
        return sendJson(res, 401, { error: "Usuario o contraseña incorrectos." });
      }
      const token = createSession();
      return sendJson(res, 200, { ok: true }, { "Set-Cookie": cookie(token, SESSION_TTL_MS / 1000, req) });
    }

    if (pathname === "/api/admin/logout" && req.method === "POST") {
      if (!sameOrigin(req)) return sendJson(res, 403, { error: "Origen no permitido" });
      const token = getToken(req);
      if (token) sessions.delete(token);
      return sendJson(res, 200, { ok: true }, { "Set-Cookie": cookie("", 0, req) });
    }

    if (pathname === "/api/admin/session" && req.method === "GET") {
      return sendJson(res, 200, { authenticated: isAuthed(req) });
    }

    if (pathname === "/api/admin/messages" && req.method === "GET") {
      if (!isAuthed(req)) return sendJson(res, 401, { error: "No autorizado" });
      const list = await readMessages();
      return sendJson(res, 200, { messages: list.slice().reverse() });
    }

    if (pathname === "/api/admin/export.csv" && req.method === "GET") {
      if (!isAuthed(req)) return sendJson(res, 401, { error: "No autorizado" });
      const list = await readMessages();
      const rows = [["Fecha", "Nombre", "Correo", "Mensaje"], ...list.map(m => [m.createdAt, m.name, m.email, m.message])];
      const csv = "﻿" + rows.map(r => r.map(csvCell).join(",")).join("\r\n");
      return send(res, 200, csv, {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="mensajes-smg.csv"',
        "Cache-Control": "no-store"
      });
    }

    return sendJson(res, 404, { error: "No encontrado" });
  } catch (e) {
    const status = e.status || 500;
    if (status === 500) console.error("Error en la API:", e);
    return sendJson(res, status, { error: status === 500 ? "Error interno del servidor" : e.message });
  }
}

// ---------- Archivos estáticos ----------
async function serveStatic(req, res, pathname) {
  if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, "Método no permitido", { Allow: "GET, HEAD" });
  let rel;
  try { rel = decodeURIComponent(pathname); } catch { return send(res, 400, "Solicitud no válida"); }
  if (rel.includes("\0")) return send(res, 400, "Solicitud no válida");
  if (rel.endsWith("/")) rel += "index.html";
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  const relative = path.relative(PUBLIC_DIR, file);
  if (relative.startsWith("..") || path.isAbsolute(relative) || relative.split(path.sep).some(p => p.startsWith("."))) {
    return send(res, 404, "No encontrado");
  }
  try {
    const stat = await fsp.stat(file);
    if (!stat.isFile()) return send(res, 404, "No encontrado");
    const type = MIME[path.extname(file).toLowerCase()] || "application/octet-stream";
    const headers = { ...SECURITY_HEADERS, "Content-Type": type, "Content-Length": stat.size, "Cache-Control": "no-cache" };
    res.writeHead(200, headers);
    if (req.method === "HEAD") return res.end();
    fs.createReadStream(file).on("error", () => res.destroy()).pipe(res);
  } catch {
    return send(res, 404, "Página no encontrada", { "Content-Type": "text/plain; charset=utf-8" });
  }
}

const server = http.createServer((req, res) => {
  let pathname;
  try { pathname = new URL(req.url, "http://localhost").pathname; } catch { return send(res, 400, "Solicitud no válida"); }
  if (pathname.startsWith("/api/")) return void handleApi(req, res, pathname);
  return void serveStatic(req, res, pathname);
});

server.listen(PORT, HOST, () => {
  console.log(`SMG web en marcha: http://localhost:${PORT}`);
  console.log(`Mensajes guardados en: ${DATA_FILE}`);
  if (ADMIN_USER === "Admin" && ADMIN_PASS === "Admin") {
    console.log("AVISO: se usa el acceso por defecto Admin / Admin. Cámbialo en .env (ADMIN_USER y ADMIN_PASS) antes de publicar el sitio.");
  }
});
