(function () {
  var titleEl = document.getElementById("decisionTitle");
  var metaEl = document.getElementById("decisionMeta");
  var messageEl = document.getElementById("decisionMessage");
  var actionsEl = document.getElementById("decisionActions");
  var reasonField = document.getElementById("reasonField");
  var reasonInput = document.getElementById("rejectReason");
  var sendEmailInput = document.getElementById("sendRejectionEmail");
  var approveBtn = document.getElementById("approveBtn");
  var rejectBtn = document.getElementById("rejectBtn");
  var confirmRejectBtn = document.getElementById("confirmRejectBtn");
  var usersAdminLink = document.getElementById("usersAdminLink");

  var params;
  try {
    params = new URLSearchParams(window.location.search);
  } catch (e) {
    params = {
      get: function () {
        return null;
      },
    };
  }

  var userId = String(params.get("userId") || params.get("id") || "").trim();
  var token = String(params.get("token") || "").trim();
  var decision = String(params.get("decision") || "").trim().toLowerCase();

  function setMessage(text, isError) {
    if (!messageEl) return;
    messageEl.textContent = text || "";
    messageEl.classList.toggle("is-error", Boolean(isError));
    messageEl.classList.toggle("is-success", Boolean(text) && !isError);
  }

  function setBusy(busy) {
    [approveBtn, rejectBtn, confirmRejectBtn].forEach(function (btn) {
      if (btn) btn.disabled = Boolean(busy);
    });
  }

  if (usersAdminLink && userId) {
    usersAdminLink.href = "users.html?focus=" + encodeURIComponent(userId);
  }

  if (!userId || !token) {
    if (titleEl) titleEl.textContent = "Invalid decision link";
    if (metaEl) {
      metaEl.textContent =
        "This approval link is missing a user id or token. Open Users admin instead.";
    }
    return;
  }

  if (metaEl) {
    metaEl.innerHTML =
      "<strong>User ID:</strong> " +
      userId.replace(/</g, "&lt;") +
      "<br>Use the buttons below to approve or reject this pending account.";
  }

  if (actionsEl) actionsEl.hidden = false;

  if (decision === "reject") {
    if (reasonField) reasonField.classList.add("is-visible");
    if (approveBtn) approveBtn.hidden = true;
    if (rejectBtn) rejectBtn.hidden = true;
    if (confirmRejectBtn) confirmRejectBtn.hidden = false;
    if (titleEl) titleEl.textContent = "Reject NOVARA account";
  } else if (decision === "approve") {
    if (titleEl) titleEl.textContent = "Approve NOVARA account";
  }

  function approve() {
    if (!window.NovaraApi) {
      setMessage("API client is unavailable.", true);
      return;
    }
    setBusy(true);
    setMessage("Approving account…");
    NovaraApi.updateUserStatus(userId, "Active", { decisionToken: token })
      .then(function () {
        setMessage("Account approved. A welcome email was sent to the user.", false);
        if (actionsEl) actionsEl.hidden = true;
        if (reasonField) reasonField.classList.remove("is-visible");
      })
      .catch(function (err) {
        setMessage((err && err.message) || "Failed to approve account.", true);
      })
      .finally(function () {
        setBusy(false);
      });
  }

  function reject() {
    if (!window.NovaraApi) {
      setMessage("API client is unavailable.", true);
      return;
    }
    var reason = reasonInput ? String(reasonInput.value || "").trim() : "";
    if (!reason) {
      setMessage("A rejection reason is required.", true);
      if (reasonField) reasonField.classList.add("is-visible");
      if (confirmRejectBtn) confirmRejectBtn.hidden = false;
      if (rejectBtn) rejectBtn.hidden = true;
      if (approveBtn) approveBtn.hidden = true;
      return;
    }
    setBusy(true);
    setMessage("Rejecting account…");
    NovaraApi.updateUserStatus(userId, "Rejected", {
      decisionToken: token,
      rejectionReason: reason,
      sendRejectionEmail: !!(sendEmailInput && sendEmailInput.checked),
    })
      .then(function () {
        setMessage("Account rejected. The reason has been saved.", false);
        if (actionsEl) actionsEl.hidden = true;
        if (reasonField) reasonField.classList.remove("is-visible");
      })
      .catch(function (err) {
        setMessage((err && err.message) || "Failed to reject account.", true);
      })
      .finally(function () {
        setBusy(false);
      });
  }

  if (approveBtn) {
    approveBtn.addEventListener("click", approve);
  }
  if (rejectBtn) {
    rejectBtn.addEventListener("click", function () {
      if (reasonField) reasonField.classList.add("is-visible");
      if (confirmRejectBtn) confirmRejectBtn.hidden = false;
      rejectBtn.hidden = true;
      if (approveBtn) approveBtn.hidden = true;
      if (titleEl) titleEl.textContent = "Reject NOVARA account";
      if (reasonInput) reasonInput.focus();
    });
  }
  if (confirmRejectBtn) {
    confirmRejectBtn.addEventListener("click", reject);
  }

  // Deep-link convenience: ?decision=approve can one-click after confirm.
  if (decision === "approve" && params.get("auto") === "1") {
    approve();
  }
})();
