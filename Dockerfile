FROM node:24-alpine@sha256:a0b9bf06e4e6193cf7a0f58816cc935ff8c2a908f81e6f1a95432d679c54fbfd AS runtime

WORKDIR /app
ENV NODE_ENV=production \
    DESIGNSIGNAL_DATA_DIR=/app/data \
    DESIGNSIGNAL_HOST=0.0.0.0 \
    DESIGNSIGNAL_PORT=3379

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
RUN mkdir -p /app/data && chown node:node /app/data

COPY --chown=node:node bin ./bin
COPY --chown=node:node src ./src
COPY --chown=node:node assets ./assets
COPY --chown=node:node config ./config
COPY --chown=node:node docs ./docs
COPY --chown=node:node README.md LICENSE ./

USER node
EXPOSE 3379
VOLUME ["/app/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3379/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "./bin/designsignal.mjs", "serve"]
