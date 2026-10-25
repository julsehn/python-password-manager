import sys


def main() -> int:
    from src.ui.main_window import MainWindow
    from src.ui.qt_compat import QApplication, QTimer

    app = QApplication(sys.argv)
    window = MainWindow()
    window.show()
    QTimer.singleShot(1000, app.quit)
    return app.exec()


if __name__ == "__main__":
    raise SystemExit(main())
