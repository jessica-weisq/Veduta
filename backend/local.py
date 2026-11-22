"""Run the API on your own machine, without Modal: useful for working on the frontend or the API.

    pip install -r backend/requirements-local.txt
    python backend/local.py            # http://localhost:8000

- With GEMINI_API_KEY (or ANTHROPIC_API_KEY) set, /match and /furnish use that model; otherwise a fixed
  demo layout and demo furniture.
- MASt3R runs only if this machine has a CUDA GPU and the mast3r repo on PYTHONPATH. Otherwise the
  model is the plan's floors and walls without scans. Set FAKE_SCANS=1 to get placeholder boxes instead.
"""

from __future__ import annotations

import logging
import os
import sys
import threading
from pathlib import Path

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE))

from core.api import create_app  # noqa: E402
from core.jobs import run_build  # noqa: E402
from core.furnish import demo_furnish, furnish_room  # noqa: E402
from core.matching import demo_match, match_photos, provider  # noqa: E402
from core.storage import Store  # noqa: E402

logging.basicConfig(level=logging.INFO)


def _reconstructor():
    try:
        import torch

        if not torch.cuda.is_available():
            raise RuntimeError("no CUDA GPU")
        from core.reconstruct import Mast3rReconstructor

        return Mast3rReconstructor()
    except Exception as e:
        logging.warning("MASt3R not available (%s): models will have floors and walls only.", e)
        return None


def make_app():
    store = Store(HERE / ".data", {})
    if os.environ.get("FAKE_SCANS"):
        # Stand-in "scans" (plain boxes) so you can see placement in the viewer without a GPU
        sys.path.insert(0, str(HERE / "tests"))
        from synthetic import fake_room_scan

        reconstruct = lambda paths: fake_room_scan(4.0, 3.0, seed=len(paths))  # noqa: E731
        logging.warning("FAKE_SCANS is set: rooms get placeholder boxes instead of MASt3R scans.")
    else:
        reconstruct = _reconstructor()

    panorama = reimagine = None
    if os.environ.get("FAL_KEY"):
        try:
            from core.panorama import make_fal_panorama

            panorama = make_fal_panorama()
            logging.info("FAL_KEY is set: builds make a 360° view per room.")
        except ImportError:
            logging.warning("FAL_KEY is set but fal-client isn't installed (pip install fal-client): no 360° views.")
    if os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY"):
        try:
            from core.reimagine import make_google_reimagine

            reimagine = make_google_reimagine()
            logging.info("GEMINI_API_KEY is set: Reimagine uses Google's Gemini image model.")
        except ImportError:
            logging.warning("GEMINI_API_KEY is set but google-genai isn't installed (pip install google-genai): no reimagining.")

    def start_build(job_id: str, project_id: str) -> None:
        threading.Thread(target=run_build, args=(store, job_id, project_id, reconstruct, panorama), daemon=True).start()

    which = provider()
    match = match_photos if which else demo_match
    if which:
        logging.info("/match uses %s.", which)
    else:
        logging.warning("No GEMINI_API_KEY or ANTHROPIC_API_KEY: /match returns a fixed demo layout.")
    from core import depth
    from core.depth_fal import make_depth_fn

    # MoGe-2 on fal when FAL_KEY is set, with Depth Anything (onnxruntime) as the fallback
    depth_fn = make_depth_fn(depth.depth_png if depth.available() else None)
    if not depth_fn:
        logging.warning("onnxruntime isn't installed: photos in the walk-through stay flat (pip install onnxruntime).")
    return create_app(store, start_build, match, furnish_room if which else demo_furnish, depth_fn, reimagine)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(make_app(), host="127.0.0.1", port=int(os.environ.get("PORT", "8000")))
