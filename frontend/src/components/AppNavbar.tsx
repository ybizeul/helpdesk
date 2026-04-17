import { Stack, Text, Avatar, Menu, Group, UnstyledButton, Box } from '@mantine/core'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  IconDashboard,
  IconInbox,
  IconUsers,
  IconSettings,
  IconLogout,
  IconUser,
} from '@tabler/icons-react'

interface AppNavbarProps {
  onLogout?: () => void
  onNavigate?: () => void
  user?: { id: string; name: string; email: string; role: string; avatar?: string } | null
  onOpenProfile?: () => void
  siteName?: string
  mailboxes?: any[]
}

export function AppNavbar({ onLogout, onNavigate, user, onOpenProfile, siteName = 'Helpdesk', mailboxes = [] }: AppNavbarProps) {
  const location = useLocation()
  const navigate = useNavigate()
  const isAdmin = user?.role === 'admin'

  const handleNav = (to: string) => {
    navigate(to)
    onNavigate?.()
  }

  const initials = user?.name
    ? user.name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
    : '?'

  // Build nav links dynamically
  const navItems: { label: string; icon: typeof IconDashboard; to: string; adminOnly?: boolean }[] = []

  navItems.push({ label: 'Dashboard', icon: IconDashboard, to: '/dashboard' })

  if (mailboxes.length <= 1) {
    // Single mailbox: show "Cases" like before
    const slug = mailboxes[0]?.slug || 'default'
    navItems.push({ label: 'Cases', icon: IconInbox, to: `/mailbox/${slug}/tickets` })
  } else {
    // Multiple mailboxes: one entry per mailbox
    for (const mb of mailboxes) {
      navItems.push({ label: mb.name, icon: IconInbox, to: `/mailbox/${mb.slug}/tickets` })
    }
  }

  if (isAdmin) {
    navItems.push({ label: 'Users', icon: IconUsers, to: '/users' })
    navItems.push({ label: 'Settings', icon: IconSettings, to: '/settings' })
  }

  return (
    <Stack gap={0} p="sm" justify="space-between" h="100%">
      <div>
        <Group mb="md" px="sm" gap="sm">
          <Menu shadow="md" width={200} position="bottom-start">
            <Menu.Target>
              <UnstyledButton>
                <Avatar size="sm" radius="xl" color="blue" src={user?.avatar || null}>{user?.avatar ? null : initials}</Avatar>
              </UnstyledButton>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Label>{user?.name || 'User'}</Menu.Label>
              <Menu.Item leftSection={<IconUser size={14} />} onClick={onOpenProfile}>
                Profile
              </Menu.Item>
              <Menu.Divider />
              <Menu.Item leftSection={<IconLogout size={14} />} color="red" onClick={onLogout}>
                Logout
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
          <Text fw={700} size="lg">{user?.name || siteName}</Text>
        </Group>
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
              <Text size="sm" fw={active ? 600 : 400}>{link.label}</Text>
            </UnstyledButton>
          )
        })}
      </div>
    </Stack>
  )
}
