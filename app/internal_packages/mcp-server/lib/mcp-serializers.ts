import type { Thread, Message, Category, Contact, File, Calendar } from 'mailspring-exports';
import { CalendarDateUtils } from 'mailspring-exports';
import { isThreadAllowed, isMessageAllowed, isAccountAllowed } from './mcp-access-control';
// Type-only, so this does not pull the calendar package's runtime (Rx,
// ical-expander) into this module. The expansion function itself is imported
// where it is called, in mcp-tools.
import type { EventOccurrence } from '../../main-calendar/lib/core/calendar-data-source';

// Authorization + output-shaping, combined. Every thread/message that leaves
// this process for an MCP client passes through one of these functions,
// which return `null` when the underlying model fails the account/folder
// access-control check — that makes it structurally impossible to add a new
// output field (or a new call site) without it also passing through the
// authorization gate.

function serializeCategory(c: Category) {
  return { id: c.id, name: c.displayName || c.name };
}

function serializeContact(c: Pick<Contact, 'name' | 'email'>) {
  return { name: c.name, email: c.email };
}

function serializeFile(f: File) {
  return {
    id: f.id,
    filename: f.displayName(),
    contentType: f.contentType || null,
    size: f.size,
    isInline: !!f.contentId,
  };
}

export function serializeThreadSummary(
  thread: Thread,
  opts: { includeMessageCount?: boolean } = {}
): Record<string, any> | null {
  if (!isThreadAllowed(thread)) return null;
  const summary: Record<string, any> = {
    id: thread.id,
    subject: thread.subject,
    snippet: thread.snippet,
    unread: thread.unread,
    starred: thread.starred,
    lastMessageReceivedTimestamp: thread.lastMessageReceivedTimestamp,
    participantCount: thread.participants?.length || 0,
    attachmentCount: thread.attachmentCount || 0,
    accountId: thread.accountId,
    categories: (thread.categories || []).map(serializeCategory),
  };
  if (opts.includeMessageCount) {
    summary.messageCount = (thread as any).messageCount || null;
  }
  return summary;
}

export function serializeMessageDetail(message: Message): Record<string, any> | null {
  if (!isMessageAllowed(message)) return null;
  return {
    id: message.id,
    headerMessageId: message.headerMessageId,
    threadId: message.threadId,
    from: message.from?.map(serializeContact),
    to: message.to?.map(serializeContact),
    cc: message.cc?.map(serializeContact),
    bcc: message.bcc?.map(serializeContact),
    subject: message.subject,
    date: message.date,
    body: message.body,
    snippet: message.snippet,
    files: (message.files || []).map(serializeFile),
    unread: message.unread,
    starred: message.starred,
    draft: message.draft,
    replyToHeaderMessageId: message.replyToHeaderMessageId,
    accountId: message.accountId,
  };
}

export function serializeThreadDetail(
  thread: Thread,
  messages: Message[]
): Record<string, any> | null {
  if (!isThreadAllowed(thread)) return null;
  return {
    id: thread.id,
    subject: thread.subject,
    unread: thread.unread,
    starred: thread.starred,
    accountId: thread.accountId,
    lastMessageReceivedTimestamp: thread.lastMessageReceivedTimestamp,
    categories: (thread.categories || []).map(serializeCategory),
    // Folder-excluded messages within an otherwise-allowed thread are
    // dropped here rather than surfaced with a placeholder, matching the
    // "don't confirm existence of excluded data" posture used everywhere
    // else in this package.
    messages: messages
      .map(serializeMessageDetail)
      .filter((m): m is Record<string, any> => m !== null),
  };
}

// ── Calendar ──

export function serializeCalendar(calendar: Calendar): Record<string, any> | null {
  if (!isAccountAllowed(calendar.accountId)) return null;
  return {
    id: calendar.id,
    accountId: calendar.accountId,
    name: calendar.name,
    description: calendar.description || null,
    readOnly: !!calendar.readOnly,
    color: calendar.color || null,
  };
}

// Event descriptions carry whatever the organiser pasted in — Meet boilerplate,
// full HTML newsletters, entire quoted threads. Left whole, a week of events can
// dwarf every other tool's output put together, so the default is a hard cap and
// the caller opts in to more.
const DEFAULT_DESCRIPTION_LIMIT = 500;

/**
 * One expanded occurrence, not one database row: a weekly meeting yields one of
 * these per week inside the queried range, each with its own `start`/`end`.
 *
 * `id` is the occurrence id (`<eventId>-e<startUnix>`), stable for a given
 * occurrence across queries but NOT a database primary key.
 *
 * All-day occurrences carry dates only (`YYYY-MM-DD`, `end` inclusive); timed
 * ones carry ISO 8601 instants. `startDate`/`endDate` give the covered day span
 * either way, so a caller grouping by day never has to branch on `allDay`.
 */
export function serializeEventOccurrence(
  occurrence: EventOccurrence,
  opts: { descriptionLimit?: number } = {}
): Record<string, any> | null {
  if (!isAccountAllowed(occurrence.accountId)) return null;

  const limit = opts.descriptionLimit ?? DEFAULT_DESCRIPTION_LIMIT;
  const description = occurrence.description || '';
  const truncated = limit >= 0 && description.length > limit;

  const startDate = CalendarDateUtils.formatCalendarDate(occurrence.startDate);
  const endDate = CalendarDateUtils.formatCalendarDate(occurrence.endDate);
  const eventIdMatch = occurrence.id.match(/^(.*)-e\d+$/);

  const result: Record<string, any> = {
    id: occurrence.id,
    // Database primary key of the master Event row. `id` is the occurrence
    // key (`<eventId>-e<startUnix>`) and is what write tools accept too.
    eventId: eventIdMatch ? eventIdMatch[1] : occurrence.id,
    accountId: occurrence.accountId,
    calendarId: occurrence.calendarId,
    title: occurrence.title,
    location: occurrence.location || null,
    allDay: occurrence.isAllDay,
    // The covered day span, inclusive both ends, for all-day and timed alike.
    startDate,
    endDate,
    // Cancelled occurrences are kept in the database so a series can show
    // "this one is off"; a caller that just wants the agenda filters them out.
    cancelled: occurrence.isCancelled,
    // TENTATIVE, or invited-and-not-yet-answered by Stepan.
    pending: occurrence.isPending,
    recurring: occurrence.isRecurring,
    recurrenceException: occurrence.isException,
    organizer: occurrence.organizer || null,
    attendees: occurrence.attendees || [],
    description: truncated ? description.slice(0, limit) : description,
  };
  if (truncated) result.descriptionTruncated = true;
  if (occurrence.recurrenceIdStart != null) {
    result.recurrenceIdStart = new Date(occurrence.recurrenceIdStart * 1000).toISOString();
  }

  if (occurrence.isAllDay === false) {
    result.start = new Date(occurrence.start * 1000).toISOString();
    result.end = new Date(occurrence.end * 1000).toISOString();
  } else {
    result.start = startDate;
    result.end = endDate;
  }

  return result;
}
