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
  var STATUS_LABEL = { VA: "Vacation", D: "Disabled", S: "Sick" };
  var recs = { statuses: [], tourChanges: [] }; // tour changes + work statuses from the editor backend
  var backend = null;
  var contacts = {}; // pos -> {email, phoneMobile, phoneOther, shared}, from the server when signed in
  function opts() { return { statuses: recs.statuses, changes: recs.tourChanges }; }
  function shift(p, d) { return M.shiftFor(p, d, opts()); }
  function tourOn(p, d) { return M.effectiveTour(p, d, recs.tourChanges); }
  function statusPill(code) {
    return code ? '<span class="st st-' + esc(code) + '" title="' + esc(STATUS_LABEL[code] || code) + '">' + esc(code) + "</span>" : "";
  }

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
    ["date", "person", "rank", "me", "admin"].forEach(function (k) {
      $("view-" + k).hidden = k !== v;
      $("tab-" + k).setAttribute("aria-selected", k === v ? "true" : "false");
    });
    store("view", v);
    render();
  }

  function render() {
    if (state.view === "date") renderDate();
    else if (state.view === "person") renderPerson();
    else if (state.view === "me") Accounts.renderMe();
    else if (state.view === "admin") Accounts.renderAdmin();
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
      var s = shift(p, d);
      if (!s) return;
      var r = { p: p, co: s.co || home(p), role: s.role, cover: s.swing && s.co !== p.company, tour: s.tour, status: s.status };
      if (q) {
        var hay = [p.name, p.title, p.pos, r.co, "tour " + s.tour, s.status ? s.status + " " + STATUS_LABEL[s.status] : ""].join(" ").toLowerCase();
        if (hay.indexOf(q) === -1) return;
      }
      rows.push(r);
    });

    var off = { VA: 0, D: 0, S: 0 }, offTotal = 0, onDuty = 0;
    rows.forEach(function (r) {
      if (!r.p.name) return;
      if (r.status) { off[r.status]++; offTotal++; } else onDuty++;
    });
    var offText = offTotal ? " · " + offTotal + " off (" + ["VA", "S", "D"].filter(function (c) { return off[c]; })
      .map(function (c) { return c + " " + off[c]; }).join(" · ") + ")" : "";
    $("date-summary").innerHTML =
      '<div class="watch-num"><span class="lbl">Watch</span><span class="n">' + w + "</span></div>" +
      '<div><div class="date-long">' + esc(longDate(d)) + (sameDay(d, today()) ? " · today" : "") + '</div>' +
      '<div class="count">' + onDuty + " on duty" + offText + (rank ? " · " + esc(rank) : "") + (q ? " matching “" + esc(q) + "”" : "") + "</div></div>" +
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
          var note = statusPill(x.status) + (x.cover ? '<span class="tag">Swing from ' + esc(x.p.company) + "</span>" :
            (x.p.swingType ? '<span class="tag">' + esc(x.p.swingType) + "</span>" : ""));
          return "<tr" + (x.status ? ' class="is-off"' : "") + "><td class=\"co\">" + esc(x.co) + "</td><td>" + name + "</td><td>" + esc(x.p.title) +
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
        '</span><span class="meta">' + esc(p.title) + " · T" + tourOn(p, today()) + "</span></li>";
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
    var workCount = 0, offCount = 0;
    for (var i = 1; i <= days; i++) {
      var d = new Date(m.getFullYear(), m.getMonth(), i);
      var s = shift(p, d);
      if (s) { if (s.status) offCount++; else workCount++; }
      var cover = s && s.swing && s.co !== p.company;
      var label = s && s.status ? s.status : s && s.swing ? s.co : "W" + M.watchFor(d);
      cells += '<div class="d' + (s ? (s.status ? " off st-" + s.status : " work") : "") + (cover && !s.status ? " cover" : "") + (sameDay(d, t) ? " today" : "") +
        '" title="' + esc(longDate(d) + " · watch " + M.watchFor(d) + (s ? (s.status ? " · " + STATUS_LABEL[s.status] : " · working" + (s.co ? " at " + s.co : "")) : " · off")) + '">' +
        '<span class="dn">' + i + '</span><span class="w">' + esc(label) + "</span></div>";
    }

    var next = [], d2 = t;
    for (var k = 0; k < 120 && next.length < 9; k++, d2 = addDays(d2, 1)) {
      var s2 = shift(p, d2);
      if (s2) next.push({ d: d2, s: s2, k: k });
    }

    var tourNow = tourOn(p, t);
    var upcoming = recs.tourChanges.filter(function (c) { return c.pos === p.pos && c.effective > iso(t); })
      .sort(function (a, b) { return a.effective.localeCompare(b.effective); })[0];
    var statusNow = M.statusFor(p.pos, t, recs.statuses);

    out.innerHTML =
      '<div class="person">' +
      '<div class="card ident"><h2>' + esc(p.name) + "</h2>" +
      kv("Rank", p.rank) + kv("Position", p.title) + kv("Position no.", p.pos) +
      '<div class="kv"><span class="k">Tour</span><span class="v big">' + tourNow + "</span></div>" +
      (upcoming ? kv("Tour change", "→ " + upcoming.tour + " from " + shortDate(fromIso(upcoming.effective))) : "") +
      kv("Works watches", watchesFor(tourNow).join(" ")) +
      (statusNow ? '<div class="kv"><span class="k">Today</span><span class="v">' + statusPill(statusNow) + " " + esc(STATUS_LABEL[statusNow]) + "</span></div>" : "") +
      contactHtml(p) + "</div>" +
      '<div class="card"><div class="cal-head"><button class="btn icon" id="pm-prev" aria-label="Previous month">&lsaquo;</button>' +
      '<span class="month-label">' + MONTHS[m.getMonth()] + " " + m.getFullYear() + '</span><button class="btn icon" id="pm-next" aria-label="Next month">&rsaquo;</button></div>' +
      '<div class="cal">' + cells + "</div>" +
      '<div class="legend"><span><i style="background:var(--accent)"></i>Work day (' + workCount + ")</span>" +
      (offCount ? '<span><i class="sw-off"></i>Off: VA / S / D (' + offCount + ")</span>" : "") +
      (p.swing ? '<span><i style="background:var(--swing)"></i>Covering another company</span>' : "") +
      '<span><i style="box-shadow:inset 0 0 0 2px var(--today)"></i>Today</span><span>W = watch number</span></div></div>' +
      '<div class="side">' +
      '<div class="card"><h3>Next shifts</h3><ol class="shifts">' +
      next.map(function (n) {
        return '<li><span class="when">' + esc(shortDate(n.d)) + '</span><span class="rel">' + (n.k === 0 ? "Today" : n.k === 1 ? "Tomorrow" : "in " + n.k + " days") +
          " · W" + n.s.watch + '</span><span class="where">' + (n.s.status ? statusPill(n.s.status) : esc(n.s.co || home(p)) + (n.s.role ? " " + esc(n.s.role) : "")) + "</span></li>";
      }).join("") + "</ol></div>" +
      historyCard(p) + "</div></div>";

    $("pm-prev").onclick = function () { state.personMonth = new Date(m.getFullYear(), m.getMonth() - 1, 1); renderPerson(); };
    $("pm-next").onclick = function () { state.personMonth = new Date(m.getFullYear(), m.getMonth() + 1, 1); renderPerson(); };
    wireEditForms(p);
  }

  /* ---------- Status & tour history, editor forms ---------- */
  function historyCard(p) {
    var canEdit = backend && backend.canEdit();
    var items = recs.statuses.filter(function (s) { return s.pos === p.pos; }).map(function (s) {
      return { kind: "statuses", id: s.id, sort: s.start, html: statusPill(s.code) + " <b>" + esc(STATUS_LABEL[s.code]) + "</b> " +
        esc(shortDate(fromIso(s.start))) + (s.end ? (s.end !== s.start ? " – " + esc(shortDate(fromIso(s.end))) : "") : " onward") +
        (s.end && s.end.slice(0, 4) !== s.start.slice(0, 4) ? " " + s.end.slice(0, 4) : ""), note: s.note };
    }).concat(recs.tourChanges.filter(function (c) { return c.pos === p.pos; }).map(function (c) {
      return { kind: "tourChanges", id: c.id, sort: c.effective, html: '<span class="st st-T">T</span> <b>Tour ' + esc(c.tour) + "</b> from " +
        esc(shortDate(fromIso(c.effective))) + " " + esc(c.effective.slice(0, 4)), note: c.note };
    })).sort(function (a, b) { return b.sort.localeCompare(a.sort); });

    var list = items.length ? '<ul class="hist">' + items.map(function (it) {
      return '<li><div>' + it.html + (it.note ? '<div class="hint">' + esc(it.note) + "</div>" : "") + "</div>" +
        (canEdit ? '<button class="btn small" data-remove="' + esc(it.kind) + '" data-id="' + esc(it.id) + '">Remove</button>' : "") + "</li>";
    }).join("") + "</ul>" : '<p class="hint">No tour changes or leave recorded.</p>';

    var t = iso(today());
    var forms = !canEdit ? editHint() :
      '<form class="edit" id="f-status" novalidate><h4>Add status</h4>' +
      '<div class="row"><label>Type<select id="fs-code"><option value="VA">VA · Vacation</option><option value="S">S · Sick</option><option value="D">D · Disabled</option></select></label>' +
      '<label>From<input type="date" id="fs-start" value="' + t + '" required></label>' +
      '<label>To<input type="date" id="fs-end" value="' + t + '"></label></div>' +
      '<label class="chk"><input type="checkbox" id="fs-open"> No end date yet</label>' +
      '<label>Note<input type="text" id="fs-note" maxlength="500" placeholder="Optional"></label>' +
      '<div class="row"><button class="btn primary" type="submit">Save status</button><span class="msg" id="fs-msg" role="status"></span></div></form>' +
      '<form class="edit" id="f-tour" novalidate><h4>Change tour</h4>' +
      '<div class="row"><label>New tour<select id="ft-tour">' + tourOptions(tourOn(p, today())) + "</select></label>" +
      '<label>Effective<input type="date" id="ft-eff" value="' + t + '" required></label></div>' +
      '<label>Note<input type="text" id="ft-note" maxlength="500" placeholder="Optional, e.g. bid result"></label>' +
      '<div class="row"><button class="btn primary" type="submit">Save tour change</button><span class="msg" id="ft-msg" role="status"></span></div></form>';

    return '<div class="card"><h3>Status &amp; tour history</h3>' + list + forms + "</div>";
  }
  function tourOptions(sel) {
    var o = "";
    for (var i = 1; i <= 31; i++) o += '<option value="' + i + '"' + (i === sel ? " selected" : "") + ">Tour " + i + "</option>";
    return o;
  }
  function editHint() {
    if (!backend || backend.mode === "none") return '<p class="hint">Editing needs the shared page or the schedule server. See the README.</p>';
    return '<p class="hint">Only editors can record leave or tour changes.</p>';
  }
  function wireEditForms(p) {
    var fs = $("f-status"), ft = $("f-tour");
    document.querySelectorAll("[data-remove]").forEach(function (b) {
      b.onclick = function () {
        if (b.dataset.confirm !== "1") { b.dataset.confirm = "1"; b.textContent = "Confirm remove"; b.classList.add("danger"); return; }
        b.disabled = true;
        backend.remove(b.dataset.remove, b.dataset.id).then(function () { renderAll(true); }, function (e) { b.disabled = false; b.textContent = e.message; });
      };
    });
    if (!fs) return;
    $("fs-open").onchange = function () { $("fs-end").disabled = this.checked; };
    fs.onsubmit = function (e) {
      e.preventDefault();
      var start = $("fs-start").value, end = $("fs-open").checked ? null : $("fs-end").value || null, msg = $("fs-msg");
      if (!start) return say(msg, "Pick a start date.", true);
      if (end && end < start) return say(msg, "The end date is before the start date.", true);
      say(msg, "Saving…");
      backend.addStatus({ pos: p.pos, name: p.name, code: $("fs-code").value, start: start, end: end, note: $("fs-note").value.trim() })
        .then(function () { renderAll(true); say($("fs-msg"), "Saved."); }, function (err) { say(msg, err.message, true); });
    };
    ft.onsubmit = function (e) {
      e.preventDefault();
      var eff = $("ft-eff").value, tour = +$("ft-tour").value, msg = $("ft-msg");
      if (!eff) return say(msg, "Pick an effective date.", true);
      if (tour === tourOn(p, fromIso(eff))) return say(msg, "They are already on Tour " + tour + " on that date.", true);
      say(msg, "Saving…");
      backend.addTourChange({ pos: p.pos, name: p.name, tour: tour, effective: eff, note: $("ft-note").value.trim() })
        .then(function () { renderAll(true); say($("ft-msg"), "Saved."); }, function (err) { say(msg, err.message, true); });
    };
  }
  function say(el, text, isErr) {
    if (!el) return;
    el.textContent = text;
    el.classList.toggle("err", !!isErr);
  }
  function contactHtml(p) {
    var c = contacts[p.pos];
    if (!c || !(c.email || c.phoneMobile || c.phoneOther)) return "";
    var bits = [];
    if (c.email) bits.push('<a href="mailto:' + esc(c.email) + '">' + esc(c.email) + '</a> <button class="btn tiny" data-copy="' + esc(c.email) + '">Copy</button>');
    [["Mobile", c.phoneMobile], ["Other", c.phoneOther]].forEach(function (ph) {
      if (ph[1]) bits.push(esc(ph[0]) + ' <a href="tel:' + esc(ph[1].replace(/[^0-9+x]/gi, "")) + '">' + esc(ph[1]) + '</a> <button class="btn tiny" data-copy="' + esc(ph[1]) + '">Copy</button>');
    });
    return '<div class="kv contact-kv"><span class="k">Contact for swaps' + (c.shared ? "" : " · not shared, admins only") + '</span><span class="v contact-v">' +
      bits.join('<span class="sep"> · </span>') + "</span></div>";
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
      return p.rank === rank && (!co || home(p) === co) && (!tour || tourOn(p, m) === tour) && (p.name || showVacant);
    }).sort(byCompany);
    var days = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate();
    var t = today();
    var dates = [];
    for (var i = 1; i <= days; i++) dates.push(new Date(m.getFullYear(), m.getMonth(), i));

    $("rank-count").textContent = rows.length + " " + (rows.length === 1 ? "position" : "positions") +
      ". Red = working. Amber = swing covering the company shown. VA / S / D = scheduled but off. Click a name for that person's detail.";
    if (!rows.length) { $("rank-grid").innerHTML = '<div class="empty">No positions match. Try All companies or All tours.</div>'; return; }

    var head = '<tr><th class="who">Name</th>' + dates.map(function (d) {
      return '<th class="' + (sameDay(d, t) ? "today-col" : "") + '"><span class="wd">' + DOW[d.getDay()].charAt(0) + "</span>" + d.getDate() +
        '<span class="wn">' + M.watchFor(d) + "</span></th>";
    }).join("") + "</tr>";
    var body = rows.map(function (p) {
      var who = p.name ? '<button class="linkish" data-pos="' + esc(p.pos) + '">' + esc(p.name) + "</button>" : '<span class="vacant">Vacant</span>';
      return '<tr><th class="who" scope="row">' + who + '<span class="meta">' + esc(home(p)) + " T" + tourOn(p, m) + (p.swingType ? " " + esc(p.swingType) : "") + "</span></th>" +
        dates.map(function (d) {
          var s = shift(p, d);
          var cls = "c" + (s ? (s.status ? " off st-" + s.status : s.swing && s.co !== p.company ? " cover" : " on") : "") + (sameDay(d, t) ? " today-col" : "") +
            (!s && (d.getDay() === 0 || d.getDay() === 6) ? " weekend" : "");
          var txt = s ? (s.status ? s.status : s.swing && s.co !== p.company ? s.co : "") : "";
          var tip = s ? shortDate(d) + " · " + (s.status ? STATUS_LABEL[s.status] : (s.co || home(p)) + (s.role ? " " + s.role : "")) : "";
          return '<td class="' + cls + '"' + (s ? ' title="' + esc(tip) + '"' : "") + ">" + (s ? "<span>" + esc(txt) + "</span>" : "") + "</td>";
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

    document.addEventListener("click", function (e) {
      var c = e.target.closest("button[data-copy]");
      if (!c) return;
      var text = c.dataset.copy;
      var done = function () { c.textContent = "Copied"; setTimeout(function () { c.textContent = "Copy"; }, 1500); };
      try {
        navigator.clipboard.writeText(text).then(done, function () { selectText(c.previousElementSibling); });
      } catch (err) { selectText(c.previousElementSibling); }
    });

    var savedPerson = recall("person");
    if (savedPerson && byPos[savedPerson] && byPos[savedPerson].name) {
      state.personPos = savedPerson;
      $("person-input").value = byPos[savedPerson].name;
    }
    booted = true;
    applyAccountUi();
    var v = recall("view");
    setView(tabAllowed(v) ? v : "date");
  }
  function selectText(el) {
    if (!el) return;
    var r = document.createRange();
    r.selectNodeContents(el);
    var sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
  }

  // Re-render the current view. Background refreshes wait while someone is filling in an edit form.
  var deferred = false, booted = false;
  function renderAll(force) {
    if (!booted) return;
    var a = document.activeElement;
    if (!force && (state.view === "person" || state.view === "me") && a && a.closest && a.closest("form.edit")) {
      if (!deferred) { deferred = true; a.closest("form.edit").addEventListener("focusout", function once(e) {
        if (e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest("form.edit")) return;
        this.removeEventListener("focusout", once);
        // Focus also leaves when the form itself is replaced, so render after the current one finishes.
        setTimeout(function () { if (deferred) { deferred = false; renderAll(); } }, 0);
      }); }
      return;
    }
    if (!force && state.view === "admin") return; // the admin page reloads itself after each action
    deferred = false;
    render();
  }

  /* ---------- Accounts (server mode) ---------- */
  function serverMode() { return backend && backend.mode === "server"; }
  function tabAllowed(v) {
    if (v === "date" || v === "person" || v === "rank") return true;
    if (v === "me") return serverMode() && backend.isActive();
    if (v === "admin") return serverMode() && backend.isAdmin();
    return false;
  }
  function applyAccountUi() {
    $("tab-me").hidden = !tabAllowed("me");
    $("tab-admin").hidden = !tabAllowed("admin");
    if (!tabAllowed(state.view) && booted) setView("date");
    renderEditChip();
  }
  function renderEditChip() {
    var el = $("edit-chip");
    if (!backend || backend.mode === "none") { el.hidden = true; return; }
    el.hidden = false;
    if (serverMode()) {
      var me = backend.me();
      if (!me.signedIn) { el.hidden = true; return; }
      el.innerHTML = '<span class="dot' + (backend.canEdit() ? " on" : "") + '"></span>' + esc(me.name || me.googleEmail) +
        ' <span class="role-pill">' + esc(me.status === "active" ? me.role : me.status) + "</span>" +
        ' <button class="linkish" id="sign-out">Sign out</button>';
      $("sign-out").onclick = function () { backend.signOut(); };
      return;
    }
    el.innerHTML = backend.canEdit() ? '<span class="dot on"></span>Editing' : '<span class="dot"></span>View only';
  }
  function gate(on) {
    document.querySelector(".page").classList.toggle("gated", on);
    $("gate").hidden = !on;
  }

  var Accounts = window.AccountViews({
    $: $, esc: esc, say: say, backend: function () { return backend; }, byPos: function () { return byPos; },
    people: function () { return people; }, recs: function () { return recs; }, shift: shift, tourOn: tourOn,
    statusFor: function (pos, d) { return M.statusFor(pos, d, recs.statuses); }, statusPill: statusPill, STATUS_LABEL: STATUS_LABEL,
    today: today, addDays: addDays, iso: iso, fromIso: fromIso, shortDate: shortDate, choosePerson: choosePerson,
    renderAll: renderAll, gate: gate,
  });

  /* ---------- Start ---------- */
  function onRecords(r) {
    recs = { statuses: r.statuses || [], tourChanges: r.tourChanges || [] };
    if (r.contacts) contacts = r.contacts;
    renderAll();
  }
  function loadError(err) {
    $("date-results").innerHTML = '<div class="empty">Could not load the roster (' + esc(err.message) +
      "). Serve this folder over HTTP, for example with <code>python3 server.py</code>, then reload.</div>";
  }
  if (window.POSITIONS) {
    // Single-file build: show the schedule at once, then light up editing when the page database answers.
    boot(window.POSITIONS);
    window.ScheduleStore.connect(onRecords).then(function (b) { backend = b; applyAccountUi(); renderAll(true); });
  } else {
    window.ScheduleStore.connect(onRecords).then(function (b) {
      backend = b;
      if (serverMode() && !backend.isActive()) { renderEditChip(); Accounts.renderGate(); return; }
      return fetch("data/positions.json", { credentials: "same-origin" }).then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      }).then(function (rows) {
        if (location.search.indexOf("auth_error") !== -1) history.replaceState(null, "", location.pathname);
        boot(rows);
      });
    }).catch(loadError);
  }
})();
