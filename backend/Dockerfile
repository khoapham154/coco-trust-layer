FROM python:3.11-slim

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

# Build context is the repo root (see deploy/docker-compose.yml).
# Copy requirements first so dep-only changes cache well.
COPY backend/requirements.txt /app/backend/requirements.txt
RUN pip install --no-cache-dir -r /app/backend/requirements.txt

# Source layout inside the image mirrors the repo so absolute
# imports like `from agents.twenty_agent import ...` resolve.
COPY backend /app/backend
COPY agents /app/agents
COPY frontend /app/frontend

# Packs, scenarios, fixtures, and the banking demo data. Shipping data/
# makes the image self-contained: with COCO_PACK_DIR unset, config loads
# both data/twenty/packs and data/banking/packs (6 packs). browser-extension
# backs the /browser-extension.zip route.
COPY data /app/data
COPY browser-extension /app/browser-extension

# Make backend/ the default working dir so uvicorn picks up `main:app`
# with the same relative imports as in dev.
WORKDIR /app/backend

EXPOSE 8080

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONPATH=/app:/app/backend

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080"]
