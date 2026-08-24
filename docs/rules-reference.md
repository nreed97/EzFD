# Contest rules reference

The scoring-relevant rules for both contests this app scores, transcribed from
the official documents so a future change can be checked against something
other than the code it is changing.

This file exists because the app's scoring was wrong for a long time in ways
nobody could see: the Field Day bonus table had been written from memory and
diverged from the rules at nearly every line, and Winter Field Day was scored
with Field Day's formula entirely. Both were only caught when the actual rules
documents were read side by side with `lib/scoring.ts`. Keep this current, and
check it — not the code — when a value is in question.

**These are summaries, not the rules.** Where this file and an official
document disagree, the official document wins and this file is a bug. Get the
current rules from the sources below before a contest; both organisations
revise them.

| Contest | Governing body | Rules |
|---|---|---|
| ARRL Field Day | ARRL | <https://www.arrl.org/field-day> |
| Winter Field Day | Winter Field Day Association | <https://www.winterfieldday.org/> |

---

## ARRL Field Day

Transcribed from the official rules, **Revised 4/2026**.

### Scoring

```
score = (QSO points × power multiplier) + bonus points
```

Sections are neither a multiplier nor a bonus. They are worth nothing. The app
counts and displays them because operators chase them, and for no other reason.

**QSO points (7.1)** — Phone 1, CW 2, Digital 2.

**Power multiplier (7.2)** — determined by the highest power used by any
transmitter during the event (7.2.5):

| Condition | Multiplier | Rule |
|---|---|---|
| ≤5 W **and** not from mains or a motor-driven generator | ×5 | 7.2.1 |
| ≤5 W but from mains or a generator | ×2 | 7.2.2 |
| ≤100 W | ×2 | 7.2.3 |
| >100 W | ×1 | 7.2.4 |

Classes A, B and C are capped at 500 W PEP; D, E and F at 100 W.

### Bonus points (7.3)

Added **after** the multiplier. None of them is multiplied — 7.3.13.1 says so
explicitly for GOTA contacts, and it holds for all of them.

| Rule | Bonus | Points | Classes |
|---|---|---|---|
| 7.3.1 | 100% emergency power | 100 **per transmitter**, max 20 tx / 2,000 | A, B, C, E, F |
| 7.3.2 | Media publicity | 100 | all |
| 7.3.3 | Public location | 100 | A, B, F |
| 7.3.4 | Public information table | 100 | A, B, F |
| 7.3.5 | Message to Section Manager | 100 | all |
| 7.3.6 | Formal messages handled | 10 each, max 100 | all |
| 7.3.7 | Satellite QSO | 100 | A, B, F |
| 7.3.8 | Alternate power (≥5 QSOs) | 100 | A, B, E, F |
| 7.3.9 | W1AW bulletin copied | 100 | all |
| 7.3.10 | Educational activity | 100 | A, F, and D/E clubs of 3+ |
| 7.3.11 | Elected official visit | 100 | all |
| 7.3.12 | Served agency rep visit | 100 (one bonus, not per rep) | all |
| 7.3.13.1 | GOTA station QSOs | **5 each, no cap** | A, F |
| 7.3.13.2 | GOTA coach | 100 | A, F |
| 7.3.14 | Entry via the ARRL web app | 50 | all |
| 7.3.15 | Youth participants (≤18) | 20 each, **max 100** | A, C, D, E, F |
| 7.3.16 | Social media promotion | 100 | all |
| 7.3.17 | Safety officer | 100 | **A only** |
| 7.3.18 | Site responsibilities | 50 | B, C, D, E, F |

The app does **not** enforce the class-eligibility column. It will let you tick
any box; read the rule before claiming one.

Bonuses that do **not** exist, and which this app awarded for several releases:
a Worked All Sections bonus, and an "all attendees licensed" bonus.

### Exchange and classes (4, 5)

Class is `<transmitters><letter>`, e.g. `3A`. The number is the maximum count
of simultaneously transmitted signals (rule 4); minimum claimable is 1.

`A` club portable · `B` 1–2 person portable · `C` mobile · `D` home ·
`E` home on emergency power · `F` EOC. `A` and `B` also have battery variants.

Stations in ARRL/RAC sections send class + section (`3A CT`). Stations outside
send class + `DX` (`2A DX`).

### On-air constraints (6)

- Once per band **per mode** (6.3).
- One transmitted signal per band-mode at a time (6.5, 6.9). This is what the
  app's band/mode checkout enforces, and why the exclusion constraint is keyed
  on `(band, mode)` and not on the station.
- No cross-band contacts except satellite (6.8); no repeaters (6.10).

### Submission (8)

**Complete logs are not required and ARRL does not use them** (8.6). What is
required is the summary sheet plus a dupe sheet — stations worked sorted by
band and mode. **Cabrillo is not required** (8.7); it is accepted in place of
the dupe sheet.

There is therefore no per-QSO transmitter attribution requirement. The app's
station number feeds the Cabrillo transmitter field, which is optional, and
serves the 6.9 band-mode coordination — not an ARRL reporting obligation.

---

## Winter Field Day

Transcribed from the WFDA rules for **2026** (v3). WFD 2026 runs January
24–25, 1600 UTC Saturday to 2159 UTC Sunday.

### Scoring — a different model entirely

```
score = total QSO points × (OM + 1)
```

There are **no bonus points** and **no power multiplier**. Every station is
capped at 100 W PEP, and operating QRP is an *objective* worth OM 4 rather than
a multiplier. Applying Field Day's `points × power + bonuses` here produces a
number the WFD rules cannot arrive at by any route — which is exactly what this
app did until the rules were read.

**QSO points** — Phone 1, CW 2, Digital 2. Same table as Field Day.

Each station may be worked once per band-mode, so up to three times per band.

### Objectives

Each completed objective contributes its Objective Multiplier. The OM values
sum, then **1 is added** — that "+1" is why a station completing nothing still
scores its contacts.

| Objective | OM |
|---|---|
| Operate 100% on alternative power | 1 |
| Operate away from home (>½ mile) | 3 |
| Deploy two or more new antennas, ≥1 contact each | 1 |
| FM satellite contact | 2 |
| SSB or CW satellite contact | 3 |
| Send and receive a Winlink email | 1 |
| Copy the WFD special bulletin | 1 |
| Three contacts on ≥6 bands | 6 |
| Three contacts on ≥12 bands | 6 |
| Use multiple modes | 2 |
| Operate the event QRP (≤10 W phone, ≤5 W CW/digital) | 4 |
| Operate six continuous hours | 2 |

All twelve total OM 32, so the maximum multiplier is ×33. Six and twelve bands
are separate objectives and both count — the twelve-band objective does not
replace the six-band one.

Satellite QSOs count for the objective **only**; they do not add QSO points.

### Exchange and classes

Exchange is `<transmitters><class> <location>`, e.g. `2M EPA`, `1H GA`,
`4O WTX`, `6I MN`.

| Class | Meaning |
|---|---|
| `H` | Home — inside a permanent livable residence |
| `I` | Indoor — away from home, in an insulated weather-protected building |
| `O` | Outdoor — partly or fully exposed shelter |
| `M` | Mobile / mobile stationary — RV, car, boat, trailer, etc. |

Note `M`, which Field Day has no equivalent of. The app's entry form omitted it
and false-flagged every mobile station's exchange as invalid.

**Location identifiers** are ARRL/RAC sections for US and Canadian stations,
`MX` for Mexico, and `DX` for everywhere else. `MX` is WFD-only — a Mexican
station in Field Day sends `DX` like any other.

### Bands and modes

All amateur bands except **12, 17, 30 and 60 m**. Unlike Field Day, VHF/UHF and
above are ordinary scoring bands. WSJT modes are not permitted.

### On-air constraints

- Multiple transmitters may not operate on the same band-mode simultaneously —
  the same constraint Field Day's 6.9 imposes.
- No cross-band contacts (satellite exempted for the objectives).
- No repeater contacts, including DMR/YSF through a repeater or hotspot.
- Maximum 100 W PEP for every station.

### Submission

A Cabrillo or ADIF log uploaded at <https://www.winterfieldday.org/>, by 23:59
UTC on March 1st. Unlike Field Day, the log itself is the entry.
