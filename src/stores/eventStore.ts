import utils from '@/utils/utils';
import {create} from 'zustand';

/**
 * Value signature of an event, used to detect real changes between renders.
 * Includes the periods, the nesting metadata and the sub-items so an edit that
 * only touches a child (or the completion state) still reaches the views.
 */
const eventSignature = (event: Model.Event): string => {
  if (!event) return '';

  const ranges = (event.ranges ?? [])
    .map((range) => `${new Date(range.start).getTime()}-${new Date(range.end).getTime()}`)
    .join(',');
  const children = (event.children ?? [])
    .map(
      (child) =>
        `${child.id}:${child.title}:${new Date(child.start).getTime()}:${new Date(child.end).getTime()}:${
          child.eventType ?? ''
        }`,
    )
    .join(',');

  return [
    event.id,
    event.title,
    new Date(event.start).getTime(),
    new Date(event.end).getTime(),
    event.eventType ?? '',
    event.allDay ? 1 : 0,
    event.isChild ? 1 : 0,
    event.depth ?? 0,
    ranges,
    children,
  ].join('|');
};

// Define the state interface
export interface EventState {
  events: Model.Event[];
  allEvents: Model.Event[]; // Store all events before filtering
  filteredEvents: Model.Event[]; // Store filtered events
  tags: string[];
  forceUpdateCounter: number; // Added to force UI updates

  // Actions
  setEvents: (events: Model.Event[]) => void;
  setFilteredEvents: (events: Model.Event[]) => void; // Set filtered events
  setTags: (tags: string[]) => void;
  insertEvent: (event: Model.Event) => void;
  deleteEventById: (id: string) => void;
  editEvent: (event: Model.Event) => void;
  updateEvent: (eventId: string, updates: Partial<Model.Event>) => void;
  setForceUpdate: () => void; // New method to force updates
}

// Create the store using Zustand
const useEventStore = create<EventState>((set, get) => ({
  events: [],
  allEvents: [], // Initialize all events array
  filteredEvents: [], // Initialize filtered events array
  tags: [],
  forceUpdateCounter: 0,

  // Actions
  setEvents: (events) => {
    // First check if the events array actually changed
    const currentEvents = get().events;

    // Process and sort events
    const processedEvents = utils.dedupeObjectWithId(
      events.sort((a, b) => utils.getTimeStampByDate(b.start) - utils.getTimeStampByDate(a.start)),
    );

    // If the arrays are the same reference, do nothing
    if (events === currentEvents) {
      return;
    }

    // If lengths are different, definitely set new events
    if (events.length !== currentEvents.length) {
      set({
        events: processedEvents,
        allEvents: processedEvents, // Keep all events in sync
      });
      return;
    }

    // Check if any events have changed. The signature also covers the fields a
    // plain id/start/end/title check misses: the checkbox state (eventType), the
    // periods of an item and its sub-items.
    const hasChanged = events.some((event, index) => eventSignature(event) !== eventSignature(currentEvents[index]));

    // Only update if something changed
    if (hasChanged) {
      set({
        events: processedEvents,
        allEvents: processedEvents, // Keep all events in sync
      });
    }
  },

  setFilteredEvents: (events) => {
    // Process and sort filtered events
    const processedEvents = utils.dedupeObjectWithId(
      events.sort((a, b) => utils.getTimeStampByDate(b.start) - utils.getTimeStampByDate(a.start)),
    );

    set({
      events: processedEvents, // Update the main events array with filtered events
      filteredEvents: processedEvents, // Store filtered events
    });
  },

  setTags: (tags) => set({tags}),

  insertEvent: (event) => {
    // Get current events
    const currentEvents = get().events;
    const allEvents = get().allEvents;

    // Check if event already exists
    const eventExists = currentEvents.some((e) => e.id === event.id);
    const eventExistsInAll = allEvents.some((e) => e.id === event.id);

    // Only insert if event doesn't exist
    if (!eventExists || !eventExistsInAll) {
      set((state) => ({
        events: utils.dedupeObjectWithId([event, ...state.events]),
        allEvents: utils.dedupeObjectWithId([event, ...state.allEvents]),
      }));
    }
  },

  deleteEventById: (id) =>
    set((state) => ({
      events: state.events.filter((event) => event.id !== id),
      allEvents: state.allEvents.filter((event) => event.id !== id),
    })),

  editEvent: (updatedEvent) =>
    set((state) => {
      // Find the event to update
      const eventIndex = state.events.findIndex((event) => event.id === updatedEvent.id);
      const allEventIndex = state.allEvents.findIndex((event) => event.id === updatedEvent.id);

      // If event not found, return state unchanged
      if (eventIndex === -1 && allEventIndex === -1) {
        return state;
      }

      // Create updated event arrays
      const newEvents = [...state.events];
      const newAllEvents = [...state.allEvents];

      // Update in current events if found
      if (eventIndex !== -1) {
        newEvents[eventIndex] = {...newEvents[eventIndex], ...updatedEvent};
      }

      // Update in all events if found
      if (allEventIndex !== -1) {
        newAllEvents[allEventIndex] = {...newAllEvents[allEventIndex], ...updatedEvent};
      }

      return {
        events: newEvents,
        allEvents: newAllEvents,
      };
    }),

  updateEvent: (eventId, updates) => {
    // Get current events and all events
    const events = get().events;
    const allEvents = get().allEvents;

    // Find the event to update
    const eventIndex = events.findIndex((event) => event.id === eventId);
    const allEventIndex = allEvents.findIndex((event) => event.id === eventId);

    // If event not found in both arrays, do nothing
    if (eventIndex === -1 && allEventIndex === -1) {
      return;
    }

    // Create updated arrays
    const updatedEvents = [...events];
    const updatedAllEvents = [...allEvents];

    // Update in current events if found
    if (eventIndex !== -1) {
      updatedEvents[eventIndex] = {
        ...updatedEvents[eventIndex],
        ...updates,
      };
    }

    // Update in all events if found
    if (allEventIndex !== -1) {
      updatedAllEvents[allEventIndex] = {
        ...updatedAllEvents[allEventIndex],
        ...updates,
      };
    }

    set({
      events: updatedEvents,
      allEvents: updatedAllEvents,
    });
  },

  // New method to force component updates by incrementing a counter
  setForceUpdate: () => {
    set((state) => ({
      forceUpdateCounter: state.forceUpdateCounter + 1,
    }));
  },
}));

export default useEventStore;
