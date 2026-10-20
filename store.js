/* Storage for tour changes and work statuses (VA, D, S).
 *
 * ScheduleStore.connect(onChange) resolves an adapter for wherever the page is running:
 *   - "db":     the shared claude.ai page database (single-file build opened on claude.ai)
 *   - "server": the repo's server.py (/api/*), people sign in with Google; roles decide who edits
 *   - "none":   read-only (plain static hosting or a local file)
 *   - Firebase Hosting (tools/build_firebase.py): accounts work as on server.py, so it reports mode "server" (hosted:
 *     "firebase"); records come from Firestore onSnapshot as on the page. It adds signIn(), fetchData(path) (roster files
 *     from Cloud Storage), openDoc(file) and importBackup(backup, onProgress) (admins).
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
 * replyTrade with rec.via "poster" is an answer the poster got by text and records for someone (Add their answer).
 * Firebase adds personal invite links: createInvite(tradeId, keys) -> [{key, code, cell}], inviteInfo(code),
 * answerInvite(code, proposal, note), redeemInvite(code, emplId); a picked unconfirmed link answer leaves the trade "pending".
 * onTool(key): true when that person has claimed a record or has a linked account, false when not, null when unknown;
 * the poster gets Invite (a text from their own phone) for the people they sent a trade to who aren't on the tool.
 * onChange also carries {members, trades, tradeReplies}.
 * Employee card (admins): update(kind, id, patch), setOverride(pos, {emplId, name, rank} | null) (roster seats; onChange
 * carries rosterOverrides, readable by everyone), setCell(key, cell | null), restoreMember(doc), deleteCorrection(id).
 * The page database adds saveBackup() (admins): every collection, cell numbers included, offered as a file to the viewer
 * for the one-time move to Firebase.
 */
(function (root) {
  "use strict";
  var COLLECTIONS = { statuses: "statuses", tourChanges: "tourChanges", covers: "covers", people: "people", staffing: "staffing", profiles: "profiles",
    members: "members", trades: "trades", tradeReplies: "tradeReplies", contacts: "contacts",
    corrections: "corrections", assignments: "assignments", rosterOverrides: "rosterOverrides" };
  var API_PATH = { statuses: "statuses", tourChanges: "tour-changes", covers: "covers", people: "people" };
  var NO_EDIT = "Only editors can make changes on this page.";
  var BOARD_ALERTS = ["off", "daily", "each"]; // trade alerts for board posts: none, a daily summary, or each post
  var BACKUP_FORMAT = "tour-schedule-backup/1";

  function nowIso() { return new Date().toISOString(); }
  /* Corrections live one record per member, `corrections/<user id>` = {items: {<id>: correction}}: each member writes and
     reads only their own (page rule `corrections/{self}`), admins read and update all (rule at `corrections`). */
  function flattenFixes(docs) {
    var out = [];
    (docs || []).forEach(function (d) {
      Object.keys(d.items || {}).forEach(function (k) { out.push(Object.assign({}, d.items[k], { id: d.id + "/" + k, owner: d.id, item: k })); });
    });
    return out;
  }
  // Cell numbers from the internal staff list (admins only): {cells: {pos or "person:<id>": number}} -> contacts by key.
  function staffContacts(docs) {
    var out = {};
    (docs || []).forEach(function (d) {
      Object.keys(d.cells || {}).forEach(function (k) { out[k] = { phoneMobile: d.cells[k], shared: false, staffList: true }; });
    });
    return out;
  }
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
      var records = { statuses: [], tourChanges: [], covers: [], people: [], staffing: [], profiles: [], members: [], trades: [], tradeReplies: [], contacts: [], corrections: [], assignments: [], rosterOverrides: [] };
      function emit() {
        onChange({ statuses: records.statuses.concat(tradeLegs(records.trades, "statuses")), tourChanges: records.tourChanges,
          covers: records.covers.concat(tradeLegs(records.trades, "covers")), people: records.people,
          staffing: records.staffing.map(function (x) { return { company: x.id, required: x.required }; }),
          members: records.members, trades: records.trades, tradeReplies: records.tradeReplies, contacts: staffContacts(records.contacts),
          corrections: flattenFixes(records.corrections), assignments: records.assignments, rosterOverrides: records.rosterOverrides });
      }
      // A frozen page (tools/build_artifact.py --frozen, after the move to Firebase) is read-only for everyone; page
      // Editors (platformEdit) can still save the backup.
      var editable = false, platformEdit = false, uid = null, failed = false, canWrite = null;
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
          .then(function (r) { platformEdit = !!r[0]; editable = platformEdit && !root.PAGE_FROZEN; uid = r[1]; canWrite = r[2]; })
        : Promise.resolve();
      /* Trades are written by every member (Contributor access and up), not only editors. can("data.write") null means the
         platform didn't say: keep the controls and let a refused write decide. */
      var tradeBlocked = false;
      function tradeOk() { return !!uid && !tradeBlocked && !root.PAGE_FROZEN && (editable || canWrite !== false); }
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
          /* Admins: every collection as one file for the move to Firebase (Admin, Import backup there). It holds the
             staff-list cell numbers, so it goes only to the viewer's own device. Resolves {records, collections}. */
          canBackup: function () { return platformEdit; },
          saveBackup: function () {
            if (!platformEdit) return Promise.reject(new Error(NO_EDIT));
            var out = { format: BACKUP_FORMAT, exportedAt: nowIso(), collections: {} }, n = 0;
            Object.keys(COLLECTIONS).forEach(function (kind) { out.collections[COLLECTIONS[kind]] = records[kind]; n += records[kind].length; });
            return root.claude.use("downloads").then(function (dl) {
              if (!dl) throw new Error("Downloads aren't available in this view. Open the page on claude.ai in a browser.");
              return dl.save({ filename: "tour-schedule-backup-" + nowIso().slice(0, 10) + ".json", data: JSON.stringify(out) });
            }).then(function () { return { records: n, collections: Object.keys(out.collections).length }; }, function (e) {
              throw new Error(e && e.code === "declined" ? "The download was cancelled." : (e && e.message) || "The download failed.");
            });
          },
          canTrade: function () { return tradeOk(); },
          myMember: myMember,
          myKey: function () { var m = myMember(); return m ? m.key : null; },
          onTool: function (key) { return records.members.some(function (m) { return m.key === key; }); },
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
          /* Corrections: any signed-in member sends one (read by admins only); admins apply or dismiss. */
          canSuggest: function () { return tradeOk(); },
          suggest: function (rec) {
            if (!tradeOk()) return Promise.reject(tradeErr());
            var m = myMember(), item = {}, k = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
            rec.state = "open";
            rec.byKey = m ? m.key : null;
            rec.createdAt = nowIso();
            rec.createdBy = uid;
            item[k] = rec;
            var ref = db.collection("corrections").doc(uid);
            return tw(ref.get().then(function (s) { return s.exists ? ref.update({ items: item }) : ref.set({ items: item }); }));
          },
          handleCorrection: function (id, state, reason) {
            if (!editable) return Promise.reject(new Error(NO_EDIT));
            var parts = String(id).split("/"), item = {};
            item[parts[1]] = { state: state, reason: reason || null, handledBy: uid, handledAt: nowIso() };
            return db.collection("corrections").doc(parts[0]).update({ items: item });
          },
          setVerified: function () {
            if (!myMember()) return Promise.reject(new Error("Pick yourself first."));
            return tw(db.collection("members").doc(uid).update({ verifiedAt: nowIso() }));
          },
          // Admins: put a cell number in the staff-list contacts record (null removes it).
          setCell: function (key, cell) {
            if (!editable) return Promise.reject(new Error(NO_EDIT));
            var doc = records.contacts.filter(function (d) { return d.id === "staff-list"; })[0];
            var cells = Object.assign({}, doc ? doc.cells : {});
            if (cell) cells[key] = cell; else delete cells[key];
            return db.collection("contacts").doc("staff-list").set({ asOf: doc ? doc.asOf : null, source: doc ? doc.source : "Corrections", cells: cells });
          },
          /* Employee card (admins). update merges fields into one record; a null field clears it. */
          update: function (kind, id, patch) {
            if (!editable) return Promise.reject(new Error(NO_EDIT));
            return db.collection(COLLECTIONS[kind]).doc(id).update(Object.assign({}, patch, { updatedAt: nowIso(), updatedBy: uid }));
          },
          // A roster seat's name, rank or Employee ID over the vacancy list and employee-ids.json; all empty removes it.
          setOverride: function (pos, o) {
            if (!editable) return Promise.reject(new Error(NO_EDIT));
            var ref = db.collection("rosterOverrides").doc(pos);
            if (!o || !(o.emplId || o.name || o.rank)) return ref.delete();
            return ref.set({ emplId: o.emplId || null, name: o.name || null, rank: o.rank || null, forName: o.forName || null, updatedAt: nowIso(), updatedBy: uid });
          },
          // Undo for unclaim: put the removed "this is me" record back as it was.
          restoreMember: function (doc) {
            if (!editable) return Promise.reject(new Error(NO_EDIT));
            var rec = Object.assign({}, doc);
            delete rec.id;
            return db.collection("members").doc(doc.id).set(rec);
          },
          // A correction is one item in its owner's record; the record is rewritten without it.
          deleteCorrection: function (id) {
            if (!editable) return Promise.reject(new Error(NO_EDIT));
            var parts = String(id).split("/"), ref = db.collection("corrections").doc(parts[0]);
            return ref.get().then(function (s) {
              if (!s.exists) return;
              var d = s.data(), items = Object.assign({}, d.items);
              delete items[parts[1]];
              return ref.set(Object.assign({}, d, { items: items }));
            });
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
    var me = null, contacts = {}, onTool = null;
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
      var admin = me.role === "admin" || me.role === "editor";
      return Promise.all([getJson("api/records"), getJson("api/contacts"), getJson("api/trades").catch(function () { return {}; }),
        admin ? getJson("api/admin/corrections").catch(function () { return []; }) : Promise.resolve([])]).then(function (res) {
        contacts = res[1];
        onTool = res[2].onTool || null;
        onChange({ statuses: res[0].statuses, tourChanges: res[0].tourChanges, covers: res[0].covers || [],
          people: res[0].people || [], staffing: res[0].staffing || [], contacts: contacts,
          trades: res[2].trades || [], tradeReplies: res[2].replies || [], members: [], corrections: res[3] || [],
          rosterOverrides: res[0].rosterOverrides || [] });
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
            canSuggest: function () { return active(); },
            suggest: function (rec) { return thenRefresh(call("POST", "api/corrections", rec)); },
            handleCorrection: function (id, state, reason) {
              return thenRefresh(call("PATCH", "api/admin/corrections/" + encodeURIComponent(id), { state: state, reason: reason || null }));
            },
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
            onTool: function (key) { return onTool ? onTool.indexOf(key) !== -1 : null; },
            setAlerts: function (a) { return call("PUT", "api/me/alerts", a).then(function (j) { me = j; return j; }); },
            postTrade: function (rec) { return thenRefresh(call("POST", "api/trades", rec)); },
            widenTrade: function (id, audience) { return thenRefresh(call("PATCH", "api/trades/" + encodeURIComponent(id), { audience: audience })); },
            replyTrade: function (rec) {
              return thenRefresh(call("POST", "api/trades/" + encodeURIComponent(rec.tradeId) + "/replies", { proposal: rec.proposal, note: rec.note,
                takerKey: rec.via === "poster" ? rec.takerKey : undefined }));
            },
            // The server writes the cover and TR records itself.
            pickReply: function (trade, reply) {
              return thenRefresh(call("POST", "api/trades/" + encodeURIComponent(trade.id) + "/pick", { replyId: reply.id }));
            },
            cancelTrade: function (trade) { return thenRefresh(call("POST", "api/trades/" + encodeURIComponent(trade.id) + "/cancel")); },
            endCover: function (id, end) { return thenRefresh(call("PATCH", "api/covers/" + encodeURIComponent(id), { end: end })); },
            update: function (kind, id, patch) {
              return thenRefresh(call("PATCH", "api/admin/records/" + API_PATH[kind] + "/" + encodeURIComponent(id), patch));
            },
            setOverride: function (pos, o) { return thenRefresh(call("PUT", "api/admin/overrides/" + encodeURIComponent(pos), o || {})); },
            setCell: function (key, cell) { return thenRefresh(call("PUT", "api/admin/cells/" + encodeURIComponent(key), { cell: cell || null })); },
            deleteCorrection: function (id) { return thenRefresh(call("DELETE", "api/admin/corrections/" + encodeURIComponent(id))); },
            remove: function (kind, id) {
              return thenRefresh(call("DELETE", "api/" + API_PATH[kind] + "/" + encodeURIComponent(id)));
            },
          };
        });
      });
    }).catch(function () { return null; });
  }

  /* ---------- Firebase Hosting (Google sign-in, Firestore, Cloud Storage) ----------
     tools/build_firebase.py loads the Firebase SDK and Hosting's /__/firebase/init.js and sets FIREBASE_HOSTED. Accounts
     (sign-in gate, claim, Admin page, My page) work as on server.py, so the screens see mode "server". Roles are custom
     claims {active, role, pos} that only the functions in firebase/functions set; firebase/firestore.rules checks them.
     Records are read with onSnapshot and written as on the claude.ai page, trades included (legs on the trade).
     Two Hosting sites share it (FIREBASE_SITE): "admin", the full page for editors and admins (anyone else is sent to the
     app), and "app", the employee build, where everyone works as a member (no edit forms or admin screens). The rules,
     not the site, decide what each account may read or write. settings/site {mode: "test" | "live"} drives the
     "Test copy" banner until cut-over (CUTOVER.md). */
  var IMPORT_KINDS = ["statuses", "tourChanges", "covers", "people", "staffing", "profiles", "members", "trades", "tradeReplies",
    "corrections", "assignments", "rosterOverrides"];
  // Replaced on cut-over: every record collection (staff-list cells included); accounts, contact info, audit and settings stay.
  var REPLACE_KINDS = IMPORT_KINDS.concat(["staffCells"]);
  function firebaseAdapter(onChange) {
    var SITE = root.FIREBASE_SITE === "app" ? "app" : "admin";
    var fb = root.firebase;
    if (!root.FIREBASE_HOSTED || !fb || !fb.apps || !fb.apps.length) return Promise.resolve(null);
    var auth = fb.auth(), fs = fb.firestore(), fns = fb.functions();
    var me = { signedIn: false, google: true }, claims = {}, user = null, listening = false, onTool = null;
    var phoneVerifier = null, phoneConfirm = null;
    var PHONE_ERRORS = {
      "auth/invalid-verification-code": "That code isn't right. Check the text and try again.",
      "auth/code-expired": "That code has expired. Ask for a new one.",
      "auth/too-many-requests": "Too many tries from this phone. Wait a while, then try again.",
      "auth/invalid-phone-number": "Enter your 10-digit cell number.",
      "auth/quota-exceeded": "The sign-in texts are used up for today. Try again tomorrow or use Google.",
      "auth/operation-not-allowed": "Cell-number sign-in isn't turned on yet. Use Google for now.",
      "auth/captcha-check-failed": "The page check failed. Reload and try again.",
    };
    var records = { statuses: [], tourChanges: [], covers: [], people: [], staffing: [], profiles: [], trades: [], tradeReplies: [],
      corrections: [], assignments: [], rosterOverrides: [], contacts: [], myContact: [], staffCells: [], launchInvites: [], site: null };

    function call(name, data) {
      return fns.httpsCallable(name)(data || {}).then(function (r) { return r.data; }, function (e) {
        var err = new Error((e && e.message) || "The server refused the request.");
        err.reason = e && e.details && e.details.reason; // syncMe: "disabled" or "domain", shown on the sign-in screen
        throw err;
      });
    }
    function approved() { return !!(me.signedIn && me.status === "active" && claims.active === true); }
    // Ask the alert function to send what's due for a trade or an answer; alerts never hold up the page.
    function notify(kind, id) { if (id) call("notify", { kind: kind, id: id }).catch(function (e) { if (root.console) console.warn("alerts: " + e.message); }); }
    function staff() { return approved() && (claims.role === "editor" || claims.role === "admin"); }
    function wrongSite() { return SITE === "admin" && me.signedIn && !staff(); }
    function active() { return approved() && !wrongSite(); }
    function role() { return !active() ? null : SITE === "app" ? "member" : claims.role; }
    function editable() { return role() === "editor" || role() === "admin"; }
    function admin() { return role() === "admin"; }
    function guard(ok) { return ok ? null : Promise.reject(new Error(NO_EDIT)); }
    function refusal(e) {
      throw new Error(e && e.code === "permission-denied" ? "You don't have access to make that change." :
        "The change was not saved (" + ((e && (e.code || e.message)) || "error") + ").");
    }
    function w(p) { return p.catch(refusal); }

    /* The signed-in account: syncMe creates it (pending) on first sign-in, refreshes the claims and returns the same JSON as
       server.py's /api/me. The ID token is refreshed when the claims changed, so the rules see them at once. */
    function syncMe() {
      return call("syncMe").then(function (j) {
        me = j;
        return user.getIdTokenResult(!!j.claimsChanged);
      }).then(function (t) {
        claims = t.claims || {};
        me.wrongSite = wrongSite();
        me.appUrl = root.FIREBASE_APP_URL || null;
      });
    }

    function contactMap() {
      var out = {};
      if (admin()) out = staffContacts([{ cells: records.staffCells.reduce(function (o, d) { o[d.id] = d.cell; return o; }, {}) }]);
      records.contacts.concat(records.myContact).forEach(function (c) {
        if (c.pos) out[c.pos] = { email: c.contactEmail || null, phoneMobile: c.phoneMobile || null, phoneOther: c.phoneOther || null, shared: !!c.share };
      });
      return out;
    }
    function emit() {
      onChange({ statuses: records.statuses.concat(tradeLegs(records.trades, "statuses")), tourChanges: records.tourChanges,
        covers: records.covers.concat(tradeLegs(records.trades, "covers")), people: records.people,
        staffing: records.staffing.map(function (x) { return { company: x.id, required: x.required }; }),
        members: [], trades: records.trades, tradeReplies: records.tradeReplies, contacts: contactMap(),
        corrections: flattenFixes(records.corrections), assignments: records.assignments, rosterOverrides: records.rosterOverrides });
    }
    function docs(snap) { return snap.docs.map(function (d) { var o = Object.assign({}, d.data()); o.id = d.id; return o; }); }
    function watch(kind, ref) {
      ref.onSnapshot(function (snap) {
        records[kind] = snap.docs ? docs(snap) : snap.exists ? [Object.assign({}, snap.data(), { id: snap.id })] : [];
        emit();
      }, function (e) { if (root.console) console.warn("Firestore " + kind + ": " + (e && e.code)); });
    }
    function listen() {
      if (listening || !active()) return;
      listening = true;
      ["statuses", "tourChanges", "covers", "people", "staffing", "assignments", "rosterOverrides", "trades", "tradeReplies"]
        .forEach(function (kind) { watch(kind, fs.collection(kind)); });
      watch("contacts", admin() ? fs.collection("contacts") : fs.collection("contacts").where("share", "==", true));
      watch("myContact", fs.collection("contacts").doc(user.uid));
      watch("corrections", editable() ? fs.collection("corrections") : fs.collection("corrections").doc(user.uid));
      if (admin()) { watch("profiles", fs.collection("profiles")); watch("staffCells", fs.collection("staffCells")); watch("launchInvites", fs.collection("launchInvites")); }
      watch("site", fs.collection("settings").doc("site"));
      // Who's on the tool (active linked accounts), for Invite on trades; refreshed every 10 minutes.
      var loadOnTool = function () { call("onToolKeys").then(function (keys) { onTool = keys; emit(); }, function () {}); };
      loadOnTool();
      setInterval(function () { if (!document.hidden) loadOnTool(); }, 600000);
    }
    // Approval, a role change or a new roster link (made by an admin) reloads the page with the new access.
    function watchAccount() {
      fs.collection("users").doc(user.uid).onSnapshot(function (s) {
        var d = s.exists ? s.data() : null;
        if (!d || (d.status === me.status && d.role === me.role && (d.pos || null) === (me.pos || null))) return;
        syncMe().then(function () { location.reload(); }, function () {});
      }, function () {});
    }

    function addRec(kind, rec) {
      rec.createdAt = nowIso();
      rec.createdBy = user.uid;
      return fs.collection(kind).add(rec);
    }
    function write(kind, rec) { return guard(editable()) || w(addRec(COLLECTIONS[kind], rec)); }
    // Files that hold names (roster, IDs, PDFs) are in Cloud Storage, readable by active accounts only (storage.rules).
    function fetchData(path) {
      var bucket = fb.app().options.storageBucket;
      return user.getIdToken().then(function (t) {
        return fetch("https://firebasestorage.googleapis.com/v0/b/" + encodeURIComponent(bucket) + "/o/" + encodeURIComponent(path) + "?alt=media",
          { headers: { Authorization: "Firebase " + t } });
      });
    }

    var adapter = {
      mode: "server",
      hosted: "firebase",
      me: function () { return me; },
      isActive: active,
      isAdmin: admin,
      canEdit: editable,
      canAdmin: admin,
      editorName: function () { return me.signedIn ? me.name || me.googleEmail : null; },
      // "test" until an admin sets the copy live at cut-over; null until the setting has loaded.
      siteMode: function () { return records.site === null ? null : records.site[0] && records.site[0].mode === "live" ? "live" : "test"; },
      setSiteMode: function (mode) {
        if (!admin()) return Promise.reject(new Error(NO_EDIT));
        return w(fs.collection("settings").doc("site").set({ mode: mode === "live" ? "live" : "test", updatedAt: nowIso(), updatedBy: user.uid }));
      },
      // On the employee app, editors and admins get a link to the back office (FIREBASE_ADMIN_URL, set at build).
      adminUrl: function () { return SITE === "app" && staff() ? root.FIREBASE_ADMIN_URL || null : null; },
      needsSignIn: function () { return !me.signedIn; },
      contacts: contactMap,
      signIn: function () {
        var provider = new fb.auth.GoogleAuthProvider();
        provider.setCustomParameters({ prompt: "select_account" });
        return auth.signInWithPopup(provider).then(function () { location.reload(); }, function (e) {
          if (e && (e.code === "auth/popup-blocked" || e.code === "auth/operation-not-supported-in-this-environment")) return auth.signInWithRedirect(provider);
          if (e && (e.code === "auth/popup-closed-by-user" || e.code === "auth/cancelled-popup-request")) return;
          throw e;
        });
      },
      signOut: function () { return auth.signOut().then(function () { location.href = location.pathname; }); },
      /* Cell-number sign-in (Firebase Auth phone provider): sendCode(cell, buttonId) texts a 6-digit code, behind an
         invisible reCAPTCHA on that button; confirmCode(code) signs in. A staff-list cell links the account at once (syncMe). */
      phoneSignIn: true,
      sendCode: function (cell, buttonId) {
        var digits = String(cell || "").replace(/[^0-9]/g, "");
        if (digits.length === 11 && digits[0] === "1") digits = digits.slice(1);
        if (digits.length !== 10) return Promise.reject(new Error("Enter your 10-digit cell number."));
        if (!phoneVerifier) phoneVerifier = new fb.auth.RecaptchaVerifier(buttonId, { size: "invisible" });
        return auth.signInWithPhoneNumber("+1" + digits, phoneVerifier).then(function (c) { phoneConfirm = c; return "+1" + digits; }, function (e) {
          if (phoneVerifier) { try { phoneVerifier.clear(); } catch (x) { /* already gone */ } phoneVerifier = null; }
          throw new Error(PHONE_ERRORS[e && e.code] || (e && e.message) || "Couldn't send the code.");
        });
      },
      confirmCode: function (code) {
        if (!phoneConfirm) return Promise.reject(new Error("Ask for a code first."));
        return phoneConfirm.confirm(String(code || "").trim()).then(function () { location.reload(); }, function (e) {
          throw new Error(PHONE_ERRORS[e && e.code] || (e && e.message) || "That code didn't work.");
        });
      },
      claim: function (pos, note) { return call("claim", { pos: pos, note: note }).then(function (j) { me = j; return j; }); },
      claimRequest: function (req) { return call("claim", { request: req }).then(function (j) { me = j; return j; }); },
      rosterNames: function () { return call("rosterNames"); },
      /* Launch invites (admins, Admin → Invite people): the staff-list cells (contacts()), who's on the tool (onTool),
         who was already texted (launchSent: pos -> {via, sentAt}), marking texts sent from the admin's own phone, the
         contact-card download log, and texts from the department number once Twilio is set up. */
      launchSent: function () { var o = {}; records.launchInvites.forEach(function (d) { o[d.id] = d; }); return o; },
      launchMark: function (keys, via) {
        if (!admin()) return Promise.reject(new Error(NO_EDIT));
        var batch = fs.batch(), at = nowIso();
        keys.forEach(function (k) { batch.set(fs.collection("launchInvites").doc(k), { via: via, sentAt: at, by: user.uid }); });
        return w(batch.commit());
      },
      launchUnmark: function (key) { return admin() ? w(fs.collection("launchInvites").doc(key).delete()) : Promise.reject(new Error(NO_EDIT)); },
      launchStatus: function () { return call("launchInvites", { action: "status" }); },
      launchAudit: function (count) { return call("launchInvites", { action: "audit", count: count }); },
      launchSend: function (keys, text) { return call("launchInvites", { action: "send", keys: keys, text: text }); },
      // Trade invites: personal links (functions createInvite, inviteInfo, answerFromInvite, redeemInvite).
      createInvite: function (tradeId, keys) { return call("createInvite", { tradeId: tradeId, keys: keys }); },
      inviteInfo: function (code) { return call("inviteInfo", { code: code }); },
      answerInvite: function (code, proposal, note) { return call("answerFromInvite", { code: code, proposal: proposal, note: note || "" }); },
      redeemInvite: function (code, emplId) { return call("redeemInvite", { code: code, emplId: emplId }).then(function (j) { me = j; return j; }); },
      saveContact: function (c) {
        var rec = { pos: me.pos || null, contactEmail: c.contactEmail || null, phoneMobile: c.phoneMobile || null,
          phoneOther: c.phoneOther || null, share: !!c.shareContact, updatedAt: nowIso() };
        return w(fs.collection("contacts").doc(user.uid).set(rec)).then(function () {
          Object.assign(me, { contactEmail: rec.contactEmail, phoneMobile: rec.phoneMobile, phoneOther: rec.phoneOther, shareContact: rec.share });
          return me;
        });
      },
      adminUsers: function () { return call("adminUsers"); },
      adminAction: function (id, body) { return call("adminAction", Object.assign({ id: id }, body)); },
      stats: function (isoDate) { return active() ? call("stats", { date: isoDate }) : Promise.resolve(null); },
      addStatus: function (rec) { return write("statuses", rec); },
      addTourChange: function (rec) { return write("tourChanges", rec); },
      addCover: function (rec) { return write("covers", rec); },
      addPerson: function (rec) { return write("people", rec); },
      endCover: function (id, end) { return guard(editable()) || w(fs.collection("covers").doc(id).update({ end: end })); },
      setStaffing: function (company, n) {
        if (!admin()) return Promise.reject(new Error(NO_EDIT));
        var ref = fs.collection("staffing").doc(company);
        return w(n == null ? ref.delete() : ref.set({ required: n, updatedAt: nowIso(), updatedBy: user.uid }));
      },
      // Admins set anyone's dates; a member sets their own (the key is their linked position).
      setProfile: function (key, dates) {
        if (!admin() && !(active() && key === me.pos)) return Promise.reject(new Error(NO_EDIT));
        var rec = { birthDate: dates.birthDate || null, hireDate: dates.hireDate || null, updatedAt: nowIso(), updatedBy: user.uid };
        return w(fs.collection("profiles").doc(key).set(rec)).then(function () {
          if (key === me.pos) me.profile = { birthDate: rec.birthDate, hireDate: rec.hireDate };
          return { key: key, birthDate: rec.birthDate, hireDate: rec.hireDate };
        });
      },
      profiles: function () {
        return Promise.resolve(records.profiles.map(function (x) { return { key: x.id, birthDate: x.birthDate, hireDate: x.hireDate }; }));
      },
      canTrade: function () { return active() && !!me.pos; },
      myKey: function () { return active() ? me.pos || null : null; },
      myMember: function () { return active() && me.pos ? { key: me.pos, alerts: me.alerts || {} } : null; },
      onTool: function (key) { return onTool ? onTool.indexOf(key) !== -1 : null; },
      setAlerts: function (a) {
        var alerts = { text: !!a.text, app: !!a.app, email: !!a.email, board: BOARD_ALERTS.indexOf(a.board) !== -1 ? a.board : "off" };
        return w(fs.collection("users").doc(user.uid).update({ alerts: alerts })).then(function () { me.alerts = alerts; return me; });
      },
      postTrade: function (rec) {
        rec.status = "open";
        return w(addRec("trades", rec)).then(function (ref) { notify("trade", ref && ref.id); return { id: ref && ref.id }; });
      },
      widenTrade: function (id, audience) { return w(fs.collection("trades").doc(id).update({ audience: audience })).then(function () { notify("trade", id); }); },
      replyTrade: function (rec) { return w(addRec("tradeReplies", rec)).then(function (ref) { notify("reply", ref && ref.id); return ref; }); },
      // An answer from an invite link that isn't confirmed yet waits ("pending") until they sign in with their Employee ID.
      pickReply: function (trade, reply, writes) {
        return w(fs.collection("trades").doc(trade.id).update({ status: reply.via === "link" && !reply.verified ? "pending" : "set", replyId: reply.id, takerKey: reply.takerKey,
          proposal: reply.proposal, setAt: nowIso(), legs: writes.map(function (x) { return Object.assign({ kind: x.kind }, x.rec); }) }))
          .then(function () { notify("trade", trade.id); });
      },
      cancelTrade: function (trade) { return w(fs.collection("trades").doc(trade.id).update({ status: "cancelled", cancelledAt: nowIso() })).then(function () { notify("trade", trade.id); }); },
      // Trade alerts are on here (functions: notify, alertAction, smsReply, dailySummary). App notifications need the
      // Web Push key (FIREBASE_VAPID_KEY, set at build) and the person's permission; the token goes on their account.
      alertsLive: true,
      canPush: function () { return !!(root.FIREBASE_VAPID_KEY && fb.messaging && root.Notification && navigator.serviceWorker); },
      registerPush: function () {
        if (!adapter.canPush()) return Promise.reject(new Error("App notifications aren't set up on this site yet."));
        return Notification.requestPermission().then(function (p) {
          if (p !== "granted") throw new Error("Notifications are blocked for this site. Allow them in your browser or phone settings." +
            (/iPhone|iPad/.test(navigator.userAgent) ? " On iPhone, first add this page to your Home Screen (Share → Add to Home Screen) and open it from there." : ""));
          return navigator.serviceWorker.register("/firebase-messaging-sw.js");
        }).then(function (reg) {
          return fb.messaging().getToken({ vapidKey: root.FIREBASE_VAPID_KEY, serviceWorkerRegistration: reg });
        }).then(function (token) {
          if (!token) throw new Error("This browser didn't give a notification token.");
          return w(fs.collection("users").doc(user.uid).update({ pushTokens: fb.firestore.FieldValue.arrayUnion(token) }));
        });
      },
      // Corrections: one record per member, corrections/<uid> = {items: {<id>: correction}}; merge keeps the other items.
      canSuggest: function () { return active(); },
      suggest: function (rec) {
        var item = {}, k = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        item[k] = Object.assign(rec, { state: "open", byKey: me.pos || null, createdAt: nowIso(), createdBy: user.uid });
        return w(fs.collection("corrections").doc(user.uid).set({ items: item }, { merge: true }));
      },
      handleCorrection: function (id, state, reason) {
        if (!editable()) return Promise.reject(new Error(NO_EDIT));
        var parts = String(id).split("/"), item = {};
        item[parts[1]] = { state: state, reason: reason || null, handledBy: user.uid, handledAt: nowIso() };
        return w(fs.collection("corrections").doc(parts[0]).set({ items: item }, { merge: true }));
      },
      deleteCorrection: function (id) {
        if (!admin()) return Promise.reject(new Error(NO_EDIT));
        var parts = String(id).split("/"), ref = fs.collection("corrections").doc(parts[0]);
        return w(ref.get().then(function (s) {
          if (!s.exists) return;
          var d = s.data(), items = Object.assign({}, d.items);
          delete items[parts[1]];
          return ref.set(Object.assign({}, d, { items: items }));
        }));
      },
      // Admins: the staff-list cell number (staffCells, admin-only rules); null removes it.
      setCell: function (key, cell) {
        if (!admin()) return Promise.reject(new Error(NO_EDIT));
        var ref = fs.collection("staffCells").doc(key);
        return w(cell ? ref.set({ cell: cell, updatedAt: nowIso(), updatedBy: user.uid }) : ref.delete());
      },
      update: function (kind, id, patch) {
        if (!editable()) return Promise.reject(new Error(NO_EDIT));
        return w(fs.collection(COLLECTIONS[kind]).doc(id).update(Object.assign({}, patch, { updatedAt: nowIso(), updatedBy: user.uid })));
      },
      setOverride: function (pos, o) {
        if (!admin()) return Promise.reject(new Error(NO_EDIT));
        var ref = fs.collection("rosterOverrides").doc(pos);
        if (!o || !(o.emplId || o.name || o.rank)) return w(ref.delete());
        return w(ref.set({ emplId: o.emplId || null, name: o.name || null, rank: o.rank || null, forName: o.forName || null, updatedAt: nowIso(), updatedBy: user.uid }));
      },
      remove: function (kind, id) {
        if (!editable()) return Promise.reject(new Error(NO_EDIT));
        var first = Promise.resolve();
        if (kind === "people") {
          var key = "person:" + id;
          var linked = records.covers.filter(function (c) { return c.coverKey === key; }).map(function (c) { return ["covers", c.id]; })
            .concat(records.statuses.filter(function (x) { return x.pos === key; }).map(function (x) { return ["statuses", x.id]; }));
          first = linked.reduce(function (p, kd) { return p.then(function () { return fs.collection(kd[0]).doc(kd[1]).delete(); }); }, first);
        }
        return w(first.then(function () { return fs.collection(COLLECTIONS[kind]).doc(id).delete(); }));
      },
      fetchData: fetchData,
      // Opens a PDF from Cloud Storage; the tab is opened first so the browser doesn't block it as a pop-up.
      openDoc: function (file) {
        var tab = root.open("", "_blank");
        return fetchData("docs/" + file).then(function (r) {
          if (!r.ok) throw new Error("HTTP " + r.status);
          return r.blob();
        }).then(function (b) {
          var url = URL.createObjectURL(new Blob([b], { type: "application/pdf" }));
          if (tab) tab.location.href = url; else location.href = url;
        }, function (e) { if (tab) tab.close(); throw e; });
      },
      /* Admins: loads a backup file saved from the claude.ai page (its saveBackup), ids kept, so it can be run again.
         The staff-list record (contacts/staff-list) becomes one staffCells doc per person; other contacts records are
         skipped. opts.replace (cut-over): first removes every record in REPLACE_KINDS that isn't in the file, so Firestore
         ends up holding exactly the page's records; accounts, contact info, audit and settings are left alone.
         Only counts are reported. onProgress(text). Resolves {collection: {backup, firestore}}, read back after the write. */
      importBackup: function (backup, opts, onProgress) {
        if (!admin()) return Promise.reject(new Error(NO_EDIT));
        if (!backup || backup.format !== BACKUP_FORMAT || !backup.collections) return Promise.reject(new Error("This isn't a backup file from the claude.ai page."));
        var cols = backup.collections, writes = [], want = {};
        REPLACE_KINDS.forEach(function (k) { want[k] = {}; });
        IMPORT_KINDS.forEach(function (kind) {
          (cols[kind] || []).forEach(function (d) {
            var rec = Object.assign({}, d);
            delete rec.id;
            if (d.id) { writes.push([kind, String(d.id), rec]); want[kind][String(d.id)] = true; }
          });
        });
        (cols.contacts || []).forEach(function (d) {
          if (d.id !== "staff-list") return;
          Object.keys(d.cells || {}).forEach(function (k) {
            if (d.cells[k]) { writes.push(["staffCells", k, { cell: String(d.cells[k]), updatedAt: d.asOf || nowIso(), updatedBy: "import" }]); want.staffCells[k] = true; }
          });
        });
        var say = onProgress || function () {};
        function inBatches(ops, apply, label) {
          var chain = Promise.resolve(), done = 0;
          for (var i = 0; i < ops.length; i += 400) {
            (function (part) {
              chain = chain.then(function () {
                var batch = fs.batch();
                part.forEach(function (x) { apply(batch, x); });
                return batch.commit().then(function () { done += part.length; say(label + " " + done + " of " + ops.length + "…"); });
              });
            })(ops.slice(i, i + 400));
          }
          return chain;
        }
        var removals = Promise.resolve([]);
        if (opts && opts.replace) {
          removals = Promise.all(REPLACE_KINDS.map(function (k) {
            return fs.collection(k).get().then(function (snap) {
              return snap.docs.filter(function (d) { return !want[k][d.id]; }).map(function (d) { return [k, d.id]; });
            });
          })).then(function (lists) { return [].concat.apply([], lists); });
        }
        return w(removals.then(function (gone) {
          return inBatches(gone, function (b, x) { b.delete(fs.collection(x[0]).doc(x[1])); }, "Removed");
        }).then(function () {
          return inBatches(writes, function (b, x) { b.set(fs.collection(x[0]).doc(x[1]), x[2]); }, "Imported");
        }).then(function () {
          return Promise.all(REPLACE_KINDS.map(function (k) { return fs.collection(k).get(); }));
        }).then(function (snaps) {
          var out = {};
          REPLACE_KINDS.forEach(function (k, i) { out[k] = { backup: Object.keys(want[k]).length, firestore: snaps[i].docs.length }; });
          return out;
        }));
      },
    };

    return new Promise(function (resolve) {
      var off = auth.onAuthStateChanged(function (u) { off(); resolve(u); });
    }).then(function (u) {
      if (!u) return adapter;
      user = u;
      return syncMe().then(function () {
        watchAccount();
        listen();
        return adapter;
      });
    }).catch(function (e) {
      // Signed in but the account was refused (disabled, or not an allowed domain): back to the sign-in screen, with why.
      if (root.console) console.warn(e && e.message);
      try { history.replaceState(null, "", location.pathname + "?auth_error=" + encodeURIComponent((e && e.reason) || "google")); } catch (x) { /* old browser */ }
      return auth.signOut().then(function () { me = { signedIn: false, google: true }; return adapter; });
    });
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
    onTool: function () { return null; },
  };

  /* A view-only snapshot: records baked into the page at build time (tools/build_artifact.py --snapshot),
     so the page needs no sign-in and no page database. */
  function snapshotAdapter(onChange) {
    var snap = root.SNAPSHOT, r = snap.records || {}, demo = root.TRADE_DEMO;
    var st = demo ? { as: demo.people[0], trades: demo.trades.slice(), replies: demo.tradeReplies.slice(), alerts: {}, n: 0 } : null;
    function emit() {
      onChange({ statuses: (r.statuses || []).concat(st ? tradeLegs(st.trades, "statuses") : []), tourChanges: r.tourChanges || [],
        covers: (r.covers || []).concat(st ? tradeLegs(st.trades, "covers") : []), people: r.people || [], staffing: r.staffing || [],
        trades: st ? st.trades : [], tradeReplies: st ? st.replies : [], members: [], assignments: r.assignments || [], rosterOverrides: r.rosterOverrides || [] });
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
      onTool: function (key) { return demo.people.indexOf(key) !== -1; },
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
    if (root.FIREBASE_HOSTED) return firebaseAdapter(onChange).then(function (f) { return f || readOnly; });
    return dbAdapter(onChange).then(function (a) {
      return a || serverAdapter(onChange).then(function (b) { return b || readOnly; });
    });
  }

  root.ScheduleStore = { connect: connect };
})(window);
