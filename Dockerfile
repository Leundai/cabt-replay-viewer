FROM node:24-bookworm-slim AS web
WORKDIR /app/web
COPY web/package*.json ./
RUN npm ci
COPY web ./
RUN npm run build

FROM python:3.12-slim
WORKDIR /app
COPY api/requirements.txt ./api/requirements.txt
RUN pip install --no-cache-dir -r api/requirements.txt
COPY api ./api
COPY --from=web /app/web/dist ./api/app/static
ENV CABT_STATIC_DIR=/app/api/app/static
ENV CABT_DATA_DIR=/data
ENV PORT=8080
EXPOSE 8080
CMD ["sh", "-c", "python -m uvicorn api.app.main:app --host 0.0.0.0 --port ${PORT:-8080}"]
