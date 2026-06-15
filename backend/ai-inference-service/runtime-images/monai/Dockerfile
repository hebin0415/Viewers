FROM python:3.11-slim

ARG PYTORCH_CPU_INDEX_URL=https://download.pytorch.org/whl/cpu

ENV PIP_NO_CACHE_DIR=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential git libglib2.0-0 libsm6 libxext6 libxrender1 \
    && rm -rf /var/lib/apt/lists/*

RUN python -m pip install --upgrade pip setuptools wheel \
    && python -m pip install --extra-index-url ${PYTORCH_CPU_INDEX_URL} \
        dicom2nifti==2.6.0 \
        httpx==0.28.1 \
        monai[fire]==1.4.0 \
        nibabel==5.3.2 \
        numpy==1.26.4 \
        pydicom==3.0.1 \
        pytorch-ignite==0.5.1 \
        requests==2.32.3 \
        torch==2.5.1+cpu

COPY runtime-images/common/ohif_runtime_common.py /opt/ohif-ai/common/ohif_runtime_common.py
COPY runtime-images/monai/infer-engine.py /opt/ohif-ai/monai/infer-engine.py

WORKDIR /opt/ohif-ai
