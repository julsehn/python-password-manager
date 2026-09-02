import os
from src.ui.qt_compat import (
    QDialog,
    QVBoxLayout,
    QLabel,
    QPushButton,
    QHBoxLayout,
    QLineEdit,
    QSpinBox,
    Qt,
)
from src.storage import load_config, save_config

class TutorialDialog(QDialog):
    """Diàleg de tutorial per als nous usuaris.

    Mostra una guia pas a pas sobre com utilitzar la caixa forta.
    """

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWindowTitle("Guia de benvinguda")
        self.setModal(True)
        self.setFixedSize(600, 400)

        self.current_slide = 0
        self.slides = [
            {
                "title": "Benvingut a la teva caixa forta!",
                "content": (
                    "La teva caixa forta és un lloc segur per emagtzar les teves contrasenyes.\n\n"
                    "Quan la obris per primer vegada, et devaràs crear una 'contrasenya mestra'.\n"
                    "Aquesta contrasenya és la clau per desbloquejar tota la teva informació.\n"
                    "Guarda aquesta contrasenya en un lloc segur fora de l'ordinador!"
                )
            },
            {
                "title": "Afegir nous accés",
                "content": (
                    "Pots afegir qualsevol servei (com que sigui Google, Instagram, etc.).\n\n"
                    "Cada accés necessita un nom d'usuari i una contrasenya.\n"
                    "El sistema valora que utilitzis contrasenyes llargues i complexes.\n"
                    "Pots també afegir notes privades per a cada accés."
                )
            },
            {
                "title": "Seguretat automàtica",
                "content": (
                    "La teva seguretat és la nostra prioritat.\n\n"
                    "- Desbloqueig automàtic: La caixa forta es bloquejarà sola després de 5 minuts d'inactivitat.\n"
                    "-neteja de ténegua: Quan copies una contrasenya, aquesta s'eliminarà de la teua ténegua després de 30 segons."
                )
            },
            {
                "title": "Exportació i còpies de segurement",
                "content": (
                    "No oblidis fer còpies de segurement de la teva caixa forta.\n\n"
                    "Pots exportar el teu arseu de contrasenyes a un arseu local.\n"
                    "Així, si alguna vegada perds l'accés al teu ordinador, podràs recuperar les teves contrasenyes."
                )
            }
        ]

        layout = QVBoxLayout()

        self.title_label = QLabel()
        self.title_label.setStyleSheet("font-size: 18px; font-weight: bold; color: #172b4d;")
        self.title_label.setWordWrap(True)
        layout.addWidget(self.title_label)

        self.content_label = QLabel()
        self.content_label.setStyleSheet("font-size: 14px; color: #4a5568;")
        self.content_label.setWordWrap(True)
        layout.addWidget(self.content_label)

        self.btn_next = QPushButton("Següent")
        self.btn_next.clicked.connect(self._next_slide)
        layout.addWidget(self.btn_next)

        self.btn_skip = QPushButton("Saltar")
        self.btn_skip.clicked.connect(self.accept)
        layout.addWidget(self.btn_skip)

        self.setLayout(layout)
        self._update_slide()

    def _update_slide(self):
        slide = self.slides[self.current_slide]
        self.title_label.setText(slide["title"])
        self.content_label.setText(slide["content"])
        
        if self.current_slide == len(self.slides) - 1:
            self.btn_next.setText("Finalitzar")
            self.btn_next.clicked.connect(self.accept)
        else:
            self.btn_next.setText("Següent")
            self.btn_next.clicked.connect(self._next_slide)

    def _next_slide(self):
        self.current_slide += 1
        self._update_slide()
