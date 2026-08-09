(function () {
  var SITE_ID = "SITE001";
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

  function formatLastUpdate(iso) {
    if (!iso) return "No readings in range";
    var date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    return date.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }

  function relativeFromNow(iso) {
    if (!iso) return "—";
    var date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
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
      return p.t;
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
              callback: function (value) {
                var label = this.getLabelForValue(value);
                var date = new Date(label);
                if (Number.isNaN(date.getTime())) return label;
                return date.toLocaleString(undefined, {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                });
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
      ? api.getReadings(SITE_ID, days)
      : fetch(
          "/api/readings?siteId=" +
            encodeURIComponent(SITE_ID) +
            "&days=" +
            encodeURIComponent(String(days))
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
        if (!points.length) {
          setChartStatus("No readings found for SiteID " + SITE_ID + " in this range.", false);
        } else {
          setChartStatus(
            points.length +
              " points · SiteID " +
              SITE_ID +
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
