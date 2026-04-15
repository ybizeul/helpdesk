import { useState, useCallback, useRef } from 'react'
import { Routes, Route, Navigate, useNavigate, useParams } from 'react-router-dom'
import { AppShell, Box, Burger, Group, Text } from '@mantine/core'
import { useDisclosure, useMediaQuery } from '@mantine/hooks'
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
  const isMobile = useMediaQuery('(max-width: 768px)')

  // Hooks must be called unconditionally (before any early return)
  const [topHeight, setTopHeight] = useState(() => {
    const saved = localStorage.getItem('pane_split')
    return saved ? Number(saved) : 50
  })
  const dragging = useRef(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    dragging.current = true

    const onMouseMove = (ev: MouseEvent) => {
      if (!dragging.current || !containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      const pct = ((ev.clientY - rect.top) / rect.height) * 100
      setTopHeight(Math.min(85, Math.max(15, pct)))
    }

    const onMouseUp = () => {
      dragging.current = false
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
      setTopHeight(prev => { localStorage.setItem('pane_split', String(prev)); return prev })
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }, [])

  // Mobile: show one pane at a time
  if (isMobile) {
    if (id) {
      return (
        <Box style={{ height: 'calc(100vh - 32px)', position: 'relative' }}>
          <TicketDetailPage ticketId={id} onBack={() => navigate('/tickets')} />
        </Box>
      )
    }
    return (
      <Box style={{ height: 'calc(100vh - 32px)', overflowY: 'auto', padding: 'var(--mantine-spacing-md)' }}>
        <TicketListPage
          activeTicketId={null}
          onSelectTicket={(ticketId) => navigate(`/tickets/${ticketId}`)}
        />
      </Box>
    )
  }

  // Desktop: ticket list on top, detail below with draggable splitter
  const showDetail = !!id

  return (
    <Box ref={containerRef} style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <Box style={{ height: showDetail ? `${topHeight}%` : '100%', padding: 'var(--mantine-spacing-md)', paddingBottom: showDetail ? 0 : undefined, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
        <TicketListPage
          activeTicketId={id || null}
          onSelectTicket={(ticketId) => navigate(`/tickets/${ticketId}`)}
        />
      </Box>
      {showDetail && (
        <>
          <Box
            onMouseDown={onMouseDown}
            style={{
              height: 5,
              cursor: 'row-resize',
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
            }}
            onMouseEnter={(e) => { const line = e.currentTarget.firstElementChild as HTMLElement; if (line) line.style.background = 'var(--mantine-color-blue-4)' }}
            onMouseLeave={(e) => { if (!dragging.current) { const line = e.currentTarget.firstElementChild as HTMLElement; if (line) line.style.background = 'var(--mantine-color-default-border)' } }}
          >
            <div style={{ height: 1, width: '100%', background: 'var(--mantine-color-default-border)', transition: 'background 150ms' }} />
          </Box>
          <Box style={{ flex: 1, padding: 'var(--mantine-spacing-md)', minHeight: 0, display: 'flex', flexDirection: 'column', position: 'relative' }}>
            <TicketDetailPage ticketId={id} />
          </Box>
        </>
      )}
    </Box>
  )
}

export default function App() {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('token'))
  const [navOpened, { toggle: toggleNav, close: closeNav }] = useDisclosure(false)
  const isMobileHeader = useMediaQuery('(max-width: 48em)')

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
      header={{ height: 50, collapsed: !isMobileHeader }}
      navbar={{ width: 220, breakpoint: 'sm', collapsed: { mobile: !navOpened } }}
      padding={0}
    >
      <AppShell.Header>
        <Group h="100%" px="md">
          <Burger opened={navOpened} onClick={toggleNav} size="sm" />
          <Text fw={700} size="lg">Helpdesk</Text>
        </Group>
      </AppShell.Header>
      <AppShell.Navbar>
        <AppNavbar onLogout={handleLogout} onNavigate={closeNav} />
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
