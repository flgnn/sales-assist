/* =========================================================
   SALES ASSIST 2.0 — modul baru di atas aplikasi KP
   Persetujuan berjenjang, penawaran PDF/email, pipeline,
   master data (Admin), audit log, manajemen pengguna.
   Memakai global dari app.js: state, api, showToast, fmtRp, render, unlockAndGo, runPowerAutomate, openSession.
   Semua data dinamis di-escape (esc) sebelum masuk innerHTML.
   ========================================================= */
(function () {
  const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const role = () => (state.user ? state.user.role : null);
  const isOwner = (s) => s && state.user && s.user_id === state.user.id;
  const tokenQs = () => `token=${encodeURIComponent(state.token)}`;
  const wib = (d) => (d ? fmtWib(d, { dateStyle: "medium", timeStyle: "short" }) : "-");

  const APPROVAL_LABEL = { draft: "Draft", diajukan: "Menunggu persetujuan", disetujui: "Disetujui", ditolak: "Ditolak" };
  const STAGE_LABEL = { prospek: "Prospek", penawaran: "Penawaran", negosiasi: "Negosiasi", menang: "Menang", kalah: "Kalah" };
  const NEXT = { prospek: ["penawaran", "kalah"], penawaran: ["negosiasi", "menang", "kalah"], negosiasi: ["penawaran", "menang", "kalah"], menang: [], kalah: [] };
  const chip = (status) => `<span class="sa-chip sa-${esc(status)}">${esc(APPROVAL_LABEL[status] || STAGE_LABEL[status] || status)}</span>`;
  const rp = (n) => fmtRp(n);

  function node(html) { const d = document.createElement("div"); d.innerHTML = html; return d; }

  /* ---------- Modal ---------- */
  function modal(title, bodyHtml, { wide = false } = {}) {
    const ov = document.createElement("div");
    ov.className = "sa-modal-overlay";
    ov.innerHTML = `<div class="sa-modal ${wide ? "wide" : ""}" role="dialog" aria-modal="true"><div class="sa-modal-head"><strong>${esc(title)}</strong><button class="icon-btn" data-close aria-label="Tutup">✕</button></div><div class="sa-modal-body">${bodyHtml}</div></div>`;
    const close = () => ov.remove();
    ov.addEventListener("click", (e) => { if (e.target === ov || e.target.hasAttribute("data-close")) close(); });
    document.body.appendChild(ov);
    return { el: ov.querySelector(".sa-modal-body"), close };
  }

  /* ---------- Navigasi per peran ---------- */
  const NAV = {
    sales: [["pipeline", "Pipeline penjualan"]],
    manager: [["approvals", "Persetujuan RAB"], ["pipeline", "Pipeline tim"], ["audit", "Audit log"]],
    admin: [["masteradmin", "Kelola master data"], ["users", "Pengguna & peran"], ["audit", "Audit log"], ["pipeline", "Pipeline (baca)"]]
  };
  window.SA_TITLES = { approvals: "Persetujuan RAB", approval: "Status persetujuan", pipeline: "Pipeline penjualan", masteradmin: "Kelola master data", audit: "Audit log", users: "Pengguna & peran" };

  window.SA_NAV = {
    build() {
      const box = document.getElementById("roleNav");
      if (!box) return;
      const items = NAV[role()] || [];
      box.style.display = items.length ? "" : "none";
      box.innerHTML = items.map(([key, label]) => `<div class="step" data-sa-view="${key}"><span class="step-dot"></span><span class="step-label">${esc(label)}</span></div>`).join("");
      box.querySelectorAll("[data-sa-view]").forEach((b) => b.addEventListener("click", () => { state.view = b.dataset.saView; render(); }));
    },
    sync() {
      document.querySelectorAll("#roleNav [data-sa-view]").forEach((b) => b.classList.toggle("active", state.view === b.dataset.saView));
    }
  };

  /* =========================================================
     VIEW: status persetujuan satu RAB
     ========================================================= */
  async function renderApproval() {
    const wrap = document.createElement("div");
    wrap.innerHTML = `<div class="muted" style="padding:20px;">Memuat…</div>`;
    try {
      const [detail, audit, trace] = await Promise.all([
        api(`/sessions/${state.sessionId}`), api(`/sessions/${state.sessionId}/audit`), api(`/sessions/${state.sessionId}/price-trace`)
      ]);
      const s = detail.session;
      state.session = s; state.items = detail.items; state.totals = detail.totals;
      const owner = isOwner(s);
      const traceById = Object.fromEntries(trace.items.map((t) => [t.item_id, t]));

      const itemRows = detail.items.map((it) => {
        const t = traceById[it.id] || {};
        const ver = t.tracked ? `v${t.versi_acuan}${t.harga_berubah_sejak_rab ? ` <span class="sa-warn" title="Harga master sudah berubah ke v${t.versi_terkini}">⚠ kini v${t.versi_terkini}</span>` : ""}${t.diedit_sales ? ` <span class="sa-note" title="Harga di RAB berbeda dari master">diedit</span>` : ""}` : `<span class="muted">manual</span>`;
        return `<tr><td>${esc(it.nama)}</td><td>${it.qty}</td><td>${rp(it.harga)}</td><td>${rp(it.psb)}</td><td>${ver}</td></tr>`;
      }).join("");
      const timeline = audit.rows.slice().reverse().map((a) => `<li><span class="sa-tl-dot"></span><div><strong>${esc(a.action.replace("session.", ""))}</strong>${a.from_value ? ` <span class="muted">${esc(a.from_value)} → ${esc(a.to_value || "")}</span>` : a.to_value ? ` <span class="muted">${esc(a.to_value)}</span>` : ""}<div class="muted">${esc(a.actor_name)} (${esc(a.actor_role)}) · ${esc(wib(a.created_at))}${a.note ? `<br>“${esc(a.note)}”` : ""}</div></div></li>`).join("");

      let actions = "";
      if (role() === "manager" && !owner && s.approval_status === "diajukan") {
        actions = `<div class="sa-card"><h3>Keputusan Manajer</h3>
          <textarea id="decNote" rows="3" placeholder="Catatan keputusan (wajib bila menolak)"></textarea>
          <div class="sa-row"><button class="btn btn-primary" id="btnApproveRab">Setujui</button><button class="btn btn-secondary" id="btnRejectRab">Tolak</button></div></div>`;
      } else if (owner && s.approval_status === "diajukan") {
        actions = `<div class="sa-card"><h3>Menunggu Manajer</h3><p class="muted">RAB terkunci selama peninjauan.</p><button class="btn btn-secondary" id="btnRecall">Tarik pengajuan</button></div>`;
      } else if (owner && s.approval_status === "disetujui" && s.status !== "completed") {
        actions = `<div class="sa-card"><h3>RAB disetujui</h3><p class="muted">Terbitkan nomor RAB dan dokumen penawaran.</p><button class="btn btn-primary" id="btnPublish">Terbitkan RAB →</button></div>`;
      } else if (owner && s.status === "completed") {
        actions = `<div class="sa-card"><h3>RAB sudah diterbitkan</h3><button class="btn btn-primary" id="btnOutput">Buka output &amp; kirim penawaran →</button></div>`;
      } else if (owner && ["draft", "ditolak"].includes(s.approval_status)) {
        actions = `<div class="sa-card"><button class="btn btn-secondary" id="btnBackReview">← Kembali ke review</button></div>`;
      }

      wrap.innerHTML = `
        <h1>${esc(s.nama_pelanggan)} ${chip(s.approval_status)}</h1>
        <p class="desc">${esc(s.industri || "-")} · ${esc(s.witel || "")} · diajukan ${esc(wib(s.submitted_at))}${s.decision_note ? ` · catatan: “${esc(s.decision_note)}”` : ""}</p>
        <div class="sa-grid">
          <div>
            <div class="sa-card"><h3>Rincian RAB</h3>
              <div class="table-wrap"><table><thead><tr><th>Item</th><th>Qty</th><th>Harga/bln</th><th>PSB</th><th>Versi harga</th></tr></thead><tbody>${itemRows}</tbody></table></div>
              <div class="sa-totals"><span>Subtotal ${rp(detail.totals.subtotal)}</span><span>PPN 11% ${rp(detail.totals.ppn)}</span><strong>Total ${rp(detail.totals.grand)}</strong></div>
              <a class="btn btn-ghost" target="_blank" rel="noopener" href="/api/sessions/${s.id}/quotation.pdf?${tokenQs()}">Pratinjau SPH (PDF)</a>
            </div>
          </div>
          <div>${actions}
            <div class="sa-card"><h3>Jejak audit</h3><ul class="sa-timeline">${timeline || '<li class="muted">Belum ada.</li>'}</ul></div>
          </div>
        </div>`;

      const on = (id, fn) => { const b = wrap.querySelector("#" + id); if (b) b.addEventListener("click", fn); };
      const run = (btn, fn) => async () => { btn.disabled = true; try { await fn(); } catch (e) { showToast(e.message, "error", 4000); btn.disabled = false; } };
      const decide = (decision) => async function () {
        const note = wrap.querySelector("#decNote").value.trim();
        if (decision === "reject" && note.length < 5) throw new Error("Penolakan wajib disertai catatan (min. 5 karakter).");
        await api(`/sessions/${s.id}/decision`, { method: "POST", body: JSON.stringify({ decision, note }) });
        showToast(decision === "approve" ? "RAB disetujui." : "RAB ditolak.");
        state.view = "approvals"; render();
      };
      const ap = wrap.querySelector("#btnApproveRab"), rj = wrap.querySelector("#btnRejectRab");
      if (ap) ap.addEventListener("click", run(ap, decide("approve")));
      if (rj) rj.addEventListener("click", run(rj, decide("reject")));
      const rc = wrap.querySelector("#btnRecall");
      if (rc) rc.addEventListener("click", run(rc, async () => { await api(`/sessions/${s.id}/recall`, { method: "POST" }); state.session.approval_status = "draft"; unlockAndGo(5); }));
      const pb = wrap.querySelector("#btnPublish");
      if (pb) pb.addEventListener("click", run(pb, async () => {
        const res = await api(`/sessions/${s.id}/approve`, { method: "POST" });
        state.session.rab_nomor = res.rab_nomor; state.session.rab_tanggal = res.rab_tanggal; state.session.status = "completed"; state.totals = res.totals;
        unlockAndGo(6); runPowerAutomate();
      }));
      on("btnOutput", () => { state.maxUnlocked = 7; unlockAndGo(7); });
      on("btnBackReview", () => unlockAndGo(5));
    } catch (e) {
      wrap.innerHTML = `<div class="notice dark">Gagal memuat: ${esc(e.message)}</div>`;
    }
    return wrap;
  }

  /* =========================================================
     VIEW: antrean persetujuan (Manajer/Admin)
     ========================================================= */
  function renderApprovals() {
    const wrap = document.createElement("div");
    let status = "diajukan";
    wrap.innerHTML = `<h1>Persetujuan RAB</h1><p class="desc">Tinjau RAB yang diajukan Sales. Penolakan wajib disertai catatan; setiap keputusan tercatat di audit log.</p>
      <div class="master-tabs" id="apTabs">${[["diajukan", "Menunggu"], ["disetujui", "Disetujui"], ["ditolak", "Ditolak"], ["all", "Semua"]].map(([k, l]) => `<div class="mtab ${k === status ? "active" : ""}" data-k="${k}">${l}</div>`).join("")}</div>
      <div class="table-wrap"><div class="scroll-table" id="apBody"></div></div>`;
    async function load() {
      const body = wrap.querySelector("#apBody");
      body.innerHTML = `<div class="muted" style="padding:20px;">Memuat…</div>`;
      try {
        const { approvals } = await api(`/approvals?status=${status}`);
        body.innerHTML = `<table><thead><tr><th>Pelanggan</th><th>Sales</th><th>Total</th><th>Status</th><th>Diajukan</th><th></th></tr></thead><tbody>${approvals.map((a) => `<tr><td>${esc(a.nama_pelanggan)}<div class="muted">${esc(a.rab_nomor || "")}</div></td><td>${esc(a.sales_name)}</td><td>${rp(a.total)}</td><td>${chip(a.approval_status)}</td><td>${esc(wib(a.submitted_at))}</td><td><button class="btn btn-secondary" data-id="${a.id}">Buka</button></td></tr>`).join("") || `<tr><td colspan="6" class="muted">Tidak ada data.</td></tr>`}</tbody></table>`;
        body.querySelectorAll("[data-id]").forEach((b) => b.addEventListener("click", () => { state.sessionId = Number(b.dataset.id); state.view = "approval"; render(); }));
      } catch (e) { body.innerHTML = `<div class="notice dark">${esc(e.message)}</div>`; }
    }
    wrap.querySelectorAll("#apTabs .mtab").forEach((t) => t.addEventListener("click", () => {
      status = t.dataset.k; wrap.querySelectorAll("#apTabs .mtab").forEach((x) => x.classList.toggle("active", x === t)); load();
    }));
    load();
    return wrap;
  }

  /* =========================================================
     VIEW: pipeline penjualan
     ========================================================= */
  function renderPipeline() {
    const wrap = document.createElement("div");
    const canWrite = role() === "sales" || role() === "manager";
    wrap.innerHTML = `<h1>Pipeline penjualan</h1><p class="desc">Prospek → Penawaran → Negosiasi → Menang / Kalah. Win rate = menang ÷ (menang + kalah) pada peluang yang sudah final.</p>
      <div id="plSummary" class="sa-cards"></div><div id="plReminders"></div>
      ${canWrite ? `<div class="sa-card"><h3>Tambah peluang</h3><div class="sa-form">
        <input id="plNama" placeholder="Nama pelanggan" maxlength="150"><input id="plNilai" type="number" min="0" placeholder="Nilai (Rp)"><input id="plFollow" type="date" title="Tindak lanjut berikutnya"><button class="btn btn-primary" id="plAdd">Tambah</button></div></div>` : ""}
      <div id="plBoard" class="sa-board"></div>`;
    async function load() {
      try {
        const [sum, list, rem] = await Promise.all([api("/pipeline/summary"), api("/pipeline"), api("/pipeline/reminders?days=7")]);
        const wr = sum.win_rate == null ? "–" : (sum.win_rate * 100).toFixed(0) + "%";
        wrap.querySelector("#plSummary").innerHTML = [["Nilai pipeline terbuka", rp(sum.open_value), `${sum.open_count} peluang`], ["Win rate", wr, `${sum.won_count} menang · ${sum.lost_count} kalah`], ["Nilai menang", rp(sum.won_value), ""], ["Pengingat", `${sum.reminders.overdue + sum.reminders.today}`, `${sum.reminders.overdue} terlambat · ${sum.reminders.today} hari ini`]]
          .map(([k, v, h]) => `<div class="sa-stat"><div class="muted">${esc(k)}</div><div class="sa-stat-v">${esc(v)}</div><div class="muted">${esc(h)}</div></div>`).join("");
        const rows = [...rem.overdue.map((o) => ["Terlambat", o]), ...rem.today_due.map((o) => ["Hari ini", o]), ...rem.upcoming.map((o) => ["Mendatang", o])];
        wrap.querySelector("#plReminders").innerHTML = rows.length ? `<div class="notice dark"><strong>Pengingat tindak lanjut</strong><br>${rows.map(([l, o]) => `• <b>${esc(l)}</b> — ${esc(o.nama_pelanggan)} (${esc(STAGE_LABEL[o.stage])}, ${esc(o.next_followup_at)})${o.followup_note ? ": " + esc(o.followup_note) : ""}`).join("<br>")}</div>` : "";
        const by = {}; Object.keys(STAGE_LABEL).forEach((k) => (by[k] = []));
        list.opportunities.forEach((o) => by[o.stage].push(o));
        wrap.querySelector("#plBoard").innerHTML = Object.keys(STAGE_LABEL).map((st) => `<div class="sa-col"><div class="sa-col-h">${esc(STAGE_LABEL[st])} <span class="muted">${by[st].length}</span></div>${by[st].map((o) => {
          const mine = state.user && o.owner_id === state.user.id;
          return `<div class="sa-opp"><strong>${esc(o.nama_pelanggan)}</strong><div>${rp(o.nilai)}</div><div class="muted">${esc(o.owner_name)}${o.next_followup_at ? ` · tindak lanjut ${esc(o.next_followup_at)}` : ""}</div>${o.lost_reason ? `<div class="sa-warn">Alasan: ${esc(o.lost_reason)}</div>` : ""}
            ${mine ? `<div class="sa-row">${NEXT[o.stage].map((n) => `<button class="btn btn-ghost sa-sm" data-id="${o.id}" data-to="${n}">→ ${esc(STAGE_LABEL[n])}</button>`).join("")}${NEXT[o.stage].length ? `<button class="btn btn-ghost sa-sm" data-fu="${o.id}">Jadwal</button>` : ""}</div>` : ""}</div>`;
        }).join("") || '<div class="muted sa-empty">Kosong</div>'}</div>`).join("");
        wrap.querySelectorAll("[data-to]").forEach((b) => b.addEventListener("click", async () => {
          const to = b.dataset.to; let lost_reason;
          if (to === "kalah") { lost_reason = prompt("Alasan kalah (wajib):"); if (!lost_reason) return; }
          try { await api(`/pipeline/${b.dataset.id}/stage`, { method: "POST", body: JSON.stringify({ stage: to, lost_reason }) }); load(); } catch (e) { showToast(e.message, "error", 4000); }
        }));
        wrap.querySelectorAll("[data-fu]").forEach((b) => b.addEventListener("click", async () => {
          const d = prompt("Tanggal tindak lanjut berikutnya (YYYY-MM-DD):"); if (!d) return;
          const note = prompt("Catatan tindak lanjut (opsional):") || undefined;
          try { await api(`/pipeline/${b.dataset.fu}`, { method: "PUT", body: JSON.stringify({ next_followup_at: d, followup_note: note }) }); load(); } catch (e) { showToast(e.message, "error", 4000); }
        }));
      } catch (e) { wrap.querySelector("#plBoard").innerHTML = `<div class="notice dark">${esc(e.message)}</div>`; }
    }
    const add = wrap.querySelector("#plAdd");
    if (add) add.addEventListener("click", async () => {
      const nama = wrap.querySelector("#plNama").value.trim();
      if (!nama) { showToast("Nama pelanggan wajib diisi.", "error"); return; }
      try {
        await api("/pipeline", { method: "POST", body: JSON.stringify({ nama_pelanggan: nama, nilai: wrap.querySelector("#plNilai").value || 0, next_followup_at: wrap.querySelector("#plFollow").value || undefined }) });
        ["plNama", "plNilai", "plFollow"].forEach((i) => (wrap.querySelector("#" + i).value = "")); load();
      } catch (e) { showToast(e.message, "error", 4000); }
    });
    load();
    return wrap;
  }

  /* =========================================================
     VIEW: kelola master data (Admin)
     ========================================================= */
  function renderMasterAdmin() {
    const wrap = document.createElement("div");
    let sheet = "hsi", q = "";
    const TABS = [["wifi", "WiFi (WMS)"], ["hsi", "HSI"], ["datin", "Datin"], ["dbt", "Digital Business"]];
    wrap.innerHTML = `<h1>Kelola master data</h1><p class="desc">Setiap perubahan harga membuat <b>versi harga</b> baru dan tercatat di audit log; RAB lama tetap menunjuk harga acuannya.</p>
      <div class="sa-row"><button class="btn btn-primary" id="mdNew">+ Produk</button><label class="btn btn-secondary" style="cursor:pointer">Impor Excel<input type="file" id="mdFile" accept=".xlsx" hidden></label><a class="btn btn-ghost" id="mdTpl" href="#">Unduh template</a></div>
      <div class="master-tabs" id="mdTabs">${TABS.map(([k, l]) => `<div class="mtab ${k === sheet ? "active" : ""}" data-k="${k}">${l}</div>`).join("")}</div>
      <div class="master-search"><input id="mdQ" placeholder="Cari layanan / paket / lokasi…"></div>
      <div class="table-wrap"><div class="scroll-table" id="mdBody"></div></div>`;

    async function load() {
      const body = wrap.querySelector("#mdBody");
      body.innerHTML = `<div class="muted" style="padding:20px;">Memuat…</div>`;
      try {
        const d = await api(`/master-data?${new URLSearchParams({ sheet, q, limit: 100, include_inactive: 1 })}`);
        body.innerHTML = `<table><thead><tr><th>Layanan</th><th>Paket</th><th>Lokasi</th><th>Mbps</th><th>Harga</th><th>PSB</th><th>Versi</th><th></th></tr></thead><tbody>${d.rows.map((r) => `<tr class="${r.is_active ? "" : "sa-inactive"}"><td>${esc(r.layanan)}</td><td>${esc(r.paket)}</td><td class="muted">${esc(r.lokasi || "")}</td><td>${esc(r.mbps)}</td><td>${rp(r.harga)}</td><td>${rp(r.psb)}</td><td>v${esc(r.price_version)}</td><td class="sa-actions"><button class="btn btn-ghost sa-sm" data-edit="${r.id}">Ubah</button><button class="btn btn-ghost sa-sm" data-ver="${r.id}">Versi</button>${r.is_active ? `<button class="btn btn-ghost sa-sm" data-off="${r.id}">Nonaktifkan</button>` : `<button class="btn btn-ghost sa-sm" data-on="${r.id}">Aktifkan</button>`}</td></tr>`).join("") || `<tr><td colspan="8" class="muted">Tidak ada data.</td></tr>`}</tbody></table>${d.total > d.rows.length ? `<div class="data-note">Menampilkan ${d.rows.length} dari ${d.total}. Persempit pencarian.</div>` : ""}`;
        const byId = Object.fromEntries(d.rows.map((r) => [r.id, r]));
        body.querySelectorAll("[data-edit]").forEach((b) => b.addEventListener("click", () => productForm(byId[b.dataset.edit])));
        body.querySelectorAll("[data-ver]").forEach((b) => b.addEventListener("click", () => showVersions(byId[b.dataset.ver])));
        body.querySelectorAll("[data-off]").forEach((b) => b.addEventListener("click", async () => { if (confirm("Nonaktifkan produk ini? RAB lama tetap utuh.")) { try { await api(`/master-data/${b.dataset.off}`, { method: "DELETE" }); load(); } catch (e) { showToast(e.message, "error"); } } }));
        body.querySelectorAll("[data-on]").forEach((b) => b.addEventListener("click", async () => { try { await api(`/master-data/${b.dataset.on}/reactivate`, { method: "POST" }); load(); } catch (e) { showToast(e.message, "error"); } }));
      } catch (e) { body.innerHTML = `<div class="notice dark">${esc(e.message)}</div>`; }
    }

    function productForm(p) {
      const m = modal(p ? "Ubah produk" : "Produk baru", `<div class="sa-form col">
        <label>Layanan<input id="pfL" value="${esc(p ? p.layanan : "")}" ${p ? "" : ""}></label><label>Paket<input id="pfP" value="${esc(p ? p.paket : "")}"></label>
        <label>Lokasi<input id="pfLok" value="${esc(p ? p.lokasi || "" : "")}"></label><label>Bandwidth (Mbps)<input id="pfM" type="number" min="0" value="${esc(p ? p.mbps : 0)}"></label>
        <label>Harga bulanan (Rp)<input id="pfH" type="number" min="0" value="${esc(p ? p.harga : 0)}"></label><label>PSB (Rp)<input id="pfS" type="number" min="0" value="${esc(p ? p.psb : 0)}"></label>
        <label>Alasan perubahan harga<input id="pfR" maxlength="200" placeholder="mis. SK tarif baru"></label>
        <button class="btn btn-primary" id="pfSave">Simpan</button></div>`);
      m.el.querySelector("#pfSave").addEventListener("click", async () => {
        const v = (id) => m.el.querySelector("#" + id).value;
        const body = { layanan: v("pfL"), paket: v("pfP"), lokasi: v("pfLok") || undefined, mbps: v("pfM"), harga: v("pfH"), psb: v("pfS"), reason: v("pfR") || undefined };
        try {
          if (p) await api(`/master-data/${p.id}`, { method: "PUT", body: JSON.stringify(body) });
          else await api("/master-data", { method: "POST", body: JSON.stringify({ ...body, sheet }) });
          m.close(); showToast("Produk tersimpan."); load();
        } catch (e) { showToast(e.message, "error", 4000); }
      });
    }

    async function showVersions(p) {
      const m = modal(`Riwayat harga — ${p.paket}`, `<div class="muted">Memuat…</div>`, { wide: true });
      try {
        const d = await api(`/master-data/${p.id}/versions`);
        m.el.innerHTML = `<table><thead><tr><th>Versi</th><th>Harga</th><th>PSB</th><th>Alasan</th><th>Oleh</th><th>Waktu</th><th>Dipakai RAB</th></tr></thead><tbody>${d.versions.map((v) => `<tr><td>v${v.version}</td><td>${rp(v.harga)}</td><td>${rp(v.psb)}</td><td>${esc(v.reason || "")}</td><td>${esc(v.changed_by_name || "sistem")}</td><td>${esc(wib(v.created_at))}</td><td>${v.used_in_items} item</td></tr>`).join("")}</tbody></table>`;
      } catch (e) { m.el.textContent = e.message; }
    }

    wrap.querySelector("#mdNew").addEventListener("click", () => productForm(null));
    wrap.querySelector("#mdTpl").addEventListener("click", (e) => { e.preventDefault(); window.open(`/api/master-data/import/template.xlsx?${tokenQs()}`, "_blank"); });
    wrap.querySelector("#mdFile").addEventListener("change", async (e) => {
      const f = e.target.files[0]; if (!f) return;
      const buf = await f.arrayBuffer();
      const call = (dry) => fetch(`${API_BASE}/master-data/import?dry_run=${dry ? 1 : 0}`, { method: "POST", headers: { Authorization: "Bearer " + state.token, "Content-Type": "application/octet-stream" }, body: buf }).then(async (r) => ({ ok: r.ok, body: await r.json().catch(() => ({})) }));
      const r = await call(true);
      if (!r.ok) { showToast(r.body.error || "Impor gagal", "error", 5000); e.target.value = ""; return; }
      const rep = r.body.report;
      const m = modal("Pratinjau impor", `<p><b>${rep.valid_rows}</b> baris valid dari ${rep.total_rows}: ${rep.to_create} produk baru, ${rep.to_update} diperbarui (${rep.price_changes} perubahan harga → versi baru), ${rep.unchanged} tanpa perubahan.</p>
        ${rep.error_count ? `<div class="notice dark"><b>${rep.error_count} baris tidak valid</b> — impor tidak dapat diterapkan:<br>${rep.errors.map((x) => `Baris ${x.row}: ${esc(x.message)}`).join("<br>")}</div>` : ""}
        <button class="btn btn-primary" id="impGo" ${rep.error_count ? "disabled" : ""}>Terapkan impor</button>`, { wide: true });
      m.el.querySelector("#impGo").addEventListener("click", async () => {
        const res = await call(false);
        if (res.ok) { m.close(); showToast("Impor diterapkan."); load(); } else showToast(res.body.error || "Gagal", "error", 5000);
      });
      e.target.value = "";
    });
    wrap.querySelectorAll("#mdTabs .mtab").forEach((t) => t.addEventListener("click", () => { sheet = t.dataset.k; wrap.querySelectorAll("#mdTabs .mtab").forEach((x) => x.classList.toggle("active", x === t)); load(); }));
    let tm; wrap.querySelector("#mdQ").addEventListener("input", (e) => { q = e.target.value; clearTimeout(tm); tm = setTimeout(load, 300); });
    load();
    return wrap;
  }

  /* =========================================================
     VIEW: audit log & pengguna
     ========================================================= */
  function renderAudit() {
    const wrap = document.createElement("div");
    wrap.innerHTML = `<h1>Audit log</h1><p class="desc">Catatan kronologis perubahan status RAB, harga, peluang, dan peran.</p>
      <div class="sa-form"><select id="auType"><option value="">Semua entitas</option>${["session", "product", "opportunity", "user", "quotation"].map((t) => `<option>${t}</option>`).join("")}</select><input id="auAct" placeholder="Awalan aksi, mis. session."><button class="btn btn-secondary" id="auGo">Terapkan</button></div>
      <div class="table-wrap"><div class="scroll-table" id="auBody"></div></div>`;
    async function load() {
      const qs = new URLSearchParams({ limit: 200 });
      const t = wrap.querySelector("#auType").value, a = wrap.querySelector("#auAct").value.trim();
      if (t) qs.set("entity_type", t); if (a) qs.set("action", a);
      const body = wrap.querySelector("#auBody");
      try {
        const d = await api(`/audit?${qs}`);
        body.innerHTML = `<table><thead><tr><th>Waktu</th><th>Aktor</th><th>Aksi</th><th>Entitas</th><th>Perubahan</th><th>Catatan</th></tr></thead><tbody>${d.rows.map((r) => `<tr><td>${esc(wib(r.created_at))}</td><td>${esc(r.actor_name)} <span class="muted">(${esc(r.actor_role)})</span></td><td>${esc(r.action)}</td><td>${esc(r.entity_type)}${r.entity_id ? " #" + r.entity_id : ""}</td><td>${r.from_value != null || r.to_value != null ? `${esc(r.from_value ?? "")} → ${esc(r.to_value ?? "")}` : ""}</td><td>${esc(r.note || "")}</td></tr>`).join("") || `<tr><td colspan="6" class="muted">Tidak ada catatan.</td></tr>`}</tbody></table><div class="data-note">${d.total} catatan.</div>`;
      } catch (e) { body.innerHTML = `<div class="notice dark">${esc(e.message)}</div>`; }
    }
    wrap.querySelector("#auGo").addEventListener("click", load);
    load();
    return wrap;
  }

  function renderUsers() {
    const wrap = document.createElement("div");
    wrap.innerHTML = `<h1>Pengguna &amp; peran</h1><p class="desc">Peran menentukan hak akses (Sales, Manajer, Admin). Perubahan langsung berlaku dan tercatat di audit log.</p><div class="table-wrap"><div class="scroll-table" id="usBody"></div></div>`;
    async function load() {
      const body = wrap.querySelector("#usBody");
      try {
        const d = await api("/users");
        body.innerHTML = `<table><thead><tr><th>Nama</th><th>Username</th><th>Email</th><th>Peran</th></tr></thead><tbody>${d.users.map((u) => `<tr><td>${esc(u.name)}</td><td>${esc(u.username)}</td><td>${esc(u.email || "-")}</td><td>${u.id === state.user.id ? esc(u.role) : `<select data-id="${u.id}">${d.roles.map((r) => `<option ${r === u.role ? "selected" : ""}>${r}</option>`).join("")}</select>`}</td></tr>`).join("")}</tbody></table>`;
        body.querySelectorAll("select").forEach((s) => s.addEventListener("change", async () => { try { await api(`/users/${s.dataset.id}/role`, { method: "PUT", body: JSON.stringify({ role: s.value }) }); showToast("Peran diperbarui."); } catch (e) { showToast(e.message, "error"); load(); } }));
      } catch (e) { body.innerHTML = `<div class="notice dark">${esc(e.message)}</div>`; }
    }
    load();
    return wrap;
  }

  window.SA_VIEWS = {
    approval: () => { const w = document.createElement("div"); renderApproval().then((n) => w.replaceWith(n)); w.innerHTML = '<div class="muted" style="padding:20px;">Memuat…</div>'; return w; },
    approvals: renderApprovals, pipeline: renderPipeline, masteradmin: renderMasterAdmin, audit: renderAudit, users: renderUsers
  };

  /* =========================================================
     Output RAB (langkah 7): PDF server, email, pipeline
     ========================================================= */
  window.SA_UI = {
    /* Ringkasan pipeline pada dashboard utama: win rate, nilai terbuka, hasil, pengingat. */
    async enhanceDashboard(wrap) {
      const stats = wrap.querySelector(".dash-stats");
      if (!stats) return;
      const row = document.createElement("div");
      row.className = "dash-stats";
      row.style.marginTop = "12px";
      row.innerHTML = `<div class="stat-card"><div class="stat-icon">WR</div><div><div class="stat-label">Win Rate Pipeline</div><div class="stat-value" id="dsWinRate">–</div></div></div>
        <div class="stat-card"><div class="stat-icon">OP</div><div><div class="stat-label">Nilai Pipeline Terbuka</div><div class="stat-value" id="dsOpen">–</div></div></div>
        <div class="stat-card"><div class="stat-icon">W/L</div><div><div class="stat-label">Menang / Kalah</div><div class="stat-value" id="dsWL">–</div></div></div>
        <div class="stat-card" style="cursor:pointer" id="dsRem" title="Buka pipeline"><div class="stat-icon">!</div><div><div class="stat-label">Pengingat Tindak Lanjut</div><div class="stat-value" id="dsRemVal">–</div></div></div>`;
      stats.insertAdjacentElement("afterend", row);
      row.querySelector("#dsRem").addEventListener("click", () => { state.view = "pipeline"; render(); });
      try {
        const sum = await api("/pipeline/summary");
        const set = (id, v) => { const el = row.querySelector(id); if (el) el.textContent = v; };
        set("#dsWinRate", sum.win_rate == null ? "–" : (sum.win_rate * 100).toFixed(0) + "%");
        set("#dsOpen", rp(sum.open_value));
        set("#dsWL", `${sum.won_count} / ${sum.lost_count}`);
        const rem = (sum.reminders.overdue || 0) + (sum.reminders.today || 0);
        set("#dsRemVal", `${rem}`);
      } catch (e) { /* ringkasan pipeline opsional: dashboard tetap tampil */ }
    },
    enhanceOutput(wrap) {
      const s = state.session;
      if (!s) return;
      // Ganti tombol PDF lama (cetak via window berisi skrip inline, diblokir CSP) dengan PDF dari server.
      const old = wrap.querySelector("#btnDownloadPdf");
      if (old) {
        const a = document.createElement("a");
        a.className = "btn btn-secondary"; a.style.cssText = "width:100%;justify-content:center;margin-top:8px;text-decoration:none;";
        a.href = `/api/sessions/${s.id}/quotation.pdf?download=1&${tokenQs()}`; a.textContent = "Download SPH (PDF)";
        old.replaceWith(a);
      }
      const panel = document.createElement("div");
      panel.className = "sa-card";
      panel.innerHTML = `<h3>Kirim penawaran ke pelanggan</h3>
        <div class="sa-form"><input id="mailTo" type="email" placeholder="email@pelanggan.co.id"><input id="mailMsg" placeholder="Pesan (opsional)"><button class="btn btn-primary" id="mailSend">Kirim PDF</button><button class="btn btn-secondary" id="mailPrev">Pratinjau</button><button class="btn btn-ghost" id="oppAdd">Tambah ke pipeline</button></div>
        <div id="mailLog" class="muted"></div>`;
      const top = wrap.querySelector(".output-top-row");
      top.parentNode.insertBefore(panel, top.nextSibling);
      const log = panel.querySelector("#mailLog");
      async function loadLog() {
        try {
          const d = await api(`/sessions/${s.id}/deliveries`);
          log.innerHTML = d.deliveries.length ? "<b>Riwayat pengiriman</b><br>" + d.deliveries.map((x) => `${esc(wib(x.created_at))} → ${esc(x.to_email)}: <b>${esc(x.status === "simulated" ? "simulasi (mode uji, tidak terkirim)" : x.status === "sent" ? "terkirim" : "gagal")}</b>${x.error ? " — " + esc(x.error) : ""}`).join("<br>") : "";
        } catch (e) { /* abaikan */ }
      }
      panel.querySelector("#mailPrev").addEventListener("click", () => modal("Pratinjau SPH", `<iframe title="SPH" style="width:100%;height:70vh;border:0" src="/api/sessions/${s.id}/quotation.pdf?${tokenQs()}"></iframe>`, { wide: true }));
      panel.querySelector("#mailSend").addEventListener("click", async (e) => {
        const to = panel.querySelector("#mailTo").value.trim();
        if (!to) { showToast("Isi alamat email pelanggan.", "error"); return; }
        e.target.disabled = true;
        try {
          const r = await api(`/sessions/${s.id}/send-quotation`, { method: "POST", body: JSON.stringify({ to, message: panel.querySelector("#mailMsg").value || undefined }) });
          showToast(r.delivery.status === "simulated" ? "Mode uji: email disimulasikan (SMTP belum dikonfigurasi)." : "Email terkirim.", "info", 4500);
        } catch (err) { showToast(err.message, "error", 5000); }
        e.target.disabled = false; loadLog();
      });
      panel.querySelector("#oppAdd").addEventListener("click", async () => {
        try { await api("/pipeline", { method: "POST", body: JSON.stringify({ session_id: s.id }) }); showToast("Peluang ditambahkan ke pipeline."); state.view = "pipeline"; render(); } catch (err) { showToast(err.message, "error", 4000); }
      });
      loadLog();
    }
  };
})();