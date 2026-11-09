const { bootstrap, tokens, auth, request } = require("./helpers");
const { validateValue } = require("../src/middleware/validate");

let app, db, t;
beforeAll(async () => { ({ app, db } = bootstrap()); t = await tokens(app); });

describe("Keamanan aplikasi", () => {
  test("helmet: header keamanan + CSP, tanpa X-Powered-By", async () => {
    const r = await request(app).get("/api/health");
    expect(r.headers["x-content-type-options"]).toBe("nosniff");
    expect(r.headers["x-powered-by"]).toBeUndefined();
    expect(r.headers["content-security-policy"]).toMatch(/default-src 'self'/);
    expect(r.headers["content-security-policy"]).toMatch(/frame-ancestors 'self'/);
    expect(r.headers["x-frame-options"]).toBeDefined();
  });

  test("CORS whitelist: origin asing tidak mendapat izin; same-origin/tanpa origin tetap jalan", async () => {
    const bad = await request(app).get("/api/health").set("Origin", "https://evil.example");
    expect(bad.headers["access-control-allow-origin"]).toBeUndefined();
    expect((await request(app).get("/api/health")).status).toBe(200);
  });

  test("CORS: origin yang di-whitelist diizinkan", async () => {
    process.env.CORS_ORIGINS = "https://app.contoh.co.id";
    const { createApp } = require("../src/app");
    const r = await request(createApp()).get("/api/health").set("Origin", "https://app.contoh.co.id");
    expect(r.headers["access-control-allow-origin"]).toBe("https://app.contoh.co.id");
    delete process.env.CORS_ORIGINS;
  });

  test("rate limiting login (aktif saat RATE_LIMIT_FORCE=1)", async () => {
    process.env.RATE_LIMIT_FORCE = "1"; process.env.AUTH_RATE_LIMIT_MAX = "3";
    const { createApp } = require("../src/app");
    const a = createApp();
    const codes = [];
    for (let i = 0; i < 5; i++) codes.push((await request(a).post("/api/auth/login").send({ username: "x", password: "y" })).status);
    delete process.env.RATE_LIMIT_FORCE; delete process.env.AUTH_RATE_LIMIT_MAX;
    expect(codes.slice(0, 3)).toEqual([401, 401, 401]);
    expect(codes.slice(3)).toEqual([429, 429]);
  });

  test("login salah -> 401, field kurang -> 400; password tidak pernah dikembalikan", async () => {
    expect((await request(app).post("/api/auth/login").send({ username: "admin", password: "salah" })).status).toBe(401);
    expect((await request(app).post("/api/auth/login").send({})).status).toBe(400);
    const ok = await request(app).post("/api/auth/login").send({ username: "admin", password: "admin123" });
    expect(JSON.stringify(ok.body)).not.toMatch(/password|\$2[aby]\$/);
  });

  test("registrasi selalu berperan sales (tidak bisa mengisi role sendiri)", async () => {
    const r = await request(app).post("/api/auth/register").send({ username: "hacker1", password: "abcdef", name: "H", role: "admin" });
    expect(r.status).toBe(201);
    expect(r.body.user.role).toBe("sales");
  });

  test("JSON rusak -> 400, payload terlalu besar -> 413, endpoint tak ada -> 404", async () => {
    expect((await request(app).post("/api/auth/login").set("Content-Type", "application/json").send("{bukan json")).status).toBe(400);
    expect((await request(app).post("/api/auth/login").send({ username: "a".repeat(2 * 1024 * 1024) })).status).toBe(413);
    expect((await request(app).get("/api/tidak-ada")).status).toBe(404);
  });

  test("injeksi SQL pada pencarian tidak merusak data (parameterisasi)", async () => {
    const before = db.prepare("SELECT COUNT(*) c FROM master_products").get().c;
    const r = await request(app).get("/api/master-data").query({ q: "'; DROP TABLE master_products; --", sheet: "x' OR '1'='1" }).set(auth(t.sales));
    expect(r.status).toBe(200);
    expect(r.body.total).toBe(0);
    expect(db.prepare("SELECT COUNT(*) c FROM master_products").get().c).toBe(before);
  });

  test("mass-assignment: field di luar skema dibuang (pipeline)", async () => {
    const r = await request(app).post("/api/pipeline").set(auth(t.sales)).send({ nama_pelanggan: "PT X", owner_id: 1, stage: "menang", closed_at: "2020-01-01" });
    expect(r.body.opportunity.stage).toBe("prospek");
    expect(r.body.opportunity.closed_at).toBeNull();
  });

  test("token lewat query hanya untuk GET", async () => {
    expect((await request(app).get(`/api/sessions?token=${t.sales}`)).status).toBe(200);
    expect((await request(app).post(`/api/sessions?token=${t.sales}`).send({ nama_pelanggan: "A", kebutuhan: "B" })).status).toBe(401);
  });

  test("log-error frontend dipotong dan tidak menjatuhkan server", async () => {
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    const r = await request(app).post("/api/log-error").send({ msg: "x".repeat(5000), stack: "y".repeat(5000) });
    expect(r.status).toBe(204);
    expect(spy.mock.calls[0][1].length).toBeLessThan(1600);
    spy.mockRestore();
  });

  test("akun yang dihapus tidak dapat memakai token lama", async () => {
    const r = await request(app).post("/api/auth/register").send({ username: "sementara", password: "abcdef", name: "Tmp" });
    const tok = r.body.token;
    db.prepare("DELETE FROM users WHERE username='sementara'").run();
    expect((await request(app).get("/api/sessions").set(auth(tok))).status).toBe(401);
  });
});

describe("Validator", () => {
  test("tipe-tipe dasar", () => {
    expect(validateValue("n", { type: "integer", min: 1 }, "2.5").error).toMatch(/bulat/);
    expect(validateValue("n", { type: "number", max: 5 }, 9).error).toMatch(/maksimal/);
    expect(validateValue("n", { type: "number" }, "1,5").value).toBe(1.5);
    expect(validateValue("e", { type: "email" }, " A@B.CO ").value).toBe("a@b.co");
    expect(validateValue("d", { type: "date" }, "2026-13-45").error).toBeDefined();
    expect(validateValue("b", { type: "boolean" }, "ya").value).toBe(true);
    expect(validateValue("b", { type: "boolean" }, "mungkin").error).toBeDefined();
    expect(validateValue("s", { type: "string", enum: ["a"] }, "b").error).toMatch(/salah satu/);
    expect(validateValue("s", { type: "string", minLength: 3 }, "ab").error).toBeDefined();
    expect(validateValue("s", { type: "string", pattern: /^\d+$/ }, "ab").error).toBeDefined();
    expect(validateValue("s", { type: "string" }, { a: 1 }).error).toBeDefined();
    expect(validateValue("s", { type: "string", required: true }, "").error).toMatch(/wajib/);
    expect(validateValue("s", { type: "string" }, undefined).value).toBeUndefined();
  });
});
