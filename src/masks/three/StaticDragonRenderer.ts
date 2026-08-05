import {
  ACESFilmicToneMapping,
  AdditiveBlending,
  AmbientLight,
  Box3,
  BufferGeometry,
  CanvasTexture,
  Color,
  DirectionalLight,
  DoubleSide,
  DynamicDrawUsage,
  Float32BufferAttribute,
  Group,
  LinearFilter,
  Material,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  OrthographicCamera,
  Points,
  PointsMaterial,
  RingGeometry,
  Scene,
  Shape,
  ShapeGeometry,
  Sprite,
  SpriteMaterial,
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
import {
  applyDragonMeshEyelidRig,
  createDragonMeshEyelidRig,
  type DragonMeshEyelidBinding,
} from './dragonMeshEyelidRig'

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
const PRIVACY_COLOR = 0x06111c
const PRIVACY_CURTAIN_COLOR = 0x06111c
const AURA_CYAN = 0x8cecff
const AURA_ICE = 0xe8fcff
const AURA_GOLD = 0xffe9a9
const AURA_VIOLET = 0xb7b6ff

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

interface AuraParticleField {
  geometry: BufferGeometry
  angles: Float32Array
  radii: Float32Array
  verticalScales: Float32Array
  speeds: Float32Array
  phases: Float32Array
  z: number
}

const MORPH_RESPONSE: Partial<Record<MorphSemantic, { gain: number; max: number }>> = {
  jawOpen: { gain: 1.22, max: 1 },
  blinkLeft: { gain: 2.25, max: 2 },
  blinkRight: { gain: 2.25, max: 2 },
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

function createDiamondShape(size = 0.065): Shape {
  const shape = new Shape()
  shape.moveTo(0, size)
  shape.lineTo(size * 0.62, 0)
  shape.lineTo(0, -size)
  shape.lineTo(-size * 0.62, 0)
  shape.closePath()
  return shape
}

function createCanvasTexture(
  size: number,
  draw: (context: CanvasRenderingContext2D, size: number) => void,
): CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d')
  if (!context) throw new Error('No fue posible crear la textura del aura.')
  draw(context, size)

  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  texture.minFilter = LinearFilter
  texture.magFilter = LinearFilter
  texture.generateMipmaps = false
  texture.needsUpdate = true
  return texture
}

function createCelestialBloomTexture(): CanvasTexture {
  return createCanvasTexture(512, (context, size) => {
    const center = size / 2
    context.clearRect(0, 0, size, size)

    const glow = context.createRadialGradient(center, center, 0, center, center, center)
    glow.addColorStop(0, 'rgba(255,255,255,0.98)')
    glow.addColorStop(0.11, 'rgba(230,252,255,0.88)')
    glow.addColorStop(0.28, 'rgba(139,236,255,0.52)')
    glow.addColorStop(0.5, 'rgba(114,192,255,0.24)')
    glow.addColorStop(0.72, 'rgba(199,190,255,0.12)')
    glow.addColorStop(1, 'rgba(92,174,255,0)')
    context.fillStyle = glow
    context.fillRect(0, 0, size, size)

    context.globalCompositeOperation = 'lighter'
    const core = context.createRadialGradient(center, center, 0, center, center, center * 0.42)
    core.addColorStop(0, 'rgba(255,251,224,0.72)')
    core.addColorStop(0.5, 'rgba(255,245,190,0.14)')
    core.addColorStop(1, 'rgba(255,245,190,0)')
    context.fillStyle = core
    context.fillRect(0, 0, size, size)
  })
}

function createCelestialRaysTexture(): CanvasTexture {
  return createCanvasTexture(512, (context, size) => {
    const center = size / 2
    context.clearRect(0, 0, size, size)
    context.translate(center, center)
    context.globalCompositeOperation = 'lighter'

    for (let index = 0; index < 36; index += 1) {
      const angle = index / 36 * Math.PI * 2
      const longRay = index % 3 === 0
      const length = longRay ? size * 0.46 : size * 0.37
      const halfWidth = longRay ? 2.4 : 1.2
      context.save()
      context.rotate(angle)
      const ray = context.createLinearGradient(size * 0.08, 0, length, 0)
      ray.addColorStop(0, 'rgba(223,251,255,0)')
      ray.addColorStop(0.35, longRay ? 'rgba(225,251,255,0.26)' : 'rgba(199,225,255,0.14)')
      ray.addColorStop(1, 'rgba(255,235,174,0)')
      context.fillStyle = ray
      context.beginPath()
      context.moveTo(size * 0.08, 0)
      context.lineTo(length, -halfWidth)
      context.lineTo(length, halfWidth)
      context.closePath()
      context.fill()
      context.restore()
    }

    context.strokeStyle = 'rgba(235,253,255,0.27)'
    context.lineWidth = 1.2
    for (const radius of [0.245, 0.325, 0.405]) {
      context.beginPath()
      context.arc(0, 0, size * radius, 0, Math.PI * 2)
      context.stroke()
    }
  })
}

function createParticleTexture(): CanvasTexture {
  return createCanvasTexture(96, (context, size) => {
    const center = size / 2
    const glow = context.createRadialGradient(center, center, 0, center, center, center)
    glow.addColorStop(0, 'rgba(255,255,255,1)')
    glow.addColorStop(0.16, 'rgba(239,254,255,0.98)')
    glow.addColorStop(0.42, 'rgba(139,238,255,0.62)')
    glow.addColorStop(0.72, 'rgba(143,182,255,0.22)')
    glow.addColorStop(1, 'rgba(120,170,255,0)')
    context.fillStyle = glow
    context.fillRect(0, 0, size, size)
  })
}

function createAuraParticleField(count: number, z: number, innerRadius: number): AuraParticleField {
  const angles = new Float32Array(count)
  const radii = new Float32Array(count)
  const verticalScales = new Float32Array(count)
  const speeds = new Float32Array(count)
  const phases = new Float32Array(count)
  const positions = new Float32Array(count * 3)

  for (let index = 0; index < count; index += 1) {
    const angle = index / count * Math.PI * 2 + (index % 5) * 0.041
    const radius = innerRadius + (index % 7) * 0.052
    const verticalScale = 1.02 + (index % 4) * 0.035
    angles[index] = angle
    radii[index] = radius
    verticalScales[index] = verticalScale
    speeds[index] = 0.025 + (index % 6) * 0.008
    phases[index] = index * 0.731
    positions[index * 3] = Math.cos(angle) * radius
    positions[index * 3 + 1] = Math.sin(angle) * radius * verticalScale
    positions[index * 3 + 2] = z
  }

  const geometry = new BufferGeometry()
  const attribute = new Float32BufferAttribute(positions, 3)
  attribute.setUsage(DynamicDrawUsage)
  geometry.setAttribute('position', attribute)
  return { geometry, angles, radii, verticalScales, speeds, phases, z }
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
  private readonly auraScene = new Scene()
  private readonly privacyScene = new Scene()
  private readonly modelScene = new Scene()
  private readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0.01, 20)
  private readonly modelContainer = new Group()
  private readonly privacyGroup = new Group()
  private readonly auraGroup = new Group()
  private readonly privacyMesh: Mesh
  private proceduralEyelids: DragonMeshEyelidBinding[] = []
  private readonly auraBloomTexture = createCelestialBloomTexture()
  private readonly auraRaysTexture = createCelestialRaysTexture()
  private readonly auraParticleTexture = createParticleTexture()
  private readonly auraBloom: Sprite
  private readonly auraRays: Sprite
  private readonly auraInnerRing: Mesh
  private readonly auraMiddleRing: Mesh
  private readonly auraOuterRing: Mesh
  private readonly auraCrownRing: Mesh
  private readonly auraSigilRing = new Group()
  private readonly auraParticlesField = createAuraParticleField(64, -2.24, 0.92)
  private readonly auraSparklesField = createAuraParticleField(26, -2.2, 0.72)
  private readonly auraParticles: Points
  private readonly auraSparkles: Points
  private readonly auraSigilGeometry = new ShapeGeometry(createDiamondShape(), 8)
  private readonly auraSigilMaterial = new MeshBasicMaterial({
    color: AURA_ICE,
    transparent: true,
    opacity: 0.48,
    blending: AdditiveBlending,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
    side: DoubleSide,
  })
  private readonly distanceModel = new MonocularHeadDistanceModel()
  private readonly morphBindings: MorphBinding[] = []
  private modelRoot: Object3D | null = null
  private modelWidth = 1
  private modelNeckDrop = 1
  private aspect = 1
  private hasNativeJaw = false
  private hasNativeBlink = false
  private hasNativeGaze = false

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
    this.renderer.autoClear = false
    this.renderer.outputColorSpace = SRGBColorSpace
    this.renderer.toneMapping = ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1
    this.renderer.setClearColor(new Color(0x000000), 0)
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5))

    this.modelContainer.rotation.order = 'YXZ'
    this.privacyGroup.rotation.order = 'XYZ'
    this.auraGroup.rotation.order = 'XYZ'

    this.privacyMesh = new Mesh(
      new ShapeGeometry(createPrivacyShape(), 24),
      new MeshBasicMaterial({
        color: PRIVACY_COLOR,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      }),
    )
    this.privacyMesh.name = 'WhiteDragon_PrivateHeadOccluder'
    this.privacyMesh.position.z = -1.42
    this.privacyMesh.frustumCulled = false

    this.auraBloom = new Sprite(new SpriteMaterial({
      map: this.auraBloomTexture,
      color: AURA_ICE,
      transparent: true,
      opacity: 0.92,
      blending: AdditiveBlending,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    }))
    this.auraBloom.scale.set(3.25, 3.38, 1)
    this.auraBloom.position.z = -2.3

    this.auraRays = new Sprite(new SpriteMaterial({
      map: this.auraRaysTexture,
      color: AURA_ICE,
      transparent: true,
      opacity: 0.68,
      blending: AdditiveBlending,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    }))
    this.auraRays.scale.set(3.48, 3.62, 1)
    this.auraRays.position.z = -2.28

    this.auraInnerRing = this.createAuraRing(0.79, 0.812, AURA_ICE, 0.62, -2.16, 104)
    this.auraMiddleRing = this.createAuraRing(0.99, 1.01, AURA_CYAN, 0.48, -2.18, 120)
    this.auraOuterRing = this.createAuraRing(1.18, 1.196, AURA_GOLD, 0.42, -2.2, 136)
    this.auraCrownRing = this.createAuraRing(1.34, 1.35, AURA_VIOLET, 0.26, -2.22, 152)

    for (let index = 0; index < 16; index += 1) {
      const angle = index / 16 * Math.PI * 2
      const sigil = new Mesh(this.auraSigilGeometry, this.auraSigilMaterial)
      const radius = index % 2 === 0 ? 1.12 : 1.27
      sigil.position.set(Math.cos(angle) * radius, Math.sin(angle) * radius * 1.08, -2.14)
      sigil.rotation.z = angle
      sigil.scale.setScalar(index % 2 === 0 ? 1 : 0.72)
      sigil.frustumCulled = false
      this.auraSigilRing.add(sigil)
    }

    this.auraParticles = new Points(
      this.auraParticlesField.geometry,
      new PointsMaterial({
        map: this.auraParticleTexture,
        color: AURA_ICE,
        size: 7.5,
        sizeAttenuation: false,
        transparent: true,
        opacity: 0.78,
        alphaTest: 0.015,
        blending: AdditiveBlending,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      }),
    )

    this.auraSparkles = new Points(
      this.auraSparklesField.geometry,
      new PointsMaterial({
        map: this.auraParticleTexture,
        color: AURA_GOLD,
        size: 12,
        sizeAttenuation: false,
        transparent: true,
        opacity: 0.68,
        alphaTest: 0.015,
        blending: AdditiveBlending,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      }),
    )

    this.auraGroup.add(this.auraBloom)
    this.auraGroup.add(this.auraRays)
    this.auraGroup.add(this.auraInnerRing)
    this.auraGroup.add(this.auraMiddleRing)
    this.auraGroup.add(this.auraOuterRing)
    this.auraGroup.add(this.auraCrownRing)
    this.auraGroup.add(this.auraSigilRing)
    this.auraGroup.add(this.auraParticles)
    this.auraGroup.add(this.auraSparkles)
    this.privacyGroup.add(this.privacyMesh)

    // Three separate passes make the compositing order absolute: celestial
    // aura first, privacy occluder second, and the GLB last. The aura therefore
    // cannot ever draw over the dragon, regardless of transparency sorting.
    this.auraScene.add(this.auraGroup)
    this.privacyScene.add(this.privacyGroup)
    this.modelScene.add(this.modelContainer)
    this.modelScene.add(new AmbientLight(0xdce8ef, 1.15))

    const key = new DirectionalLight(0xfff4e8, 2.2)
    key.position.set(-2.5, 3.5, 4.5)
    this.modelScene.add(key)

    const fill = new DirectionalLight(0xa6ddff, 0.72)
    fill.position.set(3.5, 1.5, 2)
    this.modelScene.add(fill)

    const rim = new DirectionalLight(0x72e8ff, 0.42)
    rim.position.set(2, 2, -4)
    this.modelScene.add(rim)

    this.camera.position.set(0, 0, 5)
    this.camera.lookAt(0, 0, 0)
    this.setSize(width, height)
  }

  get loaded(): boolean {
    return this.modelRoot !== null
  }

  get facialRigMode(): 'native' | 'native-partial' | 'static-model' {
    if (this.hasNativeJaw && this.hasNativeBlink) return 'native'
    if (this.hasNativeJaw || this.hasNativeBlink || this.hasNativeGaze) return 'native-partial'
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
      // The installed dragon advertises blink morphs, but they deform the
      // snout instead of closing the eyelids. Keep them disabled and move
      // only the dragon mesh vertices around each real eye.
      this.hasNativeBlink = false
      this.hasNativeGaze = this.hasMorph('eyeLookInLeft')
        || this.hasMorph('eyeLookOutLeft')
        || this.hasMorph('eyeLookInRight')
        || this.hasMorph('eyeLookOutRight')

      gltf.scene.traverse((object) => {
        if (object instanceof Mesh) object.frustumCulled = false
      })

      this.proceduralEyelids = createDragonMeshEyelidRig(
        gltf.scene,
        bounds,
        size,
        center,
        modelEyeY,
      )
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
    this.renderer.clear(true, true, true)

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
    const anchorX = eyeX * (1 - joinBlend)
      + neckX * joinBlend
      + pose.yaw * baseFaceWidthWorld * depthScale * 0.08

    this.privacyGroup.position.set(anchorX, eyeY, 0)
    this.privacyGroup.scale.set(
      baseFaceWidthWorld * depthScale * 0.9,
      baseFaceHeightWorld * depthScale * 0.63,
      1,
    )
    this.privacyGroup.rotation.set(0, 0, -pose.roll)
    this.privacyGroup.visible = true

    this.auraGroup.position.set(anchorX, eyeY + baseFaceHeightWorld * depthScale * 0.015, 0)
    this.auraGroup.scale.set(
      baseFaceWidthWorld * depthScale * 0.98,
      baseFaceHeightWorld * depthScale * 0.72,
      1,
    )
    this.auraGroup.rotation.set(0, 0, -pose.roll * 0.18)
    this.auraGroup.visible = true
    this.updateAura(performance.now(), pose)

    this.renderer.render(this.auraScene, this.camera)
    this.renderer.render(this.privacyScene, this.camera)
    this.renderer.render(this.modelScene, this.camera)
    return true
  }

  dispose(): void {
    this.disposeModel()
    this.privacyMesh.geometry.dispose()
    this.disposeMaterial(this.privacyMesh.material as Material)
    this.disposeMaterial(this.auraBloom.material as Material)
    this.disposeMaterial(this.auraRays.material as Material)
    this.auraInnerRing.geometry.dispose()
    this.disposeMaterial(this.auraInnerRing.material as Material)
    this.auraMiddleRing.geometry.dispose()
    this.disposeMaterial(this.auraMiddleRing.material as Material)
    this.auraOuterRing.geometry.dispose()
    this.disposeMaterial(this.auraOuterRing.material as Material)
    this.auraCrownRing.geometry.dispose()
    this.disposeMaterial(this.auraCrownRing.material as Material)
    this.auraSigilGeometry.dispose()
    this.auraSigilMaterial.dispose()
    this.auraParticlesField.geometry.dispose()
    this.disposeMaterial(this.auraParticles.material as Material)
    this.auraSparklesField.geometry.dispose()
    this.disposeMaterial(this.auraSparkles.material as Material)
    this.renderer.dispose()
    this.renderer.forceContextLoss()
  }

  private createAuraRing(
    innerRadius: number,
    outerRadius: number,
    color: number,
    opacity: number,
    z: number,
    segments: number,
  ): Mesh {
    const ring = new Mesh(
      new RingGeometry(innerRadius, outerRadius, segments),
      new MeshBasicMaterial({
        color,
        transparent: true,
        opacity,
        blending: AdditiveBlending,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
        side: DoubleSide,
      }),
    )
    ring.position.z = z
    ring.frustumCulled = false
    return ring
  }

  private updateAura(timeMs: number, expression: DragonExpressionState): void {
    const time = timeMs * 0.001
    const breath = (Math.sin(time * 0.92) + 1) * 0.5
    const pulse = 1.055 + breath * 0.045
    const speechEnergy = expression.jawOpen * 0.025

    this.auraGroup.scale.multiplyScalar(pulse + speechEnergy)
    this.auraRays.material.rotation = time * 0.018
    this.auraInnerRing.rotation.z = time * 0.17
    this.auraMiddleRing.rotation.z = -time * 0.105
    this.auraOuterRing.rotation.z = time * 0.058
    this.auraCrownRing.rotation.z = -time * 0.033
    this.auraSigilRing.rotation.z = -time * 0.046

    this.updateParticleField(this.auraParticlesField, time, 0.085, expression.jawOpen)
    this.updateParticleField(this.auraSparklesField, time, 0.14, expression.jawOpen)

    const bloomMaterial = this.auraBloom.material as SpriteMaterial
    const raysMaterial = this.auraRays.material as SpriteMaterial
    const particleMaterial = this.auraParticles.material as PointsMaterial
    const sparkleMaterial = this.auraSparkles.material as PointsMaterial
    bloomMaterial.opacity = 0.72 + breath * 0.18 + expression.jawOpen * 0.06
    raysMaterial.opacity = 0.46 + breath * 0.18
    particleMaterial.opacity = 0.6 + breath * 0.2
    sparkleMaterial.opacity = 0.48 + (1 - breath) * 0.22 + expression.jawOpen * 0.08
  }

  private updateParticleField(
    field: AuraParticleField,
    time: number,
    drift: number,
    speechEnergy: number,
  ): void {
    const attribute = field.geometry.getAttribute('position') as Float32BufferAttribute
    const count = field.angles.length
    for (let index = 0; index < count; index += 1) {
      const phase = field.phases[index]
      const angle = field.angles[index] + time * field.speeds[index]
      const float = Math.sin(time * (0.7 + field.speeds[index] * 5) + phase)
      const radial = field.radii[index] + float * drift + speechEnergy * 0.018
      attribute.setXYZ(
        index,
        Math.cos(angle) * radial,
        Math.sin(angle) * radial * field.verticalScales[index] + float * 0.045,
        field.z,
      )
    }
    attribute.needsUpdate = true
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

    applyDragonMeshEyelidRig(
      this.proceduralEyelids,
      expression.blinkLeft,
      expression.blinkRight,
    )
  }

  private setMorph(binding: MorphBinding, semantic: MorphSemantic, value: number): void {
    const index = binding.indices[semantic]
    if (index === undefined) return

    const response = MORPH_RESPONSE[semantic] ?? { gain: 1, max: 1 }
    binding.influences[index] = clamp(value * response.gain, 0, response.max)
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
    this.hasNativeBlink = false
    this.hasNativeGaze = false
    this.proceduralEyelids.length = 0
  }

  private disposeMaterial(material: Material): void {
    for (const value of Object.values(material)) {
      if (value instanceof Texture) value.dispose()
    }
    material.dispose()
  }
}
