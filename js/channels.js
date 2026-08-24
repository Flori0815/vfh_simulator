/**
 * VHF Marine channel data, from the IC-M503 manual's International channel
 * list (p.26) — identical table is reprinted in the DS-100 manual (p.23).
 * tx/rx in MHz. duplex = tx !== rx. Ch70 is DSC-only (no voice TX).
 */
(function (global) {
  "use strict";

  const RAW_INTERNATIONAL = [
    [1, 156.050, 160.650], [2, 156.100, 160.700], [3, 156.150, 160.750],
    [4, 156.200, 160.800], [5, 156.250, 160.850], [6, 156.300, 156.300],
    [7, 156.350, 160.950], [8, 156.400, 156.400], [9, 156.450, 156.450],
    [10, 156.500, 156.500], [11, 156.550, 156.550], [12, 156.600, 156.600],
    [13, 156.650, 156.650], [14, 156.700, 156.700], [15, 156.750, 156.750],
    [16, 156.800, 156.800], [17, 156.850, 156.850], [18, 156.900, 161.500],
    [19, 156.950, 161.550], [20, 157.000, 161.600], [21, 157.050, 161.650],
    [22, 157.100, 161.700], [23, 157.150, 161.750], [24, 157.200, 161.800],
    [25, 157.250, 161.850], [26, 157.300, 161.900], [27, 157.350, 161.950],
    [28, 157.400, 162.000], [60, 156.025, 160.625], [61, 156.075, 160.675],
    [62, 156.125, 160.725], [63, 156.175, 160.775], [64, 156.225, 160.825],
    [65, 156.275, 160.875], [66, 156.325, 160.925], [67, 156.375, 156.375],
    [68, 156.425, 156.425], [69, 156.475, 156.475], [70, 156.525, 156.525],
    [71, 156.575, 156.575], [72, 156.625, 156.625], [73, 156.675, 156.675],
    [74, 156.725, 156.725], [75, 156.775, 156.775], [76, 156.825, 156.825],
    [77, 156.875, 156.875], [78, 156.925, 161.525], [79, 156.975, 161.575],
    [80, 157.025, 161.625], [81, 157.075, 161.675], [82, 157.125, 161.725],
    [83, 157.175, 161.775], [84, 157.225, 161.825], [85, 157.275, 161.875],
    [86, 157.325, 161.925], [87, 157.375, 157.375], [88, 157.425, 157.425],
  ];

  // Low-power-only channels (†) and receive-only (‡), per the manual.
  const LOW_POWER_ONLY = new Set([15, 17, 75, 76]);
  const RECEIVE_ONLY = new Set([70]);

  const INTERNATIONAL = RAW_INTERNATIONAL.map(([ch, tx, rx]) => ({
    channel: ch,
    tx, rx,
    duplex: tx !== rx,
    lowPowerOnly: LOW_POWER_ONLY.has(ch),
    receiveOnly: RECEIVE_ONLY.has(ch),
    dsc: ch === 70,
    distress: ch === 16,
  }));

  const byChannel = new Map(INTERNATIONAL.map((c) => [c.channel, c]));

  // Ordered list of selectable channel numbers (excludes gaps, e.g. no 29-59).
  const ORDER = INTERNATIONAL.map((c) => c.channel).sort((a, b) => a - b);

  function getChannel(number) {
    return byChannel.get(number) || null;
  }

  function nextChannel(current, delta) {
    const idx = ORDER.indexOf(current);
    const base = idx === -1 ? 0 : idx;
    const len = ORDER.length;
    const nextIdx = ((base + delta) % len + len) % len;
    return ORDER[nextIdx];
  }

  global.VHFChannels = {
    groups: { INTL: INTERNATIONAL },
    order: ORDER,
    getChannel,
    nextChannel,
  };
})(window);
