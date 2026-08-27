import { ComponentRegistry, ExtensionRegistry } from 'mailspring-exports';
import { senderCategoryStore } from './sender-category-store';
import * as AccountSidebarExtension from './sidebar-extension';
import NewSenderNotification from './new-sender-notif';
import { FileSmartInboxButton } from './file-thread-button';

export function activate() {
  senderCategoryStore.activate();
  ExtensionRegistry.AccountSidebar.register(AccountSidebarExtension);
  ComponentRegistry.register(NewSenderNotification, { role: 'RootSidebar:Notifications' });
  ComponentRegistry.register(FileSmartInboxButton, { role: 'ThreadActionsToolbarButton' });
}

export function deactivate() {
  ExtensionRegistry.AccountSidebar.unregister(AccountSidebarExtension);
  ComponentRegistry.unregister(NewSenderNotification);
  ComponentRegistry.unregister(FileSmartInboxButton);
}

export function serialize() {}
