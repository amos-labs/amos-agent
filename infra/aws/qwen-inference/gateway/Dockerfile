FROM node:22-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32

ARG AMOS_SOURCE_REVISION

LABEL org.opencontainers.image.title="AMOS private Swarm Mission gateway"
LABEL org.opencontainers.image.revision="${AMOS_SOURCE_REVISION}"

WORKDIR /app
RUN chown node:node /app

COPY --chown=node:node infra/aws/qwen-inference/gateway/package.json ./package.json
COPY --chown=node:node scripts/runSwarmTurnGateway.js ./scripts/runSwarmTurnGateway.js
COPY --chown=node:node src/research/experimentProtocol.js ./src/research/experimentProtocol.js
COPY --chown=node:node src/research/missionWorkerProtocol.js ./src/research/missionWorkerProtocol.js
COPY --chown=node:node src/research/swarmTurnGateway.js ./src/research/swarmTurnGateway.js

USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e 'fetch("http://127.0.0.1:18081/health").then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))'

ENTRYPOINT ["node", "scripts/runSwarmTurnGateway.js"]
