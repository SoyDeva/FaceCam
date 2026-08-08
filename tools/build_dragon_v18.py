#!/usr/bin/env python3
"""Build FaceCam v18 from the approved v13 hybrid source.

v18 keeps the approved v13 eye morph buffers byte-for-byte. The neutral mouth is
repartitioned into a permanent upper head and a rigid lower-jaw mesh. Runtime
rotates that lower jaw around a fixed anatomical hinge; no exterior mouth
vertices are stretched. The authored open-source topology is retained only as
an oral cavity behind the rigid neutral jaw.
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
    parser.add_argument("--jaw-max-y", type=float, default=0.305)
    parser.add_argument("--jaw-min-z", type=float, default=0.115)
    parser.add_argument("--central-max-y", type=float, default=0.270)
    parser.add_argument("--central-min-z", type=float, default=0.095)
    parser.add_argument("--cavity-max-z", type=float, default=0.335)
    parser.add_argument("--cavity-front-max-z", type=float, default=0.390)
    parser.add_argument("--cavity-max-abs-x", type=float, default=0.205)
    parser.add_argument("--cavity-front-max-abs-x", type=float, default=0.150)
    parser.add_argument("--cavity-max-y", type=float, default=0.445)
    parser.add_argument("--cavity-front-max-y", type=float, default=0.340)
    parser.add_argument("--hinge-y", type=float, default=0.305)
    parser.add_argument("--hinge-z", type=float, default=0.145)
    parser.add_argument("--max-angle-deg", type=float, default=16.0)
    args = parser.parse_args()

    document, binary = read_glb(args.v13)

    neutral_positions = accessor_view(document, binary, 8).copy()
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
    open_delta = accessor_view(document, binary, 16).copy()
    open_endpoint = open_base + open_delta
    open_faces = (
        accessor_view(document, binary, 15)
        .reshape(-1)
        .astype(np.uint32)
        .reshape(-1, 3)
    )

    eye_hashes = [
        hashlib.sha256(accessor_view(document, binary, i).tobytes()).hexdigest()
        for i in (4, 5, 6, 7)
    ]

    # Rigid lower jaw: triangles must live below the lip line and toward the
    # front half of the head. A small central-chin extension keeps the jaw
    # visually continuous without pulling neck/back geometry into the hinge.
    neutral_triangles = neutral_positions[neutral_mouth_faces]
    max_y = neutral_triangles[:, :, 1].max(axis=1)
    min_z = neutral_triangles[:, :, 2].min(axis=1)
    centers = neutral_triangles.mean(axis=1)

    jaw_mask = (max_y < args.jaw_max_y) & (min_z > args.jaw_min_z)
    jaw_mask |= (
        (max_y < args.central_max_y)
        & (centers[:, 2] > args.central_min_z)
        & (np.abs(centers[:, 0]) < 0.18)
    )

    jaw_faces = neutral_mouth_faces[jaw_mask]
    returned_to_static = neutral_mouth_faces[~jaw_mask]
    head_new = np.vstack([head_faces, returned_to_static])

    # The open-source mesh is cavity-only. Exterior skin is never swapped in;
    # it cannot create serrated seams or detached cheeks/hocico.
    open_triangles = open_endpoint[open_faces]
    open_centers = open_triangles.mean(axis=1)
    cavity_mask = (
        (open_centers[:, 2] < args.cavity_max_z)
        & (np.abs(open_centers[:, 0]) < args.cavity_max_abs_x)
        & (open_centers[:, 1] < args.cavity_max_y)
    )
    cavity_mask |= (
        (open_centers[:, 2] < args.cavity_front_max_z)
        & (np.abs(open_centers[:, 0]) < args.cavity_front_max_abs_x)
        & (open_centers[:, 1] < args.cavity_front_max_y)
    )
    cavity_faces = open_faces[cavity_mask]

    append_indices(document, binary, 3, head_new)
    append_indices(document, binary, 11, jaw_faces)
    append_indices(document, binary, 15, cavity_faces)

    document["meshes"][0]["name"] = "FaceCam_HeadStatic_v18"
    document["meshes"][1]["name"] = "FaceCam_RigidLowerJaw_v18"
    document["meshes"][2]["name"] = "FaceCam_OralCavity_v18"

    document["meshes"][1].setdefault("extras", {}).update(
        {
            "faceCamRole": "neutral-mouth",
            "faceCamRigidJaw": True,
            "faceCamHingeY": args.hinge_y,
            "faceCamHingeZ": args.hinge_z,
            "faceCamMaxAngleDeg": args.max_angle_deg,
        }
    )
    document["meshes"][2].setdefault("extras", {}).update(
        {
            "faceCamRole": "open-mouth",
            "faceCamCavityOnly": True,
        }
    )

    if len(document.get("materials", [])) > 1:
        document["materials"][1]["doubleSided"] = True

    document.setdefault("asset", {}).setdefault("extras", {}).update(
        {
            "faceCamRigVersion": 18,
            "faceCamMouthOnlyRevision": "rigid-neutral-lower-jaw-plus-cavity",
            "faceCamEyesFrozenFrom": "v13",
            "faceCamHingeY": args.hinge_y,
            "faceCamHingeZ": args.hinge_z,
            "faceCamMaxAngleDeg": args.max_angle_deg,
            "faceCamEyeAccessorHashes": eye_hashes,
        }
    )

    write_glb(document, binary, args.out)

    # Re-open and prove that the approved eye accessors were not rewritten.
    output_doc, output_binary = read_glb(args.out)
    output_eye_hashes = [
        hashlib.sha256(accessor_view(output_doc, output_binary, i).tobytes()).hexdigest()
        for i in (4, 5, 6, 7)
    ]
    if output_eye_hashes != eye_hashes:
        raise RuntimeError("Eye morph buffers changed while building v18")

    output = Path(args.out).read_bytes()
    print("head faces", len(head_new))
    print("rigid jaw faces", len(jaw_faces))
    print("neutral total", len(head_new) + len(jaw_faces))
    print("cavity faces", len(cavity_faces))
    print("eyes unchanged", output_eye_hashes == eye_hashes)
    print("sha256", hashlib.sha256(output).hexdigest())


if __name__ == "__main__":
    main()
