import { useEffect, useState } from 'react'
import { Title, Table, Badge, Text, Stack, PasswordInput, Button, Group, Modal, TextInput, Select, ActionIcon, Paper, Switch, Divider, Code } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconEdit, IconTrash, IconPlus } from '@tabler/icons-react'
import { api } from '../api/client'

const emptyForm = { name: '', email: '', role: 'agent', password: '' }
const emptyOIDCForm = {
  oidc_enabled: false,
  oidc_issuer: '',
  oidc_client_id: '',
  oidc_client_secret: '',
}

export function UsersPage() {
  const [users, setUsers] = useState<any[]>([])

  // CRUD modal state
  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)

  // Delete confirmation state
  const [deleteTarget, setDeleteTarget] = useState<any | null>(null)
  const [deleting, setDeleting] = useState(false)

  // OIDC settings state
  const [oidc, setOIDC] = useState<any>(emptyOIDCForm)
  const [oidcCallbackEndpoint, setOIDCCallbackEndpoint] = useState('')
  const [oidcSaving, setOIDCSaving] = useState(false)

  const loadUsers = () => api.users.list().then(setUsers).catch(console.error)

  const loadOIDC = async () => {
    try {
      const [settings, callbackInfo] = await Promise.all([
        api.settings.get(),
        api.settings.getOIDCCallbackInfo(),
      ])
      setOIDC({ ...emptyOIDCForm, ...(settings?.auth || {}) })
      setOIDCCallbackEndpoint(callbackInfo?.callback_endpoint || '')
    } catch (err) {
      console.error(err)
    }
  }

  useEffect(() => {
    loadUsers()
    loadOIDC()
  }, [])

  const adminCount = users.filter((u) => u.role === 'admin').length

  const openCreate = () => {
    setEditingId(null)
    setForm(emptyForm)
    setModalOpen(true)
  }

  const openEdit = (u: any) => {
    setEditingId(u.id)
    setForm({ name: u.name, email: u.email, role: u.role, password: '' })
    setModalOpen(true)
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.email) {
      notifications.show({ title: 'Error', message: 'Email is required', color: 'red' })
      return
    }
    if (!editingId && form.password.length < 8) {
      notifications.show({ title: 'Error', message: 'Password must be at least 8 characters', color: 'red' })
      return
    }
    if (editingId && form.password && form.password.length < 8) {
      notifications.show({ title: 'Error', message: 'Password must be at least 8 characters', color: 'red' })
      return
    }
    setSaving(true)
    try {
      if (editingId) {
        const data: any = { name: form.name, email: form.email, role: form.role }
        if (form.password) data.password = form.password
        await api.users.update(editingId, data)
        notifications.show({ title: 'User updated', message: `${form.email} has been updated`, color: 'green' })
      } else {
        await api.users.create({ name: form.name, email: form.email, role: form.role, password: form.password })
        notifications.show({ title: 'User created', message: `${form.email} has been created`, color: 'green' })
      }
      setModalOpen(false)
      loadUsers()
    } catch (err: any) {
      notifications.show({ title: 'Error', message: err.message || 'Failed to save user', color: 'red' })
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await api.users.delete(deleteTarget.id)
      notifications.show({ title: 'User deleted', message: `${deleteTarget.email} has been deleted`, color: 'green' })
      setDeleteTarget(null)
      loadUsers()
    } catch (err: any) {
      notifications.show({ title: 'Error', message: err.message || 'Failed to delete user', color: 'red' })
    } finally {
      setDeleting(false)
    }
  }

  const saveOIDC = async () => {
    setOIDCSaving(true)
    try {
      await api.settings.updateAuth(oidc)
      notifications.show({ title: 'OIDC settings updated', message: 'Authentication configuration has been saved', color: 'green' })
    } catch (err: any) {
      notifications.show({ title: 'Error', message: err.message || 'Failed to save OIDC settings', color: 'red' })
    } finally {
      setOIDCSaving(false)
    }
  }

  const callbackURL = oidcCallbackEndpoint ? new URL(oidcCallbackEndpoint, window.location.origin).toString() : ''

  return (
    <>
      <Group justify="space-between" mb="lg">
        <Title order={2}>Users</Title>
        <Button leftSection={<IconPlus size={16} />} onClick={openCreate}>Add user</Button>
      </Group>

      <Table striped highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Name</Table.Th>
            <Table.Th>Email</Table.Th>
            <Table.Th>Role</Table.Th>
            <Table.Th w={100}>Actions</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {users.map((u) => {
            const isLastAdmin = u.role === 'admin' && adminCount <= 1
            return (
              <Table.Tr key={u.id}>
                <Table.Td>{u.name}</Table.Td>
                <Table.Td>{u.email}</Table.Td>
                <Table.Td><Badge>{u.role}</Badge></Table.Td>
                <Table.Td>
                  <Group gap="xs">
                    <ActionIcon variant="subtle" onClick={() => openEdit(u)}><IconEdit size={16} /></ActionIcon>
                    <ActionIcon variant="subtle" color="red" disabled={isLastAdmin} onClick={() => setDeleteTarget(u)}><IconTrash size={16} /></ActionIcon>
                  </Group>
                </Table.Td>
              </Table.Tr>
            )
          })}
          {users.length === 0 && (
            <Table.Tr>
              <Table.Td colSpan={4}><Text c="dimmed" ta="center">No users</Text></Table.Td>
            </Table.Tr>
          )}
        </Table.Tbody>
      </Table>

      <Paper withBorder p="lg" mt="xl" radius="md">
        <Stack>
          <Group justify="space-between" align="flex-start">
            <div>
              <Title order={3}>OIDC Authentication</Title>
              <Text size="sm" c="dimmed">Configure OpenID Connect login for your helpdesk users.</Text>
            </div>
            <Switch
              label="Enabled"
              checked={!!oidc?.oidc_enabled}
              onChange={(e) => setOIDC({ ...oidc, oidc_enabled: e.currentTarget.checked })}
            />
          </Group>

          <Divider />

          <TextInput
            label="OIDC Endpoint"
            placeholder="https://idp.example.com/.well-known/openid-configuration"
            value={oidc?.oidc_issuer || ''}
            onChange={(e) => setOIDC({ ...oidc, oidc_issuer: e.currentTarget.value })}
          />
          <TextInput
            label="Client ID"
            value={oidc?.oidc_client_id || ''}
            onChange={(e) => setOIDC({ ...oidc, oidc_client_id: e.currentTarget.value })}
          />
          <PasswordInput
            label="Client Secret"
            value={oidc?.oidc_client_secret || ''}
            onChange={(e) => setOIDC({ ...oidc, oidc_client_secret: e.currentTarget.value })}
          />

          <Stack gap={4}>
            <Text size="sm" fw={500}>Callback URL</Text>
            <Code block>{callbackURL || 'Unavailable'}</Code>
            <Text size="xs" c="dimmed">Computed from browser URL + backend callback endpoint.</Text>
          </Stack>

          <Group justify="flex-end">
            <Button onClick={saveOIDC} loading={oidcSaving}>Save OIDC Settings</Button>
          </Group>
        </Stack>
      </Paper>

      {/* Create / Edit modal */}
      <Modal opened={modalOpen} onClose={() => setModalOpen(false)} title={editingId ? 'Edit user' : 'Create user'}>
        <form onSubmit={handleSave}>
          <Stack>
            <TextInput label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.currentTarget.value })} />
            <TextInput label="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.currentTarget.value })} required />
            <Select label="Role" data={[{ value: 'admin', label: 'Admin' }, { value: 'agent', label: 'Agent' }]} value={form.role} onChange={(v) => setForm({ ...form, role: v || 'agent' })} />
            <PasswordInput label={editingId ? 'New password (leave blank to keep)' : 'Password'} value={form.password} onChange={(e) => setForm({ ...form, password: e.currentTarget.value })} required={!editingId} />
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setModalOpen(false)}>Cancel</Button>
              <Button type="submit" loading={saving}>{editingId ? 'Save' : 'Create'}</Button>
            </Group>
          </Stack>
        </form>
      </Modal>

      {/* Delete confirmation modal */}
      <Modal opened={!!deleteTarget} onClose={() => setDeleteTarget(null)} title="Delete user">
        <Text>Are you sure you want to delete <b>{deleteTarget?.email}</b>?</Text>
        <Group justify="flex-end" mt="lg">
          <Button variant="default" onClick={() => setDeleteTarget(null)}>Cancel</Button>
          <Button color="red" loading={deleting} onClick={handleDelete}>Delete</Button>
        </Group>
      </Modal>
    </>
  )
}
