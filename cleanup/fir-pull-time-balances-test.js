/* Tour schedule: fir-db1 time balances pull (test: Lester,D LE2603 and Goforth,T GO3431). Paste in the console on a
 * signed-in fir-db1 tab. Reads the Time Balance pop-up (region TIME_BALANCES on the employee page, app 1021 page 2):
 * type, hours, as-of date, scheduled hours. Downloads fir-time-balances.csv. If the pop-up isn't in the page HTML, it
 * opens each employee page in a hidden frame and refreshes the region there instead (flag "frame").
 */
(async function balancesMain(PLAN) {
  const m = /[?&]p=(\d+):\d+:(\d+)/.exec(location.href);
  if (!m) return alert("Open a fir-db1 page first (signed in), then run this again.");
  const base = location.origin + location.pathname + "?p=1021:2:" + m[2] + ":::RP,2:P2_EMPLID:";
  const COLS = ["key", "emplId", "name", "type", "hours", "asOf", "scheduled", "flag"];
  const txt = (c) => c.textContent.replace(/\s+/g, " ").trim();
  const rowsOf = (reg) => {
    const out = [];
    if (!reg) return out;
    [...reg.querySelectorAll("tr")].filter((tr) => !tr.querySelector("table")).forEach((tr) => {
      const cells = [...tr.children].filter((c) => /^T[DH]$/.test(c.tagName)).map(txt);
      if (cells.length < 2 || /^Type$/i.test(cells[0]) || !/^[A-Z]{1,4}$/.test(cells[0])) return;
      out.push({ type: cells[0], hours: cells[1] || "", asOf: cells[2] || "", scheduled: cells[3] === "-" ? "" : (cells[3] || "") });
    });
    return out;
  };
  const shownId = (doc) => { const f = doc.getElementById("P2_EMPLID"); return f ? (f.getAttribute("value") || f.value || f.textContent || "").trim().toUpperCase() : ""; };
  const viaHtml = async (id) => {
    const h = await (await fetch(base + encodeURIComponent(id), { credentials: "same-origin" })).text();
    if (/type="password"/i.test(h) && !/TIME_BALANCES/.test(h)) throw new Error("signed-out");
    const doc = new DOMParser().parseFromString(h, "text/html"), s = shownId(doc);
    if (s && s !== id) return { flag: "mismatch", items: [] };
    return { flag: doc.getElementById("TIME_BALANCES") ? "" : "no-region", items: rowsOf(doc.getElementById("TIME_BALANCES")) };
  };
  const viaFrame = (id) => new Promise((resolve) => {
    const f = document.createElement("iframe");
    f.style.cssText = "position:fixed;width:10px;height:10px;left:-50px;top:-50px;";
    f.src = base + encodeURIComponent(id);
    const done = (r) => { clearTimeout(t); f.remove(); resolve(r); };
    const t = setTimeout(() => done({ flag: "frame-timeout", items: [] }), 20000);
    f.onload = () => {
      try {
        const w = f.contentWindow, doc = f.contentDocument;
        if (w.jQuery) w.jQuery("#TIME_BALANCES").trigger("apexrefresh");
        setTimeout(() => done({ flag: "frame", items: rowsOf(doc.getElementById("TIME_BALANCES")) }), 3000);
      } catch (e) { done({ flag: "frame-error", items: [] }); }
    };
    document.body.appendChild(f);
  });
  const out = [];
  for (const p of PLAN.people) {
    let r;
    try { r = await viaHtml(p.id); } catch (e) { if (e.message === "signed-out") return alert("fir-db1 signed you out. Sign in again and paste this again."); r = { flag: "error", items: [] }; }
    if (!r.items.length && r.flag !== "mismatch") r = await viaFrame(p.id);
    if (!r.items.length) out.push([p.key, p.id, p.name, "", "", "", "", r.flag || "none"]);
    r.items.forEach((it) => out.push([p.key, p.id, p.name, it.type, it.hours, it.asOf, it.scheduled, r.flag]));
    console.log("time balances: " + p.name + " " + p.id + " " + r.items.length + " rows " + (r.flag || ""));
  }
  const q = (v) => { v = v == null ? "" : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  const csv = [COLS.join(",")].concat(out.map((r) => r.map(q).join(","))).join("\n");
  console.log(csv);
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.download = PLAN.fileName;
  document.body.appendChild(a); a.click(); a.remove();
})({ fileName: "fir-time-balances.csv", people: [
  { key: "10ENL31M", id: "LE2603", name: "Lester,David J" },
  { key: "21EOA15M", id: "GO3431", name: "Goforth,Todd M" },
] });
