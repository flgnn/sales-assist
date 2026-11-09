// Dijalankan Jest sebelum setiap berkas uji: database in-memory + rahasia uji. NODE_ENV=test diset otomatis oleh Jest.
process.env.DB_PATH = ":memory:";
process.env.JWT_SECRET = "test-secret-only";
process.env.GOOGLE_CLIENT_ID = "";
delete process.env.SMTP_HOST;
delete process.env.SMTP_USER;
delete process.env.SMTP_PASS;
