import { useEffect, useState } from 'react'
import { Title, Table, Badge, Group, Text, Checkbox, Button, Tooltip, Menu, ActionIcon } from '@mantine/core'
import { IconTrash, IconEye, IconEyeOff, IconCircle, IconRefresh, IconArrowMerge } from '@tabler/icons-react'
import { notifications } from '@mantine/notifications'
import { api } from '../api/client'

const statusColors: Record<string, string> = {
  open: 'blue',
  waiting: 'yellow',
  closed: 'gray',
}

function formatDate(d: string | Date): string {
  const date = new Date(d)
  const today = new Date()
  if (date.toDateString() === today.toDateString()) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }
  return date.toLocaleDateString()
}

interface TicketListPageProps {
  activeTicketId?: string | null
  onSelectTicket?: (id: string) => void
}

export function TicketListPage({ activeTicketId, onSelectTicket }: TicketListPageProps = {}) {
  const [tickets, setTickets] = useState<any[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const loadTickets = () => {
    api.tickets.list({}).then(setTickets).catch(console.error)
  }

  useEffect(() => {
    loadTickets()
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
      notifications.show({ title: labels[action] || action, message: `${ids.length} ticket(s)`, color: 'green' })
    } catch (e: any) {
      notifications.show({ title: 'Error', message: e.message, color: 'red' })
    }
  }

  return (
    <>
      <Group justify="space-between" mb="lg">
        <Group gap="xs">
          <Title order={2}>Tickets</Title>
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
                <Tooltip label="Merge selected tickets">
                  <Button variant="light" color="violet" size="xs" leftSection={<IconArrowMerge size={14} />} onClick={async () => {
                    const ids = Array.from(selected)
                    try {
                      const result = await api.tickets.merge(ids)
                      setSelected(new Set())
                      loadTickets()
                      notifications.show({ title: 'Tickets merged', message: `Merged ${ids.length} tickets into #${result.ticket_number}`, color: 'green' })
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
                  <Menu.Item leftSection={<Badge color="blue" size="xs" circle />} onClick={() => bulkAction('set_status', { status: 'open' })}>Open</Menu.Item>
                  <Menu.Item leftSection={<Badge color="yellow" size="xs" circle />} onClick={() => bulkAction('set_status', { status: 'waiting' })}>Waiting</Menu.Item>
                  <Menu.Item leftSection={<Badge color="gray" size="xs" circle />} onClick={() => bulkAction('set_status', { status: 'closed' })}>Closed</Menu.Item>
                </Menu.Dropdown>
              </Menu>
            </>
          )}
        </Group>
      </Group>
      <Table striped highlightOnHover fz="xs">
        <Table.Thead>
          <Table.Tr>
            <Table.Th w={40}><Checkbox size="xs" checked={tickets.length > 0 && selected.size === tickets.length} indeterminate={selected.size > 0 && selected.size < tickets.length} onChange={toggleAll} /></Table.Th>
            <Table.Th>#</Table.Th>
            <Table.Th>Subject</Table.Th>
            <Table.Th>Requester</Table.Th>
            <Table.Th>Status</Table.Th>
            <Table.Th>Priority</Table.Th>
            <Table.Th>Updated</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {tickets.map((t) => {
            const isActive = activeTicketId === t.id
            const handleClick = () => onSelectTicket?.(t.id)
            return (
              <Table.Tr key={t.id} style={{ cursor: 'pointer', fontWeight: t.unread ? 700 : 400, background: isActive ? 'var(--mantine-color-blue-0)' : undefined }}>
                <Table.Td onClick={e => e.stopPropagation()}><Checkbox size="xs" checked={selected.has(t.id)} onChange={() => toggleSelect(t.id)} /></Table.Td>
                <Table.Td onClick={handleClick}>{t.number}</Table.Td>
                <Table.Td onClick={handleClick}>{t.subject}</Table.Td>
                <Table.Td onClick={handleClick}>{t.requester?.email}</Table.Td>
                <Table.Td onClick={handleClick}><Badge size="xs" color={statusColors[t.status] || 'gray'}>{t.status}</Badge></Table.Td>
                <Table.Td onClick={handleClick}>{t.priority}</Table.Td>
                <Table.Td onClick={handleClick}>{formatDate(t.updated_at)}</Table.Td>
              </Table.Tr>
            )
          })}
          {tickets.length === 0 && (
            <Table.Tr>
              <Table.Td colSpan={7}><Text c="dimmed" ta="center">No tickets found</Text></Table.Td>
            </Table.Tr>
          )}
        </Table.Tbody>
      </Table>
    </>
  )
}
