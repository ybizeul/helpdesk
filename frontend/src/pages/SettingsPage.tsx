import { useEffect, useState, useCallback } from 'react'
import { Title, Tabs, TextInput, NumberInput, Switch, Button, Stack, Group, PasswordInput, Modal, NavLink, Text, Loader, Fieldset, Code, ActionIcon } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconFolder, IconPlus, IconTrash } from '@tabler/icons-react'
import { useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import Link from '@tiptap/extension-link'
import Image from '@tiptap/extension-image'
import Placeholder from '@tiptap/extension-placeholder'
import { RichTextEditor } from '@mantine/tiptap'
import { api } from '../api/client'

interface SettingsPageProps {
  onSiteNameChange?: (name: string) => void
  mailboxes?: any[]
  onMailboxesChange?: (mailboxes: any[]) => void
}

export function SettingsPage({ onSiteNameChange, mailboxes: propMailboxes = [], onMailboxesChange }: SettingsPageProps) {
  const [settings, setSettings] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [toolResponse, setToolResponse] = useState<string | null>(null)
  const [oidcCallbackEndpoint, setOIDCCallbackEndpoint] = useState('')
  const [activeTab, setActiveTab] = useState<string>('global')
  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [newMailboxName, setNewMailboxName] = useState('')

  // Local mailbox state for editing
  const [mailboxStates, setMailboxStates] = useState<Record<string, any>>({})

  // Init mailbox states from prop
  useEffect(() => {
    const states: Record<string, any> = {}
    for (const mb of propMailboxes) {
      if (!mailboxStates[mb.id]) {
        states[mb.id] = { ...mb }
      }
    }
    if (Object.keys(states).length > 0) {
      setMailboxStates(prev => ({ ...prev, ...states }))
    }
  }, [propMailboxes])

  useEffect(() => {
    setLoading(true)
    setLoadError(null)

    api.settings.get().then((s: any) => {
      setSettings(s)
    }).catch((err: any) => {
      setLoadError(err?.message || 'Failed to load settings')
    }).finally(() => {
      setLoading(false)
    })

    api.settings.getOIDCCallbackInfo()
      .then((callbackInfo: any) => setOIDCCallbackEndpoint(callbackInfo?.callback_endpoint || ''))
      .catch(() => setOIDCCallbackEndpoint(''))
  }, [])

  const saveGeneral = async () => {
    try {
      await api.settings.updateGeneral({ site_name: settings.site_name || '' })
      onSiteNameChange?.(settings.site_name || '')
      notifications.show({ title: 'Saved', message: 'General settings updated', color: 'green' })
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

  const createMailbox = async () => {
    if (!newMailboxName.trim()) return
    try {
      const mb = await api.mailboxes.create({ name: newMailboxName.trim() })
      const updated = [...propMailboxes, mb]
      onMailboxesChange?.(updated)
      setMailboxStates(prev => ({ ...prev, [mb.id]: { ...mb } }))
      setCreateModalOpen(false)
      setNewMailboxName('')
      setActiveTab(`mb-${mb.id}`)
      notifications.show({ title: 'Created', message: `Mailbox "${mb.name}" created`, color: 'green' })
    } catch (e: any) {
      notifications.show({ title: 'Error', message: e.message, color: 'red' })
    }
  }

  const deleteMailbox = async (id: string) => {
    try {
      await api.mailboxes.delete(id)
      const updated = propMailboxes.filter((m: any) => m.id !== id)
      onMailboxesChange?.(updated)
      setActiveTab('global')
      notifications.show({ title: 'Deleted', message: 'Mailbox deleted', color: 'green' })
    } catch (e: any) {
      notifications.show({ title: 'Error', message: e.message, color: 'red' })
    }
  }

  if (loading) return <Text c="dimmed">Loading settings...</Text>
  if (loadError) return <Text c="red">{loadError}</Text>
  if (!settings) return <Text c="red">Settings unavailable</Text>

  const updateLLM = (field: string, value: any) =>
    setSettings({ ...settings, llm: { ...settings.llm, [field]: value } })

  const updateAuth = (field: string, value: any) =>
    setSettings({ ...settings, auth: { ...settings.auth, [field]: value } })

  const callbackURL = oidcCallbackEndpoint ? new URL(oidcCallbackEndpoint, window.location.origin).toString() : ''

  return (
    <>
      <Title order={2} mb="lg">Settings</Title>
      <Tabs value={activeTab} onChange={(v) => setActiveTab(v || 'global')}>
        <Tabs.List>
          <Tabs.Tab value="global">Global</Tabs.Tab>
          {propMailboxes.map((mb: any) => (
            <Tabs.Tab key={mb.id} value={`mb-${mb.id}`}>{mb.name}</Tabs.Tab>
          ))}
          <ActionIcon variant="subtle" size="sm" mt={8} ml={4} onClick={() => { setNewMailboxName(''); setCreateModalOpen(true) }}>
            <IconPlus size={16} />
          </ActionIcon>
        </Tabs.List>

        {/* ── Global Tab ── */}
        <Tabs.Panel value="global" pt="md">
          <Tabs defaultValue="general">
            <Tabs.List>
              <Tabs.Tab value="general">General</Tabs.Tab>
              <Tabs.Tab value="auth">Authentication</Tabs.Tab>
              <Tabs.Tab value="llm">LLM</Tabs.Tab>
              {settings?.debug && <Tabs.Tab value="tools">Tools</Tabs.Tab>}
            </Tabs.List>

            <Tabs.Panel value="general" pt="md">
              <Stack maw={500}>
                <TextInput
                  label="Site name"
                  description="Displayed in the top bar and navbar"
                  placeholder="Helpdesk"
                  value={settings.site_name || ''}
                  onChange={(e) => setSettings({ ...settings, site_name: e.currentTarget.value })}
                />
                <Group><Button onClick={saveGeneral}>Save General Settings</Button></Group>
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
                <Group><Button onClick={saveAuth}>Save Authentication Settings</Button></Group>
              </Stack>
            </Tabs.Panel>

            <Tabs.Panel value="llm" pt="md">
              <Stack maw={500}>
                <Switch label="Enable LLM suggestions" checked={settings.llm?.enabled ?? false} onChange={(e) => updateLLM('enabled', e.currentTarget.checked)} />
                <TextInput label="Endpoint" value={settings.llm?.endpoint || ''} onChange={(e) => updateLLM('endpoint', e.currentTarget.value)} />
                <PasswordInput label="API Key" value={settings.llm?.api_key || ''} onChange={(e) => updateLLM('api_key', e.currentTarget.value)} />
                <TextInput label="Model" value={settings.llm?.model || ''} onChange={(e) => updateLLM('model', e.currentTarget.value)} />
                <Group><Button onClick={saveLLM}>Save LLM Settings</Button></Group>
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
        </Tabs.Panel>

        {/* ── Per-Mailbox Tabs ── */}
        {propMailboxes.map((mb: any) => (
          <Tabs.Panel key={mb.id} value={`mb-${mb.id}`} pt="md">
            <MailboxSettingsPanel
              mailbox={mailboxStates[mb.id] || mb}
              onChange={(updated) => setMailboxStates(prev => ({ ...prev, [mb.id]: updated }))}
              onDelete={() => deleteMailbox(mb.id)}
              onSaved={(updated) => {
                const newList = propMailboxes.map((m: any) => m.id === mb.id ? updated : m)
                onMailboxesChange?.(newList)
              }}
            />
          </Tabs.Panel>
        ))}
      </Tabs>

      {/* Create Mailbox Modal */}
      <Modal opened={createModalOpen} onClose={() => setCreateModalOpen(false)} title="Create Mailbox" size="sm">
        <Stack>
          <TextInput label="Name" placeholder="Support" value={newMailboxName} onChange={(e) => setNewMailboxName(e.currentTarget.value)} data-autofocus />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setCreateModalOpen(false)}>Cancel</Button>
            <Button onClick={createMailbox}>Create</Button>
          </Group>
        </Stack>
      </Modal>
    </>
  )
}

// ── MailboxSettingsPanel ──

function MailboxSettingsPanel({ mailbox, onChange, onDelete, onSaved }: {
  mailbox: any
  onChange: (mb: any) => void
  onDelete: () => void
  onSaved: (mb: any) => void
}) {
  const [browseOpen, setBrowseOpen] = useState(false)
  const [browseLoading, setBrowseLoading] = useState(false)
  const [browseTarget, setBrowseTarget] = useState<string>('imap_mailbox')
  const [imapFolders, setImapFolders] = useState<any[]>([])
  const [deleteConfirm, setDeleteConfirm] = useState(false)

  const signatureEditor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      Link.configure({ openOnClick: false }),
      Image.configure({ inline: true, allowBase64: true }),
      Placeholder.configure({ placeholder: 'Write your email signature...' }),
    ],
    content: mailbox?.signature || '',
  })

  // Sync editor content when mailbox changes
  useEffect(() => {
    if (signatureEditor && mailbox?.signature !== undefined) {
      const current = signatureEditor.getHTML()
      if (current !== mailbox.signature && !(current === '<p></p>' && !mailbox.signature)) {
        signatureEditor.commands.setContent(mailbox.signature || '')
      }
    }
  }, [mailbox?.id])

  const updateEmail = (field: string, value: any) =>
    onChange({ ...mailbox, email: { ...mailbox.email, [field]: value } })

  const saveMailbox = async () => {
    try {
      const sigHtml = signatureEditor?.getHTML() || ''
      const data = {
        name: mailbox.name,
        slug: mailbox.slug,
        enabled: mailbox.enabled ?? true,
        email: mailbox.email || {},
        signature: sigHtml === '<p></p>' ? '' : sigHtml,
        oidc_group: mailbox.oidc_group || '',
      }
      await api.mailboxes.update(mailbox.id, data)
      const updated = { ...mailbox, ...data }
      onSaved(updated)
      notifications.show({ title: 'Saved', message: `Mailbox "${mailbox.name}" updated`, color: 'green' })
    } catch (e: any) {
      notifications.show({ title: 'Error', message: e.message, color: 'red' })
    }
  }

  const browseMailboxes = async (target: string) => {
    setBrowseTarget(target)
    setBrowseLoading(true)
    setBrowseOpen(true)
    try {
      const list = await api.mailboxes.listIMAPFolders(mailbox.email || {})
      setImapFolders(list)
    } catch (e: any) {
      notifications.show({ title: 'IMAP Error', message: e.message, color: 'red' })
      setBrowseOpen(false)
    } finally {
      setBrowseLoading(false)
    }
  }

  const selectFolder = (name: string) => {
    updateEmail(browseTarget, name)
    setBrowseOpen(false)
  }

  const fetchNow = async () => {
    try {
      const result = await api.mailboxes.fetch(mailbox.id)
      notifications.show({ title: 'Fetch complete', message: `Fetched ${result?.count ?? 0} new email(s)`, color: 'green' })
    } catch (e: any) {
      notifications.show({ title: 'Fetch failed', message: e.message, color: 'red' })
    }
  }

  return (
    <Tabs defaultValue="email">
      <Tabs.List>
        <Tabs.Tab value="email">Email</Tabs.Tab>
        <Tabs.Tab value="signature">Signature</Tabs.Tab>
        <Tabs.Tab value="access">Access</Tabs.Tab>
      </Tabs.List>

      <Tabs.Panel value="email" pt="md">
        <Stack maw={500}>
          <TextInput label="Mailbox Name" value={mailbox.name || ''} onChange={(e) => onChange({ ...mailbox, name: e.currentTarget.value })} />
          <TextInput label="Slug" description="URL-friendly identifier" value={mailbox.slug || ''} onChange={(e) => onChange({ ...mailbox, slug: e.currentTarget.value })} />
          <Switch label="Enabled" description="When disabled, emails will not be fetched for this mailbox" checked={mailbox.enabled ?? true} onChange={(e) => onChange({ ...mailbox, enabled: e.currentTarget.checked })} />

          <Title order={4} mt="md">IMAP</Title>
          <Group align="end">
            <TextInput label="Host" value={mailbox.email?.imap_host || ''} onChange={(e) => updateEmail('imap_host', e.currentTarget.value)} style={{ flex: 1 }} />
            <NumberInput label="Port" value={mailbox.email?.imap_port || 993} onChange={(v) => updateEmail('imap_port', v)} w={100} />
          </Group>
          <Switch label="TLS" checked={mailbox.email?.imap_tls ?? true} onChange={(e) => updateEmail('imap_tls', e.currentTarget.checked)} />
          <Group grow>
            <TextInput label="User" value={mailbox.email?.imap_user || ''} onChange={(e) => updateEmail('imap_user', e.currentTarget.value)} />
            <PasswordInput label="Password" value={mailbox.email?.imap_password || ''} onChange={(e) => updateEmail('imap_password', e.currentTarget.value)} />
          </Group>
          <Group align="end">
            <TextInput label="Mailbox path" placeholder="INBOX" value={mailbox.email?.imap_mailbox || ''} onChange={(e) => updateEmail('imap_mailbox', e.currentTarget.value)} style={{ flex: 1 }} />
            <Button variant="light" onClick={() => browseMailboxes('imap_mailbox')} leftSection={<IconFolder size={16} />}>Browse</Button>
          </Group>

          <Title order={4} mt="md">SMTP</Title>
          <Group align="end">
            <TextInput label="Host" value={mailbox.email?.smtp_host || ''} onChange={(e) => updateEmail('smtp_host', e.currentTarget.value)} style={{ flex: 1 }} />
            <NumberInput label="Port" value={mailbox.email?.smtp_port || 587} onChange={(v) => updateEmail('smtp_port', v)} w={100} />
          </Group>
          <Switch label="TLS" checked={mailbox.email?.smtp_tls ?? true} onChange={(e) => updateEmail('smtp_tls', e.currentTarget.checked)} />
          <Group grow>
            <TextInput label="User" value={mailbox.email?.smtp_user || ''} onChange={(e) => updateEmail('smtp_user', e.currentTarget.value)} />
            <PasswordInput label="Password" value={mailbox.email?.smtp_password || ''} onChange={(e) => updateEmail('smtp_password', e.currentTarget.value)} />
          </Group>
          <TextInput label="From" description="Email address used in the From header" placeholder="support@example.com" value={mailbox.email?.smtp_from || ''} onChange={(e) => updateEmail('smtp_from', e.currentTarget.value)} />

          <Fieldset legend="Folders">
            <Stack>
              <Group align="end">
                <TextInput label="Sent Folder" placeholder="Sent" value={mailbox.email?.sent_mailbox || ''} onChange={(e) => updateEmail('sent_mailbox', e.currentTarget.value)} style={{ flex: 1 }} />
                <Button variant="light" onClick={() => browseMailboxes('sent_mailbox')} leftSection={<IconFolder size={16} />}>Browse</Button>
              </Group>
              <Group align="end">
                <TextInput label="Deleted Folder" placeholder="Trash" value={mailbox.email?.deleted_mailbox || ''} onChange={(e) => updateEmail('deleted_mailbox', e.currentTarget.value)} style={{ flex: 1 }} />
                <Button variant="light" onClick={() => browseMailboxes('deleted_mailbox')} leftSection={<IconFolder size={16} />}>Browse</Button>
              </Group>
            </Stack>
          </Fieldset>

          <NumberInput label="Poll interval (seconds)" value={mailbox.email?.poll_interval_seconds || 60} onChange={(v) => updateEmail('poll_interval_seconds', v)} />

          {mailbox.last_fetched_at && (
            <Text size="sm" c="dimmed">Last successful fetch: {new Date(mailbox.last_fetched_at).toLocaleString()}</Text>
          )}

          <Group>
            <Button onClick={saveMailbox}>Save Mailbox Settings</Button>
            <Button variant="light" onClick={fetchNow}>Fetch Now</Button>
          </Group>

          <Group mt="xl">
            {!deleteConfirm ? (
              <Button variant="subtle" color="red" leftSection={<IconTrash size={16} />} onClick={() => setDeleteConfirm(true)}>Delete Mailbox</Button>
            ) : (
              <>
                <Text size="sm" c="red">Are you sure? This cannot be undone.</Text>
                <Button color="red" onClick={onDelete}>Confirm Delete</Button>
                <Button variant="default" onClick={() => setDeleteConfirm(false)}>Cancel</Button>
              </>
            )}
          </Group>
        </Stack>

        <Modal opened={browseOpen} onClose={() => setBrowseOpen(false)} title="Select IMAP Folder" size="sm">
          {browseLoading ? (
            <Group justify="center" p="xl"><Loader /></Group>
          ) : imapFolders.length === 0 ? (
            <Text c="dimmed" ta="center" p="md">No folders found</Text>
          ) : (
            <Stack gap={0}>
              {imapFolders.map((m: any) => (
                <NavLink
                  key={m.name}
                  label={m.name}
                  leftSection={<IconFolder size={16} />}
                  active={mailbox.email?.[browseTarget] === m.name}
                  onClick={() => selectFolder(m.name)}
                />
              ))}
            </Stack>
          )}
        </Modal>
      </Tabs.Panel>

      <Tabs.Panel value="signature" pt="md">
        <Stack maw={600}>
          <Text size="sm" c="dimmed">This signature will be automatically appended to all replies from this mailbox.</Text>
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
          <Group><Button onClick={saveMailbox}>Save Signature</Button></Group>
        </Stack>
      </Tabs.Panel>

      <Tabs.Panel value="access" pt="md">
        <Stack maw={500}>
          <TextInput
            label="OIDC Group"
            description="Only users in this OIDC group will have access to this mailbox as agents. Leave empty to skip OIDC-based assignment."
            placeholder="support-team"
            value={mailbox.oidc_group || ''}
            onChange={(e) => onChange({ ...mailbox, oidc_group: e.currentTarget.value })}
          />
          <Group><Button onClick={saveMailbox}>Save Access Settings</Button></Group>
        </Stack>
      </Tabs.Panel>
    </Tabs>
  )
}
