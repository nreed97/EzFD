'use client';

// Pairs a native date input with the 24-hour ClockTimePicker, combining them
// into the same "YYYY-MM-DDTHH:MM" shape a <input type="datetime-local">
// produces — so callers that already read that format (e.g. appending ":00Z"
// for UTC) don't need to change.

import ClockTimePicker from './ClockTimePicker';

export default function DateTimeField({
  value,
  onChange,
  label,
  minDate,
  maxDate,
  compact = false,
}: {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  /** "YYYY-MM-DD" bounds — e.g. an SES's own start/end date, so scheduling
   *  ahead can't pick a date outside the event. */
  minDate?: string;
  maxDate?: string;
  compact?: boolean;
}) {
  const [datePart, timePart] = value ? value.split('T') : ['', ''];

  function setDate(newDate: string) {
    onChange(newDate ? `${newDate}T${timePart || '00:00'}` : '');
  }
  function setTime(newTime: string) {
    onChange(`${datePart || minDate || new Date().toISOString().slice(0, 10)}T${newTime}`);
  }

  const dateClass = compact
    ? 'w-full rounded border border-zinc-700 bg-zinc-800 px-1.5 py-1 text-2xs font-mono text-zinc-300 light:border-zinc-300 light:bg-white light:text-zinc-700'
    : 'input w-full';

  return (
    // Stacked rather than side-by-side: a fixed-width date input next to the
    // clock field's own HH/MM/icon cluster doesn't fit two-up in a narrow
    // column (the SES sidebar panel, or the two-column Starts/Ends row on
    // event/new) — it overflowed the card. Full-width stacked rows never do.
    <div className="flex flex-col gap-1.5">
      <input
        type="date"
        value={datePart}
        onChange={e => setDate(e.target.value)}
        min={minDate}
        max={maxDate}
        aria-label={label ? `${label} date` : 'Date'}
        className={dateClass}
      />
      <ClockTimePicker
        value={timePart}
        onChange={setTime}
        label={label}
        compact={compact}
        className="w-full"
      />
    </div>
  );
}
