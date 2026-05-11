const http = require("http");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || "0.0.0.0";
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const USERS_DIR = path.join(DATA_DIR, "users");
const LEGACY_PROJECTS_FILE = path.join(DATA_DIR, "projects.json");
const ACCOUNTS_FILE = path.join(DATA_DIR, "accounts.json");

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const USE_SUPABASE = Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
const supabase = USE_SUPABASE
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  : null;

const DEFAULT_USERS = [
  {
    username: "maubraga",
    password: "260781Mau@",
    displayName: "maubraga",
    role: "admin",
  },
  {
    username: "felipe",
    password: "bepass123",
    displayName: "Felipe",
    role: "user",
  },
];

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".manifest": "text/cache-manifest; charset=utf-8",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

function send(res, status, body, type = "text/plain; charset=utf-8", extraHeaders = {}) {
  res.writeHead(status, {
    "Content-Type": type,
    ...extraHeaders,
  });
  res.end(body);
}

function sendJson(res, status, payload) {
  send(
    res,
    status,
    JSON.stringify(payload),
    "application/json; charset=utf-8",
    { "Cache-Control": "no-store" },
  );
}

function slugify(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

function normalizeProjectName(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function buildToken(username) {
  return `gestao-gastos-token:${slugify(username)}`;
}

function sanitizeEntry(entry, fallbackProject, fallbackType) {
  return {
    id: String(entry?.id || `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`),
    date: String(entry?.date || ""),
    project: normalizeProjectName(entry?.project || fallbackProject || ""),
    costCenter: String(entry?.costCenter || "").trim(),
    description: String(entry?.description || "").trim(),
    value: Number(entry?.value || 0),
    category: String(entry?.category || fallbackType || "Reembolso").trim() || "Reembolso",
    receipts: Array.isArray(entry?.receipts) ? entry.receipts.map((receipt) => ({
      name: String(receipt?.name || "arquivo"),
      type: String(receipt?.type || "arquivo"),
      size: Number(receipt?.size || 0),
      dataUrl: String(receipt?.dataUrl || ""),
    })) : [],
  };
}

function sanitizeProjectRecord(project) {
  const name = normalizeProjectName(project?.name || "");
  const id = String(project?.id || slugify(name || "projeto"));
  const userName = String(project?.userName || "").trim();
  const reportType = String(project?.reportType || "Reembolso").trim() || "Reembolso";
  const entries = Array.isArray(project?.entries)
    ? project.entries.map((entry) => sanitizeEntry(entry, name, reportType))
    : [];

  return {
    id,
    name,
    userName,
    reportType,
    entries,
    updatedAt: project?.updatedAt || new Date().toISOString(),
  };
}

function buildProjectSummary(project) {
  return {
    id: project.id,
    name: project.name,
    userName: project.userName,
    reportType: project.reportType,
    entryCount: Array.isArray(project.entries) ? project.entries.length : 0,
    updatedAt: project.updatedAt || null,
  };
}

function isValidProject(project) {
  return Boolean(
    project &&
    typeof project.id === "string" &&
    project.id &&
    typeof project.name === "string" &&
    project.name,
  );
}

function sanitizeUserRecord(user) {
  return {
    username: String(user?.username || "").trim().toLowerCase(),
    password: String(user?.password || ""),
    displayName: String(user?.displayName || user?.username || "").trim(),
    role: user?.role === "admin" ? "admin" : "user",
  };
}

function buildPublicUser(user) {
  return {
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    isAdmin: user.role === "admin",
  };
}

async function ensureAccountsFile() {
  await fsp.mkdir(DATA_DIR, { recursive: true });

  try {
    await fsp.access(ACCOUNTS_FILE, fs.constants.F_OK);
  } catch {
    await fsp.writeFile(ACCOUNTS_FILE, JSON.stringify({ users: DEFAULT_USERS }, null, 2));
  }
}

async function readAccountsDbLocal() {
  await ensureAccountsFile();

  try {
    const raw = await fsp.readFile(ACCOUNTS_FILE, "utf8");
    const parsed = JSON.parse(raw || '{"users":[]}');
    const users = Array.isArray(parsed.users) ? parsed.users : [];
    return {
      users: users.map(sanitizeUserRecord).filter((user) => user.username && user.password),
    };
  } catch {
    return { users: DEFAULT_USERS.map(sanitizeUserRecord) };
  }
}

async function writeAccountsDbLocal(db) {
  await ensureAccountsFile();
  await fsp.writeFile(ACCOUNTS_FILE, JSON.stringify(db, null, 2));
}

function getUserFilePath(username) {
  return path.join(USERS_DIR, `${slugify(username)}.json`);
}

async function ensureUserProjectsFile(username) {
  await fsp.mkdir(USERS_DIR, { recursive: true });
  const userFile = getUserFilePath(username);

  try {
    await fsp.access(userFile, fs.constants.F_OK);
    return userFile;
  } catch {
    let initialDb = { projects: [] };

    if (slugify(username) === "felipe") {
      try {
        const legacyRaw = await fsp.readFile(LEGACY_PROJECTS_FILE, "utf8");
        const legacyParsed = JSON.parse(legacyRaw || '{"projects":[]}');
        if (Array.isArray(legacyParsed.projects)) {
          initialDb.projects = legacyParsed.projects.map(sanitizeProjectRecord).filter(isValidProject);
        }
      } catch {
        initialDb = { projects: [] };
      }
    }

    await fsp.writeFile(userFile, JSON.stringify(initialDb, null, 2));
    return userFile;
  }
}

async function readProjectsDbLocal(username) {
  const userFile = await ensureUserProjectsFile(username);

  try {
    const raw = await fsp.readFile(userFile, "utf8");
    const parsed = JSON.parse(raw || '{"projects":[]}');
    const projects = Array.isArray(parsed.projects) ? parsed.projects : [];

    return {
      projects: projects.map(sanitizeProjectRecord).filter(isValidProject),
    };
  } catch {
    return { projects: [] };
  }
}

async function writeProjectsDbLocal(username, db) {
  const userFile = await ensureUserProjectsFile(username);
  await fsp.writeFile(userFile, JSON.stringify(db, null, 2));
}

async function readAccountsDb() {
  if (!USE_SUPABASE) {
    return readAccountsDbLocal();
  }

  const { data, error } = await supabase
    .from("users")
    .select("username,password,display_name,role")
    .order("username", { ascending: true });

  if (error) {
    throw new Error(`Falha ao ler usuarios no Supabase: ${error.message}`);
  }

  return {
    users: (data || []).map((user) => sanitizeUserRecord({
      username: user.username,
      password: user.password,
      displayName: user.display_name,
      role: user.role,
    })),
  };
}

async function writeAccountsDb(db) {
  if (!USE_SUPABASE) {
    await writeAccountsDbLocal(db);
    return;
  }

  const payload = db.users.map((user) => ({
    username: user.username,
    password: user.password,
    display_name: user.displayName,
    role: user.role,
  }));

  const { error: deleteError } = await supabase
    .from("users")
    .delete()
    .neq("username", "");

  if (deleteError) {
    throw new Error(`Falha ao limpar usuarios no Supabase: ${deleteError.message}`);
  }

  if (payload.length) {
    const { error: insertError } = await supabase
      .from("users")
      .insert(payload);

    if (insertError) {
      throw new Error(`Falha ao gravar usuarios no Supabase: ${insertError.message}`);
    }
  }
}

async function ensureUserProjectsFileRemote(username) {
  if (!USE_SUPABASE) {
    return;
  }

  const db = await readProjectsDbRemote(username);
  if (!Array.isArray(db.projects)) {
    throw new Error("Falha ao preparar base remota do usuario.");
  }
}

async function readProjectsDbRemote(username) {
  const { data, error } = await supabase
    .from("projects")
    .select("id,name,user_name,report_type,entries,updated_at")
    .eq("owner_username", username)
    .order("updated_at", { ascending: false });

  if (error) {
    throw new Error(`Falha ao ler projetos no Supabase: ${error.message}`);
  }

  return {
    projects: (data || []).map((project) => sanitizeProjectRecord({
      id: project.id,
      name: project.name,
      userName: project.user_name,
      reportType: project.report_type,
      entries: project.entries,
      updatedAt: project.updated_at,
    })),
  };
}

async function writeProjectsDbRemote(username, db) {
  const { error: deleteError } = await supabase
    .from("projects")
    .delete()
    .eq("owner_username", username);

  if (deleteError) {
    throw new Error(`Falha ao limpar projetos no Supabase: ${deleteError.message}`);
  }

  const payload = db.projects.map((project) => ({
    id: project.id,
    owner_username: username,
    name: project.name,
    user_name: project.userName,
    report_type: project.reportType,
    entries: project.entries,
    updated_at: project.updatedAt || new Date().toISOString(),
  }));

  if (payload.length) {
    const { error: insertError } = await supabase
      .from("projects")
      .insert(payload);

    if (insertError) {
      throw new Error(`Falha ao gravar projetos no Supabase: ${insertError.message}`);
    }
  }
}

async function readProjectsDb(username) {
  if (!USE_SUPABASE) {
    return readProjectsDbLocal(username);
  }

  return readProjectsDbRemote(username);
}

async function writeProjectsDb(username, db) {
  if (!USE_SUPABASE) {
    await writeProjectsDbLocal(username, db);
    return;
  }

  await writeProjectsDbRemote(username, db);
}

async function readBody(req) {
  const chunks = [];

  for await (const chunk of req) {
    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) {
    return {};
  }

  return JSON.parse(raw);
}

function getBearerToken(req) {
  const header = String(req.headers.authorization || "");
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

async function getAuthenticatedUser(req) {
  return findUserByToken(getBearerToken(req));
}

async function findUserByCredentials(username, password) {
  const db = await readAccountsDb();
  return db.users.find((user) => user.username === username && user.password === password) || null;
}

async function findUserByToken(token) {
  if (!token) {
    return null;
  }

  const db = await readAccountsDb();
  return db.users.find((user) => buildToken(user.username) === token) || null;
}

async function handleAuthApi(req, res, url) {
  if (req.method === "POST" && url.pathname === "/api/login") {
    const body = await readBody(req);
    const username = String(body.username || "").trim().toLowerCase();
    const password = String(body.password || "");
    const user = await findUserByCredentials(username, password);

    if (!user) {
      sendJson(res, 401, { error: "Usuario ou senha invalidos." });
      return true;
    }

    if (USE_SUPABASE) {
      await ensureUserProjectsFileRemote(user.username);
    } else {
      await ensureUserProjectsFile(user.username);
    }

    sendJson(res, 200, {
      token: buildToken(user.username),
      user: buildPublicUser(user),
      storageMode: USE_SUPABASE ? "supabase" : "arquivo-local",
    });
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/session") {
    const user = await getAuthenticatedUser(req);

    if (!user) {
      sendJson(res, 401, { error: "Sessao invalida." });
      return true;
    }

    sendJson(res, 200, {
      user: buildPublicUser(user),
      storageMode: USE_SUPABASE ? "supabase" : "arquivo-local",
    });
    return true;
  }

  return false;
}

async function handleConfigApi(req, res) {
  if (req.method !== "GET") {
    return false;
  }

  sendJson(res, 200, {
    storageMode: USE_SUPABASE ? "supabase" : "arquivo-local",
    usesSupabase: USE_SUPABASE,
  });
  return true;
}

async function handleAdminUsersApi(req, res, user) {
  if (user.role !== "admin") {
    sendJson(res, 403, { error: "Acesso restrito ao administrador." });
    return true;
  }

  if (req.method === "GET") {
    const db = await readAccountsDb();
    sendJson(res, 200, {
      users: db.users.map(buildPublicUser),
    });
    return true;
  }

  if (req.method === "POST") {
    const body = await readBody(req);
    const username = String(body.username || "").trim().toLowerCase();
    const password = String(body.password || "").trim();

    if (!username || !password) {
      sendJson(res, 400, { error: "Usuario e senha sao obrigatorios." });
      return true;
    }

    const db = await readAccountsDb();
    if (db.users.some((item) => item.username === username)) {
      sendJson(res, 409, { error: "Esse usuario ja existe." });
      return true;
    }

    const nextUser = sanitizeUserRecord({
      username,
      password,
      displayName: username,
      role: "user",
    });

    db.users.push(nextUser);
    await writeAccountsDb(db);

    if (USE_SUPABASE) {
      await ensureUserProjectsFileRemote(nextUser.username);
    } else {
      await ensureUserProjectsFile(nextUser.username);
    }

    sendJson(res, 200, { user: buildPublicUser(nextUser) });
    return true;
  }

  return false;
}

async function handleProjectsApi(req, res, url, user) {
  const parts = url.pathname.split("/").filter(Boolean);
  const projectId = parts[2] ? decodeURIComponent(parts[2]) : "";

  if (req.method === "GET" && parts.length === 2) {
    const db = await readProjectsDb(user.username);
    const projects = db.projects
      .map(buildProjectSummary)
      .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));

    sendJson(res, 200, { projects });
    return true;
  }

  if (req.method === "GET" && parts.length === 3) {
    const db = await readProjectsDb(user.username);
    const project = db.projects.find((item) => item.id === projectId);

    if (!project) {
      sendJson(res, 404, { error: "Projeto nao encontrado." });
      return true;
    }

    sendJson(res, 200, { project });
    return true;
  }

  if (req.method === "POST" && parts.length === 2) {
    const body = await readBody(req);
    const project = sanitizeProjectRecord(body);

    if (!isValidProject(project)) {
      sendJson(res, 400, { error: "Projeto invalido." });
      return true;
    }

    const db = await readProjectsDb(user.username);
    const nextProject = {
      ...project,
      updatedAt: new Date().toISOString(),
    };

    db.projects = db.projects.filter((item) => item.id !== nextProject.id);
    db.projects.unshift(nextProject);
    await writeProjectsDb(user.username, db);

    sendJson(res, 200, { project: nextProject });
    return true;
  }

  if (req.method === "PUT" && parts.length === 3) {
    const body = await readBody(req);
    const db = await readProjectsDb(user.username);
    const existingIndex = db.projects.findIndex((item) => item.id === projectId);

    if (existingIndex < 0) {
      sendJson(res, 404, { error: "Projeto nao encontrado." });
      return true;
    }

    const nextProject = sanitizeProjectRecord({
      ...db.projects[existingIndex],
      ...body,
      id: projectId,
      updatedAt: new Date().toISOString(),
    });

    db.projects.splice(existingIndex, 1);
    db.projects.unshift(nextProject);
    await writeProjectsDb(user.username, db);

    sendJson(res, 200, { project: nextProject });
    return true;
  }

  if (req.method === "DELETE" && parts.length === 3) {
    const db = await readProjectsDb(user.username);
    const nextProjects = db.projects.filter((item) => item.id !== projectId);

    if (nextProjects.length === db.projects.length) {
      sendJson(res, 404, { error: "Projeto nao encontrado." });
      return true;
    }

    await writeProjectsDb(user.username, { projects: nextProjects });
    sendJson(res, 200, { ok: true });
    return true;
  }

  return false;
}

async function serveStatic(req, res, url) {
  const relativePath = url.pathname === "/" ? "/index.html" : url.pathname;
  const decodedPath = decodeURIComponent(relativePath);
  const safePath = path.normalize(decodedPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.resolve(ROOT, `.${safePath}`);

  if (!filePath.startsWith(ROOT)) {
    send(res, 403, "Forbidden");
    return;
  }

  try {
    const file = await fsp.readFile(filePath);
    const extension = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[extension] || "application/octet-stream";
    const extraHeaders = extension === ".html"
      ? { "Cache-Control": "no-store" }
      : {};

    send(res, 200, file, contentType, extraHeaders);
  } catch (error) {
    if (error.code === "ENOENT") {
      send(res, 404, "Not found");
      return;
    }

    sendJson(res, 500, { error: "Erro interno ao servir arquivo." });
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

    if (url.pathname === "/api/login" || url.pathname === "/api/session") {
      const handled = await handleAuthApi(req, res, url);
      if (!handled) {
        sendJson(res, 404, { error: "Rota nao encontrada." });
      }
      return;
    }

    if (url.pathname === "/api/config") {
      const handled = await handleConfigApi(req, res);
      if (!handled) {
        sendJson(res, 404, { error: "Rota nao encontrada." });
      }
      return;
    }

    if (url.pathname === "/api/admin/users") {
      const user = await getAuthenticatedUser(req);
      if (!user) {
        sendJson(res, 401, { error: "Acesso nao autorizado." });
        return;
      }

      const handled = await handleAdminUsersApi(req, res, user);
      if (!handled) {
        sendJson(res, 404, { error: "Rota nao encontrada." });
      }
      return;
    }

    if (url.pathname.startsWith("/api/projects")) {
      const user = await getAuthenticatedUser(req);
      if (!user) {
        sendJson(res, 401, { error: "Acesso nao autorizado." });
        return;
      }

      const handled = await handleProjectsApi(req, res, url, user);
      if (!handled) {
        sendJson(res, 404, { error: "Rota nao encontrada." });
      }
      return;
    }

    await serveStatic(req, res, url);
  } catch (error) {
    sendJson(res, 500, {
      error: "Erro interno.",
      details: String(error?.message || error),
    });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Gestao de Gastos online: http://${HOST}:${PORT}/`);
  console.log(`Storage mode: ${USE_SUPABASE ? "supabase" : "arquivo-local"}`);
});
