"""Compatibility layer: prefer PyQt6, fall back to PySide6.

Expose commonly used Qt classes/names so UI code can import from here.
"""
try:
    from PyQt6 import QtWidgets, QtCore, QtGui
    Qt = QtCore.Qt

    # Widgets
    QMainWindow = QtWidgets.QMainWindow
    QLabel = QtWidgets.QLabel
    QWidget = QtWidgets.QWidget
    QVBoxLayout = QtWidgets.QVBoxLayout
    QHBoxLayout = QtWidgets.QHBoxLayout
    QPushButton = QtWidgets.QPushButton
    QDialog = QtWidgets.QDialog
    QTableWidget = QtWidgets.QTableWidget
    QTableWidgetItem = QtWidgets.QTableWidgetItem
    QMessageBox = QtWidgets.QMessageBox
    QLineEdit = QtWidgets.QLineEdit
    QHeaderView = QtWidgets.QHeaderView
    QApplication = QtWidgets.QApplication
    QInputDialog = QtWidgets.QInputDialog
    QDialogButtonBox = QtWidgets.QDialogButtonBox
    QFormLayout = QtWidgets.QFormLayout
    QCheckBox = QtWidgets.QCheckBox
    QSpinBox = QtWidgets.QSpinBox
    QLabel = QtWidgets.QLabel
    QTimer = QtCore.QTimer
    QListWidget = QtWidgets.QListWidget
    QListWidgetItem = QtWidgets.QListWidgetItem
    QSplitter = QtWidgets.QSplitter
    QFrame = QtWidgets.QFrame
    QScrollArea = QtWidgets.QScrollArea
    QSizePolicy = QtWidgets.QSizePolicy
    QToolButton = QtWidgets.QToolButton
    QMenu = QtWidgets.QMenu
    QAction = QtGui.QAction
    QIcon = QtGui.QIcon
    QPixmap = QtGui.QPixmap
    QColorDialog = QtWidgets.QColorDialog
    QFileDialog = QtWidgets.QFileDialog
    QPainter = QtGui.QPainter
    QColor = QtGui.QColor
    QCursor = QtGui.QCursor

except Exception:
    # Fallback to PySide6
    from PySide6 import QtWidgets, QtCore, QtGui
    Qt = QtCore.Qt

    QMainWindow = QtWidgets.QMainWindow
    QLabel = QtWidgets.QLabel
    QWidget = QtWidgets.QWidget
    QVBoxLayout = QtWidgets.QVBoxLayout
    QHBoxLayout = QtWidgets.QHBoxLayout
    QPushButton = QtWidgets.QPushButton
    QDialog = QtWidgets.QDialog
    QTableWidget = QtWidgets.QTableWidget
    QTableWidgetItem = QtWidgets.QTableWidgetItem
    QMessageBox = QtWidgets.QMessageBox
    QLineEdit = QtWidgets.QLineEdit
    QHeaderView = QtWidgets.QHeaderView
    QApplication = QtWidgets.QApplication
    QInputDialog = QtWidgets.QInputDialog
    QDialogButtonBox = QtWidgets.QDialogButtonBox
    QFormLayout = QtWidgets.QFormLayout
    QCheckBox = QtWidgets.QCheckBox
    QSpinBox = QtWidgets.QSpinBox
    QLabel = QtWidgets.QLabel
    QTimer = QtCore.QTimer
    QListWidget = QtWidgets.QListWidget
    QListWidgetItem = QtWidgets.QListWidgetItem
    QSplitter = QtWidgets.QSplitter
    QFrame = QtWidgets.QFrame
    QScrollArea = QtWidgets.QScrollArea
    QSizePolicy = QtWidgets.QSizePolicy
    QToolButton = QtWidgets.QToolButton
    QMenu = QtWidgets.QMenu
    QAction = QtGui.QAction
    QIcon = QtGui.QIcon
    QPixmap = QtGui.QPixmap
    QColorDialog = QtWidgets.QColorDialog
    QFileDialog = QtWidgets.QFileDialog
    QPainter = QtGui.QPainter
    QColor = QtGui.QColor
    QCursor = QtGui.QCursor

__all__ = [
    "Qt",
    "QMainWindow",
    "QLabel",
    "QWidget",
    "QVBoxLayout",
    "QHBoxLayout",
    "QPushButton",
    "QDialog",
    "QTableWidget",
    "QTableWidgetItem",
    "QMessageBox",
    "QLineEdit",
    "QHeaderView",
    "QApplication",
    "QInputDialog",
    "QDialogButtonBox",
    "QTimer",
    "QListWidget",
    "QListWidgetItem",
    "QSplitter",
    "QFrame",
    "QScrollArea",
    "QSizePolicy",
    "QToolButton",
    "QMenu",
    "QAction",
    "QIcon",
    "QPixmap",
    "QColorDialog",
    "QFileDialog",
    "QPainter",
    "QColor",
    "QCursor",
    "QFormLayout",
    "QCheckBox",
    "QSpinBox",
]
