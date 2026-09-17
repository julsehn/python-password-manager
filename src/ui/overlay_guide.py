"""Overlay guide for first-time users with arrows pointing to actual UI elements."""
from PyQt6.QtWidgets import (
    QDialog,
    QVBoxLayout,
    QHBoxLayout,
    QLabel,
    QPushButton,
    QFrame,
    QWidget,
    QGraphicsBlurEffect,
    QGraphicsDropShadowEffect,
    QSizePolicy,
    QAbstractButton,
    QStyle,
    QPainter,
    QPen,
    QColor,
)
from PyQt6.QtCore import Qt, QRect, QPointF, QPoint
from PyQt6.QtGui import QFont, QPainterPath


class ArrowPainter(QPainter):
    """Custom painter for drawing arrows."""
    
    def draw_arrow(self, start: QPointF, end: QPointF, length: int = 15, width: int = 5):
        """Draw an arrow from start to end point."""
        pen = QPen(QColor(37, 99, 235), width)
        pen.setCapStyle(Qt.PenCapStyle.RoundCap)
        self.setPen(pen)
        
        # Draw line
        self.drawLine(start.toPoint(), end.toPoint())
        
        # Draw arrowhead
        arrow_length = length
        dx = end.x() - start.x()
        dy = end.y() - start.y()
        
        # Normalize direction
        if abs(dx) < 1:
            dx = 1 if dx > 0 else -1
            dy = 0
        
        # Arrowhead vertices
        head_x1 = end.x() - dx * arrow_length * 0.5
        head_y1 = end.y() - dy * arrow_length * 0.5
        head_x2 = end.x() - dx * arrow_length * 0.5
        head_y2 = end.y() + dy * arrow_length * 0.5
        
        # Draw triangle
        self.setBrush(QColor(37, 99, 235))
        self.drawPolygon([
            QPoint(int(end.x()), int(end.y())),
            QPoint(int(head_x1), int(head_y1)),
            QPoint(int(head_x2), int(head_y2))
        ])


class OverlayGuideDialog(QDialog):
    """Overlay guide that sits on top of the main UI with arrows pointing to buttons."""
    
    def __init__(self, parent=None, on_complete=None):
        super().__init__(parent)
        self.setWindowTitle("Crea el teu primer accés")
        self.setWindowFlags(Qt.WindowType.FramelessWindowHint | Qt.WindowType.Tool | Qt.WindowType.WindowStaysOnTopHint)
        self.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground, True)
        self.setAttribute(Qt.WidgetAttribute.WA_ShowWithoutActivating, True)
        self.setModal(False)  # Non-modal so user can see the main UI
        self.setFixedSize(1000, 700)
        
        self.on_complete = on_complete
        self.current_step = 0
        self.total_steps = 5
        
        self.afegir_button = None
        
        self._init_ui()
        self._find_afegir_button()
        self._update_step()
    
    def _init_ui(self):
        """Initialize the overlay UI."""
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(0)
        
        # Main content area (semi-transparent overlay)
        self.overlay_frame = QFrame(self)
        self.overlay_frame.setFrameStyle(QFrame.Shape.Panel)
        self.overlay_frame.setStyleSheet("""
            QFrame {
                background: rgba(255, 255, 255, 220);
                border: 3px solid #2563eb;
                border-radius: 16px;
            }
        """)
        self.overlay_frame.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Expanding)
        layout.addWidget(self.overlay_frame)
        
        # Content layout
        content_layout = QVBoxLayout(self.overlay_frame)
        content_layout.setContentsMargins(32, 24, 32, 24)
        content_layout.setSpacing(16)
        
        # Progress bar
        self.progress_bar = QFrame(self.overlay_frame)
        self.progress_bar.setFixedHeight(8)
        self.progress_bar.setStyleSheet("""
            QFrame {
                background: #2563eb;
                border-radius: 4px;
            }
        """)
        content_layout.addWidget(self.progress_bar)
        
        # Progress text
        self.progress_text = QLabel("Pass 1 de 5")
        self.progress_text.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.progress_text.setStyleSheet("color: #2563eb; font-weight: 600; font-size: 16px;")
        content_layout.addWidget(self.progress_text)
        
        # Title
        self.title_label = QLabel()
        self.title_label.setStyleSheet("font-size: 28px; font-weight: bold; color: #172b4d; margin: 16px 0;")
        self.title_label.setWordWrap(True)
        content_layout.addWidget(self.title_label)
        
        # Instructions
        self.instructions_label = QLabel()
        self.instructions_label.setStyleSheet("font-size: 18px; color: #4a5568; line-height: 1.8;")
        self.instructions_label.setWordWrap(True)
        content_layout.addWidget(self.instructions_label)
        
        # Visual indicator
        self.indicator_label = QLabel("👉")
        self.indicator_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.indicator_label.setStyleSheet("font-size: 56px;")
        content_layout.addWidget(self.indicator_label)
        
        # Button row
        btn_layout = QHBoxLayout()
        btn_layout.setSpacing(16)
        
        self.btn_prev = QPushButton("◀ Anterior")
        self.btn_prev.clicked.connect(self._prev_step)
        self.btn_prev.setStyleSheet("""
            QPushButton {
                background: #f1f5f9; 
                color: #475569; 
                padding: 12px 24px; 
                border-radius: 10px;
                font-weight: 600;
                font-size: 14px;
            }
            QPushButton:hover { background: #e2e8f0; }
            QPushButton:disabled { background: #f8fafc; color: #94a3b8; }
        """)
        btn_layout.addWidget(self.btn_prev)
        
        self.btn_next = QPushButton("Següent ▶")
        self.btn_next.clicked.connect(self._next_step)
        self.btn_next.setStyleSheet("""
            QPushButton {
                background: #2563eb; 
                color: white; 
                padding: 12px 24px; 
                border-radius: 10px;
                font-weight: 600;
                font-size: 14px;
            }
            QPushButton:hover { background: #1d4ed8; }
            QPushButton:pressed { background: #1e40af; }
        """)
        btn_layout.addWidget(self.btn_next)
        
        content_layout.addLayout(btn_layout)
        
        self.setLayout(content_layout)
    
    def _find_afegir_button(self):
        """Find the 'Afegir accés' button in the parent window."""
        if not self.parent():
            return
        
        # Look for buttons with "Afegir" in the text
        self.afegir_button = None
        for child in self.parent().findChildren(QAbstractButton):
            text = child.text()
            if "Afegir" in text or "Afegir accés" in text:
                self.afegir_button = child
                break
        
        # If not found, try to find any button with "Add" or "Accés"
        if not self.afegir_button:
            for child in self.parent().findChildren(QAbstractButton):
                text = child.text()
                if "Add" in text or "Accés" in text:
                    self.afegir_button = child
                    break
        
        # If still not found, use the first button we can find
        if not self.afegir_button:
            for child in self.parent().findChildren(QWidget):
                if isinstance(child, QPushButton):
                    self.afegir_button = child
                    break
    
    def _get_button_rect(self, button: QAbstractButton) -> QRect:
        """Get the screen coordinates of a button."""
        if not button:
            return QRect()
        
        # Get button position
        global_pos = button.mapToGlobal(QPoint(0, 0))
        return QRect(global_pos.x(), global_pos.y(), button.width(), button.height())
    
    def _draw_arrow_to_button(self, x: int, y: int, rect: QRect):
        """Draw an arrow pointing to the button."""
        arrow = ArrowPainter()
        arrow.begin(self.overlay_frame)
        
        # Calculate arrow start position relative to overlay
        arrow_start = QPointF(x, y)
        arrow_end = QPointF(rect.center().x(), rect.center().y())
        
        arrow.draw_arrow(arrow_start, arrow_end)
        arrow.end()
    
    def _update_step(self):
        """Update the current step."""
        self.current_step = min(self.current_step, self.total_steps - 1)
        
        # Update progress
        progress_width = (self.current_step / (self.total_steps - 1)) * self.overlay_frame.width()
        self.progress_bar.setFixedWidth(int(progress_width))
        self.progress_text.setText(f"Pass {self.current_step + 1} de {self.total_steps}")
        
        # Step definitions
        steps = [
            {
                "title": "🎯 Comença!",
                "instruction": "Prèst atenció al diagrama de dalt. Estàs al principi del procés de creació del teu primer accés. Segueix les fletxes per avançar.",
                "icon": "🎯",
                "arrow_x": 180,
                "arrow_y": 280,
            },
            {
                "title": "🌐 Pas 1: Lloc web",
                "instruction": "Aquí on escriureu el lloc web (ex: google.com). Omple aquest camp amb el nom del lloc on utilitzes aquesta contrasenya.",
                "icon": "🌐",
                "arrow_x": 180,
                "arrow_y": 380,
            },
            {
                "title": "👤 Pas 2: Nom d'usuari",
                "instruction": "Aquí on escriureu el nom d'usuari o correu electrònic (ex: joan.perez). Omple aquest camp amb el teu usuari.",
                "icon": "👤",
                "arrow_x": 180,
                "arrow_y": 480,
            },
            {
                "title": "🔒 Pas 3: Contrasenya",
                "instruction": "Aquí on escriureu la contrasenya. La contrasenya ha de tenir com a mínim 8 caràcters per a màxima seguretat.",
                "icon": "🔒",
                "arrow_x": 180,
                "arrow_y": 580,
            },
            {
                "title": "✨ Pas 4: Confirma",
                "instruction": "Revisa les teves dades i confirma. La teva entrada s'afegirà a la caixa forta!",
                "icon": "✨",
                "arrow_x": 180,
                "arrow_y": 680,
            }
        ]
        
        step = steps[self.current_step]
        self.title_label.setText(f"{step['icon']} {step['title']}")
        self.instructions_label.setText(step['instruction'])
        
        # Update indicator
        arrows = "👉 " * (self.current_step + 1)
        self.indicator_label.setText(arrows)
        
        # Draw arrow to Afegir button if exists
        if self.afegir_button and step['arrow_x']:
            rect = self._get_button_rect(self.afegir_button)
            if rect.isValid():
                self._draw_arrow_to_button(step['arrow_x'], step['arrow_y'], rect)
        
        # Update buttons
        self.btn_prev.setEnabled(self.current_step > 0)
        
        if self.current_step == self.total_steps - 1:
            self.btn_next.setText("Finalitzar")
            self.btn_next.clicked.connect(self.accept)
        else:
            self.btn_next.setText("Següent ▶")
            self.btn_next.clicked.connect(self._next_step)
    
    def _next_step(self):
        if self.current_step < self.total_steps - 1:
            self.current_step += 1
            self._update_step()
    
    def _prev_step(self):
        if self.current_step > 0:
            self.current_step -= 1
            self._update_step()
