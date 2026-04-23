import React, { useEffect, useState, useMemo, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import { Title, Text, Paper, Badge, Stack, Group, Box, ActionIcon, Tooltip, Alert, Button as MButton, Modal, Menu, Avatar, Skeleton, TextInput } from '@mantine/core'
import { IconRefresh, IconSend, IconPaperclip, IconArrowLeft, IconTrash } from '@tabler/icons-react'
import { api } from '../api/client'
import { formatDistanceToNow } from 'date-fns'
import { ReplyEditor } from '../components/ReplyEditor'
import { notifications } from '@mantine/notifications'
import { useDisclosure, useMediaQuery } from '@mantine/hooks'

const REPLY_PREFIXES = ['Re: ', 'RE: ', 're: ', 'AW: ', 'Aw: ', 'aw: ', 'Fwd: ', 'FWD: ', 'fwd: ', 'WG: ', 'Wg: ', 'SV: ', 'Sv: ', 'VS: ', 'Vs: ', 'TR: ', 'Tr: ']

function stripReplyPrefixes(subject: string): string {
  let s = subject
  let stripped = true
  while (stripped) {
    stripped = false
    for (const p of REPLY_PREFIXES) {
      if (s.startsWith(p)) { s = s.slice(p.length); stripped = true }
    }
  }
  return s
}

function buildReplySubject(number: number, subject: string): string {
  const tag = `[#${number}]`
  const bare = stripReplyPrefixes(subject)
  if (subject.includes(tag)) return `Re: ${bare}`
  return `Re: ${tag} ${bare}`
}


const statusColors: Record<string, string> = {
  unassigned: 'gray',
  active: 'orange',
  waiting: 'green',
  closed: 'dark',
  parked: '#6c757d',
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
  return formatDistanceToNow(new Date(d), { addSuffix: true })
}

function sanitizeHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/\s+on\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]*)/gi, '')
}

function withAuthTokenIfNeeded(rawUrl: string): string {
  try {
    const url = new URL(rawUrl, window.location.origin)
    const isSameOrigin = url.origin === window.location.origin
    const isApiPath = url.pathname.startsWith('/api/')
    if (!isSameOrigin || !isApiPath) return url.toString()
    if (url.searchParams.has('token')) return url.toString()
    const token = localStorage.getItem('token')
    if (!token) return url.toString()
    url.searchParams.set('token', token)
    return url.toString()
  } catch {
    return rawUrl
  }
}

function openImageWindow(src: string) {
  const imageSrc = withAuthTokenIfNeeded(src)
  const popup = window.open('', '_blank')
  if (!popup) return

  const escapedSrc = imageSrc
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')

  popup.document.open()
  popup.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Image</title><style>html,body{margin:0;height:100%;background:#111}body{display:flex;align-items:center;justify-content:center;padding:12px;box-sizing:border-box}img{max-width:100%;max-height:100%;width:auto;height:auto;object-fit:contain}.error{max-width:900px;color:#f5f5f5;background:#262626;border:1px solid #4a4a4a;border-radius:8px;padding:12px;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;white-space:pre-wrap;word-break:break-word}</style></head><body><img id="popup-image" src="${escapedSrc}" alt="image" /><script>const img=document.getElementById('popup-image');img.addEventListener('error',()=>{document.body.innerHTML='<div class="error">Failed to load image in popup.\n\nSource:\n${escapedSrc}</div>'});</script></body></html>`)
  popup.document.close()
}

function stripSignature(html: string): string {
  // Remove signature block starting with <p>--</p> or plain -- separator
  return html.replace(/<p>--<\/p>[\s\S]*$/, '').replace(/\n--\n[\s\S]*$/, '')
}

function MessageBody({ msg, isOutgoing }: { msg: any; isOutgoing?: boolean }) {
  if (msg.html) {
    const safe = useMemo(() => {
      const html = sanitizeHtml(msg.html)
      return isOutgoing ? stripSignature(html) : html
    }, [msg.html, isOutgoing])
    const refCallback = useCallback((node: HTMLDivElement | null) => {
      if (!node) return
      node.querySelectorAll('a').forEach((link) => {
        link.target = '_blank'
        link.rel = 'noopener noreferrer'
      })
      node.querySelectorAll('img').forEach((img) => {
        img.style.cursor = 'pointer'
      })

      const handleClick = (e: MouseEvent) => {
        const target = e.target as HTMLElement | null
        if (!target) return
        const img = target.closest('img') as HTMLImageElement | null
        if (!img) return
        e.preventDefault()
        e.stopPropagation()
        const imageUrl = img.currentSrc || img.src || img.getAttribute('src') || ''
        if (!imageUrl) return
        openImageWindow(imageUrl)
      }

      node.addEventListener('click', handleClick)
      return () => node.removeEventListener('click', handleClick)
    }, [])
    return (
      <Box>
        <style>{`.MsoNormal { margin: 0 !important; } pre, code { background-color: light-dark(var(--mantine-color-gray-1), var(--mantine-color-dark-6)); border-radius: 4px; } code { padding: 2px 4px; font-size: 0.9em; } pre { padding: 12px; overflow-x: auto; } pre code { padding: 0; background: none; } .msg-body img { max-width: min(100%, 800px) !important; width: auto !important; height: auto !important; object-fit: contain; }`}</style>
        <div className="msg-body" ref={refCallback} dangerouslySetInnerHTML={{ __html: safe }} />
      </Box>
    )
  }
  return (
    <Text style={{ whiteSpace: 'pre-wrap', fontFamily: 'monospace' }} size="sm">
      {isOutgoing ? msg.body.replace(/\n--\n[\s\S]*$/, '') : msg.body}
    </Text>
  )
}

function attachmentUrl(ticketId: string, msgIdx: number, attIdx: number): string {
  const token = localStorage.getItem('token') || ''
  return `/api/v1/tickets/${ticketId}/messages/${msgIdx}/attachments/${attIdx}?token=${encodeURIComponent(token)}`
}

interface TicketDetailPageProps {
  ticketId?: string
  onBack?: () => void
  onTicketUpdate?: () => void
  onNotFound?: () => void
  mailbox?: any
}

export function TicketDetailPage({ ticketId: propId, onBack, onTicketUpdate, onNotFound, mailbox }: TicketDetailPageProps = {}) {
  const { id: paramId } = useParams<{ id: string }>()
  const id = propId || paramId
  const isMobile = useMediaQuery('(max-width: 768px)')
  const [ticket, setTicket] = useState<any>(null)
  const [users, setUsers] = useState<any[]>([])

  const signature = mailbox?.signature || ''
  const [resendOpened, { open: openResend, close: closeResend }] = useDisclosure(false)
  const [resendIdx, setResendIdx] = useState<number | null>(null)
  const [deleteOpened, { open: openDelete, close: closeDelete }] = useDisclosure(false)

  useEffect(() => {
    if (id) api.tickets.get(id).then((t) => { setTicket(t); onTicketUpdate?.() }).catch(() => onNotFound?.())
    api.users.list().then(setUsers).catch(() => {})
  }, [id])

  const handleAddNote = async (html: string, text: string) => {
    if (!id) return
    await api.tickets.note(id, { body: text, html })
    notifications.show({ title: 'Note added', message: 'Private note saved', color: 'green' })
    api.tickets.get(id).then(setTicket)
    onTicketUpdate?.()
  }

  const handleSend = async (html: string, text: string) => {
    if (!id) return
    const result = await api.tickets.reply(id, { body: text, html })
    if (result.send_error) {
      notifications.show({ title: 'Send failed', message: result.send_error, color: 'red' })
    } else {
      notifications.show({ title: 'Reply sent', message: 'Email delivered successfully', color: 'green' })
    }
    api.tickets.get(id).then(setTicket)
    onTicketUpdate?.()
  }

  const handleSendAndClose = async (html: string, text: string) => {
    if (!id) return
    const result = await api.tickets.reply(id, { body: text, html })
    await api.tickets.setStatus(id, 'closed')
    if (result.send_error) {
      notifications.show({ title: 'Send failed', message: result.send_error, color: 'red' })
    } else {
      notifications.show({ title: 'Reply sent & case closed', message: 'Email delivered successfully', color: 'green' })
    }
    api.tickets.get(id).then(setTicket)
    onTicketUpdate?.()
  }

  const handleSetStatus = async (status: string) => {
    if (!id) return
    await api.tickets.setStatus(id, status)
    api.tickets.get(id).then(setTicket)
    onTicketUpdate?.()
  }

  const replyCc = useMemo(() => {
    if (!ticket || !mailbox) return []
    const ownAddr = (mailbox.email?.smtp_from || mailbox.email?.smtp_user || mailbox.email?.imap_user || '').toLowerCase()
    const requester = (ticket.requester?.email || '').toLowerCase()
    for (let i = ticket.messages.length - 1; i >= 0; i--) {
      const msg = ticket.messages[i]
      if (msg.from === 'agent' || !msg.cc?.length) continue
      return msg.cc
        .map((addr: string) => { const idx = addr.indexOf('<'); return idx >= 0 ? addr.slice(idx + 1).replace(/[> ]+$/, '').trim() : addr.trim() })
        .filter((addr: string) => { const l = addr.toLowerCase(); return l && l !== ownAddr && l !== requester })
    }
    return []
  }, [ticket, mailbox])

  if (!ticket) return (
    <Box style={{ display: 'flex', flexDirection: 'column', position: 'absolute', inset: 0 }}>
      <Box style={{ flexShrink: 0, padding: 'var(--mantine-spacing-md)', paddingBottom: 'var(--mantine-spacing-xs)', boxShadow: '0 2px 8px rgba(0,0,0,0.15)' }}>
        <Group gap="xs" mb={8}>
          <Skeleton circle height={36} width={36} />
          <Skeleton height={24} width="55%" radius="sm" />
        </Group>
        <Skeleton height={16} width="30%" radius="sm" />
      </Box>
      <Stack gap="md" p="md" style={{ flex: 1, overflowY: 'auto' }}>
        {Array.from({ length: 3 }).map((_, i) => (
          <Paper key={i} withBorder p={0} radius="md" style={{ overflow: 'hidden' }}>
            <Box p="xs" style={{ background: 'light-dark(var(--mantine-color-gray-1), var(--mantine-color-dark-6))' }}>
              <Skeleton height={12} width="25%" radius="sm" mb={6} />
              <Skeleton height={10} width="40%" radius="sm" />
            </Box>
            <Box p="md">
              <Skeleton height={12} radius="sm" mb={6} />
              <Skeleton height={12} radius="sm" mb={6} width="85%" />
              <Skeleton height={12} radius="sm" width="60%" />
            </Box>
          </Paper>
        ))}
      </Stack>
    </Box>
  )

  const ownerUser = users.find((u: any) => u.id === ticket.owner_id)
  const isOwned = !!ticket.owner_id

  const handleClaim = async () => {
    if (!id) return
    await api.tickets.claim(id)
    api.tickets.get(id).then(setTicket)
    onTicketUpdate?.()
  }

  const handleRename = async (newSubject: string) => {
    const trimmed = newSubject.trim()
    if (!id || !trimmed || trimmed === ticket.subject) return
    try {
      await api.tickets.rename(id, trimmed)
      setTicket((t: any) => ({ ...t, subject: trimmed }))
      onTicketUpdate?.()
    } catch {
      notifications.show({ title: 'Rename failed', message: 'Could not update subject', color: 'red' })
    }
  }

  return (
    <Box style={{ display: 'flex', flexDirection: 'column', position: 'absolute', inset: 0 }}>
      {isMobile ? (
        <Box style={{ flexShrink: 0, padding: 'var(--mantine-spacing-xs) var(--mantine-spacing-sm)', boxShadow: '0 2px 8px rgba(0,0,0,0.15)', position: 'relative', zIndex: 1 }}>
          <Group justify="space-between" wrap="nowrap" gap="xs" mb={4}>
            <Group gap="xs" wrap="nowrap">
              {onBack && (
                <ActionIcon variant="subtle" onClick={onBack}>
                  <IconArrowLeft size={18} />
                </ActionIcon>
              )}
              <Tooltip label={isOwned ? (ownerUser?.name || 'Unknown') : 'Assign to me'} withArrow>
                <Avatar
                  size="sm"
                  radius="xl"
                  color={isOwned ? hashColor(ticket.owner_id) : 'gray'}
                  src={isOwned && ownerUser?.avatar ? ownerUser.avatar : null}
                  style={{ cursor: isOwned ? 'default' : 'pointer' }}
                  onClick={isOwned ? undefined : handleClaim}
                >
                  {isOwned && ownerUser?.avatar ? null : (isOwned ? getInitials(ownerUser?.name || '?') : 'U')}
                </Avatar>
              </Tooltip>
            </Group>
            <Group gap="xs" wrap="nowrap">
              <Menu shadow="md" width={160}>
                <Menu.Target>
                  <Badge color={statusColors[ticket.status] || 'gray'} size="lg" style={{ cursor: 'pointer' }}>{ticket.status}</Badge>
                </Menu.Target>
                <Menu.Dropdown>
                  {(['unassigned', 'active', 'waiting', 'closed', 'parked'] as const).map(s => (
                    <Menu.Item key={s} disabled={ticket.status === s} leftSection={<Badge color={statusColors[s]} size="xs" circle />} onClick={() => handleSetStatus(s)}>
                      {s.charAt(0).toUpperCase() + s.slice(1)}
                    </Menu.Item>
                  ))}
                </Menu.Dropdown>
              </Menu>
              <ActionIcon variant="subtle" color="red" onClick={openDelete}>
                <IconTrash size={18} />
              </ActionIcon>
            </Group>
          </Group>
          <Group gap={4} wrap="nowrap" align="center" style={{ minWidth: 0 }}>
            <Title order={4} style={{ flexShrink: 0 }}>#{ticket.number}</Title>
            <TextInput
              key={ticket.id}
              defaultValue={ticket.subject}
              onBlur={(e) => handleRename(e.currentTarget.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
              className="inline-edit-subject"
              styles={{ root: { flex: 1, minWidth: 0 }, input: { fontSize: 'var(--mantine-h4-font-size)', fontWeight: 700, lineHeight: 'var(--mantine-h4-line-height)', padding: '0 4px', height: 'auto', minHeight: 'unset' } }}
            />
          </Group>
        </Box>
      ) : (
      <Group justify="space-between" wrap="nowrap" style={{ flexShrink: 0, padding: 'var(--mantine-spacing-md)', paddingBottom: 'var(--mantine-spacing-xs)', boxShadow: '0 2px 8px rgba(0,0,0,0.15)', position: 'relative', zIndex: 1 }}>
        <Group gap="xs" style={{ flex: 1, minWidth: 0 }} wrap="nowrap">
          {onBack && (
            <ActionIcon variant="subtle" onClick={onBack}>
              <IconArrowLeft size={18} />
            </ActionIcon>
          )}
          <Tooltip label={isOwned ? (ownerUser?.name || 'Unknown') : 'Assign to me'} withArrow>
            <Avatar
              radius="xl"
              color={isOwned ? hashColor(ticket.owner_id) : 'gray'}
              src={isOwned && ownerUser?.avatar ? ownerUser.avatar : null}
              style={{ cursor: isOwned ? 'default' : 'pointer' }}
              onClick={isOwned ? undefined : handleClaim}
            >
              {isOwned && ownerUser?.avatar ? null : (isOwned ? getInitials(ownerUser?.name || '?') : 'U')}
            </Avatar>
          </Tooltip>
          <Title order={2} style={{ flexShrink: 0 }}>#{ticket.number}</Title>
          <TextInput
            key={ticket.id}
            defaultValue={ticket.subject}
            onBlur={(e) => handleRename(e.currentTarget.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
            className="inline-edit-subject"
            styles={{ root: { flex: 1, minWidth: 0 }, input: { fontSize: 'var(--mantine-h2-font-size)', fontWeight: 700, lineHeight: 'var(--mantine-h2-line-height)', padding: '0 4px', height: 'auto', minHeight: 'unset' } }}
          />
        </Group>
        <Group gap="sm" style={{ flexShrink: 0 }}>
          <Menu shadow="md" width={160}>
            <Menu.Target>
              <Badge color={statusColors[ticket.status] || 'gray'} size="lg" style={{ cursor: 'pointer' }}>{ticket.status}</Badge>
            </Menu.Target>
            <Menu.Dropdown>
              {(['unassigned', 'active', 'waiting', 'closed', 'parked'] as const).map(s => (
                <Menu.Item key={s} disabled={ticket.status === s} leftSection={<Badge color={statusColors[s]} size="xs" circle />} onClick={() => handleSetStatus(s)}>
                  {s.charAt(0).toUpperCase() + s.slice(1)}
                </Menu.Item>
              ))}
            </Menu.Dropdown>
          </Menu>
        </Group>
      </Group>
      )}
      <Box style={{ flex: 1, overflowY: 'auto', minHeight: 0, padding: 'var(--mantine-spacing-md)', paddingTop: 'var(--mantine-spacing-sm)', position: 'relative', zIndex: 0 }}>

      <Stack gap="md">
        <Paper withBorder p={0} radius="md" style={{ overflow: 'hidden', marginBottom: 'var(--mantine-spacing-md)' }}>
          <Box p="xs" style={{ background: 'light-dark(var(--mantine-color-gray-1), var(--mantine-color-dark-6))' }}>
            <Text size="sm" mb={2}><Text span fw={600}>Subject:</Text> {buildReplySubject(ticket.number, ticket.subject)}</Text>
            <Text size="sm" mb={2}><Text span fw={600}>To:</Text> {ticket.requester?.email}</Text>
            {replyCc.length > 0 && (
              <Text size="sm" mb={2}><Text span fw={600}>Cc:</Text> {replyCc.join(', ')}</Text>
            )}
          </Box>
          <ReplyEditor onSend={handleSend} onSendAndClose={ticket.status !== 'closed' ? handleSendAndClose : undefined} onAddNote={handleAddNote} signature={signature} />
        </Paper>
        {ticket.messages?.map((msg: any, i: number) => ({ msg, i })).reverse().map(({ msg, i }: { msg: any; i: number }) => {
          const smtpFrom = mailbox?.email?.smtp_from
          const isOutgoing = msg.from === 'agent' || (smtpFrom && msg.from === smtpFrom)
          const displayFrom = msg.from === 'agent' ? smtpFrom || 'agent' : msg.from
          const headerBg = msg.private
            ? 'light-dark(var(--mantine-color-red-1), var(--mantine-color-red-7))'
            : 'light-dark(var(--mantine-color-gray-1), var(--mantine-color-dark-6))'
          return (<React.Fragment key={i}>
          <Paper withBorder p={0} radius="md" style={{ overflow: 'hidden' }}>
            <Box p="xs" style={{ background: headerBg, position: 'relative' }}>
              {msg.private ? (
                <Box style={{ display: 'flex', alignItems: 'center', minHeight: 24 }}>
                  <Badge color="red" variant="filled" size="sm" style={{ '--badge-bg': 'light-dark(var(--mantine-color-red-6), white)', '--badge-color': 'light-dark(white, var(--mantine-color-red-7))' } as React.CSSProperties}>Private Note</Badge>
                  <Text size="xs" style={{ position: 'absolute', top: '50%', transform: 'translateY(-50%)', right: 8, color: 'light-dark(var(--mantine-color-gray-6), var(--mantine-color-red-2))' }}>{formatDate(msg.created_at)}</Text>
                </Box>
              ) : (
                <>
                  <Text size="xs" c="dimmed" style={{ position: 'absolute', top: 8, right: 8 }}>{formatDate(msg.created_at)}</Text>
                  {isOutgoing && !msg.send_error && (
                    <Tooltip label="Re-send">
                      <ActionIcon
                        variant="default"
                        style={{ position: 'absolute', bottom: 8, right: 8 }}
                        onClick={() => { setResendIdx(i); openResend() }}
                      >
                        <IconSend size={14} />
                      </ActionIcon>
                    </Tooltip>
                  )}
                  {msg.subject && (
                    <Text size="sm" mb={2}><Text span fw={600}>Subject:</Text> {msg.subject}</Text>
                  )}
                  <Group gap="xs" mb={2}>
                    <Text size="sm"><Text span fw={600}>From:</Text> <Text span c={msg.from === 'agent' ? 'dimmed' : undefined}>{displayFrom}</Text></Text>
                    {msg.send_error && <Badge color="red" size="sm" variant="light">Unsent</Badge>}
                  </Group>
                  {msg.to?.length > 0 && (
                    <Text size="sm" mb={2}><Text span fw={600}>To:</Text> {msg.to.join(', ')}</Text>
                  )}
                  {msg.cc?.length > 0 && (
                    <Text size="sm" mb={2}><Text span fw={600}>Cc:</Text> {msg.cc.join(', ')}</Text>
                  )}
                </>
              )}
            </Box>
            <Box p="md">
            {msg.send_error && (
              <Alert color="red" variant="light" mb="sm" p="xs">
                <Group justify="space-between" align="center">
                  <Text size="xs" c="red">Failed to send: {msg.send_error}</Text>
                  <Tooltip label="Retry sending">
                    <ActionIcon
                      variant="light"
                      color="red"
                      size="sm"
                      onClick={async () => {
                        try {
                          await api.tickets.retrySend(id!, i)
                          notifications.show({ title: 'Message sent', message: 'Email delivered successfully', color: 'green' })
                        } catch { /* refresh will show updated error */ }
                        api.tickets.get(id!).then(setTicket)
                      }}
                    >
                      <IconRefresh size={14} />
                    </ActionIcon>
                  </Tooltip>
                </Group>
              </Alert>
            )}
            {msg.attachments?.some((att: any) => !att.content_type?.startsWith('image/')) && (
              <Group gap="xs" mb="sm">
                <IconPaperclip size={14} style={{ opacity: 0.5 }} />
                {msg.attachments.map((att: any, j: number) =>
                  att.content_type?.startsWith('image/') ? null : (
                    <MButton
                      key={j}
                      size="compact-xs"
                      variant="light"
                      component="a"
                      href={attachmentUrl(ticket.id, i, j)}
                      download={att.filename}
                    >
                      {att.filename} ({Math.round(att.size / 1024)}KB)
                    </MButton>
                  )
                )}
              </Group>
            )}
            <MessageBody msg={msg} isOutgoing={isOutgoing || msg.private} />
            {msg.attachments?.some((att: any) => att.content_type?.startsWith('image/')) && (
              <Stack gap="xs" mt="sm">
                {msg.attachments.map((att: any, j: number) =>
                  att.content_type?.startsWith('image/') ? (
                    <Box key={j}>
                      <img
                        src={attachmentUrl(ticket.id, i, j)}
                        alt={att.filename}
                        style={{ maxWidth: 'min(100%, 800px)', width: 'auto', height: 'auto', maxHeight: '70vh', objectFit: 'contain', borderRadius: 4, cursor: 'pointer' }}
                        onClick={() => openImageWindow(attachmentUrl(ticket.id, i, j))}
                      />
                      <Text size="xs" c="dimmed">{att.filename}</Text>
                    </Box>
                  ) : null
                )}
              </Stack>
            )}
            </Box>
          </Paper>
        </React.Fragment>)})}
      </Stack>

      </Box>

      <Modal opened={deleteOpened} onClose={closeDelete} title="Delete ticket" centered size="sm">
        <Text size="sm" mb="md">Are you sure you want to delete this ticket? This action cannot be undone.</Text>
        <Group justify="flex-end" gap="sm">
          <MButton variant="default" onClick={closeDelete}>Cancel</MButton>
          <MButton color="red" onClick={async () => {
            closeDelete()
            try {
              await api.tickets.delete(id!)
              notifications.show({ title: 'Ticket deleted', message: 'Ticket has been removed', color: 'green' })
              onBack?.()
            } catch {
              notifications.show({ title: 'Delete failed', message: 'Could not delete ticket', color: 'red' })
            }
          }}>Delete</MButton>
        </Group>
      </Modal>

      <Modal opened={resendOpened} onClose={closeResend} title="Re-send message" centered size="sm">
        <Text size="sm" mb="md">Are you sure you want to re-send this message?</Text>
        <Group justify="flex-end" gap="sm">
          <MButton variant="default" onClick={closeResend}>Cancel</MButton>
          <MButton color="blue" onClick={async () => {
            closeResend()
            if (resendIdx !== null) {
              try {
                await api.tickets.retrySend(id!, resendIdx)
                notifications.show({ title: 'Message sent', message: 'Email delivered successfully', color: 'green' })
              } catch { /* refresh will show error */ }
              api.tickets.get(id!).then(setTicket)
            }
          }}>Re-send</MButton>
        </Group>
      </Modal>
    </Box>
  )
}
