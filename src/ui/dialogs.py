import os
from src.ui.qt_compat import (
    QDialog,
    QFormLayout,
    QLineEdit,
    QDialogButtonBox,
    QCheckBox,
    QSpinBox,
    QVBoxLayout,
    QLabel,
    Qt,
)

from src.storage import load_vault, VAULT_FILENAME, VaultLockedError


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

        layout = QVBoxLayout()
        layout.setSpacing(16)

        # Title
        title = QLabel("La teva caixa forta")
        title.setAlignment(Qt.AlignmentFlag.AlignCenter)
        title.setFont(title.font().copied())
        title.setFontWeight(750)
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
        buttons = QDialogButtonBox(QDialogButtonBox.StandardButton.Ok | QDialogButtonButtonBox.StandardButton.Cancel)
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
            self.error_label.setText("La contrasenya no pot ser buida.")
            return

        if self._vault_exists:
            try:
                load_vault(password, VAULT_FILENAME)
                self.accept()
            except VaultLockedError as e:
                self.error_label.setText(str(e))
            except ValueError as e:
                if str(e) == "La contrasenya mestra ha de tenir com a mínim 16 caràcters":
                    self.error_label.setText("La contrasenya mestra ha de tenir com a mínim 16 caràcters.")
                elif str(e) == "Format de caixa forta invàlid" or str(e) == "Format de caixa forta no compatible":
                    self.error_label.setText("El format de la caixa forta és invàlid.")
                else:
                    self.error_label.setText("Contrasenya incorrecta.")
            except Exception as e:
                if "locked" in str(e).lower():
                    self.error_label.setText("La caixa forta és bloquejada. Intenta més avunt.")
                else:
                    self.error_label.setText(f"Error: {str(e)}")

    def has_vault(self) -> bool:
        """Return True if a vault file exists and requires authentication."""
        return self._vault_exists


class AddEditDialog(QDialog):
    """Diàleg emprat per afegir o editar un accés."""

    def __init__(self, parent=None, entry: dict | None = None):
        super().__init__(parent)
        self.setWindowTitle("Afegir accés" if entry is None else "Editar accés")
        self.setModal(True)

        self.site = QLineEdit()
        self.username = QLineEdit()
        self.password = QLineEdit()
        self.password.setEchoMode(QLineEdit.EchoMode.Password)
        self.show_pwd = QCheckBox("Mostrar contrasenya")
        self.show_pwd.stateChanged.connect(self._on_toggle_show)
        self.notes = QLineEdit()

        form = QFormLayout()
        form.addRow("Lloc web / Servei:", self.site)
        form.addRow("Nom d'usuari:", self.username)
        form.addRow("Contrasenya:", self.password)
        form.addRow("", self.show_pwd)
        form.addRow("Notes:", self.notes)

        buttons = QDialogButtonBox(QDialogButtonBox.StandardButton.Ok | QDialogButtonButtonBox.StandardButton.Cancel)
        buttons.button(QDialogButtonBox.StandardButton.Ok).setText("D'acord")
        buttons.button(QDialogButtonBox.StandardButton.Cancel).setText("Cancel·la")
        buttons.accepted.connect(self.accept)
        buttons.rejected.connect(self.reject)

        layout = QVBoxLayout()
        layout.addLayout(form)
        layout.addWidget(buttons)
        self.setLayout(layout)

        if entry:
            self.site.setText(entry.get("site", ""))
            self.username.setText(entry.get("username", ""))
            self.password.setText(entry.get("password", ""))
            self.notes.setText(entry.get("notes", ""))

    def _on_toggle_show(self, state: int) -> None:
        if state == Qt.CheckState.Checked:
            self.password.setEchoMode(QLineEdit.EchoMode.Normal)
        else:
            self.password.setEchoMode(QLineEdit.EchoMode.Password)

    def get_data(self) -> dict:
        return {
            "site": self.site.text().strip(),
            "username": self.username.text().strip(),
            "password": self.password.text(),
            "notes": self.notes.text().strip(),
        }


class GeneratePasswordDialog(QDialog):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWindowTitle("Generador de contrasenyes")
        self.setModal(True)

        self.length = QSpinBox()
        self.length.setRange(6, 128)
        self.length.setValue(16)
        self.upper = QCheckBox("Majúscules")
        self.upper.setChecked(True)
        self.numbers = QCheckBox("Nombres")
        self.numbers.setChecked(True)
        self.symbols = QCheckBox("Símbols")
        self.symbols.setChecked(True)

        form = QFormLayout()
        form.addRow("Longitud:", self.length)
        form.addRow(self.upper)
        form.addRow(self.numbers)
        form.addRow(self.symbols)

        self.preview = QLabel("")
        form.addRow("Vista prèvia:", self.preview)

        buttons = QDialogButtonBox(QDialogButtonBox.StandardButton.Ok | QDialogButtonButton.Cancel)
        buttons.button(QDialogButtonBox.StandardButton.Ok).setText("D'acord")
        buttons.button(QDialogButtonBox.StandardButton.Cancel).setText("Cancel·la")
        buttons.accepted.connect(self.accept)
        buttons.rejected.connect(self.reject)

        layout = QVBoxLayout()
        layout.addLayout(form)
        layout.addWidget(buttons)
        self.setLayout(layout)

    def get_options(self) -> dict:
        return {
            "length": int(self.length.value()),
            "use_upper": bool(self.upper.isChecked()),
            "use_numbers": bool(self.numbers.isChecked()),
            "use_symbols": bool(self.symbols.isChecked()),
        }
