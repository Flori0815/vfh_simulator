/**
 * Wraps the raw 105-task catalog (js/challenges-data.js) with automated
 * grading for the subset that's fully device-driven, and marks everything
 * else as a self-certified voice/procedure checklist — the real spoken
 * phrases (MAYDAY, PAN PAN, SECURITE, phonetic alphabet, …) can't be
 * graded until audio recognition lands (see docs/ROADMAP.md, Stage 2/3).
 *
 * A challenge here is: { number, category, title, important, steps,
 * criteria, type: 'device'|'voice', setup(sim), checks: [{label, check}] }.
 * `check(sim, sinceTs)` returns true/false; `sim` is { m503, ds100 } — the
 * same objects window.simState exposes. Every device challenge is graded
 * purely by inspecting m503/ds100 state and their action logs (see the
 * `log` field on both), never by special-casing the UI — so this file
 * never has to know about button coordinates or DOM structure.
 */
(function (global) {
  "use strict";

  const RAW = global.CHALLENGES_RAW;

  // ---------------------------------------------------------------- helpers
  function logSince(log, sinceTs, type, pred) {
    return log.some((e) => e.type === type && e.at >= sinceTs && (!pred || pred(e)));
  }
  function m503Log(sim, sinceTs, type, pred) {
    return logSince(sim.m503.state.log, sinceTs, type, pred);
  }
  function ds100Log(sim, sinceTs, type, pred) {
    return logSince(sim.ds100.state.log, sinceTs, type, pred);
  }
  const SIMPLEX_WORKING_CHANNELS = [69, 72, 77];

  function seedIncoming(kind, payload) {
    global.dscBus.incoming(kind, payload);
  }

  // ------------------------------------------------------- device checks (33 tasks)
  // Keyed by question number. `setup(sim)` seeds the starting scenario
  // when a challenge is started (radio powered off, dual-watch left on
  // from a "previous watch", an unread message waiting, …) so the task
  // means something instead of already being satisfied by defaults.
  const DEVICE = {
    1: {
      setup(sim) {
        sim.m503.powerOff();
        sim.m503.state.group = "ATIS";
      },
      checks: [
        { label: "Gerät eingeschaltet", check: (sim) => sim.m503.state.power },
        { label: "Seefunk-Modus aktiv (nicht ATIS)", check: (sim) => sim.m503.state.group !== "ATIS" },
        { label: "Kanal 16 angewählt", check: (sim) => sim.m503.state.channel === 16 || sim.m503.state.mode === "ch16" },
        { label: "Sendeleistung 25 W", check: (sim) => sim.m503.state.hi === true },
        { label: "Rauschsperre (Squelch) bedient", check: (sim, t) => m503Log(sim, t, "squelch") },
      ],
    },
    2: {
      setup(sim) {
        sim.m503.powerOn(false);
        sim.m503.selectChannel(16);
      },
      checks: [
        { label: "Kanalwechsel auf einen Arbeitskanal", check: (sim, t) => m503Log(sim, t, "channel", (e) => e.channel !== 16) },
        { label: "Rauschsperre nach dem Kanalwechsel neu eingestellt", check: (sim, t) => m503Log(sim, t, "squelch") },
      ],
    },
    3: {
      setup(sim) {
        sim.m503.powerOn(false);
        sim.m503.selectChannel(69);
        sim.m503.state.hi = true;
      },
      checks: [
        { label: "Arbeitskanal eingestellt (nicht 16)", check: (sim) => sim.m503.state.channel !== 16 },
        { label: "Sendeleistung auf 1 W (LOW)", check: (sim) => sim.m503.state.hi === false },
      ],
    },
    4: {
      setup(sim) {
        sim.ds100.state.manualPosition = null;
      },
      checks: [{ label: "Position manuell eingegeben", check: (sim) => sim.ds100.state.manualPosition != null }],
    },
    5: {
      setup(sim) {
        sim.ds100.state.manualTime = null;
      },
      checks: [{ label: "UTC-Zeit manuell eingegeben", check: (sim) => sim.ds100.state.manualTime != null }],
    },
    7: {
      checks: [{ label: "MMSI-Anzeige aufgerufen (Set-up → MMSI check)", check: (sim, t) => ds100Log(sim, t, "screen", (e) => e.id === "mmsiCheck") }],
    },
    8: {
      setup(sim) {
        sim.m503.powerOn(false);
        sim.m503.selectChannel(1); // duplex channel
      },
      checks: [
        {
          label: "Auf einen Simplex-Arbeitskanal (69/72/77) gewechselt",
          check: (sim) => SIMPLEX_WORKING_CHANNELS.includes(sim.m503.state.channel),
        },
      ],
    },
    9: {
      setup(sim) {
        sim.m503.powerOn(false);
        sim.m503.state.dual = "dual";
      },
      checks: [
        { label: "Mehrkanalbetrieb (DUAL) beendet", check: (sim) => sim.m503.state.dual === "off" },
        { label: "DUAL-Taste tatsächlich betätigt", check: (sim, t) => m503Log(sim, t, "dual") },
      ],
    },
    10: {
      setup(sim) {
        seedIncoming("individual", { fromMMSI: "211998877", fromName: "Test Contact", channel: 72 });
      },
      checks: [{ label: "Nachrichtenspeicher geleert", check: (sim) => sim.ds100.state.receivedOther.length === 0 }],
    },
    31: {
      setup(sim) {
        seedIncoming("distress", {
          fromMMSI: "244555666",
          natureOfDistress: "flooding",
          position: { lat: 54.1, lon: 8.2 },
          time: "12:00",
        });
      },
      checks: [{ label: "Notalarm-Speicher (Received calls → Distress) geöffnet", check: (sim, t) => ds100Log(sim, t, "screen", (e) => e.id === "receivedDetail") }],
    },
    56: {
      checks: [
        {
          label: "Notalarm gesendet und danach am Gerät storniert",
          check: (sim, t) => {
            const log = sim.ds100.state.log.filter((e) => e.at >= t);
            const txIdx = log.findIndex((e) => e.type === "distress_tx");
            if (txIdx === -1) return false;
            return log.slice(txIdx + 1).some((e) => e.type === "distress_cancel");
          },
        },
      ],
    },
    61: {
      checks: [
        {
          label: "DISTRESS-Taste vor Ablauf losgelassen, kein Alarm gesendet",
          check: (sim, t) => {
            const log = sim.ds100.state.log.filter((e) => e.at >= t);
            const released = log.some((e) => e.type === "distress_release" && e.heldMs < 5000);
            const transmitted = log.some((e) => e.type === "distress_tx");
            return released && !transmitted;
          },
        },
      ],
    },
    66: {
      checks: [{ label: "DSC-Anruf ALL SHIPS mit Priorität URGENCY gesendet", check: (sim, t) => ds100Log(sim, t, "call_tx", (e) => e.kind === "all_ships" && e.category === "urgency") }],
    },
    69: {
      checks: [{ label: "Einzelanruf an eine Küstenfunkstelle (MMSI 00…) gesendet", check: (sim, t) => ds100Log(sim, t, "call_tx", (e) => e.kind === "individual" && String(e.toMMSI).startsWith("00")) }],
    },
    81: {
      checks: [{ label: "DSC-Anruf ALL SHIPS mit Priorität SAFETY gesendet", check: (sim, t) => ds100Log(sim, t, "call_tx", (e) => e.kind === "all_ships" && e.category === "safety") }],
    },
    93: {
      checks: [
        {
          label: "Einzelanruf mit gültigem Simplex-Arbeitskanal (69/72/77) gesendet",
          check: (sim, t) => ds100Log(sim, t, "call_tx", (e) => e.kind === "individual" && SIMPLEX_WORKING_CHANNELS.includes(e.channel)),
        },
      ],
    },
    96: {
      checks: [{ label: "Einzelanruf an eine Küstenfunkstelle (MMSI 00…) gesendet", check: (sim, t) => ds100Log(sim, t, "call_tx", (e) => e.kind === "individual" && String(e.toMMSI).startsWith("00")) }],
    },
    98: {
      setup(sim) {
        sim.m503.powerOn(false);
        sim.m503.selectChannel(72);
      },
      checks: [{ label: "Schnellwahltaste 16 gedrückt", check: (sim, t) => m503Log(sim, t, "ch16_select") }],
    },
    99: {
      checks: [{ label: "DSC-Selbsttest ausgeführt (Set-up → DSC self-test)", check: (sim, t) => ds100Log(sim, t, "dsc_self_test") }],
    },
    104: {
      setup(sim) {
        sim.m503.powerOn(false);
        sim.m503.selectChannel(16);
        sim.m503.state.hi = true;
      },
      checks: [
        { label: "Kanal 11 (Port Control) eingestellt", check: (sim) => sim.m503.state.channel === 11 },
        { label: "Sendeleistung auf 1 W reduziert", check: (sim) => sim.m503.state.hi === false },
      ],
    },
    105: {
      setup(sim) {
        sim.m503.powerOn(false);
        sim.m503.selectChannel(72);
        sim.m503.state.hi = false;
      },
      checks: [
        { label: "Kanal 16 eingestellt", check: (sim) => sim.m503.state.channel === 16 || sim.m503.state.mode === "ch16" },
        { label: "Sendeleistung auf 25 W zurückgesetzt", check: (sim) => sim.m503.state.hi === true },
        { label: "Seefunk-Modus aktiv (nicht ATIS)", check: (sim) => sim.m503.state.group !== "ATIS" },
      ],
    },
  };

  // DSC distress-with-specific-nature tasks (12-20) are all structurally
  // identical — parameterize instead of repeating.
  const NATURE_BY_QUESTION = {
    11: "undesignated", 12: "fire", 13: "flooding", 14: "collision", 15: "grounding",
    16: "capsizing", 17: "sinking", 18: "man_overboard", 19: "adrift", 20: "abandoning",
  };
  Object.keys(NATURE_BY_QUESTION).forEach((numStr) => {
    const num = Number(numStr);
    const nature = NATURE_BY_QUESTION[numStr];
    DEVICE[num] = {
      checks: [
        {
          label: `DSC-Notalarm mit Notgrund "${nature}" auf Kanal 70 gesendet`,
          check: (sim, t) => ds100Log(sim, t, "distress_tx", (e) => e.nature === nature),
        },
        {
          label: "Gerät danach auf Kanal 16",
          check: (sim, t) => m503Log(sim, t, "channel", (e) => e.channel === 16) || (sim.m503.state.channel === 16 && sim.m503.state.hi === true),
        },
      ],
    };
  });

  // ---------------------------------------------------------------- build
  const all = RAW.map((raw) => {
    const device = DEVICE[raw.number];
    return Object.assign({}, raw, {
      type: device ? "device" : "voice",
      setup: device && device.setup ? device.setup : null,
      checks: device ? device.checks : null,
    });
  });

  function byCategory() {
    const map = new Map();
    all.forEach((c) => {
      if (!map.has(c.category)) map.set(c.category, []);
      map.get(c.category).push(c);
    });
    return map;
  }

  function evaluate(sim, challenge, sinceTs) {
    if (challenge.type !== "device") return [];
    return challenge.checks.map((c) => ({ label: c.label, pass: !!c.check(sim, sinceTs) }));
  }

  global.Challenges = { all, byCategory, evaluate };
})(window);
