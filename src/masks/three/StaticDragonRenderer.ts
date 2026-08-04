import {
  ACESFilmicToneMapping,
  AmbientLight,
  Box3,
  Color,
  DirectionalLight,
  Group,
  Material,
  Mesh,
  Object3D,
  OrthographicCamera,
  Scene,
  SRGBColorSpace,
  Texture,
  Vector3,
  WebGLRenderer,
} from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
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

export class StaticDragonRenderer {
  readonly canvas: HTMLCanvasElement

  private readonly renderer: WebGLRenderer
  private readonly scene = new Scene()
  private readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0.01, 20)
  private readonly modelContainer = new Group()
  private modelRoot: Object3D | null = null
  private modelWidth = 1
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

      // Tripo does not expose semantic eye nodes in this asset. The measured
      // eye line sits near 55% of the complete neck-to-horn bounds. Making that
      // line the local origin lets the model eyes follow the user's eye anchor.
      const modelEyeY = bounds.min.y + size.y * MODEL_EYE_LINE_RATIO
      gltf.scene.position.set(-center.x, -modelEyeY, -center.z)
      gltf.scene.updateMatrixWorld(true)
      gltf.scene.traverse((object) => {
        if (object instanceof Mesh) object.frustumCulled = false
      })

      this.modelWidth = size.x
      this.modelRoot = gltf.scene
      this.modelContainer.add(gltf.scene)
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
    this.renderer.clear()
    if (!pose.visible || !this.modelRoot || !headCalibration) return false

    // Scale is derived exclusively from the frontal calibration captured at
    // camera start. Current visible face width never changes the model scale.
    const baseFaceWidthWorld = headCalibration.baseFaceWidth * this.aspect * 2
    const modelScale = baseFaceWidthWorld / this.modelWidth * calibration.scaleMultiplier
    const eyeX = (pose.eyeCenterX * 2 - 1) * this.aspect
    const eyeY = 1 - pose.eyeCenterY * 2

    this.modelContainer.position.set(
      eyeX + calibration.offsetX * baseFaceWidthWorld,
      eyeY + calibration.offsetY * baseFaceWidthWorld,
      0,
    )
    this.modelContainer.scale.setScalar(modelScale)

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

    this.renderer.render(this.scene, this.camera)
    return true
  }

  dispose(): void {
    this.disposeModel()
    this.renderer.dispose()
    this.renderer.forceContextLoss()
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
