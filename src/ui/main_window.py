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
)

from src.password_manager import PasswordManager
from src.ui.dialogs import AddEditDialog, GeneratePasswordDialog, LoginDialog
from src.storage import (
    save_vault,
    load_vault,
    export_vault,
    VAULT_FILENAME,
    load_sidebar_settings,
    save_sidebar_settings,
)
from pathlib import Path
import webbrowser

# Security: Auto-lock timeout in seconds (5 minutes)
SESSION_TIMEOUT_SECONDS = 300

# Security: Clear clipboard after this many seconds (15 seconds)
CLIPBOARD_CLEAR_SECONDS = 15

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
        self._initialized = False

        # Security: Initialize login state (authenticate on startup)
        self._init_login_state()

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

        dlg = LoginDialog(self)
        if dlg.exec() == QDialog.DialogCode.Accepted:
            self._load_vault()
        else:
            # If no vault exists, just proceed (first-time setup)
            self._initialize_new_vault()

    def _load_vault(self):
        """Load vault after successful login."""
        # Get master password from user (we need to re-prompt or cache it)
        # For simplicity, we'll prompt again - in production you'd want a secure credential store
        dlg = LoginDialog(self)
        if dlg.exec() == QDialog.DialogCode.Accepted:
            try:
                entries = load_vault(dlg.password_field.text())
                self.manager.entries = entries
                self._initialized = True
                self.refresh_cards()
                self.status.setText("Caixa forta - Accés correct")
            except Exception as e:
                self.status.setText(f"Error: {str(e)}")

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

            save_vault([], pw)
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

        if os.path.exists(VAULT_FILENAME):
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

            def _show_copy_menu(_checked=False, b=btn_copy, pw=e.password, user=e.username):
                m = QMenu(self)
                m.addAction(QAction("Copiar l'usuari", m, triggered=lambda: self.copy_to_clipboard(user, "Usuari copiat")))
                m.addAction(QAction("Copiar la contrasenya", m, triggered=lambda: self.copy_to_clipboard(pw, "Contrasenya copiada")))
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

        # If it looks like a domain, prefix with https
        if len(url) > 2 and "." in url:
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
        self.refresh_cards()
        self.status.setText("Accés clonat")

    def open_site(self, site: str):
        """Open site in browser with additional safety checks."""
        if not site:
            return

        # Additional validation before opening
        if "javascript:" in site.lower() or "vbscript:" in site.lower():
            QMessageBox.warning(self, "Error de seguretat", "URL no permetada.")
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
                QMessageBox.warning(self, "No vàlid", "El nom de l'accés és obligatori.")
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
            self.status.setText("Accés afegit")

    def save_vault_with_master_password(self):
        """Save vault with master password prompt."""
        # In a real app, you'd cache the master password securely
        dlg = LoginDialog(self)
        if dlg.exec() == QDialog.DialogCode.Accepted:
            try:
                save_vault(self.manager.get_entries(), dlg.password_field.text())
            except Exception as e:
                QMessageBox.critical(self, "Error", f"No s'ha pogut Guardar: {str(e)}")

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
            self.refresh_cards()
            self.status.setText("Accés eliminat")

    def on_search(self, text: str):
        self._on_last_activity()
        self.refresh_cards()
