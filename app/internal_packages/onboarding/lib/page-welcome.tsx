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
              className="brand-lockup"
              url="mailspring://onboarding/assets/daemonmail-lockup.png"
              mode={RetinaImg.Mode.ContentPreserve}
            />
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
