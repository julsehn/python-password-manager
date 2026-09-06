import os
import time

from src.ui.qt_compat import (
    QMainWindow,
    QLabel,
    QWidget,
    QVBoxLayout,
    QHBoxLayout,
    QPushButton,
    QDialog,
    QTableWidget,
    QTableWidgetItem,
    QMessageBox,
    QInputDialog,
    QLineEdit,
    QApplication,
    Qt,
    QListWidget,
    QListWidgetItem,
    QSplitter,
    QFrame,
    QScrollArea,
    QSizePolicy,
    QToolButton,
    QIcon,
    QMenu,
    QAction,
    QPixmap,
    QPainter,
    QColor,
    QCursor,
    QTimer,
    QSpinBox,
    QColorDialog,
)

from src.password_manager import PasswordManager
from src.remote_vault import RemoteVaultStore
from src.ui.dialogs import AddEditDialog, GeneratePasswordDialog, LoginDialog
from src.ui.tutorial_dialog import TutorialDialog
from src.storage import (
    save_vault,
    load_vault,
    export_vault,
    VAULT_FILENAME,
    SIDEBAR_SETTINGS_FILENAME,
    LOCKOUT_STATE_FILENAME,
    save_config,
    load_sidebar_settings,
    save_sidebar_settings,
    load_config,
    DEFAULT_CONFIG,
)
from pathlib import Path
import webbrowser

# Load configuration
CONFIG = load_config()
SESSION_TIMEOUT_SECONDS = CONFIG.get("auto_lock_seconds", 300)
CLIPBOARD_CLEAR_SECONDS = CONFIG.get("clipboard_clear_seconds", 30)

CARD_STYLE = """
QWidget.card { background: #ffffff; border: 1px solid #dbe3eb; border-radius: 12px; }
QWidget.card:hover { border: 1px solid #a9c9e6; background: #fcfeff; }
QLabel.site { color: #172b4d; font-weight: 650; font-size: 14px; }
QLabel.user { color: #68706c; font-size: 12px; }
QLabel.site_icon { background: #e4f5fa; border-radius: 18px; padding: 8px; }
QPushButton.action { background: #2563eb; color: white; padding: 6px 10px; border-radius: 8px; }
QPushButton.flat { background: transparent; border: none; }
QToolButton.card_action { background: #fbfdff; border: 1px solid #e6eef5; padding: 0px; border-radius: 8px; }
QToolButton.card_action:hover { background: #f1f5f9; }
QToolButton.more_action { background: #fbfdff; border: 1px solid #e6eef5; padding: 0px; border-radius: 8px; }
QToolButton.more_action:hover { background: #f1f5f9; }
"""

NAV_STYLE = """
QWidget#bottom_nav {
    background: #ffffff;
    border-top: 1px solid #dfe4e1;
}
QToolButton.nav_tab {
    color: #65706c;
    border: none;
    padding: 2px 12px 1px;
    min-width: 82px;
    min-height: 58px;
    font-size: 11px;
    border-radius: 8px;
}
QToolButton.nav_tab:checked {
    color: #2563eb;
    font-weight: 600;
}
QToolButton.nav_tab:hover {
    background: #f3f6f5;
}
"""

APP_STYLE = """
QListWidget#sidebar {
    background: #f8fafc;
    border: none;
    border-right: 1px solid #e1e8ef;
    padding: 12px 10px;
}
QListWidget#sidebar::item {
    color: #526276;
    border-radius: 9px;
    padding: 8px 10px;
    margin: 2px 0;
}
QListWidget#sidebar::item:selected {
    color: #175ea8;
    background: #e5f1fb;
    font-weight: 600;
}
QLineEdit#search {
    background: #ffffff;
    border: 1px solid #d5e0e9;
    border-radius: 10px;
    color: #172b4d;
    padding: 0 12px;
    selection-background-color: #cfe5fa;
}
QLineEdit#search:focus { border: 2px solid #3987d5; }
QLabel#eyebrow { color: #3987d5; font-size: 11px; font-weight: 700; }
QLabel#page_title { color: #172b4d; font-size: 24px; font-weight: 700; }
QLabel#page_subtitle { color: #68706c; font-size: 12px; }
QLabel#status { color: #68706c; padding: 6px 2px; }
QLabel#empty_state { color: #68706c; font-size: 13px; padding: 32px; }
"""


class MainWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("Caixa forta")
        self.setGeometry(120, 80, 1100, 700)
        self.setStyleSheet(APP_STYLE)

        # Security: track last activity for auto-lock
        self._last_activity = time.time()
        self._auto_lock_timer = QTimer(self)
        self._auto_lock_timer.timeout.connect(self._on_session_timeout)

        self.manager = PasswordManager()
        self.remote_store = RemoteVaultStore(CONFIG)
        self._initialized = False
        self._master_password = None
        self._init_ui()

        # Security: Initialize login state (authenticate on startup)
        self._init_login_state()

    def _init_ui(self):
        self.status = QLabel("Preparat")
        self.status.setObjectName("status")
        self.status.setToolTip("Ready - Click for status details")
        self.sidebar_settings = load_sidebar_settings()
        self.sidebar = QListWidget()
        self.sidebar.setObjectName("sidebar")
        self.sidebar.setContextMenuPolicy(Qt.ContextMenuPolicy.CustomContextMenu)
        self.sidebar.customContextMenuRequested.connect(self._on_sidebar_menu)

        self.search = QLineEdit()
        self.search.setObjectName("search")
        self.search.setPlaceholderText("Cerca accessos")
        self.search.textChanged.connect(self.on_search)
        self.list_area = QListWidget()
        self.list_area.setSpacing(8)
        self.list_area.setFrameShape(QFrame.Shape.NoFrame)

        add_button = QPushButton("Afegir accés")
        add_button.clicked.connect(self.on_add)
        self.nav_vault = self._create_nav_tab("Caixa forta", Path())
        self.nav_vault.setChecked(True)
        self.nav_vault.clicked.connect(self.show_vault)
        self.nav_settings = self._create_nav_tab("Configuració", Path())
        self.nav_settings.clicked.connect(self.show_settings)

        sidebar_layout = QVBoxLayout()
        sidebar_layout.addWidget(self.sidebar)
        sidebar_layout.addWidget(self.nav_settings)
        sidebar_widget = QWidget()
        sidebar_widget.setLayout(sidebar_layout)

        content_layout = QVBoxLayout()
        content_layout.addWidget(self.search)
        content_layout.addWidget(add_button)
        content_layout.addWidget(self.list_area)
        content_layout.addWidget(self.status)
        content_widget = QWidget()
        content_widget.setLayout(content_layout)

        splitter = QSplitter()
        splitter.addWidget(sidebar_widget)
        splitter.addWidget(content_widget)
        splitter.setStretchFactor(1, 1)
        self.setCentralWidget(splitter)
        self._init_sidebar()

        remote_menu = self.menuBar().addMenu("Remot")
        remote_menu.addAction(QAction("Puja la caixa forta", self, triggered=self._sync_upload))
        remote_menu.addAction(QAction("Descarrega la caixa forta", self, triggered=self._sync_download))

    def _on_session_timeout(self):
        """Auto-lock after inactivity."""
        now = time.time()
        if now - self._last_activity > SESSION_TIMEOUT_SECONDS:
            self.show_login_dialog()

    def _on_last_activity(self):
        """Reset auto-lock timer on user activity."""
        self._last_activity = time.time()

    def show_login_dialog(self):
        """Show login dialog to authenticate with master password."""
        if self._initialized:
            # If we're already authenticated, just show login to re-auth
            self.status.setText("Sesón inactiu. Entra de nou.")
        else:
            self.status.setText("Entrada la contrasenya mestra per començar.")

        dlg = LoginDialog(self, remote=self.remote_store.configured)
        if dlg.exec() == QDialog.DialogCode.Accepted:
            self._load_vault(dlg.password_field.text())
        elif not self._initialized and not self.remote_store.configured and not os.path.exists(VAULT_FILENAME):
            self._initialize_new_vault()

    def _load_vault(self, master_password=None):
        """Load vault after successful login."""
        if not master_password:
            return False
        try:
            if self.remote_store.configured:
                # Auto-download from remote server
                entries, version = self.remote_store.load(master_password)
                CONFIG["railway_version"] = version
                save_config(CONFIG)
                self.manager.entries = entries
            else:
                entries = load_vault(master_password)
            self._master_password = master_password
            self._initialized = True
            self.refresh_cards()
            status_msg = "Caixa forta remota - Accés correcte" if self.remote_store.configured else "Caixa forta - Accés correcte"
            self.status.setText(status_msg)
            
            # Check for sync indicators
            if self.remote_store.configured and entries:
                self.status.setStyleSheet("color: #16803c; font-weight: 600;")
            
            return True
        except Exception as error:
            self._show_remote_error("No s'ha pogut carregar la caixa forta", error)
            self.status.setText("Error de càrrega")
            self.status.setStyleSheet("color: #dc2626; font-weight: 600;")
            return False

    def _initialize_new_vault(self):
        """Initialize a new vault with master password prompt."""
        # Create master password dialog for first-time setup
        dlg = QDialog(self)
        dlg.setWindowTitle("Crear caixa forta nova")
        layout = QVBoxLayout(dlg)

        label1 = QLabel("Benvingut a la teva caixa forta!")
        layout.addWidget(label1)

        label2 = QLabel("Crea una contrasenya mestra segura:")
        layout.addWidget(label2)

        self.new_password = QLineEdit()
        self.new_password.setEchoMode(QLineEdit.EchoMode.Password)
        layout.addWidget(self.new_password)

        self.confirm_password = QLineEdit()
        self.confirm_password.setEchoMode(QLineEdit.EchoMode.Password)
        layout.addWidget(self.confirm_password)

        error_label = QLabel("")
        layout.addWidget(error_label)

        ok_btn = QPushButton("Crear")
        cancel_btn = QPushButton("Cancel·la")
        buttons_layout = QHBoxLayout()
        buttons_layout.addWidget(ok_btn)
        buttons_layout.addWidget(cancel_btn)
        layout.addLayout(buttons_layout)

        def create_vault():
            pw = self.new_password.text()
            confirm = self.confirm_password.text()

            if len(pw) < 16:
                error_label.setText("La contrasenya mestra ha de tenir com a mínim 16 caràcters.")
                return

            if pw != confirm:
                error_label.setText("Les contrasenyes no coincideixen.")
                return

            if self.remote_store.has_server:
                self.remote_store.save([], pw)
                save_config(CONFIG)
            else:
                save_vault([], pw)
            self._master_password = pw
            self._initialized = True
            dlg.accept()

        ok_btn.clicked.connect(create_vault)
        cancel_btn.clicked.connect(dlg.reject)

        if dlg.exec() == QDialog.DialogCode.Accepted:
            self._initialized = True
            self.status.setText("Caixa forta creada!")

    def _init_login_state(self):
        """Check if vault exists and show login dialog."""
        from src.storage import VAULT_FILENAME, load_vault

        if self.remote_store.configured or os.path.exists(VAULT_FILENAME):
            self.show_login_dialog()
        else:
            # First-time setup: create new vault
            self._initialize_new_vault()

    def _create_nav_tab(self, label: str, icon_path):
        button = QToolButton()
        button.setObjectName("nav_tab")
        button.setProperty("class", "nav_tab")
        button.setText(label)
        try:
            pix = QPixmap(str(icon_path)).scaled(28, 28, Qt.AspectRatioMode.KeepAspectRatio, Qt.TransformationMode.SmoothTransformation)
            button.setIcon(QIcon(pix))
            button.setIconSize(pix.size())
        except Exception:
            button.setIcon(QIcon(str(icon_path)))
        button.setToolButtonStyle(Qt.ToolButtonStyle.ToolButtonTextUnderIcon)
        button.setCheckable(True)
        button.setAutoExclusive(True)
        button.setCursor(Qt.CursorShape.PointingHandCursor)
        button.setFixedSize(96, 58)
        return button

    def _init_sidebar(self):
        icons_path = Path(__file__).resolve().parent / "icons"
        default_icon = icons_path / "vault.svg"
        defaults = (
            ("Tots els elements", "vault.svg", "#e9f5fb"),
            ("Carpeta: Favorits", "star.svg", "#fff5d6"),
            ("Carpeta: Social", "heart.svg", "#ffe7ed"),
        )
        for index, (default_name, default_filename, default_color) in enumerate(defaults):
            saved = self.sidebar_settings[index] if index < len(self.sidebar_settings) else {}
            name = saved.get("name", default_name)
            icon_path = Path(saved.get("icon", icons_path / default_filename))
            if not icon_path.is_absolute():
                icon_path = icons_path / icon_path.name
            if not icon_path.exists():
                icon_path = default_icon
            color = saved.get("color", default_color)
            item = QListWidgetItem(name)
            pix = self._create_colored_icon(icon_path, color)
            item.setIcon(QIcon(pix))
            font = item.font()
            font.setPointSize(12)
            item.setFont(font)
            item.setData(Qt.ItemDataRole.UserRole, str(icon_path))
            item.setData(Qt.ItemDataRole.UserRole + 1, color)
            self.sidebar.addItem(item)

    def _save_sidebar_settings(self):
        settings = []
        for index in range(self.sidebar.count()):
            item = self.sidebar.item(index)
            settings.append({
                "name": item.text(),
                "icon": item.data(Qt.ItemDataRole.UserRole),
                "color": item.data(Qt.ItemDataRole.UserRole + 1),
            })
        save_sidebar_settings(settings)

    def _create_colored_icon(self, icon_path, color_str):
        pix_size = 36
        pix = QPixmap(pix_size, pix_size)
        pix.fill(Qt.GlobalColor.transparent)
        painter = QPainter(pix)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing)
        color = QColor(color_str) if color_str else None
        if color:
            painter.setBrush(color)
            painter.setPen(Qt.GlobalColor.transparent)
            painter.drawRoundedRect(0, 0, pix_size, pix_size, 10, 10)
        try:
            icon_pix = QPixmap(str(icon_path)).scaled(20, 20, Qt.AspectRatioMode.KeepAspectRatio, Qt.TransformationMode.SmoothTransformation)
            painter.drawPixmap((pix_size - icon_pix.width()) // 2, (pix_size - icon_pix.height()) // 2, icon_pix)
        except Exception:
            pass
        painter.end()
        return pix

    def _on_sidebar_menu(self, pos):
        item = self.sidebar.itemAt(pos)
        if not item:
            return
        menu = QMenu(self)
        menu.addAction(QAction("Reanomena", menu, triggered=lambda: self._rename_sidebar_item(item)))
        menu.addAction(QAction("Canvia la icona", menu, triggered=lambda: self._change_sidebar_icon(item)))
        menu.addAction(QAction("Canvia el color de la icona", menu, triggered=lambda: self._change_sidebar_icon_color(item)))
        menu.exec(self.sidebar.mapToGlobal(pos))

    def _rename_sidebar_item(self, item: QListWidgetItem):
        text, ok = QInputDialog.getText(self, "Reanomena", "Nom nou:", text=item.text())
        if ok and text:
            item.setText(text)
            self._save_sidebar_settings()

    def _change_sidebar_icon(self, item: QListWidgetItem):
        icons_path = Path(__file__).resolve().parent / "icons"
        files = [p for p in icons_path.iterdir() if p.suffix.lower() in ('.svg', '.png')]
        menu = QMenu(self)
        for f in files:
            act = QAction(f.name, menu, triggered=lambda checked, p=f: self._apply_sidebar_icon(item, p))
            act.setIcon(QIcon(str(f)))
            menu.addAction(act)
        menu.exec(QCursor.pos())

    def _apply_sidebar_icon(self, item: QListWidgetItem, path: Path):
        color = item.data(Qt.ItemDataRole.UserRole + 1) or "#e9f5fb"
        pix = self._create_colored_icon(path, color)
        item.setIcon(QIcon(pix))
        item.setData(Qt.ItemDataRole.UserRole, str(path))
        self._save_sidebar_settings()

    def _change_sidebar_icon_color(self, item: QListWidgetItem):
        color = QColorDialog.getColor()
        if color.isValid():
            icon_path = item.data(Qt.ItemDataRole.UserRole) or str(Path(__file__).resolve().parent / "icons" / "vault.svg")
            pix = self._create_colored_icon(Path(icon_path), color.name())
            item.setIcon(QIcon(pix))
            item.setData(Qt.ItemDataRole.UserRole + 1, color.name())
            self._save_sidebar_settings()

    def show_vault(self):
        self.nav_vault.setChecked(True)
        self.refresh_cards()
        self.status.setText("Caixa forta")

    def show_settings(self):
        self.nav_settings.setChecked(True)
        self.status.setText("Configuració")

        # Create a configuration dialog
        dlg = QDialog(self)
        dlg.setWindowTitle("Configuració")
        layout = QVBoxLayout(dlg)

        layout.addWidget(QLabel("Tèrmins de seguretat"))
        
        self.clip_spin = QSpinBox()
        self.clip_spin.setRange(1, 3600)
        self.clip_spin.setValue(CONFIG.get("clipboard_clear_seconds", 30))
        layout.addWidget(QLabel("Segons per netejar la ténegua:"))
        layout.addWidget(self.clip_spin)

        self.lock_spin = QSpinBox()
        self.lock_spin.setRange(1, 3600)
        self.lock_spin.setValue(CONFIG.get("auto_lock_seconds", 300))
        layout.addWidget(QLabel("Segons d'inactivitat per bloqueig automàtic:"))
        layout.addWidget(self.lock_spin)

        layout.addWidget(QLabel("URL del servidor Railway (opcional):"))
        self.railway_url_edit = QLineEdit(CONFIG.get("railway_url", ""))
        self.railway_url_edit.setPlaceholderText("https://your-project.up.railway.app")
        tooltip = QLabel("Auto-generate després de crear el projecte a Railway")
        tooltip.setAlignment(Qt.AlignmentFlag.AlignRight)
        tooltip.setStyleSheet("color: #68706c; font-size: 11px; padding-left: 8px;")
        layout.addWidget(tooltip)
        layout.addWidget(self.railway_url_edit)

        layout.addWidget(QLabel("Identificador de la caixa forta Railway:"))
        tooltip = QLabel("Crea una caixa forta al llançar l'app")
        tooltip.setAlignment(Qt.AlignmentFlag.AlignRight)
        tooltip.setStyleSheet("color: #68706c; font-size: 11px; padding-left: 8px;")
        layout.addWidget(tooltip)
        self.railway_vault_id_edit = QLineEdit(CONFIG.get("railway_vault_id", ""))
        layout.addWidget(self.railway_vault_id_edit)

        layout.addWidget(QLabel("Credencial d'accés Railway:"))
        tooltip = QLabel("S'genera automàticament al crear la caixa forta")
        tooltip.setAlignment(Qt.AlignmentFlag.AlignRight)
        tooltip.setStyleSheet("color: #68706c; font-size: 11px; padding-left: 8px;")
        layout.addWidget(tooltip)
        self.railway_token_edit = QLineEdit(CONFIG.get("railway_token", ""))
        self.railway_token_edit.setEchoMode(QLineEdit.EchoMode.Password)
        layout.addWidget(self.railway_token_edit)

        # Separator before destructive actions
        separator = QFrame()
        separator.setFixedHeight(1)
        separator.setStyleSheet("background: #dfe4e1; margin: 20px 0;")
        layout.addWidget(separator)

        # Warning label for delete all data button
        danger_label = QLabel("⚠ Aquestes accions són irreversibles")
        danger_label.setStyleSheet("color: #ef4444; font-weight: 600; margin-top: 8px;")
        layout.addWidget(danger_label)

        # Delete all data button
        delete_btn = QPushButton("🗑 Eliminar totes les dades")
        delete_btn.setStyleSheet("""
            QPushButton {
                background: #dc2626; 
                color: white; 
                padding: 8px 12px; 
                border-radius: 6px;
                font-weight: 500;
            }
            QPushButton:hover { background: #b91c1c; }
            QPushButton:pressed { background: #991b1b; }
        """)
        delete_btn.clicked.connect(self._on_delete_all_data)
        layout.addWidget(delete_btn)

        # Button row at the bottom
        btns = QHBoxLayout()
        save_btn = QPushButton("Guardar")
        save_btn.clicked.connect(lambda: self.save_settings(dlg))
        cancel_btn = QPushButton("Cancel·la")
        cancel_btn.clicked.connect(dlg.reject)
        btns.addWidget(save_btn)
        btns.addWidget(cancel_btn)
        layout.addLayout(btns)

        dlg.exec()

    def _on_delete_all_data(self):
        """Delete all data for starting over."""
        global CONFIG, SESSION_TIMEOUT_SECONDS, CLIPBOARD_CLEAR_SECONDS
        confirm = QMessageBox.warning(
            self,
            "⚠ Advertència",
            "Vols eliminar TOTES les dades de la caixa forta?\n\n"
            "Aquesta acció és IRREVERSIBLE i eliminarà:\n"
            "• Totes les contrasenyes\n"
            "• Totes les informacions\n"
            "• Totes les configuracions personalitzades\n\n\n"
            "Si continues, no podrés recuperar les dades perdudes.",
            QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
            QMessageBox.StandardButton.No
        )

        if confirm == QMessageBox.StandardButton.Yes:
            # Double-confirm for safety
            typed, ok = QInputDialog.getText(
                self,
                "⚠ Confirmació Final",
                "Escriu DELETE per confirmar l'eliminació total:",
            )

            if ok and typed == "DELETE":
                # Delete all data files
                try:
                    if self.remote_store.configured:
                        self.remote_store.delete()
                    if os.path.exists(VAULT_FILENAME):
                        os.remove(VAULT_FILENAME)
                    if os.path.exists(SIDEBAR_SETTINGS_FILENAME):
                        os.remove(SIDEBAR_SETTINGS_FILENAME)
                    if os.path.exists(LOCKOUT_STATE_FILENAME):
                        os.remove(LOCKOUT_STATE_FILENAME)

                    QMessageBox.information(
                        self,
                        "Dades eliminades",
                        "Totes les dades s'han eliminat.\n\n"
                        "La caixa forta ha estat reiniciada."
                    )
                    
                    # Reset to defaults (globals already declared at top)
                    CONFIG.clear()
                    CONFIG.update(DEFAULT_CONFIG)
                    save_config(CONFIG)
                    self.remote_store = RemoteVaultStore(CONFIG)
                    self.manager.entries = []
                    self._master_password = None
                    self._initialized = False
                    SESSION_TIMEOUT_SECONDS = CONFIG.get("auto_lock_seconds", 300)
                    CLIPBOARD_CLEAR_SECONDS = CONFIG.get("clipboard_clear_seconds", 30)

                except Exception as e:
                    self._show_remote_error("No s'han pogut eliminar les dades", e)

    def _show_remote_error(self, title: str, error: Exception):
        """Show error message to user."""
        message = f"{title}\n\n{str(error) or 'Error desconegut'}"
        self.status.setText(f"Error: {str(error)[:100]}")
        self.status.setStyleSheet("color: #dc2626; font-weight: 600;")
        QMessageBox.critical(self, title, message)

    def _show_sync_status(self):
        """Show current sync status."""
        if self.remote_store.configured:
            if self._master_password and self.manager.entries:
                status = "Sync: Active"
                self.status.setStyleSheet("color: #16803c; font-weight: 600;")
            elif self._master_password:
                status = "Sync: Ready"
                self.status.setStyleSheet("color: #3b82f6; font-weight: 600;")
            else:
                status = "Sync: Unlocked"
                self.status.setStyleSheet("color: #68706c; font-weight: 600;")
        else:
            if self._master_password:
                status = "Local Only"
                self.status.setStyleSheet("color: #f59e0b; font-weight: 600;")
            else:
                status = "Preparat"
                self.status.setStyleSheet("")
        self.status.setText(status)

    def _sync_upload(self):
        if not self.remote_store.configured:
            QMessageBox.information(self, "Remot no configurat", "Configura l'URL, l'identificador i el testimoni Railway.")
            return
        if not self._master_password:
            QMessageBox.warning(self, "Caixa forta bloquejada", "Desbloqueja la caixa forta abans de sincronitzar.")
            return
        try:
            self.remote_store.save(self.manager.get_entries(), self._master_password)
            save_config(CONFIG)
            self.status.setText(f"Pujada remota completada (versió {CONFIG['railway_version']})")
        except Exception as error:
            self._show_remote_error("No s'ha pogut pujar la caixa forta", error)

    def _sync_download(self):
        if not self.remote_store.configured:
            QMessageBox.information(self, "Remot no configurat", "Configura l'URL, l'identificador i el testimoni Railway.")
            return
        if not self._master_password:
            QMessageBox.warning(self, "Caixa forta bloquejada", "Desbloqueja la caixa forta abans de sincronitzar.")
            return
        try:
            entries, version = self.remote_store.load(self._master_password)
            self.manager.entries = entries
            CONFIG["railway_version"] = version
            save_config(CONFIG)
            self.refresh_cards()
            self.status.setText(f"Descarrega remota completada (versió {version})")
        except Exception as error:
            self._show_remote_error("No s'ha pogut descarregar la caixa forta", error)

    def save_settings(self, dlg):
        global CONFIG  # noqa: F826
        new_config = {
            "clipboard_clear_seconds": self.clip_spin.value(),
            "auto_lock_seconds": self.lock_spin.value(),
            "show_tutorial": CONFIG.get("show_tutorial", True),
            "railway_url": self.railway_url_edit.text().strip().rstrip("/") or "",
            "railway_vault_id": self.railway_vault_id_edit.text().strip() or "",
            "railway_token": self.railway_token_edit.text().strip() or "",
        }
        
        # Update with version if available
        if CONFIG.get("railway_version") is not None:
            new_config["railway_version"] = CONFIG["railway_version"]
        
        save_config(new_config)
        
        # Refresh the main window's constants
        CONFIG.update(new_config)
        self.remote_store = RemoteVaultStore(CONFIG)
        SESSION_TIMEOUT_SECONDS = CONFIG.get("auto_lock_seconds", 300)
        CLIPBOARD_CLEAR_SECONDS = CONFIG.get("clipboard_clear_seconds", 30)
        self._show_sync_status()
        
        if dlg.windowTitle() == "Configuració":
            dlg.accept()

    def refresh_cards(self):
        """Refresh cards with security improvements."""
        self.list_area.clear()
        entries = self.manager.get_entries()
        query = self.search.text().strip().lower()

        visible_entries = 0
        for e in entries:
            if query and query not in e.site.lower() and query not in e.username.lower():
                continue

            visible_entries += 1
            item = QListWidgetItem()
            card = QFrame()
            card.setObjectName("card")
            card.setStyleSheet(CARD_STYLE)
            layout = QHBoxLayout()
            layout.setContentsMargins(8, 7, 8, 7)
            layout.setSpacing(10)

            site_icon = QLabel()
            site_icon.setObjectName("site_icon")
            site_icon.setPixmap(QIcon(str(Path(__file__).resolve().parent / "icons" / "globe.svg")).pixmap(22, 22))
            layout.addWidget(site_icon)

            left = QVBoxLayout()
            left.setSpacing(2)
            site = QLabel(e.site)
            site.setObjectName("site")
            user = QLabel(e.username)
            user.setObjectName("user")
            left.addWidget(site)
            left.addWidget(user)
            layout.addLayout(left)
            layout.addStretch()

            right = QHBoxLayout()
            right.setSpacing(2)
            btn_open = QToolButton()
            btn_open.setObjectName("card_action")
            btn_open.setIcon(QIcon(str(Path(__file__).resolve().parent / "icons" / "external-link.svg")))
            btn_open.setToolTip("Obre el lloc web")
            btn_open.setFixedSize(40, 40)
            btn_open.setIconSize(btn_open.size())
            btn_open.setStyleSheet("QToolButton { background: #fbfdff; border: 1px solid #e6eef5; border-radius: 8px; } QToolButton:hover { background: #f1f5f9; }")
            btn_open.setCursor(Qt.CursorShape.PointingHandCursor)

            # Sanitize site URL to prevent XSS
            safe_site = self._sanitize_url(e.site)
            btn_open.clicked.connect(lambda _, site=safe_site: self.open_site(site))

            btn_copy = QToolButton()
            btn_copy.setObjectName("card_action")
            btn_copy.setIcon(QIcon(str(Path(__file__).resolve().parent / "icons" / "copy.svg")))
            btn_copy.setToolTip("Copia la contrasenya")
            btn_copy.setFixedSize(40, 40)
            btn_copy.setIconSize(btn_copy.size())
            btn_copy.setStyleSheet("QToolButton { background: #fbfdff; border: 1px solid #e6eef5; border-radius: 8px; } QToolButton:hover { background: #f1f5f9; }")
            btn_copy.setCursor(Qt.CursorShape.PointingHandCursor)

            btn_copy.setContextMenuPolicy(Qt.ContextMenuPolicy.CustomContextMenu)
            btn_copy.customContextMenuRequested.connect(lambda: self._show_copy_menu(btn_copy))

            def _show_copy_menu(self, b: QToolButton):
                """Show copy menu with secure labels (password shown as 🔒)."""
                m = QMenu(self)
                m.addAction(QAction("Copiar l'usuari", m, triggered=lambda: self.copy_to_clipboard(e.username, "Usuari copiat")))
                m.addAction(QAction("🔒 Copiar contrasenya", m, triggered=lambda: self.copy_to_clipboard(e.password, "Contrasenya copiada")))
                m.exec(b.mapToGlobal(b.rect().bottomLeft()))

            btn_copy.clicked.connect(_show_copy_menu)
            right.addWidget(btn_open)
            right.addWidget(btn_copy)

            btn_more = QToolButton()
            btn_more.setObjectName("more_action")
            btn_more.setIcon(QIcon(str(Path(__file__).resolve().parent / "icons" / "more.svg")))
            btn_more.setToolTip("Més accions")
            btn_more.setFixedSize(40, 40)
            btn_more.setIconSize(btn_more.size())
            btn_more.setStyleSheet("QToolButton { background: #fbfdff; border: 1px solid #e6eef5; border-radius: 8px; } QToolButton:hover { background: #f1f5f9; }")
            btn_more.setCursor(Qt.CursorShape.PointingHandCursor)
            btn_more.setPopupMode(QToolButton.ToolButtonPopupMode.InstantPopup)
            btn_more.setMenu(self._create_entry_menu(e.id))
            right.addWidget(btn_more)

            layout.addLayout(right)
            card.setLayout(layout)
            item.setSizeHint(card.sizeHint())
            self.list_area.addItem(item)
            self.list_area.setItemWidget(item, card)

        if visible_entries == 0:
            item = QListWidgetItem()
            empty_state = QLabel(
                "No hem trobat cap accés.\n\n"
                "Prova una altra cerca o crea el teu primer accés."
            )
            empty_state.setObjectName("empty_state")
            empty_state.setAlignment(Qt.AlignmentFlag.AlignCenter)
            empty_state.setWordWrap(True)
            empty_state.setMinimumHeight(150)
            item.setSizeHint(empty_state.sizeHint())
            self.list_area.addItem(item)
            self.list_area.setItemWidget(item, empty_state)

    def _sanitize_url(self, url: str) -> str:
        """Sanitize URL to prevent XSS attacks."""
        if not url:
            return ""

        # Strip any HTML/JS-like content
        url = url.strip()

        # Only allow http://, https://, and www. prefixes
        if url.startswith(("http://", "https://")):
            # Remove any protocol-relative URLs with javascript: etc.
            if "javascript:" in url.lower() or "vbscript:" in url.lower():
                return ""
            return url

        if url.startswith("www."):
            return "https://" + url

        # Default to https for any plain domain
        if "." in url and not url.startswith(("http://", "https://")):
            return "https://" + url

        return ""

    def copy_to_clipboard(self, value: str, message: str):
        """Copy to clipboard with auto-clear after SECURITY_TIMEOUT_SECONDS."""
        QApplication.clipboard().setText(value)

        # Show confirmation with progress indicator
        self.status.setText(message)
        self.status.setStyleSheet("color: #16803c; font-weight: 600;")

        # Clear clipboard after SECURITY_TIMEOUT_SECONDS
        def _clear_clipboard():
            QApplication.clipboard().clear()
            self.status.setText("Preparat")
            self.status.setStyleSheet("")

        QTimer.singleShot(CLIPBOARD_CLEAR_SECONDS * 1000, _clear_clipboard)

    def _create_entry_menu(self, entry_id: str):
        menu = QMenu(self)
        menu.addAction(QAction("Emplenament automàtic", menu, triggered=lambda: self.status.setText("Emplenament automàtic preparat")))
        menu.addAction(QAction("Preferit", menu, triggered=lambda: self.status.setText("Accés marcat com a preferit")))
        menu.addAction(QAction("Edita", menu, triggered=lambda: self.on_edit_by_id(entry_id)))
        menu.addAction(QAction("Clona", menu, triggered=lambda: self.on_clone_by_id(entry_id)))
        menu.addAction(QAction("Arxiva", menu, triggered=lambda: self.status.setText("Accés arxivat")))
        menu.addAction(QAction("Suprimeix", menu, triggered=lambda: self.on_delete_by_id(entry_id)))
        return menu

    def on_clone_by_id(self, entry_id: str):
        entry = self.manager.find_entry(entry_id)
        if not entry:
            return
        # Security: generate new ID for cloned entries
        self.manager.add_entry(entry.site, entry.username, entry.password, entry.notes)
        self.save_vault_with_master_password()
        self.refresh_cards()
        self.status.setText("Accés clonat")

    def open_site(self, site: str):
        """Open site in browser with additional safety checks."""
        if not site:
            return

        # Additional validation before opening
        if "javascript:" in site.lower() or "vbscript:" in site.lower():
            QMessageBox.warning(self, "Error de seguretat", "URL no permitada.")
            return

        if not site.startswith(("http://", "https://")):
            address = f"https://{site}"
        else:
            address = site

        try:
            webbrowser.open(address)
        except Exception as e:
            QMessageBox.warning(self, "Error", f"No s'ha pogut obrir l'almacen: {str(e)}")

    def on_add(self):
        self._on_last_activity()

        dlg = AddEditDialog(self)
        if dlg.exec() == QDialog.DialogCode.Accepted:
            data = dlg.get_data()

            # Input validation
            if not data["site"]:
                QMessageBox.warning(self, "No valid", "El nom de l'accés és obligatori.")
                return

            if not data["password"]:
                QMessageBox.warning(self, "No valid", "La contrasenya és obligatoria.")
                return

            # Sanitize inputs
            data["site"] = self._sanitize_url(data["site"])

            self.manager.add_entry(
                data["site"],
                data["username"].strip(),
                data["password"],
                data["notes"][:500]  # Limit notes length to prevent abuse
            )

            self._on_last_activity()
            self.save_vault_with_master_password()
            self.refresh_cards()
            self.status.setText("Accés afegit - Síncronitzat" if self.remote_store.configured else "Accés afegit")

    def save_vault_with_master_password(self):
        """Save vault with master password prompt."""
        if not self._master_password:
            self.show_login_dialog()
            return
        
        # Validate version before upload to prevent stale version conflicts
        if self.remote_store.has_server and self.remote_store._status.version is not None:
            # Check if version is reasonable (not too old)
            if self.remote_store._status.version > 10000:
                self.status.setText("Warning: Version stale, try deleting and recreating vault")
                self.status.setStyleSheet("color: #f59e0b; font-weight: 600;")
                return
        
        try:
            if self.remote_store.has_server:
                self.remote_store.save(self.manager.get_entries(), self._master_password)
                save_config(CONFIG)
                self.status.setText("Guardat - Síncronitzat amb el núvol")
            else:
                save_vault(self.manager.get_entries(), self._master_password)
                self.status.setText("Guardat localment")
        except Exception as error:
            self._show_remote_error("No s'ha pogut guardar", error)
            self.status.setText("Error al guardar")

    def on_edit_by_id(self, entry_id: str):
        self._on_last_activity()

        entry = self.manager.find_entry(entry_id)
        if not entry:
            return

        dlg = AddEditDialog(self, entry=entry.to_dict())
        if dlg.exec() == QDialog.DialogCode.Accepted:
            data = dlg.get_data()

            # Validate inputs
            if not data["site"]:
                QMessageBox.warning(self, "No valid", "El nom de l'accés és obligatori.")
                return

            if not data["password"]:
                QMessageBox.warning(self, "No valid", "La contrasenya és obligatória.")
                return

            data["site"] = self._sanitize_url(data["site"])

            entry.site = data["site"]
            entry.username = data["username"].strip()
            entry.password = data["password"]
            entry.notes = data["notes"][:500]

            self._on_last_activity()
            self.save_vault_with_master_password()
            self.refresh_cards()

    def on_delete_by_id(self, entry_id: str):
        self._on_last_activity()

        confirm = QMessageBox.question(
            self, "Confirmació",
            "Vols eliminar aquest accés?\n\nAquesta acció no es pot desfazer.",
            QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
            QMessageBox.StandardButton.No
        )

        if confirm == QMessageBox.StandardButton.Yes:
            self.manager.delete_entry(entry_id)
            self.save_vault_with_master_password()
            self.refresh_cards()
            self.status.setText("Accés eliminat - Síncronitzat" if self.remote_store.configured else "Accés eliminat")

    def on_search(self, text: str):
        self._on_last_activity()
        self.refresh_cards()
