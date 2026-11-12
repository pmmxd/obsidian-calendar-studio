import {App} from 'obsidian';
import EventCreatePrompt from '@/obComponents/EventCreatePrompt';
import {ParentPickerModal} from '@/obComponents/ParentPickerModal';
import {eventService} from '@/services';
import {t} from '@/translations/helper';
import {isAllDaySpan} from '@/utils/eventSpan';
import {draftsToInputs} from '../SubItemEditor';

/**
 * Shared create flow for the Agenda and Gantt views.
 *
 * Asks for the name and any sub-items first; when the resulting item carries a
 * specific time it is a sub-item, so the parent it belongs to is picked before
 * anything is written. The item then lands indented under that parent.
 */
export async function createEventWithPrompt(app: App, presetStart: Date, presetEnd: Date): Promise<void> {
  let result;
  try {
    result = await EventCreatePrompt.Prompt(app, t('Add event'), '', '', presetStart, presetEnd);
  } catch (error) {
    // Prompt cancelled
    return;
  }

  let parent: Model.Event | null = null;
  if (!isAllDaySpan(result.startDate, result.endDate) && ParentPickerModal.hasCandidates()) {
    // Items with a specific time are sub-items of a day-granular parent
    parent = await ParentPickerModal.pick(app);
    if (!parent) return;
  }

  await eventService.createEvent(result.content, result.startDate, result.endDate, {
    children: draftsToInputs(result.children ?? []),
    parent: parent ?? undefined,
  });
}
