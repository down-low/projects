/* Leave bank: sick (SP), vacation (VA) and time coming (TC) balances, estimated from a starting balance.
 * window.LeaveBankViews(api) -> {html(p), wire(p)}; LeaveBankViews.vaTier, .project for tests. `api` comes from app.js.
 * - Start: "as of my last pay stub" entered by the member (with their consent to keep it), or imported by an admin.
 * - Each pay period (14 days, Saturday to Friday, anchored 9/12/26 like pay.js) adds RATES at its last day, up to
 *   the cap; each VA or S shift on the schedule after the start uses 24 hours; TC used is entered by hand.
 * - VA's rate and cap follow years of service on that day (hire date from the profile).
 * - Private: leaveBanks/<seat>, read and written by that member and admins (firestore.rules). An estimate: payroll is
 *   the official number.
 */
(function (root) {
  "use strict";
  var ANCHOR = Date.UTC(2026, 8, 12), DAY = 864e5, PERIOD = 14, SHIFT = 24;
  var RATES = { sp: { rate: 6, cap: 1272 }, tc: { rate: 6.91, cap: 200 } };
  var VA = [{ upTo: 5, rate: 4.615, cap: 480, label: "1–5 years" }, { upTo: 15, rate: 6.923, cap: 540, label: "5–15 years" },
    { upTo: Infinity, rate: 9.231, cap: 600, label: "over 15 years" }];
  var CONSENT = 1; // wording version of the "keep my balances" box

  function t(iso) { var a = iso.split("-").map(Number); return Date.UTC(a[0], a[1] - 1, a[2]); }
  function iso(ms) { return new Date(ms).toISOString().slice(0, 10); }
  function periodEnd(ms) { var off = Math.round((ms - ANCHOR) / DAY); return ((off % PERIOD) + PERIOD) % PERIOD === PERIOD - 1; }
  function years(hire, ms) { return hire ? (ms - t(hire)) / (365.25 * DAY) : null; }
  // VA rate and cap by years of service: under 5 (1–5), 5 through 15, over 15.
  function vaTier(yos) {
    if (yos == null) return VA[0];
    return yos < 5 ? VA[0] : yos <= 15 ? VA[1] : VA[2];
  }
  function round(n) { return Math.round(n * 1000) / 1000; }

  /* Balances today from bank {asOf, sp, va, tc, tcUsed: [{date, hours}]} (balances at the end of asOf).
     opts: {today: iso, hire: iso | null, leave: {iso: "VA" | "S"}} (the schedule's VA and S shifts after asOf).
     Returns {sp, va, tc, next: iso of the next accrual, per: {sp, va, tc}, tier, capped: [bank names at their cap]}. */
  function project(bank, opts) {
    var b = { sp: Number(bank.sp) || 0, va: Number(bank.va) || 0, tc: Number(bank.tc) || 0 }, end = t(opts.today), tcByDay = {};
    (bank.tcUsed || []).forEach(function (u) { if (u && u.date) tcByDay[u.date] = (tcByDay[u.date] || 0) + (Number(u.hours) || 0); });
    for (var d = t(bank.asOf) + DAY; d <= end; d += DAY) {
      var k = iso(d), code = opts.leave && opts.leave[k];
      if (code === "VA") b.va -= SHIFT;
      else if (code === "S") b.sp -= SHIFT;
      if (tcByDay[k]) b.tc -= tcByDay[k];
      if (periodEnd(d)) {
        var vt = vaTier(years(opts.hire, d));
        b.sp = Math.min(RATES.sp.cap, b.sp + RATES.sp.rate);
        b.va = Math.min(vt.cap, b.va + vt.rate);
        b.tc = Math.min(RATES.tc.cap, b.tc + RATES.tc.rate);
      }
    }
    var next = end + DAY;
    while (!periodEnd(next)) next += DAY;
    var tier = vaTier(years(opts.hire, next)), capped = [];
    if (b.sp >= RATES.sp.cap) capped.push("SP");
    if (b.va >= tier.cap) capped.push("VA");
    if (b.tc >= RATES.tc.cap) capped.push("TC");
    return { sp: round(b.sp), va: round(b.va), tc: round(b.tc), next: iso(next), per: { sp: RATES.sp.rate, va: tier.rate, tc: RATES.tc.rate },
      tier: tier, capped: capped };
  }
  // The last pay period's end on or before today: the usual "as of" on a pay stub.
  function lastPeriodEnd(today) {
    var d = t(today);
    while (!periodEnd(d)) d -= DAY;
    return iso(d);
  }

  root.LeaveBankViews = function (api) {
    var $ = api.$, esc = api.esc;
    var ui = { edit: false };

    function backend() { return api.backend(); }
    function canSee(p) {
      var b = backend();
      return !!(b && b.saveLeaveBank && p && !p.added && (api.myPos() === p.pos || (b.canAdmin && b.canAdmin())));
    }
    function bankFor(pos) { return (api.recs().leaveBanks || []).filter(function (x) { return x.id === pos; })[0] || null; }
    function todayIso() { return api.iso(api.today()); }
    // The schedule's VA and S shifts for p after `from` through today.
    function leaveAfter(p, from) {
      var out = {}, last = api.today();
      for (var d = api.addDays(api.fromIso(from), 1); d <= last; d = api.addDays(d, 1)) {
        var s = api.day(p, d);
        if (s && (s.status === "VA" || s.status === "S")) out[api.iso(d)] = s.status;
      }
      return out;
    }
    function hrs(n) { return (Math.round(n * 10) / 10).toLocaleString("en-US") + " hrs"; }
    function num(v) { var n = Number(v); return v !== "" && isFinite(n) ? n : null; }

    function html(p) {
      if (!canSee(p)) return "";
      var bank = bankFor(p.pos), mine = api.myPos() === p.pos, hire = api.hireDate(p);
      var body, sum = "";
      if (bank && !ui.edit) {
        var r = project(bank, { today: todayIso(), hire: hire, leave: leaveAfter(p, bank.asOf) });
        sum = "SP " + Math.round(r.sp) + " · VA " + Math.round(r.va) + " · TC " + Math.round(r.tc);
        body = '<div class="bank-tiles">' + [["Sick (SP)", r.sp, RATES.sp.cap], ["Vacation (VA)", r.va, r.tier.cap], ["Time coming (TC)", r.tc, RATES.tc.cap]].map(function (x) {
          return '<div class="tile"><span class="k">' + esc(x[0]) + '</span><span class="v">' + esc(hrs(x[1])) + '</span><span class="hint">of ' + x[2] + "</span></div>";
        }).join("") + "</div>" +
          '<p class="hint">Next: +' + r.per.sp + " SP, +" + r.per.va + " VA, +" + r.per.tc + " TC on " + esc(api.shortDate(api.fromIso(r.next))) + ". " +
          "VA rate for " + esc(r.tier.label) + (hire ? "" : " (no hire date on file: add it in Pay estimate)") + ".</p>" +
          (r.capped.length ? '<p class="msg bank-cap">' + esc(r.capped.join(", ")) + " at the cap: hours you'd earn past it are lost. Use some.</p>" : "") +
          '<p class="hint">From ' + (bank.source === "import" ? "the balances an admin loaded" : "your pay stub") + " as of " + esc(api.shortDate(api.fromIso(bank.asOf))) +
          ", minus each VA or S shift on the schedule since (24 hrs each) and TC you entered. An estimate: payroll is the official number. " +
          "40 hrs of TC carry over when you promote.</p>" +
          tcList(bank) +
          '<div class="row"><button class="btn small" type="button" id="lb-edit">Update balances</button>' +
          '<button class="btn small" type="button" id="lb-clear">Stop tracking</button><span class="msg" id="lb-msg" role="status"></span></div>';
      } else {
        body = form(bank, mine);
      }
      return '<details class="card fold" data-fold="bank"' + (ui.edit ? " open" : "") + "><summary><h3>" + (mine ? "My leave bank" : "Leave bank") +
        '</h3><span class="fold-sum">' + esc(sum || (bank ? "" : "Not set up")) + "</span></summary>" + body + "</details>";
    }
    function tcList(bank) {
      var used = (bank.tcUsed || []).slice().sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); });
      return '<div class="bank-tc"><b>TC used</b> ' + (used.length ? '<ul class="tlist plain">' + used.map(function (u, i) {
        return "<li>" + esc(api.shortDate(api.fromIso(u.date))) + " · " + esc(hrs(u.hours)) + ' <button class="linkish" type="button" data-tc-del="' + esc(u.date) + "|" + esc(String(u.hours)) + '">Remove</button></li>';
      }).join("") + "</ul>" : '<span class="hint">None entered</span>') +
        '<div class="row"><label>Date<input type="date" id="lb-tc-date" value="' + esc(todayIso()) + '"></label>' +
        '<label>Hours<input type="number" id="lb-tc-hrs" min="1" max="48" step="0.5" value="12"></label>' +
        '<button class="btn small" type="button" id="lb-tc-add">Add TC used</button></div></div>';
    }
    function form(bank, mine) {
      var b = bank || {};
      return '<form class="edit" id="lb-form" novalidate><p class="hint">Enter your balances from your last pay stub. The tool adds each pay period\'s ' +
        "accrual and takes off VA and S shifts from the schedule.</p>" +
        '<div class="row"><label>As of<input type="date" id="lb-asof" value="' + esc(b.asOf || lastPeriodEnd(todayIso())) + '"></label></div>' +
        '<div class="row"><label>SP hrs<input type="number" id="lb-sp" min="0" max="1272" step="0.001" value="' + esc(b.sp == null ? "" : String(b.sp)) + '"></label>' +
        '<label>VA hrs<input type="number" id="lb-va" min="0" max="600" step="0.001" value="' + esc(b.va == null ? "" : String(b.va)) + '"></label>' +
        '<label>TC hrs<input type="number" id="lb-tc" min="0" max="200" step="0.001" value="' + esc(b.tc == null ? "" : String(b.tc)) + '"></label></div>' +
        (mine ? '<label class="chk"><input type="checkbox" id="lb-ok"' + (b.consentAt ? " checked" : "") + "> Keep my balances in the tool. Only I and admins see them.</label>" : "") +
        '<div class="row"><button class="btn primary" type="submit">Save</button>' + (bank ? '<button class="btn small" type="button" id="lb-cancel">Cancel</button>' : "") +
        '<span class="msg" id="lb-msg" role="status"></span></div></form>';
    }

    function wire(p) {
      if (!canSee(p) || !$("lb-msg")) return;
      var b = backend(), msg = $("lb-msg"), bank = bankFor(p.pos), mine = api.myPos() === p.pos;
      var done = function () { ui.edit = false; api.renderAll(true); }, fail = function (er) { api.say(msg, er.message, true); };
      if ($("lb-form")) $("lb-form").onsubmit = function (e) {
        e.preventDefault();
        var rec = { asOf: $("lb-asof").value, sp: num($("lb-sp").value), va: num($("lb-va").value), tc: num($("lb-tc").value) };
        if (!rec.asOf || rec.asOf > todayIso()) return api.say(msg, "Pick the pay stub's date (today or earlier).", true);
        if ([["sp", 1272], ["va", 600], ["tc", 200]].some(function (x) { return rec[x[0]] == null || rec[x[0]] < 0 || rec[x[0]] > x[1]; })) {
          return api.say(msg, "Enter all three: SP up to 1272, VA up to 600, TC up to 200.", true);
        }
        if (mine && !$("lb-ok").checked) return api.say(msg, "Tick the box to keep your balances in the tool.", true);
        rec.tcUsed = bank && bank.tcUsed ? bank.tcUsed : [];
        rec.source = mine ? "member" : "admin";
        if (mine) { rec.consentAt = new Date().toISOString(); rec.consentVersion = CONSENT; }
        api.say(msg, "Saving…");
        b.saveLeaveBank(p.pos, rec).then(done, fail);
      };
      if ($("lb-cancel")) $("lb-cancel").onclick = function () { ui.edit = false; api.renderAll(true); };
      if ($("lb-edit")) $("lb-edit").onclick = function () { ui.edit = true; api.renderAll(true); };
      if ($("lb-clear")) $("lb-clear").onclick = function () {
        if (this.dataset.confirm !== "1") { this.dataset.confirm = "1"; this.textContent = "Confirm: remove balances"; return; }
        b.clearLeaveBank(p.pos).then(done, fail);
      };
      // Adding or removing TC used is the member keeping their own bank, so it records their consent as a save does.
      var saveTc = function (list) {
        var rec = Object.assign({}, bank, { tcUsed: list });
        if (mine) Object.assign(rec, { source: "member", consentAt: bank.consentAt || new Date().toISOString(), consentVersion: bank.consentVersion || CONSENT });
        b.saveLeaveBank(p.pos, rec).then(done, fail);
      };
      if ($("lb-tc-add")) $("lb-tc-add").onclick = function () {
        var d = $("lb-tc-date").value, h = Number($("lb-tc-hrs").value);
        if (!d || !(h > 0 && h <= 48)) return api.say(msg, "Pick a date and 1 to 48 hours.", true);
        saveTc((bank.tcUsed || []).concat([{ date: d, hours: h }]).slice(-200));
      };
      document.querySelectorAll("[data-tc-del]").forEach(function (x) {
        x.onclick = function () {
          var parts = x.dataset.tcDel.split("|"), gone = false;
          saveTc((bank.tcUsed || []).filter(function (u) {
            if (!gone && u.date === parts[0] && String(u.hours) === parts[1]) { gone = true; return false; }
            return true;
          }));
        };
      });
    }
    return { html: html, wire: wire };
  };
  root.LeaveBankViews.vaTier = vaTier;
  root.LeaveBankViews.project = project;
  root.LeaveBankViews.lastPeriodEnd = lastPeriodEnd;
})(typeof window !== "undefined" ? window : globalThis);
