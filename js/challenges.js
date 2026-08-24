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
      hint: 'POWER einschalten. Falls im Display "ATIS" statt "INTL" steht: HI/LO ca. 0,6 s halten bis es blau leuchtet (Latch), loslassen, dann DIAL antippen — wiederholen bis "INTL" erscheint. Danach 16 antippen (setzt automatisch 25 W) und am SQL-Regler drehen.',
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
      hint: "Mit dem großen Drehknopf einen Arbeitskanal wählen (z. B. Kanal 72), danach am SQL-Regler drehen, um die Rauschsperre neu zu justieren.",
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
      hint: "Mit dem großen Drehknopf einen Arbeitskanal wählen (z. B. Kanal 69), dann HI/LO kurz antippen (kein Halten nötig), um auf 1 W (LOW) zu schalten.",
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
      hint: 'DS-100: CALL antippen → mit ▼ zu "Entry Position/Time" navigieren → ENT. Breiten- und Längengrad über das Zahlenfeld eingeben, jeweils mit ENT bestätigen.',
      setup(sim) {
        sim.ds100.state.manualPosition = null;
      },
      checks: [{ label: "Position manuell eingegeben", check: (sim) => sim.ds100.state.manualPosition != null }],
    },
    5: {
      hint: 'DS-100: CALL → "Entry Position/Time" → ENT → Position eingeben, bis zur UTC-Zeiteingabe weitergehen (ENT) und die Uhrzeit über das Zahlenfeld eingeben.',
      setup(sim) {
        sim.ds100.state.manualTime = null;
      },
      checks: [{ label: "UTC-Zeit manuell eingegeben", check: (sim) => sim.ds100.state.manualTime != null }],
    },
    7: {
      hint: 'DS-100: CALL → ▼ bis "Set-up" → ENT → "MMSI check" → ENT.',
      checks: [{ label: "MMSI-Anzeige aufgerufen (Set-up → MMSI check)", check: (sim, t) => ds100Log(sim, t, "screen", (e) => e.id === "mmsiCheck") }],
    },
    8: {
      hint: 'Mit dem großen Drehknopf auf einen Simplex-Kanal wechseln, z. B. 69, 72 oder 77 (im Display erscheint dann kein "DUP").',
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
      hint: "DUAL-Taste einmal antippen, um die Mehrkanalüberwachung zu beenden.",
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
      hint: 'DS-100: CALL → ▼ bis "Received calls" → ENT → "Other message" → ENT → passenden Eintragstyp und Nachricht öffnen → A/a antippen, um sie zu löschen.',
      setup(sim) {
        seedIncoming("individual", { fromMMSI: "211998877", fromName: "Test Contact", channel: 72 });
      },
      checks: [{ label: "Nachrichtenspeicher geleert", check: (sim) => sim.ds100.state.receivedOther.length === 0 }],
    },
    31: {
      hint: 'DS-100: CALL → ▼ bis "Received calls" → ENT → "Distress message" → ENT, um den gespeicherten Notalarm zu öffnen.',
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
      hint: "DS-100: DISTRESS-Abdeckung anheben, Taste 5 s halten (sendet den Alarm), danach CLR antippen, um ihn zu stornieren.",
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
      hint: "DISTRESS-Taste antippen und vor Ablauf der Haltezeit wieder loslassen. Hinweis: In diesem Simulator (Icom DS-100-Vorbild) sind es 5 s Haltezeit; der Prüfungskatalog nennt 3 s als allgemeine Mindesthaltezeit für DSC-Geräte.",
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
      hint: 'DS-100: CALL → ▼ bis "All ships call" → ENT → "Urgency" wählen → ENT → Kanal bestätigen mit ENT.',
      checks: [{ label: "DSC-Anruf ALL SHIPS mit Priorität URGENCY gesendet", check: (sim, t) => ds100Log(sim, t, "call_tx", (e) => e.kind === "all_ships" && e.category === "urgency") }],
    },
    69: {
      hint: 'DS-100: CALL → "Individual call" → ENT → "Manual entry" → MMSI der Küstenfunkstelle mit führenden Nullen eingeben (z. B. 002111200) → ENT → Kanal bestätigen mit ENT.',
      checks: [{ label: "Einzelanruf an eine Küstenfunkstelle (MMSI 00…) gesendet", check: (sim, t) => ds100Log(sim, t, "call_tx", (e) => e.kind === "individual" && String(e.toMMSI).startsWith("00")) }],
    },
    81: {
      hint: 'DS-100: CALL → ▼ bis "All ships call" → ENT → "Safety" wählen → ENT → Kanal bestätigen mit ENT.',
      checks: [{ label: "DSC-Anruf ALL SHIPS mit Priorität SAFETY gesendet", check: (sim, t) => ds100Log(sim, t, "call_tx", (e) => e.kind === "all_ships" && e.category === "safety") }],
    },
    93: {
      hint: 'DS-100: "Individual call" → Adressbucheintrag oder "Manual entry" wählen → auf der Kanalseite BS zweimal antippen (löscht die "16") und 69, 72 oder 77 eingeben → ENT.',
      checks: [
        {
          label: "Einzelanruf mit gültigem Simplex-Arbeitskanal (69/72/77) gesendet",
          check: (sim, t) => ds100Log(sim, t, "call_tx", (e) => e.kind === "individual" && SIMPLEX_WORKING_CHANNELS.includes(e.channel)),
        },
      ],
    },
    96: {
      hint: 'DS-100: "Individual call" → "Manual entry" → MMSI der Küstenfunkstelle mit führenden Nullen eingeben (z. B. 002111200) → ENT.',
      checks: [{ label: "Einzelanruf an eine Küstenfunkstelle (MMSI 00…) gesendet", check: (sim, t) => ds100Log(sim, t, "call_tx", (e) => e.kind === "individual" && String(e.toMMSI).startsWith("00")) }],
    },
    98: {
      hint: "16-Taste auf dem IC-M503 kurz antippen (kein Halten nötig).",
      setup(sim) {
        sim.m503.powerOn(false);
        sim.m503.selectChannel(72);
      },
      checks: [{ label: "Schnellwahltaste 16 gedrückt", check: (sim, t) => m503Log(sim, t, "ch16_select") }],
    },
    99: {
      hint: 'DS-100: CALL → ▼ bis "Set-up" → ENT → ▼ bis "DSC self-test" → ENT.',
      checks: [{ label: "DSC-Selbsttest ausgeführt (Set-up → DSC self-test)", check: (sim, t) => ds100Log(sim, t, "dsc_self_test") }],
    },
    104: {
      hint: "Mit dem großen Drehknopf Kanal 11 wählen, dann HI/LO kurz antippen, um auf 1 W zu schalten.",
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
      hint: "16-Taste antippen (setzt automatisch Kanal 16 und 25 W). Lautstärke/Squelch bei Bedarf nachjustieren; Kanalgruppe sollte INTL (nicht ATIS) sein.",
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
  const NATURE_LABELS = {
    undesignated: "Undesignated", fire: "Fire, Explosion", flooding: "Flooding", collision: "Collision",
    grounding: "Grounding", capsizing: "Capsizing", sinking: "Sinking", man_overboard: "Man overboard",
    adrift: "Disabled and adrift", abandoning: "Abandoning ship",
  };
  Object.keys(NATURE_BY_QUESTION).forEach((numStr) => {
    const num = Number(numStr);
    const nature = NATURE_BY_QUESTION[numStr];
    const natureLabel = NATURE_LABELS[nature];
    DEVICE[num] = {
      hint:
        nature === "undesignated"
          ? "DS-100: DISTRESS-Abdeckung anheben, Taste 5 s halten — ohne vorherige Notgrundauswahl wird automatisch „Undesignated“ gesendet."
          : `DS-100: CALL → ▼ bis "Distress setting" → ENT → "${natureLabel}" wählen → ENT. Danach DISTRESS-Abdeckung anheben und die Taste 5 s halten.`,
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
      hint: device && device.hint ? device.hint : null,
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
