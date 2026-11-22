"""Reimagine a redesigned room: the walk-through's 3D render of the new design, made photographic in the
room's real setting. Uses Google's Gemini image model directly (GEMINI_API_KEY); see make_google_reimagine.
The older fal version (make_fal_reimagine) is kept below but no longer wired in.

Check Google works with your key:  GEMINI_API_KEY=... python -m core.reimagine design.jpg photo.jpg "Bedroom"
Use another Google image model with GEMINI_IMAGE_MODEL (and GEMINI_IMAGE_FALLBACK for the second try).

Two pictures go to the image model: the room's original photo, for the real room (walls, windows, the view outside, floor,
light), and a render of the visitor's design from the 3D walk, for what's in it and where (furniture,
layout, colours, wall finish). The result is an AI impression, and the walk-through labels it so.
"""

from __future__ import annotations

import io
import os
import sys
from typing import Callable

import logging

from .panorama import first_image_url

log = logging.getLogger("photos-to-3d")

DEFAULT_MODEL = "fal-ai/nano-banana/edit"
# Used when the first model sends the mock-up back (nearly) unchanged: an image-to-image model, which always
# re-renders the whole picture, keeping its composition and colours by how strongly it starts from it.
DEFAULT_FALLBACK = "fal-ai/flux/dev/image-to-image"
I2I_STRENGTH = 0.6   # 0 = the mock-up as it is, 1 = ignore it; around 0.6 keeps layout and colours, renews the look
MAX_SIDE = 1536


MAX_FURNITURE = 40


def prompt_for(room_name: str, with_photo: bool, notes: str = "", photo_is_this_room: bool = True,
               stronger: bool = False, furniture: list[str] | None = None) -> str:
    """The instructions for Fal: re-render the simulation as a photograph, changing nothing but the rendering.

    furniture lists the pieces in view, each with its colour and where it is in the picture ("a teal sofa,
    centre left, in the middle distance"). Models hold on to named objects far better than to "all the
    furniture", so the list is what keeps every piece present, in place and its own colour.
    """
    room = (room_name or "room").lower()
    p = (
        f"The first image is a 3D simulation of a {room} from an interior design tool: flat shading, simple "
        "textures, computer lighting. Turn it into a real photograph of the same room.\n\n"
        "Keep everything exactly as it is:\n"
        "- Use every piece of furniture and every object in the image, and nothing else. Don't add, remove, "
        "duplicate or swap anything: no extra plants, lamps, cushions, art, rugs, decor or people.\n"
        "- Keep each piece exactly where it is, at the same size, angle and orientation, with the same gaps between "
        "pieces. Nothing moves, rotates or changes scale.\n"
        "- Keep every colour exactly: each piece's colour, the rug's colour and pattern, the wall colour or "
        "wallpaper, the floor's colour and pattern. Match the hues, don't reinterpret them.\n"
        "- Keep the room itself: walls, windows, doors, ceiling, floor layout and the view through the windows.\n"
        "- Keep the camera position, angle, lens and framing.\n"
    )
    items = [str(f).strip()[:120] for f in (furniture or []) if str(f).strip()][:MAX_FURNITURE]
    if items:
        p += "\nThe furniture and objects in the image, all of which must appear exactly as described:\n" + "".join(f"- {i}\n" for i in items)
    p += (
        "\nChange only how it's rendered:\n"
        "- Turn each simulated object into the real thing it represents, with real materials: wood with grain, "
        "upholstery with woven fabric and soft creases, metal with true reflections, glass, ceramic, stone and "
        "painted plaster with their real surface texture.\n"
        "- Give the room natural daylight from the windows, with soft shadows under and behind each piece, contact "
        "shadows where things meet the floor, and gentle bounce light.\n"
        "- Make it look like a professional interior photograph taken on a full-frame camera: sharp, true colours, "
        "realistic depth, natural exposure.\n"
    )
    if with_photo:
        p += (
            f"\nThe second image is a real photograph of this {room}. Use it only for the room's real architecture, "
            "window light, view outside and photographic style. Take all furniture, colours and positions from the "
            "first image, not the photograph.\n"
            if photo_is_this_room else
            "\nThe second image is a real photograph of another room in the same home. Use it only for the home's "
            "finishes, light and photographic style. Take the room, all furniture, colours and positions from the "
            "first image, not the photograph.\n"
        )
    p += "\nNothing in the result should look like computer graphics. No text, watermarks or borders."
    if stronger:
        p += (" The last attempt came back almost identical to the simulation: change the rendering completely, "
              "while keeping every piece, colour and position.")
    notes = (notes or "").strip()
    return p + (f"\n\nAlso: {notes[:300]}" if notes else "")


def looks_unchanged(render: bytes, result: bytes) -> bool:
    """True when the result is near enough the mock-up itself (an edit model that changed almost nothing)."""
    import numpy as np
    from PIL import Image

    def small(b: bytes):
        return np.asarray(Image.open(io.BytesIO(b)).convert("L").resize((96, 64)), dtype=np.float32)

    try:
        return float(np.abs(small(render) - small(result)).mean()) < 7.0
    except Exception:
        return False


def to_jpeg(data: bytes, max_side: int = MAX_SIDE) -> bytes:
    """Any image the browser sent -> an RGB JPEG no bigger than max_side (rejects anything that isn't an image)."""
    from PIL import Image, ImageOps

    im = Image.open(io.BytesIO(data))
    im = ImageOps.exif_transpose(im).convert("RGB")
    im.thumbnail((max_side, max_side))
    out = io.BytesIO()
    im.save(out, "JPEG", quality=90)
    return out.getvalue()


def photo_prompt(room_name: str, furniture: list[str] | None = None, notes: str = "") -> str:
    """A short prompt for image-to-image models (which read a description of the result, not instructions)."""
    room = (room_name or "room").lower()
    p = (f"A professional interior photograph of a {room}, photorealistic, real materials: wood grain, woven "
         "upholstery, painted plaster, glass and metal; soft natural daylight, real shadows and reflections, "
         "shot on a full-frame camera, sharp, true colours.")
    items = [str(f).strip() for f in (furniture or []) if str(f).strip()]
    if items:
        p += " In the room: " + "; ".join(items)[:700] + "."
    notes = (notes or "").strip()
    return p + (f" {notes[:200]}" if notes else "")


def arguments_for(model: str, urls: list[str], prompt: str, short_prompt: str) -> dict:
    """What each kind of fal model takes."""
    if "image-to-image" in model:   # FLUX and similar: one image, a description, and how far to move from it
        return {"image_url": urls[0], "prompt": short_prompt, "strength": I2I_STRENGTH, "num_inference_steps": 40,
                "guidance_scale": 3.5, "num_images": 1, "enable_safety_checker": True}
    if "kontext" in model:          # FLUX Kontext: one image and instructions
        return {"image_url": urls[0], "prompt": prompt, "num_images": 1, "output_format": "jpeg"}
    return {"prompt": prompt, "image_urls": urls, "num_images": 1, "output_format": "jpeg"}   # Nano Banana and the like


def reimagine_with(call: Callable[[str, dict], bytes], render: bytes, urls: list[str], models: list[str],
                   prompts: dict) -> dict:
    """Try the models in turn until one actually re-renders the mock-up.

    call(model, arguments) -> image bytes. prompts: {"full", "stronger", "short"}. The first model gets a second,
    firmer try if it sends the mock-up back unchanged; after that the next model is tried. Returns the image,
    whether it's still unchanged, and which model made it.
    """
    best, best_model, last_error = None, None, None
    for i, model in enumerate(models):
        tries = [prompts["full"], prompts["stronger"]] if i == 0 else [prompts["full"]]
        for prompt in tries:
            try:
                image = call(model, arguments_for(model, urls, prompt, prompts["short"]))
            except Exception as e:   # a model that fails or isn't available: try the next
                log.warning("Reimagine: %s failed: %s", model, e)
                last_error = e
                break
            if not looks_unchanged(render, image):
                return {"image": image, "unchanged": False, "model": model}
            log.warning("Reimagine: %s sent the mock-up back almost unchanged", model)
            best, best_model = image, model
    if best is None:
        raise last_error or RuntimeError("No model returned an image")
    return {"image": best, "unchanged": True, "model": best_model}


def make_fal_reimagine(model: str | None = None, timeout: float = 240) -> Callable[..., dict]:
    """Returns run(render, photo, room_name, notes, photo_is_this_room, furniture) -> {"image", "unchanged", "model"}."""
    import fal_client  # reads FAL_KEY
    import httpx

    first = model or os.environ.get("FAL_REIMAGINE_MODEL", DEFAULT_MODEL)
    fallback = os.environ.get("FAL_REIMAGINE_FALLBACK", DEFAULT_FALLBACK)
    models = [first] + ([fallback] if fallback and fallback != first else [])

    def call(m: str, arguments: dict) -> bytes:
        result = fal_client.subscribe(m, arguments=arguments, client_timeout=timeout)
        url = first_image_url(result)
        if not url:
            keys = list(result) if isinstance(result, dict) else type(result).__name__
            text = (result.get("description") or result.get("text") or "") if isinstance(result, dict) else ""
            raise RuntimeError(f"{m} returned no image (got {keys}) {str(text)[:200]}")
        if isinstance(result, dict) and result.get("description"):
            log.info("Reimagine: %s said: %s", m, str(result["description"])[:300])
        r = httpx.get(url, timeout=120, follow_redirects=True)
        r.raise_for_status()
        return r.content

    def run(render: bytes, photo: bytes | None, room_name: str, notes: str = "", photo_is_this_room: bool = True,
            furniture: list[str] | None = None) -> dict:
        # the mock-up first (the picture to re-render), the real photo second (the look to match)
        urls = [fal_client.upload(render, "image/jpeg")]
        if photo:
            urls.append(fal_client.upload(photo, "image/jpeg"))
        prompts = {
            "full": prompt_for(room_name, bool(photo), notes, photo_is_this_room, furniture=furniture),
            "stronger": prompt_for(room_name, bool(photo), notes, photo_is_this_room, stronger=True, furniture=furniture),
            "short": photo_prompt(room_name, furniture, notes),
        }
        return reimagine_with(call, render, urls, models, prompts)

    return run


# ---- Google (Gemini image generation, "Nano Banana") ----
DEFAULT_GOOGLE_MODEL = "gemini-2.5-flash-image"          # fast, about 5-15 s an image
DEFAULT_GOOGLE_FALLBACK = "gemini-3-pro-image-preview"   # slower, stronger; tried if the first sends the design back


def google_key() -> str | None:
    return os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")


def first_inline_image(response) -> bytes | None:
    """The first picture in a Gemini response (its parts can mix text and images)."""
    for cand in getattr(response, "candidates", None) or []:
        content = getattr(cand, "content", None)
        for part in getattr(content, "parts", None) or []:
            blob = getattr(part, "inline_data", None)
            if blob is not None and getattr(blob, "data", None):
                return blob.data
    return None


def make_google_reimagine(model: str | None = None, timeout_s: float = 120) -> Callable[..., dict]:
    """Returns run(render, photo, room_name, notes, photo_is_this_room, furniture) -> {"image", "unchanged", "model"}.

    Both pictures go straight to Gemini in one request (no uploads), mock-up first, real photo second.
    """
    from google import genai
    from google.genai import types

    client = genai.Client(  # reads GEMINI_API_KEY (or GOOGLE_API_KEY)
        http_options=types.HttpOptions(timeout=int(timeout_s * 1000), retry_options=types.HttpRetryOptions(attempts=1)),
    )
    first = model or os.environ.get("GEMINI_IMAGE_MODEL", DEFAULT_GOOGLE_MODEL)
    fallback = os.environ.get("GEMINI_IMAGE_FALLBACK", DEFAULT_GOOGLE_FALLBACK)
    models = [first] + ([fallback] if fallback and fallback != first else [])

    def run(render: bytes, photo: bytes | None, room_name: str, notes: str = "", photo_is_this_room: bool = True,
            furniture: list[str] | None = None) -> dict:
        images = [types.Part.from_bytes(data=render, mime_type="image/jpeg")]
        if photo:
            images.append(types.Part.from_bytes(data=photo, mime_type="image/jpeg"))

        def call(m: str, arguments: dict) -> bytes:
            response = client.models.generate_content(
                model=m,
                contents=[*images, types.Part.from_text(text=arguments["prompt"])],
                config=types.GenerateContentConfig(response_modalities=["TEXT", "IMAGE"]),
            )
            data = first_inline_image(response)
            if not data:
                text = (getattr(response, "text", None) or "")[:200]
                raise RuntimeError(f"{m} returned no image. {text}")
            return to_jpeg(data)

        prompts = {
            "full": prompt_for(room_name, bool(photo), notes, photo_is_this_room, furniture=furniture),
            "stronger": prompt_for(room_name, bool(photo), notes, photo_is_this_room, stronger=True, furniture=furniture),
            "short": photo_prompt(room_name, furniture, notes),
        }
        # the urls aren't used by Google (the images go in the request itself); reimagine_with only passes them on
        return reimagine_with(call, render, ["inline"], models, prompts)

    return run


if __name__ == "__main__":
    if len(sys.argv) < 2 or not google_key():
        sys.exit('Usage: GEMINI_API_KEY=... python -m core.reimagine design.jpg [photo.jpg] ["Room name"]')
    from pathlib import Path

    design = Path(sys.argv[1])
    photo = Path(sys.argv[2]) if len(sys.argv) > 2 and Path(sys.argv[2]).exists() else None
    name = sys.argv[3] if len(sys.argv) > 3 else (sys.argv[2] if len(sys.argv) > 2 and not photo else "room")
    print(f"Asking {os.environ.get('GEMINI_IMAGE_MODEL', DEFAULT_GOOGLE_MODEL)} to reimagine {design}{' in ' + str(photo) if photo else ''} …")
    res = make_google_reimagine()(to_jpeg(design.read_bytes()), to_jpeg(photo.read_bytes()) if photo else None, name)
    out = design.with_name(f"{design.stem}-reimagined.jpg")
    out.write_bytes(res["image"])
    print(f"Wrote {out}, made by {res['model']}" + (" (but it's almost the same as the design: try GEMINI_IMAGE_MODEL)" if res["unchanged"] else ""))
