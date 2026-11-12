import React from 'react';
import {moment} from 'obsidian';
import {getMarkBasedOnEvent} from '@/obComponents/parser';
import {eventService} from '@/services';
import useFileStore from '@/stores/fileStore';
import {showEventContextMenu} from './eventContextMenu';
import {Event} from 'react-big-calendar';

// Define props interface that matches react-big-calendar's expectations
interface EventProps<TEvent = Event> {
  event: TEvent & Model.Event; // Combine the Event type from react-big-calendar with our Model.Event
  title: string; // Changed from ReactNode to string to match react-big-calendar's expectations
  // Additional props that react-big-calendar might pass but we don't use
  localizer: any; // Changed from optional to required
  slotStart: Date; // Changed from optional to required
  slotEnd: Date; // Changed from optional to required
  continuesPrior: boolean;
  continuesAfter: boolean;
}

// Define a type extension for additional properties that might be present but not in the Model.Event interface
interface ExtendedEvent extends Model.Event {
  showTime?: boolean;
}

/**
 * Custom Event Component for Calendar
 *
 * Renders events with their type markers based on the EventType property
 * If EventType is not Default, it will show the corresponding marker
 */
const EventComponent: React.FC<EventProps<Event>> = ({
  event,
  title,
  continuesPrior,
  continuesAfter,
  localizer,
  slotStart,
  slotEnd,
}) => {
  // Get app instance from fileStore
  const app = useFileStore((state) => state.app);

  // Cast event to ExtendedEvent to handle additional properties
  const extendedEvent = event as ExtendedEvent;

  // Check if event has a non-default type
  const isDefaultType = !event.eventType || event.eventType === 'default';

  // Map of event types to their marker emojis
  const mark = getMarkBasedOnEvent(event.eventType);

  // Whether this task event is marked done
  const isDone = event.eventType === 'TASK-DONE';

  // Toggle the task checkbox (TASK-TODO <-> TASK-DONE), writing - [ ] <-> - [x]
  const handleToggleDone = (e: React.ChangeEvent<HTMLInputElement>) => {
    e.stopPropagation();
    const nextType = isDone ? 'TASK-TODO' : 'TASK-DONE';
    eventService
      .updateEvent(event.id, event.title, nextType, event.start, event.end)
      .catch((error) => console.error('Error toggling task state:', error));
  };

  // Handle right-click to open the shared context menu
  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    showEventContextMenu(app, event, e.nativeEvent);
  };

  // Format dates for display as the "~START ~ END" range used in notes
  const formatDateInfo = () => {
    let dateInfo = '';

    // Add start date if available
    if (event.start) {
      const startDate = new Date(event.start);
      dateInfo += ` ~${moment(startDate).format('YYYY-MM-DD')}`;
    }

    // Add end date if available and different from start date
    if (event.end) {
      const endDate = new Date(event.end);
      const startDate = new Date(event.start);

      // Only add end date if it's different from start date
      // Or if it's an all-day event that spans multiple days
      if (
        startDate.toDateString() !== endDate.toDateString() ||
        (event.allDay && endDate.getTime() - startDate.getTime() > 86400000) // More than one day
      ) {
        dateInfo += ` ~ ${moment(endDate).format('YYYY-MM-DD')}`;
      }
    }

    return dateInfo;
  };

  // Combine event title with date info for tooltip
  const getTooltipContent = () => {
    const originalTitle = typeof title === 'string' ? title : 'Event';
    const dateInfo = formatDateInfo();
    return `${originalTitle}${dateInfo}`;
  };

  // Sub-items sit indented under their parent so the hierarchy stays readable
  const depth = extendedEvent.depth ?? 0;
  const isChild = extendedEvent.isChild === true;

  // Style object for the event, can be customized based on event type
  const getEventStyle = () => {
    const baseStyle: React.CSSProperties = {
      display: 'flex',
      flexDirection: 'row',
      alignItems: 'center',
      padding: 'var(--size-2-1) var(--size-2-2)',
      paddingLeft: `calc(var(--size-2-2) + ${depth * 10}px)`,
      height: '100%',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
    };

    return baseStyle;
  };

  return (
    <div
      style={getEventStyle()}
      className={`rbc-event-content ${event.eventType || 'Default'}`}
      aria-label={getTooltipContent()}
      // Lets the view look the item up when a note link in its name is hovered
      data-event-id={event.id}
      onContextMenu={handleContextMenu}
    >
      {/* Type marker */}
      {!isDefaultType && (
        <span
          className="event-type-marker"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <input
            data-task={mark}
            checked={isDone}
            onChange={handleToggleDone}
            type="checkbox"
            className="task-list-item-checkbox"
          ></input>
        </span>
      )}

      {/* Sub-item marker, then the title */}
      {isChild && <span className="event-child-marker">↳</span>}
      <span className="event-title">{title}</span>

      {/* Time display for non-all-day events */}
      {event.allDay === false && extendedEvent.showTime !== false && (
        <span className="event-time">{moment(event.start).format('HH:mm')}</span>
      )}
    </div>
  );
};

// Memoized so re-renders triggered elsewhere (slot selection re-rendering the
// calendar, or the events array being replaced on create/edit) don't re-render
// every unchanged event - which caused a flicker. Compare by the event reference
// (preserved for unchanged events) and the displayed title.
export default React.memo(
  EventComponent,
  (prev, next) => prev.event === next.event && prev.title === next.title,
);
