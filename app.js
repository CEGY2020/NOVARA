document.querySelector("form").addEventListener("submit", function (e) {
    e.preventDefault();

    // TODO: Replace this with AWS Cognito authentication.
    // For now, continue to the dashboard.
    window.location.href = "dashboard.html";
});
