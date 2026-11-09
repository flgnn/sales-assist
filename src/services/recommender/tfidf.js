/**
 * TF-IDF murni (tanpa dependensi):
 *   tf  = 1 + ln(count)         (sublinear)
 *   idf = ln((1 + N) / (1 + df)) + 1   (smoothed)
 *   skor kemiripan = cosine antara vektor ternormalisasi L2
 */
class TfidfIndex {
  constructor(docsTokens) {
    this.n = docsTokens.length;
    this.df = new Map();
    docsTokens.forEach(tokens => new Set(tokens).forEach(t => this.df.set(t, (this.df.get(t) || 0) + 1)));
    this.vectors = docsTokens.map(tokens => this.vectorize(tokens));
  }

  idf(term) {
    const df = this.df.get(term);
    if (!df) return 0; // istilah tidak dikenal di korpus tidak ikut menghitung
    return Math.log((1 + this.n) / (1 + df)) + 1;
  }

  vectorize(tokens) {
    const counts = new Map();
    tokens.forEach(t => counts.set(t, (counts.get(t) || 0) + 1));
    const vec = new Map();
    let norm = 0;
    counts.forEach((c, t) => {
      const w = (1 + Math.log(c)) * this.idf(t);
      if (w > 0) { vec.set(t, w); norm += w * w; }
    });
    norm = Math.sqrt(norm);
    if (norm > 0) vec.forEach((w, t) => vec.set(t, w / norm));
    return vec;
  }

  static cosine(a, b) {
    let small = a, large = b;
    if (a.size > b.size) { small = b; large = a; }
    let dot = 0;
    small.forEach((w, t) => { const o = large.get(t); if (o) dot += w * o; });
    return dot;
  }

  /** Skor cosine query terhadap semua dokumen indeks. */
  scores(queryTokens) {
    const q = this.vectorize(queryTokens);
    return { queryVector: q, scores: this.vectors.map(v => TfidfIndex.cosine(q, v)) };
  }
}

module.exports = { TfidfIndex };
