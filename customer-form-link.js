(function () {
  var target = document.querySelector('.lead-toolbar-actions') || document.querySelector('.main-content .card');
  if (!target) return;
  var link = document.createElement('a');
  link.href = 'customer-form-upload.html';
  link.className = 'secondary-btn';
  link.textContent = 'Upload Customer Forms';
  target.appendChild(link);
})();
