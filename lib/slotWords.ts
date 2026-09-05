import type { Band, EventType, Mode } from './types';

/**
 * One coordination system, two vocabularies.
 *
 * The database does the same thing for every event type: `ses_reservations`
 * holds an exclusive claim on a (band, mode) window, and the exclusion
 * constraint refuses a second one. What that *means* to the operator reading
 * the screen is not the same thing twice.
 *
 * On a **special event** there is one callsign and many operators, often in
 * different places, and what is being handed around is the call itself. An
 * operator checks it out for a band and mode so nobody else signs it there at
 * the same time. "Call checkout" is literally what is happening.
 *
 * On **Field Day and Winter Field Day** nothing about the call is in
 * question — every station sends the club's call all weekend, and no operator
 * needs permission to use it. What rule 6.9 forbids (and the WFD rules with
 * it) is two transmitted signals on one band and mode at once, and the holder
 * of a claim is the *transmitter*, not the person: station 2 holds 20m phone
 * whoever is sitting at it. Calling that a "call checkout" describes a problem
 * a contest club does not have, and hides the one they do.
 *
 * This lived as inline ternaries in three components, which is how the section
 * list and the bonus schedule went wrong: the logging panel said "Call
 * Checkout" and "Nobody has the call checked out" on a Field Day screen while
 * the position picker two steps earlier had the contest wording right. One
 * table, read by every surface.
 */
export interface SlotWords {
  /** Panel heading. */
  title: string;
  /** One line under it, saying what claiming does here. */
  blurb: string;
  /** The button that takes the current band and mode. */
  claim: (band: Band | string, mode: Mode | string) => string;
  /** Heading over the list of live claims. */
  nowHeading: string;
  /**
   * What to say when nothing is claimed.
   *
   * `null` on a contest, and that is the point rather than an omission: an
   * unclaimed band is the *normal* state there, claiming is opt-in, and the
   * Operators panel directly below already reports who is actually on air
   * from presence. A line announcing that an optional feature is unused is
   * noise in the pane the logging screen has least room in.
   */
  noneHeld: string | null;
  /** Status line for the band and mode the entry form is set to. */
  nobodyHolds: (band: Band | string, mode: Mode | string) => string;
  /** The position picker's instruction, before an operator sits down. */
  pickHint: string;
  /** The picker's primary button: take this slot and go. */
  claimAndStart: string;
  /** Its in-flight label. */
  claiming: string;
  /** Its secondary button: sit here without taking the slot. */
  startWithout: string;
  /** What to say when the claim was refused for a reason the server did not
   *  name — a network failure, or a status with no body. */
  claimFailed: string;
  /** Why taking a band somebody else holds is a warning and not a block. */
  overrideHint: string;
}

const SES: SlotWords = {
  title: 'Call checkout',
  blurb: 'One signal per band and mode under the shared callsign.',
  claim: (band, mode) => `Check out ${band} ${mode}`,
  nowHeading: 'On the air',
  noneHeld: 'Nobody has the call checked out.',
  nobodyHolds: (band, mode) => `Nobody holds ${band} ${mode} right now`,
  pickHint:
    'Pick a band and mode, then check it out so nobody else signs the callsign there at the same time.',
  claimAndStart: 'Check out and start logging',
  claiming: 'Checking out…',
  startWithout: 'Start without checking out',
  claimFailed: 'Could not check out that band and mode.',
  overrideHint:
    'Two signals on one band and mode under the same callsign is what the checkout exists to prevent — but a contact that already happened still needs logging, so this is a warning, not a block.',
};

const CONTEST: SlotWords = {
  title: 'Band coordination',
  blurb:
    'One transmitted signal per band and mode. Claiming is optional — Operators below shows who is actually on air.',
  claim: (band, mode) => `Claim ${band} ${mode}`,
  nowHeading: 'Claimed now',
  noneHeld: null,
  nobodyHolds: (band, mode) => `No station has claimed ${band} ${mode}`,
  pickHint:
    'Pick where you are starting. Claiming is optional on a contest — it warns the next station that this band and mode is taken.',
  claimAndStart: 'Claim and start logging',
  claiming: 'Claiming…',
  startWithout: 'Start without claiming',
  claimFailed: 'Could not claim that band and mode.',
  overrideHint:
    'One transmitted signal per band and mode is a contest rule. Starting here anyway is allowed; the log will warn on each contact.',
};

/** Field Day and Winter Field Day share the contest vocabulary: both impose
 *  the same one-signal-per-band-mode constraint, and neither has a callsign
 *  question. Only a special event checks out the call itself. */
export function slotWords(eventType: EventType): SlotWords {
  return eventType === 'SES' ? SES : CONTEST;
}
