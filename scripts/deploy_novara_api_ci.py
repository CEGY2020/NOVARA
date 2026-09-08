#!/usr/bin/env python3
"""CI-safe NOVARA API deploy wrapper.

The legacy deploy script passes AppBaseUrl as a SAM parameter. AWS SAM rejects
an empty parameter override (AppBaseUrl=). This wrapper supplies a sensible
production fallback only when NOVARA_APP_BASE_URL is not already configured.
"""
from __future__ import annotations

import os

from deploy_novara_api import main


if __name__ == "__main__":
    os.environ.setdefault("NOVARA_APP_BASE_URL", "https://cegy2020.github.io/NOVARA")
    raise SystemExit(main())
