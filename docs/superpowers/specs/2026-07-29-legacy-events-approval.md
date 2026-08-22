# Legacy events reconstruction — approval list

Status: **approval only — nothing in this file has been migrated to Supabase**

## Proposed scope

- Import the 62 numbered BGC sessions from Session 1 through Session 62.
- Import seven additional Calendar-only events after deciding whether each belongs in `events` or `corporate_events`.
- Do not import Session 63 or Session 64 as new events. They overlap events already in Supabase and will be handled only in the registration reconciliation.
- Store all timestamps in Asia/Kolkata. Where an old source gives only a date, the start time remains unresolved rather than being invented.
- Keep the original source label, such as `Session 26: Sunday, 11th May, 1-5pm`, alongside the approved public name.
- Use BGC's published Instagram poster or caption as the naming authority where one exists. Finance descriptions and Tally form labels remain source evidence, but not proof of the public event name.

## Source controls

| Control | Result |
|---|---:|
| Numbered sessions proposed | 62 |
| Sessions with preserved registration rows | 59 |
| Candidate registration rows, Sessions 2–62 | 1,101 |
| Notion rows, Sessions 2–49 | 769 |
| Later export rows, Sessions 50–62 | 332 |
| Calendar-only event candidates | 7 |
| Existing-Supabase overlaps excluded from event import | 2 (Sessions 63 and 64) |

Registration counts are source-form rows, not confirmed attendance. Seat counts are available in the Notion export through Session 49; the later export does not contain a reliable seat-count field.

## Approval legend

- **Ready** — the date, name, and venue are directly supported by a published Instagram poster/caption, the Calendar, or multiple source rows.
- **Review** — at least one important field is missing, generic, or inferred from Finance descriptions.
- **Conflict** — two preserved sources disagree; the proposed value needs explicit approval.

## Instagram verification

BGC's Instagram feed and private story archive were checked on 2026-07-29. The source order for public naming is:

1. Published Instagram poster title
2. Published Instagram caption wording
3. BGC Calendar title
4. Tally form label
5. Finance description

Instagram substantially corrected the early reconstruction. Several Finance labels such as “Board Game Evening”, “Board Game Session”, “Long Games”, and “Board Game Tournament” were operational descriptions, not the names used publicly. Direct post links are attached to the affected rows below. If Instagram confirms the concept but does not publish a title, the name remains unresolved.

## Numbered sessions

| Key | Date and source time | Proposed event name | Proposed venue | Registration rows / seats | Status and evidence |
|---|---|---|---|---:|---|
| S01 | 2024-04-28, 3–7pm | Game Evening | Y101, Gulmohar Tower 1, Adarsh Palm Retreat, Bellandur | — | Ready — actual title, time, and venue on [Instagram poster](https://www.instagram.com/boardgamecompany/p/C6QbeBNvFZe/); caption calls it the pilot session |
| S02 | 2024-05-05, 3–7pm | Board Games Sunday | Y101, Gulmohar Tower 1, Adarsh Palm Retreat, Bellandur | 12 / 13 | Ready — actual title and venue on [Instagram poster](https://www.instagram.com/boardgamecompany/p/C6dSAp7M_pY/) |
| S03 | 2024-05-12, 3–7pm | Board Games | Y101, Gulmohar Tower 1, Adarsh Palm Retreat, Bellandur | 8 / 11 | Ready — actual title and venue on [Instagram poster](https://www.instagram.com/boardgamecompany/p/C6ttfwqPYyk/) |
| S04 | 2024-05-26, 3–6pm | SHASN Game Evening | Y101, Gulmohar Tower 1, Adarsh Palm Retreat, Bellandur | 8 / 8 | Ready — poster title is “SHASN”; caption calls it a Shasn game evening on the [Instagram post](https://www.instagram.com/boardgamecompany/p/C7V_gIsKAJH/) |
| S05 | 2024-06-09, 2–6pm | Board Games | Y101, Gulmohar Tower 1, Adarsh Palm Retreat, Bellandur | 9 / 9 | Ready — actual title and venue on [Instagram poster](https://www.instagram.com/boardgamecompany/p/C750q_RxGMD/) |
| S06 | 2024-06-16, 3–7pm | Board Games Afternoon | The Spiceberry, Bellandur | 16 / 16 | Ready — actual title and venue on [Instagram poster](https://www.instagram.com/boardgamecompany/p/C8Lyb0jxh5j/) |
| S07 | 2024-06-23, 2–6pm | Board Games | The Spiceberry, Bellandur | 17 / 17 | Ready — actual title and venue on [Instagram poster](https://www.instagram.com/boardgamecompany/p/C8cUsD9yE5n/) |
| S08 | 2024-07-07, 2–6pm | Board Games | Board In The City, Koramangala | 17 / 21 | Ready — actual title and venue on [Instagram poster](https://www.instagram.com/boardgamecompany/p/C89ZEBcS09q/); this resolves the Finance abbreviations “BITC” and “BITS” |
| S09 | 2024-07-14, 1–5pm | Lunch & Play | Board In The City, Koramangala | 6 / 6 | Ready — actual title and venue on [Instagram poster](https://www.instagram.com/boardgamecompany/p/C9R_5QUyjDZ/) |
| S10 | 2024-07-21, 12–2pm | **Name unresolved — Japan-themed three-course meal and board games** | Daily Sushi | 9 / 12 | Review — the [announcement reel](https://www.instagram.com/boardgamecompany/reel/C9fRktWS3Os/) and [recap](https://www.instagram.com/boardgamecompany/p/C92UYPnyG17/) confirm the concept and venue, but neither publishes an event title; do not use the Finance label “Board Game Afternoon” as the public name |
| S11 | 2024-08-04, 1–4pm | Lunch & Play | Teavaro, Koramangala | 14 / 20 | Ready — actual title and venue on [Instagram poster](https://www.instagram.com/boardgamecompany/p/C-DDUTgymBh/) |
| S12 | 2024-08-31, 1–4pm | Drunch & Play | Koramangala Social | 15 / 22 | Ready — actual title and venue on [Instagram poster](https://www.instagram.com/boardgamecompany/p/C_KeUJrSedm/) |
| S13 | 2024-09-15, 2–5pm | Drunch & Play | Bellandur Social | 16 / 19 | Ready — actual title and venue on [Instagram poster](https://www.instagram.com/boardgamecompany/p/C_xxePByDYg/) |
| S14 | 2024-10-20, 1–5pm | Lunch & Play | Teavaro, Koramangala | 13 / 15 | Ready — actual title and venue on [Instagram poster](https://www.instagram.com/boardgamecompany/p/DBJ5DxLzUId/) |
| S15 | **Proposed 2024-11-10, 1–5pm** | Lunch & Play | Teavaro, Koramangala | 16 / 20 | **Conflict** — [Instagram poster](https://www.instagram.com/boardgamecompany/p/DCEuhpLyU77/) says 1–5pm; preserved Tally label says 2–6pm |
| S16 | 2024-11-17, 1–5pm | Tabletop Tour | Teavaro, Koramangala | 20 / 24 | Ready — actual title and venue on [Instagram poster](https://www.instagram.com/boardgamecompany/p/DCRxTgQyY0h/) |
| S17 | 2024-12-22, 1–4pm | Tuscany on a Table | Jamming Goat, Indiranagar | 22 / 28 | Ready — actual title and venue on [Instagram poster](https://www.instagram.com/boardgamecompany/p/DDXEJ3_R-xf/) |
| S18 | 2025-01-18, 1–4pm | Lunch and Play | Now Boarding, HSR | 12 / 18 | Ready — Calendar and Tally date agree |
| S19 | 2025-01-26, 1–5pm | Mind Games | Teavaro, Koramangala | 9 / 14 | Ready — Calendar and Tally date agree |
| S20 | 2025-02-09, 2:30–6:30pm | Drunch and Play | Pour Room, Koramangala | 19 / 24 | Ready — Calendar and Tally date agree |
| S21 | 2025-02-23, 1–5pm | Story Mode | The Kind, Bellandur | 13 / 19 | Ready — Calendar and Tally date agree |
| S22 | 2025-03-08, 1–5pm | Mind Games | Cafe du L’Amour, Koramangala | 15 / 15 | Ready — Calendar and Tally date agree |
| S23 | 2025-03-23, 1–5pm | Tabletop Tour | Now Boarding, HSR | 37 / 43 | Ready — Calendar and Tally date agree |
| S24 | 2025-04-06, 5–10pm | Drunch and Play | Pour Room, Koramangala | 17 / 20 | Ready — Calendar and Tally date agree |
| S25 | 2025-04-27, 1–5pm | Lunch and Play | Pour Room, Koramangala | 21 / 23 | Ready — Calendar and Tally date agree |
| S26 | 2025-05-11, 1–5pm | Story Mode | Cafe du L’Amour, Koramangala | 24 / 29 | Ready — Calendar and Tally date agree |
| S27 | 2025-05-18, 1–5pm | Mind Games | Now Boarding, HSR | 19 / 22 | Ready — Calendar and Tally date agree |
| S28 | 2025-06-15, time unknown | The Pentathlon | Now Boarding, HSR | — | Ready name/date/venue — Calendar only; no preserved Tally rows |
| S29 | 2025-07-13, 1–5pm | Mind Games | Now Boarding, HSR | 25 / 31 | Ready — Calendar and Tally date agree |
| S30 | 2025-07-27, 1–5pm | Lunch and Play | Now Boarding, HSR | 19 / 21 | Ready — Calendar and Tally date agree |
| S31 | 2025-08-03, 1–5pm | Story Mode | Now Boarding, HSR | 23 / 26 | Ready — Calendar and Tally date agree |
| S32 | 2025-08-17, 1–5pm | Mind Games | Now Boarding, HSR | 20 / 24 | Ready — Calendar and Tally date agree |
| S33 | 2025-08-24, 1–5pm | Tabletop Tour | Now Boarding, HSR | 28 / 35 | Ready — Calendar and Tally date agree |
| S34 | 2025-08-30, 7–11pm | Story Mode: Blood on the Clocktower | Buddiezz Cafe, HSR | 15 / 17 | Ready — Calendar and Tally date agree |
| S35 | 2025-09-07, 1–5pm | Story Mode: TTRPGs | Big Bean, Koramangala | 25 / 27 | Ready — Calendar and Tally date agree |
| S36 | 2025-09-14, 1–5pm | Lunch and Play | Coffee Brewery, Koramangala | 15 / 18 | Ready — Calendar and Tally date agree |
| S37 | 2025-09-13, 7–11pm | Story Mode: Blood on the Clocktower | Unknown | 7 / 8 | Review — name supported by Finance; omitted from Calendar |
| S38 | 2025-09-27, 4–8pm | Story Mode: Blood on the Clocktower | Buddiezz Cafe, HSR | 6 / 6 | Ready — Calendar and Tally date agree |
| S39 | 2025-10-05, 1–5pm | Mind Games | Coffee Brewery, Koramangala | 12 / 16 | Ready — Calendar and Tally date agree |
| S40 | 2025-10-12, 12–4pm | Drunch and Play | K-OS GameBar, Koramangala | 18 / 18 | Ready — Calendar and Tally date agree |
| S41 | 2025-10-19, time unknown | Cha-llenged | Freedom Tree, Indiranagar | — | Ready name/date/venue — Calendar only; no preserved Tally rows |
| S42 | 2025-10-31, 7pm–12am | Annual Halloween Party | Buddiezz Cafe, Koramangala | 29 / 31 | Ready — the [Instagram reel](https://www.instagram.com/boardgamecompany/reel/DQJ5i0eivyd/) calls it the annual Halloween party, says Koramangala, and is co-published with Buddiezz Cafe |
| S43 | 2025-11-16, 1–5pm | Mind Games | Coffee Brewery, Koramangala | 16 / 18 | Ready — Calendar and Tally date agree |
| S44 | 2025-11-23, 1–5pm | Lunch and Play | Coffee Brewery, Koramangala | 13 / 14 | Ready — Calendar and Tally date agree |
| S45 | 2025-11-30, 1–5pm | Tabletop Tour | Now Boarding, HSR | 27 / 33 | Ready — Calendar and Tally date agree |
| S46 | 2025-12-07, 1–5pm | Story Mode: TTRPGs and Blood on the Clocktower | Big Bean, Koramangala | 22 / 23 | Ready — corrected obvious “an” typo in Calendar |
| S47 | 2025-12-14, 12–4pm | Drunch and Play | K-OS GameBar, Koramangala | 11 / 14 | Ready — Calendar and Tally date agree |
| S48 | 2025-12-21, 3–7pm | Slice of Strategy | Brik Oven, Koramangala | 16 / 16 | Ready — Calendar and Tally date agree |
| S49 | 2025-12-27, 2–6pm | Tabletop Tour + Mind Games at TTOX Bengaluru | BGC booth, TTOX Bengaluru; physical venue unresolved | 18 / 20 | Review venue only — the [Instagram poster](https://www.instagram.com/boardgamecompany/p/DSpxCwbimRq/) names both formats, the convention, date, and time; no single umbrella title or physical venue is shown |
| S50 | 2026-01-10, time unknown | Toast & Tactics | The Kind, Indiranagar | 28 / seats unavailable | Ready name/date/venue — later export omits time and seats |
| S51 | 2026-01-18, time unknown | Story Mode: Blood on the Clocktower | Gaia’s Library, Koramangala | 14 / seats unavailable | Ready name/date/venue — later export omits time and seats |
| S52 | 2026-01-31, time unknown | REPLAY mini | The Bangalore Local, Koramangala | 52 / seats unavailable | Ready name/date/venue — later export omits time and seats |
| S53 | 2026-02-07, time unknown | Toast & Tactics | The Kind, Bellandur | 29 / seats unavailable | Ready name/date/venue — later export omits time and seats |
| S54 | 2026-02-15, time unknown | Mind Games | Gaia’s Library, Koramangala | 21 / seats unavailable | Ready — Calendar weekday says Saturday, but 2026-02-15 is Sunday |
| S55 | 2026-02-21, time unknown | Toast & Tactics | The Kind, JP Nagar | 16 / seats unavailable | Ready name/date/venue — later export omits time and seats |
| S56 | 2026-03-01, time unknown | Lunch and Play | Gaia’s Library, Koramangala | 21 / seats unavailable | Ready name/date/venue — later export omits time and seats |
| S57 | **Proposed 2026-03-08**, time unknown | The REPLAY Quiz | K-OS GameBar, Koramangala | 20 / seats unavailable | **Conflict** — export label says Mar 7; Calendar and responses support Mar 8 |
| S58 | 2026-03-15, time unknown | Story Mode: Blood on the Clocktower | Gaia’s Library, Koramangala | 26 / seats unavailable | Ready name/date/venue — later export omits time and seats |
| S59 | 2026-03-21, time unknown | Tabletop Tour | The Bangalore Local, Koramangala | 47 / seats unavailable | Ready name/date/venue — later export omits time and seats |
| S60 | 2026-03-28, time unknown | Aata Kaapi Club | The Filter Coffee, Koramangala | 25 / seats unavailable | Ready name/date/venue — later export omits time and seats |
| S61 | 2026-04-04, time unknown | Drunch and Play | Woodside Inn, Indiranagar | 15 / seats unavailable | Ready name/date/venue — later export omits time and seats |
| S62 | **Proposed 2026-04-12**, time unknown | Catan Tournament | Gaia’s Library, Koramangala | 18 / seats unavailable | **Conflict** — export/session map says Apr 11; Calendar and Finance support Apr 12 |

## Calendar-only events without numbered Tally sessions

These are real Calendar entries before the Supabase cutover, but they are outside the numbered-session sequence. Approval must also choose the destination table.

| Key | Date | Proposed event name | Venue | Proposed destination | Status |
|---|---|---|---|---|---|
| C01 | 2025-09-26 | Surge by Peak XV | St. Regis, Mumbai | `corporate_events` | Review — corporate event, not a Tally registration event |
| C02 | 2025-11-08 | TTRPG Con Day 1 | Bangalore Creative Circus | `events` | Review — no Tally session; registration may have been externally managed |
| C03 | 2025-11-09 | TTRPG Con Day 2 | Bangalore Creative Circus | `events` | Review — no Tally session; registration may have been externally managed |
| C04 | 2025-12-13 | Founders Retreat | Delano, Dubai | Exclude or `corporate_events` | Review — appears private/internal rather than a public registration event |
| C05 | 2026-03-22 | Board Games & Puppies with Pawga | North Star Cafe, HSR | `events` | Ready name/date/venue — Calendar and Finance agree |
| C06 | 2026-04-18 | REPLAY: Day 1 | The Bangalore Local, Koramangala | `events` | Ready name/date/venue — Calendar only |
| C07 | 2026-04-19 | REPLAY: Day 2 | The Bangalore Local, Koramangala | `events` | Ready name/date/venue — Calendar and Finance agree |

## Existing Supabase overlap — do not insert as new events

| Source session | Source date | Existing Supabase event | Treatment |
|---|---|---|---|
| S63 | 2026-04-26 | Lunch and Play | Match registrations to the existing event and produce an exception report |
| S64 | 2026-05-02 | Drunch and Play | Match registrations to the existing event and produce an exception report |

## Explicit approval items

1. Approve the **Ready** rows as reconstructed.
2. Supply the actual public name for S10, if one existed; otherwise approve the descriptive archival name and confirm whether the physical Daily Sushi location needs an area.
3. Approve Instagram's 1–5pm time for S15 over the conflicting 2–6pm Tally label.
4. Confirm the missing venue for S37.
5. Confirm whether S49 should keep the descriptive combined title and whether the physical TTOX venue needs to be recovered.
6. Approve 2026-03-08 for S57 and 2026-04-12 for S62.
7. Decide the destination or exclusion for C01–C07.
8. Decide whether unknown start times should remain marked as date-only archival records or be backfilled from another source before migration.

## Migration guardrails after approval

- Import these as unpublished archival events with a unique legacy session key.
- Preserve the source label and source evidence.
- Make the event import idempotent and produce a dry-run report before writes.
- Do not create, void, or change any Finance transaction during the event import.
- Import registrations only after status rules and duplicate handling are separately approved.
