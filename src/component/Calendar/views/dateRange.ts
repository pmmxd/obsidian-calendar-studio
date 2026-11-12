import {moment} from 'obsidian';
import {NavigateAction} from 'react-big-calendar';
import useCalendarStore, {ListRange} from '@/stores/calendarStore';
import {eventRanges} from '@/utils/eventOccurrences';

export interface DateWindow {
  start: moment.Moment;
  end: moment.Moment;
}

/**
 * The active time window, derived from the anchor `date` and `range`:
 *  - 'month'    : the calendar month containing `date`
 *  - 'rolling'  : the ~30 days ending at `date` (30天)
 *  - 'week'     : the calendar week containing `date` (本周)
 *  - 'lastweek' : the calendar week before `date` (上周)
 *  - 'nextweek' : the calendar week after `date` (下周)
 *
 * Not every view offers every range: each one falls back to 'month' for the
 * ranges it does not expose, via {@link agendaRange} / {@link ganttRange}.
 */
export function getWindow(date: Date, range: ListRange): DateWindow {
  const anchor = moment(date);
  if (range === 'rolling') {
    return {
      start: anchor.clone().subtract(1, 'month').add(1, 'day').startOf('day'),
      end: anchor.clone().endOf('day'),
    };
  }
  if (range === 'week') {
    return {start: anchor.clone().startOf('week'), end: anchor.clone().endOf('week')};
  }
  if (range === 'lastweek') {
    const prev = anchor.clone().subtract(1, 'week');
    return {start: prev.clone().startOf('week'), end: prev.clone().endOf('week')};
  }
  if (range === 'nextweek') {
    const next = anchor.clone().add(1, 'week');
    return {start: next.clone().startOf('week'), end: next.clone().endOf('week')};
  }
  return {start: anchor.clone().startOf('month'), end: anchor.clone().endOf('month')};
}

/** Range tabs offered by the Agenda view. */
export const AGENDA_RANGES: ListRange[] = ['month', 'week', 'lastweek', 'rolling'];

/** Range tabs offered by the Gantt view. */
export const GANTT_RANGES: ListRange[] = ['month', 'week', 'nextweek', 'rolling'];

/** The Agenda window used for `range`, falling back to month when unsupported. */
export function agendaRange(range: ListRange): ListRange {
  return AGENDA_RANGES.includes(range) ? range : 'month';
}

/** The Gantt window used for `range`, falling back to month when unsupported. */
export function ganttRange(range: ListRange): ListRange {
  return GANTT_RANGES.includes(range) ? range : 'month';
}

/** Reads the current list range from the store (safe outside React). */
export function currentRange(): ListRange {
  return useCalendarStore.getState().listRange;
}

/** Reads the configured week start from the store (safe outside React). */
export function currentStartDay(): 'sunday' | 'monday' {
  return useCalendarStore.getState().startDay;
}

/** Start of the week containing `date`, honouring the configured week start. */
export function weekStartOf(date: Date | moment.Moment, startDay: 'sunday' | 'monday'): moment.Moment {
  const anchor = moment(date).startOf('day');
  const target = startDay === 'sunday' ? 0 : 1;
  const diff = (anchor.day() - target + 7) % 7;
  return anchor.subtract(diff, 'day');
}

/**
 * The two-week window shown by the Bi-week view: the current week plus the next
 * one, i.e. 14 days starting on the configured first day of the week.
 */
export function biWeekWindow(date: Date, startDay: 'sunday' | 'monday'): DateWindow {
  const start = weekStartOf(date, startDay);
  return {start, end: start.clone().add(13, 'day').endOf('day')};
}

/** Toolbar label for the two-week window. */
export function biWeekTitle(date: Date, startDay: 'sunday' | 'monday'): string {
  const win = biWeekWindow(date, startDay);
  return `${win.start.format('YYYY-MM-DD')} ~ ${win.end.format('YYYY-MM-DD')}`;
}

/** Navigation for the Bi-week view: PREV/NEXT step by a whole two-week window. */
export function navigateBiWeek(date: Date, action: NavigateAction): Date {
  switch (action) {
    case 'PREV':
      return moment(date).subtract(2, 'week').toDate();
    case 'NEXT':
      return moment(date).add(2, 'week').toDate();
    case 'TODAY':
      return new Date();
    default:
      return date;
  }
}

/**
 * Navigation for the list views: PREV/NEXT step by the width of the active
 * window (a week for the week ranges, a month otherwise). TODAY returns today.
 * Used by each custom view's static `navigate`.
 */
export function navigateRange(date: Date, action: NavigateAction, range: ListRange): Date {
  const isWeekWindow = range === 'week' || range === 'lastweek' || range === 'nextweek';
  const unit = isWeekWindow ? 'week' : 'month';

  switch (action) {
    case 'PREV':
      return moment(date).subtract(1, unit).toDate();
    case 'NEXT':
      return moment(date).add(1, unit).toDate();
    case 'TODAY':
      return new Date();
    default:
      return date;
  }
}

/** Toolbar label for the active window. */
export function rangeTitle(date: Date, range: ListRange): string {
  const win = getWindow(date, range);
  if (range === 'month') {
    return win.start.format('YYYY-MM');
  }
  return `${win.start.format('YYYY-MM-DD')} ~ ${win.end.format('YYYY-MM-DD')}`;
}

/** Whether an event intersects the window (inclusive). */
export function eventIntersects(event: Model.Event, win: DateWindow): boolean {
  const start = moment(event.start);
  const end = moment(event.end || event.start);
  return end.isSameOrAfter(win.start) && start.isSameOrBefore(win.end);
}

/**
 * Whether any period of an item intersects the window. An item may cover
 * several periods, so checking only its primary start/end would hide it from
 * a window its later periods fall into.
 */
export function recordIntersects(event: Model.Event, win: DateWindow): boolean {
  return eventRanges(event).some((range) => eventIntersects({...event, start: range.start, end: range.end}, win));
}
