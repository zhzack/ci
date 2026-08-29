"""Fernet encryption for machine credentials at rest.

The key is derived from ``security.secret_key`` (sha256), so operators only
manage one environment variable. Credentials are decryptable exclusively by
platform admins and the owning user of a personal machine — never by users
the machine is merely assigned or shared to.
"""

from __future__ import annotations

import hashlib
from typing import Any

from cryptography.fernet import Fernet, InvalidToken


def _fernet(secret_key: str) -> Fernet:
    derived = hashlib.sha256(secret_key.encode("utf-8")).digest()
    return Fernet(fernet_key(derived))


def fernet_key(raw: bytes) -> bytes:
    import base64

    return base64.urlsafe_b64encode(raw)


def encrypt_credentials(payload: dict[str, Any], secret_key: str) -> str:
    import json

    token = _fernet(secret_key).encrypt(json.dumps(payload).encode("utf-8"))
    return token.decode("utf-8")


def decrypt_credentials(token: str, secret_key: str) -> dict[str, Any] | None:
    import json

    try:
        raw = _fernet(secret_key).decrypt(token.encode("utf-8"))
        value = json.loads(raw.decode("utf-8"))
        return value if isinstance(value, dict) else None
    except (InvalidToken, ValueError, UnicodeDecodeError):
        return None
