import React from 'react';
import { localized, WorkspaceStore } from 'mailspring-exports';
import { senderCategoryStore, PendingSender } from './sender-category-store';
import { SmartInboxBucket } from '../../../src/flux/models/smart-inbox';

const CHOICES: { bucket: SmartInboxBucket; label: () => string; domain: boolean }[] = [
  { bucket: 'wanted', label: () => localized('Wanted'), domain: false },
  { bucket: 'newsletter', label: () => localized('Newsletter'), domain: true },
  { bucket: 'notification', label: () => localized('Notification'), domain: false },
  { bucket: 'hidden', label: () => localized('Hide'), domain: true },
];

function hintCopy(pending: PendingSender) {
  if (pending.hint === 'newsletter') {
    return localized('Looks like a newsletter. Where should mail from this sender go?');
  }
  if (pending.hint === 'notification') {
    return localized('Looks automated. Where should mail from this sender go?');
  }
  return localized('New sender. File this person:');
}

export default class NewSenderNotification extends React.Component<
  Record<string, unknown>,
  { pending: PendingSender[] }
> {
  static displayName = 'NewSenderNotification';
  static containerRequired = false;

  unlisten: () => void;
  unlistenWorkspace: () => void;

  constructor(props) {
    super(props);
    this.state = { pending: senderCategoryStore.pending() };
  }

  componentDidMount() {
    this.unlisten = senderCategoryStore.listen(() =>
      this.setState({ pending: senderCategoryStore.pending() })
    );
    this.unlistenWorkspace = WorkspaceStore.listen(() => this.forceUpdate());
  }

  componentWillUnmount() {
    this.unlisten();
    this.unlistenWorkspace();
  }

  _onChoose = (bucket: SmartInboxBucket, rememberDomain: boolean) => {
    const current = this.state.pending[0];
    if (!current) {
      return;
    }
    senderCategoryStore.remember(current.email, bucket, { domain: rememberDomain });
  };

  render() {
    if (WorkspaceStore.topSheet()?.id === 'Calendar') {
      return <span />;
    }
    const current = this.state.pending[0];
    if (!current) {
      return <span />;
    }
    const who =
      current.name && current.name !== current.email
        ? `${current.name} (${current.email})`
        : current.email;
    const rest = this.state.pending.length - 1;

    return (
      <div
        className="smart-inbox-sender-card"
        role="region"
        aria-label={localized('File new sender')}
      >
        <div className="smart-inbox-sender-card-copy">
          <div className="smart-inbox-sender-card-hint">{hintCopy(current)}</div>
          <div className="smart-inbox-sender-card-who">{who}</div>
          {rest > 0 ? (
            <div className="smart-inbox-sender-card-rest">
              {localized('%@ more new senders waiting', rest)}
            </div>
          ) : null}
        </div>
        <div className="smart-inbox-sender-card-actions">
          {CHOICES.map((choice) => (
            <button
              key={choice.bucket}
              type="button"
              className={`smart-inbox-sender-card-btn${
                current.hint === choice.bucket ? ' suggested' : ''
              }`}
              onClick={() => this._onChoose(choice.bucket, choice.domain)}
            >
              {choice.label()}
            </button>
          ))}
        </div>
      </div>
    );
  }
}
