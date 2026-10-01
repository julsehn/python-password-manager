"""Image-based authentication dialogs.

Users upload an image and click/draw on it to create their authentication pattern.
The click coordinates become their password.
"""

import os
import json
import base64
from typing import Optional, List

from PyQt6.QtCore import Qt, QPointF
from PyQt6.QtGui import QPainter, QColor, QPen, QBrush, QPixmap, QMouseEvent
from PyQt6.QtWidgets import (
    QDialog,
    QVBoxLayout,
    QHBoxLayout,
    QLabel,
    QPushButton,
    QLineEdit,
    QFileDialog,
    QMessageBox,
    QWidget,
)

from src.storage import (
    load_image_auth,
    save_image_auth,
    load_vault,
    VAULT_FILENAME,
    verify_image_auth_pattern,
)


class ImageCanvas(QWidget):
    """Widget that displays an image and captures click coordinates."""

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setMinimumSize(400, 300)
        self.setMouseTracking(True)
        self.image_pixmap = None
        self.original_image_pixmap = None
        self.click_points = []
        self.point_radius = 8
        self.show_feedback = True
        self.is_drawing = False
        self.last_point = None
        self._mouse_down = False

    def set_image(self, path: str):
        """Load an image from file path."""
        self.image_pixmap = QPixmap(path)
        self.original_image_pixmap = self.image_pixmap
        self.click_points = []
        self._redraw()

    def set_points(self, points: List[QPointF]):
        """Set the click points."""
        self.click_points = points
        self._redraw()

    def clear_points(self):
        """Clear all click points."""
        self.click_points = []
        self._redraw()

    def get_points(self) -> List[QPointF]:
        """Return the current click points."""
        return self.click_points

    def mousePressEvent(self, event):
        """Capture mouse click position and convert to percentages."""
        if event.button() == Qt.MouseButton.LeftButton:
            self._mouse_down = True
            pos = event.pos()
            # Convert to percentages (0-100) based on widget size
            pct_x = (pos.x() / self.width()) * 100.0
            pct_y = (pos.y() / self.height()) * 100.0
            self.click_points.append(QPointF(pct_x, pct_y))
            self._redraw()
        super().mousePressEvent(event)

    def mouseMoveEvent(self, event):
        """Capture drawing movement."""
        if self._mouse_down and self.is_drawing:
            pos = event.pos()
            pct_x = (pos.x() / self.width()) * 100.0
            pct_y = (pos.y() / self.height()) * 100.0
            self.click_points.append(QPointF(pct_x, pct_y))
            self._redraw()
        super().mouseMoveEvent(event)

    def mouseReleaseEvent(self, event):
        """Release drawing."""
        self._mouse_down = False
        super().mouseReleaseEvent(event)

    def paintEvent(self, event):
        """Draw the image with click points as dots."""
        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing)

        if self.image_pixmap is None:
            # Empty state
            painter.setPen(QColor("#9ca3af"))
            painter.drawText(self.rect(), Qt.AlignmentFlag.AlignCenter, "Cap imatge carregada")
            return

        # Draw the image scaled to fit
        scaled_pixmap = self.image_pixmap.scaled(
            self.width(),
            self.height() - 80,
            Qt.AspectRatioMode.KeepAspectRatio,
            Qt.TransformationMode.SmoothTransformation
        )
        painter.drawPixmap(0, 0, scaled_pixmap)

        # Draw click points as colored dots
        for point in self.click_points:
            # Scale point coordinates to match image scaling
            scaled_x = point.x() * scaled_pixmap.width() / self.width()
            scaled_y = point.y() * scaled_pixmap.height() / self.height()
            radius = 8
            painter.setPen(QPen(QColor("#3b82f6"), 2))
            painter.setBrush(QColor("#3b82f6"))
            painter.drawEllipse(int(scaled_x - radius), int(scaled_y - radius), 2 * radius, 2 * radius)

        painter.end()

    def _redraw(self):
        """Redraw the widget."""
        self.update()


class ImageAuthSetupDialog(QDialog):
    """Dialog for setting up image-based authentication.

    User uploads an image and clicks on it to create their pattern.
    """

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWindowTitle("Configurar autenticació amb imatge")
        self.setModal(True)
        self.setFixedSize(700, 650)

        self.pattern_points = []
        self.image_path = None

        layout = QVBoxLayout(self)
        layout.setSpacing(12)

        # Title and instructions
        title = QLabel("Configura el teu patró d'autenticació")
        title.setAlignment(Qt.AlignmentFlag.AlignCenter)
        font = title.font()
        font.setWeight(700)
        font.setPointSize(16)
        title.setFont(font)
        layout.addWidget(title)

        self.instruction_label = QLabel(
            "Fes clic per seleccionar un punt. Després clics a «Següent» per continuar.\n"
            "Tria 5 punts per al teu patró."
        )
        self.instruction_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.instruction_label.setStyleSheet("color: #68706c; font-size: 13px;")
        layout.addWidget(self.instruction_label)

        # Image upload button
        self.upload_btn = QPushButton("📷 Puja imatge")
        self.upload_btn.clicked.connect(self._on_upload_image)
        layout.addWidget(self.upload_btn)

        # Canvas area
        self.canvas = ImageCanvas(self)
        layout.addWidget(self.canvas)

        # Point count indicator
        self.point_count_label = QLabel("Punts seleccionats: 0")
        self.point_count_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        layout.addWidget(self.point_count_label)

        # Buttons
        btn_layout = QHBoxLayout()
        self.cancel_btn = QPushButton("Cancel·la")
        self.cancel_btn.clicked.connect(self.reject)
        btn_layout.addWidget(self.cancel_btn)

        self.finish_btn = QPushButton("✅ Finalitzar configuració")
        self.finish_btn.setStyleSheet("""
            QPushButton {
                background: #10b981;
                color: white;
                padding: 8px 16px;
                border-radius: 6px;
                font-weight: 500;
            }
            QPushButton:hover { background: #059669; }
        """)
        self.finish_btn.clicked.connect(self._on_finish_setup)
        btn_layout.addWidget(self.finish_btn)
        layout.addLayout(btn_layout)

        self.setLayout(layout)

    def _on_upload_image(self):
        """Open file dialog to upload an image."""
        file_path, _ = QFileDialog.getOpenFileName(
            self,
            "Puja imatge",
            "",
            "Images (*.jpg *.jpeg *.png *.gif)"
        )
        if file_path:
            self.image_path = file_path
            self.canvas.set_image(file_path)
            self.instruction_label.setText(
                "Fes clic per seleccionar un punt. Després clics a «Següent» per continuar.\n"
                "Tria 5 punts per al teu patró."
            )

    def _on_finish_setup(self):
        """Save the authentication pattern."""
        points = self.canvas.get_points()

        if len(points) < 3:
            QMessageBox.warning(
                self,
                "Error",
                "Selecciona almenys 3 punts per al teu patró."
            )
            return

        # Save pattern with image path and points
        import secrets
        salt = secrets.token_bytes(32)

        save_image_auth(
            image_b64="image_auth",
            hotspots=[
                {"x_pct": float(p.x()), "y_pct": float(p.y())}
                for p in points
            ],
            salt=salt
        )

        QMessageBox.information(
            self,
            "Autenticació configurada!",
            "El teu patró s'ha guardat.\n\n"
            "La pròxima vegada, fes clic en els mateixos punts per desbloquejar la caixa forta."
        )
        self.accept()


class ImageAuthLoginDialog(QDialog):
    """Dialog for logging in with image-based authentication.

    User recreates their pattern by clicking on the image.
    """

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWindowTitle("Entrar a la caixa forta")
        self.setModal(True)
        self.setFixedSize(700, 650)

        self.current_points = []
        self.auth_data = load_image_auth()

        if not self.auth_data:
            QMessageBox.warning(
                self,
                "Error",
                "No hi ha cap plantilla d'autenticació configurada."
            )
            self.reject()
            return

        layout = QVBoxLayout(self)
        layout.setSpacing(12)

        # Title
        title = QLabel("Entrar a la caixa forta")
        title.setAlignment(Qt.AlignmentFlag.AlignCenter)
        font = title.font()
        font.setWeight(700)
        font.setPointSize(16)
        title.setFont(font)
        layout.addWidget(title)

        subtitle = QLabel("Fes clic en els punts del teu patró")
        subtitle.setAlignment(Qt.AlignmentFlag.AlignCenter)
        subtitle.setStyleSheet("color: #68706c; font-size: 13px;")
        layout.addWidget(subtitle)

        # Canvas
        self.canvas = ImageCanvas(self)
        layout.addWidget(self.canvas)

        # Status
        self.status_label = QLabel("Selecciona els punts del teu patró")
        self.status_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.status_label.setStyleSheet("color: #68706c; font-size: 12px;")
        layout.addWidget(self.status_label)

        # Buttons
        btn_layout = QHBoxLayout()
        self.cancel_btn = QPushButton("Cancel·la")
        self.cancel_btn.clicked.connect(self.reject)
        btn_layout.addWidget(self.cancel_btn)

        self.verify_btn = QPushButton("🔍 Verificar")
        self.verify_btn.setStyleSheet("""
            QPushButton {
                background: #2563eb;
                color: white;
                padding: 8px 16px;
                border-radius: 6px;
                font-weight: 500;
            }
            QPushButton:hover { background: #1e40af; }
        """)
        self.verify_btn.clicked.connect(self._on_verify)
        btn_layout.addWidget(self.verify_btn)
        layout.addLayout(btn_layout)

        self.setLayout(layout)

    def _on_verify(self):
        """Verify the user's pattern against the stored template."""
        points = self.canvas.get_points()

        if not points:
            QMessageBox.warning(
                self,
                "Error",
                "Selecciona els punts del teu patró abans de verificar."
            )
            return

        stored_hotspots = self.auth_data.get("hotspots", [])
        salt_b64 = self.auth_data.get("salt")

        if not stored_hotspots or not salt_b64:
            QMessageBox.warning(
                self,
                "Error",
                "No hi ha dades d'autenticació configurades."
            )
            return

        # Convert base64-encoded salt to hex for verification
        try:
            salt_bytes = base64.b64decode(salt_b64)
            salt_hex = salt_bytes.hex()
        except Exception:
            QMessageBox.warning(
                self,
                "Error",
                "Error en la dades d'autentificació."
            )
            return

        # Convert QPointF objects to dicts for verification
        strokes = [
            {"x_pct": float(p.x()), "y_pct": float(p.y())}
            for p in points
        ]

        # Verify pattern using storage's verification function
        if not verify_image_auth_pattern(strokes, stored_hotspots, salt_hex):
            QMessageBox.warning(
                self,
                "Patró incorrecte",
                "El patró que has seleccionat no coincideix amb el patró d'autentificació original.\n\n"
                "Si continua fallant, contacta amb el suport tècnic."
            )
            return

        # Generate the AES key from the pattern
        try:
            from src.encryption import generate_grid_password
            password_string = generate_grid_password(self.current_points)
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
                "Patró incorrecte",
                f"No es pot desbloquejar la caixa forta.\n\n" + str(e)
            )