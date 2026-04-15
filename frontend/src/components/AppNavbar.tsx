import { NavLink, Stack, Text, Button } from '@mantine/core'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  IconDashboard,
  IconTicket,
  IconUsers,
  IconSettings,
  IconLogout,
} from '@tabler/icons-react'

const links = [
  { label: 'Dashboard', icon: IconDashboard, to: '/dashboard' },
  { label: 'Tickets', icon: IconTicket, to: '/tickets' },
  { label: 'Users', icon: IconUsers, to: '/users' },
  { label: 'Settings', icon: IconSettings, to: '/settings' },
]

interface AppNavbarProps {
  onLogout?: () => void
  onNavigate?: () => void
}

export function AppNavbar({ onLogout, onNavigate }: AppNavbarProps) {
  const location = useLocation()
  const navigate = useNavigate()

  const handleNav = (to: string) => {
    navigate(to)
    onNavigate?.()
  }

  return (
    <Stack gap={0} p="sm" justify="space-between" h="100%">
      <div>
        <Text fw={700} size="lg" mb="md" px="sm">
          Helpdesk
        </Text>
        {links.map((link) => (
          <NavLink
            key={link.to}
            label={link.label}
            leftSection={<link.icon size={18} />}
            active={location.pathname.startsWith(link.to)}
            onClick={() => handleNav(link.to)}
            style={{ borderRadius: 'var(--mantine-radius-sm)' }}
          />
        ))}
      </div>
      {onLogout && (
        <Button variant="subtle" color="gray" leftSection={<IconLogout size={16} />} onClick={onLogout} fullWidth>
          Logout
        </Button>
      )}
    </Stack>
  )
}
