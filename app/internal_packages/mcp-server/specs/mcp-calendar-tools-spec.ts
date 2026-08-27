import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import {
  Actions,
  Calendar,
  DatabaseStore,
  DestroyEventTask,
  Event,
  SyncbackEventTask,
  TaskQueue,
} from 'mailspring-exports';
import { registerTools, clearAuditLog } from '../lib/mcp-tools';

function stubQuery(rows: any[]) {
  const query: any = {
    where() {
      return query;
    },
    then(onFulfilled: any, onRejected: any) {
      return Promise.resolve(rows).then(onFulfilled, onRejected);
    },
  };
  return query;
}

function makeCalendar(fields: Partial<ConstructorParameters<typeof Calendar>[0]> = {}) {
  return new Calendar({
    id: 'cal-1',
    accountId: TEST_ACCOUNT_ID,
    name: 'Work',
    readOnly: false,
    ...fields,
  } as any);
}

describe('MCP calendar tools', function () {
  beforeEach(function () {
    this.server = new McpServer({ name: 'mailspring-spec', version: '0.0.1' });
    registerTools(this.server);
    this.client = new Client({ name: 'mcp-calendar-spec', version: '0.0.1' });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    waitsForPromise(() =>
      Promise.all([this.server.connect(serverTransport), this.client.connect(clientTransport)])
    );
  });

  afterEach(function () {
    clearAuditLog();
    AppEnv.config.set('core.mcp.accessLevel', 'read-only');
    AppEnv.config.set('core.mcp.enabledAccounts', {});
    waitsForPromise(() => this.client.close());
  });

  it('lists calendar tools', function () {
    waitsForPromise(async () => {
      const { tools } = await this.client.listTools();
      const names = tools.map((t) => t.name);
      expect(names).toContain('list_calendars');
      expect(names).toContain('list_events');
      expect(names).toContain('get_event');
      expect(names).toContain('create_event');
      expect(names).toContain('update_event');
      expect(names).toContain('delete_event');
    });
  });

  it('lists calendars for allowed accounts', function () {
    const visible = makeCalendar({ id: 'cal-visible' });
    const hidden = makeCalendar({ id: 'cal-hidden', accountId: 'other-account' });
    spyOn(DatabaseStore, 'findAll').andReturn(stubQuery([visible, hidden]));

    waitsForPromise(async () => {
      const result: any = await this.client.callTool({ name: 'list_calendars', arguments: {} });
      expect(result.isError).toBeFalsy();
      const payload = JSON.parse(result.content[0].text);
      expect(payload.map((c: any) => c.id)).toEqual(['cal-visible', 'cal-hidden']);
    });
  });

  it('hides calendars on excluded accounts', function () {
    const visible = makeCalendar({ id: 'cal-visible' });
    const hidden = makeCalendar({ id: 'cal-hidden', accountId: 'other-account' });
    spyOn(DatabaseStore, 'findAll').andReturn(stubQuery([visible, hidden]));
    AppEnv.config.set('core.mcp.enabledAccounts', {
      [TEST_ACCOUNT_ID]: { enabled: true },
    });

    waitsForPromise(async () => {
      const result: any = await this.client.callTool({ name: 'list_calendars', arguments: {} });
      const payload = JSON.parse(result.content[0].text);
      expect(payload.map((c: any) => c.id)).toEqual(['cal-visible']);
    });
  });

  it('refuses writes on a read-only calendar', function () {
    AppEnv.config.set('core.mcp.accessLevel', 'read-write');
    const calendar = makeCalendar({ id: 'cal-ro', readOnly: true });
    spyOn(DatabaseStore, 'find').andReturn(Promise.resolve(calendar));

    waitsForPromise(async () => {
      const result: any = await this.client.callTool({
        name: 'create_event',
        arguments: {
          calendarId: 'cal-ro',
          title: 'Blocked',
          start: '2026-09-01T10:00:00Z',
          end: '2026-09-01T11:00:00Z',
        },
      });
      expect(result.isError).toBe(true);
      expect(JSON.parse(result.content[0].text).error).toBe("Calendar 'cal-ro' is read-only");
    });
  });

  it('queues DestroyEventTask when deleting a non-recurring event', function () {
    AppEnv.config.set('core.mcp.accessLevel', 'read-write');
    const calendar = makeCalendar();
    const event = new Event({
      id: 'evt-1',
      accountId: TEST_ACCOUNT_ID,
      calendarId: calendar.id,
      ics: [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'BEGIN:VEVENT',
        'UID:evt-1@mailspring',
        'DTSTAMP:20260901T090000Z',
        'DTSTART:20260901T100000Z',
        'DTEND:20260901T110000Z',
        'SUMMARY:Lunch',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n'),
      icsuid: 'evt-1@mailspring',
      recurrenceId: '',
      recurrenceStart: 1788256800,
      recurrenceEnd: 1788260400,
    } as any);
    spyOn(DatabaseStore, 'find').andCallFake((klass: any) => {
      if (klass === Calendar) return Promise.resolve(calendar);
      return Promise.resolve(event);
    });
    spyOn(DatabaseStore, 'findAll').andReturn(stubQuery([event]));
    spyOn(Actions, 'queueTask');
    spyOn(TaskQueue, 'waitForPerformRemote').andReturn(
      Promise.resolve({ status: 'complete' } as any)
    );
    spyOn(DestroyEventTask, 'forRemoving').andCallThrough();
    spyOn(SyncbackEventTask, 'forUpdating');

    waitsForPromise(async () => {
      const result: any = await this.client.callTool({
        name: 'delete_event',
        arguments: { id: 'evt-1' },
      });
      expect(result.isError).toBeFalsy();
      expect(DestroyEventTask.forRemoving).toHaveBeenCalled();
      expect(Actions.queueTask).toHaveBeenCalled();
      expect(SyncbackEventTask.forUpdating).not.toHaveBeenCalled();
    });
  });
});
