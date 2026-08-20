/**
 * NOVARA Platform – Date/Time Formatting Utility
 * Formats dates as MM-DD-YY and time (e.g. 08-14-26 20:45).
 *
 * Reading sort keys look like ``2026-08-07T20:45:00Z#SYS001``. Those must be
 * stripped before Date parsing, otherwise Chart.js falls back to the raw key.
 */
(function (root) {
  var COMPOSITE_KEY_RE = /#(SYS\d+)$/i;
  var ISO_PARTS_RE =
    /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/;
  var FORMATTED_TICK_RE = /^\d{2}-\d{2}-\d{2} \d{2}:\d{2}$/;
  var DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

  function pad(n) {
    return n < 10 ? "0" + n : String(n);
  }

  /**
   * Readings store DynamoDB sort keys as ``{iso}#SYS001``.
   * Chart labels and Date parsing need the ISO timestamp only.
   */
  function stripReadingSortKey(input) {
    if (input == null) return "";
    return String(input).trim().replace(COMPOSITE_KEY_RE, "");
  }

  function formatFromIsoParts(raw) {
    var match = ISO_PARTS_RE.exec(raw);
    if (!match) return "";
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

  function parseDate(input) {
    if (input instanceof Date) return input;
    if (input == null || input === "") return new Date(NaN);
    var raw = stripReadingSortKey(input);
    if (!raw) return new Date(NaN);

    var dateOnly = DATE_ONLY_RE.exec(raw);
    if (dateOnly) {
      return new Date(
        Number(dateOnly[1]),
        Number(dateOnly[2]) - 1,
        Number(dateOnly[3])
      );
    }

    var iso = ISO_PARTS_RE.exec(raw);
    if (iso) {
      return new Date(
        Date.UTC(
          Number(iso[1]),
          Number(iso[2]) - 1,
          Number(iso[3]),
          Number(iso[4]),
          Number(iso[5]),
          Number(iso[6] || 0)
        )
      );
    }

    return new Date(raw);
  }

  function isDateOnly(input) {
    return typeof input === "string" && DATE_ONLY_RE.test(input.trim());
  }

  function formatDateFromUtc(d) {
    return (
      pad(d.getUTCMonth() + 1) +
      "-" +
      pad(d.getUTCDate()) +
      "-" +
      String(d.getUTCFullYear()).slice(-2)
    );
  }

  function formatDateFromLocal(d) {
    return (
      pad(d.getMonth() + 1) +
      "-" +
      pad(d.getDate()) +
      "-" +
      String(d.getFullYear()).slice(-2)
    );
  }

  function formatDate(input) {
    if (typeof input === "string") {
      var raw = stripReadingSortKey(input);
      var iso = ISO_PARTS_RE.exec(raw);
      if (iso) {
        return iso[2] + "-" + iso[3] + "-" + iso[1].slice(-2);
      }
      var dateOnly = DATE_ONLY_RE.exec(raw);
      if (dateOnly) {
        return dateOnly[2] + "-" + dateOnly[3] + "-" + dateOnly[1].slice(-2);
      }
    }
    var d = parseDate(input);
    if (isNaN(d.getTime())) return "";
    if (input instanceof Date) return formatDateFromLocal(d);
    return formatDateFromUtc(d);
  }

  function formatTime(input) {
    var d = parseDate(input);
    if (isNaN(d.getTime())) return "";
    var utc = typeof input === "string" && ISO_PARTS_RE.test(stripReadingSortKey(input));
    var hours = utc ? d.getUTCHours() : d.getHours();
    var minutes = pad(utc ? d.getUTCMinutes() : d.getMinutes());
    var ampm = hours >= 12 ? "PM" : "AM";
    hours = hours % 12;
    hours = hours ? hours : 12;
    return pad(hours) + ":" + minutes + " " + ampm;
  }

  function formatDateTime(input, options) {
    options = options || {};
    if (typeof input === "string") {
      var raw = stripReadingSortKey(input);
      if (FORMATTED_TICK_RE.test(raw) && options.use24Hour !== false) {
        return raw;
      }
      var fromIso = formatFromIsoParts(raw);
      if (fromIso && options.use24Hour) {
        return fromIso;
      }
    }

    var d = parseDate(input);
    if (isNaN(d.getTime())) return "";
    var includeSeconds = Boolean(options.includeSeconds);
    var use24Hour = Boolean(options.use24Hour);
    var utc =
      typeof input === "string" &&
      ISO_PARTS_RE.test(stripReadingSortKey(input));

    var datePart = utc ? formatDateFromUtc(d) : formatDateFromLocal(d);
    var hours = utc ? d.getUTCHours() : d.getHours();
    var minutes = pad(utc ? d.getUTCMinutes() : d.getMinutes());
    var seconds = includeSeconds
      ? ":" + pad(utc ? d.getUTCSeconds() : d.getSeconds())
      : "";

    if (use24Hour) {
      return datePart + " " + pad(hours) + ":" + minutes + seconds;
    }

    var ampm = hours >= 12 ? "PM" : "AM";
    hours = hours % 12;
    hours = hours ? hours : 12;
    return datePart + " " + pad(hours) + ":" + minutes + seconds + " " + ampm;
  }

  function formatChartLabel(input, mode) {
    mode = mode || "datetime";
    if (mode === "date") return formatDate(input);
    if (mode === "time") return formatTime(input);
    if (mode === "datetime24") {
      return formatDateTime(input, { use24Hour: true });
    }
    return formatDateTime(input);
  }

  /**
   * Compact x-axis ticks: date-only for longer spans, 24-hour datetime otherwise.
   * "08-07-26" vs "08-07-26 20:45"
   */
  function chartTickMode(start, end) {
    var a = parseDate(start);
    var b = parseDate(end);
    if (isNaN(a.getTime()) || isNaN(b.getTime())) return "datetime24";
    var hours = Math.abs(b.getTime() - a.getTime()) / 3600000;
    return hours <= 192 ? "datetime24" : "date";
  }

  function formatAxisTick(input, mode) {
    if (typeof input === "string" && FORMATTED_TICK_RE.test(input.trim())) {
      return input.trim();
    }
    var formatted = formatChartLabel(input, mode || "datetime24");
    if (formatted) return formatted;
    var raw = stripReadingSortKey(input);
    return formatFromIsoParts(raw) || raw;
  }

  /**
   * Display helper: date-only values stay MM-DD-YY; timestamps include time.
   * Returns "" for empty/invalid input so callers can substitute "—".
   */
  function formatDisplay(input, options) {
    if (input == null || input === "") return "";
    if (isDateOnly(input)) return formatDate(input);
    var formatted = formatDateTime(input, options);
    return formatted || stripReadingSortKey(input);
  }

  function formatOrDash(input, options) {
    return formatDisplay(input, options) || "—";
  }

  var api = {
    stripReadingSortKey: stripReadingSortKey,
    formatDate: formatDate,
    formatTime: formatTime,
    formatDateTime: formatDateTime,
    formatChartLabel: formatChartLabel,
    chartTickMode: chartTickMode,
    formatAxisTick: formatAxisTick,
    formatDisplay: formatDisplay,
    formatOrDash: formatOrDash,
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
