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

## Next step
1. With the H 2 cleanup: settle the 6 likely and to-check class matches above (fix the ID on the right side, then set the class on the card).
2. When the VPN is back, run the H 30 pull.
