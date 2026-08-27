import { localized, React } from 'mailspring-exports';
import { RetinaImg } from 'mailspring-component-kit';
import * as OnboardingActions from './onboarding-actions';

export default class WelcomePage extends React.Component {
  static displayName = 'WelcomePage';

  _onContinue = () => {
    OnboardingActions.moveToPage('tutorial');
  };

  render() {
    return (
      <div className="page welcome">
        <div className="steps-container">
          <div className="brand">
            <RetinaImg
              className="brand-mark"
              url="mailspring://onboarding/assets/daemonmail-mark.svg"
              mode={RetinaImg.Mode.ContentPreserve}
            />
            <p className="brand-wordmark">
              <span className="daemon">daemon</span>
              <span className="mail">Mail</span>
            </p>
            <p className="brand-tagline">Client for the edges of space</p>
          </div>
        </div>
        <div className="footer">
          <button key="next" className="btn btn-large btn-continue" onClick={this._onContinue}>
            {localized('Get Started')}
          </button>
        </div>
      </div>
    );
  }
}
