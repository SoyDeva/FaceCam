import {
  ACESFilmicToneMapping,
  AmbientLight,
  Box3,
  CanvasTexture,
  Color,
  DirectionalLight,
  DoubleSide,
  Group,
  Material,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  OrthographicCamera,
  PlaneGeometry,
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
const EYE_TEXTURE_WIDTH = 256
const EYE_TEXTURE_HEIGHT = 128
const MOUTH_TEXTURE_WIDTH = 256
const MOUTH_TEXTURE_HEIGHT = 128

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

type NumericUniform = { value: number }

interface MorphBinding {
  influences: number[]
  indices: Partial<Record<MorphSemantic, number>>
}

interface TextureOverlay {
  canvas: HTMLCanvasElement
  texture: CanvasTexture
  material: MeshBasicMaterial
  mesh: Mesh<PlaneGeometry, MeshBasicMaterial>
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function normalizedMorphName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '')
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

function createTextureOverlay(name: string, width: number, height: number): TextureOverlay {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  const material = new MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthTest: true,
    depthWrite: false,
    alphaTest: 0.015,
    side: DoubleSide,
    toneMapped: false,
  })
  const mesh = new Mesh(new PlaneGeometry(1, 1), material)
  mesh.name = name
  mesh.frustumCulled = false
  mesh.renderOrder = 20
  return { canvas, texture, material, mesh }
}

function drawEyeTexture(
  overlay: TextureOverlay,
  expression: DragonExpressionState,
  side: 'left' | 'right',
): void {
  const context = overlay.canvas.getContext('2d')
  if (!context) return

  const width = overlay.canvas.width
  const height = overlay.canvas.height
  const centerX = width / 2
  const centerY = height / 2
  const blink = side === 'left' ? expression.blinkLeft : expression.blinkRight
  const openness = Math.max(0.035, 1 - blink * 0.97)
  const eyeHalfWidth = width * 0.42
  const eyeHalfHeight = height * 0.31 * openness

  context.clearRect(0, 0, width, height)
  context.save()
  context.translate(centerX, centerY)
  context.shadowColor = 'rgba(74, 235, 255, 0.72)'
  context.shadowBlur = width * 0.045
  context.fillStyle = 'rgba(2, 12, 18, 0.98)'
  context.strokeStyle = 'rgba(170, 247, 255, 0.58)'
  context.lineWidth = Math.max(1.5, width * 0.009)
  context.beginPath()
  context.moveTo(-eyeHalfWidth, 0)
  context.quadraticCurveTo(0, -eyeHalfHeight * 1.18, eyeHalfWidth, 0)
  context.quadraticCurveTo(0, eyeHalfHeight * 1.18, -eyeHalfWidth, 0)
  context.closePath()
  context.fill()
  context.stroke()
  context.clip()

  if (openness > 0.08) {
    const gazeX = expression.gazeX * eyeHalfWidth * 0.2
    const gazeY = expression.gazeY * Math.max(2, eyeHalfHeight * 0.22)
    const irisRadius = Math.max(3, Math.min(eyeHalfWidth * 0.31, eyeHalfHeight * 0.92))
    const iris = context.createRadialGradient(
      gazeX - irisRadius * 0.24,
      gazeY - irisRadius * 0.3,
      irisRadius * 0.06,
      gazeX,
      gazeY,
      irisRadius,
    )
    iris.addColorStop(0, '#f4ffff')
    iris.addColorStop(0.18, '#94fbff')
    iris.addColorStop(0.52, '#22b8cd')
    iris.addColorStop(1, '#042d3b')
    context.shadowBlur = width * 0.07
    context.shadowColor = '#4deeff'
    context.fillStyle = iris
    context.beginPath()
    context.ellipse(gazeX, gazeY, irisRadius, irisRadius * 0.88, 0, 0, Math.PI * 2)
    context.fill()

    context.shadowBlur = 0
    context.fillStyle = '#010307'
    context.beginPath()
    context.ellipse(
      gazeX,
      gazeY,
      Math.max(1.5, irisRadius * 0.11),
      Math.max(3, irisRadius * 0.72),
      0,
      0,
      Math.PI * 2,
    )
    context.fill()

    context.fillStyle = 'rgba(255, 255, 255, 0.82)'
    context.beginPath()
    context.ellipse(
      gazeX - irisRadius * 0.3,
      gazeY - irisRadius * 0.34,
      irisRadius * 0.1,
      irisRadius * 0.07,
      -0.35,
      0,
      Math.PI * 2,
    )
    context.fill()
  }

  context.restore()
  overlay.texture.needsUpdate = true
}

function drawMouthTexture(overlay: TextureOverlay, expression: DragonExpressionState): void {
  const context = overlay.canvas.getContext('2d')
  if (!context) return

  const width = overlay.canvas.width
  const height = overlay.canvas.height
  const open = clamp(expression.jawOpen, 0, 1)
  const smile = clamp(expression.smile, 0, 1)
  const halfWidth = width * (0.38 + smile * 0.045)
  const halfHeight = height * (0.13 + open * 0.31)

  context.clearRect(0, 0, width, height)
  context.save()
  context.translate(width / 2, height / 2)
  const cavity = context.createRadialGradient(0, -halfHeight * 0.18, 2, 0, 0, halfWidth)
  cavity.addColorStop(0, '#40191e')
  cavity.addColorStop(0.42, '#190b10')
  cavity.addColorStop(1, '#020305')
  context.fillStyle = cavity
  context.strokeStyle = 'rgba(222, 230, 225, 0.38)'
  context.lineWidth = Math.max(1.5, width * 0.008)
  context.shadowColor = 'rgba(0, 0, 0, 0.72)'
  context.shadowBlur = width * 0.025
  context.beginPath()
  context.ellipse(0, 0, halfWidth, halfHeight, 0, 0, Math.PI * 2)
  context.fill()
  context.stroke()

  if (open > 0.22) {
    context.shadowBlur = 0
    context.fillStyle = 'rgba(235, 227, 210, 0.92)'
    const toothCount = 7
    for (let index = 0; index < toothCount; index += 1) {
      const amount = index / (toothCount - 1)
      const x = -halfWidth * 0.72 + amount * halfWidth * 1.44
      const toothWidth = width * 0.022
      const toothHeight = halfHeight * (0.28 + open * 0.18)
      context.beginPath()
      context.moveTo(x - toothWidth, -halfHeight * 0.82)
      context.lineTo(x + toothWidth, -halfHeight * 0.82)
      context.lineTo(x, -halfHeight * 0.82 + toothHeight)
      context.closePath()
      context.fill()
    }
  }

  context.restore()
  overlay.texture.needsUpdate = true
}

export class StaticDragonRenderer {
  readonly canvas: HTMLCanvasElement

  private readonly renderer: WebGLRenderer
  private readonly scene = new Scene()
  private readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0.01, 20)
  private readonly modelContainer = new Group()
  private readonly privacyGroup = new Group()
  private readonly privacyMesh: Mesh
  private readonly facialGroup = new Group()
  private readonly leftEyeOverlay = createTextureOverlay(
    'WhiteDragon_ProceduralEye_Left',
    EYE_TEXTURE_WIDTH,
    EYE_TEXTURE_HEIGHT,
  )
  private readonly rightEyeOverlay = createTextureOverlay(
    'WhiteDragon_ProceduralEye_Right',
    EYE_TEXTURE_WIDTH,
    EYE_TEXTURE_HEIGHT,
  )
  private readonly mouthOverlay = createTextureOverlay(
    'WhiteDragon_ProceduralMouth',
    MOUTH_TEXTURE_WIDTH,
    MOUTH_TEXTURE_HEIGHT,
  )
  private readonly distanceModel = new MonocularHeadDistanceModel()
  private readonly morphBindings: MorphBinding[] = []
  private readonly jawUniforms: NumericUniform[] = []
  private modelRoot: Object3D | null = null
  private modelWidth = 1
  private modelHeight = 1
  private modelNeckDrop = 1
  private aspect = 1
  private hasNativeJaw = false
  private hasNativeEyes = false
  private baseEyeY = 0
  private baseMouthY = 0
  private baseMouthWidth = 1
  private baseMouthHeight = 1
  private lastExpression: DragonExpressionState = {
    jawOpen: -1,
    blinkLeft: -1,
    blinkRight: -1,
    gazeX: 9,
    gazeY: 9,
    smile: -1,
    browRaise: -1,
  }

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

    this.mouthOverlay.mesh.renderOrder = 19
    this.facialGroup.add(
      this.leftEyeOverlay.mesh,
      this.rightEyeOverlay.mesh,
      this.mouthOverlay.mesh,
    )
    this.modelContainer.add(this.facialGroup)

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

  get facialRigMode(): 'native' | 'procedural-hybrid' {
    return this.hasNativeJaw && this.hasNativeEyes ? 'native' : 'procedural-hybrid'
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
        if (!(object instanceof Mesh)) return
        object.frustumCulled = false
        if (!this.hasNativeJaw) this.patchProceduralJaw(object, bounds, size, center)
      })

      this.configureFacialOverlays(bounds, size, center, modelEyeY)
      this.modelWidth = size.x
      this.modelHeight = size.y
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
      }, true)
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
    this.disposeOverlay(this.leftEyeOverlay)
    this.disposeOverlay(this.rightEyeOverlay)
    this.disposeOverlay(this.mouthOverlay)
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

  private patchProceduralJaw(
    mesh: Mesh,
    bounds: Box3,
    size: Vector3,
    center: Vector3,
  ): void {
    const patchMaterial = (material: Material): Material => {
      if (!(material instanceof MeshStandardMaterial)) return material

      const patched = material.clone()
      const jawUniform: NumericUniform = { value: 0 }
      this.jawUniforms.push(jawUniform)
      patched.onBeforeCompile = (shader) => {
        shader.uniforms.uFaceCamJawOpen = jawUniform
        shader.uniforms.uFaceCamJawBottomY = { value: bounds.min.y + size.y * 0.17 }
        shader.uniforms.uFaceCamJawHingeY = { value: bounds.min.y + size.y * 0.43 }
        shader.uniforms.uFaceCamJawHingeZ = { value: center.z + size.z * 0.17 }
        shader.uniforms.uFaceCamJawFrontStartZ = { value: center.z + size.z * 0.05 }
        shader.uniforms.uFaceCamJawFrontZ = { value: bounds.max.z }
        shader.uniforms.uFaceCamJawHeight = { value: size.y }
        shader.uniforms.uFaceCamJawHalfWidth = { value: size.x * 0.42 }
        shader.vertexShader = shader.vertexShader.replace(
          '#include <common>',
          `#include <common>
          uniform float uFaceCamJawOpen;
          uniform float uFaceCamJawBottomY;
          uniform float uFaceCamJawHingeY;
          uniform float uFaceCamJawHingeZ;
          uniform float uFaceCamJawFrontStartZ;
          uniform float uFaceCamJawFrontZ;
          uniform float uFaceCamJawHeight;
          uniform float uFaceCamJawHalfWidth;`,
        )
        shader.vertexShader = shader.vertexShader.replace(
          '#include <begin_vertex>',
          `vec3 transformed = vec3(position);
          float faceCamLowerGate = smoothstep(
            uFaceCamJawBottomY,
            uFaceCamJawBottomY + uFaceCamJawHeight * 0.085,
            position.y
          );
          float faceCamUpperGate = 1.0 - smoothstep(
            uFaceCamJawHingeY - uFaceCamJawHeight * 0.09,
            uFaceCamJawHingeY + uFaceCamJawHeight * 0.012,
            position.y
          );
          float faceCamFrontGate = smoothstep(
            uFaceCamJawFrontStartZ,
            uFaceCamJawFrontZ,
            position.z
          );
          float faceCamSideGate = 1.0 - smoothstep(
            uFaceCamJawHalfWidth * 0.68,
            uFaceCamJawHalfWidth,
            abs(position.x)
          );
          float faceCamJawWeight = clamp(
            faceCamLowerGate * faceCamUpperGate * faceCamFrontGate * faceCamSideGate,
            0.0,
            1.0
          );
          float faceCamJawAngle = -uFaceCamJawOpen * 0.31 * faceCamJawWeight;
          float faceCamCos = cos(faceCamJawAngle);
          float faceCamSin = sin(faceCamJawAngle);
          float faceCamY = position.y - uFaceCamJawHingeY;
          float faceCamZ = position.z - uFaceCamJawHingeZ;
          transformed.y = faceCamCos * faceCamY - faceCamSin * faceCamZ
            + uFaceCamJawHingeY
            - uFaceCamJawOpen * uFaceCamJawHeight * 0.018 * faceCamJawWeight;
          transformed.z = faceCamSin * faceCamY + faceCamCos * faceCamZ
            + uFaceCamJawHingeZ;`,
        )
      }
      patched.customProgramCacheKey = () => 'facecam-procedural-jaw-v1'
      patched.needsUpdate = true
      material.dispose()
      return patched
    }

    mesh.material = Array.isArray(mesh.material)
      ? mesh.material.map(patchMaterial)
      : patchMaterial(mesh.material)
  }

  private configureFacialOverlays(
    bounds: Box3,
    size: Vector3,
    center: Vector3,
    modelEyeY: number,
  ): void {
    const frontZ = bounds.max.z - center.z + size.z * 0.007
    const eyeY = bounds.min.y + size.y * 0.575 - modelEyeY
    const eyeX = size.x * 0.17
    const eyeWidth = size.x * 0.205
    const eyeHeight = size.y * 0.09

    this.baseEyeY = eyeY
    this.leftEyeOverlay.mesh.position.set(-eyeX, eyeY, frontZ)
    this.rightEyeOverlay.mesh.position.set(eyeX, eyeY, frontZ)
    this.leftEyeOverlay.mesh.scale.set(eyeWidth, eyeHeight, 1)
    this.rightEyeOverlay.mesh.scale.set(eyeWidth, eyeHeight, 1)
    this.leftEyeOverlay.mesh.rotation.y = 0.09
    this.rightEyeOverlay.mesh.rotation.y = -0.09
    this.leftEyeOverlay.mesh.visible = !this.hasNativeEyes
    this.rightEyeOverlay.mesh.visible = !this.hasNativeEyes

    this.baseMouthY = bounds.min.y + size.y * 0.335 - modelEyeY
    this.baseMouthWidth = size.x * 0.36
    this.baseMouthHeight = size.y * 0.105
    this.mouthOverlay.mesh.position.set(0, this.baseMouthY, frontZ + size.z * 0.004)
    this.mouthOverlay.mesh.scale.set(this.baseMouthWidth, this.baseMouthHeight * 0.18, 1)
    this.mouthOverlay.mesh.visible = !this.hasNativeJaw
    this.mouthOverlay.material.opacity = 0
  }

  private applyExpression(expression: DragonExpressionState, force = false): void {
    const jawOpen = clamp(expression.jawOpen * 0.82, 0, 0.82)
    this.jawUniforms.forEach((uniform) => {
      uniform.value = jawOpen
    })

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

    const eyeChanged = force
      || Math.abs(expression.blinkLeft - this.lastExpression.blinkLeft) > 0.015
      || Math.abs(expression.blinkRight - this.lastExpression.blinkRight) > 0.015
      || Math.abs(expression.gazeX - this.lastExpression.gazeX) > 0.012
      || Math.abs(expression.gazeY - this.lastExpression.gazeY) > 0.012
    if (!this.hasNativeEyes && eyeChanged) {
      drawEyeTexture(this.leftEyeOverlay, expression, 'left')
      drawEyeTexture(this.rightEyeOverlay, expression, 'right')
    }

    const browLift = expression.browRaise * this.modelHeight * 0.008
    this.leftEyeOverlay.mesh.position.y = this.baseEyeY + browLift
    this.rightEyeOverlay.mesh.position.y = this.baseEyeY + browLift

    if (!this.hasNativeJaw) {
      const mouthChanged = force
        || Math.abs(expression.jawOpen - this.lastExpression.jawOpen) > 0.018
        || Math.abs(expression.smile - this.lastExpression.smile) > 0.02
      if (mouthChanged) drawMouthTexture(this.mouthOverlay, expression)
      this.mouthOverlay.material.opacity = clamp((expression.jawOpen - 0.035) / 0.22, 0, 0.96)
      this.mouthOverlay.mesh.position.y = this.baseMouthY - expression.jawOpen * this.modelHeight * 0.022
      this.mouthOverlay.mesh.scale.set(
        this.baseMouthWidth * (1 + expression.smile * 0.1),
        this.baseMouthHeight * (0.16 + expression.jawOpen * 0.96),
        1,
      )
    }

    this.lastExpression = { ...expression }
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
    this.jawUniforms.length = 0
    this.hasNativeJaw = false
    this.hasNativeEyes = false
    this.leftEyeOverlay.mesh.visible = false
    this.rightEyeOverlay.mesh.visible = false
    this.mouthOverlay.mesh.visible = false
  }

  private disposeOverlay(overlay: TextureOverlay): void {
    overlay.mesh.geometry.dispose()
    overlay.texture.dispose()
    overlay.material.dispose()
  }

  private disposeMaterial(material: Material): void {
    for (const value of Object.values(material)) {
      if (value instanceof Texture) value.dispose()
    }
    material.dispose()
  }
}
