// Caixa Forta - Content Script for secure autofill and form detection

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

function findFormFields() {
  const passwordInputs = Array.from(
    document.querySelectorAll(
      'input[type="password"]:not([disabled]):not([readonly])',
    ),
  ).filter((el) => el.offsetParent !== null);

  const passwordEl = passwordInputs[0] || null;

  // Look for username/email fields
  const usernameSelectors = [
    'input[type="email"]:not([disabled]):not([readonly])',
    'input[name*="user" i]:not([disabled]):not([readonly])',
    'input[name*="login" i]:not([disabled]):not([readonly])',
    'input[name*="mail" i]:not([disabled]):not([readonly])',
    'input[id*="user" i]:not([disabled]):not([readonly])',
    'input[id*="email" i]:not([disabled]):not([readonly])',
    'input[autocomplete*="username" i]',
    'input[autocomplete*="email" i]',
    'input[type="text"]:not([disabled]):not([readonly])',
  ];

  let usernameEl = null;

  // Search within the same form first
  if (passwordEl && passwordEl.form) {
    for (const selector of usernameSelectors) {
      const match = passwordEl.form.querySelector(selector);
      if (match && match !== passwordEl && match.offsetParent !== null) {
        usernameEl = match;
        break;
      }
    }
  }

  // Fallback to searching the whole document
  if (!usernameEl) {
    for (const selector of usernameSelectors) {
      const candidates = Array.from(document.querySelectorAll(selector)).filter(
        (el) => el !== passwordEl && el.offsetParent !== null,
      );
      if (candidates.length > 0) {
        usernameEl = candidates[0];
        break;
      }
    }
  }

  return { usernameEl, passwordEl };
}

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
      const { passwordEl } = findFormFields();
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

  const existing = document.getElementById("caixa-forta-save-prompt");
  if (existing) existing.remove();

  const prompt = document.createElement("div");
  prompt.id = "caixa-forta-save-prompt";
  prompt.className = "caixa-forta-save-prompt";

  const cleanSite = site.replace(/^www\./, "");
  const userText = username ? ` (${username})` : "";

  prompt.innerHTML = `
    <span style="font-weight: 600;">🔒 Caixa Forta:</span>
    <span>Desar contrasenya per a <strong>${cleanSite}</strong>${userText}?</span>
    <button type="button" class="cf-btn-save">Desar a Caixa Forta</button>
    <button type="button" class="cf-btn-close" title="Tancar">✕</button>
  `;

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
          prompt.innerHTML = `<span style="font-weight: 600; color: #4ade80;">✓ Accés desat a Caixa Forta!</span>`;
          setTimeout(() => prompt.remove(), 2500);
        } else {
          prompt.innerHTML = `<span style="color: #f87171;">Error: ${res?.error || "No s'ha pogut desar"}</span>`;
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
