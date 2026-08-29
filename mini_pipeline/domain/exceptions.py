"""Domain-specific exceptions exposed across application layers."""


class MiniPipelineError(Exception):
    """Base class for errors that can be mapped to an API response."""


class ConfigurationError(MiniPipelineError):
    """Raised when application configuration is invalid."""


class ValidationError(MiniPipelineError):
    """Raised when a manifest or pipeline definition is invalid."""


class NotFoundError(MiniPipelineError):
    """Raised when a requested domain object does not exist."""


class ConflictError(MiniPipelineError):
    """Raised when an object already exists."""


class SourceError(MiniPipelineError):
    """Raised when a plugin source cannot be fetched safely."""


class ExecutionError(MiniPipelineError):
    """Raised when a plugin cannot be executed or its output is invalid."""


class AuthFailedError(MiniPipelineError):
    """Raised when credentials are missing or invalid (HTTP 401)."""


class PermissionDeniedError(MiniPipelineError):
    """Raised when an authenticated caller lacks the required role/grant (403)."""
