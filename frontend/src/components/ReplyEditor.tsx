import { useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import Link from '@tiptap/extension-link'
import Image from '@tiptap/extension-image'
import Placeholder from '@tiptap/extension-placeholder'
import { RichTextEditor } from '@mantine/tiptap'
import '@mantine/tiptap/styles.css'

const MAX_IMAGE_SIZE = 900

function resizeImage(dataUrl: string): Promise<string> {
  return new Promise((resolve) => {
    const img = new window.Image()
    img.onload = () => {
      if (img.width <= MAX_IMAGE_SIZE && img.height <= MAX_IMAGE_SIZE) {
        resolve(dataUrl)
        return
      }
      const scale = Math.min(MAX_IMAGE_SIZE / img.width, MAX_IMAGE_SIZE / img.height)
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(img.width * scale)
      canvas.height = Math.round(img.height * scale)
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      const isPng = dataUrl.startsWith('data:image/png')
      resolve(canvas.toDataURL(isPng ? 'image/png' : 'image/jpeg', isPng ? undefined : 0.85))
    }
    img.src = dataUrl
  })
}

interface ReplyEditorProps {
  onSend: (html: string, text: string) => void
  onSendAndClose?: (html: string, text: string) => void
  signature?: string
}

export function ReplyEditor({ onSend, onSendAndClose, signature }: ReplyEditorProps) {
  const initialContent = signature ? `<p></p><p>--</p>${signature}` : ''
  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      Link.configure({ openOnClick: false }),
      Image.configure({ inline: true, allowBase64: true }),
      Placeholder.configure({ placeholder: 'Write a reply...' }),
    ],
    content: initialContent,
    editorProps: {
      handlePaste(view, event) {
        const items = event.clipboardData?.items
        if (!items) return false
        for (const item of items) {
          if (item.type.startsWith('image/')) {
            event.preventDefault()
            const file = item.getAsFile()
            if (!file) return true
            const reader = new FileReader()
            reader.onload = async () => {
              const src = await resizeImage(reader.result as string)
              view.dispatch(
                view.state.tr.replaceSelectionWith(
                  view.state.schema.nodes.image.create({ src })
                )
              )
            }
            reader.readAsDataURL(file)
            return true
          }
        }
        return false
      },
      handleDrop(view, event) {
        const files = event.dataTransfer?.files
        if (!files?.length) return false
        for (const file of files) {
          if (file.type.startsWith('image/')) {
            event.preventDefault()
            const reader = new FileReader()
            reader.onload = async () => {
              const src = await resizeImage(reader.result as string)
              const { tr } = view.state
              const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos ?? tr.selection.from
              view.dispatch(
                tr.insert(pos, view.state.schema.nodes.image.create({ src }))
              )
            }
            reader.readAsDataURL(file)
            return true
          }
        }
        return false
      },
    },
  })

  const handleSend = () => {
    if (!editor || editor.isEmpty) return
    const html = editor.getHTML()
    const text = editor.getText()
    editor.commands.setContent(initialContent)
    onSend(html, text)
  }

  const handleSendAndClose = () => {
    if (!editor || editor.isEmpty || !onSendAndClose) return
    const html = editor.getHTML()
    const text = editor.getText()
    editor.commands.setContent(initialContent)
    onSendAndClose(html, text)
  }

  return (
    <div>
      <RichTextEditor editor={editor}>
        <RichTextEditor.Toolbar sticky stickyOffset={0}>
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
            <RichTextEditor.CodeBlock />
          </RichTextEditor.ControlsGroup>
        </RichTextEditor.Toolbar>
        <RichTextEditor.Content />
      </RichTextEditor>
      <div style={{ marginTop: 8, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        {onSendAndClose && (
          <button
            onClick={handleSendAndClose}
            style={{
              padding: '8px 16px',
              background: 'var(--mantine-color-gray-filled)',
              color: 'white',
              border: 'none',
              borderRadius: 4,
              cursor: 'pointer',
              fontWeight: 500,
            }}
          >
            Send Reply &amp; Close
          </button>
        )}
        <button
          onClick={handleSend}
          style={{
            padding: '8px 16px',
            background: 'var(--mantine-color-blue-filled)',
            color: 'white',
            border: 'none',
            borderRadius: 4,
            cursor: 'pointer',
            fontWeight: 500,
          }}
        >
          Send Reply
        </button>
      </div>
    </div>
  )
}
