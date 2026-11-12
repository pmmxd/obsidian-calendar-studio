import {moment} from 'obsidian';
import globalService from '@/services/globalService';
import {getMarkBasedOnEvent} from './parser';

/**
 * Note line format shared by the reader and the writer.
 *
 * An item occupies one line; its sub-items are the following lines indented one
 * level deeper (a tab, as in:
 *
 *   - [x] 审阅prd `2026-06-12 ~ 2026-06-13` `2026-06-14 ~ 2026-06-16`
 *   \t- [ ] 子事项 15:00-16:00 `2026-06-12 ~ 2026-06-12`
 * )
 *
 * Every period is written as inline code, so the dates stay visually distinct
 * from the title.
 */

/** Indentation written for one nesting level. */
export const INDENT_UNIT = '\t';

/**
 * Separator placed between the title and the periods, and between the periods
 * themselves. (Older notes used a leading "~" and "；" instead; both are still
 * read, so no migration is needed.)
 */
export const RANGE_GAP = ' ';

export interface ItemLineInput {
  title: string;
  eventType: string;
  /** Every period of the item, earliest first. At least one entry. */
  ranges: Model.EventRange[];
  /** Day-granular items carry no "HH:mm-HH:mm" prefix. */
  allDay: boolean;
  /** Nesting level: 0 for a parent, 1 for a child, ... */
  depth?: number;
  blockId?: string;
}

/** Column width of a raw indentation string (a tab counts as four columns). */
export function indentationWidth(indentation: string): number {
  return indentation.replace(/\t/g, '    ').length;
}

/** Leading whitespace of a line. */
export function lineIndentation(line: string): string {
  const match = /^[\t ]*/.exec(line);
  return match ? match[0] : '';
}

/**
 * Whether periods are written as inline code, per the plugin setting. Both
 * forms are read back, so switching the setting never invalidates old notes.
 */
function periodsAsCode(): boolean {
  return globalService.getState().pluginSetting?.PeriodAsCode !== false;
}

/**
 * One period, either as inline code or as plain text:
 *   `2026-09-17 ~ 2026-09-18`   or   2026-09-17 ~ 2026-09-18
 */
export function formatPeriod(start: Date | moment.Moment, end: Date | moment.Moment): string {
  const last = end || start;
  const text = `${moment(start).format('YYYY-MM-DD')} ~ ${moment(last).format('YYYY-MM-DD')}`;
  return periodsAsCode() ? `\`${text}\`` : text;
}

/**
 * Renders every period of an item, separated by {@link RANGE_GAP}:
 *   `2026-09-17 ~ 2026-09-18` `2026-09-19 ~ 2026-09-20`
 */
export function formatRanges(ranges: Model.EventRange[]): string {
  return ranges.map((range) => formatPeriod(range.start, range.end || range.start)).join(RANGE_GAP);
}

/**
 * Formats one item (parent or child) as a note line.
 *
 * Timed items always carry their periods explicitly so the day stays
 * recoverable no matter which note the item lives in.
 */
export function formatItemLine(input: ItemLineInput): string {
  const depth = Math.max(0, input.depth ?? 0);
  const indent = INDENT_UNIT.repeat(depth);
  const mark = getMarkBasedOnEvent(input.eventType);
  const bullet = mark === null ? '-' : `- [${mark}]`;

  const ranges = input.ranges.length > 0 ? formatRanges(input.ranges) : '';
  // Two spaces before the first period, so the dates read apart from the title
  const rangeText = ranges ? `${RANGE_GAP}${ranges}` : '';
  const title = input.title.trim();

  let line: string;
  if (input.allDay) {
    line = `${indent}${bullet} ${title}${rangeText}`;
  } else {
    const first = input.ranges[0];
    const timeRange = first
      ? `${moment(first.start).format('HH:mm')}-${moment(first.end || first.start).format('HH:mm')}`
      : '';
    line = `${indent}${bullet} ${timeRange ? `${timeRange} ` : ''}${title}${rangeText}`;
  }

  return input.blockId ? `${line} ${input.blockId}` : line;
}
