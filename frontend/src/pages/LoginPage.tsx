import { useEffect, useState } from 'react'
import { TextInput, PasswordInput, Button, Paper, Title, Stack, Center, Alert, Divider, Text, Loader, Group } from '@mantine/core'
import { IconUserCheck } from '@tabler/icons-react'
import { startAuthentication } from '@simplewebauthn/browser'
import { api } from '../api/client'

interface LoginPageProps {
  onLogin: (token: string, user: any) => void
}

export function LoginPage({ onLogin }: LoginPageProps) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [passkeyLoading, setPasskeyLoading] = useState(false)
  const [oidcEnabled, setOIDCEnabled] = useState(false)
  const [disableLocalLogin, setDisableLocalLogin] = useState(false)
  const [oidcLoading, setOIDCLoading] = useState(false)
  const [siteName, setSiteName] = useState('Helpdesk')
  const supportsPasskey = typeof window !== 'undefined' && !!window.PublicKeyCredential

  useEffect(() => {
    api.settings.getPublic().then(s => { if (s.site_name) setSiteName(s.site_name) }).catch(() => {})
    api.oidc.status()
      .then((s) => {
        setOIDCEnabled(!!s.enabled)
        setDisableLocalLogin(!!s.disable_local_login)
        if (s.enabled && s.disable_local_login) {
          const redirectPath = window.location.pathname + window.location.search
          window.location.href = api.oidc.startUrl(redirectPath || '/')
        }
      })
      .catch(() => {
        setOIDCEnabled(false)
        setDisableLocalLogin(false)
      })
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const result = await api.login(email, password)
      onLogin(result.token, result.user)
    } catch (err: any) {
      setError(err.message || 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  const handlePasskeyLogin = async () => {
    setError('')
    setPasskeyLoading(true)
    try {
      const { session_id, options } = await api.passkeys.beginLogin()
      const assertion = await startAuthentication({ optionsJSON: options.publicKey })
      const result = await api.passkeys.finishLogin(session_id, assertion)
      onLogin(result.token, result.user)
    } catch (err: any) {
      if (err.name === 'NotAllowedError') return // user cancelled
      setError(err.message || 'Passkey login failed')
    } finally {
      setPasskeyLoading(false)
    }
  }

  const handleOIDCLogin = () => {
    setOIDCLoading(true)
    const redirectPath = window.location.pathname + window.location.search
    window.location.href = api.oidc.startUrl(redirectPath || '/')
  }

  return (
    <Center h="100vh" px="md">
      <Paper withBorder shadow="md" p="xl" radius="md" w={400} maw="100%">
        <Title order={2} ta="center" mb="lg">{siteName}</Title>
        {disableLocalLogin && oidcEnabled ? (
          <Stack align="center" gap="md" py="md">
            <Loader size="sm" />
            <Group gap={8} justify="center">
              <IconUserCheck size={18} style={{ color: 'var(--mantine-color-dimmed)' }} />
              <Text size="sm" c="dimmed">Redirecting to your corporate authentication</Text>
            </Group>
          </Stack>
        ) : (
        <form onSubmit={handleSubmit}>
          <Stack>
            {error && <Alert color="red" variant="light">{error}</Alert>}
            <TextInput
              label="Email"
              placeholder="admin@localhost"
              value={email}
              onChange={(e) => setEmail(e.currentTarget.value)}
              required
            />
            <PasswordInput
              label="Password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.currentTarget.value)}
              required
            />
            <Button type="submit" fullWidth loading={loading}>
              Sign in
            </Button>
            {supportsPasskey && (
              <>
                <Divider label="or" labelPosition="center" />
                <Button variant="light" fullWidth loading={passkeyLoading} onClick={handlePasskeyLogin}>
                  Sign in with passkey
                </Button>
              </>
            )}
            {oidcEnabled && (
              <>
                <Divider label="or" labelPosition="center" />
                <Button variant="default" fullWidth loading={oidcLoading} onClick={handleOIDCLogin}>
                  Sign in with OIDC
                </Button>
              </>
            )}
          </Stack>
        </form>
        )}
      </Paper>
    </Center>
  )
}
