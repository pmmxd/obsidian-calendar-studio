import {App, TFile, TFolder, moment, normalizePath} from 'obsidian';
import {createDailyNote, getAllDailyNotes, getDailyNote, getDateFromFile} from 'obsidian-daily-notes-interface';
import globalService from '@/services/globalService';
import fileService from '@/services/fileService';
import {RANGE_GAP, formatPeriod} from './eventLine';

/**
 * Mode-aware note resolver.
 *
 * The plugin supports two storage modes:
 *  - 'daily'   : events live in daily notes (date comes from the filename)
 *  - 'monthly' : events live in one file per month named YYYY-MM.md inside a
 *                configured folder; events are appended at the end and each
 *                line carries its own date markers (🛫/📅) so the day is
 *                recoverable on read.
 *
 * All date->file resolution, file enumeration and file creation is funnelled
 * through here so the rest of the codebase stays mode-agnostic.
 */

const MONTHLY_FILE_RE = /^\d{4}-\d{2}\.md$/;

export function isMonthlyMode(): boolean {
  return globalService.getState().pluginSetting.CalendarMode === 'monthly';
}

/**
 * Whether monthly events should be grouped under "## YYYY-MM-DD" headings.
 * Only meaningful in monthly mode; controlled by the MonthlyGroupByDate setting.
 */
export function monthlyGroupByDate(): boolean {
  return isMonthlyMode() && globalService.getState().pluginSetting.MonthlyGroupByDate !== false;
}

const DATE_HEADING_RE = /^##\s+(\d{4}-\d{2}-\d{2})\s*$/;

/**
 * Inserts an event line under its "## YYYY-MM-DD" heading (by start date).
 * Creates the heading in date-sorted order if it does not exist yet.
 * Returns the new array of lines (input is not mutated).
 */
export function insertLineUnderDateHeading(fileLines: string[], line: string, day: moment.Moment): string[] {
  return insertLinesUnderDateHeading(fileLines, [line], day);
}

/**
 * Same as {@link insertLineUnderDateHeading} but inserts a whole block of lines
 * (an item together with its indented sub-items) as one unit.
 */
export function insertLinesUnderDateHeading(fileLines: string[], lines: string[], day: moment.Moment): string[] {
  const result = fileLines.length === 1 && fileLines[0] === '' ? [] : [...fileLines];
  const dayStr = day.format('YYYY-MM-DD');
  const headingText = `## ${dayStr}`;

  // Existing heading for this day?
  const headingIndex = result.findIndex((l) => {
    const m = DATE_HEADING_RE.exec(l);
    return m !== null && m[1] === dayStr;
  });

  if (headingIndex !== -1) {
    // Insert after the last content line within this heading's section
    let pos = headingIndex + 1;
    for (let i = headingIndex + 1; i < result.length; i++) {
      if (/^#{1,6}\s/.test(result[i])) break; // next heading ends the section
      if (result[i].trim() !== '') pos = i + 1;
    }
    result.splice(pos, 0, ...lines);
    return result;
  }

  // No heading yet: find the sorted position among existing date headings
  let insertAt = result.length;
  for (let i = 0; i < result.length; i++) {
    const m = DATE_HEADING_RE.exec(result[i]);
    if (m && m[1] > dayStr) {
      insertAt = i;
      break;
    }
  }

  const block: string[] = [];
  if (insertAt > 0 && result[insertAt - 1].trim() !== '') block.push('');
  block.push(headingText, ...lines);
  result.splice(insertAt, 0, ...block);
  return result;
}

/**
 * Removes the line at `lineIndex`; if its "## YYYY-MM-DD" section becomes empty,
 * the heading (and surrounding blank lines) is removed too.
 * Returns the new array of lines (input is not mutated).
 */
export function removeLineAndCleanHeading(fileLines: string[], lineIndex: number): string[] {
  const result = [...fileLines];
  if (lineIndex < 0 || lineIndex >= result.length) return result;
  result.splice(lineIndex, 1);

  // Find the date heading governing the removed line's position
  let headingIdx = -1;
  for (let i = Math.min(lineIndex - 1, result.length - 1); i >= 0; i--) {
    if (/^#{1,6}\s/.test(result[i])) {
      if (DATE_HEADING_RE.test(result[i])) headingIdx = i;
      break;
    }
  }
  if (headingIdx === -1) return result;

  // Does the section still have content?
  let hasContent = false;
  for (let i = headingIdx + 1; i < result.length; i++) {
    if (/^#{1,6}\s/.test(result[i])) break;
    if (result[i].trim() !== '') {
      hasContent = true;
      break;
    }
  }

  if (!hasContent) {
    let end = headingIdx + 1;
    while (end < result.length && !/^#{1,6}\s/.test(result[end]) && result[end].trim() === '') end++;
    result.splice(headingIdx, end - headingIdx);
    if (headingIdx > 0 && result[headingIdx - 1].trim() === '') {
      result.splice(headingIdx - 1, 1);
    }
  }
  return result;
}

function monthlyFolder(): string {
  return (globalService.getState().pluginSetting.MonthlyFolder || '').trim();
}

function monthlyPathForDate(date: moment.Moment): string {
  const folder = monthlyFolder();
  const name = date.format('YYYY-MM') + '.md';
  return normalizePath(folder ? `${folder}/${name}` : name);
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?/;

/**
 * Adds `tags: <tags>` to `content`'s frontmatter, or prepends a frontmatter
 * block when there is none. A template that already declares `tags` is kept
 * untouched so it never gets overwritten.
 */
function injectFrontmatterTags(content: string, tags: string): string {
  if (!tags) return content;

  const match = FRONTMATTER_RE.exec(content);
  if (!match) {
    return `---\ntags: ${tags}\n---\n${content}`;
  }
  if (/^\s*tags\s*:/m.test(match[1])) {
    return content;
  }
  return `---\n${match[1]}\ntags: ${tags}\n---\n${content.slice(match[0].length)}`;
}

/**
 * Expands the template placeholders supported in the monthly note template:
 * {{title}} (YYYY-MM), {{year}}, {{month}}, {{date}} (YYYY-MM-DD) and
 * {{date:FORMAT}} with any moment format string.
 */
function applyTemplateVariables(content: string, date: moment.Moment): string {
  return content
    .replace(/\{\{date:([^}]+)\}\}/g, (_, format) => date.format(String(format).trim()))
    .replace(/\{\{title\}\}/g, date.format('YYYY-MM'))
    .replace(/\{\{year\}\}/g, date.format('YYYY'))
    .replace(/\{\{month\}\}/g, date.format('MM'))
    .replace(/\{\{date\}\}/g, date.format('YYYY-MM-DD'));
}

/**
 * Initial content for a freshly created monthly file.
 *
 * When a template note is configured (MonthlyTemplate, a vault-relative path)
 * its content is used as the base, with the template variables expanded and the
 * MonthlyFileTags value merged into the frontmatter. Without a template only a
 * minimal `tags` frontmatter block is written.
 */
async function initialMonthlyContent(app: App, date: moment.Moment): Promise<string> {
  const settings = globalService.getState().pluginSetting;
  const tags = (settings.MonthlyFileTags || '').trim();
  const templatePath = (settings.MonthlyTemplate || '').trim();

  if (templatePath) {
    const templateFile = app.vault.getFileByPath(normalizePath(templatePath));
    if (templateFile instanceof TFile) {
      const template = await app.vault.cachedRead(templateFile);
      return applyTemplateVariables(injectFrontmatterTags(template, tags), date);
    }
  }

  return tags ? `---\ntags: ${tags}\n---\n` : '';
}

/**
 * All files the calendar should scan for events.
 */
export function getAllCalendarFiles(app: App): TFile[] {
  if (!isMonthlyMode()) {
    const notes = getAllDailyNotes();
    return Object.values(notes).filter((f): f is TFile => f instanceof TFile);
  }

  const folder = app.vault.getFolderByPath(monthlyFolder() || '/') as TFolder;
  if (!folder) {
    return [];
  }
  return folder.children.filter((f): f is TFile => f instanceof TFile && MONTHLY_FILE_RE.test(f.name));
}

/**
 * The base date for a calendar file. In monthly mode this is the first day of
 * the month; the per-line 🛫/📅 markers override it during parsing.
 */
export function getFileBaseDate(file: TFile): moment.Moment {
  if (!isMonthlyMode()) {
    return getDateFromFile(file, 'day');
  }
  return moment(file.basename, 'YYYY-MM').startOf('month');
}

/**
 * Resolve the existing note for a given date (null if it doesn't exist).
 */
export function getNoteForDate(app: App, date: moment.Moment): TFile | null {
  if (!isMonthlyMode()) {
    return getDailyNote(date, getAllDailyNotes()) ?? null;
  }
  const file = app.vault.getFileByPath(monthlyPathForDate(date));
  return file instanceof TFile ? file : null;
}

/**
 * Resolve the note for a date, creating it (and its folder) if missing.
 */
export async function getOrCreateNoteForDate(app: App, date: moment.Moment): Promise<TFile> {
  if (!isMonthlyMode()) {
    return getDailyNote(date, getAllDailyNotes()) ?? (await createDailyNote(date));
  }

  const existing = getNoteForDate(app, date);
  if (existing) {
    return existing;
  }

  const folder = monthlyFolder();
  if (folder && !app.vault.getFolderByPath(folder)) {
    await app.vault.createFolder(folder);
  }
  return await app.vault.create(monthlyPathForDate(date), await initialMonthlyContent(app, date));
}

/**
 * Whether a file is one the calendar reads from (used by vault watchers).
 */
export function isCalendarFile(file: TFile): boolean {
  if (!isMonthlyMode()) {
    return !!getDateFromFile(file, 'day');
  }
  if (!MONTHLY_FILE_RE.test(file.name)) {
    return false;
  }
  const folder = monthlyFolder();
  return folder ? file.path.startsWith(folder + '/') : true;
}

/**
 * Folder where the delete.md trash file lives.
 */
export function getTrashFolderPath(): string {
  return isMonthlyMode() ? monthlyFolder() : fileService.getDailyNotePath();
}

/**
 * Normalises a formatted event line so it always carries a "~START ~ END" date
 * range (required in monthly mode so the day is recoverable on read).
 * Idempotent: strips any existing markers before re-adding canonical ones, and
 * preserves a trailing block id (^xxxx).
 */
export function ensureMonthlyDateMarkers(
  line: string,
  startMoment: moment.Moment,
  endMoment: moment.Moment,
): string {
  const blockMatch = line.match(/\s(\^[a-zA-Z0-9-]+)$/);
  const blockId = blockMatch ? blockMatch[1] : '';
  let base = blockMatch ? line.slice(0, blockMatch.index) : line;

  // Remove existing period markers - both the inline-code form and the older
  // "~START ~ END" / emoji ones
  base = base
    .replace(/\s*`?\s*~?\s?\d{4}-\d{2}-\d{2}\s*~\s?\d{4}-\d{2}-\d{2}\s*`?/g, '')
    .replace(/\s*~\s?\d{4}-\d{2}-\d{2}/g, '')
    .replace(/\s*🛫\s?\d{4}-\d{2}-\d{2}/g, '')
    .replace(/\s*(📅|📆)\s?\d{4}-\d{2}-\d{2}/g, '')
    .replace(/\s+$/, '');

  base += `${RANGE_GAP}${formatPeriod(startMoment, endMoment)}`;

  return blockId ? `${base} ${blockId}` : base;
}
