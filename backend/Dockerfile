# Tillforty backend — FastAPI served by uvicorn.
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# Dependencies first for better layer caching.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Application code.
COPY app ./app

# Where uploaded file binaries live (bind a volume here in compose).
RUN mkdir -p /srv/storage
EXPOSE 8000

# --root-path /api so the app sits behind the nginx /api prefix and /api/docs works.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--root-path", "/api"]
