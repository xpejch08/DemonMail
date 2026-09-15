import MailspringStore from 'mailspring-store';
import {
  DatabaseStore,
  Message,
  Thread,
  AccountStore,
  CategoryStore,
  DatabaseChangeRecord,
} from 'mailspring-exports';
import { SmartInboxBucket, threadSmartInboxBucket } from '../../../src/flux/models/smart-inbox';
import { classifyMessage, domainKey, normalizeEmail } from './classify';
import { stampThreads } from './stamp';

const SENDERS_KEY = 'core.smartInbox.senders';
const BACKFILL_LIMIT = 120;
const STAMP_SCAN_LIMIT = 500;

export interface PendingSender {
  email: string;
  name: string;
  threadId: string;
  accountId: string;
  hint: 'newsletter' | 'notification' | null;
}

class SenderCategoryStore extends MailspringStore {
  private _senders: { [key: string]: SmartInboxBucket } = {};
  private _pending: PendingSender[] = [];
  private _processedIds = new Set<string>();
  private _activated = false;

  constructor() {
    super();
    this._senders = AppEnv.config.get(SENDERS_KEY) || {};
  }

  activate() {
    if (this._activated) {
      return;
    }
    this._activated = true;
    this.listenTo(DatabaseStore, this._onDatabaseChanged);
    AppEnv.config.onDidChange(SENDERS_KEY, () => {
      this._senders = AppEnv.config.get(SENDERS_KEY) || {};
      this.trigger();
    });
    this._backfillInbox();
    setTimeout(() => this._backfillInbox(), 2500);
  }

  lookup(email: string): SmartInboxBucket | null {
    const normalized = normalizeEmail(email);
    if (this._senders[normalized]) {
      return this._senders[normalized];
    }
    const domain = domainKey(normalized);
    if (domain && this._senders[domain]) {
      return this._senders[domain];
    }
    return null;
  }

  pending() {
    return this._pending;
  }

  remember(email: string, bucket: SmartInboxBucket, { domain = false } = {}) {
    const next = { ...this._senders };
    const normalized = normalizeEmail(email);
    next[normalized] = bucket;
    if (domain) {
      const key = domainKey(normalized);
      if (key) {
        next[key] = bucket;
      }
    }
    this._senders = next;
    AppEnv.config.set(SENDERS_KEY, next);
    this._pending = this._pending.filter((p) => p.email !== normalized);
    this.trigger();
    this._stampInboxThreadsFromSender(normalized, bucket, domain);
  }

  dismissPending(email: string) {
    const normalized = normalizeEmail(email);
    this._pending = this._pending.filter((p) => p.email !== normalized);
    this.trigger();
  }

  fileThreads(threads: Thread[], bucket: SmartInboxBucket, rememberDomain: boolean) {
    stampThreads(threads, bucket);
    for (const thread of threads) {
      const sender = senderFromThread(thread);
      if (sender) {
        this.remember(sender.email, bucket, { domain: rememberDomain });
      }
    }
  }

  _onDatabaseChanged = (record: DatabaseChangeRecord<Message | Thread>) => {
    if (record.type !== 'persist') {
      return;
    }
    if (record.objectClass === Thread.name) {
      const unreadInbox = (record.objects as Thread[]).filter((t) => t.unread && isInboxThread(t));
      if (unreadInbox.length > 0) {
        this._applyToInboxThreads(unreadInbox);
      }
      return;
    }
    if (record.objectClass !== Message.name) {
      return;
    }
    const newIds = record.objectsRawJSON
      .filter((json) => json.fullSyncComplete)
      .map((json) => json.id);
    if (newIds.length === 0) {
      return;
    }
    const newMessages = record.objects.filter(
      (m) => newIds.includes(m.id) && !m.draft && !this._processedIds.has(m.id)
    );
    if (newMessages.length === 0) {
      return;
    }
    this._classifyMessages(newMessages);
  };

  async _backfillInbox() {
    try {
      const threads = await DatabaseStore.findAll<Thread>(Thread)
        .where(Thread.attributes.unread.equal(true))
        .order(Thread.attributes.lastMessageReceivedTimestamp.descending())
        .limit(BACKFILL_LIMIT);
      this._applyToInboxThreads(threads);
    } catch (err) {
      console.warn('SmartInbox backfill failed', err);
    }
  }

  _applyToInboxThreads(threads: Thread[]) {
    const toStamp: { [bucket in SmartInboxBucket]?: Thread[] } = {};
    let pendingAdded = false;

    for (const thread of threads) {
      if (!isInboxThread(thread)) {
        continue;
      }
      const sender = senderFromThread(thread);
      if (!sender || AccountStore.accountForEmail(sender.email)) {
        continue;
      }

      const remembered = this.lookup(sender.email);
      if (remembered) {
        pushStamp(toStamp, remembered, thread);
        continue;
      }

      const current = threadSmartInboxBucket(thread);
      if (current === 'newsletter' || current === 'notification' || current === 'hidden') {
        continue;
      }
      if (current !== 'new') {
        pushStamp(toStamp, 'new', thread);
      }
      if (!this._pending.find((p) => p.email === sender.email)) {
        this._pending.push({
          email: sender.email,
          name: sender.name,
          threadId: thread.id,
          accountId: thread.accountId,
          hint: null,
        });
        pendingAdded = true;
      }
    }

    for (const bucket of Object.keys(toStamp) as SmartInboxBucket[]) {
      stampThreads(toStamp[bucket], bucket);
    }
    if (pendingAdded) {
      this.trigger();
    }
  }

  async _stampInboxThreadsFromSender(
    email: string,
    bucket: SmartInboxBucket,
    matchDomain: boolean
  ) {
    const inboxIds = inboxCategoryIds();
    if (inboxIds.length === 0) {
      return;
    }
    try {
      const threads = await DatabaseStore.findAll<Thread>(Thread)
        .where([Thread.attributes.categories.containsAny(inboxIds)])
        .where({ inAllMail: true })
        .order(Thread.attributes.lastMessageReceivedTimestamp.descending())
        .limit(STAMP_SCAN_LIMIT);
      const matches = threads.filter((thread) => senderMatches(thread, email, matchDomain));
      stampThreads(matches, bucket);
    } catch (err) {
      console.warn('SmartInbox stamp-by-sender failed', err);
    }
  }

  async _classifyMessages(messages: Message[]) {
    const toStamp: { [bucket in SmartInboxBucket]?: Thread[] } = {};
    let pendingAdded = false;

    for (const message of messages) {
      const result = classifyMessage(message, this);
      if (!result) {
        this._processedIds.add(message.id);
        continue;
      }
      const thread = await DatabaseStore.find<Thread>(Thread, message.threadId);
      if (!thread || !isInboxThread(thread)) {
        continue;
      }
      this._processedIds.add(message.id);
      if (!result.pending) {
        pushStamp(toStamp, result.bucket, thread);
        continue;
      }
      pushStamp(toStamp, 'new', thread);
      if (!this._pending.find((p) => p.email === result.email)) {
        this._pending.push({
          email: result.email,
          name: result.name,
          threadId: thread.id,
          accountId: thread.accountId,
          hint: result.hint,
        });
        pendingAdded = true;
      }
    }

    for (const bucket of Object.keys(toStamp) as SmartInboxBucket[]) {
      stampThreads(toStamp[bucket], bucket);
    }
    if (pendingAdded) {
      this.trigger();
    }
  }
}

function pushStamp(
  buckets: { [bucket in SmartInboxBucket]?: Thread[] },
  bucket: SmartInboxBucket,
  thread: Thread
) {
  if (!buckets[bucket]) {
    buckets[bucket] = [];
  }
  if (!buckets[bucket].find((t) => t.id === thread.id)) {
    buckets[bucket].push(thread);
  }
}

function inboxCategoryIds() {
  return AccountStore.accountIds()
    .map((id) => {
      const inbox = CategoryStore.getCategoryByRole(id, 'inbox');
      return inbox ? inbox.id : null;
    })
    .filter((id): id is string => !!id);
}

function isInboxThread(thread: Thread) {
  return !!(thread.categories || []).find((c) => c.role === 'inbox');
}

function senderMatches(thread: Thread, email: string, matchDomain: boolean) {
  const sender = senderFromThread(thread);
  if (!sender) {
    return false;
  }
  if (sender.email === email) {
    return true;
  }
  return matchDomain && domainKey(sender.email) === domainKey(email);
}

export function senderFromThread(thread: Thread): { email: string; name: string } | null {
  const others = (thread.participants || []).filter(
    (p) => p.email && !AccountStore.accountForEmail(p.email)
  );
  const contact = others[0] || (thread.participants || [])[0];
  if (!contact || !contact.email) {
    return null;
  }
  return { email: normalizeEmail(contact.email), name: contact.name || contact.email };
}

export const senderCategoryStore = new SenderCategoryStore();
