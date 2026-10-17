import { Shimmer, LoadingStatus, LoadingLines } from '../Skeleton'
import { COATS } from '../../lib/cats'
import { SupportCard } from '../Support'
import { PeekControls } from '../../pages/PeekControls'

export function AccountSkeleton() {
  return <main className="cc-account-page cc-page-skeleton" data-skeleton="account" aria-busy="true">
    <LoadingStatus label="Loading account…" />
    <div className="cc-account-layout">
      <section className="cc-account-profile">
        <h1>Account</h1>
        <div className="cc-profile-label">
          <div className="cc-profile-label-header"><span>FROM</span><Shimmer width="55%" height={20} /></div>
          <div className="cc-profile-label-body">
            <div className="cc-profile-photo-row"><Shimmer width={52} height={52} round /><span>Profile photo</span></div>
            <div className="cc-account-coats">
              <fieldset className="cc-coat-picker cc-coat-picker-names">
                <legend>Your cat</legend>
                <div className="cc-coat-options">
                  {COATS.map(coat => <span className="cc-coat-option" key={coat.key}>
                    <Shimmer width={52} height={52} round />
                    <span className="cc-coat-name">{coat.name}</span>
                  </span>)}
                </div>
              </fieldset>
            </div>
            {['Display name', 'Email'].map(label => <div className="cc-profile-field" key={label}>
              <div><strong>{label}</strong><Shimmer width={170} height={14} /></div>
            </div>)}
          </div>
        </div>
      </section>
      <div className="cc-account-settings">
        <section className="cc-account-contact">
          <div className="cc-contact-heading"><h2>How to reach me</h2></div>
          <p className="cc-contact-value-mobile"><Shimmer width={170} height={18} /></p>
          <p className="cc-contact-helper-desktop">Shown only after an ask is approved, while both of you are active in that cache.</p>
          <p className="cc-contact-helper-mobile">Shown only after an ask is approved.</p>
          <div className="cc-contact-summary"><Shimmer width={170} height={18} /></div>
        </section>
        <div className="cc-account-options">
          <section className="cc-account-push">
            <div className="cc-push-summary">
              <div>
                <h2>
                  <span className="cc-push-title-desktop">Notifications on this device</span>
                  <span className="cc-push-title-mobile">Push notifications</span>
                </h2>
                <p>
                  <span className="cc-push-title-desktop">Push notifications. Otherwise you get email.</span>
                  <span className="cc-push-title-mobile">On this device. Otherwise email.</span>
                </p>
              </div>
              <Shimmer width={48} height={28} />
            </div>
            <LoadingLines label="Loading notification configuration…" />
          </section>
          <PeekControls />
          <section className="cc-account-session">
            <p>Session</p>
            <button disabled className="cc-profile-secondary">Sign out</button>
            <span className="cc-session-mobile-hint">This browser</span>
          </section>
          <SupportCard />
        </div>
      </div>
    </div>
  </main>
}
