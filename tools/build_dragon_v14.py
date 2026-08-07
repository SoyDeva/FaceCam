#!/usr/bin/env python3
"""Build the FaceCam v14 mouth-only GLB from the approved v13 asset.

The v13 eye geometry/morph accessors are never modified. v14 only repartitions
triangle indices around the mouth so more of the exact neutral source stays
permanently visible while the open-source patch is limited to the oral/lower-jaw
region. Requires Python 3 and numpy.
"""

import argparse
import hashlib
import json
import struct
from pathlib import Path

import numpy as np

JSON_CHUNK = 0x4E4F534A
BIN_CHUNK = 0x004E4942
DTYPE = {
    5126: np.dtype("<f4"),
    5125: np.dtype("<u4"),
    5123: np.dtype("<u2"),
    5122: np.dtype("<i2"),
    5121: np.dtype("u1"),
}
NCOMP = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}


def read_glb(path: str):
    raw = Path(path).read_bytes()
    magic, version, total = struct.unpack_from("<4sII", raw, 0)
    if magic != b"glTF" or version != 2 or total != len(raw):
        raise ValueError("Invalid GLB 2.0 file")

    offset = 12
    document = None
    binary = None
    while offset < len(raw):
        length, chunk_type = struct.unpack_from("<II", raw, offset)
        data = raw[offset + 8 : offset + 8 + length]
        if chunk_type == JSON_CHUNK:
            document = json.loads(data.rstrip(b" \t\r\n\x00"))
        elif chunk_type == BIN_CHUNK:
            binary = bytearray(data)
        offset += 8 + length

    if document is None or binary is None:
        raise ValueError("GLB is missing JSON or BIN chunk")
    return document, binary


def accessor_view(document, binary, accessor_index: int):
    accessor = document["accessors"][accessor_index]
    view = document["bufferViews"][accessor["bufferView"]]
    dtype = DTYPE[accessor["componentType"]]
    components = NCOMP[accessor["type"]]
    offset = view.get("byteOffset", 0) + accessor.get("byteOffset", 0)
    stride = view.get("byteStride", dtype.itemsize * components)
    if stride != dtype.itemsize * components:
        raise ValueError("Strided accessors are not supported by this builder")
    return np.ndarray(
        (accessor["count"], components),
        dtype=dtype,
        buffer=binary,
        offset=offset,
    )


def append_indices(document, binary, accessor_index: int, indices):
    array = np.asarray(indices, dtype=np.uint32).reshape(-1)
    padding = (-len(binary)) % 4
    if padding:
        binary.extend(b"\0" * padding)

    offset = len(binary)
    payload = array.astype("<u4", copy=False).tobytes()
    binary.extend(payload)
    document["bufferViews"].append(
        {
            "buffer": 0,
            "byteOffset": offset,
            "byteLength": len(payload),
            "target": 34963,
        }
    )

    accessor = document["accessors"][accessor_index]
    accessor["bufferView"] = len(document["bufferViews"]) - 1
    accessor["byteOffset"] = 0
    accessor["count"] = int(array.size)
    accessor["componentType"] = 5125
    accessor["type"] = "SCALAR"
    accessor["min"] = [int(array.min())] if array.size else [0]
    accessor["max"] = [int(array.max())] if array.size else [0]


def write_glb(document, binary, path: str):
    document["buffers"][0]["byteLength"] = len(binary)
    json_bytes = json.dumps(
        document, separators=(",", ":"), ensure_ascii=False
    ).encode("utf-8")
    json_bytes += b" " * ((-len(json_bytes)) % 4)
    bin_bytes = bytes(binary)
    bin_bytes += b"\0" * ((-len(bin_bytes)) % 4)

    total = 12 + 8 + len(json_bytes) + 8 + len(bin_bytes)
    output = (
        struct.pack("<4sII", b"glTF", 2, total)
        + struct.pack("<II", len(json_bytes), JSON_CHUNK)
        + json_bytes
        + struct.pack("<II", len(bin_bytes), BIN_CHUNK)
        + bin_bytes
    )
    Path(path).write_bytes(output)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--v13", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--neutral-y", type=float, default=0.340)
    parser.add_argument("--open-y", type=float, default=0.360)
    args = parser.parse_args()

    document, binary = read_glb(args.v13)

    # Accessor numbers are part of the approved v13 schema. Position, normal,
    # UV and eye-morph buffers remain byte-for-byte unchanged.
    neutral_positions = accessor_view(document, binary, 0).copy()
    head_faces = accessor_view(document, binary, 3).reshape(-1).astype(np.uint32).reshape(-1, 3)
    neutral_mouth_faces = accessor_view(document, binary, 11).reshape(-1).astype(np.uint32).reshape(-1, 3)
    open_base = accessor_view(document, binary, 12).copy()
    jaw_delta = accessor_view(document, binary, 16).copy()
    open_endpoint = open_base + jaw_delta
    open_faces = accessor_view(document, binary, 15).reshape(-1).astype(np.uint32).reshape(-1, 3)

    # Keep the upper lip/hocico from the exact neutral source permanently
    # visible. Only lower lip/jaw triangles are toggled when the mouth opens.
    neutral_centers = neutral_positions[neutral_mouth_faces].mean(axis=1)
    hidden = neutral_centers[:, 1] < args.neutral_y
    neutral_mouth_new = neutral_mouth_faces[hidden]
    returned_to_static = neutral_mouth_faces[~hidden]
    head_new = np.vstack([head_faces, returned_to_static])

    # Limit the opened-source patch to the actual oral/lower-jaw region. The
    # small vertical overlap with the neutral head hides the cut seam.
    open_centers = open_endpoint[open_faces].mean(axis=1)
    open_mouth_new = open_faces[open_centers[:, 1] < args.open_y]

    append_indices(document, binary, 3, head_new)
    append_indices(document, binary, 11, neutral_mouth_new)
    append_indices(document, binary, 15, open_mouth_new)

    document["meshes"][0]["name"] = "FaceCam_HeadStatic_v14"
    document["meshes"][1]["name"] = "FaceCam_NeutralMouth_v14"
    document["meshes"][2]["name"] = "FaceCam_OpenMouth_v14"
    document["meshes"][0].setdefault("extras", {})[
        "faceCamMouthFrozenAboveY"
    ] = args.neutral_y
    document["meshes"][2].setdefault("extras", {})[
        "faceCamOralPatchMaxY"
    ] = args.open_y

    # The oral patch is intentionally cut from a larger source mesh. Rendering
    # both sides prevents cavity/boundary triangles from disappearing because
    # of back-face culling.
    if len(document.get("materials", [])) > 1:
        document["materials"][1]["doubleSided"] = True

    document.setdefault("asset", {}).setdefault("extras", {}).update(
        {
            "faceCamRigVersion": 14,
            "faceCamMouthOnlyRevision": "regional-face-repartition",
            "faceCamEyesFrozenFrom": "v13",
        }
    )

    write_glb(document, binary, args.out)
    output = Path(args.out).read_bytes()
    print(
        "neutral hidden faces", len(neutral_mouth_new),
        "returned static", len(returned_to_static),
        "head total", len(head_new),
        "open faces", len(open_mouth_new),
    )
    print("sha256", hashlib.sha256(output).hexdigest())


if __name__ == "__main__":
    main()
