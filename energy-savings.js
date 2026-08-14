(function () {
  var cumulativeChart = null;
  var bySiteChart = null;
  var chartStatusEl = document.getElementById("chart-status");
  var cumulativeCanvas = document.getElementById("savings-cumulative-chart");
  var bySiteCanvas = document.getElementById("savings-by-site-chart");
  var rangeButtons = document.querySelectorAll(".range-btn");
  var tableBody = document.getElementById("savings-table-body");
  var summaryTotalEl = document.getElementById("savings-summary-total");
  var summaryPctEl = document.getElementById("savings-summary-pct");
  var summarySitesEl = document.getElementById("savings-summary-sites");
  var emptyStateEl = document.getElementById("savings-empty-state");

  if (!cumulativeCanvas || typeof Chart === "undefined") {
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

  function datetime() {
    return window.NovaraDateTime || null;
  }

  function formatDayLabel(iso) {
    var dt = datetime();
    if (dt && dt.formatDate) {
      return dt.formatDate(iso) || iso;
    }
    return iso;
  }

  function formatFullDate(iso) {
    if (!iso) return "";
    var dt = datetime();
    if (dt && dt.formatDate) {
      return dt.formatDate(iso) || iso;
    }
    return iso;
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

  function renderCumulativeChart(points) {
    var labels = points.map(function (p) {
      return p.t;
    });
    var cumulative = points.map(function (p) {
      return Number(p.cumulative) || 0;
    });
    var daily = points.map(function (p) {
      return Number(p.daily) || 0;
    });

    if (cumulativeChart) {
      cumulativeChart.data.labels = labels;
      cumulativeChart.data.datasets[0].data = cumulative;
      cumulativeChart.data.datasets[1].data = daily;
      cumulativeChart.update("none");
      return;
    }

    cumulativeChart = new Chart(cumulativeCanvas.getContext("2d"), {
      type: "line",
      data: {
        labels: labels,
        datasets: [
          {
            label: "Cumulative savings ($)",
            data: cumulative,
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
            data: daily,
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
                return formatFullDate(items[0].label);
              },
              label: currencyTooltip,
            },
          },
        },
        scales: {
          x: {
            ticks: {
              maxTicksLimit: 8,
              callback: function (value) {
                var label = this.getLabelForValue(value);
                return formatDayLabel(label);
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

  function applyPayload(data, days) {
    var points = (data && data.points) || [];
    var sites = (data && data.sites) || [];
    var summary = (data && data.summary) || {};

    renderSummary(summary);
    renderTable(sites);

    if (!points.length) {
      renderCumulativeChart([]);
      renderBySiteChart([]);
      setEmptyState(
        true,
        "No savings data is available for this range yet. Import readings or check back after the next verification cycle."
      );
      setChartStatus("No savings points for the last " + days + " days.", false);
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
        " · last " +
        days +
        " day" +
        (days === 1 ? "" : "s"),
      false
    );
  }

  function loadSavings(days) {
    setChartStatus("Loading savings…", false);
    setEmptyState(false);
    rangeButtons.forEach(function (btn) {
      btn.disabled = true;
    });

    var api = window.NovaraApi;
    var request = api
      ? api.getSavings(days)
      : fetch("/api/savings?days=" + encodeURIComponent(String(days))).then(
          function (response) {
            return response.json().then(function (body) {
              if (!response.ok) {
                var detail = body && (body.detail || body.error);
                throw new Error(
                  detail || "Request failed (" + response.status + ")"
                );
              }
              return body;
            });
          }
        );

    return request
      .then(function (data) {
        applyPayload(data, days);
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
        rangeButtons.forEach(function (btn) {
          btn.disabled = false;
        });
      });
  }

  function activeDays() {
    var active = document.querySelector(".range-btn.active");
    return active ? Number(active.getAttribute("data-days")) || 30 : 30;
  }

  rangeButtons.forEach(function (btn) {
    btn.addEventListener("click", function () {
      rangeButtons.forEach(function (b) {
        b.classList.remove("active");
      });
      btn.classList.add("active");
      loadSavings(Number(btn.getAttribute("data-days")) || 30);
    });
  });

  loadSavings(activeDays());
})();
