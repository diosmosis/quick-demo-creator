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
   show. Claude's output streams in as it works. The finished script lands in
   an editor for you to adjust. Add anything Claude can't know, such as the URL
   the app runs at and how to log in.
2. **Puppeteer script.** Click _Generate Puppeteer script_. Claude turns the
   edited script into a Puppeteer program that records the screencast. It shows
   the scene title as a semi-opaque overlay and the other text as subtitles.
   The program is shown for review (and can be edited). A **safety check**
   scans it (see below).
3. **Record.** Click _Record screencast_. The script runs in the recorder
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
| Claude executable | `claude` | A name on `PATH` or an absolute path. The desktop menu doesn't see your shell's `PATH`. |
| Claude extra arguments | `--allowedTools "WebFetch,Bash(gh pr view:*),Bash(gh pr diff:*)"` | Placed before `-p --output-format stream-json --verbose --include-partial-messages`, which the app always adds. |
| Send the prompt | standard input | Switch to _as the last argument_ if a wrapper doesn't forward stdin. |
| Working directory | a temp dir | Where Claude runs. |
| Prompts | see below | Each has a _Reset to default_ link. |
| Docker executable / image name | `docker` / `quick-demo-creator-recorder` | |
| Extra `docker run` arguments | `--network host` | Lets the script reach apps served on this machine (`localhost`, `*.ddev.site`). |
| Output folder | `~/Videos/quick-demo-creator` | Each recording gets its own subfolder with the video, the Puppeteer script and the video script. |
| Convert to MP4 | on | `page.screencast()` records WebM; the MP4 plays in more places. |

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
  the script: ES modules, Puppeteer 24 only, `--no-sandbox`, record to
  `/output/demo.webm`, overlays that survive navigation, pacing, and one code
  block in the answer.

Clear an appended block to send nothing.

## The safety check

Before stage 3, the generated script is parsed with acorn and checked for
things a recording script has no reason to do:

- **Blocks recording:** importing `child_process`, `net`, `http(s)`, `vm`,
  `worker_threads` and similar; module names computed at runtime; `eval` or
  `new Function` in Node; `fs` writes, deletes or renames outside `/output`;
  `process.binding` and similar; references to credential files, the Docker
  socket, cloud metadata endpoints or crypto miners.
- **Warns:** packages that aren't in the image, paths it can't resolve, Node-side
  `fetch`, `process.env`, long base64 or escaped strings, minified lines, and a
  script that never calls `page.screencast()`.

To record anyway, tick _I've reviewed these and want to record anyway_. The
main process checks again before it starts, so the renderer can't skip the
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
    recorder.js    builds the recorder image, runs the script in it
    text.js        arg splitting, templating, code-fence extraction
    store.js       JSON settings/session store in userData
  preload/index.js contextBridge API
  renderer/        React UI: App.jsx (stages), components/Settings.jsx, components/LogView.jsx
docker/recorder/   the recorder image (Dockerfile + entrypoint)
tests/             node:test unit tests
```

The session state (PR link, video script and Puppeteer script) is saved as you
work and restored on the next launch.

## Notes

- The GitHub token is stored in plain text in `userData/settings.json`. Prefer a
  fine-grained, read-only token.
- Cancelling a recording kills its container by name. Killing the `docker` CLI
  alone would leave the container running.
- On rootless Docker, container root already maps to your user, so the app
  doesn't pass `--user`. It checks `docker info` to decide.
