The recording image has a `demo-kit` package that does everything demo scripts have in common: launching the browser, recording, the title and subtitle overlays (on every page, surviving navigation and pages that re-render), a visible cursor, and pacing for a human viewer. Use it for all of that rather than writing your own; use `demo.page` (a Puppeteer `Page`) directly only for what it doesn't cover.

```javascript
import { record } from 'demo-kit'

await record(async (demo) => {
  await demo.scene('Signing in')
  await demo.goto(`${APP_URL}/login`)
  await demo.say('We start by signing in as an administrator.')
  await demo.type('#username', USERNAME)
  await demo.type('#password', PASSWORD)
  await demo.click('button[type=submit]', { navigation: true })

  await demo.scene('Creating a report')
  await demo.click('::-p-text(New report)', { highlight: true })
  await demo.upload('input[type=file]', REPORT_CSV)
})
```

`record(script, options?)` launches Chrome (headless, 1920×1080, certificate errors ignored), calls `await script(demo)` and saves the screencast to `/output/demo.webm`. Recording starts once the first `demo.goto()` has loaded, so the video doesn't open on a blank page. If the script throws, the error is logged, a screenshot is saved and the process exits non-zero, but the recording is still kept and the browser closed, so don't add your own try/finally for that. Every action, scene and page load is logged with how long into the run it happened, as are the page's errors and failed loads and a target that is taking a while to appear, so don't log those yourself. The page's `alert()`, `confirm()` and `prompt()` dialogs are accepted automatically and kept in `demo.dialogs` (`{ type, message, host }`), so don't handle the page's `dialog` event yourself; the recording can't show them, so use `demo.showDialog()` to show one. Options: `autoStart: false` to start recording yourself with `demo.startRecording()` (to leave setup such as signing in out of the video); `pace` (default 1) scales every pause.

A target is a Puppeteer selector string (CSS, or `::-p-text(Save)` for an element by its text, `::-p-aria(Save)` by its accessible name) or an `ElementHandle`. Every action waits up to 30 seconds for its target to be visible, scrolls it into view, glides the drawn cursor to it and pauses briefly afterwards.

| Method | What it does |
|---|---|
| `demo.scene(title)` | Starts a scene: shows its title, clears the subtitle and logs it. |
| `demo.say(text, { min })` | Shows a subtitle and waits until it can be read (a second per four words, at least two seconds, at least `min` ms). It stays until the next `say` or scene. |
| `demo.title(text)` / `demo.subtitle(text)` | Sets the title or subtitle without waiting; `''` hides it. |
| `demo.pause(ms)` | Waits, e.g. to let a result be seen. |
| `demo.goto(url, { waitUntil, timeout })` | Navigates and waits for the page to load (`waitUntil` defaults to `'load'`). |
| `demo.click(target, { navigation, highlight })` | Clicks the target. Pass `navigation: true` when the click loads a new page, so it waits for it; `highlight: true` to ring it first. |
| `demo.type(target, text, { delay, clear, enter })` | Types at a visible speed into the target, replacing its contents unless `clear: false`; `enter: true` presses Enter afterwards. |
| `demo.press(key)` | Presses a key: `'Enter'`, `'Escape'`, `'Tab'`… |
| `demo.select(target, ...values)` | Chooses options of a `<select>` by value. For one value it draws the list open (the recording can't show the browser's own) and the cursor picks the option. |
| `demo.showOptions(target, { mark })` / `demo.hideOptions()` | Draws a `<select>`'s options open beneath it without choosing, e.g. to show what is (or isn't) offered, with the option whose value is `mark` picked out. Returns the options as `{ value, text }`. |
| `demo.check(target, checked)` | Ticks a checkbox (or unticks it, with `checked` false), clicking only if needed; one already that way is highlighted instead. |
| `demo.upload(target, ...paths)` | Sets the files of an `<input type="file">`, which may be hidden. |
| `demo.highlight(target, { ms })` | Draws a ring around the target for `ms` (default 1500) without waiting. |
| `demo.find(target, { visible, timeout, text })` / `demo.waitFor(...)` | Waits for the target and returns its `ElementHandle`. With `text`, the first match whose text contains it, e.g. `demo.find('#the-list tr', { text: 'marketing' })` for a table row. |
| `demo.zoomIn(target, { scale })` / `demo.zoomOut()` | Scrolls the target to the middle and draws it `scale` times larger (default 1.35, less if it wouldn't fit) on top of everything, to make small text readable, until `zoomOut()` or the next page. Highlights inside it are drawn on the zoomed copy. Don't click while zoomed in. |
| `demo.markText(target, text, { through })` | Wraps the first `text` in the target (up to the end of `through`, if given) in a yellow mark and returns a selector for it to `highlight` or `zoomIn` on; `null` if it isn't there. |
| `demo.selectText(target, text)` | Selects the line of a `<textarea>` containing `text` (or the text itself, elsewhere), scrolls to it and highlights the element while it's read. Returns whether it was found. |
| `demo.showDialog(dialog?)` | Draws the browser dialog the page last opened (or an entry of `demo.dialogs`, or a message string) as the browser showed it, waits until it can be read and clicks it away. |
| `demo.showSource(text)` / `demo.hideSource()` | Shows the page's HTML source over the page, like view-source (which can't be opened), scrolled to and highlighting the first occurrence of `text` (or the first found of an array, in order of preference) and its line. It is fetched again with a GET. |
| `demo.showConsole(code)` / `demo.hideConsole()` | Draws a DevTools console and types `code` into it. Only drawn: run the code yourself with `demo.page.evaluate()`. |
| `demo.saveSession(name)` / `demo.useSession(name)` | Saves the browser's cookies (who is signed in) under `name`, and later swaps them back in (`null` signs everyone out); effective from the next page load. Sign each user in with `autoStart: false` before `startRecording()`, then switch between them to show several users in one recording. |
| `demo.badge(text)` | Shows a label in the top right corner of every page, e.g. which user is signed in; `''` hides it. |
| `demo.log(message)` | Logs a line to the recording log, stamped with the time since the run started like demo-kit's own lines. |
| `demo.startRecording()` | Starts recording now (only needed with `autoStart: false`). |
| `demo.page` / `demo.browser` | The Puppeteer page and browser, for anything else. |
