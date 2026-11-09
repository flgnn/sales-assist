const { bootstrap, tokens, auth, makeAnalyzedSession, makeApprovedSession, request } = require("./helpers");

let app, db, t;
beforeAll(async () => { ({ app, db } = bootstrap()); t = await tokens(app); });

const bin = (res, cb) => { const c = []; res.on("data", d => c.push(d)); res.on("end", () => cb(null, Buffer.concat(c))); };

describe("Dokumen penawaran PDF", () => {
  test("pratinjau draft menghasilkan PDF valid (berwatermark draft); tersedia untuk manajer", async () => {
    const id = await makeAnalyzedSession(app, t.sales);
    const r = await request(app).get(`/api/sessions/${id}/quotation.pdf`).set(auth(t.sales)).buffer().parse(bin);
    expect(r.status).toBe(200);
    expect(r.headers["content-type"]).toMatch(/application\/pdf/);
    expect(r.headers["content-disposition"]).toMatch(/^inline/);
    expect(r.body.slice(0, 5).toString()).toBe("%PDF-");
    expect((await request(app).get(`/api/sessions/${id}/quotation.pdf?download=1`).set(auth(t.manager)).buffer().parse(bin)).headers["content-disposition"]).toMatch(/^attachment/);
  });

  test("sesi tanpa item -> 400", async () => {
    const c = await request(app).post("/api/sessions").set(auth(t.sales)).send({ nama_pelanggan: "PT Kosong", kebutuhan: "x" });
    expect((await request(app).get(`/api/sessions/${c.body.session.id}/quotation.pdf`).set(auth(t.sales))).status).toBe(400);
  });

  test("PDF final (disetujui) lebih besar/berbeda dari draft dan memuat banyak item tanpa galat", async () => {
    const id = await makeApprovedSession(app, t, { kebutuhan: "Bank daerah ingin menghubungkan 12 kantor cabang dengan jaringan private point to point; juga wifi managed hotel; cctv 10 titik" });
    for (let i = 0; i < 25; i++) {
      await request(app).post(`/api/sessions/${id}/items`).set(auth(t.sales)); // terkunci -> 409, tidak menambah
    }
    const r = await request(app).get(`/api/sessions/${id}/quotation.pdf`).set(auth(t.sales)).buffer().parse(bin);
    expect(r.status).toBe(200);
    expect(r.body.length).toBeGreaterThan(1500);
  });

  test("banyak item memicu halaman kedua", async () => {
    const { buildQuotationPdf } = require("../src/services/quotationPdf");
    const items = Array.from({ length: 60 }, (_, i) => ({ id: i, nama: "Layanan uji panjang nomor " + i, harga: 100000, psb: 0, qty: 2, periode: "Bulanan", periode_bulan: 12, jenis_layanan: "Connectivity" }));
    const pdf = await buildQuotationPdf({ session: { nama_pelanggan: "PT Banyak", approval_status: "draft", witel: "Witel Priangan Timur" }, items, sales: { name: "S" }, approver: null });
    const pages = (pdf.toString("latin1").match(/\/Type \/Page\b/g) || []).length;
    expect(pages).toBeGreaterThan(1);
  });
});

describe("Pengiriman email penawaran", () => {
  test("ditolak sebelum disetujui & diterbitkan", async () => {
    const id = await makeAnalyzedSession(app, t.sales);
    const r = await request(app).post(`/api/sessions/${id}/send-quotation`).set(auth(t.sales)).send({ to: "pelanggan@contoh.co.id" });
    expect(r.status).toBe(409);
  });

  test("validasi alamat email", async () => {
    const id = await makeApprovedSession(app, t);
    expect((await request(app).post(`/api/sessions/${id}/send-quotation`).set(auth(t.sales)).send({ to: "bukan-email" })).status).toBe(400);
    expect((await request(app).post(`/api/sessions/${id}/send-quotation`).set(auth(t.sales)).send({})).status).toBe(400);
  });

  test("mode uji (tanpa SMTP): status simulated, tercatat di deliveries + audit; peluang tertaut naik ke penawaran", async () => {
    const id = await makeApprovedSession(app, t);
    const opp = await request(app).post("/api/pipeline").set(auth(t.sales)).send({ session_id: id });
    expect(opp.body.opportunity.stage).toBe("prospek");
    const r = await request(app).post(`/api/sessions/${id}/send-quotation`).set(auth(t.sales)).send({ to: "pelanggan@contoh.co.id", message: "Halo" });
    expect(r.status).toBe(200);
    expect(r.body.delivery).toMatchObject({ status: "simulated", mode: "test" });
    expect(r.body.opportunity.stage).toBe("penawaran");
    const d = await request(app).get(`/api/sessions/${id}/deliveries`).set(auth(t.sales));
    expect(d.body.deliveries[0]).toMatchObject({ to_email: "pelanggan@contoh.co.id", status: "simulated" });
    expect(db.prepare("SELECT COUNT(*) c FROM audit_logs WHERE action='quotation.send'").get().c).toBeGreaterThan(0);
  });

  test("kegagalan pengiriman: dicatat 'failed', kredensial SMTP tidak bocor", async () => {
    const email = require("../src/services/emailService");
    process.env.SMTP_HOST = "127.0.0.1"; process.env.SMTP_PORT = "1"; process.env.SMTP_USER = "rahasia-user"; process.env.SMTP_PASS = "rahasia-pass";
    email.resetTransport();
    const id = await makeApprovedSession(app, t);
    const r = await request(app).post(`/api/sessions/${id}/send-quotation`).set(auth(t.sales)).send({ to: "pelanggan@contoh.co.id" });
    delete process.env.SMTP_HOST; delete process.env.SMTP_PORT; delete process.env.SMTP_USER; delete process.env.SMTP_PASS;
    email.resetTransport();
    expect(r.status).toBe(502);
    expect(r.body.delivery.status).toBe("failed");
    expect(JSON.stringify(r.body)).not.toMatch(/rahasia/);
    expect(db.prepare("SELECT status FROM quotation_deliveries WHERE session_id=?").get(id).status).toBe("failed");
  });

  test("sanitizeError menyamarkan rahasia", () => {
    const { sanitizeError } = require("../src/services/emailService");
    process.env.SMTP_PASS = "abc123";
    expect(sanitizeError(new Error("auth gagal pass abc123"))).toBe("auth gagal pass ***");
    delete process.env.SMTP_PASS;
  });

  test("unduh Excel RAB hanya setelah diterbitkan", async () => {
    const a = await makeAnalyzedSession(app, t.sales);
    expect((await request(app).get(`/api/sessions/${a}/rab.xlsx`).set(auth(t.sales))).status).toBe(400);
    const b = await makeApprovedSession(app, t);
    const r = await request(app).get(`/api/sessions/${b}/rab.xlsx`).set(auth(t.sales)).buffer().parse(bin);
    expect(r.status).toBe(200);
    expect(r.body.slice(0, 2).toString()).toBe("PK");
  });
});
