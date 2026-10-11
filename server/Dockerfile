# HITLP reference server: MCP (/mcp and the surface API) on 8080, decision page on 8081.
# Build from the repo root: docker build -f server/Dockerfile .
# Mount the settings files read-only at /etc/hitlp and a volume at /var/lib/hitlp;
# pass --page-url (the page's public https URL) after the image name, e.g.
#   docker run -v hitlp-data:/var/lib/hitlp -v ./config:/etc/hitlp:ro IMAGE --page-url https://hitlp.example.com
FROM node:22-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY sdks/typescript sdks/typescript
RUN cd sdks/typescript && npm ci && npm run build
COPY server server
RUN cd server && npm ci && npm run build && npm prune --omit=dev
# @codefrak/hitlp is a file: link to ../sdks/typescript, which would dangle in /app;
# replace it with the SDK's packed package and its runtime dependencies.
RUN cd sdks/typescript && npm pack --pack-destination /tmp \
 && rm -rf /src/server/node_modules/@codefrak/hitlp \
 && mkdir -p /src/server/node_modules/@codefrak/hitlp \
 && tar -xzf /tmp/codefrak-hitlp-*.tgz --strip-components=1 -C /src/server/node_modules/@codefrak/hitlp \
 && cd /src/server/node_modules/@codefrak/hitlp && npm install --omit=dev --omit=peer --ignore-scripts --no-package-lock

FROM node:22-slim
WORKDIR /app
COPY --from=build /src/server/package.json ./
COPY --from=build /src/server/node_modules node_modules
COPY --from=build /src/server/dist dist
RUN mkdir -p /var/lib/hitlp && chown node:node /var/lib/hitlp
USER node
VOLUME /var/lib/hitlp
EXPOSE 8080 8081
ENTRYPOINT ["node", "dist/src/main.js", \
  "--db", "/var/lib/hitlp/tasks.db", \
  "--http-host", "0.0.0.0", "--http-port", "8080", \
  "--page-host", "0.0.0.0", "--page-port", "8081", \
  "--tokens", "/etc/hitlp/tokens.json", \
  "--approvers", "/etc/hitlp/approvers.json", \
  "--admins", "/etc/hitlp/admins.json", \
  "--surfaces", "/etc/hitlp/surfaces.json"]
CMD []
