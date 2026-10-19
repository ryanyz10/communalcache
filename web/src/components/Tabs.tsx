import type { ReactNode } from 'react'
import { Link, useLocation } from 'react-router'
import { Avatar } from './Avatar'
import { Shimmer } from './Skeleton'
import type { CatCoat } from '../lib/cats'

type Tab = 'caches' | 'items' | 'requests' | 'you'
const tabs: { id: Tab; label: string; to: string }[] = [
  { id: 'caches', label: 'Caches', to: '/' },
  { id: 'items', label: 'Your items', to: '/items' },
  { id: 'requests', label: 'Requests', to: '/requests' },
  { id: 'you', label: 'You', to: '/account' },
]

function TabIcon({ tab }: { tab: Exclude<Tab, 'you'> }) {
  return <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    {tab === 'caches' && <>
      <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
      <path d="m3.3 7 8.7 5 8.7-5M12 22V12" />
    </>}
    {tab === 'items' && <>
      <path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z" />
      <circle cx="7.5" cy="7.5" r=".5" />
    </>}
    {tab === 'requests' && <>
      <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
      <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
    </>}
  </svg>
}

export function Tabs({ mobile = false, count, userId, name, coat, photoVersion }: {
  mobile?: boolean
  count: number
  userId?: string
  name?: string
  coat?: CatCoat | null
  photoVersion?: string | null
}) {
  const { pathname } = useLocation()
  let active: Tab = 'caches'
  if (pathname === '/items' || pathname.startsWith('/items/')) active = 'items'
  else if (pathname === '/requests' || pathname.startsWith('/requests/')) active = 'requests'
  else if (pathname === '/account') active = 'you'

  return <nav aria-label={mobile ? 'Mobile navigation' : 'Desktop navigation'} className={`cc-tabs ${mobile ? 'cc-tabs-mobile' : 'cc-tabs-desktop'}`}>
    {tabs.filter(tab => mobile || tab.id !== 'you').map(tab => {
      let icon: ReactNode
      if (mobile) {
        if (tab.id !== 'you') icon = <TabIcon tab={tab.id} />
        else if (userId && name) icon = <Avatar userId={userId} name={name} photoVersion={photoVersion} coat={coat} size={24} />
        else icon = <Shimmer width={24} height={24} round />
      }
      return <Link
        key={tab.id} to={tab.to} data-tour={tab.id === 'caches' ? undefined : tab.id === 'you' ? 'account' : tab.id} aria-current={active === tab.id ? 'page' : undefined}
        aria-label={tab.id === 'requests' && count > 0 ? `Requests, ${count} ${count === 1 ? 'ask needs' : 'asks need'} your answer` : undefined}
      >
        {icon}
        <span>{tab.label}</span>
        {tab.id === 'requests' && count > 0 && <span aria-hidden="true" className="cc-tab-badge">{count}</span>}
      </Link>
    })}
  </nav>
}
