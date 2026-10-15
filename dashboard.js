/* Dashboard (staffing summary by apparatus, stat summary), "6 of 9" tour intersections, Documents menu.
 * window.DashboardViews(api) -> {renderDash, renderSix, renderDocs}. `api` is supplied by app.js.
 */
(function (root) {
  "use strict";
  var M = root.TourMath;
  var Org = root.Organization;

  root.DashboardViews = function (api) {
    var $ = api.$, esc = api.esc;
    var dash = { sort: "co", dir: 1, q: "", short: false, open: {}, editing: null, msg: "", group: "division" };
    var defaultsCache = { key: null, map: null };
    var statsReq = 0;

    /* ---------- Required staffing ---------- */
    // The Daily Balance Report's requirement per apparatus (313 in all); apparatus not in the report fall back
    // to the most common number of scheduled seats there across one full 31-day cycle.
    function reportData() { return api.requiredData() || { apparatus: {} }; }
    function hiddenCo(co) { var w = Org.locate(co); return !!(w && w.division.hidden); }
    function defaultRequired() {
      var key = api.recsVersion();
      if (defaultsCache.key === key) return defaultsCache.map;
      var counts = {}, start = api.today();
      for (var i = 0; i < 31; i++) {
        var d = api.addDays(start, i), perCo = {};
        api.slots().forEach(function (p) {
          var s = api.shift(p, d);
          if (!s) return;
          var co = Org.apparatus(s.co || api.home(p));
          perCo[co] = (perCo[co] || 0) + 1;
        });
        Object.keys(perCo).forEach(function (co) {
          var c = counts[co] || (counts[co] = {});
          c[perCo[co]] = (c[perCo[co]] || 0) + 1;
        });
      }
      var map = {};
      Object.keys(counts).forEach(function (co) {
        // Days with nobody scheduled at this apparatus count as 0 seats.
        var seen = Object.keys(counts[co]).reduce(function (a, n) { return a + counts[co][n]; }, 0);
        if (seen < 31) counts[co][0] = (counts[co][0] || 0) + 31 - seen;
        var best = 0, bestN = -1;
        Object.keys(counts[co]).forEach(function (n) {
          var f = counts[co][n];
          if (f > bestN || (f === bestN && +n > best)) { best = +n; bestN = f; }
        });
        map[co] = best;
      });
      var rep = reportData().apparatus;
      Object.keys(rep).forEach(function (co) { map[co] = rep[co].required; });
      Object.keys(map).forEach(function (co) { if (hiddenCo(co)) delete map[co]; });
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
        if (hiddenCo(r.co)) return;
        var b = bucket(Org.apparatus(r.co));
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
        var covering = b.people.filter(isCovering).length;
        return { co: co, required: required, overridden: over[co] != null, defaultRequired: defs[co], working: working,
          regular: working - covering, covering: covering, open: Math.max(0, -total),
          extra: Math.max(0, total), missing: Math.min(0, total), total: total, people: b.people, short: b.short };
      });
    }

    // Someone filling a seat that isn't their own: a cover assignment, or an added person not on the vacancy list.
    function isCovering(r) { return !!(r.acting || (r.who && r.who.added)); }

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
      if (api.isPhone()) return renderDashPhone(d, out);
      var all = summarize(d);
      function sum(k) { return all.reduce(function (a, r) { return a + r[k]; }, 0); }
      var working = sum("working"), needing = sum("missing"), required = sum("required"), coveringN = sum("covering");
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

      var cols = [["co", dash.group === "division" ? "Division / battalion / apparatus" : dash.group === "battalion" ? "Battalion / apparatus" : "Apparatus"], ["required", "Required"], ["regular", "Regular"], ["covering", "Covering"], ["working", "Working"], ["extra", "Extra"], ["missing", "Open"]];
      var head = "<tr>" + cols.map(function (c) {
        var on = dash.sort === c[0];
        return '<th scope="col" aria-sort="' + (on ? (dash.dir > 0 ? "ascending" : "descending") : "none") + '"><button class="sort' + (on ? " on" : "") +
          '" data-sort="' + c[0] + '">' + c[1] + (on ? (dash.dir > 0 ? " ▲" : " ▼") : "") + "</button></th>";
      }).join("") + "</tr>";
      var body = dash.group === "apparatus" ? list.map(function (r) { return appRow(r, 0); }).join("") : groupedRows(all, list);

      function appRow(r, level) {
        var open = !!dash.open[r.co];
        var req = dash.editing === r.co
          ? '<form class="req-form" data-co="' + esc(r.co) + '"><input type="number" min="0" max="30" value="' + r.required + '" aria-label="Required staffing for ' + esc(r.co) + '">' +
            '<button class="btn tiny" type="submit">Save</button>' + (r.overridden ? '<button class="btn tiny" type="button" data-reset="' + esc(r.co) + '">Default (' + r.defaultRequired + ")</button>" : "") +
            '<button class="btn tiny" type="button" data-cancel="1">Cancel</button></form>'
          : (canAdmin ? '<button class="linkish req" data-edit="' + esc(r.co) + '" title="Change required staffing">' + r.required + "</button>" : r.required) +
            (r.overridden ? ' <span class="hint" title="Set by an admin; default ' + r.defaultRequired + '">set</span>' : "");
        var row = '<tr class="dash-row lvl-' + level + (r.total < 0 ? " neg" : r.total > 0 ? " pos" : "") + (open ? " open" : "") + '" data-co="' + esc(r.co) + '">' +
          '<th scope="row"><button class="linkish drill" aria-expanded="' + open + '" data-drill="' + esc(r.co) + '">' + (open ? "▾ " : "▸ ") + esc(r.co) + "</button></th>" +
          '<td class="num">' + req + '</td><td class="num">' + r.regular + '</td><td class="num">' + r.covering + '</td><td class="num">' + r.working +
          '</td><td class="num">' + r.extra + '</td><td class="num total">' + r.missing + "</td></tr>";
        if (!open) return row;
        return row + '<tr class="drill-row"><td colspan="7"><div class="drill-grid"><div><h4>Working (' + r.people.length + ")</h4>" +
          (r.people.length ? "<ul>" + r.people.map(function (x) {
            return '<li><button class="linkish" data-pos="' + esc(x.who ? x.who.pos : x.slot.pos) + '">' + esc(x.name) + "</button> " +
              '<span class="hint">' + esc(x.slot.title) + (x.role ? " · " + esc(x.role) : "") + " · T" + x.tour + "</span>" +
              (isCovering(x) ? ' <span class="tag tag-acting">Covering</span>' : ' <span class="tag">Regular</span>') +
              (x.acting ? ' <span class="tag tag-acting">Acting for ' + esc(x.slot.name || "vacant spot") + "</span>" : "") +
              (x.swingCover ? ' <span class="tag">Swing from ' + esc(x.slot.company) + "</span>" : "") +
              (x.slot.added ? ' <span class="tag">Added</span>' : "") + "</li>";
          }).join("") + "</ul>" : '<p class="hint">Nobody scheduled.</p>') + "</div>" +
          "<div><h4>Short or off (" + r.short.length + ")</h4>" + (r.short.length ? "<ul>" + r.short.map(function (t) { return "<li>" + esc(t) + "</li>"; }).join("") + "</ul>"
            : '<p class="hint">No open seats.</p>') + "</div></div></td></tr>";
      }

      // Division -> battalion -> apparatus, with subtotals. Subtotals cover every apparatus in the group;
      // search and "Only short" decide which apparatus are listed under it.
      function groupedRows(allRows, shown) {
        var byCo = {}, shownSet = {};
        allRows.forEach(function (r) { byCo[r.co] = r; });
        shown.forEach(function (r) { shownSet[r.co] = true; });
        var filtering = !!q || dash.short;
        function sub(rows) {
          var t = { required: 0, working: 0, extra: 0, missing: 0, regular: 0, covering: 0 };
          rows.forEach(function (r) { ["required", "working", "extra", "missing", "regular", "covering"].forEach(function (k) { t[k] += r[k]; }); });
          t.total = t.extra + t.missing;
          return t;
        }
        function sortRows(rows) {
          return rows.sort(function (a, b) {
            var k = dash.sort;
            var cmp = k === "co" ? (a.sortName || api.coKey(a.co)).localeCompare(b.sortName || api.coKey(b.co), undefined, { numeric: true }) : a[k] - b[k];
            return cmp * dash.dir;
          });
        }
        var mapped = {};
        var divisions = Org.DIVISIONS.filter(function (dv) { return !dv.hidden; }).map(function (dv) {
          var bts = dv.battalions.map(function (bt) {
            var rows = bt.apparatus.filter(function (co) { return byCo[co]; }).map(function (co) { mapped[co] = true; return byCo[co]; });
            return Object.assign(sub(rows), { key: "g:" + bt.id, name: bt.name, sortName: bt.name, rows: rows });
          });
          var allRowsDv = [].concat.apply([], bts.map(function (b) { return b.rows; }));
          return Object.assign(sub(allRowsDv), { key: "g:" + dv.id, name: dv.name, sortName: dv.name, bts: bts });
        });
        var other = allRows.filter(function (r) { return !mapped[r.co]; });
        if (other.length) {
          var ob = Object.assign(sub(other), { key: "g:OTHER", name: "Not in balance report", sortName: "zz", rows: other });
          divisions.push(Object.assign(sub(other), { key: "g:DVOTHER", name: "Other", sortName: "zz", bts: [ob] }));
        }
        function isOpen(key, dflt) { return filtering ? true : dash.open[key] != null ? dash.open[key] : dflt; }
        function groupRow(g, level, open, label) {
          return '<tr class="grp lvl-' + level + (g.total < 0 ? " neg" : g.total > 0 ? " pos" : "") + '"><th scope="row"><button class="linkish drill" aria-expanded="' + open +
            '" data-drill="' + esc(g.key) + '">' + (open ? "▾ " : "▸ ") + esc(g.name) + "</button>" + (label || "") + "</th>" +
            '<td class="num">' + g.required + '</td><td class="num">' + g.regular + '</td><td class="num">' + g.covering + '</td><td class="num">' + g.working +
            '</td><td class="num">' + g.extra + '</td><td class="num total">' + g.missing + "</td></tr>";
        }
        function btRows(bt, level) {
          var rows = sortRows(bt.rows.filter(function (r) { return shownSet[r.co]; }));
          if (filtering && !rows.length) return "";
          var open = isOpen(bt.key, false);
          return groupRow(bt, level, open) + (open ? rows.map(function (r) { return appRow(r, level + 1); }).join("") : "");
        }
        if (dash.group === "battalion") {
          var bts = [].concat.apply([], divisions.map(function (dv) { return dv.bts; }));
          return sortRows(bts).map(function (bt) { return btRows(bt, 0); }).join("");
        }
        return sortRows(divisions).map(function (dv) {
          var inner = sortRows(dv.bts).map(function (bt) { return btRows(bt, 1); }).join("");
          if (filtering && !inner) return "";
          var open = isOpen(dv.key, true);
          return groupRow(dv, 0, open, ' <b class="pill ' + (dv.total < 0 ? "bad" : "ok") + '">' + (dv.total > 0 ? "+" : "") + dv.total + "</b>") + (open ? inner : "");
        }).join("");
      }

      out.innerHTML =
        '<div class="dash-totals"><span>Required <b class="pill neutral">' + required + "</b></span>" +
        '<span>Total Working Staff <b class="pill ok">' + working + "</b>" + (coveringN ? ' <span class="hint">' + coveringN + " covering</span>" : "") + "</span>" +
        '<span>Positions Needing Staff <b class="pill ' + (needing < 0 ? "bad" : "ok") + '">' + needing + "</b></span>" +
        '<span class="hint">' + esc(api.longDate(d)) + " · watch " + M.watchFor(d) + "</span>" +
        (api.backend() && api.backend().canEdit() ? '<button class="btn small" id="open-seats-btn">Open seats</button>' : "") + "</div>" +
        reportCard(d, all, working) +
        '<div class="dash-grid">' +
        '<div class="card stats"><h3>Stats summary</h3><table class="list kv-table"><tbody>' +
        statRow("Full duty", st.full) + statRow("Vacation (VA)", st.VA) + statRow("Sick (S)", st.S) + statRow("Disabled (D)", st.D) +
        statRow("Acting / covering", st.acting) + statRow("Spots open for bid", st.open) + statRow("Vacant seats", st.vacant) +
        '<tr><th scope="row">Average age</th><td class="num" id="st-age">…</td></tr><tr><th scope="row">Average YOS</th><td class="num" id="st-yos">…</td></tr>' +
        "</tbody></table>" + '<p class="hint" id="st-note"></p></div>' +
        '<div class="card summary-card"><div class="cal-head"><h3>Schedule summary</h3>' +
        '<label class="toggle"><input type="checkbox" id="dash-short"' + (dash.short ? " checked" : "") + "> Only short</label></div>" +
        (dash.msg ? '<p class="msg" role="status">' + esc(dash.msg) + "</p>" : "") +
        (body ? '<div class="table-wrap"><table class="list dash"><thead>' + head + "</thead><tbody>" + body + "</tbody></table></div>"
          : '<p class="hint">No apparatus matches.</p>') +
        '<p class="hint">Required comes from the Daily Balance Report (' + esc(reportData().asOf || "") + ")" + (canAdmin ? "; click a number to change it" : "") +
        ". Regular = people in their own seat or on a swing. Covering = people on a cover assignment or added to the roster. Open = spots still needing someone, such as overtime.</p></div></div>";
      dash.msg = "";
      $("dash-short").onchange = function () { dash.short = this.checked; renderDash(); };
      if ($("report-card")) $("report-card").ontoggle = function () { dash.reportOpen = this.open; };
      if ($("open-seats-btn")) $("open-seats-btn").onclick = function () { api.state().seatsOpen = true; renderSeats(); };
      loadStats(d, st.named);
    }
    /* ---------- Phone list: division → battalion → apparatus → people ----------
       Staffing on phones. o: {open: {key: bool}, match: fn|null, bars: bool}.
       Returns {html, required, working}. Toggle buttons carry data-tog with the key to flip in o.open. */
    function phoneTree(d, o) {
      var all = summarize(d), byCo = {};
      all.forEach(function (r) { byCo[r.co] = r; });
      var match = o.match, filtering = !!match;
      function personMatches(x) {
        return match({ name: x.name, title: x.slot.title, co: x.co, tour: x.tour, pos: x.slot.pos, id: x.who && x.who.emplId, extra: "" });
      }
      function nums(on, req) {
        var gap = on - req;
        return '<span class="pt-n">' + on + " / " + req + '</span><span class="pt-gap' + (gap < 0 ? " neg" : gap > 0 ? " pos" : "") + '">' +
          (gap < 0 ? "−" + -gap : gap > 0 ? "+" + gap : "") + "</span>";
      }
      function isOpen(key) { return filtering || !!o.open[key]; }
      var tot = { required: 0, working: 0 };
      var html = Org.DIVISIONS.filter(function (dv) { return !dv.hidden; }).map(function (dv) {
        var dvOn = 0, dvReq = 0;
        var bts = dv.battalions.map(function (bt) {
          var rows = bt.apparatus.map(function (co) { return byCo[co]; }).filter(Boolean);
          var on = 0, req = 0;
          rows.forEach(function (r) { on += r.working; req += r.required; });
          dvOn += on; dvReq += req;
          var shown = rows.map(function (r) {
            var people = filtering ? r.people.filter(personMatches) : r.people;
            return { r: r, people: people };
          }).filter(function (x) { return !filtering || x.people.length; });
          if (filtering && !shown.length) return "";
          var open = isOpen("g:" + bt.id);
          return '<li><button class="pt-row pt-bt" type="button" data-tog="g:' + esc(bt.id) + '" aria-expanded="' + open + '"><span class="pt-name">' + esc(bt.name) + "</span>" + nums(on, req) +
            (o.bars ? '<span class="pt-bar" aria-hidden="true"><i style="width:' + Math.min(100, Math.round(100 * on / Math.max(1, req))) + '%"></i></span>' : "") + "</button>" +
            (open ? '<ul class="pt-cos">' + shown.map(function (x) {
              var r = x.r, coOpen = isOpen(r.co);
              return '<li><button class="pt-row pt-co" type="button" data-tog="' + esc(r.co) + '" aria-expanded="' + coOpen + '"><span class="pt-name">' + esc(r.co) + "</span>" +
                nums(r.working, r.required) + "</button>" +
                (coOpen ? '<ul class="pt-people">' + x.people.map(function (p) {
                  var tags = [];
                  if (p.acting) tags.push("covering " + (p.slot.name || "vacant seat"));
                  else if (p.swingCover) tags.push("swing from " + p.slot.company);
                  if (p.slot.open && !p.acting) tags.push("open for bid");
                  return '<li><button class="linkish" data-pos="' + esc(p.who ? p.who.pos : p.slot.pos) + '">' + esc(p.name) + "</button>" +
                    '<span class="pt-role">' + esc(p.slot.rank === "FF/Paramedic" ? "FF/PM" : p.slot.rank === "Lieutenant" ? "Lt." : p.slot.rank === "Captain" ? "Capt." : p.slot.rank || "") +
                    (tags.length ? ' · <span class="pt-tag">' + esc(tags.join(" · ")) + "</span>" : "") + "</span></li>";
                }).join("") + (filtering ? "" : r.short.map(function (t) { return '<li class="pt-short">' + esc(t) + "</li>"; }).join("")) +
                (!x.people.length && !r.short.length ? '<li class="pt-short">Nobody scheduled.</li>' : "") + "</ul>" : "") + "</li>";
            }).join("") + "</ul>" : "") + "</li>";
        }).join("");
        tot.required += dvReq; tot.working += dvOn;
        if (filtering && !bts) return "";
        return '<section class="pt-div"><h3 class="pt-dh"><span>' + esc(dv.name) + "</span><span>" + dvOn + " / " + dvReq + '</span></h3><ul class="pt-bts">' + bts + "</ul></section>";
      }).join("");
      return { html: html || '<p class="empty">Nobody matches.</p>', required: tot.required, working: tot.working };
    }
    /* ---------- Staffing on a phone: three tiles, then the battalion list ---------- */
    function renderDashPhone(d, out) {
      var tree = phoneTree(d, { open: dash.open, match: null, bars: true });
      var all = summarize(d), open = all.reduce(function (a, r) { return a - r.missing; }, 0);
      var st = stats(d);
      out.innerHTML =
        '<div class="tiles3">' +
        '<div class="tile3"><span class="k">Required</span><span class="v">' + tree.required + "</span></div>" +
        '<div class="tile3"><span class="k">On duty</span><span class="v">' + tree.working + "</span></div>" +
        '<div class="tile3 bad"><span class="k">Open</span><span class="v">' + open + "</span></div></div>" +
        '<p class="hint pt-lede">Open = seats still needing someone, such as overtime. Tap a battalion for its apparatus.' +
        (api.backend() && api.backend().canEdit() ? ' <button class="linkish" id="open-seats-btn">Open seats</button>' : "") + "</p>" +
        '<div class="pt">' + tree.html + "</div>" +
        reportCard(d, all, tree.working) +
        '<details class="card fold"><summary><h3>Stats summary</h3></summary><table class="list kv-table"><tbody>' +
        statRow("Full duty", st.full) + statRow("Vacation (VA)", st.VA) + statRow("Sick (S)", st.S) + statRow("Disabled (D)", st.D) +
        statRow("Acting / covering", st.acting) + statRow("Spots open for bid", st.open) + statRow("Vacant seats", st.vacant) +
        '<tr><th scope="row">Average age</th><td class="num" id="st-age">…</td></tr><tr><th scope="row">Average YOS</th><td class="num" id="st-yos">…</td></tr>' +
        '</tbody></table><p class="hint" id="st-note"></p></details>';
      if ($("report-card")) $("report-card").ontoggle = function () { dash.reportOpen = this.open; };
      if ($("open-seats-btn")) $("open-seats-btn").onclick = function () { api.state().seatsOpen = true; renderSeats(); };
      loadStats(d, st.named);
    }

    /* ---------- Check against the Daily Balance Report ---------- */
    function reportCard(d, all, toolWorking) {
      var rd = reportData();
      if (!rd.asOf) return "";
      if (api.iso(d) !== rd.asOf) {
        return '<p class="hint report-note">The Balance report check is available for ' + esc(api.longDate(api.fromIso(rd.asOf))) +
          ' (the report date). <button class="linkish" id="go-report-date">Show that day</button></p>';
      }
      var byCo = {};
      all.forEach(function (r) { byCo[r.co] = r; });
      var reportTotal = 0, gaps = [];
      Object.keys(rd.apparatus).forEach(function (co) {
        if (hiddenCo(co)) return;
        var rw = rd.apparatus[co].reportWorking, tw = byCo[co] ? byCo[co].working : 0;
        reportTotal += rw;
        if (rw > tw) gaps.push({ co: co, report: rw, tool: tw, gap: rw - tw, where: Org.locate(co) });
      });
      var ot = rd.overtimeHires || 0, regular = reportTotal - ot, est = Math.max(0, regular - toolWorking);
      var sumGaps = gaps.reduce(function (a, g) { return a + g.gap; }, 0);
      var groups = {};
      gaps.sort(function (a, b) { return b.gap - a.gap || api.coKey(a.co).localeCompare(api.coKey(b.co)); }).forEach(function (g) {
        var k = g.where ? g.where.battalion.name : "Other";
        (groups[k] = groups[k] || []).push(g);
      });
      return '<details class="card report-card"' + (dash.reportOpen ? " open" : "") + ' id="report-card"><summary><h3>Working but not in the tool</h3>' +
        '<span class="hint">Report: ' + reportTotal + " working, including " + ot + " overtime hires (about " + regular + " regular). Tool: " + toolWorking +
        ". <b>About " + est + " people working who aren't in the tool.</b></span></summary>" +
        '<p class="hint">Apparatus where the Balance report shows more people than the tool (' + sumGaps + " in all; some of these are overtime hires, which the report doesn't split by apparatus). " +
        "To fix a gap, add the person on the By person tab, or give them a cover assignment from Open seats.</p>" +
        '<div class="gap-groups">' + Object.keys(groups).sort(function (a, b) { return a.localeCompare(b, undefined, { numeric: true }); }).map(function (k) {
          return '<div><h4>' + esc(k) + "</h4><ul>" + groups[k].map(function (g) {
            return '<li><button class="linkish" data-goto="' + esc(g.co) + '">' + esc(g.co) + "</button> report " + g.report + ", tool " + g.tool + ' <b class="gap">+' + g.gap + "</b></li>";
          }).join("") + "</ul></div>";
        }).join("") + "</div></details>";
    }

    /* ---------- Open seats: vacant positions and long-term absences, with cover assignment ---------- */
    var seats = { filter: "none", msg: "", q: "" };
    function seatList(d) {
      var isoD = api.iso(d), recs = api.recs(), out = [];
      api.data().forEach(function (p) {
        var co = Org.apparatus(p.company || p.title);
        if (hiddenCo(co)) return;
        var reason = null;
        if (!p.name) reason = "Vacant";
        else {
          var st = recs.statuses.filter(function (x) { return x.pos === p.pos && x.code === "D" && x.start <= isoD && !x.end; })[0];
          var away = M.coveringOn(p.pos, d, recs.covers);
          if (st) reason = p.name + " · Disabled since " + api.shortDate(api.fromIso(st.start));
          else if (away) reason = p.name + " · acting at " + ((api.byPos()[away.targetPos] || {}).company || away.targetPos);
        }
        if (!reason) return;
        var cover = recs.covers.filter(function (c) { return c.targetPos === p.pos && (!c.end || c.end >= isoD); })
          .sort(function (a, b) { return a.start.localeCompare(b.start); })[0] || null;
        out.push({ p: p, co: co, where: Org.locate(co), reason: reason, cover: cover });
      });
      return out;
    }
    function renderSeats() {
      var d = api.state().dashDate, out = $("dash-detail"), list = seatList(d);
      var covered = list.filter(function (x) { return x.cover; }).length, vacant = list.filter(function (x) { return !x.p.name; }).length;
      var uncovered = list.length - covered;
      var q = seats.q.trim().toLowerCase();
      var shown = list.filter(function (x) {
        if (seats.filter === "none" && x.cover) return false;
        if (seats.filter === "covered" && !x.cover) return false;
        return !q || [x.co, x.p.title, x.p.pos, x.reason, x.where && x.where.battalion.name].join(" ").toLowerCase().indexOf(q) !== -1;
      });
      var groups = {};
      shown.forEach(function (x) {
        var k = x.where ? x.where.division.name + " · " + x.where.battalion.name : "Other";
        (groups[k] = groups[k] || []).push(x);
      });
      var t = api.iso(api.today());
      out.innerHTML = '<div class="card seats"><div class="cal-head"><h3>Open seats</h3><button class="btn small" id="seats-back">Back to dashboard</button></div>' +
        '<p class="lede"><b>' + list.length + "</b> positions without their own person on " + esc(api.shortDate(d)) + " (" + vacant + " vacant, " + (list.length - vacant) +
        " away long-term): <b>" + covered + "</b> covered · <b>" + uncovered + "</b> uncovered. Uncovered positions leave about <b>" + Math.round(uncovered * 9 / 31) +
        "</b> open spots a day.</p>" +
        '<div class="controls"><div class="chips seg">' + [["none", "No cover"], ["covered", "Covered"], ["all", "All"]].map(function (f) {
          return '<button class="btn small' + (seats.filter === f[0] ? " primary" : "") + '" data-sfilter="' + f[0] + '">' + f[1] + "</button>";
        }).join("") + '</div><input type="search" id="seats-q" class="grow" placeholder="Filter by apparatus, battalion or rank" value="' + esc(seats.q) + '" aria-label="Filter open seats"></div>' +
        (seats.msg ? '<p class="msg" role="status">' + esc(seats.msg) + "</p>" : "") +
        (shown.length ? Object.keys(groups).sort(function (a, b) { return a.localeCompare(b, undefined, { numeric: true }); }).map(function (k) {
          return "<h4>" + esc(k) + ' <span class="hint">' + groups[k].length + '</span></h4><ul class="seat-list">' + groups[k].sort(function (a, b) {
            return api.coKey(a.co).localeCompare(api.coKey(b.co)) || a.p.tour - b.p.tour;
          }).map(function (x) {
            var c = x.cover;
            return '<li class="seat"><div class="seat-main"><b class="mono">' + esc(x.co) + "</b> " + esc(x.p.title) + ' <span class="hint">· Tour ' + x.p.tour + " · " + esc(x.p.pos) + "</span>" +
              '<div class="hint">' + esc(x.reason) + "</div></div>" +
              (c ? '<div class="seat-cover"><span class="tag tag-acting">Covered</span> <button class="linkish" data-pos="' + esc(c.coverKey) + '">' + esc(c.coverName || c.coverKey) + "</button> " +
                '<span class="hint">' + esc(api.shortDate(api.fromIso(c.start))) + (c.end ? " – " + esc(api.shortDate(api.fromIso(c.end))) : " onward") + "</span></div>"
                : '<form class="seat-form" data-pos="' + esc(x.p.pos) + '" novalidate><input type="text" list="cover-dl" placeholder="Who is covering? Name or position no." aria-label="Person covering ' + esc(x.p.pos) + '">' +
                  '<input type="date" value="' + t + '" aria-label="Cover start date"><button class="btn small primary" type="submit">Assign</button></form>') + "</li>";
          }).join("") + "</ul>";
        }).join("") : '<p class="hint">Nothing to show for this filter.</p>') +
        '<datalist id="cover-dl">' + api.people().map(function (p) {
          return '<option value="' + esc(p.name + " · " + p.title + " (" + p.pos + ")") + '"></option>';
        }).join("") + "</datalist>" +
        '<p class="hint">Not on the roster? Add them first with "Not on the list? Add a person" on the By person tab, then assign them here. ' +
        "To end a cover, open the person and use End today.</p></div>";
      seats.msg = "";
      $("seats-back").onclick = function () { api.state().seatsOpen = false; renderDash(); };
      $("seats-q").oninput = function () { seats.q = this.value; var pos = this.selectionStart; renderSeats(); $("seats-q").focus(); $("seats-q").setSelectionRange(pos, pos); };
    }
    function wireSeats() {
      var out = $("dash-detail");
      out.addEventListener("click", function (e) {
        var f = e.target.closest("[data-sfilter]");
        if (f && api.state().seatsOpen) { seats.filter = f.dataset.sfilter; renderSeats(); }
      });
      out.addEventListener("submit", function (e) {
        var f = e.target.closest(".seat-form");
        if (!f) return;
        e.preventDefault();
        var inputs = f.querySelectorAll("input"), v = inputs[0].value.trim(), start = inputs[1].value;
        var m = /\(([^()]+)\)\s*$/.exec(v), key = m ? m[1] : null;
        var person = key && api.byPos()[key];
        if (!person || !person.name) { seats.msg = "Pick the person from the list (type a name, then choose)."; return renderSeats(); }
        if (key === f.dataset.pos) { seats.msg = "Someone can't cover their own position."; return renderSeats(); }
        if (!start) { seats.msg = "Pick a start date."; return renderSeats(); }
        api.backend().addCover({ coverKey: key, coverName: person.name, targetPos: f.dataset.pos, start: start, end: null, note: "Long-term cover (Open seats)" })
          .then(function () { seats.msg = person.name + " now covers " + f.dataset.pos + " from " + api.shortDate(api.fromIso(start)) + "."; renderSeats(); },
            function (er) { seats.msg = er.message; renderSeats(); });
      });
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
        if (e.target.closest("#go-report-date")) { api.state().dashDate = api.fromIso(reportData().asOf); return renderDash(); }
        var g = e.target.closest("[data-goto]");
        if (g) { dash.q = g.dataset.goto; $("dash-q").value = g.dataset.goto; dash.open[g.dataset.goto] = true; dash.reportOpen = true; return renderDash(); }
        var tg = e.target.closest("[data-tog]");
        if (tg) { dash.open[tg.dataset.tog] = tg.getAttribute("aria-expanded") !== "true"; return renderDash(); }
        var t = e.target.closest("[data-sort],[data-drill],[data-edit],[data-reset],[data-cancel]");
        if (!t) return;
        if (t.dataset.sort) {
          dash.dir = dash.sort === t.dataset.sort ? -dash.dir : (t.dataset.sort === "co" ? 1 : 1);
          dash.sort = t.dataset.sort;
        } else if (t.dataset.drill) dash.open[t.dataset.drill] = t.getAttribute("aria-expanded") !== "true";
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
      $("dash-q").oninput = function () { dash.q = this.value; api.state().seatsOpen = false; renderDash(); };
      $("dash-group").value = dash.group;
      $("dash-group").onchange = function () { dash.group = this.value; api.state().seatsOpen = false; renderDash(); };
      $("dash-date").onchange = function () { if (this.value) { api.state().dashDate = api.fromIso(this.value); renderDashOrSeats(); } };
      $("dash-prev").onclick = function () { api.state().dashDate = api.addDays(api.state().dashDate, -1); renderDashOrSeats(); };
      $("dash-next").onclick = function () { api.state().dashDate = api.addDays(api.state().dashDate, 1); renderDashOrSeats(); };
      $("dash-today").onclick = function () { api.state().dashDate = api.today(); renderDashOrSeats(); };
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
      var has = !!(list && list.length);
      $("docs-menu").hidden = !has;
      if ($("sheet-docs-h")) $("sheet-docs-h").hidden = !has;
      if (!has) { ul.innerHTML = ""; if ($("sheet-docs")) $("sheet-docs").innerHTML = ""; return; }
      ul.innerHTML = list.map(function (d) {
        return '<li><a href="docs/' + encodeURIComponent(d.file) + '" target="_blank" rel="noopener">' + esc(d.title) +
          '<span class="hint">' + esc(d.ref) + " · PDF</span></a></li>";
      }).join("");
      if ($("sheet-docs")) $("sheet-docs").innerHTML = ul.innerHTML; // the phone menu sheet lists the same documents
    }

    function renderDashOrSeats() { if (api.state().seatsOpen) renderSeats(); else renderDash(); }
    function wireAll() { wireDash(); wireSeats(); }

    return { renderDash: renderDashOrSeats, renderSix: renderSix, renderDocs: renderDocs, wireDash: wireAll, summarize: summarize,
      phoneTree: phoneTree };
  };
})(window);
