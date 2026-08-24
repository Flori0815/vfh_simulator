# Roadmap

## Stage 1 — Visual + functional simulator (this build)
Photo-based, responsive recreation of the IC-M503 + DS-100 front panels
with a rotary-knob interaction that works on touch and mouse, and a
JS state machine that reproduces the manual's button/menu behavior
(channels, dualwatch/tri-watch, scan, set mode, DSC calling, receiving
simulated DSC traffic). No build step — static HTML/CSS/JS, open
`index.html` or serve the folder.

## Stage 2 — AI-driven radio traffic
The DS-100 already talks to the rest of the app only through
`js/dsc-bus.js`, a small pub/sub bus carrying typed DSC messages
(`distress`, `individual`, `group`, `all_ships`, `position_request`,
`position_reply`, `ack`, `distress_relay`, …) — see `DSC_MESSAGE_SHAPES`
in that file. That boundary is the integration point for Stage 2:

- **Receiving calls**: an AI backend plays other vessels/coast stations.
  It composes messages matching those shapes (in-character MMSI, position,
  nature of distress, plain-language voice follow-up) and publishes them
  on the bus exactly like the "simulate incoming call" debug panel does
  today. The DS-100/M503 UI doesn't need to know the traffic is
  AI-generated.
- **Answering calls**: subscribe to `dscBus` for the outgoing events the
  user generates (distress alerts, individual/group calls, and — once
  built — a voice/phrase log on Ch16) and let the AI model generate a
  plausible in-character response, including realistic delays,
  mis-hearings, and the coast-station acknowledgement flow.
- Longer term this is a natural fit for a small server (or an in-browser
  call to a hosted model) that owns "the other ships" as NPCs with
  persistent MMSIs/callsigns, plus optional speech-to-text/text-to-speech
  for the voice portion of a call.

## Stage 3 — German "Seefunkzeugnis" exam trainer (in progress)
The exam (SRC — Short Range Certificate / UBI — Long Range) tests exactly
the procedures this simulator already models: correct distress/urgency/
safety call structure, correct channel usage (16 vs. 70 vs. working
channels), DSC procedure, phonetic alphabet, and standard phrases.

**Built so far**: `docs/Test_questions` is the official 105-task DSV/DMYV
practical-exam catalog (German). `js/challenges-data.js` is that catalog
parsed into structured data; `js/challenges.js` layers automated grading
onto the ~30 tasks that are fully device-driven (power/channel/mode
state, DSC transmissions, menu navigation — all checked against the
`state.log` action log on `m503`/`ds100`, never by inspecting the DOM).
`js/challenge-ui.js` is the category → challenge → live-checklist browser,
under the "Training" tab.

The remaining ~75 tasks are voice/procedure content (MAYDAY, PAN PAN,
SECURITE, phonetic alphabet, …) and are now graded by a real audio
pipeline instead of self-certification alone:
- `js/settings.js` — a "⚙ KI-Einstellungen" modal for pasting a Google
  Gemini API key, stored client-side only (`localStorage`) since this is
  a static site with no backend.
- `js/audio-recorder.js` — `getUserMedia`/`MediaRecorder` wrapper; records
  the user's spoken call as a Blob (prefers Ogg/Opus — one of Gemini's
  documented audio formats — falling back to whatever the browser offers).
- `js/gemini-api.js` — calls Gemini's `generateContent` REST endpoint
  directly from the browser (no server) with the API key in the
  `x-goog-api-key` header: first to transcribe the recording, then to
  grade the transcript against that task's `steps`/`criteria` using a
  `responseSchema`-constrained JSON verdict (`pass`/`feedback`/`missing`).
- `js/challenge-ui.js`'s voice-challenge panel drives record → transcribe
  → evaluate → show verdict, and still offers manual self-certification
  as a fallback when no mic or API key is available, or when the grader
  gets it wrong.

**Still to do**:
- A scenario runner that scripts an incoming situation end-to-end (e.g.
  "you hear another vessel's Mayday on Ch16 — what do you do?") using
  `dscBus`, rather than each task being graded independently.
- A lighter-weight quiz mode for pure theory questions (regulations,
  frequency plan) that doesn't need the radio UI at all.
- Once Stage 2's AI-generated traffic exists, the same Gemini pipeline can
  likely drive both sides of a call (NPC voice + grading the user's reply)
  instead of only grading solo scripted tasks.

Stage 2 and Stage 3 share the same event bus, so a training scenario can
literally be "the AI plays the distressed vessel, you play the operator" —
i.e. Stage 3 exercises are Stage 2 traffic with grading on top.

## Architecture note: config-driven vs. hardcoded
The DS-100 is now genuinely config-driven: `js/ds100-screens.js` is a pure
data table (one entry per LCD screen — its content *and* its input
handling) and `js/ds100.js` is a small generic engine that interprets it,
so adding or editing a screen never touches the engine. `js/channels.js`
and `js/challenges-data.js`/`js/challenges.js` are the same idea for
channel data and exam content. The IC-M503 (`js/m503.js`) is still mostly
procedural — it's a physical-button state machine (hold-modifiers, timing)
rather than a menu tree, which doesn't decompose into a screen table the
same way; its Set Mode items are the one part that's already data-driven.
