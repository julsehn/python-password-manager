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
  *{box-sizing:border-box}
  :host{
    --sherlock-font-size:16px;
    --sherlock-bg:#172b4d;
    --sherlock-text:#ffffff;
    --sherlock-muted:#b8c8dc;
    --sherlock-hover:#ffffff20;
    --sherlock-border:transparent;
    --sherlock-shadow:0 4px 16px #0004;
  }
  :host([data-sherlock-theme="light"]){
    --sherlock-bg:#ffffff;
    --sherlock-text:#172b4d;
    --sherlock-muted:#5b6b82;
    --sherlock-hover:#eef4fb;
    --sherlock-border:#d6e2f0;
    --sherlock-shadow:0 8px 24px rgba(15,23,42,.18);
  }
  .sherlock-icon-btn{position:fixed;display:flex;align-items:center;justify-content:center;padding:0;border:0;border-radius:9px;background:transparent;cursor:pointer;opacity:.9;pointer-events:auto;transition:opacity .15s ease,transform .15s ease}.sherlock-icon-btn[hidden]{display:none}
  .sherlock-icon-btn:hover{opacity:1;transform:scale(1.08)}.sherlock-icon-btn:focus-visible{outline:2px solid #2471d1;outline-offset:2px}.sherlock-icon-btn img{width:100%;height:100%;object-fit:contain;border-radius:inherit}
  .sherlock-menu,.sherlock-toast{position:fixed;z-index:2147483647;color:var(--sherlock-text);background:var(--sherlock-bg);border:1px solid var(--sherlock-border);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:var(--sherlock-font-size,16px);box-shadow:var(--sherlock-shadow)}.sherlock-menu{min-width:210px;max-width:300px;padding:6px;border-radius:10px;pointer-events:auto}.sherlock-menu button{display:block;width:100%;padding:9px 10px;border:0;border-radius:6px;background:transparent;color:inherit;text-align:left;font:inherit;cursor:pointer}.sherlock-menu button:hover{background:var(--sherlock-hover)}.sherlock-menu small{display:block;margin-top:3px;color:var(--sherlock-muted)}.sherlock-menu-title{display:block;padding:8px 10px 2px;color:var(--sherlock-text);font-size:1em}.sherlock-menu-message{margin:0;padding:0 10px 10px;color:var(--sherlock-muted);font-size:.92em;line-height:1.4}.sherlock-menu button.primary{margin-top:2px;background:#2471d1;color:#fff}.sherlock-menu button.primary:hover{background:#185cac}.sherlock-toast{left:50%;bottom:20px;transform:translateX(-50%);padding:10px 16px;border-radius:8px;pointer-events:none}
  .sherlock-prompt{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:2147483647;width:min(360px,calc(100vw - 32px));padding:16px;border-radius:12px;background:var(--sherlock-bg);color:var(--sherlock-text);border:1px solid var(--sherlock-border);box-shadow:var(--sherlock-shadow);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:var(--sherlock-font-size,16px);pointer-events:auto}
  .sherlock-prompt h3{margin:0 0 6px;font-size:1.05em;line-height:1.25}
  .sherlock-prompt p{margin:0;color:var(--sherlock-muted);line-height:1.4}
  .sherlock-prompt-actions{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:8px;margin-top:14px}
  .sherlock-prompt button{border:1px solid var(--sherlock-border);border-radius:7px;padding:8px 12px;background:transparent;color:inherit;font:inherit;font-weight:600;cursor:pointer}
  .sherlock-prompt button:hover{background:var(--sherlock-hover)}
  .sherlock-prompt button.primary{background:#2471d1;border-color:#2471d1;color:#fff}
  .sherlock-prompt button.primary:hover{background:#185cac}
  .sherlock-prompt button:disabled{opacity:.6;cursor:default}
  @media(prefers-reduced-motion:reduce){.sherlock-icon-btn{transition:none}}
`;
iconShadow.append(iconStyle);

const themeMedia =
  typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-color-scheme: dark)")
    : { matches: false, addEventListener: null };
let injectedTheme = "auto";
let resolvedInjectedTheme = themeMedia.matches ? "dark" : "light";

function iconResourceForTheme() {
  return extensionApi.runtime.getURL(
    resolvedInjectedTheme === "dark"
      ? "icons/icon128-dark.png"
      : "icons/icon128.png",
  );
}

function applyInjectedFontSize(value) {
  const size = Number(value);
  const clamped = Math.min(24, Math.max(14, Math.round(size) || 16));
  if (typeof iconHostElement.style?.setProperty === "function") {
    iconHostElement.style.setProperty("--sherlock-font-size", `${clamped}px`);
  } else if (iconHostElement.style) {
    iconHostElement.style["--sherlock-font-size"] = `${clamped}px`;
  }
}

function applyInjectedTheme(theme) {
  injectedTheme = ["light", "dark", "auto"].includes(theme) ? theme : "auto";
  resolvedInjectedTheme =
    injectedTheme === "auto"
      ? themeMedia.matches
        ? "dark"
        : "light"
      : injectedTheme;
  iconHostElement.dataset.sherlockTheme = resolvedInjectedTheme;
  try {
    extensionApi.storage.local.set({
      sherlock_resolved_theme: resolvedInjectedTheme,
    });
  } catch {
    // Storage is optional; the injected UI still uses the resolved theme.
  }
  iconShadow.querySelectorAll("img[data-sherlock-icon]").forEach((img) => {
    img.src = iconResourceForTheme();
  });
}

applyInjectedFontSize(16);
applyInjectedTheme("auto");
try {
  extensionApi.storage.local.get(
    ["sherlock_theme", "sherlock_font_size"],
    (data) => {
      applyInjectedTheme((data && data.sherlock_theme) || "auto");
      applyInjectedFontSize(data && data.sherlock_font_size);
    },
  );
  extensionApi.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return;
    if (changes.sherlock_theme) {
      applyInjectedTheme(changes.sherlock_theme.newValue || "auto");
    }
    if (changes.sherlock_font_size) {
      applyInjectedFontSize(changes.sherlock_font_size.newValue);
    }
  });
} catch {
  // Storage is optional; keep the system theme.
}
if (themeMedia.addEventListener) {
  themeMedia.addEventListener("change", () => {
    if (injectedTheme === "auto") applyInjectedTheme("auto");
  });
}

const iconByField = new WeakMap();
const activeIconEntries = new Map();
const resizeObserver = new ResizeObserver(schedulePositionUpdate);
const observedRoots = new WeakSet();
let updateTimer;
let toastTimer;
let frameScheduled = false;
let credentialSubmitCheckInFlight = false;

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
  const verticalCenter = rect.top + rect.height / 2;
  const verticalTolerance = Math.min(14, rect.height * 0.3);
  for (const control of controls) {
    if (control === button || iconHostElement.contains(control)) continue;
    const r = control.getBoundingClientRect();
    if (
      !r.width ||
      !r.height ||
      r.left < rect.left + rect.width / 2 ||
      r.width > rect.width * 0.5 ||
      r.height > rect.height * 1.2 ||
      Math.abs(r.top + r.height / 2 - verticalCenter) > verticalTolerance
    ) {
      continue;
    }
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

function closeSherlockPrompt() {
  iconShadow.querySelector(".sherlock-prompt")?.remove();
}

function showSherlockPrompt({ title, message, actions = [] }) {
  closeCredentialMenu();
  closeSherlockPrompt();
  const prompt = document.createElement("div");
  prompt.className = "sherlock-prompt";
  prompt.setAttribute("role", "dialog");
  prompt.setAttribute("aria-modal", "true");
  prompt.setAttribute("aria-label", title);

  const heading = document.createElement("h3");
  heading.textContent = title;
  const copy = document.createElement("p");
  copy.textContent = message;
  const actionRow = document.createElement("div");
  actionRow.className = "sherlock-prompt-actions";
  const buttons = [];

  for (const action of actions) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = action.label;
    if (action.primary) button.className = "primary";
    button.addEventListener("click", async () => {
      if (button.disabled) return;
      buttons.forEach((item) => {
        item.disabled = true;
      });
      closeSherlockPrompt();
      await action.onClick?.();
    });
    buttons.push(button);
    actionRow.append(button);
  }

  prompt.append(heading, copy, actionRow);
  iconShadow.append(prompt);
  requestAnimationFrame(() =>
    actionRow.querySelector("button.primary")?.focus(),
  );
}

// Close the credential chooser when the user clicks outside it, presses
// Escape, scrolls away or moves focus to the browser chrome/an iframe.
// Events originating inside the closed shadow root are retargeted to the
// host element, so clicks on the menu itself are not treated as outside.
document.addEventListener(
  "pointerdown",
  (event) => {
    if (!iconShadow.querySelector(".sherlock-menu,.sherlock-prompt")) return;
    if (event.target !== iconHostElement) {
      closeCredentialMenu();
      closeSherlockPrompt();
    }
  },
  true,
);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeCredentialMenu();
    closeSherlockPrompt();
  }
});
window.addEventListener("blur", closeCredentialMenu);
window.addEventListener("scroll", closeCredentialMenu, true);

const MULTI_LEVEL_SUFFIXES = new Set([
  "co.uk",
  "org.uk",
  "ac.uk",
  "gov.uk",
  "com.au",
  "net.au",
  "org.au",
  "co.nz",
  "co.jp",
  "com.br",
  "com.mx",
  "com.es",
  "com.ar",
  "com.co",
  "co.in",
]);

function baseHostname(hostname) {
  const host = String(hostname || "").toLowerCase();
  if (!host || host.includes(":") || /^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    return host;
  }
  const parts = host.split(".");
  if (parts.length <= 2) return host;
  const suffix = parts.slice(-2).join(".");
  return MULTI_LEVEL_SUFFIXES.has(suffix) ? parts.slice(-3).join(".") : suffix;
}

function siteHostname(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const hostname = new URL(
      raw.includes("://") ? raw : `https://${raw}`,
    ).hostname.replace(/^www\./, "");
    return baseHostname(hostname);
  } catch {
    return "";
  }
}

function saveCredentialData({
  site,
  username,
  password,
  forceNew = false,
  successMessage = "Accés desat a SherLock.",
}) {
  return new Promise((resolve) => {
    extensionApi.runtime.sendMessage(
      {
        action: "saveCredentials",
        data: {
          site,
          username,
          password,
          notes: "",
          force_new: Boolean(forceNew),
        },
      },
      (response) => {
        if (extensionApi.runtime.lastError) {
          showToast("No s'ha pogut desar l'accés.");
          resolve(null);
          return;
        }
        if (response?.success) {
          showToast(successMessage);
          resolve(response);
          return;
        }
        showToast(
          response?.error
            ? `No s'ha pogut desar: ${response.error}`
            : "No s'ha pogut desar l'accés.",
        );
        resolve(null);
      },
    );
  });
}

async function selectCredential(field, choice, button) {
  const currentSite = siteHostname(location.hostname);
  const storedSite = siteHostname(choice.site);
  if (storedSite && currentSite && storedSite !== currentSite && button) {
    showActionMenu(button, {
      title: "Accés d'un altre lloc",
      message: `Aquest accés està desat per a ${storedSite}. Vols afegir també ${currentSite} i omplir, o només omplir?`,
      actions: [
        {
          label: "Afegir i omplir",
          primary: true,
          onClick: async () => {
            const credential = await fillSelected(field, choice);
            if (!credential) return;
            await saveCredentialData({
              site: currentSite,
              username: credential.username,
              password: credential.password,
              successMessage: "Accés afegit per a aquest lloc.",
            });
          },
        },
        {
          label: "Només omplir",
          onClick: () => fillSelected(field, choice),
        },
        { label: "Cancel·la" },
      ],
    });
    return;
  }
  await fillSelected(field, choice);
}

function openSaveEntry(site, username) {
  return new Promise((resolve) => {
    extensionApi.runtime.sendMessage(
      { action: "openSaveEntry", site, username },
      (response) => {
        if (extensionApi.runtime.lastError || !response?.success) {
          showToast("No s'ha pogut obrir SherLock.");
          resolve(false);
          return;
        }
        resolve(true);
      },
    );
  });
}

function askCreateNewEntry(field, button) {
  const fields = field.form ? findFormFields(field.form) : findFormFields();
  const usernameEl =
    fields.usernameEl || (field.type !== "password" ? field : null);
  const username = usernameEl ? usernameEl.value.trim() : "";
  const currentSite = siteHostname(location.hostname);
  if (!button) return;
  showActionMenu(button, {
    title: "Cap accés desat",
    message: `No hi ha cap accés per a ${currentSite}. Vols obrir SherLock i crear una entrada nova per a aquest lloc?`,
    actions: [
      {
        label: "Crear entrada",
        primary: true,
        onClick: () => openSaveEntry(currentSite, username),
      },
      { label: "Ara no" },
    ],
  });
}

async function handleSubmittedCredentials(site, username, password) {
  const result = await new Promise((resolve) => {
    extensionApi.runtime.sendMessage(
      {
        action: "sherlockCheckCredential",
        domain: site,
        username,
        password,
      },
      (response) => {
        if (extensionApi.runtime.lastError) {
          resolve(null);
          return;
        }
        resolve(response);
      },
    );
  });

  if (!result?.success) {
    showSavePrompt({ site, username, password });
    return;
  }
  if (result.sameUsername && result.samePassword) {
    showToast("Aquest accés ja està desat.");
    return;
  }
  if (result.sameUsername) {
    showSherlockPrompt({
      title: "Credencials diferents",
      message: `Ja existeix un accés per a ${username || "aquest usuari"} en aquest lloc. Vols actualitzar la contrasenya o crear una entrada nova?`,
      actions: [
        {
          label: "Actualitza",
          primary: true,
          onClick: () =>
            saveCredentialData({
              site,
              username,
              password,
              successMessage: "Accés actualitzat.",
            }),
        },
        {
          label: "Crea'n una de nova",
          onClick: () =>
            saveCredentialData({
              site,
              username,
              password,
              forceNew: true,
              successMessage: "Accés nou creat.",
            }),
        },
        { label: "Cancel·la" },
      ],
    });
    return;
  }
  if (result.hasCredentials) {
    showSherlockPrompt({
      title: "Nou usuari en aquest lloc",
      message: `Aquest lloc ja té accessos desats, però no per a ${username || "aquest usuari"}. Vols crear una entrada nova?`,
      actions: [
        {
          label: "Crear entrada",
          primary: true,
          onClick: () =>
            saveCredentialData({
              site,
              username,
              password,
              forceNew: true,
              successMessage: "Accés nou creat.",
            }),
        },
        { label: "Cancel·la" },
      ],
    });
    return;
  }
  showSavePrompt({ site, username, password });
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
    return result.credential;
  } catch {
    showToast("SherLock està bloquejat. Obre l'app per desbloquejar-lo.");
    return null;
  }
}

function showCredentialMenu(button, field, choices) {
  closeCredentialMenu();
  closeSherlockPrompt();
  const menu = document.createElement("div");
  menu.className = "sherlock-menu";
  menu.setAttribute("role", "menu");
  menu.style.left = "0px";
  menu.style.top = "0px";
  menu.style.visibility = "hidden";
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
      await selectCredential(field, choice, button);
    });
    menu.append(option);
  }
  iconShadow.append(menu);
  positionSherlockMenu(menu, button);
}

function positionSherlockMenu(menu, button) {
  const rect = button.getBoundingClientRect();
  const menuRect = menu.getBoundingClientRect();
  const iconCenter = rect.left + rect.width / 2;
  const left = Math.max(
    8,
    Math.min(
      iconCenter - menuRect.width / 2,
      window.innerWidth - menuRect.width - 8,
    ),
  );
  let top = rect.bottom + 6;
  if (top + menuRect.height > window.innerHeight - 8) {
    top = Math.max(8, rect.top - menuRect.height - 6);
  }
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
  menu.style.visibility = "";
}

function showActionMenu(button, { title, message, actions = [] }) {
  closeCredentialMenu();
  closeSherlockPrompt();
  const menu = document.createElement("div");
  menu.className = "sherlock-menu sherlock-action-menu";
  menu.setAttribute("role", "menu");
  menu.style.left = "0px";
  menu.style.top = "0px";
  menu.style.visibility = "hidden";

  const heading = document.createElement("strong");
  heading.className = "sherlock-menu-title";
  heading.textContent = title;
  const copy = document.createElement("p");
  copy.className = "sherlock-menu-message";
  copy.textContent = message;
  menu.append(heading, copy);

  for (const action of actions) {
    const option = document.createElement("button");
    option.type = "button";
    option.setAttribute("role", "menuitem");
    if (action.primary) option.className = "primary";
    option.textContent = action.label;
    option.addEventListener("click", async () => {
      closeCredentialMenu();
      await action.onClick?.();
    });
    menu.append(option);
  }

  iconShadow.append(menu);
  positionSherlockMenu(menu, button);
}

function createFieldIcon(field) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "sherlock-icon-btn";
  button.setAttribute("aria-label", "Emplenar amb SherLock");
  button.setAttribute("tabindex", "0");
  const img = document.createElement("img");
  img.alt = "";
  img.dataset.sherlockIcon = "true";
  img.src = iconResourceForTheme();
  button.append(img);
  button.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    closeCredentialMenu();
    closeSherlockPrompt();
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
        askCreateNewEntry(field, button);
        return;
      }
      if (choices.length > 1) showCredentialMenu(button, field, choices);
      else await selectCredential(field, choices[0], button);
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
      site: siteHostname(window.location.hostname),
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
        site: siteHostname(window.location.hostname),
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

  const lightPrompt = iconHostElement.dataset.sherlockTheme === "light";
  const injectedSize =
    getComputedStyle(iconHostElement)
      .getPropertyValue("--sherlock-font-size")
      .trim() || "16px";
  prompt.style.setProperty("font-size", injectedSize, "important");
  if (lightPrompt) {
    prompt.style.setProperty("background", "#ffffff", "important");
    prompt.style.setProperty("color", "#172b4d", "important");
    prompt.style.setProperty("border-color", "#d6e2f0", "important");
  }

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
  prompt.querySelectorAll("button").forEach((button) => {
    button.style.setProperty("font-size", injectedSize, "important");
  });
  if (lightPrompt) {
    closeButton.style.setProperty("color", "#5b6b82", "important");
  }

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
          // Use textContent to avoid XSS from server-provided strings.
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

document.addEventListener(
  "submit",
  (event) => {
    if (event && !event.isTrusted) return;
    const form = event.target;
    if (!form || typeof form.querySelectorAll !== "function") return;
    const passwordInputs = Array.from(
      form.querySelectorAll('input[type="password"]'),
    ).filter((el) => el.value && el.value.trim().length > 0);

    if (passwordInputs.length > 0 && !credentialSubmitCheckInFlight) {
      const password = passwordInputs[0].value;
      const usernameInput = form.querySelector(
        'input[type="email"], input[type="text"], input[name*="user" i], input[name*="login" i], input[name*="mail" i]',
      );
      const username = usernameInput ? usernameInput.value.trim() : "";
      credentialSubmitCheckInFlight = true;
      handleSubmittedCredentials(
        siteHostname(window.location.hostname),
        username,
        password,
      ).finally(() => {
        credentialSubmitCheckInFlight = false;
      });
    }
  },
  true,
);
