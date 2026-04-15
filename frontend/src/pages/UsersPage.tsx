import { useEffect, useState } from 'react'
import { Title, Table, Badge, Text } from '@mantine/core'
import { api } from '../api/client'

export function UsersPage() {
  const [users, setUsers] = useState<any[]>([])

  useEffect(() => {
    api.users.list().then(setUsers).catch(console.error)
  }, [])

  return (
    <>
      <Title order={2} mb="lg">Users</Title>
      <Table striped highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Name</Table.Th>
            <Table.Th>Email</Table.Th>
            <Table.Th>Role</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {users.map((u) => (
            <Table.Tr key={u.id}>
              <Table.Td>{u.name}</Table.Td>
              <Table.Td>{u.email}</Table.Td>
              <Table.Td><Badge>{u.role}</Badge></Table.Td>
            </Table.Tr>
          ))}
          {users.length === 0 && (
            <Table.Tr>
              <Table.Td colSpan={3}><Text c="dimmed" ta="center">No users</Text></Table.Td>
            </Table.Tr>
          )}
        </Table.Tbody>
      </Table>
    </>
  )
}
