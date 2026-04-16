import { useEffect, useState } from 'react'
import { Title, Tabs, TextInput, NumberInput, Switch, Button, Stack, Group, PasswordInput, Modal, NavLink, Text, Loader, Fieldset, Code } from '@mantine/core'
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
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [toolResponse, setToolResponse] = useState<string | null>(null)
  const [mailboxes, setMailboxes] = useState<any[]>([])
  const [browseOpen, setBrowseOpen] = useState(false)
  const [browseLoading, setBrowseLoading] = useState(false)
  const [browseTarget, setBrowseTarget] = useState<'imap_mailbox' | 'sent_mailbox' | 'deleted_mailbox'>('imap_mailbox')
  const [oidcCallbackEndpoint, setOIDCCallbackEndpoint] = useState('')

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
    setLoading(true)
    setLoadError(null)

    api.settings.get().then((s: any) => {
      if (s?.email && !s.email.poll_interval_seconds) {
        s.email.poll_interval_seconds = 60
      }
      setSettings(s)
      if (signatureEditor && s?.signature) {
        signatureEditor.commands.setContent(s.signature)
      }
    }).catch((err: any) => {
      setLoadError(err?.message || 'Failed to load settings')
    }).finally(() => {
      setLoading(false)
    })

    api.settings.getOIDCCallbackInfo()
      .then((callbackInfo: any) => setOIDCCallbackEndpoint(callbackInfo?.callback_endpoint || ''))
      .catch(() => setOIDCCallbackEndpoint(''))
  }, [signatureEditor])

  const saveEmail = async () => {
    try {
      await api.settings.updateEmail(settings.email)
      notifications.show({ title: 'Saved', message: 'Email settings updated', color: 'green' })
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

  const saveLLM = async () => {
    try {
      await api.settings.updateLLM(settings.llm)
      notifications.show({ title: 'Saved', message: 'LLM settings updated', color: 'green' })
    } catch (e: any) {
      notifications.show({ title: 'Error', message: e.message, color: 'red' })
    }
  }

  const saveAuth = async () => {
    try {
      await api.settings.updateAuth(settings.auth || {})
      notifications.show({ title: 'Saved', message: 'Authentication settings updated', color: 'green' })
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

  if (loading) return <Text c="dimmed">Loading settings...</Text>
  if (loadError) return <Text c="red">{loadError}</Text>
  if (!settings) return <Text c="red">Settings unavailable</Text>

  const updateEmail = (field: string, value: any) =>
    setSettings({ ...settings, email: { ...settings.email, [field]: value } })

  const updateLLM = (field: string, value: any) =>
    setSettings({ ...settings, llm: { ...settings.llm, [field]: value } })

  const updateAuth = (field: string, value: any) =>
    setSettings({ ...settings, auth: { ...settings.auth, [field]: value } })

  const callbackURL = oidcCallbackEndpoint ? new URL(oidcCallbackEndpoint, window.location.origin).toString() : ''

  return (
    <>
      <Title order={2} mb="lg">Settings</Title>
      <Tabs defaultValue="email">
        <Tabs.List>
          <Tabs.Tab value="email">Email (IMAP/SMTP)</Tabs.Tab>
          <Tabs.Tab value="auth">Authentication</Tabs.Tab>
          <Tabs.Tab value="signature">Signature</Tabs.Tab>
          <Tabs.Tab value="llm">LLM</Tabs.Tab>
          {settings?.debug && <Tabs.Tab value="tools">Tools</Tabs.Tab>}
        </Tabs.List>

        <Tabs.Panel value="email" pt="md">
          <Stack maw={500}>
            <Title order={4}>IMAP</Title>
            <Group align="end">
              <TextInput label="Host" value={settings.email?.imap_host || ''} onChange={(e) => updateEmail('imap_host', e.currentTarget.value)} style={{ flex: 1 }} />
              <NumberInput label="Port" value={settings.email?.imap_port || 993} onChange={(v) => updateEmail('imap_port', v)} w={100} />
            </Group>
            <Switch label="TLS" checked={settings.email?.imap_tls ?? true} onChange={(e) => updateEmail('imap_tls', e.currentTarget.checked)} />
            <Group grow>
              <TextInput label="User" value={settings.email?.imap_user || ''} onChange={(e) => updateEmail('imap_user', e.currentTarget.value)} />
              <PasswordInput label="Password" value={settings.email?.imap_password || ''} onChange={(e) => updateEmail('imap_password', e.currentTarget.value)} />
            </Group>
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
            <Group align="end">
              <TextInput label="Host" value={settings.email?.smtp_host || ''} onChange={(e) => updateEmail('smtp_host', e.currentTarget.value)} style={{ flex: 1 }} />
              <NumberInput label="Port" value={settings.email?.smtp_port || 587} onChange={(v) => updateEmail('smtp_port', v)} w={100} />
            </Group>
            <Switch label="TLS" checked={settings.email?.smtp_tls ?? true} onChange={(e) => updateEmail('smtp_tls', e.currentTarget.checked)} />
            <Group grow>
              <TextInput label="User" value={settings.email?.smtp_user || ''} onChange={(e) => updateEmail('smtp_user', e.currentTarget.value)} />
              <PasswordInput label="Password" value={settings.email?.smtp_password || ''} onChange={(e) => updateEmail('smtp_password', e.currentTarget.value)} />
            </Group>
            <TextInput label="From" description="Email address used in the From header" placeholder="support@example.com" value={settings.email?.smtp_from || ''} onChange={(e) => updateEmail('smtp_from', e.currentTarget.value)} />

            <Fieldset legend="Folders">
              <Stack>
                <Group align="end">
                  <TextInput label="Sent Folder" description="IMAP folder to store sent emails" placeholder="Sent" value={settings.email?.sent_mailbox || ''} onChange={(e) => updateEmail('sent_mailbox', e.currentTarget.value)} style={{ flex: 1 }} />
                  <Button variant="light" onClick={() => browseMailboxes('sent_mailbox')} leftSection={<IconFolder size={16} />}>Browse</Button>
                </Group>
                <Group align="end">
                  <TextInput label="Deleted Folder" description="IMAP folder to move deleted emails to" placeholder="Trash" value={settings.email?.deleted_mailbox || ''} onChange={(e) => updateEmail('deleted_mailbox', e.currentTarget.value)} style={{ flex: 1 }} />
                  <Button variant="light" onClick={() => browseMailboxes('deleted_mailbox')} leftSection={<IconFolder size={16} />}>Browse</Button>
                </Group>
              </Stack>
            </Fieldset>

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

        <Tabs.Panel value="auth" pt="md">
          <Stack maw={600}>
            <Title order={4}>OIDC</Title>
            <Switch
              label="Enable OIDC login"
              checked={settings.auth?.oidc_enabled ?? false}
              onChange={(e) => {
                const enabled = e.currentTarget.checked
                setSettings({
                  ...settings,
                  auth: {
                    ...settings.auth,
                    oidc_enabled: enabled,
                    disable_local_login: enabled ? (settings.auth?.disable_local_login ?? false) : false,
                  },
                })
              }}
            />
            <Switch
              label="Disable Local Login"
              description="When enabled, users are redirected directly to OIDC and local email/password login is disabled."
              checked={settings.auth?.disable_local_login ?? false}
              disabled={!(settings.auth?.oidc_enabled ?? false)}
              onChange={(e) => updateAuth('disable_local_login', e.currentTarget.checked)}
            />
            <TextInput label="OIDC Endpoint" placeholder="https://idp.example.com/.well-known/openid-configuration" value={settings.auth?.oidc_issuer || ''} onChange={(e) => updateAuth('oidc_issuer', e.currentTarget.value)} />
            <TextInput label="Client ID" value={settings.auth?.oidc_client_id || ''} onChange={(e) => updateAuth('oidc_client_id', e.currentTarget.value)} />
            <PasswordInput label="Client Secret" value={settings.auth?.oidc_client_secret || ''} onChange={(e) => updateAuth('oidc_client_secret', e.currentTarget.value)} />
            <TextInput label="Admin Group Name" description="Users in this OIDC group are assigned the admin role. Others default to agent." placeholder="helpdesk-admins" value={settings.auth?.oidc_admin_group || ''} onChange={(e) => updateAuth('oidc_admin_group', e.currentTarget.value)} />
            <Stack gap={4}>
              <Text size="sm" fw={500}>Callback URL</Text>
              <Code block>{callbackURL || 'Unavailable'}</Code>
              <Text size="xs" c="dimmed">Computed from browser URL + backend callback endpoint.</Text>
            </Stack>
            <Group>
              <Button onClick={saveAuth}>Save Authentication Settings</Button>
            </Group>
          </Stack>
        </Tabs.Panel>

        <Tabs.Panel value="signature" pt="md">
          <Stack maw={600}>
            <Text size="sm" c="dimmed">This signature will be automatically appended to all replies.</Text>
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

        {settings?.debug && (
          <Tabs.Panel value="tools" pt="md">
            <Stack maw={500}>
              <Text size="sm" c="dimmed">Debug tools (visible because DEBUG environment variable is set).</Text>
              <Button
                variant="light"
                onClick={async () => {
                  setToolResponse(null)
                  try {
                    const result = await api.email.reparse()
                    setToolResponse(JSON.stringify(result, null, 2))
                    notifications.show({ title: 'Re-parse complete', message: 'All emails have been re-parsed', color: 'green' })
                  } catch (e: any) {
                    setToolResponse(e.message)
                    notifications.show({ title: 'Re-parse failed', message: e.message, color: 'red' })
                  }
                }}
              >
                Re-parse all emails
              </Button>
              {toolResponse !== null && (
                <Code block style={{ maxHeight: 300, overflow: 'auto' }}>{toolResponse}</Code>
              )}
            </Stack>
          </Tabs.Panel>
        )}
      </Tabs>
    </>
  )
}
