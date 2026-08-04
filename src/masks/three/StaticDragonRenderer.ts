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
import type { StaticDragonPoseEstimate } from './staticPose'

export interface StaticDragonCalibration {
  scaleMultiplier: number
  offsetX: number
  offsetY: number
  yawMultiplier: number
  pitchMultiplier: number
  facingReversed: boolean
}

export const DEFAULT_STATIC_DRAGON_CALIBRATION: StaticDragonCalibration = {
  scaleMultiplier: 1.62,
  offsetX: 0,
  offsetY: 0.05,
  yawMultiplier: 0.82,
  pitchMultiplier: 0.72,
  facingReversed: false,
}

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

      // The Tripo asset pivots at the neck base. Recenter it around the upper
      // head so rotations follow the user instead of swinging from the chest.
      const pivotY = bounds.min.y + size.y * 0.58
      gltf.scene.position.set(-center.x, -pivotY, -center.z)
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
  ): boolean {
    this.renderer.clear()
    if (!pose.visible || !this.modelRoot) return false

    const faceWidthWorld = pose.faceWidth * this.aspect * 2
    const modelScale = faceWidthWorld / this.modelWidth * calibration.scaleMultiplier
    const centerX = (pose.centerX * 2 - 1) * this.aspect
    const centerY = 1 - pose.centerY * 2

    this.modelContainer.position.set(
      centerX + calibration.offsetX * faceWidthWorld,
      centerY + calibration.offsetY * faceWidthWorld,
      0,
    )
    this.modelContainer.scale.setScalar(modelScale)

    const baseYaw = calibration.facingReversed ? Math.PI : 0
    const yawDirection = calibration.facingReversed ? -1 : 1
    this.modelContainer.rotation.set(
      pose.pitch * calibration.pitchMultiplier,
      baseYaw + pose.yaw * calibration.yawMultiplier * yawDirection,
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
