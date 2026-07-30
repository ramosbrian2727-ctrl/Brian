import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

const app = document.getElementById("app");

const missingConfig =
  !SUPABASE_URL ||
  !SUPABASE_ANON_KEY ||
  SUPABASE_URL.includes("PEGAR_ACA") ||
  SUPABASE_ANON_KEY.includes("PEGAR_ACA");

let supabase = null;
if (!missingConfig) {
  supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

let session = null;
let profile = null;
let memberships = [];
let currentGroup = null;
let currentRole = null;
let people = [];
let categories = [];
let expenses = [];
let splits = [];
let contributions = [];
let accessRequests = [];
let currentView = "dashboard";
let dark = localStorage.getItem("gdc_dark") === "1";

if (dark) document.body.classList.add("dark");

const DEFAULT_CATEGORIES = ["Supermercado","Servicios","Meriendas","Limpieza","Comida","Alquiler","Transporte","Mascotas","Otros"];

function uid() {
  return crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
}
function today() {
  return new Date().toISOString().slice(0, 10);
}
function money(value) {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0
  }).format(Number(value || 0));
}
function safe(value) {
  return String(value ?? "").replace(/[&<>"']/g, (m) => ({
    "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#039;"
  })[m]);
}
function toast(message) {
  const old = document.querySelector(".toast");
  if (old) old.remove();
  const t = document.createElement("div");
  t.className = "toast show";
  t.textContent = message;
  document.body.appendChild(t);
  setTimeout(() => t.classList.remove("show"), 2600);
  setTimeout(() => t.remove(), 3000);
}
function roleName(role) {
  return role === "admin" ? "Administrador" : role === "editor" ? "Editor" : role === "collaborator" ? "Colaborador" : "Espectador";
}
function canCreate() {
  return ["admin", "editor", "collaborator"].includes(currentRole);
}
function canEditAll() {
  return currentRole === "admin" || currentRole === "editor";
}
function canWrite() {
  return canCreate();
}
function isAdmin() {
  return currentRole === "admin";
}
function personName(id) {
  return people.find((p) => p.id === id)?.name || "Sin persona";
}
function categoryName(id) {
  return categories.find((c) => c.id === id)?.name || "Sin categoría";
}

function checkConfig() {
  if (!missingConfig) return false;
  app.innerHTML = `
    <section class="auth-screen">
      <div class="auth-card">
        <div class="badge">GC</div>
        <h1>Falta configurar Supabase</h1>
        <p>La app está lista, pero falta pegar tu URL y tu anon key en <b>config.js</b>.</p>
        <div class="help-box">
          <b>Qué tenés que hacer:</b><br>
          1. Entrá a Supabase.<br>
          2. Abrí tu proyecto.<br>
          3. Project Settings → API.<br>
          4. Copiá <b>Project URL</b> y <b>anon public key</b>.<br>
          5. Pegalos en el archivo <code>config.js</code>.
        </div>
      </div>
    </section>
  `;
  return true;
}

function renderAuth() {
  app.innerHTML = `
    <section class="auth-screen">
      <div class="auth-card">
        <div class="badge">GC</div>
        <h1>Gastos de Casa</h1>
        <p>Control de gastos domésticos compartidos online.</p>

        <form id="loginForm" class="form" style="margin-top:18px">
          <label>Email <input id="loginEmail" type="email" placeholder="tu@email.com" required></label>
          <label>Contraseña <input id="loginPassword" type="password" placeholder="Mínimo 6 caracteres" required></label>
          <button class="btn primary" type="submit">Ingresar</button>
        </form>

        <div class="actions" style="margin-top:10px">
          <button id="signupBtn" class="btn ghost full">Crear cuenta</button>
        </div>

        <div class="help-box">
          <b>Primera vez:</b> creá tu cuenta, confirmá el email si Supabase te lo pide, entrá y creá tu casa/grupo.
        </div>
      </div>
    </section>
  `;

  document.getElementById("loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    await login();
  });
  document.getElementById("signupBtn").addEventListener("click", signup);
}

async function login() {
  const email = document.getElementById("loginEmail").value.trim();
  const password = document.getElementById("loginPassword").value.trim();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return toast(error.message);
  await init();
}

async function signup() {
  const email = document.getElementById("loginEmail").value.trim();
  const password = document.getElementById("loginPassword").value.trim();
  if (!email || !password) return toast("Completá email y contraseña.");
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name: email.split("@")[0] } }
  });
  if (error) return toast(error.message);
  toast("Cuenta creada. Revisá tu email si Supabase pide confirmación.");
}

async function loadProfile() {
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", session.user.id)
    .maybeSingle();

  if (error) throw error;
  profile = data || { id: session.user.id, email: session.user.email };
}

async function loadMemberships() {
  const { data, error } = await supabase
    .from("group_members")
    .select("id, role, group_id, groups(id, name, owner_id, invite_code)")
    .eq("user_id", session.user.id)
    .order("created_at", { ascending: true });

  if (error) throw error;
  memberships = data || [];

  const savedGroupId = localStorage.getItem("gdc_current_group");
  const membership = memberships.find((m) => m.group_id === savedGroupId) || memberships[0];
  if (membership) {
    currentGroup = membership.groups;
    currentRole = membership.role;
    localStorage.setItem("gdc_current_group", currentGroup.id);
  } else {
    currentGroup = null;
    currentRole = null;
  }
}

async function createGroup(name) {
  const { data: group, error: groupError } = await supabase
    .from("groups")
    .insert({ name, owner_id: session.user.id })
    .select()
    .single();

  if (groupError) return toast(groupError.message);

  const { error: memberError } = await supabase
    .from("group_members")
    .insert({ group_id: group.id, user_id: session.user.id, role: "admin" });

  if (memberError) return toast(memberError.message);

  const defaultPeople = [
    { group_id: group.id, name: "Persona A" },
    { group_id: group.id, name: "Persona B" },
    { group_id: group.id, name: "Persona C" }
  ];

  await supabase.from("people").insert(defaultPeople);
  await supabase.from("categories").insert(DEFAULT_CATEGORIES.map((name) => ({ group_id: group.id, name })));

  localStorage.setItem("gdc_current_group", group.id);
  await init();
}

function renderNoGroup() {
  app.innerHTML = `
    <section class="auth-screen">
      <div class="auth-card auth-card-wide">
        <div class="badge">GC</div>
        <h1>Acceso privado</h1>
        <p>Esta aplicación es privada. Solo podés ingresar cuando el administrador aprueba tu solicitud.</p>
        <div class="mini-panel" style="margin-top:18px">
          <h3>Solicitar acceso</h3>
          <p>Ingresá el código que te dio el administrador. La solicitud quedará pendiente hasta que sea aprobada.</p>
          <form id="joinForm" class="form">
            <label>Código de invitación <input id="inviteCode" maxlength="20" placeholder="Ej: CASA-8F3K" required></label>
            <button class="btn primary">Enviar solicitud</button>
          </form>
        </div>
        <div id="requestStatus" class="help-box">Consultando el estado de tu solicitud...</div>
        <button id="logoutNoGroup" class="btn ghost full" style="margin-top:14px">Salir</button>
      </div>
    </section>
  `;
  document.getElementById("joinForm").addEventListener("submit", joinGroupByCode);
  document.getElementById("logoutNoGroup").addEventListener("click", logout);
  loadMyAccessRequests();
}

async function loadMyAccessRequests() {
  const box = document.getElementById("requestStatus");
  if (!box) return;
  const { data, error } = await supabase.rpc("my_access_requests");
  if (error) {
    box.textContent = "No se pudo consultar la solicitud: " + error.message;
    return;
  }
  const rows = data || [];
  if (!rows.length) {
    box.innerHTML = "Todavía no enviaste ninguna solicitud.";
    return;
  }
  box.innerHTML = rows.map(r => {
    const status = r.status === "pending" ? "Pendiente de aprobación" : r.status === "approved" ? "Aprobada" : r.status === "blocked" ? "Bloqueada" : "Rechazada";
    return `<div><b>${safe(r.group_name)}</b>: ${status}</div>`;
  }).join("");
}

async function joinGroupByCode(e) {
  e.preventDefault();
  const code = document.getElementById("inviteCode").value.trim().toUpperCase();
  const { data, error } = await supabase.rpc("request_group_access", { p_code: code });
  if (error) return toast(error.message);
  toast(data || "Solicitud enviada. Esperá la aprobación del administrador.");
  await loadMyAccessRequests();
}

async function loadData() {
  if (!currentGroup) return;

  const [p, c, e, s, a] = await Promise.all([
    supabase.from("people").select("*").eq("group_id", currentGroup.id).order("created_at", { ascending: true }),
    supabase.from("categories").select("*").eq("group_id", currentGroup.id).order("created_at", { ascending: true }),
    supabase.from("expenses").select("*").eq("group_id", currentGroup.id).order("date", { ascending: true }),
    supabase.from("expense_splits").select("*"),
    supabase.from("contributions").select("*").eq("group_id", currentGroup.id).order("date", { ascending: true })
  ]);

  for (const res of [p, c, e, s, a]) {
    if (res.error) throw res.error;
  }

  people = p.data || [];
  categories = c.data || [];
  expenses = e.data || [];
  const expenseIds = new Set(expenses.map((x) => x.id));
  splits = (s.data || []).filter((x) => expenseIds.has(x.expense_id));
  contributions = a.data || [];
}

function appShell() {
  app.innerHTML = `
    <section class="app">
      <aside class="side">
        <div class="logo">
          <div class="badge small">GC</div>
          <div>
            <h2>Gastos de Casa</h2>
            <span class="role">${roleName(currentRole)}</span>
            <span class="group-name">${safe(currentGroup.name)}</span>
          </div>
        </div>

        <nav class="nav">
          <button class="${currentView === "dashboard" ? "active" : ""}" data-view="dashboard">Panel</button>
          <button class="${currentView === "expenses" ? "active" : ""}" data-view="expenses">Gastos</button>
          <button class="${currentView === "contributions" ? "active" : ""}" data-view="contributions">Aportes</button>
          <button class="${currentView === "movements" ? "active" : ""}" data-view="movements">Movimientos</button>
          <button class="${currentView === "backup" ? "active" : ""}" data-view="backup">Copias</button>
          <button class="${currentView === "settings" ? "active" : ""}" data-view="settings">Configuración</button>
        </nav>

        <div class="side-footer">
          ${groupSwitcherHtml()}
          <button id="themeBtn" class="btn ghost full">${dark ? "Modo claro" : "Modo oscuro"}</button>
          <button id="logoutBtn" class="btn danger full">Salir</button>
        </div>
      </aside>

      <main>
        <header class="top">
          <div>
            <h1 id="viewTitle">${titleForView(currentView)[0]}</h1>
            <p>${titleForView(currentView)[1]}</p>
          </div>
          <div class="top-actions">
            <button id="quickExpense" class="btn primary" ${!canWrite() ? "disabled" : ""}>+ Gasto</button>
            <button id="quickContribution" class="btn secondary" ${!canWrite() ? "disabled" : ""}>+ Aporte</button>
          </div>
        </header>

        <div id="viewContainer"></div>
      </main>
    </section>
  `;

  document.querySelectorAll("[data-view]").forEach((btn) => {
    btn.addEventListener("click", () => {
      currentView = btn.dataset.view;
      renderApp();
    });
  });

  document.getElementById("logoutBtn").addEventListener("click", logout);
  document.getElementById("themeBtn").addEventListener("click", () => {
    dark = !dark;
    localStorage.setItem("gdc_dark", dark ? "1" : "0");
    document.body.classList.toggle("dark", dark);
    renderApp();
  });
  document.getElementById("quickExpense").addEventListener("click", () => {
    currentView = "expenses";
    renderApp();
  });
  document.getElementById("quickContribution").addEventListener("click", () => {
    currentView = "contributions";
    renderApp();
  });

  const groupSelect = document.getElementById("groupSelect");
  if (groupSelect) {
    groupSelect.addEventListener("change", async () => {
      localStorage.setItem("gdc_current_group", groupSelect.value);
      await init();
    });
  }
}

function groupSwitcherHtml() {
  if (memberships.length <= 1) return "";
  return `
    <label style="font-size:13px">
      Grupo
      <select id="groupSelect">
        ${memberships.map((m) => `<option value="${m.group_id}" ${m.group_id === currentGroup.id ? "selected" : ""}>${safe(m.groups.name)}</option>`).join("")}
      </select>
    </label>
  `;
}

function titleForView(view) {
  const map = {
    dashboard: ["Panel principal", "Resumen claro de gastos, aportes y saldos."],
    expenses: ["Gastos", "Cargá gastos y elegí entre quiénes se divide."],
    contributions: ["Aportes", "Registrá cuánto dinero fue aportando cada persona."],
    movements: ["Movimientos", "Filtrá gastos y aportes por fecha, persona o categoría."],
    backup: ["Copias y exportación", "Descargá una copia completa de la información del grupo."],
    settings: ["Configuración", "Administrá participantes, solicitudes, usuarios y permisos."]
  };
  return map[view] || map.dashboard;
}

function renderApp() {
  appShell();
  const container = document.getElementById("viewContainer");
  if (currentView === "dashboard") container.innerHTML = dashboardHtml();
  if (currentView === "expenses") container.innerHTML = expensesHtml();
  if (currentView === "contributions") container.innerHTML = contributionsHtml();
  if (currentView === "movements") container.innerHTML = movementsHtml();
  if (currentView === "backup") container.innerHTML = backupHtml();
  if (currentView === "settings") container.innerHTML = settingsHtml();
  bindViewEvents();
}

function datePeriod() {
  const type = document.getElementById("periodType")?.value || localStorage.getItem("gdc_period_type") || "month";
  const baseDate = document.getElementById("periodDate")?.value || localStorage.getItem("gdc_period_date") || today();
  const startCustom = document.getElementById("periodStart")?.value || localStorage.getItem("gdc_period_start") || today();
  const endCustom = document.getElementById("periodEnd")?.value || localStorage.getItem("gdc_period_end") || today();

  if (type === "day") return { type, start: baseDate, end: baseDate, baseDate, startCustom, endCustom };
  if (type === "week") {
    const d = new Date(baseDate + "T00:00:00");
    const day = d.getDay() || 7;
    const monday = new Date(d);
    monday.setDate(d.getDate() - day + 1);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    return { type, start: monday.toISOString().slice(0,10), end: sunday.toISOString().slice(0,10), baseDate, startCustom, endCustom };
  }
  if (type === "custom") return { type, start: startCustom, end: endCustom, baseDate, startCustom, endCustom };

  const d = new Date(baseDate + "T00:00:00");
  return {
    type,
    start: new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0,10),
    end: new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().slice(0,10),
    baseDate,
    startCustom,
    endCustom
  };
}

function inRange(row, start, end) {
  return row.date >= start && row.date <= end;
}

function calcBalances(start, end) {
  const result = people.map((p) => ({
    id: p.id,
    name: p.name,
    paid: 0,
    contributed: 0,
    owed: 0,
    balance: 0
  }));
  const byId = Object.fromEntries(result.map((x) => [x.id, x]));

  expenses.filter((e) => inRange(e, start, end)).forEach((e) => {
    const amount = Number(e.amount || 0);
    if (byId[e.payer_person_id]) byId[e.payer_person_id].paid += amount;
    const expenseSplits = splits.filter((s) => s.expense_id === e.id);
    const each = expenseSplits.length ? amount / expenseSplits.length : 0;
    expenseSplits.forEach((s) => {
      if (byId[s.person_id]) byId[s.person_id].owed += each;
    });
  });

  contributions.filter((c) => inRange(c, start, end)).forEach((c) => {
    if (byId[c.person_id]) byId[c.person_id].contributed += Number(c.amount || 0);
  });

  result.forEach((x) => x.balance = x.paid + x.contributed - x.owed);
  return result;
}

function dashboardHtml() {
  const p = datePeriod();
  const filteredExpenses = expenses.filter((x) => inRange(x, p.start, p.end));
  const filteredContributions = contributions.filter((x) => inRange(x, p.start, p.end));
  const totalSpent = filteredExpenses.reduce((sum, x) => sum + Number(x.amount || 0), 0);
  const totalContributed = filteredContributions.reduce((sum, x) => sum + Number(x.amount || 0), 0);
  const balances = calcBalances(p.start, p.end);

  const catTotals = {};
  filteredExpenses.forEach((e) => {
    const name = categoryName(e.category_id);
    catTotals[name] = (catTotals[name] || 0) + Number(e.amount || 0);
  });

  return `
    <section class="view active">
      <div class="panel">
        <div class="panel-head">
          <div>
            <h3>Resumen por período</h3>
            <p>Elegí día, semana, mes o rango personalizado.</p>
          </div>
          <div class="controls">
            <select id="periodType">
              <option value="month" ${p.type === "month" ? "selected" : ""}>Mes</option>
              <option value="week" ${p.type === "week" ? "selected" : ""}>Semana</option>
              <option value="day" ${p.type === "day" ? "selected" : ""}>Día</option>
              <option value="custom" ${p.type === "custom" ? "selected" : ""}>Rango</option>
            </select>
            <input id="periodDate" type="date" value="${p.baseDate}" class="${p.type === "custom" ? "hidden" : ""}">
            <input id="periodStart" type="date" value="${p.startCustom}" class="${p.type !== "custom" ? "hidden" : ""}">
            <input id="periodEnd" type="date" value="${p.endCustom}" class="${p.type !== "custom" ? "hidden" : ""}">
          </div>
        </div>
      </div>

      <div class="cards">
        <div class="card"><span>Total gastado</span><strong>${money(totalSpent)}</strong></div>
        <div class="card"><span>Total aportado</span><strong>${money(totalContributed)}</strong></div>
        <div class="card"><span>Saldo general</span><strong>${money(totalContributed - totalSpent)}</strong></div>
        <div class="card"><span>Movimientos</span><strong>${filteredExpenses.length + filteredContributions.length}</strong></div>
      </div>

      <div class="grid2">
        <div class="panel">
          <h3>Saldos por persona</h3>
          <div class="list">
            ${balances.length ? balances.map((b) => {
              const cls = b.balance > 0 ? "ok" : b.balance < 0 ? "bad" : "neu";
              const label = b.balance > 0 ? "A favor" : b.balance < 0 ? "Debe" : "Al día";
              return `
                <div class="item">
                  <div>
                    <b>${safe(b.name)}</b>
                    <small>Pagó ${money(b.paid)} · Aportó ${money(b.contributed)} · Le corresponde ${money(b.owed)}</small>
                  </div>
                  <div class="${cls}">${label}<br>${money(Math.abs(b.balance))}</div>
                </div>
              `;
            }).join("") : `<div class="empty">Agregá participantes en configuración.</div>`}
          </div>
        </div>

        <div class="panel">
          <h3>Gastos por categoría</h3>
          <div class="list">
            ${Object.entries(catTotals).length ? Object.entries(catTotals).sort((a,b) => b[1]-a[1]).map(([name, amount]) => `
              <div class="item"><span>${safe(name)}</span><b>${money(amount)}</b></div>
            `).join("") : `<div class="empty">Todavía no hay gastos en este período.</div>`}
          </div>
        </div>
      </div>

      <div class="grid2">
        <div class="panel">
          <h3>Últimos gastos</h3>
          <div class="list">
            ${filteredExpenses.slice(-5).reverse().map((e) => `
              <div class="item">
                <div><b>${safe(e.description)}</b><small>${e.date} · ${safe(categoryName(e.category_id))} · pagó ${safe(personName(e.payer_person_id))}</small></div>
                <b>${money(e.amount)}</b>
              </div>
            `).join("") || `<div class="empty">Sin gastos.</div>`}
          </div>
        </div>

        <div class="panel">
          <h3>Últimos aportes</h3>
          <div class="list">
            ${filteredContributions.slice(-5).reverse().map((c) => `
              <div class="item">
                <div><b>${safe(personName(c.person_id))}</b><small>${c.date} · ${safe(c.method || "Sin medio")}</small></div>
                <b>${money(c.amount)}</b>
              </div>
            `).join("") || `<div class="empty">Sin aportes.</div>`}
          </div>
        </div>
      </div>
    </section>
  `;
}

function peopleOptions(selected = "") {
  return people.map((p) => `<option value="${p.id}" ${p.id === selected ? "selected" : ""}>${safe(p.name)}</option>`).join("");
}
function categoriesOptions(selected = "") {
  return categories.map((c) => `<option value="${c.id}" ${c.id === selected ? "selected" : ""}>${safe(c.name)}</option>`).join("");
}

function expensesHtml() {
  return `
    <section class="view active">
      <div class="panel">
        <h3>Cargar gasto diario</h3>
        ${!canWrite() ? `<p class="warning">Tu rol es espectador. Podés ver, pero no modificar.</p>` : ""}
        <form id="expenseForm" class="form wide">
          <input type="hidden" id="expenseId">
          <label>Fecha <input id="expenseDate" type="date" value="${today()}" required ${!canWrite() ? "disabled" : ""}></label>
          <label>Descripción <input id="expenseDescription" placeholder="Ej: Supermercado" required ${!canWrite() ? "disabled" : ""}></label>
          <label>Categoría <select id="expenseCategory" required ${!canWrite() ? "disabled" : ""}>${categoriesOptions()}</select></label>
          <label>Monto total <input id="expenseAmount" type="number" min="0" step="0.01" required ${!canWrite() ? "disabled" : ""}></label>
          <label>Persona que pagó <select id="expensePayer" required ${!canWrite() ? "disabled" : ""}>${peopleOptions()}</select></label>
          <label class="full">Personas entre las que se divide
            <div class="checks" id="splitChecks">
              ${people.map((p) => `<label class="check"><input type="checkbox" value="${p.id}" ${!canWrite() ? "disabled" : ""}>${safe(p.name)}</label>`).join("")}
            </div>
          </label>
          <label class="full">Observaciones <textarea id="expenseNotes" rows="3" ${!canWrite() ? "disabled" : ""}></textarea></label>
          <div class="actions full">
            <button class="btn primary" ${!canWrite() ? "disabled" : ""}>Guardar gasto</button>
            <button type="button" id="cancelExpenseEdit" class="btn ghost hidden">Cancelar edición</button>
          </div>
        </form>
      </div>

      <div class="panel">
        <h3>Gastos cargados</h3>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Fecha</th><th>Descripción</th><th>Categoría</th><th>Monto</th><th>Pagó</th><th>Divide</th><th>Acciones</th></tr></thead>
            <tbody>
              ${expenses.slice().reverse().map((e) => {
                const expSplits = splits.filter((s) => s.expense_id === e.id).map((s) => personName(s.person_id)).join(", ");
                const canEdit = isAdmin() || (currentRole === "editor" && e.created_by === session.user.id);
                return `
                  <tr>
                    <td>${e.date}</td>
                    <td>${safe(e.description)}</td>
                    <td>${safe(categoryName(e.category_id))}</td>
                    <td><b>${money(e.amount)}</b></td>
                    <td>${safe(personName(e.payer_person_id))}</td>
                    <td>${safe(expSplits)}</td>
                    <td>
                      <div class="row-actions">
                        <button class="btn ghost small-btn" data-edit-expense="${e.id}" ${!canEdit ? "disabled" : ""}>Editar</button>
                        <button class="btn danger small-btn" data-delete-expense="${e.id}" ${!canEdit ? "disabled" : ""}>Borrar</button>
                      </div>
                    </td>
                  </tr>
                `;
              }).join("") || `<tr><td colspan="7">Todavía no hay gastos cargados.</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  `;
}

function contributionsHtml() {
  return `
    <section class="view active">
      <div class="panel">
        <h3>Cargar aporte de dinero</h3>
        ${!canWrite() ? `<p class="warning">Tu rol es espectador. Podés ver, pero no modificar.</p>` : ""}
        <form id="contributionForm" class="form wide">
          <input type="hidden" id="contributionId">
          <label>Fecha <input id="contributionDate" type="date" value="${today()}" required ${!canWrite() ? "disabled" : ""}></label>
          <label>Persona <select id="contributionPerson" required ${!canWrite() ? "disabled" : ""}>${peopleOptions()}</select></label>
          <label>Monto <input id="contributionAmount" type="number" min="0" step="0.01" required ${!canWrite() ? "disabled" : ""}></label>
          <label>Medio de pago <input id="contributionMethod" placeholder="Efectivo, transferencia..." ${!canWrite() ? "disabled" : ""}></label>
          <label class="full">Observación <textarea id="contributionNotes" rows="3" ${!canWrite() ? "disabled" : ""}></textarea></label>
          <div class="actions full">
            <button class="btn primary" ${!canWrite() ? "disabled" : ""}>Guardar aporte</button>
            <button type="button" id="cancelContributionEdit" class="btn ghost hidden">Cancelar edición</button>
          </div>
        </form>
      </div>

      <div class="panel">
        <h3>Aportes cargados</h3>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Fecha</th><th>Persona</th><th>Monto</th><th>Medio</th><th>Observación</th><th>Acciones</th></tr></thead>
            <tbody>
              ${contributions.slice().reverse().map((c) => {
                const canEdit = isAdmin() || (currentRole === "editor" && c.created_by === session.user.id);
                return `
                  <tr>
                    <td>${c.date}</td>
                    <td>${safe(personName(c.person_id))}</td>
                    <td><b>${money(c.amount)}</b></td>
                    <td>${safe(c.method || "-")}</td>
                    <td>${safe(c.notes || "-")}</td>
                    <td>
                      <div class="row-actions">
                        <button class="btn ghost small-btn" data-edit-contribution="${c.id}" ${!canEdit ? "disabled" : ""}>Editar</button>
                        <button class="btn danger small-btn" data-delete-contribution="${c.id}" ${!canEdit ? "disabled" : ""}>Borrar</button>
                      </div>
                    </td>
                  </tr>
                `;
              }).join("") || `<tr><td colspan="6">Todavía no hay aportes cargados.</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  `;
}

function getFilteredMovements() {
  const start = document.getElementById("filterStart")?.value || "1900-01-01";
  const end = document.getElementById("filterEnd")?.value || "2999-12-31";
  const type = document.getElementById("filterType")?.value || "";
  const cat = document.getElementById("filterCategory")?.value || "";
  const person = document.getElementById("filterPerson")?.value || "";

  const expRows = expenses.map((e) => ({
    type: "expense",
    typeLabel: "Gasto",
    date: e.date,
    description: e.description,
    category_id: e.category_id,
    category: categoryName(e.category_id),
    amount: e.amount,
    person_id: e.payer_person_id,
    person: personName(e.payer_person_id),
    splitIds: splits.filter((s) => s.expense_id === e.id).map((s) => s.person_id),
    includes: splits.filter((s) => s.expense_id === e.id).map((s) => personName(s.person_id)).join(", ")
  }));

  const contRows = contributions.map((c) => ({
    type: "contribution",
    typeLabel: "Aporte",
    date: c.date,
    description: c.notes || "Aporte de dinero",
    category_id: "",
    category: "-",
    amount: c.amount,
    person_id: c.person_id,
    person: personName(c.person_id),
    splitIds: [],
    includes: "-"
  }));

  return [...expRows, ...contRows]
    .filter((m) => m.date >= start && m.date <= end)
    .filter((m) => !type || m.type === type)
    .filter((m) => !cat || m.category_id === cat)
    .filter((m) => !person || m.person_id === person || m.splitIds.includes(person))
    .sort((a,b) => b.date.localeCompare(a.date));
}

function movementsHtml() {
  const rows = getFilteredMovements();
  return `
    <section class="view active">
      <div class="panel">
        <h3>Tabla de movimientos</h3>
        <div class="filters">
          <label>Desde <input id="filterStart" type="date"></label>
          <label>Hasta <input id="filterEnd" type="date"></label>
          <label>Tipo
            <select id="filterType">
              <option value="">Todos</option>
              <option value="expense">Gastos</option>
              <option value="contribution">Aportes</option>
            </select>
          </label>
          <label>Categoría
            <select id="filterCategory">
              <option value="">Todas</option>
              ${categoriesOptions()}
            </select>
          </label>
          <label>Persona
            <select id="filterPerson">
              <option value="">Todas</option>
              ${peopleOptions()}
            </select>
          </label>
          <button id="clearFilters" class="btn ghost">Limpiar</button>
          <button id="exportCsv" class="btn secondary">Exportar CSV</button>
        </div>

        <div class="table-wrap">
          <table>
            <thead><tr><th>Fecha</th><th>Tipo</th><th>Descripción</th><th>Categoría</th><th>Monto</th><th>Persona</th><th>Incluye</th></tr></thead>
            <tbody>
              ${rows.map((m) => `
                <tr>
                  <td>${m.date}</td>
                  <td>${m.typeLabel}</td>
                  <td>${safe(m.description)}</td>
                  <td>${safe(m.category)}</td>
                  <td><b>${money(m.amount)}</b></td>
                  <td>${safe(m.person)}</td>
                  <td>${safe(m.includes)}</td>
                </tr>
              `).join("") || `<tr><td colspan="7">No hay movimientos con esos filtros.</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  `;
}


function backupHtml() {
  return `
    <section class="view active">
      <div class="panel">
        <div class="panel-head">
          <div><h3>Copia manual</h3><p>Incluye participantes, categorías, gastos, divisiones y aportes del grupo actual.</p></div>
          <span class="status-pill">Último guardado: online</span>
        </div>
        <div class="backup-actions">
          <button id="exportJson" class="btn primary">Descargar JSON</button>
          <button id="exportAllCsv" class="btn secondary">Descargar CSV</button>
        </div>
        <div class="help-box"><b>Importante:</b> los datos continúan guardados en Supabase. Estas descargas son una copia adicional para conservar en tu computadora.</div>
      </div>
    </section>`;
}

function exportJsonBackup() {
  const payload = {
    exported_at: new Date().toISOString(),
    group: currentGroup,
    people, categories, expenses, splits, contributions
  };
  downloadBlob(JSON.stringify(payload, null, 2), `copia_${currentGroup.name.replace(/\s+/g,"_")}.json`, "application/json");
}
function downloadBlob(content, filename, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function settingsHtml() {
  return `
    <section class="view active">
      <div class="grid2">
        <div class="panel">
          <h3>Personas / participantes</h3>
          <form id="personForm" class="inline">
            <input id="personName" placeholder="Ej: Brian" ${!canWrite() ? "disabled" : ""}>
            <button class="btn primary" ${!canWrite() ? "disabled" : ""}>Agregar</button>
          </form>
          <div class="list">
            ${people.map((p) => `
              <div class="item">
                <span><b>${safe(p.name)}</b></span>
                <div class="row-actions">
                  <button class="btn ghost small-btn" data-edit-person="${p.id}" ${!canWrite() ? "disabled" : ""}>Editar</button>
                  <button class="btn danger small-btn" data-delete-person="${p.id}" ${!isAdmin() ? "disabled" : ""}>Borrar</button>
                </div>
              </div>
            `).join("") || `<div class="empty">No hay participantes.</div>`}
          </div>
        </div>

        <div class="panel">
          <h3>Categorías</h3>
          <form id="categoryForm" class="inline">
            <input id="categoryName" placeholder="Ej: Supermercado" ${!canWrite() ? "disabled" : ""}>
            <button class="btn primary" ${!canWrite() ? "disabled" : ""}>Agregar</button>
          </form>
          <div class="list">
            ${categories.map((c) => `
              <div class="item">
                <span><b>${safe(c.name)}</b></span>
                <div class="row-actions">
                  <button class="btn ghost small-btn" data-edit-category="${c.id}" ${!canWrite() ? "disabled" : ""}>Editar</button>
                  <button class="btn danger small-btn" data-delete-category="${c.id}" ${!isAdmin() ? "disabled" : ""}>Borrar</button>
                </div>
              </div>
            `).join("") || `<div class="empty">No hay categorías.</div>`}
          </div>
        </div>
      </div>

      <div class="panel">
        <div class="panel-head">
          <div><h3>Usuarios y permisos</h3><p>Nadie accede hasta que vos apruebes su solicitud.</p></div>
          ${isAdmin() ? `<div class="invite-box"><span>Código del grupo</span><strong>${safe(currentGroup.invite_code || "Ejecutá la actualización SQL")}</strong><button id="copyInvite" class="btn ghost small-btn">Copiar</button></div>` : ""}
        </div>
        ${isAdmin() ? `
          <div class="help-box"><b>Acceso protegido:</b> compartir el código solo permite enviar una solicitud. No concede acceso automáticamente.</div><form id="memberForm" class="form wide">
            <label>Email del usuario registrado <input id="memberEmail" type="email" placeholder="email@ejemplo.com"></label>
            <label>Rol
              <select id="memberRole">
                <option value="editor">Editor</option>
                <option value="collaborator">Colaborador</option>
                <option value="viewer">Espectador</option>
              </select>
            </label>
            <button class="btn primary">Agregar usuario al grupo</button>
          </form>
        ` : `<p class="warning">Solo el administrador puede agregar usuarios.</p>`}

        ${isAdmin() ? `
        <div class="table-wrap" style="margin-top:16px">
          <h3>Solicitudes pendientes</h3>
          <table>
            <thead><tr><th>Email</th><th>Fecha</th><th>Rol a asignar</th><th>Decisión</th></tr></thead>
            <tbody id="requestsTable"><tr><td colspan="4">Cargando solicitudes...</td></tr></tbody>
          </table>
        </div>` : ""}

        <div class="table-wrap" style="margin-top:16px">
          <h3>Usuarios autorizados</h3>
          <table>
            <thead><tr><th>Email</th><th>Rol</th><th>Acción</th></tr></thead>
            <tbody id="membersTable">
              <tr><td colspan="3">Cargando usuarios...</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>
  `;
}

async function bindViewEvents() {
  if (currentView === "dashboard") {
    ["periodType","periodDate","periodStart","periodEnd"].forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener("change", () => {
        localStorage.setItem("gdc_period_type", document.getElementById("periodType").value);
        localStorage.setItem("gdc_period_date", document.getElementById("periodDate")?.value || today());
        localStorage.setItem("gdc_period_start", document.getElementById("periodStart")?.value || today());
        localStorage.setItem("gdc_period_end", document.getElementById("periodEnd")?.value || today());
        renderApp();
      });
    });
  }

  if (currentView === "expenses") {
    document.getElementById("expenseForm").addEventListener("submit", saveExpense);
    const cancel = document.getElementById("cancelExpenseEdit");
    if (cancel) cancel.addEventListener("click", () => renderApp());
  }

  if (currentView === "contributions") {
    document.getElementById("contributionForm").addEventListener("submit", saveContribution);
    const cancel = document.getElementById("cancelContributionEdit");
    if (cancel) cancel.addEventListener("click", () => renderApp());
  }

  if (currentView === "movements") {
    ["filterStart","filterEnd","filterType","filterCategory","filterPerson"].forEach((id) => {
      document.getElementById(id).addEventListener("change", renderApp);
    });
    document.getElementById("clearFilters").addEventListener("click", () => renderApp());
    document.getElementById("exportCsv").addEventListener("click", exportCsv);
  }

  if (currentView === "backup") {
    document.getElementById("exportJson")?.addEventListener("click", exportJsonBackup);
    document.getElementById("exportAllCsv")?.addEventListener("click", exportCsv);
  }

  if (currentView === "settings") {
    document.getElementById("copyInvite")?.addEventListener("click", async () => {
      await navigator.clipboard.writeText(currentGroup.invite_code || "");
      toast("Código copiado.");
    });
    document.getElementById("personForm")?.addEventListener("submit", addPerson);
    document.getElementById("categoryForm")?.addEventListener("submit", addCategory);
    document.getElementById("memberForm")?.addEventListener("submit", addMember);
    await loadMembersTable();
  }

  document.body.querySelectorAll("[data-edit-expense]").forEach((btn) => btn.addEventListener("click", () => fillExpense(btn.dataset.editExpense)));
  document.body.querySelectorAll("[data-delete-expense]").forEach((btn) => btn.addEventListener("click", () => deleteExpense(btn.dataset.deleteExpense)));
  document.body.querySelectorAll("[data-edit-contribution]").forEach((btn) => btn.addEventListener("click", () => fillContribution(btn.dataset.editContribution)));
  document.body.querySelectorAll("[data-delete-contribution]").forEach((btn) => btn.addEventListener("click", () => deleteContribution(btn.dataset.deleteContribution)));
  document.body.querySelectorAll("[data-edit-person]").forEach((btn) => btn.addEventListener("click", () => editPerson(btn.dataset.editPerson)));
  document.body.querySelectorAll("[data-delete-person]").forEach((btn) => btn.addEventListener("click", () => deletePerson(btn.dataset.deletePerson)));
  document.body.querySelectorAll("[data-edit-category]").forEach((btn) => btn.addEventListener("click", () => editCategory(btn.dataset.editCategory)));
  document.body.querySelectorAll("[data-delete-category]").forEach((btn) => btn.addEventListener("click", () => deleteCategory(btn.dataset.deleteCategory)));
}

async function saveExpense(e) {
  e.preventDefault();
  if (!canCreate()) return toast("No tenés permiso para cargar gastos.");

  const id = document.getElementById("expenseId").value;
  const splitIds = [...document.querySelectorAll("#splitChecks input:checked")].map((x) => x.value);
  if (!splitIds.length) return toast("Elegí al menos una persona para dividir el gasto.");

  const payload = {
    group_id: currentGroup.id,
    date: document.getElementById("expenseDate").value,
    description: document.getElementById("expenseDescription").value.trim(),
    category_id: document.getElementById("expenseCategory").value || null,
    amount: Number(document.getElementById("expenseAmount").value),
    payer_person_id: document.getElementById("expensePayer").value || null,
    notes: document.getElementById("expenseNotes").value.trim(),
    created_by: session.user.id
  };

  let expenseId = id;
  if (id) {
    const { error } = await supabase.from("expenses").update(payload).eq("id", id);
    if (error) return toast(error.message);
    await supabase.from("expense_splits").delete().eq("expense_id", id);
  } else {
    const { data, error } = await supabase.from("expenses").insert(payload).select().single();
    if (error) return toast(error.message);
    expenseId = data.id;
  }

  const { error: splitError } = await supabase.from("expense_splits").insert(splitIds.map((person_id) => ({
    expense_id: expenseId,
    person_id
  })));

  if (splitError) return toast(splitError.message);

  await reload();
  toast("Gasto guardado.");
}

function fillExpense(id) {
  const exp = expenses.find((x) => x.id === id);
  if (!exp) return;
  document.getElementById("expenseId").value = exp.id;
  document.getElementById("expenseDate").value = exp.date;
  document.getElementById("expenseDescription").value = exp.description;
  document.getElementById("expenseCategory").value = exp.category_id || "";
  document.getElementById("expenseAmount").value = exp.amount;
  document.getElementById("expensePayer").value = exp.payer_person_id || "";
  document.getElementById("expenseNotes").value = exp.notes || "";
  const ids = splits.filter((s) => s.expense_id === id).map((s) => s.person_id);
  document.querySelectorAll("#splitChecks input").forEach((x) => x.checked = ids.includes(x.value));
  document.getElementById("cancelExpenseEdit").classList.remove("hidden");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function deleteExpense(id) {
  if (!confirm("¿Borrar este gasto?")) return;
  const { error } = await supabase.from("expenses").delete().eq("id", id);
  if (error) return toast(error.message);
  await reload();
}

async function saveContribution(e) {
  e.preventDefault();
  if (!canWrite()) return toast("No tenés permiso para cargar aportes.");

  const id = document.getElementById("contributionId").value;
  const payload = {
    group_id: currentGroup.id,
    date: document.getElementById("contributionDate").value,
    person_id: document.getElementById("contributionPerson").value || null,
    amount: Number(document.getElementById("contributionAmount").value),
    method: document.getElementById("contributionMethod").value.trim(),
    notes: document.getElementById("contributionNotes").value.trim(),
    created_by: session.user.id
  };

  const res = id
    ? await supabase.from("contributions").update(payload).eq("id", id)
    : await supabase.from("contributions").insert(payload);

  if (res.error) return toast(res.error.message);

  await reload();
  toast("Aporte guardado.");
}

function fillContribution(id) {
  const c = contributions.find((x) => x.id === id);
  if (!c) return;
  document.getElementById("contributionId").value = c.id;
  document.getElementById("contributionDate").value = c.date;
  document.getElementById("contributionPerson").value = c.person_id || "";
  document.getElementById("contributionAmount").value = c.amount;
  document.getElementById("contributionMethod").value = c.method || "";
  document.getElementById("contributionNotes").value = c.notes || "";
  document.getElementById("cancelContributionEdit").classList.remove("hidden");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function deleteContribution(id) {
  if (!confirm("¿Borrar este aporte?")) return;
  const { error } = await supabase.from("contributions").delete().eq("id", id);
  if (error) return toast(error.message);
  await reload();
}

async function addPerson(e) {
  e.preventDefault();
  if (!canWrite()) return;
  const name = document.getElementById("personName").value.trim();
  if (!name) return;
  const { error } = await supabase.from("people").insert({ group_id: currentGroup.id, name });
  if (error) return toast(error.message);
  await reload();
}

async function editPerson(id) {
  const current = people.find((p) => p.id === id);
  const name = prompt("Nuevo nombre:", current?.name || "");
  if (!name) return;
  const { error } = await supabase.from("people").update({ name }).eq("id", id);
  if (error) return toast(error.message);
  await reload();
}

async function deletePerson(id) {
  if (!isAdmin()) return;
  const used = expenses.some((e) => e.payer_person_id === id) ||
    splits.some((s) => s.person_id === id) ||
    contributions.some((c) => c.person_id === id);
  if (used) return toast("No se puede borrar una persona con movimientos. Podés editarle el nombre.");
  if (!confirm("¿Borrar esta persona?")) return;
  const { error } = await supabase.from("people").delete().eq("id", id);
  if (error) return toast(error.message);
  await reload();
}

async function addCategory(e) {
  e.preventDefault();
  if (!canWrite()) return;
  const name = document.getElementById("categoryName").value.trim();
  if (!name) return;
  const { error } = await supabase.from("categories").insert({ group_id: currentGroup.id, name });
  if (error) return toast(error.message);
  await reload();
}

async function editCategory(id) {
  const current = categories.find((c) => c.id === id);
  const name = prompt("Nuevo nombre:", current?.name || "");
  if (!name) return;
  const { error } = await supabase.from("categories").update({ name }).eq("id", id);
  if (error) return toast(error.message);
  await reload();
}

async function deleteCategory(id) {
  if (!isAdmin()) return;
  const used = expenses.some((e) => e.category_id === id);
  if (used) return toast("No se puede borrar una categoría con gastos. Podés editarle el nombre.");
  if (!confirm("¿Borrar esta categoría?")) return;
  const { error } = await supabase.from("categories").delete().eq("id", id);
  if (error) return toast(error.message);
  await reload();
}

async function addMember(e) {
  e.preventDefault();
  if (!isAdmin()) return;
  const email = document.getElementById("memberEmail").value.trim().toLowerCase();
  const role = document.getElementById("memberRole").value;
  if (role === "admin") return toast("Solo el propietario puede ser administrador.");

  const { data: prof, error: profileError } = await supabase
    .from("profiles")
    .select("id,email")
    .eq("email", email)
    .maybeSingle();

  if (profileError) return toast(profileError.message);
  if (!prof) return toast("Ese email todavía no creó cuenta en la app.");

  const { error } = await supabase
    .from("group_members")
    .insert({ group_id: currentGroup.id, user_id: prof.id, role });

  if (error) return toast(error.message);

  toast("Usuario agregado al grupo.");
  await init();
}

async function loadAccessRequestsTable() {
  const table = document.getElementById("requestsTable");
  if (!table || !isAdmin()) return;
  const { data, error } = await supabase.rpc("admin_access_requests", { p_group_id: currentGroup.id });
  if (error) {
    table.innerHTML = `<tr><td colspan="4">${safe(error.message)}</td></tr>`;
    return;
  }
  const rows = data || [];
  table.innerHTML = rows.length ? rows.map(r => `
    <tr>
      <td>${safe(r.email)}</td>
      <td>${new Date(r.requested_at).toLocaleString("es-AR")}</td>
      <td><select id="request-role-${r.request_id}">
        <option value="editor">Editor</option>
        <option value="collaborator" selected>Colaborador</option>
        <option value="viewer">Espectador</option>
      </select></td>
      <td><div class="row-actions">
        <button class="btn primary small-btn" data-approve-request="${r.request_id}">Aprobar</button>
        <button class="btn danger small-btn" data-reject-request="${r.request_id}">Rechazar</button>
      </div></td>
    </tr>`).join("") : `<tr><td colspan="4">No hay solicitudes pendientes.</td></tr>`;

  document.querySelectorAll("[data-approve-request]").forEach(btn => btn.addEventListener("click", async () => {
    const id = btn.dataset.approveRequest;
    const role = document.getElementById(`request-role-${id}`).value;
    const { error } = await supabase.rpc("approve_access_request", { p_request_id: id, p_role: role });
    if (error) return toast(error.message);
    toast("Usuario autorizado.");
    await loadAccessRequestsTable();
    await loadMembersTable();
  }));
  document.querySelectorAll("[data-reject-request]").forEach(btn => btn.addEventListener("click", async () => {
    if (!confirm("¿Rechazar esta solicitud?")) return;
    const { error } = await supabase.rpc("reject_access_request", { p_request_id: btn.dataset.rejectRequest });
    if (error) return toast(error.message);
    toast("Solicitud rechazada.");
    await loadAccessRequestsTable();
  }));
}

async function loadMembersTable() {
  if (currentView !== "settings") return;
  const table = document.getElementById("membersTable");
  if (!table) return;

  const { data, error } = await supabase
    .from("group_members")
    .select("id, role, user_id, created_at")
    .eq("group_id", currentGroup.id)
    .order("created_at", { ascending: true });

  if (error) {
    table.innerHTML = `<tr><td colspan="3">${safe(error.message)}</td></tr>`;
    return;
  }

  const members = data || [];
  const userIds = [...new Set(members.map(m => m.user_id))];
  let emailByUser = {};
  if (userIds.length) {
    const { data: profileRows, error: profilesError } = await supabase
      .from("profiles")
      .select("id,email")
      .in("id", userIds);
    if (profilesError) {
      table.innerHTML = `<tr><td colspan="3">${safe(profilesError.message)}</td></tr>`;
      return;
    }
    emailByUser = Object.fromEntries((profileRows || []).map(p => [p.id, p.email]));
  }

  table.innerHTML = members.map((m) => `
    <tr>
      <td>${safe(emailByUser[m.user_id] || m.user_id)}</td>
      <td>${roleName(m.role)}</td>
      <td>
        <button class="btn danger small-btn" data-remove-member="${m.id}" ${!isAdmin() || m.user_id === session.user.id ? "disabled" : ""}>Quitar</button>
      </td>
    </tr>
  `).join("");

  document.querySelectorAll("[data-remove-member]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("¿Quitar usuario del grupo?")) return;
      const { error } = await supabase.from("group_members").delete().eq("id", btn.dataset.removeMember);
      if (error) return toast(error.message);
      await loadMembersTable();
    });
  });
}

function exportCsv() {
  const rows = [["Fecha","Tipo","Descripcion","Categoria","Monto","Persona","Incluye"]];
  getFilteredMovements().forEach((m) => rows.push([
    m.date, m.typeLabel, m.description, m.category, m.amount, m.person, m.includes
  ]));

  const csv = rows.map((r) => r.map((v) => `"${String(v).replaceAll('"','""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "movimientos_gastos_de_casa.csv";
  a.click();
  URL.revokeObjectURL(url);
}

async function logout() {
  await supabase.auth.signOut();
  session = null;
  profile = null;
  currentGroup = null;
  currentRole = null;
  renderAuth();
}

async function reload() {
  await loadData();
  renderApp();
}

async function init() {
  if (checkConfig()) return;

  const { data } = await supabase.auth.getSession();
  session = data.session;

  if (!session) {
    renderAuth();
    return;
  }

  try {
    await loadProfile();
    await loadMemberships();

    if (!currentGroup) {
      renderNoGroup();
      return;
    }

    await loadData();
    renderApp();
  } catch (err) {
    app.innerHTML = `
      <section class="auth-screen">
        <div class="auth-card">
          <div class="badge">GC</div>
          <h1>Error al cargar</h1>
          <p>${safe(err.message)}</p>
          <div class="help-box">Revisá que hayas pegado el SQL completo en Supabase y que el archivo config.js tenga la URL y anon key correctas.</div>
          <button id="retryBtn" class="btn primary full">Reintentar</button>
          <button id="logoutError" class="btn ghost full" style="margin-top:10px">Salir</button>
        </div>
      </section>
    `;
    document.getElementById("retryBtn").addEventListener("click", init);
    document.getElementById("logoutError").addEventListener("click", logout);
  }
}

if (!missingConfig) {
  supabase.auth.onAuthStateChange(() => {
    init();
  });
}

init();
