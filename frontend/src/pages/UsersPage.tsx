import { useEffect, useState } from 'react'
import { Title, Table, Badge, Text, Stack, PasswordInput, Button, Group, Modal, TextInput, Select, ActionIcon, Checkbox } from '@mantine/core'
import { useMediaQuery } from '@mantine/hooks'
import { notifications } from '@mantine/notifications'
import { IconEdit, IconTrash, IconPlus } from '@tabler/icons-react'
import { api } from '../api/client'

const emptyForm = { name: '', email: '', role: 'agent', password: '', mailboxes: [] as string[] }

export function UsersPage({ mailboxes = [] }: { mailboxes?: any[] }) {
  const [users, setUsers] = useState<any[]>([])

  // CRUD modal state
  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)

  // Delete confirmation state
  const [deleteTarget, setDeleteTarget] = useState<any | null>(null)
  const [deleting, setDeleting] = useState(false)

  const isMobile = useMediaQuery('(max-width: 48em)')

  const loadUsers = () => api.users.list().then(setUsers).catch(console.error)

  useEffect(() => {
    loadUsers()
  }, [])

  const adminCount = users.filter((u) => u.role === 'admin').length

  const openCreate = () => {
    setEditingId(null)
    setForm(emptyForm)
    setModalOpen(true)
  }

  const openEdit = (u: any) => {
    setEditingId(u.id)
    setForm({ name: u.name, email: u.email, role: u.role, password: '', mailboxes: u.mailboxes || [] })
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
        const data: any = { name: form.name, email: form.email, role: form.role, mailboxes: form.role === 'agent' ? form.mailboxes : undefined }
        if (form.password) data.password = form.password
        await api.users.update(editingId, data)
        notifications.show({ title: 'User updated', message: `${form.email} has been updated`, color: 'green' })
      } else {
        await api.users.create({ name: form.name, email: form.email, role: form.role, password: form.password, mailboxes: form.role === 'agent' ? form.mailboxes : undefined })
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

  return (
    <>
      <Group justify="space-between" mb="lg">
        <Title order={2}>Users</Title>
        <Button leftSection={<IconPlus size={16} />} onClick={openCreate}>Add user</Button>
      </Group>

      <Table striped highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Name{isMobile ? ' / Email' : ''}</Table.Th>
            {!isMobile && <Table.Th>Email</Table.Th>}
            {!isMobile && <Table.Th>Mailboxes</Table.Th>}
            <Table.Th>Role</Table.Th>
            <Table.Th w={100}>Actions</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {users.map((u) => {
            const isLastAdmin = u.role === 'admin' && adminCount <= 1
            return (
              <Table.Tr key={u.id}>
                <Table.Td>
                  <Text>{u.name}</Text>
                  {isMobile && <Text size="sm" c="dimmed">{u.email}</Text>}
                </Table.Td>
                {!isMobile && <Table.Td>{u.email}</Table.Td>}
                {!isMobile && <Table.Td>
                  {u.role === 'admin'
                    ? <Text c="dimmed" size="sm">–</Text>
                    : (u.mailboxes?.length
                        ? u.mailboxes.map((mid: string) => mailboxes.find((mb: any) => mb.id === mid)?.name).filter(Boolean).join(', ') || <Text c="dimmed" size="sm">–</Text>
                        : <Text c="dimmed" size="sm">–</Text>)}
                </Table.Td>}
                <Table.Td><Badge>{u.role === 'agent' ? 'User' : u.role}</Badge></Table.Td>
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
              <Table.Td colSpan={isMobile ? 3 : 5}><Text c="dimmed" ta="center">No users</Text></Table.Td>
            </Table.Tr>
          )}
        </Table.Tbody>
      </Table>

      {/* Create / Edit modal */}
      <Modal opened={modalOpen} onClose={() => setModalOpen(false)} title={editingId ? 'Edit user' : 'Create user'}>
        <form onSubmit={handleSave}>
          <Stack>
            <TextInput label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.currentTarget.value })} />
            <TextInput label="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.currentTarget.value })} required />
            <Select label="Role" data={[{ value: 'admin', label: 'Admin' }, { value: 'agent', label: 'User' }]} value={form.role} onChange={(v) => setForm({ ...form, role: v || 'agent' })} />
            <PasswordInput label={editingId ? 'New password (leave blank to keep)' : 'Password'} value={form.password} onChange={(e) => setForm({ ...form, password: e.currentTarget.value })} required={!editingId} />
            {form.role === 'agent' && mailboxes.length > 0 && (
              <Stack gap="xs">
                <Text size="sm" fw={500}>Mailboxes</Text>
                {mailboxes.map((mb: any) => (
                  <Checkbox
                    key={mb.id}
                    label={mb.name}
                    checked={form.mailboxes.includes(mb.id)}
                    onChange={(e) => {
                      const checked = e.currentTarget.checked
                      setForm(prev => ({
                        ...prev,
                        mailboxes: checked
                          ? [...prev.mailboxes, mb.id]
                          : prev.mailboxes.filter((id: string) => id !== mb.id),
                      }))
                    }}
                  />
                ))}
              </Stack>
            )}
            {form.role === 'admin' && (
              <Text size="sm" c="dimmed">Admins have access to all mailboxes.</Text>
            )}
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
