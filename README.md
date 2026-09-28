# Quick Demo Creator

A small Electron + React desktop app that turns a **GitHub pull request** into a
**screencast demoing the feature**. Claude plans the video and writes a
Puppeteer script for it. Puppeteer then records the screencast in a Docker
container. No AI generates or edits any image or video: every frame is a real
browser recording.

## The three stages

1. **Plan.** Paste a PR link and click _Plan_. The app fetches the PR's
   description and diff, then asks Claude for a video script: scenes, each with
   a short overlay title, the browser actions to perform and the subtitles to
   show. Claude's output streams in as it works. Once it finishes, the log
   makes way for the script: an editor on the left and the rendered markdown on
   the right. _Show Claude's output_ brings the log back. Add anything Claude can't know, such as the URL
   the app runs at and how to log in.
2. **Puppeteer script.** Click _Generate Puppeteer script_. Claude turns the
   edited script into a Puppeteer program that records the screencast, written
   against the recorder's `demo-kit` library (see below), which shows the scene
   title as a semi-opaque overlay and the other text as subtitles.
   Claude's output streams in the same way, then the program replaces it for
   review. It can be edited in a code editor with JavaScript highlighting and
   find/replace (Ctrl+F). A **safety check** scans it (see below) and lists
   its findings under the editor; clicking a finding's line number jumps to it,
   and ✕ dismisses it. The script opens with a comment listing its
   preconditions: what has to be set up in the app before it can run. Before
   the first scene, and before recording starts, the script checks the ones it
   can and fails listing every precondition that isn't met. A
   sidebar on the right has two tabs: a field for each environment variable
   the script reads (see _Environment variables_), and the files it needs
   (see _Input files_).
3. **Record.** Optionally choose a _Background audio_ file under the sidebar
   first: it is looped for the whole length of the MP4, fading out over its
   last two seconds (the WebM stays silent, and nothing is added with _Convert
   to MP4_ off). Click _Record screencast_. The script runs in the recorder
   container, and its output streams in with a running timer. When it finishes,
   the output folder opens on your desktop.

## Requirements

- Node.js 18+ and npm
- The [Claude Code](https://claude.com/claude-code) CLI, or a wrapper around it
  such as `claudebox`
- Docker. The recorder image, with Node 22, Puppeteer 24, Chrome and ffmpeg, is
  built automatically the first time you record. That takes a few minutes. It
  is rebuilt whenever anything in `docker/recorder/` changes.

## Getting started

```bash
npm install
npm run dev      # development, with hot reload
```

For the production build, use `npm run build && npm start`. To add a desktop
menu entry that launches `launch.sh`, run `npm run desktop:install`.

```bash
npm test         # unit tests for the safety check, stream parser and helpers
```

## Settings

Everything is configurable from the ⚙ button:

| Setting | Default | Notes |
|---|---|---|
| GitHub token | none | Needed for private repositories. Used to fetch the PR, and also passed to Claude as `GH_TOKEN`/`GITHUB_TOKEN`. |
| Fetch PR details into the prompt | on | Appends the PR's description and diff (capped by _Maximum diff size_) to the planning prompt, so Claude doesn't need its own GitHub access. |
| Claude executable | `claude` | A name on `PATH` (e.g. `claudebox`), or a path. Run through an interactive login bash, so it finds whatever your `~/.bashrc` adds to `PATH` even when the app is started from the desktop menu. |
| Executable arguments | none | For a wrapper: placed right after the executable, before anything meant for Claude. `{PROJECT}` becomes the PR's repository name. claudebox runs from a temp dir here, so it can't tell the project from where it's started; give it `--project {PROJECT}`, and send the prompt as the last argument, since the box doesn't pass stdin on to Claude. |
| Claude extra arguments | `--allowedTools "WebFetch,Bash(gh pr view:*),Bash(gh pr diff:*)"` | Placed after the executable arguments and before `-p --output-format stream-json --verbose --include-partial-messages`, which the app always adds. |
| Send the prompt | standard input | Switch to _as the last argument_ if a wrapper doesn't forward stdin (claudebox with `--project` doesn't). Linux caps one argument at 128 KB, so a large diff may need a lower _Maximum diff size_. |
| Working directory | a temp dir | Where Claude runs. |
| Prompts | see below | Each has a _Reset to default_ link. |
| Docker executable / image name | `docker` / `quick-demo-creator-recorder` | |
| Extra `docker run` arguments | `--network host` | Lets the script reach apps served on this machine (`localhost`, `*.ddev.site`). On rootful Docker that's all it takes. On rootless Docker or Docker Desktop, "host" is not this machine; the recording log says what to do instead. |
| Output folder | `~/Videos/quick-demo-creator` | Each recording gets its own subfolder with the video, the Puppeteer script and the video script. |
| Convert to MP4 | on | `page.screencast()` records WebM; the MP4 plays in more places. The background audio is only added to the MP4. |

### Prompts

- **Stage 1: planning.** The prompt as specified, with `{PR_LINK}` replaced by
  the PR link.
- **Stage 1: output instructions** (appended). Asks for just the script as the
  final answer, since that answer goes straight into the editor. Without this,
  Claude sometimes tried to save the script to a file and opened its answer
  with an explanation.
- **Stage 2: Puppeteer script.** The prompt as specified, with `{SCRIPT}`
  replaced by the edited script.
- **Stage 2: recording environment** (appended). Tells Claude how stage 3 runs
  the script: the `demo-kit` API (`{DEMO_API}` becomes its reference), ES
  modules with no other packages, pacing, URLs and credentials read from
  environment variables with the video script's values as defaults, input
  files named as `/input/...` constants, a header comment listing the script's
  preconditions, a check of those preconditions before recording starts, and
  one code block in the answer. If you have edited this
  prompt, _Reset to default_ picks up `{DEMO_API}`; without it Claude doesn't
  know the library exists.

Clear an appended block to send nothing.

Settings only keep what differs from the defaults, so a new default prompt
reaches you unless you've edited that prompt. Settings saved before this was
the case hold a copy of every default; use _Reset to default_ on a prompt to
pick up the current one.

## demo-kit

Everything demo scripts have in common lives in a small library installed in
the recorder image as the `demo-kit` package
([docker/recorder/demo-kit.js](docker/recorder/demo-kit.js)), so the generated
scripts only say what happens in the demo, and a fix there fixes every script
rather than needing another prompt instruction:

- `record(async (demo) => { … })` launches Chrome with the right options,
  records to `/output/demo.webm` from the first page load, and on a failure
  logs it, saves `failure.png`, still keeps the video and exits non-zero.
- `demo.scene()`, `say()`, `title()`, `subtitle()` drive the overlay. It lives
  in a shadow root on `<html>` that's there from the start of every page, is
  put back whenever the page removes it, and bypasses the page's CSP.
- `demo.click()`, `type()`, `select()`, `upload()`, `highlight()` wait for
  their target, scroll to it and glide a drawn cursor to it (headless
  screencasts show no mouse pointer), at a pace a viewer can follow.
- What the recording can't show is drawn into the overlay instead: a
  `<select>`'s open list (`select()`, `showOptions()`), the page's
  `alert()`/`confirm()` dialogs (accepted automatically, then
  `showDialog()`), view-source (`showSource()`) and a DevTools console
  (`showConsole()`). `zoomIn()` enlarges a screenshot of an element in the
  overlay, so nothing on the page (a fixed sidebar with a higher z-index, a
  parent that clips) can cover or cut it off. `markText()`, `selectText()`
  and `check()` cover the rest of what demos kept writing themselves.
- `saveSession()`/`useSession()` swap the browser's cookies, so users signed
  in off camera can take turns in one recording, and `badge()` labels whose
  turn it is.
- Everything it does is logged with the time since the run started: each
  scene and action (typed text only by its length, since it's often a
  password), each page load with its status and title, the page's errors and
  failed loads, a target still being waited for every 5 seconds, and on a
  failure the step that failed. `demo.log()` adds a line of the script's own.

Its API reference, [docker/recorder/demo-kit.md](docker/recorder/demo-kit.md),
is what Claude is given, and a test fails if a public method is missing from
it. Editing either file rebuilds the image on the next recording. A script
saved with a recording needs the library to run anywhere else.

## Environment variables

The recorder container gets none of this machine's environment. The app finds
the variables the script reads as `process.env.NAME` (or `process.env['NAME']`,
or `const { NAME } = process.env`) and shows a field for each under the script,
with the script's own default as the placeholder. A default that is code, such
as `` `${APP_URL}/login` ``, is shown as that code (and in the field's tooltip),
so it's clear the field can stay blank. Filled-in values are passed
with `docker run -e` and remembered per repository. A blank field is left unset,
so the default applies. Only variables the script reads are passed.

Before recording, the app checks which Docker it's talking to. If a URL the
script will visit is on this machine (`localhost`, `127.*`, `*.ddev.site`) and
the container won't reach it, the recording log says why:

- the extra `docker run` arguments don't include `--network host`;
- rootless Docker, where `--network host` is RootlessKit's network (allow host
  loopback and use `10.0.2.2`);
- Docker Desktop, where it's the VM's network unless host networking is on (or
  use `host.docker.internal`).

## Input files

Some demos need a file from you, such as a plugin archive to upload. The
script names each one by its full path, e.g. `/input/my-plugin.zip`, and the
_Files_ tab beside the script shows a slot for each. Drop a file on a slot, or
use _Choose…_, and it is mounted under that name whatever it's called on disk.
Files dropped anywhere else in the tab (or added with _Add…_) keep their own
names.

Each file is bind-mounted read-only at `/input/<name>`, and `/input` is the
container's working directory, so relative paths work too. Files are
referenced, not copied, and remembered per repository; one that has since
been moved or deleted is marked and left out of the run. A slot with no file
doesn't stop a recording, but the log says so.

## The safety check

Before stage 3, the generated script is parsed with acorn and checked for
things a recording script has no reason to do:

`demo-kit` and `puppeteer` are the packages scripts may import.

- **Blocks recording:** importing `child_process`, `net`, `http(s)`, `vm`,
  `worker_threads` and similar; module names computed at runtime; `eval` or
  `new Function` in Node; `fs` writes, deletes or renames outside `/output`;
  `process.binding` and similar; references to credential files, the Docker
  socket, cloud metadata endpoints or crypto miners.
- **Warns:** packages that aren't in the image, paths it can't resolve, Node-side
  `fetch`, reading the whole of `process.env` (named variables are fine), long base64 or escaped strings, minified lines, and a
  script that never calls demo-kit's `record()` or `page.screencast()`.

Recording stays disabled until every blocking (red) finding has been
dismissed, which is how you say you've reviewed it. Dismissals follow the
finding's code rather than its line number, so edits elsewhere don't bring
them back; _Show dismissed safety notes_ above the editor does. The main
process checks again before it starts, so the renderer can't skip the
check.

The check is a tripwire, not a sandbox. The real containment is the container:

- Only the run's output folder and the script (read-only) are mounted.
- It runs with `--cap-drop=ALL` and `--security-opt=no-new-privileges`.
- It never gets the GitHub token.
- On rootful Docker it runs as your uid.

`--network host` does let the script reach services on your machine, so remove
it if you don't need that.

## Architecture

```
src/
  main/
    index.js       app/window lifecycle
    ipc.js         IPC handlers: settings, session, the three stages, cancel
    defaults.js    default settings and prompts
    github.js      PR URL parsing and fetching (Electron's net.fetch)
    claude.js      spawns the Claude CLI; StreamParser turns stream-json into UI events
    safety.js      static check of the generated script
    script-env.js  finds the environment variables the script reads
    script-files.js finds the /input files the script reads
    recorder.js    builds the recorder image, runs the script in it
    shell.js       runs Claude and Docker through a login shell, so they're found from the desktop menu
    text.js        arg splitting, templating, code-fence extraction
    store.js       JSON settings/session store in userData
  preload/index.js contextBridge API
  renderer/        React UI: App.jsx (stages), components/Settings.jsx, LogView.jsx, Markdown.jsx, CodeEditor.jsx (CodeMirror), InputFiles.jsx
docker/recorder/   the recorder image (Dockerfile + entrypoint) and demo-kit, the library scripts use
tests/             node:test unit tests
```

The session state (PR link, video script and Puppeteer script) is saved as you
work and restored on the next launch.

## Notes

- Claude Code streams its thinking as empty deltas, so a long think shows only
  _Thinking…_ and the timer until Claude starts writing.
- The GitHub token is stored in plain text in `userData/settings.json`. Prefer a
  fine-grained, read-only token.
- Cancelling a recording kills its container by name. Killing the `docker` CLI
  alone would leave the container running.
- On rootless Docker, container root already maps to your user, so the app
  doesn't pass `--user`. It checks `docker info` to decide.
