#!/usr/bin/env python3
"""Build FaceCam v20 from the approved v13 hybrid source.

v20 keeps the v19 source-mouth architecture but moves a four-ring topological
collar of the exact neutral mouth into the permanent static head. The collar
backs the authored open-mouth patch at the cheek/comissure seam so profile
views cannot reveal holes. Eye morph buffers and the authored open-mouth
POSITION/NORMAL/morph buffers are not modified.
"""

import argparse
import hashlib
import json
import struct
from collections import deque
from pathlib import Path

import numpy as np

JSON_CHUNK = 0x4E4F534A
BIN_CHUNK = 0x004E4942
DTYPE = {5126: np.dtype('<f4'), 5125: np.dtype('<u4'), 5123: np.dtype('<u2'), 5122: np.dtype('<i2'), 5121: np.dtype('u1')}
NCOMP = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}


def read_glb(path):
    raw = Path(path).read_bytes()
    magic, version, total = struct.unpack_from('<4sII', raw, 0)
    if magic != b'glTF' or version != 2 or total != len(raw):
        raise ValueError('invalid GLB')
    offset = 12
    document = binary = None
    while offset < len(raw):
        length, chunk_type = struct.unpack_from('<II', raw, offset)
        data = raw[offset + 8:offset + 8 + length]
        if chunk_type == JSON_CHUNK:
            document = json.loads(data.rstrip(b' \t\r\n\0'))
        elif chunk_type == BIN_CHUNK:
            binary = bytearray(data)
        offset += 8 + length
    if document is None or binary is None:
        raise ValueError('missing GLB chunks')
    return document, binary


def accessor_view(document, binary, index):
    accessor = document['accessors'][index]
    view = document['bufferViews'][accessor['bufferView']]
    dtype = DTYPE[accessor['componentType']]
    components = NCOMP[accessor['type']]
    offset = view.get('byteOffset', 0) + accessor.get('byteOffset', 0)
    stride = view.get('byteStride', dtype.itemsize * components)
    if stride != dtype.itemsize * components:
        raise ValueError('interleaved accessor unsupported')
    return np.ndarray((accessor['count'], components), dtype=dtype, buffer=binary, offset=offset)


def append_indices(document, binary, accessor_index, indices):
    array = np.asarray(indices, dtype=np.uint32).reshape(-1)
    padding = (-len(binary)) % 4
    if padding:
        binary.extend(b'\0' * padding)
    offset = len(binary)
    payload = array.astype('<u4', copy=False).tobytes()
    binary.extend(payload)
    document['bufferViews'].append({'buffer': 0, 'byteOffset': offset, 'byteLength': len(payload), 'target': 34963})
    document['accessors'][accessor_index].update({'bufferView': len(document['bufferViews']) - 1, 'byteOffset': 0, 'count': int(array.size), 'componentType': 5125, 'type': 'SCALAR', 'min': [int(array.min())], 'max': [int(array.max())]})


def write_glb(document, binary, path):
    document['buffers'][0]['byteLength'] = len(binary)
    json_bytes = json.dumps(document, separators=(',', ':'), ensure_ascii=False).encode('utf-8')
    json_bytes += b' ' * ((-len(json_bytes)) % 4)
    binary_bytes = bytes(binary)
    binary_bytes += b'\0' * ((-len(binary_bytes)) % 4)
    total = 12 + 8 + len(json_bytes) + 8 + len(binary_bytes)
    Path(path).write_bytes(struct.pack('<4sII', b'glTF', 2, total) + struct.pack('<II', len(json_bytes), JSON_CHUNK) + json_bytes + struct.pack('<II', len(binary_bytes), BIN_CHUNK) + binary_bytes)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--v13', required=True)
    parser.add_argument('--out', required=True)
    parser.add_argument('--collar-rings', type=int, default=4)
    parser.add_argument('--collar-min-y', type=float, default=0.23)
    args = parser.parse_args()
    document, binary = read_glb(args.v13)
    neutral = accessor_view(document, binary, 8).copy()
    head = accessor_view(document, binary, 3).reshape(-1).astype(np.uint32).reshape(-1, 3)
    mouth = accessor_view(document, binary, 11).reshape(-1).astype(np.uint32).reshape(-1, 3)
    eye_hashes = [hashlib.sha256(accessor_view(document, binary, index).tobytes()).hexdigest() for index in (4, 5, 6, 7)]
    head_vertices = set(np.unique(head).tolist())
    mouth_vertices = np.unique(mouth)
    seam = sorted(set(mouth_vertices.tolist()) & head_vertices)
    adjacency = {int(vertex): set() for vertex in mouth_vertices}
    for face in mouth:
        a, b, c = map(int, face)
        adjacency[a].update((b, c)); adjacency[b].update((a, c)); adjacency[c].update((a, b))
    rings = {int(vertex): 999 for vertex in mouth_vertices}
    queue = deque()
    for vertex in seam:
        rings[int(vertex)] = 0
        queue.append(int(vertex))
    while queue:
        vertex = queue.popleft()
        next_distance = rings[vertex] + 1
        for neighbor in adjacency[vertex]:
            if next_distance < rings[neighbor]:
                rings[neighbor] = next_distance
                queue.append(neighbor)
    triangle_max_ring = np.array([max(rings[int(vertex)] for vertex in face) for face in mouth])
    centers = neutral[mouth].mean(axis=1)
    collar = (triangle_max_ring <= args.collar_rings) & (centers[:, 1] > args.collar_min_y)
    head_new = np.vstack([head, mouth[collar]])
    mouth_new = mouth[~collar]
    append_indices(document, binary, 3, head_new)
    append_indices(document, binary, 11, mouth_new)
    document['meshes'][0]['name'] = 'FaceCam_HeadStatic_v20'
    document['meshes'][1]['name'] = 'FaceCam_NeutralMouth_v20'
    document['meshes'][2]['name'] = 'FaceCam_OpenMouth_v20'
    document['meshes'][0].setdefault('extras', {}).update({'faceCamRole': 'head-static', 'faceCamRigVersion': 20, 'faceCamSeamCollarTriangles': int(collar.sum()), 'faceCamSeamCollarRings': args.collar_rings, 'faceCamSeamCollarMinY': args.collar_min_y, 'faceCamEyesFrozenFrom': 'v13'})
    document['meshes'][1].setdefault('extras', {}).update({'faceCamRole': 'neutral-mouth', 'faceCamRigVersion': 20, 'faceCamSourceMouthContract': 'neutral-center-with-static-seam-collar'})
    document['meshes'][2].setdefault('extras', {}).update({'faceCamRole': 'open-mouth', 'faceCamRigVersion': 20, 'faceCamSourceMouthContract': 'authored-open-original'})
    document.setdefault('asset', {}).setdefault('extras', {}).update({'faceCamRigVersion': 20, 'faceCamMouthRevision': 'source-open-plus-neutral-topology-seam-collar', 'faceCamNeutralSource': 'Dragon_Head_Low_Poly.glb', 'faceCamOpenSource': 'Abierto_Dragon.glb', 'faceCamEyesFrozenFrom': 'v13', 'faceCamSeamCollarTriangles': int(collar.sum()), 'faceCamNeutralTriangles': int(len(head_new) + len(mouth_new)), 'faceCamOpenPatchTriangles': int(accessor_view(document, binary, 15).reshape(-1).size // 3)})
    if len(document.get('materials', [])) > 1:
        document['materials'][1]['doubleSided'] = True
    write_glb(document, binary, args.out)
    rebuilt, rebuilt_binary = read_glb(args.out)
    after_hashes = [hashlib.sha256(accessor_view(rebuilt, rebuilt_binary, index).tobytes()).hexdigest() for index in (4, 5, 6, 7)]
    if after_hashes != eye_hashes:
        raise RuntimeError('eye buffers changed')
    output = Path(args.out).read_bytes()
    print('collar triangles', int(collar.sum()))
    print('head triangles', len(head_new))
    print('neutral dynamic triangles', len(mouth_new))
    print('neutral total', len(head_new) + len(mouth_new))
    print('open triangles', accessor_view(rebuilt, rebuilt_binary, 15).reshape(-1).size // 3)
    print('eyes unchanged', True)
    print('sha256', hashlib.sha256(output).hexdigest())


if __name__ == '__main__':
    main()
