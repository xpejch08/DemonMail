import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  AccountStore,
  Actions,
  Calendar,
  CalendarUtils,
  DatabaseStore,
  DateUtils,
  DestroyEventTask,
  Event,
  ICSEventHelpers,
  Matcher,
  SyncbackEventTask,
  Task,
  TaskQueue,
} from 'mailspring-exports';
import { checkAccountAccess, getAllowedAccountIds, isAccountAllowed } from './mcp-access-control';
import { serializeCalendar, serializeEventOccurrence } from './mcp-serializers';
import {
  isTimed,
  occurrencesForEvents,
  occurrenceStartUnix,
  type EventOccurrence,
} from '../../main-calendar/lib/core/calendar-data-source';

type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean };

type DefineTool = (
  server: McpServer,
  name: string,
  description: string,
  schema: z.ZodRawShape,
  accessCategory: 'read' | 'write' | 'send',
  handler: (args: any) => Promise<ToolResult>
) => void;

type TextResult = (data: any) => ToolResult;
type ErrorResult = (message: string) => ToolResult;

const MAX_LIST = 200;
const MAX_LIST_CAP = 500;
const MAX_RANGE_DAYS = 92;
const OCCURRENCE_ID = /^(.*)-e(\d{9,12})$/;

const attendeeSchema = z.object({
  email: z.string(),
  name: z.string().optional(),
});

function parseDate(value: string, allDay: boolean): Date {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split('-').map(Number);
    return new Date(year, month - 1, day);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid date '${value}'`);
  }
  if (allDay) {
    return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
  }
  return parsed;
}

function toUnix(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}

function parseEventRef(id: string): { eventId: string; occurrenceStart?: number } {
  const match = id.match(OCCURRENCE_ID);
  if (match) {
    return { eventId: match[1], occurrenceStart: Number(match[2]) };
  }
  return { eventId: id };
}

function originalSlotStart(occurrence: EventOccurrence): number {
  return occurrence.recurrenceIdStart ?? occurrenceStartUnix(occurrence);
}

function snapshotEvent(event: Event) {
  return {
    ics: event.ics,
    recurrenceStart: event.recurrenceStart,
    recurrenceEnd: event.recurrenceEnd,
  };
}

function rangeMatcher(startUnix: number, endUnix: number) {
  const start = Event.attributes.recurrenceStart;
  const end = Event.attributes.recurrenceEnd;
  return new Matcher.Or([
    new Matcher.And([start.lte(endUnix), end.gte(startUnix)]),
    new Matcher.And([start.lte(endUnix), start.gte(startUnix)]),
    new Matcher.And([end.gte(startUnix), end.lte(endUnix)]),
    new Matcher.And([end.gte(endUnix), start.lte(startUnix)]),
  ]);
}

function assertWritableCalendar(calendar: Calendar | null, calendarId: string): Calendar {
  if (!calendar) {
    throw new Error(`Calendar '${calendarId}' not found`);
  }
  const err = checkAccountAccess(calendar.accountId);
  if (err) throw new Error(err);
  if (calendar.readOnly) {
    throw new Error(`Calendar '${calendarId}' is read-only`);
  }
  return calendar;
}

async function loadCalendar(calendarId: string): Promise<Calendar | null> {
  const calendar = await DatabaseStore.find<Calendar>(Calendar, calendarId);
  if (!calendar || !isAccountAllowed(calendar.accountId)) return null;
  return calendar;
}

async function loadMasterEvent(event: Event): Promise<Event> {
  if (!event.recurrenceId) return event;
  const related = await DatabaseStore.findAll<Event>(Event).where({ icsuid: event.icsuid });
  return related.find((row) => !row.recurrenceId) || event;
}

async function eventsOverlapping(startUnix: number, endUnix: number, calendarId?: string) {
  let query = DatabaseStore.findAll<Event>(Event).where(rangeMatcher(startUnix, endUnix));
  if (calendarId) {
    query = query.where({ calendarId });
  }
  return query;
}

async function waitForCalendarTask(task: InstanceType<typeof Task>) {
  const finished = await TaskQueue.waitForPerformRemote(task);
  if (finished.status === Task.Status.Cancelled) {
    throw new Error('Calendar task was cancelled');
  }
  return finished;
}

function allowedAccountIdsForQuery(): string[] | null {
  const allIds = AccountStore.accounts().map((a) => a.id);
  if (allIds.length === 0) return null;
  return getAllowedAccountIds(allIds);
}

function notFound(id: string): never {
  throw new Error(`Event '${id}' not found`);
}

async function resolveEventRef(id: string): Promise<{
  event: Event;
  master: Event;
  occurrence: EventOccurrence | null;
  related: Event[];
}> {
  const { eventId, occurrenceStart } = parseEventRef(id);
  const stored = await DatabaseStore.find<Event>(Event, eventId);
  if (!stored || !isAccountAllowed(stored.accountId)) notFound(id);

  const master = await loadMasterEvent(stored);
  const related = await DatabaseStore.findAll<Event>(Event).where({ icsuid: master.icsuid });
  const center = occurrenceStart ?? master.recurrenceStart;
  const occurrences = occurrencesForEvents(related, {
    startUnix: center - 86400,
    endUnix: center + 86400 * 2,
  });

  const occurrence =
    occurrences.find((item) => item.id === id) ||
    (occurrenceStart == null
      ? occurrences.find((item) => item.id.startsWith(`${master.id}-e`)) || occurrences[0]
      : null);

  return { event: stored, master, occurrence: occurrence || null, related };
}

function serializeOccurrences(
  occurrences: EventOccurrence[],
  opts: { includeCancelled?: boolean; descriptionLimit?: number; limit: number }
) {
  const rows = occurrences
    .filter((item) => opts.includeCancelled || !item.isCancelled)
    .sort((a, b) => occurrenceStartUnix(a) - occurrenceStartUnix(b))
    .map((item) => serializeEventOccurrence(item, { descriptionLimit: opts.descriptionLimit }))
    .filter((item): item is Record<string, any> => item !== null);

  return {
    events: rows.slice(0, opts.limit),
    truncated: rows.length > opts.limit,
    total: rows.length,
  };
}

async function createEventOnCalendar(args: {
  calendarId: string;
  title: string;
  start: string;
  end: string;
  allDay?: boolean;
  description?: string;
  location?: string;
  attendees?: Array<{ email: string; name?: string }>;
  recurrenceRule?: string;
  timezone?: string;
}) {
  const calendar = assertWritableCalendar(await loadCalendar(args.calendarId), args.calendarId);
  const allDay = !!args.allDay;
  const start = parseDate(args.start, allDay);
  const end = parseDate(args.end, allDay);
  if (end.getTime() <= start.getTime()) {
    throw new Error('end must be after start');
  }

  const icsuid = ICSEventHelpers.generateUID();
  const ics = ICSEventHelpers.createICSString({
    uid: icsuid,
    summary: args.title,
    start,
    end,
    isAllDay: allDay,
    timezone: args.timezone || DateUtils.timeZone,
    description: args.description,
    location: args.location,
    attendees: args.attendees,
    recurrenceRule: args.recurrenceRule,
  });

  const event = new Event({
    calendarId: calendar.id,
    accountId: calendar.accountId,
    ics,
    icsuid,
    recurrenceStart: toUnix(start),
    recurrenceEnd: toUnix(end),
  });
  event.title = args.title;

  const task = SyncbackEventTask.forCreating({
    event,
    calendarId: calendar.id,
    accountId: calendar.accountId,
  });
  Actions.queueTask(task);
  await waitForCalendarTask(task);

  return {
    id: `${event.id}-e${event.recurrenceStart}`,
    eventId: event.id,
    calendarId: calendar.id,
    accountId: calendar.accountId,
    title: args.title,
  };
}

function applySeriesEdits(
  event: Event,
  edits: {
    title?: string;
    description?: string;
    location?: string;
    startUnix?: number;
    endUnix?: number;
    allDay?: boolean;
    recurrenceRule?: string;
    occurrenceStart?: number;
  }
) {
  let ics = event.ics;
  if (edits.title !== undefined) {
    ics = ICSEventHelpers.updateEventProperty(ics, 'summary', edits.title);
    event.title = edits.title;
  }
  if (edits.description !== undefined) {
    ics = ICSEventHelpers.updateEventProperty(ics, 'description', edits.description);
  }
  if (edits.location !== undefined) {
    ics = ICSEventHelpers.updateEventProperty(ics, 'location', edits.location);
  }
  if (edits.recurrenceRule !== undefined) {
    ics = ICSEventHelpers.updateRecurrenceRule(ics, edits.recurrenceRule || null);
  }

  const timesChanged = edits.startUnix !== undefined || edits.endUnix !== undefined;
  if (timesChanged) {
    const startUnix = edits.startUnix ?? event.recurrenceStart;
    const endUnix = edits.endUnix ?? event.recurrenceEnd;
    const isAllDay = edits.allDay ?? false;
    if (ICSEventHelpers.isRecurringEvent(ics) && edits.occurrenceStart != null) {
      ics = ICSEventHelpers.updateRecurringEventTimes(
        ics,
        edits.occurrenceStart,
        startUnix,
        endUnix,
        isAllDay
      );
      const deltaMs = (startUnix - edits.occurrenceStart) * 1000;
      if (deltaMs !== 0) {
        ics = ICSEventHelpers.shiftInlineExceptions(ics, deltaMs);
      }
    } else {
      ics = ICSEventHelpers.updateEventTimes(ics, {
        start: startUnix,
        end: endUnix,
        isAllDay,
        timezone: DateUtils.timeZone,
      });
    }
    const { event: parsed } = CalendarUtils.parseICSString(ics);
    event.recurrenceStart = parsed.startDate.toJSDate().getTime() / 1000;
    event.recurrenceEnd = parsed.endDate.toJSDate().getTime() / 1000;
  }

  event.ics = ics;
}

function applyOccurrenceEdits(
  master: Event,
  occurrence: EventOccurrence,
  edits: {
    title?: string;
    description?: string;
    location?: string;
    startUnix?: number;
    endUnix?: number;
    allDay?: boolean;
  }
) {
  const newStart = edits.startUnix ?? occurrenceStartUnix(occurrence);
  const newEnd =
    edits.endUnix ??
    (isTimed(occurrence) ? occurrence.end : occurrenceStartUnix(occurrence) + 86400);
  const isAllDay = edits.allDay ?? occurrence.isAllDay;
  const { masterIcs, recurrenceId } = ICSEventHelpers.createRecurrenceException(
    master.ics,
    originalSlotStart(occurrence),
    newStart,
    newEnd,
    isAllDay
  );
  master.ics = ICSEventHelpers.applyEditsToException(masterIcs, recurrenceId, {
    summary: edits.title,
    description: edits.description,
    location: edits.location,
  });
  master.recurrenceStart = newStart;
  master.recurrenceEnd = newEnd;
}

export function registerCalendarTools(
  server: McpServer,
  defineTool: DefineTool,
  textResult: TextResult,
  errorResult: ErrorResult
) {
  defineTool(
    server,
    'list_calendars',
    'List calendars on mailboxes enabled for MCP. `readOnly: true` calendars can be queried but not written.',
    { accountId: z.string().optional().describe('Restrict to a single account') },
    'read',
    async ({ accountId }) => {
      if (accountId) {
        const err = checkAccountAccess(accountId);
        if (err) return errorResult(err);
      }

      let query = DatabaseStore.findAll<Calendar>(Calendar);
      if (accountId) {
        query = query.where({ accountId });
      } else {
        const allowedIds = allowedAccountIdsForQuery();
        if (allowedIds && allowedIds.length === 0) return textResult([]);
        if (allowedIds) {
          query = query.where(Calendar.attributes.accountId.in(allowedIds));
        }
      }

      const calendars = await query;
      return textResult(
        calendars.map(serializeCalendar).filter((row): row is Record<string, any> => row !== null)
      );
    }
  );

  defineTool(
    server,
    'list_events',
    'List expanded calendar occurrences in a date range. Recurring series yield one row per occurrence. Pass `id` from this result to get_event / update_event / delete_event. Range must be ≤ 92 days.',
    {
      start: z.string().describe('Range start: ISO 8601 instant or YYYY-MM-DD'),
      end: z.string().describe('Range end: ISO 8601 instant or YYYY-MM-DD'),
      calendarId: z.string().optional(),
      accountId: z.string().optional(),
      includeCancelled: z.boolean().optional(),
      descriptionLimit: z.number().int().optional(),
      limit: z.number().int().min(1).max(MAX_LIST_CAP).optional(),
    },
    'read',
    async ({ start, end, calendarId, accountId, includeCancelled, descriptionLimit, limit }) => {
      const startUnix = toUnix(parseDate(start, false));
      const endUnix = toUnix(parseDate(end, false));
      if (endUnix <= startUnix) return errorResult('end must be after start');
      if (endUnix - startUnix > MAX_RANGE_DAYS * 86400) {
        return errorResult(`Date range must be ${MAX_RANGE_DAYS} days or less`);
      }

      if (accountId) {
        const err = checkAccountAccess(accountId);
        if (err) return errorResult(err);
      }
      if (calendarId) {
        const calendar = await loadCalendar(calendarId);
        if (!calendar) return errorResult(`Calendar '${calendarId}' not found`);
      }

      let rows = await eventsOverlapping(startUnix, endUnix, calendarId);
      if (accountId) {
        rows = rows.filter((event) => event.accountId === accountId);
      } else {
        const allowedIds = allowedAccountIdsForQuery();
        if (allowedIds && allowedIds.length === 0) {
          return textResult({ events: [], truncated: false, total: 0 });
        }
        if (allowedIds) {
          const allowed = new Set(allowedIds);
          rows = rows.filter((event) => allowed.has(event.accountId));
        }
      }

      const occurrences = occurrencesForEvents(rows, { startUnix, endUnix });
      return textResult(
        serializeOccurrences(occurrences, {
          includeCancelled: !!includeCancelled,
          descriptionLimit,
          limit: limit ?? MAX_LIST,
        })
      );
    }
  );

  defineTool(
    server,
    'get_event',
    'Read one calendar occurrence. `id` is the occurrence id from list_events, or the database event id.',
    { id: z.string() },
    'read',
    async ({ id }) => {
      const { occurrence } = await resolveEventRef(id);
      if (!occurrence) return errorResult(`Event '${id}' not found`);
      const serialized = serializeEventOccurrence(occurrence);
      if (!serialized) return errorResult(`Event '${id}' not found`);
      return textResult(serialized);
    }
  );

  defineTool(
    server,
    'create_event',
    'Create an event on a mailbox calendar. Requires MCP access level read-write. Timed times are ISO 8601; all-day dates are YYYY-MM-DD. Recurrence is an RRULE string (e.g. FREQ=WEEKLY;BYDAY=MO).',
    {
      calendarId: z.string(),
      title: z.string(),
      start: z.string(),
      end: z.string(),
      allDay: z.boolean().optional(),
      description: z.string().optional(),
      location: z.string().optional(),
      attendees: z.array(attendeeSchema).optional(),
      recurrenceRule: z.string().optional(),
      timezone: z.string().optional().describe('IANA timezone, defaults to the app timezone'),
    },
    'write',
    async (args) => textResult(await createEventOnCalendar(args))
  );

  defineTool(
    server,
    'update_event',
    'Update an event. `id` from list_events. For recurring series, scope=this edits that occurrence (default when `id` is an occurrence); scope=all edits the series. Requires MCP access level read-write.',
    {
      id: z.string(),
      title: z.string().optional(),
      start: z.string().optional(),
      end: z.string().optional(),
      allDay: z.boolean().optional(),
      description: z.string().optional(),
      location: z.string().optional(),
      recurrenceRule: z.string().optional(),
      scope: z.enum(['this', 'all']).optional(),
    },
    'write',
    async ({ id, title, start, end, allDay, description, location, recurrenceRule, scope }) => {
      const { master, occurrence } = await resolveEventRef(id);
      const calendar = assertWritableCalendar(
        await loadCalendar(master.calendarId),
        master.calendarId
      );

      const isRecurring = ICSEventHelpers.isRecurringEvent(master.ics);
      const { occurrenceStart } = parseEventRef(id);
      const resolvedScope = scope || (isRecurring && occurrenceStart != null ? 'this' : 'all');
      if (resolvedScope === 'this' && (!isRecurring || !occurrence)) {
        if (isRecurring) {
          return errorResult(
            'scope=this needs an occurrence id from list_events, not the series event id'
          );
        }
      }

      const allDayFlag = allDay ?? occurrence?.isAllDay ?? false;
      const startUnix = start !== undefined ? toUnix(parseDate(start, allDayFlag)) : undefined;
      const endUnix = end !== undefined ? toUnix(parseDate(end, allDayFlag)) : undefined;
      if (startUnix != null && endUnix != null && endUnix <= startUnix) {
        return errorResult('end must be after start');
      }

      const undoData = snapshotEvent(master);
      if (resolvedScope === 'this' && isRecurring && occurrence) {
        applyOccurrenceEdits(master, occurrence, {
          title,
          description,
          location,
          startUnix,
          endUnix,
          allDay: allDayFlag,
        });
      } else {
        applySeriesEdits(master, {
          title,
          description,
          location,
          startUnix,
          endUnix,
          allDay: allDayFlag,
          recurrenceRule,
          occurrenceStart: occurrence ? originalSlotStart(occurrence) : occurrenceStart,
        });
      }

      const task = SyncbackEventTask.forUpdating({
        event: master,
        undoData,
        description: resolvedScope === 'this' ? 'Edit occurrence' : 'Edit event',
      });
      Actions.queueTask(task);
      await waitForCalendarTask(task);
      return textResult({ updated: true, id, eventId: master.id, calendarId: calendar.id });
    }
  );

  defineTool(
    server,
    'delete_event',
    'Delete an event. `id` from list_events. For recurring series, scope=this excludes that occurrence (default when `id` is an occurrence); scope=all deletes the series. Requires MCP access level read-write.',
    {
      id: z.string(),
      scope: z.enum(['this', 'all']).optional(),
    },
    'write',
    async ({ id, scope }) => {
      const { master, occurrence, related } = await resolveEventRef(id);
      assertWritableCalendar(await loadCalendar(master.calendarId), master.calendarId);

      const isRecurring = ICSEventHelpers.isRecurringEvent(master.ics);
      const { occurrenceStart } = parseEventRef(id);
      const resolvedScope = scope || (isRecurring && occurrenceStart != null ? 'this' : 'all');

      if (resolvedScope === 'this' && isRecurring) {
        if (!occurrence) {
          return errorResult(
            'scope=this needs an occurrence id from list_events, not the series event id'
          );
        }
        const undoData = snapshotEvent(master);
        master.ics = ICSEventHelpers.addExclusionDate(
          master.ics,
          originalSlotStart(occurrence),
          occurrence.isAllDay
        );
        const task = SyncbackEventTask.forUpdating({
          event: master,
          undoData,
          description: 'Delete occurrence',
        });
        Actions.queueTask(task);
        await waitForCalendarTask(task);
        return textResult({ deleted: true, scope: 'this', id, eventId: master.id });
      }

      const toRemove = related.length ? related : [master];
      const task = DestroyEventTask.forRemoving({ events: toRemove });
      Actions.queueTask(task);
      await waitForCalendarTask(task);
      return textResult({ deleted: true, scope: 'all', eventId: master.id });
    }
  );
}
