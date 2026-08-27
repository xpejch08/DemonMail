import React from 'react';
import { localized } from 'mailspring-exports';
import { Notification } from 'mailspring-component-kit';
import { senderCategoryStore, PendingSender } from './sender-category-store';
import { stampThreads } from './stamp';
import { DatabaseStore, Thread } from 'mailspring-exports';
import { SmartInboxBucket } from '../../../src/flux/models/smart-inbox';

export default class NewSenderNotification extends React.Component<
  Record<string, unknown>,
  { pending: PendingSender[] }
> {
  static displayName = 'NewSenderNotification';

  unlisten: () => void;

  constructor(props) {
    super(props);
    this.state = { pending: senderCategoryStore.pending() };
  }

  componentDidMount() {
    this.unlisten = senderCategoryStore.listen(() =>
      this.setState({ pending: senderCategoryStore.pending() })
    );
  }

  componentWillUnmount() {
    this.unlisten();
  }

  _onChoose = async (bucket: SmartInboxBucket, rememberDomain: boolean) => {
    const current = this.state.pending[0];
    if (!current) {
      return;
    }
    senderCategoryStore.remember(current.email, bucket, { domain: rememberDomain });
    const thread = await DatabaseStore.find<Thread>(Thread, current.threadId);
    if (thread) {
      stampThreads([thread], bucket);
    }
  };

  render() {
    const current = this.state.pending[0];
    if (!current) {
      return <span />;
    }
    const who =
      current.name && current.name !== current.email
        ? `${current.name} (${current.email})`
        : current.email;
    return (
      <Notification
        priority="3"
        icon="volstead-defaultclient.png"
        title={localized('%@ — keep in Inbox?', who)}
        actions={[
          {
            label: localized('Wanted'),
            fn: () => this._onChoose('wanted', false),
          },
          {
            label: localized('Newsletter'),
            fn: () => this._onChoose('newsletter', true),
          },
          {
            label: localized('Notification'),
            fn: () => this._onChoose('notification', false),
          },
          {
            label: localized('Hide'),
            fn: () => this._onChoose('hidden', true),
          },
        ]}
      />
    );
  }
}
