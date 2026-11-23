/**
 * Seat counts after the campaign are estimates, so they are shown as a range of about ±10%
 * (at least ±1 seat) instead of an exact number.
 */
export function seatRange(seats: number, max = Infinity) {
  if (seats <= 0) return { lo: 0, hi: 0, text: "0" };
  const delta = Math.max(1, Math.round(seats * 0.1));
  const lo = Math.max(0, seats - delta);
  const hi = Math.min(max, seats + delta);
  return { lo, hi, text: `${lo}–${hi}` };
}
