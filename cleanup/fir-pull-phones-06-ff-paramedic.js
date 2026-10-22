/* Tour schedule: fir-db1 phone pull (FF/Paramedic: 36 people with no cell in the tool). Paste in the console on a signed-in fir-db1 tab. */
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
  })({"people":[{"id":"BA4275","name":"Backman,B","key":"person:8hn3rjvw5oenvqd9apa9"},{"id":"BR1017","name":"Bradford,S","key":"person:x-BR1017"},{"id":"BU5293","name":"Burgess,B","key":"person:4yhtwa6hy49z87mrn0j9"},{"id":"CA2484","name":"Cairo,B","key":"person:x2027-CA2484"},{"id":"CH2603","name":"Cheung,H","key":"person:x2027-CH2603"},{"id":"DE1227","name":"Deaner,J","key":"person:ingp7rj0131geqm2di12"},{"id":"ER2108","name":"Erese,S","key":"person:x-ER2108"},{"id":"FA6340","name":"Fartash,D","key":"person:349ss7g1jztbss6oslmo"},{"id":"GA1940","name":"Garavaglia,C","key":"person:0909lftbj2vlymo74duh"},{"id":"GI1502","name":"Gilio,J","key":"person:x-GI1502"},{"id":"GO2086","name":"Gordon,M","key":"person:x-GO2086"},{"id":"HA6250","name":"Hanley,J","key":"person:x-HA6250"},{"id":"HA2634","name":"Hausel,N","key":"person:8lq11kyc3bhuriedelm6"},{"id":"HU1157","name":"Huynh,M","key":"person:vd88crgkn4ptmf916yjx"},{"id":"JE4734","name":"Jekayinfa,O","key":"person:x-JE4734"},{"id":"LA1666","name":"LaBauve,E","key":"person:g7wk3zlm8wowmaje1a6e"},{"id":"LE5590","name":"Levesque,E","key":"person:x-LE5590"},{"id":"LI4085","name":"Link,S","key":"person:wmbepoglzxczopb0i2yz"},{"id":"LO4278","name":"Lopez,E","key":"person:2kx6nhwf9sjrpwxuzgg0"},{"id":"LO0245","name":"Lopez,G","key":"11EOA14M"},{"id":"MA3964","name":"Mah,M","key":"person:gy0kno9s59eune1qspma"},{"id":"MA1320","name":"Mahaffey,S","key":"person:m134tat6hzyzj07g4l3q"},{"id":"MA3301","name":"Marino,M","key":"person:x-MA3301"},{"id":"MO4496","name":"Moore,K","key":"person:1h2huo9eu5r8zgtlu3l0"},{"id":"OD3139","name":"O'Driscoll,B","key":"person:x2027-OD3139"},{"id":"OR3604","name":"O'Rourke,O","key":"person:x-OR3604"},{"id":"OL2779","name":"Olguin,A","key":"person:x2027-OL2779"},{"id":"RA1669","name":"Rangel,E","key":"person:x-RA1669"},{"id":"RI1181","name":"Rios,A","key":"person:hzbcf78pq01c22k7wa41"},{"id":"SC3203","name":"Schraner,D","key":"person:x2027-SC3203"},{"id":"SH3135","name":"Shepard,K","key":"person:x-SH3135"},{"id":"SP3448","name":"Spognardi,E","key":"51EOA02M"},{"id":"ST4461","name":"Steward,M","key":"person:8d1hpcf9e3sly3cxau49"},{"id":"SU3362","name":"Summers,S","key":"25EOA03M"},{"id":"WI1740","name":"Wiltshire,D","key":"person:qx9h0a5xiloh1iqjzlie"},{"id":"WU2056","name":"Wu,J","key":"person:x-WU2056"}],"concurrency":2,"resumeKey":"phones-ff-paramedic","fileName":"fir-phones-ff-paramedic.csv"});
