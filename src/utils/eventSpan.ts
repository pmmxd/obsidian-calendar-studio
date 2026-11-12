import {moment} from 'obsidian';

/**
 * Whether a span covers whole days, i.e. is day-granular rather than timed.
 *
 * Selection UIs hand the end back in one of two ways: inclusive (23:59:59.999,
 * as the Agenda/Gantt day buttons do) or exclusive (the next day at 00:00, as
 * react-big-calendar's month selection does). Both mean "the whole day".
 */
export function isAllDaySpan(start: Date, end: Date): boolean {
  if (!start || !end) return false;

  const from = moment(start);
  const to = moment(end);

  const wholeDayStart = from.hour() === 0 && from.minute() === 0;
  const wholeDayEnd = (to.hour() === 0 && to.minute() === 0) || (to.hour() === 23 && to.minute() >= 59);

  return wholeDayStart && wholeDayEnd;
}
