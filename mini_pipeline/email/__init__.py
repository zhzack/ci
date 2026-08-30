"""Email subsystem."""

from mini_pipeline.email.models import SmtpSettings, SmtpSettingsOut, UpdateSmtpSettingsRequest
from mini_pipeline.email.service import EmailService

__all__ = ["EmailService", "SmtpSettings", "SmtpSettingsOut", "UpdateSmtpSettingsRequest"]
