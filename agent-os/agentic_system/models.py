import os

from dotenv import load_dotenv
from agno.models.azure import AzureOpenAI
from agno.models.openai import OpenAIChat

# Load .env before importing config so env-driven defaults resolve.
_backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_env_path = os.path.join(_backend_dir, ".env")
load_dotenv(dotenv_path=_env_path)

import agentic_system.config.config as CFG  # noqa: E402  (submodule path, avoids __init__ cycle)


def get_shared_model(has_tools: bool = True):
    """
    Returns the appropriate model based on configuration.
    If Azure variables are present, it configures AzureOpenAI.
    Otherwise, it defaults to standard OpenAIChat.

    `parallel_tool_calls` is forced to False (via `request_params`) so
    each turn issues at most one tool call. Neither `OpenAIChat` nor
    `AzureOpenAI` in Agno expose this as a constructor arg — but both
    accept a `request_params` dict that is spread onto the OpenAI SDK
    call, and the Chat Completions API accepts `parallel_tool_calls`
    natively. Escape hatch: PARALLEL_TOOLS=1 in .env.

    Set `has_tools=False` for toolless agents (e.g. the onboarding
    copilot). OpenAI's API returns 400 for `parallel_tool_calls` when
    no `tools` are supplied on the request.
    """
    request_params = (
        {"parallel_tool_calls": False} if (has_tools and not CFG.PARALLEL_TOOLS) else None
    )

    if CFG.AZURE_ENDPOINT and CFG.AZURE_API_KEY:
        # AzureOpenAI expects the base endpoint (e.g. https://my-resource.openai.azure.com/)
        # It automatically appends /openai/deployments/... so we strip trailing paths if present.
        clean_endpoint = (
            CFG.AZURE_ENDPOINT.replace("/openai/v1", "").replace("/openai", "").rstrip("/")
        )

        return AzureOpenAI(
            id=CFG.MODEL_ID,
            azure_endpoint=clean_endpoint,
            api_key=CFG.AZURE_API_KEY,
            api_version=CFG.AZURE_API_VERSION,
            request_params=request_params,
        )
    elif CFG.OPENAI_API_KEY:
        return OpenAIChat(
            id=CFG.MODEL_ID,
            api_key=CFG.OPENAI_API_KEY,
            request_params=request_params,
        )
    else:
        raise ValueError("Neither Azure nor OpenAI credentials were found in .env")
