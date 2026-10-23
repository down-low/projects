/* fir-db1 PQF page test (read-only): hire date, seniority and appointment type, for Lester,D LE2603 and Goforth,T
 * GO3431. It shows how page 19 (app 1021) is laid out, so a pull for everyone can be built, and reads the fields for
 * the two test people. Nothing in fir-db1 is changed. Digit runs of 5 or more are masked; dates are shown.
 *
 * Run: any signed-in fir-db1 page. Paste this in the console (F12 > Console) and press Enter. It copies a report to
 * the clipboard (paste it back in the chat) and downloads fir-pqf-test.csv.
 */
(async () => {
  const PEOPLE = [{ key: "10ENL31M", id: "LE2603", name: "Lester,David J" }, { key: "21EOA15M", id: "GO3431", name: "Goforth,Todd M" }];
  const WANT = /hire|senior|sen\.|appt|appoint|class|rank|status|date|job|title|step|eligib/i;
  const mask = (s) => String(s == null ? "" : s).replace(/\d{5,}/g, "#").replace(/\s+/g, " ").trim().slice(0, 200);
  const m = /[?&]p=(\d+):\d+:(\d+)/.exec(location.href);
  if (!m) return alert("Open a fir-db1 page first (signed in), then run this again.");
  const page = (extra) => location.origin + location.pathname + "?p=1021:19:" + m[2] + ":::19" + (extra || "::");
  const get = async (url) => {
    const ac = new AbortController(), t = setTimeout(() => ac.abort(), 30000);
    try { return await (await fetch(url, { credentials: "same-origin", signal: ac.signal })).text(); }
    catch (e) { return "ERROR " + (e.name === "AbortError" ? "timeout" : e.message); } finally { clearTimeout(t); }
  };
  const valueOf = (el) => !el ? "" : el.tagName === "SELECT" ? ((el.querySelector("option[selected]") || el.options[el.selectedIndex] || {}).textContent || "")
    : el.tagName === "INPUT" || el.tagName === "TEXTAREA" ? (el.type === "hidden" ? "" : el.getAttribute("value") || "") : el.textContent;
  const shape = (doc, html) => ({
    title: mask(doc.title),
    signedOut: /type="password"/i.test(html) && !/P19_/.test(html),
    items: [...doc.querySelectorAll("[id^=P19_]")].map((e) => e.id + (e.tagName === "SELECT" ? " (select, " + e.options.length + " options)" : e.type === "hidden" ? " (hidden)" : "")).filter((v, i, a) => a.indexOf(v) === i).slice(0, 40),
    regions: [...doc.querySelectorAll("[id][class*=t-Region], [data-region-id], .a-IRR, .t-Report")].map((e) => (e.id || e.getAttribute("data-region-id")) + ": " + mask((e.querySelector(".t-Region-title, h2") || {}).textContent || "")).filter((v, i, a) => a.indexOf(v) === i).slice(0, 15),
    tables: [...doc.querySelectorAll("table")].filter((t) => t.querySelector("th")).map((t) => ({ heads: [...t.querySelectorAll("th")].map((th) => mask(th.textContent)).filter(Boolean).slice(0, 15), rows: [...t.querySelectorAll("tr")].filter((tr) => !tr.querySelector("th")).length })).slice(0, 8),
    pagination: [...doc.querySelectorAll(".t-Report-paginationText, .a-IRR-pagination, td.pagination")].map((e) => mask(e.textContent)).filter(Boolean).slice(0, 3),
    words: ["hire", "senior", "appoint", "appt"].filter((w) => new RegExp(w, "i").test(doc.body ? doc.body.textContent : "")),
  });
  // Label -> value pairs from form items and report tables, kept only when the label looks like a field we want.
  const fields = (doc) => {
    const out = [];
    doc.querySelectorAll("label[for]").forEach((l) => {
      const el = doc.getElementById(l.getAttribute("for")), lab = mask(l.textContent);
      if (el && WANT.test(lab + " " + el.id)) out.push({ field: lab || el.id, item: el.id, value: mask(valueOf(el)) });
    });
    doc.querySelectorAll("[id^=P19_]").forEach((el) => {
      if (/^(INPUT|SELECT|TEXTAREA|SPAN|DIV)$/.test(el.tagName) && WANT.test(el.id) && !out.some((o) => o.item === el.id)) out.push({ field: el.id, item: el.id, value: mask(valueOf(el)) });
    });
    doc.querySelectorAll("table").forEach((t) => {
      const heads = [...t.querySelectorAll("th")].map((th) => mask(th.textContent));
      if (!heads.some((h) => WANT.test(h))) return;
      [...t.querySelectorAll("tr")].filter((tr) => !tr.querySelector("th")).slice(0, 5).forEach((tr, ri) => {
        [...tr.children].forEach((td, ci) => { if (heads[ci] && WANT.test(heads[ci])) out.push({ field: heads[ci] + (ri ? " (row " + (ri + 1) + ")" : ""), item: "table", value: mask(td.textContent) }); });
      });
    });
    return out.slice(0, 40);
  };
  const report = { page19: null, people: [] };
  const html0 = await get(page());
  const doc0 = new DOMParser().parseFromString(html0, "text/html");
  report.page19 = shape(doc0, html0);
  // The employee item: P19_EMPLID if the page has it, else the first P19_ item whose name says employee.
  const items = [...doc0.querySelectorAll("[id^=P19_]")].map((e) => e.id);
  const idItem = items.find((i) => /^P19_EMPLID$/.test(i)) || items.find((i) => /EMPL|EMP_ID|EMPLOYEE|EMP_NO/i.test(i)) || "P19_EMPLID";
  report.employeeItem = idItem + (items.includes(idItem) ? "" : " (guessed; not on the page)");
  const csv = [["key", "emplId", "name", "field", "value", "flag"]];
  for (const p of PEOPLE) {
    const html = await get(page(":" + idItem + ":" + p.id));
    const doc = new DOMParser().parseFromString(html, "text/html");
    const shown = (valueOf(doc.getElementById(idItem)) || "").trim().toUpperCase();
    const f = html.startsWith("ERROR") ? [] : fields(doc);
    const flag = html.startsWith("ERROR") ? html.slice(6) : shown && shown !== p.id ? "mismatch (page shows " + mask(shown) + ")" : !f.length ? "none-found" : shown ? "" : "unchecked";
    report.people.push({ id: p.id, name: p.name, shownId: mask(shown), flag, fields: f, mentions: (doc.body ? doc.body.textContent : "").match(/[^.]{0,40}(hire|senior|appoint)[^.]{0,60}/gi)?.slice(0, 6).map(mask) || [] });
    if (!f.length) csv.push([p.key, p.id, p.name, "", "", flag]);
    f.forEach((x) => csv.push([p.key, p.id, p.name, x.field, x.value, flag]));
  }
  const text = JSON.stringify(report, null, 2);
  console.log(text);
  try { copy(text); console.log("Report copied to the clipboard."); } catch (e) { console.log("Copy the report above."); }
  const q = (v) => { v = v == null ? "" : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv.map((r) => r.map(q).join(",")).join("\n")], { type: "text/csv" }));
  a.download = "fir-pqf-test.csv";
  document.body.appendChild(a); a.click(); a.remove();
})();
