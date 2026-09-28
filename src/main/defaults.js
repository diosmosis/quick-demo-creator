// Default settings. Anything the user saves overrides these; an empty prompt
// falls back to its default here, so clearing a prompt field "resets" it.
// The appended instruction blocks may be blanked to send nothing.

export const DEFAULT_PLANNING_PROMPT =
  'please read the PR description and code changes in {PR_LINK} and generate a script for a video ' +
  'demo-ing the feature to stakeholders. the script should consist of multiple scenes, each scene has ' +
  'a short title that will be displayed as an overlay, and a list of actions that will be executed in ' +
  'a browser, the script should not have any dialogue. text for communication to the viewer can be ' +
  'shown as subtitles.'

export const DEFAULT_RECORDING_PROMPT =
  'please generate a puppeteer script that creates a screencast for the below script. the title in ' +
  'the script should be displayed as a semi-opaque overlay on every page, other text should be ' +
  'displayed as subtitles near the bottom of the page. script: {SCRIPT}'

// Appended to the planning prompt. The answer goes straight into an editor,
// so it has to be the script itself rather than a file Claude wrote.
export const DEFAULT_PLANNING_INSTRUCTIONS =
  'Reply with the finished script as your final message, with nothing before or after it: it is shown ' +
  'to the user in an editor exactly as you write it. Do not write any files.'

// Appended to the recording prompt. Claude can't know how stage 4 runs the
// script, so without this it guesses at paths, packages and browser flags.
// {DEMO_API} becomes the reference of the recorder image's demo-kit library
// (docker/recorder/demo-kit.md), so it always describes the installed version.
export const DEFAULT_RECORDING_ENVIRONMENT = `{DEMO_API}

Requirements for the generated script (it is run automatically and unattended):
- It runs with Node.js 22 inside a Docker container. Use ES module syntax. Only the \`demo-kit\` and \`puppeteer\` (v24) packages and Node's built-in \`fs\`, \`path\` and \`timers/promises\` modules are available; do not import anything else.
- Pace the video for a human viewer: give each subtitle time to be read (\`demo.say\` does), and pause to let the result of an important step be seen.
- The recording log is shown while it runs, and demo-kit already logs every scene, action and page load; log anything else that helps follow a run, such as what the script is checking or waiting for, with \`demo.log\`.
- Read the app's URL, credentials and anything else that differs between machines from environment variables, in clearly named constants at the top of the file, with the value from the video script as the default: \`const APP_URL = process.env.APP_URL || 'http://localhost:8080'\`. Use upper-case names and read each one as \`process.env.NAME\`; the user is shown a field for each variable read that way.
- Files the demo needs from the user (a plugin archive to upload, an image, a CSV to import) are mounted read-only in \`/input\`, which is also the working directory. Name each one by its full path in a constant at the top of the file, using a short descriptive file name: \`const PLUGIN_ZIP = '/input/my-plugin.zip'\`. Write every \`/input/...\` path as a plain string like that; the user is shown a slot for each one to add the file to. Don't create or download these files in the script.
- Start the file with a block comment that says in a sentence what the demo shows, then lists under a \`Preconditions:\` heading everything that must already be true for the script to succeed and that it doesn't set up itself: the app running and reachable at its URL, the accounts it signs in with and the permissions they need, plugins, settings or feature flags that must be enabled, data that must already exist (and anything that must not exist yet, such as an item the demo creates), and each \`/input\` file with what it has to be. Say how to satisfy each one where the video script or the PR tells you. If there are none, say so.
- Before the first scene, verify the preconditions, so a missed setup step fails the run straight away with a clear message instead of partway through the video. Pass \`autoStart: false\` to \`record()\`, run the checks, then call \`demo.startRecording()\`, so the checks aren't in the video. Check every precondition from the header comment that the script can observe: each \`/input\` file exists (\`fs.existsSync\`), the app answers at its URL, each account can sign in, and the plugins, settings and data it relies on are there (and what it will create isn't yet), checking them the way a user would see them, in the app's pages. Only look: never create, change or delete anything to satisfy a precondition. Use short timeouts, and \`demo.page\` rather than demo-kit's actions when something is expected to be absent, so a check doesn't wait 30 seconds for it. Log each check with \`demo.log\` as it runs. Run all of them rather than stopping at the first failure, then, if any failed, throw one error listing every unmet precondition with how to fix it, in the header comment's words. Leave the browser as the first scene expects it: if a check signed in and the first scene signs in on camera, sign out again (\`demo.useSession(null)\`). Say in the header comment which preconditions the script can't verify.
- Respond with the complete script in a single \`\`\`javascript code block. Do not write any files or run any commands.`

export const DEFAULT_SETTINGS = {
  githubToken: '',

  claudePath: 'claude',
  // For a wrapper: claudebox, say, wants `--project {PROJECT}`.
  executableArgs: '',
  // Stage 1 hands Claude the PR itself, but the prompt still names the link, so
  // let it look at the PR with read-only tools if it wants to.
  claudeArgs: '--allowedTools "WebFetch,Bash(gh pr view:*),Bash(gh pr diff:*)"',
  claudeWorkdir: '',
  promptDelivery: 'stdin',

  includePrDetails: true,
  maxDiffChars: 100000,

  planningPrompt: DEFAULT_PLANNING_PROMPT,
  planningInstructions: DEFAULT_PLANNING_INSTRUCTIONS,
  recordingPrompt: DEFAULT_RECORDING_PROMPT,
  recordingEnvironment: DEFAULT_RECORDING_ENVIRONMENT,

  dockerPath: 'docker',
  dockerImage: 'quick-demo-creator-recorder',
  // The demo almost always targets an app running on this machine.
  dockerRunArgs: '--network host',
  convertToMp4: true,
  outputDir: '',
  openFolderWhenDone: true,

  ddevPath: 'ddev',
  // Where the Environment stage's copies of DDEV projects go; '' for a folder
  // in the home directory (see ipc.js).
  instancesDir: '',
  // Opens an instance's folder, e.g. `code` or `phpstorm`; '' for the file manager.
  editorCommand: ''
}

const PROMPT_KEYS = ['planningPrompt', 'recordingPrompt']

// The settings as the app should use them: defaults filled in, blank prompts
// restored, and blank folders set to `fallbacks` ({ outputDir, instancesDir }).
export function effectiveSettings(saved, fallbacks) {
  const s = { ...DEFAULT_SETTINGS, ...saved }
  for (const key of PROMPT_KEYS) {
    if (!String(s[key] || '').trim()) s[key] = DEFAULT_SETTINGS[key]
  }
  for (const key of ['outputDir', 'instancesDir']) {
    if (!String(s[key] || '').trim()) s[key] = fallbacks[key]
  }
  return s
}
