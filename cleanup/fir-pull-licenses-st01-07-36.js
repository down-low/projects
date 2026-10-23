/* Tour schedule: fir-db1 licenses and certifications pull (Stations 1, 7, 36: 126 people). Paste in the console on a signed-in fir-db1 tab. */
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
    const get = async (url) => { const h = await (await fetch(url, { credentials: "same-origin" })).text();
      if (/type="password"/i.test(h) && !/LICENSES_AND_CERTS/.test(h)) throw new Error("signed-out"); return h; };
    const RK = PLAN.resumeKey ? "tour-schedule:" + PLAN.resumeKey : null;
    let saved = { done: [], rows: [] };
    try { if (RK) saved = JSON.parse(localStorage.getItem(RK) || "null") || saved; } catch (e) { }
    const done = new Set(saved.done), out = saved.rows.slice();
    const save = () => { if (!RK) return; try { localStorage.setItem(RK, JSON.stringify({ done: [...done], rows: out })); } catch (e) { } };
    const queue = PLAN.people.filter((p) => !done.has(p.id)), total = PLAN.people.length, wait = () => new Promise((r) => setTimeout(r, 400));
    let n = done.size, stop = null;
    const worker = async () => {
      while (queue.length && !stop) {
        const p = queue.shift();
        try {
          const r = read(await get(base + encodeURIComponent(p.id)), p.id);
          if (!r.items.length) out.push([p.key, p.id, p.name, "", "", r.flag]);
          r.items.forEach((it) => out.push([p.key, p.id, p.name, it.description, it.expires, r.flag]));
          done.add(p.id);
        } catch (e) { stop = e; queue.unshift(p); break; }
        if (++n % 25 === 0) save();
        console.log("license pull " + n + "/" + total + ": " + p.name + " " + p.id);
        await wait();
      }
    };
    return Promise.all(Array.from({ length: Math.max(1, PLAN.concurrency || 1) }, worker)).then(() => {
      if (stop) { save(); return alert(stop.message === "signed-out" ? "fir-db1 signed you out after " + done.size + " of " + total + ". Sign in again, then paste and run this script again: it carries on where it stopped." : "The pull stopped (" + stop.message + ") after " + done.size + " of " + total + ". Paste and run it again to carry on."); }
      if (RK) try { localStorage.removeItem(RK); } catch (e) { }
      const q = (v) => { v = v == null ? "" : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
      const csv = [COLS.join(",")].concat(out.map((r) => r.map(q).join(","))).join("\n");
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
      a.download = PLAN.fileName || "fir-licenses.csv";
      document.body.appendChild(a); a.click(); a.remove();
      console.log("license pull done: " + total + " people, " + out.filter((r) => r[3]).length + " licenses.");
    });
  })({"people":[{"id":"AC9556","name":"Acosta,D","key":"36EOD01M"},{"id":"AD2217","name":"Adams,R","key":"07EOE29M"},{"id":"AI5684","name":"Aikhionbare,O","key":"07EOE28M"},{"id":"BA2018","name":"Balla,M","key":"36ETX29M"},{"id":"BE4474","name":"Beede,J","key":"07TOE16M"},{"id":"BE3903","name":"Bendik,A","key":"07TOC27M"},{"id":"BE9782","name":"Bendo,D","key":"01EOL03M"},{"id":"BI1404","name":"Bickham,C","key":"07EOD27M"},{"id":"BO2021","name":"Bowers,B","key":"02SOD22M"},{"id":"BO1463","name":"Boyd,L","key":"07TOF27M"},{"id":"BR9023","name":"Browne,G","key":"01TOL04M"},{"id":"CA1263","name":"Cacharelis,N","key":"01SOF11M"},{"id":"CA1510","name":"Calonico III,F","key":"01EOL02M"},{"id":"CA1626","name":"Calvillo,A","key":"02SOE18M"},{"id":"CA7490","name":"Carrillo,M","key":"01TTX25M"},{"id":"CA9622","name":"Caungula,Y","key":"02SOD21M"},{"id":"CH2779","name":"Chronister,M","key":"01TOF10M"},{"id":"CO1346","name":"Cody,W","key":"36EOE04M"},{"id":"CO1959","name":"Coppin,R","key":"01SOD20M"},{"id":"CR0996","name":"Creighton,T","key":"01TOD03M"},{"id":"CR8813","name":"Cruz,S","key":"01SOL23M"},{"id":"DE2302","name":"DeGraffenreid,M","key":"07EOA10M"},{"id":"DE6122","name":"Deguzman,J","key":"01TOE28M"},{"id":"DE2867","name":"Del Rosario,I","key":"person:x-DE2867"},{"id":"DI2984","name":"Diaz Magana,L","key":"01EOE09M"},{"id":"DI6042","name":"Dietzen,T","key":"01SOF24M"},{"id":"DO1545","name":"Domeier,J","key":"02SOF16M"},{"id":"DU5689","name":"Dugan,C","key":"36EOL29M"},{"id":"DU4274","name":"Duggan,R","key":"02SOE20M"},{"id":"DU3091","name":"Dunne,K","key":"01TOT30M"},{"id":"ED1048","name":"Edais,A","key":"36EOE03M"},{"id":"ES4341","name":"Estupinian,G","key":"01SOE15M"},{"id":"EV3145","name":"Evanoff,A","key":"01EOD05M"},{"id":"FI1585","name":"Findley,I","key":"01EOE07M"},{"id":"GA1461","name":"Gama,D","key":"07EOA12M"},{"id":"GE5487","name":"Gerber,W","key":"36EOF09M"},{"id":"GI1082","name":"Gin,W","key":"02BO005M"},{"id":"GI1079","name":"Ginotti,G","key":"01STL30M"},{"id":"GO0799","name":"Gomez,I","key":"01TOD02M"},{"id":"GR1466","name":"Grant,K","key":"36EOL27M"},{"id":"GR1425","name":"Greco,E","key":"01EOE08M"},{"id":"GR8373","name":"Groshong,J","key":"36EOA17M"},{"id":"GU3107","name":"Guillen,C","key":"07TOD24M"},{"id":"HA4076","name":"Hall,D","key":"02SOD23M"},{"id":"HA4631","name":"Harrington,J","key":"01TOL06M"},{"id":"HE1868","name":"Herron,C","key":"36EOA16M"},{"id":"HE2150","name":"Hewling,D","key":"07EOL23M"},{"id":"HI8693","name":"Hickey,J","key":"02BO206M"},{"id":"HI3955","name":"Hill,S","key":"person:x-HI3955"},{"id":"HO4855","name":"Horn,S","key":"03DO028M"},{"id":"HU6141","name":"Hutchinson,M","key":"02SOC26M"},{"id":"HU3769","name":"Hutslar,C","key":"02SOF15M"},{"id":"JA3163","name":"Jackson,S","key":"person:x-JA3163"},{"id":"JO5027","name":"Jolley,H","key":"36EOF08M"},{"id":"KA0321","name":"Kauf,A","key":"01SOF25M"},{"id":"KE1403","name":"Keane,K","key":"person:x-KE1403"},{"id":"KE0810","name":"Kelly,T","key":"01EOA07M"},{"id":"KI8274","name":"Kimmel,D","key":"01ETL10M"},{"id":"LE3287","name":"Leung,A","key":"36EOF10M"},{"id":"LO4180","name":"Locks,H","key":"01EOA06M"},{"id":"LO5347","name":"Londono,A","key":"07TOT20M"},{"id":"LO5036","name":"Lopez,P","key":"01TOF11M"},{"id":"LO2129","name":"Lorincz,R","key":"person:x-LO2129"},{"id":"MA8269","name":"Marcaletti,J","key":"07ETL28M"},{"id":"MA1061","name":"Mason,S","key":"01SOF12M"},{"id":"MC2192","name":"McCarthy,S","key":"02SOL24M"},{"id":"MC4392","name":"McCloskey,D","key":"01ENL31M"},{"id":"MC8444","name":"McCoo,R","key":"07EOA11M"},{"id":"MC3620","name":"McCoy,C","key":"36EOC28M"},{"id":"ME6940","name":"Megia,R","key":"02SOF11M"},{"id":"MI4671","name":"Miller,A","key":"07ETX31M"},{"id":"MO3260","name":"Moncada,D","key":"07EOD26M"},{"id":"MO3051","name":"Moreau,S","key":"01EOA08M"},{"id":"MO1315","name":"Morshead,D","key":"person:x-MO1315"},{"id":"MU2368","name":"Mullane,S","key":"01SOC22M"},{"id":"MU1883","name":"Murphy,L","key":"02SOF12M"},{"id":"MU1237","name":"Murtagh,A","key":"02SOL25M"},{"id":"NA1978","name":"Nackord,D","key":"01SOL21M"},{"id":"NA2384","name":"Nave,L","key":"07TTX15M"},{"id":"NU5962","name":"Nunnery,D","key":"36EOA15M"},{"id":"OD3525","name":"O'Donnell,D","key":"02SOF13M"},{"id":"ON1965","name":"O'Neil,C","key":"36EOD31M"},{"id":"OT4225","name":"Otey-Baeza,D","key":"36EOD30M"},{"id":"PA2797","name":"Pacheco Magana,J","key":"01TOT29M"},{"id":"PA2131","name":"Pardini,K","key":"01TOC05M"},{"id":"PA3312","name":"Paredes,D","key":"07EOE30M"},{"id":"PE8323","name":"Pereira,J","key":"02BO207M"},{"id":"PE4646","name":"Perez,P","key":"01TOE27M"},{"id":"PO9799","name":"Potter,R","key":"02SOE19M"},{"id":"QU0607","name":"Quesada,G","key":"01SOD18M"},{"id":"QW7146","name":"Qwist,E","key":"02STX14M"},{"id":"RA3098","name":"Rademacher,J","key":"07TOL26M"},{"id":"RA1224","name":"Ramsey,B","key":"01STX14M"},{"id":"RA1138","name":"Rashdan,A","key":"07TOE18M"},{"id":"RE2735","name":"Reyes,P","key":"person:x-RE2735"},{"id":"RI1547","name":"Rivas,M","key":"01EOD04M"},{"id":"RO6001","name":"Roddy,S","key":"01ETX10M"},{"id":"RO2042","name":"Rodriguez,S","key":"01SOE17M"},{"id":"RO3411","name":"Romero,G","key":"person:x-RO3411"},{"id":"RU1377","name":"Ruiz,R","key":"07EOD25M"},{"id":"RY3111","name":"Ryan,P","key":"01SOF13M"},{"id":"SA3142","name":"Sansoni,V","key":"07EOL24M"},{"id":"SC1354","name":"Schnelker,R","key":"01EOC01M"},{"id":"SC9401","name":"Schwartz,M","key":"02BO205M"},{"id":"SM4729","name":"Small,J","key":"01TOE26M"},{"id":"SM2694","name":"Smith Jr,J","key":"07EOC22M"},{"id":"SU1574","name":"Sudano,J","key":"01TOF12M"},{"id":"SZ1174","name":"Szutu,N","key":"02BO007M"},{"id":"TA1483","name":"Tassone,J","key":"07TOL25M"},{"id":"TA6670","name":"Taylor,G","key":"07TOT19M"},{"id":"TH5652","name":"Thomas,T","key":"person:x-TH5652"},{"id":"TH2536","name":"Thurman,Ma","key":"person:x-TH2536"},{"id":"TI1295","name":"Tizio,J","key":"01TOD01M"},{"id":"TO8687","name":"Towner,R","key":"02SOF17M"},{"id":"VA1765","name":"Vail,M","key":"07TOT21M"},{"id":"VA1176","name":"Vanderklugt,N","key":"01TOT31M"},{"id":"VA3787","name":"Vashakidze,I","key":"07TOF26M"},{"id":"VE9839","name":"Veach,J","key":"01SOF26M"},{"id":"VI3883","name":"Vickery,C","key":"01SOF10M"},{"id":"VI6015","name":"Viglizzo,J","key":"02BO006M"},{"id":"VI2594","name":"Villavicencio,J","key":"01EOD06M"},{"id":"WA0765","name":"Waterman,K","key":"01SOE16M"},{"id":"WE1151","name":"Weaver,V","key":"07TOE17M"},{"id":"WI3041","name":"Williams,D","key":"07TOF25M"},{"id":"WU2056","name":"Wu,J","key":"person:x-WU2056"},{"id":"ZI6472","name":"Zimmerman,S","key":"01SOD19M"}],"concurrency":2,"resumeKey":"lic-st01-07-36","fileName":"fir-licenses-st01-07-36.csv"});
