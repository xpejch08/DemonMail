import _ from 'underscore';
import MailspringStore from 'mailspring-store';
import DatabaseStore from './database-store';
import CategoryStore from './category-store';
import { AccountStore } from './account-store';
import { Thread } from '../models/thread';
import {
  applySmartInboxMatcher,
  SMART_INBOX_BUCKETS,
  SmartInboxBucket,
} from '../models/smart-inbox';

type CountMap = { [bucket in SmartInboxBucket]: { [accountId: string]: number } };

function emptyCounts(): CountMap {
  return {
    wanted: {},
    new: {},
    newsletter: {},
    notification: {},
    hidden: {},
  };
}

class SmartInboxCountsStore extends MailspringStore {
  private _unread: CountMap = emptyCounts();
  private _refreshing = false;
  private _needsRefresh = false;

  constructor() {
    super();
    if (AppEnv.isMainWindow()) {
      const refresh = _.throttle(this._refresh, 1000);
      DatabaseStore.listen((change) => {
        if (change.objectClass === Thread.name) {
          refresh();
        }
      });
      this.listenTo(CategoryStore, refresh);
      this.listenTo(AccountStore, refresh);
      refresh();
    }
  }

  unreadCount(accountIds: string[], bucket: SmartInboxBucket) {
    let sum = 0;
    for (const accountId of accountIds) {
      sum += this._unread[bucket][accountId] || 0;
    }
    return sum;
  }

  _refresh = async () => {
    if (this._refreshing) {
      this._needsRefresh = true;
      return;
    }
    this._refreshing = true;
    try {
      const next = emptyCounts();
      for (const accountId of AccountStore.accountIds()) {
        const inbox = CategoryStore.getCategoryByRole(accountId, 'inbox');
        if (!inbox) {
          continue;
        }
        for (const bucket of SMART_INBOX_BUCKETS) {
          next[bucket][accountId] = await this._countUnread(inbox.id, accountId, bucket);
        }
      }
      this._unread = next;
      this.trigger();
    } finally {
      this._refreshing = false;
      if (this._needsRefresh) {
        this._needsRefresh = false;
        this._refresh();
      }
    }
  };

  async _countUnread(inboxCategoryId: string, accountId: string, bucket: SmartInboxBucket) {
    const query = DatabaseStore.findAll<Thread>(Thread)
      .where([Thread.attributes.categories.containsAny([inboxCategoryId])])
      .where({ inAllMail: true, unread: true, accountId });
    applySmartInboxMatcher(query, bucket);
    const count = await query.count().run();
    return typeof count === 'number' ? count : 0;
  }
}

export default new SmartInboxCountsStore();
