import { Actions, SyncbackMetadataTask, Thread, SmartInbox } from 'mailspring-exports';
import { SmartInboxBucket } from '../../../src/flux/models/smart-inbox';

export function stampThreads(threads: Thread[], bucket: SmartInboxBucket) {
  const tasks = threads
    .filter((thread) => SmartInbox.threadSmartInboxBucket(thread) !== bucket)
    .map((thread) =>
      SyncbackMetadataTask.forSaving({
        model: thread,
        pluginId: SmartInbox.SMART_INBOX_PLUGIN_ID,
        value: { category: bucket },
      })
    );
  if (tasks.length > 0) {
    Actions.queueTasks(tasks);
  }
}
