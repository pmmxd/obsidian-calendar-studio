import useEventStore from '@/stores/eventStore';
import {
  createEventItem,
  deleteEventItem,
  reparentEventItem,
  saveEventItem,
  EventItemInput,
} from '@/obComponents/eventWriter';
import {changeEvent} from '@/obComponents/updateEvent';
import {stringOrDate} from 'react-big-calendar';
import {deleteForever} from '@/obComponents/deleteEvent';
import fileService from '@/services/fileService';
import {parseEventInfoFromLine, lineContainsEvent} from '@/utils/fileParser';
import {App, TFile, moment} from 'obsidian';
import {getEvents, getEventsFromDailyNote} from '@/obComponents/getEvents';
import {hideEvent} from '@/obComponents/hideEvent';
import {baseEventId, eventRanges} from '@/utils/eventOccurrences';
import {isAllDaySpan} from '@/utils/eventSpan';

/**
 * Event Service - Handles creation, updating, deletion and querying of calendar events
 */
class EventService {
  public initialized = false;
  private fileEventMap: Map<string, Model.Event[]> = new Map(); // Map to store events by file path
  // Paths we just wrote ourselves; the file watcher should skip the refetch for
  // these (the store was already updated optimistically) to avoid a double render.
  private selfWritePaths: Set<string> = new Set();

  /**
   * Get the current state of the event store
   */
  public getState() {
    return useEventStore.getState();
  }

  /**
   * Mark a file path as just written by us so the next watcher 'modify' event
   * for it is ignored (consumed once).
   */
  public markSelfWrite(path?: string) {
    if (!path) return;
    this.selfWritePaths.add(path);
    window.setTimeout(() => this.selfWritePaths.delete(path), 2000);
  }

  /**
   * Returns true (and consumes the flag) if the path was just written by us.
   */
  public isSelfWrite(path: string): boolean {
    if (this.selfWritePaths.has(path)) {
      this.selfWritePaths.delete(path);
      return true;
    }
    return false;
  }

  /**
   * Fetch all events and update the store
   * @returns Array of all events
   */
  public async fetchAllEvents(app: App) {
    try {
      const data = await getEvents(app);
      const events = Array.isArray(data) ? [...data] : [];

      // Clear all file-event mapping and rebuild
      this.fileEventMap.clear();

      // Group events by file
      events.forEach((event) => {
        // Assuming eventId contains file path or can be mapped to a file
        const file = fileService.getFile(event);
        if (file) {
          const filePath = file.path;
          if (!this.fileEventMap.has(filePath)) {
            this.fileEventMap.set(filePath, []);
          }
          this.fileEventMap.get(filePath)?.push(event);
        }
      });

      // Update the store with all events
      useEventStore.getState().setEvents(events);

      if (!this.initialized) {
        this.initialized = true;
      }

      return events;
    } catch (error) {
      console.error('Failed to fetch events:', error);
      return [];
    }
  }

  /**
   * Filter events
   * /

  /**
   * Filter events based on filter criteria
   * @param filterCriteria Optional filter criteria object
   * @returns Array of filtered events
   */
  public filterEvents(filterCriteria?: Model.EventFilter) {
    try {
      // Get all events from the store
      const allEvents = useEventStore.getState().allEvents;

      // If no filter criteria or empty filter, return all events
      if (!filterCriteria || Object.keys(filterCriteria).length === 0) {
        useEventStore.getState().setFilteredEvents(allEvents);
        return allEvents;
      }

      // Apply filters
      let filteredEvents = [...allEvents];

      console.log('filterCriteria', filterCriteria);

      // Filter by event type if specified
      if (filterCriteria.eventType) {
        filteredEvents = filteredEvents.filter((event) => event.eventType === filterCriteria.eventType);
      }

      // Filter by content text if specified
      if (filterCriteria.contentText) {
        const searchText = filterCriteria.contentText.toLowerCase();
        filteredEvents = filteredEvents.filter((event) => event.title.toLowerCase().includes(searchText));
      }

      // Filter by content regex if specified
      if (filterCriteria.contentRegex) {
        try {
          const regex = new RegExp(filterCriteria.contentRegex);
          filteredEvents = filteredEvents.filter((event) => regex.test(event.title));
        } catch (error) {
          console.error('Invalid regex pattern:', filterCriteria.contentRegex);
        }
      }

      // Filter by folder paths if specified
      if (filterCriteria.folderPaths && filterCriteria.folderPaths.length > 0) {
        filteredEvents = filteredEvents.filter((event) => {
          if (!event.path) return false;
          return filterCriteria.folderPaths.some((folderPath) => event.path.startsWith(folderPath));
        });
      }

      // Filter by date range if specified
      if (filterCriteria.startDate && filterCriteria.endDate) {
        const startTimestamp = new Date(filterCriteria.startDate).getTime();
        const endTimestamp = new Date(filterCriteria.endDate).getTime();

        filteredEvents = filteredEvents.filter((event) => {
          const eventStartTime = new Date(event.start).getTime();
          return eventStartTime >= startTimestamp && eventStartTime <= endTimestamp;
        });
      } else if (filterCriteria.startDate) {
        // Filter by start date only
        const startTimestamp = new Date(filterCriteria.startDate).getTime();
        filteredEvents = filteredEvents.filter((event) => new Date(event.start).getTime() >= startTimestamp);
      } else if (filterCriteria.endDate) {
        // Filter by end date only
        const endTimestamp = new Date(filterCriteria.endDate).getTime();
        filteredEvents = filteredEvents.filter((event) => new Date(event.start).getTime() <= endTimestamp);
      }

      // Update the store with filtered events
      useEventStore.getState().setFilteredEvents(filteredEvents);

      return filteredEvents;
    } catch (error) {
      console.error('Failed to filter events:', error);
      return useEventStore.getState().allEvents;
    }
  }

  /**
   * Add a new event to the store
   * @param event Event object to add
   * @returns The added event
   */
  public pushEvent(event: Model.Event) {
    useEventStore.getState().insertEvent({...event});
    return event;
  }

  /**
   * Find an event by ID
   * @param id Event ID
   * @returns Found event or undefined
   */
  public getEventById(id: string) {
    const {events} = this.getState();
    const baseId = baseEventId({id});
    return events.find((item) => item.id === baseId) ?? events.find((item) => item.id === id);
  }

  /**
   * Hide an event (remove from view but keep in delete file)
   * @param id ID of the event to hide
   * @returns Whether operation was successful
   */
  public async hideEventById(id: string) {
    useEventStore.getState().deleteEventById(id);

    try {
      await hideEvent(id);
      return true;
    } catch (err) {
      console.error('Failed to hide event:', err);
      return false;
    }
  }

  /**
   * Permanently delete an event
   * @param id ID of the event to delete
   * @returns Whether operation was successful
   */
  public async deleteEventById(id: string) {
    // Capture the event before removing it from the store so we can locate its block
    const event = this.getEventById(id);
    if (!event) {
      useEventStore.getState().deleteEventById(id);
      return false;
    }

    try {
      const app = fileService.getState().app;
      const file = await deleteEventItem(app, event);
      // Re-read the note so the record and its sub-items leave the store together
      if (file) {
        this.markSelfWrite(file.path);
        await this.fetchEventsFromFile(app, file);
      } else {
        this.clearEventFromStore(event);
      }
      return true;
    } catch (err) {
      console.error('Failed to delete event:', err);
      return false;
    }
  }

  /** Drops a record (and its sub-items) from the store without touching the note. */
  private clearEventFromStore(event: Model.Event) {
    const store = useEventStore.getState();
    store.deleteEventById(event.id);
    for (const child of event.children ?? []) {
      store.deleteEventById(child.id);
    }
  }

  /** Re-reads the given notes so the store reflects what was just written. */
  private async refreshFiles(files: TFile[]): Promise<void> {
    const app = fileService.getState().app;
    if (!app) return;
    for (const file of files) {
      this.markSelfWrite(file.path);
      await this.fetchEventsFromFile(app, file);
    }
  }

  /**
   * Turns an event into its note representation. `overrides` lets a caller move
   * a single period of the item without losing the others.
   */
  private toItemInput(
    event: Model.Event,
    titleOverride?: string,
    rangeOverride?: {index: number; start?: Date; end?: Date},
    extraChildren: EventItemInput[] = [],
  ): EventItemInput {
    const ranges = eventRanges(event);

    if (rangeOverride && (rangeOverride.start || rangeOverride.end)) {
      while (ranges.length <= rangeOverride.index) {
        ranges.push({start: new Date(event.start), end: new Date(event.end)});
      }
      ranges[rangeOverride.index] = {
        start: rangeOverride.start ?? ranges[rangeOverride.index].start,
        end: rangeOverride.end ?? ranges[rangeOverride.index].end,
      };
    }

    return {
      title: titleOverride ?? event.title,
      eventType: event.eventType || 'default',
      ranges,
      allDay: event.allDay,
      // Sub-items keep their nesting level so an edit never detaches them
      depth: event.depth ?? 0,
      children: [...(event.children ?? []).map((child) => this.toItemInput(child)), ...extraChildren],
    };
  }

  /**
   * Moves every period of an item by the given number of days, keeping its
   * sub-items and the periods' lengths. Used when dragging an item to another
   * day in a day-grid view.
   */
  public async shiftEvent(event: Model.Event, days: number): Promise<boolean> {
    if (!days) return false;

    try {
      const base = this.getEventById(event.id) ?? event;
      const input = this.toItemInput(base);
      input.ranges = input.ranges.map((range) => ({
        start: moment(range.start).add(days, 'day').toDate(),
        end: moment(range.end).add(days, 'day').toDate(),
      }));

      const app = fileService.getState().app;
      const result = await saveEventItem(app, base, input);
      await this.refreshFiles(result.files);
      return true;
    } catch (error) {
      console.error('Failed to move event:', error);
      return false;
    }
  }

  /**
   * Appends a period to an item, keeping the periods it already covers and all
   * of its sub-items. Used by the Gantt view to give an item several periods.
   */
  public async addEventPeriod(event: Model.Event, range: Model.EventRange): Promise<boolean> {
    try {
      const base = this.getEventById(event.id) ?? event;
      const input = this.toItemInput(base);
      input.ranges = [...input.ranges, {start: new Date(range.start), end: new Date(range.end)}];

      const app = fileService.getState().app;
      const result = await saveEventItem(app, base, input);
      await this.refreshFiles(result.files);
      return true;
    } catch (error) {
      console.error('Failed to add period:', error);
      return false;
    }
  }

  /**
   * Persists an item edited in the UI (title, type, periods and sub-items).
   */
  public async saveEventStructure(event: Model.Event, input: EventItemInput): Promise<boolean> {
    try {
      const app = fileService.getState().app;
      const base = this.getEventById(event.id) ?? event;
      const result = await saveEventItem(app, base, input);
      await this.refreshFiles(result.files);
      return true;
    } catch (error) {
      console.error('Failed to save event:', error);
      return false;
    }
  }

  /**
   * Saves an edited item and moves it to `newParent` (or to the top level when
   * null), so a sub-item can be re-attached to another parent item.
   */
  public async reparentEventStructure(
    event: Model.Event,
    input: EventItemInput,
    newParent: Model.Event | null,
  ): Promise<boolean> {
    try {
      const app = fileService.getState().app;
      const base = this.getEventById(event.id) ?? event;
      const result = await reparentEventItem(app, base, newParent, input);
      await this.refreshFiles(result.files);
      return true;
    } catch (error) {
      console.error('Failed to move event to another parent:', error);
      return false;
    }
  }

  /**
   * Creates an item (with its sub-items) and refreshes the affected note.
   */
  public async createEventStructure(input: EventItemInput, anchor?: Date): Promise<boolean> {
    try {
      const app = fileService.getState().app;
      const result = await createEventItem(app, input, anchor ? moment(anchor) : undefined);
      await this.refreshFiles(result.files);
      return true;
    } catch (error) {
      console.error('Failed to create event:', error);
      return false;
    }
  }

  /**
   * Edit an event
   * @param event Event object to edit
   * @param startDate New start date
   * @param endDate New end date
   * @returns Updated event or null
   */
  public async editEvent(event: Model.Event, startDate: stringOrDate, endDate: stringOrDate, newTitle?: string) {
    try {
      if (!startDate || !endDate || !event?.id) {
        return event;
      }

      // Occurrences carry "baseId::index"; the note line belongs to the record.
      const base = this.getEventById(event.id) ?? event;

      // The caller may already carry edits (rename, type change) that have not
      // reached the store yet - keep them while taking the note position from
      // the record.
      const merged: Model.Event = {
        ...base,
        title: event.title || base.title,
        eventType: event.eventType || base.eventType,
      };

      const rangeIndex = event.rangeIndex ?? 0;

      const input = this.toItemInput(merged, newTitle, {
        index: rangeIndex,
        start: new Date(startDate as unknown as string),
        end: new Date(endDate as unknown as string),
      });

      const app = fileService.getState().app;
      const result = await saveEventItem(app, base, input);
      await this.refreshFiles(result.files);

      return this.getEventById(base.id) ?? base;
    } catch (err) {
      console.error('Failed to edit event:', err);
      return null;
    }
  }

  /**
   * Clear all events
   */
  public clearEvents() {
    useEventStore.getState().setEvents([]);
    this.fileEventMap.clear();
  }

  /**
   * Clear events for a specific file
   * @param filePath Path of the file
   */
  public clearEventsForFile(filePath: string) {
    // If we don't have this file in our map, nothing to do
    if (!this.fileEventMap.has(filePath)) {
      return;
    }

    // Get all events from the store
    const currentEvents = [...this.getState().events];

    // Get events to remove (from the file)
    const eventsToRemove = this.fileEventMap.get(filePath) || [];

    // Filter out events from the specific file
    const remainingEvents = currentEvents.filter((event) => !eventsToRemove.some((e) => e.id === event.id));

    // Update the store with remaining events
    useEventStore.getState().setEvents(remainingEvents);

    // Remove file entry from the map
    this.fileEventMap.delete(filePath);
  }

  /**
   * Fetch events from a specific file and update the store
   * @param app Obsidian App instance
   * @param file TFile to fetch events from
   * @returns Array of events from the file
   */
  public async fetchEventsFromFile(app: App, file: TFile): Promise<Model.Event[]> {
    try {
      // Get events specific to this file
      const newEvents: Model.Event[] = [];
      await getEventsFromDailyNote(file, newEvents);

      if (!Array.isArray(newEvents)) {
        return [];
      }

      // The freshly parsed events are always used: keeping a previous object
      // around would hide edits that do not touch its title or end date (the
      // completion state, the periods, the sub-items).
      const updatedFileEvents: Model.Event[] = [...newEvents];

      // Update the file-event map
      this.fileEventMap.set(file.path, updatedFileEvents);

      // Get all current events that are NOT from this file path
      const currentEvents = this.getState().events.filter((event) => event.path !== file.path);

      // Combine with updated events from this file
      const updatedEvents = [...currentEvents, ...updatedFileEvents];

      // Update the store
      useEventStore.getState().setEvents(updatedEvents);

      if (!this.initialized) {
        this.initialized = true;
      }

      return updatedFileEvents;
    } catch (error) {
      console.error(`Failed to fetch events from file ${file.path}:`, error);
      return [];
    }
  }

  /**
   * Create a new event
   * @param text Event content
   * @param startDate Start date
   * @param endDate End date
   * @returns Created event object
   */
  public async createEvent(
    text: string,
    startDate: stringOrDate,
    endDate: stringOrDate,
    options: {children?: EventItemInput[]; parent?: Model.Event} = {},
  ): Promise<Model.Event> {
    const start = moment(new Date(startDate as unknown as string));
    const end = moment(new Date(endDate as unknown as string));

    // A day-granular span is written without any time prefix
    const allDay = isAllDaySpan(start.toDate(), end.toDate());

    const input: EventItemInput = {
      title: text,
      // Every item is a task so it renders with a checkbox in the views
      eventType: 'TASK-TODO',
      ranges: [{start: start.toDate(), end: end.toDate()}],
      allDay,
      children: options.children ?? [],
    };

    // Sub-items always live indented under their parent
    if (options.parent) {
      const parentInput = this.toItemInput(options.parent, options.parent.title, undefined, [input]);
      await this.saveEventStructure(options.parent, parentInput);
      return this.getEventById(options.parent.id) ?? null;
    }

    await this.createEventStructure(input, start.toDate());

    // The record id is derived from the line position, so look the fresh record
    // up in the store that the refresh just rebuilt.
    return (
      this.getState().events.find(
        (item) => item.title === input.title && moment(item.start).isSame(start, 'day') && !item.isChild,
      ) ?? null
    );
  }

  /**
   * Update an event
   * @param eventId Event ID
   * @param originalText Original text
   * @param text New text
   * @param type Event type
   * @param startDate Start date
   * @param endDate End date
   * @param originalEndDate Original end date
   * @returns Updated event or null
   */
  public async updateEvent(
    eventId: string,
    text: string,
    type: string,
    startDate: stringOrDate,
    endDate: stringOrDate,
  ): Promise<Model.Event> {
    const event = this.getEventById(eventId);
    if (!event) {
      return null;
    }

    // "base::2" targets the second period of the item; keep it so only that
    // period is rewritten.
    const rangeIndex = eventId.includes('::') ? Number(eventId.split('::')[1]) : 0;

    return await this.editEvent(
      {
        ...event,
        baseId: event.id,
        rangeIndex: Number.isFinite(rangeIndex) ? rangeIndex : 0,
        title: text,
        eventType: type,
      },
      startDate,
      endDate,
    );
  }

  /**
   * Parse an event from a text line
   * @param line Text line to parse
   * @returns Partial event object or null
   */
  public parseEventFromLine(line: string): Partial<Model.Event> | null {
    if (!lineContainsEvent(line)) {
      return null;
    }

    const eventInfo = parseEventInfoFromLine(line);
    if (!eventInfo.hasEvent) {
      return null;
    }

    // Clean the line to extract just the content without time information
    let title = line.trim();

    // Remove time patterns
    title = title.replace(/^- \d{1,2}:\d{2}(-\d{1,2}:\d{2})?\s+/, '- ');
    title = title.replace(/⏲\s?\d{1,2}:\d{2}/g, '').trim();
    title = title.replace(/~\s?\d{4}-\d{2}-\d{2}/g, '').trim();

    const result: Partial<Model.Event> = {
      title: title,
    };

    // Add date information if available
    if (eventInfo.date?.hasDate && eventInfo.date.rawDate) {
      const dateStr = eventInfo.date.rawDate;
      result.start = new Date(dateStr);
      result.end = new Date(dateStr);
    }

    // Add time information if available
    if (eventInfo.time) {
      const {hour, minute} = eventInfo.time;

      if (result.start) {
        result.start.setHours(hour, minute, 0, 0);
      }

      if (result.end) {
        // Default end time is 1 hour after start
        result.end.setHours(hour + 1, minute, 0, 0);
      }
    }

    return result;
  }

  /**
   * Update an event in a file
   * @param eventId Event ID
   * @param content New content
   * @param eventType Event type
   * @param eventStartDate Start date
   * @param eventEndDate End date
   * @param originalEndDate Original end date
   * @returns Updated event
   */
  public async updateEventInFile(
    eventId: string,
    content: string,
    eventType: string,
    eventStartDate: stringOrDate,
    eventEndDate: stringOrDate,
    originalEndDate: Date,
    originalPath: string,
  ): Promise<Model.Event> {
    return await changeEvent(
      eventId,
      '', // originalContent
      content,
      eventType,
      eventStartDate,
      eventEndDate,
      originalEndDate,
      originalPath,
    );
  }

  /**
   * Create an event in a file
   * @param content Event content
   * @param date Event date
   * @returns Event ID
   */
  public async createEventInFile(content: string, date: Date): Promise<string> {
    const start = moment(date).startOf('day').toDate();
    const end = moment(date).endOf('day').toDate();
    const created = await this.createEvent(content, start, end);
    return created?.id ?? '';
  }

  /**
   * Delete an event from a file
   * @param eventId Event ID
   */
  public async deleteEventFromFile(eventId: string): Promise<void> {
    await deleteForever(eventId);
  }

  /**
   * Get the file associated with an event
   * @param eventId Event ID
   * @returns File object or null
   */
  public getEventFile(event: Model.Event): TFile | null {
    return fileService.getFile(event);
  }
}

const eventService = new EventService();
export default eventService;
