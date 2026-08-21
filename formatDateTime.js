/**
 * NOVARA date/time labels for charts and UI.
 *
 * DynamoDB reading sort keys look like ``2026-08-07T21:30:00Z#SYS001``.
 * ``new Date(thatString)`` is NaN, so Chart.js falls back to the raw key.
 * Always strip ``#(SYSnnn)`` and format as ``MM-DD-YY HH:MM`` from the ISO
 * parts (UTC clock time as stored — 21:30 stays 21:30).
 */
(function (root) {
  var COMPOSITE_KEY_RE = /#(SYS\d+)\s*$/i;
  var ISO_PARTS_RE =
    /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/;
  var FORMATTED_TICK_RE = /^\d{2}-\d{2}-\d{2} \d{2}:\d{2}$/;

  function stripReadingSortKey(input) {
    if (input == null) return "";
    return String(input).trim().replace(COMPOSITE_KEY_RE, "");
  }

  /**
   * X-axis ticks and tooltip titles: ``08-07-26 21:30``.
   * Never returns ``#SYS001``. Idempotent if already formatted.
   */
  function formatAxisTick(input) {
    if (input == null || input === "") return "";
    var raw = stripReadingSortKey(input);
    if (FORMATTED_TICK_RE.test(raw)) return raw;
    var match = ISO_PARTS_RE.exec(raw);
    if (!match) return raw;
    return (
      match[2] +
      "-" +
      match[3] +
      "-" +
      match[1].slice(-2) +
      " " +
      match[4] +
      ":" +
      match[5]
    );
  }

  function formatDateTime(input, options) {
    options = options || {};
    var tick = formatAxisTick(input);
    if (!tick) return "";
    if (options.use24Hour !== false) return tick;
    var match = /^(\d{2}-\d{2}-\d{2}) (\d{2}):(\d{2})$/.exec(tick);
    if (!match) return tick;
    var hours = Number(match[2]);
    var ampm = hours >= 12 ? "PM" : "AM";
    hours = hours % 12;
    hours = hours ? hours : 12;
    var hh = hours < 10 ? "0" + hours : String(hours);
    return match[1] + " " + hh + ":" + match[3] + " " + ampm;
  }

  var api = {
    stripReadingSortKey: stripReadingSortKey,
    formatAxisTick: formatAxisTick,
    formatDateTime: formatDateTime,
    formatDisplay: formatAxisTick,
    formatChartLabel: formatAxisTick,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.NovaraDateTime = api;
  }
})(
  typeof window !== "undefined"
    ? window
    : typeof global !== "undefined"
      ? global
      : this
);
