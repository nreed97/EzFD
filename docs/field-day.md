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

**Sections do not multiply the score, and they are not a bonus either.** Rule
7.3 lists eighteen bonuses and none of them concerns sections. Working every
section is an operating goal the app helps you chase; it is worth no points.
Treating sections as a multiplier is the single most commonly mis-implemented
part of the Field Day formula, and getting it wrong inflates a score
enormously — a 60-section event would come out sixty times too high.

Duplicates score nothing and are excluded from exports.

## Bonus points

Tracked from the dashboard's **Bonus** panel. Changes save immediately and
appear on every connected screen.

| Bonus | Rule | Points |
|---|---|---|
| 100% emergency power | 7.3.1 | **100 per transmitter**, max 2,000 |
| Media publicity | 7.3.2 | 100 |
| Public location | 7.3.3 | 100 |
| Public information table | 7.3.4 | 100 |
| Message to Section Manager | 7.3.5 | 100 |
| Formal messages handled | 7.3.6 | 10 each, capped at 100 |
| Satellite QSO | 7.3.7 | 100 |
| Alternate power (5 QSOs) | 7.3.8 | 100 |
| W1AW bulletin copied | 7.3.9 | 100 |
| Educational activity | 7.3.10 | 100 |
| Elected official visit | 7.3.11 | 100 |
| Served agency rep visit | 7.3.12 | 100 |
| GOTA station QSOs | 7.3.13.1 | 5 each, no cap |
| GOTA coach | 7.3.13.2 | 100 |
| Entry via ARRL web app | 7.3.14 | 50 |
| Youth participants (≤18) | 7.3.15 | 20 each, capped at 100 |
| Social media promotion | 7.3.16 | 100 |
| Safety officer | 7.3.17 | 100 |
| Site responsibilities | 7.3.18 | 50 |

Values are transcribed from the official ARRL rules (Revised 4/2026), and each
row carries its rule number so you can check it against the source. Not every
bonus is available to every class — 7.3.1 excludes Class D, 7.3.17 is Class A
only, and so on. The app does not enforce class eligibility, so read the rule
before ticking a box.

**Emergency power is per transmitter, not a doubling.** A 3A entry claims 300
points, not "the whole score again" — the app read this wrong until the 2026
rules were checked line by line, which inflated claimed scores by thousands of
points. The panel shows the arithmetic (`+100 × 3 tx`) so the number is
visible rather than implied.

Bonuses are added **after** the power multiplier is applied, so a QRP entry's
bonuses are worth exactly the same as a high-power entry's. Rule 7.3.13.1 says
so explicitly for GOTA contacts, and it holds for all of them.

### Winter Field Day

Winter Field Day is run by the Winter Field Day Association, not the ARRL, and
has its own rules. The bonus values the app uses for a WFD event **have not
been verified** against those rules — the panel says so, and you should check
your claimed score against the current WFDA rules before submitting.

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

The app ships a list of ARRL and RAC sections used for validation, the map and
the section grid. It contains **85** entries
— the 71 US sections plus the 14 current RAC sections, including Puerto Rico,
the Virgin Islands and the Ontario splits (`ONE`, `ONN`, `ONS`, `GH`). If you
work a section the app doesn't recognise you will get a warning and the QSO
will log normally — the exchange is stored as typed, and the dashboard lists
the unrecognised values so a typo can be spotted and corrected.

`DX` is accepted as an exchange without a warning — Field Day stations outside
the US and Canada send it — but it is not a section, so it doesn't count toward
your sections-worked total.
