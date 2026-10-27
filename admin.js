"use strict";

const loginView = document.getElementById("loginView");
const panelView = document.getElementById("panelView");
const loginForm = document.getElementById("loginForm");
const loginNote = document.getElementById("loginNote");
const msgList = document.getElementById("msgList");
const countEl = document.getElementById("count");

function setLoginNote(text, kind) {
  loginNote.textContent = text;
  loginNote.classList.remove("ok", "error");
  if (kind) loginNote.classList.add(kind);
}

function showLogin() {
  panelView.hidden = true;
  loginView.hidden = false;
  document.getElementById("user")?.focus();
}

function showPanel() {
  loginView.hidden = true;
  panelView.hidden = false;
  loadMessages();
}

function formatDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" });
}

// Todo el contenido de los visitantes se inserta con textContent (nunca innerHTML).
function renderMessages(messages) {
  msgList.replaceChildren();
  countEl.textContent = messages.length === 1 ? "1 solicitud" : `${messages.length} solicitudes`;
  if (!messages.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "Aún no hay solicitudes. Cuando alguien llene el formulario aparecerá aquí.";
    msgList.append(empty);
    return;
  }
  for (const m of messages) {
    const card = document.createElement("article");
    card.className = "msg";

    const head = document.createElement("div");
    head.className = "msg-head";
    const name = document.createElement("span");
    name.className = "msg-name";
    name.textContent = m.name;
    const meta = document.createElement("span");
    meta.className = "msg-meta";
    meta.textContent = formatDate(m.createdAt);
    head.append(name, meta);

    const email = document.createElement("div");
    email.className = "msg-email";
    email.textContent = m.email;

    const body = document.createElement("p");
    body.className = "msg-body";
    body.textContent = m.message;

    card.append(head, email, body);
    msgList.append(card);
  }
}

async function loadMessages() {
  countEl.textContent = "Cargando…";
  try {
    const res = await fetch("/api/admin/messages", { cache: "no-store" });
    if (res.status === 401) { showLogin(); setLoginNote("Tu sesión expiró. Ingresa de nuevo.", "error"); return; }
    if (!res.ok) throw new Error("Error " + res.status);
    const data = await res.json();
    renderMessages(data.messages || []);
  } catch (err) {
    console.error(err);
    countEl.textContent = "No se pudieron cargar las solicitudes. Intenta actualizar.";
  }
}

loginForm.addEventListener("submit", async event => {
  event.preventDefault();
  const user = document.getElementById("user").value;
  const pass = document.getElementById("pass").value;
  if (!user || !pass) { setLoginNote("Escribe usuario y contraseña.", "error"); return; }
  const button = loginForm.querySelector("button[type=submit]");
  button.disabled = true;
  setLoginNote("Verificando…");
  try {
    const res = await fetch("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user, pass })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "No se pudo iniciar sesión.");
    loginForm.reset();
    setLoginNote("Ingresa tus credenciales de administrador.");
    showPanel();
  } catch (err) {
    setLoginNote(err instanceof TypeError ? "No hay conexión con el servidor." : err.message, "error");
  } finally {
    button.disabled = false;
  }
});

document.getElementById("refreshBtn").addEventListener("click", loadMessages);
document.getElementById("logoutBtn").addEventListener("click", async () => {
  try { await fetch("/api/admin/logout", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }); } catch { /* ignorar */ }
  msgList.replaceChildren();
  showLogin();
  setLoginNote("Sesión cerrada.", "ok");
});

(async function init() {
  try {
    const res = await fetch("/api/admin/session", { cache: "no-store" });
    const data = await res.json();
    if (data.authenticated) showPanel(); else showLogin();
  } catch {
    showLogin();
    setLoginNote("No hay conexión con el servidor. Abre el sitio con `npm start`.", "error");
  }
})();
