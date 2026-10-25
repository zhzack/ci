"""EmailService real-path tests: SMTP transport selection, proxy parsing,
and failure handling. The SOCKS5 classes were previously untested."""

import smtplib
import socket
from typing import Any

import pytest

from mini_pipeline.domain.exceptions import ValidationError
from mini_pipeline.email import service as email_service_module
from mini_pipeline.email.models import SmtpSettings
from mini_pipeline.email.service import EmailService, _SocksSMTP, _SocksSMTP_SSL


def _service(**overrides: Any) -> EmailService:
    base: dict[str, Any] = dict(
        host="smtp.qq.com",
        port=465,
        username="user@qq.com",
        password="secret-code",
    )
    base.update(overrides)
    return EmailService(default_settings=SmtpSettings(**base))


class FakeSocket:
    def __init__(self, log: list[tuple]) -> None:
        self._log = log

    def set_proxy(self, *args: Any) -> None:
        self._log.append(("set_proxy", args))

    def settimeout(self, value: float) -> None:
        self._log.append(("settimeout", value))

    def gettimeout(self) -> float:
        return 15.0

    def connect(self, address: tuple) -> None:
        self._log.append(("connect", address))

    def getsockopt(self, level: int, optname: int) -> int:
        # ssl.wrap_socket probes SO_TYPE; claim a TCP stream socket.
        return socket.SOCK_STREAM


@pytest.fixture()
def fake_socks(monkeypatch: pytest.MonkeyPatch) -> list[tuple]:
    """Replace the socks module used by the service with a recording fake."""
    log: list[tuple] = []

    class FakeSocksModule:
        SOCKS5 = 2

        @staticmethod
        def socksocket() -> FakeSocket:
            return FakeSocket(log)

    monkeypatch.setattr(email_service_module, "socks", FakeSocksModule)
    return log


class FakeSMTP:
    """Minimal SMTP double recording constructor args and calls."""

    last_instance: "FakeSMTP | None" = None
    login_error: Exception | None = None

    def __init__(self, host: str, port: int, timeout: float = None) -> None:
        self.host = host
        self.port = port
        self.timeout = timeout
        self.logged_in = False
        self.sent: list[Any] = []
        FakeSMTP.last_instance = self

    def __enter__(self) -> "FakeSMTP":
        return self

    def __exit__(self, *args: Any) -> None:
        return None

    def starttls(self) -> None:
        return None

    def login(self, username: str, password: str) -> None:
        if FakeSMTP.login_error is not None:
            raise FakeSMTP.login_error
        self.logged_in = True

    def send_message(self, msg: Any) -> None:
        self.sent.append(msg)


def test_parse_proxy_variants() -> None:
    def proxy_of(value: Any) -> Any:
        svc = _service()
        svc.settings.proxy = value
        return svc._parse_proxy()

    assert proxy_of(None) is None
    assert proxy_of("   ") is None
    assert proxy_of("socks5://127.0.0.1:7897") == ("127.0.0.1", 7897)
    assert proxy_of("socks5h://proxy.internal:1080") == ("proxy.internal", 1080)
    assert proxy_of("10.1.2.3:9050") == ("10.1.2.3", 9050)
    for bad in ("http://127.0.0.1:7897", "socks5://no-port", "ftp://x:1"):
        with pytest.raises(ValidationError):
            proxy_of(bad)


def test_missing_pysocks_with_configured_proxy_raises(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(email_service_module, "socks", None)
    svc = _service(proxy="socks5://127.0.0.1:7897")
    with pytest.raises(ValidationError, match="PySocks"):
        svc._open_server(use_ssl=True)


def test_open_server_uses_plain_smtp_ssl_without_proxy(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    created: list[tuple] = []

    class RecordedSMTP(FakeSMTP):
        def __init__(self, host: str, port: int, timeout: float = None) -> None:
            super().__init__(host, port, timeout)
            created.append((host, port, timeout))

    monkeypatch.setattr(smtplib, "SMTP_SSL", RecordedSMTP)
    server = _service()._open_server(use_ssl=True)
    assert created == [("smtp.qq.com", 465, 15)]
    assert isinstance(server, RecordedSMTP)


def test_open_server_routes_ssl_through_socks(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """SSL + proxy selects _SocksSMTP_SSL and passes proxy coordinates."""
    seen: list[tuple] = []

    def fake_ssl_init(
        self: Any, host: str, port: int, timeout: float, proxy_host: str, proxy_port: int
    ) -> None:
        seen.append((host, port, timeout, proxy_host, proxy_port))

    monkeypatch.setattr(_SocksSMTP_SSL, "__init__", fake_ssl_init)
    server = _service(proxy="socks5://127.0.0.1:7897")._open_server(use_ssl=True)

    assert isinstance(server, _SocksSMTP_SSL)
    assert seen == [("smtp.qq.com", 465, 15, "127.0.0.1", 7897)]


def test_open_server_plain_smtp_with_proxy(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """STARTTLS + proxy selects _SocksSMTP with the configured port."""
    seen: list[tuple] = []

    def fake_plain_init(
        self: Any, host: str, port: int, timeout: float, proxy_host: str, proxy_port: int
    ) -> None:
        seen.append((host, port, timeout, proxy_host, proxy_port))

    monkeypatch.setattr(_SocksSMTP, "__init__", fake_plain_init)
    svc = _service(
        port=587, use_ssl=False, use_tls=True, proxy="socks5://10.0.0.1:1080"
    )
    server = svc._open_server(use_ssl=False)

    assert isinstance(server, _SocksSMTP)
    assert seen == [("smtp.qq.com", 587, 15, "10.0.0.1", 1080)]


def test_socks_get_socket_routes_via_proxy(
    fake_socks: list[tuple],
) -> None:
    """Both SOCKS transports dial the proxy and then the real SMTP host."""

    class FakeContext:
        def wrap_socket(
            self, sock: FakeSocket, server_hostname: str | None = None
        ) -> FakeSocket:
            return sock

    ssl_server = _SocksSMTP_SSL.__new__(_SocksSMTP_SSL)
    ssl_server._socks_proxy = ("127.0.0.1", 7897)
    ssl_server.context = FakeContext()
    ssl_server._get_socket("smtp.qq.com", 465, 15)

    plain_server = _SocksSMTP.__new__(_SocksSMTP)
    plain_server._socks_proxy = ("10.0.0.1", 1080)
    plain_server._get_socket("smtp.qq.com", 587, 15)

    assert ("set_proxy", (2, "127.0.0.1", 7897)) in fake_socks
    assert ("connect", ("smtp.qq.com", 465)) in fake_socks
    assert ("connect", ("smtp.qq.com", 587)) in fake_socks


def test_socks_ssl_wraps_socket_for_tls(fake_socks: list[tuple]) -> None:
    class FakeContext:
        def __init__(self) -> None:
            self.wrapped: FakeSocket | None = None

        def wrap_socket(
            self, sock: FakeSocket, server_hostname: str | None = None
        ) -> FakeSocket:
            self.wrapped = sock
            return sock

    # Bypass __init__ (it would open a real connection); _get_socket is what
    # we are testing.
    server = _SocksSMTP_SSL.__new__(_SocksSMTP_SSL)
    server._socks_proxy = ("127.0.0.1", 7897)
    context = FakeContext()
    server.context = context

    result = server._get_socket("smtp.qq.com", 465, 15)

    assert isinstance(context.wrapped, FakeSocket)
    assert result is context.wrapped


def test_send_failure_wrapped_as_validation_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    FakeSMTP.login_error = RuntimeError("connection refused")
    monkeypatch.setattr(smtplib, "SMTP_SSL", FakeSMTP)
    try:
        with pytest.raises(ValidationError, match="邮件发送失败"):
            _service().send_email_sync(
                to_email="dest@example.com",
                subject="t",
                html_content="<p>hi</p>",
            )
    finally:
        FakeSMTP.login_error = None


def test_send_success_logs_in_and_sends(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(smtplib, "SMTP_SSL", FakeSMTP)
    result = _service().send_email_sync(
        to_email="dest@example.com",
        subject="build ok",
        html_content="<p>ok</p>",
        text_content="ok",
    )

    assert result is True
    server = FakeSMTP.last_instance
    assert server is not None
    assert server.logged_in is True
    assert len(server.sent) == 1
    assert server.sent[0]["Subject"] == "build ok"
