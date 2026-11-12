import {App, TFile, moment} from 'obsidian';
import {getAllLinesFromFile} from '@/utils/fileParser';
import {parseLine} from './parser';
import {formatItemLine, indentationWidth, lineIndentation} from './eventLine';
import {
  getOrCreateNoteForDate,
  insertLinesUnderDateHeading,
  monthlyGroupByDate,
} from './noteResolver';
import {findInsertPosition} from './updateEvent';

/**
 * Line-level writer for calendar items.
 *
 * An item owns a *block* in the note: its own line plus every following line
 * that is indented deeper (its sub-items). Every create / edit / delete goes
 * through here so the indentation and the multi-period syntax stay consistent.
 */

/** One item (parent or child) as edited in the UI, ready to be written. */
export interface EventItemInput {
  title: string;
  eventType: string;
  /** Every period of the item; the first one decides which note it lives in. */
  ranges: Model.EventRange[];
  /** Day-granular items are written without a time prefix. */
  allDay: boolean;
  /**
   * Nesting level of the item itself. Sub-items keep the level they were read
   * with so an edit never detaches them from their parent.
   */
  depth?: number;
  children?: EventItemInput[];
}

/** Half-open line range [start, end) owned by an item inside a note. */
export interface EventBlock {
  start: number;
  end: number;
}

const DATE_HEADING_RE = /^##\s+(\d{4}-\d{2}-\d{2})\s*$/;
const ANY_HEADING_RE = /^#{1,6}\s/;

/**
 * Serialises an item and its sub-items into the note lines they should occupy.
 *
 * `depth` defaults to the item's own level: a sub-item edited on its own must be
 * written back with its indentation, otherwise it would become a top-level item.
 */
export function buildItemLines(input: EventItemInput, depth?: number): string[] {
  const level = depth ?? input.depth ?? 0;

  const lines = [
    formatItemLine({
      title: input.title,
      eventType: input.eventType,
      ranges: input.ranges,
      allDay: input.allDay,
      depth: level,
    }),
  ];

  for (const child of input.children ?? []) {
    lines.push(...buildItemLines(child, level + 1));
  }

  return lines;
}

/**
 * Finds the line that holds an item. The recorded `lineIndex` is trusted only
 * when the line still carries the same content; otherwise the content is
 * searched for so a stale index never edits the wrong line.
 */
export function locateEventLine(lines: string[], event: Model.Event): number {
  const expected = [event.originalContent, event.title].filter((value): value is string => !!value && value !== '');

  const matches = (line: string): boolean => {
    if (!line || line.trim() === '') return false;
    const parsed = parseLine(line);
    if (!parsed.content) return false;
    return expected.some((value) => parsed.content === value.trim());
  };

  const recorded = event.lineIndex;
  if (typeof recorded === 'number' && recorded >= 0 && recorded < lines.length && matches(lines[recorded])) {
    return recorded;
  }

  for (let i = 0; i < lines.length; i++) {
    if (matches(lines[i])) return i;
  }

  // Last resort: any line mentioning the title
  for (let i = 0; i < lines.length; i++) {
    if (event.title && lines[i].includes(event.title)) return i;
  }

  return -1;
}

/**
 * The block owned by an item: its line plus the indented lines that follow.
 */
export function findEventBlock(lines: string[], event: Model.Event): EventBlock | null {
  const index = locateEventLine(lines, event);
  if (index === -1) return null;

  const own = indentationWidth(lineIndentation(lines[index]));
  let end = index + 1;
  while (end < lines.length) {
    const line = lines[end];
    if (line.trim() === '') break;
    if (indentationWidth(lineIndentation(line)) <= own) break;
    end++;
  }

  return {start: index, end};
}

/**
 * Removes a block, also dropping a "## YYYY-MM-DD" heading whose section became
 * empty (monthly grouping mode).
 */
export function removeEventBlock(fileLines: string[], block: EventBlock): string[] {
  const lines = [...fileLines];

  // The heading governing the block, looked up before the splice
  let headingIndex = -1;
  for (let i = block.start - 1; i >= 0; i--) {
    if (ANY_HEADING_RE.test(lines[i])) {
      if (DATE_HEADING_RE.test(lines[i])) headingIndex = i;
      break;
    }
  }

  lines.splice(block.start, block.end - block.start);

  if (headingIndex === -1 || !monthlyGroupByDate()) return lines;

  for (let i = headingIndex + 1; i < lines.length; i++) {
    if (ANY_HEADING_RE.test(lines[i])) break;
    if (lines[i].trim() !== '') return lines;
  }

  let end = headingIndex + 1;
  while (end < lines.length && !ANY_HEADING_RE.test(lines[end]) && lines[end].trim() === '') end++;
  const result = [...lines];
  result.splice(headingIndex, end - headingIndex);
  if (headingIndex > 0 && result[headingIndex - 1]?.trim() === '') {
    result.splice(headingIndex - 1, 1);
  }
  return result;
}

/**
 * Inserts block lines into a note: under the "## YYYY-MM-DD" heading in monthly
 * grouping mode, after the existing task block otherwise.
 */
function insertBlock(fileLines: string[], blockLines: string[], day: moment.Moment, eventType: string): string[] {
  if (monthlyGroupByDate()) {
    return insertLinesUnderDateHeading(fileLines, blockLines, day);
  }

  const lines = fileLines.length === 1 && fileLines[0] === '' ? [] : [...fileLines];
  const position = findInsertPosition(lines, eventType);
  lines.splice(position, 0, ...blockLines);
  return lines;
}

/** Files touched by a write, so the caller can refresh exactly those. */
export interface WriteResult {
  files: TFile[];
  /** The note the item now lives in. */
  target: TFile;
}

/**
 * Creates a new item (with its sub-items) in the note for its first period.
 */
export async function createEventItem(
  app: App,
  input: EventItemInput,
  anchor?: moment.Moment,
): Promise<WriteResult> {
  const day = anchor ?? moment(input.ranges[0]?.start ?? new Date());
  const target = await getOrCreateNoteForDate(app, day);
  const lines = getAllLinesFromFile(await app.vault.read(target));
  const updated = insertBlock(lines, buildItemLines(input), day, input.eventType);
  await app.vault.modify(target, updated.join('\n'));
  return {files: [target], target};
}

/**
 * Writes an edited item back to disk.
 *
 * In the common case (same note, plain daily mode) the old block is replaced in
 * place so the item keeps its position. When the item moves to another note, or
 * monthly date grouping is active, it is removed and re-inserted under the
 * right heading instead.
 */
export async function saveEventItem(
  app: App,
  existing: Model.Event | null,
  input: EventItemInput,
): Promise<WriteResult> {
  const day = moment(input.ranges[0]?.start ?? new Date());
  const oldFile = existing?.path ? app.vault.getFileByPath(existing.path) : null;

  // A sub-item always stays in the note that holds its parent, so the line it
  // is rewritten next to keeps being the parent's line.
  const target =
    oldFile instanceof TFile && existing?.isChild ? oldFile : await getOrCreateNoteForDate(app, day);

  // Keep the level the item was read with; the caller may override it explicitly
  const depth = input.depth ?? existing?.depth ?? 0;
  const blockLines = buildItemLines({...input, depth});

  const sameFile = oldFile instanceof TFile && oldFile.path === target.path;

  if (sameFile && !monthlyGroupByDate()) {
    // In-place replacement: re-read, swap the block, write once.
    const lines = getAllLinesFromFile(await app.vault.read(target));
    const block = findEventBlock(lines, existing!);
    if (block) {
      lines.splice(block.start, block.end - block.start, ...blockLines);
      await app.vault.modify(target, lines.join('\n'));
      return {files: [target], target};
    }
    const updated = insertBlock(lines, blockLines, day, input.eventType);
    await app.vault.modify(target, updated.join('\n'));
    return {files: [target], target};
  }

  const touched: TFile[] = [];

  if (oldFile instanceof TFile) {
    const oldLines = getAllLinesFromFile(await app.vault.read(oldFile));
    const block = findEventBlock(oldLines, existing!);
    if (block) {
      await app.vault.modify(oldFile, removeEventBlock(oldLines, block).join('\n'));
      touched.push(oldFile);
    }
  }

  const targetLines = getAllLinesFromFile(await app.vault.read(target));
  const updated = insertBlock(targetLines, blockLines, day, input.eventType);
  await app.vault.modify(target, updated.join('\n'));
  if (!touched.some((file) => file.path === target.path)) touched.push(target);

  return {files: touched, target};
}

/**
 * Removes an item and everything indented under it.
 */
export async function deleteEventItem(app: App, event: Model.Event): Promise<TFile | null> {
  const file = event.path ? app.vault.getFileByPath(event.path) : null;
  if (!(file instanceof TFile)) return null;

  const lines = getAllLinesFromFile(await app.vault.read(file));
  const block = findEventBlock(lines, event);
  if (!block) return null;

  await app.vault.modify(file, removeEventBlock(lines, block).join('\n'));
  return file;
}

/**
 * Moves an item to another parent, or back to the top level when `newParent` is
 * null. The item keeps its own content (see `input`), its periods and every
 * sub-item indented under it.
 *
 * The item is detached from its current note first, then re-inserted either
 * right below the new parent (so it becomes an indented sub-item of it) or as a
 * top-level item in the note for its first period.
 */
export async function reparentEventItem(
  app: App,
  event: Model.Event,
  newParent: Model.Event | null,
  input: EventItemInput,
): Promise<WriteResult> {
  const touched: TFile[] = [];

  // 1. Detach from the note the item currently lives in
  const oldFile = event.path ? app.vault.getFileByPath(event.path) : null;
  if (oldFile instanceof TFile) {
    const oldLines = getAllLinesFromFile(await app.vault.read(oldFile));
    const block = findEventBlock(oldLines, event);
    if (block) {
      await app.vault.modify(oldFile, removeEventBlock(oldLines, block).join('\n'));
      touched.push(oldFile);
    }
  }

  // 2. Back to the top level: back to the note for its first period
  if (!newParent) {
    const day = moment(input.ranges[0]?.start ?? new Date());
    const target = await getOrCreateNoteForDate(app, day);
    const lines = getAllLinesFromFile(await app.vault.read(target));
    const updated = insertBlock(lines, buildItemLines({...input, depth: 0}), day, input.eventType);
    await app.vault.modify(target, updated.join('\n'));
    if (!touched.some((file) => file.path === target.path)) touched.push(target);
    return {files: touched, target};
  }

  // 3. Attach right below the new parent so the indentation makes it a child
  const parentFile = newParent.path ? app.vault.getFileByPath(newParent.path) : null;
  if (!(parentFile instanceof TFile)) {
    return {files: touched, target: oldFile instanceof TFile ? oldFile : parentFile};
  }

  const depth = (newParent.depth ?? 0) + 1;
  const blockLines = buildItemLines({...input, depth});

  const parentLines = getAllLinesFromFile(await app.vault.read(parentFile));
  const parentBlock = findEventBlock(parentLines, newParent);
  parentLines.splice(parentBlock ? parentBlock.end : parentLines.length, 0, ...blockLines);
  await app.vault.modify(parentFile, parentLines.join('\n'));

  if (!touched.some((file) => file.path === parentFile.path)) touched.push(parentFile);

  return {files: touched, target: parentFile};
}
