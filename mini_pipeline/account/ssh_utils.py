"""SSH Key management utilities for machine Deploy Keys."""

from __future__ import annotations

import base64
import hashlib
from pathlib import Path
from typing import Any

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ed25519


def get_or_create_host_deploy_key(storage_dir: Path | None = None) -> dict[str, Any]:
    """Retrieves or generates a standard ED25519 SSH Deploy Key for the host system."""
    # Check ~/.ssh/id_ed25519.pub or ~/.ssh/id_rsa.pub first
    home_ssh = Path.home() / ".ssh"
    for pub_name in ["id_ed25519.pub", "id_rsa.pub"]:
        pub_file = home_ssh / pub_name
        if pub_file.is_file():
            try:
                content = pub_file.read_text(encoding="utf-8").strip()
                if content:
                    parts = content.split()
                    key_type = parts[0] if parts else "ssh-ed25519"
                    raw_b64 = parts[1] if len(parts) > 1 else ""
                    fingerprint = ""
                    if raw_b64:
                        raw_bytes = base64.b64decode(raw_b64)
                        fp_sha = hashlib.sha256(raw_bytes).digest()
                        fp_b64 = base64.b64encode(fp_sha).decode("ascii").rstrip("=")
                        fingerprint = f"SHA256:{fp_b64}"
                    return {
                        "public_key": content,
                        "key_type": key_type,
                        "fingerprint": fingerprint,
                        "source": "host_user",
                        "comment": parts[2] if len(parts) > 2 else "mini-pipeline@master",
                    }
            except Exception:
                pass

    # If not present in home, store/generate inside storage_dir / ssh
    ssh_dir = storage_dir / "ssh" if storage_dir else home_ssh
    ssh_dir.mkdir(parents=True, exist_ok=True)
    priv_file = ssh_dir / "mini_pipeline_deploy_key"
    pub_file = ssh_dir / "mini_pipeline_deploy_key.pub"

    if pub_file.is_file():
        content = pub_file.read_text(encoding="utf-8").strip()
        parts = content.split()
        key_type = parts[0] if parts else "ssh-ed25519"
        raw_b64 = parts[1] if len(parts) > 1 else ""
        fingerprint = ""
        if raw_b64:
            raw_bytes = base64.b64decode(raw_b64)
            fp_sha = hashlib.sha256(raw_bytes).digest()
            fp_b64 = base64.b64encode(fp_sha).decode("ascii").rstrip("=")
            fingerprint = f"SHA256:{fp_b64}"
        return {
            "public_key": content,
            "key_type": key_type,
            "fingerprint": fingerprint,
            "source": "generated",
            "comment": parts[2] if len(parts) > 2 else "mini-pipeline@master",
        }

    # Generate new ED25519 key pair
    priv_key = ed25519.Ed25519PrivateKey.generate()
    pub_key = priv_key.public_key()

    priv_pem = priv_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.OpenSSH,
        encryption_algorithm=serialization.NoEncryption(),
    )
    pub_openssh = pub_key.public_bytes(
        encoding=serialization.Encoding.OpenSSH,
        format=serialization.PublicFormat.OpenSSH,
    ).decode("utf-8").strip()

    full_pub = f"{pub_openssh} mini-pipeline@master"
    priv_file.write_bytes(priv_pem)
    pub_file.write_text(full_pub, encoding="utf-8")

    parts = full_pub.split()
    raw_b64 = parts[1] if len(parts) > 1 else ""
    raw_bytes = base64.b64decode(raw_b64)
    fp_sha = hashlib.sha256(raw_bytes).digest()
    fp_b64 = base64.b64encode(fp_sha).decode("ascii").rstrip("=")
    fingerprint = f"SHA256:{fp_b64}"

    return {
        "public_key": full_pub,
        "key_type": "ssh-ed25519",
        "fingerprint": fingerprint,
        "source": "generated",
        "comment": "mini-pipeline@master",
    }
