import React, {forwardRef, useCallback, useEffect, useMemo, memo, useState} from 'react';
import '@/less/Calendar.less';
import '@/less/time-select.less';
import '@/less/event-styles.less';
import '@/less/modal.less';
import '@/less/gantt.less';
import '@/less/biweek.less';
import {Calendar, Event, momentLocalizer, SlotInfo, View} from 'react-big-calendar';
import {moment} from 'obsidian';
import withDragAndDrop, {withDragAndDropProps} from 'react-big-calendar/lib/addons/dragAndDrop';
import dailyNotesService from '@/services/fileService';
import eventService from '@/services/eventService';
import useFileStore from '@/stores/fileStore';
import useCalendarStore from '@/stores/calendarStore';
import EventCreatePrompt, {EventCreateResult} from '@/obComponents/EventCreatePrompt';
import {ParentPickerModal} from '@/obComponents/ParentPickerModal';
import {expandEventOccurrences} from '@/utils/eventOccurrences';
import {isAllDaySpan} from '@/utils/eventSpan';
import {useEvents} from '@/hooks/useStore';
import useEventStore from '@/stores/eventStore';
import useGlobalStateStore from '@/stores/globalStateStore';
import locationService from '@/services/locationService';
// Import our custom toolbar
import CustomToolbar from './CustomToolbar';
// Import our custom event component
import EventComponent from './EventComponent';
import {openEventEditModal} from './EventEditModal';
// Import our filter component
import FilterComponent from './FilterComponent';
// Import our custom Agenda, Gantt and Bi-week views
import AgendaView from './views/AgendaView';
import GanttView from './views/GanttView';
import BiWeekView from './views/BiWeekView';
import {useView} from '@/hooks/useView';
import {t} from '@/translations/helper';
import {DEFAULT_WEEK_END_HOUR, DEFAULT_WEEK_START_HOUR, MAX_WEEK_END_HOUR} from '@/constants';

export interface EventRefActions {
  updateEvents: (events: Model.Event[]) => void;
}

interface CalendarProps {
  selectable: boolean;
  resizeable: boolean;
  defaultView: View;
  StartDate: string;
  popup: boolean;
  onEventDoubleClick: (event: Event) => void;
  onEventSelect: (event: EventCreateResult, slotInfo: SlotInfo) => void;
}

// Create a memoized DragAndDropCalendar component
const DragAndDropCalendar = memo(withDragAndDrop(Calendar as any));

// eslint-disable-next-line react/display-name
const CalendarComponent = forwardRef((props: CalendarProps, ref: React.ForwardedRef<EventRefActions>) => {
  const {
    selectable,
    resizeable,
    defaultView,
    StartDate,
    popup,
    onEventDoubleClick: handleDoubleClickEventCallback,
    onEventSelect: handleEventSelectCallback,
  } = props;

  // State to manage loading state when filters change
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // Get app from fileStore
  const app = useFileStore((state) => state.app);

  const events = useEvents();
  // Items covering several periods are expanded into one occurrence per period
  const displayEvents = useMemo(() => expandEventOccurrences(events), [events]);
  // Get state and actions from the calendar store
  const {
    calendarView,
    calendarDate,
    selectable: select,
    resizable: resize,
    calendarPopup,
    setCalendarView,
    setCalendarDate,
    setSelectable,
    setResizable,
    setCalendarPopup,
    setStartDay,
    setLoading,
    loadStoredPreferences,
    saveCalendarView,
    saveCalendarDate,
  } = useCalendarStore();

  // Week/day time grid range from the plugin settings. Subscribe to the raw values
  // (not the settings object) - the settings object is mutated in place, so only
  // primitive selectors can detect a change.
  const weekStartHour = useGlobalStateStore((state) => state.pluginSetting?.WeekStartHour ?? DEFAULT_WEEK_START_HOUR);
  const weekEndHour = useGlobalStateStore((state) => state.pluginSetting?.WeekEndHour ?? DEFAULT_WEEK_END_HOUR);

  // Create a memoized localizer
  const localizer = useMemo(() => momentLocalizer(moment), []);

  // Visible time window of the week/day (time grid) views, e.g. 09:00 - 21:00.
  // Only the time part is used - react-big-calendar merges it onto each column's date.
  const timeGridRange = useMemo(() => {
    const startHour = Math.min(MAX_WEEK_END_HOUR - 1, Math.max(0, Math.round(weekStartHour)));
    const clampedEnd = Math.min(MAX_WEEK_END_HOUR, Math.max(1, Math.round(weekEndHour)));
    const endHour = clampedEnd > startHour ? clampedEnd : Math.min(MAX_WEEK_END_HOUR, startHour + 1);

    const day = moment().startOf('day');
    const min = day.clone().hour(startHour).minute(0).second(0).millisecond(0).toDate();
    // 24:00 belongs to the next day, so roll the date over instead of using hour 24.
    const max =
      endHour === MAX_WEEK_END_HOUR
        ? day.clone().add(1, 'day').startOf('day').toDate()
        : day.clone().hour(endHour).minute(0).second(0).millisecond(0).toDate();

    return {min, max};
  }, [weekStartHour, weekEndHour]);

  // Load events when the component mounts or when the app changes
  useEffect(() => {
    const fetchEvents = async () => {
      if (app) {
        setIsLoading(true);
        try {
          // Fetch all events
          await eventService.fetchAllEvents(app);

          // Apply current filters after loading events
          const query = locationService.getState().query;
          if (query) {
            const filterCriteria: Model.EventFilter = {
              eventType: query.eventType || undefined,
              contentRegex: query.contentRegex || undefined,
              folderPaths: query.folderPaths?.length > 0 ? query.folderPaths : undefined,
              // Add any other filter criteria from query
              contentText: query.text || '',
            };

            // Apply filtering
            eventService.filterEvents(filterCriteria);
          }
        } catch (error) {
          console.error('Error loading events:', error);
        } finally {
          setIsLoading(false);
        }
      }
    };

    fetchEvents();
  }, [app]);

  // Initialize the component - Only run once when app is available
  useEffect(() => {
    if (!app) return;

    // Use a timeout to defer these operations, breaking potential circular dependencies
    const timeoutId = setTimeout(() => {
      // Load stored preferences
      loadStoredPreferences(app);

      // Set initial values from props if they don't match stored values
      if (defaultView && defaultView !== calendarView) {
        setCalendarView(defaultView);
      }

      if (selectable !== select) {
        setSelectable(selectable);
      }

      if (resizeable !== resize) {
        setResizable(resizeable);
      }

      if (popup !== calendarPopup) {
        setCalendarPopup(popup);
      }

      // Set start day and update moment locale
      setStartDay(StartDate === 'sunday' ? 'sunday' : 'monday');

      // Mark loading as complete
      setLoading(false);
    }, 0);

    return () => clearTimeout(timeoutId);
  }, [
    app,
    defaultView,
    calendarView,
    selectable,
    select,
    resizeable,
    resize,
    popup,
    calendarPopup,
    StartDate,
    loadStoredPreferences,
    setCalendarView,
    setSelectable,
    setResizable,
    setCalendarPopup,
    setStartDay,
    setLoading,
  ]);

  // Handle filter changes - reload events only if metadata filters change
  const handleFilterChange = useCallback(
    async (filterType: 'metadata' | 'client') => {
      if (!app) return;

      // Only reload data from files if metadata filters have changed
      if (filterType === 'metadata') {
        setIsRefreshing(true);
        try {
          await eventService.fetchAllEvents(app);

          // After fetching all events, apply filters
          const query = locationService.getState().query;
          const filterCriteria: Model.EventFilter = {
            eventType: query.eventType || undefined,
            contentRegex: query.contentRegex || undefined,
            folderPaths: query.folderPaths?.length > 0 ? query.folderPaths : undefined,
            contentText: query.text || '',
          };

          // Apply filtering
          eventService.filterEvents(filterCriteria);
        } catch (error) {
          console.error('Error refreshing events:', error);
        } finally {
          setIsRefreshing(false);
        }
      } else {
        // For client-side filtering, just apply filters to existing events
        const query = locationService.getState().query;
        const filterCriteria: Model.EventFilter = {
          eventType: query.eventType || undefined,
          contentRegex: query.contentRegex || undefined,
          folderPaths: query.folderPaths?.length > 0 ? query.folderPaths : undefined,
          contentText: query.text || '',
        };

        // Apply filtering
        eventService.filterEvents(filterCriteria);

        // Trigger re-render
        useEventStore.getState().setForceUpdate();
      }
    },
    [app],
  );

  // Style events based on their type
  const styleEvents = useCallback((event: any) => {
    const className = event.eventType;
    return {className: className};
  }, []);

  // Gray out weekend days (applies to month day cells, and week/day headers + columns)
  const dayPropGetter = useCallback((date: Date) => {
    const day = date.getDay();
    if (day === 0 || day === 6) {
      return {className: 'rbc-weekend'};
    }
    return {};
  }, []);

  // Handle double click on events
  const handleDoubleClickEvent = useCallback(
    (event: Event) => {
      handleDoubleClickEventCallback(event);
    },
    [handleDoubleClickEventCallback],
  );

  // Handle event selection (dragging an empty slot). Items carrying a specific
  // time are sub-items, so the parent is chosen before the name is entered.
  const handleEventSelect = useCallback(
    async (slotInfo: SlotInfo) => {
      const {app} = dailyNotesService.getState();

      const start = moment(slotInfo.start);
      const end = moment(slotInfo.end);
      const isTimed = !(start.hour() === 0 && start.minute() === 0 && end.hour() === 0 && end.minute() === 0);

      let parent: Model.Event | null = null;
      if (isTimed && ParentPickerModal.hasCandidates()) {
        parent = await ParentPickerModal.pick(app);
        // Dismissed without picking a parent: nothing is created
        if (!parent) return;
      }

      try {
        const addEvent = await EventCreatePrompt.Prompt(
          app,
          t('Add event'),
          '',
          '',
          slotInfo.start as Date,
          slotInfo.end as Date,
          parent,
        );

        addEvent.parent = parent ?? undefined;
        handleEventSelectCallback(addEvent, slotInfo);
      } catch (error) {
        // Prompt cancelled
      }
    },
    [handleEventSelectCallback],
  );

  // Single click on an event opens the edit dialog (title, periods, sub-items)
  const handleEventClick = useCallback(
    (event: Event) => {
      if (!app) return;
      openEventEditModal(app, event as Model.Event);
    },
    [app],
  );

  // Handle view changes
  const handleViewChange = useCallback(
    (view: View) => {
      if (calendarView !== view) {
        setCalendarView(view);
        // Save the view change to storage
        if (app) {
          setTimeout(() => {
            saveCalendarView(app);
          }, 0);
        }
      }
    },
    [calendarView, setCalendarView, app, saveCalendarView],
  );

  // Handle navigation (date changes)
  const handleNavigate = useCallback(
    (date: Date) => {
      if (calendarDate !== date) {
        setCalendarDate(date);

        // Save the date change to storage
        if (app) {
          setTimeout(() => {
            saveCalendarDate(app);
          }, 0);
        }
      }
    },
    [calendarDate, setCalendarDate, app, saveCalendarDate],
  );

  // Handle event resize - Memoize the implementation
  const onEventResize = useCallback<withDragAndDropProps['onEventResize']>((data) => {
    const {event, start, end} = data;

    eventService
      .editEvent(event as Model.Event, start, end)
      .then((updatedEvent) => {
        if (updatedEvent) {
          console.log('Event resized successfully:', updatedEvent.id);
        } else {
          console.error('Failed to resize event');
        }
      })
      .catch((error) => {
        console.error('Error resizing event:', error);
      });
  }, []);

  // Handle event drop - Memoize the implementation
  const onEventDrop = useCallback<withDragAndDropProps['onEventDrop']>((data) => {
    const {event, start, end} = data;

    eventService
      .editEvent(event as Model.Event, start, end)
      .then((updatedEvent) => {
        if (updatedEvent) {
          console.log('Event updated successfully:', updatedEvent.id);
        } else {
          console.error('Failed to update event');
        }
      })
      .catch((error) => {
        console.error('Error updating event:', error);
      });
  }, []);

  // Memoize calendar props to prevent unnecessary re-renders
  const calendarProps = useMemo(() => {
    return {
      selectable: select,
      localizer: localizer,
      resizable: resize,
      defaultView: calendarView,
      defaultDate: calendarDate,
      date: calendarDate,
      view: calendarView,
      eventPropGetter: styleEvents,
      dayPropGetter: dayPropGetter,
      popup: calendarPopup,
      // An item may cover several periods; react-big-calendar draws one span per
      // event, so each record is expanded into one occurrence per period.
      events: displayEvents,
      onSelectEvent: handleEventClick,
      min: timeGridRange.min,
      max: timeGridRange.max,
      onEventDrop: onEventDrop,
      onEventResize: onEventResize,
      titleAccessor: (event: any) => {
        // Remove time patterns from the title for display
        const title = event.title as string;
        const cleanedTitle = title
          .replace(/\d{1,2}:\d{2}(-\d{1,2}:\d{2})?/g, '') // Remove time ranges like 10:00-11:00
          .replace(/⏲\s?\d{1,2}:\d{2}/g, '') // Remove end time emoji patterns
          .replace(/~\s?\d{4}-\d{2}-\d{2}/g, '') // Remove "~" date patterns
          .trim();

        // Return original title if cleaned version is empty
        return cleanedTitle || title;
      },
      tooltipAccessor: (event: any) => event.title as string,
      onView: handleViewChange,
      onNavigate: handleNavigate,
      onDoubleClickEvent: handleDoubleClickEvent,
      onSelectSlot: handleEventSelect,
      // Register built-in views plus our custom Agenda, Gantt and Bi-week views
      views: {month: true, week: true, day: true, agenda: AgendaView, gantt: GanttView, biweek: BiWeekView},
      // Add custom components configuration
      components: {
        toolbar: CustomToolbar,
        event: EventComponent,
      },
    };
  }, [
    select,
    localizer,
    displayEvents,
    calendarDate,
    resize,
    calendarView,
    styleEvents,
    dayPropGetter,
    calendarPopup,
    timeGridRange,
    onEventDrop,
    onEventResize,
    handleViewChange,
    handleNavigate,
    handleDoubleClickEvent,
    handleEventSelect,
    handleEventClick,
  ]);

  return (
    <div className="calendar-container">
      <div className="calendar-filters">
        <FilterComponent onFilterChange={handleFilterChange} />
        {(isRefreshing || isLoading) && (
          <div className="filter-refreshing">{isLoading ? 'Loading events...' : 'Refreshing events...'}</div>
        )}
      </div>
      <DragAndDropCalendar {...calendarProps} />
    </div>
  );
});

export default memo(CalendarComponent);
