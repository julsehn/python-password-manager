"""Tutorial dialog for first-time users with arrow navigation."""
from PyQt6.QtWidgets import (
    QDialog,
    QVBoxLayout,
    QHBoxLayout,
    QLabel,
    QPushButton,
    QMessageBox,
    QFrame,
    QScrollArea,
    QWidget,
    QSpacerItem,
    QSizePolicy,
    QStyle,
    QApplication,
)
from PyQt6.QtCore import Qt, QTimer
from PyQt6.QtGui import QFont


class FirstTimeGuideDialog(QDialog):
    """Guia interactiva per usuaris nous amb navegació amb fletxes.

    Guia en català per usuaris que acaben de crear la seva primera caixa forta.
    Mostra com afegir el seu primer accés amb navegació amb fletxes (← →).
    """

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWindowTitle("Guia: Crea el teu primer accés")
        self.setModal(True)
        self.setFixedSize(750, 550)

        self.current_step = 0
        self.steps = [
            {
                "title": "🎉 Benvingut!",
                "message": "La teva caixa forta s'ha creat amb èxit!\n\nAra cal afegir el teu primer accés (lloc web, usuari i contrasenya).",
                "hint": "Fes clic a «Següent» per continuar",
                "icon": "🎉"
            },
            {
                "title": "🌐 Lloc web",
                "message": "Introdueix el lloc web on utilitzes aquesta contrasenya.\n\n📝 Exemples:\n• google.com\n• instagram.com\n• example.com",
                "hint": "Fes clic a «Següent» quan tinguis el lloc web",
                "icon": "🌐"
            },
            {
                "title": "👤 Nom d'usuari",
                "message": "Introdueix el nom d'usuari o l'adreça de correu que utilitzes en aquest lloc web.\n\n📝 Exemples:\n• joan.perez\n• user@example.com",
                "hint": "Fes clic a «Següent» quan tinguis el nom d'usuari",
                "icon": "👤"
            },
            {
                "title": "🔒 Contrasenya",
                "message": "Introdueix la contrasenya per a aquest accés.\n\n💡 La contrasenya ha de tenir com a mínim 8 caràcters.",
                "hint": "Fes clic a «Següent» quan tinguis la contrasenya",
                "icon": "🔒"
            },
            {
                "title": "✨ Generar contrasenya",
                "message": "Vols generar una contrasenya segura automàticament?\n\n🔑 Inclourà lletres, xifres i símbols per a màxima seguretat.",
                "hint": "Fes clic a «Següent» per continuar",
                "icon": "✨"
            },
            {
                "title": "✅ Accés afegit!",
                "message": "El teu primer accés s'ha afegit amb èxit!\n\n🎊 Continua afegint més accessos o revisa els que ja tens.",
                "hint": "Fes clic a «Finalitzar» per tancar la guia",
                "icon": "✅"
            }
        ]

        self._init_ui()
        self._update_step()

    def _init_ui(self):
        layout = QVBoxLayout(self)
        layout.setSpacing(16)
        layout.setContentsMargins(24, 24, 24, 24)

        # Progress indicator
        self.progress_label = QLabel(f"Pass {self.current_step + 1} de {len(self.steps)}")
        self.progress_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.progress_label.setStyleSheet("color: #2563eb; font-weight: 600; font-size: 15px;")
        layout.addWidget(self.progress_label)

        # Icon display
        self.icon_label = QLabel()
        self.icon_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.icon_label.setStyleSheet("font-size: 48px;")
        layout.addWidget(self.icon_label)

        # Title
        self.title_label = QLabel()
        self.title_label.setStyleSheet("font-size: 22px; font-weight: bold; color: #172b4d;")
        self.title_label.setWordWrap(True)
        layout.addWidget(self.title_label)

        # Message
        self.message_label = QLabel()
        self.message_label.setStyleSheet("font-size: 15px; color: #4a5568; line-height: 1.6;")
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
        arrow_layout.setSpacing(12)

        self.btn_prev = QPushButton("← Anterior")
        self.btn_prev.clicked.connect(self._prev_step)
        self.btn_prev.setStyleSheet(self._get_button_style(False))
        arrow_layout.addWidget(self.btn_prev)

        self.btn_next = QPushButton("Següent →")
        self.btn_next.clicked.connect(self._next_step)
        self.btn_next.setStyleSheet(self._get_button_style(True))
        arrow_layout.addWidget(self.btn_next)

        layout.addLayout(arrow_layout)

        # Visual arrow indicator (shows current step with arrows)
        self.arrow_indicator = QLabel("→ → →")
        self.arrow_indicator.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.arrow_indicator.setStyleSheet("font-size: 24px; color: #2563eb;")
        layout.addWidget(self.arrow_indicator)

        self.setLayout(layout)
        self._update_step()

    def _get_button_style(self, is_primary: bool) -> str:
        if is_primary:
            return """
                QPushButton {
                    background: #2563eb; 
                    color: white; 
                    padding: 10px 20px; 
                    border-radius: 8px;
                    font-weight: 600;
                    min-width: 120px;
                }
                QPushButton:hover { background: #1d4ed8; }
                QPushButton:pressed { background: #1e40af; }
            """
        else:
            return """
                QPushButton {
                    background: #f1f5f9; 
                    color: #475569; 
                    padding: 10px 20px; 
                    border-radius: 8px;
                    font-weight: 600;
                    min-width: 120px;
                }
                QPushButton:hover { background: #e2e8f0; }
                QPushButton:pressed { background: #cbd5e1; }
            """

    def _update_step(self):
        if self.current_step >= len(self.steps):
            self.current_step = len(self.steps) - 1

        step = self.steps[self.current_step]

        self.progress_label.setText(f"Pass {self.current_step + 1} de {len(self.steps)}")
        self.icon_label.setText(step["icon"])
        self.title_label.setText(step["title"])
        self.message_label.setText(step["message"])
        self.hint_label.setText(step["hint"])

        # Update arrow indicator
        arrows = "→ " * (self.current_step + 1)
        self.arrow_indicator.setText(arrows)

        # Update button states
        self.btn_prev.setEnabled(self.current_step > 0)

        if self.current_step == len(self.steps) - 1:
            self.btn_next.setText("Finalitzar")
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


class StepByStepGuideDialog(QDialog):
    """Guia pas a pas amb fletxes visibles per crear el primer accés.

    Shows a more detailed guide with visual arrows showing the flow.
    """

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWindowTitle("Crea el teu primer accés - Guia")
        self.setModal(True)
        self.setFixedSize(700, 600)

        self.current_step = 0
        self.total_steps = 6

        self._init_ui()
        self._update_step()

    def _init_ui(self):
        layout = QVBoxLayout(self)
        layout.setSpacing(16)
        layout.setContentsMargins(20, 20, 20, 20)

        # Title
        title = QLabel("🎯 Crea el teu primer accés")
        title.setAlignment(Qt.AlignmentFlag.AlignCenter)
        title.setStyleSheet("font-size: 24px; font-weight: bold; color: #172b4d;")
        layout.addWidget(title)

        # Visual flow diagram with arrows
        self.flow_diagram = QLabel()
        self.flow_diagram.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.flow_diagram.setStyleSheet("""
            QLabel {
                background: #f8fafc;
                border: 2px solid #e2e8f0;
                border-radius: 12px;
                padding: 20px;
                font-size: 14px;
                line-height: 1.8;
            }
        """)
        layout.addWidget(self.flow_diagram)

        # Current step description
        self.step_description = QLabel()
        self.step_description.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.step_description.setStyleSheet("font-size: 18px; font-weight: 600; color: #2563eb; margin: 10px 0;")
        layout.addWidget(self.step_description)

        # Instructions
        self.instructions = QLabel()
        self.instructions.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.instructions.setStyleSheet("font-size: 15px; color: #4a5568; line-height: 1.6;")
        self.instructions.setWordWrap(True)
        layout.addWidget(self.instructions)

        # Visual arrows showing current position
        self.position_arrows = QLabel("📍")
        self.position_arrows.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.position_arrows.setStyleSheet("font-size: 32px;")
        layout.addWidget(self.position_arrows)

        # Navigation buttons
        btn_layout = QHBoxLayout()
        btn_layout.setSpacing(12)

        self.btn_prev = QPushButton("◀ Anterior")
        self.btn_prev.clicked.connect(self._prev_step)
        self.btn_prev.setStyleSheet("""
            QPushButton {
                background: #e2e8f0; 
                color: #475569; 
                padding: 10px 20px; 
                border-radius: 8px;
                font-weight: 600;
                min-width: 110px;
            }
            QPushButton:hover { background: #cbd5e1; }
        """)
        btn_layout.addWidget(self.btn_prev)

        self.btn_next = QPushButton("Següent ▶")
        self.btn_next.clicked.connect(self._next_step)
        self.btn_next.setStyleSheet("""
            QPushButton {
                background: #2563eb; 
                color: white; 
                padding: 10px 20px; 
                border-radius: 8px;
                font-weight: 600;
                min-width: 110px;
            }
            QPushButton:hover { background: #1d4ed8; }
        """)
        btn_layout.addWidget(self.btn_next)

        layout.addLayout(btn_layout)

        self.setLayout(layout)

    def _get_flow_text(self):
        """Generate the flow diagram text based on current step."""
        steps = [
            "🏁 Començar →",
            "🌐 Omplir lloc web →",
            "👤 Omplir usuari →",
            "🔒 Omplir contrasenya →",
            "✨ Confirmar →",
            "✅ Finalitzar"
        ]

        current_idx = min(self.current_step, len(steps) - 1)
        completed = steps[:current_idx]
        current = steps[current_idx]
        remaining = steps[current_idx + 1:]

        if not completed and not remaining:
            flow = current
        elif not completed:
            flow = f"{current} → {chr(8594).join(remaining)}"
        elif not remaining:
            flow = f"{' → '.join(completed)} → {current}"
        else:
            flow = f"{' → '.join(completed)} → {current} → {chr(8594).join(remaining)}"

        return flow

    def _update_step(self):
        self.current_step = min(self.current_step, self.total_steps - 1)

        step_titles = {
            0: "Pass 1 de 6: Començar",
            1: "Pass 2 de 6: Lloc web",
            2: "Pass 3 de 6: Nom d'usuari",
            3: "Pass 4 de 6: Contrasenya",
            4: "Pass 5 de 6: Confirmar",
            5: "Pass 6 de 6: Finalitzar"
        }

        step_descriptions = {
            0: "Prèst atenció al diagrama de dalt amb les fletxes. Estàs al principi del procés.",
            1: "Introdueix el lloc web (ex: google.com). Ves al següent pas amb la fletxa.",
            2: "Introdueix el nom d'usuari (ex: joan.perez). Ves al següent pas amb la fletxa.",
            3: "Introdueix la contrasenya (mínim 8 caràcters). Ves al següent pas amb la fletxa.",
            4: "Revisa les dades i confirma. Ves al final amb la fletxa.",
            5: "L'accés s'ha creat! Ves enrere per revisar o finalitza."
        }

        self.step_description.setText(step_titles[self.current_step])
        self.instructions.setText(step_descriptions[self.current_step])

        # Update flow diagram
        self.flow_diagram.setText(self._get_flow_text())

        # Update position indicator
        if self.current_step == 0:
            self.position_arrows.setText("🏁")
        elif self.current_step == len(step_titles) - 1:
            self.position_arrows.setText("✅")
        else:
            self.position_arrows.setText(f"📍 Pass {self.current_step + 1}")

        # Update button states
        self.btn_prev.setEnabled(self.current_step > 0)

        if self.current_step == len(step_titles) - 1:
            self.btn_next.setText("Finalitzar")
            self.btn_next.clicked.connect(self.accept)
        else:
            self.btn_next.setText("Següent ▶")
            self.btn_next.clicked.connect(self._next_step)

    def _next_step(self):
        if self.current_step < len(step_titles) - 1:
            self.current_step += 1
            self._update_step()

    def _prev_step(self):
        if self.current_step > 0:
            self.current_step -= 1
            self._update_step()
