import {Plugin, Notice, Platform, FileView} from 'obsidian';
import {BigCalendar} from './bigCalendar';
import {CALENDAR_VIEW_TYPE, HOVER_LINK_SOURCE} from './constants';
import addIcons from './obComponents/customIcons';
import {BigCalendarSettingTab, DEFAULT_SETTINGS, BigCalendarSettings} from './setting';
import {t} from './translations/helper';
import {fileService, eventService, globalService} from './services';

export default class BigCalendarPlugin extends Plugin {
  public settings: BigCalendarSettings;

  async onload(): Promise<void> {
    await this.loadSettings();
    globalService.setPluginSetting(this.settings);

    this.app.workspace.onLayoutReady(() => {
      fileService.setApp(this.app);
      fileService.initAllFiles();
      eventService.fetchAllEvents(this.app);
    });

    // Register view and add icons
    this.registerView(CALENDAR_VIEW_TYPE, (leaf) => new BigCalendar(leaf, this));
    addIcons();

    // A note linked as "[[note]]" inside an item name shows Obsidian's page
    // preview while the modifier key is held, just like a link inside a note.
    // "defaultMod" is Obsidian's platform-aware modifier: Ctrl on Windows and
    // Linux, Cmd on macOS. Users can still change it in the Page preview
    // settings, where this source is listed by name.
    this.registerHoverLinkSource(HOVER_LINK_SOURCE, {
      display: this.manifest.name,
      defaultMod: true,
    });

    // Add ribbon icon
    this.addRibbonIcon('changeTaskStatus', 'Calendar Studio', () => {
      new Notice(t('Open big calendar successfully'));
      this.openCalendar();
    });

    // Add command
    this.addCommand({
        id: 'open-calendar-studio',
      name: t('Open big calendar'),
      callback: () => this.openCalendar(),
      hotkeys: [],
    });

    // Add settings tab
    this.addSettingTab(new BigCalendarSettingTab(this.app, this));
  }

  public async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    // Keep the runtime store in sync so setting changes (e.g. storage mode)
    // take effect without reloading the plugin.
    globalService.setPluginSetting(this.settings);
  }

  onunload(): void {
    this.app.workspace.detachLeavesOfType(CALENDAR_VIEW_TYPE);
    new Notice(t('Close big calendar successfully'));
  }

  async openCalendar(): Promise<void> {
    const workspace = this.app.workspace;
    workspace.detachLeavesOfType(CALENDAR_VIEW_TYPE);

    const leaf = workspace.getLeaf(
      !Platform.isMobile && workspace.activeLeaf && workspace.activeLeaf.view instanceof FileView,
    );

    await leaf.setViewState({type: CALENDAR_VIEW_TYPE});
    workspace.revealLeaf(leaf);
  }
}
