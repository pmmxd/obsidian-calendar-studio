import {moment, setIcon} from 'obsidian';
import {t} from '@/translations/helper';
import type {EventItemInput} from '@/obComponents/eventWriter';
import {eventRanges} from '@/utils/eventOccurrences';

/**
 * A day + optional time range, as edited in the create / edit dialogs. When
 * both time inputs are empty the range is day-granular (`allDay`).
 */
export interface PeriodLike {
  start: Date;
  end: Date;
  allDay: boolean;
}

/**
 * A sub-item as edited in the create / edit dialogs.
 */
export interface SubItemDraft extends PeriodLike {
  title: string;
  eventType: string;
}

/** Event types offered by the item type dropdown. */
export const ITEM_TYPE_OPTIONS: Array<{value: string; label: () => string}> = [
  {value: 'TASK-TODO', label: () => t('To-Do')},
  {value: 'TASK-DONE', label: () => t('Done')},
  {value: 'TASK-IN_PROGRESS', label: () => t('In Progress')},
  {value: 'TASK-IMPORTANT', label: () => t('Important')},
  {value: 'default', label: () => t('Default')},
];

/** Drafts taken from the sub-items an event already has. */
export function eventToDrafts(event: Model.Event | null): SubItemDraft[] {
  return (event?.children ?? []).map((child) => ({
    title: child.title,
    eventType: child.eventType || 'TASK-TODO',
    start: new Date(child.start),
    end: new Date(child.end || child.start),
    allDay: child.allDay,
  }));
}

/** Drafts taken from every period an event covers. */
export function eventToPeriodDrafts(event: Model.Event): PeriodLike[] {
  return eventRanges(event).map((range) => ({
    start: new Date(range.start),
    end: new Date(range.end),
    allDay: event.allDay,
  }));
}

/** Turns a draft into the note representation, dropping empty rows. */
export function draftToInput(draft: SubItemDraft): EventItemInput {
  return {
    title: draft.title.trim(),
    eventType: draft.eventType,
    ranges: [{start: draft.start, end: draft.end}],
    allDay: draft.allDay,
    children: [],
  };
}

export function draftsToInputs(drafts: SubItemDraft[]): EventItemInput[] {
  return drafts.filter((draft) => draft.title.trim() !== '').map(draftToInput);
}

/**
 * Renders the four period inputs (start date/time, end date/time) into
 * `container`, keeping `target` in sync. Shared by the period list of an item
 * and by each sub-item row.
 */
export function renderPeriodInputs(container: HTMLElement, target: PeriodLike): void {
  const startDate = container.createEl('input', {cls: 'bc-period-date'});
  startDate.type = 'date';
  startDate.value = moment(target.start).format('YYYY-MM-DD');

  const startTime = container.createEl('input', {cls: 'bc-period-time'});
  startTime.type = 'time';
  startTime.value = target.allDay ? '' : moment(target.start).format('HH:mm');

  container.createSpan({cls: 'bc-period-sep', text: '~'});

  const endDate = container.createEl('input', {cls: 'bc-period-date'});
  endDate.type = 'date';
  endDate.value = moment(target.end || target.start).format('YYYY-MM-DD');

  const endTime = container.createEl('input', {cls: 'bc-period-time'});
  endTime.type = 'time';
  endTime.value = target.allDay ? '' : moment(target.end || target.start).format('HH:mm');

  const syncDates = () => {
    const startDay = moment(startDate.value, 'YYYY-MM-DD');
    const endDay = moment(endDate.value, 'YYYY-MM-DD');
    if (!startDay.isValid() || !endDay.isValid()) return;

    const start = moment(target.start);
    const end = moment(target.end);
    target.start = startDay
      .clone()
      .hour(start.hour())
      .minute(start.minute())
      .second(0)
      .toDate();
    target.end = endDay
      .clone()
      .hour(end.hour())
      .minute(end.minute())
      .second(0)
      .toDate();
  };

  const syncTimes = () => {
    const rawStart = startTime.value;
    const rawEnd = endTime.value;

    // Both empty means a day-granular item
    if (!rawStart && !rawEnd) {
      target.allDay = true;
      return;
    }

    target.allDay = false;

    // Filling only one side mirrors it so the range stays valid
    const effectiveStart = rawStart || rawEnd;
    const effectiveEnd = rawEnd || rawStart;
    const [sh, sm] = effectiveStart.split(':').map(Number);
    const [eh, em] = effectiveEnd.split(':').map(Number);

    target.start = moment(target.start).startOf('day').hour(sh).minute(sm).second(0).toDate();
    target.end = moment(target.end)
      .startOf('day')
      .hour(eh)
      .minute(em)
      .second(0)
      .toDate();

    if (target.end.getTime() < target.start.getTime()) {
      target.end = new Date(target.start.getTime() + 60 * 60 * 1000);
    }
  };

  startDate.addEventListener('change', syncDates);
  endDate.addEventListener('change', syncDates);
  startTime.addEventListener('change', syncTimes);
  endTime.addEventListener('change', syncTimes);
}

/** Builds the small trash button used to drop a row. */
function createRemoveButton(container: HTMLElement, label: string, onClick: () => void): void {
  const button = container.createEl('button', {cls: 'bc-row-remove'});
  setIcon(button, 'trash');
  button.setAttribute('aria-label', label);
  button.addEventListener('click', onClick);
}

/**
 * Editable list of the periods an item covers. A parent item may span several
 * periods, written as "~A ~ B；C ~ D" on a single line.
 */
export class PeriodEditor {
  private readonly container: HTMLElement;
  private readonly drafts: PeriodLike[];
  private readonly defaultDate: Date;

  constructor(container: HTMLElement, drafts: PeriodLike[], defaultDate: Date) {
    this.container = container;
    this.drafts = drafts.length > 0 ? drafts : [{start: defaultDate, end: defaultDate, allDay: true}];
    this.defaultDate = defaultDate;
  }

  render(): void {
    this.container.empty();

    const header = this.container.createDiv({cls: 'bc-subitem-heading'});
    header.createSpan({text: t('Time periods')});

    const addButton = header.createEl('button', {cls: 'bc-subitem-add', text: t('Add period')});
    addButton.addEventListener('click', () => {
      this.drafts.push({
        start: new Date(this.defaultDate),
        end: new Date(this.defaultDate),
        allDay: this.drafts[0]?.allDay ?? true,
      });
      this.render();
    });

    this.drafts.forEach((draft, index) => {
      const row = this.container.createDiv({cls: 'bc-period-row'});
      renderPeriodInputs(row, draft);

      // The first period always stays so an item never ends up with none
      if (this.drafts.length > 1) {
        createRemoveButton(row, t('Remove period'), () => {
          this.drafts.splice(index, 1);
          this.render();
        });
      }
    });
  }

  getDrafts(): PeriodLike[] {
    return this.drafts;
  }
}

/**
 * Editable list of sub-items, rendered inside an Obsidian modal.
 *
 * Each row exposes the type, the period and the title, mirrored to the note as
 * an indented line under the parent item.
 */
export class SubItemEditor {
  private readonly container: HTMLElement;
  private readonly drafts: SubItemDraft[];
  private readonly defaultDate: Date;

  constructor(container: HTMLElement, drafts: SubItemDraft[], defaultDate: Date) {
    this.container = container;
    this.drafts = drafts;
    this.defaultDate = defaultDate;
  }

  /** Rebuilds the list; called after every add/remove. */
  render(): void {
    this.container.empty();

    const header = this.container.createDiv({cls: 'bc-subitem-heading'});
    header.createSpan({text: t('Sub-items')});

    const addButton = header.createEl('button', {cls: 'bc-subitem-add', text: t('Add sub-item')});
    addButton.addEventListener('click', () => {
      this.drafts.push({
        title: '',
        eventType: 'TASK-TODO',
        start: moment(this.defaultDate).startOf('day').toDate(),
        end: moment(this.defaultDate).startOf('day').toDate(),
        allDay: true,
      });
      this.render();
    });

    if (this.drafts.length === 0) {
      this.container.createDiv({cls: 'bc-subitem-empty', text: t('No sub-items')});
      return;
    }

    this.drafts.forEach((draft, index) => this.renderRow(draft, index));
  }

  /** The current drafts, in display order. */
  getDrafts(): SubItemDraft[] {
    return this.drafts;
  }

  private renderRow(draft: SubItemDraft, index: number): void {
    const row = this.container.createDiv({cls: 'bc-subitem-row'});

    // ---- top line: title, type, delete ----
    const top = row.createDiv({cls: 'bc-subitem-top'});

    const titleInput = top.createEl('input', {cls: 'bc-subitem-title'});
    titleInput.type = 'text';
    titleInput.placeholder = t('Sub-item name');
    titleInput.value = draft.title;
    titleInput.addEventListener('input', () => {
      draft.title = titleInput.value;
    });

    const typeSelect = top.createEl('select', {cls: 'dropdown bc-subitem-type'});
    ITEM_TYPE_OPTIONS.forEach((option) => {
      const el = typeSelect.createEl('option', {text: option.label()});
      el.value = option.value;
    });
    typeSelect.value = draft.eventType;
    typeSelect.addEventListener('change', () => {
      draft.eventType = typeSelect.value;
    });

    createRemoveButton(top, t('Remove sub-item'), () => {
      this.drafts.splice(index, 1);
      this.render();
    });

    // ---- bottom line: period ----
    const period = row.createDiv({cls: 'bc-subitem-period'});
    renderPeriodInputs(period, draft);
  }
}
