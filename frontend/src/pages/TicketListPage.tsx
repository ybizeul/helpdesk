import { useEffect, useState, useRef, useCallback, useImperativeHandle, forwardRef } from 'react'
import { Title, Table, Badge, Group, Text, Checkbox, Button, Tooltip, Menu, ActionIcon, Stack, Box, Avatar, Skeleton, Loader } from '@mantine/core'
import { IconTrash, IconEye, IconEyeOff, IconCircle, IconRefresh, IconArrowMerge, IconFilter, IconArrowDown } from '@tabler/icons-react'
import { useMediaQuery } from '@mantine/hooks'
import { notifications } from '@mantine/notifications'
import { api } from '../api/client'

const statusColors: Record<string, string> = {
  unassigned: 'gray',
  active: 'orange',
  waiting: 'green',
  closed: 'dark',
  parked: '#6c757d',
}

const statusShort: Record<string, string> = {
  unassigned: 'U', active: 'A', waiting: 'W', closed: 'C', parked: 'P',
}

type StatusFilter = 'all_open' | 'all' | 'unassigned' | 'active' | 'waiting' | 'closed' | 'parked'

const statusFilterLabels: Record<StatusFilter, string> = {
  all_open: 'All open',
  all: 'All',
  unassigned: 'Unassigned',
  active: 'Active',
  waiting: 'Waiting',
  closed: 'Closed',
  parked: 'Parked',
}

function getFilterParams(filter: StatusFilter): Record<string, string> {
  if (filter === 'all') return { include_closed: '1' }
  if (filter === 'all_open') return {}
  return { status: filter }
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

function formatDate(d: string | Date, locale?: string): string {
  const date = new Date(d)
  const today = new Date()
  if (date.toDateString() === today.toDateString()) {
    return date.toLocaleTimeString(locale || undefined, { hour: '2-digit', minute: '2-digit' })
  }
  return date.toLocaleDateString(locale || undefined)
}

function showInAppTicketNotifications(newTickets: any[]) {
  for (const t of newTickets) {
    notifications.show({
      title: `New case #${t.number}`,
      message: `${t.subject} - ${t.requester?.email || 'unknown'}`,
      color: 'blue',
      autoClose: 8000,
    })
  }
}

function notifyNewTickets(newTickets: any[]) {
  if (localStorage.getItem('notifications_enabled') !== 'true') return
  if (typeof Notification === 'undefined' || !window.isSecureContext || Notification.permission !== 'granted') {
    showInAppTicketNotifications(newTickets)
    return
  }

  let nativeFailed = false
  for (const t of newTickets) {
    try {
      new Notification(`New case #${t.number}`, {
        body: `${t.subject}\nFrom: ${t.requester?.email || 'unknown'}`,
        tag: `ticket-${t.id}`,
      })
    } catch {
      nativeFailed = true
    }
  }

  if (nativeFailed) {
    showInAppTicketNotifications(newTickets)
  }
}

interface TicketListPageProps {
  activeTicketId?: string | null
  currentUser?: { role?: string; locale?: string } | null
  onSelectTicket?: (id: string) => void
  onDeselectTicket?: () => void
  mailbox?: any
  onMailboxCountChange?: () => void
}

export interface TicketListHandle {
  refresh: () => void
}

export const TicketListPage = forwardRef<TicketListHandle, TicketListPageProps>(function TicketListPage({ activeTicketId, currentUser, onSelectTicket, onDeselectTicket, mailbox, onMailboxCountChange }, ref) {
  const [tickets, setTickets] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [usersMap, setUsersMap] = useState<Record<string, any>>({})
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all_open')
  const [fetching, setFetching] = useState(false)
  const knownIdsRef = useRef<Set<string> | null>(null)
  const isMobile = useMediaQuery('(max-width: 768px)')
  const canDelete = currentUser?.role === 'admin'
  const locale = currentUser?.locale || undefined

  const loadTickets = useCallback(() => {
    const params = { ...getFilterParams(statusFilter), ...(mailbox?.id ? { mailbox_id: mailbox.id } : {}) }
    api.tickets.list(params).then((data) => {
      if (knownIdsRef.current !== null) {
        const newTickets = data.filter((t: any) => t.unread && !knownIdsRef.current!.has(t.id))
        if (newTickets.length > 0) notifyNewTickets(newTickets)
      }
      knownIdsRef.current = new Set(data.map((t: any) => t.id))
      setTickets(data)
      setLoading(false)
    }).catch(console.error)
  }, [statusFilter, mailbox?.id])

  useImperativeHandle(ref, () => ({ refresh: loadTickets }), [loadTickets])

  const fetchAndRefresh = useCallback(async () => {
    setFetching(true)
    try {
      if (mailbox?.id) await api.mailboxes.fetch(mailbox.id)
    } catch (e: any) {
      notifications.show({ title: 'Email fetch failed', message: e.message, color: 'red' })
    } finally {
      setFetching(false)
    }
    loadTickets()
    onMailboxCountChange?.()
  }, [loadTickets, onMailboxCountChange])

  // Pull-to-refresh
  const scrollRef = useRef<HTMLDivElement>(null)
  const touchStartY = useRef(0)
  const [pullY, setPullY] = useState(0)
  const [displayHeight, setDisplayHeight] = useState(0)
  const [isCollapsing, setIsCollapsing] = useState(false)
  const wasFetchingRef = useRef(false)
  const PULL_THRESHOLD = 65
  const fetchAndRefreshRef = useRef(fetchAndRefresh)
  useEffect(() => { fetchAndRefreshRef.current = fetchAndRefresh }, [fetchAndRefresh])

  const triggerCollapse = useCallback(() => {
    setIsCollapsing(true)
    requestAnimationFrame(() => {
      setDisplayHeight(0)
      setTimeout(() => { setIsCollapsing(false); setPullY(0) }, 350)
    })
  }, [])

  // When fetch completes, animate the indicator back to 0
  useEffect(() => {
    if (wasFetchingRef.current && !fetching) triggerCollapse()
    wasFetchingRef.current = fetching
  }, [fetching, triggerCollapse])

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    if (scrollRef.current?.scrollTop !== 0) return
    touchStartY.current = e.touches[0].clientY
  }, [])

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (!touchStartY.current) return
    if ((scrollRef.current?.scrollTop ?? 0) > 0) { touchStartY.current = 0; return }
    const delta = e.touches[0].clientY - touchStartY.current
    if (delta <= 0) { setPullY(0); setDisplayHeight(0); return }
    const h = Math.min(delta * 0.45, PULL_THRESHOLD + 20)
    setPullY(h)
    setDisplayHeight(h)
  }, [])

  const onTouchEnd = useCallback(() => {
    touchStartY.current = 0
    if (pullY >= PULL_THRESHOLD) {
      setDisplayHeight(PULL_THRESHOLD)
      fetchAndRefreshRef.current()
    } else if (pullY > 0) {
      triggerCollapse()
    }
  }, [pullY, triggerCollapse])

  // Non-passive touchmove to block browser native pull-to-refresh when pulling from top
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const handler = (e: TouchEvent) => {
      if (el.scrollTop === 0 && e.touches[0].clientY > touchStartY.current) {
        e.preventDefault()
      }
    }
    el.addEventListener('touchmove', handler, { passive: false })
    return () => el.removeEventListener('touchmove', handler)
  }, [])

  useEffect(() => {
    api.users.list().then((users) => {
      const map: Record<string, any> = {}
      for (const u of users) map[u.id] = u
      setUsersMap(map)
    }).catch(console.error)
  }, [])

  useEffect(() => {
    setLoading(true)
    loadTickets()
    const interval = setInterval(loadTickets, 60_000)
    return () => clearInterval(interval)
  }, [loadTickets])

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
    if (action === 'delete' && !canDelete) {
      notifications.show({ title: 'Forbidden', message: 'Only admins can delete cases', color: 'red' })
      return
    }
    try {
      await api.tickets.bulk(ids, action, extra)
      setSelected(new Set())
      loadTickets()
      if (action === 'delete' && activeTicketId && ids.includes(activeTicketId)) onDeselectTicket?.()
      if (action === 'mark_read' || action === 'mark_unread' || action === 'delete') onMailboxCountChange?.()
      const labels: Record<string, string> = { delete: 'Deleted', mark_read: 'Marked as read', mark_unread: 'Marked as unread', set_status: `Status changed` }
      notifications.show({ title: labels[action] || action, message: `${ids.length} case(s)`, color: 'green' })
    } catch (e: any) {
      notifications.show({ title: 'Error', message: e.message, color: 'red' })
    }
  }

  return (
    <Box style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <Group justify="space-between" style={{ flexShrink: 0, padding: isMobile ? `var(--mantine-spacing-xs) var(--mantine-spacing-md)` : `0 0 var(--mantine-spacing-xs)`, borderBottom: '1px solid var(--mantine-color-default-border)' }}>
        <Group gap="xs">
          <Title order={2}>Cases</Title>
          {!isMobile && (
          <Tooltip label="Fetch emails &amp; refresh">
            <ActionIcon variant="subtle" size="sm" loading={fetching} onClick={fetchAndRefresh}><IconRefresh size={14} /></ActionIcon>
          </Tooltip>
          )}
        </Group>
        <Group gap="sm">
          {isMobile && selected.size === 0 && (
            <Menu shadow="md" width={160}>
              <Menu.Target>
                <ActionIcon variant={statusFilter !== 'all_open' ? 'light' : 'subtle'} color={statusFilter !== 'all_open' ? 'blue' : undefined} size="sm">
                  <IconFilter size={14} />
                </ActionIcon>
              </Menu.Target>
              <Menu.Dropdown>
                {(['all_open', 'all', 'unassigned', 'active', 'waiting', 'closed', 'parked'] as StatusFilter[]).map((f) => (
                  <Menu.Item
                    key={f}
                    fw={statusFilter === f ? 700 : undefined}
                    leftSection={f !== 'all_open' && f !== 'all' ? <Badge size="xs" color={statusColors[f] || 'gray'} circle /> : undefined}
                    onClick={() => setStatusFilter(f)}
                  >
                    {statusFilterLabels[f]}
                  </Menu.Item>
                ))}
              </Menu.Dropdown>
            </Menu>
          )}
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
                      if (activeTicketId && ids.includes(activeTicketId)) onDeselectTicket?.()
                      notifications.show({ title: 'Cases merged', message: `Merged ${ids.length} cases into #${result.ticket_number}`, color: 'green' })
                    } catch (e: any) {
                      notifications.show({ title: 'Merge failed', message: e.message, color: 'red' })
                    }
                  }}>Merge</Button>
                </Tooltip>
              )}
              {canDelete && (
                <Tooltip label="Delete selected">
                  <Button variant="light" color="red" size="xs" leftSection={<IconTrash size={14} />} onClick={() => bulkAction('delete')}>Delete</Button>
                </Tooltip>
              )}
              <Menu shadow="md" width={150}>
                <Menu.Target>
                  <Button variant="light" size="xs" leftSection={<IconCircle size={14} />}>Status</Button>
                </Menu.Target>
                <Menu.Dropdown>
                  <Menu.Item leftSection={<Badge color="gray" size="xs" circle />} onClick={() => bulkAction('set_status', { status: 'unassigned' })}>Unassigned</Menu.Item>
                  <Menu.Item leftSection={<Badge color="orange" size="xs" circle />} onClick={() => bulkAction('set_status', { status: 'active' })}>Active</Menu.Item>
                  <Menu.Item leftSection={<Badge color="green" size="xs" circle />} onClick={() => bulkAction('set_status', { status: 'waiting' })}>Waiting</Menu.Item>
                  <Menu.Item leftSection={<Badge color="dark" size="xs" circle />} onClick={() => bulkAction('set_status', { status: 'closed' })}>Closed</Menu.Item>
                  <Menu.Item leftSection={<Badge color="#6c757d" size="xs" circle />} onClick={() => bulkAction('set_status', { status: 'parked' })}>Parked</Menu.Item>
                </Menu.Dropdown>
              </Menu>
            </>
          )}
        </Group>
      </Group>
      <Box
        ref={scrollRef}
        style={{ flex: 1, overflowY: 'auto', minHeight: 0, position: 'relative' }}
        onTouchStart={isMobile ? onTouchStart : undefined}
        onTouchMove={isMobile ? onTouchMove : undefined}
        onTouchEnd={isMobile ? onTouchEnd : undefined}
      >
        {isMobile && (displayHeight > 0 || isCollapsing || fetching) && (
          <Box style={{
            position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10,
            height: displayHeight,
            display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
            paddingBottom: 8,
            transition: (isCollapsing || fetching) ? 'height 0.3s ease-in' : undefined,
            background: 'var(--mantine-color-body)',
            borderBottom: '1px solid var(--mantine-color-default-border)',
          }}>
            {fetching
              ? <Loader size="xs" />
              : <IconArrowDown size={18} style={{ opacity: 0.4, transform: pullY >= PULL_THRESHOLD ? 'rotate(180deg)' : undefined, transition: 'transform 0.15s' }} />
            }
          </Box>
        )}
        {isMobile && (displayHeight > 0 || isCollapsing || fetching) && (
          <Box style={{ height: displayHeight, transition: (isCollapsing || fetching) ? 'height 0.3s ease-in' : undefined }} />
        )}
      {isMobile ? (
        <Stack gap={0}>
          {loading ? (
            Array.from({ length: 20 }).map((_, i) => (
              <Box key={i} style={{ padding: 'var(--mantine-spacing-xs) var(--mantine-spacing-sm)', borderBottom: '1px solid var(--mantine-color-default-border)' }}>
                <Group justify="space-between" gap="xs" wrap="nowrap">
                  <Skeleton circle height={30} width={30} style={{ flexShrink: 0 }} />
                  <Box style={{ minWidth: 0, flex: 1 }}>
                    <Skeleton height={12} mb={6} radius="sm" width="70%" />
                    <Skeleton height={10} radius="sm" width="40%" />
                  </Box>
                  <Group gap={6} wrap="nowrap" style={{ flexShrink: 0 }}>
                    <Skeleton height={10} width={36} radius="sm" />
                    <Skeleton height={16} width={18} radius="sm" />
                  </Group>
                </Group>
              </Box>
            ))
          ) : (
          <>
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
                    <Avatar size="sm" radius="xl" color={owner ? hashColor(owner.id) : 'gray'} src={owner?.avatar || null} style={{ flexShrink: 0 }}>
                      {owner?.avatar ? null : (owner ? getInitials(owner.name) : 'U')}
                    </Avatar>
                  ) })()}
                  <Badge size="xs" color="gray.5" variant="filled" radius="xl" style={{ flexShrink: 0 }}>{t.messages?.length ?? 0}</Badge>
                  <Box style={{ minWidth: 0, flex: 1 }}>
                    <Text size="sm" fw={t.unread ? 700 : 400} truncate>#{t.number} {t.subject}</Text>
                    <Text size="xs" c="dimmed" truncate>{t.requester?.name || t.requester?.email}</Text>
                  </Box>
                  <Group gap={6} wrap="nowrap" style={{ flexShrink: 0 }}>
                    <Text size="xs" c="dimmed">{formatDate(t.updated_at, locale)}</Text>
                    <Badge size="xs" color={statusColors[t.status] || 'gray'}>{statusShort[t.status] || t.status[0]?.toUpperCase()}</Badge>
                  </Group>
                </Group>
              </Box>
            )
          })}
          {tickets.length === 0 && (
            <Text c="dimmed" ta="center" py="md">No cases found</Text>
          )}
          </>
          )}
        </Stack>
      ) : (
      <Table striped highlightOnHover fz="xs" stickyHeader>
        <Table.Thead style={{ background: 'var(--mantine-color-body)' }}>
          <Table.Tr>
            <Table.Th w={40}><Checkbox size="xs" checked={tickets.length > 0 && selected.size === tickets.length} indeterminate={selected.size > 0 && selected.size < tickets.length} onChange={toggleAll} /></Table.Th>
            <Table.Th w={1} style={{ whiteSpace: 'nowrap' }}>Owner</Table.Th>
            <Table.Th w={1} style={{ whiteSpace: 'nowrap' }}>#</Table.Th>
            <Table.Th w={1}></Table.Th>
            <Table.Th>Subject</Table.Th>
            <Table.Th>Requester</Table.Th>
            <Table.Th w={1} style={{ whiteSpace: 'nowrap' }}>Updated</Table.Th>
            <Table.Th w={1} style={{ whiteSpace: 'nowrap' }}>
              <Menu shadow="md" width={160}>
                <Menu.Target>
                  <Group gap={4} style={{ cursor: 'pointer', userSelect: 'none', flexWrap: 'nowrap' }} wrap="nowrap">
                    Status
                    <IconFilter size={12} color={statusFilter !== 'all_open' ? 'var(--mantine-color-blue-6)' : undefined} />
                  </Group>
                </Menu.Target>
                <Menu.Dropdown>
                  {(['all_open', 'all', 'unassigned', 'active', 'waiting', 'closed', 'parked'] as StatusFilter[]).map((f) => (
                    <Menu.Item
                      key={f}
                      fw={statusFilter === f ? 700 : undefined}
                      leftSection={f !== 'all_open' && f !== 'all' ? <Badge size="xs" color={statusColors[f] || 'gray'} circle /> : undefined}
                      onClick={() => setStatusFilter(f)}
                    >
                      {statusFilterLabels[f]}
                    </Menu.Item>
                  ))}
                </Menu.Dropdown>
              </Menu>
            </Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {loading ? (
            Array.from({ length: 20 }).map((_, i) => (
              <Table.Tr key={i}>
                <Table.Td><Skeleton height={14} width={14} radius="sm" /></Table.Td>
                <Table.Td><Skeleton circle height={26} width={26} /></Table.Td>
                <Table.Td><Skeleton height={12} width={30} radius="sm" /></Table.Td>
                <Table.Td><Skeleton height={18} width={24} radius="xl" /></Table.Td>
                <Table.Td><Skeleton height={12} radius="sm" width={`${50 + (i * 17) % 35}%`} /></Table.Td>
                <Table.Td><Skeleton height={12} radius="sm" width="80%" /></Table.Td>
                <Table.Td><Skeleton height={12} width={48} radius="sm" /></Table.Td>
                <Table.Td><Skeleton height={18} width={60} radius="sm" /></Table.Td>
              </Table.Tr>
            ))
          ) : (
          <>
          {tickets.map((t) => {
            const isActive = activeTicketId === t.id
            const handleClick = () => onSelectTicket?.(t.id)
            return (
              <Table.Tr key={t.id} style={{ cursor: 'pointer', fontWeight: t.unread ? 700 : 400, background: isActive ? 'var(--mantine-primary-color-light)' : undefined }}>
                <Table.Td onClick={e => e.stopPropagation()}><Checkbox size="xs" checked={selected.has(t.id)} onChange={() => toggleSelect(t.id)} /></Table.Td>
                <Table.Td onClick={handleClick}>{(() => { const owner = t.owner_id ? usersMap[t.owner_id] : null; return (
                  <Tooltip label={owner ? owner.name : 'Unassigned'} withArrow>
                    <Avatar size="sm" radius="xl" color={owner ? hashColor(owner.id) : 'gray'} src={owner?.avatar || null}>
                      {owner?.avatar ? null : (owner ? getInitials(owner.name) : 'U')}
                    </Avatar>
                  </Tooltip>
                ) })()}</Table.Td>
                <Table.Td onClick={handleClick}>{t.number}</Table.Td>
                <Table.Td onClick={handleClick} style={{ whiteSpace: 'nowrap', textAlign: 'center' }}>
                  <Badge size="xs" color="gray.5" variant="filled" radius="xl" styles={{ label: { overflow: 'visible', textOverflow: 'unset' } }}>{t.messages?.length ?? 0}</Badge>
                </Table.Td>
                <Table.Td onClick={handleClick}>{t.subject}</Table.Td>
                <Table.Td onClick={handleClick}>{t.requester?.name || t.requester?.email}</Table.Td>
                <Table.Td onClick={handleClick} style={{ whiteSpace: 'nowrap' }}>{formatDate(t.updated_at, locale)}</Table.Td>
                <Table.Td onClick={handleClick} style={{ whiteSpace: 'nowrap' }}><Badge size="xs" color={statusColors[t.status] || 'gray'} styles={{ label: { overflow: 'visible', textOverflow: 'unset' } }}>{t.status}</Badge></Table.Td>
              </Table.Tr>
            )
          })}
          {tickets.length === 0 && (
            <Table.Tr>
              <Table.Td colSpan={8}><Text c="dimmed" ta="center">No cases found</Text></Table.Td>
            </Table.Tr>
          )}
          </>
          )}
        </Table.Tbody>
      </Table>
      )}
      </Box>
    </Box>
  )
})
