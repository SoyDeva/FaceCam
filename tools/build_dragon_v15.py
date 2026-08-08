#!/usr/bin/env python3
"""Build FaceCam v15 from the approved v13 hybrid source.

v15 is mouth-only. The approved v13 eye position/normal morph buffers are never
modified. The exact neutral source is kept permanently through the upper
muzzle/lip; only the lower jaw surface and the deep central oral cavity come
from the authored open source.

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
    parser.add_argument("--neutral-y", type=float, default=0.240)
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

    # Freeze almost the entire original closed mouth into the permanent head.
    # Only the truly lower neutral jaw remains in the visibility-swapped mesh.
    neutral_centers = neutral_positions[neutral_mouth_faces].mean(axis=1)
    neutral_toggle_mask = neutral_centers[:, 1] < args.neutral_y
    neutral_mouth_new = neutral_mouth_faces[neutral_toggle_mask]
    returned_to_static = neutral_mouth_faces[~neutral_toggle_mask]
    head_new = np.vstack([head_faces, returned_to_static])

    # Do not select open triangles merely because their centroid is low: that
    # created the serrated upper-muzzle cut seen in v14. Surface triangles must
    # have every endpoint below the lower-jaw limit. Higher triangles are kept
    # only when they are deep, central oral-cavity geometry.
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

    document["meshes"][0]["name"] = "FaceCam_HeadStatic_v15"
    document["meshes"][1]["name"] = "FaceCam_NeutralMouth_v15"
    document["meshes"][2]["name"] = "FaceCam_OpenMouth_v15"

    document["meshes"][0].setdefault("extras", {}).update(
        {
            "faceCamNeutralFrozenAboveY": args.neutral_y,
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
            "faceCamRigVersion": 15,
            "faceCamMouthOnlyRevision": "upper-muzzle-frozen-lower-jaw-cavity",
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
