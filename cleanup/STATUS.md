# Records cleanup: status

This file tracks the records chat (branch `claude/zen-wright-gqa6gq`). The routine is in `README.md`.

## Where it stands (10/21/2026)
- **Station rosters (fir-sap2, 10/20):** 931 of 1,128 roster rows agree with the tool. The 5 missing are Assistant Chiefs, which are skipped.
- **Paused:** the fir-db1 pulls are waiting on VPN access. They run one rank at a time and pull only people with open questions.
  1. **H 30:** 7 people, using `fir-pull-H30.js` (already sent).
  2. **H 20:** 29 people.
  3. **H 3:** 17 people.
  4. **H 2:** 87 people. Trim this list before pulling.

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
- `missing-cells.md`: 499 of 1,230 people in the tool have no staff-list cell (Firefighter 408, most of them added people from the 2027 awards and new classes). Rebuild with `node tools/reconcile/missing_cells.js --db <dump with contacts>`.
- `fir-phone-probe.js` (run 10/21): the Phone numbers pop-up is on app 1021 page 2 and is in the page HTML, so it can be fetched per Employee ID.
- `fir-pull-phones-01-…09-*.js`: one script per rank, top ranks first (`node tools/make_phone_pull.js <missing.json>`). Each downloads `fir-phones-<rank>.csv` (key, ID, name, type, number, flag) and resumes after a sign-out. Load rule: CELL, else HOME; never overwrite a cell already on file; ask before the write.
- Loaded 10/21: Battalion Chief file (Cannon,M CA5637 CELL). Staff list now 733 cells.
- `fir-pull-noid.js` run 10/21. Results:
  - **WE, confirmed by the user, written 10/21** (open-ended, from 1/1/2026): Alba,K 3FBOL07M; Louie,T 31EOE15M; Dickerson,C 10TOE29M.
  - **Proposed, waiting on OK:**
    - 14TOT10M becomes CH1575, and 18TOD21M becomes CH1466. Then delete the duplicate added records x-CH1575 and x-CH1466.
    - 11TOF15M becomes DU2026, and 21EOE08M changes to DU2621 (Dumont,Catherine, 131st; to confirm).
    - Suhr 20EOE28M becomes SU6506, and Clarke 35EOE23M becomes CL1125 (both from the PX report).
  - **Asked:** do Lopez (42EOL22M, now x-LO6430 Captain) and Joyce (36EOE02M, now x-JO3145 Lt) still own those seats?
- Not pullable (no Employee ID): Lieutenant Alba,K FB3, Lopez,R E42; Firefighter Chin,B T14, Chin,B T18, Clarke,K E35, Dickerson,C T10, Dumont,C T11, Joyce,S E36, Louie,T E31, Suhr,M E20.

## Next step
1. With the H 2 cleanup: settle the 6 likely and to-check class matches above (fix the ID on the right side, then set the class on the card).
2. When the VPN is back, run the H 30 pull and the phone pulls (Battalion Chief first).
