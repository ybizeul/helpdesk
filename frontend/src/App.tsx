import { useState, useCallback, useRef, useEffect } from 'react'
import { Routes, Route, Navigate, useNavigate, useParams } from 'react-router-dom'
import { AppShell, Box, Burger, Group, Text, Menu, Avatar, UnstyledButton } from '@mantine/core'
import { useDisclosure, useMediaQuery } from '@mantine/hooks'
import { IconLogout, IconUser } from '@tabler/icons-react'
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

function tokenFromHash(hash: string): string | null {
  if (!hash) return null
  const frag = hash.startsWith('#') ? hash.slice(1) : hash
  if (!frag) return null

  if (frag.includes('?')) {
    const query = frag.slice(frag.indexOf('?') + 1)
    return new URLSearchParams(query).get('token')
  }

  return new URLSearchParams(frag).get('token')
}

function removeTokenFromHash(hash: string): string {
  if (!hash) return hash
  const frag = hash.startsWith('#') ? hash.slice(1) : hash
  if (!frag) return hash

  if (frag.includes('?')) {
    const idx = frag.indexOf('?')
    const pathPart = frag.slice(0, idx)
    const query = new URLSearchParams(frag.slice(idx + 1))
    if (!query.has('token')) return hash
    query.delete('token')
    const next = query.toString()
    return `#${pathPart}${next ? `?${next}` : ''}`
  }

  const query = new URLSearchParams(frag)
  if (!query.has('token')) return hash
  query.delete('token')
  const next = query.toString()
  return next ? `#${next}` : ''
}

function tokenFromCurrentLocation(): string | null {
  const url = new URL(window.location.href)
  return url.searchParams.get('token') || tokenFromHash(url.hash)
}

function getInitialToken(): string | null {
  if (typeof window === 'undefined') return null
  const fromStorage = localStorage.getItem('token')
  if (fromStorage) return fromStorage
  return tokenFromCurrentLocation()
}

function TicketRedirect({ mailboxes }: { mailboxes: any[] }) {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  useEffect(() => {
    if (mailboxes.length === 0) return
    if (!id) { navigate(`/mailbox/${mailboxes[0].slug}/tickets`, { replace: true }); return }
    api.tickets.get(id).then((ticket: any) => {
      const mb = mailboxes.find((m: any) => m.id === ticket.mailbox_id) || mailboxes[0]
      navigate(`/mailbox/${mb.slug}/tickets/${id}`, { replace: true })
    }).catch(() => {
      navigate(`/mailbox/${mailboxes[0].slug}/tickets`, { replace: true })
    })
  }, [id, mailboxes, navigate])

  return null
}

function TicketPanes({ currentUser, mailboxes, onMailboxCountChange }: { currentUser: any; mailboxes: any[]; onMailboxCountChange?: () => void }) {
  const { id, slug } = useParams<{ id: string; slug: string }>()
  const navigate = useNavigate()
  const isMobile = useMediaQuery('(max-width: 768px)')
  const listRef = useRef<TicketListHandle>(null)
  const refreshList = useCallback(() => { listRef.current?.refresh(); onMailboxCountChange?.() }, [onMailboxCountChange])

  const exactMatch = mailboxes.find((m: any) => m.slug === slug)
  const mailbox = exactMatch || mailboxes[0]
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

  // Redirect if mailbox slug not found or mailboxes not loaded yet
  useEffect(() => {
    if (mailboxes.length === 0) return
    if (!exactMatch) {
      navigate(mailboxes.length > 0 ? `/mailbox/${mailboxes[0].slug}/tickets` : '/dashboard', { replace: true })
    }
  }, [exactMatch, mailboxes, navigate])

  if (!mailbox || !exactMatch) return null

  const handleTicketNotFound = () => navigate(basePath, { replace: true })

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
            mailboxCount={mailboxes.length}
            onSelectTicket={(ticketId) => navigate(`${basePath}/${ticketId}`)}
            onDeselectTicket={() => navigate(basePath)}
            onMailboxCountChange={onMailboxCountChange}
          />
        </Box>
        {id && (
          <Box style={{ position: 'absolute', inset: 0 }}>
            <TicketDetailPage ticketId={id} onBack={() => navigate(basePath)} onTicketUpdate={refreshList} mailbox={mailbox} onNotFound={handleTicketNotFound} />
          </Box>
        )}
      </Box>
    )
  }

  // Desktop: ticket list on top, detail below with draggable splitter
  const showDetail = !!id

  return (
    <Box ref={containerRef} style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <Box key={mailbox?.id} style={{ height: showDetail ? `${topHeight}%` : '100%', padding: 'var(--mantine-spacing-md)', paddingBottom: showDetail ? 0 : undefined, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
        <TicketListPage
          ref={listRef}
          activeTicketId={id || null}
          currentUser={currentUser}
          mailbox={mailbox}
          mailboxCount={mailboxes.length}
            onSelectTicket={(ticketId) => navigate(`${basePath}/${ticketId}`)}
            onDeselectTicket={() => navigate(basePath)}
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
            <TicketDetailPage ticketId={id} onTicketUpdate={refreshList} mailbox={mailbox} onNotFound={handleTicketNotFound} />
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
  const initials = currentUser?.name
    ? currentUser.name.split(' ').map((w: string) => w[0]).join('').toUpperCase().slice(0, 2)
    : '?'

  // When single mailbox: use its name; otherwise use the site_name setting
  const displayName = mailboxes.length === 1 ? mailboxes[0].name : siteName

  useEffect(() => {
    api.settings.getPublic().then(s => { if (s.site_name) setSiteName(s.site_name) }).catch(() => {})
  }, [])

  useEffect(() => {
    document.title = displayName
  }, [displayName])

  useEffect(() => {
    const url = new URL(window.location.href)
    const oidcToken = tokenFromCurrentLocation()
    if (!oidcToken) return

    localStorage.setItem('token', oidcToken)
    setAuthToken(oidcToken)
    setToken(oidcToken)

    url.searchParams.delete('token')
    const cleanedHash = removeTokenFromHash(url.hash)
    const nextHash = cleanedHash || ''
    window.history.replaceState({}, '', url.pathname + (url.search ? url.search : '') + nextHash)
  }, [])

  const [mailboxesLoaded, setMailboxesLoaded] = useState(false)

  const loadMailboxes = useCallback(() => {
    api.mailboxes.list().then(mb => { setMailboxes(mb); setMailboxesLoaded(true) }).catch(console.error)
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

  // Periodically refresh all mailbox unread counts
  useEffect(() => {
    if (!token) return
    const interval = setInterval(loadMailboxes, 60_000)
    return () => clearInterval(interval)
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
        <Group h="100%" px="md" justify="space-between" wrap="nowrap">
          <Group gap="sm" wrap="nowrap">
            <Burger opened={navOpened} onClick={toggleNav} size="sm" hiddenFrom="sm" />
            <Text fw={700} size="lg">{displayName}</Text>
          </Group>
          <Menu shadow="md" width={200} position="bottom-end" withArrow>
            <Menu.Target>
              <UnstyledButton>
                <Avatar size="sm" radius="xl" color="blue" src={currentUser?.avatar || null}>
                  {currentUser?.avatar ? null : initials}
                </Avatar>
              </UnstyledButton>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Label>{currentUser?.name || 'User'}</Menu.Label>
              <Menu.Item leftSection={<IconUser size={14} />} onClick={openProfile}>
                Profile
              </Menu.Item>
              <Menu.Divider />
              <Menu.Item leftSection={<IconLogout size={14} />} color="red" onClick={handleLogout}>
                Logout
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        </Group>
      </AppShell.Header>
      <AppShell.Navbar>
        <AppNavbar onNavigate={closeNav} user={currentUser} mailboxes={mailboxes} />
      </AppShell.Navbar>
      <AppShell.Main style={{ overflow: 'hidden', height: '100dvh', display: 'flex', flexDirection: 'column' }}>
        <Routes>
          <Route path="/" element={mailboxesLoaded ? (mailboxes.length > 0 ? <Navigate to={`/mailbox/${mailboxes[0].slug}/tickets`} replace /> : <Navigate to="/dashboard" replace />) : null} />
          <Route path="/dashboard" element={<Box p="md"><DashboardPage /></Box>} />
          <Route path="/mailbox/:slug/tickets" element={<TicketPanes currentUser={currentUser} mailboxes={mailboxes} onMailboxCountChange={loadMailboxes} />} />
          <Route path="/mailbox/:slug/tickets/:id" element={<TicketPanes currentUser={currentUser} mailboxes={mailboxes} onMailboxCountChange={loadMailboxes} />} />
          <Route path="/tickets" element={<TicketRedirect mailboxes={mailboxes} />} />
          <Route path="/tickets/:id" element={<TicketRedirect mailboxes={mailboxes} />} />
          <Route path="/users" element={isAdmin ? <Box p="md"><UsersPage mailboxes={mailboxes} /></Box> : <Navigate to="/" replace />} />
          <Route path="/settings" element={isAdmin ? <Box p="md" style={{ overflow: 'auto', height: 'calc(100dvh - var(--app-shell-header-height, 50px))' }}><SettingsPage onSiteNameChange={setSiteName} mailboxes={mailboxes} onMailboxesChange={setMailboxes} /></Box> : <Navigate to="/" replace />} />
        </Routes>
      </AppShell.Main>
      <ProfileModal opened={profileOpened} onClose={closeProfile} user={currentUser} onAvatarChange={(avatar) => setCurrentUser((u: any) => u ? { ...u, avatar } : u)} onLocaleChange={(locale) => setCurrentUser((u: any) => u ? { ...u, locale } : u)} />
    </AppShell>
  )
}
