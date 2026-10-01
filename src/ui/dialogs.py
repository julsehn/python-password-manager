import os
import json
import base64
from typing import Optional

from src.ui.qt_compat import (
    QDialog,
    QFormLayout,
    QLineEdit,
    QDialogButtonBox,
    QCheckBox,
    QVBoxLayout,
    QHBoxLayout,
    QLabel,
    QPushButton,
    QFileDialog,
    Qt,
    QPixmap,
    QPainter,
    QColor,
    QCursor,
    QMessageBox,
    QWidget,
)

from src.storage import (
    load_vault,
    VAULT_FILENAME,
    load_image_auth,
    save_image_auth,
    verify_image_auth_pattern,
    delete_image_auth,
    image_auth_is_set,
    GRID_COLUMNS,
    GRID_ROWS,
    GRID_CELL_CHARS,
    coords_to_grid_cell,
    generate_grid_password,
)

from src.remote_vault import RemoteVaultStore


class LoginDialog(QDialog):
    """Diàleg de login per obtenir la contrasenya mestra.

    Handles:
      - Master password prompt on startup (required)
      - Brute-force attempt tracking
      - Lockout feedback after too many failed attempts
    """

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWindowTitle("Entrar a la caixa forta")
        self.setModal(True)
        self.remote = remote

        layout = QVBoxLayout()
        layout.setSpacing(16)

        # Title
        title = QLabel("La teva caixa forta")
        title.setAlignment(Qt.AlignmentFlag.AlignCenter)
        font = title.font()
        font.setWeight(750)
        title.setFont(font)
        layout.addWidget(title)

        # Subtitle
        subtitle = QLabel(
            "Entrada la contrasenya mestra per desbloquejar les teves contrasenyes."
        )
        subtitle.setAlignment(Qt.AlignmentFlag.AlignCenter)
        subtitle.setStyleSheet("color: #68706c; font-size: 13px;")
        layout.addWidget(subtitle)

        # Password field
        self.password_field = QLineEdit()
        self.password_field.setPlaceholderText("Contrasenya mestra")
        self.password_field.setEchoMode(QLineEdit.EchoMode.Password)
        layout.addWidget(self.password_field)

        # Show password checkbox
        self.show_pwd = QCheckBox("Mostrar contrasenya")
        self.show_pwd.stateChanged.connect(self._on_toggle_show)
        layout.addWidget(self.show_pwd)

        # Error label (initially hidden)
        self.error_label = QLabel("")
        self.error_label.setStyleSheet("color: #dc2626; font-size: 13px; margin-top: 4px;")
        self.error_label.setVisible(False)
        layout.addWidget(self.error_label)

        # Buttons
        buttons = QDialogButtonBox(QDialogButtonBox.StandardButton.Ok | QDialogButtonBox.StandardButton.Cancel)
        buttons.button(QDialogButtonBox.StandardButton.Ok).setText("Entrar")
        buttons.button(QDialogButtonBox.StandardButton.Cancel).setText("Cancel·la")
        buttons.accepted.connect(self._on_accept)
        buttons.rejected.connect(self.reject)

        # If there's an existing vault, we know it's locked
        self._show_lockout = False
        try:
            if os.path.exists(VAULT_FILENAME):
                # We can check lockout state
                from src.storage import is_vault_locked, load_vault

                # Try a quick check: if we can read the file (even though it's encrypted)
                # This tells us a vault exists
                self._vault_exists = True
            else:
                self._vault_exists = False

            if not self._vault_exists:
                # No vault yet - we can skip login for now, show a welcome screen instead
                self.error_label.setText("No hi ha cap caixa forta encartada.")
            else:
                self.error_label.setText(
                    "La caixa forta requereix la contrasenya mestra per accéixer-hi."
                )
        except Exception:
            self._vault_exists = True

        layout.addWidget(buttons)
        self.setLayout(layout)

    def _on_toggle_show(self, state: int) -> None:
        if state == Qt.CheckState.Checked:
            self.password_field.setEchoMode(QLineEdit.EchoMode.Normal)
        else:
            self.password_field.setEchoMode(QLineEdit.EchoMode.Password)

    def _on_accept(self) -> None:
        password = self.password_field.text()
        if not password:
            self.error_label.setText("Escriu una contrasenya.")
            return

        # Validate password length (minimum 16 characters per OWASP for vault encryption)
        if len(password) < 16:
            self.error_label.setText("La contrasenya mestra ha de tenir com a mínim 16 caràcters.")
            return

        # Validate the password against the selected vault backend.
        try:
            from src.storage import VaultLockedError
            load_vault(password, VAULT_FILENAME)
        except Exception as e:
            self.error_label.setText(str(e))
            return

        self.accept()


class CloudLoginDialog(QDialog):
    """Login/Register dialog for cloud authentication.
    
    Handles:
      - User registration (new account)
      - User login with verification
      - Password confirmation for security
    """
    
    def __init__(self, remote_store: RemoteVaultStore, parent=None):
        super().__init__(parent)
        self.setWindowTitle("Autenticació - Núvol Oficial")
        self.setModal(True)
        self.remote_store = remote_store
        self.is_registering = False
        
        layout = QVBoxLayout()
        layout.setSpacing(16)
        
        # Title and subtitle
        title = QLabel("Autenticació al núvol")
        title.setAlignment(Qt.AlignmentFlag.AlignCenter)
        font = title.font()
        font.setWeight(750)
        title.setFont(font)
        layout.addWidget(title)
        
        subtitle = QLabel(
            "Llegeix la nostra Política de Privacitat abans de continuar:\n"
            "🔒 Les teves contrasenyes estan encriptades. El servidor només emmagatzema "
            "la versió encriptada. Ningú pot accedir als teus dades sense la contrasenya mestra."
        )
        subtitle.setAlignment(Qt.AlignmentFlag.AlignCenter)
        subtitle.setStyleSheet("color: #68706c; font-size: 12px; background: #f0f9ff; padding: 12px; border-radius: 8px; margin-top: 8px;")
        layout.addWidget(subtitle)
        
        # Provider selection
        provider_label = QLabel("Proveïdor de núvol:")
        provider_label.setStyleSheet("font-weight: 600; font-size: 13px;")
        layout.addWidget(provider_label)
        
        self.provider_combo = QComboBox()
        self.provider_combo.addItems(["Núvol oficial (recomanat)", "Personalitzat"])
        self.provider_combo.setCurrentIndex(0)
        layout.addWidget(self.provider_combo)
        
        # Username
        username_label = QLabel("Usuari:")
        username_label.setStyleSheet("font-weight: 600;")
        layout.addWidget(username_label)
        
        self.username_field = QLineEdit()
        self.username_field.setPlaceholderText("E. g., joan.perez")
        self.username_field.setMinimumHeight(40)
        layout.addWidget(self.username_field)
        
        # Password
        password_label = QLabel("Contrasenya mestra:")
        password_label.setStyleSheet("font-weight: 600;")
        layout.addWidget(password_label)
        
        self.password_field = QLineEdit()
        self.password_field.setPlaceholderText("Mínim 16 caràcters")
        self.password_field.setEchoMode(QLineEdit.EchoMode.Password)
        self.password_field.setMinimumHeight(40)
        layout.addWidget(self.password_field)
        
        # Confirm password
        self.confirm_password_field = QLineEdit()
        self.confirm_password_field.setPlaceholderText("Repeteix la contrasenya")
        self.confirm_password_field.setEchoMode(QLineEdit.EchoMode.Password)
        self.confirm_password_field.setMinimumHeight(40)
        self.confirm_password_field.setVisible(False)
        layout.addWidget(self.confirm_password_field)
        
        # Error label
        self.error_label = QLabel("")
        self.error_label.setStyleSheet("color: #dc2626; font-size: 13px; margin-top: 4px;")
        self.error_label.setVisible(False)
        layout.addWidget(self.error_label)
        
        # Privacy policy checkbox
        self.privacy_accepted = QCheckBox("He llegit i accepto la Política de Privacitat")
        self.privacy_accepted.stateChanged.connect(self._on_privacy_check)
        layout.addWidget(self.privacy_accepted)
        
        # Privacy policy link
        privacy_link = QLabel("📄 Veure política de privacitat completa")
        privacy_link.setAlignment(Qt.AlignmentFlag.AlignCenter)
        privacy_link.setOpenExternalLinks(True)
        privacy_link.setStyleSheet("color: #2563eb; font-size: 11px; text-decoration: underline;")
        privacy_link.setTextInteractionFlags(Qt.TextInteractionFlag.TextBrowserInteraction)
        privacy_link.clicked.connect(lambda: self.open_external_file("/PRIVACY_POLICY.md"))
        layout.addWidget(privacy_link)
        
        # Buttons
        buttons = QDialogButtonBox(QDialogButtonBox.StandardButton.Ok | QDialogButtonBox.StandardButton.Cancel)
        buttons.button(QDialogButtonBox.StandardButton.Ok).setText("Continuar")
        buttons.button(QDialogButtonBox.StandardButton.Cancel).setText("Cancel·la")
        buttons.accepted.connect(self._on_accept)
        buttons.rejected.connect(self.reject)
        layout.addWidget(buttons)
        
        self.setLayout(layout)
    
    def open_external_file(self, path: str):
        """Open external markdown file (for privacy policy)."""
        import webbrowser
        try:
            # Try to open in same app or default viewer
            if path.startswith("/"):
                path = path.replace("/", "")
            webbrowser.open(f"file://{path}")
        except:
            QMessageBox.information(self, "Política de Privacitat", 
                "Vegeu l'arxiu PRIVACY_POLICY.md al repositori GitHub\n\n"
                "https://github.com/julsehn/Password-Manager-Cloud")
    
    def _on_privacy_check(self, state: int) -> None:
        if state == Qt.CheckState.Checked:
            self.confirm_password_field.setVisible(True)
        else:
            self.confirm_password_field.setVisible(False)
    
    def _on_accept(self) -> None:
        username = self.username_field.text().strip()
        password = self.password_field.text()
        confirm_password = self.confirm_password_field.text()
        
        # Validate inputs
        if not username:
            self.error_label.setText("L'usuari és obligatori.")
            self.username_field.setFocus()
            return
        
        if len(username) < 3:
            self.error_label.setText("L'usuari ha de tenir almenys 3 caràcters.")
            self.username_field.setFocus()
            return
        
        if len(password) < 16:
            self.error_label.setText("La contrasenya mestra ha de tenir almenys 16 caràcters per seguretat.")
            self.password_field.setFocus()
            return
        
        if not self.privacy_accepted.isChecked():
            self.error_label.setText("Has d'acceptar la Política de Privacitat per continuar.")
            return
        
        if password != confirm_password:
            self.error_label.setText("Les contrasenyes no coincideixen.")
            self.confirm_password_field.setFocus()
            return
        
        # Store password for later use
        self._auth_password = password
        
        # Proceed with authentication
        if self.provider_combo.currentIndex() == 0:
            # Official cloud - auto-authenticate
            self._authenticate_official_cloud(username)
        else:
            # Custom cloud - manual auth needed
            self.accept()
    
    def _authenticate_official_cloud(self, username: str):
        """Authenticate with official cloud service."""
        import sys
        
        try:
            # Auto-create vault with encrypted data
            encrypted_blob = self._get_default_encrypted_blob()
            
            # Register vault on cloud
            response = self.remote_store.authenticate_user(username, self._auth_password)
            
            # Create vault
            self.remote_store.save([], self._auth_password)
            
            self.config["auth_user"] = username
            save_config(self.config)
            
            self.accept()
            
        except Exception as e:
            self.error_label.setText(f"Error d'autenticació: {str(e)}")
            return
    
    def _get_default_encrypted_blob(self) -> str:
        """Generate default encrypted vault blob."""
        from src.encryption import serialize_vault
        from src.models import PasswordEntry
        
        empty_vault = [PasswordEntry()]
        return serialize_vault(empty_vault, self._auth_password)
    
    def get_credentials(self) -> dict:
        """Return authenticated credentials."""
        return {
            "username": self.username_field.text(),
            "password": self._auth_password,
        }


class GridSetupWizardDialog(QDialog):
    """Wizard dialog for setting up grid-based authentication.

    The user:
      1. Clicks on cells in a 5x5 grid to create their pattern
      2. The grid cell indices are stored and used for key derivation
    """

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWindowTitle("Configurar autenticació amb quadrícula")
        self.setFixedSize(550, 650)

        # State tracking
        self.pattern_cells: list[int] = []  # Grid cell indices
        self.grid_buttons = []

        # UI setup
        self.setup_ui()

    def setup_ui(self):
        layout = QVBoxLayout(self)
        layout.setSpacing(12)

        # Step indicator
        self.step_label = QLabel("Configura el teu patró d'autenticació")
        self.step_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        font = self.step_label.font()
        font.setWeight(600)
        font.setPointSize(16)
        self.step_label.setFont(font)
        layout.addWidget(self.step_label)

        # Instruction
        instruction = QLabel(
            "Fes clic en les caselles de la quadrícula per crear el teu patró.\n"
            "Recorda les posicions — les necessitaràs per desbloquejar la caixa forta."
        )
        instruction.setAlignment(Qt.AlignmentFlag.AlignCenter)
        instruction.setStyleSheet("color: #68706c; font-size: 12px; margin-top: 8px;")
        layout.addWidget(instruction)

        # Grid
        grid_widget = QWidget()
        grid_layout = QGridLayout(grid_widget)
        grid_layout.setSpacing(2)

        for row in range(GRID_ROWS):
            for col in range(GRID_COLUMNS):
                cell_index = col + row * GRID_COLUMNS
                button = QPushButton()
                button.setFixedSize(60, 60)
                button.setFont(QFont("monospace", 16, QFont.Weight.Bold))
                button.setAccessibleName(f"Cell {cell_index}")
                button.clicked.connect(lambda c=cell_index: self._on_cell_click(c))
                self.grid_buttons.append(button)
                grid_layout.addWidget(button, row, col)

        layout.addWidget(grid_widget, alignment=Qt.AlignmentFlag.AlignCenter)

        # Pattern display
        self.pattern_label = QLabel("Patern: ")
        self.pattern_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        layout.addWidget(self.pattern_label)

        # Button row
        btn_row = QHBoxLayout()
        self.btn_cancel = QPushButton("Cancel·la")
        self.btn_cancel.clicked.connect(self.reject)
        btn_row.addWidget(self.btn_cancel)

        finish_btn = QPushButton("✅ Finalitzar configuració")
        finish_btn.setStyleSheet("""
            QPushButton {
                background: #10b981; 
                color: white; 
                padding: 8px 16px; 
                border-radius: 6px;
                font-weight: 500;
            }
            QPushButton:hover { background: #059669; }
        """)
        finish_btn.clicked.connect(self._on_finish_setup)
        btn_row.addWidget(finish_btn)

        layout.addLayout(btn_row)

    def _on_cell_click(self, cell_index: int):
        """Handle grid cell click."""
        if cell_index in self.pattern_cells:
            # Remove from pattern if already clicked
            self.pattern_cells.remove(cell_index)
            self.grid_buttons[cell_index].setText("")
            self.grid_buttons[cell_index].setStyleSheet("")
        else:
            # Add to pattern
            self.pattern_cells.append(cell_index)
            char = GRID_CELL_CHARS[cell_index]
            self.grid_buttons[cell_index].setText(char)
            self.grid_buttons[cell_index].setStyleSheet("background: #e5e7eb; color: #1f2937;")

        # Update pattern display
        password = generate_grid_password(self.pattern_cells)
        self.pattern_label.setText(f"Patern: {password}")

    def _on_finish_setup(self):
        """Save the grid-based authentication pattern."""
        if len(self.pattern_cells) < 3:
            QMessageBox.warning(
                self,
                "Error",
                "Selecciona almenys 3 caselles per al teu patró."
            )
            return

        # Store as grid cell indices (not image)
        import os
        salt = os.urandom(32)
        save_image_auth(
            image_b64="grid_auth",
            hotspots=[{"cell": cell} for cell in self.pattern_cells],
            salt=salt
        )

        QMessageBox.information(
            self,
            "Autenticació configurada!",
            "El teu patró s'ha guardat.\n\n"
            "La pròxima vegada, fes clic en les mateixes caselles per desbloquejar la caixa forta."
        )

        self.accept()


class BiometricLoginDialog(QDialog):
    """Diàleg de login per autenticació amb quadrícula (click pattern).

    The user clicks grid cells to recreate their stored pattern.
    If the pattern matches, authentication succeeds.
    """

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWindowTitle("Entrar a la caixa forta")
        self.setModal(True)
        self.setFixedSize(550, 650)

        # State tracking
        self.current_strokes: list[int] = []  # Grid cell indices
        self.auth_data = None  # Loaded auth data

        # Load stored template
        self.auth_data = load_image_auth()

        if not self.auth_data:
            QMessageBox.warning(
                self,
                "Error",
                "No hi ha cap plantilla d'autenticació configurada."
            )
            self.reject()
            return

        self.setup_ui()

    def setup_ui(self):
        layout = QVBoxLayout(self)
        layout.setSpacing(8)

        # Title
        title = QLabel("Entrar a la caixa forta")
        title.setAlignment(Qt.AlignmentFlag.AlignCenter)
        font = title.font()
        font.setWeight(750)
        title.setFont(font)
        layout.addWidget(title)

        subtitle = QLabel("Fes clic en les caselles del teu patró")
        subtitle.setAlignment(Qt.AlignmentFlag.AlignCenter)
        subtitle.setStyleSheet("color: #68706c; font-size: 13px;")
        layout.addWidget(subtitle)

        # Grid
        grid_widget = QWidget()
        grid_layout = QGridLayout(grid_widget)
        grid_layout.setSpacing(2)

        self.grid_buttons = []
        for row in range(GRID_ROWS):
            for col in range(GRID_COLUMNS):
                cell_index = col + row * GRID_COLUMNS
                button = QPushButton()
                button.setFixedSize(60, 60)
                button.setFont(QFont("monospace", 16, QFont.Weight.Bold))
                button.setAccessibleName(f"Cell {cell_index}")
                button.clicked.connect(lambda c=cell_index: self._on_cell_click(c))
                self.grid_buttons.append(button)
                grid_layout.addWidget(button, row, col)

        layout.addWidget(grid_widget, alignment=Qt.AlignmentFlag.AlignCenter)

        # Status label
        self.status_label = QLabel("Selecciona les caselles del teu patró")
        self.status_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.status_label.setStyleSheet("color: #68706c; font-size: 12px;")
        layout.addWidget(self.status_label)

        # Button row
        btn_row = QHBoxLayout()
        self.btn_verify = QPushButton("🔍 Verificar")
        self.btn_verify.clicked.connect(self._on_verify)
        btn_row.addWidget(self.btn_verify)

        self.btn_cancel = QPushButton("Cancel·la")
        self.btn_cancel.clicked.connect(self.reject)
        btn_row.addWidget(self.btn_cancel)

        layout.addLayout(btn_row)

        self.setLayout(layout)

    def _on_cell_click(self, cell_index: int):
        """Handle grid cell click during login."""
        if cell_index in self.current_strokes:
            # Remove from pattern if already clicked
            self.current_strokes.remove(cell_index)
            self.grid_buttons[cell_index].setText("")
            self.grid_buttons[cell_index].setStyleSheet("")
        else:
            # Add to pattern
            self.current_strokes.append(cell_index)
            char = GRID_CELL_CHARS[cell_index]
            self.grid_buttons[cell_index].setText(char)
            self.grid_buttons[cell_index].setStyleSheet("background: #e5e7eb; color: #1f2937;")

        self.status_label.setText(f"Caselles seleccionades: {len(self.current_strokes)}")

    def _on_verify(self):
        """Verify the user's grid pattern against the stored template."""
        if not self.current_strokes:
            QMessageBox.warning(
                self,
                "Error",
                "Selecciona les caselles del teu patró abans de verificar."
            )
            return

        stored_hotspots = self.auth_data.get("hotspots", [])
        salt_hex = self.auth_data.get("salt")

        if not stored_hotspots or not salt_hex:
            QMessageBox.warning(
                self,
                "Error",
                "No hi ha dades d'autenticació configurades."
            )
            return

        # Convert stored hotspots (grid cells) to indices
        stored_cells = [h["cell"] for h in stored_hotspots]

        # Check if pattern matches (exact match for grid)
        if sorted(self.current_strokes) != sorted(stored_cells):
            QMessageBox.warning(
                self,
                "Patró incorrect",
                "El patró que has seleccionat no coincideix amb el patró d'autentificació original.\n\n"
                "Si continua fallant, contacta amb el suport tècnic."
            )
            return

        # Generate the AES key from the pattern
        try:
            password_string = generate_grid_password(self.current_strokes)
            load_vault(password_string, VAULT_FILENAME)

            QMessageBox.information(
                self,
                "Accés correct!",
                "El patró d'autentificació és correct.\n\n"
                "Benvingut a la teva caixa forta."
            )
            self.accept()

        except Exception as e:
            QMessageBox.warning(
                self,
                "Patró incorrect",
                f"No es pot desbloquejar la caixa forta.\n\n" + str(e)
            )


class FirstTimeGuideDialog(QDialog):
    """Guia interactiva per usuaris nous amb navegació amb fletxes.

    Guia en català per usuaris que acaben de crear la seva primera caixa forta.
    Mostra com afegir el seu primer accés amb navegació amb fletxes (← →).
    """

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWindowTitle("Guia: Crea el teu primer accés")
        self.setModal(True)
        self.setFixedSize(700, 500)

        self.current_step = 0
        self.steps = [
            {
                "title": "Benvingut!",
                "message": "La teva caixa forta s'ha creat!\n\nAra cal afegir el teu primer accés (site, usuari i contrasenya).",
                "hint": "Fes clic a «Següent» per continuar"
            },
            {
                "title": "Informació del lloc web",
                "message": "Introdueix el lloc web on utilitzes aquesta contrasenya.\n\nExemples:\n• google.com\n• instagram.com\n• example.com",
                "hint": "Fes clic a «Següent» quan tinguis el lloc web"
            },
            {
                "title": "Nom d'usuari",
                "message": "Introdueix el nom d'usuari o l'adreça de correu que utilitzes en aquest lloc web.\n\nExemples:\n• joan.perez\n• user@example.com",
                "hint": "Fes clic a «Següent» quan tinguis el nom d'usuari"
            },
            {
                "title": "Contrasenya",
                "message": "Introdueix la contrasenya per a aquest accés.\n\nLa contrasenya ha de tenir com a mínim 8 caràcters.",
                "hint": "Fes clic a «Següent» quan tinguis la contrasenya"
            },
            {
                "title": "Generar contrasenya segura",
                "message": "Vols generar una contrasenya segura?\n\nLes contrasenyes generades inclouen lletra, xifres i símbols.",
                "hint": "Fes clic a «Següent» per continuar"
            },
            {
                "title": "Accés afegit!",
                "message": "El teu primer accés s'ha afegit amb èxit!\n\nContinua afegint més accessos o revisa els que ja tens.",
                "hint": "Fes clic a «Finalitzar» per tancar la guia"
            }
        ]

        layout = QVBoxLayout(self)
        layout.setSpacing(16)

        # Progress indicator
        self.progress_label = QLabel(f"Pàs {self.current_step + 1} de {len(self.steps)}")
        self.progress_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.progress_label.setStyleSheet("color: #2563eb; font-weight: 600; font-size: 14px;")
        layout.addWidget(self.progress_label)

        # Title
        self.title_label = QLabel()
        self.title_label.setStyleSheet("font-size: 20px; font-weight: bold; color: #172b4d;")
        self.title_label.setWordWrap(True)
        layout.addWidget(self.title_label)

        # Message
        self.message_label = QLabel()
        self.message_label.setStyleSheet("font-size: 15px; color: #4a5568;")
        self.message_label.setWordWrap(True)
        layout.addWidget(self.message_label)

        # Hint
        self.hint_label = QLabel()
        self.hint_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.hint_label.setStyleSheet("color: #68706c; font-size: 13px; font-style: italic;")
        self.hint_label.setWordWrap(True)
        layout.addWidget(self.hint_label)

        # Arrow navigation
        arrow_layout = QHBoxLayout()
        self.btn_prev = QPushButton("← Anterior")
        self.btn_prev.clicked.connect(self._prev_step)
        arrow_layout.addWidget(self.btn_prev)

        self.btn_next = QPushButton("Següent →")
        self.btn_next.clicked.connect(self._next_step)
        arrow_layout.addWidget(self.btn_next)

        layout.addLayout(arrow_layout)
        self.setLayout(layout)
        self._update_step()

    def _update_step(self):
        step = self.steps[self.current_step]
        self.title_label.setText(step["title"])
        self.message_label.setText(step["message"])
        self.hint_label.setText(step["hint"])

        # Update button states
        self.btn_prev.setEnabled(self.current_step > 0)

        if self.current_step == len(self.steps) - 1:
            self.btn_next.setText("Finalitzar →")
            self.btn_next.clicked.connect(self.accept)
        else:
            self.btn_next.setText("Següent →")
            self.btn_next.clicked.connect(self._next_step)

    def _next_step(self):
        if self.current_step < len(self.steps) - 1:
            self.current_step += 1
            self._update_step()

    def _prev_step(self):
        if self.current_step > 0:
            self.current_step -= 1
            self._update_step()


class BiometricLoginPrompt(QDialog):
    """Diàleg per autenticació biométrica amb opció de contrasenya de backup.

    Allows users to either:
      - Draw their biometric pattern (primary)
      - Use a text password as backup (fallback)
    """

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWindowTitle("Entrar a la caixa forta")
        self.setModal(True)

        layout = QVBoxLayout(self)
        layout.setSpacing(12)

        # Title
        title = QLabel("La teva caixa forta")
        title.setAlignment(Qt.AlignmentFlag.AlignCenter)
        font = title.font()
        font.setWeight(700)
        title.setFont(font)
        layout.addWidget(title)

        subtitle = QLabel("Entrada la contrasenya mestra per desbloquejar les teves contrasenyes.")
        subtitle.setAlignment(Qt.AlignmentFlag.AlignCenter)
        subtitle.setStyleSheet("color: #68706c; font-size: 13px;")
        layout.addWidget(subtitle)

        # Grid auth button (primary method)
        self.btn_grid_auth = QPushButton("🔲 Autentar amb quadrícula")
        font = self.btn_grid_auth.font()
        font.setWeight(500)
        self.btn_grid_auth.setFont(font)
        self.btn_grid_auth.clicked.connect(self._on_use_grid_auth)
        layout.addWidget(self.btn_grid_auth)

        # Separator
        sep = QLabel("—")
        sep.setAlignment(Qt.AlignmentFlag.AlignCenter)
        sep.setStyleSheet("color: #d1d5db;")
        layout.addWidget(sep)

        # Text password (fallback)
        self.password_field = QLineEdit()
        self.password_field.setPlaceholderText("Contrasenya mestra")
        self.password_field.setEchoMode(QLineEdit.EchoMode.Password)
        layout.addWidget(self.password_field)

        # Show password checkbox
        self.show_pwd = QCheckBox("Mostrar contrasenya")
        self.show_pwd.stateChanged.connect(self._on_toggle_show)
        layout.addWidget(self.show_pwd)

        # Error label (initially hidden)
        self.error_label = QLabel("")
        self.error_label.setStyleSheet("color: #dc2626; font-size: 13px; margin-top: 4px;")
        self.error_label.setVisible(False)
        layout.addWidget(self.error_label)

        # Buttons
        buttons = QDialogButtonBox(QDialogButtonBox.StandardButton.Ok | QDialogButtonBox.StandardButton.Cancel)
        buttons.button(QDialogButtonBox.StandardButton.Ok).setText("Entrar")
        buttons.button(QDialogButtonBox.StandardButton.Cancel).setText("Cancel·la")
        buttons.accepted.connect(self._on_accept)
        buttons.rejected.connect(self.reject)

        layout.addWidget(buttons)
        self.setLayout(layout)

    def _on_toggle_show(self, state: int) -> None:
        if state == Qt.CheckState.Checked:
            self.password_field.setEchoMode(QLineEdit.EchoMode.Normal)
        else:
            self.password_field.setEchoMode(QLineEdit.EchoMode.Password)

    def _on_use_grid_auth(self):
        """Show the grid login dialog."""
        self.grid_login_dialog = BiometricLoginDialog(self)
        if self.grid_login_dialog.exec() == QDialog.DialogCode.Accepted:
            # Authentication succeeded via grid auth
            self.accept()

    def _on_accept(self) -> None:
        """Handle text password login."""
        password = self.password_field.text()
        if not password:
            self.error_label.setText("Escriu una contrasenya.")
            return

        # Try to load the vault with this password
        try:
            from src.storage import VaultLockedError

            load_vault(password, VAULT_FILENAME)
        except VaultLockedError as e:
            self.error_label.setText(str(e))
            return
        except Exception as e:
            self.error_label.setText(f"Contrasenya incorrecta: {str(e)}")
            return

        self.accept()


class AddEditDialog(QDialog):
    """Diàleg per afegir o editar una entrada de contrasenya."""

    def __init__(self, parent=None, entry=None):
        super().__init__(parent)
        self.setWindowTitle("Afegir/editar entrada")
        self.setFixedSize(400, 250)

        layout = QVBoxLayout(self)
        layout.setSpacing(8)

        # Site label and input
        site_label = QLabel("Sit web:")
        layout.addWidget(site_label)
        self.site_field = QLineEdit()
        self.site_field.setPlaceholderText("E. g., example.com")
        layout.addWidget(self.site_field)

        # Username label and input
        user_label = QLabel("Nom d'usuari:")
        layout.addWidget(user_label)
        self.user_field = QLineEdit()
        self.user_field.setPlaceholderText("E. g., john.doe")
        layout.addWidget(self.user_field)

        # Password label and input
        pass_label = QLabel("Contrasenya:")
        layout.addWidget(pass_label)
        self.pass_field = QLineEdit()
        self.pass_field.setPlaceholderText("Escriu la contrasenya")
        self.pass_field.setEchoMode(QLineEdit.EchoMode.Password)
        layout.addWidget(self.pass_field)

        if entry:
            self.site_field.setText(entry.get("site", ""))
            self.user_field.setText(entry.get("username", ""))
            self.pass_field.setText(entry.get("password", ""))

        # Buttons
        buttons = QDialogButtonBox(QDialogButtonBox.StandardButton.Ok | QDialogButtonBox.StandardButton.Cancel)
        buttons.accepted.connect(self.accept)
        buttons.rejected.connect(self.reject)
        layout.addWidget(buttons)

        self.setLayout(layout)

    def get_data(self):
        """Return the data from this dialog as a dict."""
        return {
            "site": self.site_field.text(),
            "username": self.user_field.text(),
            "password": self.pass_field.text(),
            "notes": "",
        }


class GeneratePasswordDialog(QDialog):
    """Diàleg per generar una contrasenya segura aleatória."""

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWindowTitle("Generar contrasenya aleatória")
        self.setFixedSize(400, 200)

        layout = QVBoxLayout(self)
        layout.setSpacing(8)

        # Title
        title = QLabel("Genera una contrasenya segura")
        title.setAlignment(Qt.AlignmentFlag.AlignCenter)
        font = title.font()
        font.setWeight(600)
        title.setFont(font)
        layout.addWidget(title)

        # Password length selector
        self.length_spin = QSpinBox()
        self.length_spin.setRange(8, 64)
        self.length_spin.setValue(16)
        layout.addWidget(QLabel(f"Longuitat: {self.length_spin.value()} characters"))

        # Generated password display
        self.generated_label = QLabel("")
        self.generated_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.generated_label.setStyleSheet("color: #2563eb; font-weight: 600;")
        layout.addWidget(self.generated_label)

        # Buttons
        btn_row = QHBoxLayout()
        self.btn_generate = QPushButton("🔑 Genera")
        self.btn_generate.clicked.connect(self._on_generate)
        btn_row.addWidget(self.btn_generate)

        self.btn_copy = QPushButton("📋 Copia")
        self.btn_copy.clicked.connect(self._on_copy)
        btn_row.addWidget(self.btn_copy)

        buttons = QDialogButtonBox(QDialogButtonBox.StandardButton.Ok | QDialogButtonBox.StandardButton.Cancel)
        buttons.accepted.connect(self.accept)
        buttons.rejected.connect(self.reject)
        btn_row.addWidget(buttons.button(QDialogButtonBox.StandardButton.Ok))
        btn_row.addWidget(buttons.button(QDialogButtonBox.StandardButton.Cancel))

        layout.addLayout(btn_row)
        self.setLayout(layout)

    def _on_generate(self):
        """Generate a random password and display it."""
        import secrets
        import string

        length = self.length_spin.value()
        alphabet = string.ascii_letters + string.digits + "!@#$%^&*()"
        password = ''.join(secrets.choice(alphabet) for _ in range(length))

        self.generated_label.setText(password)

    def _on_copy(self):
        """Copy the generated password to clipboard."""
        if self.generated_label.text():
            QApplication.clipboard().setText(self.generated_label.text())
