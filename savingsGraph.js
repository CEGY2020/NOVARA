/**
 * NOVARA Platform – Savings Graphs
 * Chart.js time-series with calendar date range, zoom, and MM-DD-YY labels.
 */
(function (root) {
  function pad(n) {
    return n < 10 ? "0" + n : String(n);
  }

  function datetime() {
    if (root && root.NovaraDateTime) return root.NovaraDateTime;
    if (typeof global !== "undefined" && global.NovaraDateTime) {
      return global.NovaraDateTime;
    }
    return null;
  }

  function parseInputDate(value) {
    if (value instanceof Date) return value;
    var raw = String(value == null ? "" : value).trim();
    if (!raw) return new Date(NaN);
    var dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
    if (dateOnly) {
      return new Date(
        Number(dateOnly[1]),
        Number(dateOnly[2]) - 1,
        Number(dateOnly[3])
      );
    }
    return new Date(raw);
  }

  function startOfDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  }

  function toInputDate(input) {
    var date = parseInputDate(input);
    if (isNaN(date.getTime())) return "";
    return (
      date.getFullYear() +
      "-" +
      pad(date.getMonth() + 1) +
      "-" +
      pad(date.getDate())
    );
  }

  function daysInclusive(start, end) {
    var from = parseInputDate(start);
    var to = parseInputDate(end);
    if (isNaN(from.getTime()) || isNaN(to.getTime())) return 0;
    return Math.round((startOfDay(to) - startOfDay(from)) / 86400000) + 1;
  }

  function defaultRange(days) {
    var count = Number(days);
    if (!Number.isFinite(count) || count < 1) count = 30;
    var end = new Date();
    var start = new Date(end.getFullYear(), end.getMonth(), end.getDate() - (count - 1));
    return {
      start: toInputDate(start),
      end: toInputDate(end),
      days: count,
    };
  }

  function pointTimestamp(point) {
    if (!point) return "";
    return point.t || point.date || point.timestamp || "";
  }

  function filterPointsByRange(points, start, end) {
    var list = Array.isArray(points) ? points : [];
    var startDate = start ? parseInputDate(start) : null;
    var endDate = end ? parseInputDate(end) : null;
    var startMs =
      startDate && !isNaN(startDate.getTime()) ? startOfDay(startDate) : null;
    var endMs = endDate && !isNaN(endDate.getTime()) ? startOfDay(endDate) : null;
    return list.filter(function (point) {
      var date = parseInputDate(pointTimestamp(point));
      if (isNaN(date.getTime())) return false;
      var ms = startOfDay(date);
      if (startMs != null && ms < startMs) return false;
      if (endMs != null && ms > endMs) return false;
      return true;
    });
  }

  function formatAxisDate(input) {
    var dt = datetime();
    if (dt && dt.formatDate) {
      return dt.formatDate(input) || String(input || "");
    }
    return toInputDate(input) || String(input || "");
  }

  function formatTooltipDate(input) {
    var dt = datetime();
    if (dt && dt.formatDate) {
      return dt.formatDate(input) || String(input || "");
    }
    return formatAxisDate(input);
  }

  function zoomOptions() {
    return {
      limits: {
        x: { min: "original", max: "original", minRange: 1 },
      },
      pan: {
        enabled: true,
        mode: "x",
        modifierKey: "shift",
      },
      zoom: {
        wheel: { enabled: true },
        pinch: { enabled: true },
        drag: {
          enabled: true,
          backgroundColor: "rgba(23, 133, 173, 0.12)",
          borderColor: "#1785ad",
          borderWidth: 1,
        },
        mode: "x",
      },
    };
  }

  function seriesFromPoints(points) {
    var list = Array.isArray(points) ? points : [];
    return {
      labels: list.map(function (point) {
        return pointTimestamp(point);
      }),
      cumulative: list.map(function (point) {
        return Number(point.cumulative) || 0;
      }),
      daily: list.map(function (point) {
        return Number(point.daily) || 0;
      }),
    };
  }

  function defaultCurrencyTooltip(item) {
    var value = item.parsed.y;
    if (value == null) return item.dataset.label + ": —";
    return (
      item.dataset.label +
      ": " +
      Number(value).toLocaleString(undefined, {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
      })
    );
  }

  function createCumulativeChart(canvas, options) {
    if (!canvas || typeof Chart === "undefined") return null;
    options = options || {};
    var initial = seriesFromPoints(options.points || []);
    var tooltipLabel = options.currencyTooltip || defaultCurrencyTooltip;

    return new Chart(canvas.getContext("2d"), {
      type: "line",
      data: {
        labels: initial.labels,
        datasets: [
          {
            label: "Cumulative savings ($)",
            data: initial.cumulative,
            borderColor: "#1785ad",
            backgroundColor: "rgba(23, 133, 173, 0.12)",
            borderWidth: 2,
            pointRadius: 0,
            pointHoverRadius: 4,
            tension: 0.25,
            fill: true,
            yAxisID: "y",
          },
          {
            label: "Daily savings ($)",
            data: initial.daily,
            borderColor: "#d97706",
            backgroundColor: "rgba(217, 119, 6, 0.10)",
            borderWidth: 2,
            pointRadius: 0,
            pointHoverRadius: 4,
            tension: 0.25,
            fill: false,
            yAxisID: "y1",
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: "index",
          intersect: false,
        },
        plugins: {
          legend: {
            position: "top",
            align: "end",
            labels: {
              boxWidth: 12,
              boxHeight: 12,
              usePointStyle: true,
              pointStyle: "circle",
            },
          },
          tooltip: {
            callbacks: {
              title: function (items) {
                if (!items.length) return "";
                return formatTooltipDate(items[0].label);
              },
              label: tooltipLabel,
            },
          },
          zoom: zoomOptions(),
        },
        scales: {
          x: {
            ticks: {
              maxTicksLimit: 8,
              maxRotation: 45,
              minRotation: 0,
              callback: function (value) {
                var label = this.getLabelForValue(value);
                return formatAxisDate(label);
              },
            },
            grid: {
              color: "rgba(15, 45, 58, 0.06)",
            },
          },
          y: {
            position: "left",
            beginAtZero: true,
            title: {
              display: true,
              text: "Cumulative ($)",
            },
            grid: {
              color: "rgba(15, 45, 58, 0.08)",
            },
            ticks: {
              callback: function (value) {
                return "$" + Number(value).toLocaleString();
              },
            },
          },
          y1: {
            position: "right",
            beginAtZero: true,
            title: {
              display: true,
              text: "Daily ($)",
            },
            grid: {
              drawOnChartArea: false,
            },
            ticks: {
              callback: function (value) {
                return "$" + Number(value).toLocaleString();
              },
            },
          },
        },
      },
    });
  }

  function updateCumulativeChart(chart, points) {
    if (!chart) return chart;
    var series = seriesFromPoints(points);
    chart.data.labels = series.labels;
    if (chart.data.datasets[0]) chart.data.datasets[0].data = series.cumulative;
    if (chart.data.datasets[1]) chart.data.datasets[1].data = series.daily;
    chart.update("none");
    resetZoom(chart);
    return chart;
  }

  function resetZoom(chart) {
    if (chart && typeof chart.resetZoom === "function") {
      chart.resetZoom();
    }
    return chart;
  }

  var api = {
    parseInputDate: parseInputDate,
    toInputDate: toInputDate,
    daysInclusive: daysInclusive,
    defaultRange: defaultRange,
    filterPointsByRange: filterPointsByRange,
    formatAxisDate: formatAxisDate,
    formatTooltipDate: formatTooltipDate,
    zoomOptions: zoomOptions,
    createCumulativeChart: createCumulativeChart,
    updateCumulativeChart: updateCumulativeChart,
    resetZoom: resetZoom,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.NovaraSavingsGraph = api;
  }
})(
  typeof window !== "undefined"
    ? window
    : typeof global !== "undefined"
      ? global
      : this
);
