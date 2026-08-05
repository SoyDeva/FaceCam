from pathlib import Path

path = Path('src/masks/three/StaticDragonRenderer.ts')
source = path.read_text()


def replace_once(old: str, new: str) -> None:
    global source
    count = source.count(old)
    if count != 1:
        raise SystemExit(f'Expected exactly one match, found {count}: {old[:100]!r}')
    source = source.replace(old, new, 1)


replace_once(
    "import {\n"
    "  configureDragonEyelidOverlay,\n"
    "  createDragonEyelidOverlay,\n"
    "  disposeDragonEyelidOverlay,\n"
    "  drawDragonEyelidOverlay,\n"
    "} from './dragonEyelidFallback'\n",
    "import {\n"
    "  applyDragonMeshEyelidRig,\n"
    "  createDragonMeshEyelidRig,\n"
    "  type DragonMeshEyelidBinding,\n"
    "} from './dragonMeshEyelidRig'\n",
)

replace_once(
    "  private readonly privacyMesh: Mesh\n"
    "  private readonly leftEyelidOverlay = createDragonEyelidOverlay(\n"
    "    'WhiteDragon_AnatomicalEyelid_Left',\n"
    "  )\n"
    "  private readonly rightEyelidOverlay = createDragonEyelidOverlay(\n"
    "    'WhiteDragon_AnatomicalEyelid_Right',\n"
    "  )\n"
    "  private lastBlinkLeft = -1\n"
    "  private lastBlinkRight = -1\n",
    "  private readonly privacyMesh: Mesh\n"
    "  private proceduralEyelids: DragonMeshEyelidBinding[] = []\n",
)

replace_once(
    "    this.privacyMesh.position.z = -1.42\n"
    "    this.privacyMesh.frustumCulled = false\n"
    "    this.modelContainer.add(\n"
    "      this.leftEyelidOverlay.mesh,\n"
    "      this.rightEyelidOverlay.mesh,\n"
    "    )\n\n",
    "    this.privacyMesh.position.z = -1.42\n"
    "    this.privacyMesh.frustumCulled = false\n\n",
)

replace_once(
    "      this.hasNativeBlink = this.hasMorph('blinkLeft') && this.hasMorph('blinkRight')\n",
    "      // The installed dragon advertises blink morphs, but they deform the\n"
    "      // snout instead of closing the eyelids. Keep them disabled and move\n"
    "      // only the dragon mesh vertices around each real eye.\n"
    "      this.hasNativeBlink = false\n",
)

replace_once(
    "      this.configureEyelidFallback(bounds, size, center, modelEyeY)\n",
    "      this.proceduralEyelids = createDragonMeshEyelidRig(\n"
    "        gltf.scene,\n"
    "        bounds,\n"
    "        size,\n"
    "        center,\n"
    "        modelEyeY,\n"
    "      )\n",
)

replace_once(
    "    disposeDragonEyelidOverlay(this.leftEyelidOverlay)\n"
    "    disposeDragonEyelidOverlay(this.rightEyelidOverlay)\n",
    "",
)

replace_once(
    "      this.setMorph(binding, 'blinkLeft', expression.blinkLeft)\n"
    "      this.setMorph(binding, 'blinkRight', expression.blinkRight)\n",
    "",
)

replace_once(
    "    this.updateEyelidFallback(expression)\n"
    "  }\n\n"
    "  private configureEyelidFallback(\n"
    "    bounds: Box3,\n"
    "    size: Vector3,\n"
    "    center: Vector3,\n"
    "    modelEyeY: number,\n"
    "  ): void {\n"
    "    const frontZ = bounds.max.z - center.z + size.z * 0.018\n"
    "    const eyeY = bounds.min.y + size.y * 0.575 - modelEyeY\n"
    "    const eyeX = size.x * 0.17\n"
    "    const eyeWidth = size.x * 0.205\n"
    "    const eyeHeight = size.y * 0.09\n\n"
    "    configureDragonEyelidOverlay(\n"
    "      this.leftEyelidOverlay,\n"
    "      -eyeX,\n"
    "      eyeY,\n"
    "      frontZ,\n"
    "      eyeWidth,\n"
    "      eyeHeight,\n"
    "      0.09,\n"
    "    )\n"
    "    configureDragonEyelidOverlay(\n"
    "      this.rightEyelidOverlay,\n"
    "      eyeX,\n"
    "      eyeY,\n"
    "      frontZ,\n"
    "      eyeWidth,\n"
    "      eyeHeight,\n"
    "      -0.09,\n"
    "    )\n"
    "    this.lastBlinkLeft = -1\n"
    "    this.lastBlinkRight = -1\n"
    "  }\n\n"
    "  private updateEyelidFallback(expression: DragonExpressionState): void {\n"
    "    const leftBlink = clamp(expression.blinkLeft * 1.16, 0, 1)\n"
    "    const rightBlink = clamp(expression.blinkRight * 1.16, 0, 1)\n\n"
    "    if (Math.abs(leftBlink - this.lastBlinkLeft) > 0.008) {\n"
    "      drawDragonEyelidOverlay(this.leftEyelidOverlay, leftBlink, 'left')\n"
    "      this.lastBlinkLeft = leftBlink\n"
    "    }\n"
    "    if (Math.abs(rightBlink - this.lastBlinkRight) > 0.008) {\n"
    "      drawDragonEyelidOverlay(this.rightEyelidOverlay, rightBlink, 'right')\n"
    "      this.lastBlinkRight = rightBlink\n"
    "    }\n"
    "  }\n\n",
    "    applyDragonMeshEyelidRig(\n"
    "      this.proceduralEyelids,\n"
    "      expression.blinkLeft,\n"
    "      expression.blinkRight,\n"
    "    )\n"
    "  }\n\n",
)

replace_once(
    "    this.hasNativeJaw = false\n"
    "    this.hasNativeBlink = false\n"
    "    this.hasNativeGaze = false\n"
    "    this.leftEyelidOverlay.mesh.visible = false\n"
    "    this.rightEyelidOverlay.mesh.visible = false\n"
    "    this.lastBlinkLeft = -1\n"
    "    this.lastBlinkRight = -1\n",
    "    this.hasNativeJaw = false\n"
    "    this.hasNativeBlink = false\n"
    "    this.hasNativeGaze = false\n"
    "    this.proceduralEyelids.length = 0\n",
)

path.write_text(source)

for obsolete in (
    Path('src/masks/three/dragonEyelidFallback.ts'),
    Path('src/masks/three/dragonEyelidFallback.test.ts'),
):
    if obsolete.exists():
        obsolete.unlink()
