// Bangalore wall-clock helpers.
//
// Admin forms must read and write the time at the venue, not the time on the
// machine doing the editing — otherwise an admin editing while travelling
// silently shifts an event by their UTC offset, and an all-day event can land
// on the wrong calendar day entirely.
//
// India has held a single +05:30 offset since 1945 and observes no DST, so the
// conversion is plain arithmetic; there is no zone rule to look up.

export const IST_OFFSET_MINUTES = 330;
const IST_SUFFIX = '+05:30';
const MS_PER_MINUTE = 60000;

const pad = (n: number) => String(n).padStart(2, '0');

/** Bangalore date (`YYYY-MM-DD`) and time (`HH:MM`) for an instant. */
export function istWallClock(iso: string | Date): { date: string; time: string } | null {
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  // Shifting the instant lets the UTC getters read out Bangalore wall time.
  const shifted = new Date(d.getTime() + IST_OFFSET_MINUTES * MS_PER_MINUTE);
  return {
    date: `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`,
    time: `${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`,
  };
}

/** `2026-09-05` + `18:00` -> `2026-09-05T18:00:00+05:30`. */
export function istIso(date: string, time: string): string {
  if (!date) return '';
  const [h = 0, m = 0] = (time || '00:00').split(':').map(Number);
  return `${date}T${pad(h)}:${pad(m)}:00${IST_SUFFIX}`;
}

/** Start of the Bangalore day an instant falls on. */
export function istMidnight(iso: string): string {
  const wc = istWallClock(iso);
  return wc ? istIso(wc.date, '00:00') : iso;
}

/** Same Bangalore wall time, N calendar days later. */
export function addIstDays(iso: string, days: number): string {
  const wc = istWallClock(iso);
  if (!wc) return iso;
  const [y, m, d] = wc.date.split('-').map(Number);
  const shifted = new Date(Date.UTC(y, m - 1, d + days));
  const date = `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
  return istIso(date, wc.time);
}

/** N hours later, re-expressed in Bangalore wall time. */
export function addIstHours(iso: string, hours: number): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const wc = istWallClock(new Date(d.getTime() + hours * 60 * MS_PER_MINUTE));
  return wc ? istIso(wc.date, wc.time) : iso;
}
