import { useState } from 'react'
import { TextInput, PasswordInput, Button, Paper, Title, Stack, Center, Alert } from '@mantine/core'
import { api } from '../api/client'

interface LoginPageProps {
  onLogin: (token: string, user: any) => void
}

export function LoginPage({ onLogin }: LoginPageProps) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

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

  return (
    <Center h="100vh">
      <Paper withBorder shadow="md" p="xl" radius="md" w={400}>
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
          </Stack>
        </form>
      </Paper>
    </Center>
  )
}
