/* =========================================================
   SALES ASSIST — Frontend terhubung ke Sales Assist API
   (Node.js/Express + SQLite di sales-assist-backend)
   ========================================================= */

window.onerror = function (msg, url, lineNo, columnNo, error) {
  fetch("/api/log-error", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ msg, url, lineNo, columnNo, stack: error ? error.stack : "" })
  }).catch(() => {});
  return false;
};

const API_BASE = window.location.origin + "/api";
const fmtRp = (n) => "Rp " + Math.round(n || 0).toLocaleString("id-ID");
// Format persentase apa adanya (nilai riil), tanpa dibulatkan ke bilangan bulat.
// Dibulatkan halus ke 2 desimal saja untuk menghindari angka mengambang (mis. 12.3400000001).
const fmtPct = (n) => {
  const v = Math.round((n || 0) * 100) / 100;
  return (Number.isInteger(v) ? v.toString() : v.toFixed(2)) + "%";
};
const formatCompactRp = (val) => {
  if (val >= 1e9) return "Rp " + (val / 1e9).toFixed(1).replace(/\.0$/, "") + " M";
  if (val >= 1e6) return "Rp " + (val / 1e6).toFixed(1).replace(/\.0$/, "") + " Jt";
  if (val >= 1e3) return "Rp " + (val / 1e3).toFixed(1).replace(/\.0$/, "") + " Rb";
  return "Rp " + val;
};

const getBinConfig = (maxVal) => {
  if (maxVal <= 50e6) return { size: 10e6 };
  if (maxVal <= 100e6) return { size: 20e6 };
  if (maxVal <= 250e6) return { size: 50e6 };
  if (maxVal <= 500e6) return { size: 100e6 };
  if (maxVal <= 1e9) return { size: 200e6 };
  if (maxVal <= 2.5e9) return { size: 500e6 };
  const step = Math.ceil(maxVal / 6 / 1e8) * 1e8;
  return { size: step };
};

const formatRangeLabel = (start, end) => {
  const formatNum = (val) => {
    if (val === 0) return "0";
    if (val >= 1e9) return (val / 1e9).toFixed(0) + " M";
    if (val >= 1e6) return (val / 1e6).toFixed(0) + " Jt";
    if (val >= 1e3) return (val / 1e3).toFixed(0) + " Rb";
    return val.toString();
  };
  return `Rp ${formatNum(start)}–${formatNum(end)}`;
};


const state = {
  token: localStorage.getItem("sa_token") || null,
  user: JSON.parse(localStorage.getItem("sa_user") || "null"),
  sessionId: null,
  session: null,
  items: [],
  totals: null,
  keywords: [],
  notes: [],
  step: 1,
  maxUnlocked: 1,
  view: "dashboard",
  masterTab: "wifi",
  masterQuery: "",
  historySearch: "",
  historySort: "latest",
  historySortBy: "updated_at",
  historySortDir: "desc",
  historyPage: 1,
  historyLimit: 10,
  bookmarkSearch: "",
  bookmarkSort: "latest",
  bookmarkSortBy: "updated_at",
  bookmarkSortDir: "desc",
  bookmarkPage: 1,
  bookmarkLimit: 10,
  selectedWitel: "semua",
};

/* ---------------- API HELPER ---------------- */
async function api(path, options = {}) {
  const headers = Object.assign(
    { "Content-Type": "application/json" },
    state.token ? { Authorization: "Bearer " + state.token } : {},
    options.headers || {}
  );
  const res = await fetch(API_BASE + path, { ...options, headers });
  if (res.status === 401) {
    doLogout();
    throw new Error("Sesi login berakhir. Silakan masuk kembali.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Gagal memanggil ${path}`);
  return data;
}

/* ---------------- API STATUS INDICATOR ---------------- */
async function checkApiStatus() {
  const el = document.getElementById("apiStatus");
  const txt = document.getElementById("apiStatusText");
  try {
    const r = await fetch(window.location.origin + "/api/health");
    if (!r.ok) throw new Error();
    el.className = "api-status online";
    txt.textContent = "Sistem terhubung";
  } catch (e) {
    el.className = "api-status offline";
    txt.textContent = "Tidak dapat terhubung ke sistem. Periksa koneksi jaringan Anda.";
  }
}

/* ---------------- LOGIN ---------------- */
function showLogin(message) {
  document.getElementById("loginScreen").style.display = "flex";
  document.getElementById("appRoot").style.display = "none";
  const err = document.getElementById("loginError");
  if (message) { err.textContent = message; err.classList.add("show"); }
  else { err.classList.remove("show"); err.textContent = ""; }
}

function showApp() {
  document.getElementById("loginScreen").style.display = "none";
  document.getElementById("appRoot").style.display = "flex";
  document.getElementById("userName").textContent = state.user.name;
  document.getElementById("userRole").textContent = ({ admin: "Admin Master Data", manager: "Manajer", sales: "Sales Telkom" })[state.user.role] || "Sales Telkom";
  if (window.SA_NAV) window.SA_NAV.build();
  document.getElementById("userAvatar").textContent = state.user.name.split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase();
  render();
}

/* ---------------- TOAST ---------------- */
function showToast(message, type = "success", timeout = 3000) {
  const el = document.getElementById("toast");
  if (!el) {
    alert(message);
    return;
  }
  el.textContent = message;
  el.className = `toast ${type === 'error' ? 'error' : type === 'info' ? 'info' : ''}`.trim();
  el.style.display = "block";
  // trigger animation
  requestAnimationFrame(() => el.classList.add("show"));
  clearTimeout(el._hideTimeout);
  el._hideTimeout = setTimeout(() => {
    el.classList.remove("show");
    setTimeout(() => { el.style.display = "none"; }, 220);
  }, timeout);
}

function doLogout() {
  localStorage.removeItem("sa_token");
  localStorage.removeItem("sa_user");
  state.token = null;
  state.user = null;
  resetSessionState();
  state.view = "dashboard";
  showLogin();
  toggleAuthForm("login");
}

async function doRegister() {
  const name = document.getElementById("regName").value.trim();
  const witel = document.getElementById("regWitel").value.trim();
  const username = document.getElementById("regUsername").value.trim();
  const password = document.getElementById("regPassword").value;
  const btn = document.getElementById("btnRegister");
  btn.disabled = true;
  btn.textContent = "Membuat akun…";
  try {
    const data = await api("/auth/register", {
      method: "POST",
      body: JSON.stringify({ name, witel, username, password })
    });
    state.token = data.token;
    state.user = data.user;
    localStorage.setItem("sa_token", data.token);
    localStorage.setItem("sa_user", JSON.stringify(data.user));
    showToast(`Akun berhasil dibuat. Selamat datang, ${data.user.name}!`, "success");
    showApp();
  } catch (err) {
    showLogin(err.message);
    toggleAuthForm("register");
  } finally {
    btn.disabled = false;
    btn.textContent = "Buat Akun";
  }
}

function toggleAuthForm(which) {
  const isRegister = which === "register";
  document.getElementById("loginFormFields").style.display = isRegister ? "none" : "block";
  const regEl = document.getElementById("registerFormFields");
  if (regEl) regEl.style.display = isRegister ? "block" : "none";
  document.getElementById("authTitle").textContent = isRegister
    ? "Buat akun sales baru"
    : "Masuk ke akun sales";
  document.getElementById("authSub").textContent = isRegister
    ? "Daftar akun baru untuk mulai membuat RAB."
    : "Silakan masuk menggunakan akun Telkom Anda.";
  const err = document.getElementById("loginError");
  err.classList.remove("show"); err.textContent = "";
}

/* OTP login removed — project does not use email OTP flow */

/* ---------------- LOGIN VIA GOOGLE ---------------- */
async function initGoogleSignIn() {
  const loginSlot = document.getElementById("googleSignInBtn");
  const registerSlot = document.getElementById("googleSignInBtnRegister");
  if (!loginSlot && !registerSlot) return;
  const fallbackMessage = "Login Google belum dikonfigurasi. Tambahkan GOOGLE_CLIENT_ID di file .env server.";
  const fallbackButtons = document.querySelectorAll(".google-fallback-btn");
  fallbackButtons.forEach((button) => button.addEventListener("click", () => showLogin(fallbackMessage)));
  try {
    const cfg = await fetch(window.location.origin + "/api/auth/google/config").then(r => r.json());
    if (!cfg.enabled || !cfg.clientId) {
      return;
    }
    fallbackButtons.forEach((button) => { button.style.display = "none"; });
    const start = () => {
      if (!window.google || !window.google.accounts || !window.google.accounts.id) {
        setTimeout(start, 300);
        return;
      }
      window.google.accounts.id.initialize({
        client_id: cfg.clientId,
        callback: handleGoogleCredential
      });
      if (loginSlot) {
        window.google.accounts.id.renderButton(loginSlot, {
          type: "standard", theme: "outline", size: "large", width: 320, text: "continue_with"
        });
      }
      if (registerSlot) {
        window.google.accounts.id.renderButton(registerSlot, {
          type: "standard", theme: "outline", size: "large", width: 320, text: "signup_with"
        });
      }
    };
    start();
  } catch (e) {
    if (loginSlot) loginSlot.style.display = "none";
    if (registerSlot) registerSlot.style.display = "none";
  }
}

async function handleGoogleCredential(response) {
  try {
    const data = await api("/auth/google", { method: "POST", body: JSON.stringify({ credential: response.credential }) });
    state.token = data.token;
    state.user = data.user;
    localStorage.setItem("sa_token", data.token);
    localStorage.setItem("sa_user", JSON.stringify(data.user));
    showApp();
  } catch (err) {
    showLogin(err.message || "Login Google gagal.");
  }
}

async function doLogin() {
  const username = document.getElementById("loginUsername").value.trim();
  const password = document.getElementById("loginPassword").value;
  const btn = document.getElementById("btnLogin");
  btn.disabled = true;
  btn.textContent = "Memeriksa…";
  try {
    const data = await api("/auth/login", { method: "POST", body: JSON.stringify({ username, password }) });
    state.token = data.token;
    state.user = data.user;
    localStorage.setItem("sa_token", data.token);
    localStorage.setItem("sa_user", JSON.stringify(data.user));
    showApp();
  } catch (err) {
    showLogin(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Masuk";
  }
}

/* ---------------- JAM WIB REAL-TIME ---------------- */
// SQLite datetime('now') menyimpan waktu UTC dengan format "YYYY-MM-DD HH:MM:SS"
// (tanpa 'T'/'Z'). Kalau langsung di-parse pakai `new Date(...)`, browser bisa salah
// mengira itu waktu lokal, sehingga jam yang tampil meleset dari WIB asli. Fungsi ini
// memastikan string tsb selalu dibaca sebagai UTC, lalu diformat ke Asia/Jakarta.
function parseSqliteUtc(sqliteDatetime) {
  if (!sqliteDatetime) return null;
  const iso = sqliteDatetime.includes("T") ? sqliteDatetime : sqliteDatetime.replace(" ", "T") + "Z";
  return new Date(iso);
}
function fmtWib(sqliteDatetime, opts) {
  const d = parseSqliteUtc(sqliteDatetime);
  if (!d || isNaN(d.getTime())) return "-";
  return d.toLocaleString("id-ID", { timeZone: "Asia/Jakarta", ...opts });
}

function updateWibClock() {
  const el = document.getElementById("wibClock");
  if (!el) return;
  const now = new Date();
  const time = now.toLocaleTimeString("id-ID", { timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
  el.textContent = `${time} WIB`;
}

document.addEventListener("DOMContentLoaded", () => {
  checkApiStatus();
  document.getElementById("btnLogin").addEventListener("click", doLogin);
  document.getElementById("loginPassword").addEventListener("keydown", (e) => { if (e.key === "Enter") doLogin(); });
  document.getElementById("btnRegister").addEventListener("click", doRegister);
  document.getElementById("regPassword").addEventListener("keydown", (e) => { if (e.key === "Enter") doRegister(); });
  document.getElementById("btnShowRegister").addEventListener("click", (e) => { e.preventDefault(); toggleAuthForm("register"); });
  document.getElementById("btnShowLogin").addEventListener("click", (e) => { e.preventDefault(); toggleAuthForm("login"); });
  document.getElementById("btnLogout").addEventListener("click", doLogout);
  document.getElementById("btnMasterData").addEventListener("click", () => {
    if (state.maxUnlocked < 3) {
      showToast("Selesaikan analisis AI terlebih dahulu untuk membuka master data produk.", "info", 2200);
      return;
    }
    state.view = "wizard";
    state.step = 3;
    render();
  });
  document.getElementById("btnHistory").addEventListener("click", () => {
    state.view = "history";
    render();
  });
  document.getElementById("btnBookmark").addEventListener("click", () => {
    state.view = "archives";
    render();
  });
  document.getElementById("btnDashboard").addEventListener("click", () => {
    state.view = "dashboard";
    render();
  });

  // OTP flow removed; no event listeners to attach here

  initGoogleSignIn();

  showLogin();
  updateWibClock();
  setInterval(updateWibClock, 1000);

  const btnHelp = document.getElementById("btnHelp");
  if (btnHelp) {
    btnHelp.addEventListener("click", startTour);
  }
});

function resetSessionState() {
  state.sessionId = null;
  state.session = null;
  state.items = [];
  state.totals = null;
  state.keywords = [];
  state.notes = [];
  state.step = 1;
  state.maxUnlocked = 1;
}

/* ---------------- STEP NAV / SIDEBAR ---------------- */
const STEP_LABELS = {
  1: "Input kebutuhan pelanggan", 2: "Analisis AI", 3: "Master data produk",
  4: "Tabel rekomendasi", 5: "Review & edit rekomendasi", 6: "Memproses RAB", 7: "Output RAB"
};
const STATUS_BY_STEP = {
  1: { text: "Menunggu input", cls: "" },
  2: { text: "Sedang diproses", cls: "processing" },
  3: { text: "Master data dimuat", cls: "processing" },
  4: { text: "Menyusun rekomendasi", cls: "processing" },
  5: { text: "Rekomendasi siap", cls: "ready" },
  6: { text: "Sedang diproses otomatis", cls: "processing" },
  7: { text: "RAB selesai dibuat", cls: "ready" }
};
function labelFor(i) {
  return { 1: "Input kebutuhan", 2: "Analisis AI", 3: "Master data produk", 4: "Tabel rekomendasi", 5: "Review & edit", 6: "Proses RAB", 7: "Output RAB" }[i];
}

function goToStep(n) { if (n > state.maxUnlocked) return; state.view = "wizard"; state.step = n; render(); }
function unlockAndGo(n) { state.maxUnlocked = Math.max(state.maxUnlocked, n); state.view = "wizard"; state.step = n; render(); }

// Step "Analisis AI" (2), "Tabel rekomendasi" (4), dan "Proses RAB" (6)
// adalah tahapan transisi/otomatis — tidak boleh dinavigasi langsung dengan klik.
const NON_CLICKABLE_STEPS = [2, 4, 6];

function renderSidebar() {
  const nav = document.getElementById("stepsNav");
  nav.innerHTML = "";
  const stepOrder = [1, 2, 4, 5, 6, 7];
  stepOrder.forEach((i) => {
    const div = document.createElement("div");
    div.className = "step";
    if (state.view === "wizard" && i === state.step) div.classList.add("active");
    if (i < state.step || i < state.maxUnlocked) div.classList.add("done");
    if (i > state.maxUnlocked) div.classList.add("locked");
    const isNonClickable = NON_CLICKABLE_STEPS.includes(i);
    if (isNonClickable) div.classList.add("no-click");
    div.innerHTML = `<span class="step-dot"></span><span class="step-label">${labelFor(i)}</span>`;
    if (!isNonClickable) {
      div.addEventListener("click", () => { if (i <= state.maxUnlocked) goToStep(i); });
    }
    nav.appendChild(div);
  });

  const btnMasterData = document.getElementById("btnMasterData");
  const btnHistory = document.getElementById("btnHistory");
  const btnBookmark = document.getElementById("btnBookmark");
  const btnDashboard = document.getElementById("btnDashboard");
  btnMasterData.classList.toggle("active", state.view === "wizard" && state.step === 3);
  btnHistory.classList.toggle("active", state.view === "history");
  btnBookmark.classList.toggle("active", state.view === "archives");
  btnDashboard.classList.toggle("active", state.view === "dashboard");

  if (window.SA_NAV) window.SA_NAV.sync();
  if (window.SA_VIEWS && window.SA_VIEWS[state.view]) {
    document.getElementById("crumbCurrent").textContent = (window.SA_TITLES || {})[state.view] || state.view;
    const badge = document.getElementById("statusBadge");
    badge.textContent = "Sales Assist 2.0";
    badge.className = "badge";
    return;
  }
  if (state.view === "dashboard") {
    document.getElementById("crumbCurrent").textContent = "Dashboard";
    const badge = document.getElementById("statusBadge");
    badge.textContent = "Beranda";
    badge.className = "badge";
    return;
  }
  if (state.view === "history") {
    document.getElementById("crumbCurrent").textContent = "Riwayat RAB";
    const badge = document.getElementById("statusBadge");
    badge.textContent = "Daftar riwayat";
    badge.className = "badge";
    return;
  }
  if (state.view === "archives") {
    document.getElementById("crumbCurrent").textContent = "Bookmark";
    const badge = document.getElementById("statusBadge");
    badge.textContent = "Daftar bookmark";
    badge.className = "badge";
    return;
  }

  document.getElementById("crumbCurrent").textContent = STEP_LABELS[state.step];
  const badge = document.getElementById("statusBadge");
  const st = STATUS_BY_STEP[state.step];
  badge.textContent = st.text;
  badge.className = "badge" + (st.cls ? " " + st.cls : "");
}

function render() {
  renderSidebar();
  const root = document.getElementById("panelRoot");
  root.innerHTML = "";
  const screen = document.createElement("div");
  screen.className = "screen";
  if (state.view === "dashboard") {
    screen.appendChild(renderDashboardView());
  } else if (state.view === "history") {
    screen.appendChild(renderHistoryView());
  } else if (state.view === "archives") {
    screen.appendChild(renderArchivesView());
  } else if (window.SA_VIEWS && window.SA_VIEWS[state.view]) {
    screen.appendChild(window.SA_VIEWS[state.view]());
  } else {
    const renderers = { 1: renderStep1, 2: renderStep2, 3: renderStep3, 4: renderStep4, 5: renderStep5, 6: renderStep6, 7: renderStep7 };
    screen.appendChild(renderers[state.step]());
  }
  root.appendChild(screen);
}

/* =========================================================
   DASHBOARD — beranda ringkasan & analytics
   ========================================================= */
function renderDashboardView() {
  const wrap = document.createElement("div");
  let summaryData = null;
  let selectedCategory = null;

  wrap.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; gap:16px; margin-bottom:20px; flex-wrap:wrap;">
      <div>
        <h1 style="margin:0; font-size:20px;">Selamat Datang, ${escapeAttr(state.user ? state.user.name : "Sales Engineer Telkom")}</h1>
        <p class="desc" style="margin:4px 0 0 0; font-size:12.5px; color:var(--ink-soft); max-width:700px; line-height:1.4;">Gunakan asisten kecerdasan buatan untuk merancang, mencocokkan, dan mencetak dokumen Rencana Anggaran Biaya (RAB) Anda.</p>
      </div>
      <div style="display:flex; gap:8px;">
        <button class="btn btn-primary" id="cardNewRab">+ Buat RAB Baru</button>
        <button class="btn btn-secondary" id="cardBookmarks">Bookmark</button>
      </div>
    </div>

    <div class="dash-stats">
      <div class="stat-card">
        <div class="stat-icon">DOC</div>
        <div><div class="stat-label">Total RAB Terbuat</div><div class="stat-value" id="statTotalDoc">–</div></div>
      </div>
      <div class="stat-card">
        <div class="stat-icon">RP</div>
        <div><div class="stat-label">Total Nilai Solusi</div><div class="stat-value" id="statTotalNilai">–</div></div>
      </div>
      <div class="stat-card">
        <div class="stat-icon">AVG</div>
        <div><div class="stat-label">Rata-rata Nilai RAB</div><div class="stat-value" id="statRataRata">–</div></div>
      </div>
      <div class="stat-card">
        <div class="stat-icon">BM</div>
        <div><div class="stat-label">Total Bookmark</div><div class="stat-value" id="statTotalBookmark">–</div></div>
      </div>
    </div>

    <div class="dash-row">
      <div class="dash-panel">
        <div class="dp-title" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
          <div class="dash-date-filter" style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
            <input type="date" id="dashStartDate" style="border:1px solid var(--line); border-radius:6px; padding:5px 8px; font-size:12px; font-family:inherit;">
            <span class="muted" style="font-size:12px;">s/d</span>
            <input type="date" id="dashEndDate" style="border:1px solid var(--line); border-radius:6px; padding:5px 8px; font-size:12px; font-family:inherit;">
            <button class="btn btn-ghost" id="btnClearDashDate" style="font-size:11px; padding:5px 10px;">Reset</button>
          </div>
        </div>
        <div style="display:flex; justify-content:flex-end; margin:0 0 8px 0;">
          <small class="muted" style="font-size:11px; font-weight:500;">Klik kategori untuk memfilter</small>
        </div>
        <div id="pieChartWrap" class="pie-wrap">
          <div class="muted" style="padding:20px; font-size:12.5px;">Memuat data…</div>
        </div>
      </div>

      <div class="dash-panel" style="flex:1.5;">
        <div id="barChartWrap">
          <div class="muted" style="padding:20px; font-size:12.5px;">Memuat data…</div>
        </div>
      </div>
    </div>

    <div class="dash-panel" style="margin-top:16px;">
      <p class="desc" style="padding:8px 14px 0 14px; margin:0; font-size:12px; color:var(--ink-soft);">Analisis volume penjualan dan breakdown sub-produk dari setiap kategori layanan utama.</p>
      <div id="svcBreakdownWrap">
        <div class="muted" style="padding:20px; font-size:12.5px;">Memuat data layanan…</div>
      </div>
    </div>
  `;

  if (window.SA_UI && window.SA_UI.enhanceDashboard) window.SA_UI.enhanceDashboard(wrap);

  wrap.querySelector("#cardNewRab").addEventListener("click", () => {
    resetSessionState();
    state.view = "wizard";
    state.step = 1;
    render();
  });
  wrap.querySelector("#cardBookmarks").addEventListener("click", () => {
    state.view = "archives";
    render();
  });

  function updateBarChartDisplay(cat) {
    selectedCategory = cat;
    const barWrap = wrap.querySelector("#barChartWrap");

    // Re-render pie legend to highlight active category
    renderPieChart(wrap.querySelector("#pieChartWrap"), summaryData.product_distribution || [], updateBarChartDisplay, selectedCategory);

    if (!cat) {
      renderHistogram(barWrap, summaryData.project_values || []);
      return;
    }

    const catItems = (summaryData.category_details && summaryData.category_details[cat]) || [];
    const sessionIds = [...new Set(catItems.map(item => item.session_id))];
    const filteredSessions = (summaryData.project_values || []).filter(s => sessionIds.includes(s.id));

    renderHistogram(barWrap, filteredSessions);
  }

  // Memuat ulang seluruh chart dashboard (pie, bar, donut) sekaligus — dipanggil saat pertama kali
  // dibuka maupun setiap kali filter rentang tanggal berubah, supaya semua chart konsisten terfilter.
  function loadDashboardData() {
    selectedCategory = null;
    wrap.querySelector("#pieChartWrap").innerHTML = `<div class="muted" style="padding:20px; font-size:12.5px;">Memuat data…</div>`;
    wrap.querySelector("#barChartWrap").innerHTML = `<div class="muted" style="padding:20px; font-size:12.5px;">Memuat data…</div>`;
    wrap.querySelector("#svcBreakdownWrap").innerHTML = `<div class="muted" style="padding:20px; font-size:12.5px;">Memuat data layanan…</div>`;

    const startVal = wrap.querySelector("#dashStartDate").value;
    const endVal = wrap.querySelector("#dashEndDate").value;
    const qs = new URLSearchParams();
    if (startVal) qs.append("start_date", startVal);
    if (endVal) qs.append("end_date", endVal);
    const url = "/sessions/dashboard/summary" + (qs.toString() ? `?${qs.toString()}` : "");

    api(url)
      .then((res) => {
        summaryData = res;
        document.getElementById("statTotalDoc").textContent = `${res.stats.total_dokumen} Dokumen`;
        document.getElementById("statTotalNilai").textContent = fmtRp(res.stats.total_nilai_solusi);
        document.getElementById("statRataRata").textContent = fmtRp(res.stats.rata_rata_nilai);
        const statBm = document.getElementById("statTotalBookmark");
        if (statBm) statBm.textContent = `${res.stats.total_bookmarks || 0} Saved`;

        renderPieChart(wrap.querySelector("#pieChartWrap"), res.product_distribution || [], updateBarChartDisplay, selectedCategory);
        renderHistogram(wrap.querySelector("#barChartWrap"), res.project_values || []);
        renderServiceBreakdown(wrap.querySelector("#svcBreakdownWrap"), res);
      })
      .catch((err) => {
        document.getElementById("statTotalDoc").textContent = "-";
        document.getElementById("statTotalNilai").textContent = "-";
        document.getElementById("statRataRata").textContent = "-";
        wrap.querySelector("#pieChartWrap").innerHTML = `<div class="muted" style="padding:26px 20px; font-size:13px;">Gagal memuat data.</div>`;
        wrap.querySelector("#barChartWrap").innerHTML = `<div class="muted" style="padding:26px 20px; font-size:13px;">Gagal memuat data.</div>`;
        wrap.querySelector("#svcBreakdownWrap").innerHTML = `<div class="muted" style="padding:20px; font-size:13px;">Gagal memuat data.</div>`;
      });
  }

  wrap.querySelector("#dashStartDate").addEventListener("change", loadDashboardData);
  wrap.querySelector("#dashEndDate").addEventListener("change", loadDashboardData);
  wrap.querySelector("#btnClearDashDate").addEventListener("click", () => {
    wrap.querySelector("#dashStartDate").value = "";
    wrap.querySelector("#dashEndDate").value = "";
    loadDashboardData();
  });

  loadDashboardData();

  return wrap;
}

const PIE_COLORS = ["#E23744", "#1E8E4C", "#B7791F", "#3B49C2", "#17181C", "#9A9CA5", "#8C1F27", "#1B82C8"];

function renderPieChart(container, data, onCategorySelect, activeCategory = null) {
  if (!data || !data.length) {
    container.innerHTML = `<div class="muted" style="padding:26px 20px; font-size:13px;">Belum ada data produk.</div>`;
    return;
  }
  const top = data.slice(0, 6);
  const rest = data.slice(6);
  if (rest.length) {
    const restQty = rest.reduce((s, d) => s + d.qty, 0);
    const restPercent = Math.round(rest.reduce((s, d) => s + d.percent, 0) * 10) / 10;
    top.push({ label: "Lainnya", qty: restQty, percent: restPercent });
  }

  let acc = 0;
  const stops = top.map((d, i) => {
    const start = acc;
    acc += d.percent;
    return `${PIE_COLORS[i % PIE_COLORS.length]} ${start}% ${acc}%`;
  }).join(", ");

  const totalQty = top.reduce((s, d) => s + d.qty, 0);
  const legend = top.map((d, i) => `
    <div class="pie-legend-row ${activeCategory === d.label ? 'active' : ''}" data-cat="${escapeAttr(d.label)}" title="Klik untuk memfilter bar chart">
      <span class="pie-dot" style="background:${PIE_COLORS[i % PIE_COLORS.length]};"></span>
      <span class="pie-legend-label">${escapeAttr(d.label)}</span>
      <span class="pie-legend-qty">${d.qty} item</span>
      <span class="pie-legend-val">${d.percent}%</span>
    </div>
  `).join("");

  container.innerHTML = `
    <div class="pie-donut" style="background: conic-gradient(${stops});">
      <div class="pie-donut-hole"></div>
    </div>
    <div class="pie-legend">
      ${legend}
      <div class="pie-total-row ${!activeCategory ? 'active' : ''}" id="pieShowAll" title="Klik untuk menampilkan semua kategori">
        <span>Semua Kategori</span>
        <span class="pie-total-val">${totalQty} item</span>
      </div>
    </div>
  `;

  if (onCategorySelect) {
    container.querySelectorAll(".pie-legend-row").forEach(row => {
      row.addEventListener("click", () => {
        const cat = row.dataset.cat;
        onCategorySelect(cat === activeCategory ? null : cat);
      });
    });
    const showAllBtn = container.querySelector("#pieShowAll");
    if (showAllBtn) {
      showAllBtn.addEventListener("click", () => onCategorySelect(null));
    }
  }
}

function renderHistogram(container, sessions) {
  if (!sessions || !sessions.length) {
    container.innerHTML = `<div class="muted" style="padding:26px 20px; font-size:13px;">Belum ada data project untuk membuat grafik.</div>`;
    return;
  }

  // Sort descending by total_biaya and take the top 5 projects
  const chartData = sessions.slice().sort((a, b) => (b.total_biaya || 0) - (a.total_biaya || 0)).slice(0, 5);
  const total = chartData.reduce((sum, d) => sum + (d.total_biaya || 0), 0);

  const segmentsHtml = chartData.map((d, i) => {
    const pct = total > 0 ? ((d.total_biaya || 0) / total) * 100 : 0;
    return `<div class="pv-segment" data-index="${i}" style="width:${pct}%; background:${PIE_COLORS[i % PIE_COLORS.length]};" title="${escapeAttr(d.nama_pelanggan)} • ${fmtRp(d.total_biaya)}"></div>`;
  }).join("");

  const legendHtml = chartData.map((d, i) => {
    const pct = total > 0 ? Math.round(((d.total_biaya || 0) / total) * 100) : 0;
    return `
      <div class="pv-legend-row" data-index="${i}">
        <span class="pv-dot" style="background:${PIE_COLORS[i % PIE_COLORS.length]};"></span>
        <span class="pv-name">${escapeAttr(d.nama_pelanggan)}</span>
        <span class="pv-value">${fmtRp(d.total_biaya)} <span class="pv-pct">• ${pct}%</span></span>
      </div>
    `;
  }).join("");

  container.innerHTML = `
    <div class="pv-chart-wrapper" style="position:relative;">
      <div class="pv-total-label">Distribusi Nilai Project (Total: ${fmtRp(total)})</div>
      <div class="pv-bar">${segmentsHtml}</div>
      <div class="pv-legend">${legendHtml}</div>
      <div class="col-chart-tooltip" style="position:absolute; display:none; background:#1A202C; color:#FFF; padding:10px 14px; border-radius:6px; font-size:11px; pointer-events:none; box-shadow: 0 4px 10px rgba(0,0,0,0.15); z-index: 100; border: 1px solid rgba(255,255,255,0.1); width: max-content;"></div>
    </div>
  `;

  const wrapper = container.querySelector(".pv-chart-wrapper");
  const tooltip = wrapper.querySelector(".col-chart-tooltip");

  function highlight(idx, on) {
    const seg = wrapper.querySelector(`.pv-segment[data-index="${idx}"]`);
    const row = wrapper.querySelector(`.pv-legend-row[data-index="${idx}"]`);
    if (seg) seg.classList.toggle("is-active", on);
    if (row) row.classList.toggle("is-active", on);
  }

  wrapper.querySelectorAll(".pv-segment").forEach(seg => {
    seg.addEventListener("mouseenter", (e) => {
      const idx = parseInt(seg.dataset.index);
      const d = chartData[idx];
      highlight(idx, true);

      const wrapBounds = wrapper.getBoundingClientRect();
      const segBounds = seg.getBoundingClientRect();
      const tipX = (segBounds.left + segBounds.width / 2) - wrapBounds.left;
      const tipY = segBounds.top - wrapBounds.top - 10;

      tooltip.style.left = `${tipX}px`;
      tooltip.style.top = `${tipY}px`;
      tooltip.style.transform = "translate(-50%, -100%)";
      tooltip.style.display = "block";
      tooltip.innerHTML = `
        <div style="font-weight:700; margin-bottom:4px; font-size:12px; color:#FFF;">${escapeAttr(d.nama_pelanggan)}</div>
        <div style="color:#A0AEC0; margin-bottom:2px;">RAB: <span style="color:#FFF; font-weight:600;">${escapeAttr(d.rab_nomor || '-')}</span></div>
        <div style="color:#A0AEC0;">Total Nilai: <span style="color:#FC8181; font-weight:700;">${fmtRp(d.total_biaya)}</span></div>
      `;
    });
    seg.addEventListener("mouseleave", () => {
      highlight(parseInt(seg.dataset.index), false);
      tooltip.style.display = "none";
    });
  });

  wrapper.querySelectorAll(".pv-legend-row").forEach(row => {
    row.addEventListener("mouseenter", () => highlight(parseInt(row.dataset.index), true));
    row.addEventListener("mouseleave", () => highlight(parseInt(row.dataset.index), false));
  });
}


function renderServiceBreakdown(container, summary) {
  const data = (summary && summary.service_breakdown) || [];
  const categoryDetails = (summary && summary.category_details) || {};
  
  if (!data || !data.length) {
    container.innerHTML = `<div class="muted" style="padding:20px; font-size:13px;">Belum ada data layanan produk.</div>`;
    return;
  }
  
  const topServices = data.slice(0, 4);
  const SEGMENT_COLORS = ["#E23744", "#F25C68", "#FFA000", "#9E1B24", "#9CA3AF"];
  
  const cardsHtml = topServices.map((svc, idx) => {
    const catName = svc.label;
    const items = categoryDetails[catName] || [];
    
    // Group by product name
    const prodMap = {};
    let totalQty = 0;
    items.forEach(it => {
      const pName = it.nama_produk || it.nama || "Lainnya";
      prodMap[pName] = (prodMap[pName] || 0) + (it.qty || 1);
      totalQty += (it.qty || 1);
    });
    
    const sortedProds = Object.entries(prodMap)
      .map(([name, qty]) => ({ name, qty }))
      .sort((a, b) => b.qty - a.qty);
      
    const slices = [];
    const legendItems = [];
    
    const top3 = sortedProds.slice(0, 3);
    const others = sortedProds.slice(3);
    
    let otherQty = 0;
    others.forEach(o => otherQty += o.qty);
    
    top3.forEach((p, pIdx) => {
      const percent = totalQty ? (p.qty / totalQty) * 100 : 0;
      const color = SEGMENT_COLORS[pIdx % SEGMENT_COLORS.length];
      slices.push({ label: p.name, qty: p.qty, percent, color });
      legendItems.push({ name: p.name, qty: p.qty, color });
    });
    
    if (otherQty > 0) {
      const percent = totalQty ? (otherQty / totalQty) * 100 : 0;
      const color = SEGMENT_COLORS[3];
      slices.push({ label: "Lainnya", qty: otherQty, percent, color });
      legendItems.push({ name: "Lainnya", qty: otherQty, color });
    }
    
    const centerText = `0${idx + 1}`;
    const donutSvg = makeDonutSvg(slices, centerText);
    
    const legendHtml = legendItems.map(item => `
      <div class="donut-legend-item">
        <span class="donut-legend-dot" style="background: ${item.color};"></span>
        <span class="donut-legend-name" title="${escapeAttr(item.name)}">${escapeAttr(item.name)}</span>
        <span class="donut-legend-qty">${item.qty} item</span>
      </div>
    `).join("");
    
    return `
      <div class="donut-card">
        ${donutSvg}
        <div class="donut-title">${escapeAttr(catName)}</div>
        <div class="donut-subtitle">${totalQty} Item • ${fmtRp(svc.total_nilai)}</div>
        <div class="donut-legend">
          ${legendHtml || '<div class="muted" style="font-size:10px; text-align:center; padding: 4px 0;">Tidak ada sub-produk</div>'}
        </div>
      </div>
    `;
  }).join("");
  
  container.innerHTML = `
    <div class="donut-row">
      ${cardsHtml}
    </div>
  `;
}

function makeDonutSvg(slices, centerText) {
  const size = 90;
  const strokeWidth = 12;
  const radius = 30;
  const center = size / 2;
  const circumference = 2 * Math.PI * radius;
  
  let currentOffset = -circumference / 4;
  let svgPaths = [];
  
  if (slices.length === 0) {
    return `
      <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
        <circle cx="${center}" cy="${center}" r="${radius}" fill="none" stroke="#E2E8F0" stroke-width="${strokeWidth}" />
        <circle cx="${center}" cy="${center}" r="${radius - strokeWidth / 2}" fill="#ffffff" />
        <text x="${center}" y="${center + 5}" text-anchor="middle" font-size="14" font-weight="800" fill="#718096">${centerText}</text>
      </svg>
    `;
  }
  
  slices.forEach(slice => {
    const proportion = slice.percent / 100;
    const strokeDash = proportion * circumference;
    svgPaths.push(`
      <circle cx="${center}" cy="${center}" r="${radius}" fill="none" 
        stroke="${slice.color}" 
        stroke-width="${strokeWidth}"
        stroke-dasharray="${strokeDash} ${circumference}"
        stroke-dashoffset="${currentOffset}"
        style="transition: stroke-width 0.2s ease, stroke 0.2s ease;"
        class="donut-segment"
        data-label="${escapeAttr(slice.label)}"
        data-val="${slice.qty} item"
      />
    `);
    currentOffset -= strokeDash;
  });
  
  return `
    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" class="donut-svg" style="overflow:visible; display:block; margin:0 auto;">
      <g>
        ${svgPaths.join("")}
      </g>
      <circle cx="${center}" cy="${center}" r="${radius - strokeWidth / 2 + 1}" fill="#ffffff" style="filter: drop-shadow(0px 2px 4px rgba(0,0,0,0.06));" />
      <text x="${center}" y="${center + 5}" text-anchor="middle" font-size="14" font-weight="800" fill="#2D3748">${centerText}</text>
    </svg>
  `;
}

/* =========================================================
   RIWAYAT RAB — daftar sesi milik sales yang login
   ========================================================= */
const HISTORY_STATUS = {
  draft: ["Draft", ""],
  analyzed: ["Dianalisis", "processing"],
  completed: ["Selesai", "ready"]
};

// Default arah urutan saat sebuah kolom pertama kali diklik
const SORT_DEFAULT_DIR = {
  nama_pelanggan: "asc",
  rab_nomor: "asc",
  industri: "asc",
  witel: "asc",
  status: "asc",
  total_biaya: "desc",
  updated_at: "desc"
};

function sortableTh(field, label, sortBy, sortDir) {
  const active = sortBy === field;
  const arrow = active ? (sortDir === "asc" ? "▲" : "▼") : "↕";
  return `<th class="sortable-th${active ? " active" : ""}" data-field="${field}" title="Urutkan berdasarkan ${escapeAttr(label)}">${label} <span class="sort-arrow">${arrow}</span></th>`;
}

function updateSortHeaderUI(theadEl, sortBy, sortDir) {
  theadEl.querySelectorAll(".sortable-th").forEach(th => {
    const field = th.dataset.field;
    const active = field === sortBy;
    th.classList.toggle("active", active);
    const arrowEl = th.querySelector(".sort-arrow");
    if (arrowEl) arrowEl.textContent = active ? (sortDir === "asc" ? "▲" : "▼") : "↕";
  });
}

// Pasang klik-untuk-urutkan pada semua header kolom yang bisa diurutkan
function attachSortableHeaders(theadEl, { getSortBy, getSortDir, setSort, onChange }) {
  theadEl.querySelectorAll(".sortable-th").forEach(th => {
    th.addEventListener("click", () => {
      const field = th.dataset.field;
      const currentBy = getSortBy();
      const currentDir = getSortDir();
      const newDir = currentBy === field
        ? (currentDir === "asc" ? "desc" : "asc")
        : (SORT_DEFAULT_DIR[field] || "asc");
      setSort(field, newDir);
      updateSortHeaderUI(theadEl, field, newDir);
      onChange();
    });
  });
}

function renderHistoryView() {
  const wrap = document.createElement("div");
  wrap.innerHTML = `
    <h1>Riwayat RAB</h1>
    <p class="desc">Semua sesi RAB yang pernah Anda buat sebelumnya.</p>

    <div class="history-toolbar">
      <div class="history-search-wrap">
        <svg class="search-icon-svg" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
        <input type="text" id="historySearch" placeholder="Cari nama pelanggan, industri, No. RAB, atau witel..." value="${escapeAttr(state.historySearch)}">
      </div>
      <div style="display:flex; gap:8px; align-items:center;">
        <label style="font-size:12.5px; font-weight:600;">Urutkan:</label>
        <select id="historySort" class="dash-select">
          <option value="latest" ${state.historySort === "latest" ? "selected" : ""}>Semua / Terbaru</option>
          <option value="total_desc" ${state.historySort === "total_desc" ? "selected" : ""}>Total Biaya Terbesar</option>
          <option value="total_asc" ${state.historySort === "total_asc" ? "selected" : ""}>Total Biaya Terkecil</option>
          <option value="oldest" ${state.historySort === "oldest" ? "selected" : ""}>Terlama</option>
        </select>
      </div>
    </div>

    <div class="table-wrap">
      <table>
        <thead id="historyThead">
          <tr>
            ${sortableTh("nama_pelanggan", "Pelanggan", state.historySortBy, state.historySortDir)}
            ${sortableTh("rab_nomor", "No. RAB", state.historySortBy, state.historySortDir)}
            ${sortableTh("industri", "Industri", state.historySortBy, state.historySortDir)}
            ${sortableTh("witel", "Witel", state.historySortBy, state.historySortDir)}
            ${sortableTh("status", "Status", state.historySortBy, state.historySortDir)}
            ${sortableTh("total_biaya", "Total Biaya", state.historySortBy, state.historySortDir)}
            ${sortableTh("updated_at", "Terakhir diubah", state.historySortBy, state.historySortDir)}
            <th>Aksi</th>
          </tr>
        </thead>
        <tbody id="historyBody">
          <tr><td colspan="8" class="muted" style="padding:20px;">Memuat riwayat…</td></tr>
        </tbody>
      </table>
    </div>

    <div class="pagination-controls">
      <span class="page-info" id="historyPageInfo">Memuat halaman…</span>
      <div style="display:flex; gap:8px;">
        <button class="btn btn-secondary" id="btnHistoryPrev" style="padding:6px 12px; font-size:12px;">← Sebelumnya</button>
        <button class="btn btn-secondary" id="btnHistoryNext" style="padding:6px 12px; font-size:12px;">Selanjutnya →</button>
      </div>
    </div>
  `;

  let debounceTimer;
  const searchInput = wrap.querySelector("#historySearch");
  searchInput.addEventListener("input", (e) => {
    state.historySearch = e.target.value;
    state.historyPage = 1;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => loadHistoryData(wrap), 300);
  });

  const sortSelect = wrap.querySelector("#historySort");
  sortSelect.addEventListener("change", (e) => {
    state.historySort = e.target.value;
    const map = {
      latest: ["updated_at", "desc"],
      oldest: ["created_at", "asc"],
      total_desc: ["total_biaya", "desc"],
      total_asc: ["total_biaya", "asc"]
    };
    const [field, dir] = map[state.historySort] || ["updated_at", "desc"];
    state.historySortBy = field;
    state.historySortDir = dir;
    state.historyPage = 1;
    updateSortHeaderUI(wrap.querySelector("#historyThead"), field, dir);
    loadHistoryData(wrap);
  });

  attachSortableHeaders(wrap.querySelector("#historyThead"), {
    getSortBy: () => state.historySortBy,
    getSortDir: () => state.historySortDir,
    setSort: (field, dir) => {
      state.historySortBy = field;
      state.historySortDir = dir;
      state.historyPage = 1;
    },
    onChange: () => loadHistoryData(wrap)
  });

  wrap.querySelector("#btnHistoryPrev").addEventListener("click", () => {
    if (state.historyPage > 1) {
      state.historyPage--;
      loadHistoryData(wrap);
    }
  });

  wrap.querySelector("#btnHistoryNext").addEventListener("click", () => {
    state.historyPage++;
    loadHistoryData(wrap);
  });

  loadHistoryData(wrap);
  return wrap;
}

function loadHistoryData(wrap) {
  const tbody = wrap.querySelector("#historyBody");
  tbody.innerHTML = `<tr><td colspan="8" class="muted" style="padding:20px;">Memuat riwayat…</td></tr>`;

  const qs = new URLSearchParams({
    q: state.historySearch,
    sortBy: state.historySortBy,
    sortDir: state.historySortDir,
    page: state.historyPage,
    limit: state.historyLimit
  });
  if (state.selectedWitel && state.selectedWitel !== "semua") {
    qs.append("witel", state.selectedWitel);
  }

  api(`/sessions?${qs.toString()}`)
    .then((res) => {
      const { sessions, pagination } = res;
      state.historyPage = pagination.page;

      const pageInfo = wrap.querySelector("#historyPageInfo");
      pageInfo.textContent = `Halaman ${pagination.page} dari ${pagination.totalPages || 1} (${pagination.total} Total RAB)`;

      const btnPrev = wrap.querySelector("#btnHistoryPrev");
      const btnNext = wrap.querySelector("#btnHistoryNext");
      btnPrev.disabled = pagination.page <= 1;
      btnNext.disabled = pagination.page >= pagination.totalPages;

      if (!sessions || !sessions.length) {
        tbody.innerHTML = `<tr><td colspan="8" class="muted" style="padding:20px;">Tidak ada riwayat RAB yang ditemukan.</td></tr>`;
        return;
      }
      tbody.innerHTML = sessions.map((s) => {
        const [label, cls] = HISTORY_STATUS[s.status] || [s.status, ""];
        const updated = fmtWib(s.updated_at, { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
        return `<tr>
          <td><strong>${escapeAttr(s.nama_pelanggan)}</strong></td>
          <td>${s.rab_nomor || "-"}</td>
          <td>${s.industri || "-"}</td>
          <td>${s.witel || "-"}</td>
          <td><span class="badge ${cls}" style="padding:4px 10px; font-size:10.5px;">${label}</span></td>
          <td><strong>${fmtRp(s.total_biaya)}</strong></td>
          <td class="muted">${updated}</td>
          <td style="white-space:nowrap;">
            <button class="bookmark-btn ${s.is_bookmarked ? 'active' : ''}" data-bookmark="${s.id}" title="Bookmark" aria-label="Bookmark" style="margin-right:6px;">
              <svg viewBox="0 0 24 24" aria-hidden="true" class="bookmark-icon">
                <path d="M7 4.5C7 3.67 7.67 3 8.5 3h7c.83 0 1.5.67 1.5 1.5v15.2c0 .47-.57.7-.94.38L12 17.2l-4.06 2.88c-.37.32-.94.09-.94-.38V4.5Z"></path>
              </svg>
            </button>
            <button class="btn btn-secondary" data-open="${s.id}" style="padding:6px 12px; font-size:12px;">Buka</button>
            <button class="btn btn-secondary" data-edit="${s.id}" style="padding:6px 12px; font-size:12px; margin-left:6px;">Edit</button>
            <button class="btn btn-danger" data-delete="${s.id}" style="padding:6px 12px; font-size:12px; margin-left:6px;">Hapus</button>
          </td>
        </tr>`;
      }).join("");

      tbody.querySelectorAll("[data-open]").forEach((btn) => {
        btn.addEventListener("click", () => openSession(btn.dataset.open));
      });
      tbody.querySelectorAll("[data-edit]").forEach((btn) => {
        btn.addEventListener("click", () => editSession(btn.dataset.edit));
      });
      tbody.querySelectorAll("[data-bookmark]").forEach((btn) => {
        btn.addEventListener("click", () => toggleBookmark(btn.dataset.bookmark));
      });
      tbody.querySelectorAll("[data-delete]").forEach((btn) => {
        btn.addEventListener("click", () => deleteSession(btn.dataset.delete));
      });
    })
    .catch((err) => {
      tbody.innerHTML = `<tr><td colspan="8" style="padding:14px;"><div class="notice dark" style="margin:0;">${err.message}</div></td></tr>`;
    });
}

function renderArchivesView() {
  const wrap = document.createElement("div");
  wrap.innerHTML = `
    <h1>Bookmark</h1>
    <p class="desc">Daftar proyek RAB yang Anda tandai sebagai bookmark.</p>

    <div class="history-toolbar">
      <div class="history-search-wrap">
        <svg class="search-icon-svg" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
        <input type="text" id="bookmarkSearch" placeholder="Cari bookmark pelanggan, No. RAB, witel..." value="${escapeAttr(state.bookmarkSearch)}">
      </div>
      <div style="display:flex; gap:8px; align-items:center;">
        <label style="font-size:12.5px; font-weight:600;">Urutkan:</label>
        <select id="bookmarkSort" class="dash-select">
          <option value="latest" ${state.bookmarkSort === "latest" ? "selected" : ""}>Terbaru</option>
          <option value="total_desc" ${state.bookmarkSort === "total_desc" ? "selected" : ""}>Total Biaya Terbesar</option>
          <option value="total_asc" ${state.bookmarkSort === "total_asc" ? "selected" : ""}>Total Biaya Terkecil</option>
          <option value="oldest" ${state.bookmarkSort === "oldest" ? "selected" : ""}>Terlama</option>
        </select>
      </div>
    </div>

    <div class="table-wrap">
      <table>
        <thead id="bookmarkThead">
          <tr>
            ${sortableTh("nama_pelanggan", "Pelanggan", state.bookmarkSortBy, state.bookmarkSortDir)}
            ${sortableTh("rab_nomor", "No. RAB", state.bookmarkSortBy, state.bookmarkSortDir)}
            ${sortableTh("industri", "Industri", state.bookmarkSortBy, state.bookmarkSortDir)}
            ${sortableTh("witel", "Witel", state.bookmarkSortBy, state.bookmarkSortDir)}
            ${sortableTh("status", "Status", state.bookmarkSortBy, state.bookmarkSortDir)}
            ${sortableTh("total_biaya", "Total Biaya", state.bookmarkSortBy, state.bookmarkSortDir)}
            ${sortableTh("updated_at", "Terakhir diubah", state.bookmarkSortBy, state.bookmarkSortDir)}
            <th>Aksi</th>
          </tr>
        </thead>
        <tbody id="archivesBody">
          <tr><td colspan="8" class="muted" style="padding:20px;">Memuat bookmark…</td></tr>
        </tbody>
      </table>
    </div>

    <div class="pagination-controls">
      <span class="page-info" id="bookmarkPageInfo">Memuat halaman…</span>
      <div style="display:flex; gap:8px;">
        <button class="btn btn-secondary" id="btnBookmarkPrev" style="padding:6px 12px; font-size:12px;">← Sebelumnya</button>
        <button class="btn btn-secondary" id="btnBookmarkNext" style="padding:6px 12px; font-size:12px;">Selanjutnya →</button>
      </div>
    </div>
  `;

  let debounceTimer;
  const searchInput = wrap.querySelector("#bookmarkSearch");
  searchInput.addEventListener("input", (e) => {
    state.bookmarkSearch = e.target.value;
    state.bookmarkPage = 1;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => loadBookmarkData(wrap), 300);
  });

  const sortSelect = wrap.querySelector("#bookmarkSort");
  sortSelect.addEventListener("change", (e) => {
    state.bookmarkSort = e.target.value;
    const map = {
      latest: ["updated_at", "desc"],
      oldest: ["created_at", "asc"],
      total_desc: ["total_biaya", "desc"],
      total_asc: ["total_biaya", "asc"]
    };
    const [field, dir] = map[state.bookmarkSort] || ["updated_at", "desc"];
    state.bookmarkSortBy = field;
    state.bookmarkSortDir = dir;
    state.bookmarkPage = 1;
    updateSortHeaderUI(wrap.querySelector("#bookmarkThead"), field, dir);
    loadBookmarkData(wrap);
  });

  attachSortableHeaders(wrap.querySelector("#bookmarkThead"), {
    getSortBy: () => state.bookmarkSortBy,
    getSortDir: () => state.bookmarkSortDir,
    setSort: (field, dir) => {
      state.bookmarkSortBy = field;
      state.bookmarkSortDir = dir;
      state.bookmarkPage = 1;
    },
    onChange: () => loadBookmarkData(wrap)
  });

  wrap.querySelector("#btnBookmarkPrev").addEventListener("click", () => {
    if (state.bookmarkPage > 1) {
      state.bookmarkPage--;
      loadBookmarkData(wrap);
    }
  });

  wrap.querySelector("#btnBookmarkNext").addEventListener("click", () => {
    state.bookmarkPage++;
    loadBookmarkData(wrap);
  });

  loadBookmarkData(wrap);
  return wrap;
}

function loadBookmarkData(wrap) {
  const tbody = wrap.querySelector("#archivesBody");
  tbody.innerHTML = `<tr><td colspan="8" class="muted" style="padding:20px;">Memuat bookmark…</td></tr>`;

  const qs = new URLSearchParams({
    q: state.bookmarkSearch,
    sortBy: state.bookmarkSortBy,
    sortDir: state.bookmarkSortDir,
    page: state.bookmarkPage,
    limit: state.bookmarkLimit
  });
  if (state.selectedWitel && state.selectedWitel !== "semua") {
    qs.append("witel", state.selectedWitel);
  }

  api(`/sessions/bookmarks?${qs.toString()}`)
    .then((res) => {
      const { bookmarks, pagination } = res;
      state.bookmarkPage = pagination.page;

      const pageInfo = wrap.querySelector("#bookmarkPageInfo");
      pageInfo.textContent = `Halaman ${pagination.page} dari ${pagination.totalPages || 1} (${pagination.total} Bookmark RAB)`;

      const btnPrev = wrap.querySelector("#btnBookmarkPrev");
      const btnNext = wrap.querySelector("#btnBookmarkNext");
      btnPrev.disabled = pagination.page <= 1;
      btnNext.disabled = pagination.page >= pagination.totalPages;

      if (!bookmarks || !bookmarks.length) {
        tbody.innerHTML = `<tr><td colspan="8" class="muted" style="padding:20px;">Belum ada bookmark RAB.</td></tr>`;
        return;
      }
      tbody.innerHTML = bookmarks.map((b) => {
        const [label, cls] = HISTORY_STATUS[b.status] || [b.status, ""];
        const updated = fmtWib(b.updated_at, { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
        return `<tr>
          <td><strong>${escapeAttr(b.nama_pelanggan)}</strong></td>
          <td>${b.rab_nomor || "-"}</td>
          <td>${b.industri || "-"}</td>
          <td>${b.witel || "-"}</td>
          <td><span class="badge ${cls}" style="padding:4px 10px; font-size:10.5px;">${label}</span></td>
          <td><strong>${fmtRp(b.total_biaya)}</strong></td>
          <td class="muted">${updated}</td>
          <td style="white-space:nowrap;">
            <button class="bookmark-btn active" data-bookmark="${b.id}" title="Unbookmark" aria-label="Unbookmark" style="margin-right:6px;">
              <svg viewBox="0 0 24 24" aria-hidden="true" class="bookmark-icon">
                <path d="M7 4.5C7 3.67 7.67 3 8.5 3h7c.83 0 1.5.67 1.5 1.5v15.2c0 .47-.57.7-.94.38L12 17.2l-4.06 2.88c-.37.32-.94.09-.94-.38V4.5Z"></path>
              </svg>
            </button>
            <button class="btn btn-secondary" data-open="${b.id}" style="padding:6px 12px; font-size:12px;">Buka</button>
            <button class="btn btn-secondary" data-edit="${b.id}" style="padding:6px 12px; font-size:12px; margin-left:6px;">Edit</button>
            <button class="btn btn-danger" data-delete="${b.id}" style="padding:6px 12px; font-size:12px; margin-left:6px;">Hapus</button>
          </td>
        </tr>`;
      }).join("");

      tbody.querySelectorAll("[data-open]").forEach((btn) => {
        btn.addEventListener("click", () => openSession(btn.dataset.open));
      });
      tbody.querySelectorAll("[data-edit]").forEach((btn) => {
        btn.addEventListener("click", () => editSession(btn.dataset.edit));
      });
      tbody.querySelectorAll("[data-bookmark]").forEach((btn) => {
        btn.addEventListener("click", () => toggleBookmark(btn.dataset.bookmark));
      });
      tbody.querySelectorAll("[data-delete]").forEach((btn) => {
        btn.addEventListener("click", () => deleteSession(btn.dataset.delete));
      });
    })
    .catch((err) => {
      tbody.innerHTML = `<tr><td colspan="8" style="padding:14px;"><div class="notice dark" style="margin:0;">${err.message}</div></td></tr>`;
    });
}

function openSession(id) {
  api(`/sessions/${id}`)
    .then((res) => {
      state.sessionId = res.session.id;
      state.session = res.session;
      state.items = res.items;
      state.totals = res.totals;
      state.keywords = res.session.keywords || [];
      state.notes = res.session.notes || [];
      state.view = "wizard";
      if (res.session.status === "completed") {
        state.maxUnlocked = 7;
        state.step = 7;
      } else if (["diajukan", "disetujui"].includes(res.session.approval_status)) {
        state.maxUnlocked = 5;
        state.step = 5;
        state.view = "approval";
      } else if (res.items.length) {
        state.maxUnlocked = 5;
        state.step = 5;
      } else {
        state.maxUnlocked = 1;
        state.step = 1;
      }
      render();
    })
    .catch((err) => alert(err.message));
}

function editSession(id) {
  if (!confirm("Edit RAB ini sebagai riwayat baru? Riwayat lama akan tetap tersimpan.")) return;
  api(`/sessions/${id}/clone`, { method: "POST" })
    .then((res) => {
      state.sessionId = res.session.id;
      state.session = res.session;
      state.items = res.items;
      state.totals = res.totals;
      state.keywords = res.session.keywords || [];
      state.notes = res.session.notes || [];
      state.view = "wizard";
      state.maxUnlocked = 5;
      state.step = 5;
      render();
      showToast("Riwayat baru berhasil dibuat dari sesi yang diedit", "success", 2200);
    })
    .catch((err) => showToast(err.message || "Gagal membuat riwayat baru", "error"));
}

function toggleBookmark(id) {
  api(`/sessions/${id}/bookmark`, { method: "PUT" })
    .then(() => {
      showToast("Status bookmark berhasil diperbarui", "success", 1800);
      state.view = "history";
      render();
    })
    .catch((err) => showToast(err.message || "Gagal memperbarui bookmark", "error"));
}

function deleteSession(id) {
  if (!confirm("Hapus riwayat RAB ini? Tindakan ini tidak bisa dibatalkan.")) return;
  api(`/sessions/${id}`, { method: "DELETE" })
    .then(() => {
      showToast("Riwayat RAB berhasil dihapus", "success");
      state.view = "history";
      render();
    })
    .catch((err) => showToast(err.message || "Gagal menghapus sesi", "error"));
}

/* =========================================================
   STEP 1 — Input kebutuhan pelanggan
   ========================================================= */
function renderStep1() {
  const wrap = document.createElement("div");
  wrap.innerHTML = `
    <h1>Input kebutuhan pelanggan</h1>

    <div class="form-grid">
      <div class="field">
        <label>Nama Perusahaan / pelanggan <span class="req">*</span></label>
        <input type="text" id="fNama" placeholder="Contoh: PT Maju Sentosa Logistik">
      </div>
      <div class="field">
        <label>Industri <span class="req">*</span></label>
        <select id="fIndustri">
          ${["Logistik & Distribusi","Pendidikan","Pemerintahan","Perdagangan / Retail","Manufaktur","Kesehatan","Perbankan & Keuangan","Lainnya"]
            .map(o => `<option>${o}</option>`).join("")}
        </select>
      </div>
      <div class="field">
        <label>Jumlah cabang / titik lokasi</label>
        <input type="text" id="fCabang" placeholder="Contoh: 6 cabang gudang — Jawa Barat">
      </div>
      <div class="field">
        <label>Witel penanggung jawab <span class="req">*</span></label>
        <select id="fWitel">
          ${["Witel Priangan Timur","Witel Priangan Barat","Witel Bekar","Witel Bandung"]
            .map(o => `<option ${o === (state.user?.witel || "Witel Priangan Timur") ? "selected" : ""}>${o}</option>`).join("")}
        </select>
      </div>
      <div class="field">
        <label>Estimasi Budget Pelanggan per Bulan Sebelum PPN (Rp - Opsional)</label>
        <input type="number" id="fBudget" placeholder="Contoh: 15000000">
      </div>
    </div>

    <div class="kebutuhan-box">
      <div class="kb-head">
        <label>Kebutuhan pelanggan (deskripsi bebas) <span class="req">*</span></label>
        <span class="chip-ai">DIBACA OLEH AI</span>
      </div>
      <textarea id="fKebutuhan" placeholder="Contoh: Butuh koneksi internet dedicated dan WiFi managed yang stabil 24 jam untuk operasional gudang, serta jaringan antarcabang yang andal dengan bandwidth tinggi."></textarea>
      <div class="kb-hint">Semakin detail kebutuhan yang dituliskan, semakin akurat rekomendasi paket yang dihasilkan sistem.</div>
    </div>

    <div id="step1Error" class="notice dark" style="display:none;"></div>

    <div class="actions-row">
      <button class="btn btn-primary" id="btnKirimAI">Kirim ke AI untuk dianalisis →</button>
    </div>
  `;

  const existingSession = state.session || null;
  if (existingSession) {
    wrap.querySelector("#fNama").value = existingSession.nama_pelanggan || "";
    wrap.querySelector("#fIndustri").value = existingSession.industri || "Logistik & Distribusi";
    wrap.querySelector("#fCabang").value = existingSession.cabang || "";
    wrap.querySelector("#fWitel").value = existingSession.witel || state.user?.witel || "Witel Priangan Timur";
    wrap.querySelector("#fKebutuhan").value = existingSession.kebutuhan || "";
    wrap.querySelector("#fBudget").value = existingSession.budget || "";
  }

  wrap.querySelector("#btnKirimAI").addEventListener("click", async () => {
    const nama = wrap.querySelector("#fNama").value.trim();
    const kebutuhan = wrap.querySelector("#fKebutuhan").value.trim();
    const budgetVal = wrap.querySelector("#fBudget").value.trim();
    const errBox = wrap.querySelector("#step1Error");
    if (!nama || !kebutuhan) {
      errBox.textContent = "Mohon lengkapi Nama Perusahaan / pelanggan dan Kebutuhan pelanggan terlebih dahulu.";
      errBox.style.display = "block";
      return;
    }
    const payload = {
      nama_pelanggan: nama,
      industri: wrap.querySelector("#fIndustri").value,
      cabang: wrap.querySelector("#fCabang").value.trim(),
      witel: wrap.querySelector("#fWitel").value,
      kebutuhan,
      budget: budgetVal ? parseFloat(budgetVal) : null
    };
    const btn = wrap.querySelector("#btnKirimAI");
    btn.disabled = true;
    btn.textContent = "Mengirim…";
    try {
      let res;
      if (state.sessionId && state.session) {
        res = await api(`/sessions/${state.sessionId}`, { method: "PUT", body: JSON.stringify(payload) });
        state.session = res.session;
      } else {
        res = await api("/sessions", { method: "POST", body: JSON.stringify(payload) });
        state.sessionId = res.session.id;
        state.session = res.session;
      }
      unlockAndGo(2);
      runAnalysis();
    } catch (err) {
      errBox.textContent = err.message;
      errBox.style.display = "block";
      btn.disabled = false;
      btn.textContent = "Kirim ke AI untuk dianalisis →";
    }
  });

  return wrap;
}

/* =========================================================
   STEP 2 — Analisis AI (animasi + panggil API asli)
   ========================================================= */
function renderStep2() {
  const wrap = document.createElement("div");
  wrap.innerHTML = `
    <h1>AI sedang menganalisis kebutuhan pelanggan</h1>
    <p class="desc">Sistem membaca kebutuhan pelanggan dan mencocokkannya dengan katalog produk Telkom secara otomatis.</p>

    <div class="flow-diagram">
      <div class="flow-node">Kebutuhan<br>pelanggan</div>
      <div class="flow-line"></div>
      <div class="flow-node center">AI</div>
      <div class="flow-line"></div>
      <div class="flow-node">Kategori<br>produk</div>
    </div>

    <div class="checklist" id="checklist">
      <div class="check-item" data-i="0"><span class="mark"></span> Membaca kebutuhan pelanggan</div>
      <div class="check-item" data-i="1"><span class="mark"></span> Mengidentifikasi kata kunci utama</div>
      <div class="check-item" data-i="2"><span class="mark"></span> Mencocokkan dengan katalog produk Telkom</div>
      <div class="check-item" data-i="3"><span class="mark"></span> Menyusun rekomendasi</div>
    </div>
    <div id="analyzeError" class="notice dark" style="display:none; margin-top:16px;"></div>
  `;
  return wrap;
}

async function runAnalysis() {
  let animDone = false, apiDone = false, apiError = null, apiResult = null;

  const list = () => document.querySelectorAll("#checklist .check-item");
  let i = 0;
  const stepAnim = () => {
    const nodes = list();
    if (!nodes.length) return;
    if (i > 0) { nodes[i - 1].classList.remove("active"); nodes[i - 1].classList.add("done"); }
    if (i < nodes.length) { nodes[i].classList.add("active"); i++; setTimeout(stepAnim, 550); }
    else { animDone = true; tryFinish(); }
  };
  setTimeout(stepAnim, 300);

  api(`/sessions/${state.sessionId}/analyze`, { method: "POST" })
    .then(res => { apiResult = res; apiDone = true; tryFinish(); })
    .catch(err => { apiError = err; apiDone = true; tryFinish(); });

  function tryFinish() {
    if (!animDone || !apiDone) return;
    if (apiError) {
      const box = document.getElementById("analyzeError");
      if (box) { box.textContent = apiError.message; box.style.display = "block"; }
      return;
    }
    state.keywords = apiResult.keywords;
    state.notes = apiResult.notes;
    state.items = apiResult.items;
    state.totals = apiResult.totals;
    unlockAndGo(4);
  }
}

/* =========================================================
   STEP 3 — Master data produk (query langsung ke API/DB)
   ========================================================= */
const MASTER_TABS = [
  { key: "wifi", label: "WiFi Managed (WMS)" },
  { key: "hsi", label: "HSI Bisnis" },
  { key: "datin", label: "Datin (Astinet / Metro-E / IP Transit)" },
  { key: "dbt", label: "Digital Business (Pijar dll.)" }
];

function renderStep3() {
  const wrap = document.createElement("div");
  wrap.innerHTML = `
    <h1>Master data produk</h1>
    <p class="desc">Katalog resmi produk &amp; harga Telkom Witel Tasikmalaya. Gunakan pencarian untuk menemukan paket yang sesuai kebutuhan pelanggan.</p>

    <div class="master-tabs" id="masterTabs">
      ${MASTER_TABS.map(t => `<div class="mtab ${state.masterTab === t.key ? "active" : ""}" data-key="${t.key}">${t.label}</div>`).join("")}
    </div>
    <div class="master-search"><input type="text" id="masterSearch" placeholder="Cari paket, lokasi, atau layanan..." value="${state.masterQuery}"></div>
    <div class="table-wrap"><div class="scroll-table" id="masterTableWrap"><div class="muted" style="padding:20px;">Memuat…</div></div></div>

    <div class="actions-row">
      <button class="btn btn-secondary" id="btnBackTo1">← Kembali</button>
      <button class="btn btn-primary" id="btnLanjutRekom">Lanjut ke rekomendasi →</button>
    </div>
  `;

  wrap.querySelectorAll("#masterTabs .mtab").forEach(el => {
    el.addEventListener("click", () => {
      state.masterTab = el.dataset.key;
      wrap.querySelectorAll("#masterTabs .mtab").forEach(x => x.classList.remove("active"));
      el.classList.add("active");
      loadMasterTable(wrap);
    });
  });

  let debounceTimer;
  wrap.querySelector("#masterSearch").addEventListener("input", (e) => {
    state.masterQuery = e.target.value;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => loadMasterTable(wrap), 300);
  });

  wrap.querySelector("#btnBackTo1").addEventListener("click", () => goToStep(1));
  wrap.querySelector("#btnLanjutRekom").addEventListener("click", () => {
    unlockAndGo(4);
  });

  loadMasterTable(wrap);
  return wrap;
}

async function loadMasterTable(wrap) {
  const container = wrap.querySelector("#masterTableWrap");
  container.innerHTML = `<div class="muted" style="padding:20px;">Memuat data produk…</div>`;
  try {
    const qs = new URLSearchParams({ sheet: state.masterTab, q: state.masterQuery, limit: 100 });
    const data = await api(`/master-data?${qs.toString()}`);
    renderMasterTable(container, data);
  } catch (err) {
    container.innerHTML = `<div class="muted" style="padding:20px; color:var(--red-dark);">Gagal memuat: ${err.message}</div>`;
  }
}

function renderMasterTable(container, data) {
  const key = state.masterTab;
  const rows = data.rows;
  let headerHtml, bodyHtml;
  if (key === "wifi" || key === "dbt") {
    headerHtml = `<tr><th>Layanan</th><th>Paket</th><th>Internet (Mbps)</th><th>Harga /bulan</th><th>Rekomendasi Penggunaan</th></tr>`;
    bodyHtml = rows.map(r => `<tr><td>${r.layanan}</td><td>${r.paket}</td><td>${r.mbps}</td><td>${fmtRp(r.harga)}</td><td>${r.rekomendasi_penggunaan || ""}</td></tr>`).join("");
  } else if (key === "hsi") {
    headerHtml = `<tr><th>Layanan</th><th>Paket</th><th>Jenis</th><th>Internet (Mbps)</th><th>Harga /bulan</th><th>Rekomendasi Penggunaan</th></tr>`;
    bodyHtml = rows.map(r => `<tr><td>${r.layanan}</td><td>${r.paket}</td><td>${r.lokasi||""}</td><td>${r.mbps}</td><td>${fmtRp(r.harga)}</td><td>${r.rekomendasi_penggunaan || ""}</td></tr>`).join("");
  } else {
    headerHtml = `<tr><th>Layanan</th><th>Paket</th><th>Lokasi</th><th>Internet (Mbps)</th><th>MRC /bulan</th><th>Biaya PSB</th><th>Rekomendasi Penggunaan</th></tr>`;
    bodyHtml = rows.map(r => `<tr><td>${r.layanan}</td><td>${r.paket}</td><td class="muted">${r.lokasi||""}</td><td>${r.mbps}</td><td>${fmtRp(r.harga)}</td><td>${fmtRp(r.psb)}</td><td>${r.rekomendasi_penggunaan || ""}</td></tr>`).join("");
  }
  container.innerHTML = `<table><thead>${headerHtml}</thead><tbody>${bodyHtml || `<tr><td colspan="6" class="muted">Tidak ada data yang cocok.</td></tr>`}</tbody></table>`;
  if (data.total > rows.length) {
    const note = document.createElement("div");
    note.className = "data-note";
    note.textContent = `Menampilkan ${rows.length} dari ${data.total} produk. Perhalus pencarian untuk hasil yang lebih spesifik.`;
    container.appendChild(note);
  }
}

/* =========================================================
   STEP 4 — transisi otomatis
   ========================================================= */
function renderStep4() {
  const wrap = document.createElement("div");
  wrap.innerHTML = `
    <h1>Tabel rekomendasi</h1>
    <p class="desc">Rekomendasi produk sudah disiapkan berdasarkan hasil analisis kebutuhan pelanggan, lengkap dengan persentase kecocokannya.</p>
    <div class="checklist" id="rekomChecklist">
      <div class="check-item" data-i="0"><span class="mark"></span> Kategori produk teridentifikasi</div>
      <div class="check-item" data-i="1"><span class="mark"></span> Produk dicocokkan dengan katalog Telkom</div>
      <div class="check-item" data-i="2"><span class="mark"></span> Menyusun tabel rekomendasi…</div>
    </div>

    <div class="table-wrap rekom-table" id="rekomPreviewWrap" style="display:none; margin-top:20px;">
      <table>
        <thead><tr><th>Produk</th><th>Sumber</th><th>Kecocokan</th><th>Harga satuan</th><th>Qty</th><th>Periode</th><th>Subtotal</th></tr></thead>
        <tbody id="rekomPreviewBody"></tbody>
      </table>
    </div>

    <div class="actions-row" id="rekomActions" style="display:none; justify-content:space-between; align-items:center;">
      <button class="btn btn-secondary" id="btnGenAgainStep4">Buat Ulang Rekomendasi AI</button>
      <button class="btn btn-primary" id="btnLanjutReview">Lanjut ke Review &amp; Edit →</button>
    </div>
  `;

  computeAltLabels(state.items);
  const previewBody = wrap.querySelector("#rekomPreviewBody");
  previewBody.innerHTML = state.items.map(it => {
    const subtotal = ((it.harga || 0) + (it.psb || 0)) * (it.qty || 0);
    const altLabel = it.alt_label;
    return `
      <tr>
        <td>
          ${escapeAttr(it.nama)}
          ${altLabel ? `<div class="alt-label ${altLabel === "Alternatif" ? "is-alt" : "is-main"}">${altLabel}</div>` : ""}
          ${(() => {
            const altReason = getAltLabelReason(it);
            return altReason ? `<div style="font-size:10px; color:var(--ink-soft); line-height:1.25; margin-top:2px;">${escapeAttr(altReason)}</div>` : "";
          })()}
          ${(() => {
            const reasoningText = getReasoningFallback(it);
            return reasoningText ? `<div style="font-size:10.5px; color:var(--ink-soft); line-height:1.2; margin-top:2px; font-style:italic;">${escapeAttr(reasoningText)}</div>` : "";
          })()}
        </td>
        <td><span class="src-chip ${srcChipClass(it.sumber)}">${it.sumber}</span></td>
        <td>${matchBadge(it.kecocokan)}</td>
        <td>${fmtRp(it.harga || 0)}</td>
        <td>${it.qty}</td>
        <td>${it.periode}</td>
        <td><strong>${fmtRp(subtotal)}</strong></td>
      </tr>`;
  }).join("") || `<tr><td colspan="7" class="muted" style="padding:20px;">Belum ada rekomendasi otomatis. Lanjutkan ke Review &amp; Edit untuk menambahkan produk secara manual.</td></tr>`;

  // Animasikan checklist singkat, lalu tampilkan tabel + tombol lanjut
  const list = () => wrap.querySelectorAll("#rekomChecklist .check-item");
  let i = 0;
  const stepAnim = () => {
    const nodes = list();
    if (i > 0) { nodes[i - 1].classList.remove("active"); nodes[i - 1].classList.add("done"); }
    if (i < nodes.length) { nodes[i].classList.add("active"); i++; setTimeout(stepAnim, 400); }
    else {
      wrap.querySelector("#rekomPreviewWrap").style.display = "";
      wrap.querySelector("#rekomActions").style.display = "flex";
    }
  };
  setTimeout(stepAnim, 200);

  const btnGen4 = wrap.querySelector("#btnGenAgainStep4");
  if (btnGen4) {
    btnGen4.addEventListener("click", async () => {
      btnGen4.disabled = true;
      btnGen4.textContent = "Memproses AI…";
      try {
        const res = await api(`/sessions/${state.sessionId}/analyze`, { method: "POST" });
        state.keywords = res.keywords;
        state.notes = res.notes;
        state.items = res.items;
        state.totals = res.totals;
        showToast("Rekomendasi AI berhasil dibuat ulang!", "success");
        render();
      } catch (err) {
        showToast(err.message || "Gagal membuat ulang rekomendasi", "error");
        btnGen4.disabled = false;
        btnGen4.textContent = "Buat Ulang Rekomendasi AI";
      }
    });
  }

  wrap.querySelector("#btnLanjutReview").addEventListener("click", () => unlockAndGo(5));

  return wrap;
}

/* =========================================================
   STEP 5 — Review & edit
   ========================================================= */
function renderStep5() {
  const wrap = document.createElement("div");
  // Normalize legacy AI note phrasing so UI shows the new per-month comparison
  let notesHtml = "";
  if (state.notes && state.notes.length) {
    notesHtml = `<div class="notice dark">` + state.notes.map(n => {
      return "• " + n.replace(/Penyesuaian Budget: Total estimasi penawaran \(Rp ([\d.,]+)\) telah disesuaikan dengan budget pelanggan \(Rp ([\d.,]+)\)\.?/i,
        (m, p1, p2) => `Total estimasi penawaran idealnya (Rp ${p1} per bulan), dibandingkan dengan budget pelanggan (Rp ${p2} per bulan).`);
    }).join("<br>") + `</div>`;
  }

  wrap.innerHTML = `
    <h1>Sales review & edit rekomendasi</h1>
    <p class="desc">Sesuaikan jumlah, harga, atau periode sesuai kebutuhan pelanggan. Perubahan tersimpan secara otomatis.</p>

    <div class="notice">AI hanya memberi saran awal — keputusan akhir dan tanggung jawab tetap di tangan sales.</div>
    ${state.session && state.session.approval_status === "ditolak" ? `<div class="notice dark">RAB ditolak Manajer: ${(state.session.decision_note || "").replace(/</g, "&lt;")}. Perbaiki lalu ajukan ulang.</div>` : ""}
    ${notesHtml}

    <div class="kebutuhan-box" style="margin-bottom:18px;">
      <div class="kb-head">
        <label>Draft input kebutuhan pelanggan</label>
        <span class="chip-ai">EDITABLE</span>
      </div>
      <textarea id="fDraftKebutuhan" placeholder="Edit kebutuhan pelanggan di sini...">${escapeAttr(state.session?.kebutuhan || "")}</textarea>
      <div class="field" style="margin-top:10px; max-width:260px;">
        <label style="font-size:11.5px;">Estimasi Budget Pelanggan per Bulan Sebelum PPN (Rp - Opsional)</label>
        <input type="number" id="fDraftBudget" placeholder="Contoh: 15000000" value="${state.session?.budget || ""}">
      </div>
      <div style="display:flex; justify-content:space-between; align-items:center; margin-top:8px;">
        <span class="kb-hint">Perubahan draft &amp; budget ini disimpan otomatis, dan dipakai AI untuk mencocokkan ke master data saat Generate.</span>
        <button class="btn btn-primary" id="btnGenFromDraft" style="padding: 7px 15px; font-size:12px; font-weight:700;">Generate</button>
      </div>
    </div>

    <div class="table-wrap rekom-table">
      <table>
        <thead><tr><th>Produk</th><th>Sumber</th><th>Jenis Layanan</th><th>Kategori</th><th>Satuan</th><th>Qty</th><th>TOP</th><th>Kontrak (Bulan)</th><th>Harga Bulanan</th><th>Diskon Bulanan (%)</th><th>Biaya PSB</th><th>Diskon PSB (%)</th><th>Total Bulanan</th><th>Total PSB</th><th>Subtotal</th><th>Diskon Agregat (%)</th><th>Grand Total</th><th></th></tr></thead>
        <tbody id="rekomBody"></tbody>
      </table>
      <div class="add-manual-row" id="btnAddManual">+ &nbsp;Tambah produk manual</div>
    </div>

    <div class="total-row" style="display:flex; justify-content:flex-end; align-items:flex-end; gap:22px; margin: 18px 0; flex-wrap:wrap;">
      <div style="text-align:right;">
        <div class="total-label" style="font-size:11px; text-transform:uppercase; letter-spacing:.4px; color:var(--ink-soft); font-weight:700;">Budget Pelanggan (per bulan)</div>
        <div id="budgetPerBulanValue" style="font-size:15px; font-weight:700; margin-top:2px;">-</div>
      </div>
      <div style="text-align:right;">
        <span class="total-label" style="font-size:11px; text-transform:uppercase; letter-spacing:.4px; color:var(--ink-soft); font-weight:700;">Total Estimasi Penawaran (per bulan)</span>
        <div><span class="total-value" id="totalValue" style="color:var(--red-dark); font-size:18px; font-weight:800;">${fmtRp(0)}</span></div>
        <div id="budgetCompareNote" style="font-size:11px; font-weight:600; margin-top:2px;"></div>
        <div style="margin-top:4px;">
          <span class="total-label" style="font-size:11px; text-transform:uppercase; letter-spacing:.4px; color:var(--ink-soft); font-weight:700;">Total Project:</span>
          <span id="totalProjectValue" style="font-size:13px; font-weight:700; color:var(--ink-dark); margin-left:4px;">-</span>
        </div>
        <div style="margin-top:10px; padding-top:10px; border-top:1px dashed var(--line);">
          <span class="total-label" style="font-size:11px; text-transform:uppercase; letter-spacing:.4px; color:var(--ink-soft); font-weight:700;">Billing Perdana (Bulan Penuh)</span>
          <div id="billingPerdanaFullValue" style="font-size:15px; font-weight:800; color:var(--ink-dark); margin-top:2px;">${fmtRp(0)}</div>
          <div style="font-size:9.5px; color:var(--ink-soft); margin-top:1px;">Total Estimasi Penawaran (per bulan) + Subtotal PSB</div>
        </div>
        <div style="margin-top:8px;">
          <span class="total-label" style="font-size:11px; text-transform:uppercase; letter-spacing:.4px; color:var(--ink-soft); font-weight:700;">Billing Perdana (Proporsional)</span>
          <div id="billingPerdanaProrataValue" style="font-size:15px; font-weight:800; color:var(--ink-dark); margin-top:2px;">${fmtRp(0)}</div>
          <div id="billingPerdanaProrataNote" style="font-size:9.5px; color:var(--ink-soft); margin-top:1px;"></div>
        </div>
      </div>
    </div>

    <div class="breakdown-container" style="display:flex; justify-content:flex-end; margin: 18px 0; border-top:1px dashed var(--line); padding-top:18px;">
      <div style="display:flex; flex-direction:column; gap:8px; min-width:320px;">
        <div style="display:flex; justify-content:space-between; font-size:11px; font-weight:700; text-transform:uppercase; color:var(--ink-soft); letter-spacing:.4px;">
          <span>Subtotal (Gross)</span>
          <span id="breakdownGross" style="color:var(--ink-dark); font-weight:700;">-</span>
        </div>
        <div style="display:flex; justify-content:space-between; font-size:11px; font-weight:700; text-transform:uppercase; color:var(--ink-soft); letter-spacing:.4px;">
          <span>Pagu (Per Bulan)</span>
          <span id="breakdownPagu" style="color:var(--ink-dark); font-weight:700;">-</span>
        </div>
        <div style="display:flex; justify-content:space-between; font-size:11px; font-weight:700; text-transform:uppercase; color:var(--ink-soft); letter-spacing:.4px;">
          <span>Sisa (Per Bulan)</span>
          <span id="breakdownSisa" style="font-weight:700;">-</span>
        </div>
        <div style="display:flex; justify-content:space-between; font-size:11px; font-weight:700; text-transform:uppercase; color:var(--ink-soft); letter-spacing:.4px;">
          <span>Subtotal (Net)</span>
          <span id="breakdownNet" style="color:var(--ink-dark); font-weight:700;">-</span>
        </div>
        <div style="display:flex; justify-content:space-between; font-size:11px; font-weight:700; text-transform:uppercase; color:var(--ink-soft); letter-spacing:.4px;">
          <span>PPN 11%</span>
          <span id="breakdownPPN" style="color:var(--ink-dark); font-weight:700;">-</span>
        </div>
        <div style="display:flex; justify-content:space-between; font-size:13px; font-weight:800; text-transform:uppercase; color:var(--ink-dark); letter-spacing:.4px;">
          <span>Total Estimasi</span>
          <span id="breakdownTotal" style="font-size:15px; color:var(--red-dark); font-weight:800;">-</span>
        </div>
      </div>
    </div>
    <div id="step5Error" class="notice dark" style="display:none;"></div>

    <div class="actions-row" style="justify-content:space-between; align-items:center;">
      <div>
        <button class="btn btn-secondary" id="btnBackTo3">← Kembali</button>
        <button class="btn btn-secondary" id="btnGenAgainStep5" style="margin-left:8px;">Buat Ulang Rekomendasi AI</button>
      </div>
      <button class="btn btn-primary" id="btnApprove">Ajukan untuk persetujuan →</button>
    </div>
  `;

  renderRekomBody(wrap.querySelector("#rekomBody"));
  updateTotal(wrap);

  const btnGenFromDraft = wrap.querySelector("#btnGenFromDraft");
  if (btnGenFromDraft) {
    btnGenFromDraft.addEventListener("click", async () => {
      btnGenFromDraft.disabled = true;
      btnGenFromDraft.textContent = "Memproses AI…";
      try {
        const kebutuhan = wrap.querySelector("#fDraftKebutuhan").value.trim();
        const draftBudgetVal = wrap.querySelector("#fDraftBudget").value.trim();
        const saveRes = await api(`/sessions/${state.sessionId}`, {
          method: "PUT",
          body: JSON.stringify({
            nama_pelanggan: state.session.nama_pelanggan,
            industri: state.session.industri || "Logistik & Distribusi",
            cabang: state.session.cabang || "",
            witel: state.session.witel || state.user?.witel || "Witel Priangan Timur",
            kebutuhan,
            budget: draftBudgetVal ? parseFloat(draftBudgetVal) : null
          })
        });
        state.session = saveRes.session;
        const res = await api(`/sessions/${state.sessionId}/analyze`, { method: "POST" });
        state.keywords = res.keywords;
        state.notes = res.notes;
        state.items = res.items;
        state.totals = res.totals;
        showToast("Rekomendasi AI diperbarui!", "success");
        render();
      } catch (err) {
        showToast(err.message || "Gagal memperbarui rekomendasi", "error");
      } finally {
        btnGenFromDraft.disabled = false;
        btnGenFromDraft.textContent = "Generate";
      }
    });
  }

  const btnGen5 = wrap.querySelector("#btnGenAgainStep5");
  if (btnGen5) {
    btnGen5.addEventListener("click", async () => {
      btnGen5.disabled = true;
      btnGen5.textContent = "Memproses AI…";
      try {
        const res = await api(`/sessions/${state.sessionId}/analyze`, { method: "POST" });
        state.keywords = res.keywords;
        state.notes = res.notes;
        state.items = res.items;
        state.totals = res.totals;
        showToast("Rekomendasi AI berhasil dibuat ulang!", "success");
        render();
      } catch (err) {
        showToast(err.message || "Gagal membuat ulang rekomendasi", "error");
        btnGen5.disabled = false;
        btnGen5.textContent = "Buat Ulang Rekomendasi AI";
      }
    });
  }

  const draftBox = wrap.querySelector("#fDraftKebutuhan");
  const draftBudgetBox = wrap.querySelector("#fDraftBudget");
  let draftDebounce;
  // flushDraft() menyimpan kebutuhan & budget SEKARANG JUGA (tanpa debounce) dan
  // mengembalikan promise-nya, supaya alur lain (mis. tombol Approve) bisa menunggu
  // perubahan draft tersimpan dulu sebelum lanjut memproses RAB / Excel.
  async function flushDraft() {
    clearTimeout(draftDebounce);
    if (!state.sessionId || !state.session) return state.session;
    const kebutuhan = draftBox.value.trim();
    const draftBudgetVal = draftBudgetBox.value.trim();
    const res = await api(`/sessions/${state.sessionId}`, {
      method: "PUT",
      body: JSON.stringify({
        nama_pelanggan: state.session.nama_pelanggan,
        industri: state.session.industri || "Logistik & Distribusi",
        cabang: state.session.cabang || "",
        witel: state.session.witel || state.user?.witel || "Witel Priangan Timur",
        kebutuhan,
        budget: draftBudgetVal ? parseFloat(draftBudgetVal) : null
      })
    });
    state.session = res.session;
    updateTotal(wrap);
    return res.session;
  }
  function saveDraft() {
    clearTimeout(draftDebounce);
    draftDebounce = setTimeout(async () => {
      try {
        await flushDraft();
        showToast("Draft kebutuhan & budget berhasil disimpan", "success", 1800);
      } catch (err) {
        showToast(err.message || "Gagal menyimpan draft kebutuhan", "error", 2500);
      }
    }, 400);
  }
  draftBox.addEventListener("input", saveDraft);
  draftBudgetBox.addEventListener("input", () => {
    // Feedback instan di kotak "Total Estimasi vs Budget" sebelum draft tersimpan ke server.
    const v = draftBudgetBox.value.trim();
    state.session = { ...state.session, budget: v ? parseFloat(v) : null };
    updateTotal(wrap);
    saveDraft();
  });

  wrap.querySelector("#btnAddManual").addEventListener("click", async () => {
    try {
      const res = await api(`/sessions/${state.sessionId}/items`, {
        method: "POST",
        body: JSON.stringify({ nama: "Produk baru", harga: 0, satuan: "unit", qty: 1, periode: "Bulanan" })
      });
      state.items.push(res.item);
      renderRekomBody(wrap.querySelector("#rekomBody"));
      updateTotal(wrap);
    } catch (err) { alert(err.message); }
  });

  wrap.querySelector("#btnBackTo3").addEventListener("click", () => goToStep(3));
  wrap.querySelector("#btnApprove").addEventListener("click", async () => {
    if (!state.items.length) {
      const box = wrap.querySelector("#step5Error");
      box.textContent = "Tabel rekomendasi masih kosong. Tambahkan minimal satu produk sebelum melanjutkan.";
      box.style.display = "block";
      return;
    }
    const btn = wrap.querySelector("#btnApprove");
    btn.disabled = true;
    btn.textContent = "Memproses…";
    try {
      // Pastikan draft kebutuhan & budget (yang mungkin baru saja diedit dan masih
      // menunggu debounce) tersimpan dulu ke server sebelum RAB/Excel diproses,
      // supaya PAGU di Excel selalu memakai budget terbaru dari halaman ini.
      await flushDraft();
      // Sales 2.0: RAB diajukan ke Manajer (draft/ditolak -> diajukan). Penerbitan nomor RAB terjadi setelah disetujui.
      const res = await api(`/sessions/${state.sessionId}/submit`, { method: "POST" });
      state.session = Object.assign(state.session || {}, res.session);
      showToast("RAB diajukan ke Manajer untuk persetujuan.");
      state.view = "approval";
      render();
      return;
    } catch (err) {
      const box = wrap.querySelector("#step5Error");
      box.textContent = err.message;
      box.style.display = "block";
      btn.disabled = false;
      btn.textContent = "Ajukan untuk persetujuan →";
    }
  });

  return wrap;
}

function srcChipClass(sumber) {
  if (sumber === "REKOMENDASI AI") return "src-ai";
  if (sumber === "DIEDIT SALES") return "src-edit";
  return "src-manual";
}

function matchBadge(pct) {
  if (pct == null) return `<span class="muted">—</span>`;
  const p = Math.round(pct);
  let cls = "match-high";
  if (p < 70) cls = "match-low";
  else if (p < 90) cls = "match-mid";
  return `<span class="match-badge ${cls}">${p}%</span>`;
}

// Di antara beberapa kandidat AI untuk kategori kebutuhan yang sama (ref),
// tandai kandidat dengan kecocokan tertinggi sebagai "Rekomendasi utama"
// dan sisanya sebagai "Alternatif" — supaya sales tahu mana pilihan AI yang paling disarankan.
function computeAltLabels(items) {
  const groups = {};
  items.forEach(it => {
    if (it.sumber !== "REKOMENDASI AI" || it.kecocokan == null) return;
    const key = it.ref || it.nama;
    (groups[key] = groups[key] || []).push(it);
  });
  
  Object.values(groups).forEach(group => {
    if (group.length <= 1) return;
    group.sort((a, b) => b.kecocokan - a.kecocokan);
    group[0].alt_label = "Rekomendasi utama";
    for (let i = 1; i < group.length; i++) group[i].alt_label = "Alternatif";
  });
}

function renderRekomBody(tbody) {
  if (!tbody) return;
  computeAltLabels(state.items);
  tbody.innerHTML = state.items.map(it => {
    const hargaNet = Math.max(0, (it.harga || 0) * (1 - (it.diskon_satuan || 0) / 100));
    const psbNet = Math.max(0, (it.psb || 0) * (1 - (it.diskon_psb || 0) / 100));
    const monthsMultiplier = it.periode === "Bulanan" ? (it.periode_bulan || 12) : 1;
    const rowTotalBulanan = hargaNet * (it.qty || 0); // per bulan — samakan dgn kolom "Total Bulanan" di Excel (tidak dikali durasi)
    const rowTotalBulananFull = hargaNet * monthsMultiplier * (it.qty || 0); // dikali durasi, dipakai utk Grand Total per baris
    const rowTotalPSB = psbNet * (it.qty || 0);
    const rowSubtotal = ((it.harga || 0) * monthsMultiplier + (it.psb || 0)) * (it.qty || 0);
    const subtotal = rowTotalBulananFull + rowTotalPSB;
    // Diskon Agregat: pakai persentase riil (tidak dibulatkan ke bilangan bulat) agar sesuai dengan angka aslinya.
    const diskonAgregatPct = rowSubtotal > 0 ? ((rowSubtotal - subtotal) / rowSubtotal) * 100 : 0;
    const currentKategori = it.kategori || "HSI";
    const kategoriOptions = ["HSI", "WMS", "Datin", "DBT", "CPE"];
    const currentJenisLayanan = it.jenis_layanan || "Connectivity";
    return `
      <tr data-id="${it.id}">
        <td style="position:relative;">
          <input type="text" class="nm-input" data-id="${it.id}" value="${escapeAttr(it.nama)}" autocomplete="off" style="border:1px solid transparent;background:transparent;font:inherit;width:100%;padding:4px 0;">
          <div class="nm-suggest" data-id="${it.id}"></div>
          ${it.alt_label ? `<div style="font-size:10px; color:var(--red-dark); font-weight:700;">${it.alt_label}</div>` : ""}
          ${(() => {
            const altReason = getAltLabelReason(it);
            return altReason ? `<div style="font-size:10px; color:var(--ink-soft); line-height:1.25; margin-top:2px;">${escapeAttr(altReason)}</div>` : "";
          })()}
          ${(() => {
            const reasoningText = getReasoningFallback(it);
            return reasoningText ? `<div style="font-size:10.5px; color:var(--ink-soft); line-height:1.2; margin-top:2px; font-style:italic;">${escapeAttr(reasoningText)}</div>` : "";
          })()}
        </td>
        <td><span class="src-chip ${srcChipClass(it.sumber)}">${it.sumber}</span></td>
        <td>
          <select class="jenis-layanan-select" data-id="${it.id}">
            <option value="Connectivity" ${currentJenisLayanan==="Connectivity"?"selected":""}>Connectivity</option>
            <option value="CPE" ${currentJenisLayanan==="CPE"?"selected":""}>CPE</option>
          </select>
        </td>
        <td><select class="kategori-select" data-id="${it.id}">${kategoriOptions.map(k => `<option ${currentKategori.toUpperCase()===k.toUpperCase()?"selected":""}>${escapeAttr(k)}</option>`).join("")}</select></td>
        <td><select class="satuan-select" data-id="${it.id}">${(() => {
          const options = ["unit","lokasi","link","site","port","slot","bundle"];
          if (it.satuan && !options.includes(it.satuan)) options.push(it.satuan);
          return options.map(u => `<option ${it.satuan===u?"selected":""}>${u}</option>`).join("");
        })()}</select></td>
        <td><div class="qty-control"><button class="qty-btn" data-act="dec" data-id="${it.id}">−</button><input type="number" class="qty-input" data-id="${it.id}" value="${it.qty}" min="0"><button class="qty-btn" data-act="inc" data-id="${it.id}">+</button></div></td>
        <td><select class="periode-select" data-id="${it.id}">${["Bulanan","Sekali bayar"].map(p => `<option ${it.periode===p?"selected":""}>${p}</option>`).join("")}</select></td>
        <td>
          <input type="number" class="bulan-input" data-id="${it.id}" value="${it.periode_bulan != null ? it.periode_bulan : (it.periode === 'Bulanan' ? 12 : 1)}" min="1" max="120" style="border:1px solid var(--line);border-radius:6px;padding:5px 8px;width:60px;font:inherit;" ${it.periode === 'Sekali bayar' ? 'disabled' : ''}>
        </td>
        <td><input type="text" class="hg-input" data-id="${it.id}" value="${Math.round(it.harga||0).toLocaleString('id-ID')}" style="border:1px solid var(--line);border-radius:6px;padding:5px 8px;width:95px;font:inherit;"></td>
        <td>
          <div style="display:flex; align-items:center; gap:4px;">
            <input type="number" class="diskon-satuan-input" data-id="${it.id}" value="${Math.round(it.diskon_satuan||0)}" min="0" max="100" style="border:1px solid var(--line);border-radius:6px;padding:5px 8px;width:55px;font:inherit;background:#FFF5F5;">
            <span style="font-size:12px; color:var(--ink-soft);">%</span>
          </div>
        </td>
        <td><input type="text" class="psb-input" data-id="${it.id}" value="${Math.round(it.psb||0).toLocaleString('id-ID')}" style="border:1px solid var(--line);border-radius:6px;padding:5px 8px;width:95px;font:inherit;"></td>
        <td>
          <div style="display:flex; align-items:center; gap:4px;">
            <input type="number" class="diskon-psb-input" data-id="${it.id}" value="${Math.round(it.diskon_psb||0)}" min="0" max="100" style="border:1px solid var(--line);border-radius:6px;padding:5px 8px;width:55px;font:inherit;background:#FFF5F5;">
            <span style="font-size:12px; color:var(--ink-soft);">%</span>
          </div>
        </td>
        <td><strong>${fmtRp(rowTotalBulanan)}</strong></td>
        <td><strong>${fmtRp(rowTotalPSB)}</strong></td>
        <td>${fmtRp(rowSubtotal)}</td>
        <td>${fmtPct(diskonAgregatPct)}</td>
        <td><strong>${fmtRp(subtotal)}</strong></td>
        <td><button class="link-danger" data-id="${it.id}" data-act="hapus">Hapus</button></td>
      </tr>`;
  }).join("") || `<tr><td colspan="18" class="muted" style="padding:20px;">Belum ada produk. Klik "+ Tambah produk manual" untuk menambahkan.</td></tr>`;

  async function patchItem(id, body) {
    const res = await api(`/sessions/${state.sessionId}/items/${id}`, { method: "PUT", body: JSON.stringify(body) });
    const idx = state.items.findIndex(x => x.id == id);
    if (idx >= 0) state.items[idx] = res.item;
    return res.item;
  }

  tbody.querySelectorAll(".qty-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const it = state.items.find(x => x.id == btn.dataset.id);
      if (!it) return;
      const newQty = btn.dataset.act === "inc" ? it.qty + 1 : Math.max(0, it.qty - 1);
      try { await patchItem(it.id, { qty: newQty }); renderRekomBody(tbody); updateTotal(tbody.closest(".screen")); }
      catch (err) { alert(err.message); }
    });
  });

  tbody.querySelectorAll(".qty-input").forEach(inp => {
    inp.addEventListener("focus", () => inp.select());
    inp.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        inp.blur();
      }
    });
    inp.addEventListener("change", async () => {
      let val = parseInt(inp.value, 10);
      if (isNaN(val) || val < 0) val = 0;
      try {
        await patchItem(inp.dataset.id, { qty: val });
        renderRekomBody(tbody);
        updateTotal(tbody.closest(".screen"));
      } catch (err) {
        alert(err.message);
      }
    });
  });

  tbody.querySelectorAll("[data-act='hapus']").forEach(btn => {
    btn.addEventListener("click", async () => {
      try {
        await api(`/sessions/${state.sessionId}/items/${btn.dataset.id}`, { method: "DELETE" });
        state.items = state.items.filter(x => x.id != btn.dataset.id);
        renderRekomBody(tbody);
        updateTotal(tbody.closest(".screen"));
      } catch (err) { alert(err.message); }
    });
  });

  tbody.querySelectorAll(".kategori-select").forEach(sel => {
    sel.addEventListener("change", async () => {
      try { await patchItem(sel.dataset.id, { kategori: sel.value }); renderRekomBody(tbody); }
      catch (err) { alert(err.message); }
    });
  });

  tbody.querySelectorAll(".jenis-layanan-select").forEach(sel => {
    sel.addEventListener("change", async () => {
      try { await patchItem(sel.dataset.id, { jenis_layanan: sel.value }); renderRekomBody(tbody); }
      catch (err) { alert(err.message); }
    });
  });

  tbody.querySelectorAll(".satuan-select").forEach(sel => {
    sel.addEventListener("change", async () => {
      try { await patchItem(sel.dataset.id, { satuan: sel.value }); renderRekomBody(tbody); }
      catch (err) { alert(err.message); }
    });
  });

  tbody.querySelectorAll(".periode-select").forEach(sel => {
    sel.addEventListener("change", async () => {
      try { await patchItem(sel.dataset.id, { periode: sel.value }); renderRekomBody(tbody); updateTotal(tbody.closest(".screen")); }
      catch (err) { alert(err.message); }
    });
  });

  tbody.querySelectorAll(".nm-input").forEach(inp => {
    inp.addEventListener("change", async () => {
      try {
        await patchItem(inp.dataset.id, { nama: inp.value });
        try {
          const lookup = await api(`/master-data/lookup?nama=${encodeURIComponent(inp.value)}`);
          if (lookup.found) {
            const p = lookup.product;
            const sheetMap = { wifi: "WMS", hsi: "HSI", datin: "Datin", dbt: "DBT" };
            const mappedKategori = sheetMap[p.sheet] || "HSI";
            const mappedJenisLayanan = p.sheet === "dbt" ? "CPE" : "Connectivity";

            const patch = {
              harga: p.harga,
              psb: p.psb || 0,
              kategori: mappedKategori,
              jenis_layanan: mappedJenisLayanan
            };
            if (p.satuan_hint) patch.satuan = p.satuan_hint;
            await patchItem(inp.dataset.id, patch);
            showToast(`Harga otomatis terisi dari master data (${p.layanan}${p.paket ? " — " + p.paket : ""})`, "success", 2400);
          }
        } catch (e) { /* lookup gagal, biarkan harga manual */ }
        renderRekomBody(tbody);
        updateTotal(tbody.closest(".screen"));
      }
      catch (err) { alert(err.message); }
    });
  });

  // ---- Autocomplete dropdown produk (sinkron master data saat mengetik) ----
  const nmSuggestDebounce = {};
  tbody.querySelectorAll(".nm-input").forEach(inp => {
    const id = inp.dataset.id;
    const dropdown = tbody.querySelector(`.nm-suggest[data-id="${id}"]`);
    if (!dropdown) return;

    const hideDropdown = () => { dropdown.classList.remove("show"); dropdown.innerHTML = ""; };

    const renderSuggestions = (rows) => {
      if (!rows.length) { hideDropdown(); return; }
      dropdown.innerHTML = rows.map(p => {
        const label = `${p.layanan || ""}${p.paket ? " — " + p.paket : ""}`;
        const meta = [p.mbps ? `${p.mbps} Mbps` : null, fmtRp(p.harga || 0), p.lokasi || null].filter(Boolean).join(" &middot; ");
        return `
          <div class="nm-suggest-item" data-id="${id}"
               data-nama="${escapeAttr(label)}" data-harga="${p.harga || 0}" data-psb="${p.psb || 0}"
               data-satuan="${escapeAttr(p.satuan_hint || "")}" data-sheet="${escapeAttr(p.sheet || "")}">
            <div class="ns-name">${escapeAttr(label)}</div>
            <div class="ns-meta">${meta}</div>
          </div>`;
      }).join("");
      dropdown.classList.add("show");
    };

    // q kosong ("") -> tampilkan semua produk dari katalog master data (dipakai saat kolom
    // produk baru masih kosong dan langsung diklik, supaya sales bisa memilih dari daftar lengkap).
    const fetchSuggestions = async (q) => {
      try {
        if (q.toLowerCase() === "produk baru") q = "";
        const limit = q ? (q.length < 3 ? 20 : 8) : 50;
        const res = await api(`/master-data?q=${encodeURIComponent(q)}&limit=${limit}`);
        renderSuggestions(res.rows || []);
      } catch (e) { hideDropdown(); }
    };

    inp.addEventListener("input", () => {
      clearTimeout(nmSuggestDebounce[id]);
      const q = inp.value.trim();
      if (q.length === 0 || q.toLowerCase() === "produk baru") {
        nmSuggestDebounce[id] = setTimeout(() => fetchSuggestions(""), 150);
        return;
      }
      nmSuggestDebounce[id] = setTimeout(() => fetchSuggestions(q), 250);
    });

    const openForEmptyOrQuery = () => {
      const q = inp.value.trim();
      fetchSuggestions(q);
    };
    inp.addEventListener("focus", () => {
      if (inp.value === "Produk baru") {
        inp.select();
      }
      openForEmptyOrQuery();
    });
    inp.addEventListener("click", () => {
      if (inp.value === "Produk baru") {
        inp.select();
      }
      openForEmptyOrQuery();
    });

    inp.addEventListener("blur", () => { setTimeout(hideDropdown, 150); });
    inp.addEventListener("keydown", (e) => { if (e.key === "Escape") hideDropdown(); });
  });

  // Delegated + reassigned tiap render supaya tidak menumpuk listener di tbody yang persist antar-render.
  tbody.onmousedown = async (e) => {
    const item = e.target.closest(".nm-suggest-item");
    if (!item) return;
    e.preventDefault(); // cegah blur duluan menghilangkan dropdown sebelum item ke-klik

    // Isi langsung nama lengkap produk yang diklik ke kotak input (feedback instan),
    // dan sembunyikan dropdown supaya tidak menggantung sebelum request ke server selesai.
    const targetInput = tbody.querySelector(`.nm-input[data-id="${item.dataset.id}"]`);
    if (targetInput) targetInput.value = item.dataset.nama;
    const targetDropdown = tbody.querySelector(`.nm-suggest[data-id="${item.dataset.id}"]`);
    if (targetDropdown) { targetDropdown.classList.remove("show"); targetDropdown.innerHTML = ""; }

    const sheetMap = { wifi: "WMS", hsi: "HSI", datin: "Datin", dbt: "DBT" };
    const mappedKategori = sheetMap[item.dataset.sheet] || "HSI";
    const mappedJenisLayanan = item.dataset.sheet === "dbt" ? "CPE" : "Connectivity";

    const patch = {
      nama: item.dataset.nama,
      harga: parseInt(item.dataset.harga, 10) || 0,
      psb: parseInt(item.dataset.psb, 10) || 0,
      kategori: mappedKategori,
      jenis_layanan: mappedJenisLayanan
    };
    if (item.dataset.satuan) patch.satuan = item.dataset.satuan;
    try {
      await patchItem(item.dataset.id, patch);
      showToast("Harga & nama produk otomatis terisi dari master data", "success", 2200);
      renderRekomBody(tbody);
      updateTotal(tbody.closest(".screen"));
    } catch (err) { alert(err.message); }
  };

  tbody.querySelectorAll(".hg-input").forEach(inp => {
    inp.addEventListener("change", async () => {
      const val = parseInt(inp.value.replace(/[^\d]/g, ""), 10) || 0;
      try { await patchItem(inp.dataset.id, { harga: val }); renderRekomBody(tbody); updateTotal(tbody.closest(".screen")); }
      catch (err) { alert(err.message); }
    });
  });

  tbody.querySelectorAll(".diskon-satuan-input").forEach(inp => {
    inp.addEventListener("change", async () => {
      const val = parseInt(inp.value, 10) || 0;
      try { await patchItem(inp.dataset.id, { diskon_satuan: val }); renderRekomBody(tbody); updateTotal(tbody.closest(".screen")); }
      catch (err) { alert(err.message); }
    });
  });

  tbody.querySelectorAll(".psb-input").forEach(inp => {
    inp.addEventListener("change", async () => {
      const val = parseInt(inp.value.replace(/[^\d]/g, ""), 10) || 0;
      try { await patchItem(inp.dataset.id, { psb: val }); renderRekomBody(tbody); updateTotal(tbody.closest(".screen")); }
      catch (err) { alert(err.message); }
    });
  });

  tbody.querySelectorAll(".diskon-psb-input").forEach(inp => {
    inp.addEventListener("change", async () => {
      const val = parseInt(inp.value, 10) || 0;
      try { await patchItem(inp.dataset.id, { diskon_psb: val }); renderRekomBody(tbody); updateTotal(tbody.closest(".screen")); }
      catch (err) { alert(err.message); }
    });
  });

  tbody.querySelectorAll(".bulan-input").forEach(inp => {
    inp.addEventListener("change", async () => {
      const val = parseInt(inp.value, 10) || 12;
      try { await patchItem(inp.dataset.id, { periode_bulan: val }); renderRekomBody(tbody); updateTotal(tbody.closest(".screen")); }
      catch (err) { alert(err.message); }
    });
  });
}

// Menjelaskan KENAPA sebuah item berlabel "Rekomendasi utama" atau "Alternatif":
// dibandingkan dengan item lain di grup kebutuhan (ref) yang sama, berdasarkan harga.
function getAltLabelReason(it) {
  if (!it.alt_label) return "";
  const key = it.ref || it.nama;
  const group = (state.items || []).filter(
    x => x.sumber === "REKOMENDASI AI" && x.kecocokan != null && (x.ref || x.nama) === key
  );
  if (group.length <= 1) return "";

  const mainItem = group.find(g => g.alt_label === "Rekomendasi utama") || group[0];

  if (it.alt_label === "Rekomendasi utama") {
    return "Rekomendasi utama: kombinasi harga & spesifikasi paling sesuai dengan kebutuhan/budget pelanggan dibanding pilihan lain di kategori ini.";
  }

  const diff = (it.harga || 0) - (mainItem.harga || 0);
  if (diff > 0) {
    return `Alternatif: spesifikasi lebih tinggi dari rekomendasi utama, dengan tambahan biaya ±${fmtRp(diff)}/bulan.`;
  }
  if (diff < 0) {
    return `Alternatif: harga ±${fmtRp(Math.abs(diff))}/bulan lebih hemat dari rekomendasi utama, cocok bila budget lebih ketat.`;
  }
  return "Alternatif: pilihan lain yang sepadan pada kategori kebutuhan yang sama.";
}

function getReasoningFallback(it) {
  if (it.reasoning) return it.reasoning;
  const kat = String(it.kategori || "").toUpperCase();
  const lay = String(it.jenis_layanan || "").toLowerCase();
  const nm = String(it.nama || "").toLowerCase();
  
  if (kat === "HSI" || nm.includes("hsi") || nm.includes("indihome")) {
    return "Internet broadband ekonomis dan cepat untuk operasional bisnis harian.";
  }
  if (kat === "WMS" || nm.includes("wms") || nm.includes("wifi managed")) {
    return "WiFi terkelola profesional untuk kemudahan akses internet karyawan & tamu/pelanggan.";
  }
  if (kat === "DATIN") {
    if (lay.includes("astinet") || nm.includes("astinet")) {
      return "Internet dedicated simetris dengan SLA tinggi untuk kestabilan bisnis & server.";
    }
    if (lay.includes("metro") || nm.includes("metro")) {
      return "Jaringan data private aman untuk menghubungkan antar kantor cabang.";
    }
    return "Layanan konektivitas data korporasi berkapasitas besar dan handal.";
  }
  if (kat === "DBT" || kat === "CPE" || nm.includes("eazy") || nm.includes("cctv") || nm.includes("pijar")) {
    if (lay.includes("antares") || lay.includes("cctv") || lay.includes("camera") || nm.includes("eazy") || nm.includes("cctv") || nm.includes("cam")) {
      return "Kamera pengawas pintar dengan perekaman berbasis cloud untuk keamanan 24 jam.";
    }
    if (lay.includes("pijar") || lay.includes("sekolah") || nm.includes("pijar")) {
      return "Platform pembelajaran digital (LMS) dan manajemen administrasi sekolah.";
    }
    return "Solusi bisnis digital Telkom untuk mendukung efisiensi operasional.";
  }
  return "Rekomendasi solusi internet sesuai dengan profil kebutuhan pelanggan.";
}

function escapeAttr(s) { return String(s).replace(/"/g, "&quot;"); }

function updateTotal(scope) {
  const elBulanan = (scope || document).querySelector("#totalHargaBulanan");
  const elPSB = (scope || document).querySelector("#totalHargaPSB");
  const elTotal = (scope || document).querySelector("#totalValue");
  const elBudget = (scope || document).querySelector("#budgetPerBulanValue");
  const elCompareNote = (scope || document).querySelector("#budgetCompareNote");
  const elTotalProject = (scope || document).querySelector("#totalProjectValue");

  // Detailed breakdown elements
  const elBreakdownGross = (scope || document).querySelector("#breakdownGross");
  const elBreakdownPagu = (scope || document).querySelector("#breakdownPagu");
  const elBreakdownSisa = (scope || document).querySelector("#breakdownSisa");
  const elBreakdownNet = (scope || document).querySelector("#breakdownNet");
  const elBreakdownPPN = (scope || document).querySelector("#breakdownPPN");
  const elBreakdownTotal = (scope || document).querySelector("#breakdownTotal");

  let bulananSum = 0;       // total tagihan bulanan (net diskon) — dipakai sebagai "Total Estimasi Penawaran (per bulan)"
  let bulananGrossSum = 0;  // total tagihan bulanan sebelum diskon, untuk menghitung persentase hemat
  let psbSum = 0;
  let subtotalSum = 0;
  let estimasiSum = 0;

  state.items.forEach(it => {
    const hargaNet = Math.max(0, (it.harga || 0) * (1 - (it.diskon_satuan || 0) / 100));
    const psbNet = Math.max(0, (it.psb || 0) * (1 - (it.diskon_psb || 0) / 100));
    const monthsMultiplier = it.periode === "Bulanan" ? (it.periode_bulan || 12) : 1;

    if (it.periode === "Bulanan") {
      bulananSum += hargaNet * (it.qty || 0);
      bulananGrossSum += (it.harga || 0) * (it.qty || 0);
    }
    psbSum += psbNet * (it.qty || 0);
    subtotalSum += ((it.harga || 0) * monthsMultiplier + (it.psb || 0)) * (it.qty || 0);
    estimasiSum += (hargaNet * monthsMultiplier + psbNet) * (it.qty || 0);
  });

  const savedAmount = subtotalSum - estimasiSum;
  const savedPct = subtotalSum > 0 ? (savedAmount / subtotalSum) * 100 : 0;
  const savedPctLabel = savedPct > 0 ? (savedPct < 1 ? savedPct.toFixed(1) : Math.round(savedPct)) : 0;

  if (elBulanan) elBulanan.textContent = fmtRp(bulananSum);
  if (elPSB) elPSB.textContent = fmtRp(psbSum);

  // 1. High-level indicators (Original style)
  if (elTotal) {
    if (savedPct > 0) {
      elTotal.innerHTML = `${fmtRp(bulananSum)} <span class="saved-badge">Hemat ${savedPctLabel}%</span>`;
    } else {
      elTotal.textContent = fmtRp(bulananSum);
    }
  }

  const budgetVal = parseFloat(state.session?.budget);
  if (elBudget) elBudget.textContent = (budgetVal > 0) ? fmtRp(budgetVal) : "Belum diisi";
  if (elTotalProject) elTotalProject.textContent = fmtRp(estimasiSum);

  if (elCompareNote) {
    if (!(budgetVal > 0)) {
      elCompareNote.textContent = "";
    } else if (bulananSum <= budgetVal) {
      elCompareNote.style.color = "#38A169";
      elCompareNote.textContent = `Sesuai budget (sisa ${fmtRp(budgetVal - bulananSum)}/bulan)`;
    } else {
      elCompareNote.style.color = "var(--red-dark)";
      elCompareNote.textContent = `Melebihi budget ${fmtRp(bulananSum - budgetVal)}/bulan`;
    }
  }

  // 2. Detailed SPH breakdown panel
  if (elBreakdownGross) elBreakdownGross.textContent = fmtRp(subtotalSum);
  if (elBreakdownPagu) elBreakdownPagu.textContent = budgetVal > 0 ? fmtRp(budgetVal) : "-";
  if (elBreakdownSisa) {
    if (budgetVal > 0) {
      const sisa = budgetVal - bulananSum;
      elBreakdownSisa.textContent = sisa >= 0 ? fmtRp(sisa) : "-" + fmtRp(Math.abs(sisa));
      elBreakdownSisa.style.color = sisa >= 0 ? "#38A169" : "var(--red-dark)";
    } else {
      elBreakdownSisa.textContent = "-";
      elBreakdownSisa.style.color = "var(--ink-soft)";
    }
  }
  if (elBreakdownNet) elBreakdownNet.textContent = fmtRp(estimasiSum);
  const ppnVal = Math.round(estimasiSum * 0.11);
  if (elBreakdownPPN) elBreakdownPPN.textContent = fmtRp(ppnVal);
  if (elBreakdownTotal) elBreakdownTotal.textContent = fmtRp(estimasiSum + ppnVal);

  // 3. Billing Perdana (tagihan pertama)
  // Rumus 1 — Bulan penuh: Total Estimasi Penawaran (per bulan) + Subtotal PSB
  // Rumus 2 — Proporsional: (Total Estimasi Penawaran per bulan ÷ 30 × sisa hari sejak tanggal pembuatan RAB) + Subtotal PSB
  const elBillingFull = (scope || document).querySelector("#billingPerdanaFullValue");
  const elBillingProrata = (scope || document).querySelector("#billingPerdanaProrataValue");
  const elBillingProrataNote = (scope || document).querySelector("#billingPerdanaProrataNote");

  const billingPerdanaFull = bulananSum + psbSum;

  const rabDate = new Date();
  const dayOfMonth = rabDate.getDate();
  // Billing Perdana Proporsional = (tanggal pembuatan RAB ÷ 30 × Total Estimasi per bulan) + Subtotal PSB
  const billingPerdanaProrata = (dayOfMonth / 30) * bulananSum + psbSum;

  if (elBillingFull) elBillingFull.textContent = fmtRp(billingPerdanaFull);
  if (elBillingProrata) elBillingProrata.textContent = fmtRp(billingPerdanaProrata);
  if (elBillingProrataNote) {
    elBillingProrataNote.textContent = `(${dayOfMonth} ÷ 30) × Total Estimasi + Subtotal PSB`;
  }
}

/* =========================================================
   STEP 6 — Power Automate (animasi; hasil sudah dari /approve)
   ========================================================= */
function renderStep6() {
  const wrap = document.createElement("div");
  wrap.innerHTML = `
    <h1>Memproses RAB secara otomatis</h1>
    <p class="desc">Sistem memvalidasi kelengkapan data dan menghitung PPN 11% secara otomatis.</p>
    <div class="checklist" id="paChecklist">
      <div class="check-item" data-i="0"><span class="mark"></span> Menerima data dari sesi review</div>
      <div class="check-item" data-i="1"><span class="mark"></span> Validasi format &amp; kelengkapan item</div>
      <div class="check-item" data-i="2"><span class="mark"></span> Menghitung total &amp; PPN 11%</div>
      <div class="check-item" data-i="3"><span class="mark"></span> Menyusun ke Template SE asli</div>
      <div class="check-item" data-i="4"><span class="mark"></span> RAB siap diunduh</div>
    </div>
  `;
  return wrap;
}

function runPowerAutomate() {
  let i = 0;
  const step = () => {
    const list = document.querySelectorAll("#paChecklist .check-item");
    if (!list.length) return;
    if (i > 0) { list[i - 1].classList.remove("active"); list[i - 1].classList.add("done"); }
    if (i < list.length) { list[i].classList.add("active"); i++; setTimeout(step, 500); }
    else { setTimeout(() => unlockAndGo(7), 400); }
  };
  setTimeout(step, 400);
}

/* =========================================================
   STEP 7 — Output RAB (unduh langsung dari API)
   ========================================================= */
function renderStep7() {
  const wrap = document.createElement("div");
  const totals = state.totals || { grand: 0, subtotal: 0, ppn: 0, grossSubtotal: 0 };
  
  // Hitung total gross di frontend untuk memastikan kecocokan pratinjau
  let grossSubtotal = 0;
  state.items.forEach(it => {
    const monthsMultiplier = it.periode === "Bulanan" ? (it.periode_bulan || 12) : 1;
    grossSubtotal += ((it.harga || 0) * monthsMultiplier + (it.psb || 0)) * (it.qty || 0);
  });
  totals.grossSubtotal = grossSubtotal;

  const fileBase = "RAB_" + (state.session.nama_pelanggan || "Pelanggan").replace(/[^a-zA-Z0-9]/g, "");
  const downloadUrl = `${API_BASE}/sessions/${state.sessionId}/rab.xlsx?token=${encodeURIComponent(state.token)}`;

  wrap.innerHTML = `
    <h1>RAB berhasil dibuat</h1>
    <p class="desc">Dokumen RAB resmi sudah siap, menggunakan format Surat Penawaran Harga (SPH) Telkom.</p>

    <div class="output-top-row">
      <div class="file-card">
        <div class="file-icon">XLSX</div>
        <div class="file-name">${fileBase}.xlsx</div>
        <div class="file-meta">${state.items.length} item &middot; Total ${fmtRp(totals.grand)}</div>
        <a class="btn btn-primary" href="${downloadUrl}" style="width:100%; justify-content:center; text-decoration:none;">Download Excel</a>
        <button class="btn btn-secondary" id="btnDownloadPdf" style="width:100%; justify-content:center; margin-top:8px;">Download PDF</button>
      </div>
      <div class="summary-card">
        <div class="sc-title">Ringkasan RAB</div>
        <div class="sc-row"><span class="k">Pelanggan</span><span class="v">${state.session.nama_pelanggan}</span></div>
        <div class="sc-row"><span class="k">Sales</span><span class="v">${state.user.name}</span></div>
        <div class="sc-row"><span class="k">Industri</span><span class="v">${state.session.industri || "-"}</span></div>
        <div class="sc-row"><span class="k">Witel</span><span class="v">${state.session.witel}</span></div>
        <div class="sc-row"><span class="k">No. RAB</span><span class="v">${state.session.rab_nomor || "-"}</span></div>
        <div class="sc-row"><span class="k">Dibuat pada</span><span class="v">${state.session.rab_tanggal || "-"}</span></div>
        <div class="sc-row"><span class="k">Pagu (per bulan)</span><span class="v">${state.session && state.session.budget ? fmtRp(state.session.budget) : "-"}</span></div>
        <div class="sc-row"><span class="k">Total estimasi</span><span class="v">${fmtRp(totals.grand)}</span></div>
      </div>
    </div>

    <div class="preview-card">
      <div class="preview-head"><span>Pratinjau — ${fileBase}.xlsx</span><span>No. ${state.session.rab_nomor || "-"} &bull; RAB SPH</span></div>
        <div class="preview-body" id="docPreview" style="overflow-x: auto;"></div>
      </div>

    <div class="actions-row">
      <button class="btn btn-secondary" id="btnBackTo5">← Kembali ke review</button>
      <button class="btn btn-ghost" id="btnRestart">Mulai sesi baru</button>
    </div>
  `;

  renderDocPreview(wrap.querySelector("#docPreview"), totals);
  if (window.SA_UI) window.SA_UI.enhanceOutput(wrap);
  wrap.querySelector("#btnBackTo5").addEventListener("click", () => goToStep(5));
  wrap.querySelector("#btnRestart").addEventListener("click", () => {
    if (confirm("Mulai sesi RAB baru? Sesi ini akan tetap tersimpan di Riwayat RAB.")) {
      resetSessionState();
      render();
    }
  });

  const btnPdf = wrap.querySelector("#btnDownloadPdf");
  if (btnPdf) {
    btnPdf.addEventListener("click", () => {
      const printHtml = `
        <html>
          <head>
            <meta charset="UTF-8" />
            <title>${fileBase}</title>
            <style>
              :root {
                --red: #E23744;
                --red-dark: #C82333;
                --ink: #1B1D21;
                --ink-soft: #5B5F66;
                --line: #E7E8EB;
                --bg: #F7F7F8;
                --radius: 10px;
              }
              * { box-sizing: border-box; }
              html, body { -webkit-print-color-adjust: exact; print-color-adjust: exact; color-adjust: exact; }
              body {
                position: relative;
                font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
                padding: 12mm;
                color: var(--ink);
                background: #fff;
                font-size: 10px;
              }
              /* Watermark: logo Telkom transparan (abu-abu gelap), 1 buah saja, memanjang secara diagonal di belakang isi dokumen */
              body::before {
                content: "";
                position: fixed;
                top: 50%;
                left: 50%;
                width: 340mm;
                height: 70mm;
                transform: translate(-50%, -50%) rotate(-30deg);
                background-image: url('${window.location.origin}/assets/telkom-logo.png');
                background-repeat: no-repeat;
                background-position: center;
                background-size: contain;
                opacity: 0.10;
                filter: grayscale(1) brightness(0.35);
                z-index: 0;
                pointer-events: none;
              }
              .doc-header, .doc-title, .doc-sub, .doc-meta, .doc-table, .doc-totals {
                position: relative;
                z-index: 1;
              }
              .doc-header {
                display: flex;
                justify-content: space-between;
                align-items: flex-start;
                margin-bottom: 12px;
              }
              .doc-logo {
                width: 22px;
                height: 22px;
                border-radius: 4px;
                background: var(--red);
                color: #fff;
                display: flex;
                align-items: center;
                justify-content: center;
                font-weight: 800;
                font-size: 10px;
              }
              .doc-num {
                text-align: right;
                color: var(--ink-soft);
                font-size: 9px;
                line-height: 1.3;
              }
              .doc-title {
                font-size: 14px;
                font-weight: 800;
                margin: 4px 0 2px 0;
              }
              .doc-sub {
                font-size: 9.5px;
                color: var(--ink-soft);
                margin-bottom: 12px;
              }
              .doc-meta {
                display: grid;
                grid-template-columns: repeat(4, 1fr);
                gap: 4px 15px;
                font-size: 9.5px;
                margin-bottom: 12px;
                background: #F7F7F8;
                padding: 10px;
                border-radius: 6px;
                border: 1px solid #E7E8EB;
              }
              .doc-meta div {
                font-size: 9.5px;
                line-height: 1.3;
              }
              .doc-meta .k {
                color: var(--ink-soft);
              }
              .doc-table {
                width: 100%;
                table-layout: fixed;
                border-collapse: collapse;
                font-size: 8.5px;
                margin-bottom: 12px;
              }
              .doc-table th {
                text-align: left;
                padding: 5px 4px;
                border-bottom: 1.5px solid var(--ink);
                font-size: 7.5px;
                text-transform: uppercase;
                color: var(--ink-soft);
                overflow-wrap: break-word;
              }
              .doc-table td {
                padding: 5px 4px;
                border-bottom: 1px solid var(--line);
                vertical-align: top;
                overflow-wrap: break-word;
              }
              .doc-table th:first-child, .doc-table td:first-child { padding-left: 0; }
              .doc-table th:last-child, .doc-table td:last-child { padding-right: 0; }
              .doc-table td.num, .doc-table th.num {
                text-align: right;
              }
              /* Lebar tiap kolom dikunci agar proporsional dan tidak berdempetan */
              .doc-table th:nth-child(1), .doc-table td:nth-child(1) { width: 21%; }   /* Produk */
              .doc-table th:nth-child(2), .doc-table td:nth-child(2) { width: 6%; }    /* Qty */
              .doc-table th:nth-child(3), .doc-table td:nth-child(3) { width: 7%; }    /* Kontrak */
              .doc-table th:nth-child(4), .doc-table td:nth-child(4) { width: 11%; }   /* Harga Bln */
              .doc-table th:nth-child(5), .doc-table td:nth-child(5) { width: 7%; }    /* Diskon Bln */
              .doc-table th:nth-child(6), .doc-table td:nth-child(6) { width: 10%; }   /* PSB */
              .doc-table th:nth-child(7), .doc-table td:nth-child(7) { width: 8%; }    /* Diskon PSB */
              .doc-table th:nth-child(8), .doc-table td:nth-child(8) { width: 11%; }   /* Subtotal */
              .doc-table th:nth-child(9), .doc-table td:nth-child(9) { width: 9%; }    /* Diskon Agregat */
              .doc-table th:nth-child(10), .doc-table td:nth-child(10) { width: 10%; } /* Grand Total */
              .doc-row-meta {
                display: block;
                color: var(--ink-soft);
                font-size: 8px;
                margin-top: 2px;
              }
              .doc-table tbody tr.section-row td {
                padding: 6px 6px;
                background: #F7FAFC;
                color: var(--ink);
                font-weight: 700;
                border-bottom: 1px solid var(--line);
              }
              .doc-totals {
                display: grid;
                grid-template-columns: max-content max-content;
                column-gap: 14px;
                row-gap: 6px;
                justify-content: end;
                margin-top: 6px;
              }
              .doc-total {
                display: contents;
              }
              .doc-total .lab {
                font-size: 9px;
                text-transform: uppercase;
                color: var(--ink-soft);
                font-weight: 700;
                text-align: right;
                justify-self: end;
              }
              .doc-total .val {
                font-size: 13px;
                font-weight: 800;
                color: var(--red);
                text-align: left;
                justify-self: start;
              }
              @media print {
                @page { size: A4 portrait; margin: 0; }
                body { padding: 10mm 12mm; }
              }
            </style>
          </head>
          <body>
            ${wrap.querySelector("#docPreview").innerHTML}
            <script>
              window.onload = function() {
                window.print();
                setTimeout(() => { window.close(); }, 500);
              };
            </script>
          </body>
        </html>
      `;
      // Buka lewat Blob URL (bukan window.open("", "_blank") + document.write) supaya tab
      // baru langsung punya alamat & judul dokumen yang benar, tidak sempat menampilkan "about:blank".
      const blob = new Blob([printHtml], { type: "text/html;charset=utf-8" });
      const blobUrl = URL.createObjectURL(blob);
      const printWindow = window.open(blobUrl, "_blank");
      if (printWindow) {
        printWindow.addEventListener("load", () => setTimeout(() => URL.revokeObjectURL(blobUrl), 1000));
      } else {
        URL.revokeObjectURL(blobUrl);
      }
    });
  }

  return wrap;
}

function renderDocPreview(container, totals) {
  const connectivity = state.items.filter(it => it.periode === "Bulanan");
  const cpe = state.items.filter(it => it.periode === "Sekali bayar");
  
  const rowsHtml = (arr) => arr.map(it => {
    const hargaNet = Math.max(0, (it.harga || 0) * (1 - (it.diskon_satuan || 0) / 100));
    const psbNet = Math.max(0, (it.psb || 0) * (1 - (it.diskon_psb || 0) / 100));
    const monthsMultiplier = it.periode === "Bulanan" ? (it.periode_bulan || 12) : 1;
    
    const rowSubtotal = ((it.harga || 0) * monthsMultiplier + (it.psb || 0)) * (it.qty || 0);
    const rowGrandTotal = (hargaNet * monthsMultiplier + psbNet) * (it.qty || 0);
    // Diskon Agregat: pakai persentase riil (tidak dibulatkan ke bilangan bulat) agar sesuai dengan angka aslinya.
    const diskonAgregatPct = rowSubtotal > 0 ? ((rowSubtotal - rowGrandTotal) / rowSubtotal) * 100 : 0;
    
    return `<tr>
      <td><strong>${it.nama}</strong><br><small class="doc-row-meta">${escapeAttr(it.kategori || "HSI")} &bull; ${escapeAttr(it.jenis_layanan || "Connectivity")}</small></td>
      <td class="num">${it.qty} ${escapeAttr(it.satuan)}</td>
      <td class="num">${it.periode === "Bulanan" ? `${monthsMultiplier} Bln` : "1x"}</td>
      <td class="num">${fmtRp(it.harga || 0)}</td>
      <td class="num">${it.diskon_satuan || 0}%</td>
      <td class="num">${fmtRp(it.psb || 0)}</td>
      <td class="num">${it.diskon_psb || 0}%</td>
      <td class="num">${fmtRp(rowSubtotal)}</td>
      <td class="num">${fmtPct(diskonAgregatPct)}</td>
      <td class="num"><strong>${fmtRp(rowGrandTotal)}</strong></td>
    </tr>`;
  }).join("");

  const savedAmount = totals.grossSubtotal - totals.subtotal;
  const savedPct = totals.grossSubtotal > 0 ? (savedAmount / totals.grossSubtotal) * 100 : 0;
  const savedPctLabel = savedPct > 0 ? (savedPct < 1 ? savedPct.toFixed(1) : Math.round(savedPct)) : 0;

  // Hitung estimasi per bulan (untuk perbandingan dengan budget per bulan)
  const monthlyEst = state.items.reduce((s, it) => {
    if (it.periode !== "Bulanan") return s;
    const hargaNet = Math.max(0, (it.harga || 0) * (1 - (it.diskon_satuan || 0) / 100));
    return s + (hargaNet * (it.qty || 0));
  }, 0);
  const paguPerBulan = state.session && state.session.budget ? parseFloat(state.session.budget) : 0;
  const sisaPerBulan = paguPerBulan - monthlyEst;

  container.innerHTML = `
    <div class="doc-header">
      <div class="doc-logo">T</div>
      <div class="doc-num">No. ${state.session.rab_nomor || "-"}<br>${state.session.rab_tanggal || ""}</div>
    </div>
    <div class="doc-title">Rencana Anggaran Biaya</div>
    <div class="doc-sub">Telkom Indonesia — ${state.session.witel}</div>
    <div class="doc-meta">
      <div><span class="k">Pelanggan</span><br><strong>${state.session.nama_pelanggan}</strong></div>
      <div><span class="k">Sales</span><br><strong>${state.user.name}</strong></div>
      <div><span class="k">Industri</span><br><strong>${state.session.industri || "-"}</strong></div>
      <div><span class="k">Witel</span><br><strong>${state.session.witel}</strong></div>
    </div>
    <table class="doc-table">
      <thead>
        <tr>
          <th>Produk</th>
          <th class="num">Qty</th>
          <th class="num">Kontrak</th>
          <th class="num">Harga Bln</th>
          <th class="num">Diskon Bln</th>
          <th class="num">PSB</th>
          <th class="num">Diskon PSB</th>
          <th class="num">Subtotal</th>
          <th class="num">Diskon Agregat (%)</th>
          <th class="num">Grand Total</th>
        </tr>
      </thead>
      <tbody>
        ${connectivity.length ? `<tr><td colspan="10" class="section-row">CONNECTIVITY</td></tr>${rowsHtml(connectivity)}` : ""}
        ${cpe.length ? `<tr><td colspan="10" class="section-row">CPE</td></tr>${rowsHtml(cpe)}` : ""}
      </tbody>
    </table>
    <div class="doc-totals">
      <div class="doc-total"><span class="lab">Subtotal (Gross)</span><span class="val" style="color:var(--ink); font-size:13px; font-weight:600;">${fmtRp(totals.grossSubtotal)}</span></div>
      ${paguPerBulan > 0 ? `<div class="doc-total"><span class="lab">Pagu (per bulan)</span><span class="val">${fmtRp(paguPerBulan)}</span></div>` : ""}
      ${sisaPerBulan != null ? `<div class="doc-total"><span class="lab">Sisa (per bulan)</span><span class="val" style="color:${sisaPerBulan>=0?"var(--ink)":"var(--red)"};">${sisaPerBulan>=0?fmtRp(sisaPerBulan):"-"+fmtRp(Math.abs(sisaPerBulan))}</span></div>` : ""}
      ${savedAmount > 0 ? `<div class="doc-total"><span class="lab">Hemat (${savedPctLabel}%)</span><span class="val" style="color:#38A169; font-size:13px; font-weight:600;">-${fmtRp(savedAmount)}</span></div>` : ""}
      <div class="doc-total"><span class="lab">Subtotal (Net)</span><span class="val" style="color:var(--ink); font-size:13px; font-weight:600;">${fmtRp(totals.subtotal)}</span></div>
      <div class="doc-total"><span class="lab">PPN 11%</span><span class="val" style="color:var(--ink); font-size:13px; font-weight:600;">${fmtRp(totals.ppn)}</span></div>
      <div class="doc-total"><span class="lab">Total estimasi</span><span class="val">${fmtRp(totals.grand)}</span></div>
    </div>
  `;
}

function startTour() {
  const tourSteps = [
    {
      title: "Dashboard Utama",
      emoji: "📊",
      text: "Selamat datang di aplikasi Sales Assist. Halaman Dashboard Utama menyajikan ringkasan kinerja penjualan, grafik pencapaian target berdasarkan kategori layanan (HSI, WMS, Datin, dan DBT), serta daftar riwayat dokumen RAB terbaru Anda."
    },
    {
      title: "Input Kebutuhan Pelanggan (Langkah 1)",
      emoji: "✍️",
      text: "Merupakan tahap awal dalam penyusunan RAB. Silakan lengkapi informasi profil pelanggan, jenis industri, witel asal, target anggaran (budget), jangka waktu kontrak, serta deskripsi spesifik mengenai kebutuhan solusi telekomunikasi pelanggan."
    },
    {
      title: "Analisis AI (Langkah 2)",
      emoji: "🤖",
      text: "Sistem kecerdasan buatan (AI) akan memproses dan menganalisis deskripsi kebutuhan pelanggan guna mendeteksi kata kunci (*keywords*) utama serta mencocokkan produk secara otomatis dengan katalog resmi Telkom."
    },
    {
      title: "Tabel Rekomendasi (Langkah 4)",
      emoji: "📋",
      text: "Pada langkah ini, sistem menampilkan rekomendasi produk usulan awal beserta persentase tingkat akurasi kecocokan (*match rate*). Anda dapat meninjau kesesuaian produk sebelum melangkah ke proses berikutnya."
    },
    {
      title: "Review & Edit Rekomendasi (Langkah 5)",
      emoji: "✏️",
      text: "Merupakan pusat penyesuaian penawaran RAB. Pada tahap ini, Anda dapat:<br>• Memilih kategori produk dan jenis layanan (Connectivity/CPE) melalui dropdown.<br>• Mengatur harga bulanan, biaya PSB, durasi kontrak (TOP), dan kuantitas unit.<br>• Menerapkan <strong>persentase diskon (%)</strong> secara manual.<br>• Memantau kalkulasi Subtotal, nilai penghematan, dan Grand Total secara real-time.<br>• Memperbarui draf kebutuhan pelanggan dan menekan tombol <strong>Generate</strong> untuk melakukan analisis ulang oleh AI secara langsung."
    },
    {
      title: "Proses RAB (Langkah 6)",
      emoji: "⚙️",
      text: "Sistem akan mengompilasi seluruh data penawaran yang telah disetujui guna menyusun draf Surat Penawaran Harga (SPH) resmi Telkom Indonesia secara otomatis."
    },
    {
      title: "Output RAB (Langkah 7)",
      emoji: "📥",
      text: "Dokumen penawaran Anda telah selesai diproses. Anda dapat mengunduh dokumen penawaran resmi dalam format <strong>Excel (.xlsx)</strong> atau menyimpannya secara praktis sebagai file <strong>PDF</strong> satu halaman siap kirim yang telah dioptimalkan."
    },
    {
      title: "Master Data & Riwayat",
      emoji: "💾",
      text: "Anda juga dapat mengelola basis data katalog produk melalui menu <strong>Master data produk</strong>, atau meninjau draf penawaran yang telah disimpan sebelumnya melalui menu <strong>Riwayat RAB</strong>."
    }
  ];

  let currentTourIdx = 0;

  // Hapus overlay lama jika ada
  const existing = document.querySelector(".tour-overlay");
  if (existing) existing.remove();

  const overlay = document.createElement("div");
  overlay.className = "tour-overlay";

  function renderTourStep() {
    const step = tourSteps[currentTourIdx];
    overlay.innerHTML = `
      <div class="tour-card">
        <div class="tour-header">
          <div class="tour-title">
            <span>${step.emoji}</span>
            <span>${step.title}</span>
          </div>
          <span class="tour-progress">Langkah ${currentTourIdx + 1} dari ${tourSteps.length}</span>
        </div>
        <div class="tour-body">
          <div class="tour-graphic">${step.emoji}</div>
          <p>${step.text}</p>
        </div>
        <div class="tour-footer">
          <button class="btn btn-ghost" id="tourBtnSkip" style="padding: 6px 12px; font-size:12px;">Tutup</button>
          <div class="tour-btns">
            ${currentTourIdx > 0 ? `<button class="btn btn-secondary" id="tourBtnPrev" style="padding: 6px 12px; font-size:12px;">Sebelumnya</button>` : ""}
            <button class="btn btn-primary" id="tourBtnNext" style="padding: 6px 12px; font-size:12px;">
              ${currentTourIdx === tourSteps.length - 1 ? "Selesai" : "Selanjutnya"}
            </button>
          </div>
        </div>
      </div>
    `;

    overlay.querySelector("#tourBtnSkip").addEventListener("click", () => overlay.remove());
    
    const btnPrev = overlay.querySelector("#tourBtnPrev");
    if (btnPrev) {
      btnPrev.addEventListener("click", () => {
        currentTourIdx--;
        renderTourStep();
      });
    }

    overlay.querySelector("#tourBtnNext").addEventListener("click", () => {
      if (currentTourIdx === tourSteps.length - 1) {
        overlay.remove();
        showToast("Tour selesai! Selamat menggunakan Sales Assist.", "success");
      } else {
        currentTourIdx++;
        renderTourStep();
      }
    });
  }

  document.body.appendChild(overlay);
  renderTourStep();
}