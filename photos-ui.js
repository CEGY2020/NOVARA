/**
 * Shared photo gallery + upload UI for Sites and Systems modals.
 * Expects markup with ids prefixed by options.idPrefix (default "photo").
 */
(function (global) {
  var PHOTO_TYPES = ["Property", "System", "Equipment", "Nameplate", "Other"];

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function currentUploader() {
    try {
      if (global.NovaraAuth && typeof NovaraAuth.getCurrentUser === "function") {
        var user = NovaraAuth.getCurrentUser();
        if (user) {
          return user.userId || user.email || user.fullName || "";
        }
      }
    } catch (e) {
      // ignore
    }
    return "";
  }

  function resolveViewUrl(url) {
    var value = String(url || "");
    if (!value) return "";
    if (/^https?:\/\//i.test(value) || value.indexOf("data:") === 0) {
      return value;
    }
    if (global.NovaraApi && typeof NovaraApi.url === "function") {
      return NovaraApi.url(value);
    }
    return value;
  }

  function createController(options) {
    options = options || {};
    var prefix = options.idPrefix || "photo";
    var section = document.getElementById(prefix + "-section");
    var gallery = document.getElementById(prefix + "-gallery");
    var emptyEl = document.getElementById(prefix + "-empty");
    var statusEl = document.getElementById(prefix + "-status");
    var typeSelect = document.getElementById(prefix + "-type");
    var captionInput = document.getElementById(prefix + "-caption");
    var fileInput = document.getElementById(prefix + "-files");
    var uploadBtn = document.getElementById(prefix + "-upload-btn");
    var lightbox = document.getElementById(prefix + "-lightbox");
    var lightboxImg = document.getElementById(prefix + "-lightbox-img");
    var lightboxMeta = document.getElementById(prefix + "-lightbox-meta");
    var lightboxClose = document.getElementById(prefix + "-lightbox-close");

    var context = {
      enabled: false,
      siteId: "",
      systemId: "",
      photos: [],
    };

    function setStatus(message, isError) {
      if (!statusEl) return;
      statusEl.textContent = message || "";
      statusEl.classList.toggle("is-error", Boolean(isError));
      statusEl.hidden = !message;
    }

    function setEnabled(enabled) {
      context.enabled = Boolean(enabled);
      if (section) {
        section.classList.toggle("is-disabled", !context.enabled);
      }
      if (typeSelect) typeSelect.disabled = !context.enabled;
      if (captionInput) captionInput.disabled = !context.enabled;
      if (fileInput) fileInput.disabled = !context.enabled;
      if (uploadBtn) uploadBtn.disabled = !context.enabled;
    }

    function resetUploadForm() {
      if (typeSelect) {
        typeSelect.value = options.defaultPhotoType || "Property";
      }
      if (captionInput) {
        captionInput.value = "";
      }
      if (fileInput) {
        fileInput.value = "";
      }
    }

    function closeLightbox() {
      if (!lightbox) return;
      lightbox.hidden = true;
      if (lightboxImg) {
        lightboxImg.removeAttribute("src");
        lightboxImg.alt = "";
      }
      if (lightboxMeta) {
        lightboxMeta.textContent = "";
      }
    }

    function openLightbox(photo) {
      if (!lightbox || !photo) return;
      var url = resolveViewUrl(photo.url);
      if (lightboxImg) {
        lightboxImg.src = url;
        lightboxImg.alt = photo.caption || photo.photoType || "Photo";
      }
      if (lightboxMeta) {
        var parts = [];
        if (photo.photoType) parts.push(photo.photoType);
        if (photo.caption) parts.push(photo.caption);
        lightboxMeta.textContent = parts.join(" — ");
      }
      lightbox.hidden = false;
    }

    function renderGallery(photos) {
      context.photos = photos || [];
      if (!gallery) return;

      if (!context.photos.length) {
        gallery.innerHTML = "";
        if (emptyEl) {
          emptyEl.hidden = false;
          emptyEl.textContent = context.enabled
            ? "No photos yet. Upload one or more images below."
            : "Save this record first to attach photos.";
        }
        return;
      }

      if (emptyEl) emptyEl.hidden = true;
      gallery.innerHTML = context.photos
        .map(function (photo) {
          var url = resolveViewUrl(photo.url);
          var caption = photo.caption || "";
          var typeLabel = photo.photoType || "Other";
          return (
            '<article class="photo-card" data-photo-id="' +
            escapeHtml(photo.photoId) +
            '">' +
            '<button type="button" class="photo-thumb-btn" data-action="view" aria-label="View photo">' +
            '<img class="photo-thumb" src="' +
            escapeHtml(url) +
            '" alt="' +
            escapeHtml(caption || typeLabel) +
            '" loading="lazy">' +
            "</button>" +
            '<div class="photo-meta">' +
            '<span class="photo-type">' +
            escapeHtml(typeLabel) +
            "</span>" +
            (caption
              ? '<span class="photo-caption">' + escapeHtml(caption) + "</span>"
              : "") +
            "</div>" +
            '<button type="button" class="link-btn danger-link-btn photo-delete-btn" data-action="delete">Delete</button>' +
            "</article>"
          );
        })
        .join("");
    }

    function loadPhotos() {
      if (!context.enabled || !context.siteId) {
        renderGallery([]);
        setStatus("", false);
        return Promise.resolve([]);
      }
      var api = global.NovaraApi;
      if (!api || !api.getPhotos) {
        setStatus("Photo API is unavailable.", true);
        return Promise.resolve([]);
      }
      setStatus("Loading photos…", false);
      var filters = { siteId: context.siteId };
      if (context.systemId) {
        filters.systemId = context.systemId;
      }
      return api
        .getPhotos(filters)
        .then(function (data) {
          var photos = (data && data.photos) || [];
          renderGallery(photos);
          setStatus(
            photos.length
              ? photos.length + " photo" + (photos.length === 1 ? "" : "s")
              : "",
            false
          );
          return photos;
        })
        .catch(function (err) {
          renderGallery([]);
          setStatus(err.message || "Failed to load photos", true);
          return [];
        });
    }

    function bindContext(next) {
      next = next || {};
      context.siteId = String(next.siteId || "").trim();
      context.systemId = String(next.systemId || "").trim();
      setEnabled(Boolean(next.enabled && context.siteId));
      resetUploadForm();
      closeLightbox();
      if (section) {
        section.hidden = false;
      }
      if (!context.enabled) {
        renderGallery([]);
        setStatus(
          context.siteId
            ? ""
            : "Save this record first to attach photos.",
          false
        );
        return Promise.resolve([]);
      }
      return loadPhotos();
    }

    function clear() {
      context.siteId = "";
      context.systemId = "";
      setEnabled(false);
      resetUploadForm();
      closeLightbox();
      renderGallery([]);
      setStatus("", false);
    }

    function uploadSelectedFiles() {
      if (!context.enabled || !context.siteId) {
        setStatus("Save this record first to attach photos.", true);
        return;
      }
      var api = global.NovaraApi;
      if (!api || !(api.uploadPhoto || (api.createPhoto && api.uploadPhotoFile))) {
        setStatus("Photo API is unavailable.", true);
        return;
      }
      var files = fileInput && fileInput.files ? Array.prototype.slice.call(fileInput.files) : [];
      if (!files.length) {
        setStatus("Choose one or more image files to upload.", true);
        return;
      }

      var photoType = (typeSelect && typeSelect.value) || "Other";
      if (PHOTO_TYPES.indexOf(photoType) === -1) {
        photoType = "Other";
      }
      var caption = captionInput ? String(captionInput.value || "").trim() : "";
      var uploadedBy = currentUploader();

      if (uploadBtn) {
        uploadBtn.disabled = true;
        uploadBtn.textContent = "Uploading…";
      }
      setStatus("Uploading " + files.length + " photo" + (files.length === 1 ? "" : "s") + "…", false);

      function uploadOne(file) {
        var payload = {
          SiteID: context.siteId,
          PhotoType: photoType,
          Caption: caption,
          ContentType: file.type || "image/jpeg",
          FileName: file.name || "photo.jpg",
          UploadedBy: uploadedBy,
        };
        if (context.systemId) {
          payload.SystemID = context.systemId;
        }
        // Prefer single-request multipart upload.
        if (typeof api.uploadPhoto === "function") {
          return api.uploadPhoto(payload, file);
        }
        // Legacy fallback: JSON metadata + PUT bytes to uploadUrl.
        return api.createPhoto(payload).then(function (result) {
          var uploadUrl = result && result.uploadUrl;
          var headers = (result && result.uploadHeaders) || {
            "Content-Type": file.type || "image/jpeg",
          };
          if (!uploadUrl) {
            throw new Error("Upload URL was not returned by the API");
          }
          return api.uploadPhotoFile(uploadUrl, file, headers);
        });
      }

      var chain = Promise.resolve();
      var uploaded = 0;
      files.forEach(function (file) {
        chain = chain.then(function () {
          return uploadOne(file).then(function () {
            uploaded += 1;
          });
        });
      });

      return chain
        .then(function () {
          resetUploadForm();
          return loadPhotos();
        })
        .then(function () {
          setStatus(
            "Uploaded " + uploaded + " photo" + (uploaded === 1 ? "" : "s") + ".",
            false
          );
        })
        .catch(function (err) {
          setStatus(err.message || "Failed to upload photos", true);
          return loadPhotos();
        })
        .finally(function () {
          if (uploadBtn) {
            uploadBtn.disabled = !context.enabled;
            uploadBtn.textContent = "Upload photos";
          }
        });
    }

    function deletePhoto(photoId) {
      var api = global.NovaraApi;
      if (!api || !api.deletePhoto) {
        setStatus("Photo API is unavailable.", true);
        return;
      }
      var confirmed = global.confirm("Delete this photo? This cannot be undone.");
      if (!confirmed) return;
      setStatus("Deleting photo…", false);
      return api
        .deletePhoto(photoId)
        .then(function () {
          return loadPhotos();
        })
        .then(function () {
          setStatus("Photo deleted.", false);
        })
        .catch(function (err) {
          setStatus(err.message || "Failed to delete photo", true);
        });
    }

    if (uploadBtn) {
      uploadBtn.addEventListener("click", function (event) {
        event.preventDefault();
        uploadSelectedFiles();
      });
    }

    if (gallery) {
      gallery.addEventListener("click", function (event) {
        var card = event.target.closest(".photo-card");
        if (!card) return;
        var photoId = card.getAttribute("data-photo-id");
        var actionBtn = event.target.closest("[data-action]");
        var action = actionBtn ? actionBtn.getAttribute("data-action") : "view";
        var photo = context.photos.find(function (row) {
          return row.photoId === photoId;
        });
        if (action === "delete") {
          event.preventDefault();
          deletePhoto(photoId);
          return;
        }
        if (photo) {
          openLightbox(photo);
        }
      });
    }

    if (lightbox) {
      lightbox.addEventListener("click", function (event) {
        if (event.target === lightbox) {
          closeLightbox();
        }
      });
    }
    if (lightboxClose) {
      lightboxClose.addEventListener("click", function () {
        closeLightbox();
      });
    }

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && lightbox && !lightbox.hidden) {
        closeLightbox();
      }
    });

    return {
      PHOTO_TYPES: PHOTO_TYPES,
      bind: bindContext,
      clear: clear,
      reload: loadPhotos,
      closeLightbox: closeLightbox,
    };
  }

  global.NovaraPhotosUI = {
    PHOTO_TYPES: PHOTO_TYPES,
    create: createController,
  };
})(window);
