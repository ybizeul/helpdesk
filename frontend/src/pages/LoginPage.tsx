import { useState } from 'react'
import { TextInput, PasswordInput, Button, Paper, Title, Stack, Center, Alert, Divider } from '@mantine/core'
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
  const supportsPasskey = typeof window !== 'undefined' && !!window.PublicKeyCredential

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

  return (
    <Center h="100vh" px="md">
      <Paper withBorder shadow="md" p="xl" radius="md" w={400} maw="100%">
        <Title order={2} ta="center" mb="lg">Helpdesk</Title>
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
          </Stack>
        </form>
      </Paper>
    </Center>
  )
}
