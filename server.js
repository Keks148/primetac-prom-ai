import express from "express";

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static("public"));

const PORT = process.env.PORT || 3000;
const PROM_BASE = "https://my.prom.ua/api/v1";

function requirePromToken(req, res, next) {
  if (!process.env.PROM_TOKEN) return res.status(500).json({ error: "PROM_TOKEN не задан на сервере" });
  next();
}

async function promRequest(path) {
  const response = await fetch(`${PROM_BASE}${path}`, {
    headers: { Authorization: `Bearer ${process.env.PROM_TOKEN}`, Accept: "application/json" }
  });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!response.ok) {
    const err = new Error(`Prom API: ${response.status}`);
    err.status = response.status; err.data = data; throw err;
  }
  return data;
}

app.get("/api/health", (req, res) => {
  res.json({ ok: true, promConfigured: Boolean(process.env.PROM_TOKEN), aiConfigured: Boolean(process.env.OPENAI_API_KEY) });
});

app.get("/api/products", requirePromToken, async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit || 50), 1), 100);
    const lastId = req.query.last_id ? `&last_id=${encodeURIComponent(req.query.last_id)}` : "";
    res.json(await promRequest(`/products/list?limit=${limit}${lastId}`));
  } catch (e) { res.status(e.status || 500).json({ error: e.message, details: e.data || null }); }
});

app.get("/api/orders", requirePromToken, async (req, res) => {
  try { res.json(await promRequest("/orders/list")); }
  catch (e) { res.status(e.status || 500).json({ error: e.message, details: e.data || null }); }
});

app.post("/api/analyze", async (req, res) => {
  try {
    if (!process.env.OPENAI_API_KEY) return res.status(400).json({ error: "OPENAI_API_KEY не задан на сервере" });
    const product = req.body?.product;
    if (!product) return res.status(400).json({ error: "Нет данных товара" });

    const model = process.env.OPENAI_MODEL || "gpt-5.6-sol";
    const prompt = `Ты помощник украинского интернет-магазина тактической одежды и снаряжения.\n\nПравила поставщика Militaris:\n- Salomon: скидка 20%\n- Helikon-Tex: 10%\n- LOWA: 5%\n- Belleville: 15%\n- остальное: 15%\n\nПроанализируй карточку товара Prom.ua и ответь кратко на русском:\n1) качество названия;\n2) что исправить в карточке;\n3) ориентировочная закупочная цена по правилу бренда, если текущая цена — розничная цена поставщика;\n4) валовая маржа при текущей цене;\n5) стоит ли продвигать;\n6) предложи улучшенное украинское название для Prom.\n\nНе придумывай цены конкурентов. Если их нет во входных данных, скажи, что для этого нужен отдельный веб-анализ.\n\nТовар:\n${JSON.stringify(product, null, 2)}`;

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, input: prompt })
    });
    const data = await response.json();
    if (!response.ok) return res.status(response.status).json({ error: "OpenAI API error", details: data });
    const text = data.output_text || (data.output || []).flatMap(x => x.content || []).filter(x => x.type === "output_text").map(x => x.text).join("\n") || "Ответ получен, но текст не найден.";
    res.json({ text });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.listen(PORT, "0.0.0.0", () => console.log(`PrimeTac Prom AI running on port ${PORT}`));
