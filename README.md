# VHF Simulator — Icom IC-M503 + DS-100

An in-browser, photo-realistic simulator of the Icom **IC-M503** marine VHF
transceiver and its optional **DS-100** Class D DSC controller. Static
HTML/CSS/JS, no build step, no dependencies — open `index.html` (or serve
the folder) and it runs.

Built from the original Icom instruction manuals in `assets/manuals/` —
see `docs/MENU-STRUCTURE.md` for the full button/menu spec this simulator
implements, and `docs/ROADMAP.md` for where it's headed (AI-generated
radio traffic, and a trainer for the German Seefunkzeugnis exam).

## Running it

```
python3 -m http.server 8000
```

then open `http://localhost:8000`. Any static file server works; it's
plain HTML/CSS/JS with no build step.

## Layout

```
index.html                 entry point, wires everything together
css/style.css               all styling, responsive layout, LCD look
js/knob.js                   reusable drag/wheel rotary-knob component
js/channels.js               VHF channel data (International list)
js/dsc-bus.js                 pub/sub bus for DSC messages (Stage 2 hook)
js/m503.js                    IC-M503 state machine + rendering
js/ds100-screens.js            DS-100 screen table (config: content + input handling per screen)
js/ds100.js                     DS-100 engine that interprets ds100-screens.js
js/challenges-data.js            105-task SRC exam catalog, parsed from docs/Test_questions
js/challenges.js                  device validators layered onto the catalog above
js/challenge-ui.js                 Training tab: category/challenge browser + live checklist
js/main.js                          boot, cross-unit wiring, responsive layout
assets/img/                    cropped faceplate photos used by the UI
assets/img/source/              original uploaded photos (uncropped)
assets/manuals/                 original PDF manuals
docs/Test_questions            official DSV/DMYV 105-task practical exam catalog (German)
docs/                        functional spec + roadmap
```

## The knob

The big channel selector (and the small VOL/SQL knobs) work the same way
on a phone and on a desktop: press and drag in a circle around the knob —
the angle you sweep maps to detented steps, just like the physical
encoder — or use a mouse wheel / trackpad scroll while hovering over it.
See `js/knob.js`.
