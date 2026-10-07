import type { ReactNode } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider, useAuth } from './auth/AuthProvider'
import { HomePage } from './pages/HomePage'
import { CachePage } from './pages/CachePage'
import { JoinPage } from './pages/JoinPage'
import { LoginPage } from './pages/LoginPage'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false, refetchOnWindowFocus: false },
  },
})

function Gate({ children }: { children: ReactNode }) {
  const { ready, error, session } = useAuth()
  if (!ready) {
    return (
      <main className="mx-auto max-w-md px-4 py-12">
        <p className="text-slate-600">Starting…</p>
      </main>
    )
  }
  if (error) {
    return (
      <main className="mx-auto max-w-md px-4 py-12">
        <p role="alert" className="text-red-700">
          {error}
        </p>
      </main>
    )
  }
  if (!session) {
    return <Navigate to="/login" replace />
  }
  return children
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/join/:token" element={<JoinPage />} />
            <Route
              path="/"
              element={
                <Gate>
                  <HomePage />
                </Gate>
              }
            />
            <Route
              path="/caches/:id"
              element={
                <Gate>
                  <CachePage />
                </Gate>
              }
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  )
}
