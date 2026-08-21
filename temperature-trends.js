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

  function stripReadingSortKey(value) {
    var dt = datetime();
    if (dt && dt.stripReadingSortKey) {
      return dt.stripReadingSortKey(value);
    }
    return String(value == null ? "" : value).replace(/#(SYS\d+)\s*$/i, "");
  }

  /**
   * Axis ticks + tooltip titles: MM-DD-YY HH:MM with no #SYS001.
   *
   * Chart.js category labels are these strings. Do not pass raw DynamoDB
   * keys like ``2026-08-07T21:30:00Z#SYS001`` into data.labels — ``new Date``
   * cannot parse the suffix, so ticks fall back to the raw key.
   */
  function formatChartTick(value) {
    var dt = datetime();
    if (dt && dt.formatAxisTick) {
      return dt.formatAxisTick(value) || stripReadingSortKey(value);
    }
    var iso = stripReadingSortKey(value);
    if (/^\d{2}-\d{2}-\d{2} \d{2}:\d{2}$/.test(iso)) return iso;
    var match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(iso);
    if (match) {
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
    return iso;
  }

  function formatLastUpdate(iso) {
    if (!iso) return "No readings in range";
    return formatChartTick(iso);
  }

  function relativeFromNow(iso) {
    if (!iso) return "—";
    var date = new Date(stripReadingSortKey(iso));
    if (Number.isNaN(date.getTime())) return stripReadingSortKey(iso);
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
      return formatChartTick(p.t);
    });
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
                return formatChartTick(items[0].label);
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
