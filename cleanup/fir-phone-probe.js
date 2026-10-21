/* fir-db1 phone pop-up probe (read-only). Shows how the Phone numbers pop-up gets its rows, so a script can pull them
 * for the people in cleanup/missing-cells.md. Prints no phone numbers: every digit run that looks like one is masked.
 *
 * Run: fir-db1, page 2, with one employee's time showing (the page that has the Phone numbers link). Paste this into
 * the console (F12 > Console) and press Enter. It copies its report to the clipboard; paste that back in the chat.
 */
(async () => {
  const mask = (s) => String(s == null ? "" : s).replace(/\+?\(?\d[\d\s().\-]{8,}\d/g, "#").slice(0, 300);
  const out = { url: location.pathname + location.search.replace(/\d{3}[\d\s().\-]{6,}\d/g, "#"), apex: typeof apex !== "undefined" };
  const reg = () => document.getElementById("PHONE_NUMBERS");
  const shape = (el) => {
    if (!el) return null;
    const t = el.querySelector("table");
    const heads = t ? [...t.querySelectorAll("th")].map((th) => th.textContent.trim()).filter(Boolean) : [];
    const rows = t ? t.querySelectorAll("tbody tr").length : 0;
    return { cls: el.className, tables: el.querySelectorAll("table").length, heads, rows,
      text: mask(el.textContent.replace(/\s+/g, " ").trim()).slice(0, 160) };
  };
  out.before = shape(reg());
  // 1. Is the pop-up already in the page HTML a plain fetch returns (what the time scripts read)?
  try {
    const html = await (await fetch(location.href, { credentials: "same-origin" })).text();
    const doc = new DOMParser().parseFromString(html, "text/html");
    out.inFetchedHtml = shape(doc.getElementById("PHONE_NUMBERS"));
  } catch (e) { out.fetchError = String(e); }
  // 2. What the refresh asks the server for (request names and parameter names; values masked).
  out.requests = [];
  const seen = (url, body) => {
    let params = {};
    try { new URLSearchParams(typeof body === "string" ? body : "").forEach((v, k) => { params[k] = /^(p_request|p_flow_id|p_flow_step_id)$/.test(k) ? v : mask(v).slice(0, 40); }); } catch (e) { /* not form data */ }
    if (typeof body === "string" && body.trim().startsWith("{")) params = { json: mask(body).slice(0, 300) };
    out.requests.push({ url: String(url).replace(/\?.*$/, ""), params });
  };
  const xo = XMLHttpRequest.prototype.open, xs = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (m, u) { this.__u = u; return xo.apply(this, arguments); };
  XMLHttpRequest.prototype.send = function (b) { seen(this.__u, b); return xs.apply(this, arguments); };
  const fo = window.fetch;
  window.fetch = function (u, o) { seen(u, o && o.body); return fo.apply(this, arguments); };
  try {
    if (out.apex) {
      try { const r = apex.region("PHONE_NUMBERS"); out.regionType = r ? r.type : null; } catch (e) { out.regionType = "error: " + e.message; }
      out.pageItems = [...document.querySelectorAll("[id^=P2_]")].map((e) => e.id).filter((v, i, a) => a.indexOf(v) === i).slice(0, 40);
    }
    if (window.jQuery) jQuery("#PHONE_NUMBERS").trigger("apexrefresh");
    await new Promise((r) => setTimeout(r, 3000));
  } finally {
    XMLHttpRequest.prototype.open = xo; XMLHttpRequest.prototype.send = xs; window.fetch = fo;
  }
  out.after = shape(reg());
  const text = JSON.stringify(out, null, 2);
  console.log(text);
  try { copy(text); console.log("Report copied to the clipboard."); } catch (e) { console.log("Copy the report above."); }
})();
