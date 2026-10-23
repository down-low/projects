/* fir-db1 licenses paging probe (read-only). Every license pull so far topped out at 6 rows a person, so the Licenses
 * and Certs list is probably shown a page at a time. This shows how that list pages, for one person, so the pull can
 * read every page. It prints counts, headings, pagination text and request names only: digit runs of 5 or more are
 * masked and no license number is shown.
 *
 * Run: any signed-in fir-db1 page. Paste this in the console (F12 > Console) and press Enter. It asks for an Employee
 * ID (Babcock BA2628 by default) and copies its report to the clipboard; paste that back in the chat.
 */
(async () => {
  const mask = (s) => String(s == null ? "" : s).replace(/\d{5,}/g, "#").replace(/\s+/g, " ").trim().slice(0, 300);
  const m = /[?&]p=(\d+):\d+:(\d+)/.exec(location.href);
  if (!m) return alert("Open a fir-db1 page first (signed in), then run this again.");
  const id = (prompt("Employee ID to check (someone with many licenses)", "BA2628") || "").trim().toUpperCase();
  if (!/^[A-Z]{2}\d{4}$/.test(id)) return alert("Use an Employee ID like BA2628.");
  const url = location.origin + location.pathname + "?p=1021:2:" + m[2] + ":::RP,2:P2_EMPLID:" + id;
  const shape = (reg) => {
    if (!reg) return null;
    const rows = [...reg.querySelectorAll("tr")].filter((tr) => !tr.querySelector("table") && tr.querySelector("td"));
    const pag = [...reg.querySelectorAll("[class*=pagination], [class*=Pagination], .t-Report-paginationText, td.pagination, a[href*=paginate], button[data-action]")]
      .map((e) => mask(e.className + " | " + e.textContent + " | " + (e.getAttribute("href") || e.getAttribute("onclick") || e.getAttribute("data-action") || "")));
    const text = mask(reg.textContent).match(/(row\(s\)|rows?)?\s*\d+\s*-\s*\d+(\s*of\s*\d+)?/gi) || [];
    return { rows: rows.length, heads: [...reg.querySelectorAll("th")].map((t) => mask(t.textContent)).filter(Boolean).slice(0, 8),
      pagination: pag.slice(0, 10), rangeText: text.slice(0, 5),
      ids: [...reg.querySelectorAll("[id]")].map((e) => e.id).filter((x) => /report|pagin|R\d/i.test(x)).slice(0, 10).map(mask),
      dataAttrs: [...reg.querySelectorAll("*")].flatMap((e) => [...e.attributes].filter((a) => /^data-/.test(a.name)).map((a) => a.name + "=" + mask(a.value))).slice(0, 12) };
  };
  const out = { id, step1: null, scripts: [], step2: null };
  // 1. The page as a plain fetch returns it (what the pull reads).
  const html = await (await fetch(url, { credentials: "same-origin" })).text();
  const doc = new DOMParser().parseFromString(html, "text/html");
  out.step1 = shape(doc.getElementById("LICENSES_AND_CERTS"));
  out.scripts = (html.match(/[^;\n]{0,80}(LICENSES_AND_CERTS|pg_R_|paginate|p_pg_m(in|ax)_row|FSP_|widget\.report)[^;\n]{0,120}/g) || []).map(mask).slice(0, 12);
  // 2. The page in a hidden frame: count rows, then try its own Next control once, and count again.
  out.step2 = await new Promise((resolve) => {
    const f = document.createElement("iframe");
    f.style.cssText = "position:fixed;width:900px;height:700px;left:-2000px;top:0";
    f.src = url;
    const finish = (r) => { clearTimeout(t); f.remove(); resolve(r); };
    const t = setTimeout(() => finish({ error: "frame-timeout" }), 25000);
    f.onload = () => setTimeout(async () => {
      try {
        const d = f.contentDocument, w = f.contentWindow, reg = () => d.getElementById("LICENSES_AND_CERTS");
        const before = shape(reg());
        let region = null;
        try { const r = w.apex && w.apex.region("LICENSES_AND_CERTS"); region = r ? { type: r.type || null } : null; } catch (e) { region = "error: " + e.message; }
        const next = reg() && [...reg().querySelectorAll("a, button")].find((a) => /next|›|>|»/i.test((a.textContent || "") + (a.getAttribute("title") || "") + (a.getAttribute("aria-label") || "")));
        const sent = [];
        const xo = w.XMLHttpRequest.prototype.open, xs = w.XMLHttpRequest.prototype.send;
        w.XMLHttpRequest.prototype.open = function (mm, u) { this.__u = u; return xo.apply(this, arguments); };
        w.XMLHttpRequest.prototype.send = function (b) {
          const names = []; try { new URLSearchParams(typeof b === "string" ? b : "").forEach((v, k) => names.push(k + (/^(p_request|p_widget_name|p_widget_action|x01|x02|p_pg_min_row|p_pg_max_rows|p_pg_rows_fetched)$/.test(k) ? "=" + mask(v).slice(0, 40) : ""))); } catch (e) { }
          sent.push(String(this.__u).replace(/\?.*$/, "") + " " + names.join("&")); return xs.apply(this, arguments);
        };
        if (next) next.click();
        await new Promise((r) => setTimeout(r, 3000));
        finish({ before, apexRegion: region, nextControl: next ? mask(next.outerHTML).slice(0, 200) : null, requests: sent.slice(0, 5), after: shape(reg()) });
      } catch (e) { finish({ error: e.message }); }
    }, 1500);
    document.body.appendChild(f);
  });
  const text = JSON.stringify(out, null, 2);
  console.log(text);
  try { copy(text); console.log("Report copied to the clipboard."); } catch (e) { console.log("Copy the report above."); }
})();
