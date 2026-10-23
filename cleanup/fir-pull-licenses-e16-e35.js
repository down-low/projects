/* Tour schedule: fir-db1 licenses and certifications pull (E16 and E35: 32 people). Paste in the console on a signed-in fir-db1 tab. */
(function licenseMain(PLAN) {
    const m = /[?&]p=(\d+):\d+:(\d+)/.exec(location.href);
    if (!m) return alert("Open a fir-db1 page first (signed in), then run this again.");
    const base = location.origin + location.pathname + "?p=1021:2:" + m[2] + ":::RP,2:P2_EMPLID:";
    const COLS = ["key", "emplId", "name", "description", "expires", "flag"], DATE = /\b(\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}-\d{2}-\d{2}|\d{1,2}-[A-Z]{3}-\d{2,4})\b/i;
    const val = (c) => {
      const k = c.cloneNode(true);
      k.querySelectorAll("input, select, textarea").forEach((f) => {
        const v = f.tagName === "SELECT" ? ((f.querySelector("option[selected]") || {}).textContent || "") : (f.type === "hidden" ? "" : f.getAttribute("value") || "");
        f.replaceWith(c.ownerDocument.createTextNode(" " + v + " "));
      });
      return k.textContent.replace(/\s+/g, " ").trim();
    };
    const read = (html, id) => {
      const doc = new DOMParser().parseFromString(html, "text/html");
      const field = doc.getElementById("P2_EMPLID");
      const shown = field ? (field.getAttribute("value") || field.textContent || "").trim().toUpperCase() : "";
      if (shown && shown !== id) return { flag: "mismatch", items: [] };
      const reg = doc.getElementById("LICENSES_AND_CERTS");
      if (!reg) return { flag: "no-region", items: [] };
      // Rows of the innermost tables: description, license number (skipped), expiration (the cell that is a date).
      const items = [], seen = {};
      [...reg.querySelectorAll("tr")].filter((tr) => !tr.querySelector("table")).forEach((tr) => {
        const cells = [...tr.children].filter((c) => /^T[DH]$/.test(c.tagName)).map(val);
        if (!cells.length || /^Description$/i.test(cells[0]) || !cells[0]) return;
        const d = cells.slice(1).map((c) => DATE.exec(c)).filter(Boolean)[0];
        const k = cells[0] + "|" + (d ? d[1] : "");
        if (seen[k]) return;
        seen[k] = 1;
        items.push({ description: cells[0], expires: d ? d[1] : "" });
      });
      return { flag: items.length ? (shown ? "" : "unchecked") : "none", items };
    };
    // As the phone pull: 30 seconds a page, one retry, then flagged "timeout"; saves every 10; a status box on the page.
    const get = async (url) => {
      const ac = new AbortController(), t = setTimeout(() => ac.abort(), PLAN.timeoutMs || 30000);
      try {
        const h = await (await fetch(url, { credentials: "same-origin", signal: ac.signal })).text();
        if (/type="password"/i.test(h) && !/LICENSES_AND_CERTS/.test(h)) throw new Error("signed-out");
        return h;
      } catch (e) { throw e.name === "AbortError" ? new Error("timeout") : e; } finally { clearTimeout(t); }
    };
    const RK = PLAN.resumeKey ? "tour-schedule:" + PLAN.resumeKey : null;
    let saved = { done: [], rows: [] };
    try { if (RK) saved = JSON.parse(localStorage.getItem(RK) || "null") || saved; } catch (e) { }
    const done = new Set(saved.done), out = saved.rows.slice();
    const save = () => { if (!RK) return; try { localStorage.setItem(RK, JSON.stringify({ done: [...done], rows: out })); } catch (e) { } };
    if (done.size) console.log("license pull: resuming, " + done.size + " already done.");
    const queue = PLAN.people.filter((p) => !done.has(p.id)), total = PLAN.people.length, wait = () => new Promise((r) => setTimeout(r, 400));
    let n = done.size, stop = null, lastAt = Date.now();
    const box = document.createElement("div");
    box.style.cssText = "position:fixed;right:12px;bottom:12px;z-index:99999;padding:8px 12px;border-radius:6px;font:13px sans-serif;color:#fff;background:#2b6cb0;box-shadow:0 2px 8px rgba(0,0,0,.3)";
    document.body.appendChild(box);
    const show = (note) => {
      const idle = Date.now() - lastAt > 60000;
      box.style.background = note ? "#2f855a" : idle ? "#c53030" : "#2b6cb0";
      box.textContent = "License pull: " + n + "/" + total + " · " + (note || (idle ? "nothing new for " + Math.round((Date.now() - lastAt) / 1000) + " s" : "last update " + new Date(lastAt).toLocaleTimeString()));
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
            if (tries === 1) r = { flag: e.message === "timeout" ? "timeout" : "error", items: [] };
            else console.warn("license pull: " + p.name + " " + p.id + " " + e.message + ", trying again");
          }
        }
        if (stop) { queue.unshift(p); break; }
        if (!r.items.length) out.push([p.key, p.id, p.name, "", "", r.flag]);
        r.items.forEach((it) => out.push([p.key, p.id, p.name, it.description, it.expires, r.flag]));
        done.add(p.id);
        lastAt = Date.now();
        if (++n % 10 === 0) save();
        console.log("license pull " + n + "/" + total + ": " + p.name + " " + p.id + (r.flag === "timeout" || r.flag === "error" ? " (" + r.flag + ")" : ""));
        show();
        await wait();
      }
    };
    return Promise.all(Array.from({ length: Math.max(1, PLAN.concurrency || 1) }, worker)).then(() => {
      clearInterval(tick);
      if (stop) { save(); show("stopped: " + stop.message); return alert(stop.message === "signed-out" ? "fir-db1 signed you out after " + done.size + " of " + total + ". Sign in again, then paste and run this script again: it carries on where it stopped." : "The pull stopped (" + stop.message + ") after " + done.size + " of " + total + ". Paste and run it again to carry on."); }
      if (RK) try { localStorage.removeItem(RK); } catch (e) { }
      const q = (v) => { v = v == null ? "" : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
      const csv = [COLS.join(",")].concat(out.map((r) => r.map(q).join(","))).join("\n");
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
      a.download = PLAN.fileName || "fir-licenses.csv";
      document.body.appendChild(a); a.click(); a.remove();
      console.log("license pull done: " + total + " people, " + out.filter((r) => r[3]).length + " licenses.");
      show("done: " + out.filter((r) => r[3]).length + " licenses, file downloaded");
    });
  })({"people":[{"id":"AS9242","name":"Aspelin,L","key":"16EOC12M"},{"id":"BA2628","name":"Babcock,M","key":"16EOA10M"},{"id":"BE4760","name":"Bernstein,A","key":"16EOA08M"},{"id":"CA1585","name":"Cacciotti,M","key":"35EOD21M"},{"id":"CA1671","name":"Canning,L","key":"35EOA26M"},{"id":"CL1125","name":"Clarke,K","key":"35EOE23M"},{"id":"DR9511","name":"Draper,J","key":"35EOC18M"},{"id":"DU2761","name":"Dumaop,G","key":"35ETX26M"},{"id":"GI5934","name":"Giannini,M","key":"person:x-GI5934"},{"id":"GR6230","name":"Grimesey,P","key":"person:x-GR6230"},{"id":"HA6250","name":"Hanley,J","key":"person:x-HA6250"},{"id":"KN1816","name":"Knott,M","key":"35EOA27M"},{"id":"KR2333","name":"Kristoff,R","key":"16EOL11M"},{"id":"LA2128","name":"Lane,H","key":"16EOE19M"},{"id":"MA2063","name":"Mar,S","key":"16ETX20M"},{"id":"MA5161","name":"Markham,N","key":"35EOE24M"},{"id":"ME1851","name":"Meikle,J","key":"16EOL13M"},{"id":"MO3816","name":"Moore,C","key":"16EOD16M"},{"id":"MU1586","name":"Murphy,M","key":"16EOE18M"},{"id":"SI9525","name":"Silva,J","key":"16EOD14M"},{"id":"SK3690","name":"Skifter,P","key":"35EOD20M"},{"id":"SO2686","name":"Solberg,H","key":"16EOD15M"},{"id":"TR3971","name":"Trim,B","key":"16EOA09M"},{"id":"WE4467","name":"Weber,J","key":"35EOA28M"},{"id":"ZA3012","name":"Zammarchi,C","key":"16EOE17M"},{"id":"TH4011","name":"Thornton,T","key":"03TOL25M"},{"id":"BU5293","name":"Burgess,B","key":"person:4yhtwa6hy49z87mrn0j9"},{"id":"KO2554","name":"Konefal,K","key":"person:293lqc1tllf8r6vjn5c0"},{"id":"MA4705","name":"Marshall,K","key":"person:ic6ne9i60x20ew2j0li1"},{"id":"DA3856","name":"Dalton,S","key":"person:x2027-DA3856"},{"id":"EA2607","name":"Eaton,W","key":"person:x2027-EA2607"},{"id":"SA1636","name":"Sanchez,M","key":"person:x2027-SA1636"}],"concurrency":2,"resumeKey":"licenses-e16-e35","fileName":"fir-licenses-e16-e35.csv","timeoutMs":30000});
