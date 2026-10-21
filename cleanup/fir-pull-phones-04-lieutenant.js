/* Tour schedule: fir-db1 phone pull (Lieutenant: 29 people with no cell in the tool). Paste in the console on a signed-in fir-db1 tab. */
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
  })({"people":[{"id":"AT3449","name":"Atkinson,K","key":"person:x-AT3449"},{"id":"BO3091","name":"Boldt,A","key":"person:x-BO3091"},{"id":"CA5068","name":"Capurro,V","key":"05ETL01M"},{"id":"CH2321","name":"Christiansen,L","key":"23EOD02M"},{"id":"CL1037","name":"Clark,A","key":"person:2bexo8dm9kuvwqepi5u5"},{"id":"DR9468","name":"Drake III,C","key":"person:831uquu79ow648cwfyyx"},{"id":"EG8779","name":"Egan,J","key":"person:x-EG8779"},{"id":"GR1466","name":"Grant,K","key":"36EOL27M"},{"id":"HA5274","name":"Halpin,N","key":"person:vjxmgdwnmeeffzktdge1"},{"id":"JE3282","name":"Jebe,D","key":"person:gkmt05fykq4que72zx10"},{"id":"KI2294","name":"Kim,Z","key":"person:jwjzvv3h831w3zmiwu36"},{"id":"KL1384","name":"Klofstad,J","key":"04EOL03M"},{"id":"KO2554","name":"Konefal,K","key":"person:293lqc1tllf8r6vjn5c0"},{"id":"KR2333","name":"Kristoff,R","key":"16EOL11M"},{"id":"LA2474","name":"Lamond,A","key":"person:lezodosudwob8dry4kbi"},{"id":"MA4705","name":"Marshall,K","key":"person:ic6ne9i60x20ew2j0li1"},{"id":"MA3507","name":"Maxwell,L","key":"person:t5aslwfz05hjfji8xyi5"},{"id":"ME7678","name":"Melton Jr.,D","key":"person:az135qyke6ou0qcgq9dw"},{"id":"MI1261","name":"Miller,D","key":"person:rihoryo3lkn43cmqm9tf"},{"id":"MO3110","name":"Montero,J","key":"person:fweq3l2nv2ntmvo5iund"},{"id":"MO2810","name":"Moreno,Z","key":"person:4ojcixgwvq26yy4kg6vb"},{"id":"NI5395","name":"Nielsen,K","key":"person:jx11hhgc6jilffh4z6pm"},{"id":"OT4273","name":"O'Toole,R","key":"person:x-OT4273"},{"id":"PA4020","name":"Palu,J","key":"person:22m9cg2hm0otawfr0g4f"},{"id":"RI1550","name":"Richardson,K","key":"person:set4l3m88mb0o2onqupw"},{"id":"SH1473","name":"Shea,K","key":"person:1q5g0clgjz42aljlhr8j"},{"id":"TH1082","name":"Thurman,M","key":"18TOL25M"},{"id":"TR0477","name":"Truong,D","key":"22EOL22M"},{"id":"WU1175","name":"Wu,A","key":"12TOL29M"}],"concurrency":2,"resumeKey":"phones-lieutenant","fileName":"fir-phones-lieutenant.csv"});
