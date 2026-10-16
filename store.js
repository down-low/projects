/* Storage for tour changes and work statuses (VA, D, S).
 *
 * ScheduleStore.connect(onChange) resolves an adapter for wherever the page is running:
 *   - "db":     the shared claude.ai page database (single-file build opened on claude.ai)
 *   - "server": the repo's server.py (/api/*), people sign in with Google; roles decide who edits
 *   - "none":   read-only (plain static hosting or a local file)
 * onChange({statuses, tourChanges, covers, people}) fires whenever the records change.
 * Adapter: {mode, canEdit(), editorName(), needsSignIn(), signOut(), addStatus(rec), addTourChange(rec),
 *           addCover(rec), endCover(id, end), addPerson(rec), remove(kind, id)}
 *   kind = "statuses" | "tourChanges" | "covers" | "people".
 * Both add staffing overrides and personal dates: setStaffing(company, n|null), setProfile(key, {birthDate, hireDate}),
 * profiles() (admins), stats(isoDate) -> {avgAge, nAge, avgYos, nYos} or null, canAdmin().
 * The server adapter adds accounts: me(), isActive(), isAdmin(), contacts(), claim(), rosterNames(),
 * saveContact(), adminUsers(), adminAction().
 * Shift trades (both adapters; read-only and snapshot pages have none): canTrade(), myKey() (the claimed person, or null),
 * myMember(), claimMember({key, emplId, confirmedStation, confirmedTour}), unclaim(memberId) (admins), setAlerts({text, app}),
 * postTrade(rec), widenTrade(id, audience), replyTrade(rec), pickReply(trade, reply, writes), cancelTrade(trade).
 * onChange also carries {members, trades, tradeReplies}.
 */
(function (root) {
  "use strict";
  var COLLECTIONS = { statuses: "statuses", tourChanges: "tourChanges", covers: "covers", people: "people", staffing: "staffing", profiles: "profiles",
    members: "members", trades: "trades", tradeReplies: "tradeReplies" };
  var API_PATH = { statuses: "statuses", tourChanges: "tour-changes", covers: "covers", people: "people" };
  var NO_EDIT = "Only editors can make changes on this page.";
  var BOARD_ALERTS = ["off", "daily", "each"]; // trade alerts for board posts: none, a daily summary, or each post

  function nowIso() { return new Date().toISOString(); }
  /* A set trade carries its records (`legs`: the taker's one-day cover and the poster's TR, and the reverse for a swap) on
     the trade itself, so members can set trades while covers and statuses stay editor-only. They join the schedule here,
     and go away when the trade is cancelled. kind: "covers" | "statuses". */
  function tradeLegs(trades, kind) {
    var out = [];
    (trades || []).forEach(function (t) {
      if (t.status !== "set" || !t.legs) return;
      t.legs.forEach(function (l, i) {
        if (l.kind === kind) out.push(Object.assign({}, l, { id: "trade:" + t.id + ":" + i, tradeId: t.id, createdAt: t.setAt || t.createdAt }));
      });
    });
    return out;
  }
  // Average age and years of service on isoDate from [{birthDate, hireDate}] (used where dates are readable).
  function averages(rows, isoDate) {
    var on = new Date(isoDate + "T00:00:00"), yr = 365.25 * 864e5, ages = [], yos = [];
    rows.forEach(function (r) {
      if (r.birthDate) ages.push((on - new Date(r.birthDate + "T00:00:00")) / yr);
      if (r.hireDate && r.hireDate <= isoDate) yos.push((on - new Date(r.hireDate + "T00:00:00")) / yr);
    });
    var avg = function (xs) { return xs.length ? Math.round(xs.reduce(function (a, b) { return a + b; }, 0) / xs.length * 10) / 10 : null; };
    return { avgAge: avg(ages), nAge: ages.length, avgYos: avg(yos), nYos: yos.length };
  }

  /* ---------- claude.ai page database ---------- */
  function dbAdapter(onChange) {
    if (!root.claude || typeof root.claude.use !== "function") return Promise.resolve(null);
    return Promise.all([root.claude.use("db"), root.claude.use("user")]).then(function (caps) {
      var db = caps[0], user = caps[1];
      if (!db) return null;
      var records = { statuses: [], tourChanges: [], covers: [], people: [], staffing: [], profiles: [], members: [], trades: [], tradeReplies: [] };
      function emit() {
        onChange({ statuses: records.statuses.concat(tradeLegs(records.trades, "statuses")), tourChanges: records.tourChanges,
          covers: records.covers.concat(tradeLegs(records.trades, "covers")), people: records.people,
          staffing: records.staffing.map(function (x) { return { company: x.id, required: x.required }; }),
          members: records.members, trades: records.trades, tradeReplies: records.tradeReplies });
      }
      var editable = false, uid = null, failed = false, canWrite = null;
      Object.keys(COLLECTIONS).forEach(function (kind) {
        db.collection(COLLECTIONS[kind]).onSnapshot(function (snap) {
          records[kind] = snap.docs.map(function (d) {
            var o = Object.assign({}, d.data());
            o.id = d.id;
            return o;
          });
          emit();
        }, emit);
      });
      var ready = user
        ? Promise.all([user.canEdit(), user.id(), user.can ? user.can("data.write") : null])
          .then(function (r) { editable = !!r[0]; uid = r[1]; canWrite = r[2]; })
        : Promise.resolve();
      /* Trades are written by every member (Contributor access and up), not only editors. can("data.write") null means the
         platform didn't say: keep the controls and let a refused write decide. */
      var tradeBlocked = false;
      function tradeOk() { return !!uid && !tradeBlocked && (editable || canWrite !== false); }
      function tradeErr(e) {
        if (e && (e.code === "invalid_argument" || e.code === "permission_denied")) tradeBlocked = true;
        return new Error(e && e.code === "quota_exceeded" ? "The page's storage is full. Ask an admin to remove old records." :
          tradeBlocked ? "You can't make trades on this page. Ask the page owner for Contributor access." :
          "The change was not saved (" + ((e && e.code) || "error") + ").");
      }
      function tw(p) { return p.catch(function (e) { throw tradeErr(e); }); }
      function myMember() {
        for (var i = 0; i < records.members.length; i++) if (records.members[i].id === uid) return records.members[i];
        return null;
      }
      function addRec(kind, rec) {
        rec.createdAt = nowIso();
        rec.createdBy = uid;
        return db.collection(kind).add(rec);
      }
      function write(kind, rec) {
        if (!editable || failed) return Promise.reject(new Error(NO_EDIT));
        rec.createdAt = nowIso();
        rec.createdBy = uid;
        return db.collection(COLLECTIONS[kind]).add(rec).catch(function (e) {
          if (e && e.code === "invalid_argument") { failed = true; editable = false; }
          throw new Error(e && e.code === "quota_exceeded" ? "The page's storage is full. Remove old records, then try again." :
            "The change was not saved (" + ((e && e.code) || "error") + ").");
        });
      }
      return ready.then(function () {
        return {
          mode: "db",
          canEdit: function () { return editable && !failed; },
          editorName: function () { return null; },
          needsSignIn: function () { return false; },
          signOut: function () {},
          addStatus: function (rec) { return write("statuses", rec); },
          addTourChange: function (rec) { return write("tourChanges", rec); },
          addCover: function (rec) { return write("covers", rec); },
          addPerson: function (rec) { return write("people", rec); },
          canAdmin: function () { return editable && !failed; },
          setStaffing: function (company, n) {
            if (!editable) return Promise.reject(new Error(NO_EDIT));
            var ref = db.collection("staffing").doc(company);
            return n == null ? ref.delete() : ref.set({ required: n, updatedAt: nowIso(), updatedBy: uid });
          },
          setProfile: function (key, dates) {
            if (!editable) return Promise.reject(new Error(NO_EDIT));
            return db.collection("profiles").doc(key).set({ birthDate: dates.birthDate || null, hireDate: dates.hireDate || null, updatedAt: nowIso() });
          },
          profiles: function () {
            return Promise.resolve(records.profiles.map(function (x) { return { key: x.id, birthDate: x.birthDate, hireDate: x.hireDate }; }));
          },
          stats: function (isoDate) { return Promise.resolve(editable ? averages(records.profiles, isoDate) : null); },
          endCover: function (id, end) {
            if (!editable) return Promise.reject(new Error(NO_EDIT));
            return db.collection("covers").doc(id).update({ end: end });
          },
          canTrade: function () { return tradeOk(); },
          myMember: myMember,
          myKey: function () { var m = myMember(); return m ? m.key : null; },
          claimMember: function (rec) {
            if (!tradeOk()) return Promise.reject(tradeErr());
            rec.userId = uid;
            rec.claimedAt = nowIso();
            return tw(db.collection("members").doc(uid).set(rec));
          },
          unclaim: function (memberId) {
            if (!editable && memberId !== uid) return Promise.reject(new Error(NO_EDIT));
            return db.collection("members").doc(memberId).delete();
          },
          setAlerts: function (a) {
            if (!myMember()) return Promise.reject(new Error("Pick yourself first."));
            return tw(db.collection("members").doc(uid).update({ alerts: { text: !!a.text, app: !!a.app, email: !!a.email, board: BOARD_ALERTS.indexOf(a.board) !== -1 ? a.board : "off" } }));
          },
          postTrade: function (rec) {
            if (!tradeOk()) return Promise.reject(tradeErr());
            rec.status = "open";
            return tw(addRec("trades", rec)).then(function (ref) { return { id: ref && ref.id }; });
          },
          widenTrade: function (id, audience) { return tw(db.collection("trades").doc(id).update({ audience: audience })); },
          replyTrade: function (rec) {
            if (!tradeOk()) return Promise.reject(tradeErr());
            return tw(addRec("tradeReplies", rec));
          },
          // writes: [{kind: "covers"|"statuses", rec}] built by the page (cover for the taker, TR for the poster, and the reverse for a swap).
          pickReply: function (trade, reply, writes) {
            return tw(db.collection("trades").doc(trade.id).update({ status: "set", replyId: reply.id, takerKey: reply.takerKey,
              proposal: reply.proposal, setAt: nowIso(), legs: writes.map(function (w) { return Object.assign({ kind: w.kind }, w.rec); }) }));
          },
          // Cancelling a set trade drops its cover and TR records with it.
          cancelTrade: function (trade) {
            return tw(db.collection("trades").doc(trade.id).update({ status: "cancelled", cancelledAt: nowIso() }));
          },
          remove: function (kind, id) {
            if (!editable) return Promise.reject(new Error(NO_EDIT));
            var first = Promise.resolve();
            if (kind === "people") {
              // An added person's covers and statuses go with them, one delete at a time.
              var key = "person:" + id;
              var linked = records.covers.filter(function (c) { return c.coverKey === key; }).map(function (c) { return ["covers", c.id]; })
                .concat(records.statuses.filter(function (x) { return x.pos === key; }).map(function (x) { return ["statuses", x.id]; }));
              first = linked.reduce(function (p, kd) {
                return p.then(function () { return db.collection(kd[0]).doc(kd[1]).delete(); });
              }, first);
            }
            return first.then(function () { return db.collection(COLLECTIONS[kind]).doc(id).delete(); });
          },
        };
      });
    }).catch(function () { return null; });
  }

  /* ---------- server.py (Google sign-in, session cookie) ---------- */
  function serverAdapter(onChange) {
    if (!root.fetch || location.protocol === "file:") return Promise.resolve(null);
    var me = null, contacts = {};
    function getJson(path) {
      return fetch(path, { cache: "no-store", credentials: "same-origin" }).then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (j) {
          if (!r.ok) throw new Error(j.error || "The server returned " + r.status + ".");
          return j;
        });
      });
    }
    function call(method, path, body) {
      var h = { "X-Requested-With": "tour-schedule" };
      if (body) h["Content-Type"] = "application/json";
      return fetch(path, { method: method, headers: h, credentials: "same-origin", body: body ? JSON.stringify(body) : undefined })
        .then(function (r) {
          return r.json().catch(function () { return {}; }).then(function (j) {
            if (r.status === 401) me = { signedIn: false };
            if (!r.ok) throw new Error(j.error || "The server refused the change (" + r.status + ").");
            return j;
          });
        });
    }
    function active() { return !!(me && me.signedIn && me.status === "active"); }
    function refresh() {
      if (!active()) return Promise.resolve();
      return Promise.all([getJson("api/records"), getJson("api/contacts"), getJson("api/trades").catch(function () { return {}; })]).then(function (res) {
        contacts = res[1];
        onChange({ statuses: res[0].statuses, tourChanges: res[0].tourChanges, covers: res[0].covers || [],
          people: res[0].people || [], staffing: res[0].staffing || [], contacts: contacts,
          trades: res[2].trades || [], tradeReplies: res[2].replies || [], members: [] });
      });
    }
    function thenRefresh(p) { return p.then(function (j) { return refresh().then(function () { return j; }); }); }

    return fetch("api/me", { cache: "no-store", credentials: "same-origin" }).then(function (r) {
      if (!r.ok) return null;
      var type = r.headers.get("Content-Type") || "";
      if (type.indexOf("application/json") === -1) return null;
      return r.json().then(function (j) {
        if (typeof j.signedIn !== "boolean") return null;
        me = j;
        setInterval(function () { if (!document.hidden) refresh().catch(function () {}); }, 60000);
        return refresh().then(function () {
          return {
            mode: "server",
            me: function () { return me; },
            isActive: active,
            isAdmin: function () { return active() && me.role === "admin"; },
            canEdit: function () { return active() && (me.role === "editor" || me.role === "admin"); },
            editorName: function () { return me && me.signedIn ? me.name || me.googleEmail : null; },
            needsSignIn: function () { return !(me && me.signedIn); },
            contacts: function () { return contacts; },
            signOut: function () { return call("POST", "auth/logout").then(function () { location.href = location.pathname; }); },
            claim: function (pos, note) { return call("POST", "api/me/claim", { pos: pos, note: note }).then(function (j) { me = j; return j; }); },
            claimRequest: function (req) { return call("POST", "api/me/claim", { request: req }).then(function (j) { me = j; return j; }); },
            rosterNames: function () { return getJson("api/roster-names"); },
            saveContact: function (c) { return thenRefresh(call("PUT", "api/me/contact", c).then(function (j) { me = j; return j; })); },
            adminUsers: function () { return getJson("api/admin/users"); },
            adminAction: function (id, body) { return thenRefresh(call("POST", "api/admin/users/" + encodeURIComponent(id), body)); },
            addStatus: function (rec) { return thenRefresh(call("POST", "api/statuses", rec)); },
            addTourChange: function (rec) { return thenRefresh(call("POST", "api/tour-changes", rec)); },
            addCover: function (rec) { return thenRefresh(call("POST", "api/covers", rec)); },
            canAdmin: function () { return active() && me.role === "admin"; },
            setStaffing: function (company, n) { return thenRefresh(call("PUT", "api/staffing/" + encodeURIComponent(company), { required: n })); },
            setProfile: function (key, dates) {
              return call("PUT", "api/profiles/" + encodeURIComponent(key), dates).then(function (j) {
                if (me && me.pos === key) me.profile = { birthDate: j.birthDate, hireDate: j.hireDate };
                return j;
              });
            },
            profiles: function () { return getJson("api/admin/profiles"); },
            stats: function (isoDate) { return getJson("api/stats?date=" + encodeURIComponent(isoDate)); },
            addPerson: function (rec) { return thenRefresh(call("POST", "api/people", rec)); },
            // Shift trades: the signed-in account's linked position is the member (claimed and approved on the Admin page).
            canTrade: function () { return active() && !!me.pos; },
            myKey: function () { return active() ? me.pos || null : null; },
            myMember: function () { return active() && me.pos ? { key: me.pos, alerts: me.alerts || {} } : null; },
            setAlerts: function (a) { return call("PUT", "api/me/alerts", a).then(function (j) { me = j; return j; }); },
            postTrade: function (rec) { return thenRefresh(call("POST", "api/trades", rec)); },
            widenTrade: function (id, audience) { return thenRefresh(call("PATCH", "api/trades/" + encodeURIComponent(id), { audience: audience })); },
            replyTrade: function (rec) {
              return thenRefresh(call("POST", "api/trades/" + encodeURIComponent(rec.tradeId) + "/replies", { proposal: rec.proposal, note: rec.note }));
            },
            // The server writes the cover and TR records itself.
            pickReply: function (trade, reply) {
              return thenRefresh(call("POST", "api/trades/" + encodeURIComponent(trade.id) + "/pick", { replyId: reply.id }));
            },
            cancelTrade: function (trade) { return thenRefresh(call("POST", "api/trades/" + encodeURIComponent(trade.id) + "/cancel")); },
            endCover: function (id, end) { return thenRefresh(call("PATCH", "api/covers/" + encodeURIComponent(id), { end: end })); },
            remove: function (kind, id) {
              return thenRefresh(call("DELETE", "api/" + API_PATH[kind] + "/" + encodeURIComponent(id)));
            },
          };
        });
      });
    }).catch(function () { return null; });
  }

  var readOnly = {
    mode: "none",
    canEdit: function () { return false; },
    editorName: function () { return null; },
    needsSignIn: function () { return false; },
    signOut: function () {},
    addStatus: function () { return Promise.reject(new Error("Editing is not available here.")); },
    addTourChange: function () { return Promise.reject(new Error("Editing is not available here.")); },
    addCover: function () { return Promise.reject(new Error("Editing is not available here.")); },
    addPerson: function () { return Promise.reject(new Error("Editing is not available here.")); },
    endCover: function () { return Promise.reject(new Error("Editing is not available here.")); },
    canAdmin: function () { return false; },
    setStaffing: function () { return Promise.reject(new Error("Editing is not available here.")); },
    setProfile: function () { return Promise.reject(new Error("Editing is not available here.")); },
    profiles: function () { return Promise.resolve([]); },
    stats: function () { return Promise.resolve(null); },
    remove: function () { return Promise.reject(new Error("Editing is not available here.")); },
    canTrade: function () { return false; },
    myKey: function () { return null; },
    myMember: function () { return null; },
  };

  /* A view-only snapshot: records baked into the page at build time (tools/build_artifact.py --snapshot),
     so the page needs no sign-in and no page database. */
  function snapshotAdapter(onChange) {
    var snap = root.SNAPSHOT, r = snap.records || {}, demo = root.TRADE_DEMO;
    var st = demo ? { as: demo.people[0], trades: demo.trades.slice(), replies: demo.tradeReplies.slice(), alerts: {}, n: 0 } : null;
    function emit() {
      onChange({ statuses: (r.statuses || []).concat(st ? tradeLegs(st.trades, "statuses") : []), tourChanges: r.tourChanges || [],
        covers: (r.covers || []).concat(st ? tradeLegs(st.trades, "covers") : []), people: r.people || [], staffing: r.staffing || [],
        trades: st ? st.trades : [], tradeReplies: st ? st.replies : [], members: [] });
    }
    setTimeout(emit, 0);
    var adapter = Object.assign({}, readOnly, { mode: "snapshot", asOf: snap.asOf });
    if (!st) return Promise.resolve(adapter);
    /* Trade demo (tools/build_artifact.py --demo): sample trades and a "viewing as" picker. Every trade action works in the
       page but nothing is saved; a reload starts over. */
    function upd(id, patch) {
      st.trades = st.trades.map(function (t) { return t.id === id ? Object.assign({}, t, patch) : t; });
      emit();
      return Promise.resolve();
    }
    return Promise.resolve(Object.assign(adapter, {
      demo: { people: demo.people, as: function () { return st.as; }, setAs: function (k) { st.as = k; emit(); } },
      canTrade: function () { return true; },
      myKey: function () { return st.as; },
      myMember: function () { return { key: st.as, alerts: st.alerts[st.as] || {} }; },
      setAlerts: function (a) { st.alerts[st.as] = { text: !!a.text, app: !!a.app, email: !!a.email, board: BOARD_ALERTS.indexOf(a.board) !== -1 ? a.board : "off" }; return Promise.resolve(); },
      postTrade: function (rec) {
        rec = Object.assign({}, rec, { id: "demo" + ++st.n, status: "open", createdAt: nowIso() });
        st.trades = st.trades.concat([rec]);
        emit();
        return Promise.resolve({ id: rec.id });
      },
      widenTrade: function (id, audience) { return upd(id, { audience: audience }); },
      replyTrade: function (rec) {
        st.replies = st.replies.filter(function (x) { return !(x.tradeId === rec.tradeId && x.takerKey === rec.takerKey); })
          .concat([Object.assign({}, rec, { id: "demo-r" + ++st.n, createdAt: nowIso() })]);
        emit();
        return Promise.resolve();
      },
      pickReply: function (trade, reply, writes) {
        return upd(trade.id, { status: "set", replyId: reply.id, takerKey: reply.takerKey, proposal: reply.proposal, setAt: nowIso(),
          legs: writes.map(function (w) { return Object.assign({ kind: w.kind }, w.rec); }) });
      },
      cancelTrade: function (trade) { return upd(trade.id, { status: "cancelled" }); },
    }));
  }

  function connect(onChange) {
    if (root.SNAPSHOT) return snapshotAdapter(onChange);
    return dbAdapter(onChange).then(function (a) {
      return a || serverAdapter(onChange).then(function (b) { return b || readOnly; });
    });
  }

  root.ScheduleStore = { connect: connect };
})(window);
