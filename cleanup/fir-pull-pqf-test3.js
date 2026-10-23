/* Tour schedule: fir-db1 PQF details pull (check: Lester, Goforth, Boldt). Paste in the console on a signed-in fir-db1 tab. */
(function pqfMain(PLAN) {
    const m = /[?&]p=(\d+):\d+:(\d+)/.exec(location.href);
    if (!m) return alert("Open a fir-db1 page first (signed in), then run this again.");
    const base = location.origin + location.pathname + "?p=1021:19:" + m[2] + ":::19:P19_EMPLID:";
    const FIELDS = [["apptType", /^appt\.? type$/i], ["officialRank", /^official rank$/i], ["apptDate", /^appointment date$/i],
      ["jobCode", /^job code$/i], ["jobEntryDate", /^job entry date$/i], ["hireDate", /^sffd hire date$/i], ["seniority", /^seniority$/i]];
    const COLS = ["key", "emplId", "name"].concat(FIELDS.map((f) => f[0])).concat(["flag"]);
    const clean = (x) => String(x == null ? "" : x).replace(/\s+/g, " ").trim();
    const read = (html, id) => {
      const doc = new DOMParser().parseFromString(html, "text/html");
      const hid = doc.getElementById("P19_EMPLID"), disp = doc.getElementById("P19_EMPLID_DISPLAY");
      const shown = clean((disp && disp.textContent) || (hid && (hid.getAttribute("value") || hid.textContent)) || "").toUpperCase();
      if (shown && shown !== id) return { flag: "mismatch", vals: {} };
      const vals = {};
      // A label (with or without its colon) followed by its value: the next non-empty element, or the parent's next.
      doc.querySelectorAll("td, th, dt, label, span, div, b, strong").forEach((e) => {
        if (e.children.length > 1) return;
        const lab = clean(e.textContent).replace(/:$/, "");
        const f = FIELDS.find((x) => x[1].test(lab));
        if (!f || vals[f[0]] != null) return;
        let v = e.nextElementSibling;
        while (v && !clean(v.textContent)) v = v.nextElementSibling;
        if (!v && e.parentElement && e.parentElement.children.length === 1) v = e.parentElement.nextElementSibling;
        if (!v && e.tagName === "LABEL" && e.getAttribute("for")) v = doc.getElementById(e.getAttribute("for") + "_DISPLAY") || doc.getElementById(e.getAttribute("for"));
        const t = v ? clean(v.tagName === "INPUT" ? v.getAttribute("value") : v.textContent) : "";
        if (t && t.length < 60 && !/\d{7,}/.test(t)) vals[f[0]] = t;
      });
      return { flag: Object.keys(vals).length ? (shown ? "" : "unchecked") : "none", vals };
    };
    const get = async (url) => {
      const ac = new AbortController(), t = setTimeout(() => ac.abort(), PLAN.timeoutMs || 30000);
      try {
        const h = await (await fetch(url, { credentials: "same-origin", signal: ac.signal })).text();
        if (/type="password"/i.test(h) && !/P19_/.test(h)) throw new Error("signed-out");
        return h;
      } catch (e) { throw e.name === "AbortError" ? new Error("timeout") : e; } finally { clearTimeout(t); }
    };
    const RK = PLAN.resumeKey ? "tour-schedule:" + PLAN.resumeKey : null;
    let saved = { done: [], rows: [] };
    try { if (RK) saved = JSON.parse(localStorage.getItem(RK) || "null") || saved; } catch (e) { }
    const done = new Set(saved.done), out = saved.rows.slice();
    const save = () => { if (!RK) return; try { localStorage.setItem(RK, JSON.stringify({ done: [...done], rows: out })); } catch (e) { } };
    if (done.size) console.log("PQF pull: resuming, " + done.size + " already done.");
    const queue = PLAN.people.filter((p) => !done.has(p.id)), total = PLAN.people.length, wait = () => new Promise((r) => setTimeout(r, 400));
    let n = done.size, stop = null, lastAt = Date.now();
    const box = document.createElement("div");
    box.style.cssText = "position:fixed;right:12px;bottom:12px;z-index:99999;padding:8px 12px;border-radius:6px;font:13px sans-serif;color:#fff;background:#2b6cb0;box-shadow:0 2px 8px rgba(0,0,0,.3)";
    document.body.appendChild(box);
    const show = (note) => {
      const idle = Date.now() - lastAt > 60000;
      box.style.background = note ? "#2f855a" : idle ? "#c53030" : "#2b6cb0";
      box.textContent = "PQF pull: " + n + "/" + total + " · " + (note || (idle ? "nothing new for " + Math.round((Date.now() - lastAt) / 1000) + " s" : "last update " + new Date(lastAt).toLocaleTimeString()));
    };
    const tick = setInterval(() => show(), 5000);
    show();
    const worker = async () => {
      while (queue.length && !stop) {
        const p = queue.shift();
        let r = null;
        for (let tries = 0; tries < 2 && !r; tries++) {
          try { r = read(await get(base + encodeURIComponent(p.id)), p.id); } catch (e) {
            if (e.message === "signed-out") { stop = e; break; }
            if (tries === 1) r = { flag: e.message === "timeout" ? "timeout" : "error", vals: {} };
          }
        }
        if (stop) { queue.unshift(p); break; }
        out.push([p.key, p.id, p.name].concat(FIELDS.map((f) => r.vals[f[0]] || "")).concat([r.flag]));
        done.add(p.id);
        lastAt = Date.now();
        if (++n % 10 === 0) save();
        console.log("PQF pull " + n + "/" + total + ": " + p.name + " " + p.id + (r.flag ? " (" + r.flag + ")" : ""));
        show();
        await wait();
      }
    };
    return Promise.all(Array.from({ length: Math.max(1, PLAN.concurrency || 1) }, worker)).then(() => {
      clearInterval(tick);
      if (stop) { save(); show("stopped: " + stop.message); return alert("fir-db1 signed you out after " + done.size + " of " + total + ". Sign in again, then paste and run this script again: it carries on where it stopped."); }
      if (RK) try { localStorage.removeItem(RK); } catch (e) { }
      const q = (v) => { v = v == null ? "" : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
      const csv = [COLS.join(",")].concat(out.map((r) => r.map(q).join(","))).join("\n");
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
      a.download = PLAN.fileName || "fir-pqf.csv";
      document.body.appendChild(a); a.click(); a.remove();
      const got = out.filter((r) => r[r.length - 1] === "" || r[r.length - 1] === "unchecked").length;
      console.log("PQF pull done: " + total + " people, " + got + " with details.");
      show("done: " + got + " with details, file downloaded");
    });
  })({"people":[{"id":"BO3091","name":"Boldt,A","key":"person:x-BO3091"},{"id":"GO3431","name":"Goforth,T","key":"21EOA15M"},{"id":"LE2603","name":"Lester,D","key":"10ENL31M"}],"concurrency":1,"resumeKey":"pqf-test3","fileName":"fir-pqf-test3.csv","timeoutMs":30000});
