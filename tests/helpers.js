const request = require("supertest");

function bootstrap() {
  const db = require("../src/db/db");
  const { seedUsers, seedMasterProducts } = require("../src/db/seed");
  const log = console.log; console.log = () => {};
  seedUsers();
  seedMasterProducts(false);
  db.ensurePriceVersions();
  console.log = log;
  const { createApp } = require("../src/app");
  return { db, app: createApp() };
}

async function login(app, username, password) {
  const res = await request(app).post("/api/auth/login").send({ username, password });
  if (res.status !== 200) throw new Error(`login ${username} gagal: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.token;
}

async function tokens(app) {
  return {
    sales: await login(app, "akbar.trisnamulya", "sales123"),
    sales2: await login(app, "sales2", "sales123"),
    manager: await login(app, "manager", "manager123"),
    admin: await login(app, "admin", "admin123")
  };
}

const auth = (t) => ({ Authorization: `Bearer ${t}` });

/** Buat sesi + analisis, kembalikan id. */
async function makeAnalyzedSession(app, token, over = {}) {
  const c = await request(app).post("/api/sessions").set(auth(token)).send({
    nama_pelanggan: "PT Uji Coba", industri: "Retail", cabang: "2 cabang", kebutuhan: "Toko swalayan ingin pasang 10 CCTV online yang bisa dipantau lewat HP", ...over
  });
  if (c.status !== 201) throw new Error("create gagal " + JSON.stringify(c.body));
  const id = c.body.session.id;
  const a = await request(app).post(`/api/sessions/${id}/analyze`).set(auth(token)).send({});
  if (a.status !== 200) throw new Error("analyze gagal " + JSON.stringify(a.body));
  return id;
}

/** Bawa sesi sampai disetujui + diterbitkan. */
async function makeApprovedSession(app, t, over) {
  const id = await makeAnalyzedSession(app, t.sales, over);
  await request(app).post(`/api/sessions/${id}/submit`).set(auth(t.sales));
  await request(app).post(`/api/sessions/${id}/decision`).set(auth(t.manager)).send({ decision: "approve" });
  const f = await request(app).post(`/api/sessions/${id}/approve`).set(auth(t.sales));
  if (f.status !== 200) throw new Error("finalize gagal " + JSON.stringify(f.body));
  return id;
}

module.exports = { bootstrap, tokens, login, auth, makeAnalyzedSession, makeApprovedSession, request };
