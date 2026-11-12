/**
 * Helpers for items that cover several periods.
 *
 * react-big-calendar can only draw one continuous span per event, so an item
 * owning several periods is expanded into one occurrence per period before it
 * reaches the calendar. Every occurrence keeps `baseId` / `rangeIndex` so an
 * edit can be routed back to the underlying note line.
 */

/** The periods of an item, falling back to its primary start/end. */
export function eventRanges(event: Model.Event): Model.EventRange[] {
  if (event.ranges && event.ranges.length > 0) {
    return event.ranges.map((range) => ({
      start: new Date(range.start),
      end: new Date(range.end || range.start),
    }));
  }
  return [{start: new Date(event.start), end: new Date(event.end || event.start)}];
}

/** The id of the record an occurrence (or a record) belongs to. */
export function baseEventId(event: {id?: string; baseId?: string} | null | undefined): string {
  if (!event) return '';
  if (event.baseId) return event.baseId;
  const id = event.id ?? '';
  return id.includes('::') ? id.split('::')[0] : id;
}

/**
 * Expands records into one occurrence per period.
 */
export function expandEventOccurrences(events: Model.Event[]): Model.Event[] {
  const occurrences: Model.Event[] = [];

  for (const event of events) {
    const ranges = eventRanges(event);
    ranges.forEach((range, index) => {
      occurrences.push({
        ...event,
        id: index === 0 ? event.id : `${event.id}::${index}`,
        baseId: event.id,
        rangeIndex: index,
        ranges,
        start: range.start,
        end: range.end,
      });
    });
  }

  return occurrences;
}

/**
 * Collapses occurrences back into one entry per record, preserving the order the
 * records were read in.
 */
export function groupOccurrences(events: Model.Event[]): Model.Event[] {
  const byId = new Map<string, Model.Event>();

  for (const event of events) {
    const id = baseEventId(event);
    if (byId.has(id)) continue;
    byId.set(id, {...event, id, baseId: id, rangeIndex: undefined});
  }

  return [...byId.values()];
}
