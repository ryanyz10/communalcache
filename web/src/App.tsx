import type { ReactNode } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider, useAuth } from './auth/AuthProvider'
import { HomePage } from './pages/HomePage'
import { LibraryPage } from './pages/LibraryPage'
import { CachePage } from './pages/CachePage'
import { ItemPage, ItemEditorPage } from './pages/ItemPages'
import { JoinPage } from './pages/JoinPage'
import { LoginPage } from './pages/LoginPage'
import { MagicLinkPage } from './pages/MagicLinkPage'
import { RequestsPage } from './pages/RequestsPage'
import { RequestDetailPage } from './pages/RequestDetailPage'
import { AccountPage } from './pages/AccountPage'
import { CacheSettingsPage } from './pages/CacheSettingsPage'
import { AppHeader } from './components/AppHeader'
import { RouteSkeleton } from './components/PageSkeletons'
import { LoadingStatus } from './components/Skeleton'
import { hasSessionHint } from './lib/sessionHint'

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } })

export function Ready({ children }: { children: ReactNode }) {
  const { ready, error } = useAuth()
  const { pathname } = useLocation()
  if (!ready) {
    if (!hasSessionHint() || pathname === '/login' || pathname === '/auth/link' || pathname.startsWith('/join/')) return <main className="cc-neutral-loading" aria-busy="true"><LoadingStatus label="Loading…" /></main>
    return <div className="cc-app-shell"><AppHeader loading /><RouteSkeleton pathname={pathname} /></div>
  }
  if (error) return <main className="mx-auto max-w-md px-4 py-12"><p role="alert" className="text-red-700">{error}</p><button onClick={() => location.reload()} className="mt-4 underline">Try again</button></main>
  return children
}

export function AppRoutes() {
  return <Routes>
    <Route path="/login" element={<LoginPage />} />
    <Route path="/auth/link" element={<MagicLinkPage />} />
    <Route path="/join/:token" element={<JoinPage />} />
    <Route path="/" element={<HomePage />} />
    <Route path="/requests" element={<RequestsPage />} />
    <Route path="/requests/:requestId" element={<RequestDetailPage />} />
    <Route path="/items" element={<LibraryPage />} />
    <Route path="/items/new" element={<ItemEditorPage />} />
    <Route path="/items/:itemId" element={<ItemPage />} />
    <Route path="/items/:itemId/edit" element={<ItemEditorPage editing />} />
    <Route path="/account" element={<AccountPage />} />
    <Route path="/caches/:cacheId/settings" element={<CacheSettingsPage />} />
    <Route path="/caches/:cacheId" element={<CachePage />} />
    <Route path="/caches/:cacheId/items/new" element={<ItemEditorPage />} />
    <Route path="/caches/:cacheId/items/:itemId" element={<ItemPage />} />
    <Route path="/caches/:cacheId/items/:itemId/edit" element={<ItemEditorPage editing />} />
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes>
}

export default function App() {
  return <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <BrowserRouter>
        <Ready><div className="cc-app-shell"><AppHeader /><AppRoutes /></div></Ready>
      </BrowserRouter>
    </AuthProvider>
  </QueryClientProvider>
}
