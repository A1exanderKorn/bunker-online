// Run after `npm --prefix frontend run build`.
// Playwright must be resolvable (NODE_PATH works); CHROME_PATH may override its browser.
// Owns one temporary server and always stops it; never uses ports 3000 / 5173.
const { chromium } = require('playwright')
const { spawn } = require('node:child_process')
const { once } = require('node:events')
const { resolve, join } = require('node:path')
const { writeFileSync } = require('node:fs')
const assert = require('node:assert/strict')
const root = resolve(__dirname, '../..')
const origin = 'http://127.0.0.1:4317'
let server, browser, logs = '', checks = [], errors = []
const shot = (page, name) => page.screenshot({ path: join(__dirname, name + '.png'), fullPage: true })
async function mode(page, name) {
  for (let i = 0; i < 3; i++) {
    if (await page.evaluate(n => localStorage.getItem('bunker-theme') === n, name)) return
    await page.getByRole('button', { name: /^Тема:/ }).click()
  }
  assert.equal(await page.evaluate(() => localStorage.getItem('bunker-theme')), name)
}
async function fits(page, label) {
  for (const width of [320, 390, 768, 1024, 1600]) {
    await page.setViewportSize({ width, height: 1100 })
    await page.evaluate(() => new Promise(ok => requestAnimationFrame(() => requestAnimationFrame(ok))))
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
    if (overflow) {
      await shot(page, 'overflow-debug')
      console.log(await page.evaluate(() => ({ viewport: innerWidth, scroll: document.documentElement.scrollWidth, body: document.body.scrollWidth, nodes: [...document.querySelectorAll('body *')].filter(el => el.getBoundingClientRect().right > innerWidth + 1).map(el => ({ tag: el.tagName, cls: el.className, right: el.getBoundingClientRect().right })).slice(0, 20) })))
    }
    assert(!overflow, label + ' overflow at ' + width)
  }
  checks.push(label + ': no page overflow at 320 / 390 / 768 / 1024 / 1600px')
}
async function contrast(page, theme) {
  const colors = await page.evaluate(() => {
    const style = getComputedStyle(document.documentElement)
    return Object.fromEntries(['text', 'text-muted', 'text-faint', 'surface', 'surface-3', 'accent', 'on-accent', 'success', 'on-success', 'danger', 'on-danger'].map(k => [k, style.getPropertyValue('--' + k).trim()]))
  })
  const luminance = hex => {
    const rgb = hex.slice(1).match(/../g).slice(0, 3).map(v => parseInt(v, 16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4)
    return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722
  }
  const pairs = [['text', 'surface'], ['text-muted', 'surface'], ['text-faint', 'surface'], ['text-faint', 'surface-3'], ['on-accent', 'accent'], ['on-success', 'success'], ['on-danger', 'danger']]
  for (const [fg, bg] of pairs) {
    const a = luminance(colors[fg]), b = luminance(colors[bg])
    const ratio = (Math.max(a, b) + .05) / (Math.min(a, b) + .05)
    assert(ratio >= 4.5, `${theme}: ${fg} / ${bg} contrast ${ratio.toFixed(2)}`)
  }
  checks.push(theme + ': body, muted, faint and button-label palette contrast >= 4.5:1')
}
async function main() {
  // Fail rather than touch an existing user's process.
  const probe = require('node:net').createServer()
  await new Promise((ok, fail) => { probe.once('error', fail); probe.listen(4317, '127.0.0.1', ok) })
  await new Promise(ok => probe.close(ok))
  server = spawn(process.execPath, [join(root, 'server/node_modules/ts-node/dist/bin.js'), join(root, 'server/index.ts')], {
    cwd: join(root, 'server'), windowsHide: true,
    env: { ...process.env, PORT: '4317', APP_ORIGIN: origin, DATABASE_URL: '', NODE_ENV: 'development' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  server.stdout.on('data', b => logs += b)
  server.stderr.on('data', b => logs += b)
  let ready = false
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(origin + '/health')).ok) { ready = true; break } } catch {}
    if (server.exitCode !== null) throw Error(logs)
    await new Promise(ok => setTimeout(ok, 150))
  }
  assert(ready, logs)
  browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) })
  const contexts = [], pages = []
  async function player(name, url) {
    const context = await browser.newContext({ viewport: { width: 1600, height: 1100 }, reducedMotion: 'reduce', colorScheme: 'dark' })
    contexts.push(context)
    const page = await context.newPage()
    page.setDefaultTimeout(8000)
    page.on('pageerror', e => errors.push(e.message))
    pages.push(page)
    await page.goto(url)
    await page.getByPlaceholder(url === origin ? 'Введите имя' : 'Введите ваше имя', { exact: true }).fill(name)
    await page.getByRole('button', { name: url === origin ? 'ОК' : 'Войти', exact: true }).click()
    return page
  }
  const page = await player('Алекс', origin)
  await page.getByRole('button', { name: 'Присоединиться к игре', exact: true }).click()
  await page.getByRole('textbox', { name: 'Код лобби — четыре латинские буквы' }).fill('1')
  await page.getByRole('button', { name: 'Войти', exact: true }).click()
  assert(await page.locator('.join-error').isVisible())
  await page.getByRole('button', { name: 'Присоединиться к игре', exact: true }).click()
  checks.push('Guest nickname and invalid lobby-code validation work')
  for (const theme of ['dark', 'light']) {
    await mode(page, theme)
    await contrast(page, theme)
    await fits(page, 'Home ' + theme)
    await shot(page, 'home-' + theme)
  }
  await page.getByRole('button', { name: 'Создать игру', exact: true }).click()
  await page.locator('.code-copy').waitFor()
  const url = page.url()
  for (const name of ['Мария', 'Иван', 'София', 'Марк', 'Анна']) {
    const p = await player(name, url)
    await p.locator('.settings-panel').waitFor()
  }
  await page.getByRole('heading', { name: 'Игроки (6)', exact: true }).waitFor()
  const baggage = page.locator('label.check').filter({ hasText: 'Доп. багаж' }).locator('input')
  await baggage.uncheck()
  await pages[1].locator('.char-count').filter({ hasText: '7' }).waitFor()
  assert.equal(await pages[1].locator('.settings-panel input:not(:disabled), .settings-panel select:not(:disabled)').count(), 0)
  await baggage.check()
  // A long timer makes screenshots and UI tests independent of rendering speed.
  await page.locator('label.field').filter({ hasText: 'Время хода, сек' }).locator('input').fill('300')
  await page.locator('label.field').filter({ hasText: 'Время хода, сек' }).locator('input').press('Tab')
  checks.push('Six players join; host settings sync; guest settings stay read-only')
  for (const theme of ['dark', 'light']) {
    await mode(page, theme)
    await fits(page, 'Lobby ' + theme)
    await page.evaluate(() => scrollTo(0, 0))
    await shot(page, 'lobby-' + theme)
  }
  await page.getByRole('button', { name: 'Начать игру', exact: true }).click()
  await page.getByRole('button', { name: 'Начать раунды', exact: true }).click()
  // Reveal one real characteristic per participant, retaining all six players.
  for (let turn = 0; turn < 6; turn++) {
    let active
    for (const p of pages) if (await p.locator('.player-card.self.current').count()) { active = p; break }
    assert(active)
    const row = active.locator('.player-card.self .char-row.clickable').first()
    await row.click()
    if (turn === 0) {
      await active.getByRole('button', { name: 'Отменить', exact: true }).click()
      assert.equal(await active.locator('.char-confirm').count(), 0)
      await row.click()
    }
    await active.getByRole('button', { name: 'Подтвердить', exact: true }).click()
    await active.getByRole('button', { name: 'Завершить ход', exact: true }).click()
    await active.locator('.player-card.self.current').waitFor({ state: 'detached' })
  }
  await page.getByRole('button', { name: 'Пауза', exact: true }).click()
  checks.push('Six real reveals, confirmation/cancel, turn advance and pause work')
  assert.equal(await page.locator('.player-card').count(), 6)
  for (const theme of ['dark', 'light']) {
    await mode(page, theme)
    await fits(page, 'Game ' + theme)
    await page.evaluate(() => scrollTo(0, 0))
    await shot(page, 'game-' + theme)
    await page.setViewportSize({ width: 390, height: 844 })
    await page.evaluate(() => scrollTo(0, 0))
    await page.screenshot({ path: join(__dirname, 'mobile-' + theme + '.png') })
  }
  await page.reload()
  await page.locator('.player-card').first().waitFor()
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'light')
  assert.equal(await page.locator('.player-card').count(), 6)
  await mode(page, 'system')
  await page.emulateMedia({ colorScheme: 'light' })
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'light')
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark')
  checks.push('Theme persists on reload; reconnect preserves players; system mode tracks OS')
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ checks, errors }, null, 2))
  writeFileSync(join(__dirname, 'verification.json'), JSON.stringify({ checks, errors }, null, 2) + '\n')
}
async function cleanup() {
  if (browser) await browser.close().catch(() => {})
  if (server && server.exitCode === null) {
    const stopped = once(server, 'exit')
    server.kill()
    await stopped
  }
  console.log('Temporary browser and server stopped.')
}
main().catch(e => { console.error(e); process.exitCode = 1 }).finally(cleanup)
