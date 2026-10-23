# Records cleanup: status

This file tracks the records chat (branch `claude/zen-wright-gqa6gq`). The routine is in `README.md`.

## Where it stands (10/21/2026)
- **Station rosters (fir-sap2, 10/20):** 931 of 1,128 roster rows agree with the tool. The 5 missing are Assistant Chiefs, which are skipped.
- **Position pulls** (VPN back 10/21), one rank at a time, questions only. Re-checked against the live records 10/22:
  1. **H 30:** 7 people, using `fir-pull-H30.js` (already sent).
  2. **H 20:** 29 people.
  3. **H 3:** 17 people.
  4. **H 2:** 83 people (4 settled by the 10/21 fixes). Trim further before pulling.

## Academy class (PX narrative rating report, 09/02/2026)
- **Field:** Class is on the Employee card (identity section) and on the person page under **Personal details**. Admins only. Published in v60.
- **What's used:** only the class number, ID and name. Nothing else from the report goes into the tool or the repo.
- **Match:** 399 of 421 IDs match a tool record. Rosas RO1790 is listed in both the 129th and the 130th; the tool uses the 129th.
- **Written 10/21:** 399 class numbers in the page's `profiles` (one new doc per person, `{classNo}`; checked against the match after a re-dump).
- **Not matched (22):** nothing has been written for these.
  - **Likely the same person:**
    - Hausel HA3634 (report) is HA2634 in the tool.
    - Lui,Anthony LU1896 (report) is LU1898 at E22 in the tool.
    - Suhr SU6506, 129th: Suhr,M at E20 has no ID in the tool.
    - Clarke CL1125, 130th: Clarke,K at E35 has no ID in the tool.
  - **To check:**
    - Dumont,Catherine DU2621, 131st: the tool has Dumont,C DU2026 at E21 and a Dumont,C with no ID at T11.
    - Nguyen,Henry NG1098, 132nd: the tool has Nguyen,H NG2127 at E25.
  - **Not in the tool:**
    - 137th: Beere,Owen BE1062
    - 136th: Scott,Joseph SC4840
    - 135th: Barr,William BA3469; May,Terrance MA3684
    - 133rd: Mallon,Alana MA1470
    - 131st: Campbell,William CA1697; Wade,Zachary WA2361
    - 130th: Graham,Joanna GR5197; Jackson,Jewan JA1783; Sagin,Aaron SA4156; Salabarria,Che SA7512; Soto,Jonathan SO1453
    - 129th: Cardenas,Alejandra CA1668; Del Castillo Haas,Daniela DE2773; Murphy,Evin MU2715; Nguyen,Kamal NG1179 (resigned)

## Cell numbers (10/21)
- `missing-cells.md`: 407 of 1,228 people still have no cell (Firefighter 402: their pull is held; Lt 2 and FF 3 are WE seats with no ID; Pilot 2 and Marine Engineer 1 are scripts 08 and 09). Rebuild with `node tools/reconcile/missing_cells.js --db <dump with contacts>`.
- `fir-phone-probe.js` (run 10/21): the Phone numbers pop-up is on app 1021 page 2 and is in the page HTML, so it can be fetched per Employee ID.
- `fir-pull-phones-01-…09-*.js`: one script per rank, top ranks first (`node tools/make_phone_pull.js <missing.json>`). Each downloads `fir-phones-<rank>.csv` (key, ID, name, type, number, flag) and resumes after a sign-out. Load rule: CELL, else HOME; never overwrite a cell already on file; ask before the write.
- **Loaded 10/21:**
  - Battalion Chief file: Cannon,M.
  - New-IDs file: both Chins, Dumont,Christopher, Suhr and Clarke.
    - The cell on 21EOE08M was Christopher's, so it moved to 11TOF15M.
    - Dumont,Catherine has no phone in fir-db1.
  - Rescue Captain file: Pendergast, Byrne,M, Warren,J.
  - Captain, Lieutenant, ISS and FF/Paramedic files: 82 cells. All had a CELL; none was already on file.
  - Staff list now 822 cells (version 5).
  - Firefighter pull held for now (user).
- `fir-pull-noid.js` run 10/21. Results:
  - **WE, confirmed by the user, written 10/21** (open-ended, from 1/1/2026): Alba,K 3FBOL07M; Louie,T 31EOE15M; Dickerson,C 10TOE29M.
  - **Written 10/21 (user OK):**
    - Seat IDs: 14TOT10M CH1575 (Chin,Bradford), 18TOD21M CH1466 (Chin,Brett), 11TOF15M DU2026 (Dumont,Christopher), 21EOE08M DU2621 (Dumont,Catherine), 20EOE28M SU6506 (Suhr), 35EOE23M CL1125 (Clarke).
    - Duplicates x-CH1575 and x-CH1466 deleted.
    - Classes: 21EOE08M 131st, 20EOE28M 129th, 35EOE23M 130th.
  - **WE written 10/21 (user OK; per Vacancy Awards 26 A-082):**
    - 42EOL22M Lopez,R from 9/27. Promoted H30 Captain, now x-LO6430. Seat goes to Jebe JE3282 on 1/17/2027.
    - 36EOE02M Joyce,S from 8/29. Promoted H20 Lt, now x-JO3145. Seat goes to Mui MU2796 on 1/17/2027.
- Still no Employee ID (all WE): Alba,K 3FBOL07M, Louie,T 31EOE15M, Dickerson,C 10TOE29M.

## New pulls (10/22)
- `fir-pull-battalions.js` reads Roster by Station (1021:11): 10 battalions × the dates asked. It gives one day's crews, with role, ID, TRC and trade partner, in the company-page CSV format, so the Employee card's fir-db1 comparison reads it. About 10 consecutive days cover every tour.
- `fir-pull-balance.js` (rebuilt 10/22): the balance report is a fir-sap2 BusinessObjects report (open.jsp, `lsSFROMDT=Date(y,m,d)`), so the script asks it for each day as Excel (`sOutputFormat=E`) and reads the status table (DP/IDV/PB/SP/SPI/TC/VA/WC/WDO by OFF/PM/FF) and the hires table. If fir-sap2 won't hand the files over, it downloads one file per day; parse those with `python3 -I tools/reconcile/balance_xlsx.py <folder or zip> balance_bottom.csv`. Output (both): date, table (status|overtime), group, code, OFF, PM, FF, rank, voluntary, mandatory, advance, total; checked against the real 10/22/2026 Excel and the 10/20 screenshot.
  - Columns: OFF = officers, PM = paramedics, FF = firefighters.
  - Groups (user): sick SL/SP/SPI; vacation VA/IDV/TC; disability DP/WC; overtime WDO (an extra shift on a day off, close to the overtime Total); other (OP, RLP, PB, …).
  - `python3 -I tools/reconcile/balance_summary.py balance_bottom.csv summary.csv` gives one row per date with group totals, plus the same weekday a year earlier (364 days before) and sick_change.
  - Runs: October 2025 and October 2026 first (the script's default), then Nov–Dec 2025, then 1/1/2026 to present.
  - **October 2025 + 10/1–10/22/2026 parsed 10/22** (53 days, 980 rows, no failures). Dashboard "SFFD Leave and Overtime" (https://claude.ai/artifact/X6Sqz6SkHTimZ29xKhj9mj, private until shared) shows them. Paired with the same weekday a year earlier: sick +33%, overtime hired +81%, vacation −3%, disability +20%. Sick vs hired r = 0.64. WDO reads 0 on days with hires, so hires Total is the overtime measure. Code OS stops after 10/9/2026.
  - **Nov–Dec 2025 parsed 10/22** (61 days, 1,074 rows, no failures). The dashboard now holds 114 days. Per day, sick / hired / mandatory: Oct 25 18.1 / 20.7 / 3.7; Nov 25 15.6 / 25.5 / 1.8; Dec 25 22.2 / 34.2 / 6.7; Oct 26 24.5 / 37.8 / 6.0. Holidays: low sick but heavy mandatory hires (Thanksgiving 50 hired, 22 mandatory).
  - **Chart work moved** to the "Analyze staffing data and overtime patterns" chat (user, 10/22), with a handoff brief sent. This chat keeps uploads and cleanups.
  - Still to add: 10/23–10/31/2026 actuals, 1/1/2026 to present. A `balanceDays` table in the tool is proposed, not built.
- `fir-licenses-probe.js` (run 10/22): the Licenses and Certs rows are in the employee page HTML, like phones, so they can be pulled per Employee ID when wanted.
- **Licenses test (Stations 1, 7, 36): loaded 10/22 (user OK).** 731 licenses for 126 people are in `profiles` (106 new docs; 20 updated, keeping their class). 79 expired (CDL-Health Questionnaire 40, HazMat Relief List 12, …); 35 expire within 90 days. Checked with a re-dump. `fir-pull-licenses-st01-07-36.js` covers 126 people (Joyce's old seat has no ID). The file has description and expiration, never license numbers. They load into each person's profile (`licenses: [{name, expires}]`, `licensesAsOf`, admin-only) and show in **Licenses and certifications** on the Employee card. Saving class or dates keeps them.
- **Balance pull 10/22: not-found.** The probe showed the report is a fir-sap2 PDF in a frame, not an fir-db1 page, so the pull was rebuilt (above).
- **Battalion roster 10/21 (all 10):** the companies and their battalion/division match organization.js exactly (81 apparatus). Stations were added from it (`Organization.STATIONS`, `station(co)`), and there's a Station column on the Employee card list. One day is enough for now (user).

- **Time balances (10/23):** `fir-pull-time-balances-test.js` reads the Time Balance pop-up from the employee page HTML (type, hours, as-of, scheduled). Test run for Lester LE2603 and Goforth GO3431 loaded into `profiles` (`balances: [{type, hours, scheduled}]`, `balancesAsOf`; admin-only) and shown in **Time balances** on the Employee card (v69). Goforth has 144 VA hours scheduled against a 54.74 balance (flagged). For more people: `node tools/make_balance_pull.js <people.json> <out.js>`.

- **No-cell count (10/23):** the live records have 407 of 1,228 with no number (Firefighter 402, Lt 2, Pilot 2, Marine Engineer 1). The back office's Invite panel showed 496 because its copy of the cells came from a backup loaded before the 10/21 phone loads; load a fresh backup (Admin → Cut-over). Pulls 07 Firefighter (399 with IDs), 08 Pilot, 09 Marine Engineer rebuilt. Load with `python3 -I tools/reconcile/load_phones.py <staff-list.json> <out.json> <pull.csv>...`: CELL first, else HOME (marked in `home`), never replacing a number on file; counts only. Home numbers show as "Home (no cell)" on the Employee card and are counted on the Invite panel.

- **Licenses E16 and E35 (10/23):** `fir-pull-licenses-e16-e35.js` covers 32 people (25 seat owners plus 7 covering a seat there today). The license and phone pulls now time out a page after 30 s (one retry, then flagged), save every 10 people and show a status box. Load after the user's OK.

- **Firefighter phones loaded (10/23, user OK):** 399 pulled; 396 cells and 2 home numbers (marked `home`) added, none replaced. Staff list v6: 1,220 numbers. Still missing (9): Dumont,Catherine (no phone in fir-db1); Lopez,R, Alba,K, Louie,T, Joyce,S, Dickerson,C (WE seats, no Employee ID); Alexander,M, Peery,M (Pilot), Mulholand,B (Marine Engineer), not pulled. The back office needs a fresh backup (Admin → Cut-over) to show them.

- **E16/E35 licenses loaded (10/23, user OK):** 32 profiles (8 merged, keeping class; 24 new), 187 licenses; 19 expired (11 CDL-Health Questionnaire), 8 due within 90 days. **Every person tops out at 6 licenses, here and in the Stations 1/7/36 load**, so fir-db1 likely shows the list 6 rows a page and both loads are partial. The probe confirmed it (Babcock: "row(s) 1 - 6 of 14", an APEX classic report paged with `apex.widget.report.paginate`). The user says the first page holds the important ones, so no re-pull for now. Qualification rules (25 A-084 Attachment B) are outlined in `docs/position-qualifications.md` for a later phase.

- **Battalion pull for trades (10/23):** `fir-pull-battalions-0922-1022.js`, 10 battalions × 31 days (310 pages), with the same timeout, resume and status box as the phone pull. Then `python3 -I tools/reconcile/trades.py <out.csv> <battalions.csv>` for the rankings.

- **Battalion pull 9/22–10/22/2026 done (10/23):** 310 pages, 10,223 rows, no timeouts. Trades: 1,087 people seen, 884 traded, 1,684 TRW / 1,572 TRO days; the most active trade 12–13 of a cycle's shifts. TRO is counted only when the partner's TRW row names them, so it runs slightly low. Rankings were given in chat; names stay out of the repo. Aides: 13 people worked 3+ REG days at a B/D company, and all standing ones already match the tool; two short details (B01, B02) ended by 10/14. No fixes needed.

- **Balance 1/1–3/31/2026 loaded (10/23):** 90 days, none missing. Combined file now 204 days (Jan–Mar 2026, Oct–Dec 2025, Oct 1–22 2026), uploaded to the dashboard's assets and handed to the analysis chat (it owns the `daily`/`codes` datasets). Per day: Jan sick 18.3 / hired 28.4; Feb 19.8 / 31.2; Mar 21.0 / 33.7. Apr–Jun and Jul–Oct 22 to follow.

## Next step
1. **H 30: done 10/22.**
   - 6 of 7 already matched. For the four "OSE at own company" flags, the ownership is a move in the tool, not a cover.
   - Truppa: cover on 3FBOC08M written, 12/6/2025 to 1/15/2027 (start per user).
2. **H 20: done 10/22.** `fir-pull-H20.js` covered 18 people. 10 already matched.
   - **Written (start dates per user):**
     - Jebe 42ETL30M (E42 Lt swing), 8/15/26 to 1/16/27.
     - Nielsen 03EOL23M, 7/13/26 to 1/17/27.
     - Melton 09ETL10M, 1/29/26 to 1/17/27.
     - Anderson,D: 17TOT13M covers 05ENL21M from 8/17/26.
     - Tokuda: 03EOD25M covers 21EOL03M from 6/12/26.
     - Atkinson 11ENL31M from 1/19/26.
     - Dekelaita: 26ETX03M covers 18ETL27M from 4/28/26.
     - Dresser D from 9/27/26.
   - **Swing seats:** the tool already follows the rotation from the vacancy list (`swing` tables in data/positions.json), so one cover per person is enough.
   - **Settled:** Price — Truong owns 22EOL22M, and Price is already D. Moreno — TC = time coming, OE = overtime earned; day-to-day relief at T09, so no cover.
3. **H 3 (17): pulled 10/22. Paused until 10/23 (user).**
   - 6 match: Fartash, Lopez,E, Steward, Deaner, Levesque, Hausel (VR fills) and Feerick (owns 03EOA05M).
   - Proposed, waiting on dates and answers:
     - Covers: Mah to 44EOA30M; Hanley,Joseph to 35EOA26M; Wiltshire to 29EOA13M; Wu to 36EOA15M; Alvarado to swing 17ETA03M; Summers to 01EOA07M; Huynh to 20EOA30M (less certain); Garavaglia to 25EOA02M (already D).
     - Nunnery D. Le covers 44EOA31M and is D.
     - Fix: the 2027 award move into 35EOA26M (HA6250) sits on 05ETX14M, which is Hanley,James HA5462. It should be on Joseph's record.
   - Questions: start dates; Summers at E01 now?; Rios SPI on 25EOA03M — D or S?
4. **H 2 (70 after dropping the OSE-at-own-company flags; trim further first):** include the leftover class matches.
   - Hausel: HA2634 is right, so set the 131st on his card.
   - Lui: report says LU1896, tool says LU1898.
   - The 16 report names not in the tool.
5. **Baum,M BA1130 (10/22, user OK):** "03DFF" in fir-db1 = Division 3 firefighter slot (not on the vacancy list; like 02BFF at B02). She's H-2, VR at D3, tour 29, working as the Division 3 aide; one REG day was coded to 03DO029M (ISS D3, tour 29, vacant). Cover written: 03DO029M from 4/24/2026 (user) to 1/15/2027; Regalado takes the seat and Baum moves to 48TTX29M on 1/16/2027.
6. **Phones:** scripts 08 Pilot and 09 Marine Engineer. Firefighter when the user is ready.
