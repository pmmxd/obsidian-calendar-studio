import {App, Modal, Setting, moment} from 'obsidian';
import {eventService} from '@/services';
import {t} from '@/translations/helper';
import {ParentPickerModal} from '@/obComponents/ParentPickerModal';
import type {EventItemInput} from '@/obComponents/eventWriter';
import {
  ITEM_TYPE_OPTIONS,
  PeriodEditor,
  PeriodLike,
  SubItemDraft,
  SubItemEditor,
  draftsToInputs,
  eventToDrafts,
  eventToPeriodDrafts,
} from './SubItemEditor';

/** Dropdown value meaning "no parent", i.e. a top-level item. */
const NO_PARENT = '__none__';

/**
 * Modal for editing an item.
 *
 * It covers the title and type, the parent it hangs under (for sub-items),
 * every period the item spans (a parent may own several) and its sub-items;
 * saving writes the whole block back to the note so the indentation in the file
 * matches what the views show.
 */
export default class EventEditModal extends Modal {
  private readonly event: Model.Event;
  private title: string;
  private eventType: string;
  private readonly periods: PeriodLike[];
  private readonly subItems: SubItemDraft[];
  /** Parent the sub-item should end up under; null means the top level. */
  private parentId: string | null;

  constructor(app: App, event: Model.Event) {
    super(app);

    this.event = event;
    this.title = event.title;
    this.eventType = event.eventType || 'TASK-TODO';
    this.periods = eventToPeriodDrafts(event);
    this.subItems = eventToDrafts(event);
    this.parentId = event.isChild ? event.parentId ?? null : null;
  }

  onOpen() {
    const {contentEl, titleEl} = this;

    titleEl.setText(t('Edit event'));
    contentEl.addClass('bc-event-edit');

    // Title
    new Setting(contentEl).setName(t('Title')).addText((text) => {
      text.setValue(this.title).onChange((value) => {
        this.title = value;
      });
    });

    // Type
    new Setting(contentEl).setName(t('Event Type')).addDropdown((dropdown) => {
      ITEM_TYPE_OPTIONS.forEach((option) => dropdown.addOption(option.value, option.label()));
      dropdown.setValue(this.eventType).onChange((value) => {
        this.eventType = value;
      });
    });

    // A sub-item can be re-attached to another parent (or moved to the top level)
    if (this.event.isChild) {
      const candidates = ParentPickerModal.list().filter((item) => item.id !== this.event.id);

      // Keep the current parent selectable even when it is no longer a candidate
      const currentParent = this.event.parentId ? eventService.getEventById(this.event.parentId) : null;
      if (currentParent && !candidates.some((item) => item.id === currentParent.id)) {
        candidates.unshift(currentParent);
      }

      const label = (item: Model.Event): string => `${moment(item.start).format('YYYY-MM-DD')}  ${item.title}`;

      new Setting(contentEl)
        .setName(t('Parent item'))
        .setDesc(t('Move this sub-item under another parent item.'))
        .addDropdown((dropdown) => {
          dropdown.addOption(NO_PARENT, t('None'));
          candidates.forEach((item) => dropdown.addOption(item.id, label(item)));
          dropdown.setValue(this.parentId ?? NO_PARENT);
          dropdown.onChange((value) => {
            this.parentId = value === NO_PARENT ? null : value;
          });
        });
    }

    // Periods the item covers
    const periodsEl = contentEl.createDiv({cls: 'bc-periods'});
    const periodEditor = new PeriodEditor(periodsEl, this.periods, new Date(this.event.start));
    periodEditor.render();

    // Sub-items
    const subItemsEl = contentEl.createDiv({cls: 'bc-subitems'});
    const subItemEditor = new SubItemEditor(subItemsEl, this.subItems, new Date(this.event.start));
    subItemEditor.render();

    // Buttons
    const buttonsEl = contentEl.createDiv({cls: 'bc-modal-buttons'});

    const saveButton = buttonsEl.createEl('button', {cls: 'mod-cta', text: t('Save')});
    saveButton.addEventListener('click', () => {
      const periods = periodEditor.getDrafts();
      const input: EventItemInput = {
        title: this.title.trim() || this.event.title,
        eventType: this.eventType,
        ranges: periods.map((period) => ({start: period.start, end: period.end})),
        allDay: periods[0]?.allDay ?? this.event.allDay,
        children: draftsToInputs(subItemEditor.getDrafts()),
      };

      // Re-attaching means moving the block under another parent's line
      const originalParentId = this.event.isChild ? this.event.parentId ?? null : null;

      if (this.event.isChild && this.parentId !== originalParentId) {
        const newParent = this.parentId ? eventService.getEventById(this.parentId) : null;
        eventService.reparentEventStructure(this.event, input, newParent).catch((error) => {
          console.error('Error moving event to another parent:', error);
        });
      } else {
        eventService.saveEventStructure(this.event, input).catch((error) => {
          console.error('Error updating event:', error);
        });
      }

      this.close();
    });

    const cancelButton = buttonsEl.createEl('button', {text: t('Cancel')});
    cancelButton.addEventListener('click', () => this.close());
  }

  onClose() {
    this.contentEl.empty();
  }
}

/** Guards against a double click opening the dialog twice. */
let lastOpen = {id: '', at: 0};

/**
 * Opens the edit modal for an event. Occurrences coming from a multi-period
 * item are resolved back to the record they belong to.
 *
 * A double click fires both the click and the double-click handler, so repeat
 * requests for the same item within a short window open a single dialog.
 */
export function openEventEditModal(app: App, event: Model.Event): void {
  const target = eventService.getEventById(event.id) ?? event;

  const now = Date.now();
  if (lastOpen.id === target.id && now - lastOpen.at < 400) return;
  lastOpen = {id: target.id, at: now};

  new EventEditModal(app, target).open();
}
