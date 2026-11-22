"""Modal deployment: the API (CPU) and the MASt3R builder (GPU).

    pip install modal
    modal setup                                   # one-time login
    modal secret create photos-to-3d GEMINI_API_KEY=...   # or ANTHROPIC_API_KEY=...; add FAL_KEY=... for 360° views
    modal serve backend/app.py                    # temporary URL, reloads on save (start.bat does this)
    modal deploy backend/app.py                   # permanent URL (the GitHub Action does this on push)

No Docker needed: Modal builds the images below on its own servers. The first build takes a while
(PyTorch + 2.7 GB of MASt3R weights); after that it's cached.
"""

from pathlib import Path

import modal

app = modal.App("photos-to-3d")

data = modal.Volume.from_name("photos-to-3d-data", create_if_missing=True)
jobs = modal.Dict.from_name("photos-to-3d-jobs", create_if_missing=True)
secret = modal.Secret.from_name("photos-to-3d")  # GEMINI_API_KEY or ANTHROPIC_API_KEY, optional FAL_KEY

MAST3R_COMMIT = "main"  # pin a commit hash here if a future change to naver/mast3r breaks things
WEIGHTS = "naver/MASt3R_ViTLarge_BaseDecoder_512_catmlpdpt_metric"
DEPTH_MODEL_URL = "https://github.com/fabio-sim/Depth-Anything-ONNX/releases/download/v1.0.0/depth_anything_vits14.onnx"  # keep in step with core/depth.py

web_image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install(
        "fastapi[standard]>=0.115", "python-multipart", "anthropic>=0.40", "google-genai>=1.30",
        "pillow", "pillow-heif", "numpy<2", "trimesh", "onnxruntime", "fal-client>=1.0", "httpx",
    )
    # The depth model for 3D photos (about 100 MB), baked in so it isn't downloaded on every cold start.
    # Downloaded directly (same URL and file name as core/depth.py) because our code isn't in the image yet here.
    .env({"DEPTH_MODEL_DIR": "/opt/depth"})
    .run_commands(
        "mkdir -p /opt/depth && python -c \"import urllib.request; urllib.request.urlretrieve("
        f"'{DEPTH_MODEL_URL}', '/opt/depth/depth_anything_vits14.onnx')\""
    )
    .add_local_python_source("core")
)

gpu_image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("git", "libgl1", "libglib2.0-0")
    .pip_install("torch==2.5.1", "torchvision==0.20.1", "numpy<2")
    .run_commands(
        f"git clone --recursive https://github.com/naver/mast3r /opt/mast3r && cd /opt/mast3r && git checkout {MAST3R_COMMIT}",
        "pip install -r /opt/mast3r/requirements.txt -r /opt/mast3r/dust3r/requirements.txt 'numpy<2'",
    )
    .pip_install("pillow-heif", "fal-client>=1.0", "httpx", "huggingface_hub")
    .env({"PYTHONPATH": "/opt/mast3r", "HF_HOME": "/opt/hf"})
    # Bake the weights into the image so cold starts don't download 2.7 GB
    .run_commands(f"python -c \"from huggingface_hub import snapshot_download; snapshot_download('{WEIGHTS}')\"")
    .add_local_python_source("core")
)


@app.cls(image=gpu_image, gpu="L4", volumes={"/data": data}, secrets=[secret], timeout=30 * 60, scaledown_window=5 * 60)
class Builder:
    @modal.enter()
    def load_model(self):
        import time

        from core.reconstruct import Mast3rReconstructor

        started = time.monotonic()
        self.reconstruct = Mast3rReconstructor(WEIGHTS)
        # this runs once per GPU container: a cold start pays it before the build begins
        print(f"MASt3R loaded onto the GPU in {time.monotonic() - started:.1f}s (cold start)", flush=True)

    @modal.method()
    def build(self, job_id: str, project_id: str):
        import os

        from core.jobs import run_build
        from core.storage import Store

        store = Store(Path("/data"), jobs, commit=data.commit, reload=data.reload)
        panorama = None
        if os.environ.get("FAL_KEY"):
            from core.panorama import make_fal_panorama

            panorama = make_fal_panorama()
        run_build(store, job_id, project_id, self.reconstruct, panorama)


@app.function(image=web_image, volumes={"/data": data}, secrets=[secret], timeout=5 * 60)
@modal.concurrent(max_inputs=20)
@modal.asgi_app()
def api():
    from core.api import create_app
    from core.depth import depth_png
    from core.furnish import furnish_room
    from core.matching import match_photos
    from core.storage import Store

    store = Store(Path("/data"), jobs, commit=data.commit, reload=data.reload)

    def start_build(job_id: str, project_id: str) -> None:
        Builder().build.spawn(job_id, project_id)

    import os

    reimagine = None
    if os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY"):
        from core.reimagine import make_google_reimagine

        reimagine = make_google_reimagine()   # Reimagine: Google's Gemini image model
    from core.depth_fal import make_depth_fn

    # 3D photos: MoGe-2 on fal when FAL_KEY is set, falling back to Depth Anything on this CPU
    return create_app(store, start_build, match_photos, furnish_room, make_depth_fn(depth_png), reimagine)
