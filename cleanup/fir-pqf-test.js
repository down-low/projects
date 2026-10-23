/* fir-db1 PQF page test, version 2 (read-only): hire date, seniority, appointment type and the appointment history, for
 * Lester,D LE2603, Goforth,T GO3431 and Boldt,A BO3091. It shows how page 19 (app 1021) is laid out, so a pull for
 * everyone can be built, and reads the fields for the test people: the "Label: value" details on the left and every
 * row of the tables on the right. Nothing in fir-db1 is changed. Digit runs of 7 or more are masked (so a 5-digit
 * seniority number shows); dates are shown.
 *
 * Run: any signed-in fir-db1 page. Paste this in the console (F12 > Console) and press Enter. It copies a report to
 * the clipboard (paste it back in the chat) and downloads fir-pqf-test.csv.
 */
(async () => {
  const PEOPLE = [{ key: "10ENL31M", id: "LE2603", name: "Lester,David J" }, { key: "21EOA15M", id: "GO3431", name: "Goforth,Todd M" },
    { key: "person:x-BO3091", id: "BO3091", name: "Boldt,Austin C" }];
  const WANT = /hire|senior|sen\.|appt|appoint|class|rank|status|date|job|title|step|eligib|entry|course/i;
  const mask = (s) => String(s == null ? "" : s).replace(/\d{7,}/g, "#").replace(/\s+/g, " ").trim().slice(0, 200);
  const m = /[?&]p=(\d+):\d+:(\d+)/.exec(location.href);
  if (!m) return alert("Open a fir-db1 page first (signed in), then run this again.");
  const page = (extra) => location.origin + location.pathname + "?p=1021:19:" + m[2] + ":::19" + (extra || "::");
  const get = async (url) => {
    const ac = new AbortController(), t = setTimeout(() => ac.abort(), 30000);
    try { return await (await fetch(url, { credentials: "same-origin", signal: ac.signal })).text(); }
    catch (e) { return "ERROR " + (e.name === "AbortError" ? "timeout" : e.message); } finally { clearTimeout(t); }
  };
  // APEX display-only items keep the shown value in a *_DISPLAY span and the raw one in a hidden input.
  const itemValue = (doc, id) => {
    const disp = doc.getElementById(id + "_DISPLAY");
    if (disp && disp.textContent.trim()) return disp.textContent;
    const el = doc.getElementById(id);
    if (el && el.tagName === "INPUT" && el.type === "hidden") return el.getAttribute("value") || "";
    return valueOf(el);
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
    const seen = new Set();
    const add = (field, item, value) => { const k = field + "|" + value; if (!seen.has(k)) { seen.add(k); out.push({ field, item, value }); } };
    doc.querySelectorAll("label[for]").forEach((l) => {
      const id = l.getAttribute("for"), el = doc.getElementById(id) || doc.getElementById(id + "_DISPLAY"), lab = mask(l.textContent).replace(/:$/, "");
      if (el && WANT.test(lab + " " + id)) add(lab || id, id, mask(itemValue(doc, id)));
    });
    // "Label:" followed by its value: two cells of a row, a dt/dd pair, or neighbouring elements.
    doc.querySelectorAll("td, th, dt, span, div, b, strong").forEach((e) => {
      if (e.children.length > 1) return;
      const lab = (e.textContent || "").replace(/\s+/g, " ").trim();
      if (!/^[A-Za-z][A-Za-z .#/()-]{1,40}:$/.test(lab) || !WANT.test(lab)) return;
      let v = e.nextElementSibling;
      while (v && !v.textContent.trim()) v = v.nextElementSibling;
      if (!v && e.parentElement && e.parentElement.children.length === 1) v = e.parentElement.nextElementSibling;
      if (v && v.textContent.trim().length < 120) add(mask(lab.replace(/:$/, "")), "label", mask(v.textContent));
    });
    doc.querySelectorAll("[id^=P19_]").forEach((el) => {
      const id = el.id.replace(/_DISPLAY$/, "");
      if (/^(INPUT|SELECT|TEXTAREA|SPAN|DIV)$/.test(el.tagName) && WANT.test(id) && !out.some((o) => o.item === id)) add(id, id, mask(itemValue(doc, id)));
    });
    doc.querySelectorAll("table").forEach((t) => {
      const heads = [...t.querySelectorAll("th")].map((th) => mask(th.textContent));
      if (!heads.some((h) => WANT.test(h))) return;
      [...t.querySelectorAll("tr")].filter((tr) => !tr.querySelector("th")).forEach((tr, ri) => {
        [...tr.children].forEach((td, ci) => { if (heads[ci]) add(heads[ci] + " (row " + (ri + 1) + ")", "table", mask(td.textContent)); });
      });
    });
    return out.slice(0, 120);
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
    const shown = (itemValue(doc, idItem) || "").trim().toUpperCase();
    const f = html.startsWith("ERROR") ? [] : fields(doc);
    const flag = html.startsWith("ERROR") ? html.slice(6) : shown && shown !== p.id ? "mismatch (page shows " + mask(shown) + ")" : !f.length ? "none-found" : shown ? "" : "unchecked";
    report.people.push({ id: p.id, name: p.name, shownId: mask(shown), flag, fields: f, heading: mask((doc.querySelector("h1, .t-Region-title") || {}).textContent || ""), tableRows: doc.querySelectorAll("tbody tr").length,
      mentions: (doc.body ? doc.body.textContent : "").match(/[^.]{0,40}(hire|senior|appoint)[^.]{0,60}/gi)?.slice(0, 6).map(mask) || [] });
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
