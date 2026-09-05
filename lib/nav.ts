import type { EventType } from './types';

/**
 * Everything an operator can reach that is not "which view am I looking at".
 *
 * ## Why this is a table and not markup
 *
 * The logger header and its mobile bar were two hand-written lists of the same
 * controls, and they drifted the way two copies always do here — the same
 * failure as the section list in two components and the bonus schedule in
 * three. The drift was not hypothetical:
 *
 *   * **Docs** was reachable only on a phone. There was no link to the guides
 *     anywhere in the logger at tablet or desktop width.
 *   * **Import ADIF, ADIF, Cabrillo, + Radio and the deleted-contacts list**
 *     were reachable only at 768px and up. An operator logging from a phone
 *     could not export their own log.
 *
 * Neither was a decision anybody made; both were a `hidden sm:` that went one
 * way in one copy and the other way in the other. So the list lives here once,
 * every surface renders it from here, and `scripts/test-nav.cjs` fails if a
 * component grows its own copy or hides an item behind a breakpoint.
 *
 * ## Views are deliberately *not* in here
 *
 * Switching between the log, the map and the rate chart is the loop somebody
 * repeats all weekend, and burying it one tap deep taxes every repetition. The
 * view switcher stays on screen; this menu is for the things you reach for
 * once an hour or once a weekend. Keeping the two apart is most of what makes
 * the header readable again — a row that mixed "where am I looking" with
 * "what can I do" gave a reader no way to scan for either.
 */

export type NavSurface = 'logger' | 'dashboard';

/** Drawer section headings, in the order they are rendered. Ordered so the
 *  things you reach for mid-event come before the things you reach for at the
 *  end of it, and settings come last. */
export const NAV_GROUPS = ['Go to', 'This event', 'Export', 'Display', 'Help'] as const;
export type NavGroup = (typeof NAV_GROUPS)[number];

/** An action the host component performs. A string rather than a callback so
 *  the table stays pure data and `scripts/test-nav.cjs` can check that every
 *  surface actually wires up the ones it claims. */
export type NavActionId =
  | 'summary'
  | 'importAdif'
  | 'secondRadio'
  | 'cwWindow'
  | 'rigDetails'
  | 'switchOperator'
  | 'toggleTheme'
  | 'toggleNight';

export interface NavItem {
  id: string;
  label: string;
  /** One line under the label. The drawer has room for it and the old
   *  icon-and-tooltip header did not, which is a large part of why things were
   *  hard to find: `Backup` and `ADIF` both read as "a download". */
  hint: string;
  group: NavGroup;
  /** Exactly one of these. `href` renders an anchor, `action` a button. */
  href?: string;
  action?: NavActionId;
  /** Opens in a new tab, so a mid-event lookup never costs the logging window. */
  newTab?: boolean;
}

export interface NavContext {
  surface: NavSurface;
  joinCode: string;
  eventType: EventType;
  /** Read-only dashboard viewer: no exports, no operator actions. */
  isVisitor?: boolean;
  /** Logger only. A second radio is a second window at the next station. */
  stationNumber?: number;
  operatorCall?: string;
  /** Logger only: the CW window and the rig readout are only meaningful with
   *  a radio attached, and CW keying additionally needs a rig that supports
   *  it. These gate on real state, never on screen width. */
  rigConnected?: boolean;
  canCw?: boolean;
}

const isSes = (t: EventType) => t === 'SES';

/**
 * The menu for one surface, already filtered.
 *
 * Filtering is on what the event and the hardware actually are — a special
 * event has no Cabrillo submission to make, a visitor has no log to export,
 * a rig that cannot key CW has no CW window. Screen width is never a reason
 * to drop an item: that is the bug this replaces.
 */
export function navItems(ctx: NavContext): NavItem[] {
  const { surface, joinCode, eventType, isVisitor = false } = ctx;
  const ses = isSes(eventType);
  const items: NavItem[] = [];

  // ── Go to ────────────────────────────────────────────────────────────────
  if (surface === 'logger') {
    items.push({
      id: 'dashboard',
      label: 'Dashboard',
      hint: 'Live score, map and log — for a second screen',
      group: 'Go to',
      href: `/event/${joinCode}/dashboard`,
    });
  } else {
    items.push({
      id: 'logger',
      label: isVisitor ? 'Leave' : 'Back to the logger',
      hint: isVisitor
        ? 'Leave visitor mode and return to the home page'
        : 'Return to your logging screen',
      group: 'Go to',
      // A visitor never chose an operator callsign, so sending them to the
      // event's sign-in asks for one they do not have — and that page drops
      // straight into the logger when the browser still holds a sign-in.
      href: isVisitor ? '/' : `/event/${joinCode}`,
    });
  }

  // ── This event ───────────────────────────────────────────────────────────
  if (surface === 'logger' && !isVisitor) {
    items.push({
      id: 'switchOperator',
      label: 'Switch operator',
      hint: 'Hand the radio over without losing the event',
      group: 'This event',
      action: 'switchOperator',
    });
    items.push({
      id: 'secondRadio',
      label: `Open station ${(ctx.stationNumber ?? 1) + 1}`,
      hint: 'A second logging window, for a second radio',
      group: 'This event',
      action: 'secondRadio',
    });
    if (ctx.rigConnected && ctx.canCw) {
      items.push({
        id: 'cwWindow',
        label: 'CW keying window',
        hint: 'Macros, Run/S&P and keying from the radio',
        group: 'This event',
        action: 'cwWindow',
      });
    }
    if (ctx.rigConnected) {
      items.push({
        id: 'rigDetails',
        label: 'Rig control',
        hint: 'What the bridge is reporting, and how it is set up',
        group: 'This event',
        action: 'rigDetails',
      });
    }
    items.push({
      id: 'importAdif',
      label: 'Import ADIF',
      hint: 'Bring in contacts from WSJT-X, JTDX or another logger',
      group: 'This event',
      action: 'importAdif',
    });
  }

  if (surface === 'dashboard' && !ses) {
    items.push({
      id: 'summary',
      label: 'Summary sheet',
      hint: 'The printable worksheet you transcribe onto an ARRL entry',
      group: 'This event',
      action: 'summary',
    });
  }

  // ── Export ───────────────────────────────────────────────────────────────
  // A visitor is explicitly read-only: they picked a screen with no callsign
  // and no operator actions, and handing them the whole log would undo that.
  if (!isVisitor) {
    items.push({
      id: 'exportAdif',
      label: 'Download ADIF',
      hint: 'Every contact, for LoTW, eQSL or another logger',
      group: 'Export',
      href: `/api/export/${joinCode}`,
    });
    if (!ses) {
      items.push({
        id: 'exportCabrillo',
        label: 'Download Cabrillo',
        hint: 'The contest submission file for the ARRL',
        group: 'Export',
        href: `/api/export/${joinCode}?format=cabrillo`,
      });
    }
    items.push({
      id: 'exportBackup',
      label: 'Full event backup',
      hint: 'Settings, contacts, roster and checkouts as one JSON file',
      group: 'Export',
      href: `/api/export/${joinCode}?format=json`,
    });
  }

  // ── Display ──────────────────────────────────────────────────────────────
  items.push({
    id: 'theme',
    label: 'Light / dark',
    hint: 'Switch the colour scheme',
    group: 'Display',
    action: 'toggleTheme',
  });
  if (surface === 'logger') {
    items.push({
      id: 'night',
      label: 'Night mode',
      hint: 'Red on black, to keep your dark adaptation after sunset',
      group: 'Display',
      action: 'toggleNight',
    });
  }

  // ── Help ─────────────────────────────────────────────────────────────────
  items.push({
    id: 'docs',
    label: 'Guides',
    hint: 'Operating, scoring, rig control and troubleshooting',
    group: 'Help',
    href: '/docs',
    newTab: true,
  });

  return items;
}

/** The items of one group, for rendering. Empty groups are skipped by the
 *  drawer rather than drawn as a bare heading. */
export function itemsByGroup(items: NavItem[]): { group: NavGroup; items: NavItem[] }[] {
  return NAV_GROUPS
    .map(group => ({ group, items: items.filter(i => i.group === group) }))
    .filter(g => g.items.length > 0);
}

/** Every action id a surface can ask its host to perform. The host declares a
 *  handler for each; `scripts/test-nav.cjs` reads both back and fails if the
 *  table grows an action nothing wires up — which would render a menu entry
 *  that silently does nothing. */
export function actionsFor(ctx: NavContext): NavActionId[] {
  const seen = new Set<NavActionId>();
  for (const item of navItems(ctx)) if (item.action) seen.add(item.action);
  return [...seen];
}
