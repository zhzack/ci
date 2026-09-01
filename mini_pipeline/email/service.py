"""Email delivery service with SMTP support and graceful fallback."""

from __future__ import annotations

import logging
import smtplib
from concurrent.futures import ThreadPoolExecutor
from email.header import Header
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from mini_pipeline.domain.exceptions import ValidationError
from mini_pipeline.email.models import SmtpSettings
from mini_pipeline.email.templates import (
    render_otp_email,
    render_pipeline_notification_email,
    render_test_email,
    render_welcome_email,
)

logger = logging.getLogger(__name__)


class EmailService:
    def __init__(self, default_settings: SmtpSettings | None = None) -> None:
        self.settings: SmtpSettings = default_settings or SmtpSettings()
        self._executor = ThreadPoolExecutor(
            max_workers=4, thread_name_prefix="email-worker"
        )

    def update_settings(self, new_settings: SmtpSettings) -> None:
        self.settings = new_settings
        logger.info(
            "Email service SMTP configuration updated (host=%s:%d)",
            self.settings.host,
            self.settings.port,
        )

    def send_email_sync(
        self,
        to_email: str,
        subject: str,
        html_content: str,
        text_content: str | None = None,
    ) -> bool:
        """Send an email synchronously via SMTP with SSL or TLS support."""
        if not self.settings.enabled:
            logger.info("[Mock Email] Email disabled. To=%s, Subject=%s", to_email, subject)
            return True

        if not self.settings.host or not self.settings.username:
            logger.warning(
                "[Mock Email] SMTP not fully configured. To=%s, Subject=%s", to_email, subject
            )
            return True

        msg = MIMEMultipart("alternative")
        sender_header = Header(self.settings.sender_name, "utf-8").encode()
        msg["From"] = f"{sender_header} <{self.settings.sender_email or self.settings.username}>"
        msg["To"] = to_email
        msg["Subject"] = Header(subject, "utf-8")

        if text_content:
            msg.attach(MIMEText(text_content, "plain", "utf-8"))
        msg.attach(MIMEText(html_content, "html", "utf-8"))

        try:
            if self.settings.use_ssl or self.settings.port == 465:
                # SSL connection (e.g. QQ Mail 465)
                with smtplib.SMTP_SSL(
                    self.settings.host, self.settings.port, timeout=15
                ) as server:
                    server.login(self.settings.username, self.settings.password)
                    server.send_message(msg)
            else:
                # Standard SMTP / STARTTLS connection (e.g. 587 or 25)
                with smtplib.SMTP(
                    self.settings.host, self.settings.port, timeout=15
                ) as server:
                    if self.settings.use_tls or self.settings.port == 587:
                        server.starttls()
                    if self.settings.password:
                        server.login(self.settings.username, self.settings.password)
                    server.send_message(msg)

            logger.info("Successfully sent email to %s (Subject=%s)", to_email, subject)
            return True
        except Exception as e:
            logger.error("Failed to send email to %s: %s", to_email, e, exc_info=True)
            raise ValidationError(f"邮件发送失败: {e}") from e

    def send_email_async(
        self,
        to_email: str,
        subject: str,
        html_content: str,
        text_content: str | None = None,
    ) -> None:
        """Dispatch email delivery in a background thread to avoid blocking request handlers."""
        def _task():
            try:
                self.send_email_sync(to_email, subject, html_content, text_content)
            except Exception as e:
                logger.error("Background email task failed to %s: %s", to_email, e)

        self._executor.submit(_task)

    def send_verification_code(
        self, to_email: str, code: str, purpose: str = "register"
    ) -> None:
        """Render and send an OTP verification code email."""
        subject, html_content, text_content = render_otp_email(code, purpose)
        self.send_email_sync(to_email, subject, html_content, text_content)

    def send_pipeline_notification(
        self,
        to_email: str,
        pipeline_name: str,
        run_id: str,
        status: str,
        duration_s: float,
        trigger_by: str = "系统",
        web_url: str = "",
        error_summary: str = "",
    ) -> None:
        """Render and asynchronously send pipeline run completion notification."""
        subject, html_content, text_content = render_pipeline_notification_email(
            pipeline_name=pipeline_name,
            run_id=run_id,
            status=status,
            duration_s=duration_s,
            trigger_by=trigger_by,
            web_url=web_url,
            error_summary=error_summary,
        )
        self.send_email_async(to_email, subject, html_content, text_content)

    def send_test_email(self, to_email: str) -> None:
        """Send a test email to verify SMTP configuration."""
        subject, html_content, text_content = render_test_email()
        self.send_email_sync(to_email, subject, html_content, text_content)

    def send_welcome_email(
        self,
        to_email: str,
        username: str,
        display_name: str = "",
    ) -> None:
        """Render and asynchronously send new user registration welcome email."""
        subject, html_content, text_content = render_welcome_email(
            username=username,
            email=to_email,
            display_name=display_name,
        )
        self.send_email_async(to_email, subject, html_content, text_content)
