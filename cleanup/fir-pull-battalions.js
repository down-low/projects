/* Tour schedule: fir-db1 battalion roster pull (all 10 battalions, dates asked when it runs). Paste in the console on a signed-in fir-db1 tab. */
(function battalionMain(PLAN) {
    const m = /[?&]p=(\d+):\d+:(\d+)/.exec(location.href);
    if (!m) return alert("Open a fir-db1 page first (signed in), then run this again.");
    const base = location.origin + location.pathname + "?p=1021:11:" + m[2] + "::NO::P11_FROMDT,P11_BATTALION:";
    const ask = (q, d) => (prompt(q, d) || "").trim();
    const t = new Date(), md = (d) => (d.getMonth() + 1) + "/" + d.getDate() + "/" + d.getFullYear();
    const from = PLAN.from || ask("First date (MM/DD/YYYY)", md(t)), to = PLAN.to || ask("Last date (MM/DD/YYYY)", from);
    const dt = (x) => { const a = x.split("/"); return new Date(+a[2], a[0] - 1, +a[1]); };
    if (!/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(from) || !/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(to)) return alert("Use dates like 10/22/2026.");
    const dates = [];
    for (let d = dt(from); d <= dt(to); d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) dates.push(md(d));
    const COLS = ["mode", "pulledFor", "date", "query", "emplId", "name", "co", "trc", "position", "role", "hours", "status", "flag", "station", "battalion", "with", "mark"];
    const ID = /^[A-Z]{2}\d{4}$/, ROLE = /^[A-Z][A-Z\/]{1,5}$/;
    const UNIT = { Engine: "E", Truck: "T", Battalion: "B", "Rescue Squad": "RS", "Rescue Captain": "RC", Fireboat: "FB", "Fire Boat": "FB", Medic: "M", "Hose Tender": "HT", "Mobile Air": "MA" };
    const ROMAN = { I: 1, II: 2, III: 3, IV: 4 };
    const coCode = (label) => {
      if (/^Bureau of Equipment/.test(label)) return "BE";
      const u = /^(Engine|Truck|Battalion|Rescue Squad|Rescue Captain|Fireboat|Fire Boat|Medic|Hose Tender|Mobile Air)\s+(\d+)/.exec(label);
      if (u) return UNIT[u[1]] + (/^(E|T|B)$/.test(UNIT[u[1]]) ? ("0" + u[2]).slice(-2) : u[2]);
      const dv = /^Division\s+([IV]+)/.exec(label);
      return dv ? "D" + ROMAN[dv[1]] : label.replace(/\s+-\s+\d+\/\d+.*$/, "");
    };
    const cellText = (c) => { const k = c.cloneNode(true); k.querySelectorAll("script, noscript").forEach((x) => x.remove()); return k.textContent.replace(/\s+/g, " ").trim(); };
    const read = (html, date, bt) => {
      const doc = new DOMParser().parseFromString(html, "text/html"), rows = [], done = new Set();
      let station = "", co = "";
      const walk = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
      while (walk.nextNode()) {
        const node = walk.currentNode, txt = node.nodeValue.replace(/\s+/g, " ").trim();
        if (!txt) continue;
        const tr = node.parentElement && node.parentElement.closest("tr");
        const st = /^Fire Station\s+(\w+)/.exec(txt), unit = /^(.+?)\s+-\s+\d+\/\d+\b/.exec(txt);
        if (st && !(tr && done.has(tr))) { station = st[1]; continue; }
        if (unit && !(tr && done.has(tr))) { co = coCode(unit[1]); continue; }
        if (!tr || done.has(tr)) continue;
        const cells = [...tr.children].filter((c) => /^T[DH]$/.test(c.tagName)).map(cellText);
        let i = cells.findIndex((c) => ID.test(c) || /\s[A-Z]{2}\d{4}$/.test(c));
        if (i < 0) continue;
        done.add(tr);
        let name = "", id = cells[i];
        const glued = /^(.*\S)\s+([A-Z]{2}\d{4})$/.exec(id);
        if (glued) { name = glued[1]; id = glued[2]; } else name = cells[i - 1] || "";
        const before = cells.slice(0, glued ? i : i - 1).filter(Boolean);
        const role = before.length && ROLE.test(before[before.length - 1]) ? before.pop() : "";
        const after = cells.slice(i + 1).filter(Boolean), trc = after.length && /^[A-Z]{1,4}$/.test(after[0]) ? after[0] : "";
        const tw = after.map((c) => /\b(TR[OW])\s*([A-Z]{2}\d{4})\b/.exec(c)).filter(Boolean)[0];
        rows.push({ mode: "co", pulledFor: date, date, query: co, emplId: id, name: name.replace(/\s*-ND$/, ""), co, trc, position: "", role,
          hours: "", status: "", flag: "", station, battalion: bt, with: tw ? tw[1] + " " + tw[2] : "", mark: before.join(" ") });
      }
      if (!rows.length) {
        const shape = [...doc.querySelectorAll("table")].slice(0, 5).map((tb) => tb.querySelectorAll("tr").length + " rows: " + cellText(tb).slice(0, 120)).join(" | ");
        rows.push({ mode: "co", pulledFor: date, date, query: bt, flag: /type="password"/i.test(html) ? "signed-out" : "no-rows", name: shape.slice(0, 600), battalion: bt });
      }
      return rows;
    };
    const jobs = [];
    dates.forEach((d) => PLAN.battalions.forEach((b) => jobs.push([d, b])));
    const wait = () => new Promise((r) => setTimeout(r, 400));
    // As the phone and license pulls: 30 seconds a page and one retry (then flagged "timeout"), progress saved every
    // 10 pages so a sign-out or closed tab resumes where it stopped, and a status box on the page.
    const get = async (url) => {
      const ac = new AbortController(), t = setTimeout(() => ac.abort(), PLAN.timeoutMs || 30000);
      try { return await (await fetch(url, { credentials: "same-origin", signal: ac.signal })).text(); }
      catch (e) { throw e.name === "AbortError" ? new Error("timeout") : e; } finally { clearTimeout(t); }
    };
    const RK = "tour-schedule:battalions-" + from + "-" + to + "-" + PLAN.battalions.join("");
    let saved = { k: 0, rows: [] };
    try { saved = JSON.parse(localStorage.getItem(RK) || "null") || saved; } catch (e) { }
    const out = saved.rows.slice();
    let k = saved.k, lastAt = Date.now(), note = "";
    const save = () => { try { localStorage.setItem(RK, JSON.stringify({ k, rows: out })); } catch (e) { console.warn("Could not save progress: " + e.message); } };
    if (k) console.log("battalion pull: resuming, " + k + " of " + jobs.length + " pages already done.");
    const box = document.createElement("div");
    box.style.cssText = "position:fixed;right:12px;bottom:12px;z-index:99999;padding:8px 12px;border-radius:6px;font:13px sans-serif;color:#fff;background:#2b6cb0;box-shadow:0 2px 8px rgba(0,0,0,.3)";
    document.body.appendChild(box);
    const show = (end) => {
      const idle = Date.now() - lastAt > 60000;
      box.style.background = end ? "#2f855a" : idle ? "#c53030" : "#2b6cb0";
      box.textContent = "Battalion pull: " + k + "/" + jobs.length + " · " + (end || ((note ? note + " · " : "") + (idle ? "nothing new for " + Math.round((Date.now() - lastAt) / 1000) + " s" : "last update " + new Date(lastAt).toLocaleTimeString())));
    };
    const tick = setInterval(() => show(), 5000);
    show();
    return (async () => {
      for (; k < jobs.length; ) {
        const [d, b] = jobs[k];
        let rows = null;
        for (let tries = 0; tries < 2 && !rows; tries++) {
          try { rows = read(await get(base + encodeURIComponent(d) + "," + b), d, b); } catch (e) {
            if (tries === 1) rows = [{ mode: "co", pulledFor: d, date: d, query: b, flag: e.message === "timeout" ? "timeout" : "error", battalion: b }];
            else console.warn("battalion pull: " + d + " " + b + " " + e.message + ", trying again");
          }
        }
        if (rows[0].flag === "signed-out") {
          save(); clearInterval(tick); show("stopped: signed out");
          return alert("fir-db1 signed you out after " + k + " of " + jobs.length + " pages. Sign in again, then paste and run this script again: it carries on where it stopped.");
        }
        rows.forEach((r) => out.push(r));
        k++; lastAt = Date.now(); note = d + " " + b;
        if (k % 10 === 0) save();
        console.log("battalion pull " + k + "/" + jobs.length + ": " + d + " " + b + " (" + rows.filter((r) => !r.flag).length + " people" + (rows[0].flag === "timeout" || rows[0].flag === "error" ? ", " + rows[0].flag : "") + ")");
        show();
        await wait();
      }
      clearInterval(tick);
      try { localStorage.removeItem(RK); } catch (e) { }
      const q = (v) => { v = v == null ? "" : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
      const csv = [COLS.join(",")].concat(out.map((r) => COLS.map((c) => q(r[c])).join(","))).join("\n");
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
      a.download = PLAN.fileName || ("fir-battalions-" + from.replace(/\//g, "-") + (to !== from ? "_to_" + to.replace(/\//g, "-") : "") + ".csv");
      document.body.appendChild(a); a.click(); a.remove();
      console.log("battalion pull done: " + out.filter((r) => !r.flag).length + " rows.");
      show("done: " + out.filter((r) => !r.flag).length + " rows, file downloaded");
    })();
  })({"from":"","to":"","fileName":"","timeoutMs":30000,"battalions":["BT01","BT02","BT03","BT04","BT05","BT06","BT07","BT08","BT09","BT10"]});
