import { localDevAuth } from './local-dev'

type AuthMail = { to: string[]; subject: string; text: string; html?: string }

export async function sendAuthMail(env: {LOCAL_DEV_AUTH?:string;RESEND_API_KEY?:string;EMAIL_FROM:string}, requestUrl: string | undefined, mail: AuthMail) {
  if (localDevAuth(env,requestUrl) && !env.RESEND_API_KEY) {
    console.log(`\n=== LOCAL DEV SIGN-IN MAIL (not sent) ===\nTo: ${mail.to.join(', ')}\nSubject: ${mail.subject}\n\n${mail.text}\n=== END LOCAL DEV SIGN-IN MAIL ===\n`)
    return
  }
  if (!env.RESEND_API_KEY) throw new Error('Auth mail is not configured')
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(10_000),
    headers: {Authorization:`Bearer ${env.RESEND_API_KEY}`,'Content-Type':'application/json'},
    body: JSON.stringify({from:env.EMAIL_FROM,...mail}),
  })
  await response.body?.cancel()
  if (!response.ok) throw new Error('Could not send sign-in email')
}
