"""Own a multi-format clipboard until another application replaces it."""

import base64
import json
import sys

from PySide6.QtCore import QMimeData, QTimer
from PySide6.QtGui import QGuiApplication


def main() -> int:
    formats: dict[str, str] = json.load(sys.stdin)
    app = QGuiApplication(["omarchy-grammar-clipboard"])
    clipboard = app.clipboard()
    data = QMimeData()
    for mime, encoded in formats.items():
        data.setData(mime, base64.b64decode(encoded, validate=True))
    clipboard.setMimeData(data)

    def changed() -> None:
        if not clipboard.ownsClipboard():
            app.quit()

    def ready() -> None:
        if not clipboard.ownsClipboard():
            app.exit(1)
            return
        print("READY", flush=True)

    clipboard.dataChanged.connect(changed)
    QTimer.singleShot(0, ready)
    return app.exec()


if __name__ == "__main__":
    sys.exit(main())
