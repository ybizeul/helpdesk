import { useState, useCallback } from 'react'
import { Routes, Route, Navigate, useNavigate, useParams } from 'react-router-dom'
import { AppShell, Box } from '@mantine/core'
import { AppNavbar } from './components/AppNavbar'
import { TicketListPage } from './pages/TicketListPage'
import { TicketDetailPage } from './pages/TicketDetailPage'
import { DashboardPage } from './pages/DashboardPage'
import { SettingsPage } from './pages/SettingsPage'
import { UsersPage } from './pages/UsersPage'
import { LoginPage } from './pages/LoginPage'
import { setAuthToken } from './api/client'

function TicketPanes() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  return (
    <Box style={{ display: 'flex', height: 'calc(100vh - 32px)', gap: 0 }}>
      <Box
        style={{
          width: id ? 420 : '100%',
          minWidth: id ? 320 : undefined,
          flexShrink: 0,
          overflowY: 'auto',
          borderRight: id ? '1px solid var(--mantine-color-gray-3)' : undefined,
          padding: 'var(--mantine-spacing-md)',
          transition: 'width 150ms ease',
        }}
      >
        <TicketListPage
          activeTicketId={id || null}
          onSelectTicket={(ticketId) => navigate(`/tickets/${ticketId}`)}
        />
      </Box>
      {id && (
        <Box style={{ flex: 1, overflowY: 'auto', padding: 'var(--mantine-spacing-md)', minWidth: 0 }}>
          <TicketDetailPage ticketId={id} />
        </Box>
      )}
    </Box>
  )
}

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
      padding={0}
    >
      <AppShell.Navbar>
        <AppNavbar onLogout={handleLogout} />
      </AppShell.Navbar>
      <AppShell.Main>
        <Routes>
          <Route path="/" element={<Navigate to="/tickets" replace />} />
          <Route path="/dashboard" element={<Box p="md"><DashboardPage /></Box>} />
          <Route path="/tickets" element={<TicketPanes />} />
          <Route path="/tickets/:id" element={<TicketPanes />} />
          <Route path="/users" element={<Box p="md"><UsersPage /></Box>} />
          <Route path="/settings" element={<Box p="md"><SettingsPage /></Box>} />
        </Routes>
      </AppShell.Main>
    </AppShell>
  )
}
