import { useEffect, useState, useRef, useCallback, useImperativeHandle, forwardRef } from 'react'
import { Title, Table, Badge, Group, Text, Checkbox, Button, Tooltip, Menu, ActionIcon, Stack, Box, Avatar } from '@mantine/core'
import { IconTrash, IconEye, IconEyeOff, IconCircle, IconRefresh, IconArrowMerge } from '@tabler/icons-react'
import { useMediaQuery } from '@mantine/hooks'
import { notifications } from '@mantine/notifications'
import { api } from '../api/client'

const statusColors: Record<string, string> = {
  unassigned: 'gray',
  active: 'orange',
  waiting: 'green',
  closed: 'dark',
}

const statusShort: Record<string, string> = {
  unassigned: 'U',
  active: 'A',
  waiting: 'W',
  closed: 'C',
}

const avatarColors = ['red', 'pink', 'grape', 'violet', 'indigo', 'blue', 'cyan', 'teal', 'green', 'lime', 'yellow', 'orange']

function hashColor(str: string): string {
  let hash = 0
  for (let i = 0; i < str.length; i++) hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0
  return avatarColors[Math.abs(hash) % avatarColors.length]
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
  return name.slice(0, 2).toUpperCase()
}

function formatDate(d: string | Date): string {
  const date = new Date(d)
  const today = new Date()
  if (date.toDateString() === today.toDateString()) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }
  return date.toLocaleDateString()
}

function notifyNewTickets(newTickets: any[]) {
  if (localStorage.getItem('notifications_enabled') !== 'true') return
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
  for (const t of newTickets) {
    new Notification(`New case #${t.number}`, {
      body: `${t.subject}\nFrom: ${t.requester?.email || 'unknown'}`,
      icon: '/favicon.svg',
      tag: `ticket-${t.id}`,
    })
  }
}

interface TicketListPageProps {
  activeTicketId?: string | null
  onSelectTicket?: (id: string) => void
}

export interface TicketListHandle {
  refresh: () => void
}

export const TicketListPage = forwardRef<TicketListHandle, TicketListPageProps>(function TicketListPage({ activeTicketId, onSelectTicket }, ref) {
  const [tickets, setTickets] = useState<any[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [usersMap, setUsersMap] = useState<Record<string, any>>({})
  const knownIdsRef = useRef<Set<string> | null>(null)
  const isMobile = useMediaQuery('(max-width: 768px)')

  const loadTickets = useCallback(() => {
    api.tickets.list({}).then((data) => {
      if (knownIdsRef.current !== null) {
        const newTickets = data.filter((t: any) => t.unread && !knownIdsRef.current!.has(t.id))
        if (newTickets.length > 0) notifyNewTickets(newTickets)
      }
      knownIdsRef.current = new Set(data.map((t: any) => t.id))
      setTickets(data)
    }).catch(console.error)
  }, [])

  useImperativeHandle(ref, () => ({ refresh: loadTickets }), [loadTickets])

  useEffect(() => {
    loadTickets()
    api.users.list().then((users) => {
      const map: Record<string, any> = {}
      for (const u of users) map[u.id] = u
      setUsersMap(map)
    }).catch(console.error)
    const interval = setInterval(loadTickets, 60_000)
    return () => clearInterval(interval)
  }, [])

  const toggleSelect = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleAll = () => {
    if (selected.size === tickets.length) setSelected(new Set())
    else setSelected(new Set(tickets.map(t => t.id)))
  }

  const bulkAction = async (action: string, extra?: Record<string, string>) => {
    const ids = Array.from(selected)
    try {
      await api.tickets.bulk(ids, action, extra)
      setSelected(new Set())
      loadTickets()
      const labels: Record<string, string> = { delete: 'Deleted', mark_read: 'Marked as read', mark_unread: 'Marked as unread', set_status: `Status changed` }
      notifications.show({ title: labels[action] || action, message: `${ids.length} case(s)`, color: 'green' })
    } catch (e: any) {
      notifications.show({ title: 'Error', message: e.message, color: 'red' })
    }
  }

  return (
    <Box style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <Group justify="space-between" style={{ flexShrink: 0, paddingBottom: 'var(--mantine-spacing-xs)', borderBottom: '1px solid var(--mantine-color-default-border)' }}>
        <Group gap="xs">
          <Title order={2}>Cases</Title>
          <Tooltip label="Refresh">
            <ActionIcon variant="white" size="sm" onClick={loadTickets}><IconRefresh size={14} /></ActionIcon>
          </Tooltip>
        </Group>
        <Group gap="sm">
          {selected.size > 0 && (
            <>
              <Text size="sm" c="dimmed">{selected.size} selected</Text>
              <Tooltip label="Mark as read">
                <Button variant="light" size="xs" leftSection={<IconEye size={14} />} onClick={() => bulkAction('mark_read')}>Read</Button>
              </Tooltip>
              <Tooltip label="Mark as unread">
                <Button variant="light" size="xs" leftSection={<IconEyeOff size={14} />} onClick={() => bulkAction('mark_unread')}>Unread</Button>
              </Tooltip>
              {selected.size >= 2 && (
                <Tooltip label="Merge selected cases">
                  <Button variant="light" color="violet" size="xs" leftSection={<IconArrowMerge size={14} />} onClick={async () => {
                    const ids = Array.from(selected)
                    try {
                      const result = await api.tickets.merge(ids)
                      setSelected(new Set())
                      loadTickets()
                      notifications.show({ title: 'Cases merged', message: `Merged ${ids.length} cases into #${result.ticket_number}`, color: 'green' })
                    } catch (e: any) {
                      notifications.show({ title: 'Merge failed', message: e.message, color: 'red' })
                    }
                  }}>Merge</Button>
                </Tooltip>
              )}
              <Tooltip label="Delete selected">
                <Button variant="light" color="red" size="xs" leftSection={<IconTrash size={14} />} onClick={() => bulkAction('delete')}>Delete</Button>
              </Tooltip>
              <Menu shadow="md" width={150}>
                <Menu.Target>
                  <Button variant="light" size="xs" leftSection={<IconCircle size={14} />}>Status</Button>
                </Menu.Target>
                <Menu.Dropdown>
                  <Menu.Item leftSection={<Badge color="gray" size="xs" circle />} onClick={() => bulkAction('set_status', { status: 'unassigned' })}>Unassigned</Menu.Item>
                  <Menu.Item leftSection={<Badge color="orange" size="xs" circle />} onClick={() => bulkAction('set_status', { status: 'active' })}>Active</Menu.Item>
                  <Menu.Item leftSection={<Badge color="green" size="xs" circle />} onClick={() => bulkAction('set_status', { status: 'waiting' })}>Waiting</Menu.Item>
                  <Menu.Item leftSection={<Badge color="dark" size="xs" circle />} onClick={() => bulkAction('set_status', { status: 'closed' })}>Closed</Menu.Item>
                </Menu.Dropdown>
              </Menu>
            </>
          )}
        </Group>
      </Group>
      <Box style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
      {isMobile ? (
        <Stack gap={0}>
          {tickets.map((t) => {
            const isActive = activeTicketId === t.id
            const handleClick = () => onSelectTicket?.(t.id)
            return (
              <Box
                key={t.id}
                onClick={handleClick}
                style={{
                  cursor: 'pointer',
                  padding: 'var(--mantine-spacing-xs) var(--mantine-spacing-sm)',
                  background: isActive ? 'var(--mantine-primary-color-light)' : undefined,
                  borderBottom: '1px solid var(--mantine-color-default-border)',
                }}
              >
                <Group justify="space-between" gap="xs" wrap="nowrap">
                  {(() => { const owner = t.owner_id ? usersMap[t.owner_id] : null; return (
                    <Avatar size="sm" radius="xl" color={owner ? hashColor(owner.id) : 'gray'} style={{ flexShrink: 0 }}>
                      {owner ? getInitials(owner.name) : 'U'}
                    </Avatar>
                  ) })()}
                  <Box style={{ minWidth: 0, flex: 1 }}>
                    <Text size="sm" fw={t.unread ? 700 : 400} truncate>#{t.number} {t.subject}</Text>
                    <Text size="xs" c="dimmed" truncate>{t.requester?.email}</Text>
                  </Box>
                  <Group gap={6} wrap="nowrap" style={{ flexShrink: 0 }}>
                    <Text size="xs" c="dimmed">{formatDate(t.updated_at)}</Text>
                    <Badge size="xs" color={statusColors[t.status] || 'gray'}>{statusShort[t.status] || t.status[0]?.toUpperCase()}</Badge>
                  </Group>
                </Group>
              </Box>
            )
          })}
          {tickets.length === 0 && (
            <Text c="dimmed" ta="center" py="md">No cases found</Text>
          )}
        </Stack>
      ) : (
      <Table striped highlightOnHover fz="xs">
        <Table.Thead>
          <Table.Tr>
            <Table.Th w={40}><Checkbox size="xs" checked={tickets.length > 0 && selected.size === tickets.length} indeterminate={selected.size > 0 && selected.size < tickets.length} onChange={toggleAll} /></Table.Th>
            <Table.Th w={40}>Owner</Table.Th>
            <Table.Th>#</Table.Th>
            <Table.Th>Subject</Table.Th>
            <Table.Th>Requester</Table.Th>
            <Table.Th>Updated</Table.Th>
            <Table.Th>Priority</Table.Th>
            <Table.Th>Status</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {tickets.map((t) => {
            const isActive = activeTicketId === t.id
            const handleClick = () => onSelectTicket?.(t.id)
            return (
              <Table.Tr key={t.id} style={{ cursor: 'pointer', fontWeight: t.unread ? 700 : 400, background: isActive ? 'var(--mantine-primary-color-light)' : undefined }}>
                <Table.Td onClick={e => e.stopPropagation()}><Checkbox size="xs" checked={selected.has(t.id)} onChange={() => toggleSelect(t.id)} /></Table.Td>
                <Table.Td onClick={handleClick}>{(() => { const owner = t.owner_id ? usersMap[t.owner_id] : null; return (
                  <Tooltip label={owner ? owner.name : 'Unassigned'} withArrow>
                    <Avatar size="sm" radius="xl" color={owner ? hashColor(owner.id) : 'gray'}>
                      {owner ? getInitials(owner.name) : 'U'}
                    </Avatar>
                  </Tooltip>
                ) })()}</Table.Td>
                <Table.Td onClick={handleClick}>{t.number}</Table.Td>
                <Table.Td onClick={handleClick}>{t.subject}</Table.Td>
                <Table.Td onClick={handleClick}>{t.requester?.email}</Table.Td>
                <Table.Td onClick={handleClick}>{formatDate(t.updated_at)}</Table.Td>
                <Table.Td onClick={handleClick}>{t.priority}</Table.Td>
                <Table.Td onClick={handleClick}><Badge size="xs" color={statusColors[t.status] || 'gray'}>{t.status}</Badge></Table.Td>
              </Table.Tr>
            )
          })}
          {tickets.length === 0 && (
            <Table.Tr>
              <Table.Td colSpan={8}><Text c="dimmed" ta="center">No cases found</Text></Table.Td>
            </Table.Tr>
          )}
        </Table.Tbody>
      </Table>
      )}
      </Box>
    </Box>
  )
})
