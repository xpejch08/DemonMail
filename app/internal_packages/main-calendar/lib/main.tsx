import { ipcRenderer } from 'electron';
import { WorkspaceStore, ComponentRegistry, Actions } from 'mailspring-exports';
import { QuickEventButton } from './quick-event-button';
import { MailspringCalendar } from './core/mailspring-calendar';
import { EventSearchBar } from './core/event-search-bar';

function showCalendarSheet() {
  const sheet = WorkspaceStore.Sheet.Calendar;
  if (!sheet) return;
  if (WorkspaceStore.topSheet() !== sheet) {
    Actions.pushSheet(sheet);
  }
}

export function activate() {
  WorkspaceStore.defineSheet(
    'Calendar',
    {},
    {
      list: ['Calendar'],
      split: ['Calendar'],
      splitVertical: ['Calendar'],
    }
  );

  ComponentRegistry.register(MailspringCalendar, {
    location: WorkspaceStore.Location.Calendar,
  });
  ComponentRegistry.register(QuickEventButton, {
    location: WorkspaceStore.Location.Calendar.Toolbar,
  });
  ComponentRegistry.register(EventSearchBar, {
    location: WorkspaceStore.Location.Calendar.Toolbar,
  });

  ipcRenderer.on('show-calendar', showCalendarSheet);
}

export function deactivate() {
  ipcRenderer.removeListener('show-calendar', showCalendarSheet);
  ComponentRegistry.unregister(MailspringCalendar);
  ComponentRegistry.unregister(QuickEventButton);
  ComponentRegistry.unregister(EventSearchBar);
}
