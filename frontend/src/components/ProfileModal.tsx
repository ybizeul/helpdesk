import { useEffect, useState, useRef, useCallback } from 'react'
import { Modal, Tabs, Stack, TextInput, PasswordInput, Button, Group, Text, Table, ActionIcon, Tooltip, Switch, Avatar, UnstyledButton } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconTrash, IconCamera } from '@tabler/icons-react'
import { startRegistration } from '@simplewebauthn/browser'
import { api } from '../api/client'

function canUseDesktopNotifications(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window && window.isSecureContext
}

function resizeImage(dataUrl: string, maxSize: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const scale = Math.min(maxSize / img.width, maxSize / img.height, 1)
      const w = Math.round(img.width * scale)
      const h = Math.round(img.height * scale)
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(img, 0, 0, w, h)
      resolve(canvas.toDataURL('image/png'))
    }
    img.onerror = reject
    img.src = dataUrl
  })
}

interface ProfileModalProps {
  opened: boolean
  onClose: () => void
  user: { id: string; name: string; email: string; role: string; avatar?: string } | null
  onAvatarChange?: (avatar: string) => void
}

export function ProfileModal({ opened, onClose, user, onAvatarChange }: ProfileModalProps) {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [changingPassword, setChangingPassword] = useState(false)

  const [passkeys, setPasskeys] = useState<any[]>([])
  const [passkeyName, setPasskeyName] = useState('')
  const [registeringPasskey, setRegisteringPasskey] = useState(false)
  const supportsPasskey = typeof window !== 'undefined' && !!window.PublicKeyCredential

  const [, forceUpdate] = useState(0)

  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleImageFile = useCallback(async (file: File) => {
    if (!file.type.startsWith('image/')) return
    const reader = new FileReader()
    reader.onload = async () => {
      try {
        const resized = await resizeImage(reader.result as string, 70)
        await api.updateAvatar(resized)
        onAvatarChange?.(resized)
        notifications.show({ title: 'Success', message: 'Profile picture updated', color: 'green' })
      } catch (e: any) {
        notifications.show({ title: 'Error', message: e.message, color: 'red' })
      }
    }
    reader.readAsDataURL(file)
  }, [onAvatarChange])

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items
    if (!items) return
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile()
        if (file) { handleImageFile(file); break }
      }
    }
  }, [handleImageFile])

  useEffect(() => {
    if (!opened) return
    if (supportsPasskey) {
      api.passkeys.list().then(setPasskeys).catch(console.error)
    }
  }, [opened])

  const handleChangePassword = async () => {
    if (newPassword !== confirmPassword) {
      notifications.show({ title: 'Error', message: 'Passwords do not match', color: 'red' })
      return
    }
    setChangingPassword(true)
    try {
      await api.changePassword(currentPassword, newPassword)
      notifications.show({ title: 'Success', message: 'Password changed', color: 'green' })
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
    } catch (e: any) {
      notifications.show({ title: 'Error', message: e.message, color: 'red' })
    } finally {
      setChangingPassword(false)
    }
  }

  return (
    <Modal opened={opened} onClose={onClose} title="Profile" size="lg">
      <div onPaste={handlePaste}>
      <Tabs defaultValue="account">
        <Tabs.List>
          <Tabs.Tab value="account">Account</Tabs.Tab>
          <Tabs.Tab value="notifications">Notifications</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="account" pt="md">
          <Stack>
            <Group>
              <Tooltip label="Click to change picture, or paste from clipboard" withArrow>
                <UnstyledButton onClick={() => fileInputRef.current?.click()}>
                  <Avatar
                    size={70}
                    radius="xl"
                    src={user?.avatar || null}
                    color="blue"
                    style={{ cursor: 'pointer', position: 'relative' }}
                  >
                    {user?.avatar ? null : (user?.name?.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2) || '?')}
                    <IconCamera size={20} style={{ position: 'absolute', bottom: 0, right: 0, background: 'var(--mantine-color-blue-6)', borderRadius: '50%', padding: 2, color: 'white' }} />
                  </Avatar>
                </UnstyledButton>
              </Tooltip>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImageFile(f); e.target.value = '' }}
              />
              <div>
                <Text fw={500}>{user?.name}</Text>
                <Text size="sm" c="dimmed">{user?.email}</Text>
              </div>
            </Group>

            <Text fw={500} mt="md">Change password</Text>
            <PasswordInput label="Current password" value={currentPassword} onChange={(e) => setCurrentPassword(e.currentTarget.value)} />
            <Group grow>
              <PasswordInput label="New password" value={newPassword} onChange={(e) => setNewPassword(e.currentTarget.value)} />
              <PasswordInput label="Confirm new password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.currentTarget.value)} />
            </Group>
            <Group>
              <Button onClick={handleChangePassword} loading={changingPassword} disabled={!currentPassword || !newPassword || !confirmPassword}>
                Change password
              </Button>
            </Group>

            {supportsPasskey && (
              <>
                <Text fw={500} mt="md">Passkeys</Text>
                <Text size="sm" c="dimmed">Sign in with your fingerprint, face, or device PIN instead of a password.</Text>
                {passkeys.length > 0 && (
                  <Table>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>Name</Table.Th>
                        <Table.Th>Created</Table.Th>
                        <Table.Th w={50} />
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {passkeys.map((pk) => (
                        <Table.Tr key={pk.id}>
                          <Table.Td>{pk.name}</Table.Td>
                          <Table.Td>{new Date(pk.created_at).toLocaleDateString()}</Table.Td>
                          <Table.Td>
                            <Tooltip label="Delete passkey">
                              <ActionIcon color="red" variant="subtle" onClick={async () => {
                                try {
                                  await api.passkeys.delete(pk.id)
                                  setPasskeys(prev => prev.filter(p => p.id !== pk.id))
                                  notifications.show({ title: 'Deleted', message: 'Passkey removed', color: 'green' })
                                } catch (e: any) {
                                  notifications.show({ title: 'Error', message: e.message, color: 'red' })
                                }
                              }}>
                                <IconTrash size={16} />
                              </ActionIcon>
                            </Tooltip>
                          </Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                )}
                <Group align="end">
                  <TextInput
                    label="Passkey name"
                    placeholder="e.g. MacBook Touch ID"
                    value={passkeyName}
                    onChange={(e) => setPasskeyName(e.currentTarget.value)}
                    style={{ flex: 1 }}
                  />
                  <Button loading={registeringPasskey} onClick={async () => {
                    setRegisteringPasskey(true)
                    try {
                      const { session_id, options } = await api.passkeys.beginRegistration()
                      const attestation = await startRegistration({ optionsJSON: options.publicKey })
                      const result = await api.passkeys.finishRegistration(session_id, passkeyName || 'Passkey', attestation)
                      setPasskeys(prev => [...prev, result])
                      setPasskeyName('')
                      notifications.show({ title: 'Registered', message: 'Passkey added successfully', color: 'green' })
                    } catch (e: any) {
                      if (e.name === 'NotAllowedError') { setRegisteringPasskey(false); return }
                      notifications.show({ title: 'Error', message: e.message, color: 'red' })
                    } finally {
                      setRegisteringPasskey(false)
                    }
                  }}>Register passkey</Button>
                </Group>
              </>
            )}
          </Stack>
        </Tabs.Panel>

        <Tabs.Panel value="notifications" pt="md">
          <Stack>
            <Text size="sm" c="dimmed">Receive browser notifications when new cases arrive.</Text>
            <Switch
              label="Enable desktop notifications"
              checked={localStorage.getItem('notifications_enabled') === 'true'}
              onChange={async (e) => {
                if (e.currentTarget.checked) {
                  if (!canUseDesktopNotifications()) {
                    notifications.show({
                      title: 'Not supported',
                      message: 'Desktop notifications require a supported browser and a secure context (https or localhost).',
                      color: 'red'
                    })
                    return
                  }
                  const permission = Notification.permission === 'granted'
                    ? 'granted'
                    : await Notification.requestPermission()
                  if (permission === 'granted') {
                    localStorage.setItem('notifications_enabled', 'true')
                    notifications.show({ title: 'Enabled', message: 'Desktop notifications enabled', color: 'green' })
                    try {
                      const n = new Notification('Helpdesk notifications enabled', { body: 'You will be notified when new cases arrive.' })
                      setTimeout(() => n.close(), 2500)
                    } catch {
                      notifications.show({
                        title: 'Browser limitation',
                        message: 'Permission is granted but this browser did not display a test notification.',
                        color: 'yellow'
                      })
                    }
                  } else {
                    localStorage.setItem('notifications_enabled', 'false')
                    notifications.show({ title: 'Denied', message: 'Notification permission was denied by the browser', color: 'red' })
                  }
                } else {
                  localStorage.setItem('notifications_enabled', 'false')
                  notifications.show({ title: 'Disabled', message: 'Desktop notifications disabled', color: 'gray' })
                }
                forceUpdate(n => n + 1)
              }}
            />
            {typeof Notification !== 'undefined' && Notification.permission === 'denied' && (
              <Text size="sm" c="red">Notifications are blocked by your browser. Please allow them in your browser settings.</Text>
            )}
          </Stack>
        </Tabs.Panel>
      </Tabs>
      </div>
    </Modal>
  )
}
