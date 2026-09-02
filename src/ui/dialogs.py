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
)


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

        # Validate password length (minimum 8 characters)
        if len(password) < 8:
            self.error_label.setText("La contrasenya ha de ser d'almenys 8 characters.")
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


class ImageAuthSetupDialog(QDialog):
    """Wizard dialog for setting up image-based biometric authentication.

    The user:
      1. Uploads an image (their "biometric canvas")
      2. Draws a sequence of strokes/clicks on it (their "biometric password")
      3. The system stores both and derives an AES key from the strokes
    """

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWindowTitle("Configurar autenticació per imatge")
        self.setFixedSize(600, 750)

        # State tracking
        self.current_step = 0  # 0: select image, 1: draw pattern
        self.selected_image_path = None
        self.original_pixmap = None
        self.drawn_strokes: list[dict] = []  # List of {"x_pct": float, "y_pct": float}
        self.max_strokes = 20

        # UI setup
        self.setup_ui()

    def setup_ui(self):
        layout = QVBoxLayout(self)
        layout.setSpacing(12)

        # Step indicator
        self.step_label = QLabel("Pass 1 de 2: Selecciona una imatge")
        self.step_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.step_label.setFont(self.step_label.font().copied())
        self.step_label.setFontWeight(600)
        layout.addWidget(self.step_label)

        # Step 1: Image selection and preview
        self.image_preview = QLabel("Select an image to get started")
        self.image_preview.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.image_preview.setStyleSheet(
            "border: 2px dashed #d1d5db; border-radius: 8px; "
            "background: #f9fafb; padding: 40px; min-height: 250px;"
        )
        self.image_preview.setMinimumHeight(180)
        layout.addWidget(self.image_preview)

        # Button row for step 1
        btn_row = QHBoxLayout()
        self.btn_select_image = QPushButton("📁 Selecciona imatge")
        self.btn_select_image.clicked.connect(self._on_select_image)
        btn_row.addWidget(self.btn_select_image)

        self.btn_cancel = QPushButton("Cancel·la")
        self.btn_cancel.clicked.connect(self.reject)
        btn_row.addWidget(self.btn_cancel)

        layout.addLayout(btn_row)

    def _on_select_image(self):
        """Open file dialog to select an image."""
        file_dialog = QFileDialog.getOpenFileName(
            self,
            "Selecciona imatge",
            "",
            "Images (*.png *.jpg *.jpeg *.bmp *.svg);;All files (*)"
        )

        if file_dialog[0]:  # Valid path selected
            self.selected_image_path = file_dialog[0]

            # Load and preview the image
            pixmap = QPixmap(self.selected_image_path)
            if pixmap.isNull():
                QMessageBox.warning(
                    self,
                    "Error",
                    "No es pot carregar l'imgatge seleccionat."
                )
                return

            # Scale to fit within preview area while maintaining aspect ratio
            scaled = pixmap.scaled(500, 200, Qt.AspectRatioMode.KeepAspectRatio,
                                   Qt.TransformationMode.SmoothTransformation)

            # Create a painter overlay showing click zones
            self.original_pixmap = pixmap
            self.image_preview.setPixmap(scaled)

            self.step_label.setText("Pass 2 de 2: Dibuixa el teu patró")
            self.btn_select_image.setEnabled(False)

            # Add instruction label
            instruction = QLabel(
                "Dibuixa o faga clics per crear el teu patró d'autentificació.\n"
                "Utilitza les mateixes posicions quan volis desbloquejar la caixa forta."
            )
            instruction.setAlignment(Qt.AlignmentFlag.AlignCenter)
            instruction.setStyleSheet("color: #68706c; font-size: 12px; margin-top: 8px;")
            layout = self.layout()
            instruction_index = layout.count() - 1
            layout.insertWidget(instruction_index, instruction)

            # Add a "Finish setup" button that's hidden until image is selected
            finish_btn = QPushButton("✅ Finalitzar configuració")
            self.finish_button = finish_btn
            finish_btn.setFont(finish_btn.font().copied())
            finish_btn.setFontWeight(500)
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

    def _on_finish_setup(self):
        """Process the image drawing for biometric pattern."""
        if not self.original_pixmap or not self.drawn_strokes:
            QMessageBox.warning(
                self,
                "Error",
                "Dibuixa el teu patró abans de finalitzar la configuració."
            )
            return

        # Convert to base64 for storage
        buffer = bytearray()
        pixmap_bytes = self.original_pixmap.toData()
        pixmap_bytes = QPixmap(pixmap_bytes).toPng(buffer)

        image_b64 = base64.b64encode(buffer).decode("ascii")

        # Save the image auth template
        save_image_auth(
            image_b64=image_b64,
            hotspots=self.drawn_strokes,
        )

        QMessageBox.information(
            self,
            "Autenticació configurada!",
            "La imatge i el teu patró d'autentificació s'han guardat.\n\n"
            "La pròxima vegada, dibujaràs el mateix patró per desbloquejar la caixa forta."
        )

        self.accept()


class BiometricLoginDialog(QDialog):
    """Diàleg de login per autenticació biométrica (draw/click pattern).

    The user draws their stored pattern on the template image.
    If the pattern matches within tolerance, authentication succeeds.
    """

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWindowTitle("Entrar a la caixa forta")
        self.setModal(True)
        self.setFixedSize(500, 650)

        # State tracking
        self.current_strokes: list[dict] = []  # Active strokes being drawn
        self.auth_data = None  # Loaded image auth data

        # Load stored template
        self.auth_data = load_image_auth()

        if not self.auth_data or not self.auth_data.get("image_b64"):
            QMessageBox.warning(
                self,
                "Error",
                "No hi ha cap plantilla d'autenticació per imatge configurada."
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
        title.setFont(title.font().copied())
        title.setFontWeight(750)
        layout.addWidget(title)

        subtitle = QLabel("Dibuixa el teu patró d'autentificació")
        subtitle.setAlignment(Qt.AlignmentFlag.AlignCenter)
        subtitle.setStyleSheet("color: #68706c; font-size: 13px;")
        layout.addWidget(subtitle)

        # Draw canvas (uses original pixmap as base, draws strokes on top)
        self.draw_canvas = QLabel()
        self.draw_canvas.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.draw_canvas.setStyleSheet(
            "border: 2px solid #3b82f6; border-radius: 10px; background: white;"
        )

        # Load and set the template image
        self.base_pixmap = QPixmap()
        if self.auth_data.get("image_b64"):
            try:
                image_bytes = base64.b64decode(self.auth_data["image_b64"])
                pixmap = QPixmap()
                pixmap.loadFromData(image_bytes)
                self.base_pixmap = pixmap.scaled(400, 250,
                                           Qt.AspectRatioMode.KeepAspectRatio,
                                           Qt.TransformationMode.SmoothTransformation)
            except Exception as e:
                QMessageBox.warning(
                    self, "Error", f"No es pot carregar l'imgatge: {str(e)}"
                )
                self.reject()
                return

        self.draw_canvas.setPixmap(self.base_pixmap)
        layout.addWidget(self.draw_canvas)

        # Status label
        self.status_label = QLabel("Dibuixa el teu patró")
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
        self.setCursor(QCursor(Qt.CursorShape.CrossCursor))

    def paintEvent(self, event):
        """Custom painting to show strokes."""
        painter = QPainter(self.draw_canvas)

        # Draw the base image
        painter.drawPixmap(0, 0, self.base_pixmap)

        # Draw the strokes
        for stroke in self.current_strokes:
            x = stroke["x_pct"] * self.base_pixmap.width()
            y = stroke["y_pct"] * self.base_pixmap.height()

            painter.setPen(QColor("#2563eb"))
            painter.setBrush(QColor("#2563eb"))
            painter.drawEllipse(x - 4, y - 4, 8, 8)

            # Draw line from previous stroke to this one
            if len(self.current_strokes) > 1:
                prev = self.current_strokes[-2]
                prev_x = prev["x_pct"] * self.base_pixmap.width()
                prev_y = prev["y_pct"] * self.base_pixmap.height()

                painter.setPen(QColor("#2563eb"))
                painter.drawLine(prev_x, prev_y, x, y)

        painter.end()

    def mousePressEvent(self, event):
        """Handle click to add a stroke point."""
        pos = event.globalPos() - self.draw_canvas.mapFromGlobal(event.pos())

        if not self.base_pixmap.isNull():
            x_pct = pos.x() / self.base_pixmap.width()
            y_pct = pos.y() / self.base_pixmap.height()

            # Clamp to 0-1 range
            x_pct = max(0.0, min(1.0, x_pct))
            y_pct = max(0.0, min(1.0, y_pct))

            self.current_strokes.append({"x_pct": x_pct, "y_pct": y_pct})
            self.status_label.setText(f"Punts: {len(self.current_strokes)}")

    def mouseMoveEvent(self, event):
        """Handle drag to add continuous stroke points."""
        pos = event.globalPos() - self.draw_canvas.mapFromGlobal(event.pos())

        if not self.base_pixmap.isNull():
            x_pct = pos.x() / self.base_pixmap.width()
            y_pct = pos.y() / self.base_pixmap.height()

            x_pct = max(0.0, min(1.0, x_pct))
            y_pct = max(0.0, min(1.0, y_pct))

            self.current_strokes.append({"x_pct": x_pct, "y_pct": y_pct})
            self.status_label.setText(f"Punts: {len(self.current_strokes)}")

    def _on_verify(self):
        """Verify the user's drawn pattern against the stored template."""
        if not self.current_strokes:
            QMessageBox.warning(
                self,
                "Error",
                "Dibuixa el teu patró abans de verificar."
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

        # Check if pattern matches within tolerance
        is_match = verify_image_auth_pattern(
            self.current_strokes,
            stored_hotspots,
            salt_hex
        )

        if is_match:
            # Generate the AES key from the hotspots
            try:
                from src.encryption import derive_key_from_hotspots

                derive_key_from_hotspots(stored_hotspots, salt_hex)
            except Exception as e:
                QMessageBox.critical(self, "Error", f"Error derivant la clau: {str(e)}")
                return

            # Try to load the vault with this key
            try:
                coords = ";".join(
                    f"{point['x_pct']:.6f},{point['y_pct']:.6f}"
                    for point in stored_hotspots
                )
                password_string = f"hotspots:{coords};salt:{salt_hex}"
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
        else:
            QMessageBox.warning(
                self,
                "Patró incorrect",
                "El patró dibuit no coincideix amb el guardat.\n\n"
                "Intenta dibuixa el mateix patrón."
            )


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
        title.setFont(title.font().copied())
        title.setFontWeight(700)
        layout.addWidget(title)

        subtitle = QLabel("Entrada la contrasenya mestra per desbloquejar les teves contrasenyes.")
        subtitle.setAlignment(Qt.AlignmentFlag.AlignCenter)
        subtitle.setStyleSheet("color: #68706c; font-size: 13px;")
        layout.addWidget(subtitle)

        # Image auth button (primary method)
        self.btn_image_auth = QPushButton("🖼 Autentar amb imatge")
        self.btn_image_auth.setFont(self.btn_image_auth.font().copied())
        self.btn_image_auth.setFontWeight(500)
        self.btn_image_auth.clicked.connect(self._on_use_image_auth)
        layout.addWidget(self.btn_image_auth)

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
        buttons = QDialogButtonBox(QDialogButtonBox.StandardButton.Ok | QDialogButtonButtonBox.StandardButton.Cancel)
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

    def _on_use_image_auth(self):
        """Show the biometric login dialog."""
        self.image_login_dialog = BiometricLoginDialog(self)
        if self.image_login_dialog.exec() == QDialog.DialogCode.Accepted:
            # Authentication succeeded via image auth
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

    def __init__(self, parent=None):
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

        # Buttons
        buttons = QDialogButtonBox(QDialogButtonBox.StandardButton.Ok | QDialogButtonButtonBox.StandardButton.Cancel)
        buttons.accepted.connect(self.accept)
        buttons.rejected.connect(self.reject)
        layout.addWidget(buttons)

        self.setLayout(layout)

    def get_data(self):
        """Return the data from this dialog as a dict."""
        return {
            "site": self.site_field.text(),
            "user": self.user_field.text(),
            "password": self.pass_field.text(),
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
        title.setFont(title.font().copied())
        title.setFontWeight(600)
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

        buttons = QDialogButtonBox(QDialogButtonBox.StandardButton.Ok | QDialogButtonButtonBox.StandardButton.Cancel)
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
