(function () {
  function queryParam(name, fallback) {
    try {
      var params = new URLSearchParams(window.location.search || "");
      var fromQuery = (params.get(name) || "").trim();
      if (fromQuery) return fromQuery;
    } catch (err) {
      /* ignore */
    }
    return fallback || "";
  }

  var SITE_ID = queryParam("siteId", "SITE001");
  var SYSTEM_ID = queryParam("systemId", "");
  var chart = null;
  var statusEl = document.getElementById("system-last-update");
  var chartStatusEl = document.getElementById("chart-status");
  var canvas = document.getElementById("temperature-trends-chart");
  var rangeButtons = document.querySelectorAll(".range-btn");

  if (!canvas || typeof Chart === "undefined") {
    return;
  }

  function setChartStatus(message, isError) {
    if (!chartStatusEl) return;
    chartStatusEl.textContent = message || "";
    chartStatusEl.classList.toggle("is-error", Boolean(isError));
  }

  function datetime() {
    return window.NovaraDateTime || null;
  }

  function readingTimestamp(value) {
    var dt = datetime();
    if (dt && dt.stripReadingSortKey) {
      return dt.stripReadingSortKey(value);
    }
    return String(value == null ? "" : value).replace(/#(SYS\d+)$/i, "");
  }

  function formatLastUpdate(iso) {
    if (!iso) return "No readings in range";
    var dt = datetime();
    if (dt && dt.formatDateTime) {
      return dt.formatDateTime(iso) || readingTimestamp(iso);
    }
    return readingTimestamp(iso);
  }

  var axisTickMode = "datetime24";

  function formatChartTick(iso) {
    var dt = datetime();
    if (dt && dt.formatAxisTick) {
      return dt.formatAxisTick(iso, axisTickMode);
    }
    if (dt && dt.formatDateTime) {
      if (axisTickMode === "date" && dt.formatDate) {
        return dt.formatDate(iso) || readingTimestamp(iso);
      }
      return dt.formatDateTime(iso, { use24Hour: true }) || readingTimestamp(iso);
    }
    return readingTimestamp(iso);
  }

  function relativeFromNow(iso) {
    if (!iso) return "—";
    var date = new Date(readingTimestamp(iso));
    if (Number.isNaN(date.getTime())) return readingTimestamp(iso);
    var diffMs = Date.now() - date.getTime();
    if (diffMs < 0) return "just now";
    var minutes = Math.floor(diffMs / 60000);
    if (minutes < 1) return "just now";
    if (minutes < 60) return minutes + (minutes === 1 ? " minute ago" : " minutes ago");
    var hours = Math.floor(minutes / 60);
    if (hours < 48) return hours + (hours === 1 ? " hour ago" : " hours ago");
    var days = Math.floor(hours / 24);
    return days + (days === 1 ? " day ago" : " days ago");
  }

  function renderChart(points) {
    var labels = points.map(function (p) {
      return readingTimestamp(p.t);
    });
    var dt = datetime();
    if (dt && dt.chartTickMode && labels.length) {
      axisTickMode = dt.chartTickMode(labels[0], labels[labels.length - 1]);
    } else {
      axisTickMode = "datetime24";
    }
    var supply = points.map(function (p) {
      return p.t1;
    });
    var ret = points.map(function (p) {
      return p.t2;
    });

    if (chart) {
      chart.data.labels = labels;
      chart.data.datasets[0].data = supply;
      chart.data.datasets[1].data = ret;
      chart.update("none");
      return;
    }

    chart = new Chart(canvas.getContext("2d"), {
      type: "line",
      data: {
        labels: labels,
        datasets: [
          {
            label: "Supply (T1) °F",
            data: supply,
            borderColor: "#1785ad",
            backgroundColor: "rgba(23, 133, 173, 0.12)",
            borderWidth: 2,
            pointRadius: 0,
            pointHoverRadius: 4,
            tension: 0.25,
            fill: false,
          },
          {
            label: "Return (T2) °F",
            data: ret,
            borderColor: "#d97706",
            backgroundColor: "rgba(217, 119, 6, 0.10)",
            borderWidth: 2,
            pointRadius: 0,
            pointHoverRadius: 4,
            tension: 0.25,
            fill: false,
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
                return formatLastUpdate(items[0].label);
              },
              label: function (item) {
                var value = item.parsed.y;
                if (value == null) return item.dataset.label + ": —";
                return item.dataset.label + ": " + Number(value).toFixed(1) + " °F";
              },
            },
          },
        },
        scales: {
          x: {
            ticks: {
              maxTicksLimit: 8,
              maxRotation: 45,
              minRotation: 0,
              callback: function (value) {
                var label = this.getLabelForValue(value);
                return formatChartTick(label);
              },
            },
            grid: {
              color: "rgba(15, 45, 58, 0.06)",
            },
          },
          y: {
            title: {
              display: true,
              text: "Temperature (°F)",
            },
            grid: {
              color: "rgba(15, 45, 58, 0.08)",
            },
          },
        },
      },
    });
  }

  function loadReadings(days) {
    setChartStatus("Loading readings…", false);
    rangeButtons.forEach(function (btn) {
      btn.disabled = true;
    });

    var api = window.NovaraApi;
    var request = api
      ? api.getReadings(SITE_ID, days, SYSTEM_ID || undefined)
      : fetch(
          "/api/readings?siteId=" +
            encodeURIComponent(SITE_ID) +
            "&days=" +
            encodeURIComponent(String(days)) +
            (SYSTEM_ID
              ? "&systemId=" + encodeURIComponent(SYSTEM_ID)
              : "")
        ).then(function (response) {
          return response.json().then(function (body) {
            if (!response.ok) {
              var detail = body && (body.detail || body.error);
              throw new Error(detail || "Request failed (" + response.status + ")");
            }
            return body;
          });
        });

    return request
      .then(function (data) {
        var points = (data && data.points) || [];
        if (statusEl) {
          statusEl.textContent = relativeFromNow(data.lastUpdate);
          statusEl.title = data.lastUpdate ? formatLastUpdate(data.lastUpdate) : "";
        }
        renderChart(points);
        var scopeLabel =
          "SiteID " + SITE_ID + (SYSTEM_ID ? " · SystemID " + SYSTEM_ID : "");
        if (!points.length) {
          setChartStatus(
            "No readings found for " + scopeLabel + " in this range.",
            false
          );
        } else {
          setChartStatus(
            points.length +
              " points · " +
              scopeLabel +
              " · last " +
              days +
              " day" +
              (days === 1 ? "" : "s"),
            false
          );
        }
      })
      .catch(function (err) {
        setChartStatus(err.message || "Failed to load readings", true);
        if (statusEl) {
          statusEl.textContent = "unavailable";
          statusEl.title = "";
        }
      })
      .finally(function () {
        rangeButtons.forEach(function (btn) {
          btn.disabled = false;
        });
      });
  }

  function activeDays() {
    var active = document.querySelector(".range-btn.active");
    return active ? Number(active.getAttribute("data-days")) || 7 : 7;
  }

  rangeButtons.forEach(function (btn) {
    btn.addEventListener("click", function () {
      rangeButtons.forEach(function (b) {
        b.classList.remove("active");
      });
      btn.classList.add("active");
      loadReadings(Number(btn.getAttribute("data-days")) || 7);
    });
  });

  loadReadings(activeDays());
})();
