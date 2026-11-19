// SherLock - Content Script for secure autofill and form detection
console.log("SherLock content script loaded");

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

function collectOpenShadowInputs(root = document) {
  const found = [];
  const visit = (node) => {
    found.push(...(node.querySelectorAll?.("input") || []));
    for (const element of node.querySelectorAll?.("*") || []) {
      if (element.shadowRoot) visit(element.shadowRoot);
    }
    if (node.shadowRoot) visit(node.shadowRoot);
  };
  visit(root);
  return [...new Set(found)];
}

function findFormFields(root = document, { includeNewPassword = false } = {}) {
  const inputs = collectOpenShadowInputs(root).filter(isUsableInput);
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

// ─── SherLock field icon layer ───
function computeIconBox(fieldRect) {
  const margin = Math.max(4, Math.min(fieldRect.height * 0.15, 8));
  const size = Math.max(18, Math.min(fieldRect.height - 2 * margin, 40));
  return {
    size,
    top: fieldRect.top + (fieldRect.height - size) / 2,
    left: fieldRect.right - size - margin,
    margin,
  };
}

function isFieldVisible(
  field,
  rect = field.getBoundingClientRect?.() || {
    top: 0,
    left: 0,
    right: 300,
    bottom: 40,
    width: 300,
    height: 40,
  },
) {
  if (!isFieldRendered(field, rect)) return false;
  return (
    rect.bottom > 0 &&
    rect.right > 0 &&
    rect.top < window.innerHeight &&
    rect.left < window.innerWidth
  );
}

function isFieldRendered(field, rect) {
  if (field.getClientRects && field.getClientRects().length === 0) return false;
  if (!rect.width || !rect.height) return false;
  const style = getComputedStyle(field);
  return (
    style.display !== "none" &&
    style.visibility !== "hidden" &&
    Number(style.opacity) !== 0
  );
}

function isEligibleLoginField(field) {
  if (
    !field ||
    field.tagName !== "INPUT" ||
    field.disabled ||
    field.readOnly ||
    ["hidden", "submit", "button", "reset", "image", "search"].includes(
      field.type,
    )
  )
    return false;
  const rect = field.getBoundingClientRect?.() || {
    top: 0,
    left: 0,
    right: 300,
    bottom: 40,
    width: 300,
    height: 40,
  };
  if (rect.height < 24 || rect.width < 80 || !isFieldRendered(field, rect))
    return false;
  if (field.type === "password" || field.type === "email") return true;
  return (
    field.type === "text" &&
    /user(name)?|login|account|email|mail|identifier|correu|usuari/.test(
      inputAttributes(field),
    )
  );
}

const extensionApi = globalThis.browser ?? globalThis.chrome;
const iconHostElement = document.createElement("div");
iconHostElement.id = "sherlock-field-icons";
iconHostElement.style.cssText =
  "all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none";
document.documentElement.appendChild(iconHostElement);
const iconShadow = iconHostElement.attachShadow({ mode: "closed" });
const iconStyle = document.createElement("style");
iconStyle.textContent = `
  *{box-sizing:border-box}.sherlock-icon-btn{position:fixed;display:flex;align-items:center;justify-content:center;padding:0;border:0;border-radius:9px;background:transparent;cursor:pointer;opacity:.9;pointer-events:auto;transition:opacity .15s ease,transform .15s ease}.sherlock-icon-btn[hidden]{display:none}
  .sherlock-icon-btn:hover{opacity:1;transform:scale(1.08)}.sherlock-icon-btn:focus-visible{outline:2px solid #2471d1;outline-offset:2px}.sherlock-icon-btn img{width:100%;height:100%;object-fit:contain;border-radius:inherit}
  .sherlock-menu,.sherlock-toast{position:fixed;z-index:2147483647;color:#fff;background:#172b4d;font:13px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;box-shadow:0 4px 16px #0004}.sherlock-menu{min-width:210px;max-width:300px;padding:6px;border-radius:10px;pointer-events:auto}.sherlock-menu button{display:block;width:100%;padding:9px 10px;border:0;border-radius:6px;background:transparent;color:inherit;text-align:left;font:inherit;cursor:pointer}.sherlock-menu button:hover{background:#ffffff20}.sherlock-menu small{display:block;margin-top:3px;color:#b8c8dc}.sherlock-toast{left:50%;bottom:20px;transform:translateX(-50%);padding:10px 16px;border-radius:8px;pointer-events:none}
  @media(prefers-reduced-motion:reduce){.sherlock-icon-btn{transition:none}}
`;
iconShadow.append(iconStyle);
const iconByField = new WeakMap();
const activeIconEntries = new Map();
const resizeObserver = new ResizeObserver(schedulePositionUpdate);
const observedRoots = new WeakSet();
let updateTimer;
let toastTimer;
let frameScheduled = false;

function showToast(message) {
  iconShadow.querySelector(".sherlock-toast")?.remove();
  const toast = document.createElement("div");
  toast.className = "sherlock-toast";
  toast.setAttribute("role", "status");
  toast.textContent = message;
  iconShadow.append(toast);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.remove(), 3200);
}

function positionFieldIcon(field, button) {
  if (!field.isConnected) {
    button.remove();
    activeIconEntries.delete(field);
    iconByField.delete(field);
    resizeObserver.unobserve(field);
    return;
  }
  const rect = field.getBoundingClientRect();
  if (!isFieldVisible(field, rect)) {
    button.hidden = true;
    return;
  }
  button.hidden = false;
  const box = computeIconBox(rect);
  let left = box.left;
  // Move left of an existing eye/reveal control in the same field container.
  const parent = field.parentElement;
  const controls =
    parent?.querySelectorAll(
      'button,[role="button"],[aria-label*="password" i]',
    ) || [];
  for (const control of controls) {
    if (control === button || iconHostElement.contains(control)) continue;
    const r = control.getBoundingClientRect();
    if (
      r.width &&
      r.height &&
      Math.abs(r.top + r.height / 2 - (rect.top + rect.height / 2)) <
        rect.height
    )
      left = Math.max(rect.left + 4, Math.min(left, r.left - box.size - 4));
  }
  button.style.top = `${box.top}px`;
  button.style.left = `${left}px`;
  button.style.width = `${box.size}px`;
  button.style.height = `${box.size}px`;
}

function schedulePositionUpdate() {
  if (frameScheduled) return;
  frameScheduled = true;
  requestAnimationFrame(() => {
    frameScheduled = false;
    for (const [field, button] of activeIconEntries)
      positionFieldIcon(field, button);
  });
}

function closeCredentialMenu() {
  iconShadow.querySelector(".sherlock-menu")?.remove();
}

async function fillSelected(field, choice) {
  try {
    const result = await extensionApi.runtime.sendMessage({
      action: "sherlockSelectCredential",
      domain: location.hostname,
      credentialId: choice.id,
      username: choice.username,
    });
    if (result?.locked) {
      showToast("SherLock està bloquejat. Obre l'app per desbloquejar-lo.");
      return;
    }
    if (!result?.success || !result.credential) {
      showToast("No s'ha pogut obtenir aquesta entrada.");
      return;
    }
    const { usernameEl, passwordEl } = field.form
      ? findFormFields(field.form)
      : findFormFields();
    const userTarget = usernameEl || (field.type !== "password" ? field : null);
    const passwordTarget =
      passwordEl || (field.type === "password" ? field : null);
    if (userTarget && result.credential.username)
      setNativeInputValue(userTarget, result.credential.username);
    if (passwordTarget && result.credential.password)
      setNativeInputValue(passwordTarget, result.credential.password);
    if (!userTarget && !passwordTarget) {
      showToast("No s'ha trobat cap camp de login.");
      return;
    }
    showToast("Credencials emplenades.");
  } catch {
    showToast("SherLock està bloquejat. Obre l'app per desbloquejar-lo.");
  }
}

function showCredentialMenu(button, field, choices) {
  closeCredentialMenu();
  const menu = document.createElement("div");
  menu.className = "sherlock-menu";
  menu.setAttribute("role", "menu");
  const rect = button.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 308))}px`;
  menu.style.top = `${Math.min(window.innerHeight - 12, rect.bottom + 6)}px`;
  for (const choice of choices) {
    const option = document.createElement("button");
    option.type = "button";
    option.setAttribute("role", "menuitem");
    option.append(
      document.createTextNode(choice.username || "Compte sense nom"),
    );
    const domain = document.createElement("small");
    domain.textContent = choice.domain || location.hostname;
    option.append(domain);
    option.addEventListener("click", async () => {
      closeCredentialMenu();
      await fillSelected(field, choice);
    });
    menu.append(option);
  }
  iconShadow.append(menu);
}

function createFieldIcon(field) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "sherlock-icon-btn";
  button.setAttribute("aria-label", "Emplenar amb SherLock");
  button.setAttribute("tabindex", "0");
  const img = document.createElement("img");
  img.alt = "";
  img.src = extensionApi.runtime.getURL("icons/icon128.png");
  button.append(img);
  button.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    button.disabled = true;
    try {
      const result = await extensionApi.runtime.sendMessage({
        action: "sherlockGetCredentialChoices",
        domain: location.hostname,
      });
      if (result?.locked) {
        showToast("SherLock està bloquejat. Obre l'app per desbloquejar-lo.");
        return;
      }
      if (!result?.success) {
        showToast("No s'ha pogut consultar SherLock.");
        return;
      }
      const choices = result.choices || [];
      if (!choices.length) {
        showToast("No hi ha cap entrada per a aquest lloc.");
        return;
      }
      if (choices.length > 1) showCredentialMenu(button, field, choices);
      else await fillSelected(field, choices[0]);
    } catch {
      showToast("SherLock està bloquejat. Obre l'app per desbloquejar-lo.");
    } finally {
      button.disabled = false;
    }
  });
  iconShadow.append(button);
  iconByField.set(field, button);
  activeIconEntries.set(field, button);
  resizeObserver.observe(field);
  positionFieldIcon(field, button);
}

function updateIcons() {
  observeOpenShadowRoots();
  if (window.top !== window.self) return;
  const eligible = new Set(
    collectOpenShadowInputs().filter(isEligibleLoginField),
  );
  for (const [field, button] of activeIconEntries) {
    if (!eligible.has(field)) {
      button.remove();
      activeIconEntries.delete(field);
      iconByField.delete(field);
      resizeObserver.unobserve(field);
    } else positionFieldIcon(field, button);
  }
  for (const field of eligible)
    if (!iconByField.has(field)) createFieldIcon(field);
}

const mutationObserver = new MutationObserver(() => {
  clearTimeout(updateTimer);
  updateTimer = setTimeout(updateIcons, 250);
});
mutationObserver.observe(document.documentElement, {
  childList: true,
  subtree: true,
});
function observeOpenShadowRoots(root = document) {
  for (const element of root.querySelectorAll?.("*") || []) {
    if (!element.shadowRoot || observedRoots.has(element.shadowRoot)) continue;
    observedRoots.add(element.shadowRoot);
    mutationObserver.observe(element.shadowRoot, {
      childList: true,
      subtree: true,
    });
    observeOpenShadowRoots(element.shadowRoot);
  }
}
window.addEventListener("scroll", schedulePositionUpdate, true);
window.addEventListener("resize", schedulePositionUpdate, true);
setTimeout(updateIcons, 100);

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

  prompt.querySelector(".cf-btn-save")?.addEventListener("click", (event) => {
    if (event && !event.isTrusted) return;
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
    if (event && !event.isTrusted) return;
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
