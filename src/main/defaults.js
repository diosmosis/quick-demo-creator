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

// Appended to the recording prompt. Claude can't know how stage 3 runs the
// script, so without this it guesses at paths, packages and browser flags.
export const DEFAULT_RECORDING_ENVIRONMENT = `Requirements for the generated script (it is run automatically and unattended):
- It runs with Node.js 22 inside a Docker container where the \`puppeteer\` package (v24) and a matching Chrome are installed. Use ES module syntax (\`import puppeteer from 'puppeteer'\`). Do not import any other packages; Node's built-in \`fs\`, \`path\` and \`timers/promises\` modules are available.
- Launch the browser with \`headless: true\`, \`args: ['--no-sandbox', '--disable-dev-shm-usage']\` and \`defaultViewport: { width: 1920, height: 1080 }\`.
- Record with Puppeteer's built-in \`page.screencast({ path: '/output/demo.webm' })\` (ffmpeg is installed), and stop the recorder before closing the browser. \`/output\` is the only directory that is kept, so write everything there.
- Install the title overlay and subtitle elements with \`page.evaluateOnNewDocument\` so they exist on every page, and update their text with \`page.evaluate\`. Make them fixed-position with a high z-index and \`pointer-events: none\` so they never block clicks.
- Pace the video for a human viewer: pause long enough for each subtitle to be read (roughly one second per four words, at least two seconds), type with a visible delay, and pause briefly after each navigation.
- Log progress with \`console.log\` (for example, the scene being recorded); the log is shown while recording.
- Put URLs, credentials and anything else that may need adjusting in clearly named constants at the top of the file.
- Close the browser and exit even when a step fails, so the recording is still saved.
- Respond with the complete script in a single \`\`\`javascript code block. Do not write any files or run any commands.`

export const DEFAULT_SETTINGS = {
  githubToken: '',

  claudePath: 'claude',
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
  openFolderWhenDone: true
}

const PROMPT_KEYS = ['planningPrompt', 'recordingPrompt']

// The settings as the app should use them: defaults filled in, blank prompts
// restored.
export function effectiveSettings(saved, fallbackOutputDir) {
  const s = { ...DEFAULT_SETTINGS, ...saved }
  for (const key of PROMPT_KEYS) {
    if (!String(s[key] || '').trim()) s[key] = DEFAULT_SETTINGS[key]
  }
  if (!String(s.outputDir || '').trim()) s.outputDir = fallbackOutputDir
  return s
}
