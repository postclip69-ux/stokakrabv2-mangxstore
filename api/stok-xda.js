// api/stok-xda.js
// Serverless (Vercel) – Normalisasi stok KHFY dan tangani kondisi "stok kosong" tanpa error.
// API ini KHUSUS untuk XDA
// ENV opsional: UPSTREAM_URL_XDA, CORS_ORIGIN, FETCH_TIMEOUT_MS

const DEFAULT_UPSTREAM = process.env.UPSTREAM_URL_XDA
  || "https://panel.khfy-store.com/api_v3/cek_stock_akrab_v2";

const FETCH_TIMEOUT_MS = Number(process.env.FETCH_TIMEOUT_MS || 10000);

function cors(req, res) {
  const origin = process.env.CORS_ORIGIN || "*";
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-api-key");
}

function toNumber(x) {
  if (x == null) return 0;
  if (typeof x === "number" && Number.isFinite(x)) return x;
  const n = parseInt(String(x).replace(/[^\d-]/g, ""), 10);
  return Number.isFinite(n) ? n : 0;
}

// --- FUNGSI PARSING BARU ---
// Dibuat khusus untuk membaca JSON {"status": true, "message": "..."}
function extractFromStringMessage(raw) {
  const out = [];

  // 1. Pastikan data valid
  if (!raw || raw.status !== true || typeof raw.message !== 'string' || !raw.message.trim()) {
    return []; // Kembalikan array kosong jika format tidak dikenal
  }

  // 2. Ambil string 'message' dan pecah per baris
  const lines = raw.message.split('\n'); 

  // 3. Looping setiap baris
  for (const line of lines) {
    const trimmedLine = line.trim();
    if (!trimmedLine) continue; // Lewati baris kosong

    // 4. Pecah baris berdasarkan karakter '|'
    const parts = trimmedLine.split('|'); 
    if (parts.length < 2) continue; // Lewati baris yang formatnya salah

    // 5. Ambil data
    const sku = parts[0].trim().toUpperCase();
    const name = sku; // Di format ini, nama dan SKU sama
    const stock = toNumber(parts[1]); // " 0 unit " akan diubah menjadi 0

    if (sku) {
      out.push({ sku: sku, name: name, stock: stock });
    }
  }
  return out;
}
// --- AKHIR FUNGSI BARU ---


module.exports = async (req, res) => {
  cors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Method not allowed" });

  const url = DEFAULT_UPSTREAM;

  // Timeout via AbortController
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);

  try {
    const r = await fetch(url, {
      method: "GET",
      headers: { "accept": "application/json, text/html;q=0.9, */*;q=0.8" },
      signal: ac.signal
    }).catch(e => { throw e; });
    clearTimeout(timer);

    const text = await r.text();
    let json; try { json = JSON.parse(text); } catch { json = null; }

    // --- PERUBAHAN UTAMA DI SINI ---
    // Kita panggil fungsi parsing baru kita
    let list = extractFromStringMessage(json);
    // --- AKHIR PERUBAHAN ---

    // --- JANGAN error ketika kosong --- //
    // Blok ini akan terlewati jika API mengirimkan list (meskipun stoknya 0)
    if (!list.length) {
      res.setHeader("Cache-Control", "s-maxage=15, stale-while-revalidate=60");
      return res.status(200).json({
        ok: true,
        count: 0,
        list: [],
        text: "(Info) Saat ini stok kosong / belum tersedia.\nSilakan cek lagi nanti.",
        upstream_ok: r.ok,
        upstream_status: r.status
      });
    }

    // Susun text block mirip WA
    const lines = list.map(it => `(${it.sku}) ${it.name} : ${toNumber(it.stock)}`);
    const textBlock = lines.join("\n");

    res.setHeader("Cache-Control", "s-maxage=30, stale-while-revalidate=300");
    return res.status(200).json({ ok: true, count: list.length, list, text: textBlock });
  } catch (e) {
    const isAbort = e && (e.name === "AbortError" || e.code === "ABORT_ERR");
    return res.status(isAbort ? 504 : 502).json({
      ok: false,
      error: isAbort ? "Timeout ke server supplier" : (e && e.message) || "Proxy error"
    });
  }
};
