FROM node:22-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32 AS node-runtime

FROM docker:28.5.2-cli@sha256:625d9431a9f54c5a2bc90f24f0e1c3d55b1349fd857dd85035f98c2c9acbdd4d AS docker-cli

FROM alpine:3.22@sha256:14358309a308569c32bdc37e2e0e9694be33a9d99e68afb0f5ff33cc1f695dce AS tmux-builder

ARG TMUX_VERSION=3.5a
ARG TMUX_SHA256=16216bd0877170dfcc64157085ba9013610b12b082548c7c9542cc0103198951

RUN apk add --no-cache \
    build-base \
    bison \
    curl \
    libevent-dev \
    libevent-static \
    ncurses-dev \
    ncurses-static \
  && curl --fail --location --silent --show-error \
    "https://github.com/tmux/tmux/releases/download/${TMUX_VERSION}/tmux-${TMUX_VERSION}.tar.gz" \
    --output /tmp/tmux.tar.gz \
  && echo "${TMUX_SHA256}  /tmp/tmux.tar.gz" | sha256sum -c - \
  && mkdir /tmp/tmux-source \
  && tar --extract --gzip --file /tmp/tmux.tar.gz --directory /tmp/tmux-source --strip-components=1 \
  && cd /tmp/tmux-source \
  && ./configure CFLAGS="-Os" LDFLAGS="-static" \
  && make -j"$(getconf _NPROCESSORS_ONLN)" \
  && strip tmux \
  && ! ldd tmux 2>&1 | grep -q 'libc.musl'

FROM python:3.12-alpine@sha256:d09d15e60962ca365d1cd544a48773bac9d33f2fb1b00f2aa0deec78ade7dc31

ARG HARBOR_VERSION=0.22.0
ARG UV_VERSION=0.10.10
ARG AMOS_SOURCE_REVISION
ARG AMOS_SOURCE_DIGEST

COPY --from=node-runtime /usr/local/bin/node /usr/local/bin/node
COPY --from=node-runtime /usr/local/lib/node_modules /usr/local/lib/node_modules
COPY --from=docker-cli /usr/local/bin/docker /usr/local/bin/docker
COPY --from=docker-cli /usr/local/libexec/docker/cli-plugins/docker-compose /usr/local/libexec/docker/cli-plugins/docker-compose
COPY --from=tmux-builder /tmp/tmux-source/tmux /opt/amos/bin/tmux-static
COPY --from=amos-organism . /opt/amos-organism

RUN ln -s /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
  && ln -s /usr/local/lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx \
  && apk add --no-cache bash ca-certificates libstdc++ \
  && python -m venv /opt/harbor \
  && /opt/harbor/bin/pip install --no-cache-dir "uv==${UV_VERSION}" \
  && /opt/harbor/bin/uv pip install --python /opt/harbor/bin/python \
    "awscli==1.46.0" \
    "harbor==${HARBOR_VERSION}"

ENV PATH="/opt/harbor/bin:${PATH}"
ENV NODE_ENV=production
ENV AMOS_SOURCE_REVISION="${AMOS_SOURCE_REVISION}"
ENV AMOS_SOURCE_DIGEST="${AMOS_SOURCE_DIGEST}"
ENV AMOS_ORGANISM_ROOT="/opt/amos-organism"
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

COPY benchmarks ./benchmarks
COPY infra/aws/qwen-inference/scripts ./infra/aws/qwen-inference/scripts
COPY infra/aws/qwen-research-plane/runner/entrypoint.sh ./infra/aws/qwen-research-plane/runner/entrypoint.sh
COPY scripts ./scripts
COPY src ./src

RUN chmod 0755 \
  ./infra/aws/qwen-inference/scripts/run-terminal-bench-holographic-swarm.sh \
  ./infra/aws/qwen-inference/scripts/run-terminal-bench-holographic-training.sh \
  ./infra/aws/qwen-inference/scripts/run-recursive-organism-cycle.sh \
  ./infra/aws/qwen-inference/scripts/run-terminal-bench-task-swarm.sh \
  ./infra/aws/qwen-research-plane/runner/entrypoint.sh

ENTRYPOINT ["./infra/aws/qwen-research-plane/runner/entrypoint.sh"]
