import os

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

from PyQt6.QtWidgets import QApplication

from src.ui.dialogs import CloudLoginDialog, LoginDialog
from src.ui.main_window import MainWindow
from src.ui.tutorial_dialog import FirstTimeGuideDialog, StepByStepGuideDialog


def test_desktop_ui_modules_import():
    assert CloudLoginDialog is not None
    assert LoginDialog is not None
    assert MainWindow is not None


def test_tutorial_buttons_advance_once_and_finish():
    app = QApplication.instance() or QApplication([])

    for dialog_type in (FirstTimeGuideDialog, StepByStepGuideDialog):
        dialog = dialog_type()
        dialog.btn_next.click()
        assert dialog.current_step == 1

        for _ in range(5):
            dialog.btn_next.click()

        assert dialog.result() == dialog.DialogCode.Accepted

    app.quit()
