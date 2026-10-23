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
    var ui = { from: "", to: "", bt: "", replyOpen: null, claimQ: "", claimPick: null, claimsOpen: false,
      addOpen: null, inviteRun: null, invited: {}, copyOpen: null, links: {}, openOwn: {} };
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
      return trades().filter(function (x) { return x.posterKey === pos && x.date === dIso && (statusOf(x) === "open" || x.status === "set" || x.status === "pending"); })[0] || null;
    }
    /* Who can post a trade for pos: that person, or an admin for anyone (on Firebase and the shared page; server.py's
       trade routes only take the signed-in person). An admin's post records postedBy and shows who it's for. */
    function tradeAdmin() {
      var b = backend();
      return visible() && !!b.canAdmin && b.canAdmin() && (b.hosted === "firebase" || b.mode === "db");
    }
    function canTradeFor(pos) { return visible() && !!pos && ((pos === myKey() && backend().canTrade()) || (!!byPos()[pos] && tradeAdmin())); }
    function forSomeone(pos) { return pos !== myKey(); }
    function tradeLink(p, d) {
      if (!canTradeFor(p.pos)) return "";
      var dIso = api.iso(d), t = tradeFor(p.pos, dIso);
      if (dIso < todayIso()) return "";
      if (t) return '<span class="tag tag-trade">' + (t.status === "set" ? "Traded" : "Trade posted") + "</span>";
      return '<button class="linkish trade-link" data-trade-day="' + dIso + '" data-trade-pos="' + esc(p.pos) + '">Trade</button>';
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
          : claimHtml()) + forOthersHtml(null) + adminClaimsHtml() + "</div>";
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
        forOthersHtml(key) + adminClaimsHtml() + "</div>";
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
    // Admins: trades posted for other people (by any admin), so someone not on the tool still gets answers picked.
    function forOthersHtml(key) {
      if (!tradeAdmin()) return "";
      var t0 = todayIso();
      var list = trades().filter(function (t) {
        return t.postedBy && t.posterKey !== key && t.date >= t0 && ["open", "pending", "set"].indexOf(statusOf(t)) !== -1;
      }).sort(byDate);
      return section("Admin: trades posted for others", list.map(ownCard).join("") ||
        '<p class="hint">None. To post one for someone, open their page and tap the day.</p>');
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
      var st = statusOf(t), reps = repliesFor(t), aud = t.audience || { to: [] }, other = t.posterKey !== myKey();
      // Collapsed to one line (date, status, a short count) until tapped, so a long list stays short.
      var gist = st === "set" || st === "pending" ? nameOf(t.takerKey) + (st === "set" ? " works it" : " picked")
        : st === "open" ? (reps.length ? reps.length + (reps.length === 1 ? " answer" : " answers")
          : [aud.to && aud.to.length ? "Sent to " + aud.to.length : "", aud.board ? "On the board" : ""].filter(Boolean).join(" · ")) : "";
      var head = '<summary class="trade-head"><span class="trade-date">' + esc(dateText(t.date)) + "</span>" +
        (other ? '<span class="trade-who">For ' + esc(byPos()[t.posterKey] ? nameOf(t.posterKey) : t.posterName || t.posterKey) + "</span>" : "") + '<span class="tag tag-st-' + st + '">' +
        { open: "Open", set: "Set", pending: "Picked", cancelled: "Cancelled", expired: "Expired" }[st] + "</span>" +
        (gist ? '<span class="' + (st === "open" && reps.length ? "trade-gist due" : "hint trade-gist") + '">' + esc(gist + (st === "open" && reps.length ? " · pick one" : "")) + "</span>" : "") + "</summary>" +
        (t.postedBy ? '<p class="hint">Posted by an admin' + (other ? "" : " for you") + "</p>" : "");
      var body = "";
      if (st === "pending") {
        body = '<p class="trade-terms">You picked ' + esc(nameOf(t.takerKey)) + ". " + esc(terms(t.proposal, true)) + ".</p>" +
          '<p class="hint">Waiting for them to sign in from their link with their Employee ID; then the trade is set.</p>' +
          '<div class="row"><button class="btn small" data-cancel="' + esc(t.id) + '">Cancel trade</button></div>';
      } else if (st === "set") {
        body = '<p class="trade-terms">' + esc(nameOf(t.takerKey)) + (other ? " works their shift. " : " works your shift. ") + esc(terms(t.proposal, true)) + ".</p>" +
          '<div class="row"><button class="btn small" data-cancel="' + esc(t.id) + '">Cancel trade</button></div>';
      } else if (st === "open") {
        body = '<p class="hint">' + [aud.to && aud.to.length ? "Sent to " + aud.to.length : "", aud.board ? "On the board" : ""].filter(Boolean).join(" · ") +
          "</p>" +
          (reps.length ? '<ul class="tlist">' + reps.map(function (r) {
            var p = byPos()[r.takerKey] || { name: r.takerName || r.takerKey, rank: "", title: "" };
            return "<li><div>" + who(p) + (r.via === "poster" ? ' <span class="tag">Added by you</span>' : "") +
              (r.via === "link" ? ' <span class="tag">' + (r.verified ? "From their link" : "From their link · not verified") + "</span>" : "") +
              '<div class="trade-terms">' + esc(terms(r.proposal, true)) + (r.note ? " · " + esc(r.note) : "") + "</div></div>" +
              '<button class="btn small primary" data-pick="' + esc(r.id) + '" data-trade="' + esc(t.id) + '">Pick</button></li>';
          }).join("") + "</ul>" : '<p class="hint">No responses yet.</p>') + inviteHtml(t) +
          (ui.addOpen === t.id ? addForm(t) : "") +
          '<div class="row"><button class="btn small" data-widen="' + esc(t.id) + '">Send to more people</button>' +
          (ui.addOpen === t.id ? "" : '<button class="btn small" data-add="' + esc(t.id) + '">Add their answer</button>') +
          '<button class="btn small" data-cancel="' + esc(t.id) + '">Cancel</button><span class="msg" data-msg="' + esc(t.id) + '" role="status"></span></div>';
      }
      var open = ui.openOwn[t.id] || ui.addOpen === t.id || (ui.inviteRun && ui.inviteRun.id === t.id) || ui.copyOpen === t.id;
      return '<details class="trade mine" data-own="' + esc(t.id) + '"' + (open ? " open" : "") + ">" + head +
        (t.note ? '<p class="trade-note">' + esc(t.note) + "</p>" : "") + body + "</details>";
    }
    /* ---------- Invites: people the trade was sent to who aren't on the tool yet ----------
       The text goes from the poster's own phone (Messages opens with it filled in; they pick the person from their contacts).
       The tool never fills in a number: staff-list cells stay admin-only. Replies come back to the poster, who records
       them with Add their answer. */
    function pageLink() {
      if (root.FIREBASE_APP_URL) return root.FIREBASE_APP_URL;
      if (root.PAGE_URL) return root.PAGE_URL;
      return /^https?:$/.test(location.protocol) ? location.origin + location.pathname : "";
    }
    // The text for one person: their personal link when there is one (Firebase), else the general link.
    function inviteText(t, k) {
      var p = byPos()[t.posterKey] || { name: t.posterName || t.posterKey, rank: "" }, seat = byPos()[t.seatPos];
      var mine = k && inviteFor(t, k), link = mine && mine.code ? pageLink().replace(/\/?$/, "/") + "?t=" + mine.code : pageLink();
      return (k ? "Hi " + api.firstName(k) + ", " : "") + p.name + (p.rank ? " (" + p.rank + ")" : "") + " wants to trade " + dateText(t.date) +
        ", 24 hrs" + (seat ? " at " + api.home(seat) : "") + ". You're off that day." + (t.note ? ' "' + t.note + '"' : "") +
        " Interested? Text me back: pay back later, or a day of yours I'd work instead." + (link ? " Sign up for Dept Scheduler & Trade Board: " + link : "");
    }
    /* A Messages link, addressed to `cells` (staff-list numbers from createInvite) when there are any. iPhones and Macs
       take "sms:<n>&body=" and "sms:/open?addresses=<a>,<b>&body=" for a group; Android "sms:<a>,<b>?body=". */
    function smsHref(body, cells) {
      var ios = /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent), enc = encodeURIComponent(body);
      var nums = (cells || []).map(function (c) { return String(c).replace(/[^0-9+]/g, ""); }).filter(Boolean);
      if (ios && nums.length > 1) return "sms:/open?addresses=" + nums.join(",") + "&body=" + enc;
      return "sms:" + nums.join(",") + (ios ? "&" : "?") + "body=" + enc;
    }
    /* Personal links (Firebase): createInvite makes one code per person not on the tool, with their staff-list cell.
       Fetched once per trade; until then (or elsewhere) the general link and no number. */
    function inviteFor(t, k) { var l = ui.links[t.id]; return l && l.byKey ? l.byKey[k] || null : null; }
    function loadLinks(t, keys) {
      var b = backend();
      // Personal links are the poster's own (createInvite checks); an admin texting for someone sends the general link.
      if (!b.createInvite || ui.links[t.id] || forSomeone(t.posterKey)) return;
      ui.links[t.id] = { loading: true };
      b.createInvite(t.id, keys).then(function (rows) {
        var by = {};
        (rows || []).forEach(function (r) { by[r.key] = r; });
        ui.links[t.id] = { byKey: by };
        renderTrades();
      }, function (er) { ui.links[t.id] = { error: er.message }; renderTrades(); });
    }
    function notOnTool(t) {
      var b = backend();
      if (!b.onTool) return [];
      return ((t.audience && t.audience.to) || []).filter(function (k) { return byPos()[k] && b.onTool(k) === false; });
    }
    // Who a text goes to, and the staff-list number Messages will open to, so the poster knows before sending.
    function sendTo(t, k) {
      var mine = inviteFor(t, k);
      return mine && mine.cell ? '<p class="hint">Opens to ' + esc(M.showCell(mine.cell)) + "</p>" : "";
    }
    function smsLink(t, k, label, cls, run) {
      var mine = inviteFor(t, k);
      return '<a class="btn small' + (cls ? " " + cls : "") + '" href="' + esc(smsHref(inviteText(t, k), mine && mine.cell ? [mine.cell] : [])) + '" target="_blank" rel="noopener" data-invite="' +
        esc(t.id) + '" data-key="' + esc(k) + '"' + (run ? " data-run" : "") + ">" + esc(label) + "</a>";
    }
    // Inside the claude.ai page (a frame) a Messages link can't open, so the text is shown to copy and paste instead.
    function framed() { try { return root.self !== root.top; } catch (e) { return true; } }
    function inviteHtml(t) {
      var keys = notOnTool(t);
      if (!keys.length) return "";
      var n = keys.length === 1 ? "1 person you chose isn't" : keys.length + " people you chose aren't";
      if (framed()) {
        return '<div class="invite-box"><p class="hint">' + n + " on the app yet. Copy each person's text and send it to them from Messages.</p>" +
          '<ul class="tlist">' + keys.map(function (k) {
            var done = ui.invited[t.id + "/" + k], id = t.id + "/" + k, name = api.firstName(k);
            return '<li class="invite-one"><div>' + who(byPos()[k]) +
              '<textarea class="invite-copy" readonly rows="4" data-copy-text="' + esc(id) + '">' + esc(inviteText(t, k)) + "</textarea>" +
              '<span class="msg" data-copy-msg="' + esc(id) + '"></span></div>' + '<div class="row">' +
              '<button class="btn small primary" data-invite-copy="' + esc(id) + '">Copy ' + esc(name) + "'s text</button>" +
              '<button class="btn small' + (done ? " tag-st-set" : "") + '" data-mark="' + esc(t.id) + '" data-key="' + esc(k) + '">' +
              (done ? "Texted ✓" : "Mark texted") + "</button></div></li>";
          }).join("") + "</ul></div>";
      }
      loadLinks(t, keys);
      var run = ui.inviteRun && ui.inviteRun.id === t.id ? ui.inviteRun : null, links = ui.links[t.id] || {};
      var personal = !!links.byKey, cells = keys.map(function (k) { var m = inviteFor(t, k); return m && m.cell; }).filter(Boolean);
      var html = '<div class="invite-box"><p class="hint">' + n + " on the app yet. Text them from the button below. Your phone Messages opens with the text filled in" +
        (cells.length === keys.length ? ", and their cell." : cells.length ? ", and their cell when it's on file; pick the others from your contacts." : "; pick them from your contacts.") +
        (personal ? " (They can answer before signing up.)" : "") + "</p>" +
        (links.loading ? '<p class="hint">Getting their links…</p>' : "") + (links.error ? '<p class="msg err">' + esc(links.error) + "</p>" : "");
      if (run) {
        var k = run.keys[run.i];
        html += k
          ? '<div class="invite-run"><span class="hint">' + (run.i + 1) + " of " + run.keys.length + "</span> " + who(byPos()[k]) +
            sendTo(t, k) + '<div class="row">' + smsLink(t, k, "Text " + api.firstName(k), "primary", true) +
            '<button class="btn small" data-invite-skip>Skip</button><button class="btn small" data-invite-stop>Done</button></div></div>'
          : '<div class="row"><span class="hint">All done.</span><button class="btn small" data-invite-stop>Close</button></div>';
      } else {
        html += '<ul class="tlist">' + keys.map(function (k) {
          return "<li><div>" + who(byPos()[k]) + (ui.invited[t.id + "/" + k] ? ' <span class="tag tag-st-set">Texted</span>' : "") + sendTo(t, k) + "</div>" +
            smsLink(t, k, "Text " + api.firstName(k)) + "</li>";
        }).join("") + "</ul>" +
          '<div class="row">' + (keys.length > 1 ? '<button class="btn small" data-invite-all="' + esc(t.id) + '">Invite all (' + keys.length + ")</button>" +
            '<a class="btn small" href="' + esc(smsHref(inviteText(t), cells)) + '" target="_blank" rel="noopener">Group text</a>' : "") +
          '<button class="linkish small-link" data-invite-copy="' + esc(t.id) + '">Copy the text instead</button></div>' +
          (keys.length > 1 ? '<p class="hint">Group text: one message to all of them; everyone sees the replies.</p>' : "") +
          (ui.copyOpen === t.id ? '<textarea class="invite-copy" readonly rows="4" data-copy-text="' + esc(t.id) + '">' + esc(inviteText(t)) + "</textarea>" : "");
      }
      return html + "</div>";
    }
    // Add their answer: the poster records an answer they got by text (pay back later, or a day of the taker's).
    function addForm(t) {
      var poster = byPos()[t.posterKey], el = poster ? M.eligibleTakers(api.fromIso(t.date), poster, ctx()) : [];
      var to = (t.audience && t.audience.to) || [];
      el.sort(function (a, b) { return (to.indexOf(b.p.pos) !== -1) - (to.indexOf(a.p.pos) !== -1) || a.p.name.localeCompare(b.p.name); });
      return '<form class="edit add-form" data-trade="' + esc(t.id) + '" novalidate><h4>Add their answer</h4>' +
        '<p class="hint">For an answer you got by text or in person. It shows as added by you.</p>' +
        '<label>Who<select id="ad-who"><option value="">Pick a person</option>' + el.map(function (e) {
          return '<option value="' + esc(e.p.pos) + '">' + esc(e.p.name + " · " + e.p.rank + " · " + api.home(e.p)) + (to.indexOf(e.p.pos) !== -1 ? " (sent to)" : "") + "</option>";
        }).join("") + "</select></label>" +
        '<fieldset class="choice"><legend>How they pay you back</legend>' +
        '<label class="chk"><input type="radio" name="ad-kind" value="later" checked> Pay back later</label>' +
        '<label class="chk"><input type="radio" name="ad-kind" value="swap"> Swap: I work one of their shifts</label>' +
        '<label class="indent">Their day I\'d work<input type="date" id="ad-swap" min="' + todayIso() + '" disabled></label></fieldset>' +
        '<label>Note<input type="text" id="ad-note" maxlength="300" placeholder="Optional"></label>' +
        '<div class="row"><button class="btn primary small" type="submit">Add</button><button class="btn small" type="button" data-add-x>Cancel</button>' +
        '<span class="msg" id="ad-msg" role="status"></span></div></form>';
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
        '<label class="alert-board">Board posts<select data-alert="board">' + [["off", "Off: I'll check the board"], ["daily", "Daily summary"], ["each", "Each new post"]].map(function (o) {
          return '<option value="' + o[0] + '"' + ((a.board || "off") === o[0] ? " selected" : "") + ">" + o[1] + "</option>";
        }).join("") + "</select></label>" +
        '<p class="hint">' + (backend().alertsLive
          ? "Trades sent to you, answers to yours and picks always alert you on the ways you switch on, with the details and a one-tap answer. " +
            "Texts start once the department's texting number is approved."
          : "Saved now; alerts start at launch. Trades sent to you and responses to yours always alert you, with the details and a one-tap reply, so there's no need to open the page.") +
        '</p><span class="msg" id="alert-msg" role="status"></span></details>';
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
          out.querySelectorAll("[data-alert]").forEach(function (x) { vals[x.dataset.alert] = x.tagName === "SELECT" ? x.value : x.checked; });
          var b = backend(), msg = $("alert-msg");
          // Turning on app alerts asks this phone or browser for notification permission first (Firebase).
          var ready = c.dataset.alert === "app" && c.checked && b.registerPush ? b.registerPush() : Promise.resolve();
          ready.then(function () {
            if (c.dataset.alert === "app" && c.checked && b.registerPush && msg) api.say(msg, "Notifications are on for this device.");
            return b.setAlerts(vals);
          }).catch(function (er) {
            if (c.tagName !== "SELECT") c.checked = !c.checked;
            if (msg) api.say(msg, er.message, true);
          });
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
      out.querySelectorAll("[data-invite]").forEach(function (a) {
        a.addEventListener("click", function () {
          ui.invited[a.dataset.invite + "/" + a.dataset.key] = true;
          if (a.hasAttribute("data-run") && ui.inviteRun) ui.inviteRun.i++;
          setTimeout(renderTrades, 400); // after Messages opens
        });
      });
      out.querySelectorAll("[data-invite-all]").forEach(function (b) {
        b.onclick = function () { var t = find(b.dataset.inviteAll); ui.inviteRun = { id: t.id, keys: notOnTool(t), i: 0 }; renderTrades(); };
      });
      out.querySelectorAll("[data-invite-skip]").forEach(function (b) { b.onclick = function () { ui.inviteRun.i++; renderTrades(); }; });
      out.querySelectorAll("[data-invite-stop]").forEach(function (b) { b.onclick = function () { ui.inviteRun = null; renderTrades(); }; });
      out.querySelectorAll("[data-mark]").forEach(function (b) {
        b.onclick = function () { var k = b.dataset.mark + "/" + b.dataset.key; ui.invited[k] = !ui.invited[k]; renderTrades(); };
      });
      // Copy by selecting the text box (works inside the claude.ai frame, where the clipboard API may not).
      out.querySelectorAll("[data-invite-copy]").forEach(function (b) {
        b.onclick = function () {
          var id = b.dataset.inviteCopy;
          if (!out.querySelector('[data-copy-text="' + id + '"]')) { ui.copyOpen = id; renderTrades(); }
          var ta = out.querySelector('[data-copy-text="' + id + '"]'), msg = out.querySelector('[data-copy-msg="' + id + '"]');
          if (!ta) return;
          ta.focus(); ta.select(); ta.setSelectionRange(0, ta.value.length);
          var ok = false;
          try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
          var say = function (text) { if (msg) msg.textContent = text; else b.textContent = text; };
          if (ok) say("Copied. Open Messages, paste it and send.");
          else say("Press and hold the text, then Copy.");
        };
      });
      out.querySelectorAll("[data-add]").forEach(function (b) { b.onclick = function () { ui.addOpen = b.dataset.add; renderTrades(); }; });
      out.querySelectorAll("[data-add-x]").forEach(function (b) { b.onclick = function () { ui.addOpen = null; renderTrades(); }; });
      out.querySelectorAll(".add-form").forEach(function (f) {
        var swapIn = f.querySelector("#ad-swap");
        f.querySelectorAll("[name=ad-kind]").forEach(function (r) { r.onchange = function () { swapIn.disabled = f.querySelector("[name=ad-kind]:checked").value !== "swap"; }; });
        f.onsubmit = function (e) {
          e.preventDefault();
          var t = find(f.dataset.trade), msg = $("ad-msg"), taker = byPos()[f.querySelector("#ad-who").value];
          if (!taker) return api.say(msg, "Pick who answered.", true);
          if (!canTake(taker, t)) return api.say(msg, taker.name + " works that day or is marked off.", true);
          var proposal = { later: true }, swapSeat = null;
          if (f.querySelector("[name=ad-kind]:checked").value === "swap") {
            var why = swapProblem(t, taker, swapIn.value);
            if (why) return api.say(msg, why, true);
            proposal = { swapDate: swapIn.value };
            swapSeat = seatOn(taker, api.fromIso(swapIn.value));
          }
          api.say(msg, "Saving…");
          backend().replyTrade({ tradeId: t.id, takerKey: taker.pos, takerName: taker.name, proposal: proposal, swapSeatPos: swapSeat,
            note: f.querySelector("#ad-note").value.trim(), via: "poster", recordedBy: myKey() })
            .then(function () { ui.addOpen = null; api.renderAll(true); }, function (er) { api.say(msg, er.message, true); });
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
      var jp = ui.justPosted && out.querySelector('details[data-own="' + ui.justPosted + '"]');
      if (jp) { ui.justPosted = null; jp.scrollIntoView({ block: "center" }); }
      out.querySelectorAll("details[data-own]").forEach(function (d) {
        d.addEventListener("toggle", function () { ui.openOwn[d.dataset.own] = d.open; });
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
      if (!seatOn(taker, d)) {
        return taker.pos === myKey() ? "You don't work " + dateText(sw) + ". Pick one of your shifts." : taker.name + " doesn't work " + dateText(sw) + ".";
      }
      if (poster && (api.day(poster, d) || M.statusFor(poster.pos, d, recs().statuses))) return nameOf(t.posterKey) + " isn't free on " + dateText(sw) + ".";
      return null;
    }
    /* The records a pick sets (on the shared page they are kept on the trade; the server writes its own): the taker covers the
       poster's seat and the poster is TR; for a swap the same the other way on the swap day. An error string when the trade
       no longer works. */
    function pickWrites(t, r) { return M.pickLegs(t, r, { byPos: byPos(), opts: api.opts(), today: todayIso() }); }

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
        var station = $("cl-co").value, tour = +$("cl-tour").value;
        backend().claimMember({ key: p.pos, emplId: p.emplId || null, confirmedStation: station, confirmedTour: tour })
          .then(function () {
            ui.claimPick = null; ui.claimQ = ""; api.renderAll(true);
            if (api.afterClaim) api.afterClaim(p, station, tour);
          }, function (er) { api.say($("cl-msg"), er.message, true); });
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
      $("trade-title").textContent = (w.widen ? "Send to more · " : "Trade · ") + (forSomeone(w.poster.pos) ? w.poster.name + " · " : "") + api.shortDate(d);
      // Steps: 2 = who, 3 = post. The poster doesn't offer a payback day; whoever is interested suggests one.
      var steps = '<ol class="wiz-steps">' + ["Who", "Post"].map(function (s, i) {
        return '<li class="' + (w.step === i + 2 ? "on" : w.step > i + 2 ? "done" : "") + '">' + s + "</li>";
      }).join("") + "</ol>";
      var html = steps + '<p class="hint">' + (forSomeone(w.poster.pos) ? esc(w.poster.name) + "'s" : "Your") + ' 24-hour shift' + (seat ? " at " + esc(api.home(seat)) : "") + " on " + esc(api.longDate(d)) + ".</p>";
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
          // Checking opens the lists, so you can see who's selected.
          if (c.checked) g.bts.forEach(function (b) { w.open[g.dv.id + "/" + b.bt.id] = true; });
          setAll([].concat.apply([], g.bts.map(function (b) { return b.people; })), c.checked);
        };
      });
      body.querySelectorAll("[data-bt]").forEach(function (c) {
        c.onclick = function (e) { e.stopPropagation(); };
        c.onchange = function () {
          var k = c.dataset.bt.split("/"), g = gs.filter(function (x) { return x.dv.id === k[0]; })[0];
          if (c.checked) w.open[c.dataset.bt] = true;
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
        : backend().postTrade(Object.assign(forSomeone(w.poster.pos) ? { postedBy: "admin" } : {}, { posterKey: w.poster.pos, posterName: w.poster.name, seatPos: w.seat, date: w.date,
          note: w.note, audience: aud }));
      // The trade just posted (or widened) opens on the Trades tab; the others stay collapsed.
      p.then(function (r) {
        var id = w.widen ? w.widen.id : r && r.id;
        if (id) { ui.openOwn = {}; ui.openOwn[id] = true; ui.justPosted = id; }
        closeWizard(); api.showTrades();
      }, function (er) { api.say(msg, er.message, true); });
    }
    function wireSheet() {
      var sh = $("trade-sheet");
      sh.addEventListener("click", function (e) { if (e.target.closest("[data-close]")) closeWizard(); });
      document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !sh.hidden) closeWizard(); });
      document.addEventListener("click", function (e) {
        var b = e.target.closest("[data-trade-day]");
        if (b && (b.dataset.tradePos || myKey())) { openWizard(b.dataset.tradePos || myKey(), b.dataset.tradeDay); return; }
        var c = e.target.closest("[data-claim]");
        if (c) { ui.claimPick = c.dataset.claim; api.showTrades(); }
      });
    }
    wireSheet();

    return { renderTrades: renderTrades, tradeLink: tradeLink, canTradeFor: canTradeFor, forSomeone: forSomeone, tradeFor: tradeFor, personExtras: personExtras, openWizard: openWizard, visible: visible };
  };
})(window);
