import {
  ACESFilmicToneMapping,
  AmbientLight,
  Box3,
  Color,
  DirectionalLight,
  Group,
  Material,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  OrthographicCamera,
  Scene,
  Shape,
  ShapeGeometry,
  SRGBColorSpace,
  Texture,
  Vector3,
  WebGLRenderer,
} from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import type { DragonExpressionState } from './dragonExpressions'
import { MonocularHeadDistanceModel } from './headDistance'
import type { StaticDragonHeadCalibration } from './headCalibration'
import type { StaticDragonPoseEstimate } from './staticPose'
import { resolveStaticDragonYaw } from './staticPose'

export interface StaticDragonCalibration {
  scaleMultiplier: number
  offsetX: number
  offsetY: number
  yawMultiplier: number
  pitchMultiplier: number
  facingReversed: boolean
}

export const DEFAULT_STATIC_DRAGON_CALIBRATION: StaticDragonCalibration = {
  scaleMultiplier: 1.74,
  offsetX: 0,
  offsetY: 0.08,
  yawMultiplier: 0.82,
  pitchMultiplier: 0.72,
  facingReversed: false,
}

const MODEL_EYE_LINE_RATIO = 0.55
const PRIVACY_COLOR = 0xdce4e6
const PRIVACY_CURTAIN_COLOR = 0x101820

const MORPH_ALIASES = {
  jawOpen: ['jawOpen', 'mouthOpen', 'openJaw'],
  blinkLeft: ['eyeBlinkLeft', 'blinkLeft'],
  blinkRight: ['eyeBlinkRight', 'blinkRight'],
  smileLeft: ['mouthSmileLeft', 'smileLeft'],
  smileRight: ['mouthSmileRight', 'smileRight'],
  eyeLookInLeft: ['eyeLookInLeft'],
  eyeLookOutLeft: ['eyeLookOutLeft'],
  eyeLookInRight: ['eyeLookInRight'],
  eyeLookOutRight: ['eyeLookOutRight'],
  eyeLookUpLeft: ['eyeLookUpLeft'],
  eyeLookUpRight: ['eyeLookUpRight'],
  eyeLookDownLeft: ['eyeLookDownLeft'],
  eyeLookDownRight: ['eyeLookDownRight'],
  browInnerUp: ['browInnerUp'],
  browOuterUpLeft: ['browOuterUpLeft'],
  browOuterUpRight: ['browOuterUpRight'],
} as const

type MorphSemantic = keyof typeof MORPH_ALIASES

interface MorphBinding {
  influences: number[]
  indices: Partial<Record<MorphSemantic, number>>
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function normalizedMorphName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function createPrivacyShape(): Shape {
  const shape = new Shape()
  shape.moveTo(0, 1.18)
  shape.bezierCurveTo(0.72, 1.16, 1.02, 0.7, 1.02, 0.14)
  shape.bezierCurveTo(1.02, -0.45, 0.74, -0.82, 0.48, -0.96)
  shape.lineTo(0.62, -1.52)
  shape.lineTo(-0.62, -1.52)
  shape.lineTo(-0.48, -0.96)
  shape.bezierCurveTo(-0.74, -0.82, -1.02, -0.45, -1.02, 0.14)
  shape.bezierCurveTo(-1.02, 0.7, -0.72, 1.16, 0, 1.18)
  shape.closePath()
  return shape
}

function provisionalCalibration(pose: StaticDragonPoseEstimate): StaticDragonHeadCalibration {
  return {
    version: 1,
    baseFaceWidth: pose.faceWidth,
    baseEyeDistance: pose.eyeDistance,
    baseFaceHeight: pose.faceHeight,
    capturedAt: 0,
  }
}

export class StaticDragonRenderer {
  readonly canvas: HTMLCanvasElement

  private readonly renderer: WebGLRenderer
  private readonly scene = new Scene()
  private readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0.01, 20)
  private readonly modelContainer = new Group()
  private readonly privacyGroup = new Group()
  private readonly privacyMesh: Mesh
  private readonly distanceModel = new MonocularHeadDistanceModel()
  private readonly morphBindings: MorphBinding[] = []
  private modelRoot: Object3D | null = null
  private modelWidth = 1
  private modelNeckDrop = 1
  private aspect = 1
  private hasNativeJaw = false
  private hasNativeEyes = false

  constructor(width: number, height: number) {
    this.canvas = document.createElement('canvas')
    this.renderer = new WebGLRenderer({
      canvas: this.canvas,
      alpha: true,
      antialias: true,
      premultipliedAlpha: true,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: true,
    })
    this.renderer.outputColorSpace = SRGBColorSpace
    this.renderer.toneMapping = ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1
    this.renderer.setClearColor(new Color(0x000000), 0)
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5))

    this.modelContainer.rotation.order = 'YXZ'
    this.privacyGroup.rotation.order = 'XYZ'

    this.privacyMesh = new Mesh(
      new ShapeGeometry(createPrivacyShape(), 24),
      new MeshBasicMaterial({
        color: PRIVACY_COLOR,
        depthTest: true,
        depthWrite: true,
        toneMapped: false,
      }),
    )
    this.privacyMesh.name = 'WhiteDragon_PrivateHeadOccluder'
    this.privacyMesh.position.z = -1.5
    this.privacyMesh.frustumCulled = false
    this.privacyGroup.add(this.privacyMesh)

    this.scene.add(this.privacyGroup)
    this.scene.add(this.modelContainer)
    this.scene.add(new AmbientLight(0xdce8ef, 1.15))

    const key = new DirectionalLight(0xfff4e8, 2.2)
    key.position.set(-2.5, 3.5, 4.5)
    this.scene.add(key)

    const fill = new DirectionalLight(0xa6ddff, 0.72)
    fill.position.set(3.5, 1.5, 2)
    this.scene.add(fill)

    const rim = new DirectionalLight(0x72e8ff, 0.42)
    rim.position.set(2, 2, -4)
    this.scene.add(rim)

    this.camera.position.set(0, 0, 5)
    this.camera.lookAt(0, 0, 0)
    this.setSize(width, height)
  }

  get loaded(): boolean {
    return this.modelRoot !== null
  }

  get facialRigMode(): 'native' | 'native-partial' | 'static-model' {
    if (this.hasNativeJaw && this.hasNativeEyes) return 'native'
    if (this.hasNativeJaw || this.hasNativeEyes) return 'native-partial'
    return 'static-model'
  }

  async load(file: Blob): Promise<void> {
    const objectUrl = URL.createObjectURL(file)
    try {
      const gltf = await new GLTFLoader().loadAsync(objectUrl)
      const bounds = new Box3().setFromObject(gltf.scene)
      if (bounds.isEmpty()) throw new Error('El GLB no contiene geometría visible.')

      const size = bounds.getSize(new Vector3())
      const center = bounds.getCenter(new Vector3())
      if (!Number.isFinite(size.x) || size.x <= 0) {
        throw new Error('El GLB tiene dimensiones inválidas.')
      }

      this.disposeModel()

      const modelEyeY = bounds.min.y + size.y * MODEL_EYE_LINE_RATIO
      gltf.scene.position.set(-center.x, -modelEyeY, -center.z)
      gltf.scene.updateMatrixWorld(true)

      this.collectMorphBindings(gltf.scene)
      this.hasNativeJaw = this.hasMorph('jawOpen')
      this.hasNativeEyes = this.hasMorph('blinkLeft')
        && this.hasMorph('blinkRight')
        && (
          this.hasMorph('eyeLookInLeft')
          || this.hasMorph('eyeLookOutLeft')
          || this.hasMorph('eyeLookInRight')
          || this.hasMorph('eyeLookOutRight')
        )

      gltf.scene.traverse((object) => {
        if (object instanceof Mesh) object.frustumCulled = false
      })

      this.modelWidth = size.x
      this.modelNeckDrop = Math.max(0.001, modelEyeY - bounds.min.y)
      this.modelRoot = gltf.scene
      this.modelContainer.add(gltf.scene)
      this.distanceModel.reset()
      this.applyExpression({
        jawOpen: 0,
        blinkLeft: 0,
        blinkRight: 0,
        gazeX: 0,
        gazeY: 0,
        smile: 0,
        browRaise: 0,
      })
    } finally {
      URL.revokeObjectURL(objectUrl)
    }
  }

  setSize(width: number, height: number): void {
    const safeWidth = Math.max(2, width)
    const safeHeight = Math.max(2, height)
    this.aspect = safeWidth / safeHeight
    this.camera.left = -this.aspect
    this.camera.right = this.aspect
    this.camera.top = 1
    this.camera.bottom = -1
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(safeWidth, safeHeight, false)
  }

  render(
    pose: StaticDragonPoseEstimate,
    calibration: StaticDragonCalibration,
    mirrored: boolean,
    headCalibration: StaticDragonHeadCalibration | null,
  ): boolean {
    if (!this.modelRoot) return false

    if (!pose.visible) {
      return this.renderPrivacyCurtain()
    }

    this.applyExpression(pose)
    this.renderer.setClearColor(new Color(0x000000), 0)
    this.renderer.clear()

    const shapeCalibration = headCalibration ?? provisionalCalibration(pose)
    const distance = headCalibration
      ? this.distanceModel.update(pose, headCalibration)
      : { scale: 1, relativeDistance: 1, confidence: 0 }

    const depthScale = distance.scale
    const baseFaceWidthWorld = shapeCalibration.baseFaceWidth * this.aspect * 2
    const baseFaceHeightWorld = shapeCalibration.baseFaceHeight * 2
    const modelScale = baseFaceWidthWorld / this.modelWidth
      * calibration.scaleMultiplier
      * depthScale
    const eyeX = (pose.eyeCenterX * 2 - 1) * this.aspect
    const eyeY = 1 - pose.eyeCenterY * 2
    const neckX = (pose.neckAnchorX * 2 - 1) * this.aspect
    const neckY = 1 - pose.neckAnchorY * 2

    const desiredEyeToNeck = Math.max(0.001, eyeY - neckY)
    const naturalEyeToNeck = Math.max(0.001, this.modelNeckDrop * modelScale)
    const neckFit = clamp(desiredEyeToNeck / naturalEyeToNeck, 0.9, 1.13)
    const verticalScale = modelScale * neckFit

    this.modelContainer.position.set(
      eyeX + calibration.offsetX * baseFaceWidthWorld * depthScale,
      eyeY + calibration.offsetY * baseFaceWidthWorld * depthScale,
      0,
    )
    this.modelContainer.scale.set(modelScale, verticalScale, modelScale)
    this.modelContainer.rotation.set(
      pose.pitch * calibration.pitchMultiplier,
      resolveStaticDragonYaw(
        pose.yaw,
        calibration.yawMultiplier,
        calibration.facingReversed,
        mirrored,
      ),
      -pose.roll,
    )

    const joinBlend = 0.12
    this.privacyGroup.position.set(
      eyeX * (1 - joinBlend) + neckX * joinBlend + pose.yaw * baseFaceWidthWorld * depthScale * 0.08,
      eyeY,
      0,
    )
    this.privacyGroup.scale.set(
      baseFaceWidthWorld * depthScale * 0.84,
      baseFaceHeightWorld * depthScale * 0.58,
      1,
    )
    this.privacyGroup.rotation.set(0, 0, -pose.roll)
    this.privacyGroup.visible = true

    this.renderer.render(this.scene, this.camera)
    return true
  }

  dispose(): void {
    this.disposeModel()
    this.privacyMesh.geometry.dispose()
    this.disposeMaterial(this.privacyMesh.material as Material)
    this.renderer.dispose()
    this.renderer.forceContextLoss()
  }

  private collectMorphBindings(root: Object3D): void {
    this.morphBindings.length = 0
    root.traverse((object) => {
      if (!(object instanceof Mesh)) return
      const dictionary = object.morphTargetDictionary
      const influences = object.morphTargetInfluences
      if (!dictionary || !influences) return

      const normalized = new Map(
        Object.entries(dictionary).map(([name, index]) => [normalizedMorphName(name), index]),
      )
      const indices: Partial<Record<MorphSemantic, number>> = {}
      for (const [semantic, aliases] of Object.entries(MORPH_ALIASES) as [MorphSemantic, readonly string[]][]) {
        for (const alias of aliases) {
          const index = normalized.get(normalizedMorphName(alias))
          if (index !== undefined) {
            indices[semantic] = index
            break
          }
        }
      }
      this.morphBindings.push({ influences, indices })
    })
  }

  private hasMorph(semantic: MorphSemantic): boolean {
    return this.morphBindings.some((binding) => binding.indices[semantic] !== undefined)
  }

  private applyExpression(expression: DragonExpressionState): void {
    const horizontalRight = Math.max(0, expression.gazeX)
    const horizontalLeft = Math.max(0, -expression.gazeX)
    const lookDown = Math.max(0, expression.gazeY)
    const lookUp = Math.max(0, -expression.gazeY)

    for (const binding of this.morphBindings) {
      this.setMorph(binding, 'jawOpen', expression.jawOpen)
      this.setMorph(binding, 'blinkLeft', expression.blinkLeft)
      this.setMorph(binding, 'blinkRight', expression.blinkRight)
      this.setMorph(binding, 'smileLeft', expression.smile)
      this.setMorph(binding, 'smileRight', expression.smile)
      this.setMorph(binding, 'eyeLookInLeft', horizontalRight)
      this.setMorph(binding, 'eyeLookOutRight', horizontalRight)
      this.setMorph(binding, 'eyeLookOutLeft', horizontalLeft)
      this.setMorph(binding, 'eyeLookInRight', horizontalLeft)
      this.setMorph(binding, 'eyeLookDownLeft', lookDown)
      this.setMorph(binding, 'eyeLookDownRight', lookDown)
      this.setMorph(binding, 'eyeLookUpLeft', lookUp)
      this.setMorph(binding, 'eyeLookUpRight', lookUp)
      this.setMorph(binding, 'browInnerUp', expression.browRaise)
      this.setMorph(binding, 'browOuterUpLeft', expression.browRaise)
      this.setMorph(binding, 'browOuterUpRight', expression.browRaise)
    }
  }

  private setMorph(binding: MorphBinding, semantic: MorphSemantic, value: number): void {
    const index = binding.indices[semantic]
    if (index !== undefined) binding.influences[index] = clamp(value, 0, 1)
  }

  private renderPrivacyCurtain(): boolean {
    this.renderer.setClearColor(new Color(PRIVACY_CURTAIN_COLOR), 1)
    this.renderer.clear(true, true, true)
    this.renderer.setClearColor(new Color(0x000000), 0)
    return true
  }

  private disposeModel(): void {
    if (this.modelRoot) {
      this.modelContainer.remove(this.modelRoot)
      this.modelRoot.traverse((object) => {
        if (!(object instanceof Mesh)) return
        object.geometry.dispose()
        const materials = Array.isArray(object.material) ? object.material : [object.material]
        materials.forEach((material) => this.disposeMaterial(material))
      })
    }
    this.modelRoot = null
    this.morphBindings.length = 0
    this.hasNativeJaw = false
    this.hasNativeEyes = false
  }

  private disposeMaterial(material: Material): void {
    for (const value of Object.values(material)) {
      if (value instanceof Texture) value.dispose()
    }
    material.dispose()
  }
}
