/**
 * DS-100 screen definitions — the "config" half of the DS-100 (see
 * js/ds100.js for the small engine that interprets this table).
 *
 * Each entry in SCREENS is one LCD screen. All the content AND the input
 * handling for a screen live together in one object, instead of being
 * spread across separate render/up/down/ent switch-statements keyed by
 * screen name. Adding a new screen (e.g. for a future exam challenge)
 * means adding one entry here — nothing else in the engine changes.
 *
 * A screen object may define:
 *   render(ctx)         -> { title, body, foot }   (required)
 *   items(ctx)           -> string[]  (list screens only; drives generic
 *                                      ▲/▼ navigation over ctx.flow.index)
 *   up(ctx), down(ctx)    -> override generic list navigation
 *   left(ctx), right(ctx)  -> override generic text-cursor movement
 *   key(ctx, digit)         -> override generic keypad entry
 *   bs(ctx)                  -> override generic backspace
 *   aa(ctx)                   -> A/a key (case toggle / clear message)
 *   ent(ctx)                   -> ENT key (required unless purely informational)
 *   clr(ctx)                    -> override CLR (default: go home)
 *
 * ctx is defined in js/ds100.js and exposes state/flow plus helpers
 * (goto, goHome, toast, log, transmit*, windowLines, text-editor helpers).
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

  const SETUP_ITEMS = ["Address ID", "Offset time", "Brightness", "Contrast", "MMSI check", "DSC self-test"];
  const ADDRESS_ITEMS = ["Add an address ID", "Delete address ID", "Add a group ID", "Delete a group ID"];
  const ALL_SHIPS_CATEGORIES = [["safety", "Safety"], ["urgency", "Urgency"]];

  // Multi-tap keypad, matching the labels printed on the DS-100's keys.
  const KEYPAD_LETTERS = {
    1: ["Q", "Z"], 2: ["A", "B", "C"], 3: ["D", "E", "F"],
    4: ["G", "H", "I"], 5: ["J", "K", "L"], 6: ["M", "N", "O"],
    7: ["P", "R", "S"], 8: ["T", "U", "V"], 9: ["W", "X", "Y"],
    0: [" ", "-"],
  };

  const RECEIVED_OTHER_KINDS = [
    "individual_ack", "individual", "group", "all_ships",
    "distress", "distress_relay", "distress_relay_ack", "distress_ack",
  ];
  const RECEIVED_OTHER_LABELS = [
    "Individual ACK", "Individual call", "Group call", "All ships call",
    "Distress", "Distress relay", "Distress RLY ACK", "Distress ACK",
  ];

  function markedList(items, selectedIndex) {
    return items.map((s, i) => (i === (selectedIndex || 0) ? `≣${s}` : ` ${s}`));
  }
  function freshChannelEd() {
    return { chars: ["1", "6"], cursor: 2, maxLen: 2 };
  }

  const SCREENS = {
    // ------------------------------------------------------------ home
    home: {
      render(ctx) {
        const p = ctx.state.manualPosition || ctx.state.position;
        const timeLine =
          ctx.state.manualTime && !ctx.state.gpsConnected
            ? `MNL  UTC   ${ctx.state.manualTime}`
            : `GPS  UTC   ${ctx.currentTimeLabel()}`;
        return {
          title: "-VHF DSC CONTROLLER-",
          body: `CH70 WATCHING\n\n${timeLine}\nPos.  ${ctx.fmtLat(p.lat)}\n      ${ctx.fmtLon(p.lon)}`,
          foot: ctx.state.awaitingAck ? "Distress repeat active — CLR to cancel" : "",
        };
      },
    },

    // ------------------------------------------------------------ subject menu
    menu: {
      items() {
        return SUBJECT_ITEMS;
      },
      render(ctx) {
        return {
          title: "<Select a subject>",
          body: ctx.windowLines(markedList(SUBJECT_ITEMS, ctx.flow.index), ctx.flow.index),
          foot: "▲▼ select · ENT open · CLR exit",
        };
      },
      ent(ctx) {
        const label = SUBJECT_ITEMS[ctx.flow.index || 0];
        const dest = {
          "Entry Position/Time": () => ctx.goto("entryPosLat", { ed: { chars: [], cursor: 0, maxLen: 3 } }),
          "Individual call": () => ctx.goto("individualSelect", { index: 0 }),
          "Group call": () => ctx.goto("groupSelect", { index: 0 }),
          "All ships call": () => ctx.goto("allShipsCategory", { index: 0 }),
          "Received calls": () => ctx.goto("receivedSelectKind", { index: 0 }),
          "Distress setting": () => ctx.goto("distressSettingList", { index: 0 }),
          "Set-up": () => ctx.goto("setupMenu", { index: 0 }),
        }[label];
        if (dest) dest();
      },
    },

    // ------------------------------------------------------------ distress
    distressWaiting: {
      render(ctx) {
        return {
          title: "Distress alert",
          body: `Nature: ${DISTRESS_NATURES.find((n) => n[0] === ctx.activeDistressNature())[1]}\nNow waiting for\nacknowledgement…`,
          foot: "<CLR→Cancel>",
        };
      },
      clr(ctx) {
        ctx.cancelDistress();
      },
    },
    incomingAlert: {
      render(ctx) {
        const m = ctx.flow.message;
        return {
          title: `—RCV ${m.kind.replace(/_/g, " ")}—`,
          body: ctx.incomingSummary(m),
          foot: "<CLR→Exit/ENT→OK>",
        };
      },
      ent(ctx) {
        ctx.goHome();
      },
    },
    distressSettingList: {
      items() {
        return DISTRESS_NATURES.map((n) => n[1]);
      },
      render(ctx) {
        return {
          title: "<Select a nature>",
          body: ctx.windowLines(markedList(DISTRESS_NATURES.map((n) => n[1]), ctx.flow.index), ctx.flow.index || 0),
          foot: "▲▼ select · ENT confirm",
        };
      },
      ent(ctx) {
        const [key, label] = DISTRESS_NATURES[ctx.flow.index || 0];
        ctx.state.distressNature = key;
        ctx.state.distressNatureExpiry = Date.now() + 10 * 60 * 1000;
        ctx.log("nature_set", { nature: key });
        ctx.toast(`Nature of distress set: ${label} (valid 10 min)`);
        ctx.goHome();
      },
    },

    // ------------------------------------------------------------ position/time entry
    entryPosLat: {
      render(ctx) {
        return { title: "<Input a position>", body: `Latitude\n${ctx.ed2str(ctx.flow.ed)}_°N`, foot: "<CLR→Exit/ENT→OK>" };
      },
      ent(ctx) {
        const f = ctx.flow;
        f.lat = f.ed.chars.join("") || "0";
        ctx.goto("entryPosNS", { ...f, ns: f.ns || "N" });
      },
    },
    entryPosNS: {
      render(ctx) {
        return { title: "<Select N/S>", body: `Latitude: ${ctx.flow.lat}° ${ctx.flow.ns}`, foot: "▲▼ toggle · ENT confirm" };
      },
      up(ctx) { ctx.flow.ns = ctx.flow.ns === "N" ? "S" : "N"; },
      down(ctx) { ctx.flow.ns = ctx.flow.ns === "N" ? "S" : "N"; },
      ent(ctx) {
        ctx.goto("entryPosLon", { ...ctx.flow, ed: { chars: [], cursor: 0, maxLen: 3 } });
      },
    },
    entryPosLon: {
      render(ctx) {
        return { title: "<Input a position>", body: `Longitude\n${ctx.ed2str(ctx.flow.ed)}_°E`, foot: "<CLR→Exit/ENT→OK>" };
      },
      ent(ctx) {
        const f = ctx.flow;
        f.lon = f.ed.chars.join("") || "0";
        ctx.goto("entryPosEW", { ...f, ew: f.ew || "E" });
      },
    },
    entryPosEW: {
      render(ctx) {
        return { title: "<Select E/W>", body: `Longitude: ${ctx.flow.lon}° ${ctx.flow.ew}`, foot: "▲▼ toggle · ENT confirm" };
      },
      up(ctx) { ctx.flow.ew = ctx.flow.ew === "E" ? "W" : "E"; },
      down(ctx) { ctx.flow.ew = ctx.flow.ew === "E" ? "W" : "E"; },
      ent(ctx) {
        ctx.goto("entryPosTime", { ...ctx.flow, ed: { chars: [], cursor: 0, maxLen: 4 } });
      },
    },
    entryPosTime: {
      render(ctx) {
        return { title: "<Input a Time>", body: `UTC : ${ctx.ed2str(ctx.flow.ed)}_`, foot: "<CLR→Exit/ENT→OK>" };
      },
      ent(ctx) {
        const f = ctx.flow;
        const t = (f.ed.chars.join("") || "0000").padStart(4, "0");
        const lat = parseFloat(f.lat) * (f.ns === "S" ? -1 : 1);
        const lon = parseFloat(f.lon) * (f.ew === "W" ? -1 : 1);
        ctx.state.manualPosition = { lat: lat || 0, lon: lon || 0 };
        ctx.state.manualTime = `${t.slice(0, 2)}:${t.slice(2)}`;
        ctx.state.gpsConnected = false;
        ctx.log("position_time_set", { position: ctx.state.manualPosition, time: ctx.state.manualTime });
        ctx.toast("Manual position/time entered (GPS treated as disconnected)");
        ctx.goHome();
      },
    },

    // ------------------------------------------------------------ individual call
    individualSelect: {
      items(ctx) {
        return [...ctx.state.addressBook.map((a) => a.name), "Manual entry"];
      },
      render(ctx) {
        const names = [...ctx.state.addressBook.map((a) => a.name), "Manual entry"];
        return {
          title: "<Select an address ID>",
          body: ctx.windowLines(markedList(names, ctx.flow.index), ctx.flow.index),
          foot: "▲▼ select · ENT next",
        };
      },
      ent(ctx) {
        const f = ctx.flow;
        if (f.index === ctx.state.addressBook.length) {
          ctx.goto("individualManualId", { ed: { chars: [], cursor: 0, maxLen: 9 } });
        } else {
          const a = ctx.state.addressBook[f.index];
          ctx.goto("individualChannel", { id: a.id, name: a.name, channelEd: freshChannelEd() });
        }
      },
    },
    individualManualId: {
      render(ctx) {
        return { title: "<Input an address>", body: `ID:(9digit)\n${ctx.ed2str(ctx.flow.ed)}`, foot: "<CLR→Exit/ENT→OK>" };
      },
      ent(ctx) {
        ctx.goto("individualChannel", {
          id: ctx.flow.ed.chars.join("").padEnd(9, "0"),
          channelEd: freshChannelEd(),
        });
      },
    },
    individualChannel: {
      render(ctx) {
        return {
          title: "<Select traffic channel>",
          body: `To: ${ctx.flow.name || ctx.flow.id}\nChannel: ${ctx.ed2str(ctx.flow.channelEd)}`,
          foot: "BS then digits to change · ENT sends",
        };
      },
      ent(ctx) {
        const f = ctx.flow;
        f.channel = parseInt(f.channelEd.chars.join("") || "16", 10);
        ctx.transmitIndividual(f);
      },
    },

    // ------------------------------------------------------------ group call
    groupSelect: {
      items(ctx) {
        return [...ctx.state.groupBook.map((g) => g.name), "Manual entry"];
      },
      render(ctx) {
        const names = [...ctx.state.groupBook.map((g) => g.name), "Manual entry"];
        return {
          title: "<Select a group>",
          body: ctx.windowLines(markedList(names, ctx.flow.index), ctx.flow.index),
          foot: "▲▼ select · ENT next",
        };
      },
      ent(ctx) {
        const f = ctx.flow;
        if (f.index === ctx.state.groupBook.length) {
          ctx.goto("groupManualId", { ed: { chars: [], cursor: 0, maxLen: 8 } });
        } else {
          const g = ctx.state.groupBook[f.index];
          ctx.goto("groupChannel", { id: g.id, name: g.name, channelEd: freshChannelEd() });
        }
      },
    },
    groupManualId: {
      render(ctx) {
        return { title: "<Input an address>", body: `ID:(8digit)\n${ctx.ed2str(ctx.flow.ed)}`, foot: "<CLR→Exit/ENT→OK>" };
      },
      ent(ctx) {
        ctx.goto("groupChannel", {
          id: ctx.flow.ed.chars.join("").padEnd(8, "0"),
          channelEd: freshChannelEd(),
        });
      },
    },
    groupChannel: {
      render(ctx) {
        return {
          title: "<Select traffic channel>",
          body: `Group: ${ctx.flow.name || ctx.flow.id}\nChannel: ${ctx.ed2str(ctx.flow.channelEd)}`,
          foot: "BS then digits to change · ENT sends",
        };
      },
      ent(ctx) {
        const f = ctx.flow;
        f.channel = parseInt(f.channelEd.chars.join("") || "16", 10);
        ctx.transmitGroup(f);
      },
    },

    // ------------------------------------------------------------ all ships call
    allShipsCategory: {
      items() {
        return ALL_SHIPS_CATEGORIES.map((c) => c[1]);
      },
      render(ctx) {
        return {
          title: "<Select a category>",
          body: markedList(ALL_SHIPS_CATEGORIES.map((c) => c[1]), ctx.flow.index).join("\n"),
          foot: "▲▼ select · ENT next",
        };
      },
      ent(ctx) {
        ctx.goto("allShipsChannel", {
          category: ALL_SHIPS_CATEGORIES[ctx.flow.index || 0][0],
          channelEd: freshChannelEd(),
        });
      },
    },
    allShipsChannel: {
      render(ctx) {
        return {
          title: "<Select traffic channel>",
          body: `Category: ${ctx.flow.category}\nChannel: ${ctx.ed2str(ctx.flow.channelEd)}`,
          foot: "BS then digits to change · ENT sends",
        };
      },
      ent(ctx) {
        const f = ctx.flow;
        f.channel = parseInt(f.channelEd.chars.join("") || "16", 10);
        ctx.transmitAllShips(f);
      },
    },

    // ------------------------------------------------------------ received calls
    receivedSelectKind: {
      items() {
        return ["Distress message", "Other message"];
      },
      render(ctx) {
        const labels = [
          `Distress message (${ctx.state.receivedDistress.length})`,
          `Other message (${ctx.state.receivedOther.length})`,
        ];
        return { title: "<Select a message>", body: markedList(labels, ctx.flow.index).join("\n"), foot: "▲▼ select · ENT open" };
      },
      ent(ctx) {
        if ((ctx.flow.index || 0) === 0) ctx.goto("receivedDistressList", { index: 0 });
        else ctx.goto("receivedOtherKindList", { index: 0 });
      },
    },
    receivedDistressList: {
      items(ctx) {
        return ctx.state.receivedDistress;
      },
      render(ctx) {
        const list = ctx.state.receivedDistress;
        const body = list.length
          ? ctx.windowLines(
              markedList(
                list.map((e, i) => `${i + 1}: Distress  ${e.at.toTimeString().slice(0, 5)}`),
                ctx.flow.index
              ),
              ctx.flow.index
            )
          : "(no distress messages)";
        return { title: "<Select a message>", body, foot: "<CLR→Exit/ENT→OK>" };
      },
      ent(ctx) {
        if (ctx.state.receivedDistress.length) {
          ctx.goto("receivedDetail", { kindGroup: "distress", index: ctx.flow.index || 0 });
        }
      },
    },
    receivedOtherKindList: {
      items() {
        return RECEIVED_OTHER_LABELS;
      },
      render(ctx) {
        return {
          title: "<Select a message>",
          body: ctx.windowLines(markedList(RECEIVED_OTHER_LABELS, ctx.flow.index), ctx.flow.index || 0),
          foot: "▲▼ select · ENT open",
        };
      },
      ent(ctx) {
        const kind = RECEIVED_OTHER_KINDS[ctx.flow.index || 0];
        ctx.goto("receivedOtherList", { otherKind: kind, index: 0 });
      },
    },
    receivedOtherList: {
      items(ctx) {
        return ctx.filteredOtherList(ctx.flow.otherKind);
      },
      render(ctx) {
        const list = ctx.filteredOtherList(ctx.flow.otherKind);
        const body = list.length
          ? ctx.windowLines(
              markedList(
                list.map((e, i) => `From ${e.message.fromName || e.message.fromMMSI}  ${e.at.toTimeString().slice(0, 5)}`),
                ctx.flow.index
              ),
              ctx.flow.index
            )
          : "(none received)";
        return { title: "<Select a message>", body, foot: "<CLR→Exit/ENT→OK>" };
      },
      ent(ctx) {
        const list = ctx.filteredOtherList(ctx.flow.otherKind);
        if (list.length) ctx.goto("receivedDetail", { kindGroup: "other", otherKind: ctx.flow.otherKind, index: ctx.flow.index || 0 });
      },
    },
    receivedDetail: {
      render(ctx) {
        const f = ctx.flow;
        const list = f.kindGroup === "distress" ? ctx.state.receivedDistress : ctx.filteredOtherList(f.otherKind);
        const entry = list[f.index];
        return { title: "<Message contents>", body: entry ? ctx.incomingSummary(entry.message) : "(deleted)", foot: "A/a clear · CLR exit" };
      },
      aa(ctx) {
        const f = ctx.flow;
        if (f.index == null) return;
        const list = f.kindGroup === "distress" ? ctx.state.receivedDistress : ctx.filteredOtherList(f.otherKind);
        const removed = list[f.index];
        if (!removed) return;
        const home = f.kindGroup === "distress" ? ctx.state.receivedDistress : ctx.state.receivedOther;
        const idx = home.indexOf(removed);
        if (idx !== -1) home.splice(idx, 1);
        ctx.toast("Message cleared");
        ctx.goto(f.kindGroup === "distress" ? "receivedDistressList" : "receivedOtherList", { otherKind: f.otherKind, index: 0 });
      },
      ent(ctx) {
        ctx.goHome();
      },
    },

    // ------------------------------------------------------------ set-up
    setupMenu: {
      items() {
        return SETUP_ITEMS;
      },
      render(ctx) {
        return {
          title: "<Select a subject>",
          body: ctx.windowLines(markedList(SETUP_ITEMS, ctx.flow.index), ctx.flow.index || 0),
          foot: "▲▼ select · ENT open · CLR exit",
        };
      },
      ent(ctx) {
        const dest = {
          "Address ID": () => ctx.goto("setupAddressMenu", { index: 0 }),
          "Offset time": () => ctx.goto("offsetSign", { sign: "+" }),
          Brightness: () => ctx.goto("brightness"),
          Contrast: () => ctx.goto("contrast"),
          "MMSI check": () => ctx.goto("mmsiCheck"),
          "DSC self-test": () => ctx.goto("dscSelfTest"),
        }[SETUP_ITEMS[ctx.flow.index || 0]];
        if (dest) dest();
      },
    },
    setupAddressMenu: {
      items() {
        return ADDRESS_ITEMS;
      },
      render(ctx) {
        return {
          title: "<Select a subject>",
          body: ctx.windowLines(markedList(ADDRESS_ITEMS, ctx.flow.index), ctx.flow.index || 0),
          foot: "▲▼ select · ENT open",
        };
      },
      ent(ctx) {
        const dest = {
          "Add an address ID": () => ctx.goto("setupAddAddressId", { ed: { chars: [], cursor: 0, maxLen: 9 } }),
          "Delete address ID": () => ctx.goto("setupDeleteAddressList", { index: 0 }),
          "Add a group ID": () => ctx.goto("setupAddGroupId", { ed: { chars: [], cursor: 0, maxLen: 8 } }),
          "Delete a group ID": () => ctx.goto("setupDeleteGroupList", { index: 0 }),
        }[ADDRESS_ITEMS[ctx.flow.index || 0]];
        if (dest) dest();
      },
    },
    setupAddAddressId: {
      render(ctx) {
        return { title: "<Add an address ID>", body: `ID:(9digit)\n${ctx.ed2str(ctx.flow.ed)}`, foot: "<CLR→Exit/ENT→OK>" };
      },
      ent(ctx) {
        ctx.goto("setupAddAddressName", { id: ctx.flow.ed.chars.join("").padEnd(9, "0"), ed: { chars: [], cursor: 0, maxLen: 15 } });
      },
    },
    setupAddAddressName: {
      render(ctx) {
        return { title: "Enter name", body: `Name:(15characters)\n${ctx.ed2str(ctx.flow.ed)}_  [${ctx.state.keypadMode}]`, foot: "A/a case · BS delete · ENT save" };
      },
      key(ctx, k) {
        ctx.inputChar(ctx.flow.ed, k);
      },
      aa(ctx) {
        ctx.toggleKeypadMode();
      },
      ent(ctx) {
        const f = ctx.flow;
        ctx.state.addressBook.push({ id: f.id, name: f.ed.chars.join("").trim() || f.id });
        ctx.log("address_added", { id: f.id });
        ctx.toast("Address ID added");
        ctx.goHome();
      },
    },
    setupAddGroupId: {
      render(ctx) {
        return { title: "<Add a group ID>", body: `ID:(8digit)\n${ctx.ed2str(ctx.flow.ed)}`, foot: "<CLR→Exit/ENT→OK>" };
      },
      ent(ctx) {
        ctx.goto("setupAddGroupName", { id: ctx.flow.ed.chars.join("").padEnd(8, "0"), ed: { chars: [], cursor: 0, maxLen: 15 } });
      },
    },
    setupAddGroupName: {
      render(ctx) {
        return { title: "Enter name", body: `Name:(15characters)\n${ctx.ed2str(ctx.flow.ed)}_  [${ctx.state.keypadMode}]`, foot: "A/a case · BS delete · ENT save" };
      },
      key(ctx, k) {
        ctx.inputChar(ctx.flow.ed, k);
      },
      aa(ctx) {
        ctx.toggleKeypadMode();
      },
      ent(ctx) {
        const f = ctx.flow;
        ctx.state.groupBook.push({ id: f.id, name: f.ed.chars.join("").trim() || f.id });
        ctx.log("group_added", { id: f.id });
        ctx.toast("Group ID added");
        ctx.goHome();
      },
    },
    setupDeleteAddressList: {
      items(ctx) {
        return ctx.state.addressBook;
      },
      render(ctx) {
        const names = ctx.state.addressBook.map((a) => a.name);
        return {
          title: "<Delete address ID>",
          body: names.length ? ctx.windowLines(markedList(names, ctx.flow.index), ctx.flow.index || 0) : "(empty)",
          foot: "▲▼ select · ENT delete",
        };
      },
      ent(ctx) {
        if (ctx.state.addressBook.length) {
          const removed = ctx.state.addressBook.splice(ctx.flow.index || 0, 1)[0];
          ctx.toast(`Deleted ${removed.name}`);
        }
        ctx.goHome();
      },
    },
    setupDeleteGroupList: {
      items(ctx) {
        return ctx.state.groupBook;
      },
      render(ctx) {
        const names = ctx.state.groupBook.map((g) => g.name);
        return {
          title: "<Delete group ID>",
          body: names.length ? ctx.windowLines(markedList(names, ctx.flow.index), ctx.flow.index || 0) : "(empty)",
          foot: "▲▼ select · ENT delete",
        };
      },
      ent(ctx) {
        if (ctx.state.groupBook.length) {
          const removed = ctx.state.groupBook.splice(ctx.flow.index || 0, 1)[0];
          ctx.toast(`Deleted ${removed.name}`);
        }
        ctx.goHome();
      },
    },
    offsetSign: {
      render(ctx) {
        return { title: "<Offset time>", body: `Sign: ${ctx.flow.sign} (▲▼ to toggle)`, foot: "ENT next · CLR exit" };
      },
      up(ctx) { ctx.flow.sign = ctx.flow.sign === "-" ? "+" : "-"; },
      down(ctx) { ctx.flow.sign = ctx.flow.sign === "-" ? "+" : "-"; },
      ent(ctx) {
        ctx.goto("offsetValue", { ...ctx.flow, ed: { chars: [], cursor: 0, maxLen: 4 } });
      },
    },
    offsetValue: {
      render(ctx) {
        return { title: "<Offset time>", body: `${ctx.flow.sign}${ctx.ed2str(ctx.flow.ed)}_  (HHMM)`, foot: "<CLR→Exit/ENT→OK>" };
      },
      ent(ctx) {
        const f = ctx.flow;
        const v = (f.ed.chars.join("") || "0000").padStart(4, "0");
        const mins = parseInt(v.slice(0, 2), 10) * 60 + parseInt(v.slice(2), 10);
        ctx.state.offsetMinutes = (f.sign === "-" ? -1 : 1) * mins;
        ctx.log("offset_set", { minutes: ctx.state.offsetMinutes });
        ctx.toast("Local time offset saved");
        ctx.goHome();
      },
    },
    brightness: {
      render(ctx) {
        return { title: "<Brightness>", body: `Level: ${ctx.state.brightness} / 8`, foot: "▲▼ adjust · CLR exit" };
      },
      up(ctx) { ctx.state.brightness = Math.min(8, ctx.state.brightness + 1); },
      down(ctx) { ctx.state.brightness = Math.max(1, ctx.state.brightness - 1); },
    },
    contrast: {
      render(ctx) {
        return { title: "<Contrast>", body: `Level: ${ctx.state.contrast} / 8`, foot: "▲▼ adjust · CLR exit" };
      },
      up(ctx) { ctx.state.contrast = Math.min(8, ctx.state.contrast + 1); },
      down(ctx) { ctx.state.contrast = Math.max(1, ctx.state.contrast - 1); },
    },
    mmsiCheck: {
      render(ctx) {
        ctx.log("mmsi_check", {});
        return { title: "<MMSI check>", body: ctx.state.mmsi, foot: "<CLR→Exit>" };
      },
    },
    dscSelfTest: {
      render(ctx) {
        if (!ctx.flow.ranAt) {
          ctx.flow.ranAt = Date.now();
          ctx.log("dsc_self_test", {});
        }
        return { title: "<DSC self-test>", body: "Testing modem…\n\nTEST OK\n(no signal transmitted)", foot: "<CLR→Exit>" };
      },
    },
  };

  global.DS100_CONFIG = {
    DISTRESS_NATURES,
    SUBJECT_ITEMS,
    SETUP_ITEMS,
    ADDRESS_ITEMS,
    ALL_SHIPS_CATEGORIES,
    KEYPAD_LETTERS,
    RECEIVED_OTHER_KINDS,
    RECEIVED_OTHER_LABELS,
    SCREENS,
  };
})(window);
