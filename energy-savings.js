(function () {
  var SITE_ID = "SITE001";
  var chart = null;
  var chartStatusEl = document.getElementById("chart-status");
  var canvas = document.getElementById("savings-trends-chart");
  var rangeButtons = document.querySelectorAll(".range-btn");

  if (!canvas || typeof Chart === "undefined") {
    return;
  }

  var PORTFOLIO = [
    { name: "Vista Springs", annual: 42850, pct: 34.2 },
    { name: "Highlander Pointe", annual: 38920, pct: 31.8 },
    { name: "La Verne Pool", annual: 21450, pct: 28.4 },
    { name: "Solar Thermal Demo", annual: 12480, pct: 22.1 },
  ];

  function setChartStatus(message, isError) {
    if (!chartStatusEl) return;
    chartStatusEl.textContent = message || "";
    chartStatusEl.classList.toggle("is-error", Boolean(isError));
  }

  function formatDay(iso) {
    if (!iso) return "";
    var date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    return date.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }

  function formatCurrency(value) {
    var num = Number(value);
    if (!Number.isFinite(num)) return "—";
    return (
      "$" +
      num.toLocaleString(undefined, {
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      })
    );
  }

  function dayNoise(dayKey) {
    var acc = 0;
    for (var i = 0; i < dayKey.length; i++) {
      acc = (acc * 33 + dayKey.charCodeAt(i)) >>> 0;
    }
    return (acc % 10000) / 10000;
  }

  function buildDemoSavings(days) {
    var annualTotal = PORTFOLIO.reduce(function (sum, site) {
      return sum + site.annual;
    }, 0);
    var weightedPct =
      PORTFOLIO.reduce(function (sum, site) {
        return sum + site.annual * site.pct;
      }, 0) / annualTotal;
    var dailyBaseline = annualTotal / 365;
    var end = new Date();
    end.setUTCHours(0, 0, 0, 0);
    var points = [];
    var cumulative = 0;
    for (var offset = days - 1; offset >= 0; offset--) {
      var day = new Date(end.getTime() - offset * 86400000);
      var dayKey = day.toISOString().slice(0, 10);
      var noise = dayNoise(dayKey);
      var weekendScale = day.getUTCDay() === 0 || day.getUTCDay() === 6 ? 0.92 : 1;
      var shape = 0.88 + 0.24 * noise;
      var daily = Math.round(dailyBaseline * weekendScale * shape * 100) / 100;
      cumulative = Math.round((cumulative + daily) * 100) / 100;
      var pct = Math.round(weightedPct * (0.96 + 0.08 * noise) * 10) / 10;
      points.push({
        t: dayKey + "T00:00:00Z",
        daily: daily,
        cumulative: cumulative,
        pct: pct,
      });
    }
    return {
      points: points,
      lastUpdate: points.length ? points[points.length - 1].t : null,
      siteId: SITE_ID,
      days: days,
      count: points.length,
      source: "demo-local",
      readingCount: 0,
      totals: {
        verifiedSavings: cumulative,
        annualPortfolio: annualTotal,
        savingsPct: points.length ? points[points.length - 1].pct : weightedPct,
      },
    };
  }

  function renderChart(points) {
    var labels = points.map(function (p) {
      return p.t;
    });
    var cumulative = points.map(function (p) {
      return p.cumulative;
    });
    var daily = points.map(function (p) {
      return p.daily;
    });

    if (chart) {
      chart.data.labels = labels;
      chart.data.datasets[0].data = cumulative;
      chart.data.datasets[1].data = daily;
      chart.update("none");
      return;
    }

    chart = new Chart(canvas.getContext("2d"), {
      type: "line",
      data: {
        labels: labels,
        datasets: [
          {
            label: "Cumulative verified ($)",
            data: cumulative,
            yAxisID: "y",
            borderColor: "#1785ad",
            backgroundColor: "rgba(23, 133, 173, 0.12)",
            borderWidth: 2,
            pointRadius: 0,
            pointHoverRadius: 4,
            tension: 0.25,
            fill: false,
          },
          {
            label: "Daily verified ($)",
            data: daily,
            yAxisID: "y1",
            borderColor: "#2e7d32",
            backgroundColor: "rgba(46, 125, 50, 0.10)",
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
                return formatDay(items[0].label);
              },
              label: function (item) {
                var value = item.parsed.y;
                if (value == null) return item.dataset.label + ": —";
                return item.dataset.label + ": " + formatCurrency(value);
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
                return formatDay(label);
              },
            },
            grid: {
              color: "rgba(15, 45, 58, 0.06)",
            },
          },
          y: {
            position: "left",
            title: {
              display: true,
              text: "Cumulative ($)",
            },
            grid: {
              color: "rgba(15, 45, 58, 0.08)",
            },
            ticks: {
              callback: function (value) {
                return formatCurrency(value);
              },
            },
          },
          y1: {
            position: "right",
            title: {
              display: true,
              text: "Daily ($)",
            },
            grid: {
              drawOnChartArea: false,
            },
            ticks: {
              callback: function (value) {
                return formatCurrency(value);
              },
            },
          },
        },
      },
    });
  }

  function describeSource(data, days) {
    var points = (data && data.points) || [];
    var totals = (data && data.totals) || {};
    var source = (data && data.source) || "demo";
    var readingCount = Number((data && data.readingCount) || 0);
    var parts = [
      points.length + " days",
      "last " + days + " day" + (days === 1 ? "" : "s"),
      formatCurrency(totals.verifiedSavings) + " verified in range",
    ];
    if (source.indexOf("readings") !== -1 && readingCount > 0) {
      parts.push(readingCount + " NOVARAReadings used for calibration");
    } else if (source === "demo-local") {
      parts.push("demo series (API unavailable)");
    } else {
      parts.push("portfolio demo series");
    }
    return parts.join(" · ");
  }

  function loadSavings(days) {
    setChartStatus("Loading savings…", false);
    rangeButtons.forEach(function (btn) {
      btn.disabled = true;
    });

    var api = window.NovaraApi;
    var request = api
      ? api.getSavings(days, SITE_ID)
      : fetch(
          "/api/savings?days=" +
            encodeURIComponent(String(days)) +
            "&siteId=" +
            encodeURIComponent(SITE_ID)
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
        if (!points.length) {
          data = buildDemoSavings(days);
          points = data.points;
        }
        renderChart(points);
        setChartStatus(describeSource(data, days), false);
      })
      .catch(function () {
        var data = buildDemoSavings(days);
        renderChart(data.points);
        setChartStatus(describeSource(data, days), false);
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
