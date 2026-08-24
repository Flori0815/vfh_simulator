/**
 * dscBus — a tiny pub/sub bus carrying DSC (Digital Selective Calling)
 * messages between the DS-100 UI and the rest of the app.
 *
 * This is the intentional seam for Stage 2 of the roadmap (see
 * docs/ROADMAP.md): an AI backend that plays "other vessels" only needs to
 * call `dscBus.incoming(message)` with a message matching one of the
 * shapes below, and the DS-100 reacts exactly as it does to the built-in
 * "simulate incoming call" debug panel. Symmetrically, anything the AI
 * needs to react *to* is published here via `dscBus.outgoing(message)`
 * whenever the user places a call from the DS-100 UI.
 *
 * Message `kind` mirrors the call/receive types documented in the DS-100
 * manual (see docs/MENU-STRUCTURE.md § "Receiving calls"):
 *   distress, distress_relay, distress_ack, distress_relay_ack,
 *   individual, individual_ack, group, all_ships,
 *   position_request, position_reply
 *
 * DSC_MESSAGE_SHAPES documents the fields each kind carries; it's not
 * enforced at runtime (this stays a plain JS object bus, no schema
 * library) but is the contract a future AI integration should target.
 */
(function (global) {
  "use strict";

  const DSC_MESSAGE_SHAPES = {
    distress: {
      fromMMSI: "string (9 digits)",
      natureOfDistress:
        "'undesignated'|'fire'|'flooding'|'collision'|'grounding'|'capsizing'|'sinking'|'adrift'|'abandoning'|'piracy'|'man_overboard'|'epirb'",
      position: "{ lat: number, lon: number } | null",
      time: "'HH:MM' UTC | null",
    },
    distress_relay: { fromMMSI: "string", relayedFromMMSI: "string", natureOfDistress: "string", position: "object|null", time: "string|null" },
    distress_ack: { fromMMSI: "string", fromName: "string", distressMMSI: "string" },
    distress_relay_ack: { fromMMSI: "string", fromName: "string", distressMMSI: "string" },
    individual: { fromMMSI: "string", fromName: "string", toMMSI: "string", channel: "number (default 16)", category: "'routine'|'safety'|'urgency'|'distress'" },
    individual_ack: { fromMMSI: "string", fromName: "string", toMMSI: "string" },
    group: { fromMMSI: "string", fromName: "string", groupId: "string (8 digits)", channel: "number", category: "string" },
    all_ships: { fromMMSI: "string", fromName: "string", channel: "number", category: "'routine'|'safety'|'urgency'" },
    position_request: { fromMMSI: "string", fromName: "string" },
    position_reply: { fromMMSI: "string", fromName: "string", position: "{ lat, lon }" },
  };

  let seq = 0;
  const handlers = { incoming: new Set(), outgoing: new Set(), any: new Set() };

  function makeMessage(direction, kind, payload) {
    return Object.assign(
      {
        id: `dsc-${Date.now()}-${seq++}`,
        direction,
        kind,
        timestamp: new Date().toISOString(),
      },
      payload
    );
  }

  function dispatch(direction, message) {
    handlers[direction].forEach((fn) => fn(message));
    handlers.any.forEach((fn) => fn(message));
  }

  const dscBus = {
    SHAPES: DSC_MESSAGE_SHAPES,

    /** A future AI backend (or the debug panel) calls this to simulate a
     *  call arriving from another station. */
    incoming(kind, payload) {
      const message = makeMessage("incoming", kind, payload);
      dispatch("incoming", message);
      return message;
    },

    /** The DS-100 UI calls this whenever the user actually transmits a call. */
    outgoing(kind, payload) {
      const message = makeMessage("outgoing", kind, payload);
      dispatch("outgoing", message);
      return message;
    },

    /** direction: 'incoming' | 'outgoing' | 'any' */
    on(direction, handler) {
      handlers[direction].add(handler);
      return () => handlers[direction].delete(handler);
    },

    off(direction, handler) {
      handlers[direction].delete(handler);
    },
  };

  global.dscBus = dscBus;
})(window);
