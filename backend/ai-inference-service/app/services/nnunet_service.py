from app.schemas.api import InferenceRequest, InferenceResponse
from app.services.external_runner import ExternalRunnerConfig, run_external_inference


class NnUNetService:
    name = "nnunet"
    family = "nnunet"
    version = "0.1.0"
    task_types = ["segmentation"]
    runner_config = ExternalRunnerConfig(
        family="nnunet",
        command_env_name="AI_INFERENCE_NNUNET_COMMAND",
        default_result_format="dicom-seg",
        recommended_command=["python", "runners/nnunet_wrapper.py"],
        wrapper_command_env_name="AI_INFERENCE_NNUNET_WRAPPER_COMMAND",
        managed_command_env_name="AI_INFERENCE_NNUNET_MANAGED_COMMAND",
        managed_runtime_command_env_name="AI_INFERENCE_NNUNET_RUNTIME_COMMAND",
    )

    def infer(self, request: InferenceRequest, job_id: str) -> InferenceResponse:
        return run_external_inference(config=self.runner_config, request=request, job_id=job_id)
