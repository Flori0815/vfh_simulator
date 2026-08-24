/**
 * DS-100 DSC Controller state machine + rendering. See
 * docs/MENU-STRUCTURE.md (derived from assets/manuals/DS-100_instruction_manual.pdf).
 *
 * All outgoing calls are published on window.dscBus so other modules (the
 * IC-M503 cross-wiring in main.js today, an AI backend in Stage 2) can
 * react without this file knowing about them. Incoming traffic — whether
 * from the debug panel or, later, an AI — arrives the same way, via
 * dscBus.incoming(...).
 */
(function (global) {
  "use strict";

  const DISTRESS_NATURES = [
    ["undesignated", "Undesignated"],
    ["fire", "Fire, Explosion"],
    ["flooding", "Flooding"],
    ["collision", "Collision"],
    ["grounding", "Grounding"],
    ["capsizing", "Capsizing"],
    ["sinking", "Sinking"],
    ["adrift", "Disabled and adrift"],
    ["abandoning", "Abandoning ship"],
    ["piracy", "Piracy attack"],
    ["man_overboard", "Man overboard"],
    ["epirb", "EPIRB emission"],
  ];

  const SUBJECT_ITEMS = [
    "Entry Position/Time",
    "Individual call",
    "Group call",
    "All ships call",
    "Received calls",
    "Distress setting",
    "Set-up",
  ];

  const SETUP_ITEMS = ["Address ID", "Offset time", "Brightness", "Contrast", "MMSI check"];
  const ADDRESS_ITEMS = ["Add an address ID", "Delete address ID", "Add a group ID", "Delete a group ID"];
  const ALL_SHIPS_CATEGORIES = [["safety", "Safety"], ["urgency", "Urgency"]];

  // Multi-tap keypad, matching the labels printed on the DS-100's keys.
  const KEYPAD_LETTERS = {
    1: ["Q", "Z"], 2: ["A", "B", "C"], 3: ["D", "E", "F"],
    4: ["G", "H", "I"], 5: ["J", "K", "L"], 6: ["M", "N", "O"],
    7: ["P", "R", "S"], 8: ["T", "U", "V"], 9: ["W", "X", "Y"],
    0: [" ", "-"],
  };

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
      menuIndex: 0,
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
    };

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
      render();
    }

    // ---------------------------------------------------------------- clock
    setInterval(() => {
      if (state.screen === "home" || state.screen === "distressWaiting") render();
    }, 1000);

    function currentPosLabel() {
      const p = state.manualPosition || state.position;
      return `Lat.  ${fmtLat(p.lat)}\nLon. ${fmtLon(p.lon)}`;
    }
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
      toast("Distress cancel acknowledgement transmitted");
      goHome();
    }

    function armDistress() {
      el.distress.classList.add("is-armed");
      state.armTimer = setTimeout(() => {
        el.distress.classList.remove("is-armed");
        transmitDistress();
      }, 5000);
    }
    function disarmDistress() {
      clearTimeout(state.armTimer);
      el.distress.classList.remove("is-armed");
    }

    // ------------------------------------------------------- outgoing calls
    function transmitIndividual(flow) {
      global.dscBus.outgoing("individual", {
        fromMMSI: state.mmsi,
        toMMSI: flow.id,
        channel: flow.channel,
        category: "routine",
      });
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
      toast(`Group call sent to ${flow.name || flow.id} on Ch${flow.channel}`);
      goHome();
    }
    function transmitAllShips(flow) {
      global.dscBus.outgoing("all_ships", {
        fromMMSI: state.mmsi,
        channel: flow.channel,
        category: flow.category,
      });
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

    // ---------------------------------------------------------------- input
    function commitMultitap() {
      state.multitap = null;
    }
    function inputChar(ed, key) {
      if (state.keypadMode === "num" || !KEYPAD_LETTERS[key]) {
        insertChar(ed, key);
        commitMultitap();
        return;
      }
      const letters = KEYPAD_LETTERS[key];
      const now = Date.now();
      if (
        state.multitap &&
        state.multitap.key === key &&
        now - state.multitap.at < 700 &&
        ed.chars.length > 0
      ) {
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
    function insertChar(ed, ch) {
      ed.chars.splice(ed.cursor, 0, ch);
      ed.cursor++;
      if (ed.maxLen) {
        ed.chars = ed.chars.slice(0, ed.maxLen);
        ed.cursor = Math.min(ed.cursor, ed.chars.length);
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
      state.keypadMode =
        state.keypadMode === "caps" ? "small" : state.keypadMode === "small" ? "num" : "caps";
      commitMultitap();
      render();
    }

    // ------------------------------------------------------------- key handlers
    function onKeypad(key) {
      const f = state.flow;
      switch (state.screen) {
        case "individualManualId":
        case "groupManualId":
        case "setupAddAddressId":
        case "setupAddGroupId":
          f.ed = f.ed || { chars: [], cursor: 0, maxLen: state.screen.includes("group") ? 8 : 9 };
          insertChar(f.ed, key);
          f.ed.chars = f.ed.chars.slice(0, f.ed.maxLen);
          f.ed.cursor = Math.min(f.ed.cursor, f.ed.chars.length);
          return render();
        case "setupAddAddressName":
        case "setupAddGroupName":
          f.ed = f.ed || { chars: [], cursor: 0, maxLen: 15 };
          inputChar(f.ed, key);
          return render();
        case "individualChannel":
        case "groupChannel":
        case "allShipsChannel":
          f.channelEd = f.channelEd || { chars: [], cursor: 0, maxLen: 2 };
          insertChar(f.channelEd, key);
          return render();
        default:
          return;
      }
    }

    function onBS() {
      const f = state.flow;
      const ed = f.ed || f.channelEd;
      if (ed) {
        backspace(ed);
        if (f.channelEd) f.channelEd.chars = [];
        render();
      }
    }

    function onAa() {
      const f = state.flow;
      if (f.ed && (state.screen.includes("Name"))) {
        toggleKeypadMode();
      } else if (state.screen === "receivedDetail") {
        clearCurrentMessage();
      }
    }

    function clearCurrentMessage() {
      const f = state.flow;
      if (!f || f.index == null) return;
      const list = f.kindGroup === "distress" ? state.receivedDistress : state.receivedOther;
      list.splice(f.index, 1);
      toast("Message cleared");
      goto(f.kindGroup === "distress" ? "receivedDistressList" : "receivedOtherList");
    }

    function onUp() {
      navigate(-1);
    }
    function onDown() {
      navigate(1);
    }
    function navigate(dir) {
      const f = state.flow;
      switch (state.screen) {
        case "menu":
          state.menuIndex = (state.menuIndex + dir + SUBJECT_ITEMS.length) % SUBJECT_ITEMS.length;
          break;
        case "distressSettingList":
          f.index = ((f.index || 0) + dir + DISTRESS_NATURES.length) % DISTRESS_NATURES.length;
          break;
        case "individualSelect":
          f.index = ((f.index || 0) + dir + (state.addressBook.length + 1)) % (state.addressBook.length + 1);
          break;
        case "groupSelect":
          f.index = ((f.index || 0) + dir + (state.groupBook.length + 1)) % (state.groupBook.length + 1);
          break;
        case "allShipsCategory":
          f.index = ((f.index || 0) + dir + ALL_SHIPS_CATEGORIES.length) % ALL_SHIPS_CATEGORIES.length;
          break;
        case "receivedSelectKind":
          f.index = ((f.index || 0) + dir + 2) % 2;
          break;
        case "receivedDistressList":
          if (state.receivedDistress.length) f.index = ((f.index || 0) + dir + state.receivedDistress.length) % state.receivedDistress.length;
          break;
        case "receivedOtherKindList":
          f.index = ((f.index || 0) + dir + 8) % 8;
          break;
        case "receivedOtherList": {
          const list = filteredOtherList(f.otherKind);
          if (list.length) f.index = ((f.index || 0) + dir + list.length) % list.length;
          break;
        }
        case "setupMenu":
          f.index = ((f.index || 0) + dir + SETUP_ITEMS.length) % SETUP_ITEMS.length;
          break;
        case "setupAddressMenu":
          f.index = ((f.index || 0) + dir + ADDRESS_ITEMS.length) % ADDRESS_ITEMS.length;
          break;
        case "setupDeleteAddressList":
          if (state.addressBook.length) f.index = ((f.index || 0) + dir + state.addressBook.length) % state.addressBook.length;
          break;
        case "setupDeleteGroupList":
          if (state.groupBook.length) f.index = ((f.index || 0) + dir + state.groupBook.length) % state.groupBook.length;
          break;
        case "brightness":
          state.brightness = Math.max(1, Math.min(8, state.brightness + dir));
          break;
        case "contrast":
          state.contrast = Math.max(1, Math.min(8, state.contrast + dir));
          break;
        case "individualManualNS":
        case "entryPosNS":
          f.ns = f.ns === "N" ? "S" : "N";
          break;
        case "entryPosEW":
          f.ew = f.ew === "E" ? "W" : "E";
          break;
        case "offsetSign":
          f.sign = f.sign === "-" ? "+" : "-";
          break;
        default:
          return;
      }
      render();
    }

    function onLeft() {
      moveCursor(-1);
    }
    function onRight() {
      moveCursor(1);
    }
    function moveCursor(dir) {
      const f = state.flow;
      const ed = f.ed || f.channelEd;
      if (ed) {
        ed.cursor = Math.max(0, Math.min(ed.chars.length, ed.cursor + dir));
        render();
      }
    }

    function filteredOtherList(kind) {
      if (!kind) return [];
      return state.receivedOther.filter((e) => e.kind === kind);
    }

    // ---------------------------------------------------------------- ENT
    function onEnt() {
      const f = state.flow;
      switch (state.screen) {
        case "home":
          break;
        case "menu":
          enterSubject(state.menuIndex);
          break;
        case "entryPosLat":
          f.lat = (f.ed.chars.join("") || "0");
          goto("entryPosNS", { ...f, ns: f.ns || "N" });
          break;
        case "entryPosNS":
          goto("entryPosLon", { ...f, ed: { chars: [], cursor: 0, maxLen: 3 } });
          break;
        case "entryPosLon":
          f.lon = f.ed.chars.join("") || "0";
          goto("entryPosEW", { ...f, ew: f.ew || "E" });
          break;
        case "entryPosEW":
          goto("entryPosTime", { ...f, ed: { chars: [], cursor: 0, maxLen: 4 } });
          break;
        case "entryPosTime": {
          const t = (f.ed.chars.join("") || "0000").padStart(4, "0");
          const lat = parseFloat(f.lat) * (f.ns === "S" ? -1 : 1);
          const lon = parseFloat(f.lon) * (f.ew === "W" ? -1 : 1);
          state.manualPosition = { lat: lat || 0, lon: lon || 0 };
          state.manualTime = `${t.slice(0, 2)}:${t.slice(2)}`;
          state.gpsConnected = false;
          toast("Manual position/time entered (GPS treated as disconnected)");
          goHome();
          break;
        }
        case "individualSelect":
          if (f.index === state.addressBook.length) {
            goto("individualManualId", { ed: { chars: [], cursor: 0, maxLen: 9 } });
          } else {
            const a = state.addressBook[f.index];
            goto("individualChannel", { id: a.id, name: a.name, channelEd: { chars: ["1", "6"], cursor: 2, maxLen: 2 } });
          }
          break;
        case "individualManualId":
          goto("individualChannel", {
            id: f.ed.chars.join("").padEnd(9, "0"),
            channelEd: { chars: ["1", "6"], cursor: 2, maxLen: 2 },
          });
          break;
        case "individualChannel":
          f.channel = parseInt(f.channelEd.chars.join("") || "16", 10);
          transmitIndividual(f);
          break;
        case "groupSelect":
          if (f.index === state.groupBook.length) {
            goto("groupManualId", { ed: { chars: [], cursor: 0, maxLen: 8 } });
          } else {
            const g = state.groupBook[f.index];
            goto("groupChannel", { id: g.id, name: g.name, channelEd: { chars: ["1", "6"], cursor: 2, maxLen: 2 } });
          }
          break;
        case "groupManualId":
          goto("groupChannel", {
            id: f.ed.chars.join("").padEnd(8, "0"),
            channelEd: { chars: ["1", "6"], cursor: 2, maxLen: 2 },
          });
          break;
        case "groupChannel":
          f.channel = parseInt(f.channelEd.chars.join("") || "16", 10);
          transmitGroup(f);
          break;
        case "allShipsCategory":
          goto("allShipsChannel", {
            category: ALL_SHIPS_CATEGORIES[f.index || 0][0],
            channelEd: { chars: ["1", "6"], cursor: 2, maxLen: 2 },
          });
          break;
        case "allShipsChannel":
          f.channel = parseInt(f.channelEd.chars.join("") || "16", 10);
          transmitAllShips(f);
          break;
        case "receivedSelectKind":
          if ((f.index || 0) === 0) goto("receivedDistressList", { index: 0 });
          else goto("receivedOtherKindList", { index: 0 });
          break;
        case "receivedDistressList":
          if (state.receivedDistress.length)
            goto("receivedDetail", { kindGroup: "distress", index: f.index || 0 });
          break;
        case "receivedOtherKindList": {
          const kinds = ["individual_ack", "individual", "group", "all_ships", "distress", "distress_relay", "distress_relay_ack", "distress_ack"];
          goto("receivedOtherList", { otherKind: kinds[f.index || 0], index: 0 });
          break;
        }
        case "receivedOtherList": {
          const list = filteredOtherList(f.otherKind);
          if (list.length) goto("receivedDetail", { kindGroup: "other", otherKind: f.otherKind, index: f.index || 0 });
          break;
        }
        case "distressSettingList": {
          const [key] = DISTRESS_NATURES[f.index || 0];
          state.distressNature = key;
          state.distressNatureExpiry = Date.now() + 10 * 60 * 1000;
          toast(`Nature of distress set: ${DISTRESS_NATURES[f.index || 0][1]} (valid 10 min)`);
          goHome();
          break;
        }
        case "setupMenu":
          enterSetup(f.index || 0);
          break;
        case "setupAddressMenu":
          enterAddress(f.index || 0);
          break;
        case "setupAddAddressId":
          goto("setupAddAddressName", { id: f.ed.chars.join("").padEnd(9, "0"), ed: { chars: [], cursor: 0, maxLen: 15 } });
          break;
        case "setupAddAddressName":
          state.addressBook.push({ id: f.id, name: f.ed.chars.join("").trim() || f.id });
          toast("Address ID added");
          goHome();
          break;
        case "setupAddGroupId":
          goto("setupAddGroupName", { id: f.ed.chars.join("").padEnd(8, "0"), ed: { chars: [], cursor: 0, maxLen: 15 } });
          break;
        case "setupAddGroupName":
          state.groupBook.push({ id: f.id, name: f.ed.chars.join("").trim() || f.id });
          toast("Group ID added");
          goHome();
          break;
        case "setupDeleteAddressList":
          if (state.addressBook.length) {
            const removed = state.addressBook.splice(f.index || 0, 1)[0];
            toast(`Deleted ${removed.name}`);
          }
          goHome();
          break;
        case "setupDeleteGroupList":
          if (state.groupBook.length) {
            const removed = state.groupBook.splice(f.index || 0, 1)[0];
            toast(`Deleted ${removed.name}`);
          }
          goHome();
          break;
        case "offsetSign":
          goto("offsetValue", { ...f, ed: { chars: [], cursor: 0, maxLen: 4 } });
          break;
        case "offsetValue": {
          const v = (f.ed.chars.join("") || "0000").padStart(4, "0");
          const mins = parseInt(v.slice(0, 2), 10) * 60 + parseInt(v.slice(2), 10);
          state.offsetMinutes = (f.sign === "-" ? -1 : 1) * mins;
          toast("Local time offset saved");
          goHome();
          break;
        }
        case "incomingAlert":
          goHome();
          break;
        default:
          break;
      }
    }

    function enterSubject(index) {
      switch (SUBJECT_ITEMS[index]) {
        case "Entry Position/Time":
          goto("entryPosLat", { ed: { chars: [], cursor: 0, maxLen: 3 } });
          break;
        case "Individual call":
          goto("individualSelect", { index: 0 });
          break;
        case "Group call":
          goto("groupSelect", { index: 0 });
          break;
        case "All ships call":
          goto("allShipsCategory", { index: 0 });
          break;
        case "Received calls":
          goto("receivedSelectKind", { index: 0 });
          break;
        case "Distress setting":
          goto("distressSettingList", { index: 0 });
          break;
        case "Set-up":
          goto("setupMenu", { index: 0 });
          break;
      }
    }
    function enterSetup(index) {
      switch (SETUP_ITEMS[index]) {
        case "Address ID":
          goto("setupAddressMenu", { index: 0 });
          break;
        case "Offset time":
          goto("offsetSign", { sign: "+" });
          break;
        case "Brightness":
          goto("brightness");
          break;
        case "Contrast":
          goto("contrast");
          break;
        case "MMSI check":
          goto("mmsiCheck");
          break;
      }
    }
    function enterAddress(index) {
      switch (ADDRESS_ITEMS[index]) {
        case "Add an address ID":
          goto("setupAddAddressId", { ed: { chars: [], cursor: 0, maxLen: 9 } });
          break;
        case "Delete address ID":
          goto("setupDeleteAddressList", { index: 0 });
          break;
        case "Add a group ID":
          goto("setupAddGroupId", { ed: { chars: [], cursor: 0, maxLen: 8 } });
          break;
        case "Delete a group ID":
          goto("setupDeleteGroupList", { index: 0 });
          break;
      }
    }

    // ---------------------------------------------------------------- CLR
    function onClr() {
      if (state.screen === "distressWaiting") return cancelDistress();
      goHome();
    }
    function onCall() {
      if (state.screen === "home") {
        state.menuIndex = 0;
        goto("menu", {});
      } else {
        goHome();
      }
    }

    // ------------------------------------------------------------- render
    function ed2str(ed, mask) {
      if (!ed) return "";
      return ed.chars.map((c) => (mask ? "*" : c)).join("") || "";
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
      let start = Math.min(
        Math.max(0, idx - Math.floor((maxLines - 1) / 2)),
        lines.length - maxLines
      );
      const windowed = lines.slice(start, start + maxLines);
      if (start > 0) windowed[0] = "↑" + windowed[0].slice(1);
      if (start + maxLines < lines.length) {
        windowed[windowed.length - 1] = "↓" + windowed[windowed.length - 1].slice(1);
      }
      return windowed.join("\n");
    }

    function render() {
      const f = state.flow;
      let title = "";
      let body = "";
      let foot = "";

      switch (state.screen) {
        case "home": {
          const p = state.manualPosition || state.position;
          const timeLine = state.manualTime && !state.gpsConnected
            ? `MNL  UTC   ${state.manualTime}`
            : `GPS  UTC   ${currentTimeLabel()}`;
          title = "-VHF DSC CONTROLLER-";
          body = `CH70 WATCHING\n\n${timeLine}\nPos.  ${fmtLat(p.lat)}\n      ${fmtLon(p.lon)}`;
          foot = state.awaitingAck ? "Distress repeat active — CLR to cancel" : "";
          break;
        }
        case "menu":
          title = "<Select a subject>";
          body = windowLines(
            SUBJECT_ITEMS.map((s, i) => (i === state.menuIndex ? `≣${s}` : ` ${s}`)),
            state.menuIndex
          );
          foot = "▲▼ select · ENT open · CLR exit";
          break;
        case "distressWaiting":
          title = "Distress alert";
          body = `Nature: ${DISTRESS_NATURES.find((n) => n[0] === activeDistressNature())[1]}\nNow waiting for\nacknowledgement…`;
          foot = "<CLR→Cancel>";
          break;
        case "incomingAlert": {
          const m = f.message;
          title = `—RCV ${m.kind.replace(/_/g, " ")}—`;
          body = incomingSummary(m);
          foot = "<CLR→Exit/ENT→OK>";
          break;
        }
        case "entryPosLat":
          title = "<Input a position>";
          body = `Latitude\n${ed2str(f.ed)}_°N`;
          foot = "<CLR→Exit/ENT→OK>";
          break;
        case "entryPosNS":
          title = "<Select N/S>";
          body = `Latitude: ${f.lat}° ${f.ns}`;
          foot = "▲▼ toggle · ENT confirm";
          break;
        case "entryPosLon":
          title = "<Input a position>";
          body = `Longitude\n${ed2str(f.ed)}_°E`;
          foot = "<CLR→Exit/ENT→OK>";
          break;
        case "entryPosEW":
          title = "<Select E/W>";
          body = `Longitude: ${f.lon}° ${f.ew}`;
          foot = "▲▼ toggle · ENT confirm";
          break;
        case "entryPosTime":
          title = "<Input a Time>";
          body = `UTC : ${ed2str(f.ed)}_`;
          foot = "<CLR→Exit/ENT→OK>";
          break;
        case "individualSelect":
          title = "<Select an address ID>";
          body = windowLines(
            [...state.addressBook.map((a) => a.name), "Manual entry"].map((n, i) =>
              i === f.index ? `≣${n}` : ` ${n}`
            ),
            f.index
          );
          foot = "▲▼ select · ENT next";
          break;
        case "individualManualId":
          title = "<Input an address>";
          body = `ID:(9digit)\n${ed2str(f.ed)}`;
          foot = "<CLR→Exit/ENT→OK>";
          break;
        case "individualChannel":
          title = "<Select traffic channel>";
          body = `To: ${f.name || f.id}\nChannel: ${ed2str(f.channelEd)}`;
          foot = "BS then digits to change · ENT sends";
          break;
        case "groupSelect":
          title = "<Select a group>";
          body = windowLines(
            [...state.groupBook.map((g) => g.name), "Manual entry"].map((n, i) =>
              i === f.index ? `≣${n}` : ` ${n}`
            ),
            f.index
          );
          foot = "▲▼ select · ENT next";
          break;
        case "groupManualId":
          title = "<Input an address>";
          body = `ID:(8digit)\n${ed2str(f.ed)}`;
          foot = "<CLR→Exit/ENT→OK>";
          break;
        case "groupChannel":
          title = "<Select traffic channel>";
          body = `Group: ${f.name || f.id}\nChannel: ${ed2str(f.channelEd)}`;
          foot = "BS then digits to change · ENT sends";
          break;
        case "allShipsCategory":
          title = "<Select a category>";
          body = ALL_SHIPS_CATEGORIES.map(([, label], i) => (i === f.index ? `≣${label}` : ` ${label}`)).join("\n");
          foot = "▲▼ select · ENT next";
          break;
        case "allShipsChannel":
          title = "<Select traffic channel>";
          body = `Category: ${f.category}\nChannel: ${ed2str(f.channelEd)}`;
          foot = "BS then digits to change · ENT sends";
          break;
        case "receivedSelectKind":
          title = "<Select a message>";
          body = [`≣ Distress message (${state.receivedDistress.length})`, `  Other message (${state.receivedOther.length})`]
            .map((s, i) => (i === (f.index || 0) ? s.replace("≣", "≣") : s))
            .join("\n");
          foot = "▲▼ select · ENT open";
          break;
        case "receivedDistressList":
          title = "<Select a message>";
          body = state.receivedDistress.length
            ? windowLines(
                state.receivedDistress.map(
                  (e, i) => `${i === f.index ? "≣" : " "}${i + 1}: Distress  ${e.at.toTimeString().slice(0, 5)}`
                ),
                f.index
              )
            : "(no distress messages)";
          foot = "<CLR→Exit/ENT→OK>";
          break;
        case "receivedOtherKindList": {
          const labels = ["Individual ACK", "Individual call", "Group call", "All ships call", "Distress", "Distress relay", "Distress RLY ACK", "Distress ACK"];
          title = "<Select a message>";
          body = windowLines(
            labels.map((l, i) => (i === (f.index || 0) ? `≣${l}` : ` ${l}`)),
            f.index || 0
          );
          foot = "▲▼ select · ENT open";
          break;
        }
        case "receivedOtherList": {
          const list = filteredOtherList(f.otherKind);
          title = "<Select a message>";
          body = list.length
            ? windowLines(
                list.map(
                  (e, i) => `${i === f.index ? "≣" : " "}From ${e.message.fromName || e.message.fromMMSI}  ${e.at.toTimeString().slice(0, 5)}`
                ),
                f.index
              )
            : "(none received)";
          foot = "<CLR→Exit/ENT→OK>";
          break;
        }
        case "receivedDetail": {
          const list = f.kindGroup === "distress" ? state.receivedDistress : filteredOtherList(f.otherKind);
          const entry = list[f.index];
          title = "<Message contents>";
          body = entry ? incomingSummary(entry.message) : "(deleted)";
          foot = "A/a clear · CLR exit";
          break;
        }
        case "distressSettingList":
          title = "<Select a nature>";
          body = windowLines(
            DISTRESS_NATURES.map(([, label], i) => (i === (f.index || 0) ? `≣${label}` : ` ${label}`)),
            f.index || 0
          );
          foot = "▲▼ select · ENT confirm";
          break;
        case "setupMenu":
          title = "<Select a subject>";
          body = windowLines(
            SETUP_ITEMS.map((s, i) => (i === (f.index || 0) ? `≣${s}` : ` ${s}`)),
            f.index || 0
          );
          foot = "▲▼ select · ENT open · CLR exit";
          break;
        case "setupAddressMenu":
          title = "<Select a subject>";
          body = windowLines(
            ADDRESS_ITEMS.map((s, i) => (i === (f.index || 0) ? `≣${s}` : ` ${s}`)),
            f.index || 0
          );
          foot = "▲▼ select · ENT open";
          break;
        case "setupAddAddressId":
          title = "<Add an address ID>";
          body = `ID:(9digit)\n${ed2str(f.ed)}`;
          foot = "<CLR→Exit/ENT→OK>";
          break;
        case "setupAddAddressName":
        case "setupAddGroupName":
          title = "Enter name";
          body = `Name:(15characters)\n${ed2str(f.ed)}_  [${state.keypadMode}]`;
          foot = "A/a case · BS delete · ENT save";
          break;
        case "setupAddGroupId":
          title = "<Add a group ID>";
          body = `ID:(8digit)\n${ed2str(f.ed)}`;
          foot = "<CLR→Exit/ENT→OK>";
          break;
        case "setupDeleteAddressList":
          title = "<Delete address ID>";
          body = state.addressBook.length
            ? windowLines(
                state.addressBook.map((a, i) => (i === (f.index || 0) ? `≣${a.name}` : ` ${a.name}`)),
                f.index || 0
              )
            : "(empty)";
          foot = "▲▼ select · ENT delete";
          break;
        case "setupDeleteGroupList":
          title = "<Delete group ID>";
          body = state.groupBook.length
            ? windowLines(
                state.groupBook.map((g, i) => (i === (f.index || 0) ? `≣${g.name}` : ` ${g.name}`)),
                f.index || 0
              )
            : "(empty)";
          foot = "▲▼ select · ENT delete";
          break;
        case "offsetSign":
          title = "<Offset time>";
          body = `Sign: ${f.sign} (▲▼ to toggle)`;
          foot = "ENT next · CLR exit";
          break;
        case "offsetValue":
          title = "<Offset time>";
          body = `${f.sign}${ed2str(f.ed)}_  (HHMM)`;
          foot = "<CLR→Exit/ENT→OK>";
          break;
        case "brightness":
          title = "<Brightness>";
          body = `Level: ${state.brightness} / 8`;
          foot = "▲▼ adjust · CLR exit";
          break;
        case "contrast":
          title = "<Contrast>";
          body = `Level: ${state.contrast} / 8`;
          foot = "▲▼ adjust · CLR exit";
          break;
        case "mmsiCheck":
          title = "<MMSI check>";
          body = state.mmsi;
          foot = "<CLR→Exit>";
          break;
        default:
          title = "";
          body = "";
      }

      el.title.textContent = title;
      el.body.textContent = body;
      el.foot.textContent = foot;
      root.style.setProperty("--ds100-contrast", state.contrast / 8);
      root.style.setProperty("--ds100-brightness", state.brightness / 8);
      el.status.textContent = statusLine();
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
    return { state, render };
  }

  global.createDS100 = createDS100;
})(window);
