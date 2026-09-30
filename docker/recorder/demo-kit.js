// demo-kit: what every generated demo script has in common, so the scripts
// only have to say what happens in the demo. Installed in the recorder image as
// the `demo-kit` package; its API reference (demo-kit.md) is given to Claude
// with the stage 2 prompt.
//
//   import { record } from 'demo-kit'
//   await record(async (demo) => {
//     await demo.scene('Creating a report')
//     await demo.goto(APP_URL)
//     await demo.say('Reports are created from the dashboard.')
//     await demo.click('::-p-text(New report)')
//   })
import { setTimeout as sleep } from 'node:timers/promises'

export const OUTPUT_VIDEO = '/output/demo.webm'
const FAILURE_SCREENSHOT = '/output/failure.png'
const OVERLAY_KEY = '__demoKit'

// Thrown by startRecording() in a check-only run (the app's "Check
// preconditions", which sets DEMO_CHECK_ONLY=1): everything before the
// recording starts is the script's precondition checks, and they passed.
// A script that leaves recording to start at its first page load doesn't
// check anything first, so that only shows the app answers.
class ChecksPassed extends Error {
  constructor(autoStart) {
    super(
      autoStart
        ? "The first page loaded. This is a check-only run, and the script doesn't check its preconditions first (it doesn't pass autoStart: false to record()), so that is all it checked."
        : 'The preconditions are met. This is a check-only run, so it stops here, where the recording would start.'
    )
  }
}

// How long a viewer needs to read `text`: a second per four words, and at
// least two seconds.
export function readingTime(text) {
  const words = String(text ?? '').trim().split(/\s+/).filter(Boolean).length
  return Math.max(2000, words * 250)
}

// Where `box` is drawn when zoomed in `scale` times: around its own middle,
// but scaled down to fit the viewport with a `margin` and moved back inside
// it. Never smaller than the box itself.
export function zoomedBox(box, viewport, scale, margin = 40) {
  const k = Math.max(1, Math.min(scale, (viewport.width - 2 * margin) / box.width, (viewport.height - 2 * margin) / box.height))
  if (k === 1) return { ...box }
  const width = box.width * k
  const height = box.height * k
  const place = (start, size, zoomed, max) => Math.min(Math.max(start + size / 2 - zoomed / 2, margin), max - margin - zoomed)
  return { x: place(box.x, box.width, width, viewport.width), y: place(box.y, box.height, height, viewport.height), width, height }
}

// Launches the browser, runs `script(demo)` and saves the screencast to
// /output/demo.webm. Recording starts when the first demo.goto() has loaded,
// or at demo.startRecording(). A failing script is logged, screenshotted and
// makes the process exit non-zero, but the recording is still saved. With
// DEMO_CHECK_ONLY=1 the run ends, successfully, where the recording would start.
export async function record(script, options = {}) {
  const { viewport = { width: 1920, height: 1080 }, launch = {}, ...demoOptions } = options
  const startedAt = Date.now()
  const log = (message) => console.log(stamp(startedAt, message))
  log(`Launching Chrome at ${viewport.width}×${viewport.height}…`)
  const { default: puppeteer } = await import('puppeteer')
  const browser = await puppeteer.launch({
    headless: true,
    acceptInsecureCerts: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
    defaultViewport: viewport,
    ...launch
  })
  log(`Started ${await browser.version().catch(() => 'Chrome')}.`)
  let demo
  try {
    const [page = await browser.newPage()] = await browser.pages()
    demo = new Demo(browser, page, { ...demoOptions, checkOnly: process.env.DEMO_CHECK_ONLY === '1', startedAt })
    await demo.setup()
    try {
      await script(demo)
      if (!demo.recording) console.warn(stamp(startedAt, 'demo-kit: the script never loaded a page with demo.goto() or called demo.startRecording(), so nothing was recorded.'))
      log(`The script finished after ${demo.sceneCount} ${demo.sceneCount === 1 ? 'scene' : 'scenes'}.`)
      await demo.pause(1500)
    } catch (err) {
      if (err instanceof ChecksPassed) {
        log(err.message)
        return
      }
      process.exitCode = 1
      console.error(stamp(startedAt, `Demo failed${demo.step ? ` during: ${demo.step}` : ''}`))
      console.error(`${err?.stack || err}`)
      await page.screenshot({ path: FAILURE_SCREENSHOT }).then(
        () => console.error(`The page at the time (${page.url()}) is in ${FAILURE_SCREENSHOT.split('/').pop()}.`),
        () => {}
      )
      await demo.pause(1500)
    }
  } finally {
    await demo?.stopRecording().catch((err) => console.error(stamp(startedAt, `Could not save the recording: ${err.message}`)))
    await browser.close().catch(() => {})
    log(`Done in ${seconds(Date.now() - startedAt)}.`)
  }
}

// The handle a script drives the demo with. Targets are a Puppeteer selector
// (CSS, or `::-p-text(...)`, `::-p-aria(...)`, ...) or an ElementHandle.
export class Demo {
  constructor(browser, page, { autoStart = true, pace = 1, actionPause = 600, output = OUTPUT_VIDEO, checkOnly = false, startedAt = Date.now() } = {}) {
    this.browser = browser
    this.page = page
    this.recording = false
    this.options = { autoStart, pace, actionPause, output, checkOnly }
    this.state = { title: '', subtitle: '', cursor: null, css: '' }
    this.recorder = null
    this.recordingStartedAt = 0
    this.initScript = null
    this.sceneCount = 0
    this.startedAt = startedAt
    // The action running now, named in the log if the script fails.
    this.step = ''
    // Every alert(), confirm() and prompt() the page has shown: { type, message, host }.
    this.dialogs = []
    // Cookies saved with saveSession(), by name.
    this.sessions = {}
    // The element zoomed in on: where it is and where it's drawn.
    this.zoomed = null
    // The last page logged.
    this.pageUrl = ''
    this.marks = 0
    this.cdpSession = null
  }

  // Logs `message` with the time since the run started, like every line
  // demo-kit logs.
  log(message) {
    console.log(stamp(this.startedAt, message))
  }

  // Makes the overlay part of every page from now on, and lets the demo work on
  // pages whose Content Security Policy would block its styles.
  async setup() {
    await this.page.setBypassCSP(true)
    // A navigation the script didn't start (a form submit, a redirect) gets
    // the current state as soon as the page has loaded.
    this.page.on('domcontentloaded', () => {
      // The new page's overlay starts without the zoom.
      this.zoomed = null
      this.render().catch(() => {})
    })
    // What the page does is worth seeing in the log too: where it ends up,
    // and whatever goes wrong in it. history.replaceState() and pushState()
    // count as navigations too, and pages like WP admin call them on load with
    // the URL they're already at, so only a different URL is logged.
    this.page.on('framenavigated', (frame) => {
      if (frame !== this.page.mainFrame() || frame.url() === this.pageUrl) return
      this.pageUrl = frame.url()
      if (this.pageUrl !== 'about:blank') this.log(`    page: ${this.pageUrl}`)
    })
    // A dialog left open blocks the page, and the recording can't show it
    // anyway (showDialog() draws it). Accepted, unless the script listens for
    // dialogs itself.
    this.page.on('dialog', (dialog) => {
      const entry = { type: dialog.type(), message: dialog.message(), host: hostOf(this.page.url()) }
      this.dialogs.push(entry)
      this.log(`    page ${entry.type}: ${entry.message}`)
      if (this.page.listenerCount('dialog') === 1) dialog.accept().catch(() => {})
    })
    this.page.on('response', (response) => {
      if (response.status() >= 400 && response.request().isNavigationRequest()) {
        this.log(`    HTTP ${response.status()} for ${response.url()}`)
      }
    })
    this.page.on('requestfailed', (request) => {
      if (request.isNavigationRequest()) this.log(`    request failed: ${request.url()} (${request.failure()?.errorText || 'unknown error'})`)
    })
    this.page.on('pageerror', (err) => this.log(`    page error: ${err?.message || err}`))
    this.page.on('console', (message) => {
      if (message.type() !== 'error') return
      // Chrome's own message for a failed load doesn't say what failed to load.
      // A page that failed is already logged, and a missing favicon is noise.
      const url = message.location()?.url || ''
      const failedLoad = message.text().startsWith('Failed to load resource')
      if (failedLoad && (url === this.page.url() || /\/favicon\.ico(\?|$)/.test(url))) return
      this.log(`    page console: ${message.text()}${failedLoad && url ? ` (${url})` : ''}`)
    })
    await this.update({})
  }

  async startRecording() {
    if (this.recording) return
    if (this.options.checkOnly) throw new ChecksPassed(this.options.autoStart)
    this.recorder = await this.page.screencast({ path: this.options.output })
    this.recording = true
    this.recordingStartedAt = Date.now()
    this.log(`Recording to ${this.options.output}.`)
  }

  async stopRecording() {
    if (!this.recorder) return
    const recorder = this.recorder
    this.recorder = null
    this.log(`Saving the recording (${seconds(Date.now() - this.recordingStartedAt)} long)…`)
    await recorder.stop()
    this.log(`Saved ${this.options.output}.`)
  }

  // --- overlay -------------------------------------------------------------

  // Starts a scene: shows its title, clears the subtitle and logs it.
  async scene(title) {
    this.sceneCount++
    this.log(`Scene ${this.sceneCount}: ${title}`)
    await this.update({ title: title || '', subtitle: '' })
  }

  // Sets the title overlay; '' or null hides it.
  async title(text) {
    await this.update({ title: text || '' })
  }

  // Sets the subtitle without waiting; '' or null hides it.
  async subtitle(text) {
    await this.update({ subtitle: text || '' })
  }

  // Shows a subtitle and waits long enough for it to be read (at least `min`
  // milliseconds). The subtitle stays until the next one or the next scene.
  async say(text, { min = 0 } = {}) {
    this.action(`say "${text}"`)
    await this.subtitle(text)
    await this.pause(Math.max(min, readingTime(text)))
  }

  // Waits `ms` milliseconds, scaled by the `pace` option.
  async pause(ms) {
    await sleep(Math.round(ms * this.options.pace))
  }

  // Draws a ring around the target for `ms` milliseconds, without waiting.
  async highlight(target, { ms = 1500 } = {}) {
    this.action(`highlight ${describe(target)}`)
    await this.ring(await this.find(target), ms)
  }

  // --- actions -------------------------------------------------------------

  async goto(url, { waitUntil = 'load', timeout = 60000 } = {}) {
    this.action(`go to ${url}`)
    const started = Date.now()
    const response = await this.page.goto(url, { waitUntil, timeout })
    const title = await this.page.title().catch(() => '')
    this.log(`    loaded in ${seconds(Date.now() - started)}${response ? `, HTTP ${response.status()}` : ''}${title ? `: "${title}"` : ''}`)
    await this.render().catch(() => {})
    if (this.options.autoStart) await this.startRecording()
    await this.pause(this.options.actionPause)
  }

  // The target once it is on the page (and visible, unless `visible: false`),
  // scrolled into view. With `text`, the first match whose text contains it.
  async find(target, { visible = true, timeout = 30000, text } = {}) {
    if (typeof target !== 'string') return target
    const what = text === undefined ? describe(target) : `${describe(target)} containing "${text}"`
    // A step that is stuck says so, rather than the log going quiet until the
    // timeout.
    const started = Date.now()
    const waiting = setInterval(() => {
      this.log(`    still waiting for ${what}${visible ? ' to be visible' : ''} (${seconds(Date.now() - started)} of ${seconds(timeout)})…`)
    }, 5000)
    const found = text === undefined
      ? this.page.waitForSelector(target, { visible, timeout })
      : this.findWithText(target, text, { visible, timeout })
    const el = await found.finally(() => clearInterval(waiting))
    if (!el) throw new Error(`Could not find ${what}.`)
    if (visible && !(await el.isIntersectingViewport({ threshold: 1 }))) {
      // One taller than the screen is never all on it: it scrolls to its top
      // instead, unless that is already in the upper half or it fills the screen.
      const scrolled = await el.evaluate((node) => {
        const box = node.getBoundingClientRect()
        const tall = box.height > innerHeight
        if (tall && ((box.top >= 0 && box.top <= innerHeight / 2) || (box.top < 0 && box.bottom > innerHeight))) return false
        node.scrollIntoView({ block: tall ? 'start' : 'center', behavior: 'smooth' })
        return true
      })
      if (scrolled) await sleep(600)
    }
    return el
  }

  // Waits for the target to appear, without interacting with it.
  async waitFor(target, options) {
    return this.find(target, options)
  }

  // Moves the visible cursor to the target and clicks it. With `navigation`,
  // waits for the page the click leads to.
  async click(target, { navigation = false, highlight = false, timeout = 60000 } = {}) {
    this.action(`click ${describe(target)}${navigation ? ' and wait for the next page' : ''}`)
    const el = await this.find(target)
    await this.uncovered(el, target)
    await this.moveTo(el)
    if (highlight) {
      await this.ring(el, 1500)
      await this.pause(700)
    }
    await this.evaluateOverlay((key) => window[key]?.pulse())
    if (navigation) {
      const started = Date.now()
      await Promise.all([this.page.waitForNavigation({ waitUntil: 'load', timeout }), el.click()])
      this.log(`    loaded in ${seconds(Date.now() - started)}: "${await this.page.title().catch(() => '')}"`)
    } else await el.click()
    await this.pause(this.options.actionPause)
  }

  // Clicks into the target and types `text` at a visible speed, replacing
  // what is there unless `clear` is false. `enter` presses Enter afterwards.
  async type(target, text, { delay = 70, clear = true, enter = false } = {}) {
    // Only the length: what's typed is often a password.
    const length = String(text).length
    this.action(`type ${length} ${length === 1 ? 'character' : 'characters'} into ${describe(target)}${enter ? ', then Enter' : ''}`)
    const el = await this.find(target)
    await this.uncovered(el, target)
    await this.moveTo(el)
    await el.click()
    if (clear && (await el.evaluate((node) => ('value' in node ? node.value : node.textContent) !== ''))) {
      await this.page.keyboard.down('Control')
      await this.page.keyboard.press('KeyA')
      await this.page.keyboard.up('Control')
      await this.page.keyboard.press('Backspace')
    }
    await el.type(String(text), { delay: Math.round(delay * this.options.pace) })
    if (enter) await this.page.keyboard.press('Enter')
    await this.pause(this.options.actionPause)
  }

  // Presses a key (Puppeteer key name, e.g. 'Enter', 'Escape', 'Tab').
  async press(key) {
    this.action(`press ${key}`)
    await this.page.keyboard.press(key)
    await this.pause(this.options.actionPause)
  }

  // Picks options of a <select> by value. The browser draws a select's list
  // outside the page, where the recording can't see it, so for a single value
  // a drawn list opens and the cursor picks the option from it.
  async select(target, ...values) {
    this.action(`select ${values.map((v) => `"${v}"`).join(', ')} in ${describe(target)}`)
    const el = await this.find(target)
    await this.uncovered(el, target)
    await this.moveTo(el)
    const option = values.length === 1 ? await this.drawOptions(el, values[0]) : null
    if (option) {
      await this.pause(500)
      await this.moveToPoint(middle(option))
      await this.evaluateOverlay((key) => window[key]?.pulse())
      await this.pause(300)
    }
    await el.select(...values)
    if (option) await this.evaluateOverlay((key) => window[key]?.options(null))
    await this.pause(this.options.actionPause)
  }

  // Draws the <select>'s list of options open beneath it, e.g. to show what
  // is on offer without choosing, with the option whose value is `mark`
  // picked out. Stays until hideOptions() or the next page. Returns the
  // options as { value, text }.
  async showOptions(target, { mark } = {}) {
    this.action(`show the options of ${describe(target)}`)
    const el = await this.find(target)
    await this.moveTo(el)
    await this.drawOptions(el, mark)
    await this.pause(this.options.actionPause)
    return el.evaluate((select) => [...select.options].map((o) => ({ value: o.value, text: o.text })))
  }

  async hideOptions() {
    await this.evaluateOverlay((key) => window[key]?.options(null))
    await this.pause(400)
  }

  // Ticks the checkbox (or unticks it, with `checked` false), clicking it
  // only if it isn't that way already; if it is, it's highlighted instead.
  async check(target, checked = true) {
    this.action(`${checked ? 'tick' : 'untick'} ${describe(target)}`)
    const el = await this.find(target)
    await this.moveTo(el)
    if ((await el.evaluate((box) => box.checked)) === checked) {
      await this.ring(el, 1000)
      await this.pause(800)
      return
    }
    await this.uncovered(el, target)
    await this.evaluateOverlay((key) => window[key]?.pulse())
    await el.click()
    await this.pause(this.options.actionPause)
  }

  // Selects the line of a <textarea> that contains `text` and scrolls to it,
  // or the text itself in any other element, then highlights the element
  // while it's read. Returns whether the text was found.
  async selectText(target, text) {
    this.action(`select "${text}" in ${describe(target)}`)
    const el = await this.find(target)
    const found = await el.evaluate((node, text) => {
      if (typeof node.setSelectionRange === 'function' && typeof node.value === 'string') {
        const value = node.value
        const at = value.indexOf(text)
        if (at < 0) return false
        let start = at
        let end = at + text.length
        if (node.tagName === 'TEXTAREA') {
          start = value.lastIndexOf('\n', at) + 1
          end = value.indexOf('\n', at)
          if (end < 0) end = value.length
        }
        node.focus()
        node.setSelectionRange(start, end)
        const lineHeight = parseFloat(getComputedStyle(node).lineHeight) || 18
        const line = value.slice(0, start).split('\n').length - 1
        node.scrollTop = Math.max(0, line * lineHeight - node.clientHeight / 2)
        return true
      }
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT)
      for (let t; (t = walker.nextNode());) {
        const at = t.data.indexOf(text)
        if (at < 0) continue
        const range = document.createRange()
        range.setStart(t, at)
        range.setEnd(t, at + text.length)
        getSelection().removeAllRanges()
        getSelection().addRange(range)
        return true
      }
      return false
    }, text)
    if (!found) this.log(`    "${text}" is not in ${describe(target)}`)
    await this.ring(el, 2500)
    await this.pause(2500)
    return found
  }

  // Wraps the first occurrence of `text` in the target (through the end of
  // `through`, if that follows it in the same text) in a yellow <mark>, and
  // returns a selector for it to highlight or zoom in on; null if the text
  // isn't there.
  async markText(target, text, { through } = {}) {
    this.action(`mark "${text}"${through ? ` through "${through}"` : ''} in ${describe(target)}`)
    await this.find(target, { visible: false })
    const roots = typeof target === 'string' ? await this.page.$$(target) : [target]
    const id = `demo-kit-mark-${++this.marks}`
    for (const root of roots) {
      const marked = await root.evaluate((root, text, through, id) => {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
        for (let node; (node = walker.nextNode());) {
          const at = node.data.indexOf(text)
          if (at < 0) continue
          let end = at + text.length
          if (through) {
            const k = node.data.indexOf(through, at)
            end = k < 0 ? node.data.length : k + through.length
          }
          const range = document.createRange()
          range.setStart(node, at)
          range.setEnd(node, end)
          const mark = document.createElement('mark')
          mark.id = id
          mark.style.cssText = 'background: #fff3a0; color: inherit; padding: 0 2px; border-radius: 2px;'
          range.surroundContents(mark)
          return true
        }
        return false
      }, text, through ?? null, id)
      if (marked) return `#${id}`
    }
    this.log(`    "${text}" is not in ${describe(target)}`)
    return null
  }

  // Scrolls the target to the middle of the screen and draws it larger on
  // top of everything else, until zoomOut() or the next page. Highlights of
  // what's inside it are drawn on the zoomed copy.
  async zoomIn(target, { scale = 1.35 } = {}) {
    this.action(`zoom in on ${describe(target)}`)
    if (this.zoomed) await this.evaluateOverlay((key) => window[key]?.zoom(null))
    const el = await this.find(target)
    await el.evaluate((node) => node.scrollIntoView({ block: 'center', behavior: 'smooth' }))
    await sleep(600)
    // A copy rather than the element scaled in place: an element can't be
    // raised above anything outside its stacking context (a fixed sidebar,
    // say), and its ancestors may clip it.
    const viewport = await this.page.evaluate(() => ({ width: innerWidth, height: innerHeight, scrollX, scrollY }))
    const box = await el.boundingBox()
    const from = box && intersection(box, { x: 0, y: 0, width: viewport.width, height: viewport.height })
    if (!from) throw new Error(`Nothing to zoom in on: ${describe(target)} is not visible.`)
    // The overlay's own cursor, ring and captions are left out of the copy.
    await this.evaluateOverlay((key, box) => window[key]?.capture(box), from)
    const image = await this.page
      .screenshot({ clip: { x: from.x + viewport.scrollX, y: from.y + viewport.scrollY, width: from.width, height: from.height, scale: 2 }, captureBeyondViewport: false, encoding: 'base64' })
      .finally(() => this.evaluateOverlay((key) => window[key]?.capture(null)))
    const to = zoomedBox(from, viewport, scale)
    await this.evaluateOverlay((key, src, from, to) => window[key]?.zoom(src, from, to), `data:image/png;base64,${image}`, from, to)
    this.zoomed = { from, to }
    await this.pause(1200)
  }

  async zoomOut() {
    if (!this.zoomed) return
    this.action('zoom out')
    this.zoomed = null
    await this.evaluateOverlay((key) => window[key]?.zoom(null))
    await this.pause(700)
  }

  // Draws the browser dialog the page opened (the last one, or the one given)
  // as the browser showed it, which the recording can't, and clicks it away.
  // `dialog` may also be a message of your own.
  async showDialog(dialog = this.dialogs.at(-1)) {
    if (!dialog) throw new Error('The page has not opened a dialog.')
    const { type = 'alert', message, host = hostOf(this.page.url()) } = typeof dialog === 'string' ? { message: dialog } : dialog
    this.action(`show the ${type} "${message}"`)
    const button = await this.page.evaluate((key, type, host, message) => window[key]?.dialog(type, host, message), OVERLAY_KEY, type, host, message)
    await this.pause(readingTime(message))
    if (button) {
      await this.moveToPoint(middle(button))
      await this.evaluateOverlay((key) => window[key]?.pulse())
      await this.pause(300)
    }
    await this.evaluateOverlay((key) => window[key]?.dialog(null))
    await this.pause(this.options.actionPause)
  }

  // Shows the page's HTML source over the page, as view-source would, scrolled
  // to the first line containing `text` (or the first of several, in order of
  // preference), which is highlighted. Stays until hideSource() or the next
  // page. The source is fetched again, so it's what a GET of the page returns.
  async showSource(text = []) {
    const needles = [].concat(text)
    this.action(`show the page source${needles.length ? ` at ${needles.map((n) => `"${n}"`).join(' or ')}` : ''}`)
    const url = this.page.url()
    const html = await this.page.evaluate(async () => (await fetch(location.href, { credentials: 'include' })).text())
    const lines = html.split('\n')
    // Where the text is within its line too: a line can wrap over many
    // screens (inline JSON, minified CSS), so scrolling to the line isn't enough.
    let hit = null
    for (const needle of needles) {
      const line = lines.findIndex((text) => text.includes(needle))
      if (line >= 0) {
        hit = { line, start: lines[line].indexOf(needle), length: needle.length }
        break
      }
    }
    if (needles.length) this.log(hit ? `    found on line ${hit.line + 1}` : `    none of ${needles.map((n) => `"${n}"`).join(', ')} is in the source`)
    await this.evaluateOverlay((key, url, lines, hit, ms) => window[key]?.source(url, lines, hit, ms), url, lines, hit, Math.round(3000 * this.options.pace))
    await this.pause(hit >= 0 ? 3000 : 2000)
  }

  async hideSource() {
    await this.evaluateOverlay((key) => window[key]?.source(null))
  }

  // Draws a DevTools console at the bottom of the page and types `code` into
  // it, e.g. before running that code with demo.page.evaluate(). Only drawn:
  // nothing is run. Stays until hideConsole() or the next page.
  async showConsole(code) {
    this.action(`show ${String(code).split('\n').length} line(s) typed into the console`)
    await this.page.evaluate((key, code, ms) => window[key]?.console(code, ms), OVERLAY_KEY, String(code), Math.round(12 * this.options.pace)).catch(() => {})
    await this.pause(this.options.actionPause)
  }

  async hideConsole() {
    await this.evaluateOverlay((key) => window[key]?.console(null))
  }

  // Shows `text` as a label in the top right corner of every page, e.g. which
  // user is signed in; '' hides it.
  async badge(text) {
    await this.update({ badge: text || '' })
  }

  // Adds `css` to every page from now on, e.g. to hide a notice that has
  // nothing to do with the demo. It comes after the page's own styles, so a
  // rule as specific as the page's wins.
  async addStyle(css) {
    this.action('add a style')
    await this.update({ css: `${this.state.css}${css}\n` })
  }

  // Removes every style addStyle() added.
  async clearStyles() {
    this.action('clear the added styles')
    await this.update({ css: '' })
  }

  // Keeps the browser's cookies (who is signed in) under `name`, for
  // useSession(). Signing each user in off camera and switching between them
  // shows several users in one recording.
  async saveSession(name) {
    const cdp = await this.cdp()
    const { cookies } = await cdp.send('Network.getAllCookies')
    this.sessions[name] = cookies.map(({ name, value, domain, path, secure, httpOnly, sameSite, expires, session }) => ({
      name, value, domain, path, secure, httpOnly,
      ...(sameSite ? { sameSite } : {}),
      ...(session || expires < 0 ? {} : { expires })
    }))
    this.log(`  saved the session "${name}" (${cookies.length} ${cookies.length === 1 ? 'cookie' : 'cookies'})`)
  }

  // Replaces the browser's cookies with those saved as `name`; null clears
  // them, signing everyone out. Takes effect on the next page load.
  async useSession(name) {
    this.action(name == null ? 'clear the cookies' : `use the session "${name}"`)
    if (name != null && !this.sessions[name]) throw new Error(`No session was saved as "${name}".`)
    // Leave the page first: requests it still has in flight could set the old
    // cookies again (Matomo refreshes its session cookie on every request).
    await this.page.goto('about:blank')
    const cdp = await this.cdp()
    await cdp.send('Network.clearBrowserCookies')
    if (name != null && this.sessions[name].length) await cdp.send('Network.setCookies', { cookies: this.sessions[name] })
  }

  // Sets the files of an <input type="file">, which is often hidden, so it
  // doesn't have to be visible.
  async upload(target, ...files) {
    this.action(`upload ${files.join(', ')} to ${describe(target)}`)
    const el = await this.find(target, { visible: false })
    await el.uploadFile(...files)
    await this.pause(this.options.actionPause)
  }

  // --- internals -----------------------------------------------------------

  // Draws the highlight ring around the element for `ms` milliseconds.
  async ring(el, ms) {
    let box = await el.boundingBox()
    if (!box) throw new Error('Nothing to highlight: the element is not visible.')
    // Inside a zoomed element, the ring goes around its zoomed copy.
    const zoom = this.zoomed
    const { x, y } = middle(box)
    if (zoom && x >= zoom.from.x && x <= zoom.from.x + zoom.from.width && y >= zoom.from.y && y <= zoom.from.y + zoom.from.height) {
      const k = zoom.to.width / zoom.from.width
      box = { x: zoom.to.x + (box.x - zoom.from.x) * k, y: zoom.to.y + (box.y - zoom.from.y) * k, width: box.width * k, height: box.height * k }
    }
    await this.evaluateOverlay((key, box, ms) => window[key]?.highlight(box, ms), box, Math.round(ms * this.options.pace))
  }

  // Draws the <select>'s options open beneath it, the one whose value is
  // `mark` picked out, and returns where that one is drawn (null if none).
  // Not for a list box (`multiple` or `size`), which the page shows itself.
  async drawOptions(el, mark) {
    const list = await el.evaluate((select) => ({
      box: select.getBoundingClientRect().toJSON(),
      listBox: select.multiple || select.size > 1,
      options: [...select.options].map((o) => ({ value: o.value, text: o.text, selected: o.selected, disabled: o.disabled }))
    }))
    if (list.listBox) return null
    return this.page.evaluate((key, box, options, mark) => window[key]?.options(box, options, mark), OVERLAY_KEY, list.box, list.options, mark ?? null).catch(() => null)
  }

  // Waits until a click on the element would reach it, rather than whatever
  // is on top of it (a dialog, a loading overlay, a sticky header), which
  // would take the click or the typing instead and leave the script to fail
  // later with no sign why. Fails after `timeout`, naming what is in the way.
  async uncovered(el, target, { timeout = 10000 } = {}) {
    const started = Date.now()
    let logged = started
    let scrolled = false
    for (;;) {
      const cover = await el.evaluate(coverOf)
      if (!cover) return
      // What is fixed to the top or bottom of the screen, such as a sticky
      // header, is out of the way of the middle.
      if (!scrolled) {
        scrolled = true
        await el.evaluate((node) => node.scrollIntoView({ block: 'center', behavior: 'smooth' }))
        await sleep(600)
        continue
      }
      if (Date.now() - started > timeout) {
        throw new Error(`Could not reach ${describe(target)}: ${cover}, so a click would go there instead.`)
      }
      if (Date.now() - logged >= 5000) {
        logged = Date.now()
        this.log(`    still waiting for ${describe(target)} to be uncovered: ${cover} (${seconds(Date.now() - started)} of ${seconds(timeout)})…`)
      }
      await sleep(250)
    }
  }

  // Polls for the first element matching `selector` whose text contains `text`.
  async findWithText(selector, text, { visible, timeout }) {
    const deadline = Date.now() + timeout
    for (;;) {
      for (const el of await this.page.$$(selector)) {
        if ((await el.evaluate((node, text) => node.textContent.includes(text), text).catch(() => false)) && (!visible || (await el.isVisible()))) return el
        await el.dispose()
      }
      if (Date.now() > deadline) throw new Error(`Could not find ${describe(selector)} containing "${text}" within ${seconds(timeout)}.`)
      await sleep(250)
    }
  }

  async cdp() {
    this.cdpSession ??= await this.page.createCDPSession()
    return this.cdpSession
  }

  // Logs the action that is starting and remembers it for the failure message.
  action(description) {
    this.step = description
    this.log(`  ${description}`)
  }

  // Glides the drawn cursor (headless screencasts show no mouse pointer) and
  // the real mouse, for hover effects, to the middle of the element.
  async moveTo(el) {
    const box = await el.boundingBox()
    if (box) await this.moveToPoint(middle(box))
  }

  async moveToPoint(point) {
    const cursor = { x: Math.round(point.x), y: Math.round(point.y) }
    await this.update({ cursor })
    await this.page.mouse.move(cursor.x, cursor.y, { steps: 10 })
    await sleep(Math.round(500 * this.options.pace))
  }

  // Changes the overlay state: re-registers the script that draws it on each
  // new document, so the next page starts out with it, and redraws this one.
  async update(patch) {
    this.state = { ...this.state, ...patch }
    const previous = this.initScript
    this.initScript = await this.page.evaluateOnNewDocument(overlay, OVERLAY_KEY, this.state)
    if (previous) await this.page.removeScriptToEvaluateOnNewDocument(previous.identifier).catch(() => {})
    await this.render().catch(() => {})
  }

  // Draws the current state on the current page, installing the overlay if
  // the page doesn't have it (it loaded before setup, say).
  async render() {
    await this.page.evaluate(overlay, OVERLAY_KEY, this.state)
  }

  // Runs `fn(key, ...args)` in the page; a page that is navigating away is
  // not an error, the next one gets the state anyway.
  async evaluateOverlay(fn, ...args) {
    await this.page.evaluate(fn, OVERLAY_KEY, ...args).catch(() => {})
  }
}

// Runs in the page: null if a click on `node` (at the middle of its part on
// the screen, where Puppeteer clicks) reaches it, or else what is in the way.
function coverOf(node) {
  const name = (el) => {
    let text = el.tagName.toLowerCase()
    if (el.id) text += `#${el.id}`
    for (const c of [...el.classList].slice(0, 3)) text += `.${c}`
    const words = (el.innerText || '').trim().replace(/\s+/g, ' ')
    return words ? `${text} ("${words.length > 40 ? `${words.slice(0, 40)}…` : words}")` : text
  }
  const box = node.getBoundingClientRect()
  const left = Math.max(box.left, 0)
  const top = Math.max(box.top, 0)
  const right = Math.min(box.right, innerWidth)
  const bottom = Math.min(box.bottom, innerHeight)
  if (right <= left || bottom <= top) return 'it is not on the screen'
  const x = (left + right) / 2
  const y = (top + bottom) / 2
  // Into shadow roots, whose hosts stand in for what is inside them.
  let hit = document.elementFromPoint(x, y)
  while (hit?.shadowRoot) {
    const inner = hit.shadowRoot.elementFromPoint(x, y)
    if (!inner || inner === hit) break
    hit = inner
  }
  if (!hit) return 'nothing is at its middle'
  if (hit === node || node.contains(hit)) return null
  // A label clicks its control, as custom-styled checkboxes rely on.
  if (hit.closest('label')?.control === node) return null
  // An element that ignores the mouse is clicked through to what is under it.
  if (getComputedStyle(node).pointerEvents === 'none' && hit.contains(node)) return null
  return `it is covered by ${name(hit)}`
}

function describe(target) {
  return typeof target === 'string' ? `"${target}"` : 'the element'
}

function middle(box) {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

// The part of `box` inside `bounds`, or null if none is.
function intersection(box, bounds) {
  const x = Math.max(box.x, bounds.x)
  const y = Math.max(box.y, bounds.y)
  const width = Math.min(box.x + box.width, bounds.x + bounds.width) - x
  const height = Math.min(box.y + box.height, bounds.y + bounds.height) - y
  return width > 0 && height > 0 ? { x, y, width, height } : null
}

function hostOf(url) {
  try {
    return new URL(url).host
  } catch {
    return ''
  }
}

// `message` prefixed with the time since `startedAt`, e.g. "[  12.3s] Scene 2: Signing in".
function stamp(startedAt, message) {
  return `[${seconds(Date.now() - startedAt).padStart(7)}] ${message}`
}

function seconds(ms) {
  return `${(ms / 1000).toFixed(1)}s`
}

// Runs in the page, at the start of every document and again with each state
// change. Draws the title, subtitle, cursor and highlight ring in a shadow root
// on <html>, out of reach of the page's CSS, and puts it back whenever the page
// removes it (frameworks that re-render <body> would otherwise wipe it).
function overlay(key, state) {
  if (window !== window.top) return
  if (window[key]) {
    window[key].set(state)
    return
  }

  const host = document.createElement('demo-kit-overlay')
  host.style.cssText = 'all: initial; position: fixed; inset: 0; z-index: 2147483647; pointer-events: none;'
  const shadow = host.attachShadow({ mode: 'open' })
  const style = document.createElement('style')
  style.textContent = `
    * { box-sizing: border-box; font-family: 'Liberation Sans', Arial, sans-serif; }
    .title, .subtitle { position: fixed; left: 50%; transform: translateX(-50%); max-width: 80%; text-align: center;
      color: #fff; transition: opacity 0.3s; }
    .title { top: 32px; padding: 14px 30px; border-radius: 12px; background: rgba(17, 24, 39, 0.72);
      font-size: 30px; font-weight: 700; box-shadow: 0 6px 24px rgba(0, 0, 0, 0.25); }
    .subtitle { bottom: 56px; max-width: 70%; padding: 12px 26px; border-radius: 10px; background: rgba(0, 0, 0, 0.78);
      font-size: 26px; line-height: 1.35; }
    .hidden { opacity: 0; }
    .ring { position: fixed; border: 4px solid #f59e0b; border-radius: 8px; box-shadow: 0 0 0 6px rgba(245, 158, 11, 0.35);
      transition: opacity 0.25s; }
    .cursor { position: fixed; left: 0; top: 0; width: 28px; height: 28px; transition: transform 0.5s ease-in-out;
      filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.5)); }
    .cursor.still { transition: none; }
    .pulse { position: fixed; width: 40px; height: 40px; margin: -20px 0 0 -20px; border-radius: 50%;
      background: rgba(245, 158, 11, 0.5); animation: pulse 0.5s ease-out forwards; }
    @keyframes pulse { from { transform: scale(0.3); opacity: 1; } to { transform: scale(1.6); opacity: 0; } }
    .badge { position: fixed; top: 44px; right: 16px; padding: 6px 14px; border-radius: 999px; background: rgba(29, 35, 39, 0.85);
      color: #fff; font-size: 14px; font-weight: 600; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3); transition: opacity 0.3s; }
    .capturing { visibility: hidden !important; }
    .zoom { position: fixed; transform-origin: 0 0; transition: transform 0.6s ease, box-shadow 0.6s ease; box-shadow: none; }
    .zoom.in { box-shadow: 0 12px 40px rgba(0, 0, 0, 0.35); }
    .options { position: fixed; padding: 4px 0; overflow: hidden; background: #fff; border: 1px solid #8c8f94; border-radius: 4px;
      box-shadow: 0 6px 18px rgba(0, 0, 0, 0.25); color: #1d2327; font-size: 14px; line-height: 1.4; }
    .options div { padding: 6px 14px; white-space: nowrap; }
    .options .selected { background: #f0f0f1; }
    .options .disabled { color: #a7aaad; }
    .options .mark { background: #2271b1; color: #fff; }
    .dialog { position: fixed; top: 120px; left: 50%; transform: translateX(-50%); width: 460px; padding: 20px 24px;
      background: #fff; border-radius: 8px; box-shadow: 0 8px 32px rgba(0, 0, 0, 0.35); color: #202124; font-size: 15px; line-height: 1.5; }
    .dialog .host { font-weight: 600; margin-bottom: 10px; }
    .dialog .message { white-space: pre-wrap; overflow-wrap: anywhere; }
    .dialog .buttons { display: flex; justify-content: flex-end; gap: 8px; margin-top: 18px; }
    .dialog button { padding: 8px 22px; border: 1px solid #dadce0; border-radius: 4px; background: #fff; color: #1a73e8; font-size: 14px; }
    .dialog button.ok { border-color: #1a73e8; background: #1a73e8; color: #fff; }
    .console { position: fixed; left: 0; right: 0; bottom: 150px; height: 300px; overflow: hidden; background: #202124; color: #e8eaed;
      border-top: 1px solid #5f6368; box-shadow: 0 -4px 16px rgba(0, 0, 0, 0.35); }
    .console .tabs { padding: 6px 14px; background: #292a2d; border-bottom: 1px solid #3c4043; color: #9aa0a6; font-size: 13px; word-spacing: 18px; }
    .console .tabs b { color: #8ab4f8; font-weight: normal; border-bottom: 2px solid #8ab4f8; padding-bottom: 4px; }
    pre, pre * { font-family: 'Liberation Mono', 'DejaVu Sans Mono', monospace; }
    .console pre { margin: 0; padding: 12px 16px; font-size: 14px; line-height: 1.5; white-space: pre-wrap; }
    .source { position: fixed; inset: 0; overflow: auto; background: #fff; color: #000; }
    .source .bar { position: sticky; top: 0; padding: 10px 16px; background: #f1f3f4; border-bottom: 1px solid #dadce0; color: #3c4043; font-size: 14px; }
    .source pre { margin: 0; padding: 8px 0; font-size: 13px; line-height: 1.5; white-space: pre-wrap; word-break: break-all; }
    .source .line { display: flex; }
    .source .line span:first-child { flex: none; width: 56px; padding-right: 14px; text-align: right; color: #999; }
    .source .hit { background: #fff3a0; }
    .source mark { background: #ffd54f; color: inherit; }
  `
  const make = (className) => {
    const el = document.createElement('div')
    el.className = className
    return el
  }
  const title = make('title hidden')
  const subtitle = make('subtitle hidden')
  const ring = make('ring hidden')
  const badge = make('badge hidden')
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('class', 'cursor still hidden')
  const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  arrow.setAttribute('d', 'M3 2 L3 20 L8 15.5 L11.5 23 L14.5 21.7 L11 14.3 L17.5 14.3 Z')
  arrow.setAttribute('fill', '#111')
  arrow.setAttribute('stroke', '#fff')
  arrow.setAttribute('stroke-width', '1.5')
  svg.append(arrow)
  shadow.append(style, badge, title, subtitle, ring, svg)
  // addStyle()'s CSS, which is for the page, so outside the shadow root.
  const pageStyle = document.createElement('style')
  pageStyle.setAttribute('data-demo-kit', '')

  let current = {}
  let ringTimer = 0
  // The zoomed copy, drawn options, dialog, console and source view: one of
  // each at a time, beneath the captions and ring.
  const layers = {}
  const layer = (name, el) => {
    layers[name]?.remove()
    layers[name] = el
    if (el) shadow.insertBefore(el, badge)
    return el
  }
  const show = (el, text) => {
    if (text) el.textContent = text
    el.classList.toggle('hidden', !text)
  }
  const drawRing = (box, ms) => {
    Object.assign(ring.style, {
      left: `${box.x - 6}px`, top: `${box.y - 6}px`, width: `${box.width + 12}px`, height: `${box.height + 12}px`
    })
    ring.classList.remove('hidden')
    clearTimeout(ringTimer)
    ringTimer = setTimeout(() => ring.classList.add('hidden'), ms)
  }
  const set = (next) => {
    show(title, next.title)
    show(subtitle, next.subtitle)
    show(badge, next.badge)
    if (pageStyle.textContent !== (next.css || '')) pageStyle.textContent = next.css || ''
    if (next.cursor) {
      // A new page shows the cursor where it was; only moves glide.
      svg.classList.toggle('still', !current.cursor)
      svg.style.transform = `translate(${next.cursor.x - 3}px, ${next.cursor.y - 2}px)`
      svg.classList.remove('hidden')
    }
    current = next
  }

  // Keeps the host and the page's style attached to <html>, observing <html> itself (the host
  // being removed) and the document (<html> being replaced).
  const observer = new MutationObserver(() => ensure())
  let watched = null
  const ensure = () => {
    const root = document.documentElement
    if (!root) return
    if (host.parentNode !== root) root.appendChild(host)
    if (pageStyle.parentNode !== root) root.appendChild(pageStyle)
    if (root !== watched) {
      watched = root
      observer.observe(root, { childList: true })
    }
  }
  observer.observe(document, { childList: true })

  Object.defineProperty(window, key, {
    value: {
      set: (next) => {
        ensure()
        set(next)
      },
      highlight: (box, ms) => {
        ensure()
        drawRing(box, ms)
      },
      pulse: () => {
        if (!current.cursor) return
        const dot = make('pulse')
        dot.style.left = `${current.cursor.x}px`
        dot.style.top = `${current.cursor.y}px`
        shadow.append(dot)
        setTimeout(() => dot.remove(), 600)
      },
      // Hides whatever of the overlay covers `box` while the page is
      // screenshotted there; null shows it again.
      capture: (box) => {
        for (const el of shadow.children) {
          if (!box) {
            el.classList.remove('capturing')
            continue
          }
          if (el === style) continue
          const r = el.getBoundingClientRect()
          const covers = r.width && r.height && r.left < box.x + box.width && r.right > box.x && r.top < box.y + box.height && r.bottom > box.y
          if (covers) el.classList.add('capturing')
        }
      },
      // Draws the image `src` of the page at `from`, grown to `to`; null
      // shrinks it back and removes it.
      zoom: async (src, from, to) => {
        ensure()
        const old = layers.zoom
        if (!src) {
          if (!old) return
          layers.zoom = null
          // A ring drawn on the copy would be left around nothing.
          ring.classList.add('hidden')
          old.classList.remove('in')
          old.style.transform = 'none'
          setTimeout(() => old.remove(), 650)
          return
        }
        const img = document.createElement('img')
        img.className = 'zoom'
        img.src = src
        await img.decode().catch(() => {})
        Object.assign(img.style, { left: `${from.x}px`, top: `${from.y}px`, width: `${from.width}px`, height: `${from.height}px` })
        layer('zoom', img)
        img.getBoundingClientRect()
        img.classList.add('in')
        img.style.transform = `translate(${to.x - from.x}px, ${to.y - from.y}px) scale(${to.width / from.width})`
      },
      // Draws a select's options open beneath `box` (above it if there's no
      // room), and returns where the option whose value is `mark` is.
      options: (box, options, mark) => {
        ensure()
        if (!box) return layer('options', null)
        const list = layer('options', make('options'))
        let marked = null
        for (const o of options) {
          const item = make([o.selected && 'selected', o.disabled && 'disabled', o.value === mark && 'mark'].filter(Boolean).join(' '))
          item.textContent = o.text
          list.append(item)
          if (o.value === mark) marked = item
        }
        list.style.left = `${box.left}px`
        list.style.minWidth = `${box.width}px`
        list.style.maxHeight = `${innerHeight - 16}px`
        const height = list.getBoundingClientRect().height
        const below = box.bottom + 2 + height <= innerHeight
        list.style.top = `${below ? box.bottom + 2 : Math.max(8, box.top - 2 - height)}px`
        return marked?.getBoundingClientRect().toJSON() || null
      },
      // Draws a browser dialog and returns where its OK button is; null
      // removes it.
      dialog: (type, host, message) => {
        ensure()
        if (!type) return layer('dialog', null)
        const box = layer('dialog', make('dialog'))
        const heading = make('host')
        heading.textContent = `${host || 'This page'} says`
        const text = make('message')
        text.textContent = message
        const buttons = make('buttons')
        const button = (label, className) => {
          const b = document.createElement('button')
          b.textContent = label
          b.className = className
          buttons.append(b)
          return b
        }
        if (type !== 'alert') button('Cancel', 'cancel')
        const ok = button('OK', 'ok')
        box.append(heading, text, buttons)
        return ok.getBoundingClientRect().toJSON()
      },
      // Draws a DevTools console and types `code` into it, `ms` per character;
      // null removes it.
      console: async (code, ms) => {
        ensure()
        if (code == null) return layer('console', null)
        const panel = layer('console', make('console'))
        const tabs = make('tabs')
        tabs.innerHTML = 'Elements <b>Console</b> Sources Network'
        const pre = document.createElement('pre')
        panel.append(tabs, pre)
        for (let i = 0; i <= code.length; i += 3) {
          pre.textContent = `> ${code.slice(0, i)}`
          await new Promise((resolve) => setTimeout(resolve, ms * 3))
        }
        pre.textContent = `> ${code}`
      },
      // Draws the page source over the page, scrolled to `hit` ({ line, from
      // 0, and the start and length of the text in it }; null for none), which
      // is highlighted and ringed for `ms`; null removes it.
      source: (url, lines, hit, ms) => {
        ensure()
        if (url == null) return layer('source', null)
        const view = layer('source', make('source'))
        const bar = make('bar')
        bar.textContent = `view-source:${url}`
        const pre = document.createElement('pre')
        let match = null
        lines.forEach((text, i) => {
          const line = make(i === hit?.line ? 'line hit' : 'line')
          const number = document.createElement('span')
          number.textContent = String(i + 1)
          const code = document.createElement('span')
          if (i === hit?.line) {
            match = document.createElement('mark')
            match.textContent = text.slice(hit.start, hit.start + hit.length)
            code.append(text.slice(0, hit.start), match, text.slice(hit.start + hit.length))
          } else {
            code.textContent = text
          }
          line.append(number, code)
          pre.append(line)
        })
        view.append(bar, pre)
        if (!match) return
        const box = match.getBoundingClientRect()
        view.scrollTop += box.top + box.height / 2 - view.clientHeight / 2
        drawRing(match.getBoundingClientRect(), ms)
      }
    }
  })
  ensure()
  set(state)
}
