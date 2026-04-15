import { useEffect, useState } from 'react'
import { Title, Tabs, TextInput, NumberInput, Switch, Button, Stack, Group, PasswordInput, Modal, NavLink, Text, Loader } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconFolder } from '@tabler/icons-react'
import { useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import Link from '@tiptap/extension-link'
import Image from '@tiptap/extension-image'
import Placeholder from '@tiptap/extension-placeholder'
import { RichTextEditor } from '@mantine/tiptap'
import { api } from '../api/client'

export function SettingsPage() {
  const [settings, setSettings] = useState<any>(null)
  const [mailboxes, setMailboxes] = useState<any[]>([])
  const [browseOpen, setBrowseOpen] = useState(false)
  const [browseLoading, setBrowseLoading] = useState(false)
  const [browseTarget, setBrowseTarget] = useState<'imap_mailbox' | 'sent_mailbox' | 'deleted_mailbox'>('imap_mailbox')

  const signatureEditor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      Link.configure({ openOnClick: false }),
      Image.configure({ inline: true, allowBase64: true }),
      Placeholder.configure({ placeholder: 'Write your email signature...' }),
    ],
    content: '',
  })

  useEffect(() => {
    api.settings.get().then((s: any) => {
      if (s?.email && !s.email.poll_interval_seconds) {
        s.email.poll_interval_seconds = 60
      }
      setSettings(s)
      if (signatureEditor && s?.signature) {
        signatureEditor.commands.setContent(s.signature)
      }
    }).catch(console.error)
  }, [signatureEditor])

  const saveEmail = async () => {
    try {
      await api.settings.updateEmail(settings.email)
      notifications.show({ title: 'Saved', message: 'Email settings updated', color: 'green' })
    } catch (e: any) {
      notifications.show({ title: 'Error', message: e.message, color: 'red' })
    }
  }

  const saveLLM = async () => {
    try {
      await api.settings.updateLLM(settings.llm)
      notifications.show({ title: 'Saved', message: 'LLM settings updated', color: 'green' })
    } catch (e: any) {
      notifications.show({ title: 'Error', message: e.message, color: 'red' })
    }
  }

  const saveSignature = async () => {
    try {
      const html = signatureEditor?.getHTML() || ''
      await api.settings.updateSignature(html === '<p></p>' ? '' : html)
      notifications.show({ title: 'Saved', message: 'Signature updated', color: 'green' })
    } catch (e: any) {
      notifications.show({ title: 'Error', message: e.message, color: 'red' })
    }
  }

  const browseMailboxes = async (target: 'imap_mailbox' | 'sent_mailbox' | 'deleted_mailbox' = 'imap_mailbox') => {
    setBrowseTarget(target)
    setBrowseLoading(true)
    setBrowseOpen(true)
    try {
      const list = await api.email.mailboxes(settings.email || {})
      setMailboxes(list)
    } catch (e: any) {
      notifications.show({ title: 'IMAP Error', message: e.message, color: 'red' })
      setBrowseOpen(false)
    } finally {
      setBrowseLoading(false)
    }
  }

  const selectMailbox = (name: string) => {
    updateEmail(browseTarget, name)
    setBrowseOpen(false)
  }

  if (!settings) return null

  const updateEmail = (field: string, value: any) =>
    setSettings({ ...settings, email: { ...settings.email, [field]: value } })

  const updateLLM = (field: string, value: any) =>
    setSettings({ ...settings, llm: { ...settings.llm, [field]: value } })

  return (
    <>
      <Title order={2} mb="lg">Settings</Title>
      <Tabs defaultValue="email">
        <Tabs.List>
          <Tabs.Tab value="email">Email (IMAP/SMTP)</Tabs.Tab>
          <Tabs.Tab value="signature">Signature</Tabs.Tab>
          <Tabs.Tab value="llm">LLM</Tabs.Tab>
          <Tabs.Tab value="notifications">Notifications</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="email" pt="md">
          <Stack maw={500}>
            <Title order={4}>IMAP</Title>
            <TextInput label="Host" value={settings.email?.imap_host || ''} onChange={(e) => updateEmail('imap_host', e.currentTarget.value)} />
            <NumberInput label="Port" value={settings.email?.imap_port || 993} onChange={(v) => updateEmail('imap_port', v)} />
            <Switch label="TLS" checked={settings.email?.imap_tls ?? true} onChange={(e) => updateEmail('imap_tls', e.currentTarget.checked)} />
            <TextInput label="User" value={settings.email?.imap_user || ''} onChange={(e) => updateEmail('imap_user', e.currentTarget.value)} />
            <PasswordInput label="Password" value={settings.email?.imap_password || ''} onChange={(e) => updateEmail('imap_password', e.currentTarget.value)} />
            <Group align="end">
              <TextInput label="Mailbox path" placeholder="INBOX" value={settings.email?.imap_mailbox || ''} onChange={(e) => updateEmail('imap_mailbox', e.currentTarget.value)} style={{ flex: 1 }} />
              <Button variant="light" onClick={() => browseMailboxes('imap_mailbox')} leftSection={<IconFolder size={16} />}>Browse</Button>
            </Group>

            <Modal opened={browseOpen} onClose={() => setBrowseOpen(false)} title="Select IMAP Mailbox" size="sm">
              {browseLoading ? (
                <Group justify="center" p="xl"><Loader /></Group>
              ) : mailboxes.length === 0 ? (
                <Text c="dimmed" ta="center" p="md">No mailboxes found</Text>
              ) : (
                <Stack gap={0}>
                  {mailboxes.map((m) => (
                    <NavLink
                      key={m.name}
                      label={m.name}
                      leftSection={<IconFolder size={16} />}
                      active={settings.email?.[browseTarget] === m.name}
                      onClick={() => selectMailbox(m.name)}
                    />
                  ))}
                </Stack>
              )}
            </Modal>

            <Title order={4} mt="md">SMTP</Title>
            <TextInput label="Host" value={settings.email?.smtp_host || ''} onChange={(e) => updateEmail('smtp_host', e.currentTarget.value)} />
            <NumberInput label="Port" value={settings.email?.smtp_port || 587} onChange={(v) => updateEmail('smtp_port', v)} />
            <Switch label="TLS" checked={settings.email?.smtp_tls ?? true} onChange={(e) => updateEmail('smtp_tls', e.currentTarget.checked)} />
            <TextInput label="User" value={settings.email?.smtp_user || ''} onChange={(e) => updateEmail('smtp_user', e.currentTarget.value)} />
            <PasswordInput label="Password" value={settings.email?.smtp_password || ''} onChange={(e) => updateEmail('smtp_password', e.currentTarget.value)} />
            <TextInput label="From" description="Email address used in the From header" placeholder="support@example.com" value={settings.email?.smtp_from || ''} onChange={(e) => updateEmail('smtp_from', e.currentTarget.value)} />

            <Group align="end">
              <TextInput label="Sent email path" description="IMAP folder to store sent emails" placeholder="Sent" value={settings.email?.sent_mailbox || ''} onChange={(e) => updateEmail('sent_mailbox', e.currentTarget.value)} style={{ flex: 1 }} />
              <Button variant="light" onClick={() => browseMailboxes('sent_mailbox')} leftSection={<IconFolder size={16} />}>Browse</Button>
            </Group>

            <Group align="end">
              <TextInput label="Deleted email path" description="IMAP folder to move deleted emails to" placeholder="Trash" value={settings.email?.deleted_mailbox || ''} onChange={(e) => updateEmail('deleted_mailbox', e.currentTarget.value)} style={{ flex: 1 }} />
              <Button variant="light" onClick={() => browseMailboxes('deleted_mailbox')} leftSection={<IconFolder size={16} />}>Browse</Button>
            </Group>

            <NumberInput label="Poll interval (seconds)" value={settings.email?.poll_interval_seconds || 60} onChange={(v) => updateEmail('poll_interval_seconds', v)} />

            {settings.last_fetched_at && (
              <Text size="sm" c="dimmed">Last successful fetch: {new Date(settings.last_fetched_at).toLocaleString()}</Text>
            )}

            <Group>
              <Button onClick={saveEmail}>Save Email Settings</Button>
              <Button variant="light" onClick={async () => {
                try {
                  const result = await api.email.fetch()
                  notifications.show({ title: 'Fetch complete', message: `Fetched ${result?.count ?? 0} new email(s)`, color: 'green' })
                  api.settings.get().then(setSettings)
                } catch (e: any) {
                  notifications.show({ title: 'Fetch failed', message: e.message, color: 'red' })
                }
              }}>Fetch Now</Button>
            </Group>
          </Stack>
        </Tabs.Panel>

        <Tabs.Panel value="signature" pt="md">
          <Stack maw={600}>
            <Text size="sm" c="dimmed">This signature will be automatically appended to your replies.</Text>
            <RichTextEditor editor={signatureEditor}>
              <RichTextEditor.Toolbar sticky stickyOffset={0}>
                <RichTextEditor.ControlsGroup>
                  <RichTextEditor.Bold />
                  <RichTextEditor.Italic />
                  <RichTextEditor.Underline />
                </RichTextEditor.ControlsGroup>
                <RichTextEditor.ControlsGroup>
                  <RichTextEditor.BulletList />
                  <RichTextEditor.OrderedList />
                </RichTextEditor.ControlsGroup>
                <RichTextEditor.ControlsGroup>
                  <RichTextEditor.Link />
                  <RichTextEditor.Unlink />
                </RichTextEditor.ControlsGroup>
              </RichTextEditor.Toolbar>
              <RichTextEditor.Content />
            </RichTextEditor>
            <Group>
              <Button onClick={saveSignature}>Save Signature</Button>
            </Group>
          </Stack>
        </Tabs.Panel>

        <Tabs.Panel value="llm" pt="md">
          <Stack maw={500}>
            <Switch label="Enable LLM suggestions" checked={settings.llm?.enabled ?? false} onChange={(e) => updateLLM('enabled', e.currentTarget.checked)} />
            <TextInput label="Endpoint" value={settings.llm?.endpoint || ''} onChange={(e) => updateLLM('endpoint', e.currentTarget.value)} />
            <PasswordInput label="API Key" value={settings.llm?.api_key || ''} onChange={(e) => updateLLM('api_key', e.currentTarget.value)} />
            <TextInput label="Model" value={settings.llm?.model || ''} onChange={(e) => updateLLM('model', e.currentTarget.value)} />
            <Group>
              <Button onClick={saveLLM}>Save LLM Settings</Button>
            </Group>
          </Stack>
        </Tabs.Panel>

        <Tabs.Panel value="notifications" pt="md">
          <Stack maw={500}>
            <Text size="sm" c="dimmed">Receive browser notifications when new tickets arrive.</Text>
            <Switch
              label="Enable desktop notifications"
              checked={localStorage.getItem('notifications_enabled') === 'true'}
              onChange={async (e) => {
                if (e.currentTarget.checked) {
                  if (!('Notification' in window)) {
                    notifications.show({ title: 'Not supported', message: 'Your browser does not support notifications', color: 'red' })
                    return
                  }
                  const permission = await Notification.requestPermission()
                  if (permission === 'granted') {
                    localStorage.setItem('notifications_enabled', 'true')
                    notifications.show({ title: 'Enabled', message: 'Desktop notifications enabled', color: 'green' })
                  } else {
                    notifications.show({ title: 'Denied', message: 'Notification permission was denied by the browser', color: 'red' })
                  }
                } else {
                  localStorage.setItem('notifications_enabled', 'false')
                  notifications.show({ title: 'Disabled', message: 'Desktop notifications disabled', color: 'gray' })
                }
                // Force re-render
                setSettings({ ...settings })
              }}
            />
            {typeof Notification !== 'undefined' && Notification.permission === 'denied' && (
              <Text size="sm" c="red">Notifications are blocked by your browser. Please allow them in your browser settings.</Text>
            )}
          </Stack>
        </Tabs.Panel>
      </Tabs>
    </>
  )
}
