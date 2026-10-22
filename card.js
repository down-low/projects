/* Employee card: one back-office screen where an admin finds a person and edits their whole record.
 * window.CardViews(api) -> {render, open(key)}. With nobody open it shows the roster: rank tiles over a table of everyone. `api` comes from app.js. Admins only (page Editors, server admins); members
 * and viewers never see it, and the person page they use is unchanged.
 * Sections: identity (name, rank, Employee ID, academy class), own seat and moves, current assignment, leave, tour changes, cell number
 * (staff list), "This is me" claim, corrections, and one history timeline with edit and delete for every record.
 * The status, cover and tour forms are the person page's (app.js statusForm / coverForm / tourForm), with other id prefixes.
 */
(function (root) {
  "use strict";
  var M = root.TourMath;

  root.CardViews = function (api) {
    var $ = api.$, esc = api.esc;
    /* key: the person shown; edit: "section|kind|id" of the record whose edit form is open; undo: a removed claim
       ({key, member} on the shared page, {key, accountId} on the server). */
    var ui = { key: null, q: "", edit: null, undo: null, users: null, usersLoading: false,
      rank: "", sort: { key: "name", dir: 1 }, page: 0, per: 25, cols: null, chooser: false };

    function backend() { return api.backend(); }
    function byPos() { return api.byPos(); }
    function recs() { return api.recs(); }
    function todayIso() { return api.iso(api.today()); }
    function serverMode() { return backend() && backend().mode === "server"; }
    function nameOf(key) { var p = byPos()[key]; return p ? p.name || "Vacant" : key; }
    function when(isoStr) { return isoStr ? api.shortDate(api.fromIso(String(isoStr).slice(0, 10))) : ""; }
    function btn(label, attrs, cls) { return '<button type="button" class="btn small' + (cls ? " " + cls : "") + '" ' + attrs + ">" + label + "</button>"; }
    function msgEl(id) { return '<span class="msg" id="' + id + '" role="status"></span>'; }

    function open(key) {
      ui.key = key;
      ui.edit = null;
      api.show();
    }

    /* ---------- Records touching one person ---------- */
    function covers(key) { return (recs().covers || []).filter(function (c) { return c.coverKey === key || c.targetPos === key; }); }
    function statuses(key) { return (recs().statuses || []).filter(function (s) { return s.pos === key; }); }
    function tourChanges(key) { return (recs().tourChanges || []).filter(function (c) { return c.pos === key; }); }
    function claims(key) { return (recs().members || []).filter(function (m) { return m.key === key; }); }
    function fixes(key) { return (recs().corrections || []).filter(function (c) { return c.aboutKey === key || c.byKey === key; }); }
    function byStartDesc(a, b) { return String(b.start || b.effective).localeCompare(String(a.start || a.effective)); }
    function live(r) { return !r.end || r.end >= todayIso(); }

    function statusLine(s) {
      return api.statusPill(s.code) + " <b>" + esc(api.STATUS_LABEL[s.code] || s.code) + "</b> " + esc(when(s.start)) +
        (s.end ? (s.end !== s.start ? " – " + esc(when(s.end)) : "") : " onward");
    }
    function coverLine(c, key) {
      if (c.coverKey === key) return "<b>" + esc(api.kindWord(c)) + " " + esc(api.slotLabel(c.targetPos)) + "</b> " +
        (M.isMove(c) ? "" : '<span class="tag">' + esc(api.KIND[kindKey(c)][0]) + "</span> ") + esc(api.rangeText(c));
      return "<b>" + esc(c.coverName || nameOf(c.coverKey)) + " · " + esc(api.kindWord(c).toLowerCase()) + "</b> in this seat " + esc(api.rangeText(c));
    }
    function kindKey(c) {
      var who = byPos()[c.coverKey], seat = byPos()[c.targetPos];
      return M.coverKind(c, who && who.rank, seat && seat.rank);
    }
    function tourLine(c) { return '<span class="st st-T">T</span> <b>Tour ' + esc(c.tour) + "</b> from " + esc(when(c.effective)); }

    // One list row for a schedule record, with Edit / End today / Delete, and its edit form underneath when open.
    function recRow(section, kind, r, html, p) {
      var editKey = section + "|" + kind + "|" + r.id, trade = !!r.tradeId;
      var acts = trade ? '<span class="hint">From a shift trade; change it on the Trades tab</span>' :
        btn("Edit", 'data-cedit="' + esc(editKey) + '"') +
        (kind === "covers" && !r.end && r.start <= todayIso() ? btn("End today", 'data-cend="' + esc(r.id) + '"') : "") +
        btn("Delete", 'data-cdel="' + esc(kind) + '" data-id="' + esc(r.id) + '"');
      var form = ui.edit === editKey ? editForm(kind, r, p) : "";
      return "<li><div>" + html + (r.note ? '<div class="hint">' + esc(r.note) + "</div>" : "") + "</div>" +
        '<div class="acts">' + acts + "</div>" + (form ? '<div class="card-editform">' + form + "</div>" : "") + "</li>";
    }
    // The edit form for one record; a cover is edited as the person covering (they may not be the person shown).
    function editForm(kind, r, p) {
      if (kind === "statuses") return api.statusForm(p, r, "kh");
      if (kind === "tourChanges") return api.tourForm(p, r, "kh");
      if (kind === "covers") return api.coverForm(coverer(r), r, "kh", { move: true });
      return "";
    }
    function coverer(c) { return byPos()[c.coverKey] || { pos: c.coverKey, name: c.coverName || c.coverKey }; }
    function list(rows, empty) { return rows.length ? '<ul class="hist card-list">' + rows.join("") + "</ul>" : '<p class="hint">' + empty + "</p>"; }
    function section(id, title, sum, body, openDefault) {
      var open = ui.folds && id in ui.folds ? ui.folds[id] : openDefault !== false;
      return '<details class="card fold card-sec" data-cfold="' + id + '"' + (open ? " open" : "") + "><summary><h3>" + esc(title) + "</h3>" +
        '<span class="fold-sum">' + sum + "</span></summary>" + body + "</details>";
    }

    /* ---------- Roster: rank tiles over a table of everyone ----------
       Tiles count people per rank and filter the table; the table has search, sorting, paging, a column chooser (remembered
       per browser) and a status quick edit. Clicking a name opens that person's card.

       To add a column, add one entry to COLUMNS: {key, label, get(p) -> sortable value, html?(p) -> cell HTML, on: shown by
       default, phone: shown by default on phones}. A new stored field (e.g. email, DSW No, seniority number) needs the data
       first: an admin-only page collection (one rule in tools/build_artifact.py CAPABILITIES, read in store.js and passed
       through onChange like rosterOverrides), then a COLUMNS entry that reads it. */
    var PAGE_SIZES = [25, 50, 100, 0]; // 0 = all
    var STATUS_OPTS = [["", "Full duty"], ["VA", "VA · Vacation"], ["S", "S · Sick"], ["D", "D · Disabled"], ["WE", "WE · Working elsewhere"]];
    function org(p) { return api.Organization ? api.Organization.locate(api.home(p)) : null; }
    function profile(p) { return (api.profiles() || {})[p.pos] || {}; }
    function yearsSince(isoStr) { return isoStr ? Math.floor((api.today() - api.fromIso(isoStr)) / (365.25 * 864e5) * 10) / 10 : null; }
    function cellOf(p) { var c = api.contacts()[p.pos]; return c && c.staffList ? root.TourMath.showCell(c.phoneMobile) : ""; }
    function claimed(p) {
      if (serverMode()) return (ui.users || []).some(function (u) { return u.pos === p.pos; });
      return (recs().members || []).some(function (m) { return m.key === p.pos; });
    }
    function openFixes(p) { return (recs().corrections || []).filter(function (c) { return c.aboutKey === p.pos && c.state === "open"; }).length; }
    function current(p) { return (recs().covers || []).filter(function (c) { return c.coverKey === p.pos && !M.isMove(c) && c.start <= todayIso() && live(c); })[0] || null; }
    var COLUMNS = [
      { key: "div", label: "Division", get: function (p) { var o = org(p); return o ? o.division.name : ""; }, on: true },
      { key: "batt", label: "Battalion", get: function (p) { var o = org(p); return o ? o.battalion.name : ""; }, on: true },
      { key: "stn", label: "Station", get: function (p) { var o = org(p); return o && o.station ? o.station : null; }, num: true, on: true,
        html: function (p) { var o = org(p); return o && o.station ? "Sta " + o.station : ""; } },
      // Key kept as "station" so column choices saved in browsers still find it.
      { key: "station", label: "Company", get: function (p) { return api.home(p) || ""; }, sortKey: function (p) { return coSort(api.home(p)); }, on: true, phone: true },
      { key: "name", label: "Name", get: function (p) { return p.name; }, on: true, phone: true,
        html: function (p) { return '<button type="button" class="linkish" data-ckey="' + esc(p.pos) + '">' + esc(p.name) + "</button>"; } },
      { key: "position", label: "Position", get: function (p) { return p.title + (p.added ? "" : " " + p.pos); }, on: true,
        html: function (p) { return esc(p.title) + (p.added ? "" : ' <span class="hint mono">' + esc(p.pos) + "</span>"); } },
      { key: "rank", label: "Rank", get: function (p) { return p.rank; }, sortKey: function (p) { return api.RANKS.indexOf(p.rank); } },
      { key: "hclass", label: "H-class", get: function (p) { return p.hclass || ""; } },
      { key: "tour", label: "Tour", get: function (p) { return api.tourOn(p, api.today()) || ""; }, num: true, on: true, phone: true },
      { key: "id", label: "Employee ID", get: function (p) { return p.emplId || ""; }, on: true, html: function (p) { return p.emplId ? '<span class="mono">' + esc(p.emplId) + "</span>" : '<span class="hint">—</span>'; } },
      { key: "status", label: "Status", get: function (p) { return api.statusFor(p.pos, api.today()) || ""; }, on: true, phone: true, html: statusCell },
      { key: "asg", label: "Assignment", get: function (p) { var c = current(p); return c ? api.kindWord(c) + " " + ((byPos()[c.targetPos] || {}).company || c.targetPos) : ""; } },
      { key: "cell", label: "Cell", get: cellOf },
      { key: "birth", label: "Birth date", get: function (p) { return profile(p).birthDate || ""; }, needs: "profiles" },
      { key: "age", label: "Age", get: function (p) { return yearsSince(profile(p).birthDate); }, num: true, needs: "profiles" },
      { key: "hire", label: "Hire date", get: function (p) { return profile(p).hireDate || ""; }, needs: "profiles" },
      { key: "yos", label: "Years of service", get: function (p) { return yearsSince(profile(p).hireDate); }, num: true, needs: "profiles" },
      { key: "claimed", label: "Claimed", get: function (p) { return claimed(p) ? "Yes" : ""; }, needs: "users" },
      { key: "fixes", label: "Open corrections", get: openFixes, num: true },
      { key: "action", label: "Action", get: function () { return ""; }, on: true, nosort: true,
        html: function (p) { return btn("Open", 'data-ckey="' + esc(p.pos) + '"'); } },
    ];
    function coSort(co) { var m = /^([A-Z]+)(\d+)$/.exec(co || ""); return m ? m[1] + ("000" + m[2]).slice(-3) : "ZZZ" + (co || ""); }
    function visibleCols() {
      if (!ui.cols) {
        var saved = null;
        try { saved = JSON.parse(api.recall("card-cols") || "null"); } catch (e) { saved = null; }
        ui.cols = Array.isArray(saved) ? saved : COLUMNS.filter(function (c) { return api.isPhone() ? c.phone || c.key === "action" : c.on; }).map(function (c) { return c.key; });
      }
      return COLUMNS.filter(function (c) { return ui.cols.indexOf(c.key) !== -1; });
    }
    // Profiles (shared with the person page, app.js) and (on the server) accounts load only when a column that needs them is shown.
    function loadNeeds(cols) {
      cols.forEach(function (c) {
        if (c.needs === "profiles") api.loadProfiles();
        if (c.needs === "users" && serverMode() && !ui.users) linkedUsers("");
      });
    }

    function statusCell(p) {
      var code = api.statusFor(p.pos, api.today());
      if (code === "TR") return '<select disabled aria-label="Status"><option>TR (trade)</option></select>';
      return '<select data-cstatus="' + esc(p.pos) + '" aria-label="Status for ' + esc(p.name) + '">' + STATUS_OPTS.map(function (o) {
        return '<option value="' + o[0] + '"' + (o[0] === (code || "") ? " selected" : "") + ">" + esc(o[1]) + "</option>";
      }).join("") + '</select> <span class="msg" data-cstatus-msg="' + esc(p.pos) + '" role="status"></span>';
    }
    // Quick edit: VA / S / D / WE from today, open-ended; Full duty ends whatever is running today (a status that starts
    // today is removed, an older one ends yesterday). Trade records are left alone.
    function setStatus(pos, code, msg) {
      var b = backend(), p = byPos()[pos], t = todayIso();
      if (!p) return;
      api.say(msg, "Saving…");
      var y = api.iso(new Date(api.today().getFullYear(), api.today().getMonth(), api.today().getDate() - 1));
      var running = (recs().statuses || []).filter(function (s) { return s.pos === pos && !s.tradeId && s.start <= t && (!s.end || s.end >= t); });
      var done = code
        ? b.addStatus({ pos: pos, name: p.name, code: code, start: t, end: null, note: "Set from the roster table" })
        : running.reduce(function (pr, s) {
          return pr.then(function () { return s.start >= t ? b.remove("statuses", s.id) : b.update("statuses", s.id, { end: y }); });
        }, Promise.resolve());
      done.then(function () { api.renderAll(true); }, function (er) { api.say(msg, er.message, true); });
    }

    function rosterRows() {
      var match = api.makeMatcher(ui.q), t = api.today();
      var rows = api.people().filter(function (p) {
        if (ui.rank && p.rank !== ui.rank) return false;
        return !match || match({ name: p.name, title: p.title, co: api.home(p), tour: api.tourOn(p, t), pos: p.pos, id: p.emplId });
      });
      var col = COLUMNS.filter(function (c) { return c.key === ui.sort.key; })[0];
      if (col) {
        var f = col.sortKey || col.get;
        rows = rows.map(function (p) { return { p: p, v: f(p) }; }).sort(function (a, b) {
          var x = a.v, y = b.v, empty = (x === "" || x == null) - (y === "" || y == null);
          if (empty) return empty; // blanks last either way
          var c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
          return c * ui.sort.dir || a.p.name.localeCompare(b.p.name);
        }).map(function (r) { return r.p; });
      }
      return rows;
    }
    function tilesHtml() {
      var counts = {}, all = api.people();
      all.forEach(function (p) { counts[p.rank] = (counts[p.rank] || 0) + 1; });
      return '<div class="rtiles" role="group" aria-label="Filter by rank">' +
        [["", "All", all.length]].concat(api.RANKS.filter(function (r) { return counts[r]; }).map(function (r) { return [r, r, counts[r]]; })).map(function (x) {
          return '<button type="button" class="rtile' + (ui.rank === x[0] ? " on" : "") + '" data-crank="' + esc(x[0]) + '" aria-pressed="' + (ui.rank === x[0]) + '">' +
            '<span class="n">' + x[2] + '</span><span class="k">' + esc(x[1]) + "</span></button>";
        }).join("") + "</div>";
    }
    function rosterHtml() {
      return '<div class="card roster-card"><h2 class="view-title">Employee cards</h2>' +
        '<p class="hint">Admins only. Tap a rank to filter; tap a name to open their card. Members never see this screen.</p>' +
        (backend().saveBackup ? '<p class="row backup">' + btn("Download backup", 'id="card-backup"') + msgEl("card-backup-msg") +
          '<span class="hint">Every record, cell numbers included, as one file for the move to Firebase. Keep it private.</span></p>' : "") +
        tilesHtml() +
        '<form class="edit rbar" id="card-search" novalidate role="search">' +
        '<label class="rshow">Show<select id="card-per">' + PAGE_SIZES.map(function (n) {
          return '<option value="' + n + '"' + (n === ui.per ? " selected" : "") + ">" + (n || "All") + "</option>";
        }).join("") + "</select></label>" +
        '<label class="rq">Search<input type="search" id="card-q" placeholder="Name, Employee ID, company, tour or position" autocomplete="off" value="' + esc(ui.q) + '"></label>' +
        '<button type="button" class="btn" id="card-cols-btn" aria-expanded="' + !!ui.chooser + '" aria-controls="card-cols">☰ Columns</button></form>' +
        '<div class="rcols" id="card-cols"' + (ui.chooser ? "" : " hidden") + '><div class="rcols-head"><b>Column chooser</b>' + btn("Done", 'id="card-cols-x"') + "</div>" +
        COLUMNS.map(function (c) {
          return '<label class="chk"><input type="checkbox" data-ccol="' + c.key + '"' + (ui.cols.indexOf(c.key) !== -1 ? " checked" : "") + "> " + esc(c.label) + "</label>";
        }).join("") + btn("Reset to default", 'id="card-cols-reset"') + "</div>" +
        '<p class="rsum" id="card-sum"></p><div class="table-wrap rwrap" id="card-table"></div><div class="rpager" id="card-pager"></div></div>' +
        firHtml();
    }

    /* ---------- Compare with fir-db1 (fir.js) ----------
       Pick a rank level; the tool lists the people it has questions about (or everyone at that level) with the reasons, and
       builds a console script for just them. Run it in a signed-in fir-db1 tab, then choose the CSV it downloads here. The
       file is read in this browser and kept in memory only. */
    function firPlan() {
      var F = root.FirCompare, f = ui.fir, d = f.date ? api.fromIso(f.date) : api.today();
      var md = function (x) { return (x.getMonth() + 1) + "/" + x.getDate() + "/" + x.getFullYear(); };
      var date = md(d), to = f.to && f.to > (f.date || "") ? md(api.fromIso(f.to)) : "";
      if (f.source === "list" && f.list) {
        // A loaded list: people by the list's Employee IDs; rows without one can't be pulled.
        var lt = F.targetsFromList(f.list, api, f.group);
        return { list: lt, label: f.list.name + (f.group ? ", " + f.group : ""), skipped: lt.filter(function (x) { return !x.id; }).length,
          people: lt.filter(function (x) { return x.id; }).map(function (x) { return { id: x.id, name: x.p ? x.p.name : x.name, co: x.p ? api.home(x.p) || "" : "" }; }),
          companies: [], date: date, to: to };
      }
      var list = F.targets(api, f.level, f.all).map(function (x) { return { p: x.p, id: x.p.emplId || "", name: x.p.name, reasons: x.reasons }; });
      var people = list.filter(function (x) { return x.id; }).map(function (x) { return { id: x.id, name: x.name, co: api.home(x.p) || "" }; });
      var cos = {};
      list.forEach(function (x) { if (!x.id && api.home(x.p)) cos[api.home(x.p)] = 1; });
      var lv = F.LEVELS.filter(function (l) { return l.id === f.level; })[0];
      return { list: list, label: lv.label + (f.all ? ", everyone" : ", questions only"), people: people, companies: Object.keys(cos), date: date, to: to };
    }
    function firHtml() {
      var F = root.FirCompare;
      if (!F || !api.dayRows) return "";
      ui.fir = ui.fir || { level: "H40", all: false, date: api.iso(api.today()) };
      var f = ui.fir, plan = firPlan(), r = f.result;
      var asked = plan.list.filter(function (x) { return x.reasons.length; }).length;
      return '<details class="card fold fir-card" id="fir-card"' + (f.open ? " open" : "") + "><summary><h3>Check with fir-db1</h3>" +
        '<span class="fold-sum">' + (r ? r.people.filter(function (x) { return x.issues.length; }).length + " of " + r.people.length + " people differ" : "positions the tool isn't sure about") + "</span></summary>" +
        '<form class="edit fir-form" id="fir-form" novalidate><div class="row">' +
        '<label>Who<select id="fir-source"><option value="tool"' + (f.source !== "list" ? " selected" : "") + ">People this tool has questions about</option>" +
        '<option value="list"' + (f.source === "list" ? " selected" : "") + ">People on a list (CSV)</option></select></label>" +
        '<label>From date<input type="date" id="fir-date" value="' + esc(f.date) + '"></label>' +
        '<label>To date (optional)<input type="date" id="fir-to" value="' + esc(f.to || "") + '"></label></div>' +
        (f.source === "list"
          ? '<div class="row"><label>List<input type="file" id="fir-list" accept=".csv,text/csv"></label>' +
            (f.list && f.list.groups.length ? '<label>Rank group<select id="fir-group"><option value="">All groups</option>' + f.list.groups.map(function (g) {
              return '<option value="' + esc(g) + '"' + (g === f.group ? " selected" : "") + ">" + esc(g) + "</option>"; }).join("") + "</select></label>" : "") + "</div>" +
            '<p class="hint">' + (f.list ? "Loaded <b>" + esc(f.list.name) + "</b> (" + f.list.rows.length + " rows). " : "") +
            "Any CSV with an <code>employee_id</code> column, e.g. <code>cleanup/records-in-question.csv</code>. Read in this browser only.</p>"
          : '<div class="row"><label>Rank level<select id="fir-level">' + F.LEVELS.map(function (l) { return '<option value="' + l.id + '"' + (l.id === f.level ? " selected" : "") + ">" + esc(l.label) + "</option>"; }).join("") + "</select></label></div>" +
            '<label class="chk"><input type="checkbox" id="fir-all"' + (f.all ? " checked" : "") + "> Everyone at this level, not just the ones with questions</label>") + "</form>" +
        '<details class="fir-who"><summary><b>' + plan.list.length + "</b> to check" + (f.all ? " (" + asked + " with questions)" : "") +
        " · " + plan.people.length + " employee pages" + (plan.companies.length ? " + " + plan.companies.length + " company pages (no Employee ID)" : "") +
        (plan.skipped ? " · " + plan.skipped + " without an Employee ID (not pulled)" : "") + "</summary>" +
        (plan.list.length ? '<ul class="tlist fir-list">' + plan.list.map(function (x) {
          return "<li><div>" + (x.p ? '<button type="button" class="linkish" data-ckey="' + esc(x.p.pos) + '">' + esc(x.p.name) + '</button> <span class="hint">' + esc(x.p.title)
            : esc(x.name) + ' <span class="hint">not in the tool') + (x.id ? " · " + esc(x.id) : "") + "</span>" +
            (x.reasons.length ? '<div class="hint">' + esc(x.reasons.join(" · ")) + "</div>" : "") + "</div></li>";
        }).join("") + "</ul>" : '<p class="hint">' + (f.source === "list" ? (f.list ? "Nobody in this group." : "Choose a list file above.") : 'Nobody at this level has open questions. Tick "Everyone" to check them all anyway.') + "</p>") + "</details>" +
        '<ol class="fir-steps"><li>On the city VPN, open fir-db1 and sign in (any page).</li>' +
        "<li>" + btn("Copy pull script", 'id="fir-copy"' + (plan.people.length + plan.companies.length ? "" : " disabled"), "primary") +
        " then in that tab open the console (F12 → Console; type <code>allow pasting</code> if Chrome asks), paste and press Enter. " +
        "It opens each person's time page (" + (plan.to ? "every day from " + esc(plan.date) + " to " + esc(plan.to) : "14 days around the date") + ") and downloads <code>fir-&lt;date&gt;" + (plan.to ? "_to_&lt;date&gt;" : "") + ".csv</code>.</li>" +
        '<li>Choose that file here: <input type="file" id="fir-file" accept=".csv,text/csv"> <span class="msg" id="fir-msg" role="status">' + esc(f.error || "") + "</span></li></ol>" +
        '<textarea id="fir-script" class="fir-script" readonly hidden></textarea>' +
        '<p class="hint">The script only reads pages your fir-db1 login can already see, one at a time. The file stays on this computer; nothing is saved to the tool.</p>' +
        (r ? firResult(r) : "") + "</details>";
    }
    function firCell(f) {
      if (!f) return '<span class="hint">—</span>';
      var st = root.FirCompare.firState(f);
      return esc([f.co || (f.mode === "co" ? f.query : ""), f.position, f.role, f.trc].filter(Boolean).join(" · ")) + (f.status && f.status !== f.trc ? " " + api.statusPill(f.status) : "") +
        (st.kind === "off" ? ' <span class="hint">off</span>' : "");
    }
    function toolCell(e) {
      if (!e) return '<span class="hint">off that day</span>';
      var bits = [e.co, e.seat];
      if (e.kind) bits.push((api.KIND[e.kind] || api.KIND.cover)[0]);
      return esc(bits.join(" · ")) + (e.status ? " " + api.statusPill(e.status) : e.off ? ' <span class="tag tag-away">' + (e.away ? "away" : "covered") + "</span>" : "");
    }
    function firResult(r) {
      var diff = r.people.filter(function (x) { return x.issues.length; }), same = r.people.filter(function (x) { return !x.issues.length; });
      var span = r.dates.length ? api.shortDate(api.fromIso(r.dates[0])) + (r.dates.length > 1 ? " – " + api.shortDate(api.fromIso(r.dates[r.dates.length - 1])) : "") : "";
      var flags = r.flags.filter(function (x) { return x.flag !== "empty"; });
      var row = function (x) {
        return '<details class="fir-person"><summary><button type="button" class="linkish" data-ckey="' + esc(x.key) + '">' + esc(x.name) + "</button> " +
          '<span class="hint mono">' + esc(x.emplId || "") + "</span> · " + x.issues.length + " of " + x.days + " days differ" +
          '<div class="hint">' + esc(firstNotes(x.issues)) + "</div>" + (x.notes.length ? '<div class="hint">' + esc(x.notes.join(" · ")) + "</div>" : "") + "</summary>" +
          '<div class="table-wrap"><table class="list fir-t"><thead><tr><th>Date</th><th>fir-db1</th><th>This tool</th><th>Note</th></tr></thead><tbody>' +
          x.issues.map(function (it) {
            return "<tr><td>" + esc(api.shortDate(api.fromIso(it.date))) + "</td><td>" + firCell(it.fir) + "</td><td>" + toolCell(it.tool) + "</td><td>" + esc(it.note) + "</td></tr>";
          }).join("") + "</tbody></table></div></details>";
      };
      return '<div class="fir-result"><p><b>' + esc(span) + "</b> · " + r.people.length + " people checked · <b>" + diff.length + "</b> with differences · " + same.length + " agree on every day</p>" +
        (flags.length ? '<p class="hint err">Couldn\'t read: ' + esc(flags.map(function (x) { return x.query + " (" + x.flag + ")"; }).join(", ")) + "</p>" : "") +
        (diff.length ? diff.map(row).join("") : '<p class="hint">No differences.</p>') +
        (r.unknown.length ? '<details class="fir-sec" open><summary><b>On fir-db1, not in the tool</b> <span class="n">' + r.unknown.length + "</span></summary><ul class=\"tlist\">" +
          r.unknown.map(function (u) {
            var w = u.rows.filter(function (f) { return f.position; })[0] || u.rows[0];
            return "<li><div>" + esc(u.name) + ' <span class="hint mono">' + esc(u.emplId) + "</span> · " + firCell(w) + "</div></li>";
          }).join("") + "</ul><p class=\"hint\">Add them with <b>Not on the list? Add a person</b> on the Schedule tab if they belong.</p></details>" : "") +
        (r.toolOnly.length ? '<details class="fir-sec"><summary><b>Working there in the tool, not on fir-db1\'s company list</b> <span class="n">' + r.toolOnly.length + "</span></summary><ul class=\"tlist\">" +
          r.toolOnly.map(function (t) {
            return "<li><div>" + (t.p ? '<button type="button" class="linkish" data-ckey="' + esc(t.key) + '">' + esc(t.p.name) + "</button>" : esc(t.key)) + " · " + esc(api.shortDate(api.fromIso(t.date))) + " · " + toolCell(t.tool) + "</div></li>";
          }).join("") + "</ul></details>" : "") +
        (same.length ? '<details class="fir-sec" open><summary><b>Agree on every day</b> <span class="n">' + same.length + "</span></summary><p>" +
          same.map(function (x) { return '<button type="button" class="linkish" data-ckey="' + esc(x.key) + '">' + esc(x.name) + "</button>" + (x.notes.length ? ' <span class="hint">(' + esc(x.notes.join(" · ")) + ")</span>" : ""); }).join("<br>") + "</p></details>" : "") + "</div>";
    }
    function firstNotes(issues) {
      var seen = {}, out = [];
      issues.forEach(function (i) { var n = i.note.split(" · ")[0]; if (!seen[n]) { seen[n] = 1; out.push(n); } });
      return out.join(" · ");
    }
    function wireFir() {
      var F = root.FirCompare, card = $("fir-card");
      if (!F || !card) return;
      card.addEventListener("toggle", function () { ui.fir.open = card.open; });
      $("fir-source").onchange = function () { ui.fir.source = this.value; render(); };
      if ($("fir-level")) $("fir-level").onchange = function () { ui.fir.level = this.value; render(); };
      if ($("fir-all")) $("fir-all").onchange = function () { ui.fir.all = this.checked; render(); };
      if ($("fir-group")) $("fir-group").onchange = function () { ui.fir.group = this.value; render(); };
      if ($("fir-list")) $("fir-list").onchange = function () {
        var file = this.files && this.files[0];
        if (!file) return;
        var rd = new FileReader();
        rd.onload = function () {
          try {
            var l = F.parseList(rd.result);
            l.name = file.name;
            ui.fir.list = l;
            ui.fir.group = l.groups[0] || "";
            ui.fir.error = "";
          } catch (er) { ui.fir.error = er.message; }
          render();
        };
        rd.readAsText(file);
      };
      $("fir-date").onchange = function () { if (this.value) { ui.fir.date = this.value; render(); } };
      $("fir-to").onchange = function () { ui.fir.to = this.value; render(); };
      $("fir-form").onsubmit = function (e) { e.preventDefault(); };
      $("fir-copy").onclick = function () {
        var text = F.script(firPlan()), ta = $("fir-script"), b = this;
        ta.value = text;
        var shown = function () { ta.hidden = false; ta.focus(); ta.select(); api.say($("fir-msg"), "Copy the script from the box above (it's selected).", false); };
        try {
          navigator.clipboard.writeText(text).then(function () { b.textContent = "Copied"; setTimeout(function () { b.textContent = "Copy pull script"; }, 2000); }, shown);
        } catch (e) { shown(); }
      };
      $("fir-file").onchange = function () {
        var file = this.files && this.files[0];
        if (!file) return;
        var rd = new FileReader();
        rd.onload = function () {
          try {
            ui.fir.result = F.compare(F.parseCsv(rd.result), api);
            ui.fir.error = "";
          } catch (er) { ui.fir.result = null; ui.fir.error = er.message; }
          ui.fir.open = true;
          render();
        };
        rd.readAsText(file);
      };
      card.addEventListener("click", function (e) {
        var k = e.target.closest("[data-ckey]");
        if (k) { e.preventDefault(); open(k.dataset.ckey); }
      });
    }
    // Redraws just the counts, table and pager, so typing in the search box keeps focus.
    function drawRoster() {
      if (!$("card-table")) return;
      var cols = visibleCols(), rows = rosterRows(), per = ui.per, pages = per ? Math.max(1, Math.ceil(rows.length / per)) : 1;
      loadNeeds(cols);
      if (ui.page >= pages) ui.page = pages - 1;
      var shown = per ? rows.slice(ui.page * per, ui.page * per + per) : rows;
      var t = api.today(), st = { full: 0 };
      rows.forEach(function (p) { var c = api.statusFor(p.pos, t); st[c || "full"] = (st[c || "full"] || 0) + 1; });
      $("card-sum").innerHTML = "<b>" + rows.length + "</b> " + (ui.rank ? esc(ui.rank) + (rows.length === 1 ? "" : "s") : rows.length === 1 ? "person" : "people") +
        " · " + st.full + " full duty" + ["VA", "S", "D", "WE", "TR"].filter(function (c) { return st[c]; }).map(function (c) { return " · " + c + " " + st[c]; }).join("");
      $("card-table").innerHTML = rows.length ? '<table class="list roster-t"><thead><tr>' + cols.map(function (c) {
        var on = ui.sort.key === c.key;
        return '<th scope="col"' + (c.key === "name" ? ' class="sticky"' : "") + (c.nosort ? "" : ' aria-sort="' + (on ? (ui.sort.dir > 0 ? "ascending" : "descending") : "none") + '"') + ">" +
          (c.nosort ? esc(c.label) : '<button type="button" class="sort' + (on ? " on" : "") + '" data-csort="' + c.key + '">' + esc(c.label) + (on ? (ui.sort.dir > 0 ? " ▲" : " ▼") : "") + "</button>") + "</th>";
      }).join("") + "</tr></thead><tbody>" + shown.map(function (p) {
        return "<tr>" + cols.map(function (c) {
          var v = c.html ? c.html(p) : esc(c.get(p) == null ? "" : c.get(p));
          return "<td" + (c.key === "name" ? ' class="sticky"' : c.num ? ' class="num"' : "") + ">" + v + "</td>";
        }).join("") + "</tr>";
      }).join("") + "</tbody></table>" : '<p class="hint">Nobody matches.</p>';
      var from = rows.length ? ui.page * (per || rows.length) + 1 : 0, to = per ? Math.min(rows.length, (ui.page + 1) * per) : rows.length;
      $("card-pager").innerHTML = pages > 1 ? btn("‹ Prev", 'data-cpage="-1"' + (ui.page ? "" : " disabled")) + " <span>" + from + "–" + to + " of " + rows.length + "</span> " +
        btn("Next ›", 'data-cpage="1"' + (ui.page < pages - 1 ? "" : " disabled")) : "";
    }
    function wireRoster() {
      var el = $("card-detail");
      wireFir();
      $("card-q").oninput = function () { ui.q = this.value; ui.page = 0; drawRoster(); };
      $("card-search").onsubmit = function (e) { e.preventDefault(); };
      $("card-per").onchange = function () { ui.per = +this.value; ui.page = 0; drawRoster(); };
      if ($("card-backup")) $("card-backup").onclick = function () {
        var x = this;
        x.disabled = true;
        api.say($("card-backup-msg"), "Preparing…");
        backend().saveBackup().then(function (r) {
          x.disabled = false;
          api.say($("card-backup-msg"), "Saved " + r.records + " records from " + r.collections + " collections.");
        }, function (er) { x.disabled = false; api.say($("card-backup-msg"), er.message, true); });
      };
      $("card-cols-btn").onclick = function () { ui.chooser = !ui.chooser; $("card-cols").hidden = !ui.chooser; this.setAttribute("aria-expanded", ui.chooser); };
      $("card-cols-x").onclick = function () { ui.chooser = false; $("card-cols").hidden = true; $("card-cols-btn").setAttribute("aria-expanded", "false"); };
      $("card-cols-reset").onclick = function () { ui.cols = null; try { api.store("card-cols", ""); } catch (e) { /* storage unavailable */ } render(); };
      el.querySelectorAll("[data-ccol]").forEach(function (x) {
        x.onchange = function () {
          var k = x.dataset.ccol;
          ui.cols = COLUMNS.map(function (c) { return c.key; }).filter(function (c) { return c === k ? x.checked : ui.cols.indexOf(c) !== -1; });
          api.store("card-cols", JSON.stringify(ui.cols));
          drawRoster();
        };
      });
      el.querySelectorAll("[data-crank]").forEach(function (x) {
        x.onclick = function () { ui.rank = x.dataset.crank; ui.page = 0; render(); };
      });
      // Table clicks (the table is redrawn without re-wiring, so delegate).
      $("card-table").onclick = function (e) {
        var s = e.target.closest("[data-csort]"), k = e.target.closest("[data-ckey]");
        if (s) {
          ui.sort = { key: s.dataset.csort, dir: ui.sort.key === s.dataset.csort ? -ui.sort.dir : 1 };
          drawRoster();
        } else if (k) open(k.dataset.ckey);
      };
      $("card-table").onchange = function (e) {
        var sel = e.target.closest("[data-cstatus]");
        if (sel) setStatus(sel.dataset.cstatus, sel.value, el.querySelector('[data-cstatus-msg="' + sel.dataset.cstatus + '"]'));
      };
      $("card-pager").onclick = function (e) {
        var b = e.target.closest("[data-cpage]");
        if (b) { ui.page += +b.dataset.cpage; drawRoster(); }
      };
    }

    /* ---------- Render ---------- */
    function render() {
      var el = $("card-detail");
      if (!el) return;
      var b = backend();
      if (!b || !b.update || !b.canAdmin()) { el.innerHTML = '<div class="empty">Only admins can open employee cards.</div>'; return; }
      var p = ui.key ? byPos()[ui.key] : null;
      if (!p) {
        visibleCols();
        el.innerHTML = rosterHtml();
        wireRoster();
        drawRoster();
        return;
      }
      loadNeeds([{ needs: "profiles" }]); // the academy class in the identity section
      el.innerHTML = '<div class="card-back">' + btn("‹ Back to roster", 'id="card-back"') + "</div>" + cardHtml(p);
      $("card-back").onclick = function () { ui.key = null; ui.edit = null; render(); el.scrollIntoView({ block: "start" }); };
      wire(p);
    }

    function cardHtml(p) {
      var t = api.today(), tIso = todayIso(), key = p.pos;
      var s = api.day(p, t), st = api.statusFor(key, t), tour = api.tourOn(p, t);
      var cv = covers(key).sort(byStartDesc);
      var moves = cv.filter(function (c) { return c.coverKey === key && M.isMove(c); });
      var mine = cv.filter(function (c) { return c.coverKey === key && !M.isMove(c); });
      var inSeat = cv.filter(function (c) { return c.targetPos === key && c.coverKey !== key; });
      var sts = statuses(key).sort(byStartDesc), tcs = tourChanges(key).sort(byStartDesc);
      var nowLine = st ? api.statusPill(st) + " " + esc(api.STATUS_LABEL[st]) : s ? (s.acting ? esc(api.kindWord(s.acting)) + " at " : "Working at ") + esc(s.co || api.home(p)) : "Off today";

      var head = '<div class="card card-head"><div><h2>' + esc(p.name) + "</h2>" +
        '<div class="hint">' + esc(p.title) + (p.added ? "" : " · " + esc(key)) + (tour ? " · Tour " + tour : "") + (p.emplId ? " · " + esc(p.emplId) : "") +
          (profile(p).classNo ? " · " + esc(root.TourMath.classLabel(profile(p).classNo)) + " class" : "") + "</div>" +
        "<div>Today: " + nowLine + "</div></div>" +
        '<div class="acts">' + btn("Schedule page", 'data-cgo="' + esc(key) + '"') + "</div></div>";

      // 1. Identity
      var o0 = p.added ? null : api.orig(key), ov = p.added ? null : api.overrideFor(key);
      var staleOv = !p.added && !ov && (recs().rosterOverrides || []).some(function (x) { return x.id === key; });
      var idBody = '<form class="edit" id="ci-form" novalidate>' +
        '<div class="row"><label>Name<input type="text" id="ci-name" maxlength="80" value="' + esc(p.name) + '"></label>' +
        "<label>Rank<select id=\"ci-rank\">" + api.RANKS.map(function (r) { return "<option" + (r === p.rank ? " selected" : "") + ">" + esc(r) + "</option>"; }).join("") + "</select></label>" +
        '<label>Employee ID<input type="text" id="ci-id" maxlength="6" placeholder="e.g. LE1234" autocomplete="off" value="' + esc(p.emplId || "") + '"></label>' +
        '<label>Class<input type="number" id="ci-class" min="1" max="999" inputmode="numeric" placeholder="' + (api.profiles() ? "e.g. 137" : "Loading…") + '"' +
          (api.profiles() ? "" : " disabled") + ' value="' + esc(profile(p).classNo || "") + '"></label></div>' +
        (p.added ? '<div class="row"><label>Apparatus<input type="text" id="ci-co" maxlength="6" placeholder="e.g. E10, or blank" value="' + esc(p.company || "") + '"></label>' +
          '<label>Tour<select id="ci-tour"><option value="">No tour</option>' + api.tourOptions(p.tour || 0) + "</select></label></div>" +
          '<p class="hint">Added person, not on the vacancy list. Give both an apparatus and a tour, or neither.</p>'
          : '<p class="hint">Vacancy list: ' + esc(o0.name) + " · " + esc(o0.rank) + " · ID " + esc(o0.emplId || "not on file") +
            ". Changing the rank moves this seat to that rank on Projection and Staffing and changes who can trade with it. " +
            "Leave the ID blank to use the file's.</p>") +
        (staleOv ? '<p class="hint err">An older override for this seat no longer applies: the vacancy list has someone new here.</p>' : "") +
        '<div class="row"><button class="btn primary" type="submit">Save identity</button>' +
        (ov || staleOv ? " " + btn("Reset to vacancy list", 'id="ci-reset"') : "") + msgEl("ci-msg") + "</div></form>";

      // 2. Own seat and moves
      var own = moves.filter(function (c) { return c.start <= tIso && live(c); })[0];
      var seatBody = "<p>" + (own ? "Owns <b>" + esc(api.slotLabel(own.targetPos)) + "</b> since " + esc(when(own.start))
        : p.added ? (p.company ? "Added at " + esc(p.company) + (p.tour ? ", Tour " + p.tour : "") : "No own seat") : "Owns <b>" + esc(p.title) + " " + esc(key) + "</b> (vacancy list)") + "</p>" +
        list(moves.map(function (c) { return recRow("seat", "covers", c, coverLine(c, key), p); }), "No moves recorded.") +
        api.coverForm(p, null, "km", { moveOnly: true });

      // 3. Current assignment
      var cur = mine.filter(live);
      var asgBody = list(cur.map(function (c) { return recRow("asg", "covers", c, coverLine(c, key), p); }), "In their own seat. No current or upcoming cover.") +
        (inSeat.filter(live).length ? '<h4 class="sub-h">Others in this seat</h4>' + list(inSeat.filter(live).map(function (c) { return recRow("asg", "covers", c, coverLine(c, key), p); }), "") : "") +
        api.coverForm(p, null, "kc", { move: false });

      // 4. Leave and statuses (current and upcoming; older ones are in History)
      var curSt = sts.filter(live);
      var leaveBody = list(curSt.map(function (x) { return recRow("leave", "statuses", x, statusLine(x), p); }), "No current or upcoming leave.") +
        api.statusForm(p, null, "ks");

      // 5. Tour changes
      var tourBody = p.added ? '<p class="hint">An added person\'s tour is under Identity.</p>' :
        "<p>Tour " + esc(tour) + " today.</p>" + list(tcs.map(function (c) { return recRow("tour", "tourChanges", c, tourLine(c), p); }), "No tour changes.") +
        api.tourForm(p, null, "kt");

      // 6. Cell number (staff list, admins only)
      var c = api.contacts()[key] || {};
      var cellBody = '<form class="edit" id="cc-form" novalidate><p class="hint">From the staff list. Only admins ever receive it; it is never in the view-only link or the repository.</p>' +
        (c.phoneMobile && !c.staffList ? '<p>Their own contact: ' + esc(c.phoneMobile) + (c.shared ? " (shared)" : " (not shared)") + "</p>" : "") +
        '<div class="row"><label>Cell<input type="tel" id="cc-cell" maxlength="25" placeholder="(415) 555-0100" value="' + esc(c.staffList ? root.TourMath.showCell(c.phoneMobile) : "") + '"></label></div>' +
        '<div class="row"><button class="btn primary" type="submit">Save cell</button>' + (c.staffList ? " " + btn("Clear", 'id="cc-clear"') : "") + msgEl("cc-msg") + "</div></form>";

      // 7. "This is me" claim
      var claimBody = claimHtml(key);

      // 8. Corrections
      var fx = fixes(key).sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); });
      var F = api.fix();
      var fixBody = list(fx.map(function (x) {
        var about = x.aboutKey === key ? "" : "About " + esc(nameOf(x.aboutKey)) + ": ";
        return "<li><div>" + about + esc(F.summary(x)) + (x.note ? '<div class="hint">“' + esc(x.note) + "”</div>" : "") +
          '<div class="hint">' + (x.byKey === key ? "Sent by them" : "From " + esc(x.byName || (x.byKey ? nameOf(x.byKey) : "a member"))) + " · " + esc(when(x.createdAt)) +
          " · " + esc(x.state) + (x.reason ? ": " + esc(x.reason) : "") + "</div></div>" +
          '<div class="acts">' + (x.state === "open" ? btn("Apply", 'data-cfix="apply" data-id="' + esc(x.id) + '"', "primary") + btn("Dismiss", 'data-cfix="dismissed" data-id="' + esc(x.id) + '"')
            : btn("Reopen", 'data-cfix="open" data-id="' + esc(x.id) + '"')) + btn("Delete", 'data-cfix="delete" data-id="' + esc(x.id) + '"') + "</div></li>";
      }), "No corrections about or from them.") + msgEl("cf-msg");

      // 9. History: every record touching the person
      var hist = historyItems(p);
      var histBody = list(hist.map(function (h) { return h.row; }), "Nothing recorded.");

      var nCur = cur.length;
      return head +
        section("id", "Identity", esc(p.rank) + (p.emplId ? " · " + esc(p.emplId) : " · no ID") + (ov ? " · edited" : ""), idBody) +
        section("seat", "Own seat and moves", moves.length ? moves.length + (moves.length === 1 ? " move" : " moves") : "No moves", seatBody, !api.isPhone()) +
        section("asg", "Current assignment", nCur ? esc(api.kindWord(cur[0])) + " " + esc((byPos()[cur[0].targetPos] || {}).company || cur[0].targetPos) : "Own seat", asgBody, !api.isPhone()) +
        section("leave", "Leave and statuses", curSt.length ? curSt.map(function (x) { return esc(x.code); }).join(" · ") : "None", leaveBody, !api.isPhone()) +
        section("tour", "Tour changes", p.added ? "—" : "Tour " + esc(tour) + (tcs.length ? " · " + tcs.length + " change" + (tcs.length === 1 ? "" : "s") : ""), tourBody, !api.isPhone()) +
        section("cell", "Cell number", c.staffList ? "On file" : "None", cellBody, !api.isPhone()) +
        section("claim", "“This is me” claim", claimSum(key), claimBody, !api.isPhone()) +
        section("fixes", "Corrections", fx.filter(function (x) { return x.state === "open"; }).length + " open of " + fx.length, fixBody, !api.isPhone()) +
        section("hist", "History", hist.length + (hist.length === 1 ? " record" : " records"), histBody, !api.isPhone());
    }

    // The claim: on the shared page a `members` record; on the server the account linked to the position.
    function claimSum(key) {
      if (serverMode()) { var u = linkedUsers(key); return u ? (u.length ? "Linked" : "Not linked") : "…"; }
      return claims(key).length ? "Claimed" : "Not claimed";
    }
    function linkedUsers(key) {
      if (!ui.users) {
        if (!ui.usersLoading) {
          ui.usersLoading = true;
          backend().adminUsers().then(function (us) { ui.users = us; ui.usersLoading = false; render(); }, function () { ui.users = []; ui.usersLoading = false; });
        }
        return null;
      }
      return ui.users.filter(function (u) { return u.pos === key; });
    }
    function claimHtml(key) {
      var undo = ui.undo && ui.undo.key === key ? '<p>Claim removed. ' + btn("Undo", 'id="cl-undo"', "primary") + "</p>" : "";
      if (serverMode()) {
        var us = linkedUsers(key);
        if (!us) return '<p class="hint">Loading accounts…</p>';
        return undo + list(us.map(function (u) {
          return "<li><div><b>" + esc(u.name || u.googleEmail) + '</b> <span class="hint">' + esc(u.googleEmail) + " · " + esc(u.role) + " · " + esc(u.status) + "</span></div>" +
            '<div class="acts">' + btn("Unlink", 'data-cunlink="' + esc(u.id) + '"') + "</div></li>";
        }), "No account is linked to this person. Link one on the Admin page.") + msgEl("cl-msg");
      }
      return undo + list(claims(key).map(function (m) {
        return "<li><div>Claimed " + esc(when(m.claimedAt)) +
          (m.confirmedStation || m.confirmedTour ? " · says " + esc(m.confirmedStation || "?") + ", Tour " + esc(m.confirmedTour || "?") : "") +
          (m.emplId ? " · typed ID " + esc(m.emplId) : "") + (m.verifiedAt ? " · verified " + esc(when(m.verifiedAt)) : " · not verified") + "</div>" +
          '<div class="acts">' + btn("Remove claim", 'data-cunclaim="' + esc(m.id) + '"') + "</div></li>";
      }), "Nobody has said “This is me” for this person.") + msgEl("cl-msg");
    }

    function historyItems(p) {
      var key = p.pos, out = [];
      statuses(key).forEach(function (x) { out.push({ at: x.start, row: recRow("hist", "statuses", x, statusLine(x), p) }); });
      tourChanges(key).forEach(function (x) { out.push({ at: x.effective, row: recRow("hist", "tourChanges", x, tourLine(x), p) }); });
      covers(key).forEach(function (x) { out.push({ at: x.start, row: recRow("hist", "covers", x, '<span class="st st-A">' + (x.coverKey === key ? (M.isMove(x) ? "MV" : "AC") : "CV") + "</span> " + coverLine(x, key), p) }); });
      claims(key).forEach(function (m) {
        out.push({ at: m.claimedAt, row: "<li><div><b>Said “This is me”</b> " + esc(when(m.claimedAt)) + "</div>" +
          '<div class="acts">' + btn("Remove claim", 'data-cunclaim="' + esc(m.id) + '"') + "</div></li>" });
      });
      fixes(key).forEach(function (x) {
        out.push({ at: x.createdAt, row: "<li><div><b>Correction</b> " + esc(api.fix().summary(x)) + ' <span class="hint">' + esc(when(x.createdAt)) + " · " + esc(x.state) + "</span></div>" +
          '<div class="acts">' + btn("Delete", 'data-cfix="delete" data-id="' + esc(x.id) + '"') + "</div></li>" });
      });
      var ov = !p.added && (recs().rosterOverrides || []).filter(function (o) { return o.id === key; })[0];
      if (ov) {
        out.push({ at: ov.updatedAt, row: "<li><div><b>Identity edited</b> " + esc([ov.name, ov.rank, ov.emplId].filter(Boolean).join(" · ")) +
          ' <span class="hint">' + esc(when(ov.updatedAt)) + "</span></div>" + '<div class="acts">' + btn("Reset", 'data-creset="1"') + "</div></li>" });
      }
      if (p.added) {
        var rec = (recs().people || []).filter(function (x) { return "person:" + x.id === key; })[0];
        if (rec) out.push({ at: rec.createdAt, row: "<li><div><b>Added to the roster</b> " + esc(when(rec.createdAt)) + (rec.note ? '<div class="hint">' + esc(rec.note) + "</div>" : "") + "</div>" +
          '<div class="acts">' + btn("Remove this person", 'data-cdel="people" data-id="' + esc(rec.id) + '"') + "</div></li>" });
      }
      return out.sort(function (a, b) { return String(b.at || "").localeCompare(String(a.at || "")); });
    }

    /* ---------- Wiring ---------- */
    function confirmTap(b, label) {
      if (b.dataset.confirm === "1") return true;
      b.dataset.confirm = "1";
      b.textContent = label;
      b.classList.add("danger");
      return false;
    }
    function fail(b) { return function (e) { b.disabled = false; b.textContent = e.message; }; }
    function rerender() { api.renderAll(true); }

    function wire(p) {
      var el = $("card-detail"), b = backend(), key = p.pos;
      el.querySelectorAll("details[data-cfold]").forEach(function (d) {
        d.addEventListener("toggle", function () { ui.folds = ui.folds || {}; ui.folds[d.dataset.cfold] = d.open; });
      });
      el.querySelectorAll("[data-cgo]").forEach(function (x) { x.onclick = function () { api.choosePerson(x.dataset.cgo); }; });
      el.querySelectorAll("[data-cedit]").forEach(function (x) {
        x.onclick = function () { ui.edit = ui.edit === x.dataset.cedit ? null : x.dataset.cedit; render(); };
      });
      el.querySelectorAll("[data-cend]").forEach(function (x) {
        x.onclick = function () { x.disabled = true; b.endCover(x.dataset.cend, todayIso()).then(rerender, fail(x)); };
      });
      el.querySelectorAll("[data-cdel]").forEach(function (x) {
        x.onclick = function () {
          if (!confirmTap(x, "Confirm delete")) return;
          x.disabled = true;
          var kind = x.dataset.cdel;
          b.remove(kind, x.dataset.id).then(function () {
            if (kind === "people") { ui.key = null; ui.q = ""; }
            ui.edit = null;
            rerender();
          }, fail(x));
        };
      });
      // Forms: add (km = move, kc = cover, ks = status, kt = tour) and the one open edit form (kh).
      api.wireForms(p, "km", null);
      api.wireForms(p, "kc", null);
      api.wireForms(p, "ks", null);
      api.wireForms(p, "kt", null);
      if (ui.edit) {
        var parts = ui.edit.split("|"), kind = parts[1], id = parts[2];
        var rec = (recs()[kind] || []).filter(function (r) { return r.id === id; })[0];
        if (rec) api.wireForms(kind === "covers" ? coverer(rec) : p, "kh", rec, function () { ui.edit = null; }, function () { ui.edit = null; render(); });
      }
      wireIdentity(p);
      wireCell(key);
      wireClaim(key);
      wireFixes();
    }

    function wireIdentity(p) {
      var f = $("ci-form"), b = backend(), key = p.pos;
      if (!f) return;
      if ($("ci-reset")) $("ci-reset").onclick = function () {
        api.say($("ci-msg"), "Saving…");
        b.setOverride(key, null).then(rerender, function (e) { api.say($("ci-msg"), e.message, true); });
      };
      f.onsubmit = function (e) {
        e.preventDefault();
        var msg = $("ci-msg"), name = $("ci-name").value.trim(), rank = $("ci-rank").value, empl = $("ci-id").value.trim().toUpperCase();
        if (name.length < 2) return api.say(msg, "Enter the name, e.g. Lester,D.", true);
        if (empl && !api.ID_RE.test(empl)) return api.say(msg, "Employee ID is two letters and four digits, e.g. LE1234.", true);
        var other = empl && (api.byId()[empl] || []).filter(function (o) { return o.pos !== key; })[0];
        if (other) return api.say(msg, "Employee ID " + empl + " is already on " + other.name + " (" + other.title + ").", true);
        var cls = $("ci-class").value.trim();
        if (cls && !/^[1-9]\d{0,2}$/.test(cls)) return api.say(msg, "Class is the academy class number, e.g. 137.", true);
        api.say(msg, "Saving…");
        var done = function () { rerender(); api.say($("ci-msg"), "Saved."); }, err = function (er) { api.say($("ci-msg"), er.message, true); };
        // The class lives in the person's profile (admins only), saved first; the dates there are kept.
        var classNo = cls ? +cls : null, first = Promise.resolve();
        if (api.profiles() && classNo !== (profile(p).classNo || null)) {
          first = b.setProfile(key, { classNo: classNo }).then(function () {
            api.profiles()[key] = Object.assign({ key: key, birthDate: null, hireDate: null }, api.profiles()[key], { classNo: classNo });
          });
        }
        if (p.added) {
          var co = $("ci-co").value.trim().toUpperCase(), tour = $("ci-tour").value;
          if (co && !api.companyOk(co)) return api.say(msg, "Apparatus must be a company on the roster, like E10.", true);
          if (!co !== !tour) return api.say(msg, "Pick both an apparatus and a tour, or neither.", true);
          return first.then(function () { return b.update("people", key.slice(7), { name: name, rank: rank, emplId: empl || null, company: co || null, tour: tour ? +tour : null }); }).then(done, err);
        }
        // Roster seat: keep only what differs from the files, tied to the holder it was made for.
        var o0 = api.orig(key);
        var o = { name: name !== o0.name ? name : null, rank: rank !== o0.rank ? rank : null, emplId: empl && empl !== o0.emplId ? empl : null, forName: o0.name };
        first.then(function () { return b.setOverride(key, o.name || o.rank || o.emplId ? o : null); }).then(done, err);
      };
    }

    function wireCell(key) {
      var f = $("cc-form"), b = backend();
      if (!f) return;
      f.onsubmit = function (e) {
        e.preventDefault();
        // Saved as +14155550100 (TourMath.normCell), so invites and cell sign-in match it.
        var cell = root.TourMath.normCell($("cc-cell").value), msg = $("cc-msg");
        if (!cell) return api.say(msg, "Enter a 10-digit number.", true);
        api.say(msg, "Saving…");
        b.setCell(key, cell).then(function () { rerender(); api.say($("cc-msg"), "Saved."); }, function (er) { api.say($("cc-msg"), er.message, true); });
      };
      if ($("cc-clear")) $("cc-clear").onclick = function () {
        if (!confirmTap(this, "Confirm clear")) return;
        b.setCell(key, null).then(rerender, fail(this));
      };
    }

    function wireClaim(key) {
      var el = $("card-detail"), b = backend();
      el.querySelectorAll("[data-cunclaim]").forEach(function (x) {
        x.onclick = function () {
          if (!confirmTap(x, "Confirm remove")) return;
          var m = claims(key).filter(function (c) { return c.id === x.dataset.cunclaim; })[0];
          x.disabled = true;
          b.unclaim(x.dataset.cunclaim).then(function () { ui.undo = m ? { key: key, member: m } : null; rerender(); }, fail(x));
        };
      });
      el.querySelectorAll("[data-cunlink]").forEach(function (x) {
        x.onclick = function () {
          if (!confirmTap(x, "Confirm unlink")) return;
          x.disabled = true;
          var id = x.dataset.cunlink;
          b.adminAction(id, { action: "unlink" }).then(function () { ui.undo = { key: key, accountId: id }; ui.users = null; rerender(); }, fail(x));
        };
      });
      if ($("cl-undo")) $("cl-undo").onclick = function () {
        var u = ui.undo, x = this;
        x.disabled = true;
        var p2 = u.accountId ? b.adminAction(u.accountId, { action: "link", pos: key }) : b.restoreMember(u.member);
        p2.then(function () { ui.undo = null; ui.users = null; rerender(); }, fail(x));
      };
    }

    function wireFixes() {
      var el = $("card-detail"), b = backend();
      el.querySelectorAll("[data-cfix]").forEach(function (x) {
        x.onclick = function () {
          var act = x.dataset.cfix, id = x.dataset.id;
          if (act === "apply") return api.fix().apply(id);
          if (act === "delete" && !confirmTap(x, "Confirm delete")) return;
          x.disabled = true;
          (act === "delete" ? b.deleteCorrection(id) : b.handleCorrection(id, act)).then(rerender, fail(x));
        };
      });
      el.querySelectorAll("[data-creset]").forEach(function (x) {
        x.onclick = function () {
          if (!confirmTap(x, "Confirm reset")) return;
          b.setOverride(ui.key, null).then(rerender, fail(x));
        };
      });
    }

    return { render: render, open: open };
  };
})(typeof window !== "undefined" ? window : globalThis);
