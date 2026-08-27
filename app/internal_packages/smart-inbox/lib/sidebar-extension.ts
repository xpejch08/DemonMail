import { localized, MailboxPerspective } from 'mailspring-exports';
import { SmartInboxBucket } from '../../../src/flux/models/smart-inbox';

const BUCKETS: { id: string; bucket: SmartInboxBucket; name: () => string; iconName: string }[] = [
  { id: 'smart-inbox-new', bucket: 'new', name: () => localized('New'), iconName: 'unread.png' },
  {
    id: 'smart-inbox-newsletter',
    bucket: 'newsletter',
    name: () => localized('Newsletters'),
    iconName: 'sent.png',
  },
  {
    id: 'smart-inbox-notification',
    bucket: 'notification',
    name: () => localized('Notifications'),
    iconName: 'reminders.png',
  },
  {
    id: 'smart-inbox-hidden',
    bucket: 'hidden',
    name: () => localized('Hidden'),
    iconName: 'archive.png',
  },
];

export const name = 'SmartInboxAccountSidebarExtension';

export function sidebarItems(accountIds: string[]) {
  return BUCKETS.map((item) => ({
    id: item.id,
    name: item.name(),
    iconName: item.iconName,
    perspective: MailboxPerspective.forSmartInbox(accountIds, item.bucket),
    insertAfterInbox: true,
  }));
}
