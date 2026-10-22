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
3. **H 3 (17):** `fir-pull-H3.js` sent 10/22 (still 17 after the re-check).
4. **H 2 (70 after dropping the OSE-at-own-company flags; trim further first):** include the leftover class matches.
   - Hausel: HA2634 is right, so set the 131st on his card.
   - Lui: report says LU1896, tool says LU1898.
   - The 16 report names not in the tool.
5. **Phones:** scripts 08 Pilot and 09 Marine Engineer. Firefighter when the user is ready.
