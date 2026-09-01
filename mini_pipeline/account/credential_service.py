"""Credential & Secret Management Service."""

from __future__ import annotations

import fnmatch
import re
from typing import Any
from urllib.parse import urlsplit

from mini_pipeline.account.crypto import decrypt_credentials, encrypt_credentials
from mini_pipeline.account.service import Principal
from mini_pipeline.core.config import Settings
from mini_pipeline.database.account_repositories import (
    CredentialRepository,
    TeamRepository,
    UserRepository,
)
from mini_pipeline.database.models import Credential
from mini_pipeline.domain.exceptions import NotFoundError, PermissionDeniedError, ValidationError

ALLOWED_TYPES = {"username_password", "secret_text", "ssh_key", "secret_file"}
ALLOWED_SCOPES = {"personal", "team", "global"}
NAME_PATTERN = re.compile(r"^[a-zA-Z0-9_\-\.]{2,64}$")


def match_domain_pattern(url: str, pattern: str) -> bool:
    """Matches a URL or host string against a wildcard domain/URL pattern.

    Supports:
      - '*.github.com' matches 'github.com', 'api.github.com', 'git.github.com'
      - 'gitlab.mycorp.internal' exact host match
      - 'nexus.internal:8081' host and port match
      - 'https://nexus.corp.internal/*' full URL prefix match
      - 'git@github.com:*' SSH URL format
    """
    clean_url = (url or "").strip()
    clean_pattern = (pattern or "").strip().lower()
    if not clean_url or not clean_pattern:
        return False

    # Normalize SSH git URL (e.g. git@github.com:org/repo.git)
    if clean_url.startswith("git@") and ":" in clean_url:
        host = clean_url.split("@", 1)[1].split(":", 1)[0].strip().lower()
        host_port = host
    else:
        try:
            parsed = urlsplit(clean_url if "://" in clean_url else f"http://{clean_url}")
            host = (parsed.hostname or "").lower()
            host_port = (parsed.netloc or "").lower()
        except Exception:
            host = clean_url.lower()
            host_port = clean_url.lower()

    # Full URL prefix match (if pattern contains scheme)
    if clean_pattern.startswith(("http://", "https://", "git@")):
        return fnmatch.fnmatch(clean_url.lower(), clean_pattern)

    # Glob match on hostname or host:port
    if fnmatch.fnmatch(host, clean_pattern) or fnmatch.fnmatch(host_port, clean_pattern):
        return True

    # Suffix domain match (e.g. pattern='*.github.com' or pattern='github.com')
    if clean_pattern.startswith("*."):
        root_domain = clean_pattern[2:]
        if host == root_domain or host.endswith(f".{root_domain}"):
            return True
    if host == clean_pattern or host.endswith(f".{clean_pattern}"):
        return True

    return False


class CredentialService:
    """Business service for managing encrypted credentials & secrets in vault."""

    def __init__(
        self,
        credential_repo: CredentialRepository,
        team_repo: TeamRepository,
        user_repo: UserRepository,
        settings: Settings,
    ) -> None:
        self.credential_repo = credential_repo
        self.team_repo = team_repo
        self.user_repo = user_repo
        self.settings = settings

    @property
    def secret_key(self) -> str:
        key = self.settings.security.secret_key
        if not key:
            raise ValidationError("security.secret_key must be configured to use credential vault")
        return key

    def _mask_payload(self, cred_type: str, decrypted: dict[str, Any] | None) -> dict[str, Any]:
        if not decrypted:
            return {}
        if cred_type == "username_password":
            return {
                "username": decrypted.get("username", ""),
                "password": "••••••••" if decrypted.get("password") else "",
            }
        if cred_type == "secret_text":
            sec = decrypted.get("secret", "")
            return {
                "secret": "••••••••" if sec else "",
                "preview": f"{sec[:3]}...{sec[-2:]}" if len(sec) > 6 else "••••",
                "length": len(sec),
            }
        if cred_type == "ssh_key":
            return {
                "username": decrypted.get("username", ""),
                "has_passphrase": bool(decrypted.get("passphrase")),
                "private_key": "••••••••",
            }
        if cred_type == "secret_file":
            return {
                "filename": decrypted.get("filename", "secret.bin"),
                "has_content": bool(decrypted.get("content_base64")),
            }
        return {"masked": "••••••••"}

    def serialize_credential(
        self,
        cred: Credential,
        owner_name: str | None = None,
        team_name: str | None = None,
    ) -> dict[str, Any]:
        decrypted = decrypt_credentials(cred.encrypted_data, self.secret_key)
        masked = self._mask_payload(cred.type, decrypted)

        return {
            "id": cred.id,
            "name": cred.name,
            "type": cred.type,
            "scope": cred.scope,
            "owner_id": cred.owner_id,
            "owner_name": owner_name,
            "team_id": cred.team_id,
            "team_name": team_name,
            "description": cred.description,
            "domain_patterns": cred.domain_patterns or [],
            "data": masked,
            "created_at": cred.created_at.isoformat() if cred.created_at else None,
            "updated_at": cred.updated_at.isoformat() if cred.updated_at else None,
        }

    def can_access_credential(self, user: Principal, cred: Credential) -> bool:
        if user.is_admin:
            return True
        if cred.scope == "global":
            return True
        if cred.scope == "personal" and cred.owner_id == user.user_id:
            return True
        if cred.scope == "team" and cred.team_id:
            members = self.team_repo.members_of(cred.team_id)
            if any(m.user_id == user.user_id for m in members):
                return True
        return False

    def can_modify_credential(self, user: Principal, cred: Credential) -> bool:
        if user.is_admin:
            return True
        return cred.owner_id == user.user_id

    def create_credential(
        self,
        user: Principal,
        name: str,
        type_: str,
        scope: str,
        payload: dict[str, Any],
        description: str = "",
        team_id: str | None = None,
        domain_patterns: list[str] | None = None,
    ) -> dict[str, Any]:
        clean_name = name.strip()
        if not NAME_PATTERN.match(clean_name):
            raise ValidationError(
                f"Invalid credential name '{clean_name}'. Must be 2-64 chars "
                f"(alphanumeric, dashes, underscores, dots)."
            )
        if type_ not in ALLOWED_TYPES:
            raise ValidationError(
                f"Invalid credential type '{type_}'. Must be one of {ALLOWED_TYPES}"
            )
        if scope not in ALLOWED_SCOPES:
            raise ValidationError(
                f"Invalid credential scope '{scope}'. Must be one of {ALLOWED_SCOPES}"
            )

        if scope == "global" and not user.is_admin:
            raise PermissionDeniedError(
                "Only platform administrators can create global credentials"
            )

        if scope == "team":
            if not team_id:
                raise ValidationError("team_id is required for team-scoped credentials")
            members = self.team_repo.members_of(team_id)
            if not user.is_admin and not any(m.user_id == user.user_id for m in members):
                raise PermissionDeniedError("You are not a member of the specified team")

        # Validate payload requirements
        if type_ == "username_password":
            if not payload.get("username") or not payload.get("password"):
                raise ValidationError(
                    "Username and password are required for username_password credential"
                )
        elif type_ == "secret_text":
            if not payload.get("secret"):
                raise ValidationError("Secret text is required for secret_text credential")
        elif type_ == "ssh_key":
            if not payload.get("private_key"):
                raise ValidationError("SSH private key is required for ssh_key credential")
        elif type_ == "secret_file":
            if not payload.get("content_base64") and not payload.get("content"):
                raise ValidationError("File content is required for secret_file credential")

        # Check name uniqueness for user / global scope
        existing = self.credential_repo.get_by_name(clean_name, user.user_id)
        if existing:
            raise ValidationError(
                f"A credential with name '{clean_name}' already exists in your accessible scope"
            )

        encrypted = encrypt_credentials(payload, self.secret_key)
        cred = self.credential_repo.create(
            name=clean_name,
            type_=type_,
            scope=scope,
            encrypted_data=encrypted,
            owner_id=user.user_id,
            team_id=team_id if scope == "team" else None,
            description=description,
            domain_patterns=domain_patterns or [],
        )

        return self.serialize_credential(cred, owner_name=user.username or user.name)

    def list_credentials_for_user(self, user: Principal) -> list[dict[str, Any]]:
        all_creds = self.credential_repo.list_all()
        user_teams: set[str] = set()
        if not user.is_admin and user.user_id:
            teams = self.team_repo.teams_of_user(user.user_id)
            user_teams = {t.id for t in teams}

        accessible: list[dict[str, Any]] = []
        # Cache user & team names
        user_cache: dict[str, str] = {}
        team_cache: dict[str, str] = {}

        for cred in all_creds:
            if not user.is_admin:
                if cred.scope == "personal" and cred.owner_id != user.user_id:
                    continue
                if cred.scope == "team" and cred.team_id not in user_teams:
                    continue

            # Fetch owner name
            owner_name: str | None = None
            if cred.owner_id:
                if cred.owner_id not in user_cache:
                    try:
                        u = self.user_repo.get(cred.owner_id)
                        user_cache[cred.owner_id] = (
                            u.display_name or u.username if u else cred.owner_id
                        )
                    except Exception:
                        user_cache[cred.owner_id] = cred.owner_id
                owner_name = user_cache[cred.owner_id]

            # Fetch team name
            team_name: str | None = None
            if cred.team_id:
                if cred.team_id not in team_cache:
                    try:
                        t = self.team_repo.get(cred.team_id)
                        team_cache[cred.team_id] = t.name if t else cred.team_id
                    except Exception:
                        team_cache[cred.team_id] = cred.team_id
                team_name = team_cache[cred.team_id]

            accessible.append(
                self.serialize_credential(
                    cred, owner_name=owner_name, team_name=team_name
                )
            )

        return accessible

    def get_credential(self, user: Principal, credential_id: str) -> dict[str, Any]:
        cred = self.credential_repo.get_by_id(credential_id)
        if not cred:
            raise NotFoundError(f"Credential '{credential_id}' not found")
        if not self.can_access_credential(user, cred):
            raise PermissionDeniedError("You do not have access to this credential")

        owner_name = None
        if cred.owner_id:
            try:
                u = self.user_repo.get(cred.owner_id)
                owner_name = u.display_name or u.username if u else cred.owner_id
            except Exception:
                owner_name = cred.owner_id

        team_name = None
        if cred.team_id:
            try:
                t = self.team_repo.get(cred.team_id)
                team_name = t.name if t else cred.team_id
            except Exception:
                team_name = cred.team_id

        return self.serialize_credential(cred, owner_name=owner_name, team_name=team_name)

    def get_raw_credential(self, user: Principal, credential_id: str) -> dict[str, Any]:
        cred = self.credential_repo.get_by_id(credential_id)
        if not cred:
            raise NotFoundError(f"Credential '{credential_id}' not found")
        if not self.can_modify_credential(user, cred):
            raise PermissionDeniedError(
                "Only credential owner or admin can view raw credential plaintext"
            )

        decrypted = decrypt_credentials(cred.encrypted_data, self.secret_key)
        return {
            "id": cred.id,
            "name": cred.name,
            "type": cred.type,
            "data": decrypted or {},
        }

    def update_credential(
        self,
        user: Principal,
        credential_id: str,
        name: str | None = None,
        description: str | None = None,
        scope: str | None = None,
        payload: dict[str, Any] | None = None,
        team_id: str | None = None,
        domain_patterns: list[str] | None = None,
    ) -> dict[str, Any]:
        cred = self.credential_repo.get_by_id(credential_id)
        if not cred:
            raise NotFoundError(f"Credential '{credential_id}' not found")
        if not self.can_modify_credential(user, cred):
            raise PermissionDeniedError("You do not have permission to modify this credential")

        if scope == "global" and not user.is_admin:
            raise PermissionDeniedError("Only platform administrators can set global scope")

        if name is not None:
            clean_name = name.strip()
            if not NAME_PATTERN.match(clean_name):
                raise ValidationError(f"Invalid credential name '{clean_name}'")
            if clean_name != cred.name:
                existing = self.credential_repo.get_by_name(clean_name, user.user_id)
                if existing and existing.id != cred.id:
                    raise ValidationError(f"Credential with name '{clean_name}' already exists")

        encrypted_data = None
        if payload is not None and len(payload) > 0:
            encrypted_data = encrypt_credentials(payload, self.secret_key)

        updated = self.credential_repo.update(
            credential_id=credential_id,
            name=name,
            description=description,
            scope=scope,
            encrypted_data=encrypted_data,
            team_id=team_id,
            domain_patterns=domain_patterns,
        )

        return self.serialize_credential(updated)

    def match_credentials_for_url(
        self, user: Principal, url: str
    ) -> list[dict[str, Any]]:
        """Finds all credentials accessible to user that match the specified URL/host."""
        clean_url = (url or "").strip()
        if not clean_url:
            return []
        accessible = self.list_credentials_for_user(user)
        matched = []
        for cred in accessible:
            patterns = cred.get("domain_patterns") or []
            for pat in patterns:
                if match_domain_pattern(clean_url, pat):
                    matched.append(cred)
                    break
        return matched

    def delete_credential(self, user: Principal, credential_id: str) -> None:
        cred = self.credential_repo.get_by_id(credential_id)
        if not cred:
            raise NotFoundError(f"Credential '{credential_id}' not found")
        if not self.can_modify_credential(user, cred):
            raise PermissionDeniedError("You do not have permission to delete this credential")

        self.credential_repo.delete(credential_id)

    def resolve_secret(
        self, name_or_id: str, user_id: str | None = None
    ) -> dict[str, Any] | None:
        """Resolves credential plaintext for pipeline executor or internal services."""
        cred = self.credential_repo.get_by_id(name_or_id)
        if not cred:
            cred = self.credential_repo.get_by_name(name_or_id, user_id)
        if not cred:
            return None

        if user_id:
            try:
                user = self.user_repo.get(user_id)
                principal = Principal(
                    name=user.username,
                    role=user.role,
                    user_id=user.id,
                    username=user.username,
                    email=user.email,
                )
                if not self.can_access_credential(principal, cred):
                    return None
            except Exception:
                return None

        return decrypt_credentials(cred.encrypted_data, self.secret_key)
