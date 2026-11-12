import React, {useMemo, useRef, useState} from 'react';
import {moment} from 'obsidian';
import {NavigateAction} from 'react-big-calendar';
import useCalendarStore from '@/stores/calendarStore';
import useFileStore from '@/stores/fileStore';
import {eventService} from '@/services';
import {getMarkBasedOnEvent} from '@/obComponents/parser';
import {t} from '@/translations/helper';
import {showEventContextMenu} from '../eventContextMenu';
import {createEventWithPrompt} from './createFlow';
import {biWeekTitle, biWeekWindow, currentStartDay, navigateBiWeek} from './dateRange';
import {eventRanges, groupOccurrences} from '@/utils/eventOccurrences';

interface BiWeekViewProps {
  date: Date;
  events: Model.Event[];
  // eslint-disable-next-line
  onSelectEvent?: (event: Model.Event, e: React.SyntheticEvent) => void;
  // eslint-disable-next-line
  onDoubleClickEvent?: (event: Model.Event, e: React.SyntheticEvent) => void;
}

interface DayCell {
  day: moment.Moment;
  key: string;
  isToday: boolean;
  isWeekend: boolean;
}

/**
 * One drawn period of an item inside a week row. A period covering several days
 * becomes a single bar spanning those columns, so a cross-day item is never
 * broken up into independent pieces.
 */
interface SpanBar {
  key: string;
  record: Model.Event;
  rangeIndex: number;
  /** Column of the period's first/last day within its week row (0-6). */
  startCol: number;
  endCol: number;
  /** Stacking row inside the week, used to keep overlapping bars apart. */
  lane: number;
  /** Only the first bar of a record carries the completion checkbox. */
  showCheckbox: boolean;
  /** The period runs past this week row and continues in the neighbour. */
  continuesPrior: boolean;
  continuesAfter: boolean;
  /** Days of the period that fall before / after the visible two weeks. */
  overflowBefore: number;
  overflowAfter: number;
}

/** What is being dragged, where it would land and where the pointer is. */
interface ItemDragState {
  record: Model.Event;
  fromIndex: number;
  toIndex: number;
  /** Columns the dragged bar spans, so the preview keeps its length. */
  span: number;
  /** Lane the dragged bar sits in, so the preview does not jump rows. */
  lane: number;
  /** Pointer position, used to float the drag ghost. */
  x: number;
  y: number;
  /** Width of one day column, so the ghost keeps the bar's proportions. */
  colWidth: number;
}

/** Which edge of a period is being pulled, and how far it has moved. */
interface ItemResizeState {
  record: Model.Event;
  rangeIndex: number;
  edge: 'start' | 'end';
  /** Grid index of the dragged edge, and where the pointer is now. */
  fromIndex: number;
  toIndex: number;
  /** True day indices (0-13) of both edges when the drag started. */
  originStartIdx: number;
  originEndIdx: number;
  /** Grid position of the edge that is not moving. */
  otherWeek: number;
  otherCol: number;
  lane: number;
}

/** Height of one lane, shared by the stacking maths and the bar style. */
const LANE_H = 34;
/** Vertical gap between two stacked bars. */
const BAR_GAP = 4;
/** Days shown by the view: this week plus the next one. */
const WINDOW_DAYS = 14;
/**
 * How far the pointer must travel before a press counts as a drag. Below this
 * the gesture stays a click, so pressing a bar a little longer - or the small
 * tremor that comes with it - never moves the item.
 */
const DRAG_THRESHOLD = 6;

/**
 * Follows a press until the button is released.
 *
 * The listeners are attached synchronously, so a fast click can never miss the
 * matching mouseup (which used to leave the view stuck in a "dragging" state).
 * The gesture is only promoted to a drag once the pointer has travelled past
 * {@link DRAG_THRESHOLD}; `onDrag` is not called before that, so nothing on
 * screen reacts to a plain press.
 *
 * @param onDrag Called for every pointer move once the gesture is a drag.
 * @param onRelease Called on mouseup; `dragged` reports whether it ever became one.
 */
function trackPress(
  e: React.MouseEvent,
  onDrag: (ev: MouseEvent) => void,
  onRelease: (dragged: boolean) => void,
): void {
  const startX = e.clientX;
  const startY = e.clientY;
  let dragged = false;

  const handleMove = (ev: MouseEvent) => {
    if (!dragged) {
      if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < DRAG_THRESHOLD) return;
      dragged = true;
    }
    onDrag(ev);
  };

  const handleUp = () => {
    document.removeEventListener('mousemove', handleMove);
    document.removeEventListener('mouseup', handleUp);
    onRelease(dragged);
  };

  document.addEventListener('mousemove', handleMove);
  document.addEventListener('mouseup', handleUp);
}

/** "+3 days" style marker for a period reaching past the visible window. */
function overflowLabel(days: number): string {
  return t('+{n} days').replace('{n}', String(days));
}

/**
 * Two-week ("this week + next week") view: 14 day boxes laid out as two rows of
 * seven.
 *
 * Items are drawn as bars spanning the days they cover, so an item that runs
 * across several days reads as one connected bar with a single checkbox. Bars
 * are packed into lanes so overlapping items stack instead of hiding each other.
 *
 * Like the month view, hovering a bar reveals a vertical handle on each end:
 * pulling one of them widens or narrows the period, while dragging the middle
 * of the bar moves the whole item.
 */
function BiWeekView(props: BiWeekViewProps): React.ReactElement {
  const {date, events, onSelectEvent, onDoubleClickEvent} = props;

  const app = useFileStore((state) => state.app);
  const startDay = useCalendarStore((state) => state.startDay);

  const gridRef = useRef<HTMLDivElement>(null);

  const win = biWeekWindow(date, startDay);
  const windowStart = win.start.valueOf();
  const todayKey = moment().format('YYYY-MM-DD');

  // 14 days, as two rows of seven
  const days = useMemo(() => {
    const list: moment.Moment[] = [];
    for (let i = 0; i < WINDOW_DAYS; i++) {
      list.push(moment(windowStart).add(i, 'day'));
    }
    return list;
  }, [windowStart]);

  const cells = useMemo<DayCell[]>(
    () =>
      days.map((day) => ({
        day,
        key: day.format('YYYY-MM-DD'),
        isToday: day.format('YYYY-MM-DD') === todayKey,
        isWeekend: day.day() === 0 || day.day() === 6,
      })),
    [days, todayKey],
  );

  // Weekday headers, honouring the configured first day of week
  const weekdayLabels = useMemo(() => days.slice(0, 7).map((day) => day.format('ddd')), [days]);

  /**
   * Every period intersecting the two weeks, laid out per week row as one
   * spanning bar (or two when the period crosses the week boundary).
   */
  const barsByWeek = useMemo<SpanBar[][]>(() => {
    const records = groupOccurrences(events || []);
    const byId = new Map(records.map((record) => [record.id, record]));

    // Sub-items sort with their parent so the hierarchy stays readable
    const sortKeyOf = (record: Model.Event): number => {
      const parent = record.parentId ? byId.get(record.parentId) : undefined;
      return moment(parent ? parent.start : record.start).valueOf();
    };
    records.sort((a, b) => {
      const byParent = sortKeyOf(a) - sortKeyOf(b);
      if (byParent !== 0) return byParent;
      if (a.isChild !== b.isChild) return a.isChild ? 1 : -1;
      return new Date(a.start).getTime() - new Date(b.start).getTime();
    });

    const weeks: SpanBar[][] = [[], []];
    const anchor = moment(windowStart);

    records.forEach((record) => {
      eventRanges(record).forEach((range, rangeIndex) => {
        const startIdx = moment(range.start).startOf('day').diff(anchor, 'days');
        const endIdx = moment(range.end).startOf('day').diff(anchor, 'days');

        if (startIdx > WINDOW_DAYS - 1 || endIdx < 0) return;

        // Clip the period to the visible two weeks
        const from = Math.max(0, startIdx);
        const to = Math.min(WINDOW_DAYS - 1, Math.max(endIdx, 0));
        if (from > to) return;

        const overflowBefore = Math.max(0, -startIdx);
        const overflowAfter = Math.max(0, endIdx - (WINDOW_DAYS - 1));

        for (let week = 0; week < 2; week++) {
          const firstCol = week * 7;
          const lastCol = firstCol + 6;
          const colStart = Math.max(from, firstCol);
          const colEnd = Math.min(to, lastCol);
          if (colStart > colEnd) continue;

          weeks[week].push({
            key: `${record.id}-${rangeIndex}-${week}`,
            record,
            rangeIndex,
            startCol: colStart - firstCol,
            endCol: colEnd - firstCol,
            lane: 0,
            showCheckbox: false,
            continuesPrior: week === 1 && from < firstCol,
            continuesAfter: week === 0 && to > lastCol,
            overflowBefore,
            overflowAfter,
          });
        }
      });
    });

    // Pack the bars into lanes (longest first so they take the top rows) and
    // mark the first bar of each record as the one owning the checkbox.
    const checkboxTaken = new Set<string>();

    weeks.forEach((bars) => {
      bars.sort((a, b) => a.startCol - b.startCol || b.endCol - a.endCol);

      const laneEnds: number[] = [];
      bars.forEach((bar) => {
        let lane = laneEnds.findIndex((end) => end < bar.startCol);
        if (lane === -1) {
          lane = laneEnds.length;
          laneEnds.push(bar.endCol);
        } else {
          laneEnds[lane] = bar.endCol;
        }
        bar.lane = lane;

        if (!checkboxTaken.has(bar.record.id)) {
          checkboxTaken.add(bar.record.id);
          bar.showCheckbox = true;
        }
      });
    });

    return weeks;
  }, [events, windowStart]);

  // ---- Pointer interaction --------------------------------------------------
  // Drags are driven by plain document listeners registered on mousedown, so a
  // fast click can never miss the matching mouseup (which used to leave the view
  // stuck in a "dragging" state and swallow every later click).
  const [selection, setSelection] = useState<{start: number; end: number} | null>(null);
  const [itemDrag, setItemDrag] = useState<ItemDragState | null>(null);
  const [itemResize, setItemResize] = useState<ItemResizeState | null>(null);
  // The click that ends a real drag must not also open the editor
  const suppressClickRef = useRef(false);

  const markSuppressClick = () => {
    suppressClickRef.current = true;
    window.setTimeout(() => {
      suppressClickRef.current = false;
    }, 250);
  };

  /** Viewport rects measured once at the start of a drag. */
  interface GridGeometry {
    /** The two week rows, used to tell which row the pointer is over. */
    rows: DOMRect[];
    /** The two lane areas, used to map the pointer onto a column. */
    lanes: DOMRect[];
  }

  const measureGrid = (): GridGeometry => {
    const root = gridRef.current;
    if (!root) return {rows: [], lanes: []};
    return {
      rows: Array.from(root.querySelectorAll('.bc-biweek-row')).map((el) => el.getBoundingClientRect()),
      lanes: Array.from(root.querySelectorAll('.bc-biweek-lanes')).map((el) => el.getBoundingClientRect()),
    };
  };

  /** Row (0/1) and column (0-6) under the given viewport point. */
  const cellAt = (clientX: number, clientY: number, geo: GridGeometry): {row: number; col: number} => {
    // The row rect includes the day-number band and the gutter, so it decides
    // the row; the lane rect lines up with the seven columns, so it decides the
    // column.
    const row = geo.rows.length > 1 && clientY >= geo.rows[1].top ? 1 : 0;
    const rect = geo.lanes[row] ?? geo.lanes[0];
    if (!rect || !rect.width) return {row, col: 0};

    const col = Math.max(0, Math.min(6, Math.floor(((clientX - rect.left) / rect.width) * 7)));
    return {row, col};
  };

  const dayIndexAt = (clientX: number, clientY: number, geo: GridGeometry): number => {
    const {row, col} = cellAt(clientX, clientY, geo);
    return row * 7 + col;
  };

  /** Column width of one day, used to size the floating drag ghost. */
  const columnWidth = (geo: GridGeometry, row: number): number => {
    const rect = geo.lanes[row] ?? geo.lanes[0];
    return rect ? rect.width / 7 : 0;
  };

  /** Opens the create dialog for a whole-day range; never asks for a parent. */
  const createForDays = (fromIndex: number, toIndex: number) => {
    if (!app) return;
    const from = Math.min(fromIndex, toIndex);
    const to = Math.max(fromIndex, toIndex);
    const start = days[from].clone().startOf('day').toDate();
    const end = days[to].clone().endOf('day').toDate();
    createEventWithPrompt(app, start, end).catch((error) => {
      console.error('Error creating event:', error);
    });
  };

  /** Picks a day (or a range of days) on the empty grid. */
  const beginSelection = (index: number, e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();

    const geo = measureGrid();
    const state = {start: index, end: index};

    trackPress(
      e,
      (ev) => {
        state.end = dayIndexAt(ev.clientX, ev.clientY, geo);
        setSelection({...state});
      },
      () => {
        setSelection(null);
        createForDays(state.start, state.end);
      },
    );
  };

  /** Drags the middle of a bar: the whole item moves to another day. */
  const beginItemDrag = (
    e: React.MouseEvent,
    record: Model.Event,
    fromIndex: number,
    span: number,
    lane: number,
  ) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();

    const geo = measureGrid();
    const startRow = Math.floor(fromIndex / 7);

    const state: ItemDragState = {
      record,
      fromIndex,
      toIndex: fromIndex,
      span,
      lane,
      x: e.clientX,
      y: e.clientY,
      colWidth: columnWidth(geo, startRow),
    };

    trackPress(
      e,
      (ev) => {
        state.toIndex = dayIndexAt(ev.clientX, ev.clientY, geo);
        state.x = ev.clientX;
        state.y = ev.clientY;
        setItemDrag({...state});
      },
      (dragged) => {
        setItemDrag(null);
        // A plain click (however long it was held) leaves the item alone and
        // lets the click event open the editor
        if (!dragged) return;

        const delta = state.toIndex - state.fromIndex;
        if (delta === 0) return;

        markSuppressClick();
        eventService.shiftEvent(state.record, delta).catch((error) => {
          console.error('Error moving event:', error);
        });
      },
    );
  };

  /**
   * Pulls one end of a bar: only that end of the period moves, exactly like the
   * resize handles the month view shows on hover.
   */
  const beginResize = (e: React.MouseEvent, bar: SpanBar, edge: 'start' | 'end', weekIndex: number) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();

    const anchor = moment(windowStart);
    const ranges = eventRanges(bar.record);
    const range = ranges[bar.rangeIndex] ?? ranges[0];

    const originStartIdx = moment(range.start).startOf('day').diff(anchor, 'days');
    const originEndIdx = moment(range.end || range.start).startOf('day').diff(anchor, 'days');

    const geo = measureGrid();
    const gridIndex = weekIndex * 7 + (edge === 'start' ? bar.startCol : bar.endCol);
    const otherIdx = Math.max(
      0,
      Math.min(WINDOW_DAYS - 1, edge === 'start' ? originEndIdx : originStartIdx),
    );

    const state: ItemResizeState = {
      record: bar.record,
      rangeIndex: bar.rangeIndex,
      edge,
      fromIndex: gridIndex,
      toIndex: gridIndex,
      originStartIdx,
      originEndIdx,
      otherWeek: Math.floor(otherIdx / 7),
      otherCol: otherIdx % 7,
      lane: bar.lane,
    };
    trackPress(
      e,
      (ev) => {
        state.toIndex = dayIndexAt(ev.clientX, ev.clientY, geo);
        setItemResize({...state});
      },
      (dragged) => {
        setItemResize(null);
        // Pressing a handle without pulling it must leave the dates untouched
        if (!dragged) return;

        const delta = state.toIndex - state.fromIndex;
        if (delta === 0) return;

        markSuppressClick();
        const bounds = resizeBounds(state);

        // Keep the period's clock, only its days change
        const startTime = moment(range.start);
        const endTime = moment(range.end || range.start);

        const newStart = moment(windowStart)
          .add(bounds.startIdx, 'day')
          .hour(startTime.hour())
          .minute(startTime.minute())
          .second(0);
        const newEnd = moment(windowStart)
          .add(bounds.endIdx, 'day')
          .hour(endTime.hour())
          .minute(endTime.minute())
          .second(0);

        eventService
          .editEvent(
            {...bar.record, rangeIndex: bar.rangeIndex, baseId: bar.record.id},
            newStart.toDate(),
            newEnd.toDate(),
          )
          .catch((error) => {
            console.error('Error resizing event:', error);
          });
      },
    );
  };

  /** New day indices (0-13 relative to the window) while one edge is pulled. */
  const resizeBounds = (state: ItemResizeState): {startIdx: number; endIdx: number} => {
    const delta = state.toIndex - state.fromIndex;
    let startIdx = state.originStartIdx;
    let endIdx = state.originEndIdx;

    if (state.edge === 'start') {
      startIdx += delta;
      if (startIdx > endIdx) startIdx = endIdx;
    } else {
      endIdx += delta;
      if (endIdx < startIdx) endIdx = startIdx;
    }

    return {startIdx, endIdx};
  };

  const isSelected = (index: number): boolean => {
    if (!selection) return false;
    return index >= Math.min(selection.start, selection.end) && index <= Math.max(selection.start, selection.end);
  };

  /**
   * Columns the dragged item would cover if dropped now. The landing span has
   * the same length as the bar, clamped to its week row.
   */
  const dropTarget = itemDrag
    ? (() => {
        const rowStart = Math.floor(itemDrag.toIndex / 7) * 7;
        const startCol = itemDrag.toIndex % 7;
        const endCol = Math.min(6, startCol + itemDrag.span);
        return {week: Math.floor(itemDrag.toIndex / 7), startCol, endCol, fromIndex: rowStart + startCol, toIndex: rowStart + endCol};
      })()
    : null;

  /** Span the bar would cover while one of its ends is being pulled. */
  const resizePreview = itemResize
    ? (() => {
        const week = Math.floor(itemResize.toIndex / 7);
        const col = itemResize.toIndex % 7;
        if (week === itemResize.otherWeek) {
          return {week, startCol: Math.min(col, itemResize.otherCol), endCol: Math.max(col, itemResize.otherCol)};
        }
        return week > itemResize.otherWeek
          ? {week, startCol: 0, endCol: col}
          : {week, startCol: col, endCol: 6};
      })()
    : null;

  /** Day cells highlighted as the landing area of the current drag. */
  const bandRange = itemResize
    ? (() => {
        const bounds = resizeBounds(itemResize);
        return {from: Math.max(0, bounds.startIdx), to: Math.min(WINDOW_DAYS - 1, bounds.endIdx)};
      })()
    : dropTarget
      ? {from: dropTarget.fromIndex, to: dropTarget.toIndex}
      : null;

  const isDropTarget = (index: number): boolean =>
    !!bandRange && index >= bandRange.from && index <= bandRange.to;

  // Right-click an item: the same menu as the other views
  const handleContextMenu = (e: React.MouseEvent, record: Model.Event) => {
    e.preventDefault();
    e.stopPropagation();
    showEventContextMenu(app, record, e.nativeEvent);
  };

  // Toggle a task between TASK-TODO and TASK-DONE, syncing to the note
  const handleToggleDone = (record: Model.Event, e: React.ChangeEvent<HTMLInputElement>) => {
    e.stopPropagation();
    const nextType = record.eventType === 'TASK-DONE' ? 'TASK-TODO' : 'TASK-DONE';
    eventService
      .updateEvent(record.id, record.title, nextType, record.start, record.end)
      .catch((error) => console.error('Error toggling task state:', error));
  };

  const barHeight = LANE_H - BAR_GAP;
  const weekStarts = [win.start, win.start.clone().add(7, 'day')];

  // Keep the floating ghost inside the viewport: letting it overflow would add a
  // scrollbar mid-drag and make the whole grid shift under the pointer.
  const ghostStyle = itemDrag
    ? (() => {
        const width = Math.max(80, (itemDrag.span + 1) * itemDrag.colWidth - 8);
        const maxX = window.innerWidth - width - 16;
        const maxY = window.innerHeight - barHeight - 16;
        return {
          left: Math.max(8, Math.min(itemDrag.x + 14, Math.max(8, maxX))),
          top: Math.max(8, Math.min(itemDrag.y - barHeight / 2, Math.max(8, maxY))),
          width,
          height: barHeight,
        };
      })()
    : null;

  return (
    <div className="bc-biweek" ref={gridRef}>
      <div className="bc-biweek-head">
        <div className="bc-biweek-gutter" />
        {weekdayLabels.map((label, index) => (
          <div className="bc-biweek-weekday" key={`${label}-${index}`}>
            {label}
          </div>
        ))}
      </div>

      {weekStarts.map((weekStart, weekIndex) => (
        <div className="bc-biweek-row" key={weekStart.format('YYYY-MM-DD')}>
          <div className="bc-biweek-gutter" title={weekStart.format('YYYY-MM-DD')}>
            {weekIndex === 0 ? t('This week') : t('Next week')}
          </div>

          {cells.slice(weekIndex * 7, weekIndex * 7 + 7).map((cell, offset) => {
            const index = weekIndex * 7 + offset;
            const isFirstOfMonth = cell.day.date() === 1;

            return (
              <div
                key={cell.key}
                className={`bc-biweek-cell ${cell.isToday ? 'is-today' : ''} ${
                  cell.isWeekend ? 'is-weekend' : ''
                } ${isSelected(index) ? 'is-selected' : ''} ${isDropTarget(index) ? 'is-drop-target' : ''}`}
                onMouseDown={(e) => beginSelection(index, e)}
              >
                <div className="bc-biweek-daynum">
                  {cell.day.format('D')}
                  {isFirstOfMonth && <span className="bc-biweek-month">{cell.day.format('M月')}</span>}
                </div>
              </div>
            );
          })}

          {/* Bars sit above the day cells; only the bars take pointer events */}
          <div className="bc-biweek-lanes">
            {barsByWeek[weekIndex].map((bar) => {
              const record = bar.record;
              const isTask = (record.eventType || '').startsWith('TASK-');
              const isDone = record.eventType === 'TASK-DONE';
              const width = ((bar.endCol - bar.startCol + 1) / 7) * 100;
              const isDragged = itemDrag?.record.id === record.id;

              return (
                <div
                  key={bar.key}
                  className={`bc-biweek-bar ${record.eventType || 'default'} ${isDone ? 'is-done' : ''} ${
                    bar.continuesPrior ? 'continues-prior' : ''
                  } ${bar.continuesAfter ? 'continues-after' : ''} ${isDragged ? 'is-dragging' : ''}`}
                  style={{
                    // 2px insets keep neighbouring bars visually apart
                    left: `calc(${(bar.startCol / 7) * 100}% + 2px)`,
                    width: `calc(${width}% - 4px)`,
                    top: bar.lane * LANE_H,
                    height: barHeight,
                  }}
                  title={`${record.title}  ${moment(record.start).format('YYYY-MM-DD')}`}
                  data-event-id={record.id}
                  onMouseDown={(e) =>
                    beginItemDrag(e, record, weekIndex * 7 + bar.startCol, bar.endCol - bar.startCol, bar.lane)
                  }
                  onClick={(e) => {
                    e.stopPropagation();
                    if (suppressClickRef.current) return;
                    onSelectEvent && onSelectEvent(record, e);
                  }}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    onDoubleClickEvent && onDoubleClickEvent(record, e);
                  }}
                  onContextMenu={(e) => handleContextMenu(e, record)}
                >
                  {/* The period starts before the window: hint how much is hidden */}
                  {!bar.continuesPrior && bar.startCol === 0 && bar.overflowBefore > 0 && (
                    <span className="bc-biweek-overflow">{overflowLabel(bar.overflowBefore)}</span>
                  )}

                  {isTask && bar.showCheckbox && (
                    <input
                      type="checkbox"
                      className="task-list-item-checkbox bc-biweek-check"
                      data-task={getMarkBasedOnEvent(record.eventType)}
                      checked={isDone}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => handleToggleDone(record, e)}
                    />
                  )}

                  {record.isChild && <span className="bc-biweek-branch">↳</span>}
                  <span className="bc-biweek-bar-title">{record.title}</span>

                  {/* The period runs past the window: hint the tail length */}
                  {!bar.continuesAfter && bar.endCol === 6 && bar.overflowAfter > 0 && (
                    <span className="bc-biweek-overflow">{overflowLabel(bar.overflowAfter)}</span>
                  )}

                  {/* Vertical handles, shown on hover like the month view */}
                  <span
                    className="bc-biweek-resize bc-biweek-resize-l"
                    title={t('Drag to change the dates')}
                    onMouseDown={(e) => beginResize(e, bar, 'start', weekIndex)}
                  />
                  <span
                    className="bc-biweek-resize bc-biweek-resize-r"
                    title={t('Drag to change the dates')}
                    onMouseDown={(e) => beginResize(e, bar, 'end', weekIndex)}
                  />
                </div>
              );
            })}

            {/* Landing spot while moving */}
            {dropTarget && dropTarget.week === weekIndex && itemDrag && (
              <div
                className="bc-biweek-bar bc-biweek-bar-preview"
                style={{
                  left: `calc(${(dropTarget.startCol / 7) * 100}% + 2px)`,
                  width: `calc(${((dropTarget.endCol - dropTarget.startCol + 1) / 7) * 100}% - 4px)`,
                  top: itemDrag.lane * LANE_H,
                  height: barHeight,
                }}
              >
                {itemDrag.record.isChild && <span className="bc-biweek-branch">↳</span>}
                <span className="bc-biweek-bar-title">{itemDrag.record.title}</span>
              </div>
            )}

            {/* Resulting span while one end is being pulled */}
            {resizePreview && resizePreview.week === weekIndex && itemResize && (
              <div
                className="bc-biweek-bar bc-biweek-bar-preview"
                style={{
                  left: `calc(${(resizePreview.startCol / 7) * 100}% + 2px)`,
                  width: `calc(${((resizePreview.endCol - resizePreview.startCol + 1) / 7) * 100}% - 4px)`,
                  top: itemResize.lane * LANE_H,
                  height: barHeight,
                }}
              >
                <span className="bc-biweek-bar-title">{itemResize.record.title}</span>
              </div>
            )}
          </div>
        </div>
      ))}

      {/* Ghost following the pointer, like the native drag of the week view */}
      {itemDrag && ghostStyle && (
        <div className="bc-biweek-ghost" style={ghostStyle}>
          <span className="bc-biweek-bar-title">{itemDrag.record.title}</span>
        </div>
      )}
    </div>
  );
}

// react-big-calendar custom-view statics
const BiWeekViewWithStatics = BiWeekView as typeof BiWeekView & {
  range: (date: Date) => Date[];
  navigate: (date: Date, action: NavigateAction) => Date;
  title: (date: Date) => string;
};
BiWeekViewWithStatics.range = (date: Date): Date[] => [date];
BiWeekViewWithStatics.navigate = (date: Date, action: NavigateAction): Date => navigateBiWeek(date, action);
BiWeekViewWithStatics.title = (date: Date): string => biWeekTitle(date, currentStartDay());

export default BiWeekViewWithStatics;
