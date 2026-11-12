/**
 * Unified parser for tasks and list items in Obsidian Big Calendar
 * Provides high-performance parsing of lists, tasks, times, dates, and text content
 */

import {moment} from 'obsidian';
import {BigCalendarSettings} from '@/setting';

/**
 * Represents the status of a task
 */
export enum TaskStatus {
  // Standard statuses
  Todo = 'Todo',
  Done = 'Done',
  Cancelled = 'Cancelled',
  Forwarded = 'Forwarded',
  Deferred = 'Deferred',
  InProgress = 'InProgress',
  Question = 'Question',
  // Additional statuses
  Important = 'Important',
  Info = 'Info',
  Bookmark = 'Bookmark',
  Pro = 'Pro',
  Con = 'Con',
  Brainstorming = 'Brainstorming',
  Example = 'Example',
  Quote = 'Quote',
  Note = 'Note',
  Win = 'Win',
  Lose = 'Lose',
  Add = 'Add',
  Reviewed = 'Reviewed',
  // Default for non-recognized status characters
  Unknown = 'Unknown',
  // Non-task
  NotATask = 'NotATask',
}

/**
 * Maps status characters to TaskStatus enum values
 */
const STATUS_MAPPING: Record<string, TaskStatus> = {
  ' ': TaskStatus.Todo,
  x: TaskStatus.Done,
  X: TaskStatus.Done,
  '-': TaskStatus.Cancelled,
  '>': TaskStatus.Forwarded,
  D: TaskStatus.Deferred,
  '/': TaskStatus.InProgress,
  '?': TaskStatus.Question,
  '!': TaskStatus.Important,
  i: TaskStatus.Info,
  B: TaskStatus.Bookmark,
  P: TaskStatus.Pro,
  C: TaskStatus.Con,
  b: TaskStatus.Brainstorming,
  E: TaskStatus.Example,
  Q: TaskStatus.Quote,
  N: TaskStatus.Note,
  W: TaskStatus.Win,
  L: TaskStatus.Lose,
  '+': TaskStatus.Add,
  R: TaskStatus.Reviewed,
};

/**
 * Represents time information
 */
export interface TimeInfo {
  hour: number;
  minute: number;
  second?: number;
  isEndTime?: boolean;
}

/**
 * Represents date information
 */
export interface DateInfo {
  date: string; // YYYY-MM-DD format
  moment: moment.Moment;
  type: 'due' | 'start' | 'scheduled' | 'done';
  rawMatch?: string;
}

/**
 * A single "~START ~ END" period written on an item's line.
 */
export interface ParsedRange {
  start: string; // YYYY-MM-DD
  end: string; // YYYY-MM-DD
}

/**
 * Unified representation of a parsed line item
 */
export interface ParsedLine {
  // Basic information
  originalLine: string;
  content: string;
  indentation: string;

  // Task-specific information
  isTask: boolean;
  taskStatus?: TaskStatus;
  statusCharacter?: string;

  // Time and date information
  startTime?: TimeInfo;
  endTime?: TimeInfo;
  dates: DateInfo[];
  /** Every period on the line. Parents may declare more than one. */
  ranges: ParsedRange[];

  // Markers
  hasRecurrence: boolean;
  recurrenceRule?: string;
  blockLink?: string;

  // Line type information
  isListItem: boolean;
  listMarker: string;
}

/**
 * Regex patterns for parsing
 */
export const PATTERNS = {
  // Basic line structure
  LIST_ITEM: /^(\s*)(-|\*|\+|\d+\.)\s+(.*)$/,
  TASK: /^(\s*)(-|\*|\+|\d+\.)\s+\[(.)\]\s+(.*)$/,

  // Time patterns
  TIME_STANDARD: /(\d{1,2}):(\d{2})(?::(\d{2}))?/g,
  TIME_WITH_TAG: /<time>(\d{1,2}):(\d{2})(?::(\d{2}))?<\/time>/g,
  END_TIME: /⏲\s?(\d{1,2}):(\d{2})(?::(\d{2}))?/g,
  TIME_RANGE: /(\d{1,2}):(\d{2})(?::(\d{2}))?-(\d{1,2}):(\d{2})(?::(\d{2}))?/g,

  // Date patterns: events are written as "~START ~ END" (or a single "~ DATE").
  DATE_RANGE: /~\s?(\d{4}-\d{2}-\d{2})\s*~\s?(\d{4}-\d{2}-\d{2})/g,
  SINGLE_DATE: /~\s?(\d{4}-\d{2}-\d{2})/g,
  /**
   * One period of an item. Current notes write it as inline code
   * ("`A ~ B`  `C ~ D`"); older ones used a leading "~" and "；" separators.
   * Both are matched here, which also keeps the pattern usable for stripping.
   */
  RANGE_PAIR: /(~)?\s*`?(\d{4}-\d{2}-\d{2})\s*~\s*(\d{4}-\d{2}-\d{2})`?/g,
  SCHEDULED_DATE: /[⏳⌛]\s?(\d{4}-\d{2}-\d{2})/g,
  DONE_DATE: /✅\s?(\d{4}-\d{2}-\d{2})/g,

  // Additional markers
  RECURRENCE: /🔁([a-zA-Z0-9, !]+)$/,
  BLOCK_LINK: /\s\^([a-zA-Z0-9-]+)$/,
};

/**
 * Extracts start and end times from a line
 *
 * @param line The text line to parse
 * @returns Object containing start and end times if found
 */
export function extractTimes(line: string): {startTime?: TimeInfo; endTime?: TimeInfo} {
  const result: {startTime?: TimeInfo; endTime?: TimeInfo} = {};

  // First, check for time range format (HH:MM-HH:MM)
  const timeRangeMatches = [...line.matchAll(PATTERNS.TIME_RANGE)];
  if (timeRangeMatches.length > 0) {
    const match = timeRangeMatches[0];
    result.startTime = {
      hour: parseInt(match[1]),
      minute: parseInt(match[2]),
      second: match[3] ? parseInt(match[3]) : undefined,
      isEndTime: false,
    };
    result.endTime = {
      hour: parseInt(match[4]),
      minute: parseInt(match[5]),
      second: match[6] ? parseInt(match[6]) : undefined,
      isEndTime: true,
    };
    return result;
  }

  // Extract end time (prioritize)
  const endTimeMatch = [...line.matchAll(PATTERNS.END_TIME)][0];
  if (endTimeMatch) {
    result.endTime = {
      hour: parseInt(endTimeMatch[1]),
      minute: parseInt(endTimeMatch[2]),
      second: endTimeMatch[3] ? parseInt(endTimeMatch[3]) : undefined,
      isEndTime: true,
    };
  }

  // Extract start time - first check for time tag
  const timeTagMatches = [...line.matchAll(PATTERNS.TIME_WITH_TAG)];
  if (timeTagMatches.length > 0) {
    const match = timeTagMatches[0];
    result.startTime = {
      hour: parseInt(match[1]),
      minute: parseInt(match[2]),
      second: match[3] ? parseInt(match[3]) : undefined,
      isEndTime: false,
    };
  } else {
    // Check for standard time format
    const standardTimeMatches = [...line.matchAll(PATTERNS.TIME_STANDARD)];
    if (standardTimeMatches.length > 0) {
      // Use the first time as start time (if it's not the same as end time)
      const match = standardTimeMatches[0];
      const potentialStartTime = {
        hour: parseInt(match[1]),
        minute: parseInt(match[2]),
        second: match[3] ? parseInt(match[3]) : undefined,
        isEndTime: false,
      };

      if (
        !result.endTime ||
        result.endTime.hour !== potentialStartTime.hour ||
        result.endTime.minute !== potentialStartTime.minute
      ) {
        result.startTime = potentialStartTime;
      } else if (standardTimeMatches.length > 1) {
        // If the first time was the end time, try using the second time as start time
        const secondMatch = standardTimeMatches[1];
        result.startTime = {
          hour: parseInt(secondMatch[1]),
          minute: parseInt(secondMatch[2]),
          second: secondMatch[3] ? parseInt(secondMatch[3]) : undefined,
          isEndTime: false,
        };
      }
    }
  }

  return result;
}

/** Fresh regex copies - PATTERNS keeps shared /g instances whose lastIndex moves. */
const rangePairRegex = (): RegExp => /(~)?\s*`?(\d{4}-\d{2}-\d{2})\s*~\s*(\d{4}-\d{2}-\d{2})`?/g;
const singleDateRegex = (): RegExp => /~\s?(\d{4}-\d{2}-\d{2})/g;

/**
 * Extracts every period declared on a line.
 *
 * A line may carry several periods, written as inline code and separated by two
 * spaces:
 *   `- [x] 审阅prd `2026-06-12 ~ 2026-06-13`  `2026-06-14 ~ 2026-06-16``
 * Older notes ("~A ~ B；C ~ D") are still understood, and a lone "~ DATE" is
 * read as a one-day period.
 */
export function extractRanges(line: string): ParsedRange[] {
  const ranges: ParsedRange[] = [];
  const seen = new Set<string>();

  for (const match of line.matchAll(rangePairRegex())) {
    const start = match[2];
    const end = match[3];
    const key = `${start}|${end}`;
    if (seen.has(key)) continue;
    seen.add(key);
    ranges.push({start, end});
  }

  if (ranges.length === 0) {
    const single = [...line.matchAll(singleDateRegex())][0];
    if (single) {
      ranges.push({start: single[1], end: single[1]});
    }
  }

  return ranges;
}

/**
 * Whether a line carries at least one period marker.
 */
export function hasDateMarkers(line: string): boolean {
  return rangePairRegex().test(line) || singleDateRegex().test(line);
}

/**
 * Extracts all dates from a line
 *
 * @param line The text line to parse
 * @returns Array of date information objects
 */
export function extractDates(line: string): DateInfo[] {
  const dates: DateInfo[] = [];

  // Every period becomes a start/due pair (a parent may declare several)
  for (const range of extractRanges(line)) {
    dates.push({
      date: range.start,
      moment: moment(range.start, 'YYYY-MM-DD'),
      type: 'start',
      rawMatch: `~${range.start} ~ ${range.end}`,
    });
    dates.push({
      date: range.end,
      moment: moment(range.end, 'YYYY-MM-DD'),
      type: 'due',
      rawMatch: `~${range.start} ~ ${range.end}`,
    });
  }

  // Extract scheduled dates
  const scheduledDateMatches = [...line.matchAll(PATTERNS.SCHEDULED_DATE)];
  for (const match of scheduledDateMatches) {
    dates.push({
      date: match[1],
      moment: moment(match[1], 'YYYY-MM-DD'),
      type: 'scheduled',
      rawMatch: match[0],
    });
  }

  // Extract done dates
  const doneDateMatches = [...line.matchAll(PATTERNS.DONE_DATE)];
  for (const match of doneDateMatches) {
    dates.push({
      date: match[1],
      moment: moment(match[1], 'YYYY-MM-DD'),
      type: 'done',
      rawMatch: match[0],
    });
  }

  return dates;
}

/**
 * Extracts recurrence information from a line
 *
 * @param line The text line to parse
 * @returns Recurrence rule text if found
 */
export function extractRecurrence(line: string): string | undefined {
  const match = line.match(PATTERNS.RECURRENCE);
  return match ? match[1].trim() : undefined;
}

/**
 * Extracts block link information from a line
 *
 * @param line The text line to parse
 * @returns Block link ID if found
 */
export function extractBlockLink(line: string): string | undefined {
  const match = line.match(PATTERNS.BLOCK_LINK);
  return match ? match[1] : undefined;
}

/**
 * Cleans the content by removing metadata markers
 *
 * @param content The original content text
 * @param dates Array of date information to remove
 * @param recurrenceRule Recurrence rule to remove (if present)
 * @param blockLink Block link to remove (if present)
 * @returns Cleaned content text
 */
export function cleanContent(content: string, dates: DateInfo[], recurrenceRule?: string, blockLink?: string): string {
  let result = content;

  // Timed items are written as "HH:MM-HH:MM title": the time belongs to the
  // item's period, not to its title
  result = result.replace(/^\s*\d{1,2}:\d{2}(?:-\d{1,2}:\d{2})?\s*/, ' ');

  // Remove every period marker ("~A ~ B；C ~ D" and lone "~ DATE")
  result = result.replace(rangePairRegex(), ' ');
  result = result.replace(singleDateRegex(), ' ');
  // Drop the "；" separators that connected the removed periods
  result = result.replace(/\s*[；;]\s*/g, ' ');

  // Remove scheduled / done markers (anything else the period pass did not cover)
  for (const date of dates) {
    if (date.rawMatch && (date.type === 'scheduled' || date.type === 'done')) {
      result = result.replace(date.rawMatch, '');
    }
  }

  // Remove recurrence
  if (recurrenceRule) {
    result = result.replace(`🔁${recurrenceRule}`, '');
  }

  // Remove block link
  if (blockLink) {
    result = result.replace(`^${blockLink}`, '');
  }

  // Remove end time markers
  result = result.replace(/⏲\s?\d{1,2}:\d{2}(:\d{2})?/g, '');

  // Clean up any excess whitespace left behind by the removed markers
  result = result.replace(/\s+/g, ' ').trim();

  // A period written inside a note link ("[[note 2026-09-21 ~ ...]]") would
  // leave a stray space behind, which must not end up in the link target
  return result.replace(/\[\[([^\]]*)\]\]/g, (_full, inner: string) => `[[${inner.trim()}]]`);
}

/**
 * Parses a line for task or list item information
 *
 * @param line The text line to parse
 * @returns A ParsedLine object with all extracted information
 */
export function parseLine(line: string): ParsedLine {
  // Initialize the result object
  const result: ParsedLine = {
    originalLine: line,
    content: '',
    indentation: '',
    isTask: false,
    isListItem: false,
    listMarker: '',
    dates: [],
    ranges: [],
    hasRecurrence: false,
  };

  // Check if it's a task
  const taskMatch = line.match(PATTERNS.TASK);
  if (taskMatch) {
    result.isTask = true;
    result.isListItem = true;
    result.indentation = taskMatch[1];
    result.listMarker = taskMatch[2];
    result.statusCharacter = taskMatch[3];
    result.taskStatus = STATUS_MAPPING[taskMatch[3]] || TaskStatus.Unknown;
    result.content = taskMatch[4];
  } else {
    // Check if it's a list item
    const listMatch = line.match(PATTERNS.LIST_ITEM);
    if (listMatch) {
      result.isListItem = true;
      result.indentation = listMatch[1];
      result.listMarker = listMatch[2];
      result.content = listMatch[3];
      result.taskStatus = TaskStatus.NotATask;
    } else {
      // It's a regular line
      result.content = line;
      result.taskStatus = TaskStatus.NotATask;
    }
  }

  // Extract times
  const times = extractTimes(result.content);
  result.startTime = times.startTime;
  result.endTime = times.endTime;

  // Extract dates
  result.dates = extractDates(result.content);
  result.ranges = extractRanges(result.content);

  // Extract recurrence
  const recurrenceRule = extractRecurrence(result.content);
  result.hasRecurrence = !!recurrenceRule;
  result.recurrenceRule = recurrenceRule;

  // Extract block link
  result.blockLink = extractBlockLink(result.content);

  // Clean content by removing metadata markers
  result.content = cleanContent(result.content, result.dates, result.recurrenceRule, result.blockLink);

  return result;
}

/**
 * Checks if a line contains a token that indicates items below it should be parsed
 *
 * @param line The line to check
 * @param settings Plugin settings
 * @returns Boolean indicating if the line contains the parse below token
 */
export function lineContainsParseBelowToken(line: string, settings: BigCalendarSettings): boolean {
  if (settings.ProcessEntriesBelow === '') {
    return true;
  }

  try {
    const pattern = new RegExp(settings.ProcessEntriesBelow.replace(/([.?*+^$[\]\\(){}|-])/g, '\\$1'), '');
    return pattern.test(line);
  } catch (e) {
    console.error('Invalid regex pattern in ProcessEntriesBelow setting', e);
    return false;
  }
}

/**
 * Checks if a line contains time information or is a task
 *
 * @param line The line to check
 * @returns Boolean indicating if the line contains time information or is a task
 */
export function lineContainsTime(line: string): boolean {
  // Fresh, non-global patterns: the shared /g instances in PATTERNS keep a
  // lastIndex between calls, which made repeated .test() calls alternate.
  // Check if line contains time information, a period marker, or is a task
  return (
    /\d{1,2}:\d{2}/.test(line) ||
    /<time>\d{1,2}:\d{2}/.test(line) ||
    /⏲\s?\d{1,2}:\d{2}/.test(line) ||
    /^\s*(?:-|\*|\+|\d+\.)\s+\[.]\s+/.test(line) ||
    hasDateMarkers(line)
  );
}

/**
 * Converts a ParsedLine to an event object
 *
 * @param parsedLine The parsed line
 * @param defaultDate The default date to use if no date is found
 * @param lineIndex The index of the line in the file (for ID generation)
 * @returns An event object compatible with full calendar
 */
export function convertToEvent(
  parsedLine: ParsedLine,
  defaultDate: moment.Moment,
  lineIndex: number,
  path: string,
): Model.Event | null {
  // Determine if it's a task
  const isTask = parsedLine.isTask;

  // Check if there's time information
  let hasTimeInfo = parsedLine.startTime !== undefined;

  // Handle case where only an end time is provided (⏲)
  if (!parsedLine.startTime && parsedLine.endTime) {
    hasTimeInfo = true;
  }

  const hasRanges = parsedLine.ranges.length > 0;

  // If it's not a task and has neither time nor a period marker, skip it
  if (!isTask && !hasTimeInfo && !hasRanges) {
    return null;
  }

  // Tasks without time information are all-day items (parents stay day-granular)
  const allDay = isTask && !hasTimeInfo;

  // One period per "~START ~ END" group; fall back to the file's base date
  const baseRanges: ParsedRange[] = hasRanges
    ? parsedLine.ranges
    : [{start: defaultDate.format('YYYY-MM-DD'), end: defaultDate.format('YYYY-MM-DD')}];

  const ranges: Model.EventRange[] = baseRanges.map((range) => {
    const rangeStart = moment(range.start, 'YYYY-MM-DD').startOf('day');
    const rangeEnd = moment(range.end, 'YYYY-MM-DD').startOf('day');

    if (!hasTimeInfo) {
      return {start: rangeStart.toDate(), end: rangeEnd.toDate()};
    }

    // Timed item: keep the period's day and apply the line's start/end time
    const start = rangeStart
      .clone()
      .hour(parsedLine.startTime!.hour)
      .minute(parsedLine.startTime!.minute)
      .second(parsedLine.startTime!.second || 0);

    const end = parsedLine.endTime
      ? rangeEnd
          .clone()
          .hour(parsedLine.endTime.hour)
          .minute(parsedLine.endTime.minute)
          .second(parsedLine.endTime.second || 0)
      : start.clone().add(30, 'minutes');

    return {start: start.toDate(), end: end.toDate()};
  });

  const startDate = moment(ranges[0].start);
  const endDate = moment(ranges[0].end);

  // Generate unique ID
  const id = `${startDate.format('YYYYMMDDHHmm')}00${lineIndex}`;

  // Determine event type
  let eventType = 'default';
  if (parsedLine.isTask) {
    // Map task status to event type
    switch (parsedLine.taskStatus) {
      case TaskStatus.Todo:
        eventType = 'TASK-TODO';
        break;
      case TaskStatus.Done:
        eventType = 'TASK-DONE';
        break;
      case TaskStatus.Cancelled:
        eventType = 'TASK-CANCELLED';
        break;
      case TaskStatus.Forwarded:
        eventType = 'TASK-FORWARDED';
        break;
      case TaskStatus.Deferred:
        eventType = 'TASK-DEFERRED';
        break;
      case TaskStatus.InProgress:
        eventType = 'TASK-IN_PROGRESS';
        break;
      case TaskStatus.Question:
        eventType = 'TASK-QUESTION';
        break;
      case TaskStatus.Add:
        eventType = 'TASK-ADD';
        break;
      case TaskStatus.Reviewed:
        eventType = 'TASK-REVIEWED';
        break;
      case TaskStatus.Important:
        eventType = 'TASK-IMPORTANT';
        break;
      case TaskStatus.Info:
        eventType = 'TASK-INFO';
        break;
      case TaskStatus.Bookmark:
        eventType = 'TASK-BOOKMARK';
        break;
      case TaskStatus.Pro:
        eventType = 'TASK-PRO';
        break;
      case TaskStatus.Con:
        eventType = 'TASK-CON';
        break;
      case TaskStatus.Brainstorming:
        eventType = 'TASK-BRAINSTORMING';
        break;
      case TaskStatus.Example:
        eventType = 'TASK-EXAMPLE';
        break;
      case TaskStatus.Quote:
        eventType = 'TASK-QUOTE';
        break;
      case TaskStatus.Note:
        eventType = 'TASK-NOTE';
        break;
      case TaskStatus.Win:
        eventType = 'TASK-WIN';
        break;
      case TaskStatus.Lose:
        eventType = 'TASK-LOSE';
        break;
      default:
        eventType = 'default';
    }
  }

  // Create event object
  const event: Model.Event = {
    id,
    title: parsedLine.content,
    start: startDate.toDate(),
    end: endDate.toDate(),
    allDay,
    eventType,
    path,
    ranges,
    lineIndex,
    depth: 0,
  };

  // Add optional fields if available
  if (parsedLine.recurrenceRule) {
    event.recurrenceRule = parsedLine.recurrenceRule;
  }

  if (parsedLine.blockLink) {
    event.blockLink = parsedLine.blockLink;
  }

  return event;
}

/**
 * Gets the original task mark character based on the event type
 *
 * @param event The event object
 * @returns The mark character corresponding to the event type
 */
export function getMarkBasedOnEvent(eventType: string): string | null {
  if (!eventType || !eventType.startsWith('TASK-')) {
    return null;
  }

  const taskType = eventType.split('-')[1];

  switch (taskType) {
    case 'TODO':
      return ' ';
    case 'DONE':
      return 'x';
    case 'CANCELLED':
      return '-';
    case 'IN_PROGRESS':
      return '/';
    case 'IMPORTANT':
      return '!';
    case 'QUESTION':
      return '?';
    case 'REVIEW':
      return '>';
    case 'IDEA':
      return 'i';
    case 'PRO':
      return '+';
    case 'CON':
      return '-';
    case 'BRAINSTORMING':
      return 'b';
    case 'EXAMPLE':
      return 'e';
    case 'QUOTE':
      return 'q';
    case 'NOTE':
      return 'n';
    case 'WIN':
      return 'w';
    case 'LOSE':
      return 'l';
    default:
      return ' ';
  }
}
