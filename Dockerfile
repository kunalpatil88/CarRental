FROM node:20-alpine

ENV NODE_ENV=production \
    PORT=3000 \
    CONFIG_FILE=/app/config/admin.config.json

WORKDIR /app
COPY . .

# Folders the admin panel writes to. They are mounted as volumes in docker-compose.yml
# so content, uploads and the password survive rebuilds.
RUN mkdir -p config data/backups assets/img/uploads \
 && chown -R node:node config data assets/img/uploads

USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "server.js"]
