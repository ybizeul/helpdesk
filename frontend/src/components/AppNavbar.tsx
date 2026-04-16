import { NavLink, Stack, Text, Avatar, Menu, Group, UnstyledButton } from '@mantine/core'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  IconDashboard,
  IconTicket,
  IconUsers,
  IconSettings,
  IconLogout,
  IconUser,
} from '@tabler/icons-react'

const links = [
  { label: 'Dashboard', icon: IconDashboard, to: '/dashboard' },
  { label: 'Cases', icon: IconTicket, to: '/tickets' },
  { label: 'Users', icon: IconUsers, to: '/users' },
  { label: 'Settings', icon: IconSettings, to: '/settings' },
]

interface AppNavbarProps {
  onLogout?: () => void
  onNavigate?: () => void
  user?: { id: string; name: string; email: string; role: string; avatar?: string } | null
  onOpenProfile?: () => void
  siteName?: string
}

export function AppNavbar({ onLogout, onNavigate, user, onOpenProfile, siteName = 'Helpdesk' }: AppNavbarProps) {
  const location = useLocation()
  const navigate = useNavigate()
  const isAdmin = user?.role === 'admin'
  const visibleLinks = isAdmin ? links : links.filter((link) => link.to !== '/users' && link.to !== '/settings')

  const handleNav = (to: string) => {
    navigate(to)
    onNavigate?.()
  }

  const initials = user?.name
    ? user.name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
    : '?'

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
        {visibleLinks.map((link) => (
          <NavLink
            key={link.to}
            component="button"
            label={link.label}
            leftSection={<link.icon size={18} />}
            active={location.pathname.startsWith(link.to)}
            onClick={() => handleNav(link.to)}
            style={{ borderRadius: 'var(--mantine-radius-sm)', width: '100%' }}
          />
        ))}
      </div>
    </Stack>
  )
}
