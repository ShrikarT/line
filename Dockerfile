# Build the frontend and run deployment:prepare on the host before docker build.
FROM node:26.7.0-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY dist ./dist
COPY server ./server
COPY src/lib ./src/lib
COPY scripts ./scripts
COPY contracts ./contracts
COPY .deployment/organization ./.compact-keys/releases/organization
COPY .deployment/organization-release.json ./.compact-keys/organization-release.json
RUN node scripts/validate-organization-release.mjs
RUN mkdir -p /data/line-supplier && chown -R node:node /data/line-supplier
USER node
ENV NODE_ENV=production PORT=3000 LINE_SUPPLIER_DATA_DIR=/data/line-supplier
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=240s CMD node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--experimental-strip-types", "server/organization-server.mjs"]
