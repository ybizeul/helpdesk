import { useEffect, useState, useMemo } from 'react'
import { useParams } from 'react-router-dom'
import { Title, Text, Paper, Badge, Stack, Group, Divider, Box, ActionIcon, Tooltip, Alert, Button as MButton } from '@mantine/core'
import { IconLock, IconLockOpen, IconRefresh, IconSend, IconPaperclip } from '@tabler/icons-react'
import { api } from '../api/client'
import { ReplyEditor } from '../components/ReplyEditor'
import { notifications } from '@mantine/notifications'

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
  return date.toLocaleString()
}

function sanitizeHtml(html: string): string {
  // Strip <script>, <style>, on* attributes for safe rendering
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/\s+on\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]*)/gi, '')
}

function MessageBody({ msg }: { msg: any }) {
  if (msg.html) {
    const safe = useMemo(() => sanitizeHtml(msg.html), [msg.html])
    return (
      <Box style={{ overflow: 'auto' }}>
        <style>{`.MsoNormal { margin: 0 !important; } pre, code { background-color: #f5f5f5; border-radius: 4px; } code { padding: 2px 4px; font-size: 0.9em; } pre { padding: 12px; overflow-x: auto; } pre code { padding: 0; background: none; }`}</style>
        <div dangerouslySetInnerHTML={{ __html: safe }} />
      </Box>
    )
  }
  return (
    <Text style={{ whiteSpace: 'pre-wrap', fontFamily: 'monospace' }} size="sm">
      {msg.body}
    </Text>
  )
}

function attachmentUrl(ticketId: string, msgIdx: number, attIdx: number): string {
  const token = localStorage.getItem('token') || ''
  return `/api/v1/tickets/${ticketId}/messages/${msgIdx}/attachments/${attIdx}?token=${encodeURIComponent(token)}`
}

export function TicketDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [ticket, setTicket] = useState<any>(null)
  const [signature, setSignature] = useState<string>('')

  useEffect(() => {
    if (id) api.tickets.get(id).then(setTicket).catch(console.error)
    api.settings.get().then((s: any) => setSignature(s?.signature || '')).catch(() => {})
  }, [id])

  const handleSend = async (html: string, text: string) => {
    if (!id) return
    const result = await api.tickets.reply(id, { from: 'agent', body: text, html })
    if (result.send_error) {
      notifications.show({ title: 'Send failed', message: result.send_error, color: 'red' })
    } else {
      notifications.show({ title: 'Reply sent', message: 'Email delivered successfully', color: 'green' })
    }
    api.tickets.get(id).then(setTicket)
  }

  const handleSendAndClose = async (html: string, text: string) => {
    if (!id) return
    const result = await api.tickets.reply(id, { from: 'agent', body: text, html })
    await api.tickets.setStatus(id, 'closed')
    if (result.send_error) {
      notifications.show({ title: 'Send failed', message: result.send_error, color: 'red' })
    } else {
      notifications.show({ title: 'Reply sent & ticket closed', message: 'Email delivered successfully', color: 'green' })
    }
    api.tickets.get(id).then(setTicket)
  }

  const handleClose = async () => {
    if (!id) return
    await api.tickets.setStatus(id, 'closed')
    api.tickets.get(id).then(setTicket)
  }

  const handleReopen = async () => {
    if (!id) return
    await api.tickets.setStatus(id, 'open')
    api.tickets.get(id).then(setTicket)
  }

  if (!ticket) return <Text>Loading...</Text>

  return (
    <>
      <Group justify="space-between" mb="md">
        <Title order={2}>#{ticket.number} {ticket.subject}</Title>
        <Group gap="sm">
          <Badge color={statusColors[ticket.status] || 'gray'} size="lg">{ticket.status}</Badge>
          {ticket.status === 'closed' ? (
            <Tooltip label="Re-open ticket">
              <ActionIcon variant="light" color="green" onClick={handleReopen}>
                <IconLockOpen size={18} />
              </ActionIcon>
            </Tooltip>
          ) : (
            <Tooltip label="Close ticket">
              <ActionIcon variant="light" color="gray" onClick={handleClose}>
                <IconLock size={18} />
              </ActionIcon>
            </Tooltip>
          )}
        </Group>
      </Group>
      <Text c="dimmed" mb="lg">
        From: {ticket.requester?.name} ({ticket.requester?.email}) · Priority: {ticket.priority}
      </Text>

      <Stack gap="md">
        {ticket.messages?.map((msg: any, i: number) => (
          <Paper key={i} withBorder p="md" radius="md">
            <Box mb="sm" p="xs" style={{ background: 'var(--mantine-color-gray-0)', borderRadius: 4 }}>
              <Group justify="space-between">
                <Group gap="xs">
                  <Text size="sm"><Text span fw={600}>From:</Text> {msg.from}</Text>
                  {msg.send_error && <Badge color="red" size="sm" variant="light">Unsent</Badge>}
                </Group>
                <Group gap="xs">
                  {msg.from === 'agent' && !msg.send_error && (
                    <Tooltip label="Re-send">
                      <ActionIcon
                        variant="subtle"
                        color="gray"
                        size="sm"
                        onClick={async () => {
                          try {
                            await api.tickets.retrySend(id!, i)
                            notifications.show({ title: 'Message sent', message: 'Email delivered successfully', color: 'green' })
                          } catch { /* refresh will show error */ }
                          api.tickets.get(id!).then(setTicket)
                        }}
                      >
                        <IconSend size={14} />
                      </ActionIcon>
                    </Tooltip>
                  )}
                  <Text size="xs" c="dimmed">{formatDate(msg.created_at)}</Text>
                </Group>
              </Group>
              {msg.cc?.length > 0 && (
                <Text size="sm" mt={4}><Text span fw={600}>Cc:</Text> {msg.cc.join(', ')}</Text>
              )}
            </Box>
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
            <MessageBody msg={msg} />
            {msg.attachments?.some((att: any) => att.content_type?.startsWith('image/')) && (
              <Stack gap="xs" mt="sm">
                {msg.attachments.map((att: any, j: number) =>
                  att.content_type?.startsWith('image/') ? (
                    <Box key={j}>
                      <img
                        src={attachmentUrl(ticket.id, i, j)}
                        alt={att.filename}
                        style={{ maxWidth: '100%', borderRadius: 4 }}
                      />
                      <Text size="xs" c="dimmed">{att.filename}</Text>
                    </Box>
                  ) : null
                )}
              </Stack>
            )}
          </Paper>
        ))}
      </Stack>

      <Divider my="lg" />
      <ReplyEditor onSend={handleSend} onSendAndClose={ticket.status !== 'closed' ? handleSendAndClose : undefined} signature={signature} />
    </>
  )
}
