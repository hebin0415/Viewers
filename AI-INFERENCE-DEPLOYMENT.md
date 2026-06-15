# OHIF AI Inference Deployment Guide

## 1. Scope

This guide describes how to deploy the current OHIF AI inference integration for nnU-Net, YOLO, and MONAI in this repository.

It covers:

- DICOMWeb service wiring through Orthanc
- required runtime images or raw commands
- required model directory layout
- backend startup order
- production startup commands
- acceptance checks

This guide assumes the code in [AI-INFERENCE-ARCHITECTURE.md](AI-INFERENCE-ARCHITECTURE.md) is already present and that deployment is being done on Windows.

Important status note:

- The repository now contains the integration platform, startup scripts, stop scripts, DICOMWeb wiring, and runtime contract.
- The repository now also contains local runtime image build assets under `backend/ai-inference-service/runtime-images` and model bootstrap scripts under `backend/ai-inference-service/scripts`.
- The current workspace still has not completed a truthful end-to-end validation against running real containers, because Docker daemon access was unavailable during implementation.

## 2. What Must Exist Before Startup

The platform is only fully deployable if the deployment environment provides all of the following:

- one runtime implementation for each family: nnU-Net, YOLO, MONAI
- one model directory for each family
- one reachable DICOMWeb service if real source retrieval or STOW is required

In the current repository, those deployment inputs map to these contracts:

- nnU-Net runtime image: `ohif-ai-nnunet-runtime:3.13.0-beta.87`
- YOLO runtime image: `ohif-ai-yolo-runtime:3.13.0-beta.87`
- MONAI runtime image: `ohif-ai-monai-runtime:3.13.0-beta.87`
- model directories:
  - `backend/ai-inference-service/models/nnunet`
  - `backend/ai-inference-service/models/yolo`
  - `backend/ai-inference-service/models/monai`
- DICOMWeb endpoints:
  - retrieve base URL: `http://127.0.0.1:8042/dicom-web`
  - STOW URL: `http://127.0.0.1:8042/dicom-web/studies`

If your environment does not use Docker runtime images, the backend can still run through raw commands, but those commands must be provided through the `AI_INFERENCE_*_COMMAND` and related environment variables before the backend starts.

Current workspace reality:

- the three model directories exist
- they can now be populated through the checked-in model bootstrap script
- runtime Dockerfiles and family-specific `infer-engine.py` implementations now exist under `backend/ai-inference-service/runtime-images`

That means you must supply either:

- three locally built runtime images from this repository
- or three real raw commands backed by installed frameworks and real model files

## 3. Orthanc Service

Orthanc is already available in your environment and matches the repository's DICOMWeb assumptions.

### 3.1 Startup Command

```powershell
docker pull jodogne/orthanc-plugins
docker run -d --name orthanc -p 4242:4242 -p 8042:8042 --restart=always -v C:/work/openct/newSolution/Viewers/platform/app/public/config/orthanc/orthanc.json:ro jodogne/orthanc-plugins
```

Explorer URL:

- `http://localhost:8042/app/explorer.html`

Orthanc config file:

- [platform/app/public/config/orthanc/orthanc.json](platform/app/public/config/orthanc/orthanc.json)

### 3.2 Relevant Orthanc Facts

The current Orthanc config already enables DICOMWeb and exposes it at:

- `http://127.0.0.1:8042/dicom-web`

That means the current backend deployment can use Orthanc for:

- source series retrieval
- DICOM SEG/SR STOW back into Orthanc
- later OHIF-side derived series refresh through the active data source

## 4. Runtime Image Contract

The current managed runtime deployment expects each family image to support this outer contract:

- a mounted adapter under `/opt/ohif-runtime/<family>/infer.py`
- request file at `/runtime/work/request.json`
- response file at `/runtime/work/response.json`
- model directory mounted under the family-specific `containerModelDir`
- an internal command inside the image referenced by `internalCommand`

Configured defaults live in:

- [backend/ai-inference-service/config/production-runtime.json](backend/ai-inference-service/config/production-runtime.json)

Current internal command conventions are:

- nnU-Net: `/opt/ohif-ai/nnunet/infer-engine.py`
- YOLO: `/opt/ohif-ai/yolo/infer-engine.py`
- MONAI: `/opt/ohif-ai/monai/infer-engine.py`

The checked-in implementations use the following real upstream assets:

- nnU-Net family: TotalSegmentator with automatic TotalSegmentator weight download and DICOM SEG output
- YOLO family: Ultralytics YOLO26n with official release weights downloaded from `ultralytics/assets`
- MONAI family: official `spleen_ct_segmentation` MONAI bundle downloaded with `monai.bundle download`

If your runtime images expose different internal entrypoints, change the `internalCommand` array in the production JSON.

## 5. Model Directory Layout

The default deployment file expects the following host directories:

- `backend/ai-inference-service/models/nnunet`
- `backend/ai-inference-service/models/yolo`
- `backend/ai-inference-service/models/monai`

The production startup script can create these directories automatically.

Expected usage:

- nnU-Net directory stores `totalsegmentator-home` and downloaded TotalSegmentator weights
- YOLO directory stores `yolo26n.pt`
- MONAI directory stores the downloaded `spleen_ct_segmentation` bundle

The exact file naming inside each family directory depends on the runtime image or raw command implementation.

To populate these directories outside Docker, run:

```powershell
Set-Location "C:\work\openct\newSolution\Viewers\backend\ai-inference-service"
.\scripts\download-runtime-models.ps1
```

This will download:

- TotalSegmentator weights into `models/nnunet/totalsegmentator-home`
- `yolo26n.pt` into `models/yolo`
- the `spleen_ct_segmentation` bundle into `models/monai`

## 6. Production Configuration File

The primary deployment file is:

- [backend/ai-inference-service/config/production-runtime.json](backend/ai-inference-service/config/production-runtime.json)

It now includes:

- backend listen host and port
- managed runtime host and ports
- artifact output directory
- Orthanc retrieve URL
- Orthanc STOW URL
- runtime image names
- model directory mappings
- runtime container arguments
- internal command templates

This file is the main place to edit when moving from local defaults to a real environment.

## 7. Startup Sequence

Recommended startup order:

1. Start Orthanc.
2. Confirm Orthanc DICOMWeb is reachable.
3. Build the three runtime images locally.
4. Populate the three model directories with real assets.
5. Start the AI backend production script.
6. Start or open OHIF and point the AI panel to the backend if needed.

## 8. Build Local Runtime Images

From the backend directory:

```powershell
Set-Location "C:\work\openct\newSolution\Viewers\backend\ai-inference-service"
.\scripts\build-runtime-images.ps1
```

This builds the local tags already referenced by `production-runtime.json`:

- `ohif-ai-nnunet-runtime:3.13.0-beta.87`
- `ohif-ai-yolo-runtime:3.13.0-beta.87`
- `ohif-ai-monai-runtime:3.13.0-beta.87`

If these images already exist locally, `start-production.ps1` now tolerates a failed `docker pull` and falls back to the local tags.

## 9. One-Command Managed Runtime Startup

From the backend directory, the standard production startup command is:

```powershell
Set-Location "C:\work\openct\newSolution\Viewers\backend\ai-inference-service"
.\scripts\start-production.ps1 -CreateModelDirectories
```

For a non-destructive dry-run that only resolves config and prepares directories without pulling images or starting the backend:

```powershell
Set-Location "C:\work\openct\newSolution\Viewers\backend\ai-inference-service"
.\scripts\start-production.ps1 -SkipImagePull -SkipBackendStart -CreateModelDirectories
```

If you already built the local images with `build-runtime-images.ps1`, use this startup path to avoid unnecessary registry pulls:

```powershell
Set-Location "C:\work\openct\newSolution\Viewers\backend\ai-inference-service"
.\scripts\start-production.ps1 -SkipImagePull -CreateModelDirectories
```

What this does:

- resolves the JSON configuration
- creates the family model directories if they do not exist
- exports `AI_INFERENCE_*` environment variables
- wires Orthanc retrieve and STOW URLs into the backend environment
- prepares managed runtime startup for nnU-Net, YOLO, and MONAI
- uses CPU defaults unless you override `device` and `extraDockerArgs` in `production-runtime.json`

To stop the system and clean up any lingering runtime containers, use:

```powershell
Set-Location "C:\work\openct\newSolution\Viewers\backend\ai-inference-service"
.\scripts\stop-production.ps1
```

If you also want to stop Orthanc as part of the shutdown:

```powershell
Set-Location "C:\work\openct\newSolution\Viewers\backend\ai-inference-service"
.\scripts\stop-production.ps1 -StopOrthanc
```

## 10. Alternative Raw Command Mode

If you do not want Docker-managed family runtimes, the backend also supports direct commands.

The primary environment variables are:

- `AI_INFERENCE_NNUNET_COMMAND`
- `AI_INFERENCE_YOLO_COMMAND`
- `AI_INFERENCE_MONAI_COMMAND`

Optional wrapper-managed variants are:

- `AI_INFERENCE_NNUNET_WRAPPER_COMMAND`
- `AI_INFERENCE_YOLO_WRAPPER_COMMAND`
- `AI_INFERENCE_MONAI_WRAPPER_COMMAND`

Managed runtime raw command variables are:

- `AI_INFERENCE_NNUNET_RUNTIME_COMMAND`
- `AI_INFERENCE_YOLO_RUNTIME_COMMAND`
- `AI_INFERENCE_MONAI_RUNTIME_COMMAND`

Use raw command mode when:

- model runtimes already exist outside Docker
- you want to run family inference inside Conda or Python environments
- the deployment target uses a scheduler that should own process startup

Use managed image mode when:

- you want one consistent startup path from the repository
- the runtime entrypoints are already containerized
- GPU and filesystem mounting should be controlled by the deployment script

## 11. Acceptance Checks

After startup, verify the deployment in this order.

### 10.1 Orthanc

Open:

- `http://localhost:8042/app/explorer.html`

Confirm Orthanc is reachable and DICOMWeb is enabled.

### 10.2 Backend Health

Open:

- `http://127.0.0.1:8000/health`

Expected result:

- service responds successfully
- available model count is non-zero when runtimes are configured

### 10.3 Model Registration

Open:

- `http://127.0.0.1:8000/models`

Expected result:

- entries for `nnunet`, `yolo`, and `monai`
- each model should report configured once the runtime contract is satisfied

### 10.4 Managed Runtime Health

Expected default runtime health URLs:

- `http://127.0.0.1:8101/health`
- `http://127.0.0.1:8102/health`
- `http://127.0.0.1:8103/health`

Expected result:

- `/health` returns `configured: true`

### 10.5 OHIF Integration

In OHIF:

- open the AI panel
- check backend health
- load models
- run a segmentation or detection request
- verify overlay rendering in the active viewport
- verify that a derived DICOM object is created and can be refreshed back into the viewer

### 10.6 Orthanc Result Persistence

If STOW is enabled, verify in Orthanc explorer that derived SEG or SR instances appear after inference completes.

## 11. Common Failure Modes

If `/models` shows `configured: false`:

- runtime image names do not exist or cannot be pulled
- model directory is missing
- runtime command env vars are missing

If backend inference completes but nothing appears in Orthanc:

- `AI_INFERENCE_DICOMWEB_STOW_URL` is not set
- Orthanc DICOMWeb STOW endpoint is unreachable
- headers or network rules are blocking STOW

If derived DICOM is generated locally but not visible in OHIF:

- the active OHIF data source is not refreshing the derived series metadata
- Orthanc contains the derived object but OHIF study metadata was not reloaded

If managed runtime health fails:

- the runtime image exists but its internal command does not match the configured `internalCommand`
- the mounted model directory path does not match the container's expected path
- GPU arguments in `extraDockerArgs` do not match the host Docker configuration

## 12. Recommended Next Operational Step

Before calling the deployment complete, do one real environment check:

1. Put a minimal valid model bundle into each family model directory.
2. Start Orthanc.
3. Run `start-production.ps1`.
4. Execute one inference from OHIF.
5. Confirm both viewport rendering and Orthanc-side derived DICOM persistence.

That is the smallest end-to-end validation proving the integration is not only wired in code, but operational in your target environment.

## 13. What Still Blocks Real End-to-End Validation Today

The remaining blockers in the current workspace are concrete, not conceptual:

1. No real nnU-Net runtime image or raw command implementation is present.
2. No real YOLO runtime image or raw command implementation is present.
3. No real MONAI runtime image or raw command implementation is present.
4. No actual model weights are present in the three family model directories.

Until those four inputs are supplied, I can validate only the integration shell:

- startup and shutdown behavior
- backend API behavior
- DICOM SEG/SR generation and STOW wiring
- OHIF integration code paths

I cannot truthfully claim a real OHIF-triggered inference against live models has passed in this workspace yet.
