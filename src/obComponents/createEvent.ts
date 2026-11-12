import {moment} from 'obsidian';
import {stringOrDate} from 'react-big-calendar';
import {getAllLinesFromFile, safeExecute} from '@/api';
import fileService from '@/services/fileService';
import {globalService} from '@/services';
import {formatEventLine, findInsertPosition} from './updateEvent';
import {convertToEvent, parseLine} from './parser';
import {
  ensureMonthlyDateMarkers,
  getOrCreateNoteForDate,
  insertLineUnderDateHeading,
  isMonthlyMode,
  monthlyGroupByDate,
} from './noteResolver';

interface MContent {
  content: string;
  posNum?: number;
}

// https://stackoverflow.com/questions/3115150/how-to-escape-regular-expression-special-characters-using-javascript
export function escapeRegExp(text: string): string {
  return text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
}

//credit to chhoumann, original code from: https://github.com/chhoumann/quickadd/blob/7536a120701a626ef010db567cea7cf3018e6c82/src/utility.ts#L130
export function getLinesInString(input: string): string[] {
  const lines: string[] = [];
  let tempString = input;

  while (tempString.contains('\n')) {
    const lineEndIndex = tempString.indexOf('\n');
    lines.push(tempString.slice(0, lineEndIndex));
    tempString = tempString.slice(lineEndIndex + 1);
  }

  if (tempString.length > 0) lines.push(tempString);

  return lines;
}

export async function waitForInsert(
  EventContent: string,
  startDate: stringOrDate,
  endDate: stringOrDate,
): Promise<Model.Event> {
  return await safeExecute(async () => {
    const app = fileService.getState().app;
    const settings = globalService.getState().pluginSetting;

    // Format the date
    const startMoment = startDate instanceof Date ? moment(startDate) : moment(startDate as string);
    const endMoment = endDate instanceof Date ? moment(endDate) : moment(endDate as string);

    // Create events as to-do tasks so they render with a "- [ ]" checkbox and
    // can be toggled complete from the calendar views.
    const eventType = 'TASK-TODO';

    // Format the content based on event type
    let formattedContent = formatEventLine(EventContent, startMoment, endMoment, eventType);

    // In monthly mode the day must be embedded in the line so it can be read back
    if (isMonthlyMode()) {
      formattedContent = ensureMonthlyDateMarkers(formattedContent, startMoment, endMoment);
    }

    // Get or create the note and insert the event
    const result = await insertEventIntoNote(app, startMoment, formattedContent, settings.InsertAfter, eventType);
    const parsedLine = parseLine(formattedContent);

    // Convert to event - tasks without time info will be treated as all-day events
    const event = convertToEvent(parsedLine, startMoment, result.lineNum, result.file.path);
    // Create and return the event object
    return event;
  }, 'Failed to create event');
}

/**
 * Computes the new file content (as lines) with the event inserted, and the
 * line number it was inserted at.
 *
 * When an "insert after" heading is configured, the event is placed after that
 * heading's section. If the heading is missing, it is created at the end of the
 * file so the event always lands under the configured heading (never line 0).
 * When no heading is configured, falls back to findInsertPosition (shared with
 * the edit path) which also never inserts at line 0.
 */
function buildContentWithEvent(
  fileLines: string[],
  text: string,
  insertAfter: string,
  eventType: string,
  day: moment.Moment,
): {lines: string[]; lineNum: number} {
  // A freshly created empty note reads back as a single empty line
  const result = fileLines.length === 1 && fileLines[0] === '' ? [] : [...fileLines];

  // Monthly mode with date grouping: insert under the "## YYYY-MM-DD" heading
  if (monthlyGroupByDate()) {
    const lines = insertLineUnderDateHeading(result, text, day);
    return {lines, lineNum: lines.indexOf(text)};
  }

  // Monthly mode without grouping: append at the end of the file
  if (isMonthlyMode()) {
    const pos = result.length;
    result.push(text);
    return {lines: result, lineNum: pos};
  }

  const useHeading = insertAfter && insertAfter.trim() !== '';

  if (useHeading) {
    let headingIndex = result.findIndex((l) => l.includes(insertAfter));
    if (headingIndex === -1) {
      // Heading missing: create it at the end of the file
      if (result.length && result[result.length - 1].trim() !== '') result.push('');
      result.push(insertAfter);
      headingIndex = result.length - 1;
    }
    // Insert after the last content line within this heading's section,
    // so events accumulate in order under the heading
    let pos = headingIndex + 1;
    for (let i = headingIndex + 1; i < result.length; i++) {
      if (/^#{1,6}\s/.test(result[i])) break; // next heading ends the section
      if (result[i].trim() !== '') pos = i + 1;
    }
    result.splice(pos, 0, text);
    return {lines: result, lineNum: pos};
  }

  // No heading configured: reuse the edit path's logic (never inserts at line 0)
  const pos = findInsertPosition(result, eventType);
  result.splice(pos, 0, text);
  return {lines: result, lineNum: pos};
}

/**
 * Inserts event into a daily note
 */
async function insertEventIntoNote(
  app: any,
  startMoment: moment.Moment,
  formattedContent: string,
  insertAfterSetting: string,
  eventType: string,
): Promise<{file: any; lineNum: number}> {
  const file = await getOrCreateNoteForDate(app, startMoment);

  const fileContents = await app.vault.read(file);
  const fileLines = getAllLinesFromFile(fileContents);

  const {lines, lineNum} = buildContentWithEvent(fileLines, formattedContent, insertAfterSetting, eventType, startMoment);
  await app.vault.modify(file, lines.join('\n'));

  return {file, lineNum};
}

/**
 * Creates an event object from the given parameters
 */
function createEventObject(
  eventContent: string,
  startMoment: moment.Moment,
  endMoment: moment.Moment,
  startTimeHour: string,
  startTimeMinute: string,
  endDate: stringOrDate,
  isMultiDayEvent: boolean,
  file: any,
  lineNum: number,
): Model.Event {
  const eventId = startMoment.format('YYYYMMDDHHmmss') + lineNum;

  return {
    id: eventId,
    title: eventContent,
    start: new Date(
      startMoment.year(),
      startMoment.month(),
      startMoment.date(),
      parseInt(startTimeHour),
      parseInt(startTimeMinute),
    ),
    end: endDate
      ? new Date(endDate as any)
      : new Date(
          startMoment.year(),
          startMoment.month(),
          startMoment.date(),
          parseInt(startTimeHour) + 1,
          parseInt(startTimeMinute),
        ),
    allDay: isMultiDayEvent,
    eventType: isMultiDayEvent ? 'TASK-TODO' : 'default',
    path: file.path,
  };
}

//credit to chhoumann, original code from: https://github.com/chhoumann/quickadd
export async function insertAfterHandler(
  targetString: string,
  formatted: string,
  fileContent: string,
): Promise<MContent> {
  return await safeExecute(async () => {
    const lines = getLinesInString(fileContent);
    let found = false;
    let pos = 0;

    // Find the position to insert after
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Look for heading content
      if (line.contains(targetString)) {
        found = true;
        pos = i;
        break;
      }
    }

    // If target string not found, insert at the beginning
    if (!found) {
      return {
        content: formatted + '\n' + fileContent,
        posNum: 0,
      };
    }

    // Insert after the found position
    return await insertTextAfterPositionInBody(formatted, fileContent, pos, found);
  }, 'Failed to insert after handler');
}

export async function insertTextAfterPositionInBody(
  text: string,
  body: string,
  pos: number,
  found?: boolean,
): Promise<MContent> {
  return await safeExecute(async () => {
    const lines = getLinesInString(body);

    if (found) {
      // Insert after the specified position
      const targetPosition = pos + 1;
      lines.splice(targetPosition, 0, text);
      return {
        content: lines.join('\n'),
        posNum: targetPosition,
      };
    } else {
      // Insert at the beginning if position not found
      lines.splice(0, 0, text);
      return {
        content: lines.join('\n'),
        posNum: 0,
      };
    }
  }, 'Failed to insert text after position');
}
