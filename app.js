(function () {
  "use strict";
  var M = window.TourMath;
  var RANK_ORDER = ["Battalion Chief", "Rescue Captain", "Captain", "Lieutenant", "ISS", "FF/Paramedic", "Firefighter", "Pilot", "Marine Engineer"];
  var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  var DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  var $ = function (id) { return document.getElementById(id); };
  var data = [];
  var people = []; // filled positions, sorted by name
  var state = { view: "date", date: today(), personPos: null, personMonth: null, rankMonth: null };

  function today() { var d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  function addDays(d, n) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); }
  function sameDay(a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
  function iso(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function fromIso(s) { var p = s.split("-"); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function longDate(d) { return DOW[d.getDay()] + ", " + MONTHS[d.getMonth()] + " " + d.getDate() + ", " + d.getFullYear(); }
  function shortDate(d) { return DOW[d.getDay()] + " " + MONTHS[d.getMonth()].slice(0, 3) + " " + d.getDate(); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function coKey(co) {
    var m = /^([A-Z]+)(\d+)$/.exec(co || "");
    return m ? m[1] + ("000" + m[2]).slice(-3) : "ZZZ" + (co || "");
  }
  function byCompany(a, b) {
    return coKey(a.co || a.company).localeCompare(coKey(b.co || b.company)) || a.tour - b.tour;
  }
  function home(p) { return p.company || p.title; }
  function store(k, v) { try { localStorage.setItem("tour-schedule:" + k, v); } catch (e) { /* storage unavailable */ } }
  function recall(k) { try { return localStorage.getItem("tour-schedule:" + k); } catch (e) { return null; } }

  /* ---------- Tabs ---------- */
  function setView(v) {
    state.view = v;
    ["date", "person", "rank"].forEach(function (k) {
      $("view-" + k).hidden = k !== v;
      $("tab-" + k).setAttribute("aria-selected", k === v ? "true" : "false");
    });
    store("view", v);
    render();
  }

  function render() {
    if (state.view === "date") renderDate();
    else if (state.view === "person") renderPerson();
    else renderRank();
  }

  function rankOptions(sel, withAll) {
    sel.innerHTML = (withAll ? '<option value="">All ranks</option>' : "") +
      RANK_ORDER.map(function (r) { return '<option value="' + esc(r) + '">' + esc(r) + "</option>"; }).join("");
  }

  /* ---------- Who's working (by date) ---------- */
  function renderDate() {
    var d = state.date;
    var w = M.watchFor(d);
    $("date-input").value = iso(d);
    var rank = $("date-rank").value;
    var q = $("date-filter").value.trim().toLowerCase();
    var showVacant = $("date-vacant").checked;

    var rows = [];
    data.forEach(function (p) {
      if (!p.name && !showVacant) return;
      if (rank && p.rank !== rank) return;
      var s = M.shiftFor(p, d);
      if (!s) return;
      var r = { p: p, co: s.co || home(p), role: s.role, cover: s.swing && s.co !== p.company, tour: p.tour };
      if (q) {
        var hay = [p.name, p.title, p.pos, r.co, "tour " + p.tour].join(" ").toLowerCase();
        if (hay.indexOf(q) === -1) return;
      }
      rows.push(r);
    });

    var filled = rows.filter(function (r) { return r.p.name; }).length;
    $("date-summary").innerHTML =
      '<div class="watch-num"><span class="lbl">Watch</span><span class="n">' + w + "</span></div>" +
      '<div><div class="date-long">' + esc(longDate(d)) + (sameDay(d, today()) ? " · today" : "") + '</div>' +
      '<div class="count">' + filled + " on duty" + (rank ? " · " + esc(rank) : "") + (q ? " matching “" + esc(q) + "”" : "") + "</div></div>" +
      '<div class="chips"><span class="lbl">Tours working</span>' +
      M.toursOn(w).map(function (t) { return '<span class="chip">' + t + "</span>"; }).join("") + "</div>";

    if (!rows.length) {
      $("date-results").innerHTML = '<div class="empty">Nobody matches this filter on ' + esc(shortDate(d)) + ". Clear the filter or pick another rank.</div>";
      return;
    }
    var groups = {};
    rows.forEach(function (r) { (groups[r.p.rank] = groups[r.p.rank] || []).push(r); });
    var html = RANK_ORDER.filter(function (r) { return groups[r]; }).map(function (r) {
      var list = groups[r].sort(byCompany);
      return '<details class="group" open><summary>' + esc(r) + ' <span class="n">' + list.length + "</span></summary>" +
        '<div class="table-wrap"><table class="list"><thead><tr><th>Company</th><th>Name</th><th>Position</th><th>Tour</th><th></th></tr></thead><tbody>' +
        list.map(function (x) {
          var name = x.p.name
            ? '<button class="linkish" data-pos="' + esc(x.p.pos) + '">' + esc(x.p.name) + "</button>"
            : '<span class="vacant">Vacant</span>';
          var note = x.cover ? '<span class="tag">Swing from ' + esc(x.p.company) + "</span>" :
            (x.p.swingType ? '<span class="tag">' + esc(x.p.swingType) + "</span>" : "");
          return "<tr><td class=\"co\">" + esc(x.co) + "</td><td>" + name + "</td><td>" + esc(x.p.title) +
            (x.role ? " · " + esc(x.role) : "") + ' <span class="hint">' + esc(x.p.pos) + '</span></td><td class="mono">' + x.tour + "</td><td>" + note + "</td></tr>";
        }).join("") + "</tbody></table></div></details>";
    }).join("");
    $("date-results").innerHTML = html;
  }

  /* ---------- By person ---------- */
  var suggestIdx = -1;
  function matches(q) {
    q = q.trim().toLowerCase();
    if (!q) return [];
    var starts = [], contains = [];
    people.forEach(function (p) {
      var n = p.name.toLowerCase();
      var other = (p.pos + " " + p.title + " " + (p.company || "")).toLowerCase();
      if (n.indexOf(q) === 0) starts.push(p);
      else if (n.indexOf(q) !== -1 || other.indexOf(q) !== -1) contains.push(p);
    });
    return starts.concat(contains).slice(0, 40);
  }
  function showSuggest() {
    var list = matches($("person-input").value);
    var ul = $("person-list");
    suggestIdx = -1;
    if (!list.length) { ul.hidden = true; $("person-input").setAttribute("aria-expanded", "false"); return; }
    ul.innerHTML = list.map(function (p, i) {
      return '<li role="option" id="opt-' + i + '" data-pos="' + esc(p.pos) + '"><span>' + esc(p.name) +
        '</span><span class="meta">' + esc(p.title) + " · T" + p.tour + "</span></li>";
    }).join("");
    ul.hidden = false;
    $("person-input").setAttribute("aria-expanded", "true");
  }
  function moveSuggest(dir) {
    var items = $("person-list").querySelectorAll("li");
    if (!items.length) return;
    suggestIdx = (suggestIdx + dir + items.length) % items.length;
    items.forEach(function (li, i) { li.setAttribute("aria-selected", i === suggestIdx ? "true" : "false"); });
    items[suggestIdx].scrollIntoView({ block: "nearest" });
    $("person-input").setAttribute("aria-activedescendant", items[suggestIdx].id);
  }
  function choosePerson(pos) {
    var p = byPos[pos];
    if (!p) return;
    state.personPos = pos;
    state.personMonth = new Date(state.date.getFullYear(), state.date.getMonth(), 1);
    $("person-input").value = p.name || "";
    $("person-list").hidden = true;
    $("person-input").setAttribute("aria-expanded", "false");
    store("person", pos);
    if (state.view !== "person") setView("person"); else renderPerson();
  }

  function renderPerson() {
    var p = byPos[state.personPos];
    var out = $("person-detail");
    if (!p) {
      out.innerHTML = '<div class="empty">Type a last name above to see that person\'s tour, their work days for any month, and their next shifts. ' +
        people.length + " people are listed across " + data.length + " positions. You can also click any name in the Who's working list.</div>";
      return;
    }
    var m = state.personMonth;
    var first = new Date(m.getFullYear(), m.getMonth(), 1);
    var days = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate();
    var t = today();
    var cells = DOW.map(function (d) { return '<div class="dow">' + d.slice(0, 2) + "</div>"; }).join("");
    for (var b = 0; b < first.getDay(); b++) cells += '<div class="d blank"></div>';
    var workCount = 0;
    for (var i = 1; i <= days; i++) {
      var d = new Date(m.getFullYear(), m.getMonth(), i);
      var s = M.shiftFor(p, d);
      if (s) workCount++;
      var cover = s && s.swing && s.co !== p.company;
      var label = s && s.swing ? s.co : "W" + M.watchFor(d);
      cells += '<div class="d' + (s ? " work" : "") + (cover ? " cover" : "") + (sameDay(d, t) ? " today" : "") +
        '" title="' + esc(longDate(d) + " · watch " + M.watchFor(d) + (s ? " · working" + (s.co ? " at " + s.co : "") : " · off")) + '">' +
        '<span class="dn">' + i + '</span><span class="w">' + esc(label) + "</span></div>";
    }

    var next = [], d2 = t;
    for (var k = 0; k < 120 && next.length < 9; k++, d2 = addDays(d2, 1)) {
      var s2 = M.shiftFor(p, d2);
      if (s2) next.push({ d: d2, s: s2, k: k });
    }

    out.innerHTML =
      '<div class="person">' +
      '<div class="card ident"><h2>' + esc(p.name) + "</h2>" +
      kv("Rank", p.rank) + kv("Position", p.title) + kv("Position no.", p.pos) +
      '<div class="kv"><span class="k">Tour</span><span class="v big">' + p.tour + "</span></div>" +
      kv("Works watches", watchesFor(p.tour).join(" ")) + "</div>" +
      '<div class="card"><div class="cal-head"><button class="btn icon" id="pm-prev" aria-label="Previous month">&lsaquo;</button>' +
      '<span class="month-label">' + MONTHS[m.getMonth()] + " " + m.getFullYear() + '</span><button class="btn icon" id="pm-next" aria-label="Next month">&rsaquo;</button></div>' +
      '<div class="cal">' + cells + "</div>" +
      '<div class="legend"><span><i style="background:var(--accent)"></i>Work day (' + workCount + ")</span>" +
      (p.swing ? '<span><i style="background:var(--swing)"></i>Covering another company</span>' : "") +
      '<span><i style="box-shadow:inset 0 0 0 2px var(--today)"></i>Today</span><span>W = watch number</span></div></div>' +
      '<div class="card"><h3>Next shifts</h3><ol class="shifts">' +
      next.map(function (n) {
        return '<li><span class="when">' + esc(shortDate(n.d)) + '</span><span class="rel">' + (n.k === 0 ? "Today" : n.k === 1 ? "Tomorrow" : "in " + n.k + " days") +
          " · W" + n.s.watch + '</span><span class="where">' + esc(n.s.co || home(p)) + (n.s.role ? " " + esc(n.s.role) : "") + "</span></li>";
      }).join("") + "</ol></div></div>";

    $("pm-prev").onclick = function () { state.personMonth = new Date(m.getFullYear(), m.getMonth() - 1, 1); renderPerson(); };
    $("pm-next").onclick = function () { state.personMonth = new Date(m.getFullYear(), m.getMonth() + 1, 1); renderPerson(); };
  }
  function kv(k, v) { return '<div class="kv"><span class="k">' + esc(k) + '</span><span class="v">' + esc(v) + "</span></div>"; }
  function watchesFor(tour) {
    var out = [];
    for (var w = 1; w <= 31; w++) if (M.tourWorks(tour, w)) out.push(w);
    return out;
  }

  /* ---------- By rank (month roster) ---------- */
  function fillCompanies() {
    var rank = $("rank-select").value;
    var prev = $("rank-company").value;
    var cos = {};
    data.forEach(function (p) { if (p.rank === rank) cos[home(p)] = 1; });
    var list = Object.keys(cos).sort(function (a, b) { return coKey(a).localeCompare(coKey(b)); });
    $("rank-company").innerHTML = '<option value="">All companies</option>' +
      list.map(function (c) { return '<option value="' + esc(c) + '">' + esc(c) + "</option>"; }).join("");
    if (cos[prev]) $("rank-company").value = prev;
  }

  function renderRank() {
    var m = state.rankMonth;
    var rank = $("rank-select").value, co = $("rank-company").value, tour = +$("rank-tour").value;
    var showVacant = $("rank-vacant").checked;
    $("rank-month").textContent = MONTHS[m.getMonth()] + " " + m.getFullYear();
    var rows = data.filter(function (p) {
      return p.rank === rank && (!co || home(p) === co) && (!tour || p.tour === tour) && (p.name || showVacant);
    }).sort(byCompany);
    var days = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate();
    var t = today();
    var dates = [];
    for (var i = 1; i <= days; i++) dates.push(new Date(m.getFullYear(), m.getMonth(), i));

    $("rank-count").textContent = rows.length + " " + (rows.length === 1 ? "position" : "positions") +
      ". Red = working. Amber = swing covering the company shown. Click a name for that person's detail.";
    if (!rows.length) { $("rank-grid").innerHTML = '<div class="empty">No positions match. Try All companies or All tours.</div>'; return; }

    var head = '<tr><th class="who">Name</th>' + dates.map(function (d) {
      return '<th class="' + (sameDay(d, t) ? "today-col" : "") + '"><span class="wd">' + DOW[d.getDay()].charAt(0) + "</span>" + d.getDate() +
        '<span class="wn">' + M.watchFor(d) + "</span></th>";
    }).join("") + "</tr>";
    var body = rows.map(function (p) {
      var who = p.name ? '<button class="linkish" data-pos="' + esc(p.pos) + '">' + esc(p.name) + "</button>" : '<span class="vacant">Vacant</span>';
      return '<tr><th class="who" scope="row">' + who + '<span class="meta">' + esc(home(p)) + " T" + p.tour + (p.swingType ? " " + esc(p.swingType) : "") + "</span></th>" +
        dates.map(function (d) {
          var s = M.shiftFor(p, d);
          var cls = "c" + (s ? (s.swing && s.co !== p.company ? " cover" : " on") : "") + (sameDay(d, t) ? " today-col" : "") +
            (!s && (d.getDay() === 0 || d.getDay() === 6) ? " weekend" : "");
          var txt = s && s.swing && s.co !== p.company ? esc(s.co) : "";
          return '<td class="' + cls + '"' + (s ? ' title="' + esc(shortDate(d) + " · " + (s.co || home(p)) + (s.role ? " " + s.role : "")) + '"' : "") + ">" + (s ? "<span>" + txt + "</span>" : "") + "</td>";
        }).join("") + "</tr>";
    }).join("");
    $("rank-grid").innerHTML = '<table class="roster"><thead>' + head + "</thead><tbody>" + body + "</tbody></table>";
  }

  /* ---------- Boot ---------- */
  var byPos = {};
  function boot(rows) {
    data = rows;
    data.forEach(function (p) { byPos[p.pos] = p; });
    people = data.filter(function (p) { return p.name; }).sort(function (a, b) { return a.name.localeCompare(b.name); });
    var t = today();
    state.personMonth = new Date(t.getFullYear(), t.getMonth(), 1);
    state.rankMonth = new Date(t.getFullYear(), t.getMonth(), 1);
    $("today-chip").innerHTML = esc(shortDate(t)) + " <span>Watch</span> <b>" + M.watchFor(t) + "</b>";

    rankOptions($("date-rank"), true);
    rankOptions($("rank-select"), false);
    $("rank-select").value = "Captain";
    $("rank-tour").innerHTML = '<option value="">All tours</option>' +
      Array.apply(null, Array(31)).map(function (_, i) { return '<option value="' + (i + 1) + '">Tour ' + (i + 1) + "</option>"; }).join("");
    fillCompanies();

    document.querySelectorAll(".tab").forEach(function (b) { b.onclick = function () { setView(b.dataset.view); }; });
    $("date-input").onchange = function () { if (this.value) { state.date = fromIso(this.value); renderDate(); } };
    $("date-prev").onclick = function () { state.date = addDays(state.date, -1); renderDate(); };
    $("date-next").onclick = function () { state.date = addDays(state.date, 1); renderDate(); };
    $("date-today").onclick = function () { state.date = today(); renderDate(); };
    $("date-rank").onchange = renderDate;
    $("date-filter").oninput = renderDate;
    $("date-vacant").onchange = renderDate;

    $("person-input").oninput = showSuggest;
    $("person-input").onfocus = showSuggest;
    $("person-input").onkeydown = function (e) {
      if (e.key === "ArrowDown") { e.preventDefault(); moveSuggest(1); }
      else if (e.key === "ArrowUp") { e.preventDefault(); moveSuggest(-1); }
      else if (e.key === "Enter") {
        var items = $("person-list").querySelectorAll("li");
        var li = items[suggestIdx >= 0 ? suggestIdx : 0];
        if (li && !$("person-list").hidden) { e.preventDefault(); choosePerson(li.dataset.pos); }
      } else if (e.key === "Escape") { $("person-list").hidden = true; }
    };
    $("person-list").onmousedown = function (e) {
      var li = e.target.closest("li");
      if (li) { e.preventDefault(); choosePerson(li.dataset.pos); }
    };
    $("person-input").onblur = function () { setTimeout(function () { $("person-list").hidden = true; }, 100); };

    $("rank-select").onchange = function () { fillCompanies(); renderRank(); };
    $("rank-company").onchange = renderRank;
    $("rank-tour").onchange = renderRank;
    $("rank-vacant").onchange = renderRank;
    $("rank-prev").onclick = function () { state.rankMonth = new Date(state.rankMonth.getFullYear(), state.rankMonth.getMonth() - 1, 1); renderRank(); };
    $("rank-next").onclick = function () { state.rankMonth = new Date(state.rankMonth.getFullYear(), state.rankMonth.getMonth() + 1, 1); renderRank(); };

    document.addEventListener("click", function (e) {
      var b = e.target.closest("button.linkish[data-pos]");
      if (b) choosePerson(b.dataset.pos);
    });

    var savedPerson = recall("person");
    if (savedPerson && byPos[savedPerson] && byPos[savedPerson].name) {
      state.personPos = savedPerson;
      $("person-input").value = byPos[savedPerson].name;
    }
    var v = recall("view");
    setView(v === "person" || v === "rank" ? v : "date");
  }

  var load = window.POSITIONS
    ? Promise.resolve(window.POSITIONS)
    : fetch("data/positions.json").then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      });
  load.then(boot).catch(function (err) {
    $("date-results").innerHTML = '<div class="empty">Could not load data/positions.json (' + esc(err.message) +
      "). Serve this folder over HTTP, for example with <code>python3 -m http.server</code>, then reload.</div>";
  });
})();
