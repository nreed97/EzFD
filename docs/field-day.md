# Field Day and Winter Field Day

ARRL Field Day (June) and Winter Field Day (January) are the two contest event
types. They differ only in class letters and the Cabrillo contest name; the
rest of this page applies to both.

## Setting up

**Class** is a transmitter count plus a letter:

| Event | Letters |
|---|---|
| Field Day | `A` club portable · `B` home or one transmitter · `C` mobile · `D` home station · `E` emergency power · `F` EOC |
| Winter Field Day | `H` home · `O` outdoor · `I` indoor |

So `3A` is three transmitters, club portable. The entry form validates the
letter against the event type — a `3H` on a Field Day event is flagged.

**ARRL section** is your own section, sent as part of the exchange.

**Power category** sets the score multiplier and is one of `HIGH`, `LOW`
(≤150 W) or `QRP` (≤5 W).

## The exchange

Both contests use **class + section**. You send yours (taken from the event,
so operators never retype it) and log theirs.

The received section is validated against the app's section list and flagged
if unrecognised — again a warning, not a refusal, since the list can lag
changes to the official one.

## Scoring

```
score = QSO points × power multiplier + bonus points
```

| Component | Value |
|---|---|
| Phone QSO | 1 point |
| CW QSO | 2 points |
| Digital QSO | 2 points |
| `HIGH` power | ×1 |
| `LOW` power (≤150 W) | ×2 |
| `QRP` power (≤5 W) | ×5 |

**Sections do not multiply the score.** They are a bonus trigger only. This is
the single most commonly mis-implemented part of the Field Day formula, and
getting it wrong inflates a score enormously — a 60-section event would come
out sixty times too high.

Duplicates score nothing and are excluded from exports.

## Bonus points

Tracked from the dashboard's **Bonus** panel. Changes save immediately and
appear on every connected screen.

| Bonus | Points |
|---|---|
| 100% emergency power | Doubles the base score |
| W1AW bulletin | 100 |
| Satellite QSO | 100 |
| Natural power QSO | 100 |
| Public information table | 100 |
| Media publicity | 100 |
| Educational activity | 100 |
| Message to Section Manager | 100 |
| All operators licensed | 100 |
| Elected official visit | 50 |
| Web submission | 50 |
| Social media | 50 |
| Safety officer | 25 |
| Youth operators | 20 each |
| GOTA QSOs | 10 each, capped at 1000 |
| Served agency visit | 10 each, capped at 100 |
| NTS traffic | 10 each, capped at 100 |
| Worked All Sections | 100 |

Emergency power is the one that isn't a flat number: it adds the entire base
score again, so it roughly doubles a typical entry.

Worked All Sections is worth 100 points for working all **85** ARRL/RAC
sections. The scoring code, the summary sheet, the "Sections Needed" button and
the section grid all derive that total from a single list, so they cannot
disagree with each other.

Only recognised sections count toward it. A station outside the US and Canada
sends `DX`, which the entry form accepts and the log exports, but which is not
a section and does not count. Anything else that isn't a section — almost
always a typo — is listed in the "Sections Needed" panel so it can be
corrected.

## Submitting

From the logger header or the dashboard:

**Cabrillo** (`CLUBCALL_FD2026.log`) is the ARRL submission format. Upload it
to the Field Day online entry form.

**ADIF** (`CLUBCALL_FD2026.adi`) is for LoTW, QRZ Logbook, or any log manager.
Contest QSOs carry `MY_ARRL_SECT`, `STX_STRING` (your class and section) and
`SRX_STRING` (theirs).

**Summary sheet** is a printable worksheet mirroring the ARRL entry form: QSO
totals by mode, the score calculation with the power multiplier shown as its
own line, active bonuses itemised, sections worked, and the operator list.

![Field Day summary sheet: QSO totals by mode, score calculation and sections worked](images/summary-sheet.png)

Both exports include only non-duplicate QSOs, in chronological order.

## Sections

The app ships a list of ARRL and RAC sections used for validation, the map,
the section grid, and the Worked All Sections bonus. It contains **85** entries
— the 71 US sections plus the 14 current RAC sections, including Puerto Rico,
the Virgin Islands and the Ontario splits (`ONE`, `ONN`, `ONS`, `GH`). If you
work a section the app doesn't recognise you will get a warning and the QSO
will log normally — the exchange is stored as typed, and the dashboard lists
the unrecognised values so a typo can be spotted and corrected.

`DX` is accepted as an exchange without a warning — Field Day stations outside
the US and Canada send it — but it is not a section, so it doesn't count toward
Worked All Sections.
