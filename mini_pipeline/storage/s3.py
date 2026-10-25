"""S3-compatible object storage driver (AWS S3, MinIO, Aliyun OSS, Tencent COS)."""

import hashlib
import hmac
import io
import mimetypes
import urllib.parse
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, BinaryIO, Optional

import httpx

from mini_pipeline.domain.exceptions import ConfigurationError, NotFoundError, ValidationError
from mini_pipeline.storage.base import (
    StorageDriver,
    StorageItem,
    StorageLeaderboardItem,
    StorageStats,
    TypeUsage,
)
from mini_pipeline.storage.local import categorize_file, is_file_editable


class S3StorageDriver(StorageDriver):
    """Storage driver for S3 and S3-compatible object storage (MinIO, OSS, etc)."""

    def __init__(
        self,
        *,
        bucket_name: str,
        endpoint_url: Optional[str] = None,
        access_key: Optional[str] = None,
        secret_key: Optional[str] = None,
        region: str = "us-east-1",
    ) -> None:
        if not bucket_name:
            raise ConfigurationError("S3 storage requires bucket_name")
        self.bucket_name = bucket_name
        self.endpoint_url = (endpoint_url or "https://s3.amazonaws.com").rstrip("/")
        self.access_key = access_key or ""
        self.secret_key = secret_key or ""
        self.region = region or "us-east-1"
        self._client = httpx.Client(timeout=30.0)

    @property
    def driver_name(self) -> str:
        return "s3"

    def _normalize_key(self, path: str) -> str:
        clean = path.strip().replace("\\", "/").strip("/")
        parts = [p for p in clean.split("/") if p and p != "."]
        if any(p == ".." for p in parts):
            raise ValidationError(f"Path traversal detected: {path}")
        return "/".join(parts)

    def _sign_headers(
        self,
        method: str,
        canonical_uri: str,
        query_params: dict[str, str],
        payload_hash: str,
        extra_headers: Optional[dict[str, str]] = None,
    ) -> dict[str, str]:
        """Generate AWS SigV4 signed headers."""
        if not self.access_key or not self.secret_key:
            headers = dict(extra_headers or {})
            return headers

        now = datetime.now(timezone.utc)
        amz_date = now.strftime("%Y%m%dT%H%M%SZ")
        date_stamp = now.strftime("%Y%m%d")

        parsed = urllib.parse.urlparse(self.endpoint_url)
        host = parsed.netloc or parsed.path

        headers = {
            "host": host,
            "x-amz-date": amz_date,
            "x-amz-content-sha256": payload_hash,
        }
        if extra_headers:
            for k, v in extra_headers.items():
                headers[k.lower()] = v

        sorted_headers = sorted(headers.items())
        canonical_headers = "".join(f"{k}:{v}\n" for k, v in sorted_headers)
        signed_headers = ";".join(k for k, _ in sorted_headers)

        sorted_params = sorted(query_params.items())
        canonical_querystring = urllib.parse.urlencode(sorted_params)

        canonical_request = (
            f"{method.upper()}\n"
            f"{canonical_uri}\n"
            f"{canonical_querystring}\n"
            f"{canonical_headers}\n"
            f"{signed_headers}\n"
            f"{payload_hash}"
        )

        signature = self._sign_canonical(canonical_request, amz_date, date_stamp)
        algorithm = "AWS4-HMAC-SHA256"
        credential_scope = f"{date_stamp}/{self.region}/s3/aws4_request"

        headers["Authorization"] = (
            f"{algorithm} Credential={self.access_key}/{credential_scope}, "
            f"SignedHeaders={signed_headers}, Signature={signature}"
        )
        return headers

    def _sign_canonical(
        self, canonical_request: str, amz_date: str, date_stamp: str
    ) -> str:
        """SigV4 signature over a canonical request (header + query auth)."""
        algorithm = "AWS4-HMAC-SHA256"
        credential_scope = f"{date_stamp}/{self.region}/s3/aws4_request"
        string_to_sign = (
            f"{algorithm}\n"
            f"{amz_date}\n"
            f"{credential_scope}\n"
            f"{hashlib.sha256(canonical_request.encode('utf-8')).hexdigest()}"
        )

        def sign(key: bytes, msg: str) -> bytes:
            return hmac.new(key, msg.encode("utf-8"), hashlib.sha256).digest()

        k_date = sign(f"AWS4{self.secret_key}".encode(), date_stamp)
        k_region = sign(k_date, self.region)
        k_service = sign(k_region, "s3")
        k_signing = sign(k_service, "aws4_request")
        return hmac.new(
            k_signing, string_to_sign.encode("utf-8"), hashlib.sha256
        ).hexdigest()

    def presign(self, method: str, key: str, *, expires_seconds: int = 3600) -> str:
        """Presigned URL (SigV4 query auth) for a direct GET/PUT on `key`.

        The client needs no credentials: auth travels in the query string
        (X-Amz-Signature over UNSIGNED-PAYLOAD), letting browsers and runner
        agents move bytes straight to/from object storage without proxying
        through the API server.
        """
        if not self.access_key or not self.secret_key:
            raise ConfigurationError(
                "Presigned URLs require S3 access/secret keys"
            )
        if method.upper() not in ("GET", "PUT"):
            raise ValidationError(
                f"Unsupported presign method {method!r} (GET or PUT)"
            )
        now = datetime.now(timezone.utc)
        amz_date = now.strftime("%Y%m%dT%H%M%SZ")
        date_stamp = now.strftime("%Y%m%d")
        credential = f"{self.access_key}/{date_stamp}/{self.region}/s3/aws4_request"

        norm = self._normalize_key(key)
        canonical_uri = f"/{self.bucket_name}/{norm}"
        parsed = urllib.parse.urlparse(self.endpoint_url)
        host = parsed.netloc or parsed.path
        query = {
            "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
            "X-Amz-Credential": credential,
            "X-Amz-Date": amz_date,
            "X-Amz-Expires": str(int(expires_seconds)),
            "X-Amz-SignedHeaders": "host",
        }
        canonical_querystring = urllib.parse.urlencode(sorted(query.items()))
        canonical_request = (
            f"{method.upper()}\n"
            f"{canonical_uri}\n"
            f"{canonical_querystring}\n"
            f"host:{host}\n\n"
            f"host\n"
            f"UNSIGNED-PAYLOAD"
        )
        query["X-Amz-Signature"] = self._sign_canonical(
            canonical_request, amz_date, date_stamp
        )
        full_query = urllib.parse.urlencode(sorted(query.items()))
        return f"{self.endpoint_url}{canonical_uri}?{full_query}"

    def _request(
        self,
        method: str,
        key: str = "",
        query: Optional[dict[str, str]] = None,
        data: Optional[bytes] = None,
        extra_headers: Optional[dict[str, str]] = None,
    ) -> httpx.Response:
        query = query or {}
        key = key.lstrip("/")
        canonical_uri = f"/{self.bucket_name}/{key}" if key else f"/{self.bucket_name}"
        payload_hash = hashlib.sha256(data or b"").hexdigest()

        headers = self._sign_headers(method, canonical_uri, query, payload_hash, extra_headers)
        url = f"{self.endpoint_url}{canonical_uri}"
        if query:
            url += f"?{urllib.parse.urlencode(query)}"

        return self._client.request(method, url, headers=headers, content=data)

    def list_dir(self, path: str = "") -> list[StorageItem]:
        norm = self._normalize_key(path)
        prefix = f"{norm}/" if norm else ""
        resp = self._request("GET", query={"list-type": "2", "prefix": prefix, "delimiter": "/"})
        if resp.status_code != 200:
            raise ValidationError(f"Failed to list S3 directory: {resp.status_code} {resp.text}")

        root = ET.fromstring(resp.text)
        ns = {"s3": "http://s3.amazonaws.com/doc/2006-03-01/"}
        items: list[StorageItem] = []

        # Find folders (CommonPrefixes)
        for cp in root.findall("s3:CommonPrefixes", ns) or root.findall("CommonPrefixes"):
            prefix_elem = (
                cp.find("s3:Prefix", ns)
                if cp.find("s3:Prefix", ns) is not None
                else cp.find("Prefix")
            )
            if prefix_elem is not None and prefix_elem.text:
                folder_path = prefix_elem.text.rstrip("/")
                folder_name = folder_path.split("/")[-1]
                items.append(
                    StorageItem(
                        name=folder_name,
                        path=folder_path,
                        is_dir=True,
                        size=0,
                        mime_type="inode/directory",
                    )
                )

        # Find files (Contents)
        for c in root.findall("s3:Contents", ns) or root.findall("Contents"):
            key_elem = (
                c.find("s3:Key", ns)
                if c.find("s3:Key", ns) is not None
                else c.find("Key")
            )
            size_elem = (
                c.find("s3:Size", ns)
                if c.find("s3:Size", ns) is not None
                else c.find("Size")
            )
            mod_elem = (
                c.find("s3:LastModified", ns)
                if c.find("s3:LastModified", ns) is not None
                else c.find("LastModified")
            )

            if key_elem is not None and key_elem.text:
                file_key = key_elem.text
                if file_key == prefix:  # skip directory marker itself
                    continue
                file_name = file_key.split("/")[-1]
                size = int(size_elem.text) if size_elem is not None and size_elem.text else 0
                ext = Path(file_name).suffix.lower()
                mime, _ = mimetypes.guess_type(file_name)
                mime = mime or "application/octet-stream"

                updated = None
                if mod_elem is not None and mod_elem.text:
                    try:
                        updated = datetime.fromisoformat(mod_elem.text.replace("Z", "+00:00"))
                    except Exception:
                        pass

                items.append(
                    StorageItem(
                        name=file_name,
                        path=file_key,
                        is_dir=False,
                        size=size,
                        mime_type=mime,
                        updated_at=updated,
                        extension=ext,
                        is_editable=is_file_editable(file_name, mime),
                        is_plugin_candidate=ext in {".zip", ".tar", ".gz"},
                    )
                )

        return sorted(items, key=lambda x: (not x.is_dir, x.name.lower()))

    def get_file_stream(self, path: str) -> tuple[BinaryIO, str, int]:
        norm = self._normalize_key(path)
        resp = self._request("GET", key=norm)
        if resp.status_code == 404:
            raise NotFoundError(f"Object not found: {path}")
        if resp.status_code != 200:
            raise ValidationError(f"Failed to get S3 object: {resp.status_code}")
        mime = resp.headers.get("content-type", "application/octet-stream")
        size = int(resp.headers.get("content-length", len(resp.content)))
        return io.BytesIO(resp.content), mime, size

    def read_text(self, path: str, max_chars: int = 2_000_000) -> str:
        stream, _, size = self.get_file_stream(path)
        if size > max_chars * 4:
            msg = f"File too large to preview as text ({size} bytes, limit: {max_chars})"
            raise ValidationError(msg)
        data = stream.read()
        try:
            return data.decode("utf-8")
        except UnicodeDecodeError:
            try:
                return data.decode("gbk")
            except UnicodeDecodeError:
                return data.decode("latin-1", errors="replace")

    def write_file(self, path: str, stream: BinaryIO) -> StorageItem:
        norm = self._normalize_key(path)
        content = stream.read()
        mime, _ = mimetypes.guess_type(norm)
        mime = mime or "application/octet-stream"
        resp = self._request("PUT", key=norm, data=content, extra_headers={"content-type": mime})
        if resp.status_code not in (200, 201):
            raise ValidationError(f"Failed to write S3 object: {resp.status_code} {resp.text}")
        return StorageItem(
            name=norm.split("/")[-1],
            path=norm,
            is_dir=False,
            size=len(content),
            mime_type=mime,
            updated_at=datetime.now(timezone.utc),
            extension=Path(norm).suffix.lower(),
            is_editable=is_file_editable(norm, mime),
        )

    def write_text(self, path: str, text: str) -> StorageItem:
        return self.write_file(path, io.BytesIO(text.encode("utf-8")))

    def create_dir(self, path: str) -> StorageItem:
        norm = self._normalize_key(path).rstrip("/") + "/"
        self._request(
            "PUT",
            key=norm,
            data=b"",
            extra_headers={"content-type": "application/x-directory"},
        )
        folder_name = norm.rstrip("/").split("/")[-1]
        return StorageItem(name=folder_name, path=norm.rstrip("/"), is_dir=True, size=0)

    def delete(self, path: str, recursive: bool = False) -> bool:
        norm = self._normalize_key(path)
        if not norm:
            raise ValidationError("Cannot delete bucket root")
        # In S3, directory deletion may require deleting child objects
        if recursive:
            prefix = f"{norm}/"
            list_resp = self._request("GET", query={"list-type": "2", "prefix": prefix})
            if list_resp.status_code == 200:
                root = ET.fromstring(list_resp.text)
                ns = {"s3": "http://s3.amazonaws.com/doc/2006-03-01/"}
                for c in root.findall("s3:Contents", ns) or root.findall("Contents"):
                    key_elem = (
                        c.find("s3:Key", ns)
                        if c.find("s3:Key", ns) is not None
                        else c.find("Key")
                    )
                    if key_elem is not None and key_elem.text:
                        self._request("DELETE", key=key_elem.text)
        resp = self._request("DELETE", key=norm)
        return resp.status_code in (200, 204)

    def stat(self, path: str) -> Optional[StorageItem]:
        norm = self._normalize_key(path)
        if not norm:
            return StorageItem(name="root", path="", is_dir=True, size=0)
        resp = self._request("HEAD", key=norm)
        if resp.status_code == 200:
            size = int(resp.headers.get("content-length", 0))
            mime = resp.headers.get("content-type", "application/octet-stream")
            return StorageItem(
                name=norm.split("/")[-1],
                path=norm,
                is_dir=False,
                size=size,
                mime_type=mime,
                extension=Path(norm).suffix.lower(),
                is_editable=is_file_editable(norm, mime),
            )
        return None

    def get_real_path_if_local(self, path: str) -> Optional[str]:
        return None

    def get_stats(self, path: str = "") -> StorageStats:
        norm = self._normalize_key(path)
        prefix = f"{norm}/" if norm else ""
        list_resp = self._request("GET", query={"list-type": "2", "prefix": prefix})
        if list_resp.status_code != 200:
            raise NotFoundError(f"Failed to query S3 bucket stats for {path}")

        root = ET.fromstring(list_resp.text)
        ns = {"s3": "http://s3.amazonaws.com/doc/2006-03-01/"}
        contents = root.findall("s3:Contents", ns) or root.findall("Contents")

        total_size = 0
        total_files = 0
        cat_stats: dict[str, dict[str, Any]] = {
            "archives": {"label": "归档压缩包", "color": "#722ed1", "size": 0, "count": 0},
            "code": {"label": "代码与配置", "color": "#1677ff", "size": 0, "count": 0},
            "media": {"label": "图片与多媒体", "color": "#13c2c2", "size": 0, "count": 0},
            "docs": {"label": "文档与日志", "color": "#faad14", "size": 0, "count": 0},
            "other": {"label": "其他格式", "color": "#8c8c8c", "size": 0, "count": 0},
        }
        all_candidates: list[StorageLeaderboardItem] = []

        for c in contents:
            key_elem = c.find("s3:Key", ns) if c.find("s3:Key", ns) is not None else c.find("Key")
            size_elem = (
                c.find("s3:Size", ns) if c.find("s3:Size", ns) is not None else c.find("Size")
            )
            mtime_elem = (
                c.find("s3:LastModified", ns)
                if c.find("s3:LastModified", ns) is not None
                else c.find("LastModified")
            )
            if key_elem is not None and key_elem.text:
                k = key_elem.text
                if k.endswith("/"):
                    continue
                size = int(size_elem.text) if size_elem is not None and size_elem.text else 0
                mtime = None
                if mtime_elem is not None and mtime_elem.text:
                    try:
                        mtime = datetime.fromisoformat(mtime_elem.text.replace("Z", "+00:00"))
                    except Exception:
                        pass
                total_files += 1
                total_size += size
                cat, _, _ = categorize_file(k)
                cat_stats[cat]["size"] += size
                cat_stats[cat]["count"] += 1
                all_candidates.append(
                    StorageLeaderboardItem(
                        name=k.split("/")[-1],
                        path=k,
                        is_dir=False,
                        size_bytes=size,
                        updated_at=mtime,
                    )
                )

        type_usages: list[TypeUsage] = []
        for cat_key, cdata in cat_stats.items():
            if cdata["count"] > 0:
                pct = round((cdata["size"] / total_size * 100), 1) if total_size > 0 else 0.0
                type_usages.append(
                    TypeUsage(
                        category=cat_key,
                        label=cdata["label"],
                        color=cdata["color"],
                        size_bytes=cdata["size"],
                        file_count=cdata["count"],
                        percentage=pct,
                    )
                )
        type_usages.sort(key=lambda x: x.size_bytes, reverse=True)
        top_largest = sorted(all_candidates, key=lambda x: x.size_bytes, reverse=True)[:10]

        return StorageStats(
            scope_path=norm,
            total_size_bytes=total_size,
            total_files=total_files,
            total_dirs=0,
            zones=[],
            types=type_usages,
            top_largest=top_largest,
        )
