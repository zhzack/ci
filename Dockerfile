FROM python:3.9-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    MINI_PIPELINE_CONFIG=/app/config/docker.yaml

RUN apt-get update \
    && apt-get install --no-install-recommends -y git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY pyproject.toml readme.md ./
COPY mini_pipeline ./mini_pipeline
COPY config ./config
RUN pip install --no-cache-dir .

RUN useradd --create-home --uid 10001 pipeline \
    && mkdir -p /app/data \
    && chown -R pipeline:pipeline /app/data
USER pipeline

EXPOSE 8000
CMD ["uvicorn", "mini_pipeline.server.app:app", "--host", "0.0.0.0", "--port", "8000"]
