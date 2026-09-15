# 😈 DemonMail

**A desktop mail and calendar client that your AI agent can actually use.**

DemonMail is a fork of a mature open-source mail client, rebuilt around one idea: the mailbox
should be a first-class tool for an agent, not something an agent scrapes. It ships an **MCP
server inside the app** — 27 tools over `127.0.0.1`, bearer-token authenticated, gated by an
access level you choose, with a per-account allowlist and an audit log you can read in
Preferences.

Everything runs locally. Mail never leaves the machine to reach the agent; the agent talks to
the client that already has your mailbox synced.

<!-- screenshots go here -->

## Why this exists

I drive a personal knowledge vault from my inbox — nightly sweeps that read mail and calendar,
turn them into tasks, and keep project context current. Getting a mail client to cooperate with
that turned out to be the hard part:

- **Vendor CLIs** work until the vendor changes the shape of the data, and they answer the
  questions the vendor thought of, not the ones you have.
- **IMAP-level tooling** gives you raw messages and no client-side state — no idea what's been
  replied to, no labels the way the provider actually applies them.
- **Scraping the client's own database** breaks on every upgrade.

The client already has the sync engine, the folder model, the reply state and the calendar. The
missing piece was a way to ask it questions. So I added one.

## What DemonMail adds

### MCP server, built in

Not a sidecar process — an internal package that starts with the app.

| | |
|---|---|
| Transport | HTTP on `127.0.0.1:2587/mcp`, bearer token |
| Tools | 27 across mail, threads, attachments, calendar and tracking |
| Access levels | `read-only`, `read-write`, `read-write-send` |
| Scope | per-account allowlist — expose one mailbox, hide the rest |
| Audit | every call logged and viewable in Preferences |
| Setup | one click from Preferences generates the client config |

**The access level is a floor, not a suggestion.** At `read-write` the whole `send` category is
refused by the server, so `send_draft` and `schedule_send` cannot fire even if an agent is told
to. Drafting stays available. Raising the level is a deliberate act.

Mail tools: `list_accounts` · `list_folders` · `search_mail` · `list_threads` · `get_thread` ·
`get_message` · `get_attachment` · `create_draft` · `reply_to_thread` · `send_draft` ·
`schedule_send` · `list_scheduled_sends` · `set_unread` · `set_starred` · `set_labels` ·
`move_to_folder` · `archive_threads` · `trash_threads`

Calendar tools: `list_calendars` · `list_events` · `get_event` · `create_event` ·
`update_event` · `delete_event`

Tracking tools: `get_message_tracking` · `list_tracked_messages` · `get_top_links`

`search_mail` takes a Gmail-ish query language — `from:` `to:` `subject:` `in:<folder role>`
`is:unread|read|starred|unstarred` `has:attachment` `since:` `before:` `after:`, combined with
`AND`, `OR`, `NOT` and parentheses. Folder matching is by provider-agnostic **role**, so
`in:sent` works whether the provider calls it `Sent Mail` or `Odeslaná pošta`.

### Calendar as a real surface

The calendar opens as a sheet in the main window instead of hiding in a separate mode, and it is
**writable through MCP** — including recurrence rules, with `scope: this | all` so an agent can
edit one occurrence without rewriting the series. `list_events` returns expanded occurrences,
one row per instance.

### Smart Inbox

Mail is bucketed by sender, and the buckets are remembered. A card above the thread list offers
to file each new sender the first time it appears, one decision per sender rather than a rules
engine to maintain. Buckets and drafts nest under each account's inbox in the sidebar.

### Runs properly on Windows

The upstream project is happiest on macOS. Fixed here: renderer sandboxing, GPU staying alive,
mailbox sharing between processes, protocol path and MIME resolution, the unpackaged app icon,
Gmail accounts that failed to add when SMTP died after IMAP login, and mailsync refusing to
start behind a local TLS interceptor.

### No account, no subscription

Onboarding goes straight to adding your mailbox. No product ID, no subscription step, no
promotional signature appended to your sent mail.

### Demon theme

Dark purple, a restyled folder sidebar, roomier thread rows with rounded selection, and a
rounded reading pane.

## Getting started

```bash
npm install
npm start
```

Other useful scripts: `npm run build`, `npm run lint`, `npm run typecheck`, `npm test`.

To connect an agent: open **Preferences → MCP**, pick an access level, choose which accounts are
exposed, and use the one-click setup to generate the client configuration.

## Status

Personal project, used daily. The MCP server, smart inbox, calendar sheet and Windows fixes are
in active use; expect rough edges elsewhere.

## Licence

GPL-3.0, inherited from the upstream project this is forked from. See [LICENSE.md](LICENSE.md).
