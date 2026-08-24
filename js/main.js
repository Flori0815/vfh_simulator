/**
 * Boot both units, wire the mobile tab switcher, the toast helper, the
 * "simulate incoming DSC traffic" debug panel, and the cross-unit
 * behavior described in docs/MENU-STRUCTURE.md ("Cross-unit behavior"):
 * DSC calls and alerts move the IC-M503 to Ch70/Ch16 automatically.
 * All of that cross-unit wiring goes through dscBus — the same seam
 * Stage 2 (AI-generated traffic) will use — so m503.js and ds100.js
 * never reference each other directly.
 */
(function () {
  "use strict";

  let toastTimer = null;
  window.simToast = function simToast(message) {
    const node = document.getElementById("toast");
    if (!node) return;
    node.textContent = message;
    node.classList.add("is-visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => node.classList.remove("is-visible"), 2600);
  };

  const m503 = window.createM503(document.getElementById("unit-m503"));
  const ds100 = window.createDS100(document.getElementById("unit-ds100"));
  m503.powerOn(false);
  // Exposed for debugging / future automated exercises (Stage 3 grading).
  window.simState = { m503, ds100 };

  // ---- cross-unit wiring via dscBus --------------------------------------
  function toChannelForTraffic() {
    if (!m503.state.power) return;
    m503.state.mode = "normal";
    m503.state.channel = 70;
    m503.render();
    setTimeout(() => {
      if (!m503.state.power) return;
      m503.state.channel = 16;
      m503.render();
    }, 1500);
  }

  window.dscBus.on("outgoing", (msg) => {
    if (["distress", "individual", "group", "all_ships"].includes(msg.kind)) {
      toChannelForTraffic();
    }
  });
  window.dscBus.on("incoming", (msg) => {
    if (["distress", "distress_relay", "distress_ack", "distress_relay_ack"].includes(msg.kind)) {
      if (!m503.state.power) return;
      m503.state.mode = "ch16";
      m503.render();
    }
  });

  // ---- debug panel: stand-in for Stage 2's AI-generated traffic ---------
  const SIM_PRESETS = {
    distress: () => ({
      fromMMSI: "244123456",
      fromName: "MV Northern Star",
      natureOfDistress: "flooding",
      position: { lat: 54.32, lon: 8.15 },
      time: new Date().toISOString().slice(11, 16),
    }),
    individual: () => ({ fromMMSI: "211567892", fromName: "DS-100 SN2", toMMSI: "211234567", channel: 72 }),
    group: () => ({ fromMMSI: "211567893", fromName: "DS-100 SN3", groupId: "00302340", channel: 78 }),
    all_ships: () => ({ fromMMSI: "211987654", fromName: "Coast Guard", channel: 14, category: "urgency" }),
    position_request: () => ({ fromMMSI: "211567892", fromName: "DS-100 SN2" }),
    distress_ack: () => ({ fromMMSI: "002111000", fromName: "Bremen Rescue Radio", distressMMSI: "244123456" }),
  };

  document.querySelectorAll("#debug-panel [data-sim]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const kind = btn.dataset.sim;
      const build = SIM_PRESETS[kind];
      if (build) window.dscBus.incoming(kind, build());
    });
  });

  // ---- mobile tab switcher -------------------------------------------------
  const tabs = document.querySelectorAll(".tab-btn");
  const panels = document.querySelectorAll("[data-unit-panel]");
  function showPanel(name) {
    panels.forEach((p) => p.classList.toggle("is-active-tab", p.dataset.unitPanel === name));
    tabs.forEach((t) => t.classList.toggle("is-active", t.dataset.target === name));
  }
  tabs.forEach((t) => t.addEventListener("click", () => showPanel(t.dataset.target)));
  showPanel("m503");
})();
