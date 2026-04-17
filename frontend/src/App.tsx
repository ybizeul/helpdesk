import { useState, useCallback, useRef, useEffect } from 'react'
import { Routes, Route, Navigate, useNavigate, useParams } from 'react-router-dom'
import { AppShell, Box, Burger, Group, Text } from '@mantine/core'
import { useDisclosure, useMediaQuery } from '@mantine/hooks'
import { AppNavbar } from './components/AppNavbar'
import { ProfileModal } from './components/ProfileModal'
import { TicketListPage } from './pages/TicketListPage'
import type { TicketListHandle } from './pages/TicketListPage'
import { TicketDetailPage } from './pages/TicketDetailPage'
import { DashboardPage } from './pages/DashboardPage'
import { SettingsPage } from './pages/SettingsPage'
import { UsersPage } from './pages/UsersPage'
import { LoginPage } from './pages/LoginPage'
import { setAuthToken, api } from './api/client'

function getInitialToken(): string | null {
  if (typeof window === 'undefined') return null
  const fromStorage = localStorage.getItem('token')
  if (fromStorage) return fromStorage

  const url = new URL(window.location.href)
  return url.searchParams.get('token')
}

function TicketPanes({ currentUser, mailboxes, onMailboxCountChange }: { currentUser: any; mailboxes: any[]; onMailboxCountChange?: () => void }) {
  const { id, slug } = useParams<{ id: string; slug: string }>()
  const navigate = useNavigate()
  const isMobile = useMediaQuery('(max-width: 768px)')
  const listRef = useRef<TicketListHandle>(null)
  const refreshList = useCallback(() => { listRef.current?.refresh(); onMailboxCountChange?.() }, [onMailboxCountChange])

  const mailbox = mailboxes.find((m: any) => m.slug === slug) || mailboxes[0]
  const basePath = `/mailbox/${mailbox?.slug || 'default'}/tickets`

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

  // Mobile: render both panes, toggle visibility so list stays mounted (preserves scroll/state)
  if (isMobile) {
    return (
      <Box style={{ height: 'calc(100dvh - var(--app-shell-header-height, 50px))', position: 'relative', overflow: 'hidden' }}>
        <Box key={mailbox?.id} style={{ display: id ? 'none' : 'flex', flexDirection: 'column', height: '100%' }}>
          <TicketListPage
            ref={listRef}
            activeTicketId={null}
            currentUser={currentUser}
            mailbox={mailbox}
            onSelectTicket={(ticketId) => navigate(`${basePath}/${ticketId}`)}
            onMailboxCountChange={onMailboxCountChange}
          />
        </Box>
        {id && (
          <Box style={{ position: 'absolute', inset: 0 }}>
            <TicketDetailPage ticketId={id} onBack={() => navigate(basePath)} onTicketUpdate={refreshList} mailbox={mailbox} />
          </Box>
        )}
      </Box>
    )
  }

  // Desktop: ticket list on top, detail below with draggable splitter
  const showDetail = !!id

  return (
    <Box ref={containerRef} style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <Box key={mailbox?.id} style={{ height: showDetail ? `${topHeight}%` : '100%', padding: 'var(--mantine-spacing-md)', paddingBottom: showDetail ? 0 : undefined, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
        <TicketListPage
          ref={listRef}
          activeTicketId={id || null}
          currentUser={currentUser}
          mailbox={mailbox}
            onSelectTicket={(ticketId) => navigate(`${basePath}/${ticketId}`)}
            onMailboxCountChange={onMailboxCountChange}
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
            <TicketDetailPage ticketId={id} onTicketUpdate={refreshList} mailbox={mailbox} />
          </Box>
        </>
      )}
    </Box>
  )
}

export default function App() {
  const [token, setToken] = useState<string | null>(getInitialToken)
  const [navOpened, { toggle: toggleNav, close: closeNav }] = useDisclosure(false)
  const [profileOpened, { open: openProfile, close: closeProfile }] = useDisclosure(false)
  const [currentUser, setCurrentUser] = useState<any>(null)
  const [siteName, setSiteName] = useState('Helpdesk')
  const [mailboxes, setMailboxes] = useState<any[]>([])
  const isAdmin = currentUser?.role === 'admin'

  useEffect(() => {
    api.settings.getPublic().then(s => { if (s.site_name) setSiteName(s.site_name) }).catch(() => {})
  }, [])

  useEffect(() => {
    document.title = siteName
  }, [siteName])

  useEffect(() => {
    const url = new URL(window.location.href)
    const oidcToken = url.searchParams.get('token')
    if (!oidcToken) return

    localStorage.setItem('token', oidcToken)
    setAuthToken(oidcToken)
    setToken(oidcToken)

    url.searchParams.delete('token')
    window.history.replaceState({}, '', url.pathname + (url.search ? url.search : '') + url.hash)
  }, [])

  const loadMailboxes = useCallback(() => {
    api.mailboxes.list().then(setMailboxes).catch(console.error)
  }, [])

  const handleLogin = useCallback((newToken: string, user: any) => {
    localStorage.setItem('token', newToken)
    setAuthToken(newToken)
    setToken(newToken)
    setCurrentUser(user)
    loadMailboxes()
  }, [loadMailboxes])

  const handleLogout = useCallback(() => {
    localStorage.removeItem('token')
    setAuthToken(null)
    setToken(null)
    setCurrentUser(null)
  }, [])

  // Restore token on mount
  if (token) setAuthToken(token)

  useEffect(() => {
    if (token && !currentUser) {
      api.me().then(setCurrentUser).catch(console.error)
      loadMailboxes()
    }
  }, [token, loadMailboxes])

  if (!token) {
    return <LoginPage onLogin={handleLogin} />
  }

  return (
    <AppShell
      header={{ height: 50 }}
      navbar={{ width: 220, breakpoint: 'sm', collapsed: { mobile: !navOpened } }}
      padding={0}
    >
      <AppShell.Header>
        <Group h="100%" px="md">
          <Burger opened={navOpened} onClick={toggleNav} size="sm" hiddenFrom="sm" />
          <Text fw={700} size="lg">{siteName}</Text>
        </Group>
      </AppShell.Header>
      <AppShell.Navbar>
        <AppNavbar onLogout={handleLogout} onNavigate={closeNav} user={currentUser} onOpenProfile={openProfile} siteName={siteName} mailboxes={mailboxes} />
      </AppShell.Navbar>
      <AppShell.Main style={{ overflow: 'hidden' }}>
        <Routes>
          <Route path="/" element={mailboxes.length > 0 ? <Navigate to={`/mailbox/${mailboxes[0].slug}/tickets`} replace /> : <Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<Box p="md"><DashboardPage /></Box>} />
          <Route path="/mailbox/:slug/tickets" element={<TicketPanes currentUser={currentUser} mailboxes={mailboxes} onMailboxCountChange={loadMailboxes} />} />
          <Route path="/mailbox/:slug/tickets/:id" element={<TicketPanes currentUser={currentUser} mailboxes={mailboxes} onMailboxCountChange={loadMailboxes} />} />
          <Route path="/tickets" element={mailboxes.length > 0 ? <Navigate to={`/mailbox/${mailboxes[0].slug}/tickets`} replace /> : null} />
          <Route path="/tickets/:id" element={mailboxes.length > 0 ? <Navigate to={`/mailbox/${mailboxes[0].slug}/tickets`} replace /> : null} />
          <Route path="/users" element={isAdmin ? <Box p="md"><UsersPage mailboxes={mailboxes} /></Box> : <Navigate to="/" replace />} />
          <Route path="/settings" element={isAdmin ? <Box p="md"><SettingsPage onSiteNameChange={setSiteName} mailboxes={mailboxes} onMailboxesChange={setMailboxes} /></Box> : <Navigate to="/" replace />} />
        </Routes>
      </AppShell.Main>
      <ProfileModal opened={profileOpened} onClose={closeProfile} user={currentUser} onAvatarChange={(avatar) => setCurrentUser((u: any) => u ? { ...u, avatar } : u)} onLocaleChange={(locale) => setCurrentUser((u: any) => u ? { ...u, locale } : u)} />
    </AppShell>
  )
}
