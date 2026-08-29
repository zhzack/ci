FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    MINI_PIPELINE_CONFIG=/app/config/docker.yaml

RUN apt-get update \
    && apt-get install --no-install-recommends -y git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY pyproject.toml readme.md alembic.ini ./
COPY migrations ./migrations
COPY mini_pipeline ./mini_pipeline
COPY config ./config
COPY scripts/start.sh ./scripts/start.sh
RUN sed -i 's/\r$//' scripts/start.sh \
    && chmod +x scripts/start.sh \
    && pip install --no-cache-dir .

RUN useradd --create-home --uid 10001 pipeline \
    && mkdir -p /app/data \
    && chown -R pipeline:pipeline /app/data
USER pipeline

EXPOSE 8000
CMD ["scripts/start.sh"]
