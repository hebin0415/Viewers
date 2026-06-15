from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes.health import router as health_router
from app.api.routes.inference import router as inference_router
from app.api.routes.jobs import router as jobs_router
from app.api.routes.models import router as models_router
from app.api.routes.series import router as series_router
from app.core.settings import settings
from app.services.managed_runtime_manager import managed_runtime_manager


@asynccontextmanager
async def lifespan(_app: FastAPI):
    managed_runtime_manager.start()
    try:
        yield
    finally:
        managed_runtime_manager.stop()


app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    description="AI inference backend scaffold for OHIF integration.",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=list(settings.cors_allowed_origins),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health_router)
app.include_router(models_router)
app.include_router(inference_router)
app.include_router(jobs_router)
app.include_router(series_router)
