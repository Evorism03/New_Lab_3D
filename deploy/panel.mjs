// Web version of the server control window (Lab3D.exe), served on panel.<domain> through Caddy.
// It is the same panel, not a copy: it reads the same state files, runs the same deploy/server.ps1
// commands and writes to the same journal (logs/journal.log) the desktop window shows — whatever
// is done in one is visible in the other, and the two never run an operation at the same time.
//
// Runs on its own (Windows task "Lab3D Panel", see server.ps1 panel-install), so it keeps working
// while the site restarts. Plain Node, no dependencies. Listens on 127.0.0.1 only; Caddy adds HTTPS.
//
//   node deploy/panel.mjs        # PANEL_PASSWORD / PANEL_SECRET / PANEL_PORT come from .env.production

import { spawn, execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEPLOY = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(DEPLOY);
const ENV_FILE = path.join(ROOT, ".env.production");
const LOG_DIR = path.join(DEPLOY, "logs");
const JOURNAL = path.join(LOG_DIR, "journal.log");
const WEB_LOCK = path.join(DEPLOY, "operation.json"); // written here while a web operation runs
const GUI_LOCK = path.join(DEPLOY, "gui-operation.json"); // written by Lab3D.exe while it runs one
const SERVER_PS1 = path.join(DEPLOY, "server.ps1");
const LAB_ROOT = path.join(ROOT, "lab");
const LAB_SERVER_PS1 = path.join(LAB_ROOT, "deploy", "server.ps1");

const SESSION_HOURS = 12;
const MAX_FAILED_LOGINS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

// ---------------------------------------------------------------- settings

function readEnv(file = ENV_FILE) {
  const values = {};
  try {
    for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (m) values[m[1]] = m[2].replace(/^"(.*)"$/, "$1");
    }
  } catch {
    // not installed yet
  }
  return values;
}

const startupEnv = readEnv();
const PORT = Number(startupEnv.PANEL_PORT) || 3100;
// Without a stored secret sessions just end when the panel restarts.
const SECRET = startupEnv.PANEL_SECRET || crypto.randomBytes(32).toString("hex");

// ---------------------------------------------------------------- auth

// "pbkdf2-sha256$<iterations>$<salt b64>$<hash b64>" — written by Set-PanelPassword (deploy/lib.ps1).
function checkPassword(password) {
  const stored = readEnv().PANEL_PASSWORD || "";
  const [scheme, iterations, salt, hash] = stored.split("$");
  if (scheme !== "pbkdf2-sha256" || !hash) return false;
  const expected = Buffer.from(hash, "base64");
  const actual = crypto.pbkdf2Sync(String(password), Buffer.from(salt, "base64"), Number(iterations), expected.length, "sha256");
  return crypto.timingSafeEqual(actual, expected);
}

const sign = (data) => crypto.createHmac("sha256", SECRET).update(data).digest("base64url");

function newSession() {
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + SESSION_HOURS * 3600e3 })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

function isAuthed(req) {
  const cookie = (req.headers.cookie || "").split(/;\s*/).find((c) => c.startsWith("panel_session="));
  if (!cookie) return false;
  const [payload, mac] = cookie.slice("panel_session=".length).split(".");
  if (!payload || !mac) return false;
  const expected = sign(payload);
  if (mac.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return false;
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString()).exp > Date.now();
  } catch {
    return false;
  }
}

// Caddy is the only client (we listen on loopback), so its X-Forwarded-For is the real address.
const clientIp = (req) => String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
const failedLogins = new Map(); // ip → { count, until }

// ---------------------------------------------------------------- state (same files as Lab3D.exe)

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8").replace(/^﻿/, ""));
  } catch {
    return null;
  }
}

function alive(pid) {
  if (!pid) return false;
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch (err) {
    return err.code === "EPERM";
  }
}

function serviceState(stateFile, envFile) {
  if (!fs.existsSync(envFile)) return { state: "not-installed" };
  const s = readJson(stateFile);
  if (!s || !alive(s.supervisorPid)) return { state: "stopped" };
  return { state: s.ready ? "running" : "starting", url: s.url || "", startedAt: s.startedAt || null };
}

function bambuddyState() {
  return new Promise((resolve) => {
    execFile("sc.exe", ["query", "Bambuddy"], { windowsHide: true }, (err, stdout) => {
      if (err && !stdout) return resolve({ state: "not-installed" });
      const m = String(stdout).match(/STATE\s*:\s*\d+\s+(\w+)/);
      if (!m) return resolve({ state: "not-installed" });
      const map = { RUNNING: "running", STOPPED: "stopped", START_PENDING: "starting", STOP_PENDING: "stopping" };
      resolve({ state: map[m[1]] || m[1].toLowerCase() });
    });
  });
}

function gitHead() {
  return new Promise((resolve) => {
    execFile("git", ["-c", "safe.directory=*", "-C", ROOT, "log", "-1", "--format=%h · %cd · %s", "--date=format:%d.%m.%Y %H:%M"],
      { windowsHide: true }, (err, stdout) => resolve(err ? "" : String(stdout).trim()));
  });
}

function currentOperation() {
  const web = readJson(WEB_LOCK);
  if (web && alive(web.pid)) return { title: web.title, source: "web" };
  const gui = readJson(GUI_LOCK);
  if (gui && alive(gui.pid)) return { title: gui.title, source: "gui" };
  return null;
}

let lastGitCheck = null; // result of the last "server.ps1 git-check"

// ---------------------------------------------------------------- operations

// Everything the web panel may run — the same commands as the buttons of Lab3D.exe. No "stop" for
// the site itself: HTTPS (Caddy) runs with it, so stopping it would cut off this very panel.
const ACTIONS = {
  "site-restart": { title: "Перезапуск сервера", script: SERVER_PS1, args: ["restart"] },
  "site-update": { title: "Обновление сайта", script: SERVER_PS1, args: ["update", "-Yes"] },
  "crm-start": { title: "Запуск «Заказы»", script: LAB_SERVER_PS1, args: ["start"] },
  "crm-stop": { title: "Остановка «Заказы»", script: LAB_SERVER_PS1, args: ["stop"] },
  "crm-restart": { title: "Перезапуск «Заказы»", script: LAB_SERVER_PS1, args: ["restart"] },
  "bambuddy-start": { title: "Запуск Bambuddy", script: SERVER_PS1, args: ["bambuddy-start"] },
  "bambuddy-stop": { title: "Остановка Bambuddy", script: SERVER_PS1, args: ["bambuddy-stop"] },
  "bambuddy-restart": { title: "Перезапуск Bambuddy", script: SERVER_PS1, args: ["bambuddy-restart"] },
};

function journal(text) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  try {
    if (fs.statSync(JOURNAL).size > 1024 * 1024) fs.renameSync(JOURNAL, `${JOURNAL}.1`);
  } catch {
    // no journal yet
  }
  fs.appendFileSync(JOURNAL, text);
}

const stripAnsi = (s) => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");

function runAction(name) {
  const action = ACTIONS[name];
  const busy = currentOperation();
  if (busy) {
    const err = new Error(`Уже выполняется: ${busy.title}${busy.source === "gui" ? " (в окне на сервере)" : ""}`);
    err.status = 409;
    throw err;
  }
  journal(`\n► ${action.title} (веб-панель)\n`);
  const child = spawn("powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", action.script, ...action.args, "-NoElevate"],
    { cwd: ROOT, windowsHide: true, detached: false });
  fs.writeFileSync(WEB_LOCK, JSON.stringify({ pid: child.pid, title: action.title, startedAt: new Date().toISOString() }));
  const out = (chunk) => journal(stripAnsi(chunk.toString("utf8")));
  child.stdout.on("data", out);
  child.stderr.on("data", out);
  child.on("close", (code) => {
    journal(code === 0 ? "√ Готово.\n" : "× Операция завершилась с ошибкой.\n");
    fs.rmSync(WEB_LOCK, { force: true });
  });
}

function gitCheck() {
  return new Promise((resolve) => {
    execFile("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", SERVER_PS1, "git-check", "-NoElevate"],
      { cwd: ROOT, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
        const json = String(stdout).split(/\r?\n/).reverse().find((l) => l.trim().startsWith("{"));
        try {
          lastGitCheck = { ...JSON.parse(json), checkedAt: new Date().toISOString() };
        } catch {
          lastGitCheck = { error: err ? err.message : "не удалось проверить", checkedAt: new Date().toISOString() };
        }
        resolve(lastGitCheck);
      });
  });
}

// ---------------------------------------------------------------- logs

const LOG_SOURCES = {
  site: ["Сайт", path.join(LOG_DIR, "next.log")],
  "site-errors": ["Ошибки сайта", path.join(LOG_DIR, "next-error.log")],
  caddy: ["HTTPS (Caddy)", path.join(LOG_DIR, "caddy-error.log")],
  events: ["События сервера", path.join(LOG_DIR, "supervisor.log")],
  crm: ["Заказы: сервер", path.join(LAB_ROOT, "deploy", "logs", "app.log")],
  "crm-errors": ["Заказы: ошибки", path.join(LAB_ROOT, "deploy", "logs", "app-error.log")],
};

// Bytes of a file from `from` (or its last `tail` bytes); returns the text and the new offset.
function readFrom(file, from, tail = 64 * 1024) {
  try {
    const size = fs.statSync(file).size;
    let start = from === null || from > size ? Math.max(0, size - tail) : from;
    const length = size - start;
    if (length <= 0) return { text: "", offset: size };
    const fd = fs.openSync(file, "r");
    const buffer = Buffer.alloc(length);
    fs.readSync(fd, buffer, 0, length, start);
    fs.closeSync(fd);
    let text = buffer.toString("utf8").replace(/^﻿/, "");
    if (from === null && start > 0) text = text.slice(text.indexOf("\n") + 1); // cut the partial first line
    return { text: stripAnsi(text), offset: size };
  } catch {
    return { text: "", offset: 0 };
  }
}

// ---------------------------------------------------------------- http

function send(res, status, body, headers = {}) {
  const isJson = typeof body !== "string";
  res.writeHead(status, {
    "Content-Type": isJson ? "application/json; charset=utf-8" : "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    ...headers,
  });
  res.end(isJson ? JSON.stringify(body) : body);
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => {
      data += c;
      if (data.length > 10_000) req.destroy();
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(data || "{}"));
      } catch {
        resolve({});
      }
    });
  });
}

const PAGE = fs.readFileSync(path.join(DEPLOY, "panel.html"), "utf8");

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://panel");
  const secure = req.headers["x-forwarded-proto"] === "https";

  if (req.method === "GET" && url.pathname === "/") return send(res, 200, PAGE);

  // POSTs must come from our page's fetch() — a form on another site cannot set this header.
  if (req.method === "POST" && req.headers["x-panel"] !== "1") return send(res, 403, { error: "forbidden" });

  if (req.method === "POST" && url.pathname === "/api/login") {
    const ip = clientIp(req);
    const record = failedLogins.get(ip);
    if (record && record.until > Date.now()) {
      return send(res, 429, { error: "Слишком много попыток. Подождите 15 минут." });
    }
    if (!readEnv().PANEL_PASSWORD) {
      return send(res, 503, { error: "Пароль панели не задан — задайте его в Lab3D.exe → Настройки → Веб-панель." });
    }
    const { password } = await readBody(req);
    if (!checkPassword(password || "")) {
      // A lockout that has run out starts the count over.
      const count = (record && !(record.until && record.until <= Date.now()) ? record.count : 0) + 1;
      failedLogins.set(ip, { count, until: count >= MAX_FAILED_LOGINS ? Date.now() + LOCKOUT_MS : 0 });
      journal(`\n! Неудачный вход в веб-панель с ${ip}\n`);
      return send(res, 401, { error: "Неверный пароль" });
    }
    failedLogins.delete(ip);
    journal(`\n► Вход в веб-панель с ${ip}\n`);
    const cookie = `panel_session=${newSession()}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_HOURS * 3600}${secure ? "; Secure" : ""}`;
    return send(res, 200, { ok: true }, { "Set-Cookie": cookie });
  }

  if (!url.pathname.startsWith("/api/")) return send(res, 404, { error: "not found" });
  if (!isAuthed(req)) return send(res, 401, { error: "Нужно войти" });

  try {
    if (req.method === "POST" && url.pathname === "/api/logout") {
      return send(res, 200, { ok: true }, { "Set-Cookie": "panel_session=; Path=/; Max-Age=0" });
    }
    if (req.method === "GET" && url.pathname === "/api/status") {
      const [bambuddy, head] = await Promise.all([bambuddyState(), gitHead()]);
      // Ports for the "localhost" buttons — the services straight on the server, past domain and HTTPS.
      const env = readEnv();
      const labEnv = readEnv(path.join(LAB_ROOT, ".env"));
      let bambuddyPort = 8000;
      try {
        if (env.BAMBUDDY_URL) bambuddyPort = Number(new URL(env.BAMBUDDY_URL).port) || 8000;
      } catch {
        // malformed URL — keep the default
      }
      return send(res, 200, {
        site: { ...serviceState(path.join(DEPLOY, "state.json"), ENV_FILE), localPort: Number(env.APP_PORT) || 3000 },
        crm: fs.existsSync(LAB_SERVER_PS1)
          ? { ...serviceState(path.join(LAB_ROOT, "deploy", "state.json"), path.join(LAB_ROOT, ".env")), localPort: Number(labEnv.PORT) || 3001 }
          : { state: "absent" },
        bambuddy: { ...bambuddy, localPort: bambuddyPort },
        operation: currentOperation(),
        version: head,
        updates: lastGitCheck,
        domain: readEnv().DEPLOY_DOMAIN || "",
      });
    }
    if (req.method === "POST" && url.pathname === "/api/action") {
      const { action } = await readBody(req);
      if (!ACTIONS[action]) return send(res, 400, { error: "Неизвестное действие" });
      runAction(action);
      return send(res, 200, { ok: true });
    }
    if (req.method === "POST" && url.pathname === "/api/git-check") {
      return send(res, 200, await gitCheck());
    }
    if (req.method === "GET" && url.pathname === "/api/journal") {
      const from = url.searchParams.has("from") ? Number(url.searchParams.get("from")) : null;
      return send(res, 200, readFrom(JOURNAL, from));
    }
    if (req.method === "GET" && url.pathname === "/api/logs") {
      const source = LOG_SOURCES[url.searchParams.get("source")];
      if (!source) return send(res, 200, { sources: Object.fromEntries(Object.entries(LOG_SOURCES).map(([k, v]) => [k, v[0]])) });
      const from = url.searchParams.has("from") ? Number(url.searchParams.get("from")) : null;
      return send(res, 200, readFrom(source[1], from));
    }
    return send(res, 404, { error: "not found" });
  } catch (err) {
    return send(res, err.status || 500, { error: err.message });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Веб-панель: http://127.0.0.1:${PORT}`);
});
