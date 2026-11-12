import React from 'react';
import {moment} from 'obsidian';
import {NavigateAction} from 'react-big-calendar';
import useCalendarStore from '@/stores/calendarStore';
import useFileStore from '@/stores/fileStore';
import {eventService} from '@/services';
import {getMarkBasedOnEvent} from '@/obComponents/parser';
import {t} from '@/translations/helper';
import {showEventContextMenu} from '../eventContextMenu';
import {createEventWithPrompt} from './createFlow';
import {agendaRange, getWindow, navigateRange, rangeTitle, currentRange, recordIntersects} from './dateRange';
import {eventRanges, groupOccurrences} from '@/utils/eventOccurrences';

interface AgendaViewProps {
  date: Date;
  events: Model.Event[];
  // eslint-disable-next-line
  onSelectEvent?: (event: Model.Event, e: React.SyntheticEvent) => void;
  // eslint-disable-next-line
  onDoubleClickEvent?: (event: Model.Event, e: React.SyntheticEvent) => void;
}

/** "2026-06-12 ~ 2026-06-13；2026-06-14 ~ 2026-06-16" (times kept for timed items). */
function formatPeriods(event: Model.Event): string {
  return eventRanges(event)
    .map((range) => {
      const start = moment(range.start);
      const end = moment(range.end);
      const startDay = start.format('YYYY-MM-DD');
      const endDay = end.format('YYYY-MM-DD');

      if (event.allDay) {
        return startDay === endDay ? startDay : `${startDay} ~ ${endDay}`;
      }

      const time = `${start.format('HH:mm')}-${end.format('HH:mm')}`;
      return startDay === endDay ? `${startDay} ${time}` : `${startDay} ${time} ~ ${endDay} ${end.format('HH:mm')}`;
    })
    .join('；');
}

/**
 * Custom Agenda view: lists items intersecting the active window
 * (本月 / 本周 / 上周 / 30天), each item once with every period it covers.
 * Sub-items are listed directly under their parent, indented.
 */
function AgendaView(props: AgendaViewProps): React.ReactElement {
  const {date, events, onSelectEvent, onDoubleClickEvent} = props;
  // Subscribe so the view re-renders when the range tab is toggled
  const listRange = useCalendarStore((state) => state.listRange);
  const app = useFileStore((state) => state.app);

  // The range tab may have been set in a view that offers more windows
  const win = getWindow(date, agendaRange(listRange));

  // One row per item (an item with several periods stays a single row) and its
  // sub-items directly beneath it.
  const records = groupOccurrences(events || []).filter((record) => recordIntersects(record, win));
  const byId = new Map(records.map((record) => [record.id, record]));

  const roots = records
    .filter((record) => !record.parentId || !byId.has(record.parentId))
    .sort((a, b) => new Date(b.start).getTime() - new Date(a.start).getTime());

  const rows: Model.Event[] = [];
  const placed = new Set<string>();

  const pushWithChildren = (record: Model.Event) => {
    if (placed.has(record.id)) return;
    placed.add(record.id);
    rows.push(record);

    (record.children ?? [])
      .map((child) => byId.get(child.id))
      .filter((child): child is Model.Event => !!child)
      .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())
      .forEach((child) => pushWithChildren(child));
  };

  roots.forEach(pushWithChildren);
  records.forEach(pushWithChildren);

  // Create a new item, pre-filled with an all-day range for today
  const handleAddEvent = async () => {
    if (!app) return;
    const start = moment().startOf('day').toDate();
    const end = moment().endOf('day').toDate();
    await createEventWithPrompt(app, start, end);
  };

  // Toggle a task event between TASK-TODO and TASK-DONE, syncing to the note
  const handleToggleDone = (event: Model.Event, e: React.ChangeEvent<HTMLInputElement>) => {
    e.stopPropagation();
    const nextType = event.eventType === 'TASK-DONE' ? 'TASK-TODO' : 'TASK-DONE';
    eventService
      .updateEvent(event.id, event.title, nextType, event.start, event.end)
      .catch((error) => console.error('Error toggling task state:', error));
  };

  // Right-click a row to get the same menu as in the calendar views (edit / duplicate / type / delete)
  const handleContextMenu = (e: React.MouseEvent, event: Model.Event) => {
    e.preventDefault();
    showEventContextMenu(app, event, e.nativeEvent);
  };

  return (
    <div className="bc-agenda">
      <div className="bc-agenda-toolbar">
        <button type="button" className="bc-agenda-add" onClick={handleAddEvent}>
          + {t('Add event')}
        </button>
      </div>

      {rows.length === 0 ? (
        <div className="bc-agenda-empty">{t('No events in this range')}</div>
      ) : (
        <table className="bc-agenda-table">
          <thead>
            <tr>
              <th className="bc-agenda-check-col" />
              <th className="bc-agenda-date-col">{t('Date')}</th>
              <th className="bc-agenda-title-col">{t('Event')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((event) => {
              const isTask = (event.eventType || '').startsWith('TASK-');
              const isDone = event.eventType === 'TASK-DONE';
              const depth = event.depth ?? 0;
              return (
                <tr
                  key={event.id}
                  className={`bc-agenda-row ${event.eventType || 'default'} ${isDone ? 'is-done' : ''} ${
                    event.isChild ? 'is-child' : ''
                  }`}
                  data-event-id={event.id}
                  onClick={(e) => onSelectEvent && onSelectEvent(event, e)}
                  onDoubleClick={(e) => onDoubleClickEvent && onDoubleClickEvent(event, e)}
                  onContextMenu={(e) => handleContextMenu(e, event)}
                >
                  <td className="bc-agenda-check-col" onClick={(e) => e.stopPropagation()}>
                    {isTask && (
                      <input
                        type="checkbox"
                        className="task-list-item-checkbox"
                        data-task={getMarkBasedOnEvent(event.eventType)}
                        checked={isDone}
                        onChange={(e) => handleToggleDone(event, e)}
                      />
                    )}
                  </td>
                  <td className="bc-agenda-date-col">{formatPeriods(event)}</td>
                  <td className="bc-agenda-title-col" style={{paddingLeft: 8 + depth * 20}}>
                    {event.title}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

// react-big-calendar custom-view statics
const AgendaViewWithStatics = AgendaView as typeof AgendaView & {
  range: (date: Date) => Date[];
  navigate: (date: Date, action: NavigateAction) => Date;
  title: (date: Date) => string;
};
AgendaViewWithStatics.range = (date: Date): Date[] => [date];
AgendaViewWithStatics.navigate = (date: Date, action: NavigateAction): Date =>
  navigateRange(date, action, agendaRange(currentRange()));
AgendaViewWithStatics.title = (date: Date): string => rangeTitle(date, agendaRange(currentRange()));

export default AgendaViewWithStatics;
