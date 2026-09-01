"""Platform SSH identity: generate & persist a server-side RSA keypair.

On first startup the server generates a 4096-bit RSA key and persists it under
``data/server_ssh_key`` (private) and ``data/server_ssh_key.pub`` (public).
Subsequent restarts load the existing keys.

The public key is distributed to registered agents via the heartbeat response.
Each agent writes the key into the local user's ``~/.ssh/authorized_keys`` file,
enabling the server to SSH directly into the machine using its private key
without requiring the user to copy any credentials.
"""

from __future__ import annotations

import logging
from pathlib import Path

logger = logging.getLogger(__name__)

_PRIVATE_KEY_FILENAME = "server_ssh_key"
_PUBLIC_KEY_FILENAME = "server_ssh_key.pub"


def _load_or_generate(data_dir: Path) -> tuple[str, str]:
    """Return (private_key_pem, public_key_openssh), generating if absent."""
    priv_path = data_dir / _PRIVATE_KEY_FILENAME
    pub_path = data_dir / _PUBLIC_KEY_FILENAME

    if priv_path.exists() and pub_path.exists():
        priv_pem = priv_path.read_text()
        pub_openssh = pub_path.read_text().strip()
        logger.debug("Loaded existing server SSH identity from %s", data_dir)
        return priv_pem, pub_openssh

    logger.info("Generating new server SSH identity in %s ...", data_dir)
    try:
        from cryptography.hazmat.primitives import serialization
        from cryptography.hazmat.primitives.asymmetric import rsa

        private_key = rsa.generate_private_key(public_exponent=65537, key_size=4096)

        priv_pem = private_key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.OpenSSH,
            encryption_algorithm=serialization.NoEncryption(),
        ).decode()

        pub_openssh = private_key.public_key().public_bytes(
            encoding=serialization.Encoding.OpenSSH,
            format=serialization.PublicFormat.OpenSSH,
        ).decode().strip()

    except ImportError:
        import subprocess
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            tmp_key = Path(tmp) / "id_rsa"
            subprocess.run(
                ["ssh-keygen", "-t", "rsa", "-b", "4096",
                 "-N", "", "-C", "mini-pipeline-server", "-f", str(tmp_key)],
                check=True, capture_output=True,
            )
            priv_pem = tmp_key.read_text()
            pub_openssh = (tmp_key.parent / "id_rsa.pub").read_text().strip()

    data_dir.mkdir(parents=True, exist_ok=True)
    priv_path.write_text(priv_pem)
    try:
        priv_path.chmod(0o600)
    except Exception:
        pass  # Windows does not support POSIX chmod
    pub_path.write_text(pub_openssh + "\n")
    logger.info("Server SSH identity generated and saved to %s", data_dir)
    return priv_pem, pub_openssh


class ServerSshIdentity:
    """Holds the platform platform SSH keypair; loaded once at startup."""

    def __init__(self, data_dir: Path) -> None:
        self._private_key_pem, self._public_key_openssh = _load_or_generate(data_dir)

    @property
    def public_key(self) -> str:
        """OpenSSH public key string (safe to publish)."""
        return self._public_key_openssh

    @property
    def private_key_pem(self) -> str:
        """PEM-encoded private key (keep server-side only)."""
        return self._private_key_pem
