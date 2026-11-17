// SherLock - Content Script for secure autofill and form detection

function setNativeInputValue(element, value) {
  if (!element) return;
  element.focus();
  const prototype = Object.getPrototypeOf(element);
  const descriptor =
    Object.getOwnPropertyDescriptor(prototype, "value") ||
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");

  if (descriptor && descriptor.set) {
    descriptor.set.call(element, value);
  } else {
    element.value = value;
  }

  element.dispatchEvent(
    new Event("input", { bubbles: true, cancelable: true }),
  );
  element.dispatchEvent(
    new Event("change", { bubbles: true, cancelable: true }),
  );
  element.dispatchEvent(new Event("blur", { bubbles: true, cancelable: true }));

  // Visual feedback glow
  const prevTransition = element.style.transition;
  const prevBoxShadow = element.style.boxShadow;
  element.style.transition = "box-shadow 0.2s ease";
  element.style.boxShadow = "0 0 0 3px rgba(36, 113, 209, 0.4)";
  setTimeout(() => {
    element.style.boxShadow = prevBoxShadow;
    element.style.transition = prevTransition;
  }, 1200);
}

function inputAttributes(input) {
  return [
    input.name,
    input.id,
    input.placeholder,
    input.getAttribute?.("aria-label"),
    input.getAttribute?.("autocomplete"),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function isUsableInput(input) {
  if (input.tagName !== "INPUT" || input.disabled || input.readOnly)
    return false;
  if (["hidden", "submit", "button", "reset", "image"].includes(input.type)) {
    return false;
  }
  if (typeof input.getClientRects === "function") {
    return input.getClientRects().length > 0;
  }
  return input.offsetParent !== null;
}

function scoreUsernameInput(input) {
  const autocomplete = (input.autocomplete || "").toLowerCase();
  const hints = inputAttributes(input);
  let score = 0;

  if (autocomplete === "username") score += 120;
  if (autocomplete === "email") score += 90;
  if (input.type === "email") score += 70;
  if (/user(name)?|login|account|email|mail|identifier/.test(hints))
    score += 40;
  if (input.type === "text") score += 5;

  return score;
}

function findFormFields(root = document, { includeNewPassword = false } = {}) {
  const inputs = Array.from(root.querySelectorAll("input")).filter(
    isUsableInput,
  );
  const passwordInputs = inputs.filter((input) => input.type === "password");
  const signupOnly =
    !includeNewPassword &&
    passwordInputs.length > 0 &&
    passwordInputs.every(
      (input) => (input.autocomplete || "").toLowerCase() === "new-password",
    );
  if (signupOnly) return { usernameEl: null, passwordEl: null };
  const passwordEl =
    passwordInputs
      .filter((input) => {
        const autocomplete = (input.autocomplete || "").toLowerCase();
        return includeNewPassword || autocomplete !== "new-password";
      })
      .map((input) => {
        const autocomplete = (input.autocomplete || "").toLowerCase();
        const hints = inputAttributes(input);
        const sameFormHasUsername = inputs.some(
          (candidate) =>
            candidate !== input &&
            candidate.form === input.form &&
            candidate.type !== "password" &&
            scoreUsernameInput(candidate) > 5,
        );
        return {
          input,
          score:
            10 +
            (autocomplete === "current-password" ? 120 : 0) +
            (/pass|password/.test(hints) ? 30 : 0) +
            (sameFormHasUsername ? 35 : 0),
        };
      })
      .sort((left, right) => right.score - left.score)[0]?.input || null;

  const usernameCandidates = inputs
    .filter(
      (input) =>
        input !== passwordEl &&
        input.type !== "password" &&
        scoreUsernameInput(input) > 5,
    )
    .filter((input) => !passwordEl?.form || input.form === passwordEl.form)
    .map((input) => ({ input, score: scoreUsernameInput(input) }))
    .sort((left, right) => right.score - left.score);

  // On two-step sign-in pages, the username field is the only login field.
  const fallbackCandidates = usernameCandidates.length
    ? usernameCandidates
    : inputs
        .filter((input) => input !== passwordEl && input.type !== "password")
        .map((input) => ({ input, score: scoreUsernameInput(input) }))
        .filter(({ score }) => score > 5)
        .sort((left, right) => right.score - left.score);

  return {
    usernameEl: fallbackCandidates[0]?.input || null,
    passwordEl,
  };
}

// ─── Inline field icons ───
// Inject inline icons near password/username fields for autofill.

let lastIconUpdate = 0;
const ICON_THROTTLE_MS = 500;

function shouldInjectIcons() {
  const now = Date.now();
  if (now - lastIconUpdate < ICON_THROTTLE_MS) return false;
  lastIconUpdate = now;
  return true;
}

function isEligibleField(input) {
  if (input.disabled || input.readOnly) return false;
  if (input.getClientRects && input.getClientRects().length === 0) return false;
  return (
    input.type === "password" || input.type === "email" || input.type === "text"
  );
}

function hasIcon(input) {
  return input.dataset.sherlockIcon !== undefined;
}

function injectInlineIcons() {
  if (!shouldInjectIcons()) return;

  const { usernameEl, passwordEl } = findFormFields();

  // Remove icons from fields that are no longer eligible
  document.querySelectorAll("[data-sherlock-icon]").forEach((container) => {
    const field = container.dataset.sherlockTarget;
    const stillEligible = field === passwordEl || field === usernameEl;
    if (!stillEligible) container.remove();
  });

  // Add icon to password field if eligible and not already added
  if (passwordEl && isEligibleField(passwordEl) && !hasIcon(passwordEl)) {
    passwordEl.dataset.sherlockIcon = "password";
    const wrapper = createFieldIconWrapper(passwordEl);
    createInlineIcon(wrapper, passwordEl, "password");
    passwordEl.parentElement.appendChild(wrapper);
  }

  // Add icon to username field if eligible and not already added
  if (usernameEl && isEligibleField(usernameEl) && !hasIcon(usernameEl)) {
    usernameEl.dataset.sherlockIcon = "username";
    const wrapper = createFieldIconWrapper(usernameEl);
    createInlineIcon(wrapper, usernameEl, "username");
    usernameEl.parentElement.appendChild(wrapper);
  }
}

function createFieldIconWrapper(field) {
  const wrapper = document.createElement("span");
  wrapper.setAttribute("data-sherlock-icon", "");
  wrapper.setAttribute("data-sherlock-target", field);
  wrapper.className = "sherlock-icon-wrapper";
  return wrapper;
}

function createInlineIcon(wrapper, field, type) {
  const icon = document.createElement("button");
  icon.type = "button";
  icon.className = "sherlock-inline-icon";
  icon.setAttribute("data-sherlock-field-type", type);
  icon.setAttribute("data-sherlock-field-target", field);
  icon.setAttribute("aria-label", "SherLock: fill credentials");

  // SVG icon inline (no external resource needed)
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "16");
  svg.setAttribute("height", "16");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute(
    "d",
    "M12 2a5 5 0 0 0-5 5v4a5 5 0 0 0 10 0V7a5 5 0 0 0-5-5z",
  );
  svg.appendChild(path);
  icon.appendChild(svg);

  icon.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    handleIconClick(field, type, icon);
  });

  wrapper.appendChild(icon);
  return icon;
}

async function handleIconClick(field, type, icon) {
  icon.classList.add("sherlock-loading");
  try {
    if (type === "password") {
      const response = await chrome.runtime.sendMessage({
        action: "autofillLogin",
      });
      if (response.success) {
        showToast("Filled credentials");
      } else {
        showToast("Could not fill credentials");
      }
    } else {
      showToast("Select login form first");
    }
  } catch (error) {
    showToast("SherLock error: " + error.message);
  } finally {
    icon.classList.remove("sherlock-loading");
  }
}

function showToast(message) {
  const existing = document.getElementById("sherlock-toast");
  if (existing) existing.remove();

  const toast = document.createElement("div");
  toast.id = "sherlock-toast";
  toast.className = "sherlock-toast";
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.remove();
  }, 3000);
}

// Periodically inject icons for new forms (SPA)
setInterval(injectInlineIcons, 3000);

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "autofillLogin") {
    const cred = request.credential;
    if (!cred) {
      sendResponse({ success: false, error: "No credentials provided" });
      return false;
    }

    const { usernameEl, passwordEl } = findFormFields();

    let filledCount = 0;
    if (usernameEl && cred.username) {
      setNativeInputValue(usernameEl, cred.username);
      filledCount++;
    }

    if (passwordEl && cred.password) {
      setNativeInputValue(passwordEl, cred.password);
      filledCount++;
    }

    if (filledCount > 0) {
      sendResponse({ success: true, filledCount });
    } else {
      sendResponse({
        success: false,
        error: "No matching login input fields found on this page",
      });
    }
    return true;
  }

  if (request.action === "getFormData") {
    const { usernameEl, passwordEl } = findFormFields();
    sendResponse({
      success: true,
      site: window.location.hostname.replace(/^www\./, ""),
      username: usernameEl ? usernameEl.value : "",
      password: passwordEl ? passwordEl.value : "",
    });
    return true;
  }

  if (request.action === "fillGeneratedPassword") {
    let target = document.activeElement;
    if (!target || target.tagName !== "INPUT" || target.type !== "password") {
      const { passwordEl } = findFormFields(document, {
        includeNewPassword: true,
      });
      target = passwordEl;
    }
    if (target) {
      setNativeInputValue(target, request.password);

      // Fill repeat/confirm password field if exists in the same form
      if (target.form) {
        const otherPasswords = Array.from(
          target.form.querySelectorAll('input[type="password"]'),
        ).filter((el) => el !== target);
        otherPasswords.forEach((el) =>
          setNativeInputValue(el, request.password),
        );
      }

      // Show save prompt so user can save immediately with 1-click
      const { usernameEl } = findFormFields();
      showSavePrompt({
        site: window.location.hostname,
        username: usernameEl ? usernameEl.value.trim() : "",
        password: request.password,
      });

      sendResponse({ success: true });
    } else {
      sendResponse({ success: false, error: "No password field found" });
    }
    return true;
  }

  return false;
});

function showSavePrompt({ site, username, password }) {
  if (!site || !password) return;

  const existing = document.getElementById("sherlock-save-prompt");
  if (existing) existing.remove();

  const prompt = document.createElement("div");
  prompt.id = "sherlock-save-prompt";
  prompt.className = "sherlock-save-prompt";

  const cleanSite = site.replace(/^www\./, "");
  const title = document.createElement("span");
  title.style.fontWeight = "600";
  title.textContent = "SherLock:";

  const message = document.createElement("span");
  message.append("Desar contrasenya per a ");
  const siteName = document.createElement("strong");
  siteName.textContent = cleanSite;
  message.append(siteName);
  if (username) {
    message.append(` (${username})`);
  }
  message.append("?");

  const saveButton = document.createElement("button");
  saveButton.type = "button";
  saveButton.className = "cf-btn-save";
  saveButton.textContent = "Desar a SherLock";

  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = "cf-btn-close";
  closeButton.title = "Tancar";
  closeButton.textContent = "X";
  prompt.replaceChildren(title, message, saveButton, closeButton);

  prompt.querySelector(".cf-btn-close")?.addEventListener("click", () => {
    prompt.remove();
  });

  prompt.querySelector(".cf-btn-save")?.addEventListener("click", () => {
    const saveBtn = prompt.querySelector(".cf-btn-save");
    if (saveBtn) {
      saveBtn.textContent = "Desant...";
      saveBtn.disabled = true;
    }
    chrome.runtime.sendMessage(
      {
        action: "saveCredentials",
        data: { site: cleanSite, username, password, notes: "" },
      },
      (res) => {
        if (res && res.success) {
          // Use textContent to avoid XSS from server-provided strings (F15)
          const okSpan = document.createElement("span");
          okSpan.style.fontWeight = "600";
          okSpan.style.color = "#4ade80";
          okSpan.textContent = "✓ Accés desat a SherLock!";
          prompt.replaceChildren(okSpan);
          setTimeout(() => prompt.remove(), 2500);
        } else {
          const errSpan = document.createElement("span");
          errSpan.style.color = "#f87171";
          errSpan.textContent =
            "Error: " + (res?.error || "No s'ha pogut desar");
          prompt.replaceChildren(errSpan);
          setTimeout(() => prompt.remove(), 3500);
        }
      },
    );
  });

  document.body.appendChild(prompt);
  setTimeout(() => {
    if (document.body.contains(prompt)) {
      prompt.remove();
    }
  }, 15000);
}

// Listen for form submissions to offer saving new credentials
document.addEventListener(
  "submit",
  (event) => {
    const form = event.target;
    if (!form || typeof form.querySelectorAll !== "function") return;
    const passwordInputs = Array.from(
      form.querySelectorAll('input[type="password"]'),
    ).filter((el) => el.value && el.value.trim().length > 0);

    if (passwordInputs.length > 0) {
      const password = passwordInputs[0].value;
      const usernameInput = form.querySelector(
        'input[type="email"], input[type="text"], input[name*="user" i], input[name*="login" i], input[name*="mail" i]',
      );
      const username = usernameInput ? usernameInput.value.trim() : "";
      showSavePrompt({
        site: window.location.hostname,
        username,
        password,
      });
    }
  },
  true,
);
