import {App, Menu, TFile} from 'obsidian';
import {eventService} from '@/services';
import {openEventEditModal} from './EventEditModal';
import {t} from '@/translations/helper';

interface EventContextMenuOptions {
  /** Called once the event has been removed, so custom views can refresh themselves. */
  onDeleted?: (event: Model.Event) => void;
}

/** Event types offered by the "Set type" section of the context menu. */
const EVENT_TYPE_OPTIONS: Array<{type: string; label: () => string}> = [
  {type: 'default', label: () => t('Default')},
  {type: 'TASK-TODO', label: () => t('To-Do')},
  {type: 'TASK-DONE', label: () => t('Done')},
  {type: 'TASK-IN_PROGRESS', label: () => t('In Progress')},
  {type: 'TASK-IMPORTANT', label: () => t('Important')},
];

/**
 * Builds and shows the event context menu shared by every view (calendar, agenda, gantt).
 *
 * @param app Obsidian app instance, used to open the edit modal
 * @param event The event the user right-clicked
 * @param mouseEvent The native mouse event, used to position the menu
 */
export function showEventContextMenu(
  app: App | null,
  event: Model.Event,
  mouseEvent: MouseEvent,
  options: EventContextMenuOptions = {},
): Menu {
  const menu = new Menu();

  menu.addItem((item) =>
    item
      .setTitle(t('Edit event'))
      .setIcon('pencil')
      .onClick(() => {
        if (!app) {
          console.error('App instance not available');
          return;
        }
        openEventEditModal(app, event);
      }),
  );

  menu.addItem((item) =>
    item
      .setTitle(t('Open event note'))
      .setIcon('file-text')
      .onClick(async () => {
        if (!app) {
          console.error('App instance not available');
          return;
        }

        const file = event.path ? app.vault.getFileByPath(event.path) : null;
        if (!(file instanceof TFile)) {
          console.error('Note for event not found:', event.path);
          return;
        }

        // Open in a new tab so the calendar view stays visible
        await app.workspace.getLeaf('tab').openFile(file);
      }),
  );

  menu.addItem((item) =>
    item
      .setTitle(t('Duplicate event'))
      .setIcon('copy')
      .onClick(async () => {
        try {
          await eventService.createEvent(event.title, event.start, event.end);
        } catch (error) {
          console.error('Error duplicating event:', error);
        }
      }),
  );

  menu.addSeparator();

  EVENT_TYPE_OPTIONS.forEach((option) => {
    menu.addItem((item) => {
      const isCurrentType = (event.eventType || 'default') === option.type;
      item
        .setTitle(`${t('Set type: ')}${option.label()}`)
        .setChecked(isCurrentType)
        .setIcon(option.type === 'default' ? 'pencil' : 'check')
        .onClick(async () => {
          if (isCurrentType) return; // No need to update if it's already the current type
          try {
            await eventService.updateEvent(event.id, event.title, option.type, event.start, event.end);
          } catch (error) {
            console.error('Error changing event type:', error);
          }
        });
    });
  });

  menu.addSeparator();

  menu.addItem((item) =>
    item
      .setWarning(true)
      .setTitle(t('Delete event'))
      .setIcon('trash')
      .onClick(async () => {
        try {
          await eventService.deleteEventById(event.id);
          options.onDeleted?.(event);
        } catch (error) {
          console.error('Error deleting event:', error);
        }
      }),
  );

  menu.showAtMouseEvent(mouseEvent);
  return menu;
}
