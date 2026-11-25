// SherLock - Popup Controller
// Implements reactive state, Tauri design system integration, and secure vault communication.

function replacePopupMarkup(element, markup) {
  element.replaceChildren(
    DOMPurify.sanitize(String(markup ?? ""), { RETURN_DOM_FRAGMENT: true }),
  );
}

class PopupController {
  constructor() {
    this.state = {
      connected: false,
      unlocked: false,
      entryCount: 0,
      domain: "",
      activeTabId: null,
      credentials: [],
      searchQuery: "",
      generatedPassword: "",
    };
    this.windowMode =
      new URLSearchParams(window.location.search).get("window") === "1";

    this.init();
  }

  async init() {
    this.setupWindowMode();
    await this.initTheme();
    await this.initFontSize();
    this.setupTabNavigation();
    this.setupEventListeners();
    await this.initPendingSave();
    await this.detectActiveTab();
    await this.checkStatus();
    this.initGenerator();
  }

  setupWindowMode() {
    if (!this.windowMode) return;
    document.body.classList.add("window-mode");
    document.getElementById("detachBtn")?.remove();
  }

  openDetachedWindow() {
    const url = chrome.runtime.getURL("popup.html?window=1");
    const fallback = () => {
      if (chrome.tabs?.create) {
        chrome.tabs.create({ url });
      } else {
        window.open(url, "_blank", "width=560,height=760");
      }
      window.close();
    };

    if (chrome.windows?.create) {
      chrome.windows.create(
        { url, type: "normal", width: 560, height: 760 },
        (created) => {
          if (chrome.runtime.lastError || !created) {
            fallback();
            return;
          }
          window.close();
        },
      );
      return;
    }
    fallback();
  }

  initTheme() {
    // Use the callback form: it is supported by both Chrome and Firefox,
    // whereas Firefox's `chrome.*` namespace does not return a Promise.
    return new Promise((resolve) => {
      chrome.storage.local.get("sherlock_theme", (data) => {
        const theme = (data && data.sherlock_theme) || "auto";
        const select = document.getElementById("themeSelect");
        if (select) select.value = theme;
        this.applyTheme(theme);
        this.themeMedia = window.matchMedia("(prefers-color-scheme: dark)");
        this.themeMedia.addEventListener?.("change", () => {
          if (this.currentTheme === "auto") this.applyTheme("auto");
        });
        resolve();
      });
    });
  }

  applyTheme(theme) {
    this.currentTheme = theme;
    if (theme === "dark") {
      document.documentElement.setAttribute("data-theme", "dark");
    } else if (theme === "light") {
      document.documentElement.setAttribute("data-theme", "light");
    } else {
      document.documentElement.removeAttribute("data-theme");
    }

    const dark =
      theme === "dark" ||
      (theme === "auto" &&
        window.matchMedia("(prefers-color-scheme: dark)").matches);
    try {
      chrome.storage.local.set({
        sherlock_resolved_theme: dark ? "dark" : "light",
      });
    } catch {
      // Storage may be unavailable in a non-extension preview.
    }
    document.querySelectorAll("img.brand-icon").forEach((img) => {
      img.src = chrome.runtime.getURL(
        dark ? "icons/icon128-dark.png" : "icons/icon128.png",
      );
    });
  }

  clampFontSize(value) {
    const size = Number(value);
    if (!Number.isFinite(size)) return 16;
    return Math.min(24, Math.max(14, Math.round(size)));
  }

  initFontSize() {
    return new Promise((resolve) => {
      chrome.storage.local.get("sherlock_font_size", (data) => {
        const size = this.clampFontSize(data && data.sherlock_font_size);
        this.setFontSizeControls(size);
        this.applyFontSize(size);
        resolve();
        this.syncFontSizeFromNative(size);
      });
    });
  }

  setFontSizeControls(size) {
    const slider = document.getElementById("fontSizeSlider");
    const output = document.getElementById("fontSizeVal");
    if (slider) slider.value = String(size);
    if (output) output.textContent = `${size} px`;
  }

  syncFontSizeFromNative(fallbackSize) {
    chrome.runtime.sendMessage({ action: "getUiFontSize" }, (response) => {
      if (chrome.runtime.lastError) return;
      if (!response?.success) {
        if (response?.error === "No font size stored") {
          chrome.runtime.sendMessage({
            action: "setUiFontSize",
            size: this.clampFontSize(fallbackSize),
          });
        }
        return;
      }
      const size = this.clampFontSize(response.size);
      this.setFontSizeControls(size);
      this.applyFontSize(size);
      chrome.storage.local.set({ sherlock_font_size: size });
    });
  }

  applyFontSize(size) {
    const clamped = this.clampFontSize(size);
    document.documentElement.style.fontSize = `${clamped}px`;
  }

  setupTabNavigation() {
    const tabs = document.querySelectorAll(".tab-btn");
    tabs.forEach((btn) => {
      btn.addEventListener("click", () => {
        const targetTab = btn.getAttribute("data-tab");
        this.switchTab(targetTab);
      });
    });
  }

  initPendingSave() {
    return new Promise((resolve) => {
      chrome.storage.local.get("sherlock_pending_save", (data) => {
        const pending = data && data.sherlock_pending_save;
        if (!pending || !pending.site) {
          resolve();
          return;
        }
        chrome.storage.local.remove("sherlock_pending_save");
        if (Date.now() - Number(pending.createdAt || 0) > 60_000) {
          resolve();
          return;
        }
        this.switchTab("save");
        const site = document.getElementById("saveSite");
        const username = document.getElementById("saveUser");
        const password = document.getElementById("savePass");
        if (site) site.value = pending.site;
        if (username) username.value = pending.username || "";
        if (password) setTimeout(() => password.focus(), 0);
        resolve();
      });
    });
  }

  switchTab(tabId) {
    document.querySelectorAll(".tab-btn").forEach((b) => {
      b.classList.toggle("active", b.getAttribute("data-tab") === tabId);
    });

    document.querySelectorAll(".tab-content").forEach((c) => {
      c.classList.toggle("active", c.id === `tab-${tabId}`);
    });

    if (tabId === "vault") {
      this.refreshCredentials();
    }
    if (tabId === "generator" && !this.state.generatedPassword) {
      this.runGenerator();
    }
  }

  async detectActiveTab() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: "getActiveTab" }, (res) => {
        const banner = document.getElementById("domainBanner");
        const nameEl = document.getElementById("domainName");
        if (res && res.hostname) {
          this.state.domain = this.baseHost(res.hostname);
          this.state.activeTabId = res.id;
          if (banner && nameEl) {
            nameEl.textContent = this.baseHost(res.hostname);
            banner.style.display = "flex";
          }
          const saveSiteInput = document.getElementById("saveSite");
          if (saveSiteInput && !saveSiteInput.value) {
            saveSiteInput.value = res.hostname;
          }
        } else {
          this.state.domain = "";
          this.state.activeTabId = null;
          if (banner) banner.style.display = "none";
        }
        resolve();
      });
    });
  }

  async checkStatus() {
    if (this._unlockPollTimer) {
      clearInterval(this._unlockPollTimer);
      this._unlockPollTimer = null;
    }
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: "getVaultInfo" }, async (res) => {
        const pill = document.getElementById("statusPill");
        const statusText = document.getElementById("statusText");
        const lockBtn = document.getElementById("lockBtn");

        if (res && res.connected && res.paired === false) {
          this.state.connected = true;
          this.state.unlocked = false;
          this.state.entryCount = 0;
          pill.className = "status-pill locked";
          statusText.textContent = "No vinculat";
          if (lockBtn) lockBtn.style.display = "none";
          this.renderPairRequiredState();
        } else if (res && res.connected) {
          this.state.connected = true;
          this.state.unlocked = res.unlocked;
          this.state.entryCount = res.entryCount || 0;

          if (res.unlocked) {
            pill.className = "status-pill connected";
            statusText.textContent = "Connectat";
            if (lockBtn) lockBtn.style.display = "grid";
            await this.refreshCredentials();
          } else {
            pill.className = "status-pill locked";
            statusText.textContent = "Bloquejat";
            if (lockBtn) lockBtn.style.display = "none";
            this.renderLockedState();
          }
        } else {
          this.state.connected = false;
          this.state.unlocked = false;
          pill.className = "status-pill disconnected";
          statusText.textContent = "Desconnectat";
          if (lockBtn) lockBtn.style.display = "none";
          this.renderDisconnectedState();
        }
        resolve();
      });
    });
  }

  async refreshCredentials() {
    if (!this.state.connected || !this.state.unlocked) return;

    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: "listCredentials" }, (res) => {
        if (res && res.success) {
          this.state.credentials = res.credentials || [];
          this.renderCredentialsList();
        } else if (res && res.unlocked === false) {
          this.state.unlocked = false;
          this.checkStatus();
        } else if (/no està vinculat|not paired/i.test(res?.error || "")) {
          this.renderPairRequiredState();
        }
        resolve();
      });
    });
  }

  renderDisconnectedState() {
    const searchSection = document.getElementById("searchSection");
    if (searchSection) searchSection.style.display = "none";

    const container = document.getElementById("vaultContent");
    replacePopupMarkup(
      container,
      `
      <div class="state-box">
        <div class="state-icon red">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="2" y="2" width="20" height="8" rx="2" ry="2"></rect>
            <rect x="2" y="14" width="20" height="8" rx="2" ry="2"></rect>
            <line x1="6" y1="6" x2="6.01" y2="6"></line>
            <line x1="6" y1="18" x2="6.01" y2="18"></line>
          </svg>
        </div>
        <h3 class="state-title">SherLock no detectada</h3>
        <p class="state-desc">Obre l'aplicació d'escriptori SherLock al teu ordinador per connectar-hi.</p>
        <button id="retryConnectBtn" class="btn btn-primary" style="margin-top: 6px;">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"></path>
          </svg>
          Reintentar connexió
        </button>
      </div>
    `,
    );

    document
      .getElementById("retryConnectBtn")
      ?.addEventListener("click", () => {
        this.showToast("Comprovant connexió...");
        this.checkStatus();
      });
  }

  renderLockedState() {
    // The master password must NOT travel through the extension.
    // The popup instructs the user to unlock from the desktop app; it polls
    // getVaultInfo to detect when the vault has been unlocked.
    const searchSection = document.getElementById("searchSection");
    if (searchSection) searchSection.style.display = "none";

    const container = document.getElementById("vaultContent");
    replacePopupMarkup(
      container,
      `
      <div class="state-box">
        <div class="state-icon amber">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
          </svg>
        </div>
        <h3 class="state-title">SherLock bloquejat</h3>
        <p class="state-desc">Desbloqueja l'aplicació SherLock per accedir als teus accessos.</p>
        <button type="button" id="retryUnlockBtn" class="btn btn-secondary" style="margin-top: 8px;">
          Comprovar de nou
        </button>
      </div>
    `,
    );

    // Poll every 3 seconds so the popup updates automatically once the user
    // unlocks from the desktop app.
    const retryBtn = document.getElementById("retryUnlockBtn");
    retryBtn?.addEventListener("click", () => this.checkStatus());

    this._unlockPollTimer = setInterval(() => {
      this.checkStatus();
    }, 3000);
  }

  renderPairRequiredState() {
    const searchSection = document.getElementById("searchSection");
    if (searchSection) searchSection.style.display = "none";
    const container = document.getElementById("vaultContent");
    replacePopupMarkup(
      container,
      `
      <div class="state-box">
        <div class="state-icon amber">${this.iconSvg("KeyRound", 24)}</div>
        <h3 class="state-title">Vincula aquest navegador</h3>
        <p class="state-desc">Per protegir la caixa, cada navegador s'ha d'aprovar des de l'app SherLock.</p>
        <button id="openPairSettingsBtn" class="btn btn-primary" style="margin-top: 6px">Obrir vinculació</button>
      </div>
    `,
    );
    document
      .getElementById("openPairSettingsBtn")
      ?.addEventListener("click", () => {
        this.switchTab("settings");
      });
  }

  iconSvg(name, size = 16) {
    const paths = {
      KeyRound:
        '<circle cx="7.5" cy="15.5" r="5.5"></circle><path d="m21 2-9.6 9.6"></path><path d="m15.5 7.5 3 3L22 7l-3-3"></path>',
      Globe:
        '<circle cx="12" cy="12" r="10"></circle><path d="M2 12h20"></path><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10Z"></path>',
      Eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z"></path><circle cx="12" cy="12" r="3"></circle>',
      EyeOff:
        '<path d="m3 3 18 18"></path><path d="M10.6 10.6a2 2 0 0 0 2.8 2.8"></path><path d="M9.9 5.2A11 11 0 0 1 12 5c6.4 0 10 7 10 7a14 14 0 0 1-3.2 3.9"></path><path d="M6.6 6.6C3.7 8.3 2 12 2 12s3.6 7 10 7a10 10 0 0 0 3.2-.5"></path>',
      UserRound:
        '<circle cx="12" cy="8" r="5"></circle><path d="M20 21a8 8 0 0 0-16 0"></path>',
      Copy: '<rect x="8" y="8" width="14" height="14" rx="2"></rect><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"></path>',
      Pencil:
        '<path d="M12 20h9"></path><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"></path>',
      Sparkles:
        '<path d="m12 3 1.9 5.8L20 11l-6.1 2.2L12 19l-1.9-5.8L4 11l6.1-2.2L12 3Z"></path><path d="m19 14 1.1 2.9L23 18l-2.9 1.1L19 22l-1.1-2.9L15 18l2.9-1.1L19 14Z"></path>',
    };
    return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || ""}</svg>`;
  }

  renderCredentialsList() {
    this.closeCopyMenu();
    const searchSection = document.getElementById("searchSection");
    if (searchSection) searchSection.style.display = "block";

    const container = document.getElementById("vaultContent");
    const query = (this.state.searchQuery || "").trim().toLowerCase();
    const currentDomain = this.baseHost(this.state.domain);

    let matched = [];
    let others = [];

    this.state.credentials.forEach((cred) => {
      const site = this.baseHost(cred.site);
      const user = (cred.username || "").toLowerCase();

      if (query) {
        if (site.includes(query) || user.includes(query)) {
          matched.push(cred);
        }
      } else {
        if (currentDomain && this.hostMatches(site, currentDomain)) {
          matched.push(cred);
        } else {
          others.push(cred);
        }
      }
    });

    if (query) {
      if (matched.length === 0) {
        replacePopupMarkup(
          container,
          `
          <div class="state-box"><p class="state-desc">Cap resultat per a "${this.escapeHtml(this.state.searchQuery)}"</p></div>
        `,
        );
      } else {
        replacePopupMarkup(
          container,
          `
          <div class="credential-section">
            <h3 class="credential-section-title">Resultats (${matched.length})</h3>
            <div class="cred-list">${matched.map((c) => this.renderCredCard(c)).join("")}</div>
          </div>
        `,
        );
      }
    } else {
      const currentHeading = currentDomain
        ? `Entrades guardades per a ${this.escapeHtml(this.state.domain)}`
        : "Entrades guardades per a aquesta pàgina";
      const currentSection = matched.length
        ? `<section class="credential-section"><h3 class="credential-section-title">${currentHeading}</h3><div class="cred-list">${matched.map((c) => this.renderCredCard(c)).join("")}</div></section>`
        : `<section class="credential-section"><h3 class="credential-section-title">${currentHeading}</h3><p class="credential-empty">No hi ha cap entrada desada per a aquesta pàgina.</p><button id="quickSaveForSiteBtn" class="btn btn-secondary">+ Desar accés d'aquest lloc</button></section>`;
      const othersSection = others.length
        ? `<section class="credential-section"><h3 class="credential-section-title">Altres entrades (${others.length})</h3><div class="cred-list">${others.map((c) => this.renderCredCard(c)).join("")}</div></section>`
        : "";
      replacePopupMarkup(container, `${currentSection}${othersSection}`);
      document
        .getElementById("quickSaveForSiteBtn")
        ?.addEventListener("click", () => {
          this.switchTab("save");
        });
    }

    this.attachCardActions();
  }

  normalizeHost(value = "") {
    const input = String(value).trim().toLowerCase();
    if (!input) return "";
    try {
      return new URL(
        input.includes("://") ? input : `https://${input}`,
      ).hostname.replace(/^www\./, "");
    } catch {
      return input.replace(/^www\./, "").split(/[/:]/, 1)[0];
    }
  }

  baseHost(value = "") {
    const host = this.normalizeHost(value);
    if (!host || host.includes(":") || /^\d+\.\d+\.\d+\.\d+$/.test(host)) {
      return host;
    }
    const suffixes = new Set([
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
    const parts = host.split(".");
    if (parts.length <= 2) return host;
    const suffix = parts.slice(-2).join(".");
    return suffixes.has(suffix) ? parts.slice(-3).join(".") : suffix;
  }

  hostMatches(savedHost, activeHost) {
    return Boolean(
      savedHost &&
      activeHost &&
      (savedHost === activeHost || activeHost.endsWith(`.${savedHost}`)),
    );
  }

  renderCredCard(cred) {
    const domainIcon = this.iconSvg("Globe", 18);
    return `
      <div class="cred-card" data-id="${this.escapeHtml(cred.id)}">
        <div class="cred-header">
          <div class="cred-icon">${domainIcon}</div>
          <div class="cred-info">
            <div class="cred-title" title="${this.escapeHtml(this.baseHost(cred.site))}">${this.escapeHtml(this.baseHost(cred.site))}</div>
            <div class="cred-user" title="${this.escapeHtml(cred.username)}">${this.escapeHtml(cred.username || "Sense usuari")}</div>
          </div>
          <button class="btn btn-secondary action-edit" data-id="${this.escapeHtml(cred.id)}" title="Editar entrada">
            ${this.iconSvg("Pencil", 14)}
          </button>
          <button class="btn btn-secondary action-copy" data-id="${this.escapeHtml(cred.id)}" title="Copiar">
            ${this.iconSvg("Copy", 14)}
          </button>
        </div>
        <div class="cred-actions">
          <button class="btn btn-primary action-fill" data-id="${this.escapeHtml(cred.id)}">
            ${this.iconSvg("Sparkles", 14)}
            Omplir formulari
          </button>
        </div>
      </div>
    `;
  }

  attachCardActions() {
    document.querySelectorAll(".action-edit").forEach((btn) => {
      btn.addEventListener("click", (event) => {
        event.stopPropagation();
        const credential = this.state.credentials.find(
          (item) => item.id === btn.getAttribute("data-id"),
        );
        if (credential) this.showEditCredential(credential);
      });
    });

    document.querySelectorAll(".action-copy").forEach((btn) => {
      btn.addEventListener("click", (event) => {
        event.stopPropagation();
        const credential = this.state.credentials.find(
          (item) => item.id === btn.getAttribute("data-id"),
        );
        if (credential) this.showCopyMenu(btn, credential);
      });
    });

    document.querySelectorAll(".cred-card").forEach((card) => {
      card.addEventListener("click", (event) => {
        if (event.target.closest("button")) return;
        const credential = this.state.credentials.find(
          (item) => item.id === card.getAttribute("data-id"),
        );
        if (credential) this.showCredentialDetails(credential);
      });
    });

    document.querySelectorAll(".action-fill").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-id");
        const cred = this.state.credentials.find((c) => c.id === id);
        if (!cred) return;
        if (!this.state.domain) {
          this.showToast("Obre una pestanya web per omplir les dades");
          return;
        }
        if (this.baseHost(cred.site) !== this.baseHost(this.state.domain)) {
          this.showFillChoice(cred);
        } else {
          this.fillCredential(cred);
        }
      });
    });
  }

  fillCredential(credential, addCurrentSite = false) {
    this.loadCredential(credential).then((full) => {
      if (!full) {
        this.showToast("No s'ha pogut obtenir aquesta entrada");
        return;
      }
      if (addCurrentSite) {
        this.saveCredentialForCurrentSite(full).then((saved) => {
          if (saved) this.refreshCredentials();
          this.autofillCredential(full);
        });
        return;
      }
      this.autofillCredential(full);
    });
  }

  saveCredentialForCurrentSite(credential) {
    return new Promise((resolve) => {
      const site = this.baseHost(this.state.domain);
      chrome.runtime.sendMessage(
        {
          action: "saveCredentials",
          data: {
            site,
            username: credential.username || "",
            password: credential.password || "",
            notes: "",
            force_new: false,
          },
        },
        (response) => {
          if (chrome.runtime.lastError || !response?.success) {
            this.showToast(
              response?.error
                ? `No s'ha pogut afegir el lloc: ${response.error}`
                : "No s'ha pogut afegir el lloc",
            );
            resolve(false);
            return;
          }
          this.showToast("Accés afegit per a aquest lloc");
          resolve(true);
        },
      );
    });
  }

  showFillChoice(credential) {
    document.getElementById("fillPrompt")?.remove();
    const overlay = document.createElement("div");
    overlay.id = "fillPrompt";
    overlay.className = "fill-prompt";
    const card = document.createElement("div");
    card.className = "fill-prompt-card";
    const title = document.createElement("h3");
    title.textContent = "Afegir aquest lloc?";
    const message = document.createElement("p");
    message.textContent = `Aquest accés està desat per a ${this.baseHost(credential.site)}. Vols afegir també ${this.baseHost(this.state.domain)} i omplir, o només omplir?`;
    const actions = document.createElement("div");
    actions.className = "fill-prompt-actions";

    const close = () => {
      overlay.remove();
      document.removeEventListener("keydown", onKeyDown);
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("keydown", onKeyDown);

    const addButton = document.createElement("button");
    addButton.type = "button";
    addButton.className = "btn btn-primary";
    addButton.textContent = "Afegir i omplir";
    addButton.addEventListener("click", () => {
      close();
      this.fillCredential(credential, true);
    });

    const fillButton = document.createElement("button");
    fillButton.type = "button";
    fillButton.className = "btn btn-secondary";
    fillButton.textContent = "Només omplir";
    fillButton.addEventListener("click", () => {
      close();
      this.fillCredential(credential);
    });

    const cancelButton = document.createElement("button");
    cancelButton.type = "button";
    cancelButton.className = "btn btn-secondary";
    cancelButton.textContent = "Cancel·la";
    cancelButton.addEventListener("click", close);

    actions.append(addButton, fillButton, cancelButton);
    card.append(title, message, actions);
    overlay.append(card);
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) close();
    });
    document.body.append(overlay);
    addButton.focus();
  }

  closeCopyMenu() {
    if (this._copyMenuClose) this._copyMenuClose();
  }

  showCopyMenu(button, credential) {
    this.closeCopyMenu();
    const menu = document.createElement("div");
    menu.id = "sherlock-copy-menu";
    menu.className = "copy-menu";
    const copyUser = document.createElement("button");
    copyUser.type = "button";
    copyUser.textContent = "Copiar usuari";
    const copyPass = document.createElement("button");
    copyPass.type = "button";
    copyPass.textContent = "Copiar contrasenya";
    menu.append(copyUser, copyPass);

    const close = () => {
      menu.remove();
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      this._copyMenuClose = null;
    };
    const onPointerDown = (event) => {
      if (!menu.contains(event.target)) close();
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") close();
    };
    this._copyMenuClose = close;

    const rect = button.getBoundingClientRect();
    const width = 190;
    const left = Math.max(
      8,
      Math.min(rect.right - width, window.innerWidth - width - 8),
    );
    menu.style.left = `${left}px`;
    menu.style.top = `${rect.bottom + 6}px`;
    document.body.append(menu);
    const menuRect = menu.getBoundingClientRect();
    if (menuRect.bottom > window.innerHeight - 8) {
      menu.style.top = `${Math.max(8, rect.top - menuRect.height - 6)}px`;
    }

    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);

    copyUser.addEventListener("click", () => {
      close();
      if (credential.username) {
        navigator.clipboard.writeText(credential.username);
        this.showToast("Usuari copiat!");
      }
    });
    copyPass.addEventListener("click", () => {
      close();
      this.loadCredential(credential).then((full) => {
        if (!full?.password) {
          this.showToast("No s'ha pogut obtenir la contrasenya");
          return;
        }
        navigator.clipboard.writeText(full.password);
        this.showToast("Contrasenya copiada!");
      });
    });
  }

  async showCredentialDetails(credential) {
    const full = await this.loadCredential(credential);
    if (!full) {
      this.showToast("No s'ha pogut obtenir aquesta entrada");
      return;
    }

    const overlay = document.createElement("div");
    overlay.id = "credDetailsPrompt";
    overlay.className = "fill-prompt";
    const card = document.createElement("div");
    card.className = "fill-prompt-card cred-details-card";
    const title = document.createElement("h3");
    title.textContent = this.baseHost(full.site);
    const list = document.createElement("div");
    list.className = "cred-details-list";

    const addRow = (label, value) => {
      const row = document.createElement("div");
      row.className = "cred-details-row";
      const name = document.createElement("span");
      name.className = "cred-details-label";
      name.textContent = label;
      const content = document.createElement("span");
      content.className = "cred-details-value";
      content.textContent = value || "—";
      row.append(name, content);
      list.append(row);
      return content;
    };

    addRow("Lloc web", this.baseHost(full.site));
    addRow("Usuari", full.username || "Sense usuari");
    const passwordValue = addRow("Contrasenya", "••••••••");
    const passwordRow = list.lastElementChild;
    passwordRow.classList.add("cred-details-password");
    let passwordVisible = false;
    passwordValue.dataset.visible = "false";
    const togglePassword = document.createElement("button");
    togglePassword.type = "button";
    togglePassword.className = "btn btn-secondary cred-details-eye";
    togglePassword.title = "Mostrar contrasenya";
    togglePassword.innerHTML = this.iconSvg("Eye", 14);
    togglePassword.addEventListener("click", () => {
      passwordVisible = !passwordVisible;
      passwordValue.textContent = passwordVisible ? full.password : "••••••••";
      passwordValue.dataset.visible = String(passwordVisible);
      togglePassword.innerHTML = this.iconSvg(
        passwordVisible ? "EyeOff" : "Eye",
        14,
      );
      togglePassword.title = passwordVisible
        ? "Amagar contrasenya"
        : "Mostrar contrasenya";
    });
    passwordRow.append(togglePassword);
    addRow("Notes", full.notes || "Sense notes");

    const actions = document.createElement("div");
    actions.className = "cred-details-actions";
    const copyUser = document.createElement("button");
    copyUser.type = "button";
    copyUser.className = "btn btn-secondary";
    copyUser.textContent = "Copiar usuari";
    copyUser.addEventListener("click", () => {
      navigator.clipboard.writeText(full.username || "");
      this.showToast("Usuari copiat!");
    });
    const copyPass = document.createElement("button");
    copyPass.type = "button";
    copyPass.className = "btn btn-secondary";
    copyPass.textContent = "Copiar contrasenya";
    copyPass.addEventListener("click", () => {
      navigator.clipboard.writeText(full.password || "");
      this.showToast("Contrasenya copiada!");
    });
    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "btn btn-primary";
    edit.textContent = "Editar";
    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "btn btn-danger";
    deleteButton.textContent = "Eliminar";
    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.className = "btn btn-secondary cred-details-close";
    closeButton.textContent = "Tancar";
    actions.append(copyUser, copyPass, edit, deleteButton, closeButton);

    const close = () => {
      overlay.remove();
      document.removeEventListener("keydown", onKeyDown);
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("keydown", onKeyDown);
    closeButton.addEventListener("click", close);
    edit.addEventListener("click", () => {
      close();
      this.showEditCredential(full);
    });
    deleteButton.addEventListener("click", () => {
      close();
      this.confirmDeleteCredential(full);
    });
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) close();
    });

    card.append(title, list, actions);
    overlay.append(card);
    document.body.append(overlay);
  }

  confirmDeleteCredential(credential) {
    const overlay = document.createElement("div");
    overlay.id = "credDeletePrompt";
    overlay.className = "fill-prompt";
    const card = document.createElement("div");
    card.className = "fill-prompt-card";
    const title = document.createElement("h3");
    title.textContent = "Eliminar entrada?";
    const message = document.createElement("p");
    message.textContent = `Vols eliminar l'accés de ${this.baseHost(credential.site)} (${credential.username || "sense usuari"})? Aquesta acció no es pot desfer.`;
    const actions = document.createElement("div");
    actions.className = "fill-prompt-actions";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "btn btn-secondary";
    cancel.textContent = "Cancel·la";
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "btn btn-danger";
    remove.textContent = "Eliminar";
    actions.append(cancel, remove);

    const close = () => {
      overlay.remove();
      document.removeEventListener("keydown", onKeyDown);
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("keydown", onKeyDown);
    cancel.addEventListener("click", close);
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) close();
    });
    remove.addEventListener("click", () => {
      remove.disabled = true;
      chrome.runtime.sendMessage(
        { action: "deleteCredential", id: credential.id },
        (response) => {
          if (chrome.runtime.lastError || !response?.success) {
            remove.disabled = false;
            this.showToast(
              response?.error
                ? `No s'ha pogut eliminar: ${response.error}`
                : "No s'ha pogut eliminar l'entrada",
            );
            return;
          }
          close();
          this.refreshCredentials();
          this.showToast("Entrada eliminada");
        },
      );
    });

    card.append(title, message, actions);
    overlay.append(card);
    document.body.append(overlay);
    cancel.focus();
  }

  async showEditCredential(credential) {
    const full = await this.loadCredential(credential);
    if (!full) {
      this.showToast("No s'ha pogut obtenir aquesta entrada");
      return;
    }

    const overlay = document.createElement("div");
    overlay.id = "credEditPrompt";
    overlay.className = "fill-prompt";
    const card = document.createElement("div");
    card.className = "fill-prompt-card";
    const title = document.createElement("h3");
    title.textContent = "Editar entrada";

    const form = document.createElement("div");
    form.className = "cred-edit-form";
    const createField = (labelText, value, type = "text") => {
      const label = document.createElement("label");
      label.className = "form-label";
      label.textContent = labelText;
      const input = document.createElement("input");
      input.className = "form-control";
      input.type = type;
      input.value = value || "";
      form.append(label, input);
      return input;
    };
    const siteInput = createField("Lloc web", full.site);
    const userInput = createField("Usuari", full.username);
    const passInput = createField("Contrasenya", full.password, "password");
    const notesLabel = document.createElement("label");
    notesLabel.className = "form-label";
    notesLabel.textContent = "Notes";
    const notesInput = document.createElement("textarea");
    notesInput.className = "form-control";
    notesInput.rows = 3;
    notesInput.value = full.notes || "";
    form.append(notesLabel, notesInput);

    const actions = document.createElement("div");
    actions.className = "fill-prompt-actions";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "btn btn-secondary";
    cancel.textContent = "Cancel·la";
    const save = document.createElement("button");
    save.type = "button";
    save.className = "btn btn-primary";
    save.textContent = "Desar canvis";
    actions.append(cancel, save);

    const close = () => {
      overlay.remove();
      document.removeEventListener("keydown", onKeyDown);
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("keydown", onKeyDown);
    cancel.addEventListener("click", close);
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) close();
    });

    save.addEventListener("click", () => {
      const site = siteInput.value.trim();
      const username = userInput.value.trim();
      const password = passInput.value;
      const notes = notesInput.value;
      if (!site || !password) {
        this.showToast("El lloc i la contrasenya són obligatoris");
        return;
      }
      save.disabled = true;
      chrome.runtime.sendMessage(
        {
          action: "saveCredentials",
          data: {
            id: full.id,
            site,
            username,
            password,
            notes,
            force_new: false,
          },
        },
        (response) => {
          save.disabled = false;
          if (chrome.runtime.lastError || !response?.success) {
            this.showToast(
              response?.error
                ? `No s'ha pogut desar: ${response.error}`
                : "No s'ha pogut desar l'entrada",
            );
            return;
          }
          close();
          this.refreshCredentials();
          this.showToast("Entrada actualitzada");
        },
      );
    });

    card.append(title, form, actions);
    overlay.append(card);
    document.body.append(overlay);
    siteInput.focus();
  }

  loadCredential(credential, domain = credential.site) {
    return new Promise((resolve) =>
      chrome.runtime.sendMessage(
        { action: "fetchCredentials", site: this.normalizeHost(domain) },
        (res) =>
          resolve(
            res?.success
              ? (res.credentials || []).find(
                  (item) => item.id === credential.id,
                )
              : null,
          ),
      ),
    );
  }

  autofillCredential(credential) {
    if (!this.state.activeTabId) {
      this.showToast("Obre una pestanya web per omplir les dades");
      return;
    }

    chrome.tabs.sendMessage(
      this.state.activeTabId,
      { action: "autofillLogin", credential },
      { frameId: 0 },
      (res) => {
        if (chrome.runtime.lastError || !res || !res.success) {
          this.showToast(res?.error || "No s'ha pogut omplir el formulari");
        } else {
          this.showToast("Dades d'accés omplertes!");
        }
      },
    );
  }

  initGenerator() {
    const slider = document.getElementById("lengthSlider");
    const lengthVal = document.getElementById("lengthVal");

    slider?.addEventListener("input", (e) => {
      if (lengthVal) lengthVal.textContent = e.target.value;
      this.runGenerator();
    });

    ["chkUpper", "chkLower", "chkNumbers", "chkSymbols"].forEach((id) => {
      document.getElementById(id)?.addEventListener("change", () => {
        this.syncGeneratorMinimums();
        this.runGenerator();
      });
    });

    ["minNumbersInput", "minSymbolsInput"].forEach((id) => {
      document.getElementById(id)?.addEventListener("input", () => {
        this.runGenerator();
      });
      document.getElementById(id)?.addEventListener("change", (e) => {
        e.target.value = String(
          Math.min(20, Math.max(0, parseInt(e.target.value, 10) || 0)),
        );
        this.runGenerator();
      });
    });

    document
      .getElementById("regenBtn")
      ?.addEventListener("click", () => this.runGenerator());
    document
      .getElementById("copyGenBtn")
      ?.addEventListener("click", () => this.copyGenerated());

    document.getElementById("saveGenAction")?.addEventListener("click", () => {
      if (!this.state.generatedPassword) return;
      const savePassInput = document.getElementById("savePass");
      if (savePassInput) {
        savePassInput.value = this.state.generatedPassword;
      }
      const saveSiteInput = document.getElementById("saveSite");
      if (saveSiteInput && !saveSiteInput.value && this.state.domain) {
        saveSiteInput.value = this.state.domain;
      }
      this.switchTab("save");
      this.showToast("Contrasenya llista per desar!");
      if (saveSiteInput && saveSiteInput.value) {
        document.getElementById("saveUser")?.focus();
      } else {
        saveSiteInput?.focus();
      }
    });

    this.syncGeneratorMinimums();
    this.runGenerator();
  }

  syncGeneratorMinimums() {
    const numbers = document.getElementById("chkNumbers")?.checked ?? true;
    const symbols = document.getElementById("chkSymbols")?.checked ?? true;
    const minNumbers = document.getElementById("minNumbersInput");
    const minSymbols = document.getElementById("minSymbolsInput");
    if (minNumbers) minNumbers.disabled = !numbers;
    if (minSymbols) minSymbols.disabled = !symbols;
  }

  readGeneratorOptions() {
    const slider = document.getElementById("lengthSlider");
    const lengthVal = document.getElementById("lengthVal");
    const uppercase = document.getElementById("chkUpper")?.checked ?? true;
    const lowercase = document.getElementById("chkLower")?.checked ?? true;
    const numbers = document.getElementById("chkNumbers")?.checked ?? true;
    const symbols = document.getElementById("chkSymbols")?.checked ?? true;
    let length = Math.min(
      64,
      Math.max(8, parseInt(slider?.value || "18", 10) || 18),
    );
    const minNumbers = numbers
      ? Math.min(
          20,
          Math.max(
            0,
            parseInt(document.getElementById("minNumbersInput")?.value, 10) ||
              0,
          ),
        )
      : 0;
    const minSymbols = symbols
      ? Math.min(
          20,
          Math.max(
            0,
            parseInt(document.getElementById("minSymbolsInput")?.value, 10) ||
              0,
          ),
        )
      : 0;

    const minimumLength = Math.max(8, minNumbers + minSymbols);
    if (length < minimumLength) {
      length = minimumLength;
      if (slider) slider.value = String(length);
      if (lengthVal) lengthVal.textContent = String(length);
    }

    return {
      length,
      uppercase,
      lowercase,
      numbers,
      symbols,
      minNumbers,
      minSymbols,
      selected: uppercase || lowercase || numbers || symbols,
    };
  }

  randomInt(max) {
    const cryptoObject = globalThis.crypto;
    const limit = Math.floor(0x100000000 / max) * max;
    const buffer = new Uint32Array(1);
    do {
      cryptoObject.getRandomValues(buffer);
    } while (buffer[0] >= limit);
    return buffer[0] % max;
  }

  generatePasswordLocal(options) {
    const pools = [];
    if (options.uppercase) pools.push("ABCDEFGHIJKLMNOPQRSTUVWXYZ");
    if (options.lowercase) pools.push("abcdefghijklmnopqrstuvwxyz");
    if (options.numbers) pools.push("0123456789");
    if (options.symbols) pools.push("!@#$%^&*()_+-=[]{}|;:,.<>?");
    if (!pools.length) return "";

    const numbersPool = "0123456789";
    const symbolsPool = "!@#$%^&*()_+-=[]{}|;:,.<>?";
    const all = pools.join("");
    const characters = [];

    for (let index = 0; index < options.minNumbers; index += 1) {
      characters.push(numbersPool[this.randomInt(numbersPool.length)]);
    }
    for (let index = 0; index < options.minSymbols; index += 1) {
      characters.push(symbolsPool[this.randomInt(symbolsPool.length)]);
    }
    while (characters.length < options.length) {
      characters.push(all[this.randomInt(all.length)]);
    }
    for (let index = characters.length - 1; index > 0; index -= 1) {
      const swapIndex = this.randomInt(index + 1);
      [characters[index], characters[swapIndex]] = [
        characters[swapIndex],
        characters[index],
      ];
    }
    return characters.slice(0, options.length).join("");
  }

  renderGeneratedPassword(password) {
    const output = document.getElementById("genOutput");
    if (!output) return;
    const fragment = document.createDocumentFragment();
    for (const character of password) {
      const span = document.createElement("span");
      span.textContent = character;
      if (/[0-9]/.test(character)) {
        span.className = "gen-number";
      } else if (/[^A-Za-z0-9]/.test(character)) {
        span.className = "gen-symbol";
      }
      fragment.append(span);
    }
    output.replaceChildren(fragment);
  }

  clearGeneratedPassword() {
    this.state.generatedPassword = "";
    const outputEl = document.getElementById("genOutput");
    if (outputEl) outputEl.textContent = "La contrasenya apareixerà aquí";
    const strengthBar = document.getElementById("strengthBar");
    if (strengthBar) {
      strengthBar.style.width = "0%";
      strengthBar.style.background = "var(--border-subtle)";
    }
    const strengthLabel = document.getElementById("strengthLabel");
    if (strengthLabel) {
      strengthLabel.textContent = "Encara no s'ha generat";
      strengthLabel.style.color = "var(--text-muted)";
    }
    ["regenBtn", "copyGenBtn", "saveGenAction"].forEach((id) => {
      const button = document.getElementById(id);
      if (button) button.disabled = true;
    });
  }

  runGenerator() {
    const options = this.readGeneratorOptions();
    if (!options.selected) {
      this.clearGeneratedPassword();
      this.showToast("Marca almenys una opció de caràcters");
      return;
    }

    const password = this.generatePasswordLocal(options);
    if (!password) {
      this.clearGeneratedPassword();
      return;
    }

    this.state.generatedPassword = password;
    this.renderGeneratedPassword(password);
    this.updateStrength(password);
    ["regenBtn", "copyGenBtn", "saveGenAction"].forEach((id) => {
      const button = document.getElementById(id);
      if (button) button.disabled = false;
    });
  }

  updateStrength(password) {
    let score = 0;
    if (password.length >= 12) score += 25;
    if (password.length >= 16) score += 25;
    if (/[A-Z]/.test(password)) score += 15;
    if (/[0-9]/.test(password)) score += 15;
    if (/[^A-Za-z0-9]/.test(password)) score += 20;

    const bar = document.getElementById("strengthBar");
    const label = document.getElementById("strengthLabel");

    let text = "Molt feble";
    let color = "#ef4444";

    if (score >= 85) {
      text = "Molt forta";
      color = "#22c55e";
    } else if (score >= 65) {
      text = "Forta";
      color = "#10b981";
    } else if (score >= 45) {
      text = "Bona";
      color = "#f59e0b";
    } else if (score >= 25) {
      text = "Feble";
      color = "#f97316";
    }

    if (bar) {
      bar.style.width = `${Math.min(100, Math.max(10, score))}%`;
      bar.style.background = color;
    }
    if (label) {
      label.textContent = text;
      label.style.color = color;
    }
  }

  copyGenerated() {
    if (!this.state.generatedPassword) return;
    navigator.clipboard.writeText(this.state.generatedPassword);
    this.showToast("Contrasenya copiada!");
  }

  setupEventListeners() {
    document.getElementById("pairBrowserBtn")?.addEventListener("click", () => {
      const input = document.getElementById("pairingCodeInput");
      const code = (input?.value || "").trim();
      if (!/^\d{6}$/.test(code))
        return this.showToast("Introdueix el codi de sis xifres");
      chrome.runtime.sendMessage({ action: "pairBrowser", code }, (res) => {
        if (res?.success) {
          if (input) input.value = "";
          this.showToast("Navegador vinculat correctament");
          this.checkStatus();
        } else
          this.showToast(res?.error || "No s'ha pogut vincular el navegador");
      });
    });

    document.getElementById("searchInput")?.addEventListener("input", (e) => {
      this.state.searchQuery = e.target.value;
      this.renderCredentialsList();
    });

    document.getElementById("lockBtn")?.addEventListener("click", () => {
      chrome.runtime.sendMessage({ action: "lockVault" }, () => {
        this.showToast("SherLock bloquejat");
        this.checkStatus();
      });
    });

    document.getElementById("refreshBtn")?.addEventListener("click", () => {
      this.showToast("Actualitzant...");
      this.checkStatus();
    });

    document
      .getElementById("grabPageDataBtn")
      ?.addEventListener("click", () => {
        if (!this.state.activeTabId) return;
        chrome.tabs.sendMessage(
          this.state.activeTabId,
          { action: "getFormData" },
          { frameId: 0 },
          (res) => {
            if (res && res.success) {
              if (res.site)
                document.getElementById("saveSite").value = res.site;
              if (res.username)
                document.getElementById("saveUser").value = res.username;
              if (res.password)
                document.getElementById("savePass").value = res.password;
              this.showToast("Dades agafades de la pàgina!");
            } else {
              this.showToast("No s'han trobat dades a la pàgina");
            }
          },
        );
      });

    const toggleSavePass = document.getElementById("toggleSavePassReveal");
    const savePassInput = document.getElementById("savePass");
    toggleSavePass?.addEventListener("click", () => {
      if (savePassInput) {
        savePassInput.type =
          savePassInput.type === "password" ? "text" : "password";
      }
    });

    document.getElementById("genForSaveBtn")?.addEventListener("click", () => {
      this.switchTab("generator");
    });

    document.getElementById("submitSaveBtn")?.addEventListener("click", () => {
      const siteInput = document.getElementById("saveSite");
      const userInput = document.getElementById("saveUser");
      const passInput = document.getElementById("savePass");
      const notesInput = document.getElementById("saveNotes");

      let site = siteInput?.value.trim() || "";
      const username = userInput?.value.trim() || "";
      const password = passInput?.value.trim() || "";
      const notes = notesInput?.value.trim() || "";

      if (!site && this.state.domain) {
        site = this.state.domain;
        if (siteInput) siteInput.value = site;
      }

      if (!site) {
        this.showToast("Introdueix el lloc web o servei");
        siteInput?.focus();
        return;
      }

      if (!password) {
        this.showToast("La contrasenya és obligatòria");
        passInput?.focus();
        return;
      }

      const submitBtn = document.getElementById("submitSaveBtn");
      if (submitBtn) submitBtn.disabled = true;

      this.showToast("Desant a SherLock...");
      chrome.runtime.sendMessage(
        {
          action: "saveCredentials",
          data: { site, username, password, notes },
        },
        (res) => {
          if (submitBtn) submitBtn.disabled = false;
          if (res && res.success) {
            this.showToast("Accés desat amb èxit!");
            if (passInput) passInput.value = "";
            if (notesInput) notesInput.value = "";
            this.switchTab("vault");
          } else {
            this.showToast(res?.error || "Error en desar l'accés");
          }
        },
      );
    });

    const serverUrlInput = document.getElementById("serverUrlInput");
    chrome.storage.local.get("sherlock_server_url", (data) => {
      if (data.sherlock_server_url && serverUrlInput) {
        serverUrlInput.value = data.sherlock_server_url;
      }
    });

    serverUrlInput?.addEventListener("change", (e) => {
      chrome.storage.local.set(
        { sherlock_server_url: e.target.value.trim() },
        () => {
          this.showToast("Adreça desada");
          this.checkStatus();
        },
      );
    });

    document.getElementById("themeSelect")?.addEventListener("change", (e) => {
      const theme = e.target.value;
      chrome.storage.local.set({ sherlock_theme: theme }, () => {
        this.applyTheme(theme);
        this.showToast("Tema actualitzat");
      });
    });

    const fontSizeSlider = document.getElementById("fontSizeSlider");
    fontSizeSlider?.addEventListener("input", (e) => {
      const size = this.clampFontSize(e.target.value);
      const output = document.getElementById("fontSizeVal");
      if (output) output.textContent = `${size} px`;
      this.applyFontSize(size);
    });
    fontSizeSlider?.addEventListener("change", (e) => {
      const size = this.clampFontSize(e.target.value);
      chrome.storage.local.set({ sherlock_font_size: size });
      this.applyFontSize(size);
      chrome.runtime.sendMessage(
        { action: "setUiFontSize", size },
        (response) => {
          if (chrome.runtime.lastError || !response?.success) {
            this.showToast("Mida del text actualitzada");
            return;
          }
          this.showToast("Mida del text sincronitzada");
        },
      );
    });

    document.getElementById("detachBtn")?.addEventListener("click", () => {
      this.openDetachedWindow();
    });

    document.getElementById("reconnectBtn")?.addEventListener("click", () => {
      this.showToast("Sincronitzant...");
      this.checkStatus();
    });
  }

  showToast(msg) {
    const toast = document.getElementById("toast");
    const toastMsg = document.getElementById("toastMsg");
    if (!toast || !toastMsg) return;

    toastMsg.textContent = msg;
    toast.classList.add("show");

    clearTimeout(this._toastTimeout);
    this._toastTimeout = setTimeout(() => {
      toast.classList.remove("show");
    }, 2400);
  }

  escapeHtml(str) {
    if (!str) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }
}

document.addEventListener("DOMContentLoaded", () => {
  new PopupController();
});
