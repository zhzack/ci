"""Email domain models and data transfer objects."""

from __future__ import annotations

from pydantic import BaseModel, Field


class SmtpSettings(BaseModel):
    enabled: bool = True
    host: str = "smtp.qq.com"
    port: int = 465
    username: str = ""
    # Credentials come from config env expansion or the admin console DB row.
    password: str = ""
    sender_email: str = ""
    sender_name: str = "Mini Pipeline CI/CD"
    use_ssl: bool = True
    use_tls: bool = False
    # Optional SOCKS5 proxy for SMTP delivery, e.g. "socks5://127.0.0.1:7897"
    # (useful when the server network blocks outbound SMTP ports).
    proxy: str | None = None


class SmtpSettingsOut(BaseModel):
    enabled: bool
    host: str
    port: int
    username: str
    sender_email: str
    sender_name: str
    use_ssl: bool
    use_tls: bool
    proxy: str | None = None
    has_password: bool = True


class UpdateSmtpSettingsRequest(BaseModel):
    enabled: bool = True
    host: str = Field(min_length=1)
    port: int = Field(default=465, ge=1, le=65535)
    username: str = Field(min_length=1)
    password: str | None = None  # None = keep existing password
    sender_email: str = Field(min_length=1)
    sender_name: str = "Mini Pipeline CI/CD"
    use_ssl: bool = True
    use_tls: bool = False
    proxy: str | None = None  # None = keep existing proxy


class SendEmailTask(BaseModel):
    to_email: str
    subject: str
    html_content: str
    text_content: str | None = None
