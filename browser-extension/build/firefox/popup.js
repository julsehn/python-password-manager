// Caixa Forta - Popup Controller
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

    this.init();
  }

  async init() {
    await this.initTheme();
    this.setupTabNavigation();
    this.setupEventListeners();
    await this.detectActiveTab();
    await this.checkStatus();
    this.initGenerator();
  }

  // --- THEME ---
  async initTheme() {
    const data = await chrome.storage.local.get("caixa_theme");
    const theme = (data && data.caixa_theme) || "auto";
    const select = document.getElementById("themeSelect");
    if (select) select.value = theme;
    this.applyTheme(theme);
  }

  applyTheme(theme) {
    if (theme === "dark") {
      document.documentElement.setAttribute("data-theme", "dark");
    } else if (theme === "light") {
      document.documentElement.setAttribute("data-theme", "light");
    } else {
      document.documentElement.removeAttribute("data-theme");
    }
  }

  // --- NAVIGATION ---
  setupTabNavigation() {
    const tabs = document.querySelectorAll(".tab-btn");
    tabs.forEach((btn) => {
      btn.addEventListener("click", () => {
        const targetTab = btn.getAttribute("data-tab");
        this.switchTab(targetTab);
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
  }

  // --- ACTIVE TAB DETECTION ---
  async detectActiveTab() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: "getActiveTab" }, (res) => {
        if (res && res.hostname) {
          this.state.domain = res.hostname;
          this.state.activeTabId = res.id;
          const banner = document.getElementById("domainBanner");
          const nameEl = document.getElementById("domainName");
          if (banner && nameEl) {
            nameEl.textContent = res.hostname;
            banner.style.display = "flex";
          }
          const saveSiteInput = document.getElementById("saveSite");
          if (saveSiteInput && !saveSiteInput.value) {
            saveSiteInput.value = res.hostname;
          }
        }
        resolve();
      });
    });
  }

  // --- CONNECTION & VAULT STATUS ---
  async checkStatus() {
    // Clear any poll timer started by renderLockedState.
    if (this._unlockPollTimer) {
      clearInterval(this._unlockPollTimer);
      this._unlockPollTimer = null;
    }
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: "getVaultInfo" }, async (res) => {
        const pill = document.getElementById("statusPill");
        const statusText = document.getElementById("statusText");
        const lockBtn = document.getElementById("lockBtn");

        if (res && res.connected) {
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

  // --- CREDENTIALS MANAGEMENT ---
  async refreshCredentials() {
    if (!this.state.connected || !this.state.unlocked) return;

    return new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { action: "listCredentials" },
        (res) => {
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
        },
      );
    });
  }

  // --- RENDERING ---
  renderDisconnectedState() {
    const searchSection = document.getElementById("searchSection");
    if (searchSection) searchSection.style.display = "none";

    const container = document.getElementById("vaultContent");
    replacePopupMarkup(container, `
      <div class="state-box">
        <div class="state-icon red">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="2" y="2" width="20" height="8" rx="2" ry="2"></rect>
            <rect x="2" y="14" width="20" height="8" rx="2" ry="2"></rect>
            <line x1="6" y1="6" x2="6.01" y2="6"></line>
            <line x1="6" y1="18" x2="6.01" y2="18"></line>
          </svg>
        </div>
        <h3 class="state-title">Caixa Forta no detectada</h3>
        <p class="state-desc">Obre l'aplicació d'escriptori Caixa Forta al teu ordinador per connectar-hi.</p>
        <button id="retryConnectBtn" class="btn btn-primary" style="margin-top: 6px;">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"></path>
          </svg>
          Reintentar connexió
        </button>
      </div>
    `);

    document
      .getElementById("retryConnectBtn")
      ?.addEventListener("click", () => {
        this.showToast("Comprovant connexió...");
        this.checkStatus();
      });
  }

  renderLockedState() {
    // F9 (Phase 2): The master password must NOT travel through the extension.
    // The popup instructs the user to unlock from the desktop app; it polls
    // getVaultInfo to detect when the vault has been unlocked.
    const searchSection = document.getElementById("searchSection");
    if (searchSection) searchSection.style.display = "none";

    const container = document.getElementById("vaultContent");
    replacePopupMarkup(container, `
      <div class="state-box">
        <div class="state-icon amber">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
          </svg>
        </div>
        <h3 class="state-title">Caixa Forta bloquejada</h3>
        <p class="state-desc">Desbloqueja a l'aplicació Caixa Forta per accedir als teus accessos.</p>
        <button type="button" id="retryUnlockBtn" class="btn btn-secondary" style="margin-top: 8px;">
          Comprovar de nou
        </button>
      </div>
    `);

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
    replacePopupMarkup(container, `
      <div class="state-box">
        <div class="state-icon amber">${this.iconSvg("KeyRound", 24)}</div>
        <h3 class="state-title">Vincula aquest navegador</h3>
        <p class="state-desc">Per protegir la caixa, cada navegador s'ha d'aprovar des de l'app Caixa Forta.</p>
        <button id="openPairSettingsBtn" class="btn btn-primary" style="margin-top: 6px">Obrir vinculació</button>
      </div>
    `);
    document.getElementById("openPairSettingsBtn")?.addEventListener("click", () => {
      this.switchTab("settings");
    });
  }

  iconSvg(name, size = 16) {
    const paths = {
      KeyRound: '<circle cx="7.5" cy="15.5" r="5.5"></circle><path d="m21 2-9.6 9.6"></path><path d="m15.5 7.5 3 3L22 7l-3-3"></path>',
      Globe: '<circle cx="12" cy="12" r="10"></circle><path d="M2 12h20"></path><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10Z"></path>',
      Eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z"></path><circle cx="12" cy="12" r="3"></circle>',
      EyeOff: '<path d="m3 3 18 18"></path><path d="M10.6 10.6a2 2 0 0 0 2.8 2.8"></path><path d="M9.9 5.2A11 11 0 0 1 12 5c6.4 0 10 7 10 7a14 14 0 0 1-3.2 3.9"></path><path d="M6.6 6.6C3.7 8.3 2 12 2 12s3.6 7 10 7a10 10 0 0 0 3.2-.5"></path>',
      UserRound: '<circle cx="12" cy="8" r="5"></circle><path d="M20 21a8 8 0 0 0-16 0"></path>',
      Copy: '<rect x="8" y="8" width="14" height="14" rx="2"></rect><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"></path>',
      Sparkles: '<path d="m12 3 1.9 5.8L20 11l-6.1 2.2L12 19l-1.9-5.8L4 11l6.1-2.2L12 3Z"></path><path d="m19 14 1.1 2.9L23 18l-2.9 1.1L19 22l-1.1-2.9L15 18l2.9-1.1L19 14Z"></path>',
    };
    return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || ""}</svg>`;
  }

  renderCredentialsList() {
    const searchSection = document.getElementById("searchSection");
    if (searchSection) searchSection.style.display = "block";

    const container = document.getElementById("vaultContent");
    const query = (this.state.searchQuery || "").trim().toLowerCase();
    const currentDomain = this.normalizeHost(this.state.domain);

    let matched = [];
    let others = [];

    this.state.credentials.forEach((cred) => {
      const site = this.normalizeHost(cred.site);
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
        replacePopupMarkup(container, `
          <div class="state-box"><p class="state-desc">Cap resultat per a "${this.escapeHtml(this.state.searchQuery)}"</p></div>
        `);
      } else {
        replacePopupMarkup(container, `
          <div class="credential-section">
            <h3 class="credential-section-title">Resultats (${matched.length})</h3>
            <div class="cred-list">${matched.map((c) => this.renderCredCard(c)).join("")}</div>
          </div>
        `);
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
      document.getElementById("quickSaveForSiteBtn")?.addEventListener("click", () => {
        this.switchTab("save");
      });
    }

    this.attachCardActions();
  }

  normalizeHost(value = "") {
    const input = String(value).trim().toLowerCase();
    if (!input) return "";
    try {
      return new URL(input.includes("://") ? input : `https://${input}`).hostname
        .replace(/^www\./, "");
    } catch {
      return input.replace(/^www\./, "").split(/[/:]/, 1)[0];
    }
  }

  hostMatches(savedHost, activeHost) {
    return Boolean(
      savedHost && activeHost &&
      (savedHost === activeHost ||
        activeHost.endsWith(`.${savedHost}`)),
    );
  }

  renderCredCard(cred) {
    const domainIcon = this.iconSvg("Globe", 18);
    const autofillAllowed = this.hostMatches(
      this.normalizeHost(cred.site),
      this.normalizeHost(this.state.domain),
    );
    return `
      <div class="cred-card" data-id="${this.escapeHtml(cred.id)}">
        <div class="cred-header">
          <div class="cred-icon">${domainIcon}</div>
          <div class="cred-info">
            <div class="cred-title" title="${this.escapeHtml(cred.site)}">${this.escapeHtml(cred.site)}</div>
            <div class="cred-user" title="${this.escapeHtml(cred.username)}">${this.escapeHtml(cred.username || "Sense usuari")}</div>
          </div>
          <button class="btn btn-secondary action-copy-user" data-user="${this.escapeHtml(cred.username)}" title="Copiar usuari">
            ${this.iconSvg("UserRound", 14)}
          </button>
          <button class="btn btn-secondary action-copy-pass" data-id="${this.escapeHtml(cred.id)}" title="Copiar contrasenya">
            ${this.iconSvg("Copy", 14)}
          </button>
        </div>
        <div class="cred-actions">
          <button class="btn btn-primary action-fill" data-id="${this.escapeHtml(cred.id)}" ${autofillAllowed ? "" : "disabled title=\"L'ompliment només està disponible per a aquest lloc\""}>
            ${this.iconSvg("Sparkles", 14)}
            Omplir formulari
          </button>
        </div>
      </div>
    `;
  }

  attachCardActions() {
    document.querySelectorAll(".action-copy-user").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const user = btn.getAttribute("data-user");
        if (user) {
          navigator.clipboard.writeText(user);
          this.showToast("Usuari copiat!");
        }
      });
    });

    document.querySelectorAll(".action-copy-pass").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const id = btn.getAttribute("data-id");
        const credential = this.state.credentials.find(
          (item) => item.id === id,
        );
        if (credential) this.loadCredential(credential).then((full) => {
          if (!full?.password) return this.showToast("No s'ha pogut obtenir la contrasenya");
          navigator.clipboard.writeText(full.password);
          this.showToast("Contrasenya copiada!");
        });
      });
    });

    document.querySelectorAll(".action-fill").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-id");
        const cred = this.state.credentials.find((c) => c.id === id);
        if (cred) this.loadCredential(cred, this.state.domain).then((full) => full && this.autofillCredential(full));
      });
    });
  }

  loadCredential(credential, domain = credential.site) {
    return new Promise((resolve) => chrome.runtime.sendMessage(
      { action: "fetchCredentials", site: this.normalizeHost(domain) },
      (res) => resolve(res?.success ? (res.credentials || []).find((item) => item.id === credential.id) : null),
    ));
  }

  autofillCredential(credential) {
    if (!this.state.activeTabId) {
      this.showToast("Obre una pestanya web per omplir les dades");
      return;
    }

    chrome.tabs.sendMessage(
      this.state.activeTabId,
      { action: "autofillLogin", credential },
      (res) => {
        if (chrome.runtime.lastError || !res || !res.success) {
          this.showToast(res?.error || "No s'ha pogut omplir el formulari");
        } else {
          this.showToast("Dades d'accés omplertes!");
        }
      },
    );
  }

  // --- PASSWORD GENERATOR ---
  initGenerator() {
    const slider = document.getElementById("lengthSlider");
    const lengthVal = document.getElementById("lengthVal");

    slider?.addEventListener("input", (e) => {
      if (lengthVal) lengthVal.textContent = e.target.value;
      this.clearGeneratedPassword();
    });

    ["chkUpper", "chkLower", "chkNumbers", "chkSymbols"].forEach((id) => {
      document
        .getElementById(id)
        ?.addEventListener("change", () => this.clearGeneratedPassword());
    });

    document
      .getElementById("regenBtn")
      ?.addEventListener("click", () => this.runGenerator());
    document
      .getElementById("generatePasswordBtn")
      ?.addEventListener("click", () => this.runGenerator());

    document
      .getElementById("copyGenBtn")
      ?.addEventListener("click", () => this.copyGenerated());
    document
      .getElementById("copyGenAction")
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

    document.getElementById("fillGenAction")?.addEventListener("click", () => {
      if (!this.state.generatedPassword) return;
      if (!this.state.activeTabId) {
        this.showToast("Obre una pàgina per omplir la contrasenya");
        return;
      }
      const savePassInput = document.getElementById("savePass");
      if (savePassInput) savePassInput.value = this.state.generatedPassword;

      chrome.tabs.sendMessage(
        this.state.activeTabId,
        {
          action: "fillGeneratedPassword",
          password: this.state.generatedPassword,
        },
        (res) => {
          if (chrome.runtime.lastError || !res || !res.success) {
            this.showToast(
              res?.error || "No s'ha trobat cap camp de contrasenya",
            );
          } else {
            this.showToast("Contrasenya inserida! Pots desar-la a 'Desar'");
          }
        },
      );
    });

    this.clearGeneratedPassword();
  }

  clearGeneratedPassword() {
    this.state.generatedPassword = "";
    const outputEl = document.getElementById("genOutput");
    if (outputEl) outputEl.textContent = "Tria les opcions i prem Generar";
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
    ["regenBtn", "copyGenBtn", "copyGenAction", "fillGenAction", "saveGenAction"]
      .forEach((id) => {
        const button = document.getElementById(id);
        if (button) button.disabled = true;
      });
    this.updateGenerateButtonState();
  }

  updateGenerateButtonState() {
    const selected = ["chkUpper", "chkLower", "chkNumbers", "chkSymbols"]
      .some((id) => document.getElementById(id)?.checked);
    const button = document.getElementById("generatePasswordBtn");
    if (button) button.disabled = !selected;
    const hint = document.getElementById("generatorHint");
    if (hint) {
      hint.textContent = selected
        ? "Tria les opcions que vulguis i genera quan estiguis a punt."
        : "Selecciona com a mínim un tipus de caràcter.";
    }
  }

  runGenerator() {
    const selected = ["chkUpper", "chkLower", "chkNumbers", "chkSymbols"]
      .some((id) => document.getElementById(id)?.checked);
    if (!selected) {
      this.clearGeneratedPassword();
      return;
    }

    const length = parseInt(
      document.getElementById("lengthSlider")?.value || 18,
      10,
    );
    const uppercase = document.getElementById("chkUpper")?.checked ?? true;
    const lowercase = document.getElementById("chkLower")?.checked ?? true;
    const numbers = document.getElementById("chkNumbers")?.checked ?? true;
    const symbols = document.getElementById("chkSymbols")?.checked ?? true;

    chrome.runtime.sendMessage(
      {
        action: "generatePassword",
        options: { length, uppercase, lowercase, numbers, symbols },
      },
      (res) => {
        if (res && res.password) {
          this.state.generatedPassword = res.password;
          const outputEl = document.getElementById("genOutput");
          if (outputEl) outputEl.textContent = res.password;
          this.updateStrength(res.password);
          ["regenBtn", "copyGenBtn", "copyGenAction", "fillGenAction", "saveGenAction"]
            .forEach((id) => {
              const button = document.getElementById(id);
              if (button) button.disabled = false;
            });
        }
      },
    );
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

  // --- EVENT LISTENERS ---
  setupEventListeners() {
    document.getElementById("pairBrowserBtn")?.addEventListener("click", () => {
      const input = document.getElementById("pairingCodeInput");
      const code = (input?.value || "").trim();
      if (!/^\d{6}$/.test(code)) return this.showToast("Introdueix el codi de sis xifres");
      chrome.runtime.sendMessage({ action: "pairBrowser", code }, (res) => {
        if (res?.success) {
          if (input) input.value = "";
          this.showToast("Navegador vinculat correctament");
          this.checkStatus();
        } else this.showToast(res?.error || "No s'ha pogut vincular el navegador");
      });
    });

    // Search input
    document.getElementById("searchInput")?.addEventListener("input", (e) => {
      this.state.searchQuery = e.target.value;
      this.renderCredentialsList();
    });

    // Lock button
    document.getElementById("lockBtn")?.addEventListener("click", () => {
      chrome.runtime.sendMessage({ action: "lockVault" }, () => {
        this.showToast("Caixa Forta bloquejada");
        this.checkStatus();
      });
    });

    // Refresh button
    document.getElementById("refreshBtn")?.addEventListener("click", () => {
      this.showToast("Actualitzant...");
      this.checkStatus();
    });

    // Save form actions
    document
      .getElementById("grabPageDataBtn")
      ?.addEventListener("click", () => {
        if (!this.state.activeTabId) return;
        chrome.tabs.sendMessage(
          this.state.activeTabId,
          { action: "getFormData" },
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
      this.showToast("Tria les opcions i prem Generar");
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

      this.showToast("Desant a Caixa Forta...");
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

    // Settings actions
    const serverUrlInput = document.getElementById("serverUrlInput");
    chrome.storage.local.get("caixa_server_url", (data) => {
      if (data.caixa_server_url && serverUrlInput) {
        serverUrlInput.value = data.caixa_server_url;
      }
    });

    serverUrlInput?.addEventListener("change", (e) => {
      chrome.storage.local.set(
        { caixa_server_url: e.target.value.trim() },
        () => {
          this.showToast("Adreça desada");
          this.checkStatus();
        },
      );
    });

    document.getElementById("themeSelect")?.addEventListener("change", (e) => {
      const theme = e.target.value;
      chrome.storage.local.set({ caixa_theme: theme }, () => {
        this.applyTheme(theme);
        this.showToast("Tema actualitzat");
      });
    });

    document.getElementById("reconnectBtn")?.addEventListener("click", () => {
      this.showToast("Sincronitzant...");
      this.checkStatus();
    });

    document
      .getElementById("clearSessionBtn")
      ?.addEventListener("click", () => {
        chrome.storage.local.remove(
          ["caixa_session_token", "caixa_shared_secret"],
          () => {
            this.showToast("Sessió tancada");
            this.checkStatus();
          },
        );
      });
  }

  // --- TOAST NOTIFICATIONS ---
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
