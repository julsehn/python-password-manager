// Caixa Forta - Popup Controller
// Implements reactive state, Tauri design system integration, and secure vault communication.

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
        { action: "fetchCredentials", site: "" },
        (res) => {
          if (res && res.success) {
            this.state.credentials = res.credentials || [];
            this.renderCredentialsList();
          } else if (res && res.unlocked === false) {
            this.state.unlocked = false;
            this.checkStatus();
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
    container.innerHTML = `
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
    `;

    document
      .getElementById("retryConnectBtn")
      ?.addEventListener("click", () => {
        this.showToast("Comprovant connexió...");
        this.checkStatus();
      });
  }

  renderLockedState() {
    const searchSection = document.getElementById("searchSection");
    if (searchSection) searchSection.style.display = "none";

    const container = document.getElementById("vaultContent");
    container.innerHTML = `
      <div class="state-box">
        <div class="state-icon amber">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
          </svg>
        </div>
        <h3 class="state-title">Caixa Forta bloquejada</h3>
        <p class="state-desc">Introdueix la teva contrasenya mestra per accedir als teus accessos:</p>
        
        <form id="unlockForm" style="width: 100%; display: flex; flex-direction: column; gap: 8px;">
          <div class="input-with-action">
            <input type="password" id="unlockPasswordInput" class="form-control" placeholder="Contrasenya mestra" required autofocus />
            <button type="button" id="toggleUnlockReveal" class="btn btn-secondary" title="Mostrar contrasenya">👁️</button>
          </div>
          <button type="submit" class="btn btn-primary">
            Desbloquejar
          </button>
        </form>
      </div>
    `;

    const unlockForm = document.getElementById("unlockForm");
    const pwdInput = document.getElementById("unlockPasswordInput");
    const toggleReveal = document.getElementById("toggleUnlockReveal");

    toggleReveal?.addEventListener("click", () => {
      pwdInput.type = pwdInput.type === "password" ? "text" : "password";
    });

    unlockForm?.addEventListener("submit", (e) => {
      e.preventDefault();
      const pwd = pwdInput.value;
      if (!pwd) return;

      this.showToast("Desbloquejant...");
      chrome.runtime.sendMessage(
        { action: "unlockVault", masterPassword: pwd },
        (res) => {
          if (res && res.success) {
            this.showToast("Caixa Forta desbloquejada!");
            this.checkStatus();
          } else {
            this.showToast(res?.error || "Contrasenya incorrecta");
          }
        },
      );
    });
  }

  renderCredentialsList() {
    const searchSection = document.getElementById("searchSection");
    if (searchSection) searchSection.style.display = "block";

    const container = document.getElementById("vaultContent");
    const query = (this.state.searchQuery || "").trim().toLowerCase();
    const currentDomain = (this.state.domain || "").toLowerCase();

    let matched = [];
    let others = [];

    this.state.credentials.forEach((cred) => {
      const site = (cred.site || "").toLowerCase();
      const user = (cred.username || "").toLowerCase();

      if (query) {
        if (site.includes(query) || user.includes(query)) {
          matched.push(cred);
        }
      } else {
        if (
          currentDomain &&
          (site.includes(currentDomain) || currentDomain.includes(site))
        ) {
          matched.push(cred);
        } else {
          others.push(cred);
        }
      }
    });

    if (!query && matched.length === 0) {
      container.innerHTML = `
        <div class="state-box" style="padding: 18px 14px;">
          <div class="state-icon blue" style="width: 36px; height: 36px;">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="12" y1="8" x2="12" y2="12"></line>
              <line x1="12" y1="16" x2="12.01" y2="16"></line>
            </svg>
          </div>
          <h4 class="state-title" style="font-size: 0.875rem;">Cap accés per a aquest lloc</h4>
          <p class="state-desc" style="font-size: 0.6875rem;">No tens cap credencial desada per a ${this.state.domain || "aquesta pàgina"}.</p>
          <button id="quickSaveForSiteBtn" class="btn btn-primary" style="margin-top: 4px; font-size: 0.75rem;">
            + Desar accés d'aquest lloc
          </button>
        </div>
        ${
          others.length > 0
            ? `<div style="font-size: 0.6875rem; font-weight: 700; color: var(--text-muted); margin-top: 8px; text-transform: uppercase;">Altres accessos (${others.length})</div>
               <div class="cred-list">${others.map((c) => this.renderCredCard(c)).join("")}</div>`
            : ""
        }
      `;

      document
        .getElementById("quickSaveForSiteBtn")
        ?.addEventListener("click", () => {
          this.switchTab("save");
        });
    } else {
      const itemsToRender = query ? matched : matched.concat(others);
      if (itemsToRender.length === 0) {
        container.innerHTML = `
          <div class="state-box">
            <p class="state-desc">Cap resultat per a "${this.state.searchQuery}"</p>
          </div>
        `;
      } else {
        container.innerHTML = `
          <div class="cred-list">
            ${itemsToRender.map((c) => this.renderCredCard(c)).join("")}
          </div>
        `;
      }
    }

    this.attachCardActions();
  }

  renderCredCard(cred) {
    const initial = (cred.site || "W").charAt(0).toUpperCase();
    return `
      <div class="cred-card" data-id="${cred.id}">
        <div class="cred-header">
          <div class="cred-icon">${this.escapeHtml(initial)}</div>
          <div class="cred-info">
            <div class="cred-title" title="${this.escapeHtml(cred.site)}">${this.escapeHtml(cred.site)}</div>
            <div class="cred-user" title="${this.escapeHtml(cred.username)}">${this.escapeHtml(cred.username || "Sense usuari")}</div>
          </div>
          <button class="btn btn-secondary action-copy-user" data-user="${this.escapeHtml(cred.username)}" title="Copiar usuari">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
              <circle cx="12" cy="7" r="4"></circle>
            </svg>
          </button>
          <button class="btn btn-secondary action-copy-pass" data-pass="${this.escapeHtml(cred.password)}" title="Copiar contrasenya">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>
          </button>
        </div>
        <div class="cred-actions">
          <button class="btn btn-primary action-fill" data-id="${cred.id}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="9 11 12 14 22 4"></polyline>
              <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path>
            </svg>
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
        const pass = btn.getAttribute("data-pass");
        if (pass) {
          navigator.clipboard.writeText(pass);
          this.showToast("Contrasenya copiada!");
        }
      });
    });

    document.querySelectorAll(".action-fill").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-id");
        const cred = this.state.credentials.find((c) => c.id === id);
        if (cred) {
          this.autofillCredential(cred);
        }
      });
    });
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
      this.runGenerator();
    });

    ["chkUpper", "chkLower", "chkNumbers", "chkSymbols"].forEach((id) => {
      document
        .getElementById(id)
        ?.addEventListener("change", () => this.runGenerator());
    });

    document
      .getElementById("regenBtn")
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

    this.runGenerator();
  }

  runGenerator() {
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
          const savePassInput = document.getElementById("savePass");
          if (savePassInput && !savePassInput.value) {
            savePassInput.value = res.password;
          }
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
      chrome.runtime.sendMessage(
        { action: "generatePassword", options: { length: 18 } },
        (res) => {
          if (res && res.password) {
            const passEl = document.getElementById("savePass");
            if (passEl) passEl.value = res.password;
            this.state.generatedPassword = res.password;
            this.showToast("Contrasenya generada!");
          }
        },
      );
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
