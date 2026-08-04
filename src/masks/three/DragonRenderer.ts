import {
  ACESFilmicToneMapping,
  AmbientLight,
  Color,
  DirectionalLight,
  Group,
  Mesh,
  Object3D,
  PerspectiveCamera,
  Quaternion,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from 'three'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js'
import type { DragonAssetManifest } from './manifest'
import { resolvePublicAssetUrl } from './manifest'
import type { DragonExpressionFrame, DragonMorphTarget } from './retargeting'
import type { DragonQualityProfile } from './quality'

interface MorphBinding {
  influences: number[]
  indices: Partial<Record<DragonMorphTarget, number>>
}

export interface DragonPose {
  position: Vector3
  rotation: Quaternion
  scale: number
}

export class DragonRenderer {
  readonly canvas: HTMLCanvasElement

  private readonly renderer: WebGLRenderer
  private readonly scene = new Scene()
  private readonly camera = new PerspectiveCamera(34, 16 / 9, 0.01, 20)
  private readonly modelContainer = new Group()
  private modelRoot: Object3D | null = null
  private neck: Object3D | null = null
  private morphBindings: MorphBinding[] = []
  private ktx2Loader: KTX2Loader | null = null

  constructor(
    private readonly profile: DragonQualityProfile,
    width: number,
    height: number,
  ) {
    this.canvas = document.createElement('canvas')
    this.renderer = new WebGLRenderer({
      canvas: this.canvas,
      alpha: true,
      antialias: profile.antialias,
      premultipliedAlpha: true,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false,
    })
    this.renderer.outputColorSpace = SRGBColorSpace
    this.renderer.toneMapping = ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1
    this.renderer.setClearColor(new Color(0x000000), 0)
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, profile.maxPixelRatio))

    this.scene.add(this.modelContainer)
    this.scene.add(new AmbientLight(0xd8e8f0, 1.05))

    const keyLight = new DirectionalLight(0xfff3e8, 2.1)
    keyLight.position.set(-2.5, 3.5, 4)
    this.scene.add(keyLight)

    const rimLight = new DirectionalLight(0x8cefff, 0.65)
    rimLight.position.set(3, 1.5, -2)
    this.scene.add(rimLight)

    this.camera.position.set(0, 0, 2.8)
    this.camera.lookAt(0, 0, 0)
    this.setSize(width, height)
  }

  async load(manifest: DragonAssetManifest): Promise<void> {
    const lod = manifest.lods[this.profile.lod]
    const loader = new GLTFLoader()

    this.ktx2Loader = new KTX2Loader()
      .setTranscoderPath(resolvePublicAssetUrl(manifest.basisTranscoderPath))
      .setWorkerLimit(this.profile.level === 'safe' ? 1 : 2)
      .detectSupport(this.renderer)

    loader.setKTX2Loader(this.ktx2Loader)
    loader.setMeshoptDecoder(MeshoptDecoder)

    const gltf = await loader.loadAsync(resolvePublicAssetUrl(lod.url))
    this.validateAsset(gltf.scene, manifest)

    if (this.modelRoot) this.modelContainer.remove(this.modelRoot)
    this.modelRoot = gltf.scene
    this.neck = gltf.scene.getObjectByName(manifest.nodes.neck) ?? null
    this.morphBindings = this.collectMorphBindings(gltf.scene)
    this.modelContainer.add(gltf.scene)
  }

  setSize(width: number, height: number): void {
    const safeWidth = Math.max(2, width)
    const safeHeight = Math.max(2, height)
    this.renderer.setSize(safeWidth, safeHeight, false)
    this.camera.aspect = safeWidth / safeHeight
    this.camera.updateProjectionMatrix()
  }

  setPose(pose: DragonPose): void {
    this.modelContainer.position.copy(pose.position)
    this.modelContainer.quaternion.copy(pose.rotation)
    this.modelContainer.scale.setScalar(pose.scale)
  }

  setNeckEnabled(enabled: boolean): void {
    if (this.neck) this.neck.visible = enabled
  }

  applyExpression(frame: DragonExpressionFrame): void {
    for (const binding of this.morphBindings) {
      for (const [target, value] of Object.entries(frame) as [DragonMorphTarget, number][]) {
        const index = binding.indices[target]
        if (index === undefined) continue
        binding.influences[index] = value
      }
    }
  }

  render(): HTMLCanvasElement {
    this.renderer.clear()
    this.renderer.render(this.scene, this.camera)
    return this.canvas
  }

  setLighting(options: {
    exposure?: number
    ambientColor?: number
    backgroundLuminance?: number
  }): void {
    const backgroundLuminance = options.backgroundLuminance ?? 0.5
    this.renderer.toneMappingExposure = options.exposure ?? (0.82 + backgroundLuminance * 0.42)
    const ambient = this.scene.children.find((child): child is AmbientLight => child instanceof AmbientLight)
    if (ambient && options.ambientColor !== undefined) ambient.color.setHex(options.ambientColor)
  }

  dispose(): void {
    this.scene.traverse((object) => {
      if (!(object instanceof Mesh)) return
      object.geometry.dispose()
      const materials = Array.isArray(object.material) ? object.material : [object.material]
      for (const material of materials) material.dispose()
    })
    this.ktx2Loader?.dispose()
    this.renderer.dispose()
    this.renderer.forceContextLoss()
    this.modelRoot = null
    this.neck = null
    this.morphBindings = []
  }

  private collectMorphBindings(root: Object3D): MorphBinding[] {
    const bindings: MorphBinding[] = []

    root.traverse((object) => {
      if (!(object instanceof Mesh)) return
      const dictionary = object.morphTargetDictionary
      const influences = object.morphTargetInfluences
      if (!dictionary || !influences) return

      const indices: Partial<Record<DragonMorphTarget, number>> = {}
      for (const [name, index] of Object.entries(dictionary)) {
        indices[name as DragonMorphTarget] = index
      }
      bindings.push({ influences, indices })
    })

    return bindings
  }

  private validateAsset(root: Object3D, manifest: DragonAssetManifest): void {
    const requiredNodes = Object.values(manifest.nodes)
    const missingNodes = requiredNodes.filter((name) => !root.getObjectByName(name))
    if (missingNodes.length) {
      throw new Error(`El GLB del Dragón Blanco no cumple el contrato. Faltan: ${missingNodes.join(', ')}.`)
    }
  }
}
