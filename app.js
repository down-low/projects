(function () {
  "use strict";
  var M = window.TourMath;
  var RANK_ORDER = ["Battalion Chief", "Rescue Captain", "Captain", "Lieutenant", "ISS", "FF/Paramedic", "Firefighter", "Pilot", "Marine Engineer"];
  var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  var DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  var $ = function (id) { return document.getElementById(id); };
  var data = [];
  var people = []; // filled positions, sorted by name
  var state = { view: "dash", date: today(), personPos: null, personMonth: null, rankMonth: null,
    dashDate: today(), sixTour: 1, sixMonth: null, sixPair: null, folds: {}, crewIdx: 0 };
  var recsVersion = 0; // bumps whenever records change, for caches
  var requiredData = window.REQUIRED_STAFFING || null; // required staffing per apparatus, from the Daily Balance Report
  var emplIds = window.EMPLOYEE_IDS || null; // {ids: {pos: {id, name, source}}}, employee IDs for roster positions
  var ID_RE = /^[a-z]{2}\d{4}$/i; // employee ID, e.g. LE1234
  var STATUS_LABEL = { VA: "Vacation", D: "Disabled", S: "Sick", WE: "Working elsewhere", TR: "Traded off" };
  var OFF_CODES = ["VA", "S", "D", "WE", "TR"]; // TR is written only by a set shift trade
  var recs = { statuses: [], tourChanges: [], covers: [], people: [], members: [], trades: [], tradeReplies: [] }; // records from the backend
  var backend = null;
  var contacts = {}; // pos -> {email, phoneMobile, phoneOther, shared}, from the server when signed in
  function opts() { return { statuses: recs.statuses, changes: recs.tourChanges, covers: recs.covers, byPos: byPos }; }
  // A position's own scheduled shift (the seat), ignoring who fills it.
  function shift(p, d) { return M.shiftFor(p, d, opts()); }
  // A person's day: their own shift, or the covered position's shift while on a cover assignment.
  function day(p, d) { return M.dayFor(p.pos, p.added && !p.tour ? null : p, d, opts()); }
  function tourOn(p, d) { return p.added ? p.tour || null : M.effectiveTour(p, d, recs.tourChanges); }
  function coverOf(pos, d) { return M.coverOn(pos, d, recs.covers); }
  function coveringBy(key, d) { return M.coveringOn(key, d, recs.covers); }
  function nameOf(key) { var x = byPos[key]; return x ? x.name || "Vacant" : key; }
  function slotLabel(pos) { var x = byPos[pos]; return x ? x.title + " (" + (x.name || "vacant") + ")" : pos; }

  /* Search: "E10", "e 10", "RS1" match a company exactly; "tour 10" matches the tour; a full position
     number matches that position; an employee ID (LE1234) matches that person; anything else matches names, titles
     and IDs. f: {name, title, co, tour, pos, id, extra} */
  function makeMatcher(q) {
    q = (q || "").trim().toLowerCase();
    if (!q) return null;
    if (ID_RE.test(q)) return function (f) { return (f.id || "").toLowerCase() === q; };
    var m = /^([a-z]{1,3})\s*0*(\d{1,3})$/.exec(q);
    if (m && m[1] !== "tour") {
      return function (f) {
        var c = /^([A-Za-z]+)0*(\d+)$/.exec(f.co || "");
        return !!c && c[1].toLowerCase() === m[1] && +c[2] === +m[2];
      };
    }
    if ((m = /^(?:tour|t\.)\s*(\d{1,2})$/.exec(q))) return function (f) { return f.tour === +m[1]; };
    if (/^\d{1,2}[a-z]{2,4}\d{2,3}m$/.test(q)) return function (f) { return (f.pos || "").toLowerCase() === q; };
    // Names: words in any order, first or last ("david lester", "lester d").
    return function (f) { return M.wordsMatch(q, [f.name, f.title, f.id, f.extra].join(" ")); };
  }
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
    ["dash", "date", "person", "crew", "rank", "me", "admin", "six", "trades", "awards", "fixes", "card"].forEach(function (k) {
      $("view-" + k).hidden = k !== v;
      if ($("tab-" + k)) $("tab-" + k).setAttribute("aria-selected", k === v ? "true" : "false");
    });
    $("six-link").classList.toggle("on", v === "six");
    $("awards-link").classList.toggle("on", v === "awards");
    $("fixes-link").classList.toggle("on", v === "fixes");
    $("card-link").classList.toggle("on", v === "card");
    store("view", v);
    render();
  }

  function render() {
    if (state.view === "dash") Dash.renderDash();
    else if (state.view === "six") Dash.renderSix();
    else if (state.view === "date") renderDate();
    else if (state.view === "person") renderPerson();
    else if (state.view === "crew") renderCrew();
    else if (state.view === "me") Accounts.renderMe();
    else if (state.view === "admin") Accounts.renderAdmin();
    else if (state.view === "trades") Trades.renderTrades();
    else if (state.view === "awards") Awards.render();
    else if (state.view === "fixes") Fix.render();
    else if (state.view === "card") Card.render();
    else renderRank();
  }

  function rankOptions(sel, withAll) {
    sel.innerHTML = (withAll ? '<option value="">All ranks</option>' : "") +
      RANK_ORDER.map(function (r) { return '<option value="' + esc(r) + '">' + esc(r) + "</option>"; }).join("");
  }

  /* ---------- One day, every seat ----------
     Rows for each scheduled seat (roster positions and added people with a tour) on date d:
     the owner row (name null for a vacant seat) and, when the seat is covered, a row for the person covering.
     The owner is whoever moved into the seat (a 2027 award or assignment), else the vacancy-list holder unless they moved
     out. An owner on a cover elsewhere shows away. Row: {slot, co, tour, role, who, name, status, off, away, coveredBy,
     acting, moved, swingCover} */
  function dayRows(d) {
    var rows = [];
    slots().forEach(function (p) {
      var s = shift(p, d);
      if (!s) return;
      var o = ownerOn(p, d);
      var covs = M.coversOn(p.pos, d, recs.covers);
      var away = o.key ? M.actingOn(o.key, d, recs.covers) : null;
      var status = o.key ? M.statusFor(o.key, d, recs.statuses) : null;
      // Acting and covering take the seat; shadowing and extra fill it only when the owner isn't working.
      var cov = covs.filter(M.takesSeat)[0] || ((status || away || !o.name) && covs[0]) || null;
      var base = { slot: p, co: s.co || home(p), role: s.role, swingCover: s.swing && s.co !== p.company, tour: s.tour };
      rows.push(Object.assign({}, base, {
        who: o.person, name: o.name, status: status, moved: o.moved,
        away: away, coveredBy: cov, off: !!(status || away || (cov && o.name)),
      }));
      covs.forEach(function (c) { // usually one; two people can work the same seat's tour
        var coverer = byPos[c.coverKey];
        var coverStatus = M.statusFor(c.coverKey, d, recs.statuses);
        rows.push(Object.assign({}, base, {
          who: coverer || null, name: coverer ? coverer.name : c.coverName, acting: c, kind: kindOf(c),
          status: coverStatus, off: !!coverStatus,
        }));
      });
    });
    return rows;
  }
  // Who owns seat p on d: {key, person, name, moved}. moved is the move record when someone moved in.
  function ownerOn(p, d) {
    var mv = M.movesInto(p.pos, d, recs.covers);
    if (mv) return { key: mv.coverKey, person: byPos[mv.coverKey] || null, name: (byPos[mv.coverKey] || {}).name || mv.coverName, moved: mv };
    var out = p.name ? M.movedTo(p.pos, d, recs.covers) : null;
    if (!p.name || (out && out.targetPos !== p.pos)) return { key: null, person: null, name: null, moved: null };
    return { key: p.pos, person: p, name: p.name, moved: null };
  }
  // The seat person p owns on d: their vacancy-list seat, or the one a move gave them.
  function ownSeatOn(p, d) {
    var mv = M.movedTo(p.pos, d, recs.covers);
    return mv && byPos[mv.targetPos] ? byPos[mv.targetPos] : p.added && !p.tour ? null : p;
  }
  // Cover kind for a record (acting, cover, shadow, extra) and its wording.
  var KIND = { acting: ["Acting", "Acting for", "Acting at"], cover: ["Covering", "Covering for", "Covering at"],
    shadow: ["Shadowing", "Shadowing", "Shadowing at"], extra: ["Also assigned", "Also assigned with", "Also at"] };
  function kindOf(c) {
    var who = byPos[c.coverKey], seat = byPos[c.targetPos];
    return M.coverKind(c, who && who.rank, seat && seat.rank);
  }
  function kindWord(c, i) { return M.isMove(c) ? ["Moved", "Moved to", "Moved to"][i || 0] : KIND[kindOf(c)][i || 0]; }
  // Seats on the schedule: roster positions plus added people who have their own apparatus and tour.
  function slots() { return addedWithTour.length ? data.concat(addedWithTour) : data; }

  /* ---------- Projection: everyone on a date ---------- */
  function renderDate() {
    var d = state.date;
    var w = M.watchFor(d);
    $("date-input").value = iso(d);
    var rank = $("date-rank").value;
    var q = $("date-filter").value.trim().toLowerCase();
    var showVacant = $("date-vacant").checked;

    var match = makeMatcher(q);
    var phone = isPhone();
    var rows = dayRows(d).filter(function (r) {
      if (rank && r.slot.rank !== rank) return false;
      if (!r.name && !showVacant) return false;
      return !match || match({ name: r.name, title: r.slot.title, co: r.co, tour: r.tour, pos: r.slot.pos, id: r.who && r.who.emplId,
        extra: r.status ? r.status + " " + STATUS_LABEL[r.status] : "" });
    });

    var off = { VA: 0, D: 0, S: 0, WE: 0, TR: 0 }, offTotal = 0, onDuty = 0, awayN = 0, coveredN = 0;
    rows.forEach(function (r) {
      if (!r.name) return;
      if (!r.off) { onDuty++; return; }
      offTotal++;
      if (r.status) off[r.status]++;
      else if (r.away) awayN++;
      else coveredN++;
    });
    var offParts = OFF_CODES.filter(function (c) { return off[c]; }).map(function (c) { return c + " " + off[c]; });
    if (awayN) offParts.push(awayN + " covering elsewhere");
    if (coveredN) offParts.push(coveredN + " covered");
    var offText = offTotal ? " · " + offTotal + " off (" + offParts.join(" · ") + ")" : "";
    if (phone) {
      $("date-summary").innerHTML = '<div class="pt-sum">' + (M.holidayFor(d) ? holidayNote(d) + "<br>" : "") +
        "Tours " + M.toursOn(w).join(" · ") + " · <b>" + onDuty + "</b> on duty" + offText +
        (q ? " · matching “" + esc(q) + "”" : "") + "</div>";
    } else $("date-summary").innerHTML =
      '<div class="watch-num"><span class="lbl">Watch</span><span class="n">' + w + "</span></div>" +
      '<div><div class="date-long">' + esc(longDate(d)) + (sameDay(d, today()) ? " · today" : "") + " " + holidayNote(d) + "</div>" +
      '<div class="count">' + onDuty + " on duty" + offText + (rank ? " · " + esc(rank) : "") + (q ? " matching “" + esc(q) + "”" : "") + "</div></div>" +
      '<div class="chips"><span class="lbl">Tours working</span>' +
      M.toursOn(w).map(function (t) { return '<span class="chip">' + t + "</span>"; }).join("") + "</div>";

    if (!rows.length) {
      $("date-results").innerHTML = '<div class="empty">Nobody matches this filter on ' + esc(shortDate(d)) + ". Clear the filter or pick another rank.</div>";
      return;
    }
    rows = mergeCovered(rows);
    var groups = {};
    rows.forEach(function (r) { (groups[r.slot.rank] = groups[r.slot.rank] || []).push(r); });
    var html = RANK_ORDER.filter(function (r) { return groups[r]; }).map(function (r) {
      var list = groups[r].sort(byCompany);
      if (phone) {
        // Phones: the same rank groups as a list, one row per person (company, name, position, tour, status).
        return '<details class="group" open><summary>' + esc(r) + ' <span class="n">' + list.length + '</span></summary><ul class="plist">' +
          list.map(function (x) {
            var name = nameCell(x);
            return "<li" + (x.off ? ' class="is-off"' : "") + '><span class="pl-co">' + esc(Organization.apparatus(x.co)) + '</span><span class="pl-main"><span class="pl-names">' + name + "</span>" +
              '<span class="pl-sub">' + esc(x.slot.title) + (x.role ? " · " + esc(x.role) : "") + " · T" + x.tour + "</span></span>" +
              '<span class="pl-tags">' + statusPill(x.status) + rowTags(x).join(" ") + "</span></li>";
          }).join("") + "</ul></details>";
      }
      return '<details class="group" open><summary>' + esc(r) + ' <span class="n">' + list.length + "</span></summary>" +
        '<div class="table-wrap"><table class="list"><thead><tr><th>Company</th><th>Name</th><th>Position</th><th>Tour</th><th></th></tr></thead><tbody>' +
        list.map(function (x) {
          var name = nameCell(x);
          var tags = rowTags(x);
          return "<tr" + (x.off ? ' class="is-off"' : "") + "><td class=\"co\">" + esc(x.co) + "</td><td>" + name + "</td><td>" + esc(x.slot.title) +
            (x.role ? " · " + esc(x.role) : "") + (x.slot.added ? "" : ' <span class="hint">' + esc(x.slot.pos) + "</span>") + '</td><td class="mono">' + x.tour + "</td><td>" +
            statusPill(x.status) + tags.join(" ") + "</td></tr>";
        }).join("") + "</tbody></table></div></details>";
    }).join("");
    $("date-results").innerHTML = html;
  }

  // One row per covered seat: the person working it, with the holder beside them struck through.
  function mergeCovered(rows) {
    var holders = new Map();
    rows.forEach(function (r) { if (!r.acting && r.coveredBy && r.name) holders.set(r.coveredBy, r); });
    var used = new Set();
    rows.forEach(function (r) {
      var h = r.acting && holders.get(r.acting);
      if (h && !used.has(h)) { r.held = h; used.add(h); }
    });
    // Someone covering the seat but off (e.g. on D) sits beside whoever is working it in their place.
    rows.forEach(function (r) {
      if (!r.acting || !r.off || used.has(r)) return;
      var w = rows.filter(function (x) { return x !== r && x.slot === r.slot && x.acting && !x.off && !x.held && !used.has(x); })[0];
      if (w) { w.held = r; used.add(r); }
    });
    return rows.filter(function (r) { return !used.has(r); });
  }
  function whoLink(name, who) {
    return who ? '<button class="linkish" data-pos="' + esc(who.pos) + '">' + esc(name) + "</button>" : esc(name);
  }
  function nameCell(x) {
    if (!x.name) return '<span class="vacant">Vacant</span>';
    var h = x.held;
    return whoLink(x.name, x.who) + (h ? ' <s class="held">' + whoLink(h.name, h.who) + "</s>" +
      (h.status ? " " + statusPill(h.status) : h.away ? ' <span class="hint">at ' + esc((byPos[h.away.targetPos] || {}).company || h.away.targetPos) + "</span>" : "") : "");
  }
  // Who a trade cover works for: the poster of the trade (they may be covering someone else's seat themselves).
  function tradePoster(c) {
    var t = (recs.trades || []).filter(function (x) { return x.id === c.tradeId; })[0];
    return t ? nameOf(t.posterKey) : null;
  }
  // Tags for a Projection row: acting / covering / shadowing (extra gets none), covered, swing, open for bid, added.
  function rowTags(x) {
    var tags = [];
    if (x.acting && x.kind !== "extra") {
      var k = KIND[x.kind] || KIND.cover;
      tags.push('<span class="tag tag-acting">' + (x.acting.tradeId ? "Trade for " + esc(tradePoster(x.acting) || x.slot.name || "vacant spot")
        : /^2027 (award|assignment)/.test(x.acting.note || "") ? "2027 move"
        : x.held ? k[0] : x.slot.name ? k[1] + " " + esc(x.slot.name) : k[0] + " · vacant spot") + "</span>");
    }
    if (x.away) tags.push('<span class="tag tag-away">' + kindWord(x.away, 2) + " " + esc((byPos[x.away.targetPos] || {}).company || x.away.targetPos) + "</span>");
    else if (x.coveredBy && x.name) tags.push('<span class="tag tag-away">Covered by ' + esc(x.coveredBy.coverName || nameOf(x.coveredBy.coverKey)) + "</span>");
    if (x.swingCover) tags.push('<span class="tag">Swing from ' + esc(x.slot.company) + "</span>");
    else if (x.slot.swingType && !x.acting) tags.push('<span class="tag">' + esc(x.slot.swingType) + "</span>");
    if (x.slot.open && !x.acting && !x.moved) tags.push('<span class="tag tag-open">Spot open for bid</span>');
    if (x.slot.added && !x.acting) tags.push('<span class="tag">Added</span>');
    if (x.moved && !x.acting) tags.push('<span class="tag tag-acting">' + (/^2027 (award|assignment)/.test(x.moved.note || "") ? "2027 seat" : "Moved here") + "</span>");
    return tags;
  }

  /* ---------- Crew: who's on your apparatus on your next shifts (members) ---------- */
  var RANK_SHORT = { "Battalion Chief": "BC", "Rescue Captain": "RC", Captain: "Capt", Lieutenant: "Lt", "FF/Paramedic": "FF/PM",
    Firefighter: "FF", "Marine Engineer": "ME" };
  function renderCrew() {
    var out = $("crew-detail");
    var me = byPos[myPos()];
    if (!me) {
      out.innerHTML = '<div class="empty">Link your account to your roster spot (Trades, This is me) to see your crew.</div>';
      return;
    }
    var shifts = [], d = today();
    for (var k = 0; k < 60 && shifts.length < 4; k++, d = addDays(d, 1)) {
      var s = day(me, d);
      if (s && !s.status) shifts.push({ d: d, co: s.co || home(me), k: k });
    }
    if (!shifts.length) { out.innerHTML = '<div class="empty">No shifts in the next 60 days.</div>'; return; }
    var i = Math.min(state.crewIdx, shifts.length - 1), cur = shifts[i];
    var co = Organization.apparatus(cur.co);
    var rows = mergeCovered(dayRows(cur.d)).filter(function (r) { return r.name && Organization.apparatus(r.co) === co; })
      .sort(function (a, b) { return RANK_ORDER.indexOf(a.slot.rank) - RANK_ORDER.indexOf(b.slot.rank) || (a.name || "").localeCompare(b.name || ""); });
    var on = rows.filter(function (r) { return !r.off; }).length;
    out.innerHTML =
      '<div class="crew-days" role="group" aria-label="Your next shifts">' + shifts.map(function (x, j) {
        return '<button type="button" class="btn small' + (j === i ? " primary" : "") + '" data-crew="' + j + '" aria-pressed="' + (j === i) + '">' +
          (x.k === 0 ? "Today" : x.k === 1 ? "Tomorrow" : esc(shortDate(x.d))) + "</button>";
      }).join("") + "</div>" +
      '<p class="hint crew-head">' + esc(co) + " on " + esc(longDate(cur.d)) + " · " + on + " on duty</p>" +
      '<div class="group"><ul class="plist">' + rows.map(function (x) {
        return "<li" + (x.off ? ' class="is-off"' : "") + '><span class="pl-co">' + esc(RANK_SHORT[x.slot.rank] || x.slot.rank) + "</span>" +
          '<span class="pl-main"><span class="pl-names">' + nameCell(x) + (x.who && x.who.pos === me.pos ? ' <span class="tag">You</span>' : "") + "</span>" +
          '<span class="pl-sub">' + esc(x.slot.title) + (x.role ? " · " + esc(x.role) : "") + " · T" + x.tour + "</span></span>" +
          '<span class="pl-tags">' + statusPill(x.status) + rowTags(x).join(" ") + "</span></li>";
      }).join("") + "</ul></div>";
    out.querySelectorAll("[data-crew]").forEach(function (b) {
      b.onclick = function () { state.crewIdx = +b.dataset.crew; renderCrew(); };
    });
  }

  /* ---------- Schedule: one person ---------- */
  var suggestIdx = -1;
  function matches(q) {
    var match = makeMatcher(q);
    if (!match) return [];
    q = q.trim().toLowerCase();
    var starts = [], rest = [];
    people.forEach(function (p) {
      if (!match({ name: p.name, title: p.title, co: p.company, tour: tourOn(p, today()), pos: p.pos, id: p.emplId })) return;
      (p.name.toLowerCase().indexOf(q) === 0 ? starts : rest).push(p);
    });
    return starts.concat(rest).slice(0, 40);
  }
  function showSuggest() {
    var list = matches($("person-input").value);
    var ul = $("person-list");
    suggestIdx = -1;
    if (!list.length) { ul.hidden = true; $("person-input").setAttribute("aria-expanded", "false"); return; }
    ul.innerHTML = list.map(function (p, i) {
      return '<li role="option" id="opt-' + i + '" data-pos="' + esc(p.pos) + '"><span class="who"><span>' + esc(p.name) +
        '</span><span class="meta">' + esc(p.title) + (tourOn(p, today()) ? " · T" + tourOn(p, today()) : "") +
        (p.emplId ? " · " + esc(p.emplId) : "") + "</span></span>" + briefHtml(p) + "</li>";
    }).join("");
    ul.hidden = false;
    $("person-input").setAttribute("aria-expanded", "true");
  }
  // Today at a glance for a search result: "On · E09", a leave code, or "Off" with the next shift.
  function briefHtml(p) {
    var t = today(), s = day(p, t);
    if (s && !s.status) return '<span class="brief on">On · ' + esc(s.co || home(p)) + "</span>";
    if (s && s.status) return '<span class="brief">' + statusPill(s.status) + "</span>";
    for (var k = 1; k <= 40; k++) {
      var d = addDays(t, k), s2 = day(p, d);
      if (s2 && !s2.status) {
        return '<span class="brief">Off<small>' + (k === 1 ? "tomorrow" : k < 7 ? "next " + DOW[d.getDay()] : MONTHS[d.getMonth()].slice(0, 3) + " " + d.getDate()) + "</small></span>";
      }
    }
    return '<span class="brief">Off</span>';
  }
  function moveSuggest(dir) {
    var items = $("person-list").querySelectorAll("li");
    if (!items.length) return;
    suggestIdx = (suggestIdx + dir + items.length) % items.length;
    items.forEach(function (li, i) { li.setAttribute("aria-selected", i === suggestIdx ? "true" : "false"); });
    items[suggestIdx].scrollIntoView({ block: "nearest" });
    $("person-input").setAttribute("aria-activedescendant", items[suggestIdx].id);
  }
  var pickedThisVisit = false;
  function choosePerson(pos) {
    var p = byPos[pos];
    if (!p) return;
    pickedThisVisit = true;
    state.personPos = pos;
    state.personMonth = new Date(state.date.getFullYear(), state.date.getMonth(), 1);
    $("person-input").value = p.name || "";
    $("person-list").hidden = true;
    $("person-input").setAttribute("aria-expanded", "false");
    store("person", pos);
    if (state.view !== "person") setView("person"); else renderPerson();
  }

  /* ---------- List sheet: the people or seats behind a count (Stats summary) ----------
     spec: {title, people: [{p, detail, note}]} grouped by rank, or {title, seats: [{p, detail}]} grouped by battalion. */
  var listSpec = null;
  function showList(spec) {
    listSpec = spec;
    $("list-q").value = "";
    drawList();
    $("list-sheet").hidden = false;
    $("list-q").focus();
  }
  function drawList() {
    var spec = listSpec, match = makeMatcher($("list-q").value.trim());
    var rows = (spec.people || spec.seats).filter(function (r) {
      return !match || match({ name: r.p.name || "", title: r.p.title || "", co: home(r.p), tour: tourOn(r.p, state.dashDate), pos: r.p.pos, id: r.p.emplId });
    });
    var total = (spec.people || spec.seats).length;
    $("list-title").textContent = spec.title + " · " + total;
    var groups = {}, order = [];
    rows.forEach(function (r) {
      var g;
      if (spec.people) g = r.p.rank || "Other";
      else { var o = Organization.locate(r.p.company); g = o ? o.division.name + " · " + o.battalion.name : "Other"; }
      if (!groups[g]) { groups[g] = []; order.push(g); }
      groups[g].push(r);
    });
    if (spec.people) order.sort(function (a, b) { return (RANK_ORDER.indexOf(a) + 99) % 99 - (RANK_ORDER.indexOf(b) + 99) % 99; });
    else order.sort(function (a, b) { return Organization.order(groups[a][0].p.company) - Organization.order(groups[b][0].p.company); });
    $("list-body").innerHTML = (rows.length < total ? '<p class="hint">' + rows.length + " of " + total + " match.</p>" : "") +
      (rows.length ? order.map(function (g) {
        var list = groups[g].sort(function (a, b) { return coKey(home(a.p)).localeCompare(coKey(home(b.p))) || String(a.p.name).localeCompare(String(b.p.name)); });
        return '<details class="group" open><summary>' + esc(g) + ' <span class="n">' + list.length + '</span></summary><ul class="tlist plain list-rows">' +
          list.map(function (r) {
            var t = tourOn(r.p, state.dashDate);
            var who = spec.people
              ? (byPos[r.p.pos] ? '<button class="linkish" data-list-pos="' + esc(r.p.pos) + '">' + esc(r.p.name) + "</button>" : esc(r.p.name))
              : '<b class="mono">' + esc(r.p.pos) + "</b>" + (r.p.name ? ' <button class="linkish" data-list-pos="' + esc(r.p.pos) + '">' + esc(r.p.name) + "</button>" : "");
            return "<li>" + who + ' <span class="hint">' + esc(r.p.title || "") + (spec.people && !r.p.added ? " · " + esc(r.p.pos) : "") + (t ? " · T" + t : "") + "</span>" +
              (r.detail ? "<div>" + esc(r.detail) + "</div>" : "") + (r.note ? '<div class="hint">' + esc(r.note) + "</div>" : "") + "</li>";
          }).join("") + "</ul></details>";
      }).join("") : '<p class="hint">Nothing matches.</p>');
  }
  function wireList() {
    $("list-q").oninput = drawList;
    $("list-sheet").addEventListener("click", function (e) {
      if (e.target.closest("[data-close]")) { $("list-sheet").hidden = true; return; }
      var b = e.target.closest("[data-list-pos]");
      if (b) { $("list-sheet").hidden = true; choosePerson(b.dataset.listPos); }
    });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") $("list-sheet").hidden = true; });
  }

  function renderPerson() {
    var p = byPos[state.personPos];
    var out = $("person-detail");
    if (!p) {
      out.innerHTML = '<div class="empty">Type a last name, a company (E10) or a position number above to see that person\'s tour, their work days for any month, and their next shifts. ' +
        people.length + " people are listed across " + data.length + " positions. You can also click any name on the Projection tab.</div>";
      return;
    }
    var m = state.personMonth;
    var first = new Date(m.getFullYear(), m.getMonth(), 1);
    var days = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate();
    var t = today();
    var cells = DOW.map(function (d) { return '<div class="dow">' + d.slice(0, 2) + "</div>"; }).join("");
    for (var b = 0; b < first.getDay(); b++) cells += '<div class="d blank"></div>';
    var workCount = 0, offCount = 0, actingCount = 0, monthHolidays = [];
    var tappable = Trades.canTradeFor(p.pos) || !!(backend && backend.canEdit());
    for (var i = 1; i <= days; i++) {
      var d = new Date(m.getFullYear(), m.getMonth(), i);
      var s = day(p, d);
      // On their own tour days while covering elsewhere, show "Away".
      var own = ownSeatOn(p, d), awayDay = !s && own && M.actingOn(p.pos, d, recs.covers) && shift(own, d);
      if (s) { if (s.status) offCount++; else if (s.acting) actingCount++; else workCount++; }
      var cover = s && !s.acting && s.swing && s.co !== p.company;
      var label = s && s.status ? s.status : s && (s.acting || s.swing) ? s.co : awayDay ? "Away" : "W" + M.watchFor(d);
      var cls = s ? (s.status ? " off st-" + s.status : s.acting ? " work acting" : " work") : awayDay ? " away" : "";
      var tip = s ? (s.status ? STATUS_LABEL[s.status] : (s.acting ? "acting at " : "working at ") + (s.co || home(p))) : awayDay ? "away, covering another position" : "off";
      var hol = M.holidayFor(d);
      if (hol) monthHolidays.push({ d: d, h: hol });
      cells += '<div class="d' + (tappable ? " tap" : "") + cls + (cover && !s.status ? " cover" : "") + (sameDay(d, t) ? " today" : "") + '"' +
        (tappable ? ' data-day="' + iso(d) + '" role="button" tabindex="0"' : "") + ' title="' + esc(longDate(d) + " · watch " + M.watchFor(d) + " · " + tip + (hol ? " · " + hol.name : "")) + '">' +
        '<span class="dn">' + i + (hol ? holidayDot(hol) : "") + '</span><span class="w">' + esc(label) + "</span></div>";
    }

    var next = [], d2 = t;
    for (var k = 0; k < 120 && next.length < 9; k++, d2 = addDays(d2, 1)) {
      var s2 = day(p, d2);
      if (s2) next.push({ d: d2, s: s2, k: k });
    }

    var tourNow = tourOn(p, t);
    var upcoming = recs.tourChanges.filter(function (c) { return c.pos === p.pos && c.effective > iso(t); })
      .sort(function (a, b) { return a.effective.localeCompare(b.effective); })[0];
    var statusNow = M.statusFor(p.pos, t, recs.statuses);
    var actingNow = M.actingOn(p.pos, t, recs.covers) || recs.covers.filter(function (c) { return c.coverKey === p.pos && !M.isMove(c) && c.start > iso(t); })
      .sort(function (a, b) { return a.start.localeCompare(b.start); })[0];
    // A move to a new owned seat (2027 award or assignment), current or coming up.
    var moveNext = recs.covers.filter(function (c) { return c.coverKey === p.pos && M.isMove(c) && (!c.end || c.end >= iso(t)); })
      .sort(function (a, b) { return b.start.localeCompare(a.start); })[0];
    var coveredNow = p.added ? null : coverOf(p.pos, t);

    out.innerHTML =
      '<div class="person">' +
      '<div class="card ident"><h2>' + esc(p.name) + "</h2>" +
      identTiles(p, tourNow, next) +
      kv("Rank", p.rank) +
      kv("Employee ID", p.emplId || "Not on file", "kv-id") +
      (p.added && !p.tour
        ? kv("Roster", "Added, not on the vacancy list")
        : (p.added ? kv("Roster", "Added, not on the vacancy list") + kv("Apparatus", p.company) : kv("Position", p.title) + kv("Position no.", p.pos)) +
          '<div class="kv kv-tour"><span class="k">Tour</span><span class="v big">' + tourNow + "</span></div>" +
          (upcoming ? kv("Tour change", "→ " + upcoming.tour + " from " + shortDate(fromIso(upcoming.effective))) : "") +
          kv("Works watches", watchesFor(tourNow).join(" "))) +
      (p.open ? '<div class="kv"><span class="k">Bid</span><span class="v"><span class="tag tag-open">Spot open for bid</span></span></div>' : "") +
      (actingNow ? kv(actingNow.start > iso(t) ? "Will cover" : kindWord(actingNow), slotLabel(actingNow.targetPos) + " · " + rangeText(actingNow)) : "") +
      (moveNext ? kv(moveNext.start > iso(t) ? "Own seat from " + shortDate(fromIso(moveNext.start)) : "Own seat", (byPos[moveNext.targetPos] || {}).title + " " + moveNext.targetPos +
        (actingNow && (!actingNow.end || actingNow.end >= moveNext.start) ? " · the cover above continues until it's ended" : "")) : "") +
      (coveredNow ? kv("Covered by", (coveredNow.coverName || nameOf(coveredNow.coverKey)) + " · " + kindWord(coveredNow).toLowerCase() + " · " + rangeText(coveredNow)) : "") +
      (p.added && !p.tour && !actingNow ? kv("Assignment", "None. Use Cover another position below.") : "") +
      (statusNow ? '<div class="kv"><span class="k">Today</span><span class="v">' + statusPill(statusNow) + " " + esc(STATUS_LABEL[statusNow]) + "</span></div>" : "") +
      twinsHtml(p) + contactHtml(p) + Trades.personExtras(p) + Fix.link(p) +
      (isCardAdmin() ? '<div class="kv"><span class="v"><button type="button" class="btn small" id="open-card">Employee card</button> <span class="hint">admins only</span></span></div>' : "") + "</div>" +
      '<div class="card"><div class="cal-head"><button class="btn icon" id="pm-prev" aria-label="Previous month">&lsaquo;</button>' +
      '<span class="month-label">' + MONTHS[m.getMonth()] + " " + m.getFullYear() + '</span><button class="btn icon" id="pm-next" aria-label="Next month">&rsaquo;</button></div>' +
      '<div class="cal">' + cells + "</div>" + holidayList(monthHolidays) +
      '<div class="legend"><span><i style="background:var(--accent)"></i>Work day (' + workCount + ")</span>" +
      (monthHolidays.length ? '<span><i class="sw-hol"></i>Holiday</span>' : "") +
      (actingCount ? '<span><i class="sw-acting"></i>Acting / covering (' + actingCount + ")</span>" : "") +
      (offCount ? '<span><i class="sw-off"></i>Off: VA / S / D / WE / TR (' + offCount + ")</span>" : "") +
      (p.swing ? '<span><i style="background:var(--swing)"></i>Covering another company</span>' : "") +
      '<span><i style="box-shadow:inset 0 0 0 2px var(--today)"></i>Today</span><span>W = watch number</span></div></div>' +
      '<div class="side">' +
      foldOpen("next", '<details class="card fold" data-fold="next"', ">") + '<summary><h3>Next shifts</h3><span class="fold-sum">' +
      esc(next.slice(0, 3).map(function (n) { return n.k === 0 ? "Today" : DOW[n.d.getDay()] + " " + n.d.getDate(); }).join(" · ")) + "</span></summary>" +
      (next.length ? "" : '<p class="hint">No shifts in the next 120 days.</p>') + '<ol class="shifts">' +
      next.map(function (n) {
        return "<li" + (tappable ? ' class="tap" data-day="' + iso(n.d) + '"' : "") + '><span class="when">' + esc(shortDate(n.d)) + (n.s.status ? "" : Trades.tradeLink(p, n.d)) +
          '</span><span class="rel">' + (n.k === 0 ? "Today" : n.k === 1 ? "Tomorrow" : "in " + n.k + " days") +
          " · W" + n.s.watch + '</span><span class="where">' + (n.s.status ? statusPill(n.s.status) : (n.s.acting ? kindWord(n.s.acting) + " · " : "") + esc(n.s.co || home(p)) + (n.s.role ? " " + esc(n.s.role) : "")) + "</span></li>";
      }).join("") + "</ol></details>" +
      movesCard(p) + historyCard(p, datesCard(p)) + "</div></div>";

    $("pm-prev").onclick = function () { state.personMonth = new Date(m.getFullYear(), m.getMonth() - 1, 1); renderPerson(); };
    $("pm-next").onclick = function () { state.personMonth = new Date(m.getFullYear(), m.getMonth() + 1, 1); renderPerson(); };
    wireEditForms(p);
    if ($("open-card")) $("open-card").onclick = function () { Card.open(p.pos); };
    Fix.wireLinks($("person-detail"));
    Fix.prefill(p);
    wireDates(p);
    // Tapping a calendar day or an upcoming shift opens that day's options (trade, leave, who's working).
    out.querySelectorAll("[data-day]").forEach(function (el) {
      var open = function (e) { if (!e.target.closest("[data-trade-day], .tag")) openDay(p, el.dataset.day, el); };
      el.addEventListener("click", open);
      el.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(e); } });
    });
    out.querySelectorAll("details[data-fold]").forEach(function (el) {
      el.addEventListener("toggle", function () { state.folds[el.dataset.fold] = el.open; });
    });
  }
  /* ---------- One day's options (from the calendar or Next shifts) ----------
     Trade the shift (your own page) or mark one day VA or S (editors; D and WE stay in the Edit forms).
     Days are only tappable for someone who can do one of those. */
  var dayOpener = null;
  function openDay(p, dIso, opener) {
    var d = fromIso(dIso), s = day(p, d), t = iso(today());
    var trade = Trades.tradeFor(p.pos, dIso);
    var cov = !p.added || p.tour ? coverOf(p.pos, d) : null;
    var line = s && s.status ? statusPill(s.status) + " " + esc(STATUS_LABEL[s.status]) +
        (cov && s.status === "TR" ? " · " + esc(cov.coverName || nameOf(cov.coverKey)) + " works it" : "")
      : s ? (s.acting ? "Acting at " : "Working at ") + esc(s.co || home(p)) + (s.role ? " " + esc(s.role) : "") + " · Tour " + s.tour
      : ownSeatOn(p, d) && M.actingOn(p.pos, d, recs.covers) && shift(ownSeatOn(p, d), d) ? "Away, covering another position" : "Off";
    var acts = [];
    if (s && !s.status && dIso >= t && Trades.canTradeFor(p.pos)) {
      acts.push(trade ? '<button type="button" data-day-act="trades">' + (trade.status === "set" ? "Traded" : "Trade posted") + '<span class="hint">See it on the Trades tab</span></button>'
        : '<button type="button" data-day-act="trade">Trade this shift' + (Trades.forSomeone(p.pos) ? " for " + esc(p.name) : "") + '<span class="hint">Send it to people who are off, or post it to the board</span></button>');
    }
    var leave = "";
    if (s && !s.status && backend && backend.canEdit()) {
      leave = ('<div class="day-leave"><span class="k">Mark this day</span><div class="seg">' + ["VA", "S"].map(function (c) {
        return '<button type="button" class="btn small" data-day-leave="' + c + '" title="' + esc(STATUS_LABEL[c]) + '">' + c + "</button>";
      }).join("") + '</div><span class="msg" id="day-msg" role="status"></span></div>');
    }
    if (!acts.length && !leave) return; // nothing to do on this day
    var hol = M.holidayFor(d);
    $("day-title").textContent = shortDate(d);
    $("day-body").innerHTML = '<p class="day-line">' + esc(p.name) + " · Watch " + M.watchFor(d) + (hol ? " · " + esc(hol.name) : "") + "<br>" + line + "</p>" +
      (acts.length ? '<div class="sheet-list day-acts">' + acts.join("") + "</div>" : "") + leave;
    dayOpener = opener || document.activeElement;
    $("day-sheet").hidden = false;
    $("day-sheet").querySelector(".sheet-x").focus();
    $("day-body").querySelectorAll("[data-day-act]").forEach(function (b) {
      b.onclick = function () {
        var a = b.dataset.dayAct;
        closeDay();
        if (a === "trade") Trades.openWizard(p.pos, dIso);
        else setView("trades");
      };
    });
    $("day-body").querySelectorAll("[data-day-leave]").forEach(function (b) {
      b.onclick = function () {
        var code = b.dataset.dayLeave;
        say($("day-msg"), "Saving…");
        backend.addStatus({ pos: p.pos, name: p.name, code: code, start: dIso, end: dIso, note: "" })
          .then(function () { closeDay(); renderAll(true); }, function (er) { say($("day-msg"), er.message, true); });
      };
    });
  }
  function closeDay() {
    if ($("day-sheet").hidden) return;
    $("day-sheet").hidden = true;
    if (dayOpener && dayOpener.focus && document.contains(dayOpener)) dayOpener.focus();
  }

  /* Folded sections on the person page: next shifts and history start open on wide screens and closed on phones
     (except your own Next shifts when you can trade);
     the editing forms start closed everywhere. A section someone opens or closes stays that way. */
  // Position moves from assignment-change notices (the `assignments` log), newest first, as a closed fold.
  function movesCard(p) {
    var list = (recs.assignments || []).filter(function (a) { return a.key === p.pos || (p.emplId && a.emplId === p.emplId); })
      .sort(function (a, b) { return String(b.firstReg).localeCompare(String(a.firstReg)); });
    if (!list.length) return "";
    function d(s) { return s ? shortDate(fromIso(s)) + " " + s.slice(0, 4) : "?"; }
    function seat(pos, st, tour) { return esc(pos) + (st ? " " + esc(st) : "") + (tour ? " (Tour " + tour + ")" : ""); }
    return foldOpen("moves", '<details class="card fold" data-fold="moves"', ">") + "<summary><h3>Moves</h3>" +
      '<span class="fold-sum">' + list.length + (list.length === 1 ? " move" : " moves") + " · latest " + esc(d(list[0].firstReg)) + "</span></summary>" +
      '<ul class="hist moves">' + list.map(function (a) {
        return "<li><div><b>" + esc(d(a.firstReg)) + "</b> · " + seat(a.fromPos, a.fromStation) + " → " + seat(a.toPos, a.toStation, a.toTour) +
          '<div class="hint">' + (a.lastReg ? "Last shift there " + esc(d(a.lastReg)) + " · " : "") + esc(a.rankFrom || "") +
          (a.rankTo && a.rankTo !== a.rankFrom ? " → " + esc(a.rankTo) : "") + "</div>" +
          '<div class="hint">' + esc(a.source || "") + (a.note ? " · " + esc(a.note) : "") + "</div></div></li>";
      }).join("") + "</ul></details>";
  }
  function foldOpen(key, head, tail) {
    var open = state.folds[key];
    // On phones, your own Next shifts start open when you can trade, so the Trade links show.
    if (open == null) open = key === "edit" || key === "moves" ? false : !isPhone() || (key === "next" && Trades.canTradeFor(state.personPos));
    return head + (open ? " open" : "") + tail;
  }
  // Holiday marker (a dot) and the month's holidays listed under a calendar.
  function holidayDot(h) {
    return '<i class="hol' + (h.kind === "observance" ? " obs" : "") + '" title="' + esc(h.name) + '" aria-label="' + esc(h.name) + '"></i>';
  }
  function holidayList(list) {
    if (!list.length) return "";
    return '<p class="hol-list">' + list.map(function (x) {
      return holidayDot(x.h) + "<b>" + MONTHS[x.d.getMonth()].slice(0, 3) + " " + x.d.getDate() + "</b> " + esc(x.h.name);
    }).join('<span class="sep"> · </span>') + "</p>";
  }
  // "Holiday: Thanksgiving Day" for a date line, or "".
  function holidayNote(d) {
    var h = M.holidayFor(d);
    return h ? '<span class="hol-note">' + holidayDot(h) + esc(h.name) + "</span>" : "";
  }
  // Phone-only summary tiles at the top of a person's page.
  function identTiles(p, tourNow, next) {
    var n = next.filter(function (x) { return !x.s.status; })[0];
    var cov = !tourNow && coveringBy(p.pos, today());
    if (cov && byPos[cov.targetPos]) tourNow = tourOn(byPos[cov.targetPos], today()); // covering: the covered seat's tour
    var when = !n ? "None soon" : n.k === 0 ? "Today" : n.k === 1 ? "Tomorrow" : shortDate(n.d);
    return '<div class="tiles">' +
      '<div class="tile"><span class="k">Tour</span><span class="v big">' + (tourNow || "—") + "</span></div>" +
      '<div class="tile"><span class="k">Next shift</span><span class="v">' + esc(when) + "</span></div>" +
      '<div class="tile"><span class="k">Empl ID</span><span class="v mono">' + esc(p.emplId || "—") + "</span></div></div>";
  }

  /* ---------- Birth and hire dates (admins) ---------- */
  var profilesCache = null, profilesLoading = false;
  function datesCard(p) {
    if (!backend || !backend.canAdmin()) return "";
    if (!profilesCache) {
      if (!profilesLoading) {
        profilesLoading = true;
        backend.profiles().then(function (list) {
          profilesCache = {};
          list.forEach(function (x) { profilesCache[x.key] = x; });
          profilesLoading = false;
          if (state.view === "person") renderAll();
        }, function () { profilesLoading = false; profilesCache = {}; });
      }
      return '<div class="card"><h3>Personal dates</h3><p class="hint">Loading…</p></div>';
    }
    var pf = profilesCache[p.pos] || {};
    return '<form class="card edit dates" id="pd-form" novalidate><h3>Personal dates</h3>' +
      '<p class="hint">Admins only. Used for the dashboard\'s average age and years of service.</p>' +
      '<div class="row"><label>Birth date<input type="date" id="pd-birth" value="' + esc(pf.birthDate || "") + '"></label>' +
      '<label>Hire date<input type="date" id="pd-hire" value="' + esc(pf.hireDate || "") + '"></label></div>' +
      '<div class="row"><button class="btn primary" type="submit">Save dates</button><span class="msg" id="pd-msg" role="status"></span></div></form>';
  }
  function wireDates(p) {
    var f = $("pd-form");
    if (!f) return;
    f.onsubmit = function (e) {
      e.preventDefault();
      var bd = $("pd-birth").value || null, hd = $("pd-hire").value || null;
      if (bd && hd && hd <= bd) return say($("pd-msg"), "The hire date must be after the birth date.", true);
      say($("pd-msg"), "Saving…");
      backend.setProfile(p.pos, { birthDate: bd, hireDate: hd }).then(function () {
        profilesCache[p.pos] = { key: p.pos, birthDate: bd, hireDate: hd };
        say($("pd-msg"), "Saved.");
      }, function (er) { say($("pd-msg"), er.message, true); });
    };
  }

  /* ---------- Status & tour history, editor forms ---------- */
  function historyCard(p, extra) {
    var canEdit = backend && backend.canEdit();
    var items = recs.statuses.filter(function (s) { return s.pos === p.pos; }).map(function (s) {
      return { kind: "statuses", id: s.id, trade: !!s.tradeId, sort: s.start, html: statusPill(s.code) + " <b>" + esc(STATUS_LABEL[s.code]) + "</b> " +
        esc(shortDate(fromIso(s.start))) + (s.end ? (s.end !== s.start ? " – " + esc(shortDate(fromIso(s.end))) : "") : " onward") +
        (s.end && s.end.slice(0, 4) !== s.start.slice(0, 4) ? " " + s.end.slice(0, 4) : ""), note: s.note };
    }).concat(recs.tourChanges.filter(function (c) { return c.pos === p.pos; }).map(function (c) {
      return { kind: "tourChanges", id: c.id, sort: c.effective, html: '<span class="st st-T">T</span> <b>Tour ' + esc(c.tour) + "</b> from " +
        esc(shortDate(fromIso(c.effective))) + " " + esc(c.effective.slice(0, 4)), note: c.note };
    })).concat(recs.covers.filter(function (c) { return c.coverKey === p.pos || c.targetPos === p.pos; }).map(function (c) {
      var mine = c.coverKey === p.pos;
      return { kind: "covers", id: c.id, trade: !!c.tradeId, sort: c.start, openEnded: !c.end && c.start <= iso(today()),
        html: '<span class="st st-A">' + (mine ? "AC" : "CV") + "</span> <b>" + (mine ? kindWord(c) + " " + esc(slotLabel(c.targetPos))
          : esc(c.coverName || nameOf(c.coverKey)) + " · " + kindWord(c).toLowerCase()) + "</b> " + esc(rangeText(c)), note: c.note };
    })).sort(function (a, b) { return b.sort.localeCompare(a.sort); });

    var list = items.length ? '<ul class="hist">' + items.map(function (it) {
      return '<li><div>' + it.html + (it.note ? '<div class="hint">' + esc(it.note) + "</div>" : "") + "</div>" +
        (canEdit && !it.trade ? '<div class="acts">' + (it.openEnded ? '<button class="btn small" data-end="' + esc(it.id) + '">End today</button>' : "") +
          '<button class="btn small" data-remove="' + esc(it.kind) + '" data-id="' + esc(it.id) + '">Remove</button></div>' : "") + "</li>";
    }).join("") + "</ul>" : '<p class="hint">No tour changes, leave or cover assignments recorded.</p>';

    var forms = !canEdit ? editHint() : statusForm(p) + coverForm(p) + (p.added ? "" : tourForm(p)) +
      (p.added ? '<div class="row danger-zone"><button class="btn small" data-remove="people" data-id="' + esc(p.pos.slice(7)) + '">Remove this person</button></div>' : "");

    return foldOpen("hist", '<details class="card fold" data-fold="hist"', ">") + "<summary><h3>Covers, leave &amp; history</h3>" +
      '<span class="fold-sum">' + (items.length ? items.length + (items.length === 1 ? " record" : " records") : "None") + "</span></summary>" + list + "</details>" +
      (canEdit
        ? foldOpen("edit", '<details class="card fold edit-fold" data-fold="edit"', ">") + "<summary><h3>Edit</h3>" +
          '<span class="fold-sum">leave · cover' + (p.added ? "" : " · tour") + "</span></summary>" + forms + (extra || "") + "</details>"
        : '<div class="card edit-hint-card">' + forms + "</div>");
  }
  function tourOptions(sel) {
    var o = "";
    for (var i = 1; i <= 31; i++) o += '<option value="' + i + '"' + (i === sel ? " selected" : "") + ">Tour " + i + "</option>";
    return o;
  }
  function editHint() {
    if (!backend || backend.mode === "none") return '<p class="hint">Editing needs the shared page or the schedule server. See the README.</p>';
    return '<p class="hint">Only editors can record leave, tour changes or cover assignments.</p>';
  }
  function wireEditForms(p) {
    document.querySelectorAll("#person-detail [data-remove]").forEach(function (b) {
      b.onclick = function () {
        if (b.dataset.confirm !== "1") { b.dataset.confirm = "1"; b.textContent = "Confirm remove"; b.classList.add("danger"); return; }
        b.disabled = true;
        backend.remove(b.dataset.remove, b.dataset.id).then(function () {
          if (b.dataset.remove === "people") { state.personPos = null; $("person-input").value = ""; }
          renderAll(true);
        }, function (e) { b.disabled = false; b.textContent = e.message; });
      };
    });
    document.querySelectorAll("#person-detail [data-end]").forEach(function (b) {
      b.onclick = function () {
        b.disabled = true;
        backend.endCover(b.dataset.end, iso(today())).then(function () { renderAll(true); }, function (e) { b.disabled = false; b.textContent = e.message; });
      };
    });
    wireForms(p, "f", null, function () { Fix.saved(); });
  }

  /* ---------- Edit forms: status, cover, tour ----------
     Shared by the person page (prefix "f": #f-status, #fs-code, #fc-target, #ft-tour …) and the employee card (other
     prefixes). With rec the form edits that record (backend.update); without, it adds a new one. */
  function slotOption(p) { return (p.name || "Vacant") + " · " + p.title + " · Tour " + p.tour + " (" + p.pos + ")"; }
  function selectHtml(id, opts, sel) {
    return '<select id="' + id + '">' + opts.map(function (o) {
      return '<option value="' + esc(o[0]) + '"' + (String(o[0]) === String(sel == null ? "" : sel) ? " selected" : "") + ">" + esc(o[1]) + "</option>";
    }).join("") + "</select>";
  }
  function datesHtml(x, r, openDefault) {
    var t = iso(today()), open = r.id ? !r.end : openDefault;
    return '<div class="row"><label>From<input type="date" id="' + x + 'start" value="' + esc(r.start || t) + '" required></label>' +
      '<label>To<input type="date" id="' + x + 'end" value="' + esc(r.end || (open ? "" : t)) + '"' + (open ? " disabled" : "") + "></label></div>" +
      '<label class="chk"><input type="checkbox" id="' + x + 'open"' + (open ? " checked" : "") + "> No end date yet</label>";
  }
  function formEnd(pre, x, rec, label) {
    return '<div class="row"><button class="btn primary" type="submit">' + (rec ? "Save changes" : label) + "</button>" +
      (rec ? ' <button class="btn" type="button" data-form-cancel>Cancel</button>' : "") +
      '<span class="msg" id="' + x + 'msg" role="status"></span></div></form>';
  }
  function statusForm(p, rec, pre) {
    pre = pre || "f";
    var x = pre + "s-", r = rec || {};
    return '<form class="edit" id="' + pre + '-status" novalidate><h4>' + (rec ? "Edit status" : "Add status") + "</h4>" +
      '<div class="row"><label>Type' + selectHtml(x + "code", [["VA", "VA · Vacation"], ["S", "S · Sick"], ["D", "D · Disabled"], ["WE", "WE · Working elsewhere"]], r.code) + "</label></div>" +
      datesHtml(x, r, false) +
      '<label>Note<input type="text" id="' + x + 'note" maxlength="500" placeholder="Optional" value="' + esc(r.note || "") + '"></label>' +
      formEnd(pre, x, rec, "Save status");
  }
  // opt.move: show the "own seat" checkbox (employee card); opt.moveOnly: a move form.
  function coverForm(p, rec, pre, opt) {
    pre = pre || "f"; opt = opt || {};
    var x = pre + "c-", r = rec || {}, target = r.targetPos && byPos[r.targetPos] ? slotOption(byPos[r.targetPos]) : "";
    var isMv = rec ? M.isMove(rec) : !!opt.moveOnly;
    return '<form class="edit" id="' + pre + '-cover" novalidate><h4>' + (rec ? (isMv ? "Edit move" : "Edit cover") : opt.moveOnly ? "Move to a new own seat" : "Cover another position") + "</h4>" +
      (rec ? "" : opt.moveOnly ? '<p class="hint">From this date the seat is ' + esc(p.name) + "'s own; their old seat is vacant unless someone moves in.</p>"
        : '<p class="hint">While covering, ' + esc(p.name) + " works that position's tour and company instead of " + (p.added && !p.tour ? "nothing" : "their own") + ".</p>") +
      '<label>' + (isMv ? "New seat" : "Position to cover") + '<input type="text" id="' + x + 'target" list="slot-dl" placeholder="Name, company or position number" autocomplete="off" value="' + esc(target) + '"></label>' +
      (isMv ? "" : '<label>Type' + selectHtml(x + "kind", [["", "Covering or acting (by rank)"], ["cover", "Covering · same rank, in someone's spot"],
        ["acting", "Acting · temporarily promoted to the seat's rank"], ["shadow", "Shadowing · day-to-day LWLP (usually VR)"],
        ["extra", "Also in this seat · same tour, alongside the holder (e.g. two captains)"]], r.kind || "") + "</label>") +
      datesHtml(x, r, true) +
      (opt.move && !opt.moveOnly ? '<label class="chk"><input type="checkbox" id="' + x + 'move"' + (isMv ? " checked" : "") + "> Move · this becomes their own seat</label>"
        : '<input type="hidden" id="' + x + 'move" value="' + (isMv ? "1" : "") + '">') +
      '<label>Note<input type="text" id="' + x + 'note" maxlength="500" placeholder="Optional, e.g. Weddle injured" value="' + esc(r.note || "") + '"></label>' +
      formEnd(pre, x, rec, isMv ? "Save move" : "Save cover");
  }
  function tourForm(p, rec, pre) {
    pre = pre || "f";
    var x = pre + "t-", r = rec || {};
    return '<form class="edit" id="' + pre + '-tour" novalidate><h4>' + (rec ? "Edit tour change" : "Change tour") + "</h4>" +
      '<div class="row"><label>New tour<select id="' + x + 'tour">' + tourOptions(rec ? r.tour : tourOn(p, today())) + "</select></label>" +
      '<label>Effective<input type="date" id="' + x + 'eff" value="' + esc(r.effective || iso(today())) + '" required></label></div>' +
      '<label>Note<input type="text" id="' + x + 'note" maxlength="500" placeholder="Optional, e.g. bid result" value="' + esc(r.note || "") + '"></label>' +
      formEnd(pre, x, rec, "Save tour change");
  }
  /* Wire whichever of the three forms with this prefix are on the page. after() runs once a save lands; onCancel for the
     Cancel button on an edit form. */
  function wireForms(p, pre, rec, after, onCancel) {
    var fs = $(pre + "-status"), fc = $(pre + "-cover"), ft = $(pre + "-tour");
    function done(x) {
      return function () { if (after) after(); renderAll(true); say($(x + "msg"), "Saved."); };
    }
    function save(kind, add, patch, x) {
      var msg = $(x + "msg");
      say(msg, "Saving…");
      var p2 = rec ? backend.update(kind, rec.id, patch) : add(Object.assign({}, patch));
      return p2.then(done(x), function (err) { say(msg, err.message, true); });
    }
    [fs, fc, ft].forEach(function (f) {
      var c = f && f.querySelector("[data-form-cancel]");
      if (c) c.onclick = function () { if (onCancel) onCancel(); };
    });
    function openToggle(x) {
      var o = $(x + "open");
      if (o) o.onchange = function () { $(x + "end").disabled = this.checked; if (!this.checked && !$(x + "end").value) $(x + "end").value = $(x + "start").value; };
    }
    function range(x) {
      var start = $(x + "start").value, end = $(x + "open").checked ? null : $(x + "end").value || null;
      if (!start) return say($(x + "msg"), "Pick a start date.", true), null;
      if (end && end < start) return say($(x + "msg"), "The end date is before the start date.", true), null;
      return { start: start, end: end };
    }
    if (fc) {
      var xc = pre + "c-";
      openToggle(xc);
      fc.onsubmit = function (e) {
        e.preventDefault();
        var msg = $(xc + "msg"), target = slotFromInput($(xc + "target").value), mv = $(xc + "move");
        var isMv = mv.type === "checkbox" ? mv.checked : !!mv.value;
        if (!target) return say(msg, "Pick the position from the list.", true);
        if (target === p.pos) return say(msg, "Someone can't cover their own position.", true);
        var rg = range(xc);
        if (!rg) return;
        var rec2 = { targetPos: target, start: rg.start, end: rg.end, note: $(xc + "note").value.trim(), kind: $(xc + "kind") ? $(xc + "kind").value || null : null };
        if (isMv) rec2.move = true; else if (rec && rec.move) rec2.move = false;
        if (!rec) { rec2.coverKey = p.pos; rec2.coverName = p.name; }
        save("covers", backend.addCover, rec2, xc);
      };
    }
    if (fs) {
      var xs = pre + "s-";
      openToggle(xs);
      fs.onsubmit = function (e) {
        e.preventDefault();
        var rg = range(xs);
        if (!rg) return;
        var rec2 = { code: $(xs + "code").value, start: rg.start, end: rg.end, note: $(xs + "note").value.trim() };
        if (!rec) { rec2.pos = p.pos; rec2.name = p.name; }
        save("statuses", backend.addStatus, rec2, xs);
      };
    }
    if (ft) {
      var xt = pre + "t-";
      ft.onsubmit = function (e) {
        e.preventDefault();
        var eff = $(xt + "eff").value, tour = +$(xt + "tour").value, msg = $(xt + "msg");
        if (!eff) return say(msg, "Pick an effective date.", true);
        if (!rec && tour === tourOn(p, fromIso(eff))) return say(msg, "They are already on Tour " + tour + " on that date.", true);
        var rec2 = { tour: tour, effective: eff, note: $(xt + "note").value.trim() };
        if (!rec) { rec2.pos = p.pos; rec2.name = p.name; }
        save("tourChanges", backend.addTourChange, rec2, xt);
      };
    }
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
    [[c.staffList ? "" : "Mobile", c.phoneMobile], ["Other", c.phoneOther]].forEach(function (ph) {
      if (ph[1] && M.normCell(ph[1])) ph[1] = M.showCell(ph[1]); // shown as (415) 555-0100
      if (ph[1]) bits.push(esc(ph[0]) + ' <a href="tel:' + esc(ph[1].replace(/[^0-9+x]/gi, "")) + '">' + esc(ph[1]) + '</a> <button class="btn tiny" data-copy="' + esc(ph[1]) + '">Copy</button>');
    });
    return '<div class="kv contact-kv"><span class="k">' + (c.staffList ? "Cell · staff list, admins only" : "Contact for swaps" + (c.shared ? "" : " · not shared, admins only")) + '</span><span class="v contact-v">' +
      bits.join('<span class="sep"> · </span>') + "</span></div>";
  }
  function rangeText(r) {
    return shortDate(fromIso(r.start)) + (r.end ? " – " + shortDate(fromIso(r.end)) : " onward");
  }
  // Others with the same name, or (a data error) the same employee ID, so look-alike names can be told apart.
  function twinsHtml(p) {
    var lines = [];
    (byName[nameKey(p.name)] || []).forEach(function (o) {
      if (o !== p) lines.push("Same name: " + personLink(o) + (o.emplId ? " · ID " + esc(o.emplId) : " · no ID on file"));
    });
    (p.emplId ? byId[p.emplId] || [] : []).forEach(function (o) {
      if (o !== p) lines.push('<span class="err">Same employee ID on ' + personLink(o) + ". One of them is wrong.</span>");
    });
    return lines.length ? '<div class="kv"><span class="k">Check</span><span class="v">' + lines.join("<br>") + "</span></div>" : "";
  }
  function personLink(o) {
    return '<button class="linkish" data-pos="' + esc(o.pos) + '">' + esc(o.name) + "</button> " +
      '<span class="hint">' + esc(o.title) + "</span>";
  }
  function kv(k, v, cls) { return '<div class="kv' + (cls ? " " + cls : "") + '"><span class="k">' + esc(k) + '</span><span class="v">' + esc(v) + "</span></div>"; }
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
    slots().forEach(function (p) { if (p.rank === rank) cos[home(p)] = 1; });
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
    var rows = slots().filter(function (p) {
      return p.rank === rank && (!co || home(p) === co) && (!tour || tourOn(p, m) === tour) && (p.name || showVacant);
    }).sort(byCompany);
    var days = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate();
    var t = today();
    var dates = [];
    for (var i = 1; i <= days; i++) dates.push(new Date(m.getFullYear(), m.getMonth(), i));

    $("rank-count").textContent = rows.length + " " + (rows.length === 1 ? "position" : "positions") +
      ". Red = working. Amber = swing covering the company shown. Teal = acting in another position (company shown); AW = away from own spot. VA / S / D / WE / TR = scheduled but off (WE = working elsewhere, e.g. an admin assignment; TR = traded off). Click a name for that person's detail.";
    if (!rows.length) { $("rank-grid").innerHTML = '<div class="empty">No positions match. Try All companies or All tours.</div>'; return; }

    var head = '<tr><th class="who">Name</th>' + dates.map(function (d) {
      var hol = M.holidayFor(d);
      return '<th class="' + (sameDay(d, t) ? "today-col" : "") + '"' + (hol ? ' title="' + esc(hol.name) + '"' : "") + '><span class="wd">' +
        DOW[d.getDay()].charAt(0) + "</span>" + d.getDate() + '<span class="wn">' + M.watchFor(d) + "</span>" + (hol ? holidayDot(hol) : "") + "</th>";
    }).join("") + "</tr>";
    var body = rows.map(function (p) {
      var who = p.name ? '<button class="linkish" data-pos="' + esc(p.pos) + '">' + esc(p.name) + "</button>" : '<span class="vacant">Vacant</span>';
      return '<tr><th class="who" scope="row">' + who + '<span class="meta">' + esc(home(p)) + " T" + tourOn(p, m) + (p.swingType ? " " + esc(p.swingType) : "") + "</span></th>" +
        dates.map(function (d) {
          var s = p.name ? day(p, d) : shift(p, d);
          var awayDay = !s && p.name && M.actingOn(p.pos, d, recs.covers) && shift(ownSeatOn(p, d) || p, d);
          var cls = "c" + (s ? (s.status ? " off st-" + s.status : s.acting ? " acting" : s.swing && s.co !== p.company ? " cover" : " on") : awayDay ? " away" : "") +
            (sameDay(d, t) ? " today-col" : "") + (!s && !awayDay && (d.getDay() === 0 || d.getDay() === 6) ? " weekend" : "");
          var txt = s ? (s.status ? s.status : (s.acting || (s.swing && s.co !== p.company)) ? s.co : "") : awayDay ? "AW" : "";
          var tip = s ? shortDate(d) + " · " + (s.status ? STATUS_LABEL[s.status] : (s.acting ? "Acting at " : "") + (s.co || home(p)) + (s.role ? " " + s.role : ""))
            : awayDay ? shortDate(d) + " · away, covering another position" : "";
          return '<td class="' + cls + '"' + (tip ? ' title="' + esc(tip) + '"' : "") + ">" + (s || awayDay ? "<span>" + esc(txt) + "</span>" : "") + "</td>";
        }).join("") + "</tr>";
    }).join("");
    $("rank-grid").innerHTML = '<table class="roster"><thead>' + head + "</thead><tbody>" + body + "</tbody></table>";
  }

  /* ---------- Boot ---------- */
  var byPos = {};
  var openTrades = false; // opened from a trade alert link (?trade=)
  var addedWithTour = [];
  var byId = {}, byName = {}; // employee ID -> people, name -> people (more than one means a duplicate)
  function nameKey(n) { return String(n || "").toLowerCase().replace(/\s+/g, ""); }
  // People added by editors (not on the vacancy list) join the roster as "person:<id>" entries.
  function rebuildPeople() {
    applyOverrides();
    Object.keys(byPos).forEach(function (k) { if (k.indexOf("person:") === 0) delete byPos[k]; });
    var added = (recs.people || []).map(function (x) {
      var e = { pos: "person:" + x.id, name: x.name, rank: x.rank, title: x.rank + (x.company ? " " + x.company : "") + " (added)",
        company: x.company || null, tour: x.tour || null, emplId: x.emplId || null, added: true };
      byPos[e.pos] = e;
      return e;
    });
    addedWithTour = added.filter(function (e) { return e.tour && e.company; });
    people = data.filter(function (p) { return p.name; }).concat(added).sort(function (a, b) { return a.name.localeCompare(b.name); });
    byId = {}; byName = {};
    people.forEach(function (p) {
      if (p.emplId) (byId[p.emplId] = byId[p.emplId] || []).push(p);
      var k = nameKey(p.name);
      (byName[k] = byName[k] || []).push(p);
    });
  }
  /* Roster overrides (employee card): a seat's name, rank or Employee ID over the vacancy list and employee-ids.json.
     An override made for one holder (forName) stops applying once a new vacancy list puts someone else in the seat. */
  var orig = {}; // pos -> {name, rank, emplId} from the files, before overrides
  function overrideFor(pos) {
    var o = (recs.rosterOverrides || []).filter(function (x) { return x.id === pos; })[0];
    return o && orig[pos] && (!o.forName || o.forName === orig[pos].name) ? o : null;
  }
  function applyOverrides() {
    var by = {};
    (recs.rosterOverrides || []).forEach(function (o) { by[o.id] = o; });
    data.forEach(function (p) {
      var o0 = orig[p.pos], o = by[p.pos];
      if (!o0) return;
      if (o && o.forName && o.forName !== o0.name) o = null;
      p.name = (o && o.name) || o0.name;
      p.rank = (o && o.rank) || o0.rank;
      p.emplId = (o && o.emplId) || o0.emplId || null;
    });
    var dl = $("slot-dl");
    if (dl) dl.innerHTML = data.slice().sort(byCompany).map(function (p) { return '<option value="' + esc(slotOption(p)) + '"></option>'; }).join("");
  }
  function slotFromInput(v) {
    var m = /\(?\b(\d{1,2}[A-Z]{2,4}\d{2,3}M)\)?\s*$/i.exec((v || "").trim());
    var pos = m && m[1].toUpperCase();
    return pos && byPos[pos] && !byPos[pos].added ? pos : null;
  }
  function boot(rows) {
    data = rows;
    var ids = (emplIds && emplIds.ids) || {};
    data.forEach(function (p) {
      byPos[p.pos] = p;
      orig[p.pos] = { name: p.name, rank: p.rank, emplId: ids[p.pos] && p.name ? ids[p.pos].id : null };
    });
    var dl = document.createElement("datalist");
    dl.id = "slot-dl";
    document.body.appendChild(dl);
    rebuildPeople();
    var rankSel = $("ap-rank");
    if (rankSel) rankOptions(rankSel, false);
    var t = today();
    state.personMonth = new Date(t.getFullYear(), t.getMonth(), 1);
    state.rankMonth = new Date(t.getFullYear(), t.getMonth(), 1);
    var holT = M.holidayFor(t);
    $("today-chip").innerHTML = esc(shortDate(t)) + (holT ? holidayDot(holT) : "") + " <span>Watch</span> <b>" + M.watchFor(t) + "</b>";

    rankOptions($("date-rank"), true);
    rankOptions($("rank-select"), false);
    $("rank-select").value = "Captain";
    $("rank-tour").innerHTML = '<option value="">All tours</option>' +
      Array.apply(null, Array(31)).map(function (_, i) { return '<option value="' + (i + 1) + '">Tour ' + (i + 1) + "</option>"; }).join("");
    fillCompanies();

    document.querySelectorAll(".tab[data-view]").forEach(function (b) { b.onclick = function () { setView(b.dataset.view); }; });
    wireSheet();
    wireList();
    Fix.wire();
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
    // On phones the results stay put when the keyboard closes, so they can be read and tapped.
    $("person-input").onblur = function () { setTimeout(function () { if (!isPhone()) $("person-list").hidden = true; }, 100); };

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

    state.sixMonth = new Date(t.getFullYear(), t.getMonth(), 1);
    Dash.wireDash();
    $("awards-link").onclick = function () { setView("awards"); };
    $("fixes-link").onclick = function () { setView("fixes"); };
    $("card-link").onclick = function () { setView("card"); };
    $("six-link").onclick = function () {
      if (state.view !== "six") {
        var me = serverMode() && backend.me && backend.me();
        var mine = me && me.pos && byPos[me.pos];
        if (mine && tourOn(mine, today()) && !state.sixTouched) state.sixTour = tourOn(mine, today());
      }
      setView("six");
    };
    $("ap-tour").innerHTML = '<option value="">No tour</option>' + tourOptions(0);
    if (window.DOCS) Dash.renderDocs(window.DOCS);
    else getFile("docs/index.json").then(function (r) { return r.ok ? r.json() : null; })
      .then(Dash.renderDocs, function () { Dash.renderDocs(null); });
    // On Firebase the PDFs are in Cloud Storage (signed-in members only), so the adapter opens them.
    if (backend && backend.openDoc) document.addEventListener("click", function (e) {
      var a = e.target.closest('a[href^="docs/"]');
      if (!a) return;
      e.preventDefault();
      backend.openDoc(decodeURIComponent(a.getAttribute("href").slice(5))).catch(function () { /* the tab shows nothing */ });
    });

    $("add-person-btn").onclick = function () { $("add-person").hidden = !$("add-person").hidden; if (!$("add-person").hidden) $("ap-name").focus(); };
    $("add-person").onsubmit = function (e) {
      e.preventDefault();
      var name = $("ap-name").value.trim(), msg = $("ap-msg");
      if (name.length < 2) return say(msg, "Enter the person's name, e.g. Lester,D.", true);
      say(msg, "Saving…");
      var co = $("ap-company").value.trim().toUpperCase(), tourV = $("ap-tour").value;
      if (co && !data.some(function (p) { return p.company === co; })) return say(msg, "Apparatus must be a company on the roster, like E10.", true);
      if (!co !== !tourV) return say(msg, "Pick both an apparatus and a tour, or neither.", true);
      var empl = $("ap-id").value.trim().toUpperCase();
      if (empl && !ID_RE.test(empl)) return say(msg, "Employee ID is two letters and four digits, e.g. LE1234.", true);
      if (empl && byId[empl]) return say(msg, "Employee ID " + empl + " is already on " + byId[empl][0].name + " (" + byId[empl][0].title + ").", true);
      backend.addPerson({ name: name, rank: $("ap-rank").value, company: co || null, tour: tourV ? +tourV : null, emplId: empl || null,
        note: $("ap-note").value.trim() }).then(function (res) {
        $("add-person").reset();
        $("add-person").hidden = true;
        say(msg, "");
        if (res && res.id) {
          state.personPos = "person:" + res.id;
          $("person-input").value = name;
          store("person", state.personPos);
        }
        renderAll(true);
      }, function (err) { say(msg, err.message, true); });
    };

    // The Schedule tab opens on you when your account is linked to the roster, else on the last person searched.
    var savedPerson = myPos() || recall("person");
    if (savedPerson && byPos[savedPerson] && byPos[savedPerson].name) {
      state.personPos = savedPerson;
      $("person-input").value = byPos[savedPerson].name;
    }
    booted = true;
    applyAccountUi();
    var v = openTrades ? "trades" : recall("view");
    // Members start on their own schedule, or on one of their main tabs if they left it open last time.
    if (simpleUi() && ["person", "crew", "date", "trades"].indexOf(v) === -1) v = "person";
    setView(tabAllowed(v) ? v : isPhone() || simpleUi() ? "person" : "dash");
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
    if (!force && (state.view === "person" || state.view === "me" || state.view === "trades" || state.view === "card") && a && a.closest && a.closest("form.edit, #cl-q, .trade-filters")) {
      var box = a.closest("form.edit, .trade-filters") || a;
      if (!deferred) { deferred = true; box.addEventListener("focusout", function once(e) {
        if (e.relatedTarget && box.contains(e.relatedTarget)) return;
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
  // The employee card: admins on the shared page (Editor access) or on the server; never viewers, members or snapshots.
  function isCardAdmin() { return !!(backend && backend.update && backend.canAdmin && backend.canAdmin()); }
  function serverMode() { return backend && backend.mode === "server"; }
  // The roster position this account is linked to (Firebase, server, or "This is me" on the shared page), or null.
  function myPos() {
    if (!backend || backend.mode === "snapshot" || !backend.myKey) return null; // the demo's "viewing as" isn't you
    var k = backend.myKey();
    return k && byPos[k] ? k : null;
  }
  // The simpler member layout: anyone who can't edit (everyone on the employee app). Editors and admins keep every tab.
  // Until the account is known (the single-file page boots first), keep today's layout.
  function simpleUi() { return !!backend && !backend.canEdit(); }
  function tabAllowed(v) {
    if (v === "dash" || v === "six" || v === "date" || v === "person" || v === "rank") return true;
    if (v === "crew") return simpleUi() && !!myPos();
    if (v === "me") return serverMode() && backend.isActive();
    if (v === "admin") return serverMode() && backend.isAdmin();
    if (v === "trades") return !!(backend && Trades.visible());
    if (v === "awards") return !!(backend && backend.canEdit() && window.AWARDS_2027);
    if (v === "fixes") return !!(backend && backend.canEdit() && backend.handleCorrection);
    if (v === "card") return isCardAdmin();
    return false;
  }
  // Open corrections, on the header link and the menu item (admins).
  function fixesBadge() {
    var n = Fix.count();
    $("fixes-link").textContent = "Corrections" + (n ? " (" + n + ")" : "");
    $("fixes-count").textContent = n ? n + " open" : "";
  }
  function applyAccountUi() {
    $("add-person-btn").hidden = !(backend && backend.canEdit());
    document.querySelector(".page").classList.toggle("simple", simpleUi());
    $("tab-crew").hidden = !tabAllowed("crew");
    $("tab-me").hidden = !tabAllowed("me");
    $("tab-admin").hidden = !tabAllowed("admin");
    $("tab-trades").hidden = !tabAllowed("trades");
    $("awards-link").hidden = !tabAllowed("awards");
    $("fixes-link").hidden = !tabAllowed("fixes");
    $("card-link").hidden = !tabAllowed("card");
    if (!tabAllowed(state.view) && booted) setView(simpleUi() ? "person" : "dash");
    // Menu sheet items marked data-need show only to people who can use them.
    var me = serverMode() && backend.me ? backend.me() : null;
    var can = { member: tabAllowed("me"), admin: tabAllowed("admin"), card: tabAllowed("card"), editor: !!(backend && backend.canEdit()), "signed-in": !!(me && me.signedIn),
      simple: simpleUi() };
    document.querySelectorAll("#more-sheet [data-need]").forEach(function (li) { li.hidden = !can[li.dataset.need]; });
    $("sheet-mode").textContent = !backend || backend.mode === "none" ? "View only" : backend.mode === "snapshot" ? snapshotLabel()
      : serverMode() ? "" : backend.canEdit() ? "Editing" : "View only";
    renderEditChip();
    siteBanner();
  }

  function snapshotLabel() { return "View only · records as of " + (backend.asOf ? shortDate(fromIso(backend.asOf)) : "publish date"); }

  /* ---------- Phone layout: bottom tabs and the More sheet ---------- */
  var phoneMq = window.matchMedia ? window.matchMedia("(max-width: 640px)") : null;
  function isPhone() { return !!(phoneMq && phoneMq.matches); }
  if (phoneMq) {
    var onWidth = function () { if (booted) render(); };
    if (phoneMq.addEventListener) phoneMq.addEventListener("change", onWidth); else if (phoneMq.addListener) phoneMq.addListener(onWidth);
  }
  var sheetOpener = null;
  function openSheet(opener) {
    sheetOpener = opener || document.activeElement;
    $("more-sheet").hidden = false;
    $("more-sheet").querySelector(".sheet-x").focus();
  }
  function closeSheet() {
    if ($("more-sheet").hidden) return;
    $("more-sheet").hidden = true;
    if (sheetOpener && sheetOpener.focus && document.contains(sheetOpener)) sheetOpener.focus();
  }
  function wireSheet() {
    $("menu-btn").onclick = function () { openSheet(this); };
    $("tab-more").onclick = function () { openSheet(this); };
    $("more-sheet").addEventListener("click", function (e) {
      if (e.target.closest("[data-close]")) return closeSheet();
      var go = e.target.closest("[data-go]");
      if (go) {
        var to = go.dataset.go;
        closeSheet();
        if (to === "signout") return backend.signOut();
        if (to === "seats") { state.seatsOpen = true; return setView("dash"); }
        if (to === "dash") state.seatsOpen = false;
        if (tabAllowed(to)) setView(to);
        return;
      }
      if (e.target.closest("a")) closeSheet();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key !== "Escape") return;
      if (!$("day-sheet").hidden) closeDay(); else if (!$("more-sheet").hidden) closeSheet();
    });
    $("day-sheet").addEventListener("click", function (e) { if (e.target.closest("[data-close]")) closeDay(); });
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
      if (backend.adminUrl && backend.adminUrl()) {
        el.insertAdjacentHTML("beforeend", ' <a class="linkish" href="' + esc(backend.adminUrl()) + '">Back office</a>');
      }
      return;
    }
    el.innerHTML = backend.mode === "snapshot" ? '<span class="dot"></span>' + esc(snapshotLabel())
      : backend.canEdit() ? '<span class="dot on"></span>Editing' : '<span class="dot"></span>View only';
  }
  /* Firebase: a "Test copy" banner until an admin sets the copy live (CUTOVER.md). Frozen claude.ai page
     (tools/build_artifact.py --frozen): page Editors keep Download backup in the "Moved" banner. */
  function siteBanner() {
    var mode = backend && backend.siteMode ? backend.siteMode() : null, el = $("site-banner");
    if (mode === "test" && !el) {
      document.querySelector(".page").insertAdjacentHTML("afterbegin", '<p class="site-banner" id="site-banner" role="status">' +
        "<b>Test copy.</b> Not the live schedule: changes here are replaced on cut-over day.</p>");
    } else if (mode !== "test" && el) el.remove();
    var fb = $("frozen-backup");
    if (fb && !fb.firstChild && backend && backend.canBackup && backend.canBackup()) {
      fb.innerHTML = '<button class="btn small" type="button" id="card-backup">Download backup</button> <span class="msg" id="card-backup-msg" role="status"></span>';
      $("card-backup").onclick = function () {
        var x = this;
        x.disabled = true;
        say($("card-backup-msg"), "Preparing…");
        backend.saveBackup().then(function (r) {
          x.disabled = false;
          say($("card-backup-msg"), "Saved " + r.records + " records from " + r.collections + " collections.");
        }, function (er) { x.disabled = false; say($("card-backup-msg"), er.message, true); });
      };
    }
  }
  function gate(on) {
    document.querySelector(".page").classList.toggle("gated", on);
    $("gate").hidden = !on;
  }

  var Dash = window.DashboardViews({
    $: $, esc: esc, today: today, addDays: addDays, iso: iso, fromIso: fromIso, longDate: longDate, shortDate: shortDate, MONTHS: MONTHS,
    holidayNote: holidayNote,
    slots: function () { return slots(); }, shift: shift, home: home, recs: function () { return recs; },
    recsVersion: function () { return recsVersion + ":" + iso(today()); }, dayRows: dayRows, byPos: function () { return byPos; },
    people: function () { return people; }, data: function () { return data; }, STATUS_LABEL: STATUS_LABEL, coKey: coKey,
    backend: function () { return backend; }, state: function () { return state; },
    requiredData: function () { return requiredData; }, isPhone: function () { return isPhone(); },
    kindWord: kindWord, KIND: KIND, showList: showList,
  });

  var Trades = window.TradeViews({
    $: $, esc: esc, say: say, backend: function () { return backend; }, recs: function () { return recs; }, byPos: function () { return byPos; },
    people: function () { return people; }, slots: function () { return slots(); }, opts: opts, day: day, tourOn: tourOn, home: home, coKey: coKey,
    today: today, iso: iso, fromIso: fromIso, shortDate: shortDate, longDate: longDate, renderAll: renderAll,
    showTrades: function () { if (state.view === "trades") renderAll(true); else setView("trades"); },
    afterClaim: function (p, station, tour) { return Fix.afterClaim(p, station, tour); },
  });

  var Fix = window.CorrectionViews({
    $: $, esc: esc, say: say, backend: function () { return backend; }, byPos: function () { return byPos; }, recs: function () { return recs; },
    today: today, iso: iso, fromIso: fromIso, shortDate: shortDate, home: home, tourOn: tourOn, day: day,
    statusFor: function (pos, d) { return M.statusFor(pos, d, recs.statuses); }, slotFromInput: slotFromInput, choosePerson: choosePerson,
    renderAll: renderAll, kindWord: kindWord, KIND: KIND, STATUS_LABEL: STATUS_LABEL,
  });

  var Card = window.CardViews({
    $: $, esc: esc, say: say, backend: function () { return backend; }, byPos: function () { return byPos; }, recs: function () { return recs; },
    people: function () { return people; }, contacts: function () { return contacts; }, byId: function () { return byId; },
    orig: function (pos) { return orig[pos] || null; }, overrideFor: overrideFor, makeMatcher: makeMatcher, isPhone: isPhone,
    today: today, iso: iso, fromIso: fromIso, shortDate: shortDate, home: home, tourOn: tourOn, day: day, coverOf: coverOf,
    statusFor: function (pos, d) { return M.statusFor(pos, d, recs.statuses); }, statusPill: statusPill, rangeText: rangeText, slotLabel: slotLabel,
    kindWord: kindWord, KIND: KIND, STATUS_LABEL: STATUS_LABEL, RANKS: RANK_ORDER, ID_RE: ID_RE, tourOptions: tourOptions,
    statusForm: statusForm, coverForm: coverForm, tourForm: tourForm, wireForms: wireForms,
    companyOk: function (co) { return data.some(function (p) { return p.company === co; }); },
    fix: function () { return Fix; }, choosePerson: choosePerson, renderAll: renderAll,
    Organization: window.Organization, store: store, recall: recall,
    show: function () { if (state.view === "card") renderAll(true); else setView("card"); },
  });

  var Awards = window.AwardViews({
    $: $, esc: esc, backend: function () { return backend; }, byPos: function () { return byPos; }, recs: function () { return recs; },
    people: function () { return people; }, data: function () { return data; }, renderAll: renderAll, RANKS: RANK_ORDER,
  });

  var Accounts = window.AccountViews({
    $: $, esc: esc, say: say, backend: function () { return backend; }, byPos: function () { return byPos; },
    people: function () { return people; }, recs: function () { return recs; }, shift: shift, tourOn: tourOn,
    statusFor: function (pos, d) { return M.statusFor(pos, d, recs.statuses); }, statusPill: statusPill, STATUS_LABEL: STATUS_LABEL,
    today: today, addDays: addDays, iso: iso, fromIso: fromIso, shortDate: shortDate, choosePerson: choosePerson,
    renderAll: renderAll, gate: gate, RANKS: RANK_ORDER,
  });

  /* ---------- Start ---------- */
  function onRecords(r) {
    recs = { statuses: r.statuses || [], tourChanges: r.tourChanges || [], covers: r.covers || [], people: r.people || [],
      staffing: r.staffing || [], members: r.members || [], trades: r.trades || [], tradeReplies: r.tradeReplies || [],
      corrections: r.corrections || [], assignments: r.assignments || [], rosterOverrides: r.rosterOverrides || [] };
    recsVersion++;
    fixesBadge();
    if (r.contacts) contacts = r.contacts;
    siteBanner();
    if (booted) rebuildPeople();
    renderAll();
  }
  // Roster files and the documents list: from the server or static folder, or Cloud Storage on Firebase.
  function getFile(path) { return backend && backend.fetchData ? backend.fetchData(path) : fetch(path, { credentials: "same-origin" }); }
  function loadError(err) {
    $("date-results").innerHTML = '<div class="empty">Could not load the roster (' + esc(err.message) +
      "). Serve this folder over HTTP, for example with <code>python3 server.py</code>, then reload.</div>";
  }
  if (window.POSITIONS) {
    // Single-file build: show the schedule at once, then light up editing when the page database answers.
    boot(window.POSITIONS);
    window.ScheduleStore.connect(onRecords).then(function (b) {
      backend = b;
      // Linked with "This is me": open on yourself, unless someone was already picked this visit.
      if (myPos() && !pickedThisVisit) { state.personPos = myPos(); $("person-input").value = byPos[myPos()].name; }
      applyAccountUi();
      // Members (now that we know) start on a main tab, as boot does on the other builds.
      if (simpleUi() && ["person", "crew", "date", "trades"].indexOf(state.view) === -1) return setView("person");
      renderAll(true);
    });
  } else {
    window.ScheduleStore.connect(onRecords).then(function (b) {
      backend = b;
      if (serverMode() && !backend.isActive()) { renderEditChip(); Accounts.renderGate(); return; }
      // The roster and the three smaller files download together (Firebase may have started them during sign-in).
      var json = function (url) {
        return getFile(url).then(function (r) { return r.ok ? r.json() : null; }, function () { return null; });
      };
      var others = Promise.all([json("data/required-staffing.json"), json("data/employee-ids.json"), json("data/vacancy-awards-2027.json")]);
      return getFile("data/positions.json").then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      }).then(function (rows) {
        // ?trade=<id>: opened from a trade alert, so start on the Trades tab.
        openTrades = /[?&]trade=/.test(location.search);
        var linkCode = (/[?&]t=([^&]+)/.exec(location.search) || [])[1];
        if (/[?&](auth_error|t|trade)=/.test(location.search)) history.replaceState(null, "", location.pathname);
        // A trade invite link opened by someone already approved: when they're the person it was for (signed in with
        // that person's staff-list cell), it confirms their answer from the link. Otherwise it's just dropped.
        try {
          var inviteCode = sessionStorage.getItem("tradeInvite") || linkCode;
          sessionStorage.removeItem("tradeInvite");
          if (inviteCode && backend.redeemInvite) backend.redeemInvite(decodeURIComponent(inviteCode), "").catch(function () {});
        } catch (e) { /* storage unavailable */ }
        return others.then(function (got) {
          requiredData = got[0]; emplIds = got[1]; recsVersion++;
          window.EMPLOYEE_IDS = window.EMPLOYEE_IDS || got[1];
          window.AWARDS_2027 = window.AWARDS_2027 || got[2];
          boot(rows);
        });
      });
    }).catch(loadError);
  }
})();
