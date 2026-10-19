import { useEffect, useState } from 'react'
import { dismissInstallHint, finishInstallPrompt, installCopy as copy, installHintDismissed, installHintKey, installPlatform, standaloneMode, useInstallState } from '../lib/install'
import '../install-hint.css'

export function IOSInstallInstructions() {
  return <div className="cc-install-instructions">
    <p>{copy.iosStart}{' '}<span className="cc-install-share"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d="M12 16V3m-4 4 4-4 4 4M7 11H5v10h14V11h-2" /></svg>{copy.share}</span>{copy.then}{' '}<strong>{copy.add}</strong>.</p>
    <p>{copy.notifications}</p>
  </div>
}

export function InstallHint() {
  const install = useInstallState()
  const platform = installPlatform()
  const [dismissed, setDismissed] = useState(installHintDismissed)
  const [pending, setPending] = useState(false)
  useEffect(() => {
    const refresh = () => setDismissed(installHintDismissed())
    const storage = (event: StorageEvent) => { if (event.key === null || event.key === installHintKey(location.origin)) refresh() }
    window.addEventListener('focus', refresh)
    window.addEventListener('storage', storage)
    return () => { window.removeEventListener('focus', refresh); window.removeEventListener('storage', storage) }
  }, [])
  if (dismissed || install.standalone || standaloneMode() || install.installed || platform === 'none' || (platform === 'android' && !install.prompt)) return null

  function dismiss(forever: boolean) {
    dismissInstallHint(forever)
    setDismissed(true)
  }
  async function prompt() {
    const event = install.prompt
    if (!event || pending) return
    setPending(true)
    try { await event.prompt(); await event.userChoice }
    catch { /* Browser-owned install UI may be unavailable or the event already spent. */ }
    finally { finishInstallPrompt(event); setPending(false) }
  }
  return <section className="cc-install-hint" aria-labelledby="install-hint-heading">
    <div>
      <h2 id="install-hint-heading" className="cc-install-title">{copy.heading}</h2>
      {platform === 'ios' ? <IOSInstallInstructions /> : <p>{platform === 'in-app' ? copy.inApp : copy.android}</p>}
    </div>
    <div className="cc-install-actions">
      {platform === 'android' && <button type="button" className="cc-profile-primary" disabled={pending} onClick={() => void prompt()}>{pending ? copy.installing : copy.install}</button>}
      <button type="button" className="cc-text-action" disabled={pending} onClick={() => dismiss(false)}>{copy.notNow}</button>
      <button type="button" className="cc-text-action" disabled={pending} onClick={() => dismiss(true)}>{copy.never}</button>
    </div>
  </section>
}
