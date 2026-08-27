import MailspringStore from 'mailspring-store';
import {
  DatabaseStore,
  Message,
  Thread,
  AccountStore,
  DatabaseChangeRecord,
} from 'mailspring-exports';
import { SmartInboxBucket } from '../../../src/flux/models/smart-inbox';
import { classifyMessage, domainKey, normalizeEmail } from './classify';
import { stampThreads } from './stamp';

const SENDERS_KEY = 'core.smartInbox.senders';
const AUTO_SINCE_KEY = 'MailRules-Auto-Since';

export interface PendingSender {
  email: string;
  name: string;
  threadId: string;
  accountId: string;
}

class SenderCategoryStore extends MailspringStore {
  private _senders: { [key: string]: SmartInboxBucket } = {};
  private _pending: PendingSender[] = [];
  private _autoSince: number;
  private _processedIds = new Set<string>();
  private _activated = false;

  constructor() {
    super();
    this._senders = AppEnv.config.get(SENDERS_KEY) || {};
    this._autoSince = Number(window.localStorage.getItem(AUTO_SINCE_KEY) || Date.now());
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

  _onDatabaseChanged = (record: DatabaseChangeRecord<Message>) => {
    if (record.type !== 'persist' || record.objectClass !== Message.name) {
      return;
    }
    const newIds = record.objectsRawJSON
      .filter((json) => json.fullSyncComplete)
      .map((json) => json.id);
    if (newIds.length === 0) {
      return;
    }
    const newMessages = record.objects.filter(
      (m) =>
        newIds.includes(m.id) &&
        !m.draft &&
        m.date &&
        m.date.valueOf() > this._autoSince &&
        !this._processedIds.has(m.id)
    );
    if (newMessages.length === 0) {
      return;
    }
    for (const message of newMessages) {
      this._processedIds.add(message.id);
    }
    this._classifyMessages(newMessages);
  };

  async _classifyMessages(messages: Message[]) {
    for (const message of messages) {
      const result = classifyMessage(message, this);
      if (!result) {
        continue;
      }
      const thread = await DatabaseStore.find<Thread>(Thread, message.threadId);
      if (!thread || !thread.categories.find((c) => c.role === 'inbox')) {
        continue;
      }
      stampThreads([thread], result.bucket);
      if (result.rememberEmail) {
        this.remember(result.email, result.bucket, { domain: result.rememberDomain });
      }
      if (result.pending && !this._pending.find((p) => p.email === result.email)) {
        this._pending.push({
          email: result.email,
          name: result.name,
          threadId: thread.id,
          accountId: thread.accountId,
        });
        this.trigger();
      }
    }
  }
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
