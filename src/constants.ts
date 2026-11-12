export const CALENDAR_VIEW_TYPE = 'big-calendar';

/**
 * Id this plugin registers as a "hover-link" source, used when an item name
 * contains a note link ("[[note]]") so Obsidian's page preview can show it.
 */
export const HOVER_LINK_SOURCE = 'big-calendar';

/** Visible time window of the week/day (time grid) views: 09:00 - 21:00 by default. */
export const DEFAULT_WEEK_START_HOUR = 9;
export const DEFAULT_WEEK_END_HOUR = 21;

/** Latest selectable end hour; 24 means "end of day" (24:00). */
export const MAX_WEEK_END_HOUR = 24;
