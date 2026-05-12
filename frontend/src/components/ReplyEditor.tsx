import { useState } from 'react'
import { useEditor } from '@tiptap/react'
import { Fragment, Slice } from '@tiptap/pm/model'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import Link from '@tiptap/extension-link'
import Image from '@tiptap/extension-image'
import Placeholder from '@tiptap/extension-placeholder'
import { RichTextEditor } from '@mantine/tiptap'
import { Button, Group, Box } from '@mantine/core'
import { IconNotes, IconSend, IconCircleLetterCFilled, IconMobiledata } from '@tabler/icons-react'
import { useMediaQuery } from '@mantine/hooks'
import { notifications } from '@mantine/notifications'
import '@mantine/tiptap/styles.css'

const MAX_IMAGE_SIZE = 900

function insertPlainTextWithLineBreaks(view: any, rawText: string): boolean {
  const text = rawText.replace(/\r\n?/g, '\n')
  const lines = text.split('\n')
  const hardBreak = view.state.schema.nodes.hardBreak
  if (!hardBreak) return false

  const nodes = [] as any[]
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.length > 0) nodes.push(view.state.schema.text(line))
    if (i < lines.length - 1) nodes.push(hardBreak.create())
  }

  if (nodes.length === 0) return true

  const tr = view.state.tr.replaceSelection(new Slice(Fragment.fromArray(nodes), 0, 0)).scrollIntoView()
  view.dispatch(tr)
  return true
}

function isInCodeBlock(view: any): boolean {
  const { $from } = view.state.selection
  for (let depth = $from.depth; depth >= 0; depth--) {
    const node = $from.node(depth)
    if (node.type.spec.code || node.type.name === 'codeBlock') return true
  }
  return false
}

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

async function blobUrlToDataUrl(blobUrl: string): Promise<string | null> {
  try {
    const res = await fetch(blobUrl)
    if (!res.ok) return null
    const blob = await res.blob()
    return await new Promise((resolve) => {
      const reader = new FileReader()
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null)
      reader.onerror = () => resolve(null)
      reader.readAsDataURL(blob)
    })
  } catch {
    return null
  }
}

async function normalizeBlobImageSources(html: string): Promise<string> {
  if (!html.includes('blob:') || typeof window === 'undefined') return html

  const parser = new DOMParser()
  const doc = parser.parseFromString(html, 'text/html')
  const images = Array.from(doc.querySelectorAll('img[src]'))

  for (const img of images) {
    const src = img.getAttribute('src')?.trim() || ''
    if (!src.startsWith('blob:')) continue
    const dataUrl = await blobUrlToDataUrl(src)
    if (dataUrl) {
      img.setAttribute('src', dataUrl)
    }
  }

  return doc.body.innerHTML
}

interface ReplyEditorProps {
  onSend: (html: string, text: string) => void
  onSendAndClose?: (html: string, text: string) => void
  onAddNote?: (html: string, text: string) => void
  signature?: string
  showHuploadControl?: boolean
  onInsertHuploadShare?: () => Promise<string>
}

export function ReplyEditor({ onSend, onSendAndClose, onAddNote, signature, showHuploadControl, onInsertHuploadShare }: ReplyEditorProps) {
  const isMobile = useMediaQuery('(max-width: 768px)')
  const initialContent = signature ? `<p></p><p>--</p>${signature}` : ''
  const [isInsertingHupload, setIsInsertingHupload] = useState(false)
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
        const plainText = event.clipboardData?.getData('text/plain')
        const htmlText = event.clipboardData?.getData('text/html')
        if (plainText && !htmlText) {
          if (isInCodeBlock(view)) {
            // Let ProseMirror handle plain text paste in code blocks to keep raw newlines.
            return false
          }
          event.preventDefault()
          return insertPlainTextWithLineBreaks(view, plainText)
        }

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

  const handleSend = async () => {
    if (!editor || editor.isEmpty) return
    const html = await normalizeBlobImageSources(editor.getHTML())
    const text = editor.getText()
    editor.commands.setContent(initialContent)
    onSend(html, text)
  }

  const handleSendAndClose = async () => {
    if (!editor || editor.isEmpty || !onSendAndClose) return
    const html = await normalizeBlobImageSources(editor.getHTML())
    const text = editor.getText()
    editor.commands.setContent(initialContent)
    onSendAndClose(html, text)
  }

  const handleAddNote = async () => {
    if (!editor || editor.isEmpty || !onAddNote) return
    const html = await normalizeBlobImageSources(editor.getHTML())
    const text = editor.getText()
    editor.commands.setContent(initialContent)
    onAddNote(html, text)
  }

  const handleInsertHupload = async () => {
    if (!editor || !onInsertHuploadShare || isInsertingHupload) return
    try {
      setIsInsertingHupload(true)
      const shareURL = await onInsertHuploadShare()
      if (!shareURL) return
      editor.chain().focus().insertContent(`<a href="${shareURL}">${shareURL}</a>`).run()
    } catch (e: any) {
      notifications.show({ title: 'Hupload error', message: e?.message || 'Failed to create share URL', color: 'red' })
    } finally {
      setIsInsertingHupload(false)
    }
  }

  return (
    <div>
      <RichTextEditor editor={editor} styles={{ root: { border: 'none', borderRadius: 0 }, toolbar: { borderTop: '1px solid var(--mantine-color-default-border)', borderRadius: 0 } }}>
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
          {showHuploadControl && (
            <RichTextEditor.ControlsGroup>
              <RichTextEditor.Control
                onClick={handleInsertHupload}
                title="Insert Hupload share URL"
                aria-label="Insert Hupload share URL"
                disabled={isInsertingHupload}
              >
                <IconMobiledata size={16} />
              </RichTextEditor.Control>
            </RichTextEditor.ControlsGroup>
          )}
        </RichTextEditor.Toolbar>
        <RichTextEditor.Content />
      </RichTextEditor>
      <Group justify="space-between" m="md">
        <Box>
          {onAddNote && (
            <Button variant="light" color="red" onClick={handleAddNote} size={isMobile ? 'sm' : undefined} px={isMobile ? 'xs' : undefined}>
              {isMobile ? <IconNotes size={16} /> : 'Add Private Note'}
            </Button>
          )}
        </Box>
        <Group gap="xs">
          {isMobile ? (
            <>
              {onSendAndClose && (
                <Button size="sm" px="xs" onClick={handleSendAndClose}>
                  <IconSend size={14} /><span style={{ fontSize: 10, margin: '0 1px' }}>+</span><IconCircleLetterCFilled size={14} />
                </Button>
              )}
              <Button size="sm" px="xs" onClick={handleSend}>
                <IconSend size={16} />
              </Button>
            </>
          ) : (
            <>
              {onSendAndClose && (
                <Button variant="default" onClick={handleSendAndClose}>
                  Reply &amp; Close
                </Button>
              )}
              <Button onClick={handleSend}>
                Reply
              </Button>
            </>
          )}
        </Group>
      </Group>
    </div>
  )
}
