# AI Inference Service

Minimal FastAPI backend scaffold for the OHIF AI inference extension.

This service currently provides:
- health and model discovery endpoints
- synchronous inference stubs for nnU-Net, YOLO, and MONAI
- in-memory job and result storage for integration wiring
- pytest smoke tests for health, model listing, inference, and job lookup
