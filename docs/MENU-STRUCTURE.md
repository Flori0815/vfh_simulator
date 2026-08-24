# Menu & Function Structure (from the original manuals)

Source: `assets/manuals/IC-M503.pdf` (Icom IC-M503 VHF Marine Transceiver
Instruction Manual) and `assets/manuals/DS-100_instruction_manual.pdf`
(Icom DS-100 (#02) DSC Controller Instruction Manual). This document is the
functional spec the simulator is built from — keep it in sync with the code.

## IC-M503 — front panel controls

| Control | Primary action | Secondary / hold action |
|---|---|---|
| `POWER` | Toggle power ON/OFF | — |
| `VOL` (rotary) | Audio level | — |
| `SQL` (rotary) | Squelch threshold | — |
| Channel selector (big rotary) | Change channel / set-mode value | — |
| `DIMMER` | Cycle 8 backlight levels | Hold 1s: toggle intercom mode |
| `CALL` | Select call channel | Hold 3s: enter call-channel programming. Hold+`HI/LO`: memory name programming |
| `16` | Select Channel 16 | Hold while powering on: enter Set Mode |
| `DIAL` | Exit Channel 16 / call channel back to normal operation | Hold+`HI/LO`: change channel group (INT/USA/Holland/ATIS/DSC depending on version) |
| `SCAN/TAG` | Start/stop scan | Hold 1s: tag current channel. Hold+`HI/LO` hold 3s: clear all tags in group |
| `DUAL` | Start/stop dualwatch or tri-watch (per Set Mode selection) | — |
| `HI/LO` | Toggle 25W / 1W transmit power | Held down, acts as the *modifier* key for the secondary actions above |

### Function display fields
`BUSY`/`TX`, `25W`/`1W`, `TAG`, `SC` (scrambler), `DUP` (duplex), `CALLING`,
channel name/comment, channel number (`A` = simplex), channel group indicator
(`INTL`/`USA`/`HOLLAND`/`ATIS`/DSC), `CALL` (call channel active),
`DUAL`/`TRI`, `INT` (intercom).

### Set Mode (hold `16` while powering on)
Cycle items with `16`, change value by rotating the channel selector:
`Scan mode` (Priority default / Normal) · `Scan resume timer` (ON default / OFF)
· `Dual/Tri watch` (Dual default / Tri) · `Beep tone` (ON default / OFF) ·
`Internal speaker` (ON default / OFF) · `LCD contrast` (1–8, default 4) ·
`Scrambler code` (0–127 or 1–32) · `Scrambler type` (UT-98/UT-112) ·
`ATIS check` (read-only, FRG version).

### Channel groups
International (57 ch, all versions) · U.S.A. (58 ch, U.K. version) ·
Holland (59 ch, Holland version) · ATIS/DSC (57 ch each, FRG version).
Switch groups with `HI/LO`+`DIAL`. This simulator ships the International
list (`js/channels.js`) plus a DSC/Ch70 marker; other regional lists can be
added the same way later.

### Dualwatch / Tri-watch
Dualwatch = monitor Ch16 while listening to the selected channel. Tri-watch
= monitor Ch16 **and** the call channel. A signal on Ch16 always takes
priority and pauses the watch; a signal on the call channel during
tri-watch downgrades it to dualwatch until the signal clears.

### Scan
Two modes, chosen in Set Mode: **Priority scan** cycles tag channels while
still checking Ch16 between them; **Normal scan** cycles tag channels only.
Channels are tagged per channel-group with `SCAN/TAG` (hold 1s).

## DS-100 DSC Controller — front panel controls

| Control | Action |
|---|---|
| `DISTRESS` (guarded, red) | Hold 5s → transmit a DSC distress alert on Ch70, then auto-switch to Ch16 to wait for/give voice follow-up |
| `CLR` | Cancel current menu / cancel call-repeat (sends a "cancel acknowledgement" if held during distress repeat) |
| `CALL` | Open the Subject menu / return to the home screen |
| `ENT` | Confirm / drill into the highlighted item |
| `▲ ▼ ◀ ▶` | Navigate menu items (▲/▼) and move the text cursor (◀/▶) |
| Keypad `0`–`9`, `A/a`, `BS` | Numeric/alpha entry (MMSI, names, positions); `A/a` cycles caps/lower/numeric, `BS` backspaces |

### Subject menu (`CALL`, then ▲/▼, `ENT`)
`Entry Position/Time` (manual GPS fallback) · `Individual call` ·
`Group call` · `All ships call` · `Received calls` · `Distress setting` ·
`Set-up`.

### Distress call
Simple operation: hold `DISTRESS` 5s → transmits "Undesignated distress"
immediately with current position/time. Regular operation: pick a
**nature of distress** first via `Distress setting` (Fire/Explosion,
Flooding, Collision, Grounding, Capsizing, Sinking, Disabled/adrift,
Abandoning ship, Piracy attack, Man overboard, EPIRB emission — valid for
10 minutes, else reverts to undesignated) then hold `DISTRESS` 5s. The
call repeats every 3.5–4.5 min with a loud 1s beep until an acknowledgement
arrives or `CLR` cancels it (which itself transmits a cancel message).

### Individual / Group / All-ships calls
Select an address (manual 9-digit MMSI entry, or a saved Address/Group ID),
optionally change the proposed traffic channel (defaults to Ch16), then
press `CALL`+`ENT` together to transmit.

### Receiving calls
Distress, Individual, Group, All-ships, Position request/reply and the
various acknowledgements each have their own alert tone and screen
(modeled 1:1 in `docs/MENU-STRUCTURE.md` → `js/dsc-bus.js`). Distress
messages are stored separately, up to 20 distress + 20 other messages in
the `Received calls` log; non-distress messages clear on power-off.

### Set-up
`Address ID` (add/delete individual + group IDs, 70 total) · `Offset time`
(local time offset) · `Brightness` (1–8) · `Contrast` (1–8) · `MMSI check`
(read own ID).

## Cross-unit behavior
- DS-100 distress/individual/group/all-ships calls put the IC-M503 on
  Ch70 to transmit, then Ch16 automatically afterwards.
- An incoming DSC alert on the DS-100 forces the IC-M503 to Ch16.
- The DS-100 needs its own MMSI programmed to function — modeled as a
  required `Set-up → Address ID` self-check before distress calls work,
  matching "The DS-100 does not function when there is no ID is
  programmed."
