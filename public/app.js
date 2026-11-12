const API_BASE = (function () {
  var p = window.location.pathname.replace(/\/+$/, "");
  return p + "/api";
})();

const PREVIEW_TOKEN = new URLSearchParams(window.location.search).get("t") || "";

function withToken(url) {
  if (!PREVIEW_TOKEN) return url;
  var sep = url.indexOf("?") === -1 ? "?" : "&";
  return url + sep + "t=" + encodeURIComponent(PREVIEW_TOKEN);
}

// ── State ──
let currentPage = "dashboard";
let sidebarOpen = false;
let sidebarCollapsed = localStorage.getItem("sidebar-collapsed") === "true";
let toasts = [];
let chatHistory = [];
let chatLoading = false;
let orders = [];
let invoices = [];
let knowledge = [];
let approvals = [];
let auditLogs = [];
let dashboardStats = {};
let paypalConfigured = false;
let pageDataLoaded = {};
let authToken = localStorage.getItem("merchant_token") || "";
let needsAuth = false;
let authChecked = false;
let securityWarning = null;

// ── Icons (inline SVG) ──
const icons = {
  dashboard: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/></svg>',
  chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
  orders: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>',
  invoices: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M16 13H8"/><path d="M16 17H8"/><path d="M10 9H8"/></svg>',
  knowledge: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>',
  approvals: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M9 12l2 2 4-4"/><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z"/></svg>',
  settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
  audit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M12 8v4l3 3"/><circle cx="12" cy="12" r="10"/></svg>',
  menu: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 12h18M3 6h18M3 18h18"/></svg>',
  close: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
  send: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4z"/></svg>',
  plus: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  trash: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
  check: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
  x: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
  external: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><path d="M15 3h6v6"/><path d="M10 14 21 3"/></svg>',
  refresh: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>',
  empty: '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
  collapse: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
  expand: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>',
  lock: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>',
};

// ── API helpers ──
async function api(path, options = {}) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (authToken) headers["Authorization"] = `Bearer ${authToken}`;
  const res = await fetch(withToken(`${API_BASE}${path}`), { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || data.details || `Request failed (${res.status})`);
  }
  return data;
}

// ── Toast ──
function showToast(message, type = "info") {
  const id = Date.now() + Math.random();
  toasts.push({ id, message, type });
  renderToasts();
  setTimeout(() => { toasts = toasts.filter((t) => t.id !== id); renderToasts(); }, 5000);
}

function renderToasts() {
  let container = document.getElementById("toast-container");
  if (!container) {
    container = document.createElement("div");
    container.id = "toast-container";
    container.className = "toast-container";
    document.body.appendChild(container);
  }
  container.innerHTML = toasts
    .map((t) => `<div class="toast toast-${t.type}"><span class="text-sm">${escapeHtml(t.message)}</span></div>`)
    .join("");
}

// ── Utils ──
function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str || "";
  return div.innerHTML;
}

function formatTime(ts) {
  if (!ts) return "";
  return new Date(ts).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function statusBadge(status) {
  const s = (status || "").toUpperCase();
  let cls = "badge-neutral";
  if (["COMPLETED", "PAID", "APPROVED", "SENT", "ACTIVE"].includes(s)) cls = "badge-success";
  else if (["PENDING", "CREATED", "DRAFT"].includes(s)) cls = "badge-warning";
  else if (["FAILED", "REJECTED", "CANCELLED", "VOID"].includes(s)) cls = "badge-error";
  return `<span class="badge ${cls}"><span class="badge-dot"></span>${s}</span>`;
}

// ── Navigation ──
const pages = [
  { id: "dashboard", label: "Dashboard", icon: "dashboard", section: "Workspace" },
  { id: "chat", label: "AI Assistant", icon: "chat", section: "Workspace" },
  { id: "orders", label: "Orders", icon: "orders", section: "Commerce" },
  { id: "invoices", label: "Invoices", icon: "invoices", section: "Commerce" },
  { id: "approvals", label: "Approvals", icon: "approvals", section: "Commerce", badge: 0, badgeClass: "warning" },
  { id: "knowledge", label: "Knowledge Base", icon: "knowledge", section: "Resources" },
  { id: "audit", label: "Audit Logs", icon: "audit", section: "Resources" },
  { id: "settings", label: "Settings", icon: "settings", section: "Resources" },
];

function navigate(pageId) {
  currentPage = pageId;
  sidebarOpen = false;
  const sidebar = document.getElementById("sidebar");
  const backdrop = document.getElementById("sidebar-backdrop");
  if (sidebar) sidebar.classList.remove("open");
  if (backdrop) { backdrop.classList.remove("show"); backdrop.classList.remove("visible"); }
  updateSidebarActive();
  updateTopbarTitle();
  renderCurrentPageContent();
  loadPageData(pageId);
}

function loadPageData(pageId) {
  if (pageId === "dashboard") loadDashboard();
  else if (pageId === "chat") loadChatHistory();
  else if (pageId === "orders") loadOrders();
  else if (pageId === "invoices") loadInvoices();
  else if (pageId === "approvals") loadApprovals();
  else if (pageId === "knowledge") loadKnowledge();
  else if (pageId === "audit") loadAuditLogs();
  else if (pageId === "settings") loadSettings();
}

// ── Auth ──
async function checkAuth() {
  try {
    const status = await api("/auth/status");
    needsAuth = status.needsAuth;
    authChecked = true;
    if (status.error) {
      securityWarning = status.error;
    }
    if (!needsAuth) {
      renderLogin();
      const root = document.getElementById("root");
      if (root && securityWarning) {
        const existing = root.querySelector(".login-subtitle");
        if (existing) existing.textContent = securityWarning;
      }
    } else if (status.authenticated || authToken) {
      renderShell();
      navigate("dashboard");
      loadApprovals();
    } else {
      renderLogin();
    }
  } catch {
    authChecked = true;
    renderLogin();
  }
}

function renderLogin() {
  const root = document.getElementById("root");
  root.innerHTML = `
    <div class="login-container">
      <div class="login-card">
        <div class="login-logo">
          <div class="sidebar-logo-icon" style="width:40px;height:40px;font-size:20px">H</div>
        </div>
        <h1 class="login-title">HelpPuff Commerce</h1>
        <p class="login-subtitle">Enter your merchant token to access the dashboard</p>
        <form id="login-form" onSubmit="return false" autocomplete="on">
          <input type="text" name="username" value="merchant" autocomplete="username" style="display:none" aria-hidden="true" />
          <div class="form-group" style="margin-top:24px">
            <input type="password" class="form-input" id="login-token" name="password" placeholder="Merchant token" style="height:40px" autocomplete="current-password" />
          </div>
          <button type="submit" class="btn btn-primary w-full" id="login-btn" style="height:40px;margin-top:8px">Sign In</button>
        </form>
      </div>
    </div>
  `;
  const input = document.getElementById("login-token");
  const btn = document.getElementById("login-btn");
  input.onkeydown = (e) => { if (e.key === "Enter") doLogin(); };
  btn.onclick = doLogin;
}

async function doLogin() {
  const input = document.getElementById("login-token");
  const token = input.value.trim();
  if (!token) { showToast("Token is required", "error"); return; }
  try {
    const res = await api("/auth/login", { method: "POST", body: JSON.stringify({ token }) });
    if (res.authenticated) {
      authToken = res.token || token;
      localStorage.setItem("merchant_token", authToken);
      showToast("Signed in", "success");
      renderShell();
      navigate("dashboard");
      loadApprovals();
    }
  } catch (e) {
    showToast(e.message, "error");
  }
}

// ── Data Loaders ──
async function loadDashboard() {
  try {
    const [stats, status] = await Promise.all([api("/dashboard"), api("/paypal/status")]);
    dashboardStats = stats;
    paypalConfigured = status.configured;
    pageDataLoaded.dashboard = true;
    updatePayPalStatusBadge();
    if (currentPage === "dashboard") renderDashboardContent();
  } catch (e) { showToast(e.message, "error"); }
}

async function loadChatHistory() {
  try {
    chatHistory = await api("/chat/history");
    pageDataLoaded.chat = true;
    if (currentPage === "chat") renderChatContent();
  } catch (e) { showToast(e.message, "error"); }
}

async function loadOrders() {
  try {
    orders = await api("/orders");
    pageDataLoaded.orders = true;
    if (currentPage === "orders") renderOrdersContent();
  } catch (e) { showToast(e.message, "error"); }
}

async function loadInvoices() {
  try {
    invoices = await api("/invoices");
    pageDataLoaded.invoices = true;
    if (currentPage === "invoices") renderInvoicesContent();
  } catch (e) { showToast(e.message, "error"); }
}

async function loadApprovals() {
  try {
    approvals = await api("/approvals");
    pageDataLoaded.approvals = true;
    updateSidebarBadges();
    if (currentPage === "approvals") renderApprovalsContent();
  } catch (e) { showToast(e.message, "error"); }
}

async function loadKnowledge() {
  try {
    knowledge = await api("/knowledge");
    pageDataLoaded.knowledge = true;
    if (currentPage === "knowledge") renderKnowledgeContent();
  } catch (e) { showToast(e.message, "error"); }
}

async function loadAuditLogs() {
  try {
    auditLogs = await api("/audit-logs");
    pageDataLoaded.audit = true;
    if (currentPage === "audit") renderAuditContent();
  } catch (e) { showToast(e.message, "error"); }
}

async function loadSettings() {
  try {
    const status = await api("/paypal/status");
    paypalConfigured = status.configured;
    pageDataLoaded.settings = true;
    if (currentPage === "settings") renderSettingsContent();
  } catch (e) { showToast(e.message, "error"); }
}

// ── Shell Render ──
function renderShell() {
  const root = document.getElementById("root");
  root.innerHTML = `
    <div class="app-shell ${sidebarCollapsed ? "sidebar-collapsed" : ""}" id="app-shell">
      ${renderSidebar()}
      <div class="sidebar-backdrop" id="sidebar-backdrop"></div>
      <div class="main-content">
        ${renderTopbar()}
        ${securityWarning ? `<div class="security-warning">${icons.lock} <span>${escapeHtml(securityWarning)}</span></div>` : ""}
        <div class="content-area" id="content-area"><div class="spinner"></div></div>
      </div>
    </div>
  `;
  attachShellEventListeners();
}

function renderSidebar() {
  let sections = {};
  pages.forEach((p) => { if (!sections[p.section]) sections[p.section] = []; sections[p.section].push(p); });
  const isDark = document.documentElement.classList.contains("dark");
  let html = `<aside class="sidebar ${sidebarOpen ? "open" : ""}" id="sidebar">
    <div class="sidebar-header">
      <div class="sidebar-logo">
        <div class="sidebar-logo-icon">H</div>
        <span class="sidebar-logo-text">HelpPuff Commerce</span>
      </div>
      <button class="sidebar-collapse-btn" id="sidebar-collapse-btn" title="${sidebarCollapsed ? "Expand" : "Collapse"}" aria-label="${sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}">
        ${sidebarCollapsed ? icons.expand : icons.collapse}
      </button>
    </div>
    <nav class="sidebar-nav">`;
  Object.keys(sections).forEach((section) => {
    html += `<div class="sidebar-section-label">${section}</div>`;
    sections[section].forEach((p) => {
      const badge = p.badge ? `<span class="sidebar-item-badge ${p.badgeClass || ""}">${p.badge}</span>` : "";
      html += `<button class="sidebar-item ${currentPage === p.id ? "active" : ""}" data-page="${p.id}" title="${p.label}">${icons[p.icon]}<span class="sidebar-item-label">${p.label}</span>${badge}</button>`;
    });
  });
  html += `</nav>
    <div class="sidebar-footer">
      <button class="sidebar-footer-item" id="theme-toggle" title="${isDark ? "Switch to light mode" : "Switch to dark mode"}">
        <span class="sidebar-footer-icon">${isDark ? "☀️" : "🌙"}</span>
        <span class="sidebar-footer-label">${isDark ? "Light mode" : "Dark mode"}</span>
      </button>
      ${needsAuth ? `<button class="sidebar-footer-item" id="logout-btn" title="Sign out"><span class="sidebar-footer-icon">${icons.lock}</span><span class="sidebar-footer-label">Sign out</span></button>` : ""}
    </div>
  </aside>`;
  return html;
}

function renderTopbar() {
  const page = pages.find((p) => p.id === currentPage);
  return `<header class="topbar"><button class="mobile-toggle" id="mobile-toggle">${icons.menu}</button><div class="topbar-title">${page ? page.label : ""}</div><div class="topbar-spacer"></div><div id="paypal-status-badge"></div></header>`;
}

function updateSidebarActive() {
  document.querySelectorAll(".sidebar-item").forEach((el) => { el.classList.toggle("active", el.dataset.page === currentPage); });
}

function updateTopbarTitle() {
  const page = pages.find((p) => p.id === currentPage);
  const titleEl = document.querySelector(".topbar-title");
  if (titleEl) titleEl.textContent = page ? page.label : "";
}

function updateSidebarBadges() {
  const approvalsPage = pages.find((p) => p.id === "approvals");
  if (approvalsPage) { approvalsPage.badge = approvals.filter((a) => a.status === "pending").length; }
  document.querySelectorAll(".sidebar-item").forEach((el) => {
    const page = pages.find((p) => p.id === el.dataset.page);
    if (!page) return;
    const existingBadge = el.querySelector(".sidebar-item-badge");
    if (page.badge && page.badge > 0) {
      if (existingBadge) { existingBadge.textContent = page.badge; existingBadge.style.display = ""; }
      else { const badgeEl = document.createElement("span"); badgeEl.className = `sidebar-item-badge ${page.badgeClass || ""}`; badgeEl.textContent = page.badge; el.appendChild(badgeEl); }
    } else if (existingBadge) { existingBadge.style.display = "none"; }
  });
}

function updatePayPalStatusBadge() {
  const container = document.getElementById("paypal-status-badge");
  if (!container) return;
  container.innerHTML = paypalConfigured
    ? `<span class="badge badge-success"><span class="badge-dot"></span>Sandbox</span>`
    : `<span class="badge badge-warning"><span class="badge-dot"></span>Not configured</span>`;
}

// ── Render current page content ──
function renderCurrentPageContent() {
  const loaded = pageDataLoaded[currentPage];
  if (loaded) {
    if (currentPage === "dashboard") renderDashboardContent();
    else if (currentPage === "chat") renderChatContent();
    else if (currentPage === "orders") renderOrdersContent();
    else if (currentPage === "invoices") renderInvoicesContent();
    else if (currentPage === "approvals") renderApprovalsContent();
    else if (currentPage === "knowledge") renderKnowledgeContent();
    else if (currentPage === "audit") renderAuditContent();
    else if (currentPage === "settings") renderSettingsContent();
  } else {
    showContentSpinner();
  }
}

function showContentSpinner() {
  const area = document.getElementById("content-area");
  if (area) area.innerHTML = '<div class="spinner"></div>';
}

// ── Shell event listeners ──
function attachShellEventListeners() {
  document.querySelectorAll(".sidebar-item").forEach((el) => { el.onclick = (e) => { e.preventDefault(); navigate(el.dataset.page); }; });
  const toggle = document.getElementById("mobile-toggle");
  if (toggle) { toggle.onclick = () => { sidebarOpen = !sidebarOpen; const sidebar = document.getElementById("sidebar"); const backdrop = document.getElementById("sidebar-backdrop"); if (sidebar) sidebar.classList.toggle("open", sidebarOpen); if (backdrop) { backdrop.classList.toggle("show", sidebarOpen); backdrop.classList.toggle("visible", sidebarOpen); } }; }
  const backdrop = document.getElementById("sidebar-backdrop");
  if (backdrop) { backdrop.onclick = () => { sidebarOpen = false; const sidebar = document.getElementById("sidebar"); if (sidebar) sidebar.classList.remove("open"); backdrop.classList.remove("show"); backdrop.classList.remove("visible"); }; }
  const collapseBtn = document.getElementById("sidebar-collapse-btn");
  if (collapseBtn) { collapseBtn.onclick = () => { sidebarCollapsed = !sidebarCollapsed; localStorage.setItem("sidebar-collapsed", String(sidebarCollapsed)); const shell = document.getElementById("app-shell"); if (shell) shell.classList.toggle("sidebar-collapsed", sidebarCollapsed); collapseBtn.innerHTML = sidebarCollapsed ? icons.expand : icons.collapse; collapseBtn.title = sidebarCollapsed ? "Expand" : "Collapse"; collapseBtn.setAttribute("aria-label", sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"); }; }
  const themeToggle = document.getElementById("theme-toggle");
  if (themeToggle) { themeToggle.onclick = () => { const isDark = document.documentElement.classList.contains("dark"); if (isDark) { document.documentElement.classList.remove("dark"); localStorage.setItem("theme", "light"); } else { document.documentElement.classList.add("dark"); localStorage.setItem("theme", "dark"); } const icon = themeToggle.querySelector(".sidebar-footer-icon"); const label = themeToggle.querySelector(".sidebar-footer-label"); if (icon) icon.textContent = isDark ? "🌙" : "☀️"; if (label) label.textContent = isDark ? "Dark mode" : "Light mode"; themeToggle.title = isDark ? "Switch to dark mode" : "Switch to light mode"; }; }
  const logoutBtn = document.getElementById("logout-btn");
  if (logoutBtn) { logoutBtn.onclick = () => { localStorage.removeItem("merchant_token"); authToken = ""; location.reload(); }; }
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && sidebarOpen) { sidebarOpen = false; const sidebar = document.getElementById("sidebar"); const backdrop = document.getElementById("sidebar-backdrop"); if (sidebar) sidebar.classList.remove("open"); if (backdrop) { backdrop.classList.remove("show"); backdrop.classList.remove("visible"); } } });
}

// ── Content render functions ──
function renderDashboardContent() {
  const s = dashboardStats;
  const area = document.getElementById("content-area");
  if (!area) return;
  area.innerHTML = `
    <div class="page-header"><div><h1 class="page-title">Dashboard</h1><p class="page-description">Overview of your commerce activity</p></div><button class="btn btn-primary btn-sm" data-page="chat">${icons.chat} New conversation</button></div>
    <div class="kpi-grid">
      <div class="kpi-card"><div class="kpi-label">Total Orders</div><div class="kpi-value">${s.orders || 0}</div><div class="kpi-sub">${s.capturedOrders || 0} captured</div></div>
      <div class="kpi-card"><div class="kpi-label">Invoices</div><div class="kpi-value">${s.invoices || 0}</div><div class="kpi-sub">Sent via PayPal</div></div>
      <div class="kpi-card"><div class="kpi-label">Revenue (captured)</div><div class="kpi-value">$${s.totalRevenue || "0.00"}</div><div class="kpi-sub">From captured orders</div></div>
      <div class="kpi-card"><div class="kpi-label">Pending Approvals</div><div class="kpi-value">${s.pendingApprovals || 0}</div><div class="kpi-sub">Awaiting action</div></div>
    </div>
    <div class="card mb-6"><div class="card-header"><div><div class="card-title">Knowledge Base Articles</div><div class="card-description">${s.knowledge || 0} articles stored</div></div><button class="btn btn-secondary btn-sm" data-page="knowledge">Manage</button></div></div>
    <div class="card"><div class="card-header"><div><div class="card-title">PayPal Integration</div><div class="card-description">Sandbox mode</div></div></div>
      <p class="text-sm text-muted">${paypalConfigured ? '<span class="badge badge-success"><span class="badge-dot"></span>Connected</span> PayPal Sandbox credentials are configured.' : '<span class="badge badge-warning"><span class="badge-dot"></span>Not configured</span> Set <code class="font-mono">PAYPAL_CLIENT_ID</code> and <code class="font-mono">PAYPAL_CLIENT_SECRET</code> as Cloudflare secrets.'}</p>
    </div>
  `;
  attachContentEventListeners();
}

function renderChatContent() {
  const area = document.getElementById("content-area");
  if (!area) return;
  area.innerHTML = `
    <div class="chat-container">
      <div class="chat-messages" id="chat-messages">
        ${chatHistory.length === 0 ? `<div class="empty-state"><div class="empty-state-icon">${icons.chat}</div><h3>Start a conversation</h3><p>Ask me to create an order, generate an invoice, or answer commerce questions. Financial actions require your approval.</p></div>` : ""}
        ${chatHistory.map((m) => `<div class="chat-msg ${m.role}"><div class="chat-avatar ${m.role === "user" ? "user" : "ai"}">${m.role === "user" ? "U" : "H"}</div><div class="chat-bubble">${escapeHtml(m.content)}</div></div>`).join("")}
      </div>
      <div class="chat-input-area">
        <input type="text" class="chat-input" id="chat-input" placeholder="Ask HelpPuff to create an order, send an invoice..." ${chatLoading ? "disabled" : ""} />
        <button class="btn btn-primary" id="chat-send" ${chatLoading ? "disabled" : ""}>${chatLoading ? '<div class="spinner"></div>' : icons.send} Send</button>
      </div>
    </div>
  `;
  attachContentEventListeners();
  scrollChatToBottom();
}

function scrollChatToBottom() { const el = document.getElementById("chat-messages"); if (el) el.scrollTop = el.scrollHeight; }

async function sendChatMessage() {
  const input = document.getElementById("chat-input");
  const msg = input.value.trim();
  if (!msg || chatLoading) return;
  chatHistory.push({ role: "user", content: msg, created_at: Date.now() });
  input.value = "";
  chatLoading = true;
  renderChatContent();
  try {
    const res = await api("/chat", { method: "POST", body: JSON.stringify({ message: msg }) });
    chatHistory.push({ role: "assistant", content: res.response, created_at: Date.now() });
    if (res.pendingApprovals && res.pendingApprovals.length > 0) {
      showToast(`${res.pendingApprovals.length} pending approval(s) need your review`, "info");
      loadApprovals();
    }
  } catch (e) {
    chatHistory.push({ role: "assistant", content: `Error: ${e.message}`, created_at: Date.now() });
    showToast(e.message, "error");
  } finally {
    chatLoading = false;
    renderChatContent();
  }
}

function renderOrdersContent() {
  const area = document.getElementById("content-area");
  if (!area) return;
  area.innerHTML = `
    <div class="page-header"><div><h1 class="page-title">Orders</h1><p class="page-description">PayPal Sandbox orders created through the AI assistant</p></div><button class="btn btn-secondary btn-sm" id="refresh-orders">${icons.refresh} Refresh</button></div>
    ${orders.length === 0 ? `<div class="empty-state"><div class="empty-state-icon">${icons.empty}</div><h3>No orders yet</h3><p>Orders appear here after you create them via the AI assistant and approve the action.</p><button class="btn btn-primary btn-sm mt-4" data-page="chat">Start a conversation</button></div>` : `
      <div class="table-wrap"><table><thead><tr><th>ID</th><th>PayPal Order ID</th><th>Description</th><th class="numeric-cell">Amount</th><th>Customer</th><th>Status</th><th>Created</th><th></th></tr></thead><tbody>
        ${orders.map((o) => `<tr><td class="mono">${o.id}</td><td class="mono">${escapeHtml(o.paypal_order_id)}</td><td>${escapeHtml(o.description)}</td><td class="numeric-cell">${o.currency} ${o.amount}</td><td>${escapeHtml(o.customer_email)}</td><td>${statusBadge(o.status)}</td><td class="text-muted text-xs">${formatTime(o.created_at)}</td><td><div class="flex gap-2">${o.approve_url ? `<a href="${o.approve_url}" target="_blank" class="btn btn-ghost btn-sm" title="Approve on PayPal">${icons.external}</a>` : ""}<button class="btn btn-ghost btn-sm" data-verify-order="${o.id}" title="Verify status">${icons.refresh}</button>${o.status === "APPROVED" && !o.captured ? `<button class="btn btn-primary btn-sm" data-capture-order="${o.paypal_order_id}" title="Capture payment">Capture</button>` : ""}</div></td></tr>`).join("")}
      </tbody></table></div>
    `}
  `;
  attachContentEventListeners();
}

function renderInvoicesContent() {
  const area = document.getElementById("content-area");
  if (!area) return;
  area.innerHTML = `
    <div class="page-header"><div><h1 class="page-title">Invoices</h1><p class="page-description">PayPal Sandbox invoices generated through the AI assistant</p></div><button class="btn btn-secondary btn-sm" id="refresh-invoices">${icons.refresh} Refresh</button></div>
    ${invoices.length === 0 ? `<div class="empty-state"><div class="empty-state-icon">${icons.empty}</div><h3>No invoices yet</h3><p>Invoices appear here after you generate them via the AI assistant and approve the action.</p><button class="btn btn-primary btn-sm mt-4" data-page="chat">Start a conversation</button></div>` : `
      <div class="table-wrap"><table><thead><tr><th>ID</th><th>Invoice #</th><th>PayPal ID</th><th>Recipient</th><th class="numeric-cell">Amount</th><th>Status</th><th>Created</th><th></th></tr></thead><tbody>
        ${invoices.map((inv) => `<tr><td class="mono">${inv.id}</td><td class="mono">${escapeHtml(inv.invoice_number)}</td><td class="mono">${escapeHtml(inv.paypal_invoice_id)}</td><td>${escapeHtml(inv.recipient_name)}<br><span class="text-muted text-xs">${escapeHtml(inv.recipient_email)}</span></td><td class="numeric-cell">${inv.currency} ${inv.amount}</td><td>${statusBadge(inv.status)}</td><td class="text-muted text-xs">${formatTime(inv.created_at)}</td><td><button class="btn btn-ghost btn-sm" data-verify-invoice="${inv.id}" title="Verify status">${icons.refresh}</button></td></tr>`).join("")}
      </tbody></table></div>
    `}
  `;
  attachContentEventListeners();
}

function renderApprovalsContent() {
  const area = document.getElementById("content-area");
  if (!area) return;
  const pending = approvals.filter((a) => a.status === "pending");
  const resolved = approvals.filter((a) => a.status !== "pending");
  area.innerHTML = `
    <div class="page-header"><div><h1 class="page-title">Approvals</h1><p class="page-description">Financial actions require explicit approval before execution</p></div></div>
    ${pending.length === 0 ? `<div class="empty-state"><div class="empty-state-icon">${icons.empty}</div><h3>No pending approvals</h3><p>When the AI assistant proposes a financial action, it will appear here for your review.</p></div>` : pending.map((a) => {
      let details = "";
      try { const p = JSON.parse(a.payload); details = Object.entries(p).map(([k, v]) => `<strong>${escapeHtml(k)}</strong>: ${escapeHtml(String(v))}`).join("<br>"); } catch { details = escapeHtml(a.payload); }
      return `<div class="approval-card"><div class="approval-card-header"><div><span class="badge badge-warning"><span class="badge-dot"></span>${escapeHtml(a.action_type)}</span><span class="text-sm text-muted ml-2">${formatTime(a.created_at)}</span></div></div><p class="text-sm font-medium mb-2">${escapeHtml(a.description)}</p><div class="text-xs text-muted">${details}</div><div class="approval-actions"><button class="btn btn-primary btn-sm" data-approve="${a.id}">${icons.check} Approve & Execute</button><button class="btn btn-secondary btn-sm" data-reject="${a.id}">${icons.x} Reject</button></div></div>`;
    }).join("")}
    ${resolved.length > 0 ? `<h2 class="page-title mt-4 mb-4" style="font-size:18px">History</h2><div class="table-wrap"><table><thead><tr><th>Action</th><th>Description</th><th>Status</th><th>Created</th><th>Resolved</th></tr></thead><tbody>${resolved.map((a) => `<tr><td><span class="badge badge-neutral">${escapeHtml(a.action_type)}</span></td><td>${escapeHtml(a.description)}</td><td>${statusBadge(a.status)}</td><td class="text-muted text-xs">${formatTime(a.created_at)}</td><td class="text-muted text-xs">${formatTime(a.resolved_at)}</td></tr>`).join("")}</tbody></table></div>` : ""}
  `;
  attachContentEventListeners();
}

function renderKnowledgeContent() {
  const area = document.getElementById("content-area");
  if (!area) return;
  area.innerHTML = `
    <div class="page-header"><div><h1 class="page-title">Knowledge Base</h1><p class="page-description">Store articles, FAQs, and documentation for the AI assistant</p></div><button class="btn btn-primary btn-sm" id="add-knowledge">${icons.plus} New Article</button></div>
    ${knowledge.length === 0 ? `<div class="empty-state"><div class="empty-state-icon">${icons.empty}</div><h3>No articles yet</h3><p>Add knowledge base articles to help the AI assistant provide better answers.</p></div>` : `<div class="flex gap-3" style="flex-wrap:wrap">${knowledge.map((k) => `<div class="card" style="flex:1;min-width:300px;max-width:400px"><div class="card-header"><div><div class="card-title">${escapeHtml(k.title)}</div>${k.tags ? `<div class="card-description">${escapeHtml(k.tags)}</div>` : ""}</div><button class="btn btn-ghost btn-sm" data-delete-knowledge="${k.id}">${icons.trash}</button></div><p class="text-sm text-muted">${escapeHtml(k.body).substring(0, 200)}${k.body.length > 200 ? "…" : ""}</p><div class="text-xs text-muted mt-2">${formatTime(k.created_at)}</div></div>`).join("")}</div>`}
  `;
  attachContentEventListeners();
}

function renderAuditContent() {
  const area = document.getElementById("content-area");
  if (!area) return;
  area.innerHTML = `
    <div class="page-header"><div><h1 class="page-title">Audit Logs</h1><p class="page-description">Security and action audit trail</p></div><button class="btn btn-secondary btn-sm" id="refresh-audit">${icons.refresh} Refresh</button></div>
    ${auditLogs.length === 0 ? `<div class="empty-state"><div class="empty-state-icon">${icons.empty}</div><h3>No audit logs</h3><p>Actions will be logged here.</p></div>` : `<div class="table-wrap"><table><thead><tr><th>Action</th><th>Details</th><th>IP</th><th>Time</th></tr></thead><tbody>${auditLogs.map((l) => `<tr><td><span class="badge badge-neutral">${escapeHtml(l.action)}</span></td><td class="text-sm">${escapeHtml(l.details)}</td><td class="mono text-xs">${escapeHtml(l.ip)}</td><td class="text-muted text-xs">${formatTime(l.created_at)}</td></tr>`).join("")}</tbody></table></div>`}
  `;
  attachContentEventListeners();
}

function renderSettingsContent() {
  const area = document.getElementById("content-area");
  if (!area) return;
  area.innerHTML = `
    <div class="page-header"><div><h1 class="page-title">Settings</h1><p class="page-description">Configure PayPal integration and preferences</p></div></div>
    <div class="card mb-6"><div class="card-header"><div><div class="card-title">PayPal Sandbox</div><div class="card-description">Connection status and configuration</div></div></div>
      <div class="mb-4">${paypalConfigured ? '<span class="badge badge-success"><span class="badge-dot"></span>Connected</span> <span class="text-sm text-muted">PayPal Sandbox credentials are configured.</span>' : '<span class="badge badge-warning"><span class="badge-dot"></span>Not configured</span> <span class="text-sm text-muted">Set credentials as Cloudflare secrets.</span>'}</div>
      <div class="text-sm text-muted"><p class="mb-2"><strong>Setup instructions:</strong></p><ol style="padding-left:20px;line-height:1.8"><li>Get Sandbox credentials at <a href="https://developer.paypal.com/dashboard/applications/sandbox" target="_blank" style="color:var(--brand-fg)">PayPal Developer Dashboard</a></li><li>Set secrets via Wrangler CLI:</li></ol><pre class="font-mono text-xs" style="background:var(--bg-canvas);padding:12px;border-radius:6px;margin-top:8px;overflow-x:auto">wrangler secret put PAYPAL_CLIENT_ID\nwrangler secret put PAYPAL_CLIENT_SECRET\nwrangler secret put PAYPAL_WEBHOOK_ID\nwrangler secret put MERCHANT_TOKEN</pre></div>
    </div>
    <div class="card"><div class="card-header"><div><div class="card-title">AI Model</div><div class="card-description">Powered by Cloudflare Workers AI</div></div></div><p class="text-sm text-muted">Model: <code class="font-mono">@cf/meta/llama-3.3-70b-instruct-fp8-fast</code><br>All AI inference runs on Cloudflare's edge network within configured usage limits.</p></div>
    <div class="card mt-4"><div class="card-header"><div><div class="card-title">Embeddable Chat Widget</div><div class="card-description">Customer-facing assistant for your website</div></div></div><p class="text-sm text-muted">Add this script to any page to embed the HelpPuff visitor chat widget:</p><pre class="font-mono text-xs" style="background:var(--bg-canvas);padding:12px;border-radius:6px;margin-top:8px;overflow-x:auto">&lt;script src="/widget.js"&gt;&lt;/script&gt;</pre></div>
  `;
  attachContentEventListeners();
}

// ── Knowledge Modal ──
function showKnowledgeModal() {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `<div class="modal"><div class="modal-header"><div class="modal-title">New Knowledge Article</div><button class="modal-close" id="modal-close">${icons.close}</button></div><div class="modal-body"><div class="form-group"><label class="form-label">Title</label><input type="text" class="form-input" id="kb-title" placeholder="Article title" /></div><div class="form-group"><label class="form-label">Body</label><textarea class="form-textarea" id="kb-body" placeholder="Article content..."></textarea></div><div class="form-group"><label class="form-label">Tags (comma-separated)</label><input type="text" class="form-input" id="kb-tags" placeholder="faq, shipping, returns" /></div></div><div class="modal-footer"><button class="btn btn-secondary btn-sm" id="modal-cancel">Cancel</button><button class="btn btn-primary btn-sm" id="modal-save">Save Article</button></div></div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  document.getElementById("modal-close").onclick = close;
  document.getElementById("modal-cancel").onclick = close;
  document.getElementById("modal-save").onclick = async () => {
    const title = document.getElementById("kb-title").value.trim();
    const body = document.getElementById("kb-body").value.trim();
    const tags = document.getElementById("kb-tags").value.trim();
    if (!title || !body) { showToast("Title and body are required", "error"); return; }
    try { await api("/knowledge", { method: "POST", body: JSON.stringify({ title, body, tags }) }); showToast("Article saved", "success"); close(); loadKnowledge(); }
    catch (e) { showToast(e.message, "error"); }
  };
}

// ── Content event listeners ──
function attachContentEventListeners() {
  document.querySelectorAll("[data-page]").forEach((el) => { el.onclick = (e) => { e.preventDefault(); navigate(el.dataset.page); }; });
  const chatInput = document.getElementById("chat-input");
  if (chatInput) { chatInput.onkeydown = (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendChatMessage(); } }; }
  const chatSend = document.getElementById("chat-send");
  if (chatSend) { chatSend.onclick = sendChatMessage; }
  const refreshOrders = document.getElementById("refresh-orders");
  if (refreshOrders) refreshOrders.onclick = () => loadOrders();
  const refreshInvoices = document.getElementById("refresh-invoices");
  if (refreshInvoices) refreshInvoices.onclick = () => loadInvoices();
  const refreshAudit = document.getElementById("refresh-audit");
  if (refreshAudit) refreshAudit.onclick = () => loadAuditLogs();
  const addKnowledge = document.getElementById("add-knowledge");
  if (addKnowledge) addKnowledge.onclick = showKnowledgeModal;
  document.querySelectorAll("[data-delete-knowledge]").forEach((el) => { el.onclick = async () => { try { await api(`/knowledge/${el.dataset.deleteKnowledge}`, { method: "DELETE" }); showToast("Article deleted", "success"); loadKnowledge(); } catch (e) { showToast(e.message, "error"); } }; });
  document.querySelectorAll("[data-approve]").forEach((el) => { el.onclick = async () => { el.disabled = true; el.innerHTML = '<div class="spinner"></div> Executing...'; try { const result = await api(`/approvals/${el.dataset.approve}/approve`, { method: "POST" }); showToast("Action executed successfully", "success"); if (result.result?.approveUrl) { showToast(`Order created. Buyer must approve at PayPal: ${result.result.approveUrl}`, "info"); } loadApprovals(); } catch (e) { showToast(e.message, "error"); loadApprovals(); } }; });
  document.querySelectorAll("[data-reject]").forEach((el) => { el.onclick = async () => { try { await api(`/approvals/${el.dataset.reject}/reject`, { method: "POST" }); showToast("Action rejected", "info"); loadApprovals(); } catch (e) { showToast(e.message, "error"); } }; });
  document.querySelectorAll("[data-verify-order]").forEach((el) => { el.onclick = async () => { try { const res = await api(`/orders/${el.dataset.verifyOrder}/verify`); showToast(`Order status: ${res.status}`, "info"); loadOrders(); } catch (e) { showToast(e.message, "error"); } }; });
  document.querySelectorAll("[data-verify-invoice]").forEach((el) => { el.onclick = async () => { try { const res = await api(`/invoices/${el.dataset.verifyInvoice}/verify`); showToast(`Invoice status: ${res.status}`, "info"); loadInvoices(); } catch (e) { showToast(e.message, "error"); } }; });
  document.querySelectorAll("[data-capture-order]").forEach((el) => { el.onclick = async () => { try {      const res = await fetch(withToken(`${API_BASE}/approvals`), { method: "POST", headers: { "Content-Type": "application/json", ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}) }, body: JSON.stringify({ action_type: "capture_order", description: `Capture order ${el.dataset.captureOrder}`, payload: JSON.stringify({ paypalOrderId: el.dataset.captureOrder }) }) }); const data = await res.json(); if (data.id) { showToast("Capture approval created. Review in Approvals.", "info"); loadApprovals(); } } catch (e) { showToast(e.message, "error"); } }; });
}

// ── Init ──
checkAuth();
