/**
 * DS-100 DSC Controller — engine. Screen content and per-screen input
 * handling live in js/ds100-screens.js (window.DS100_CONFIG); this file
 * is the generic interpreter: state shape, the action log (used by the
 * exam-challenge validators in js/challenges.js), generic list/text-entry
 * navigation, DSC transmit/receive plumbing, and DOM wiring.
 *
 * See docs/MENU-STRUCTURE.md (derived from assets/manuals/DS-100_instruction_manual.pdf).
 *
 * All outgoing calls are published on window.dscBus so other modules (the
 * IC-M503 cross-wiring in main.js today, an AI backend in Stage 2) can
 * react without this file knowing about them. Incoming traffic — whether
 * from the debug panel or, later, an AI — arrives the same way, via
 * dscBus.incoming(...).
 */
(function (global) {
  "use strict";

  const CFG = global.DS100_CONFIG;
  const { DISTRESS_NATURES, KEYPAD_LETTERS } = CFG;

  function pad(n, len) {
    return String(n).padStart(len, "0");
  }
  function fmtLat(lat) {
    const h = lat >= 0 ? "N" : "S";
    return `${Math.abs(lat).toFixed(2)}'${h}`;
  }
  function fmtLon(lon) {
    const h = lon >= 0 ? "E" : "W";
    return `${Math.abs(lon).toFixed(2)}'${h}`;
  }
  function fmtUTC(d) {
    return `${pad(d.getUTCHours(), 2)}:${pad(d.getUTCMinutes(), 2)}`;
  }

  // The real LCD only shows a handful of lines at once; long lists (the
  // subject menu, the 12 distress natures, …) scroll with the selection
  // rather than dumping every item, which is also what keeps the text
  // from overflowing the display area.
  const MAX_LIST_LINES = 5;
  function windowLines(lines, selectedIndex, maxLines) {
    maxLines = maxLines || MAX_LIST_LINES;
    if (lines.length <= maxLines) return lines.join("\n");
    const idx = selectedIndex || 0;
    let start = Math.min(Math.max(0, idx - Math.floor((maxLines - 1) / 2)), lines.length - maxLines);
    const windowed = lines.slice(start, start + maxLines);
    if (start > 0) windowed[0] = "↑" + windowed[0].slice(1);
    if (start + maxLines < lines.length) {
      windowed[windowed.length - 1] = "↓" + windowed[windowed.length - 1].slice(1);
    }
    return windowed.join("\n");
  }

  function createDS100(root) {
    const el = {
      title: root.querySelector("#ds100-title"),
      body: root.querySelector("#ds100-body"),
      foot: root.querySelector("#ds100-foot"),
      status: root.querySelector("#ds100-status"),
      distress: root.querySelector("#ds100-btn-distress"),
      clr: root.querySelector("#ds100-btn-clr"),
      call: root.querySelector("#ds100-btn-call"),
      ent: root.querySelector("#ds100-btn-ent"),
      up: root.querySelector("#ds100-btn-up"),
      down: root.querySelector("#ds100-btn-down"),
      left: root.querySelector("#ds100-btn-left"),
      right: root.querySelector("#ds100-btn-right"),
      keys: Array.from(root.querySelectorAll(".ctrl--ds100-key")),
    };

    const state = {
      mmsi: "211234567",
      screen: "home",
      flow: {},
      gpsConnected: true,
      position: { lat: 53.5511, lon: 9.9937 },
      manualPosition: null,
      manualTime: null,
      addressBook: [
        { id: "244670181", name: "DS-100 SN10" },
        { id: "211567892", name: "DS-100 SN2" },
        { id: "211567893", name: "DS-100 SN3" },
      ],
      groupBook: [{ id: "00302340", name: "ICOM" }],
      distressNature: "undesignated",
      distressNatureExpiry: 0,
      awaitingAck: false,
      distressRepeatHandle: null,
      offsetMinutes: 0,
      brightness: 4,
      contrast: 4,
      receivedDistress: [],
      receivedOther: [],
      keypadMode: "caps", // caps | small | num
      multitap: null, // { key, index, at }
      armTimer: null,
      distressArmedAt: null,
      // Rolling log of meaningful events, newest last — this is what the
      // exam-challenge validators (js/challenges.js) inspect to grade a
      // run. Capped so a long session doesn't grow it unbounded.
      log: [],
    };

    function log(type, data) {
      state.log.push(Object.assign({ type, at: Date.now() }, data));
      if (state.log.length > 500) state.log.shift();
    }

    function toast(msg) {
      if (global.simToast) global.simToast(msg);
    }

    function goHome() {
      state.screen = "home";
      state.flow = {};
      render();
    }
    function goto(screen, flow) {
      state.screen = screen;
      state.flow = flow || {};
      log("screen", { id: screen });
      render();
    }

    // ---------------------------------------------------------------- clock
    setInterval(() => {
      if (state.screen === "home" || state.screen === "distressWaiting") render();
    }, 1000);

    function currentTimeLabel() {
      const d = new Date(Date.now() + state.offsetMinutes * 60000);
      return fmtUTC(d);
    }

    // ------------------------------------------------------------- distress
    function activeDistressNature() {
      if (state.distressNatureExpiry && Date.now() > state.distressNatureExpiry) {
        state.distressNature = "undesignated";
      }
      return state.distressNature;
    }

    function transmitDistress() {
      const nature = activeDistressNature();
      const msg = global.dscBus.outgoing("distress", {
        fromMMSI: state.mmsi,
        natureOfDistress: nature,
        position: state.manualPosition || state.position,
        time: currentTimeLabel(),
      });
      state.awaitingAck = true;
      goto("distressWaiting");
      log("distress_tx", { nature });
      toast(`DISTRESS transmitted on Ch70 (${DISTRESS_NATURES.find((n) => n[0] === nature)[1]})`);
      scheduleDistressRepeat();
      return msg;
    }
    function scheduleDistressRepeat() {
      clearTimeout(state.distressRepeatHandle);
      const delay = (3.5 + Math.random()) * 60 * 1000; // 3.5-4.5 min, per manual
      state.distressRepeatHandle = setTimeout(() => {
        if (state.awaitingAck) transmitDistress();
      }, delay);
    }
    function cancelDistress() {
      clearTimeout(state.distressRepeatHandle);
      state.awaitingAck = false;
      log("distress_cancel", {});
      toast("Distress cancel acknowledgement transmitted");
      goHome();
    }

    function armDistress() {
      el.distress.classList.add("is-armed");
      state.distressArmedAt = Date.now();
      state.armTimer = setTimeout(() => {
        el.distress.classList.remove("is-armed");
        transmitDistress();
      }, 5000);
    }
    function disarmDistress() {
      clearTimeout(state.armTimer);
      el.distress.classList.remove("is-armed");
      if (state.distressArmedAt) {
        log("distress_release", { heldMs: Date.now() - state.distressArmedAt });
        state.distressArmedAt = null;
      }
    }

    // ------------------------------------------------------- outgoing calls
    function transmitIndividual(flow) {
      global.dscBus.outgoing("individual", {
        fromMMSI: state.mmsi,
        toMMSI: flow.id,
        channel: flow.channel,
        category: "routine",
      });
      log("call_tx", { kind: "individual", toMMSI: flow.id, channel: flow.channel });
      toast(`Individual call sent to ${flow.name || flow.id} on Ch${flow.channel}`);
      goHome();
    }
    function transmitGroup(flow) {
      global.dscBus.outgoing("group", {
        fromMMSI: state.mmsi,
        groupId: flow.id,
        channel: flow.channel,
        category: "routine",
      });
      log("call_tx", { kind: "group", groupId: flow.id, channel: flow.channel });
      toast(`Group call sent to ${flow.name || flow.id} on Ch${flow.channel}`);
      goHome();
    }
    function transmitAllShips(flow) {
      global.dscBus.outgoing("all_ships", {
        fromMMSI: state.mmsi,
        channel: flow.channel,
        category: flow.category,
      });
      log("call_tx", { kind: "all_ships", category: flow.category, channel: flow.channel });
      toast(`All ships call sent (${flow.category}) on Ch${flow.channel}`);
      goHome();
    }

    // ------------------------------------------------------------- incoming
    function pushReceived(kind, message) {
      const entry = { kind, message, at: new Date() };
      if (kind === "distress" || kind === "distress_relay") {
        state.receivedDistress.unshift(entry);
        state.receivedDistress = state.receivedDistress.slice(0, 20);
      } else {
        state.receivedOther.unshift(entry);
        state.receivedOther = state.receivedOther.slice(0, 20);
      }
    }

    global.dscBus.on("incoming", (message) => {
      pushReceived(message.kind, message);
      alertFor(message);
      render();
    });

    function alertFor(message) {
      const labels = {
        distress: "RCV Distress call",
        distress_relay: "RCV Distress relay",
        distress_ack: "RCV Distress ACK",
        distress_relay_ack: "RCV Distress RLY ACK",
        individual: "RCV Individual call",
        individual_ack: "RCV Individual ACK",
        group: "RCV Group call",
        all_ships: "RCV All ships call",
        position_request: "RCV Position request",
        position_reply: "RCV Position reply",
      };
      toast(`${labels[message.kind] || "RCV"} — from ${message.fromName || message.fromMMSI}`);
      if (["distress", "distress_relay", "distress_ack", "distress_relay_ack"].includes(message.kind)) {
        goto("incomingAlert", { message });
      }
    }

    function incomingSummary(m) {
      const lines = [`From: ${m.fromName || m.fromMMSI || "unknown"}`];
      if (m.natureOfDistress) {
        lines.push(`Distress ID: ${m.fromMMSI}`);
        lines.push(DISTRESS_NATURES.find((n) => n[0] === m.natureOfDistress)?.[1] || m.natureOfDistress);
      }
      if (m.position) lines.push(`Pos: ${fmtLat(m.position.lat)}  ${fmtLon(m.position.lon)}`);
      if (m.time) lines.push(`Time: UTC ${m.time}`);
      if (m.channel) lines.push(`Channel: ${m.channel}`);
      if (m.category) lines.push(`Category: ${m.category}`);
      return lines.join("\n");
    }

    function filteredOtherList(kind) {
      if (!kind) return [];
      return state.receivedOther.filter((e) => e.kind === kind);
    }

    // ---------------------------------------------------------------- text entry
    function commitMultitap() {
      state.multitap = null;
    }
    function insertChar(ed, ch) {
      ed.chars.splice(ed.cursor, 0, ch);
      ed.cursor++;
      if (ed.maxLen) {
        ed.chars = ed.chars.slice(0, ed.maxLen);
        ed.cursor = Math.min(ed.cursor, ed.chars.length);
      }
    }
    function inputChar(ed, key) {
      if (state.keypadMode === "num" || !KEYPAD_LETTERS[key]) {
        insertChar(ed, key);
        commitMultitap();
        return;
      }
      const letters = KEYPAD_LETTERS[key];
      const now = Date.now();
      if (state.multitap && state.multitap.key === key && now - state.multitap.at < 700 && ed.chars.length > 0) {
        const nextIndex = (state.multitap.index + 1) % letters.length;
        const ch = letters[nextIndex];
        ed.chars[ed.cursor - 1] = state.keypadMode === "small" ? ch.toLowerCase() : ch;
        state.multitap = { key, index: nextIndex, at: now };
      } else {
        const ch = letters[0];
        insertChar(ed, state.keypadMode === "small" ? ch.toLowerCase() : ch);
        state.multitap = { key, index: 0, at: now };
      }
    }
    function backspace(ed) {
      if (ed.cursor > 0) {
        ed.chars.splice(ed.cursor - 1, 1);
        ed.cursor--;
      }
      commitMultitap();
    }
    function toggleKeypadMode() {
      state.keypadMode = state.keypadMode === "caps" ? "small" : state.keypadMode === "small" ? "num" : "caps";
      commitMultitap();
      render();
    }
    function ed2str(ed) {
      if (!ed) return "";
      return ed.chars.join("");
    }
    // Which editor field a screen's flow is using, if any — individualChannel
    // etc. use `channelEd` (defaults to "16"), everything else uses `ed`.
    function activeEditor(flow) {
      return flow.ed || flow.channelEd || null;
    }

    // ---------------------------------------------------------------- ctx
    // The interface js/ds100-screens.js's screen definitions are written
    // against. Keeping it a flat object (rather than exposing the whole
    // engine) is what keeps the screen table a config file rather than
    // just "more code that happens to live in a different file".
    const ctx = {
      state,
      get flow() {
        return state.flow;
      },
      goto,
      goHome,
      toast,
      log,
      windowLines,
      ed2str,
      inputChar,
      toggleKeypadMode,
      fmtLat,
      fmtLon,
      currentTimeLabel,
      activeDistressNature,
      cancelDistress,
      transmitIndividual,
      transmitGroup,
      transmitAllShips,
      incomingSummary,
      filteredOtherList,
    };

    function currentScreen() {
      return CFG.SCREENS[state.screen] || {};
    }

    // ---------------------------------------------------------------- generic input
    function genericListNav(dir) {
      const s = currentScreen();
      if (!s.items) return;
      const n = s.items(ctx).length;
      if (!n) return;
      const cur = state.flow.index || 0;
      state.flow.index = ((cur + dir) % n + n) % n;
    }
    function genericCursorMove(dir) {
      const ed = activeEditor(state.flow);
      if (!ed) return;
      ed.cursor = Math.max(0, Math.min(ed.chars.length, ed.cursor + dir));
    }
    function genericKeyEntry(key) {
      const ed = activeEditor(state.flow);
      if (!ed) return;
      insertChar(ed, key);
    }
    function genericBackspace() {
      const f = state.flow;
      if (f.ed) {
        backspace(f.ed);
      } else if (f.channelEd) {
        // Matches the real DS-100: BS on a traffic-channel field clears it
        // fully rather than deleting one digit at a time (manual: "push
        // BS twice and enter channel number").
        f.channelEd.chars = [];
        f.channelEd.cursor = 0;
        commitMultitap();
      }
    }

    function onUp() {
      const s = currentScreen();
      if (s.up) s.up(ctx);
      else genericListNav(-1);
      render();
    }
    function onDown() {
      const s = currentScreen();
      if (s.down) s.down(ctx);
      else genericListNav(1);
      render();
    }
    function onLeft() {
      const s = currentScreen();
      if (s.left) s.left(ctx);
      else genericCursorMove(-1);
      render();
    }
    function onRight() {
      const s = currentScreen();
      if (s.right) s.right(ctx);
      else genericCursorMove(1);
      render();
    }
    function onEnt() {
      const s = currentScreen();
      if (s.ent) s.ent(ctx);
      render();
    }
    function onKeypad(key) {
      const s = currentScreen();
      if (s.key) s.key(ctx, key);
      else genericKeyEntry(key);
      render();
    }
    function onBS() {
      const s = currentScreen();
      if (s.bs) s.bs(ctx);
      else genericBackspace();
      render();
    }
    function onAa() {
      const s = currentScreen();
      if (s.aa) s.aa(ctx);
      render();
    }
    function onClr() {
      const s = currentScreen();
      if (s.clr) {
        s.clr(ctx);
        render();
      } else {
        goHome();
      }
    }
    function onCall() {
      if (state.screen === "home") {
        goto("menu", { index: 0 });
      } else {
        goHome();
      }
    }

    // ------------------------------------------------------------- render
    function render() {
      const s = currentScreen();
      const out = s.render ? s.render(ctx) : { title: "", body: "", foot: "" };
      el.title.textContent = out.title || "";
      el.body.textContent = out.body || "";
      el.foot.textContent = out.foot || "";
      root.style.setProperty("--ds100-contrast", state.contrast / 8);
      root.style.setProperty("--ds100-brightness", state.brightness / 8);
      el.status.textContent = statusLine();
    }

    function statusLine() {
      const distressCount = state.receivedDistress.length;
      const otherCount = state.receivedOther.length;
      return `MMSI ${state.mmsi} · ${distressCount} distress / ${otherCount} other message${otherCount === 1 ? "" : "s"} logged`;
    }

    // ---------------------------------------------------------------- wiring
    el.distress.addEventListener("pointerdown", (evt) => {
      evt.preventDefault();
      armDistress();
    });
    el.distress.addEventListener("pointerup", disarmDistress);
    el.distress.addEventListener("pointerleave", disarmDistress);

    el.clr.addEventListener("click", onClr);
    el.call.addEventListener("click", onCall);
    el.ent.addEventListener("click", onEnt);
    el.up.addEventListener("click", onUp);
    el.down.addEventListener("click", onDown);
    el.left.addEventListener("click", onLeft);
    el.right.addEventListener("click", onRight);
    el.keys.forEach((btn) => {
      const key = btn.dataset.key;
      btn.addEventListener("click", () => {
        if (key === "Aa") return onAa();
        if (key === "BS") return onBS();
        onKeypad(key);
      });
    });

    render();
    return { state, render, ctx };
  }

  global.createDS100 = createDS100;
})(window);
