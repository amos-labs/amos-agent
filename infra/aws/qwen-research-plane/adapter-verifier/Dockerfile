FROM pytorch/pytorch:2.13.0-cuda13.0-cudnn9-runtime@sha256:db80a41f8428644cebcb3d75b0b62df334ab6c0e75785951eb25f48bfbd42407 AS builder

ARG VLLM_VERSION=0.27.1

ENV DEBIAN_FRONTEND=noninteractive \
    HF_HUB_DISABLE_TELEMETRY=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PYTHONUNBUFFERED=1 \
    PATH=/opt/venv/bin:$PATH

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates python3-venv \
    && rm -rf /var/lib/apt/lists/* \
    && python -m venv --system-site-packages /opt/venv

RUN python -m pip install --no-cache-dir \
    "vllm==${VLLM_VERSION}"

FROM pytorch/pytorch:2.13.0-cuda13.0-cudnn9-runtime@sha256:db80a41f8428644cebcb3d75b0b62df334ab6c0e75785951eb25f48bfbd42407

ENV DEBIAN_FRONTEND=noninteractive \
    HF_HUB_DISABLE_TELEMETRY=1 \
    HF_HUB_OFFLINE=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PYTHONUNBUFFERED=1 \
    TRANSFORMERS_OFFLINE=1 \
    PATH=/opt/venv/bin:$PATH

RUN apt-get update \
    && apt-get upgrade -y \
    && apt-get purge -y \
        python3-pip \
        python3-wheel \
    && apt-get autoremove -y \
    && apt-get install -y --no-install-recommends gcc libc6-dev linux-libc-dev \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /opt/venv /opt/venv
WORKDIR /opt/amos
COPY infra/aws/qwen-research-plane/adapter-verifier/verify_vllm_adapter.py /opt/amos/verify_vllm_adapter.py
RUN python -m py_compile /opt/amos/verify_vllm_adapter.py \
    && useradd --create-home --uid 10001 verifier \
    && mkdir -p /work \
    && chown -R verifier:verifier /work /opt/amos

USER verifier
ENTRYPOINT ["python", "/opt/amos/verify_vllm_adapter.py"]
