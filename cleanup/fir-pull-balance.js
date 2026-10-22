/* Tour schedule: fir-db1 daily balance report pull (status and hire tables, dates asked when it runs). Paste in the console on the balance report page. */
(function balanceMain(PLAN) {
    const m = /[?&]p=(\d+):(\d+):(\d+)/.exec(location.href);
    if (!m) return alert("Open the balance report in fir-db1 first, then run this again.");
    const [, app, pg, session] = m, DATE = /^\d{1,2}\/\d{1,2}\/\d{4}$/;
    let item = null;
    const u = /[?&]p=[^&]*?:NO::([^:&]+):([^:&]+)/.exec(location.href);
    if (u) { const names = decodeURIComponent(u[1]).split(","), vals = decodeURIComponent(u[2]).split(","); const k = vals.findIndex((v) => DATE.test(v)); if (k >= 0) item = names[k]; }
    if (!item) { const f = [...document.querySelectorAll("input[id^='P" + pg + "_']")].find((e) => DATE.test(e.value || "")); if (f) item = f.id; }
    if (!item) item = (prompt("Page " + pg + ": name of the date item (e.g. P" + pg + "_DATE)", "P" + pg + "_DATE") || "").trim();
    if (!item) return;
    const t = new Date(), md = (d) => (d.getMonth() + 1) + "/" + d.getDate() + "/" + d.getFullYear();
    const from = PLAN.from || (prompt("First date (MM/DD/YYYY)", md(t)) || "").trim(), to = PLAN.to || (prompt("Last date (MM/DD/YYYY)", from) || "").trim();
    if (!DATE.test(from) || !DATE.test(to)) return alert("Use dates like 10/22/2026.");
    const dt = (x) => { const a = x.split("/"); return new Date(+a[2], a[0] - 1, +a[1]); };
    const dates = [];
    for (let d = dt(from); d <= dt(to); d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) dates.push(md(d));
    const base = location.origin + location.pathname + "?p=" + app + ":" + pg + ":" + session + "::NO::" + item + ":";
    const txt = (c) => c.textContent.replace(/\s+/g, " ").trim();
    const read = (html, date) => {
      const doc = new DOMParser().parseFromString(html, "text/html"), out = [];
      doc.querySelectorAll("table").forEach((tb) => {
        const trs = [...tb.querySelectorAll("tr")].filter((tr) => tr.closest("table") === tb);
        const rowText = (tr) => [...tr.children].map(txt).join(" ");
        const hi = trs.findIndex((tr) => [...tr.children].some((c) => /^(Status|Rank)$/.test(txt(c))) && /\b(OFF|Voluntary)\b/.test(rowText(tr)));
        if (hi < 0) return;
        const head = [...trs[hi].children].map(txt);
        // One table or two side by side: split the header where a block starts (Status, Rank).
        const starts = head.map((h, i) => (/^(Status|Rank)$/.test(h) ? i : -1)).filter((i) => i >= 0);
        starts.forEach((s, n) => {
          const e = n + 1 < starts.length ? starts[n + 1] : head.length, cols = head.slice(s + 1, e), table = head[s] === "Rank" ? "hires" : "status";
          trs.slice(hi + 1).forEach((tr) => {
            const c = [...tr.children].map(txt), key = c[s];
            if (!key) return;
            const r = { date, table, key };
            cols.forEach((h, j) => { r[h] = c[s + 1 + j] || ""; });
            out.push(r);
          });
        });
      });
      if (!out.length) out.push({ date, table: /type="password"/i.test(html) ? "signed-out" : "not-found",
        key: [...doc.querySelectorAll("table")].slice(-4).map((tb) => [...tb.querySelectorAll("tr")].slice(0, 3).map((tr) => [...tr.children].map(txt).join(" ")).join(" / ").slice(0, 140)).join(" | ").slice(0, 600) });
      return out;
    };
    return (async () => {
      const all = [];
      for (let k = 0; k < dates.length; k++) {
        const rows = read(await (await fetch(base + encodeURIComponent(dates[k]), { credentials: "same-origin" })).text(), dates[k]);
        if (rows[0].table === "signed-out") { alert("fir-db1 signed you out after " + k + " of " + dates.length + " days. Sign in and run again from " + dates[k] + "."); break; }
        rows.forEach((r) => all.push(r));
        console.log("balance pull " + (k + 1) + "/" + dates.length + ": " + dates[k] + " (" + rows.length + " rows)");
        await new Promise((r) => setTimeout(r, 400));
      }
      const cols = ["date", "table", "key"];
      all.forEach((r) => Object.keys(r).forEach((h) => { if (cols.indexOf(h) < 0) cols.push(h); }));
      const q = (v) => { v = v == null ? "" : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
      const csv = [cols.join(",")].concat(all.map((r) => cols.map((c) => q(r[c])).join(","))).join("\n");
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
      a.download = PLAN.fileName || ("fir-balance-" + from.replace(/\//g, "-") + (to !== from ? "_to_" + to.replace(/\//g, "-") : "") + ".csv");
      document.body.appendChild(a); a.click(); a.remove();
      console.log("balance pull done: " + all.length + " rows (date item " + item + ").");
    })();
  })({"from":"","to":"","fileName":""});
