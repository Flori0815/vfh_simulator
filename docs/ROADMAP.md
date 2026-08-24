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

## Stage 3 — German "Seefunkzeugnis" exam trainer
The exam (SRC — Short Range Certificate / UBI — Long Range) tests exactly
the procedures this simulator already models: correct distress/urgency/
safety call structure, correct channel usage (16 vs. 70 vs. working
channels), DSC procedure, phonetic alphabet, and standard phrases.
Planned structure:

- `docs/exam/` — question bank and scenario definitions (not yet built),
  written from the German Seefunk syllabus (Telekom-Regulierungsbehörde /
  Bundesnetzagentur SRC/LRC curriculum), kept separate from the simulator
  code so content can grow independently.
- A **scenario runner** that scripts an incoming situation (e.g. "you hear
  another vessel's Mayday on Ch16 — what do you do?") and drives it through
  the same `dscBus`/UI the simulator already has, then grades the user's
  actual button presses and any free-text voice-procedure answers against
  a checklist derived from `docs/MENU-STRUCTURE.md`.
- A lighter-weight **quiz mode** for the theory questions (regulations,
  frequency plan, phonetic alphabet, prowords) that doesn't need the radio
  UI at all.

Stage 2 and Stage 3 share the same event bus, so a training scenario can
literally be "the AI plays the distressed vessel, you play the operator" —
i.e. Stage 3 exercises are Stage 2 traffic with grading on top.
