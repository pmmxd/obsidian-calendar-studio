import React, {useCallback} from 'react';
import {App, Modal, moment, setIcon} from 'obsidian';
import useFileStore from '@/stores/fileStore';
import useCalendarStore, {ListRange} from '@/stores/calendarStore';
import {ToolbarProps, View, NavigateAction} from 'react-big-calendar';
import '@/less/time-select.less';
import {t} from '@/translations/helper';
import {AGENDA_RANGES, GANTT_RANGES, agendaRange, ganttRange} from './views/dateRange';

// Using the ToolbarProps interface from react-big-calendar
const CustomToolbar: React.FC<ToolbarProps<any, object>> = (props) => {
  const {
    localizer: {messages},
    label,
    view,
    views,
    onNavigate,
    onView,
    date, // Added date from ToolbarProps
  } = props;

  const app = useFileStore((state) => state.app);
  const listRange = useCalendarStore((state) => state.listRange);
  const setListRange = useCalendarStore((state) => state.setListRange);

  // Localized labels for the view buttons
  const viewLabel = useCallback((name: string): string => {
    switch (name) {
      case 'month':
        return t('Month');
      case 'week':
        return t('Week');
      case 'day':
        return t('Day');
      case 'agenda':
        return t('Agenda');
      case 'gantt':
        return t('Gantt');
      case 'biweek':
        return t('Bi-week');
      default:
        return messages[name];
    }
  }, [messages]);

  // Range tabs are per view: the Agenda offers 上周, the Gantt offers 下周
  const viewName = view as string;
  const rangeTabs: ListRange[] = viewName === 'agenda' ? AGENDA_RANGES : viewName === 'gantt' ? GANTT_RANGES : [];
  const activeRange =
    viewName === 'gantt' ? ganttRange(listRange) : viewName === 'agenda' ? agendaRange(listRange) : listRange;

  const rangeLabel = useCallback((range: ListRange): string => {
    switch (range) {
      case 'week':
        return t('This week');
      case 'lastweek':
        return t('Last week');
      case 'nextweek':
        return t('Next week');
      case 'rolling':
        return t('Last 30 days');
      default:
        return t('This month');
    }
  }, []);

  // Switch the Agenda/Gantt time window and reset to today
  const handleRangeChange = useCallback(
    (range: ListRange) => {
      setListRange(range, app);
      onNavigate('TODAY' as NavigateAction);
    },
    [setListRange, app, onNavigate],
  );

  // Handle navigation actions (Today, Previous, Next)
  const handleNavigate = useCallback(
    (action: NavigateAction) => {
      onNavigate(action);
    },
    [onNavigate],
  );

  // Handle view changes (Month, Week, Day, Agenda)
  const handleView = useCallback(
    (newView: View) => {
      onView(newView);
    },
    [onView],
  );

  // Handle date label click - show date picker
  const handleDateLabelClick = useCallback(async () => {
    if (!app) return;

    // Create and show the date picker
    const datePicker = new DatePickerModal(app, (newDate) => {
      // Navigate to the selected date with the DATE action
      onNavigate('DATE' as NavigateAction, newDate);
    });

    // Initialize with current calendar date
    datePicker.setInitialDate(date);
    datePicker.open();
  }, [app, onNavigate, date]);

  // Render view buttons
  const renderViewButtons = useCallback(() => {
    // Convert views object to array of keys
    const viewNames = ['month', 'week', 'biweek', 'day', 'agenda', 'gantt'];

    if (viewNames.length > 1) {
      return viewNames.map((name) => (
        <button
          type="button"
          key={name}
          className={view === name ? 'rbc-active' : ''}
          onClick={() => handleView(name as View)}
        >
          {viewLabel(name)}
        </button>
      ));
    }
    return null;
  }, [views, view, viewLabel, handleView]);

  return (
    <div className="rbc-toolbar">
      <span className="rbc-btn-group">
        <button type="button" onClick={() => handleNavigate('TODAY' as NavigateAction)}>
          {t('Today')}
        </button>
        <button type="button" onClick={() => handleNavigate('PREV' as NavigateAction)}>
          {t('Back')}
        </button>
        <button type="button" onClick={() => handleNavigate('NEXT' as NavigateAction)}>
          {t('Next')}
        </button>
      </span>

      <span
        aria-label={t('Select a date')}
        className="rbc-toolbar-label"
        onClick={handleDateLabelClick}
        style={{cursor: 'pointer'}}
      >
        <span
          ref={(ref) => {
            if (!ref) return;

            setIcon(ref, 'calendar-search');
          }}
        ></span>
        {label}
      </span>

      <span className="rbc-btn-group">{renderViewButtons()}</span>

      {rangeTabs.length > 0 && (
        <span className="rbc-btn-group bc-range-tab">
          {rangeTabs.map((range) => (
            <button
              type="button"
              key={range}
              className={activeRange === range ? 'rbc-active' : ''}
              onClick={() => handleRangeChange(range)}
            >
              {rangeLabel(range)}
            </button>
          ))}
        </span>
      )}
    </div>
  );
};

// Modal for Date Picker - properly extending Obsidian's Modal class
class DatePickerModal extends Modal {
  private onDateSelected: (date: Date) => void;
  private initialDate: Date;

  constructor(app: App, onDateSelected: (date: Date) => void) {
    super(app);
    this.onDateSelected = onDateSelected;
    this.initialDate = new Date();
  }

  setInitialDate(date: Date) {
    this.initialDate = date;
    return this;
  }

  onOpen() {
    // Set title
    this.titleEl.setText(t('Select a date'));

    // Add content container with the class from our CSS
    const containerEl = this.contentEl.createDiv();
    containerEl.className = 'date-picker-container';

    // Current date display
    const currentDateDisplay = containerEl.createDiv({cls: 'current-date-display'});

    // Update the display when date changes
    const updateDateDisplay = (date: Date) => {
      currentDateDisplay.setText(moment(date).format('dddd, MMMM D, YYYY'));
    };

    // Set initial date display
    updateDateDisplay(this.initialDate);

    // Date input
    const dateInput = containerEl.createEl('input', {cls: 'date-input'});
    dateInput.type = 'date';
    dateInput.value = moment(this.initialDate).format('YYYY-MM-DD');

    // Update display when date input changes
    dateInput.addEventListener('change', () => {
      updateDateDisplay(moment(dateInput.value).toDate());
    });

    // Today button
    const todayButton = containerEl.createEl('button', {
      text: t('Today'),
      cls: 'today-button mod-cta',
    });

    todayButton.addEventListener('click', () => {
      const today = new Date();
      dateInput.value = moment(today).format('YYYY-MM-DD');
      updateDateDisplay(today);
    });

    // Buttons container
    const buttonsContainer = containerEl.createDiv({cls: 'buttons-container'});

    // Cancel button
    const cancelButton = buttonsContainer.createEl('button', {
      text: t('Cancel'),
      cls: 'mod-warning',
    });

    cancelButton.addEventListener('click', () => {
      this.close();
    });

    // OK button
    const okButton = buttonsContainer.createEl('button', {
      text: t('Go to date'),
      cls: 'mod-cta',
    });

    okButton.addEventListener('click', () => {
      const selectedDate = moment(dateInput.value).toDate();
      this.onDateSelected(selectedDate);
      this.close();
    });

    // Add keyboard event for Enter key
    this.scope.register([], 'Enter', (evt) => {
      const selectedDate = moment(dateInput.value).toDate();
      this.onDateSelected(selectedDate);
      this.close();
      return false;
    });

    // Focus the date input
    setTimeout(() => {
      dateInput.focus();
    }, 10);
  }

  onClose() {
    // Clear the content to prevent memory leaks
    this.contentEl.empty();
  }
}

export default CustomToolbar;
