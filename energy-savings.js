(function () {
  var graph = window.NovaraSavingsGraph;
  var cumulativeChart = null;
  var bySiteChart = null;
  var chartStatusEl = document.getElementById("chart-status");
  var cumulativeCanvas = document.getElementById("savings-cumulative-chart");
  var bySiteCanvas = document.getElementById("savings-by-site-chart");
  var rangeButtons = document.querySelectorAll(".range-btn[data-days]");
  var tableBody = document.getElementById("savings-table-body");
  var summaryTotalEl = document.getElementById("savings-summary-total");
  var summaryPctEl = document.getElementById("savings-summary-pct");
  var summarySitesEl = document.getElementById("savings-summary-sites");
  var emptyStateEl = document.getElementById("savings-empty-state");
  var startInput = document.getElementById("savings-start-date");
  var endInput = document.getElementById("savings-end-date");
  var resetBtn = document.getElementById("savings-reset-zoom");

  if (!cumulativeCanvas || typeof Chart === "undefined" || !graph) {
    return;
  }

  function setChartStatus(message, isError) {
    if (!chartStatusEl) return;
    chartStatusEl.textContent = message || "";
    chartStatusEl.classList.toggle("is-error", Boolean(isError));
  }

  function setEmptyState(visible, message) {
    if (!emptyStateEl) return;
    emptyStateEl.hidden = !visible;
    if (message) {
      emptyStateEl.textContent = message;
    }
  }

  function formatCurrency(value) {
    var amount = Number(value);
    if (!Number.isFinite(amount)) return "—";
    return amount.toLocaleString(undefined, {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    });
  }

  function formatPct(value) {
    var amount = Number(value);
    if (!Number.isFinite(amount)) return "—";
    return amount.toFixed(1) + "%";
  }

  function currencyTooltip(item) {
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

  function todayInputDate() {
    return graph.toInputDate(new Date());
  }

  function writeDateInputs(start, end) {
    if (startInput) startInput.value = start || "";
    if (endInput) endInput.value = end || "";
  }

  function syncPresetButtons(days) {
    rangeButtons.forEach(function (btn) {
      var btnDays = Number(btn.getAttribute("data-days"));
      btn.classList.toggle("active", days != null && btnDays === days);
    });
  }

  function markPresetForRange(start, end) {
    var days = graph.daysInclusive(start, end);
    var isPreset =
      end === todayInputDate() && (days === 30 || days === 90 || days === 365);
    syncPresetButtons(isPreset ? days : null);
  }

  function renderCumulativeChart(points) {
    if (cumulativeChart) {
      graph.updateCumulativeChart(cumulativeChart, points);
      return;
    }
    cumulativeChart = graph.createCumulativeChart(cumulativeCanvas, {
      points: points,
      currencyTooltip: currencyTooltip,
    });
  }

  function renderBySiteChart(sites) {
    if (!bySiteCanvas) return;
    var labels = sites.map(function (site) {
      return site.name;
    });
    var values = sites.map(function (site) {
      var amount =
        site.windowSavings != null ? site.windowSavings : site.verifiedSavings;
      return Number(amount) || 0;
    });

    if (bySiteChart) {
      bySiteChart.data.labels = labels;
      bySiteChart.data.datasets[0].data = values;
      bySiteChart.update("none");
      return;
    }

    bySiteChart = new Chart(bySiteCanvas.getContext("2d"), {
      type: "bar",
      data: {
        labels: labels,
        datasets: [
          {
            label: "Verified savings ($)",
            data: values,
            backgroundColor: "rgba(23, 133, 173, 0.72)",
            borderColor: "#1785ad",
            borderWidth: 1,
            borderRadius: 6,
            maxBarThickness: 48,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: false,
          },
          tooltip: {
            callbacks: {
              label: currencyTooltip,
            },
          },
        },
        scales: {
          x: {
            grid: {
              display: false,
            },
          },
          y: {
            beginAtZero: true,
            title: {
              display: true,
              text: "Savings ($)",
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
        },
      },
    });
  }

  function renderTable(sites) {
    if (!tableBody) return;
    if (!sites.length) {
      tableBody.innerHTML =
        '<tr><td colspan="5">No verified savings rows for this range.</td></tr>';
      return;
    }
    tableBody.innerHTML = sites
      .map(function (site) {
        return (
          "<tr>" +
          "<td>" +
          escapeHtml(site.name || "—") +
          "</td>" +
          "<td>" +
          escapeHtml(site.systemType || "—") +
          "</td>" +
          '<td class="savings-value">' +
          formatPct(site.savingsPct) +
          "</td>" +
          '<td class="savings-value">' +
          formatCurrency(site.verifiedSavings) +
          "</td>" +
          "<td>" +
          escapeHtml(site.period || "Rolling 12 months") +
          "</td>" +
          "</tr>"
        );
      })
      .join("");
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function renderSummary(summary) {
    if (summaryTotalEl) {
      summaryTotalEl.textContent = formatCurrency(
        summary && summary.totalSavings
      );
    }
    if (summaryPctEl) {
      summaryPctEl.textContent = formatPct(summary && summary.avgSavingsPct);
    }
    if (summarySitesEl) {
      var count = summary && summary.siteCount;
      summarySitesEl.textContent =
        count == null ? "—" : String(count) + (count === 1 ? " site" : " sites");
    }
  }

  function formatRangeLabel(start, end, days) {
    var dt = window.NovaraDateTime;
    var startLabel = start;
    var endLabel = end;
    if (dt && dt.formatDate) {
      startLabel = dt.formatDate(start) || start;
      endLabel = dt.formatDate(end) || end;
    }
    if (startLabel && endLabel) {
      return startLabel + " – " + endLabel;
    }
    return "last " + days + " day" + (days === 1 ? "" : "s");
  }

  function applyPayload(data, request) {
    var points = (data && data.points) || [];
    var sites = (data && data.sites) || [];
    var summary = (data && data.summary) || {};
    var days = Number((data && data.days) || (request && request.days) || points.length) || 0;
    var start = (data && data.rangeStart) || (request && request.start) || "";
    var end = (data && data.rangeEnd) || (request && request.end) || "";

    if (start && end) {
      writeDateInputs(start, end);
      markPresetForRange(start, end);
    }

    renderSummary(summary);
    renderTable(sites);

    if (!points.length) {
      renderCumulativeChart([]);
      renderBySiteChart([]);
      setEmptyState(
        true,
        "No savings data is available for this range yet. Import readings or check back after the next verification cycle."
      );
      setChartStatus("No savings points for " + formatRangeLabel(start, end, days) + ".", false);
      return;
    }

    setEmptyState(false);
    renderCumulativeChart(points);
    renderBySiteChart(sites);
    var sourceLabel = data.source === "demo" ? "demo portfolio" : "verified";
    setChartStatus(
      points.length +
        " days · " +
        sites.length +
        " sites · " +
        sourceLabel +
        " · " +
        formatRangeLabel(start, end, days) +
        " · drag, scroll, or pinch to zoom",
      false
    );
  }

  function setControlsDisabled(disabled) {
    rangeButtons.forEach(function (btn) {
      btn.disabled = disabled;
    });
    if (startInput) startInput.disabled = disabled;
    if (endInput) endInput.disabled = disabled;
    if (resetBtn) resetBtn.disabled = disabled;
  }

  function loadSavings(request) {
    request = request || {};
    setChartStatus("Loading savings…", false);
    setEmptyState(false);
    setControlsDisabled(true);

    var api = window.NovaraApi;
    var days = request.days;
    var start = request.start;
    var end = request.end;
    var queryRequest;
    if (api) {
      queryRequest = api.getSavings(days, start && end ? { start: start, end: end } : null);
    } else if (start && end) {
      queryRequest = fetch(
        "/api/savings?start=" +
          encodeURIComponent(start) +
          "&end=" +
          encodeURIComponent(end)
      ).then(parseSavingsResponse);
    } else {
      queryRequest = fetch(
        "/api/savings?days=" + encodeURIComponent(String(days || 30))
      ).then(parseSavingsResponse);
    }

    return queryRequest
      .then(function (data) {
        applyPayload(data, request);
      })
      .catch(function (err) {
        setChartStatus(err.message || "Failed to load savings", true);
        setEmptyState(
          true,
          "Savings charts could not be loaded. Confirm the NOVARA API is reachable, then try again."
        );
        renderSummary({});
      })
      .finally(function () {
        setControlsDisabled(false);
      });
  }

  function parseSavingsResponse(response) {
    return response.json().then(function (body) {
      if (!response.ok) {
        var detail = body && (body.detail || body.error);
        throw new Error(detail || "Request failed (" + response.status + ")");
      }
      return body;
    });
  }

  function loadFromDateInputs() {
    var start = startInput && startInput.value;
    var end = endInput && endInput.value;
    if (!start || !end) {
      setChartStatus("Choose a start and end date.", true);
      return;
    }
    if (start > end) {
      setChartStatus("Start date must be on or before end date.", true);
      return;
    }
    var days = graph.daysInclusive(start, end);
    if (days < 1 || days > 365) {
      setChartStatus("Date range must be between 1 and 365 days.", true);
      return;
    }
    markPresetForRange(start, end);
    loadSavings({ start: start, end: end, days: days });
  }

  rangeButtons.forEach(function (btn) {
    btn.addEventListener("click", function () {
      var days = Number(btn.getAttribute("data-days")) || 30;
      var range = graph.defaultRange(days);
      writeDateInputs(range.start, range.end);
      syncPresetButtons(days);
      loadSavings({ days: days, start: range.start, end: range.end });
    });
  });

  if (startInput) {
    startInput.max = todayInputDate();
    startInput.addEventListener("change", loadFromDateInputs);
  }
  if (endInput) {
    endInput.max = todayInputDate();
    endInput.addEventListener("change", loadFromDateInputs);
  }
  if (resetBtn) {
    resetBtn.addEventListener("click", function () {
      graph.resetZoom(cumulativeChart);
    });
  }

  var initial = graph.defaultRange(30);
  writeDateInputs(initial.start, initial.end);
  syncPresetButtons(30);
  loadSavings({ days: 30, start: initial.start, end: initial.end });
})();
