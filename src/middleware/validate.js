/**
 * Validator skema ringan (tanpa dependensi) untuk body / query.
 * Skema: { field: { type: 'string'|'number'|'integer'|'boolean'|'email'|'date', required, min, max, minLength, maxLength, enum, pattern } }
 * Nilai dibersihkan (trim, konversi angka) dan ditempatkan kembali di req.body.
 */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function validateValue(name, rule, raw) {
  const empty = raw === undefined || raw === null || raw === "";
  if (empty) {
    if (rule.required) return { error: `${name} wajib diisi.` };
    return { value: undefined };
  }
  let v = raw;
  switch (rule.type) {
    case "number":
    case "integer": {
      v = typeof raw === "number" ? raw : Number(String(raw).replace(/,/g, "."));
      if (!Number.isFinite(v)) return { error: `${name} harus berupa angka.` };
      if (rule.type === "integer" && !Number.isInteger(v)) return { error: `${name} harus bilangan bulat.` };
      if (rule.min != null && v < rule.min) return { error: `${name} minimal ${rule.min}.` };
      if (rule.max != null && v > rule.max) return { error: `${name} maksimal ${rule.max}.` };
      break;
    }
    case "boolean":
      if (typeof raw === "boolean") v = raw;
      else if (["1", "true", "ya"].includes(String(raw).toLowerCase())) v = true;
      else if (["0", "false", "tidak"].includes(String(raw).toLowerCase())) v = false;
      else return { error: `${name} harus berupa true/false.` };
      break;
    case "email":
      v = String(raw).trim().toLowerCase();
      if (!EMAIL_RE.test(v) || v.length > 254) return { error: `${name} bukan alamat email yang valid.` };
      break;
    case "date":
      v = String(raw).trim();
      if (!DATE_RE.test(v) || Number.isNaN(Date.parse(v))) return { error: `${name} harus berformat YYYY-MM-DD.` };
      break;
    default: {
      if (typeof raw === "object") return { error: `${name} harus berupa teks.` };
      v = String(raw).trim();
      if (rule.minLength != null && v.length < rule.minLength) return { error: `${name} minimal ${rule.minLength} karakter.` };
      if (rule.maxLength != null && v.length > rule.maxLength) return { error: `${name} maksimal ${rule.maxLength} karakter.` };
      if (rule.pattern && !rule.pattern.test(v)) return { error: `${name} formatnya tidak valid.` };
    }
  }
  if (rule.enum && !rule.enum.includes(v)) return { error: `${name} harus salah satu dari: ${rule.enum.join(", ")}.` };
  return { value: v };
}

function validate(schema, source = "body") {
  return (req, res, next) => {
    const input = (source === "query" ? req.query : req.body) || {};
    const out = {};
    for (const [name, rule] of Object.entries(schema)) {
      const r = validateValue(name, rule, input[name]);
      if (r.error) return res.status(400).json({ error: r.error });
      if (r.value !== undefined) out[name] = r.value;
    }
    // Field di luar skema dibuang (mencegah mass-assignment), kecuali bila skema menyatakan passthrough.
    if (source === "body") req.body = out;
    else req.validatedQuery = out;
    next();
  };
}

module.exports = { validate, validateValue, EMAIL_RE };
