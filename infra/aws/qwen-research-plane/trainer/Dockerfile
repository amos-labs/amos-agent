FROM pytorch/pytorch:2.13.0-cuda13.0-cudnn9-runtime@sha256:db80a41f8428644cebcb3d75b0b62df334ab6c0e75785951eb25f48bfbd42407 AS builder

ARG TRANSFORMERS_REVISION=3d6c72018870c3a89f3024c1383e0fbc6c2f352a
ARG PEFT_REVISION=5d602fdbff04c33c1c4de55cda9d4ae1d7cb7e40
ARG ACCELERATE_REVISION=fd01e35c83d8cc43b88cf0896007716fc5986558

ENV DEBIAN_FRONTEND=noninteractive \
    HF_HUB_DISABLE_TELEMETRY=1 \
    HF_HUB_ENABLE_HF_TRANSFER=0 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    TORCH_DISABLE_NATIVE_JIT=1 \
    PYTHONUNBUFFERED=1 \
    PATH=/opt/venv/bin:$PATH

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates git python3-venv \
    && rm -rf /var/lib/apt/lists/* \
    && python -m venv --system-site-packages /opt/venv

RUN python -m pip install --no-cache-dir \
    "transformers @ git+https://github.com/huggingface/transformers.git@${TRANSFORMERS_REVISION}" \
    "peft @ git+https://github.com/huggingface/peft.git@${PEFT_REVISION}" \
    "accelerate @ git+https://github.com/huggingface/accelerate.git@${ACCELERATE_REVISION}" \
    bitsandbytes==0.50.1 \
    boto3==1.43.78 \
    huggingface-hub==1.28.0 \
    safetensors==0.8.0

FROM pytorch/pytorch:2.13.0-cuda13.0-cudnn9-runtime@sha256:db80a41f8428644cebcb3d75b0b62df334ab6c0e75785951eb25f48bfbd42407

ENV DEBIAN_FRONTEND=noninteractive \
    HF_HUB_DISABLE_TELEMETRY=1 \
    HF_HUB_ENABLE_HF_TRANSFER=0 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PYTHONUNBUFFERED=1 \
    PATH=/opt/venv/bin:$PATH

RUN apt-get update \
    && apt-get upgrade -y \
    && apt-get purge -y \
        linux-libc-dev \
        libc6-dev \
        libc-dev-bin \
        python3-pip \
        python3-wheel \
    && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /opt/venv /opt/venv
WORKDIR /opt/amos
COPY infra/aws/qwen-research-plane/trainer/train_stage0.py /opt/amos/train_stage0.py
RUN python -m py_compile /opt/amos/train_stage0.py \
    && useradd --create-home --uid 10001 trainer \
    && mkdir -p /work/stage0 \
    && chown -R trainer:trainer /work /opt/amos

USER trainer
ENTRYPOINT ["python", "/opt/amos/train_stage0.py"]
