from app.schemas.api import InferenceRequest, InferenceResponse
from app.services.external_runner import ExternalRunnerConfig, run_external_inference


class MonaiService:
    name = "monai"
    family = "monai"
    version = "0.1.0"
    task_types = ["segmentation", "detection", "classification"]
    runner_config = ExternalRunnerConfig(
        family="monai",
        command_env_name="AI_INFERENCE_MONAI_COMMAND",
        default_result_format="json-monai",
        recommended_command=["python", "runners/monai_wrapper.py"],
        wrapper_command_env_name="AI_INFERENCE_MONAI_WRAPPER_COMMAND",
        managed_command_env_name="AI_INFERENCE_MONAI_MANAGED_COMMAND",
        managed_runtime_command_env_name="AI_INFERENCE_MONAI_RUNTIME_COMMAND",
    )

    def infer(self, request: InferenceRequest, job_id: str) -> InferenceResponse:
        return run_external_inference(config=self.runner_config, request=request, job_id=job_id)
