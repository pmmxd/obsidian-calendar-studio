import {App, FuzzySuggestModal, moment} from 'obsidian';
import eventService from '@/services/eventService';
import {t} from '@/translations/helper';

/**
 * Event types that mean the item is finished. A finished item is no longer a
 * candidate parent: sub-items are only attached to something still open.
 */
const DONE_EVENT_TYPES = new Set(['TASK-DONE']);

/**
 * Timed items are sub-items, so creating one starts by choosing the parent it
 * belongs to. Only pending, day-granular items (parents) are offered.
 */
export class ParentPickerModal extends FuzzySuggestModal<Model.Event> {
  private selected: Model.Event | null = null;
  private readonly resolve: (event: Model.Event | null) => void;

  constructor(app: App, resolve: (event: Model.Event | null) => void) {
    super(app);
    this.resolve = resolve;
    this.setPlaceholder(t('Select a parent item'));
  }

  /**
   * Pending, day-granular items: the ones that can still own sub-items.
   * Completed items and sub-items themselves are excluded.
   */
  private static candidates(): Model.Event[] {
    return eventService
      .getState()
      .events.filter(
        (event) =>
          event.allDay &&
          !event.isChild &&
          !DONE_EVENT_TYPES.has(event.eventType ?? ''),
      )
      .sort((a, b) => new Date(b.start).getTime() - new Date(a.start).getTime());
  }

  /** Every item that could act as a parent, for callers building their own list. */
  public static list(): Model.Event[] {
    return ParentPickerModal.candidates();
  }

  /**
   * Whether a parent can be picked at all. When there is nothing to nest under,
   * callers create the item at the top level instead of blocking the user.
   */
  public static hasCandidates(): boolean {
    return ParentPickerModal.candidates().length > 0;
  }

  /**
   * Opens the picker and resolves with the chosen parent, or null when the
   * dialog is dismissed.
   */
  public static pick(app: App): Promise<Model.Event | null> {
    return new Promise((resolve) => {
      new ParentPickerModal(app, resolve).open();
    });
  }

  getItems(): Model.Event[] {
    return ParentPickerModal.candidates();
  }

  getItemText(event: Model.Event): string {
    return `${moment(event.start).format('YYYY-MM-DD')}  ${event.title}`;
  }

  //eslint-disable-next-line
  onChooseItem(event: Model.Event): void {
    this.selected = event;
    this.resolve(event);
  }

  onClose(): void {
    super.onClose();
    // The dialog was dismissed without a choice
    if (!this.selected) {
      window.setTimeout(() => this.resolve(null), 0);
    }
  }
}
