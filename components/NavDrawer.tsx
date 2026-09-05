'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { navItems, itemsByGroup, type NavContext, type NavActionId } from '@/lib/nav';

/**
 * The hamburger and its slide-out menu.
 *
 * Every entry comes from `lib/nav.ts`; nothing is listed here. One drawer
 * serves both the logger and the dashboard and every screen width, which is
 * the point — the two hand-written copies it replaces had drifted until Docs
 * was phone-only and the exports were desktop-only.
 *
 * ## Keyboard and focus
 *
 * A menu that swallows the keyboard is worse than the row of buttons it
 * replaces, so: Escape closes it, focus moves into the panel on open and back
 * to the hamburger on close, and Tab cycles within the panel while it is open.
 * The backdrop is a real button so a pointer user can dismiss by clicking away
 * without that being the *only* way out.
 */

export type NavHandlers = Partial<Record<NavActionId, () => void>>;

interface Props {
  ctx: NavContext;
  handlers: NavHandlers;
  /** Rendered at the top of the panel — the event identity on the logger, so
   *  the drawer says which event and operator it belongs to. */
  heading?: React.ReactNode;
}

export default function NavDrawer({ ctx, handlers, heading }: Props) {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();

  // Escape closes, and Tab is kept inside the panel. Bound only while open, so
  // the logger's own key handling (ESM, the Tab loop in QSOForm) is untouched
  // the rest of the time — the entry form is the hot path and must not gain a
  // listener it has to fall through on every keystroke.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); return; }
      if (e.key !== 'Tab') return;
      const focusable = panelRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled])',
      );
      if (!focusable || focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open]);

  // Move focus in on open and back to the hamburger on close. Both are DOM
  // calls in an effect rather than state, so nothing re-renders for them.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open) {
      panelRef.current?.querySelector<HTMLElement>('a[href], button')?.focus();
    } else if (wasOpen.current) {
      buttonRef.current?.focus();
    }
    wasOpen.current = open;
  }, [open]);

  // The page behind must not scroll under the drawer on a phone, where the
  // panel is the whole screen and a stray scroll looks like the app moving on
  // its own.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  const groups = itemsByGroup(navItems(ctx));

  const itemClass =
    'block w-full rounded px-3 py-2 text-left transition-colors hover:bg-zinc-800 ' +
    'focus:bg-zinc-800 focus:outline-none focus:ring-1 focus:ring-amber-400 ' +
    'light:hover:bg-zinc-100 light:focus:bg-zinc-100';

  return (
    <>
      <button
        ref={buttonRef}
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label="Menu"
        title="Menu"
        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded border border-zinc-700 text-zinc-300 transition-colors hover:bg-zinc-800 light:border-zinc-300 light:text-zinc-600 light:hover:bg-zinc-100"
      >
        {/* Drawn rather than an emoji: the three bars are the one icon every
            operator already reads as "menu", and a font substitution on a
            field laptop must not turn it into a box. */}
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
          <path d="M2 4h12M2 8h12M2 12h12" />
        </svg>
      </button>

      {/* Kept mounted but hidden so opening the drawer costs no layout work
          mid-run, and so the transition has something to animate from. */}
      <div
        className={`fixed inset-0 z-50 ${open ? '' : 'pointer-events-none'}`}
        aria-hidden={!open}
      >
        <button
          tabIndex={-1}
          aria-hidden="true"
          onClick={() => setOpen(false)}
          className={`absolute inset-0 h-full w-full cursor-default bg-black/50 transition-opacity duration-200 motion-reduce:transition-none ${
            open ? 'opacity-100' : 'opacity-0'
          }`}
        />
        <div
          ref={panelRef}
          role="dialog"
          aria-modal={open}
          aria-labelledby={titleId}
          className={`absolute right-0 top-0 flex h-full w-full max-w-xs flex-col border-l border-zinc-800 bg-zinc-900 shadow-2xl transition-transform duration-200 motion-reduce:transition-none light:border-zinc-200 light:bg-white ${
            open ? 'translate-x-0' : 'translate-x-full'
          }`}
        >
          <div className="flex items-start justify-between gap-2 border-b border-zinc-800 px-4 py-3 light:border-zinc-200">
            <div className="min-w-0">
              <h2 id={titleId} className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                Menu
              </h2>
              {heading && <div className="mt-1 min-w-0">{heading}</div>}
            </div>
            <button
              onClick={() => setOpen(false)}
              aria-label="Close menu"
              className="shrink-0 rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800 light:border-zinc-300 light:text-zinc-600 light:hover:bg-zinc-100"
            >
              Close
            </button>
          </div>

          <nav className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
            {groups.map(({ group, items }) => (
              <div key={group} className="mb-3 last:mb-0">
                <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-600 light:text-zinc-400">
                  {group}
                </div>
                {items.map(item => {
                  const body = (
                    <>
                      <span className="block text-sm font-medium text-zinc-200 light:text-zinc-800">
                        {item.label}
                        {item.newTab && <span className="ml-1 text-[10px] text-zinc-500">↗</span>}
                      </span>
                      {/* The hint is why the drawer is easier to read than the
                          old header: "ADIF" and "Backup" both looked like a
                          download, and nothing on screen said which was which. */}
                      <span className="mt-0.5 block text-[11px] leading-snug text-zinc-500 light:text-zinc-500">
                        {item.hint}
                      </span>
                    </>
                  );

                  if (item.href) {
                    return (
                      <a
                        key={item.id}
                        href={item.href}
                        {...(item.newTab ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                        onClick={() => setOpen(false)}
                        className={itemClass}
                      >
                        {body}
                      </a>
                    );
                  }

                  const handler = item.action ? handlers[item.action] : undefined;
                  // A menu entry that does nothing is worse than one that is
                  // absent, so an unwired action is not rendered — and
                  // scripts/test-nav.cjs fails if a surface leaves one unwired
                  // rather than letting it disappear quietly here.
                  if (!handler) return null;
                  return (
                    <button
                      key={item.id}
                      onClick={() => { setOpen(false); handler(); }}
                      className={itemClass}
                    >
                      {body}
                    </button>
                  );
                })}
              </div>
            ))}
          </nav>
        </div>
      </div>
    </>
  );
}
