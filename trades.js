/* Shift trades: the "this is me" claim, the Trades tab (board, sent to me, my trades, owed) and the Trade wizard.
 * window.TradeViews(api) -> {renderTrades, tradeLink, personExtras, openWizard, visible}. `api` is supplied by app.js.
 * Full 24-hour shifts only. Who can take a shift: TourMath.eligibleTakers (same rank group, off that day, no status).
 * When the poster picks a response, the trade is set: a one-day cover puts the taker on the poster's seat and a one-day
 * TR (traded off) status marks the poster; a swap writes the same pair the other way on the swap day.
 */
(function (root) {
  "use strict";
  var M = root.TourMath;

  root.TradeViews = function (api) {
    var $ = api.$, esc = api.esc;
    var ui = { from: "", to: "", bt: "", replyOpen: null, claimQ: "", claimPick: null, claimsOpen: false };
    var wiz = null; // the open wizard: {poster, date, seat, step (2 who, 3 post), note, sel: {key: true}, board, send, widen: trade|null}

    function backend() { return api.backend(); }
    function recs() { return api.recs(); }
    function byPos() { return api.byPos(); }
    function myKey() { var b = backend(); return b && b.myKey ? b.myKey() : null; }
    function me() { return byPos()[myKey()] || null; }
    function nameOf(key) { var p = byPos()[key]; return p ? p.name : key; }
    function todayIso() { return api.iso(api.today()); }
    function dateText(s) { return api.shortDate(api.fromIso(s)); }
    // Trades are offered wherever records can be written: the shared page (Contributor access and up) or the server.
    function visible() {
      var b = backend();
      if (!b || !b.canTrade) return false;
      if (b.mode === "server") return b.isActive();
      if (b.mode === "snapshot") return !!b.demo;
      return b.mode === "db" && (b.canTrade() || !!b.myKey());
    }
    function statusOf(t) { return t.status === "open" && t.date < todayIso() ? "expired" : t.status; }
    // The seat person p works on d (their own, or the one they cover), or null when they're off.
    function seatOn(p, d) {
      var s = api.day(p, d);
      return s && !s.status ? (s.acting ? s.acting.targetPos : p.pos) : null;
    }
    function ctx(list) { return { people: list || api.people(), opts: api.opts() }; }
    function canTake(p, t) {
      var poster = byPos()[t.posterKey];
      return !!(p && poster && M.eligibleTakers(api.fromIso(t.date), poster, ctx([p])).length);
    }
    function trades() { return recs().trades || []; }
    // Latest response per person on a trade.
    function repliesFor(t) {
      var by = {};
      (recs().tradeReplies || []).forEach(function (r) {
        if (r.tradeId === t.id && (!by[r.takerKey] || r.createdAt > by[r.takerKey].createdAt)) by[r.takerKey] = r;
      });
      return Object.keys(by).map(function (k) { return by[k]; }).sort(function (a, b) { return a.createdAt.localeCompare(b.createdAt); });
    }
    // A response's terms. `asPoster`: worded for the poster (they work the taker's swap day), else for the taker.
    function terms(prop, asPoster) {
      if (!prop) return "";
      if (prop.later) return "Pay back later";
      return asPoster ? "Swap: you work their " + dateText(prop.swapDate) : "Swap: they work your " + dateText(prop.swapDate);
    }
    function where(p) { var o = Organization.locate(api.home(p)); return o ? o.battalion.name : ""; }
    function who(p) { return esc(p.name) + ' <span class="hint">' + esc(p.rank + " · " + api.home(p)) + "</span>"; }

    /* Owed shifts: a set "pay back later" trade A -> B means A owes B a shift. It clears when a later set trade has
       B posting and A taking (oldest debt first). Returns [{trade, owes, to}] still open. */
    function owed() {
      var set = trades().filter(function (t) { return t.status === "set"; }).sort(function (a, b) { return a.date.localeCompare(b.date); });
      var used = {}, out = [];
      set.forEach(function (t) {
        if (!t.proposal || !t.proposal.later) return;
        var pay = set.filter(function (x) {
          return !used[x.id] && x !== t && x.posterKey === t.takerKey && x.takerKey === t.posterKey && x.date > t.date;
        })[0];
        if (pay) used[pay.id] = true; else out.push({ trade: t, owes: t.posterKey, to: t.takerKey });
      });
      return out;
    }
    function owedLines(key) {
      return owed().filter(function (o) { return o.owes === key || o.to === key; }).map(function (o) {
        return o.owes === key
          ? "Owes " + esc(nameOf(o.to)) + " a shift (worked " + esc(dateText(o.trade.date)) + ")"
          : esc(nameOf(o.owes)) + " owes a shift (you worked " + esc(dateText(o.trade.date)) + ")";
      });
    }

    /* ---------- Person page hooks ---------- */
    // "Trade" on one of my upcoming shifts, or the trade already posted for that day.
    // My open or set trade for that day, or null.
    function tradeFor(pos, dIso) {
      return trades().filter(function (x) { return x.posterKey === pos && x.date === dIso && (statusOf(x) === "open" || x.status === "set"); })[0] || null;
    }
    function canTradeFor(pos) { return visible() && !!pos && pos === myKey() && backend().canTrade(); }
    function tradeLink(p, d) {
      if (!canTradeFor(p.pos)) return "";
      var dIso = api.iso(d), t = tradeFor(p.pos, dIso);
      if (dIso < todayIso()) return "";
      if (t) return '<span class="tag tag-trade">' + (t.status === "set" ? "Traded" : "Trade posted") + "</span>";
      return '<button class="linkish trade-link" data-trade-day="' + dIso + '">Trade</button>';
    }
    // Owed shifts and the "This is me" link for a person's page.
    function personExtras(p) {
      var html = "";
      var lines = visible() ? owedLines(p.pos) : [];
      if (lines.length) html += '<div class="kv"><span class="k">Shift trades</span><span class="v">' + lines.join("<br>") + "</span></div>";
      var b = backend();
      if (b && b.mode === "db" && visible() && !myKey() && b.canTrade() && !claimedBy(p.pos)) {
        html += '<div class="kv"><span class="k">Is this you?</span><span class="v"><button class="linkish" data-claim="' + esc(p.pos) +
          '">This is me</button> <span class="hint">to trade shifts</span></span></div>';
      }
      return html;
    }
    function claimedBy(key) { return (recs().members || []).filter(function (m) { return m.key === key; })[0] || null; }

    /* ---------- Trades tab ---------- */
    function renderTrades() {
      var out = $("trades-detail");
      if (!out) return;
      var b = backend();
      if (!visible()) { out.innerHTML = '<div class="empty">Shift trades need the shared page or the schedule server.</div>'; return; }
      var mine = me();
      if (!mine) {
        out.innerHTML = '<div class="trades">' + (b.mode === "server" ? '<div class="card"><h3>Shift trades</h3><p class="hint">Your account isn\'t linked to a roster position yet. Ask an admin to link it on the Admin page.</p></div>'
          : claimHtml()) + adminClaimsHtml() + "</div>";
        wireClaim();
        wireTab();
        return;
      }
      var t0 = todayIso(), key = mine.pos;
      var all = trades();
      var sent = all.filter(function (t) { return statusOf(t) === "open" && t.posterKey !== key && t.audience && (t.audience.to || []).indexOf(key) !== -1; });
      var board = all.filter(function (t) {
        if (statusOf(t) !== "open" || t.posterKey === key || !t.audience || !t.audience.board || sent.indexOf(t) !== -1) return false;
        if (ui.from && t.date < ui.from) return false;
        if (ui.to && t.date > ui.to) return false;
        if (ui.bt && where(byPos()[t.posterKey] || {}) !== ui.bt) return false;
        return canTake(mine, t);
      }).sort(byDate);
      var own = all.filter(function (t) { return t.posterKey === key && (t.status !== "cancelled" || t.date >= t0); }).sort(byDate);
      var took = all.filter(function (t) { return t.status === "set" && t.takerKey === key && t.date >= t0; }).sort(byDate);
      var lines = owedLines(key);

      var bts = [];
      Organization.DIVISIONS.forEach(function (dv) { if (!dv.hidden) dv.battalions.forEach(function (bt) { bts.push(bt.name); }); });
      out.innerHTML =
        '<div class="trades">' + demoBar() +
        '<div class="card trade-me"><div><b>' + esc(mine.name) + '</b> <span class="hint">' + esc(mine.rank + " · " + api.home(mine)) +
        (api.tourOn(mine, api.today()) ? " · Tour " + api.tourOn(mine, api.today()) : "") + "</span></div>" +
        '<p class="hint">To trade a shift, open <button class="linkish" data-pos="' + esc(key) + '">your page</button> and tap the day, or Trade under it in Next shifts.</p>' +
        alertsHtml() + "</div>" +
        (lines.length ? '<div class="card"><h3>Owed shifts</h3><ul class="tlist plain">' + lines.map(function (l) { return "<li>" + l + "</li>"; }).join("") + "</ul></div>" : "") +
        section("Sent to me", sent.sort(byDate).map(offerCard).join("") || '<p class="hint">Nobody has sent you a trade.</p>') +
        section("Board",
          '<div class="trade-filters"><label>From<input type="date" id="tf-from" value="' + esc(ui.from) + '"></label>' +
          '<label>To<input type="date" id="tf-to" value="' + esc(ui.to) + '"></label>' +
          '<label>Battalion<select id="tf-bt"><option value="">All</option>' + bts.map(function (n) {
            return "<option" + (n === ui.bt ? " selected" : "") + ">" + esc(n) + "</option>";
          }).join("") + "</select></label></div>" +
          (board.map(offerCard).join("") || '<p class="hint">No open trades you could take' + (ui.from || ui.to || ui.bt ? " with these filters" : "") + ".</p>")) +
        section("My trades", own.map(ownCard).join("") + took.map(tookCard).join("") ||
          '<p class="hint">You haven\'t posted a trade. Tap a shift on your page to trade it.</p>') +
        adminClaimsHtml() + "</div>";
      wireTab();
    }
    // Demo page: say nothing is saved, and let the viewer switch who they are.
    function demoBar() {
      var d = backend().demo;
      if (!d) return "";
      return '<div class="card demo-bar"><p><b>Demo.</b> Sample trades; try anything, nothing is saved. Reload to start over.</p>' +
        '<label>Viewing as<select id="demo-as">' + d.people.map(function (k) {
          var p = byPos()[k] || {};
          return '<option value="' + esc(k) + '"' + (k === d.as() ? " selected" : "") + ">" + esc((p.name || k) + " · " + (p.rank || "") + " · " + (p.company || p.title || "")) + "</option>";
        }).join("") + "</select></label></div>";
    }
    function byDate(a, b) { return a.date.localeCompare(b.date) || String(a.createdAt).localeCompare(String(b.createdAt)); }
    function section(title, body) { return '<section class="card trade-sec"><h3>' + esc(title) + "</h3>" + body + "</section>"; }

    // A trade someone else posted that I could take.
    function offerCard(t) {
      var p = byPos()[t.posterKey] || { name: t.posterName || t.posterKey, rank: "", title: "" };
      var mineR = repliesFor(t).filter(function (r) { return r.takerKey === myKey(); })[0];
      var seat = byPos()[t.seatPos];
      var open = ui.replyOpen === t.id;
      var adj = me() ? M.adjacentWork(me(), api.fromIso(t.date), api.opts()) : {};
      return '<article class="trade" data-id="' + esc(t.id) + '"><div class="trade-head"><span class="trade-date">' + esc(dateText(t.date)) + "</span>" +
        '<span class="trade-who">' + who(p) + "</span></div>" +
        '<div class="trade-terms">' + (seat && api.home(seat) !== api.home(p) ? "At " + esc(api.home(seat)) + " · " : "") +
        "24-hour shift" +
        (adj.before ? ' <span class="tag">You work the day before</span>' : "") + (adj.after ? ' <span class="tag">You work the day after</span>' : "") + "</div>" +
        (t.note ? '<p class="trade-note">' + esc(t.note) + "</p>" : "") +
        (mineR ? '<p class="hint">You responded: ' + esc(terms(mineR.proposal)) + (mineR.note ? " · " + esc(mineR.note) : "") +
          ' <button class="linkish" data-reply="' + esc(t.id) + '">Change</button></p>'
          : open ? "" : '<div class="row"><button class="btn small primary" data-reply="' + esc(t.id) + '">I\'m interested</button></div>') +
        (open ? replyForm(t, mineR) : "") + "</article>";
    }
    function replyForm(t, prev) {
      var later = prev ? !!prev.proposal.later : false;
      var swap = prev && prev.proposal.swapDate || "";
      return '<form class="edit reply-form" data-trade="' + esc(t.id) + '" novalidate>' +
        '<fieldset class="choice"><legend>How they pay you back</legend>' +
        '<label class="chk"><input type="radio" name="rp-kind" value="swap"' + (later ? "" : " checked") + '> Suggest a day: they work one of my shifts</label>' +
        '<label class="indent">My day they\'d work<input type="date" id="rp-swap" min="' + todayIso() + '" value="' + esc(swap) + '"></label>' +
        '<label class="chk"><input type="radio" name="rp-kind" value="later"' + (later ? " checked" : "") + "> Pay back later</label></fieldset>" +
        '<label>Note<input type="text" id="rp-note" maxlength="300" placeholder="Optional" value="' + esc(prev ? prev.note || "" : "") + '"></label>' +
        '<div class="row"><button class="btn primary small" type="submit">Send</button><button class="btn small" type="button" data-reply-x>Cancel</button>' +
        '<span class="msg" id="rp-msg" role="status"></span></div></form>';
    }

    // One of my posts: responses with their terms, Pick, Cancel, Widen.
    function ownCard(t) {
      var st = statusOf(t), reps = repliesFor(t), aud = t.audience || { to: [] };
      var head = '<div class="trade-head"><span class="trade-date">' + esc(dateText(t.date)) + '</span><span class="tag tag-st-' + st + '">' +
        { open: "Open", set: "Set", cancelled: "Cancelled", expired: "Expired" }[st] + "</span></div>";
      var body = "";
      if (st === "set") {
        body = '<p class="trade-terms">' + esc(nameOf(t.takerKey)) + " works your shift. " + esc(terms(t.proposal, true)) + ".</p>" +
          '<div class="row"><button class="btn small" data-cancel="' + esc(t.id) + '">Cancel trade</button></div>';
      } else if (st === "open") {
        body = '<p class="hint">' + [aud.to && aud.to.length ? "Sent to " + aud.to.length : "", aud.board ? "On the board" : ""].filter(Boolean).join(" · ") +
          "</p>" +
          (reps.length ? '<ul class="tlist">' + reps.map(function (r) {
            var p = byPos()[r.takerKey] || { name: r.takerName || r.takerKey, rank: "", title: "" };
            return "<li><div>" + who(p) + '<div class="trade-terms">' + esc(terms(r.proposal, true)) + (r.note ? " · " + esc(r.note) : "") + "</div></div>" +
              '<button class="btn small primary" data-pick="' + esc(r.id) + '" data-trade="' + esc(t.id) + '">Pick</button></li>';
          }).join("") + "</ul>" : '<p class="hint">No responses yet.</p>') +
          '<div class="row"><button class="btn small" data-widen="' + esc(t.id) + '">Send to more people</button>' +
          '<button class="btn small" data-cancel="' + esc(t.id) + '">Cancel</button><span class="msg" data-msg="' + esc(t.id) + '" role="status"></span></div>';
      }
      return '<article class="trade mine">' + head + (t.note ? '<p class="trade-note">' + esc(t.note) + "</p>" : "") + body + "</article>";
    }
    // A shift I'm working for someone else.
    function tookCard(t) {
      return '<article class="trade mine"><div class="trade-head"><span class="trade-date">' + esc(dateText(t.date)) +
        '</span><span class="tag tag-st-set">You work it</span></div><p class="trade-terms">For ' + esc(nameOf(t.posterKey)) + ". " +
        esc(t.proposal && t.proposal.later ? "They owe you a shift." : terms(t.proposal) + ".") + "</p></article>";
    }

    function alertsHtml() {
      var m = backend().myMember() || {}, a = m.alerts || {};
      return '<details class="trade-alerts"' + (ui.alertsOpen ? " open" : "") + "><summary>Alerts</summary>" +
        '<label class="chk"><input type="checkbox" data-alert="text"' + (a.text ? " checked" : "") + "> Notify me by text</label>" +
        '<label class="chk"><input type="checkbox" data-alert="app"' + (a.app ? " checked" : "") + "> Notify me in the app</label>" +
        '<label class="chk"><input type="checkbox" data-alert="email"' + (a.email ? " checked" : "") + "> Notify me by email</label>" +
        '<p class="hint">Available at launch. Your choice is saved now; alerts start with the department server. App alerts need the app ' +
        "installed on your phone; texts come from the department's number; email goes to the address on your account.</p></details>";
    }

    function wireTab() {
      var out = $("trades-detail");
      if ($("demo-as")) $("demo-as").onchange = function () { ui.replyOpen = null; backend().demo.setAs(this.value); };
      if ($("tf-from")) {
        $("tf-from").onchange = function () { ui.from = this.value; renderTrades(); };
        $("tf-to").onchange = function () { ui.to = this.value; renderTrades(); };
        $("tf-bt").onchange = function () { ui.bt = this.value; renderTrades(); };
      }
      out.querySelectorAll("[data-alert]").forEach(function (c) {
        c.onchange = function () {
          var vals = {};
          out.querySelectorAll("[data-alert]").forEach(function (x) { vals[x.dataset.alert] = x.checked; });
          backend().setAlerts(vals).catch(function () { c.checked = !c.checked; });
        };
      });
      out.querySelectorAll("[data-reply]").forEach(function (b) {
        b.onclick = function () { ui.replyOpen = b.dataset.reply; renderTrades(); var f = out.querySelector(".reply-form"); if (f) f.querySelector("input").focus(); };
      });
      out.querySelectorAll("[data-reply-x]").forEach(function (b) { b.onclick = function () { ui.replyOpen = null; renderTrades(); }; });
      out.querySelectorAll(".reply-form").forEach(function (f) {
        var swapIn = f.querySelector("#rp-swap");
        f.querySelectorAll("[name=rp-kind]").forEach(function (r) { r.onchange = function () { swapIn.disabled = f.querySelector("[name=rp-kind]:checked").value !== "swap"; }; });
        swapIn.disabled = f.querySelector("[name=rp-kind]:checked").value !== "swap";
        f.onsubmit = function (e) {
          e.preventDefault();
          var t = find(f.dataset.trade), msg = $("rp-msg");
          var kind = f.querySelector("[name=rp-kind]:checked").value, proposal = { later: true }, swapSeat = null;
          if (kind === "swap") {
            var sw = swapIn.value;
            var why = swapProblem(t, me(), sw);
            if (why) return api.say(msg, why, true);
            proposal = { swapDate: sw };
            swapSeat = seatOn(me(), api.fromIso(sw));
          }
          if (!canTake(me(), t)) return api.say(msg, "You can't take this shift: you work that day or are marked off.", true);
          api.say(msg, "Sending…");
          backend().replyTrade({ tradeId: t.id, takerKey: myKey(), takerName: me().name, proposal: proposal, swapSeatPos: swapSeat,
            note: f.querySelector("#rp-note").value.trim() })
            .then(function () { ui.replyOpen = null; api.renderAll(true); }, function (er) { api.say(msg, er.message, true); });
        };
      });
      out.querySelectorAll("[data-pick]").forEach(function (b) {
        b.onclick = function () {
          if (b.dataset.confirm !== "1") { b.dataset.confirm = "1"; b.textContent = "Confirm"; return; }
          var t = find(b.dataset.trade), r = repliesFor(t).filter(function (x) { return x.id === b.dataset.pick; })[0];
          var msg = out.querySelector('[data-msg="' + t.id + '"]');
          var writes = pickWrites(t, r);
          if (typeof writes === "string") return api.say(msg, writes, true);
          b.disabled = true;
          api.say(msg, "Saving…");
          backend().pickReply(t, r, writes).then(function () { api.renderAll(true); }, function (er) { b.disabled = false; api.say(msg, er.message, true); });
        };
      });
      out.querySelectorAll("[data-cancel]").forEach(function (b) {
        b.onclick = function () {
          if (b.dataset.confirm !== "1") { b.dataset.confirm = "1"; b.textContent = "Confirm cancel"; b.classList.add("danger"); return; }
          b.disabled = true;
          backend().cancelTrade(find(b.dataset.cancel)).then(function () { api.renderAll(true); }, function (er) { b.disabled = false; b.textContent = er.message; });
        };
      });
      out.querySelectorAll("[data-widen]").forEach(function (b) {
        b.onclick = function () { var t = find(b.dataset.widen); openWizard(t.posterKey, t.date, t); };
      });
      out.querySelectorAll("[data-unclaim]").forEach(function (b) {
        b.onclick = function () {
          if (b.dataset.confirm !== "1") { b.dataset.confirm = "1"; b.textContent = "Confirm undo"; b.classList.add("danger"); return; }
          backend().unclaim(b.dataset.unclaim).then(function () { api.renderAll(true); }, function (er) { b.textContent = er.message; });
        };
      });
      var af = out.querySelector("details.trade-alerts");
      if (af) af.addEventListener("toggle", function () { ui.alertsOpen = af.open; });
      var cf = out.querySelector("details.claims-fold");
      if (cf) cf.addEventListener("toggle", function () { ui.claimsOpen = cf.open; });
    }
    function find(id) { return trades().filter(function (t) { return t.id === id; })[0]; }

    // Why swap day `sw` doesn't work, or null: the taker must work it and the poster must be free.
    function swapProblem(t, taker, sw) {
      if (!sw) return "Pick the day they'd work for you.";
      if (sw < todayIso() || sw === t.date) return "Pick a later day, not the traded day.";
      var d = api.fromIso(sw), poster = byPos()[t.posterKey];
      if (!seatOn(taker, d)) return "You don't work " + dateText(sw) + ". Pick one of your shifts.";
      if (poster && (api.day(poster, d) || M.statusFor(poster.pos, d, recs().statuses))) return nameOf(t.posterKey) + " isn't free on " + dateText(sw) + ".";
      return null;
    }
    /* The records a pick sets (on the shared page they are kept on the trade; the server writes its own): the taker covers the
       poster's seat and the poster is TR; for a swap the same the other way on the swap day. An error string when the trade
       no longer works. */
    function pickWrites(t, r) {
      var poster = byPos()[t.posterKey], taker = byPos()[r.takerKey], d = api.fromIso(t.date);
      if (!poster || !taker) return "That person is no longer on the roster.";
      if (t.date < todayIso()) return "That day has passed.";
      if (seatOn(poster, d) !== t.seatPos) return "Your schedule for that day has changed. Cancel this trade and post it again.";
      if (!canTake(taker, t)) return taker.name + " now works that day or is marked off.";
      var leg = function (cov, off, seat, day) {
        return [{ kind: "covers", rec: { coverKey: cov.pos, coverName: cov.name, targetPos: seat, start: day, end: day, note: "Shift trade" } },
          { kind: "statuses", rec: { pos: off.pos, name: off.name, code: "TR", start: day, end: day, note: "Shift trade" } }];
      };
      var writes = leg(taker, poster, t.seatPos, t.date);
      if (r.proposal.swapDate) {
        var why = swapProblem(t, taker, r.proposal.swapDate);
        if (why) return why;
        writes = writes.concat(leg(poster, taker, seatOn(taker, api.fromIso(r.proposal.swapDate)), r.proposal.swapDate));
      }
      return writes;
    }

    /* ---------- "This is me" (shared page) ---------- */
    function claimHtml() {
      var b = backend();
      if (!b.canTrade()) return '<div class="card"><h3>Shift trades</h3><p class="hint">You can view this page but not make trades. Ask the page owner for Contributor access.</p></div>';
      var p = byPos()[ui.claimPick];
      var hits = ui.claimQ.length >= 2 ? matches(ui.claimQ) : [];
      return '<div class="card claim"><h3>Which one is you?</h3>' +
        "<p>Trades need to know who you are. Find yourself by name or Employee ID, then confirm your station and tour.</p>" +
        (p ? confirmHtml(p) :
          '<label for="cl-q">Your name or Employee ID</label><input type="search" id="cl-q" autocomplete="off" placeholder="e.g. Lester or LE1234" value="' + esc(ui.claimQ) + '">' +
          (hits.length ? '<ul class="pick">' + hits.map(function (x) {
            return '<li><button type="button" data-pick-me="' + esc(x.pos) + '">' + esc(x.name) + ' <span class="hint">' + esc(x.title) +
              (x.emplId ? " · " + esc(x.emplId) : "") + "</span></button></li>";
          }).join("") + "</ul>" : ui.claimQ.length >= 2 ? '<p class="hint">No match. Try your last name only.</p>' : "")) +
        "</div>";
    }
    function confirmHtml(p) {
      var cos = {}, t = api.today();
      api.slots().forEach(function (x) { if (x.rank === p.rank && x.company) cos[x.company] = 1; });
      var co = api.home(p), tour = api.tourOn(p, t) || "";
      if (!cos[co]) cos[co] = 1;
      var list = Object.keys(cos).sort(function (a, b) { return api.coKey(a).localeCompare(api.coKey(b)); });
      return '<form class="edit" id="cl-form" novalidate><p><b>' + esc(p.name) + "</b> · " + esc(p.title) + (p.emplId ? " · " + esc(p.emplId) : "") + "</p>" +
        '<div class="row"><label>Your station<select id="cl-co">' + list.map(function (c) {
          return "<option" + (c === co ? " selected" : "") + ">" + esc(c) + "</option>";
        }).join("") + "</select></label>" +
        '<label>Your tour<select id="cl-tour">' + Array.apply(null, Array(31)).map(function (_, i) {
          return '<option value="' + (i + 1) + '"' + (i + 1 === tour ? " selected" : "") + ">Tour " + (i + 1) + "</option>";
        }).join("") + "</select></label></div>" +
        '<p class="hint">The roster has you at ' + esc(co) + (tour ? ", Tour " + tour : "") + ". If that's wrong, pick what's right; an admin will check it.</p>" +
        '<div class="row"><button class="btn primary" type="submit">Yes, this is me</button><button class="btn" type="button" id="cl-back">Not me</button>' +
        '<span class="msg" id="cl-msg" role="status"></span></div></form>';
    }
    function matches(q) {
      q = q.trim().toLowerCase();
      var idq = q.toUpperCase();
      return api.people().filter(function (p) {
        return !claimedBy(p.pos) && (p.name.toLowerCase().indexOf(q) !== -1 || (p.emplId && p.emplId === idq));
      }).slice(0, 12);
    }
    function wireClaim() {
      var q = $("cl-q");
      if (q) {
        q.oninput = function () {
          ui.claimQ = this.value;
          var pos = this.selectionStart;
          renderTrades();
          var n = $("cl-q");
          if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (e) { /* search inputs */ } }
        };
      }
      document.querySelectorAll("#trades-detail [data-pick-me]").forEach(function (b) {
        b.onclick = function () { ui.claimPick = b.dataset.pickMe; renderTrades(); };
      });
      if ($("cl-back")) $("cl-back").onclick = function () { ui.claimPick = null; renderTrades(); };
      if ($("cl-form")) $("cl-form").onsubmit = function (e) {
        e.preventDefault();
        var p = byPos()[ui.claimPick];
        api.say($("cl-msg"), "Saving…");
        backend().claimMember({ key: p.pos, emplId: p.emplId || null, confirmedStation: $("cl-co").value, confirmedTour: +$("cl-tour").value })
          .then(function () { ui.claimPick = null; ui.claimQ = ""; api.renderAll(true); }, function (er) { api.say($("cl-msg"), er.message, true); });
      };
    }
    // Admins: who has claimed whom, with Undo. A station or tour that differs from the roster is flagged.
    function adminClaimsHtml() {
      var b = backend();
      if (b.mode !== "db" || !b.canAdmin()) return "";
      var t = api.today();
      var list = (recs().members || []).slice().sort(function (a, c) { return nameOf(a.key).localeCompare(nameOf(c.key)); });
      return '<details class="card fold claims-fold"' + (ui.claimsOpen ? " open" : "") + "><summary><h3>Claimed accounts</h3>" +
        '<span class="fold-sum">' + list.length + "</span></summary>" + (list.length ? '<ul class="tlist">' + list.map(function (m) {
          var p = byPos()[m.key] || {};
          var off = p.pos && (m.confirmedStation !== api.home(p) || m.confirmedTour !== api.tourOn(p, t));
          return "<li><div>" + esc(p.name || m.key) + ' <span class="hint">' + esc((p.title || "") + (m.emplId ? " · " + m.emplId : "")) + "</span>" +
            (off ? '<div class="err">Says ' + esc(m.confirmedStation) + ", Tour " + esc(m.confirmedTour) + "; the roster differs.</div>" : "") +
            '</div><button class="btn small" data-unclaim="' + esc(m.id) + '">Undo</button></li>';
        }).join("") + "</ul>" : '<p class="hint">Nobody has claimed a record yet.</p>') + "</details>";
    }

    /* ---------- Trade wizard ---------- */
    // Opens on one of my shifts. With `widen` (an open trade of mine), it adds recipients or the board to it.
    function openWizard(posterKey, dateIso, widen) {
      var poster = byPos()[posterKey];
      if (!poster) return;
      var d = api.fromIso(dateIso);
      var el = M.eligibleTakers(d, poster, ctx());
      var sel = {};
      if (widen) (widen.audience.to || []).forEach(function (k) { sel[k] = true; });
      wiz = { poster: poster, date: dateIso, seat: widen ? widen.seatPos : seatOn(poster, d), step: 2, note: "",
        el: el, sel: sel, board: widen ? !!widen.audience.board : true, send: true, widen: widen || null, open: {} };
      $("trade-sheet").hidden = false;
      drawWizard();
    }
    function closeWizard() { wiz = null; $("trade-sheet").hidden = true; }
    function groups() {
      var out = [], idx = {};
      wiz.el.forEach(function (e) {
        var o = Organization.locate(api.home(e.p));
        var dv = o ? o.division : { id: "zz", name: "Other" }, bt = o ? o.battalion : { id: "zz", name: "Other" };
        if (!idx[dv.id]) { idx[dv.id] = { dv: dv, bts: [], bidx: {} }; out.push(idx[dv.id]); }
        var g = idx[dv.id];
        if (!g.bidx[bt.id]) { g.bidx[bt.id] = { bt: bt, people: [] }; g.bts.push(g.bidx[bt.id]); }
        g.bidx[bt.id].people.push(e);
      });
      var ord = function (co) { return Organization.order(co); };
      var first = function (list) { return Math.min.apply(null, list.map(function (e) { return ord(api.home(e.p)); })); };
      out.forEach(function (g) { g.bts.sort(function (a, c) { return first(a.people) - first(c.people); }); });
      out.sort(function (a, c) { return first(a.bts[0].people) - first(c.bts[0].people); });
      out.forEach(function (g) {
        g.bts.forEach(function (b) { b.people.sort(function (a, c) { return ord(api.home(a.p)) - ord(api.home(c.p)) || a.p.name.localeCompare(c.p.name); }); });
      });
      return out;
    }
    function nSel() { return Object.keys(wiz.sel).filter(function (k) { return wiz.sel[k]; }).length; }
    function locked(key) { return !!(wiz.widen && (wiz.widen.audience.to || []).indexOf(key) !== -1); }
    function drawWizard() {
      var w = wiz, body = $("trade-body"), d = api.fromIso(w.date), seat = byPos()[w.seat];
      $("trade-title").textContent = (w.widen ? "Send to more · " : "Trade · ") + api.shortDate(d);
      // Steps: 2 = who, 3 = post. The poster doesn't offer a payback day; whoever is interested suggests one.
      var steps = '<ol class="wiz-steps">' + ["Who", "Post"].map(function (s, i) {
        return '<li class="' + (w.step === i + 2 ? "on" : w.step > i + 2 ? "done" : "") + '">' + s + "</li>";
      }).join("") + "</ol>";
      var html = steps + '<p class="hint">Your 24-hour shift' + (seat ? " at " + esc(api.home(seat)) : "") + " on " + esc(api.longDate(d)) + ".</p>";
      if (w.step === 2) {
        var gs = groups(), all = w.el.length && w.el.every(function (e) { return w.sel[e.p.pos]; });
        html += w.el.length
          ? '<p class="hint">' + w.el.length + " " + esc(M.rankGroup(w.poster.rank)) + (w.el.length === 1 ? " is" : "s are") + " off that day. Pick who to send it to.</p>" +
            '<label class="chk wz-all"><input type="checkbox" data-all' + (all ? " checked" : "") + "> Everyone (" + w.el.length + ")</label>" +
            '<div class="wz-list">' + gs.map(function (g) {
              var dvAll = g.bts.every(function (b) { return b.people.every(function (e) { return w.sel[e.p.pos]; }); });
              var dvN = g.bts.reduce(function (a, b) { return a + b.people.length; }, 0);
              return '<div class="wz-dv"><label class="chk wz-dvh"><input type="checkbox" data-dv="' + esc(g.dv.id) + '"' + (dvAll ? " checked" : "") + "> " + esc(g.dv.name) +
                ' <span class="n">' + dvN + "</span></label>" + g.bts.map(function (b) {
                  var btAll = b.people.every(function (e) { return w.sel[e.p.pos]; }), key = g.dv.id + "/" + b.bt.id;
                  return '<details class="wz-bt"' + (w.open[key] ? " open" : "") + ' data-key="' + esc(key) + '"><summary><label class="chk"><input type="checkbox" data-bt="' + esc(key) + '"' + (btAll ? " checked" : "") + "> " +
                    esc(b.bt.name) + '</label> <span class="n">' + b.people.filter(function (e) { return w.sel[e.p.pos]; }).length + "/" + b.people.length + "</span></summary><ul>" +
                    b.people.map(function (e) {
                      return '<li><label class="chk"><input type="checkbox" data-key="' + esc(e.p.pos) + '"' + (w.sel[e.p.pos] ? " checked" : "") + (locked(e.p.pos) ? " disabled" : "") + "> " +
                        '<span class="wz-name">' + esc(e.p.name) + ' <span class="hint">' + esc(api.home(e.p) + " · " + e.p.rank) + "</span></span></label>" +
                        (e.before ? '<span class="tag" title="Works the day before">Day before</span>' : "") +
                        (e.after ? '<span class="tag" title="Works the day after">Day after</span>' : "") + "</li>";
                    }).join("") + "</ul></details>";
                }).join("") + "</div>";
            }).join("") + "</div>"
          : '<p class="hint">Nobody in your rank group is off that day. You can still post it to the board.</p>';
      } else {
        var n = nSel();
        html += '<fieldset class="choice"><legend>Who sees it</legend>' +
          '<label class="chk"><input type="checkbox" id="wz-send"' + (w.send && n ? " checked" : "") + (n ? "" : " disabled") + "> Selected people (" + n + ")</label>" +
          '<label class="chk"><input type="checkbox" id="wz-board"' + (w.board ? " checked" : "") + (w.widen && w.widen.audience.board ? " disabled" : "") +
          "> Board: everyone who could take it</label></fieldset>" +
          (w.widen ? "" : '<label>Note<input type="text" id="wz-note" maxlength="300" placeholder="Optional, e.g. kid\'s graduation" value="' + esc(w.note) + '"></label>') +
          '<p class="hint">Whoever is interested suggests a day to pay you back, or pay back later. You pick. You can send it to more people or add it to the board later.</p>';
      }
      html += '<div class="row wz-nav">' + (w.step > 2 ? '<button class="btn" type="button" id="wz-back">Back</button>' : "") +
        (w.step < 3 ? '<button class="btn primary" type="button" id="wz-next">Next</button>' : '<button class="btn primary" type="button" id="wz-post">' + (w.widen ? "Save" : "Post trade") + "</button>") +
        '<span class="msg" id="wz-msg" role="status"></span></div>';
      body.innerHTML = html;
      wireWizard();
    }
    function wireWizard() {
      var w = wiz, body = $("trade-body");
      body.querySelectorAll("details.wz-bt").forEach(function (dt) { dt.addEventListener("toggle", function () { w.open[dt.dataset.key] = dt.open; }); });
      var setAll = function (list, on) { list.forEach(function (e) { if (!locked(e.p.pos)) w.sel[e.p.pos] = on; }); drawWizard(); };
      var gs = w.step === 2 ? groups() : [];
      body.querySelectorAll("[data-all]").forEach(function (c) { c.onchange = function () { setAll(w.el, c.checked); }; });
      body.querySelectorAll("[data-dv]").forEach(function (c) {
        c.onchange = function () {
          var g = gs.filter(function (x) { return x.dv.id === c.dataset.dv; })[0];
          setAll([].concat.apply([], g.bts.map(function (b) { return b.people; })), c.checked);
        };
      });
      body.querySelectorAll("[data-bt]").forEach(function (c) {
        c.onclick = function (e) { e.stopPropagation(); };
        c.onchange = function () {
          var k = c.dataset.bt.split("/"), g = gs.filter(function (x) { return x.dv.id === k[0]; })[0];
          setAll(g.bts.filter(function (b) { return b.bt.id === k[1]; })[0].people, c.checked);
        };
      });
      body.querySelectorAll("input[data-key]").forEach(function (c) { c.onchange = function () { w.sel[c.dataset.key] = c.checked; drawWizard(); }; });
      if ($("wz-back")) $("wz-back").onclick = function () { keep(); w.step--; drawWizard(); };
      if ($("wz-next")) $("wz-next").onclick = function () {
        keep();
        w.step++;
        drawWizard();
      };
      if ($("wz-post")) $("wz-post").onclick = post;
    }
    function keep() {
      var w = wiz;
      if (w.step === 3) { w.send = $("wz-send").checked; w.board = $("wz-board").checked; if ($("wz-note")) w.note = $("wz-note").value.trim(); }
    }
    function post() {
      keep();
      var w = wiz, msg = $("wz-msg");
      var to = w.send ? Object.keys(w.sel).filter(function (k) { return w.sel[k]; }) : [];
      if (!to.length && !w.board) return api.say(msg, "Pick people to send it to, or post it to the board.", true);
      api.say(msg, "Saving…");
      var aud = { board: !!w.board, to: to };
      var p = w.widen
        ? backend().widenTrade(w.widen.id, { board: w.widen.audience.board || aud.board, to: Array.from(new Set((w.widen.audience.to || []).concat(to))) })
        : backend().postTrade({ posterKey: w.poster.pos, posterName: w.poster.name, seatPos: w.seat, date: w.date,
          note: w.note, audience: aud });
      p.then(function () { closeWizard(); api.showTrades(); }, function (er) { api.say(msg, er.message, true); });
    }
    function wireSheet() {
      var sh = $("trade-sheet");
      sh.addEventListener("click", function (e) { if (e.target.closest("[data-close]")) closeWizard(); });
      document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !sh.hidden) closeWizard(); });
      document.addEventListener("click", function (e) {
        var b = e.target.closest("[data-trade-day]");
        if (b && myKey()) { openWizard(myKey(), b.dataset.tradeDay); return; }
        var c = e.target.closest("[data-claim]");
        if (c) { ui.claimPick = c.dataset.claim; api.showTrades(); }
      });
    }
    wireSheet();

    return { renderTrades: renderTrades, tradeLink: tradeLink, canTradeFor: canTradeFor, tradeFor: tradeFor, personExtras: personExtras, openWizard: openWizard, visible: visible };
  };
})(window);
