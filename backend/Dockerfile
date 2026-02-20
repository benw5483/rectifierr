FROM python:3.12-slim

# Install system dependencies (FFmpeg + OpenCV deps)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libgl1-mesa-glx \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Config and thumbnail dirs will be mounted as volumes
RUN mkdir -p /config /media /config/thumbnails

ENV PYTHONUNBUFFERED=1 \
    DATABASE_URL="sqlite:////config/rectifierr.db" \
    CONFIG_DIR="/config" \
    THUMBNAILS_DIR="/config/thumbnails" \
    MEDIA_ROOT="/media"

EXPOSE 8000

# Single worker required — in-memory scan/sync state is not shared across processes.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
