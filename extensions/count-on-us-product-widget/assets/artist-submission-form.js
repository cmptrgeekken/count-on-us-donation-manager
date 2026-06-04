(function () {
  const forms = document.querySelectorAll("[data-count-on-us-artist-form]");

  forms.forEach((root) => {
    const form = root.querySelector("form");
    const status = root.querySelector("[data-count-on-us-artist-form-status]");
    const body = root.querySelector("[data-count-on-us-artist-form-body]");
    const linkFields = Array.from(root.querySelectorAll("[data-count-on-us-link-field]"));
    const contactMethod = root.querySelector("[data-count-on-us-contact-method]");
    const contactDetailField = root.querySelector("[data-count-on-us-contact-detail-field]");
    const contactDetailInput = root.querySelector("[data-count-on-us-contact-detail]");
    const contactDetailLabel = root.querySelector("[data-count-on-us-contact-detail-label]");
    const contactDetailHelp = root.querySelector("[data-count-on-us-contact-detail-help]");
    const causePreference = root.querySelector("[data-count-on-us-cause-preference]");
    const causeLinksField = root.querySelector("[data-count-on-us-cause-links]");
    const submit = form && form.querySelector("button[type='submit']");

    if (!form || !status) return;

    function setStatus(message, isError) {
      status.hidden = false;
      status.classList.toggle("count-on-us-widget__status--error", Boolean(isError));
      status.textContent = message;
    }

    function hideStatus() {
      status.hidden = true;
      status.textContent = "";
      status.classList.remove("count-on-us-widget__status--error");
    }

    function getErrorTarget(fieldName) {
      return root.querySelector(`[data-count-on-us-error-for="${fieldName}"]`);
    }

    function setFieldError(fieldName, message) {
      const target = getErrorTarget(fieldName) || getErrorTarget("form");
      if (!target) return null;
      target.hidden = false;
      target.textContent = message;
      return target;
    }

    function clearFieldErrors() {
      root.querySelectorAll("[data-count-on-us-error-for]").forEach((target) => {
        target.hidden = true;
        target.textContent = "";
      });
    }

    function focusField(fieldName) {
      const linkField = linkFields.find((field) => field.getAttribute("data-count-on-us-link-error") === fieldName);
      const linkInput = linkField ? linkField.querySelector("[data-count-on-us-link-input]") : null;
      const field =
        form.querySelector(`[name="${fieldName}"]`) ||
        linkInput ||
        form.querySelector("[name='publicCreditName']");
      if (field && typeof field.focus === "function") field.focus();
    }

    function showFieldErrors(fieldErrors, fallbackMessage) {
      clearFieldErrors();
      hideStatus();

      const entries = Object.entries(fieldErrors || {}).filter((entry) => Array.isArray(entry[1]) && entry[1].length > 0);
      if (entries.length === 0) {
        const target = setFieldError("form", fallbackMessage || "Unable to submit the form.");
        if (target) target.scrollIntoView({ block: "center", behavior: "smooth" });
        return;
      }

      const [firstFieldName] = entries[0];
      entries.forEach(([fieldName, messages]) => {
        setFieldError(fieldName, messages[0]);
      });

      const firstError = getErrorTarget(firstFieldName);
      if (firstError) firstError.scrollIntoView({ block: "center", behavior: "smooth" });
      focusField(firstFieldName);
    }

    function normalizePublicUrl(value) {
      const trimmed = String(value || "").trim();
      if (!trimmed || /[\u0000-\u001f\u007f]|\s/.test(trimmed)) return null;

      const withProtocol = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
      let parsed;
      try {
        parsed = new URL(withProtocol);
      } catch (_error) {
        return null;
      }

      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
      if (parsed.username || parsed.password) return null;
      if (!parsed.hostname || !parsed.hostname.includes(".") || parsed.hostname.toLowerCase() === "localhost") return null;
      return parsed.toString();
    }

    function renderLink(field, value) {
      const linkList = field.querySelector("[data-count-on-us-link-list]");
      if (!linkList) return;
      const fieldName = field.getAttribute("data-count-on-us-link-name") || "publicLinks";

      const item = document.createElement("div");
      item.className = "count-on-us-artist-form__link-item";

      const hidden = document.createElement("input");
      hidden.type = "hidden";
      hidden.name = fieldName;
      hidden.value = value;

      const text = document.createElement("span");
      text.textContent = value;

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "count-on-us-artist-form__link-remove";
      remove.textContent = "Remove";
      remove.addEventListener("click", () => item.remove());

      item.append(hidden, text, remove);
      linkList.append(item);
    }

    function addCurrentLink(field) {
      if (field.hidden) return true;
      const linkInput = field.querySelector("[data-count-on-us-link-input]");
      if (!linkInput) return true;
      const value = linkInput.value.trim();
      if (!value) return true;
      const fieldName = field.getAttribute("data-count-on-us-link-error") || field.getAttribute("data-count-on-us-link-name") || "publicLinks";

      const normalized = normalizePublicUrl(value);
      if (!normalized) {
        showFieldErrors({ [fieldName]: ["Please enter a valid public website URL."] });
        return false;
      }

      renderLink(field, normalized);
      linkInput.value = "";
      const errorTarget = getErrorTarget(fieldName);
      if (errorTarget) {
        errorTarget.hidden = true;
        errorTarget.textContent = "";
      }
      return true;
    }

    linkFields.forEach((field) => {
      const addLinkButton = field.querySelector("[data-count-on-us-add-link]");
      const linkInput = field.querySelector("[data-count-on-us-link-input]");

      if (!addLinkButton || !linkInput) return;

      addLinkButton.addEventListener("click", () => {
        addCurrentLink(field);
      });

      linkInput.addEventListener("keydown", (event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        event.stopPropagation();
        addCurrentLink(field);
      });
    });

    function addPendingLinks() {
      return linkFields.every((field) => addCurrentLink(field));
    }

    const contactDetailCopy = {
      "Phone / text": {
        label: "Phone or text number *",
        help: "Enter the phone number we should use for text or phone follow-up.",
        placeholder: "555-555-5555",
        type: "tel",
        autocomplete: "tel",
      },
      "Instagram DM": {
        label: "Instagram handle *",
        help: "Enter the Instagram handle we should message.",
        placeholder: "@sparklyrocketship",
        type: "text",
        autocomplete: "off",
      },
      Signal: {
        label: "Signal contact *",
        help: "Enter the phone number or Signal username we should use.",
        placeholder: "Signal phone number or username",
        type: "text",
        autocomplete: "off",
      },
      Discord: {
        label: "Discord username *",
        help: "Enter the Discord username we should use.",
        placeholder: "username",
        type: "text",
        autocomplete: "off",
      },
      Other: {
        label: "Contact detail *",
        help: "Enter the contact detail and any context we need for your preferred method.",
        placeholder: "Preferred contact detail",
        type: "text",
        autocomplete: "off",
      },
    };

    function updateContactDetailField() {
      if (!contactMethod || !contactDetailField || !contactDetailInput) return;
      const selectedMethod = contactMethod.value;
      const copy = contactDetailCopy[selectedMethod];

      contactDetailField.hidden = !copy;
      contactDetailInput.required = Boolean(copy);

      if (!copy) {
        contactDetailInput.value = "";
        const errorTarget = getErrorTarget("contactDetail");
        if (errorTarget) {
          errorTarget.hidden = true;
          errorTarget.textContent = "";
        }
        return;
      }

      if (contactDetailLabel) contactDetailLabel.textContent = copy.label;
      if (contactDetailHelp) contactDetailHelp.textContent = copy.help;
      contactDetailInput.placeholder = copy.placeholder;
      contactDetailInput.type = copy.type;
      contactDetailInput.autocomplete = copy.autocomplete;
    }

    function updateCauseLinksVisibility() {
      if (!causePreference || !causeLinksField) return;
      const showLinks = causePreference.value === "I have specific causes in mind";
      causeLinksField.hidden = !showLinks;

      if (showLinks) return;

      const linkInput = causeLinksField.querySelector("[data-count-on-us-link-input]");
      const linkList = causeLinksField.querySelector("[data-count-on-us-link-list]");
      if (linkInput) linkInput.value = "";
      if (linkList) linkList.textContent = "";
      const errorTarget = getErrorTarget("causeLinks");
      if (errorTarget) {
        errorTarget.hidden = true;
        errorTarget.textContent = "";
      }
    }

    if (contactMethod) {
      contactMethod.addEventListener("change", updateContactDetailField);
      updateContactDetailField();
    }

    if (causePreference) {
      causePreference.addEventListener("change", updateCauseLinksVisibility);
      updateCauseLinksVisibility();
    }

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      clearFieldErrors();
      hideStatus();
      updateContactDetailField();
      updateCauseLinksVisibility();
      if (!addPendingLinks()) return;
      setStatus("Submitting...", false);
      if (submit) submit.disabled = true;

      try {
        const response = await fetch(form.action, {
          method: "POST",
          body: new FormData(form),
          headers: {
            Accept: "application/json",
          },
        });

        const json = await response.json().catch(() => ({}));
        if (!response.ok) {
          const fieldErrors =
            json && json.error && json.error.fieldErrors
              ? json.error.fieldErrors
              : json && json.error && json.error.code === "UPLOAD_ERROR"
                ? { artworkFiles: [json.error.message] }
                : null;
          showFieldErrors(fieldErrors, json && json.error && json.error.message);
          return;
        }

        if (body) body.hidden = true;
        clearFieldErrors();
        status.textContent = "Thanks. Your collaboration interest form was submitted.";
      } catch (error) {
        if (body) body.hidden = false;
        showFieldErrors({ form: [error && error.message ? error.message : "Unable to submit the form."] });
      } finally {
        if (submit) submit.disabled = false;
      }
    });
  });
})();
