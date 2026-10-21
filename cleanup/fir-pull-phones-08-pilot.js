/* Tour schedule: fir-db1 phone pull (Pilot: 2 people with no cell in the tool). Paste in the console on a signed-in fir-db1 tab. */
(function phoneMain(PLAN) {
    const m = /[?&]p=(\d+):\d+:(\d+)/.exec(location.href);
    if (!m) return alert("Open a fir-db1 page first (signed in), then run this again.");
    const base = location.origin + location.pathname + "?p=1021:2:" + m[2] + ":::RP,2:P2_EMPLID:";
    const COLS = ["key", "emplId", "name", "type", "number", "flag"];
    const PHONE = /\b([A-Z][A-Z]{2,11})\s*(\(?\d{3}\)?[\/\s.\-]*\d{3}[\s.\-]*\d{4})/g;
    const read = (html, id) => {
      const doc = new DOMParser().parseFromString(html, "text/html");
      const field = doc.getElementById("P2_EMPLID");
      const shown = field ? (field.getAttribute("value") || field.textContent || "").trim().toUpperCase() : "";
      if (shown && shown !== id) return { flag: "mismatch", phones: [] };
      const reg = doc.getElementById("PHONE_NUMBERS");
      if (!reg) return { flag: "no-region", phones: [] };
      // Form fields show their value; every element boundary becomes a space so "CELL" and the number stay apart.
      reg.querySelectorAll("input, select, textarea").forEach((f) => {
        const v = f.tagName === "SELECT" ? ((f.querySelector("option[selected]") || {}).textContent || "") : (f.type === "hidden" ? "" : f.getAttribute("value") || "");
        f.replaceWith(doc.createTextNode(" " + v + " "));
      });
      const parts = [], walk = doc.createTreeWalker(reg, NodeFilter.SHOW_TEXT);
      while (walk.nextNode()) parts.push(walk.currentNode.nodeValue);
      const text = parts.join(" ").replace(/\s+/g, " "), phones = [], seen = {};
      let x;
      PHONE.lastIndex = 0;
      while ((x = PHONE.exec(text))) { const k = x[1] + x[2]; if (!seen[k] && !/^PHONE|TYPE$/.test(x[1])) { seen[k] = 1; phones.push({ type: x[1], number: x[2] }); } }
      return { flag: phones.length ? (shown ? "" : "unchecked") : "none", phones };
    };
    const get = async (url) => { const h = await (await fetch(url, { credentials: "same-origin" })).text();
      if (/type="password"/i.test(h) && !/PHONE_NUMBERS/.test(h)) throw new Error("signed-out"); return h; };
    const RK = PLAN.resumeKey ? "tour-schedule:" + PLAN.resumeKey : null;
    let saved = { done: [], rows: [] };
    try { if (RK) saved = JSON.parse(localStorage.getItem(RK) || "null") || saved; } catch (e) { }
    const done = new Set(saved.done), out = saved.rows.slice();
    const save = () => { if (!RK) return; try { localStorage.setItem(RK, JSON.stringify({ done: [...done], rows: out })); } catch (e) { console.warn("Could not save progress: " + e.message); } };
    if (done.size) console.log("phone pull: resuming, " + done.size + " already done.");
    const queue = PLAN.people.filter((p) => !done.has(p.id)), total = PLAN.people.length, wait = () => new Promise((r) => setTimeout(r, 400));
    let n = done.size, stop = null;
    const worker = async () => {
      while (queue.length && !stop) {
        const p = queue.shift();
        try {
          const r = read(await get(base + encodeURIComponent(p.id)), p.id);
          if (!r.phones.length) out.push([p.key, p.id, p.name, "", "", r.flag]);
          r.phones.forEach((ph) => out.push([p.key, p.id, p.name, ph.type, ph.number, r.flag]));
          done.add(p.id);
        } catch (e) { stop = e; queue.unshift(p); break; }
        if (++n % 25 === 0) save();
        console.log("phone pull " + n + "/" + total + ": " + p.name + " " + p.id);
        await wait();
      }
    };
    return Promise.all(Array.from({ length: Math.max(1, PLAN.concurrency || 1) }, worker)).then(() => {
      if (stop) {
        save();
        return alert(stop.message === "signed-out" ? "fir-db1 signed you out after " + done.size + " of " + total + ". Sign in again, then paste and run this script again: it carries on where it stopped."
          : "The pull stopped (" + stop.message + ") after " + done.size + " of " + total + ". Paste and run it again to carry on.");
      }
      if (RK) try { localStorage.removeItem(RK); } catch (e) { }
      const q = (v) => { v = v == null ? "" : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
      const csv = [COLS.join(",")].concat(out.map((r) => r.map(q).join(","))).join("\n");
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
      a.download = PLAN.fileName || "fir-phones.csv";
      document.body.appendChild(a); a.click(); a.remove();
      console.log("phone pull done: " + total + " people, " + out.filter((r) => r[4]).length + " numbers.");
    });
  })({"people":[{"id":"AL1213","name":"Alexander,M","key":"person:x-AL1213"},{"id":"PE3397","name":"Peery,M","key":"person:x-PE3397"}],"concurrency":2,"resumeKey":"phones-pilot","fileName":"fir-phones-pilot.csv"});
