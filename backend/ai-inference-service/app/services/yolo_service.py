from app.schemas.api import InferenceRequest, InferenceResponse
from app.services.external_runner import ExternalRunnerConfig, run_external_inference


class YoloService:
    name = "yolo"
    family = "yolo"
    version = "0.1.0"
    task_types = ["detection"]
    runner_config = ExternalRunnerConfig(
        family="yolo",
        command_env_name="AI_INFERENCE_YOLO_COMMAND",
        default_result_format="json-detection",
        recommended_command=["python", "runners/yolo_wrapper.py"],
        wrapper_command_env_name="AI_INFERENCE_YOLO_WRAPPER_COMMAND",
        managed_command_env_name="AI_INFERENCE_YOLO_MANAGED_COMMAND",
        managed_runtime_command_env_name="AI_INFERENCE_YOLO_RUNTIME_COMMAND",
    )

    def infer(self, request: InferenceRequest, job_id: str) -> InferenceResponse:
        return run_external_inference(config=self.runner_config, request=request, job_id=job_id)
