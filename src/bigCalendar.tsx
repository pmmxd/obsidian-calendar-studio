import {WorkspaceLeaf, ItemView, TFile, setIcon} from 'obsidian';
import {CALENDAR_VIEW_TYPE, HOVER_LINK_SOURCE} from './constants';
import {extractWikilink} from './utils/wikilink';
import React from 'react';
import ReactDOM from 'react-dom/client';

import App from './App';
import type BigCalendarPlugin from './index';
import {fileService, eventService} from '@/services';
import {isCalendarFile} from '@/obComponents/noteResolver';
import {ViewProvider} from '@/hooks/useView';
import {t} from '@/translations/helper';

export class BigCalendar extends ItemView {
  plugin: BigCalendarPlugin;
  private root: ReactDOM.Root | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: BigCalendarPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getDisplayText(): string {
    return 'Calendar Studio';
  }

  getIcon(): string {
    return 'calendar-with-checkmark';
  }

  getViewType(): string {
    return CALENDAR_VIEW_TYPE;
  }

  private async onFileDeleted(file: TFile): Promise<void> {
    if (isCalendarFile(file)) {
      // Get updates only for this specific file's events
      eventService.clearEventsForFile(file.path);

      // Still need to update our files list, but don't reprocess all events
      await fileService.getAllFiles();
    }
  }

  private async onFileModified(file: TFile): Promise<void> {
    if (isCalendarFile(file) && this.root) {
      // Skip our own writes - the store was already updated optimistically, so a
      // refetch here would just cause a second render (flicker).
      if (eventService.isSelfWrite(file.path)) {
        return;
      }
      // Update only events from this specific file
      await eventService.fetchEventsFromFile(this.app, file);
    }
  }

  /**
   * A note linked inside an item name ("[[note]]") opens Obsidian's page
   * preview while Ctrl (Cmd on macOS) is held, the same way a link behaves in a
   * note. The modifier requirement comes from the registered hover-link source,
   * so it follows the platform automatically.
   *
   * The target is read from the *rendered* name, which only carries the link:
   * the date markers are stripped while parsing, so a note line written as
   * "[[大师傅但是 2026-09-21 ~ 2026-09-23]]" previews "大师傅但是".
   */
  private handleEventHover(evt: MouseEvent): void {
    const target = evt.target as HTMLElement | null;
    const eventEl = target?.closest?.('[data-event-id]') as HTMLElement | null;
    if (!eventEl) return;

    const linktext = extractWikilink(eventEl.textContent);
    if (!linktext) return;

    // The note the item lives in lets Obsidian resolve relative links
    const item = eventEl.dataset.eventId ? eventService.getEventById(eventEl.dataset.eventId) : undefined;

    this.app.workspace.trigger('hover-link', {
      event: evt,
      source: HOVER_LINK_SOURCE,
      hoverParent: this,
      targetEl: eventEl,
      linktext,
      sourcePath: item?.path,
    });
  }

  private onFileCreated(file: TFile): void {
    if (this.app.workspace.layoutReady && this.root) {
      if (isCalendarFile(file)) {
        // Update our files list
        fileService.getAllFiles();

        // Process only events from this new file
        eventService.fetchEventsFromFile(this.app, file);
      }
    }
  }

  async onOpen(): Promise<void> {
    this.onFileCreated = this.onFileCreated.bind(this);
    this.onFileDeleted = this.onFileDeleted.bind(this);
    this.onFileModified = this.onFileModified.bind(this);
    this.handleEventHover = this.handleEventHover.bind(this);

    this.registerEvent(this.app.vault.on('create', this.onFileCreated));
    this.registerEvent(this.app.vault.on('delete', this.onFileDeleted));
    this.registerEvent(this.app.vault.on('modify', this.onFileModified));

    // Delegated: any item element carrying a note link can request a preview
    this.registerDomEvent(this.contentEl, 'mouseover', this.handleEventHover);

    const actionElement = this.addAction('filter', t('Filter'), () => {
      setIcon(actionElement, !this.contentEl.hasClass('filter-open') ? 'filter' : 'filter-x');
      this.contentEl.toggleClass('filter-open', !this.contentEl.hasClass('filter-open'));
    });

    this.root = ReactDOM.createRoot(this.contentEl);
    this.root.render(
      <React.StrictMode>
        <ViewProvider initialView={this}>
          <App />
        </ViewProvider>
      </React.StrictMode>,
    );
  }

  // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
  async onClose() {
    // Clean up React 18 root
    if (this.root) {
      this.root.unmount();
      this.root = null;
    }
  }
}
