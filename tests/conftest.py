"""Shared fixtures and path setup for the test suite."""

from __future__ import annotations

import sys
from pathlib import Path

# Add backend/ to sys.path so imports like `from engine import ...` work
# regardless of where pytest is run from.
REPO_ROOT = Path(__file__).resolve().parent.parent
BACKEND_DIR = REPO_ROOT / "backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

PACK_DIR = REPO_ROOT / "data" / "twenty" / "packs"
SCENARIO_DIR = REPO_ROOT / "data" / "twenty" / "scenarios"
