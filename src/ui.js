function esc(value) {
  return String(
    value ?? ""
  )
    .replace(
      /&/g,
      "&amp;"
    )
    .replace(
      /</g,
      "&lt;"
    )
    .replace(
      />/g,
      "&gt;"
    )
    .replace(
      /"/g,
      "&quot;"
    );
}

function card(
  title,
  value,
  sub = ""
) {
  return `<div class="card"><div class="label">${esc(title)}</div><div class="value">${esc(value)}</div>${sub ? `<div class="sub">${esc(sub)}</div>` : ""}</div>`;
}

function renderDashboard({
  state,
  config
}) {
  const r =
    state.report;

  const sampleFamilies =
    r?.samples?.families ||
    r?.safeExamples ||
    [];

  const body =
    r
      ? `
    <div class="grid">
      ${card("Товарів Prom", r?.prom?.products ?? 0)}
      ${card("Груп Prom", r?.prom?.groups ?? 0)}
      ${card("BEZET", r?.suppliers?.BEZET?.offers ?? 0, r?.suppliers?.BEZET?.ok ? "OK" : "ПОМИЛКА")}
      ${card("Militaris", r?.suppliers?.MILITARIS?.offers ?? 0, r?.suppliers?.MILITARIS?.ok ? "OK" : "ПОМИЛКА")}
      ${card("Точних збігів", r?.matching?.exactMatches ?? 0)}
      ${card("Не зіставлено", r?.matching?.unmatchedPromProducts ?? 0)}
      ${card("Сімей різновидів XML", r?.variants?.totalFamilies ?? 0)}
      ${card("Товарів у сім'ях", r?.variants?.totalVariantOffers ?? 0)}
    </div>

    <section>
      <h2>Різновиди</h2>
      <div class="row">
        <span>BEZET: <b>${esc(r?.variants?.bySupplier?.BEZET ?? 0)}</b></span>
        <span>Militaris: <b>${esc(r?.variants?.bySupplier?.MILITARIS ?? 0)}</b></span>
        <span>Сімей з точним Prom↔XML збігом: <b>${esc(r?.variants?.matchedFamilies ?? 0)}</b></span>
      </div>
    </section>

    <section>
      <h2>Приклади XML-сімей</h2>
      <div class="tablewrap">
        <table>
          <thead><tr><th>Постачальник</th><th>group_id</th><th>Варіантів</th><th>Приклад</th></tr></thead>
          <tbody>
          ${sampleFamilies
            .slice(
              0,
              15
            )
            .map(
              f => `
            <tr>
              <td>${esc(f?.supplier || "")}</td>
              <td>${esc(f?.groupId || "")}</td>
              <td>${esc(f?.count ?? f?.supplierVariantCount ?? "")}</td>
              <td>${esc(f?.sample?.[0]?.name || f?.title || "")}</td>
            </tr>`
            )
            .join("") ||
            `<tr><td colspan="4">Немає даних</td></tr>`}
          </tbody>
        </table>
      </div>
    </section>
  `
      : `
    <section>
      <h2>Аудит ще не завершено</h2>
      <p class="muted">Сервіс сам запустить READ ONLY аудит після старту.</p>
    </section>
  `;

  const error =
    state.lastError
      ? `<section class="error"><h2>Остання помилка</h2><pre>${esc(state.lastError)}</pre></section>`
      : "";

  return `<!doctype html>
<html lang="uk">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>PrimeTac Sync v1.5.5</title>
<style>
:root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;background:#0d1117;color:#e6edf3;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif}.wrap{max-width:1100px;margin:0 auto;padding:20px}header{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;flex-wrap:wrap;margin-bottom:18px}h1{margin:0 0 6px;font-size:28px}h2{margin:0 0 12px;font-size:18px}.badge{display:inline-block;padding:6px 10px;border:1px solid #3fb950;border-radius:999px;color:#3fb950;font-weight:700}.muted{color:#8b949e}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-bottom:16px}.card,section{background:#161b22;border:1px solid #30363d;border-radius:12px;padding:16px}section{margin:12px 0}.label{color:#8b949e;font-size:13px}.value{font-size:30px;font-weight:800;margin-top:4px}.sub{color:#8b949e;font-size:12px;margin-top:4px}button{appearance:none;border:0;border-radius:10px;padding:12px 16px;background:#238636;color:white;font-weight:700;cursor:pointer}button:disabled{opacity:.55;cursor:wait}.row{display:flex;gap:18px;flex-wrap:wrap}.tablewrap{overflow:auto}table{width:100%;border-collapse:collapse;min-width:650px}th,td{text-align:left;border-bottom:1px solid #30363d;padding:10px;font-size:14px}th{color:#8b949e}.error{border-color:#f85149}pre{white-space:pre-wrap;word-break:break-word;font-size:12px}.config{font-size:12px;color:#8b949e;margin-top:8px}
</style>
</head>
<body>
<div class="wrap">
<header>
<div>
<h1>PrimeTac Sync v1.5.5</h1>
<span class="badge">READ ONLY</span>
<div class="config">
Prom token: ${config.hasPromToken ? "✓" : "✗"} ·
BEZET XML: ${config.hasBezetXmlUrl ? "✓" : "✗"} ·
Militaris XML: ${config.hasMilitarisXmlUrl ? "✓" : "✗"}
</div>
</div>
<button id="audit" ${state.running ? "disabled" : ""}>${state.running ? "Аудит виконується…" : "Запустити аудит"}</button>
</header>
${body}
${error}
<p class="muted">Останній запуск: ${esc(state.lastStartedAt || "—")} · завершено: ${esc(state.lastFinishedAt || "—")}</p>
</div>
<script>
const btn=document.getElementById("audit");
btn?.addEventListener("click",async()=>{btn.disabled=true;btn.textContent="Аудит виконується…";try{const r=await fetch("/api/audit",{method:"POST"});const j=await r.json();if(!j.ok)throw new Error(j.error||"Audit failed");location.reload()}catch(e){alert(e.message||e);location.reload()}});
${state.running ? `setTimeout(()=>location.reload(),5000);` : ""}
</script>
</body>
</html>`;
}

module.exports = {
  renderDashboard
};
