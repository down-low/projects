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
 */
(function (root) {
  "use strict";
  var COLLECTIONS = { statuses: "statuses", tourChanges: "tourChanges", covers: "covers", people: "people", staffing: "staffing", profiles: "profiles" };
  var API_PATH = { statuses: "statuses", tourChanges: "tour-changes", covers: "covers", people: "people" };
  var NO_EDIT = "Only editors can make changes on this page.";

  function nowIso() { return new Date().toISOString(); }
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
      var records = { statuses: [], tourChanges: [], covers: [], people: [], staffing: [], profiles: [] };
      function emit() {
        onChange({ statuses: records.statuses, tourChanges: records.tourChanges, covers: records.covers, people: records.people,
          staffing: records.staffing.map(function (x) { return { company: x.id, required: x.required }; }) });
      }
      var editable = false, uid = null, failed = false;
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
        ? Promise.all([user.canEdit(), user.id()]).then(function (r) { editable = !!r[0]; uid = r[1]; })
        : Promise.resolve();
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
      return Promise.all([getJson("api/records"), getJson("api/contacts")]).then(function (res) {
        contacts = res[1];
        onChange({ statuses: res[0].statuses, tourChanges: res[0].tourChanges, covers: res[0].covers || [],
          people: res[0].people || [], staffing: res[0].staffing || [], contacts: contacts });
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
  };

  function connect(onChange) {
    return dbAdapter(onChange).then(function (a) {
      return a || serverAdapter(onChange).then(function (b) { return b || readOnly; });
    });
  }

  root.ScheduleStore = { connect: connect };
})(window);
