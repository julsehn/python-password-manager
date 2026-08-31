import sys
from src.ui.main_window import MainWindow
from src.ui.qt_compat import QApplication, Qt, QTimer

app = QApplication(sys.argv)
win = MainWindow()
win.show()

# close after 1s
QTimer.singleShot(1000, app.quit)
app.exec()
print('GUI test run completed')
