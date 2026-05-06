import { useState } from 'react'
import { Modal, TextInput, Button, Group, Stack, Text } from '@mantine/core'
import { useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import Link from '@tiptap/extension-link'
import Image from '@tiptap/extension-image'
import Placeholder from '@tiptap/extension-placeholder'
import { RichTextEditor } from '@mantine/tiptap'
import { useMediaQuery } from '@mantine/hooks'
import { notifications } from '@mantine/notifications'
import { api } from '../api/client'
import '@mantine/tiptap/styles.css'

interface NewTicketModalProps {
  opened: boolean
  onClose: () => void
  mailboxId?: string
  onCreated?: (ticketId: string) => void
}

export function NewTicketModal({ opened, onClose, mailboxId, onCreated }: NewTicketModalProps) {
  const isMobile = useMediaQuery('(max-width: 768px)')
  const [subject, setSubject] = useState('')
  const [recipientEmail, setRecipientEmail] = useState('')
  const [loading, setLoading] = useState(false)

  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      Link.configure({ openOnClick: false }),
      Image.configure({ inline: true, allowBase64: true }),
      Placeholder.configure({ placeholder: 'Write a message...' }),
    ],
    content: '',
  })

  const emailValid = recipientEmail.trim() === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail.trim())
  const canCreate = subject.trim().length > 0 && recipientEmail.trim().length > 0 && emailValid

  const handleClose = () => {
    setSubject('')
    setRecipientEmail('')
    editor?.commands.clearContent()
    onClose()
  }

  const handleCreate = async () => {
    if (!canCreate) return
    setLoading(true)
    try {
      const ticket = await api.tickets.create({
        subject: subject.trim(),
        mailbox_id: mailboxId,
        requester: { email: recipientEmail.trim(), name: recipientEmail.trim().split('@')[0] },
      })

      if (editor && !editor.isEmpty) {
        const html = editor.getHTML()
        const text = editor.getText()
        try {
          const result = await api.tickets.reply(ticket.id, { body: text, html })
          if (result.send_error) {
            notifications.show({ title: 'Case created but email failed to send', message: result.send_error, color: 'yellow' })
          } else {
            notifications.show({ title: 'Case created', message: `#${ticket.number} — email sent`, color: 'green' })
          }
        } catch (e: unknown) {
          notifications.show({ title: 'Case created but email failed to send', message: (e as Error).message, color: 'yellow' })
        }
      } else {
        notifications.show({ title: 'Case created', message: `#${ticket.number} - ${ticket.subject}`, color: 'green' })
      }

      setSubject('')
      setRecipientEmail('')
      editor?.commands.clearContent()
      onClose()
      onCreated?.(ticket.id)
    } catch (e: unknown) {
      notifications.show({ title: 'Failed to create case', message: (e as Error).message, color: 'red' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal opened={opened} onClose={handleClose} title="New Case" size="lg" fullScreen={isMobile}>
      <Stack gap="sm">
        <TextInput
          label="Recipient Email"
          placeholder="user@example.com"
          value={recipientEmail}
          onChange={(e) => setRecipientEmail(e.currentTarget.value)}
          required
          error={recipientEmail.trim() !== '' && !emailValid ? 'Invalid email address' : undefined}
        />
        <TextInput
          label="Subject"
          placeholder="Case title"
          value={subject}
          onChange={(e) => setSubject(e.currentTarget.value)}
          required
        />
        <div>
          <Text size="sm" fw={500} mb={4}>Message</Text>
          <RichTextEditor editor={editor} styles={{ root: { border: '1px solid var(--mantine-color-default-border)' } }}>
            <RichTextEditor.Toolbar>
              <RichTextEditor.ControlsGroup>
                <RichTextEditor.Bold />
                <RichTextEditor.Italic />
                <RichTextEditor.Underline />
                <RichTextEditor.Strikethrough />
              </RichTextEditor.ControlsGroup>
              <RichTextEditor.ControlsGroup>
                <RichTextEditor.BulletList />
                <RichTextEditor.OrderedList />
              </RichTextEditor.ControlsGroup>
              <RichTextEditor.ControlsGroup>
                <RichTextEditor.Link />
                <RichTextEditor.Unlink />
              </RichTextEditor.ControlsGroup>
              <RichTextEditor.ControlsGroup>
                <RichTextEditor.Blockquote />
                <RichTextEditor.Code />
              </RichTextEditor.ControlsGroup>
            </RichTextEditor.Toolbar>
            <RichTextEditor.Content />
          </RichTextEditor>
        </div>
        <Group justify="flex-end">
          <Button variant="default" onClick={handleClose} disabled={loading}>Cancel</Button>
          <Button loading={loading} disabled={!canCreate} onClick={handleCreate}>Create</Button>
        </Group>
      </Stack>
    </Modal>
  )
}
