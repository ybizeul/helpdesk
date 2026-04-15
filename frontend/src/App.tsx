import { useState, useCallback } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { AppShell } from '@mantine/core'
import { AppNavbar } from './components/AppNavbar'
import { TicketListPage } from './pages/TicketListPage'
import { TicketDetailPage } from './pages/TicketDetailPage'
import { DashboardPage } from './pages/DashboardPage'
import { SettingsPage } from './pages/SettingsPage'
import { UsersPage } from './pages/UsersPage'
import { LoginPage } from './pages/LoginPage'
import { setAuthToken } from './api/client'

export default function App() {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('token'))

  const handleLogin = useCallback((newToken: string, _user: any) => {
    localStorage.setItem('token', newToken)
    setAuthToken(newToken)
    setToken(newToken)
  }, [])

  const handleLogout = useCallback(() => {
    localStorage.removeItem('token')
    setAuthToken(null)
    setToken(null)
  }, [])

  // Restore token on mount
  if (token) setAuthToken(token)

  if (!token) {
    return <LoginPage onLogin={handleLogin} />
  }

  return (
    <AppShell
      navbar={{ width: 220, breakpoint: 'sm' }}
      padding="md"
    >
      <AppShell.Navbar>
        <AppNavbar onLogout={handleLogout} />
      </AppShell.Navbar>
      <AppShell.Main>
        <Routes>
          <Route path="/" element={<Navigate to="/tickets" replace />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/tickets" element={<TicketListPage />} />
          <Route path="/tickets/:id" element={<TicketDetailPage />} />
          <Route path="/users" element={<UsersPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </AppShell.Main>
    </AppShell>
  )
}
