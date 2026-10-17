import { createElement } from 'react'
import { vi } from 'vitest'
import { Toast, type useToast } from '../components/Toast'
import { transientActionFailure } from '../lib/feedback'

export function toastFixture() {
  let notice: ReturnType<typeof useToast>['toast'] = null, sequence = 0
  const showToast = vi.fn((message: string, tone: 'success' | 'error' = 'success') => { notice = { message, tone, sequence: ++sequence } })
  return {
    showToast,
    get notice() { return notice },
    element: () => notice ? createElement(Toast, { toast: notice }) : null,
    modules: {
      '../components/Toast': { Toast, useToast: () => ({ toast: notice, showToast, dismissToast: () => { notice = null } }) },
      '../lib/feedback': { transientActionFailure },
    },
  }
}
