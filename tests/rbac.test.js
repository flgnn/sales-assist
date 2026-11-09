const { bootstrap, tokens, auth, makeAnalyzedSession, request } = require("./helpers");
const { PERMISSIONS, can } = require("../src/middleware/rbac");

let app, db, t, sid;
beforeAll(async () => { ({ app, db } = bootstrap()); t = await tokens(app); sid = await makeAnalyzedSession(app, t.sales); });

// Matriks hak akses: [metode, path, {peran: dapat mengakses?}]. "allowed" berarti respons BUKAN 401/403.
const OK = true, NO = false;
const MATRIX = () => [
  ["GET", "/api/sessions", { sales: OK, manager: OK, admin: OK }],
  ["POST", "/api/sessions", { sales: OK, manager: NO, admin: NO }, { nama_pelanggan: "PT A", kebutuhan: "internet" }],
  ["GET", `/api/sessions/${sid}`, { sales: OK, manager: OK, admin: OK }],
  ["PUT", `/api/sessions/${sid}`, { sales: OK, manager: NO, admin: NO }, { nama_pelanggan: "PT A", kebutuhan: "internet" }],
  ["POST", `/api/sessions/${sid}/analyze`, { sales: OK, manager: NO, admin: NO }, {}],
  ["POST", `/api/sessions/${sid}/submit`, { sales: OK, manager: NO, admin: NO }],
  ["POST", `/api/sessions/${sid}/decision`, { sales: NO, manager: OK, admin: NO }, { decision: "approve" }],
  ["POST", `/api/sessions/${sid}/send-quotation`, { sales: OK, manager: NO, admin: NO }, { to: "a@b.co" }],
  ["GET", `/api/sessions/${sid}/audit`, { sales: OK, manager: OK, admin: OK }],
  ["GET", `/api/sessions/${sid}/quotation.pdf`, { sales: OK, manager: OK, admin: OK }],
  ["GET", "/api/approvals", { sales: NO, manager: OK, admin: OK }],
  ["GET", "/api/audit", { sales: NO, manager: OK, admin: OK }],
  ["GET", "/api/users", { sales: NO, manager: NO, admin: OK }],
  ["GET", "/api/master-data", { sales: OK, manager: OK, admin: OK }],
  ["POST", "/api/master-data", { sales: NO, manager: NO, admin: OK }, { sheet: "hsi", layanan: "1S", paket: "HSI uji", harga: 1 }],
  ["PUT", "/api/master-data/1", { sales: NO, manager: NO, admin: OK }, { harga: 500000 }],
  ["DELETE", "/api/master-data/999999", { sales: NO, manager: NO, admin: OK }],
  ["POST", "/api/master-data/import", { sales: NO, manager: NO, admin: OK }],
  ["GET", "/api/master-data/import/template.xlsx", { sales: NO, manager: NO, admin: OK }],
  ["GET", "/api/pipeline", { sales: OK, manager: OK, admin: OK }],
  ["GET", "/api/pipeline/summary", { sales: OK, manager: OK, admin: OK }],
  ["POST", "/api/pipeline", { sales: OK, manager: OK, admin: NO }, { nama_pelanggan: "PT P" }]
];

describe("Uji hak akses otomatis per peran", () => {
  test("tanpa token semua endpoint terproteksi mengembalikan 401", async () => {
    for (const [method, path, , body] of MATRIX()) {
      const res = await request(app)[method.toLowerCase()](path).send(body || {});
      expect([method, path, res.status]).toEqual([method, path, 401]);
    }
  });

  test("token tidak valid -> 401", async () => {
    const res = await request(app).get("/api/sessions").set(auth("bukan.token.valid"));
    expect(res.status).toBe(401);
  });

  for (const role of ["sales", "manager", "admin"]) {
    test(`peran ${role}: sesuai matriks (403 bila tidak berhak, bukan 401/403 bila berhak)`, async () => {
      for (const [method, path, expect_, body] of MATRIX()) {
        const res = await request(app)[method.toLowerCase()](path).set(auth(t[role])).send(body || {});
        if (expect_[role]) expect([method, path, role, res.status === 401 || res.status === 403]).toEqual([method, path, role, false]);
        else expect([method, path, role, res.status]).toEqual([method, path, role, 403]);
      }
    });
  }

  test("setiap rute /api (selain publik) dilindungi requireAuth", () => {
    const PUBLIC = new Set(["GET /api/health", "POST /api/log-error", "POST /api/auth/login", "POST /api/auth/register",
      "POST /api/auth/google", "GET /api/auth/google/config"]);
    const unprotected = []; let visited = 0;
    const walk = (stack, prefix) => {
      stack.forEach(layer => {
        if (layer.route) {
          Object.keys(layer.route.methods).forEach(m => {
            const full = `${m.toUpperCase()} ${prefix}${layer.route.path === "/" ? "" : layer.route.path}`;
            if (!full.includes(" /api")) return;
            visited += 1;
            const guarded = layer.route.stack.some(l => l.handle.isAuthGuard);
            if (!guarded && !PUBLIC.has(full) && !PUBLIC.has(full.replace(/\/$/, ""))) unprotected.push(full);
          });
        } else if (layer.name === "router" && layer.handle.stack) {
          const m = layer.regexp.source.match(/^\^\\\/(.+?)\\\/\?\(\?=\\\/\|\$\)/);
          walk(layer.handle.stack, prefix + (m ? "/" + m[1].replace(/\\\//g, "/") : ""));
        }
      });
    };
    walk(app._router.stack, "");
    expect(visited).toBeGreaterThan(50);
    expect(unprotected).toEqual([]);
  });

  test("perubahan peran berlaku seketika (peran dibaca dari DB), tercatat audit, tidak bisa ubah diri sendiri", async () => {
    const sales2 = db.prepare("SELECT id FROM users WHERE username='sales2'").get().id;
    const adminId = db.prepare("SELECT id FROM users WHERE username='admin'").get().id;
    expect((await request(app).get("/api/approvals").set(auth(t.sales2))).status).toBe(403);
    let r = await request(app).put(`/api/users/${sales2}/role`).set(auth(t.admin)).send({ role: "manager" });
    expect(r.status).toBe(200);
    expect((await request(app).get("/api/approvals").set(auth(t.sales2))).status).toBe(200); // token lama, peran baru
    expect(db.prepare("SELECT from_value, to_value FROM audit_logs WHERE action='user.role_change' AND entity_id=?").get(sales2)).toEqual({ from_value: "sales", to_value: "manager" });
    await request(app).put(`/api/users/${sales2}/role`).set(auth(t.admin)).send({ role: "sales" });
    r = await request(app).put(`/api/users/${adminId}/role`).set(auth(t.admin)).send({ role: "sales" });
    expect(r.status).toBe(409);
    r = await request(app).put(`/api/users/${sales2}/role`).set(auth(t.admin)).send({ role: "superuser" });
    expect(r.status).toBe(400);
    expect((await request(app).get("/api/users").set(auth(t.admin))).body.users.length).toBeGreaterThanOrEqual(4);
  });

  test("peta PERMISSIONS: setiap peran punya izin dan can() konsisten", () => {
    expect(can("sales", "session:create")).toBe(true);
    expect(can("manager", "session:decide")).toBe(true);
    expect(can("admin", "master:write")).toBe(true);
    expect(can("sales", "master:write")).toBe(false);
    expect(can("ghost", "master:read")).toBe(false);
    Object.values(PERMISSIONS).forEach(p => expect(p.length).toBeGreaterThan(0));
  });

  test("sales tidak dapat melihat / mengubah RAB sales lain", async () => {
    expect((await request(app).get(`/api/sessions/${sid}`).set(auth(t.sales2))).status).toBe(404);
    expect((await request(app).put(`/api/sessions/${sid}/items/1`).set(auth(t.sales2)).send({ qty: 1 })).status).toBe(404);
  });
});
