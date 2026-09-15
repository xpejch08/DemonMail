import { Message, AccountStore, Utils } from 'mailspring-exports';
import { SmartInboxBucket } from '../../../src/flux/models/smart-inbox';

export interface SenderLookup {
  lookup(email: string): SmartInboxBucket | null;
}

export type ClassifyHint = 'newsletter' | 'notification' | null;

export interface ClassifyResult {
  email: string;
  name: string;
  bucket: SmartInboxBucket;
  rememberEmail: boolean;
  rememberDomain: boolean;
  pending: boolean;
  hint: ClassifyHint;
}

export function domainKey(email: string) {
  const at = email.lastIndexOf('@');
  if (at < 0) {
    return null;
  }
  return `@${email.slice(at + 1).toLowerCase()}`;
}

export function normalizeEmail(email: string) {
  return (email || '').trim().toLowerCase();
}

function isOwnAddress(email: string) {
  return !!AccountStore.accountForEmail(email);
}

function isInboxMessage(message: Message) {
  if (message.draft) {
    return false;
  }
  const role = message.folder && (message.folder as any).role;
  return !role || role === 'inbox';
}

export function classifyMessage(message: Message, lookup: SenderLookup): ClassifyResult | null {
  if (!isInboxMessage(message)) {
    return null;
  }
  const from = message.from && message.from[0];
  if (!from || !from.email) {
    return null;
  }
  const email = normalizeEmail(from.email);
  if (!email || isOwnAddress(email)) {
    return null;
  }

  const remembered = lookup.lookup(email);
  if (remembered) {
    return {
      email,
      name: from.name || email,
      bucket: remembered,
      rememberEmail: false,
      rememberDomain: false,
      pending: false,
      hint: null,
    };
  }

  const hint: ClassifyHint =
    message.listUnsubscribe || message.listUnsubscribePost
      ? 'newsletter'
      : Utils.likelyNonHumanEmail(email)
        ? 'notification'
        : null;

  return {
    email,
    name: from.name || email,
    bucket: 'new',
    rememberEmail: false,
    rememberDomain: false,
    pending: true,
    hint,
  };
}
