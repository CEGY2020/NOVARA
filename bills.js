(function () {
  var statusEl = document.getElementById("bills-status");
  var tbody = document.getElementById("bills-tbody");
  var emptyStateEl = document.getElementById("bills-empty-state");
  var tableEl = document.getElementById("bills-table");

  if (!tbody) {
    return;
  }

  var EMPTY_MESSAGE =
    "No utility bills have been synced yet. Configure UtilityAPI in Settings, then records will appear here after sync is enabled.";

  function setStatus(message, isError) {
    if (!statusEl) return;
    statusEl.textContent = message || "";
    statusEl.classList.toggle("is-error", Boolean(isError));
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatPeriod(bill) {
    var start = String((bill && bill.periodStart) || "").trim();
    var end = String((bill && bill.periodEnd) || "").trim();
    if (start && end) {
      return start + " – " + end;
    }
    return start || end || "—";
  }

  function formatUsage(bill) {
    if (!bill || bill.usageAmount == null || bill.usageAmount === "") {
      return "—";
    }
    var amount = bill.usageAmount;
    var unit = String(bill.usageUnit || "").trim();
    return unit ? amount + " " + unit : String(amount);
  }

  function formatCost(bill) {
    if (!bill || bill.cost == null || bill.cost === "") {
      return "—";
    }
    var currency = String((bill && bill.currency) || "USD").trim() || "USD";
    var amount = Number(bill.cost);
    if (!Number.isNaN(amount)) {
      try {
        return new Intl.NumberFormat("en-US", {
          style: "currency",
          currency: currency,
        }).format(amount);
      } catch (e) {
        return String(bill.cost) + " " + currency;
      }
    }
    return String(bill.cost);
  }

  function formatWhen(value) {
    if (!value) return "—";
    return String(value)
      .replace("T", " ")
      .replace("Z", " UTC")
      .slice(0, 19);
  }

  function renderEmpty() {
    tbody.innerHTML =
      '<tr><td colspan="7">' + escapeHtml(EMPTY_MESSAGE) + "</td></tr>";
    if (emptyStateEl) {
      emptyStateEl.hidden = false;
    }
    if (tableEl) {
      tableEl.hidden = true;
    }
  }

  function renderBills(bills) {
    var rows = Array.isArray(bills) ? bills : [];
    if (!rows.length) {
      renderEmpty();
      return;
    }
    if (emptyStateEl) {
      emptyStateEl.hidden = true;
    }
    if (tableEl) {
      tableEl.hidden = false;
    }
    tbody.innerHTML = rows
      .map(function (bill) {
        return (
          "<tr>" +
          "<td>" +
          escapeHtml(bill.recordId || "—") +
          "</td>" +
          "<td>" +
          escapeHtml(bill.siteId || "—") +
          "</td>" +
          "<td>" +
          escapeHtml(bill.utilityAccountId || "—") +
          "</td>" +
          "<td>" +
          escapeHtml(formatPeriod(bill)) +
          "</td>" +
          "<td>" +
          escapeHtml(formatUsage(bill)) +
          "</td>" +
          "<td>" +
          escapeHtml(formatCost(bill)) +
          "</td>" +
          "<td>" +
          escapeHtml(formatWhen(bill.lastSyncedAt)) +
          "</td>" +
          "</tr>"
        );
      })
      .join("");
  }

  function loadBills() {
    var api = window.NovaraApi;
    if (!api || typeof api.getUtilityBills !== "function") {
      setStatus("API client is not available.", true);
      renderEmpty();
      return;
    }
    setStatus("Loading utility data…");
    api
      .getUtilityBills()
      .then(function (payload) {
        var bills = (payload && payload.bills) || [];
        renderBills(bills);
        if (!bills.length) {
          setStatus("No utility bills yet.");
        } else {
          setStatus(bills.length === 1 ? "1 record" : bills.length + " records");
        }
      })
      .catch(function (err) {
        renderEmpty();
        setStatus(
          (err && err.message) || "Failed to load utility bills.",
          true
        );
      });
  }

  loadBills();
})();
