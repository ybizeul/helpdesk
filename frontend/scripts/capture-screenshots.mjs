import fs from 'node:fs/promises'
import path from 'node:path'
import { chromium, request } from 'playwright'

const BASE_URL = process.env.BASE_URL || 'http://localhost:5173'
const EMAIL = process.env.SCREENSHOT_EMAIL || 'mock-admin@tynsoe.org'
const PASSWORD = process.env.SCREENSHOT_PASSWORD || 'Mock1234!'
const OUT_DIR = path.resolve(process.cwd(), 'screenshots')

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true })
  const entries = await fs.readdir(dir)
  await Promise.all(entries
    .filter((name) => name.endsWith('.png'))
    .map((name) => fs.rm(path.join(dir, name), { force: true })))
}

async function loginAndGetToken(api) {
  const response = await api.post(`${BASE_URL}/api/v1/auth/login`, {
    data: {
      email: EMAIL,
      password: PASSWORD,
    },
  })

  if (!response.ok()) {
    const body = await response.text()
    throw new Error(`Login failed (${response.status()}): ${body}`)
  }

  const payload = await response.json()
  return payload.token
}

async function getMockMailboxesAndTickets(api, token) {
  const headers = { Authorization: `Bearer ${token}` }

  const mbRes = await api.get(`${BASE_URL}/api/v1/mailboxes`, { headers })
  if (!mbRes.ok()) {
    throw new Error(`Failed to list mailboxes: HTTP ${mbRes.status()}`)
  }
  const mailboxes = await mbRes.json()
  if (!Array.isArray(mailboxes) || mailboxes.length < 2) {
    throw new Error('Expected at least two mailboxes for screenshots.')
  }

  const bySlug = Object.fromEntries(mailboxes.map((mb) => [mb.slug, mb]))
  const acme = bySlug.acme
  const marvelous = bySlug.marvelous
  if (!acme || !marvelous) {
    throw new Error('Expected seeded mailboxes with slugs "acme" and "marvelous".')
  }

  async function pickTicketForMailbox(mailbox) {
    const tRes = await api.get(`${BASE_URL}/api/v1/tickets?mailbox_id=${encodeURIComponent(mailbox.id)}`, { headers })
    if (!tRes.ok()) {
      throw new Error(`Failed to list tickets for ${mailbox.slug}: HTTP ${tRes.status()}`)
    }
    const tickets = await tRes.json()
    if (!Array.isArray(tickets) || tickets.length === 0) {
      throw new Error(`No tickets returned for mailbox ${mailbox.slug}.`)
    }

    const openStatuses = new Set(['unassigned', 'active', 'waiting'])
    const openTickets = tickets.filter((t) => openStatuses.has(t.status))
    const preferred = openTickets.length > 0 ? openTickets : tickets

    const details = await Promise.all(preferred.slice(0, 10).map(async (t) => {
      const detailRes = await api.get(`${BASE_URL}/api/v1/tickets/${t.id}`, { headers })
      if (!detailRes.ok()) return null
      return detailRes.json()
    }))
    const detailCandidates = details.filter(Boolean)
    detailCandidates.sort((a, b) => (b.messages?.length || 0) - (a.messages?.length || 0))

    return detailCandidates[0] || preferred[0]
  }

  return {
    acme,
    marvelous,
    acmeTicket: await pickTicketForMailbox(acme),
  }
}

function hashUrl(route) {
  return `${BASE_URL}/#${route}`
}

async function capture(page, name, route, waitFor) {
  await page.goto(hashUrl(route), { waitUntil: 'domcontentloaded' })
  if (waitFor) await waitFor(page)
  await page.waitForTimeout(700)
  const outPath = path.join(OUT_DIR, name)
  await page.screenshot({ path: outPath, fullPage: true })
  return outPath
}

async function main() {
  await ensureDir(OUT_DIR)

  const api = await request.newContext()
  const token = await loginAndGetToken(api)
  const { acme, marvelous, acmeTicket } = await getMockMailboxesAndTickets(api, token)

  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: 1536, height: 960 } })
  await context.addInitScript((savedToken) => {
    localStorage.setItem('token', savedToken)
    localStorage.setItem('pane_split', '35')
  }, token)
  const page = await context.newPage()

  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' })

  const outputs = []
  outputs.push(await capture(page, '01-dashboard.png', '/dashboard', async (p) => {
    await p.waitForURL((u) => u.hash === '#/dashboard', { timeout: 15000 })
    await p.waitForTimeout(1800)
  }))
  outputs.push(await capture(page, '02-acme-ticket-list.png', `/mailbox/${acme.slug}/tickets`, async (p) => {
    await p.waitForURL((u) => u.hash.includes(`/mailbox/${acme.slug}/tickets`), { timeout: 15000 })
    await p.waitForTimeout(1800)
  }))
  outputs.push(await capture(page, '03-acme-ticket-detail.png', `/mailbox/${acme.slug}/tickets/${acmeTicket.id}`, async (p) => {
    await p.waitForURL((u) => u.hash.includes(`/mailbox/${acme.slug}/tickets/${acmeTicket.id}`), { timeout: 15000 })
    await p.waitForTimeout(2200)
  }))
  outputs.push(await capture(page, '04-marvelous-ticket-list.png', `/mailbox/${marvelous.slug}/tickets`, async (p) => {
    await p.waitForURL((u) => u.hash.includes(`/mailbox/${marvelous.slug}/tickets`), { timeout: 15000 })
    await p.waitForTimeout(1800)
  }))
  outputs.push(await capture(page, '05-users.png', '/users', async (p) => {
    await p.waitForURL((u) => u.hash === '#/users', { timeout: 15000 })
    await p.waitForTimeout(1800)
  }))
  outputs.push(await capture(page, '06-settings.png', '/settings', async (p) => {
    await p.waitForURL((u) => u.hash === '#/settings', { timeout: 15000 })
    await p.waitForTimeout(2200)
  }))

  await context.close()
  await browser.close()
  await api.dispose()

  console.log(`Screenshots generated for user: ${EMAIL}`)
  console.log('Screenshots generated:')
  for (const file of outputs) console.log(`- ${file}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
