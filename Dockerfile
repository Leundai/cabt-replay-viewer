FROM node:26-bookworm-slim AS web
WORKDIR /app/web
RUN chown -R node:node /app
USER node
COPY --chown=node:node web/package*.json ./
RUN npm ci
COPY --chown=node:node web ./
RUN npm run build

FROM python:3.12-slim
WORKDIR /app
RUN groupadd --system app && useradd --system --gid app --home-dir /app app
COPY api/requirements.lock ./api/requirements.lock
RUN pip install --no-cache-dir --require-hashes -r api/requirements.lock
COPY --chown=app:app api ./api
COPY --chown=app:app --from=web /app/web/dist ./api/app/static
ENV CABT_STATIC_DIR=/app/api/app/static
ENV CABT_DATA_DIR=/data
ENV PORT=8080
RUN mkdir -p /data && chown app:app /data
USER app
EXPOSE 8080
CMD ["sh", "-c", "python -m uvicorn api.app.main:app --host 0.0.0.0 --port ${PORT:-8080}"]
