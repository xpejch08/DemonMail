import React from 'react';
import ReactDOM from 'react-dom';
import { localized, Actions, Thread } from 'mailspring-exports';
import { senderCategoryStore, senderFromThread } from './sender-category-store';
import { SmartInboxBucket } from '../../../src/flux/models/smart-inbox';
import { domainKey } from './classify';

const CHOICES: { bucket: SmartInboxBucket; label: () => string }[] = [
  { bucket: 'wanted', label: () => localized('Wanted') },
  { bucket: 'newsletter', label: () => localized('Newsletter') },
  { bucket: 'notification', label: () => localized('Notification') },
  { bucket: 'hidden', label: () => localized('Hidden') },
];

function askRememberDomain(email: string): boolean | null {
  const domain = domainKey(email);
  if (!domain) {
    return false;
  }
  const response = require('@electron/remote').dialog.showMessageBoxSync({
    type: 'question',
    message: localized('Apply to this sender only, or the whole domain?'),
    detail: email,
    buttons: [
      localized('This address'),
      localized('Everyone at %@', domain.slice(1)),
      localized('Cancel'),
    ],
    defaultId: 0,
    cancelId: 2,
  });
  if (response === 2) {
    return null;
  }
  return response === 1;
}

class FileSmartInboxPopover extends React.Component<{ threads: Thread[] }> {
  _onChoose = (bucket: SmartInboxBucket) => {
    const { threads } = this.props;
    const sender = senderFromThread(threads[0]);
    Actions.closePopover();
    const rememberDomain = sender ? askRememberDomain(sender.email) : false;
    if (rememberDomain === null) {
      return;
    }
    senderCategoryStore.fileThreads(threads, bucket, rememberDomain);
  };

  render() {
    return (
      <div className="menu" style={{ minWidth: 180, padding: 6 }}>
        {CHOICES.map((choice) => (
          <div
            key={choice.bucket}
            className="item"
            onClick={() => this._onChoose(choice.bucket)}
            style={{ padding: '6px 10px', cursor: 'pointer' }}
          >
            {choice.label()}
          </div>
        ))}
      </div>
    );
  }
}

export class FileSmartInboxButton extends React.Component<{ items: Thread[] }> {
  static displayName = 'FileSmartInboxButton';
  static containerRequired = false;

  _onClick = (event?: React.MouseEvent) => {
    if (event) {
      event.stopPropagation();
    }
    const node = ReactDOM.findDOMNode(this) as HTMLElement;
    Actions.openPopover(<FileSmartInboxPopover threads={this.props.items} />, {
      originRect: node.getBoundingClientRect(),
      direction: 'down',
    });
  };

  render() {
    if (!this.props.items || this.props.items.length === 0) {
      return <span />;
    }
    return (
      <button
        tabIndex={-1}
        className="btn btn-toolbar"
        title={localized('File sender')}
        onClick={this._onClick}
      >
        {localized('File')}
      </button>
    );
  }
}
