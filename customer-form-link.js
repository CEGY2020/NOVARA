(function () {
  var toolbar = document.querySelector('.lead-toolbar-actions');
  var target = toolbar || document.querySelector('.main-content .card');
  if (!target) return;
  var link = document.createElement('a');
  link.href = 'customer-form-upload.html';
  link.className = 'secondary-btn';
  link.textContent = 'Upload Customer Forms';
  link.style.display = 'inline-flex';
  link.style.alignItems = 'center';
  link.style.maxWidth = '100%';
  link.style.whiteSpace = 'normal';
  link.style.textDecoration = 'none';
  if (toolbar) {
    target.appendChild(link);
  } else {
    var actions = document.createElement('div');
    actions.style.display = 'flex';
    actions.style.flexWrap = 'wrap';
    actions.style.margin = '12px 0';
    actions.appendChild(link);
    target.appendChild(actions);
  }
})();
