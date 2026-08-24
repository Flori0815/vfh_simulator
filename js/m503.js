/**
 * IC-M503 state machine + rendering. See docs/MENU-STRUCTURE.md for the
 * behavior this implements (derived from assets/manuals/IC-M503.pdf).
 */
(function (global) {
  "use strict";

  const NAME_CHARSET =
    ' ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!"#$%&\'()*+,-./';

  const SET_MODE_ITEMS = [
    { key: "scanMode", label: "Scan mode" },
    { key: "scanTimer", label: "Scan resume timer" },
    { key: "dualTri", label: "Dual/Tri watch" },
    { key: "beep", label: "Beep tone" },
    { key: "internalSpeaker", label: "Internal speaker" },
    { key: "lcdContrast", label: "LCD contrast" },
    { key: "scramblerCode", label: "Scrambler code" },
    { key: "scramblerType", label: "Scrambler type" },
    { key: "atisCheck", label: "ATIS check" },
  ];

  function createM503(root) {
    const el = {
      lcd: root.querySelector("#m503-lcd"),
      channum: root.querySelector("#m503-channum"),
      group: root.querySelector("#m503-group"),
      name: root.querySelector("#m503-name"),
      status: root.querySelector("#m503-status"),
      btn16: root.querySelector("#m503-btn-16"),
      btnDual: root.querySelector("#m503-btn-dual"),
      btnScan: root.querySelector("#m503-btn-scan"),
      btnDial: root.querySelector("#m503-btn-dial"),
      btnCall: root.querySelector("#m503-btn-call"),
      btnPower: root.querySelector("#m503-btn-power"),
      btnHiLo: root.querySelector("#m503-btn-hilo"),
      btnDimmer: root.querySelector("#m503-btn-dimmer"),
      knobVol: root.querySelector("#m503-knob-vol"),
      knobSql: root.querySelector("#m503-knob-sql"),
      knobChannel: root.querySelector("#m503-knob-channel"),
    };

    const state = {
      power: false,
      volume: 60,
      squelch: 20,
      channel: 6,
      group: "INTL",
      mode: "normal", // normal | ch16 | call | setmode | nameedit
      hi: true, // 25W (true) / 1W (false)
      hiBeforeCh16: null, // power level to restore when leaving Ch16
      callChannel: null,
      dual: "off", // off | dual | tri
      dualTriChoice: "dual",
      scanning: false,
      scanType: "priority",
      scanTimer: true,
      tags: new Set(),
      dimmer: 4,
      beep: true,
      internalSpeaker: true,
      lcdContrast: 4,
      scrambler: false,
      scramblerCode: 0,
      scramblerType: "UT-98",
      intercom: false,
      channelNames: {},
      setModeIndex: 0,
      programmingCall: false,
      programmingCallChannel: null,
      nameEdit: null, // { chars: string[], cursor: number }
      heldButtons: new Set(),
      hiloConsumed: false,
      // HI/LO's secondary functions are physically "hold HI/LO, press another
      // key" — impossible for a single mouse pointer (only real on a touch
      // screen with two fingers, or two hands on the real device). hiloLatched
      // is a single-pointer-friendly alternative: a long-press on HI/LO arms
      // the modifier so the *next* tap on another control consumes it, same
      // as physically holding it would have.
      hiloLatched: false,
      setModeArmed: false, // same idea for "hold 16, then press POWER"
    };

    function toast(msg) {
      if (global.simToast) global.simToast(msg);
    }
    function beep() {
      /* placeholder for a future audio cue; state.beep gates it */
    }

    function currentDisplayChannel() {
      if (state.mode === "call") return state.callChannel;
      return state.channel;
    }

    function markHiloConsumed() {
      state.hiloConsumed = true;
      state.hiloLatched = false;
    }
    function hiloModifierActive() {
      return state.heldButtons.has("hilo") || state.hiloLatched;
    }

    // ---- power -------------------------------------------------------
    function powerOn(intoSetMode) {
      state.power = true;
      if (intoSetMode) {
        state.mode = "setmode";
        state.setModeIndex = 0;
      } else {
        state.mode = "normal";
      }
      render();
    }
    function powerOff() {
      state.power = false;
      state.mode = "normal";
      state.scanning = false;
      state.dual = "off";
      state.intercom = false;
      state.programmingCall = false;
      state.nameEdit = null;
      render();
    }

    // ---- channel changes -----------------------------------------------
    function stepChannel(dir) {
      if (state.mode === "setmode") return adjustSetModeValue(dir);
      if (state.mode === "nameedit") return stepNameChar(dir);
      if (state.programmingCall) {
        state.programmingCallChannel = global.VHFChannels.nextChannel(
          state.programmingCallChannel,
          dir
        );
        return render();
      }
      if (state.mode === "ch16" || state.mode === "call") {
        if (state.mode === "ch16" && state.hiBeforeCh16 != null) {
          state.hi = state.hiBeforeCh16;
          state.hiBeforeCh16 = null;
        }
        state.mode = "normal";
      }
      if (state.scanning) state.scanning = false;
      state.channel = global.VHFChannels.nextChannel(state.channel, dir);
      render();
    }

    function adjustSetModeValue(dir) {
      const item = SET_MODE_ITEMS[state.setModeIndex].key;
      switch (item) {
        case "scanMode":
          state.scanType = state.scanType === "priority" ? "normal" : "priority";
          break;
        case "scanTimer":
          state.scanTimer = !state.scanTimer;
          break;
        case "dualTri":
          state.dualTriChoice = state.dualTriChoice === "dual" ? "tri" : "dual";
          break;
        case "beep":
          state.beep = !state.beep;
          break;
        case "internalSpeaker":
          state.internalSpeaker = !state.internalSpeaker;
          break;
        case "lcdContrast":
          state.lcdContrast = Math.max(1, Math.min(8, state.lcdContrast + dir));
          break;
        case "scramblerCode":
          state.scramblerCode = Math.max(0, Math.min(127, state.scramblerCode + dir));
          break;
        case "scramblerType":
          state.scramblerType = state.scramblerType === "UT-98" ? "UT-112" : "UT-98";
          break;
        case "atisCheck":
          break; // read-only
      }
      render();
    }

    function stepNameChar(dir) {
      const ed = state.nameEdit;
      if (!ed) return;
      const cur = ed.chars[ed.cursor];
      let idx = NAME_CHARSET.indexOf(cur);
      if (idx === -1) idx = 0;
      idx = (idx + dir + NAME_CHARSET.length) % NAME_CHARSET.length;
      ed.chars[ed.cursor] = NAME_CHARSET[idx];
      render();
    }

    // ---- 16 ------------------------------------------------------------
    function on16Tap() {
      if (!state.power) return;
      if (state.mode === "setmode") {
        state.setModeIndex = (state.setModeIndex + 1) % SET_MODE_ITEMS.length;
        return render();
      }
      // "Output power turns to 25W automatically, whenever Channel 16 is
      // selected" — save the prior power level (unless already parked on
      // ch16) so DIAL can restore it on exit.
      if (state.mode !== "ch16") {
        state.hiBeforeCh16 = state.hi;
      }
      state.hi = true;
      state.mode = "ch16";
      state.scanning = false;
      render();
    }

    // ---- DIAL ------------------------------------------------------------
    function onDialTap() {
      if (!state.power || state.mode === "setmode") return;
      if (state.mode === "nameedit") {
        state.nameEdit.cursor = Math.max(0, state.nameEdit.cursor - 1);
        return render();
      }
      if (state.programmingCall) {
        state.programmingCall = false; // cancel
        toast("Call channel programming cancelled");
        return render();
      }
      if (hiloModifierActive()) {
        markHiloConsumed();
        cycleGroup();
        return;
      }
      if (state.mode === "ch16" || state.mode === "call") {
        if (state.mode === "ch16" && state.hiBeforeCh16 != null) {
          state.hi = state.hiBeforeCh16; // "Output power returns to the previous output power automatically"
          state.hiBeforeCh16 = null;
        }
        state.mode = "normal";
        render();
      }
    }
    function onDialHold() {
      if (!state.power || state.mode === "setmode") return;
      if (hiloModifierActive()) {
        markHiloConsumed();
        state.tags.clear();
        toast(`All tag channels cleared (${state.group})`);
        render();
      }
    }
    function cycleGroup() {
      const groups = ["INTL", "USA", "HOLLAND", "ATIS", "DSC"];
      const idx = groups.indexOf(state.group);
      state.group = groups[(idx + 1) % groups.length];
      if (state.group !== "INTL") {
        toast(`${state.group} channel plan is not modeled in this simulator yet — showing International frequencies`);
      }
      render();
    }

    // ---- CALL ------------------------------------------------------------
    function onCallTap() {
      if (!state.power || state.mode === "setmode") return;
      if (state.mode === "nameedit") return commitNameEdit();
      if (state.programmingCall) {
        state.callChannel = state.programmingCallChannel;
        state.programmingCall = false;
        toast(`Call channel set to CH ${state.callChannel}`);
        return render();
      }
      if (hiloModifierActive()) {
        markHiloConsumed();
        return startNameEdit();
      }
      if (state.callChannel == null) {
        toast("No call channel programmed — hold CALL for 3s to program one");
        return;
      }
      state.mode = "call";
      render();
    }
    function onCallHold() {
      if (!state.power || state.mode === "setmode" || state.mode === "nameedit") return;
      if (hiloModifierActive()) {
        markHiloConsumed();
        return startNameEdit();
      }
      state.programmingCall = true;
      state.programmingCallChannel = state.channel;
      toast("Programming call channel — rotate to choose, CALL to save, DIAL to cancel");
      render();
    }
    function startNameEdit() {
      const ch = currentDisplayChannel();
      const existing = (state.channelNames[ch] || "").padEnd(10, " ").slice(0, 10);
      state.nameEdit = { channel: ch, chars: existing.split(""), cursor: 0 };
      state.mode = "nameedit";
      render();
    }
    function commitNameEdit() {
      const ed = state.nameEdit;
      const name = ed.chars.join("").replace(/\s+$/, "");
      state.channelNames[ed.channel] = name;
      state.nameEdit = null;
      state.mode = "normal";
      toast(name ? `Channel ${ed.channel} name set to "${name}"` : `Channel ${ed.channel} name cleared`);
      render();
    }

    // ---- SCAN/TAG --------------------------------------------------------
    function onScanTap() {
      if (!state.power || state.mode === "setmode") return;
      if (state.mode === "nameedit") {
        state.nameEdit.cursor = Math.min(9, state.nameEdit.cursor + 1);
        return render();
      }
      if (state.tags.size === 0) {
        toast("No tag channels set — hold SCAN 1s on a channel to tag it");
        return;
      }
      state.scanning = !state.scanning;
      state.mode = "normal";
      render();
    }
    function onScanHold() {
      if (!state.power || state.mode === "setmode" || state.mode === "nameedit") return;
      const ch = state.channel;
      if (state.tags.has(ch)) {
        state.tags.delete(ch);
        toast(`Channel ${ch} un-tagged`);
      } else {
        state.tags.add(ch);
        toast(`Channel ${ch} tagged for scan`);
      }
      render();
    }

    // ---- DUAL --------------------------------------------------------------
    function onDualTap() {
      if (!state.power || state.mode === "setmode") return;
      if (state.dual !== "off") {
        state.dual = "off";
      } else {
        state.dual = state.dualTriChoice;
      }
      render();
    }

    // ---- HI/LO ---------------------------------------------------------------
    let hiloLatchTimer = null;
    let hiloLatchCancelledByThisPress = false;
    function onHiLoDown() {
      if (state.hiloLatched) {
        // Tapping HI/LO again while latched cancels the latch instead of
        // toggling power — an explicit "never mind".
        state.hiloLatched = false;
        hiloLatchCancelledByThisPress = true;
        render();
      } else {
        hiloLatchCancelledByThisPress = false;
      }
      state.heldButtons.add("hilo");
      state.hiloConsumed = false;
      clearTimeout(hiloLatchTimer);
      hiloLatchTimer = setTimeout(() => {
        if (state.heldButtons.has("hilo")) {
          state.hiloLatched = true;
          toast("HI/LO latched — tap DIAL, CALL or DIMMER for its secondary function");
          render();
          setTimeout(() => {
            if (state.hiloLatched) {
              state.hiloLatched = false;
              render();
            }
          }, 6000);
        }
      }, 550);
    }
    function onHiLoUp() {
      clearTimeout(hiloLatchTimer);
      state.heldButtons.delete("hilo");
      if (!state.power) return render();
      if (hiloLatchCancelledByThisPress) return render();
      if (state.hiloLatched) return render(); // just armed by this press; stays latched after release
      if (!state.hiloConsumed) {
        state.hi = !state.hi;
      }
      render();
    }

    // ---- DIMMER -------------------------------------------------------------
    function onDimmerTap() {
      if (!state.power || state.mode === "setmode") return;
      if (hiloModifierActive()) {
        markHiloConsumed();
        state.scrambler = !state.scrambler;
        toast(`Voice scrambler ${state.scrambler ? "ON" : "OFF"}`);
        return render();
      }
      if (state.intercom) {
        state.intercom = false;
        return render();
      }
      state.dimmer = state.dimmer >= 8 ? 1 : state.dimmer + 1;
      render();
    }
    function onDimmerHold() {
      if (!state.power || state.mode === "setmode") return;
      if (hiloModifierActive()) return; // scrambler toggle already handled on tap
      state.intercom = true;
      render();
    }

    // ---- POWER -----------------------------------------------------------
    function onPowerTap() {
      if (state.power) {
        powerOff();
      } else {
        powerOn(state.heldButtons.has("ch16") || state.setModeArmed);
      }
      state.setModeArmed = false;
    }

    // ---- rendering ---------------------------------------------------------
    function setInd(name, on) {
      const node = el.lcd.querySelector(`[data-ind="${name}"]`);
      if (node) node.classList.toggle("is-on", !!on);
    }

    function render() {
      root.classList.toggle("is-powered", state.power);
      root.style.setProperty("--m503-contrast", state.lcdContrast / 8);
      el.btnHiLo.classList.toggle("is-pressed", state.heldButtons.has("hilo"));
      el.btnHiLo.classList.toggle("is-latched", state.hiloLatched);
      el.btn16.classList.toggle("is-latched", state.setModeArmed);

      if (!state.power) {
        el.channum.textContent = "";
        el.group.textContent = "";
        el.name.textContent = "";
        ["busy", "tx", "int", "pwr", "tag", "sc", "dup", "watch", "call"].forEach((k) =>
          setInd(k, false)
        );
        el.status.textContent = "Power off";
        return;
      }

      const chInfo = global.VHFChannels.getChannel(state.channel);

      if (state.mode === "setmode") {
        const item = SET_MODE_ITEMS[state.setModeIndex];
        el.group.textContent = "SET MODE";
        el.channum.textContent = setModeValueLabel(item.key);
        el.name.textContent = item.label;
        el.status.textContent = `Set Mode — ${item.label}: ${setModeValueLabel(item.key)} (rotate to change, push 16 for next item, power off to exit)`;
        ["busy", "tx", "int", "pwr", "tag", "sc", "dup", "watch", "call"].forEach((k) =>
          setInd(k, false)
        );
        return;
      }

      if (state.mode === "nameedit") {
        const ed = state.nameEdit;
        el.channum.textContent = ed.channel;
        el.group.textContent = state.group;
        el.name.innerHTML = ed.chars
          .map((c, i) => (i === ed.cursor ? `<u>${c === " " ? "&nbsp;" : c}</u>` : c === " " ? "&nbsp;" : c))
          .join("");
        el.status.textContent = `Editing name for channel ${ed.channel} — rotate to change letter, SCAN/DIAL to move cursor, CALL to save`;
        return;
      }

      const displayChannel = state.programmingCall
        ? state.programmingCallChannel
        : currentDisplayChannel();
      el.channum.textContent = displayChannel;
      el.channum.classList.toggle("is-flashing", state.programmingCall);
      el.group.textContent = state.group;
      el.name.textContent = state.programmingCall
        ? "Programming call channel…"
        : state.channelNames[displayChannel] || "";

      setInd("int", state.intercom);
      setInd("tag", state.tags.has(state.channel));
      setInd("sc", state.scrambler);
      setInd("dup", !!(chInfo && chInfo.duplex));
      setInd("call", state.mode === "call");
      setInd("busy", false);
      setInd("tx", false);

      const pwrInd = el.lcd.querySelector('[data-ind="pwr"]');
      pwrInd.textContent = state.hi ? "25W" : "1W";
      setInd("pwr", true);

      const watchInd = el.lcd.querySelector('[data-ind="watch"]');
      watchInd.textContent = state.dual === "tri" ? "TRI" : "DUAL";
      setInd("watch", state.dual !== "off");

      let statusBits = [];
      if (state.mode === "ch16") statusBits.push("Channel 16 — distress & safety");
      else if (state.mode === "call") statusBits.push(`Call channel ${state.callChannel}`);
      else if (state.programmingCall)
        statusBits.push(`Programming call channel: CH ${state.programmingCallChannel}`);
      else statusBits.push(`Channel ${state.channel}${chInfo ? ` (${chInfo.tx.toFixed(3)} MHz${chInfo.duplex ? " dup" : ""})` : ""}`);
      statusBits.push(state.hi ? "25 W" : "1 W");
      if (state.scanning) statusBits.push(`Scanning (${state.scanType})`);
      if (state.dual !== "off") statusBits.push(state.dual === "tri" ? "Tri-watch" : "Dualwatch");
      if (state.intercom) statusBits.push("Intercom");
      el.status.textContent = statusBits.join(" · ");
    }

    function setModeValueLabel(key) {
      switch (key) {
        case "scanMode":
          return state.scanType === "priority" ? "Priority" : "Normal";
        case "scanTimer":
          return state.scanTimer ? "ON" : "OFF";
        case "dualTri":
          return state.dualTriChoice === "tri" ? "Tri-watch" : "Dual watch";
        case "beep":
          return state.beep ? "ON" : "OFF";
        case "internalSpeaker":
          return state.internalSpeaker ? "ON" : "OFF";
        case "lcdContrast":
          return String(state.lcdContrast);
        case "scramblerCode":
          return String(state.scramblerCode);
        case "scramblerType":
          return state.scramblerType;
        case "atisCheck":
          return "0123456789";
        default:
          return "";
      }
    }

    // ---- wiring: tap/hold helper --------------------------------------------
    function bindTapHold(button, key, { onTap, onHold, holdMs = 900 } = {}) {
      let timer = null;
      let held = false;
      button.addEventListener("pointerdown", (evt) => {
        evt.preventDefault();
        held = false;
        if (key) state.heldButtons.add(key);
        button.classList.add("is-pressed");
        if (onHold) {
          timer = setTimeout(() => {
            held = true;
            onHold();
          }, holdMs);
        }
      });
      const release = () => {
        if (timer) clearTimeout(timer);
        button.classList.remove("is-pressed");
        if (key) state.heldButtons.delete(key);
        if (!held && onTap) onTap();
      };
      button.addEventListener("pointerup", release);
      button.addEventListener("pointerleave", (evt) => {
        if (timer) clearTimeout(timer);
        button.classList.remove("is-pressed");
        if (key) state.heldButtons.delete(key);
      });
    }

    bindTapHold(el.btn16, "ch16", {
      onTap: on16Tap,
      holdMs: 600,
      onHold: () => {
        // Long-press 16 (instead of physically holding it while also
        // pressing POWER — impossible with one mouse pointer) arms Set
        // Mode; the next POWER press enters it. Only meaningful while off.
        if (!state.power) {
          state.setModeArmed = true;
          toast("Set Mode armed — press POWER to enter");
          render();
        }
      },
    });
    bindTapHold(el.btnDial, null, { onTap: onDialTap, onHold: onDialHold, holdMs: 3000 });
    bindTapHold(el.btnCall, null, { onTap: onCallTap, onHold: onCallHold, holdMs: 3000 });
    bindTapHold(el.btnScan, null, { onTap: onScanTap, onHold: onScanHold, holdMs: 1000 });
    bindTapHold(el.btnDual, null, { onTap: onDualTap });
    bindTapHold(el.btnDimmer, null, { onTap: onDimmerTap, onHold: onDimmerHold, holdMs: 1000 });
    bindTapHold(el.btnPower, null, { onTap: onPowerTap });

    el.btnHiLo.addEventListener("pointerdown", (evt) => {
      evt.preventDefault();
      onHiLoDown();
      el.btnHiLo.classList.add("is-pressed");
    });
    el.btnHiLo.addEventListener("pointerup", () => {
      onHiLoUp();
      el.btnHiLo.classList.remove("is-pressed");
    });
    el.btnHiLo.addEventListener("pointerleave", () => {
      el.btnHiLo.classList.remove("is-pressed");
    });

    new global.RotaryKnob(el.knobVol, {
      continuous: false,
      value: state.volume,
      label: "Volume",
      onChange: (v) => (state.volume = v),
    });
    new global.RotaryKnob(el.knobSql, {
      continuous: false,
      value: state.squelch,
      label: "Squelch",
      onChange: (v) => (state.squelch = v),
    });
    new global.RotaryKnob(el.knobChannel, {
      continuous: true,
      degreesPerStep: 16,
      label: "Channel selector",
      onStep: (dir) => stepChannel(dir),
    });

    render();

    return { state, render, powerOn, powerOff, selectCh16: on16Tap, selectChannel: (n) => {
      if (!state.power) return;
      if (state.mode === "ch16" && state.hiBeforeCh16 != null) {
        state.hi = state.hiBeforeCh16;
        state.hiBeforeCh16 = null;
      }
      state.mode = "normal";
      state.channel = n;
      render();
    } };
  }

  global.createM503 = createM503;
})(window);
