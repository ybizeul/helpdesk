import { Stack, Text, UnstyledButton, Box, Badge } from '@mantine/core'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  IconDashboard,
  IconInbox,
  IconUsers,
  IconSettings,
} from '@tabler/icons-react'

interface AppNavbarProps {
  onNavigate?: () => void
  user?: { id: string; name: string; email: string; role: string; avatar?: string } | null
  mailboxes?: any[]
}

export function AppNavbar({ onNavigate, user, mailboxes = [] }: AppNavbarProps) {
  const location = useLocation()
  const navigate = useNavigate()
  const isAdmin = user?.role === 'admin'

  const handleNav = (to: string) => {
    navigate(to)
    onNavigate?.()
  }

  // Build nav links dynamically
  const navItems: { label: string; icon: typeof IconDashboard; to: string; adminOnly?: boolean; unreadCount?: number }[] = []

  navItems.push({ label: 'Dashboard', icon: IconDashboard, to: '/dashboard' })

  if (mailboxes.length <= 1) {
    // Single mailbox: show "Cases" like before
    const mb = mailboxes[0]
    const slug = mb?.slug || 'default'
    navItems.push({ label: 'Cases', icon: IconInbox, to: `/mailbox/${slug}/tickets`, unreadCount: mb?.unread_count || 0 })
  } else {
    // Multiple mailboxes: one entry per mailbox
    for (const mb of mailboxes) {
      navItems.push({ label: mb.name, icon: IconInbox, to: `/mailbox/${mb.slug}/tickets`, unreadCount: mb.unread_count || 0 })
    }
  }

  if (isAdmin) {
    navItems.push({ label: 'Users', icon: IconUsers, to: '/users' })
    navItems.push({ label: 'Settings', icon: IconSettings, to: '/settings' })
  }

  return (
    <Stack gap={0} p="sm" justify="space-between" h="100%">
      <div>
        {navItems.map((link) => {
          const active = location.pathname.startsWith(link.to)
          return (
            <UnstyledButton
              key={link.to}
              onClick={() => handleNav(link.to)}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                width: '100%', padding: '8px 12px',
                borderRadius: 'var(--mantine-radius-sm)',
                fontWeight: active ? 600 : 400,
                background: active ? 'var(--mantine-primary-color-light)' : undefined,
                color: active ? 'var(--mantine-primary-color-filled)' : undefined,
              }}
            >
              <Box style={{ color: active ? 'var(--mantine-primary-color-filled)' : 'var(--mantine-color-dimmed)', display: 'flex' }}>
                <link.icon size={18} />
              </Box>
              <Text size="sm" fw={active ? 600 : 400} style={{ flex: 1 }}>{link.label}</Text>
              {(link.unreadCount ?? 0) > 0 && (
                <Badge size="sm" variant="filled" circle>{link.unreadCount}</Badge>
              )}
            </UnstyledButton>
          )
        })}
      </div>
    </Stack>
  )
}
