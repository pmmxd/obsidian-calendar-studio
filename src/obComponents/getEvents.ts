import {TFolder, TFile, Notice, App} from 'obsidian';
import {getDailyNoteSettings} from 'obsidian-daily-notes-interface';
import {getAllLinesFromFile} from '@/utils/fileParser';
import {fileService, globalService, locationService} from '@/services';
import {BigCalendarSettings} from '@/setting';
import {t} from '@/translations/helper';
import {parseLine, lineContainsParseBelowToken, lineContainsTime, convertToEvent} from './parser';
import {indentationWidth} from './eventLine';
import {getAllCalendarFiles, getFileBaseDate, isMonthlyMode} from './noteResolver';

export class DailyNotesFolderMissingError extends Error {}

export async function getRemainingEvents(note: TFile): Promise<number> {
  return await safeExecute(async () => {
    if (!note) {
      return 0;
    }

    const {vault} = fileService.getState().app;
    const settings = globalService.getState().pluginSetting;
    const fileContents = await vault.read(note);
    const fileLines = getAllLinesFromFile(fileContents);

    // Find the parse below token
    const processHeaderIndex = fileLines.findIndex((line) => lineContainsParseBelowToken(line, settings));

    // If the token is not found, return 0
    if (processHeaderIndex === -1) {
      return 0;
    }

    // Count lines with time information
    let count = 0;
    for (let i = processHeaderIndex === 0 ? 0 : processHeaderIndex + 1; i < fileLines.length; i++) {
      const line = fileLines[i];
      // Stop counting if we hit a new heading
      if (/^#{1,} /g.test(line) && !(settings.ProcessEntriesBelow.trim() === '')) {
        break;
      }

      if (lineContainsTime(line)) {
        count++;
      }
    }

    return count;
  }, 'Failed to get remaining events');
}

export async function getEventsFromDailyNote(
  dailyNote: TFile | null,
  dailyEvents: Model.Event[],
): Promise<Model.Event[]> {
  return await safeExecute(async () => {
    if (!dailyNote) {
      return [];
    }

    const {vault} = fileService.getState().app;
    const settings = globalService.getState().pluginSetting;
    const eventCount = await getRemainingEvents(dailyNote);

    if (!eventCount) {
      return [];
    }

    const fileContents = await vault.read(dailyNote);
    const fileLines = getAllLinesFromFile(fileContents);
    const startDate = getFileBaseDate(dailyNote);
    const result: Model.Event[] = [];

    // Find the parse below token
    const processHeaderIndex = fileLines.findIndex((line) => lineContainsParseBelowToken(line, settings));

    // If the token is not found, return empty array
    if (processHeaderIndex === -1) {
      return [];
    }

    // Process lines after the parse below token
    let currentIndex = processHeaderIndex === 0 ? 0 : processHeaderIndex + 1;

    // Open ancestors ordered by indentation, used to attach sub-items to the
    // item they are indented under.
    const stack: Model.Event[] = [];

    while (currentIndex < fileLines.length) {
      const line = fileLines[currentIndex];

      // Stop processing if we hit a new heading
      if (/^#{1,} /g.test(line) && !(settings.ProcessEntriesBelow.trim() === '')) {
        break;
      }

      // Parse the line
      const parsedLine = parseLine(line);

      // Check if line has time information or is a task
      if (lineContainsTime(line)) {
        // Convert to event - tasks without time info will be treated as all-day events
        const event = convertToEvent(parsedLine, startDate, currentIndex, dailyNote.path);

        if (event) {
          // Attach the item to the nearest ancestor with a shallower indentation
          const ownWidth = indentationWidth(parsedLine.indentation || '');
          while (stack.length > 0 && stack[stack.length - 1].indentationWidth! >= ownWidth) {
            stack.pop();
          }

          const parent = stack[stack.length - 1];
          if (parent) {
            event.isChild = true;
            event.parentId = parent.id;
            event.depth = (parent.depth ?? 0) + 1;
            if (!parent.children) parent.children = [];
            parent.children.push(event);
          } else {
            event.isChild = false;
            event.depth = 0;
          }

          event.indentationWidth = ownWidth;
          stack.push(event);

          result.push(event);
          if (dailyEvents) {
            dailyEvents.push(event);
          }
        }
      }

      currentIndex++;
    }

    return result;
  }, 'Failed to get events from daily note');
}

// Function to check if the file metadata matches the filter criteria
async function fileHasMatchingMetadata(
  file: TFile,
  metadataKeys: string[],
  metadataValues: Record<string, string>,
): Promise<boolean> {
  try {
    // Get file metadata
    const app = fileService.getState().app;
    // @ts-ignore - Access to Obsidian's internal API
    const fileCache = app.metadataCache.getFileCache(file);

    if (!fileCache || !fileCache.frontmatter) {
      return false;
    }

    const frontmatter = fileCache.frontmatter;

    // Check if all required metadata keys exist
    if (metadataKeys.length > 0) {
      const hasMissingKey = metadataKeys.some((key) => !Object.prototype.hasOwnProperty.call(frontmatter, key));
      if (hasMissingKey) {
        return false;
      }
    }

    // Check if all metadata key-value pairs match
    if (Object.keys(metadataValues).length > 0) {
      for (const [key, value] of Object.entries(metadataValues)) {
        if (frontmatter[key] !== value) {
          return false;
        }
      }
    }

    return true;
  } catch (error) {
    console.error('Error checking file metadata:', error);
    return false;
  }
}

// Check if the event matches the filter criteria
export function eventMatchesFilter(event: Model.Event, filter: Query): boolean {
  // Filter by event type
  if (filter.eventType && event.eventType !== filter.eventType) {
    return false;
  }

  // Filter by content regex
  if (filter.contentRegex) {
    try {
      const regex = new RegExp(filter.contentRegex);
      if (!regex.test(event.title)) {
        return false;
      }
    } catch (error) {
      console.error('Invalid regex pattern:', filter.contentRegex);
      // Invalid regex - we'll skip this filter
    }
  }

  // Filter by folder paths (if event has a path property)
  if (filter.folderPaths && filter.folderPaths.length > 0 && event.path) {
    const matchesAnyFolder = filter.folderPaths.some((folderPath) => event.path!.startsWith(folderPath));
    if (!matchesAnyFolder) {
      return false;
    }
  }

  return true;
}

export async function getEvents(app: App): Promise<Model.Event[]> {
  return await safeExecute(async () => {
    const allEvents: Model.Event[] = [];
    const filter = locationService.getState().query;

    if (!app) return [];

    if (!isMonthlyMode()) {
      const {folder} = getDailyNoteSettings();
      const dailyNotesFolder = app.vault.getFolderByPath(folder) as TFolder;
      if (!dailyNotesFolder) {
        new Notice(t('Your daily notes folder is not set correctly. Please check your settings.'));
        return [];
      }
    }

    // Get all calendar files (daily notes, or monthly YYYY-MM.md files)
    const calendarFiles = getAllCalendarFiles(app);

    // Only filter files if metadata filters are applied
    const needsMetadataFiltering =
      (filter.metadataKeys && filter.metadataKeys.length > 0) ||
      (filter.metadataValues && Object.keys(filter.metadataValues).length > 0);

    // Process each file
    for (const file of calendarFiles) {
      // Apply metadata filtering if needed
      if (needsMetadataFiltering) {
        const hasMatchingMetadata = await fileHasMatchingMetadata(
          file,
          filter.metadataKeys || [],
          filter.metadataValues || {},
        );

        if (!hasMatchingMetadata) {
          continue; // Skip this file
        }
      }

      // Get events from the file
      const events = await getEventsFromDailyNote(file, []);
      allEvents.push(...events);
    }

    return allEvents;
  }, 'Failed to get events');
}

// Import this function from elsewhere as it's not defined in the existing getEvents.ts code
async function safeExecute<T>(fn: () => Promise<T>, errorMessage: string): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    console.error(`${errorMessage}: ${error}`);
    throw error;
  }
}
