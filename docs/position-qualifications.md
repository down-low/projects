# Position qualifications (outline only)

A loose outline for a later phase: filling empty spots only with people who hold the qualifications a position needs.
Not a spec. The rules below are paraphrased from the department's own document and are themselves loose.

## Source

Vacancy bid file code **25 A-084, Attachment B: Position Qualifications**. It lists, per position type, the minimum
requirements to apply and the requirements to keep the spot. Missing a "maintain" requirement means forfeiting the owned
spot and going to Vacation Relief.

| Position | To apply (summary) | To keep (summary) |
|---|---|---|
| Apparatus Operator | Driver's license class and endorsements | Driver's license, medical certificate, endorsements; EMT |
| EMT | Certified EMT | EMT |
| Station 36 / HazMat | All ranks HazMat Specialist | HazMat Specialist; Confined Space within 12 months |
| Rescue Squads | Officers Surf ICS, FFs Surf Rescue; all: SCUBA, HazMat Specialist, Rescue Systems 1 or SCS1, EMT, Driver, 5 years of service | Confined Space, Public Safety Diver, Rescue Systems 2 or SCS2, Trench and Rope Rescue technician within 12 months. From the 2026 bid, all of it is needed to bid |
| Surf Rescue companies (E14, E18, E23, E34, E51, T14, T18) | Officers Surf Rescue or Surf ICS; FFs and PMs Surf Rescue | Same |
| Station 16 | All ranks Surf Rescue | Rescue Boat Operator and PWC within 12 months |
| Station 35 / Fireboat | Officers Surf Rescue or Surf ICS; FFs and PMs Surf Rescue | Same |
| Station 51 | Officers Surf ICS; FFs and PMs Surf Rescue | LARRO or Rope Rescue Operations within 12 months |
| FF/Paramedic (H3) | Apparatus Operator and Paramedic license; probation done | Driver's license, Paramedic license, endorsements |
| FF positions | Apparatus Operator and EMT; probation done | Driver's license, medical certificate, endorsements |

## Rough shape

- **Rules as data.** Each rule ties a scope to a set of required qualifications for apply and keep:
  - the scope can be a station, company, company list or role (driver, paramedic, officer);
  - "12 months after the bid" is a deadline counted from the award date;
  - "either/or" requirements are allowed (Surf Rescue *or* Surf ICS).
- **Qualification names.** Map the department's wording to the names fir-db1 uses on the Licenses and Certs list:
  - Surf Rescue Certification
  - Hazardous Material Specialist
  - Emergency Medical Technician
  - Emerg. Medical Tech. Paramedic
  - California Driver's License, with CDL-Health Questionnaire as the medical certificate
  - California Boater Card and PWC Operator
  - The mapping is a small table, edited as gaps show up.
- **What it would show:**
  - **On the Employee card:** "Missing for E16: Rescue Boat Operator (due 1/2027)", using the licenses already loaded and their expiration dates.
  - **When filling a vacancy or a day-to-day spot:** only eligible people listed, or ineligible ones flagged with the reason.
  - **A station or company view:** who holds a required qualification that expires soon.
- **Where it fits.** It belongs with the positions/roles/ranks data model in `docs/platform-plan.md` (being drafted in
  the platform planning chat): qualifications as a reference table, rules attached to org units and roles.

## Data limits today

- **Partial loads:** licenses are loaded for Stations 1, 7, 36, E16 and E35 only.
- **First page only:** fir-db1 shows the list 6 rows a page ("row(s) 1 - 6 of 14"), and the pull reads page 1. The user
  judged the first page holds the important ones, so that's fine for now.
- **Reading every page later:** the probe showed the paging is an APEX classic report
  (`apex.widget.report.paginate(..., {min, max, fetched})`). A later pull can request every page, or one large page.
- Years of service (for Rescue Squads) would come from the hire dates in `profiles`.
