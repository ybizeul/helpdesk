import { useEffect, useState } from 'react'
import { Title, SimpleGrid, Paper, Text } from '@mantine/core'
import { api } from '../api/client'

export function DashboardPage() {
  const [stats, setStats] = useState<any>(null)

  useEffect(() => {
    api.stats().then(setStats).catch(console.error)
  }, [])

  if (!stats) return <Text>Loading...</Text>

  return (
    <>
      <Title order={2} mb="lg">Dashboard</Title>
      <SimpleGrid cols={{ base: 1, sm: 2, md: 5 }}>
        <Paper withBorder p="md" radius="md">
          <Text c="dimmed" size="sm">Total</Text>
          <Text size="xl" fw={700}>{stats.total}</Text>
        </Paper>
        <Paper withBorder p="md" radius="md">
          <Text c="dimmed" size="sm">Unassigned</Text>
          <Text size="xl" fw={700} c="gray">{stats.unassigned}</Text>
        </Paper>
        <Paper withBorder p="md" radius="md">
          <Text c="dimmed" size="sm">Active</Text>
          <Text size="xl" fw={700} c="orange">{stats.active}</Text>
        </Paper>
        <Paper withBorder p="md" radius="md">
          <Text c="dimmed" size="sm">Waiting</Text>
          <Text size="xl" fw={700} c="green">{stats.waiting}</Text>
        </Paper>
        <Paper withBorder p="md" radius="md">
          <Text c="dimmed" size="sm">Closed</Text>
          <Text size="xl" fw={700} c="gray">{stats.closed}</Text>
        </Paper>
      </SimpleGrid>
    </>
  )
}
