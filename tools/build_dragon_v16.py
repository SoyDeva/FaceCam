#!/usr/bin/env python3
"""Build FaceCam v16 from the approved v13 hybrid source.

v16 is mouth-only. The approved v13 eye POSITION/NORMAL morph buffers are never
modified. It keeps the exact neutral upper muzzle/lip permanent, but unlike v15
it swaps the complete lower-jaw/commissure region so the authored open mouth is
not occluded by a closed neutral lower lip.

Requires Python 3 and numpy.
"""

import argparse
import hashlib
from pathlib import Path

import numpy as np

from build_dragon_v14 import accessor_view, append_indices, read_glb, write_glb


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--v13", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--neutral-max-y", type=float, default=0.300)
    parser.add_argument("--surface-max-y", type=float, default=0.220)
    parser.add_argument("--interior-max-z", type=float, default=0.220)
    parser.add_argument("--interior-max-abs-x", type=float, default=0.130)
    parser.add_argument("--interior-max-y", type=float, default=0.420)
    args = parser.parse_args()

    document, binary = read_glb(args.v13)

    neutral_positions = accessor_view(document, binary, 0).copy()
    head_faces = (
        accessor_view(document, binary, 3)
        .reshape(-1)
        .astype(np.uint32)
        .reshape(-1, 3)
    )
    neutral_mouth_faces = (
        accessor_view(document, binary, 11)
        .reshape(-1)
        .astype(np.uint32)
        .reshape(-1, 3)
    )

    open_base = accessor_view(document, binary, 12).copy()
    jaw_delta = accessor_view(document, binary, 16).copy()
    open_endpoint = open_base + jaw_delta
    open_faces = (
        accessor_view(document, binary, 15)
        .reshape(-1)
        .astype(np.uint32)
        .reshape(-1, 3)
    )

    # v15 left most of the neutral lower lip permanently visible, so at 100%
    # the authored open mouth was hidden behind a narrow closed slit. v16 keeps
    # only the upper muzzle/lip permanent. A neutral triangle is swapped only
    # when every one of its vertices belongs below the lower-jaw boundary; this
    # keeps the cut triangle-clean and avoids the serrated upper-muzzle edge.
    neutral_triangles = neutral_positions[neutral_mouth_faces]
    neutral_max_y = neutral_triangles[:, :, 1].max(axis=1)
    neutral_toggle_mask = neutral_max_y < args.neutral_max_y
    neutral_mouth_new = neutral_mouth_faces[neutral_toggle_mask]
    returned_to_static = neutral_mouth_faces[~neutral_toggle_mask]
    head_new = np.vstack([head_faces, returned_to_static])

    # Preserve the v15 open-source selection: complete low surface plus deep,
    # central oral-cavity geometry. The visual change in v16 comes from no
    # longer occluding this valid open endpoint with the closed lower jaw.
    open_triangles = open_endpoint[open_faces]
    open_centers = open_triangles.mean(axis=1)
    open_max_y = open_triangles[:, :, 1].max(axis=1)

    lower_surface = open_max_y <= args.surface_max_y
    deep_cavity = (
        (open_centers[:, 2] < args.interior_max_z)
        & (open_centers[:, 1] < args.interior_max_y)
        & (np.abs(open_centers[:, 0]) < args.interior_max_abs_x)
    )
    open_mouth_new = open_faces[lower_surface | deep_cavity]

    append_indices(document, binary, 3, head_new)
    append_indices(document, binary, 11, neutral_mouth_new)
    append_indices(document, binary, 15, open_mouth_new)

    document["meshes"][0]["name"] = "FaceCam_HeadStatic_v16"
    document["meshes"][1]["name"] = "FaceCam_NeutralMouth_v16"
    document["meshes"][2]["name"] = "FaceCam_OpenMouth_v16"

    document["meshes"][0].setdefault("extras", {}).update(
        {
            "faceCamNeutralPermanentAboveY": args.neutral_max_y,
            "faceCamEyesFrozenFrom": "v13",
        }
    )
    document["meshes"][2].setdefault("extras", {}).update(
        {
            "faceCamLowerSurfaceMaxY": args.surface_max_y,
            "faceCamInteriorMaxZ": args.interior_max_z,
            "faceCamInteriorMaxAbsX": args.interior_max_abs_x,
            "faceCamInteriorMaxY": args.interior_max_y,
        }
    )

    if len(document.get("materials", [])) > 1:
        document["materials"][1]["doubleSided"] = True

    document.setdefault("asset", {}).setdefault("extras", {}).update(
        {
            "faceCamRigVersion": 16,
            "faceCamMouthOnlyRevision": "full-lower-jaw-toggle-upper-lip-frozen",
            "faceCamEyesFrozenFrom": "v13",
        }
    )

    write_glb(document, binary, args.out)
    output = Path(args.out).read_bytes()
    print("head faces", len(head_new))
    print("neutral mouth faces", len(neutral_mouth_new))
    print("neutral total", len(head_new) + len(neutral_mouth_new))
    print("open mouth faces", len(open_mouth_new))
    print("sha256", hashlib.sha256(output).hexdigest())


if __name__ == "__main__":
    main()
