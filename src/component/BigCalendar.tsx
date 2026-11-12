import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {fileService, eventService} from '@/services';
import {Notice} from 'obsidian';
import CalendarComponent, {EventRefActions} from '@/component/Calendar/Calendar';
import {View, SlotInfo} from 'react-big-calendar';
import {openEventEditModal} from '@/component/Calendar/EventEditModal';
import {useApp, useEvents} from '@/hooks/useStore';
import useCalendarStore from '@/stores/calendarStore';
import {EventCreateResult} from '@/obComponents/EventCreatePrompt';
import {draftsToInputs} from '@/component/Calendar/SubItemEditor';

interface Props {}

const BigCalendar: React.FC<Props> = () => {
  const app = useApp();
  const [isLoading, setIsLoading] = useState(true);
  const eventRef = useRef<EventRefActions>(null);

  // Get calendar state once and prevent re-renders
  const {calendarView, startDay} = useCalendarStore();

  // Fetch data only once when component mounts
  useEffect(() => {
    let isMounted = true;
    const fetchData = async () => {
      try {
        await Promise.all([eventService.fetchAllEvents(app), fileService.getMyAllDailyNotes()]);

        if (isMounted) {
          setIsLoading(false);
        }
      } catch (err) {
        console.error(err);
        if (isMounted) {
          new Notice('Failed to fetch data');
          setIsLoading(false);
        }
      }
    };

    fetchData();

    // Cleanup function to prevent state updates if component unmounts
    return () => {
      isMounted = false;
    };
  }, []);

  // Handle event double click - open the edit modal
  const handleEventDoubleClick = useCallback(
    (event: any) => {
      if (!app) return;
      openEventEditModal(app, event as Model.Event);
    },
    [app],
  );

  // Handle event creation. The file watcher picks up the new line and updates the
  // store once - we intentionally do not also pushEvent (that would render twice).
  const handleEventSelect = useCallback(async (event: EventCreateResult, slotInfo: SlotInfo) => {
    try {
      // Sub-items entered in the dialog are written indented under the new item;
      // a timed item is added to the parent picked before the dialog opened.
      await eventService.createEvent(event.content, event.startDate, event.endDate, {
        children: draftsToInputs(event.children ?? []),
        parent: event.parent,
      });
    } catch (err) {
      console.error(err);
    }
  }, []);

  // Memoize calendar config
  const calendarConfig = useMemo(
    () => ({
      selectable: true,
      resizeable: true,
      StartDate: startDay,
      defaultView: calendarView as View,
      popup: true,
      onEventDoubleClick: handleEventDoubleClick,
      onEventSelect: handleEventSelect,
    }),
    [handleEventDoubleClick, handleEventSelect, calendarView, startDay],
  );

  return (
    <div className="big-calendar-wrapper">
      {isLoading ? <div>Loading...</div> : <CalendarComponent ref={eventRef} {...calendarConfig} />}
    </div>
  );
};

export default BigCalendar;
