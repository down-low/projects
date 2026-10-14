/* Dashboard (staffing summary by apparatus, stat summary), "6 of 9" tour intersections, Documents menu.
 * window.DashboardViews(api) -> {renderDash, renderSix, renderDocs}. `api` is supplied by app.js.
 */
(function (root) {
  "use strict";
  var M = root.TourMath;

  root.DashboardViews = function (api) {
    var $ = api.$, esc = api.esc;
    var dash = { sort: "total", dir: 1, q: "", short: false, open: {}, editing: null, msg: "" };
    var defaultsCache = { key: null, map: null };
    var statsReq = 0;

    /* ---------- Required staffing ---------- */
    // Most common number of scheduled seats at each apparatus across one full 31-day cycle.
    function defaultRequired() {
      var key = api.recsVersion();
      if (defaultsCache.key === key) return defaultsCache.map;
      var counts = {}, start = api.today();
      for (var i = 0; i < 31; i++) {
        var d = api.addDays(start, i), perCo = {};
        api.slots().forEach(function (p) {
          var s = api.shift(p, d);
          if (!s) return;
          var co = s.co || api.home(p);
          perCo[co] = (perCo[co] || 0) + 1;
        });
        Object.keys(perCo).forEach(function (co) {
          var c = counts[co] || (counts[co] = {});
          c[perCo[co]] = (c[perCo[co]] || 0) + 1;
        });
      }
      var map = {};
      Object.keys(counts).forEach(function (co) {
        var best = 0, bestN = -1;
        Object.keys(counts[co]).forEach(function (n) {
          var f = counts[co][n];
          if (f > bestN || (f === bestN && +n > best)) { best = +n; bestN = f; }
        });
        map[co] = best;
      });
      defaultsCache = { key: key, map: map };
      return map;
    }
    function overrides() {
      var o = {};
      (api.recs().staffing || []).forEach(function (x) { o[x.company] = x.required; });
      return o;
    }

    /* ---------- Per-apparatus summary for one day ---------- */
    function summarize(d) {
      var rows = api.dayRows(d), by = {}, defs = defaultRequired(), over = overrides();
      function bucket(co) {
        return by[co] || (by[co] = { co: co, people: [], short: [], seats: 0 });
      }
      rows.forEach(function (r) {
        var b = bucket(r.co);
        if (!r.acting) b.seats++;
        if (r.name && !r.off) { b.people.push(r); return; }
        if (r.acting) { b.short.push(r.name + " (covering) · " + api.STATUS_LABEL[r.status]); return; }
        var covered = r.coveredBy && rows.some(function (x) { return x.acting === r.coveredBy && !x.off; });
        if (covered) return;
        if (!r.name) b.short.push("Vacant seat · " + r.slot.title + " (" + r.slot.pos + ")");
        else if (r.status) b.short.push(r.name + " · " + api.STATUS_LABEL[r.status] + " · not covered");
        else if (r.away) b.short.push(r.name + " · acting at " + ((api.byPos()[r.away.targetPos] || {}).company || r.away.targetPos));
        else b.short.push(r.name + " · off");
      });
      Object.keys(defs).forEach(function (co) { bucket(co); });
      return Object.keys(by).map(function (co) {
        var b = by[co];
        var required = over[co] != null ? over[co] : defs[co] != null ? defs[co] : b.seats;
        var working = b.people.length, total = working - required;
        return { co: co, required: required, overridden: over[co] != null, defaultRequired: defs[co], working: working,
          extra: Math.max(0, total), missing: Math.min(0, total), total: total, people: b.people, short: b.short };
      });
    }

    function stats(d) {
      var isoD = api.iso(d), recs = api.recs(), counts = { VA: 0, S: 0, D: 0 }, named = 0, full = 0;
      api.people().forEach(function (p) {
        named++;
        var st = M.statusFor(p.pos, d, recs.statuses);
        if (st) counts[st]++; else full++;
      });
      var acting = recs.covers.filter(function (c) { return c.start <= isoD && (!c.end || c.end >= isoD); }).length;
      var open = api.data().filter(function (p) { return p.open; }).length;
      var vacant = api.data().filter(function (p) { return !p.name; }).length;
      return { named: named, full: full, VA: counts.VA, S: counts.S, D: counts.D, acting: acting, open: open, vacant: vacant };
    }

    /* ---------- Dashboard ---------- */
    function renderDash() {
      var d = api.state().dashDate;
      var out = $("dash-detail");
      $("dash-date").value = api.iso(d);
      var all = summarize(d);
      var working = all.reduce(function (a, r) { return a + r.working; }, 0);
      var needing = all.reduce(function (a, r) { return a + r.missing; }, 0);
      var q = dash.q.trim().toUpperCase().replace(/\s+/g, "");
      var list = all.filter(function (r) {
        if (dash.short && r.total >= 0) return false;
        if (!q) return true;
        var m = /^([A-Z]+)0*(\d+)$/.exec(q), c = /^([A-Z]+)0*(\d+)$/.exec(r.co);
        return m && c ? m[1] === c[1] && +m[2] === +c[2] : r.co.toUpperCase().indexOf(q) !== -1;
      });
      list.sort(function (a, b) {
        var k = dash.sort, x = a[k], y = b[k];
        var cmp = k === "co" ? api.coKey(x).localeCompare(api.coKey(y)) : x - y;
        return cmp * dash.dir || api.coKey(a.co).localeCompare(api.coKey(b.co));
      });
      var canAdmin = api.backend() && api.backend().canAdmin();
      var st = stats(d);

      var cols = [["co", "Apparatus"], ["required", "Required"], ["working", "Working"], ["extra", "Extra"], ["missing", "Missing"], ["total", "Total"]];
      var head = "<tr>" + cols.map(function (c) {
        var on = dash.sort === c[0];
        return '<th scope="col" aria-sort="' + (on ? (dash.dir > 0 ? "ascending" : "descending") : "none") + '"><button class="sort' + (on ? " on" : "") +
          '" data-sort="' + c[0] + '">' + c[1] + (on ? (dash.dir > 0 ? " ▲" : " ▼") : "") + "</button></th>";
      }).join("") + "</tr>";
      var body = list.map(function (r) {
        var open = !!dash.open[r.co];
        var req = dash.editing === r.co
          ? '<form class="req-form" data-co="' + esc(r.co) + '"><input type="number" min="0" max="30" value="' + r.required + '" aria-label="Required staffing for ' + esc(r.co) + '">' +
            '<button class="btn tiny" type="submit">Save</button>' + (r.overridden ? '<button class="btn tiny" type="button" data-reset="' + esc(r.co) + '">Default (' + r.defaultRequired + ")</button>" : "") +
            '<button class="btn tiny" type="button" data-cancel="1">Cancel</button></form>'
          : (canAdmin ? '<button class="linkish req" data-edit="' + esc(r.co) + '" title="Change required staffing">' + r.required + "</button>" : r.required) +
            (r.overridden ? ' <span class="hint" title="Set by an admin; default ' + r.defaultRequired + '">set</span>' : "");
        var row = '<tr class="dash-row' + (r.total < 0 ? " neg" : r.total > 0 ? " pos" : "") + (open ? " open" : "") + '" data-co="' + esc(r.co) + '">' +
          '<th scope="row"><button class="linkish drill" aria-expanded="' + open + '" data-drill="' + esc(r.co) + '">' + (open ? "▾ " : "▸ ") + esc(r.co) + "</button></th>" +
          '<td class="num">' + req + '</td><td class="num">' + r.working + '</td><td class="num">' + r.extra + '</td><td class="num">' + r.missing +
          '</td><td class="num total">' + (r.total > 0 ? "+" : "") + r.total + "</td></tr>";
        if (!open) return row;
        return row + '<tr class="drill-row"><td colspan="6"><div class="drill-grid"><div><h4>Working (' + r.people.length + ")</h4>" +
          (r.people.length ? "<ul>" + r.people.map(function (x) {
            return '<li><button class="linkish" data-pos="' + esc(x.who ? x.who.pos : x.slot.pos) + '">' + esc(x.name) + "</button> " +
              '<span class="hint">' + esc(x.slot.title) + (x.role ? " · " + esc(x.role) : "") + " · T" + x.tour + "</span>" +
              (x.acting ? ' <span class="tag tag-acting">Acting for ' + esc(x.slot.name || "vacant spot") + "</span>" : "") +
              (x.swingCover ? ' <span class="tag">Swing from ' + esc(x.slot.company) + "</span>" : "") +
              (x.slot.added ? ' <span class="tag">Added</span>' : "") + "</li>";
          }).join("") + "</ul>" : '<p class="hint">Nobody scheduled.</p>') + "</div>" +
          "<div><h4>Short or off (" + r.short.length + ")</h4>" + (r.short.length ? "<ul>" + r.short.map(function (t) { return "<li>" + esc(t) + "</li>"; }).join("") + "</ul>"
            : '<p class="hint">No open seats.</p>') + "</div></div></td></tr>";
      }).join("");

      out.innerHTML =
        '<div class="dash-totals"><span>Total Working Staff <b class="pill ok">' + working + "</b></span>" +
        '<span>Positions Needing Staff <b class="pill ' + (needing < 0 ? "bad" : "ok") + '">' + needing + "</b></span>" +
        '<span class="hint">' + esc(api.longDate(d)) + " · watch " + M.watchFor(d) + "</span></div>" +
        '<div class="dash-grid">' +
        '<div class="card stats"><h3>Stats summary</h3><table class="list kv-table"><tbody>' +
        statRow("Full duty", st.full) + statRow("Vacation (VA)", st.VA) + statRow("Sick (S)", st.S) + statRow("Disabled (D)", st.D) +
        statRow("Acting / covering", st.acting) + statRow("Spots open for bid", st.open) + statRow("Vacant seats", st.vacant) +
        '<tr><th scope="row">Average age</th><td class="num" id="st-age">…</td></tr><tr><th scope="row">Average YOS</th><td class="num" id="st-yos">…</td></tr>' +
        "</tbody></table>" + '<p class="hint" id="st-note"></p></div>' +
        '<div class="card summary-card"><div class="cal-head"><h3>Schedule summary</h3>' +
        '<label class="toggle"><input type="checkbox" id="dash-short"' + (dash.short ? " checked" : "") + "> Only short</label></div>" +
        (dash.msg ? '<p class="msg" role="status">' + esc(dash.msg) + "</p>" : "") +
        (list.length ? '<div class="table-wrap"><table class="list dash"><thead>' + head + "</thead><tbody>" + body + "</tbody></table></div>"
          : '<p class="hint">No apparatus matches.</p>') +
        '<p class="hint">Required = the usual number of positions scheduled at that apparatus' + (canAdmin ? " (click a number to change it)" : "") +
        ". Missing counts vacant seats and people off who aren't covered.</p></div></div>";
      dash.msg = "";
      $("dash-short").onchange = function () { dash.short = this.checked; renderDash(); };
      loadStats(d, st.named);
    }
    function statRow(k, v) { return '<tr><th scope="row">' + esc(k) + '</th><td class="num">' + v + "</td></tr>"; }
    function loadStats(d, n) {
      var my = ++statsReq;
      var b = api.backend();
      (b ? b.stats(api.iso(d)) : Promise.resolve(null)).then(function (s) {
        if (my !== statsReq || !$("st-age")) return;
        $("st-age").textContent = s && s.avgAge != null ? s.avgAge.toFixed(1) : "—";
        $("st-yos").textContent = s && s.avgYos != null ? s.avgYos.toFixed(1) : "—";
        $("st-note").textContent = s ? "Ages from " + s.nAge + " and years of service from " + s.nYos + " of " + n + " people with dates on file."
          : "Average age and YOS appear once birth and hire dates are entered.";
      }, function () { if ($("st-age")) { $("st-age").textContent = "—"; $("st-yos").textContent = "—"; } });
    }
    function wireDash() {
      var out = $("dash-detail");
      out.addEventListener("click", function (e) {
        var t = e.target.closest("[data-sort],[data-drill],[data-edit],[data-reset],[data-cancel]");
        if (!t) return;
        if (t.dataset.sort) {
          dash.dir = dash.sort === t.dataset.sort ? -dash.dir : (t.dataset.sort === "co" ? 1 : 1);
          dash.sort = t.dataset.sort;
        } else if (t.dataset.drill) dash.open[t.dataset.drill] = !dash.open[t.dataset.drill];
        else if (t.dataset.edit) dash.editing = t.dataset.edit;
        else if (t.dataset.cancel) dash.editing = null;
        else if (t.dataset.reset) return saveReq(t.dataset.reset, null);
        renderDash();
        if (t.dataset.edit) { var i = document.querySelector(".req-form input"); if (i) i.focus(); }
      });
      out.addEventListener("submit", function (e) {
        var f = e.target.closest(".req-form");
        if (!f) return;
        e.preventDefault();
        var n = parseInt(f.querySelector("input").value, 10);
        if (!(n >= 0 && n <= 30)) { dash.msg = "Required staffing must be a whole number from 0 to 30."; return renderDash(); }
        saveReq(f.dataset.co, n);
      });
      $("dash-q").oninput = function () { dash.q = this.value; renderDash(); };
      $("dash-date").onchange = function () { if (this.value) { api.state().dashDate = api.fromIso(this.value); renderDash(); } };
      $("dash-prev").onclick = function () { api.state().dashDate = api.addDays(api.state().dashDate, -1); renderDash(); };
      $("dash-next").onclick = function () { api.state().dashDate = api.addDays(api.state().dashDate, 1); renderDash(); };
      $("dash-today").onclick = function () { api.state().dashDate = api.today(); renderDash(); };
    }
    function saveReq(co, n) {
      api.backend().setStaffing(co, n).then(function () {
        dash.editing = null;
        dash.msg = n == null ? co + " is back to its default required staffing." : co + " now requires " + n + ".";
        renderDash();
      }, function (er) { dash.msg = er.message; renderDash(); });
    }

    /* ---------- 6 of 9 ---------- */
    function renderSix() {
      var st = api.state(), a = st.sixTour, m = st.sixMonth, out = $("six-detail");
      var days = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate();
      var partners = [];
      for (var b = 1; b <= 31; b++) if (b !== a && M.sharedWatches(a, b).length === 6) partners.push(b);
      function datesShared(x, y) {
        if (y === undefined) { y = x; x = a; }
        var o = [];
        for (var i = 1; i <= days; i++) {
          var w = M.watchFor(new Date(m.getFullYear(), m.getMonth(), i));
          if (M.tourWorks(x, w) && M.tourWorks(y, w)) o.push(i);
        }
        return o;
      }
      function tourSel(id, label, sel) {
        return '<select id="' + id + '" aria-label="' + label + '">' + Array.apply(null, Array(31)).map(function (_, i) {
          return '<option value="' + (i + 1) + '"' + (i + 1 === sel ? " selected" : "") + ">" + (i + 1) + "</option>";
        }).join("") + "</select>";
      }
      // The comparison box: the page's tour (a) against a second tour (sixPair, default its first 6-of-9 partner).
      var pb = st.sixPair || partners[0];
      var both = M.sharedWatches(a, pb), bothDates = datesShared(a, pb);
      var compare = '<div class="card compare"><h3>Compare two tours</h3>' +
        '<div class="cmp-row"><label class="cmp-pick"><span>Tour</span>' + tourSel("six-tour", "First tour", a) + "</label>" +
        '<span class="cmp-amp" aria-hidden="true">&amp;</span>' +
        '<label class="cmp-pick"><span>Tour</span>' + tourSel("six-pair", "Second tour", pb) + "</label>" +
        '<div class="cmp-count" aria-live="polite"><b>' + both.length + "</b><span>of 9 shifts together</span></div></div>" +
        '<div class="cmp-detail">' +
        (pb === a ? '<span class="tag">Same tour</span>' : both.length === 6 ? '<span class="tag tag-acting">6 of 9 partners</span>' : "") +
        '<div class="kv"><span class="k">Shared watches</span><span class="v">' + (both.length ? both.join(" ") : "None") + "</span></div>" +
        '<div class="kv"><span class="k">Together in ' + api.MONTHS[m.getMonth()] + " " + m.getFullYear() + '</span><span class="v">' +
        (bothDates.length ? bothDates.join(", ") : "No days") + "</span></div></div></div>";
      var mine = [];
      for (var w = 1; w <= 31; w++) if (M.tourWorks(a, w)) mine.push(w);
      var cards = partners.map(function (x) {
        var off = ((x - a) % 31 + 31) % 31, label = off > 15 ? "−" + (31 - off) : "+" + off;
        var shared = M.sharedWatches(a, x), ds = datesShared(x);
        return '<div class="card six-card' + (pb === x ? " sel" : "") + '"><div class="six-head"><b>Tour ' + x + '</b><span class="hint">' + label + " days</span></div>" +
          '<div class="kv"><span class="k">Shared watches</span><span class="v">' + shared.join(" ") + "</span></div>" +
          '<div class="kv"><span class="k">Together in ' + api.MONTHS[m.getMonth()].slice(0, 3) + '</span><span class="v">' + (ds.length ? ds.join(", ") : "—") + "</span></div></div>";
      }).join("");
      var matrix = '<table class="six-matrix"><thead><tr><th scope="col"><span class="sr">Tour</span></th>' +
        Array.apply(null, Array(31)).map(function (_, j) { return '<th scope="col">' + (j + 1) + "</th>"; }).join("") + "</tr></thead><tbody>" +
        Array.apply(null, Array(31)).map(function (_, i) {
          var r = i + 1;
          return '<tr><th scope="row">' + r + "</th>" + Array.apply(null, Array(31)).map(function (_, j) {
            var c = j + 1, n = M.sharedWatches(r, c).length;
            var cls = (n === 9 ? "diag" : n === 6 ? "six" : n >= 4 ? "mid" : "") + (r === a ? " cur" : "") + (r === a && c === pb ? " pick" : "");
            return '<td class="' + cls + '" data-a="' + r + '" data-b="' + c + '" title="Tours ' + r + " and " + c + ": " + n + ' of 9 shifts together">' + n + "</td>";
          }).join("") + "</tr>";
        }).join("") + "</tbody></table>";
      out.innerHTML =
        '<div class="controls"><div class="stepper"><button class="btn icon" id="six-prev" aria-label="Previous month">&lsaquo;</button>' +
        '<span class="month-label">' + api.MONTHS[m.getMonth()] + " " + m.getFullYear() + '</span><button class="btn icon" id="six-next" aria-label="Next month">&rsaquo;</button></div></div>' +
        compare +
        '<p class="lede">Tour ' + a + " works watches " + mine.join(" ") + ". These four tours work <b>6 of the same 9</b> shifts with it:</p>" +
        '<div class="six-cards">' + cards + "</div>" +
        '<div class="card"><h3>Shifts in common, every pair of tours</h3><p class="hint">Each cell is how many of the 9 shifts two tours work together. 6 = the "6 of 9" partners. Click a cell to compare that pair above.</p>' +
        '<div class="table-wrap">' + matrix + "</div></div>";
      $("six-tour").onchange = function () { st.sixTour = +this.value; st.sixPair = null; st.sixTouched = true; renderSix(); };
      $("six-pair").onchange = function () { st.sixPair = +this.value; renderSix(); };
      $("six-prev").onclick = function () { st.sixMonth = new Date(m.getFullYear(), m.getMonth() - 1, 1); renderSix(); };
      $("six-next").onclick = function () { st.sixMonth = new Date(m.getFullYear(), m.getMonth() + 1, 1); renderSix(); };
      out.querySelector(".six-matrix").onclick = function (e) {
        var td = e.target.closest("td[data-a]");
        if (!td) return;
        st.sixTour = +td.dataset.a;
        st.sixTouched = true;
        st.sixPair = +td.dataset.b;
        renderSix();
        var box = out.querySelector(".compare");
        if (box && box.scrollIntoView) box.scrollIntoView({ block: "nearest", behavior: "smooth" });
      };
    }

    /* ---------- Documents menu ---------- */
    function renderDocs(list) {
      var ul = $("docs-list");
      if (!list || !list.length) { $("docs-menu").hidden = true; return; }
      $("docs-menu").hidden = false;
      ul.innerHTML = list.map(function (d) {
        return '<li><a href="docs/' + encodeURIComponent(d.file) + '" target="_blank" rel="noopener">' + esc(d.title) +
          '<span class="hint">' + esc(d.ref) + " · PDF</span></a></li>";
      }).join("");
    }

    return { renderDash: renderDash, renderSix: renderSix, renderDocs: renderDocs, wireDash: wireDash, summarize: summarize };
  };
})(window);
