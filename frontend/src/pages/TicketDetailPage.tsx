import React, { useEffect, useState, useMemo, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import { Title, Text, Paper, Badge, Stack, Group, Box, ActionIcon, Tooltip, Alert, Button as MButton, Modal, Menu } from '@mantine/core'
import { IconRefresh, IconSend, IconPaperclip, IconArrowLeft, IconUserCheck } from '@tabler/icons-react'
import { api } from '../api/client'
import { ReplyEditor } from '../components/ReplyEditor'
import { notifications } from '@mantine/notifications'
import { useDisclosure } from '@mantine/hooks'

const statusColors: Record<string, string> = {
  unassigned: 'gray',
  active: 'orange',
  waiting: 'green',
  closed: 'dark',
}

function formatDate(d: string | Date): string {
  const date = new Date(d)
  const today = new Date()
  if (date.toDateString() === today.toDateString()) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }
  return date.toLocaleString()
}

function sanitizeHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/\s+on\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]*)/gi, '')
}

function openImageWindow(src: string) {
  const html = `<!DOCTYPE html><html><head><title>Image</title><style>body{margin:0;display:flex;justify-content:center;align-items:center;min-height:100vh;background:#222}img{max-width:100%;max-height:100vh;object-fit:contain}</style></head><body><img src="${src.replace(/"/g, '&quot;')}"></body></html>`
  const blob = new Blob([html], { type: 'text/html' })
  window.open(URL.createObjectURL(blob), '_blank')
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
      node.querySelectorAll('img').forEach((img) => {
        img.style.cursor = 'pointer'
        img.onclick = (e) => {
          e.preventDefault()
          openImageWindow(img.src)
        }
      })
    }, [safe])
    return (
      <Box>
        <style>{`.MsoNormal { margin: 0 !important; } pre, code { background-color: var(--mantine-color-default-hover); border-radius: 4px; } code { padding: 2px 4px; font-size: 0.9em; } pre { padding: 12px; overflow-x: auto; } pre code { padding: 0; background: none; } .msg-body img { max-width: 800px; height: auto; }`}</style>
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

function getCurrentUserId(): string | null {
  try {
    const token = localStorage.getItem('token')
    if (!token) return null
    const payload = JSON.parse(atob(token.split('.')[1]))
    return payload.sub || null
  } catch { return null }
}

interface TicketDetailPageProps {
  ticketId?: string
  onBack?: () => void
  onTicketUpdate?: () => void
}

export function TicketDetailPage({ ticketId: propId, onBack, onTicketUpdate }: TicketDetailPageProps = {}) {
  const { id: paramId } = useParams<{ id: string }>()
  const id = propId || paramId
  const [ticket, setTicket] = useState<any>(null)
  const [users, setUsers] = useState<any[]>([])
  const [settings, setSettings] = useState<any>(null)
  const [signature, setSignature] = useState<string>('')
  const [resendOpened, { open: openResend, close: closeResend }] = useDisclosure(false)
  const [resendIdx, setResendIdx] = useState<number | null>(null)

  useEffect(() => {
    if (id) api.tickets.get(id).then(setTicket).catch(console.error)
    api.users.list().then(setUsers).catch(() => {})
    api.settings.get().then((s: any) => { setSettings(s); setSignature(s?.signature || '') }).catch(() => {})
  }, [id])

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
    if (!ticket || !settings) return []
    const ownAddr = (settings.email?.smtp_from || settings.email?.smtp_user || settings.email?.imap_user || '').toLowerCase()
    const requester = (ticket.requester?.email || '').toLowerCase()
    for (let i = ticket.messages.length - 1; i >= 0; i--) {
      const msg = ticket.messages[i]
      if (msg.from === 'agent' || !msg.cc?.length) continue
      return msg.cc
        .map((addr: string) => { const idx = addr.indexOf('<'); return idx >= 0 ? addr.slice(idx + 1).replace(/[> ]+$/, '').trim() : addr.trim() })
        .filter((addr: string) => { const l = addr.toLowerCase(); return l && l !== ownAddr && l !== requester })
    }
    return []
  }, [ticket, settings])

  if (!ticket) return <Text>Loading...</Text>

  const currentUserId = getCurrentUserId()
  const ownerUser = users.find((u: any) => u.id === ticket.owner_id)
  const isOwned = !!ticket.owner_id
  const isOwnedByMe = ticket.owner_id === currentUserId

  const handleClaim = async () => {
    if (!id) return
    await api.tickets.claim(id)
    api.tickets.get(id).then(setTicket)
    onTicketUpdate?.()
  }

  return (
    <Box style={{ display: 'flex', flexDirection: 'column', position: 'absolute', inset: 0 }}>
      <Group justify="space-between" style={{ flexShrink: 0, padding: 'var(--mantine-spacing-md)', paddingBottom: 'var(--mantine-spacing-xs)', boxShadow: '0 2px 8px rgba(0,0,0,0.15)', zIndex: 1 }}>
        <Group gap="xs">
          {onBack && (
            <ActionIcon variant="subtle" onClick={onBack}>
              <IconArrowLeft size={18} />
            </ActionIcon>
          )}
          <Title order={2}>#{ticket.number} {ticket.subject}</Title>
        </Group>
        <Group gap="sm">
          {isOwned ? (
            <Badge variant="light" color={isOwnedByMe ? 'green' : 'blue'} size="lg">{ownerUser?.name || 'Unknown'}</Badge>
          ) : (
            <Tooltip label="Assign to me">
              <ActionIcon variant="light" color="blue" onClick={handleClaim}>
                <IconUserCheck size={18} />
              </ActionIcon>
            </Tooltip>
          )}
          <Menu shadow="md" width={160}>
            <Menu.Target>
              <Badge color={statusColors[ticket.status] || 'gray'} size="lg" style={{ cursor: 'pointer' }}>{ticket.status}</Badge>
            </Menu.Target>
            <Menu.Dropdown>
              {(['unassigned', 'active', 'waiting', 'closed'] as const).map(s => (
                <Menu.Item key={s} disabled={ticket.status === s} leftSection={<Badge color={statusColors[s]} size="xs" circle />} onClick={() => handleSetStatus(s)}>
                  {s.charAt(0).toUpperCase() + s.slice(1)}
                </Menu.Item>
              ))}
            </Menu.Dropdown>
          </Menu>
        </Group>
      </Group>
      <Box style={{ flex: 1, overflowY: 'auto', minHeight: 0, padding: 'var(--mantine-spacing-md)', paddingTop: 'var(--mantine-spacing-sm)' }}>

      <Stack gap="md">
        {ticket.messages?.map((msg: any, i: number) => ({ msg, i })).reverse().map(({ msg, i }: { msg: any; i: number }, renderIdx: number) => {
          const smtpFrom = settings?.email?.smtp_from
          const isOutgoing = msg.from === 'agent' || (smtpFrom && msg.from === smtpFrom)
          const displayFrom = msg.from === 'agent' ? smtpFrom || 'agent' : msg.from
          return (<React.Fragment key={i}>
          <Paper withBorder p={0} radius="md" style={{ overflow: 'hidden' }}>
            <Box p="xs" style={{ background: 'var(--mantine-color-default-hover)', position: 'relative' }}>
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
            <MessageBody msg={msg} isOutgoing={isOutgoing} />
            {msg.attachments?.some((att: any) => att.content_type?.startsWith('image/')) && (
              <Stack gap="xs" mt="sm">
                {msg.attachments.map((att: any, j: number) =>
                  att.content_type?.startsWith('image/') ? (
                    <Box key={j}>
                      <img
                        src={attachmentUrl(ticket.id, i, j)}
                        alt={att.filename}
                        style={{ maxWidth: 800, borderRadius: 4, cursor: 'pointer' }}
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
          {renderIdx === 0 && (
            <Paper withBorder p={0} radius="md" style={{ overflow: 'hidden', marginBottom: 'var(--mantine-spacing-md)' }}>
              <Box p="xs" style={{ background: 'var(--mantine-color-default-hover)' }}>
                <Text size="sm" mb={2}><Text span fw={600}>Subject:</Text> Re: [#{ticket.number}] {ticket.subject}</Text>
                <Text size="sm" mb={2}><Text span fw={600}>To:</Text> {ticket.requester?.email}</Text>
                {replyCc.length > 0 && (
                  <Text size="sm" mb={2}><Text span fw={600}>Cc:</Text> {replyCc.join(', ')}</Text>
                )}
              </Box>
              <ReplyEditor onSend={handleSend} onSendAndClose={ticket.status !== 'closed' ? handleSendAndClose : undefined} signature={signature} />
            </Paper>
          )}
        </React.Fragment>)})}
      </Stack>

      </Box>

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
