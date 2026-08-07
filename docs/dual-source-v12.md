# FaceCam Dragon dual-source v12

The two user-provided source GLBs are not the same topology:

- `Dragon_Head_Low_Poly.glb`: 22,899 vertices / 27,206 triangles (authoritative closed neutral).
- `Abierto_Dragon.glb`: 27,746 vertices / 29,569 triangles (authoritative full-open mouth).

The previous single-topology rigs v2-v11 used the open topology and reconstructed a closed rest pose, which is the source of the remaining lower-mouth artifacts.

v12 embeds both source topologies in one GLB:

- `FaceCamNeutralSource`: aligned original closed geometry, with the approved left/right eyelid morphs transferred to this topology.
- `FaceCamOpenRig`: open-topology rig whose `jawOpen=1` endpoint is the original `Abierto_Dragon.glb` geometry.

Runtime selection uses hysteresis. Rest and small tracking noise stay on the exact neutral source. A real mouth opening switches to the open topology at a non-zero jaw morph; the renderer switches back only after the jaw drops below the lower exit threshold. This prevents topology chatter while preserving the exact neutral and exact full-open endpoints.
