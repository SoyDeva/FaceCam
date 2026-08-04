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
  offsetY: 0,
  yawMultiplier: 0.82,
  pitchMultiplier: 0.72,
  facingReversed: false,
}

const MODEL_EYE_LINE_RATIO = 0.55
const PRIVACY_COLOR = 0xdce4e6
const PRIVACY_CURTAIN_COLOR = 0x101820

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function createPrivacyShape(): Shape {
  const shape = new Shape()
  // Local origin is the user's eye line. The upper lobe covers hair and ears;
  // the tapered lower section hides the real neck and bridges the GLB to body.
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
  private modelRoot: Object3D | null = null
  private modelWidth = 1
  private modelNeckDrop = 1
  private aspect = 1

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
      gltf.scene.traverse((object) => {
        if (object instanceof Mesh) object.frustumCulled = false
      })

      this.modelWidth = size.x
      this.modelNeckDrop = Math.max(0.001, modelEyeY - bounds.min.y)
      this.modelRoot = gltf.scene
      this.modelContainer.add(gltf.scene)
      this.distanceModel.reset()
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

    // The eyes remain the exact anchor. A small bounded vertical stretch uses
    // the inferred neck point to make the GLB meet the user's body without
    // moving the dragon eyes away from the real eye line.
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

    // Screen-space privacy silhouette: it follows translation, distance and
    // roll, but never performs 3D yaw that could uncover the real hair/face.
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

  private renderPrivacyCurtain(): boolean {
    this.renderer.setClearColor(new Color(PRIVACY_CURTAIN_COLOR), 1)
    this.renderer.clear(true, true, true)
    this.renderer.setClearColor(new Color(0x000000), 0)
    return true
  }

  private disposeModel(): void {
    if (!this.modelRoot) return

    this.modelContainer.remove(this.modelRoot)
    this.modelRoot.traverse((object) => {
      if (!(object instanceof Mesh)) return
      object.geometry.dispose()
      const materials = Array.isArray(object.material) ? object.material : [object.material]
      materials.forEach((material) => this.disposeMaterial(material))
    })
    this.modelRoot = null
  }

  private disposeMaterial(material: Material): void {
    for (const value of Object.values(material)) {
      if (value instanceof Texture) value.dispose()
    }
    material.dispose()
  }
}
