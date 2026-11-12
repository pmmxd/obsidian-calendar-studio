import React, {useEffect, useRef, useState} from 'react';
import {moment} from 'obsidian';
import {NavigateAction} from 'react-big-calendar';
import useCalendarStore from '@/stores/calendarStore';
import useFileStore from '@/stores/fileStore';
import {eventService} from '@/services';
import {getMarkBasedOnEvent} from '@/obComponents/parser';
import {t} from '@/translations/helper';
import {showEventContextMenu} from '../eventContextMenu';
import {createEventWithPrompt} from './createFlow';
import {getWindow, navigateRange, rangeTitle, currentRange, recordIntersects, ganttRange} from './dateRange';
import {eventRanges, groupOccurrences} from '@/utils/eventOccurrences';

interface GanttViewProps {
  date: Date;
  events: Model.Event[];
  // eslint-disable-next-line
  onSelectEvent?: (event: Model.Event, e: React.SyntheticEvent) => void;
  // eslint-disable-next-line
  onDoubleClickEvent?: (event: Model.Event, e: React.SyntheticEvent) => void;
}

type DragMode = 'move' | 'resize-start' | 'resize-end';
interface DragState {
  eventId: string;
  /** Which period of the item is being dragged. */
  rangeIndex: number;
  mode: DragMode;
  startClientX: number;
  origStartIdx: number;
  origEndIdx: number;
  startIdx: number;
  endIdx: number;
}

/** A period being drawn on an item's row by dragging the empty track. */
interface CreateState {
  eventId: string;
  /** Left edge of the row's track in viewport coordinates. */
  trackLeft: number;
  startIdx: number;
  endIdx: number;
  /** Day-granular items keep their granularity for the new period. */
  allDay: boolean;
}

const NAME_W = 220;
/** Narrowest day column; a short window (a week) stretches it for readability. */
const MIN_DAY_W = 28;

/**
 * Monthly Gantt view: item names on the left, a day grid for the active window
 * on the right (本月 / 最近一个月). An item covering several periods gets one bar
 * per period; bars can be dragged (move) or resized from either edge.
 * Sub-items are listed indented under their parent; weekends are shaded.
 */
function GanttView(props: GanttViewProps): React.ReactElement {
  const {date, events, onSelectEvent, onDoubleClickEvent} = props;
  const listRange = useCalendarStore((state) => state.listRange);
  const app = useFileStore((state) => state.app);

  // Week ranges (本周/上周) only filter the Agenda; the Gantt stays on its month window.
  const win = getWindow(date, ganttRange(listRange));
  const todayStr = moment().format('YYYY-MM-DD');

  // Days in the window
  const days: moment.Moment[] = [];
  for (let d = win.start.clone(); d.isSameOrBefore(win.end, 'day'); d.add(1, 'day')) {
    days.push(d.clone());
  }
  const N = days.length;
  // A week-wide window gets wider columns so the bars stay readable
  const dayWidth = Math.max(MIN_DAY_W, Math.min(80, Math.floor(760 / Math.max(1, N))));
  const trackWidth = N * dayWidth;
  const winStartDay = win.start.clone().startOf('day');

  // One row per item; sub-items follow their parent
  const records = groupOccurrences(events || []).filter((record) => recordIntersects(record, win));
  const byId = new Map(records.map((record) => [record.id, record]));
  const roots = records
    .filter((record) => !record.parentId || !byId.has(record.parentId))
    .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());

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

  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  dragRef.current = drag;
  // A drag ends with a click on the bar; that click must not open the edit dialog
  const suppressClickRef = useRef(false);

  // Clamp a date to a day index within the window
  const idxOf = (value: Date | moment.Moment): number => {
    const diff = moment(value).startOf('day').diff(winStartDay, 'days');
    return Math.max(0, Math.min(diff, N - 1));
  };

  const beginDrag = (e: React.MouseEvent, event: Model.Event, mode: DragMode, rangeIndex: number) => {
    // Only the left button drags - the right button opens the context menu instead
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();

    const ranges = eventRanges(event);
    const range = ranges[rangeIndex] ?? ranges[0];
    const s = idxOf(range.start);
    const en = idxOf(range.end || range.start);
    setDrag({eventId: event.id, rangeIndex, mode, startClientX: e.clientX, origStartIdx: s, origEndIdx: en, startIdx: s, endIdx: en});
  };

  useEffect(() => {
    if (!drag) return;

    const onMove = (e: MouseEvent) => {
      const cur = dragRef.current;
      if (!cur) return;
      const delta = Math.round((e.clientX - cur.startClientX) / dayWidth);
      let s = cur.origStartIdx;
      let en = cur.origEndIdx;
      if (cur.mode === 'move') {
        s += delta;
        en += delta;
      } else if (cur.mode === 'resize-start') {
        s += delta;
      } else {
        en += delta;
      }
      s = Math.max(0, Math.min(s, N - 1));
      en = Math.max(0, Math.min(en, N - 1));
      if (s > en) {
        if (cur.mode === 'resize-start') s = en;
        else en = s;
      }
      setDrag((d) => (d ? {...d, startIdx: s, endIdx: en} : d));
    };

    const onUp = () => {
      const cur = dragRef.current;
      if (cur && (cur.startIdx !== cur.origStartIdx || cur.endIdx !== cur.origEndIdx)) {
        // Swallow the click that follows a real drag
        suppressClickRef.current = true;
        window.setTimeout(() => {
          suppressClickRef.current = false;
        }, 250);

        const ev = records.find((r) => r.id === cur.eventId);
        if (ev) {
          const ranges = eventRanges(ev);
          const orig = ranges[cur.rangeIndex] ?? ranges[0];
          const origStart = moment(orig.start);
          const origEnd = moment(orig.end || orig.start);
          const newStart = winStartDay
            .clone()
            .add(cur.startIdx, 'day')
            .hour(origStart.hour())
            .minute(origStart.minute())
            .second(0);
          const newEnd = winStartDay
            .clone()
            .add(cur.endIdx, 'day')
            .hour(origEnd.hour())
            .minute(origEnd.minute())
            .second(0);

          // Only the dragged period moves; the other periods of the item stay put
          eventService
            .editEvent({...ev, rangeIndex: cur.rangeIndex, baseId: ev.id}, newStart.toDate(), newEnd.toDate())
            .catch((error) => {
              console.error('Error updating event from gantt:', error);
            });
        }
      }
      setDrag(null);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag?.eventId, drag?.mode, drag?.rangeIndex, dayWidth]);

  // ---- Drawing a new period on an item's row ----
  const [creating, setCreating] = useState<CreateState | null>(null);
  const creatingRef = useRef<CreateState | null>(null);
  creatingRef.current = creating;

  const beginCreate = (e: React.MouseEvent<HTMLDivElement>, event: Model.Event) => {
    if (e.button !== 0) return;
    // Bars handle their own dragging; only the empty track creates a period
    if ((e.target as HTMLElement).closest('.bc-gantt-bar')) return;

    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const index = Math.max(0, Math.min(Math.floor((e.clientX - rect.left) / dayWidth), N - 1));
    setCreating({eventId: event.id, trackLeft: rect.left, startIdx: index, endIdx: index, allDay: event.allDay});
  };

  useEffect(() => {
    if (!creating) return;

    const onMove = (e: MouseEvent) => {
      const cur = creatingRef.current;
      if (!cur) return;
      const index = Math.max(0, Math.min(Math.floor((e.clientX - cur.trackLeft) / dayWidth), N - 1));
      setCreating((state) => (state ? {...state, endIdx: index} : state));
    };

    const onUp = () => {
      const cur = creatingRef.current;
      if (cur) {
        const ev = records.find((record) => record.id === cur.eventId);
        if (ev) {
          const from = Math.min(cur.startIdx, cur.endIdx);
          const to = Math.max(cur.startIdx, cur.endIdx);
          const startDay = winStartDay.clone().add(from, 'day').startOf('day');
          const endDay = winStartDay.clone().add(to, 'day').startOf('day');

          // A day-granular item stays day-granular; a timed one keeps its clock
          const existingRange = eventRanges(ev)[0];
          const range = cur.allDay
            ? {start: startDay.toDate(), end: endDay.toDate()}
            : {
                start: startDay
                  .clone()
                  .hour(moment(existingRange.start).hour())
                  .minute(moment(existingRange.start).minute())
                  .toDate(),
                end: endDay
                  .clone()
                  .hour(moment(existingRange.end).hour())
                  .minute(moment(existingRange.end).minute())
                  .toDate(),
              };

          eventService.addEventPeriod(ev, range).catch((error) => {
            console.error('Error adding period from gantt:', error);
          });
        }
      }
      setCreating(null);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [creating?.eventId, N]);

  const handleAddEvent = async () => {
    if (!app) return;
    // Default to an all-day event spanning three days: today and the next two
    const start = moment().startOf('day').toDate();
    const end = moment().startOf('day').add(2, 'day').toDate();
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

  // Checkbox shown in front of the item name; non-task items get a blank spacer
  // so every name stays aligned in the column.
  const renderCheckbox = (event: Model.Event) => {
    const isTask = (event.eventType || '').startsWith('TASK-');
    if (!isTask) {
      return <span className="bc-gantt-check-placeholder" />;
    }
    return (
      <input
        type="checkbox"
        className="task-list-item-checkbox bc-gantt-check"
        data-task={getMarkBasedOnEvent(event.eventType)}
        checked={event.eventType === 'TASK-DONE'}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => handleToggleDone(event, e)}
      />
    );
  };

  // Background day cells, shared by the header and each row (keeps columns aligned)
  const renderDayCells = (withNumbers: boolean) =>
    days.map((day) => {
      const ds = day.format('YYYY-MM-DD');
      const weekend = day.day() === 0 || day.day() === 6;
      const isToday = ds === todayStr;
      return (
        <div
          key={ds}
          className={`bc-gantt-daycell ${weekend ? 'bc-gantt-weekend' : ''} ${isToday ? 'bc-gantt-today' : ''}`}
          style={{width: dayWidth}}
        >
          {withNumbers && <span className="bc-gantt-daynum">{day.format('D')}</span>}
        </div>
      );
    });

  return (
    <div className="bc-gantt">
      <div className="bc-gantt-toolbar">
        <button type="button" className="bc-gantt-add" onClick={handleAddEvent}>
          + {t('Add event')}
        </button>
      </div>

      {rows.length === 0 ? (
        <div className="bc-gantt-empty">{t('No events in this range')}</div>
      ) : (
        <div className="bc-gantt-grid">
          <div className="bc-gantt-header">
            <div className="bc-gantt-name" style={{width: NAME_W}}>
              <span className="bc-gantt-check-placeholder" />
              <span className="bc-gantt-name-text">{t('Event')}</span>
            </div>
            <div className="bc-gantt-track" style={{width: trackWidth}}>
              {renderDayCells(true)}
            </div>
          </div>

          {rows.map((event, rowIndex) => {
            const isDragging = drag && drag.eventId === event.id;
            const ranges = eventRanges(event);
            const isDone = event.eventType === 'TASK-DONE';
            const depth = event.depth ?? 0;
            const hasChildren = (event.children?.length ?? 0) > 0;

            // The last child of a parent closes the branch with an elbow
            const nextRow = rows[rowIndex + 1];
            const isLastChild = depth > 0 && (!nextRow || (nextRow.depth ?? 0) < depth);

            return (
              <div
                key={event.id}
                className={`bc-gantt-row ${event.eventType || 'default'} ${isDone ? 'is-done' : ''} ${
                  depth > 0 ? 'is-child' : ''
                } ${hasChildren ? 'has-children' : ''}`}
                data-event-id={event.id}
                onContextMenu={(e) => handleContextMenu(e, event)}
              >
                <div className="bc-gantt-name" style={{width: NAME_W}} title={event.title}>
                  {/* One guide column per nesting level, with a connector elbow */}
                  {depth > 0 && (
                    <span className="bc-gantt-guides" aria-hidden>
                      {Array.from({length: depth}).map((_, level) => (
                        <span
                          key={level}
                          className={`bc-gantt-guide ${level === depth - 1 && isLastChild ? 'is-last' : ''}`}
                        />
                      ))}
                    </span>
                  )}
                  {renderCheckbox(event)}
                  <span className="bc-gantt-name-text">{event.title}</span>
                </div>
                <div
                  className="bc-gantt-track"
                  style={{width: trackWidth}}
                  title={t('Drag here to add a period')}
                  onMouseDown={(e) => beginCreate(e, event)}
                >
                  {renderDayCells(false)}

                  {/* Preview of the period being drawn */}
                  {creating && creating.eventId === event.id && (
                    <div
                      className="bc-gantt-bar bc-gantt-bar-preview"
                      style={{
                        left: Math.min(creating.startIdx, creating.endIdx) * dayWidth,
                        width: (Math.abs(creating.endIdx - creating.startIdx) + 1) * dayWidth,
                      }}
                    >
                      {Array.from({length: Math.abs(creating.endIdx - creating.startIdx) + 1}).map((_, i) => (
                        <div key={i} className="bc-gantt-fill" style={{width: dayWidth}} />
                      ))}
                    </div>
                  )}

                  {ranges.map((range, rangeIndex) => {
                    const beingDragged = isDragging && drag!.rangeIndex === rangeIndex;
                    const startIdx = beingDragged ? drag!.startIdx : idxOf(range.start);
                    const endIdx = beingDragged ? drag!.endIdx : idxOf(range.end || range.start);
                    const barLeft = startIdx * dayWidth;
                    const barWidth = (endIdx - startIdx + 1) * dayWidth;

                    return (
                      <div
                        key={`${event.id}-${rangeIndex}`}
                        className={`bc-gantt-bar ${isDone ? 'is-done' : ''}`}
                        style={{left: barLeft, width: barWidth}}
                        onMouseDown={(e) => beginDrag(e, event, 'move', rangeIndex)}
                        onClick={(e) => {
                          if (suppressClickRef.current) return;
                          onSelectEvent && onSelectEvent(event, e);
                        }}
                        onDoubleClick={(e) => onDoubleClickEvent && onDoubleClickEvent(event, e)}
                        title={event.title}
                      >
                        {Array.from({length: endIdx - startIdx + 1}).map((_, i) => (
                          <div key={i} className="bc-gantt-fill" style={{width: dayWidth}} />
                        ))}
                        <span
                          className="bc-gantt-handle bc-gantt-handle-l"
                          onMouseDown={(e) => beginDrag(e, event, 'resize-start', rangeIndex)}
                        />
                        <span
                          className="bc-gantt-handle bc-gantt-handle-r"
                          onMouseDown={(e) => beginDrag(e, event, 'resize-end', rangeIndex)}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// react-big-calendar custom-view statics
const GanttViewWithStatics = GanttView as typeof GanttView & {
  range: (date: Date) => Date[];
  navigate: (date: Date, action: NavigateAction) => Date;
  title: (date: Date) => string;
};
GanttViewWithStatics.range = (date: Date): Date[] => [date];
GanttViewWithStatics.navigate = (date: Date, action: NavigateAction): Date =>
  navigateRange(date, action, ganttRange(currentRange()));
GanttViewWithStatics.title = (date: Date): string => rangeTitle(date, ganttRange(currentRange()));

export default GanttViewWithStatics;
