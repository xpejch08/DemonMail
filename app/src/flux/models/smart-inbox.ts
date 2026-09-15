import { Matcher } from '../attributes/matcher';
import { Thread } from './thread';
import { Model } from './model';
import ModelQuery from './query';

export const SMART_INBOX_PLUGIN_ID = 'demon-inbox';

export type SmartInboxBucket = 'wanted' | 'new' | 'newsletter' | 'notification' | 'hidden';

export const SMART_INBOX_STAMPED_BUCKETS: SmartInboxBucket[] = [
  'new',
  'newsletter',
  'notification',
  'hidden',
];

export const SMART_INBOX_BUCKETS: SmartInboxBucket[] = ['wanted', ...SMART_INBOX_STAMPED_BUCKETS];

const CATEGORY_IN_CLAUSE = `'new','newsletter','notification','hidden'`;

function metadataCategorySql(klass: typeof Model, predicate: string) {
  return `EXISTS (
    SELECT 1 FROM json_each(CAST(\`${klass.name}\`.\`data\` AS TEXT), '$.metadata')
    WHERE (
      json_extract(value, '$.pluginId') = '${SMART_INBOX_PLUGIN_ID}'
      OR json_extract(value, '$.id') = '${SMART_INBOX_PLUGIN_ID}'
    )
    AND ${predicate}
  )`;
}

/**
 * Filters inbox threads by the JSON category on plugin metadata.
 * Single pluginId so recategorize overwrites one row. json_each avoids
 * Matcher.Not(contains), which INNER JOINs and drops unstamped mail.
 */
export class SmartInboxCategoryMatcher extends Matcher {
  bucket: SmartInboxBucket;

  constructor(bucket: SmartInboxBucket) {
    super(Thread.attributes.pluginMetadata, 'smartInboxCategory', bucket);
    this.bucket = bucket;
  }

  joinSQL() {
    return false;
  }

  whereSQL(klass: typeof Model) {
    if (this.bucket === 'wanted') {
      return `NOT (${metadataCategorySql(
        klass,
        `json_extract(value, '$.value.category') IN (${CATEGORY_IN_CLAUSE})`
      )})`;
    }
    return metadataCategorySql(klass, `json_extract(value, '$.value.category') = '${this.bucket}'`);
  }

  evaluate(model: Model) {
    const category = threadSmartInboxBucket(model as Thread);
    if (this.bucket === 'wanted') {
      return category === 'wanted';
    }
    return category === this.bucket;
  }
}

export function threadSmartInboxBucket(thread: Thread): SmartInboxBucket {
  const value = thread.metadataForPluginId?.(SMART_INBOX_PLUGIN_ID) as { category?: string } | null;
  const category = value?.category;
  if (
    category === 'new' ||
    category === 'newsletter' ||
    category === 'notification' ||
    category === 'hidden' ||
    category === 'wanted'
  ) {
    return category;
  }
  return 'wanted';
}

export function isNonWantedSmartInboxThread(thread: Thread) {
  return threadSmartInboxBucket(thread) !== 'wanted';
}

export function applySmartInboxMatcher(
  query: ModelQuery<Thread | Thread[]>,
  bucket: SmartInboxBucket
) {
  query.where(new SmartInboxCategoryMatcher(bucket));
  return query;
}
