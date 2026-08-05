import {
  CanvasTexture,
  DoubleSide,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SRGBColorSpace,
} from 'three'

const TEXTURE_WIDTH = 256
const TEXTURE_HEIGHT = 128

export interface DragonEyelidOverlay {
  canvas: HTMLCanvasElement
  texture: CanvasTexture
  material: MeshBasicMaterial
  mesh: Mesh<PlaneGeometry, MeshBasicMaterial>
}

function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value))
}

export function resolveDragonEyelidClosure(blink: number): number {
  const normalized = clamp((blink - 0.035) / 0.55)
  return Math.pow(normalized, 0.72)
}

export function createDragonEyelidOverlay(name: string): DragonEyelidOverlay {
  const canvas = document.createElement('canvas')
  canvas.width = TEXTURE_WIDTH
  canvas.height = TEXTURE_HEIGHT

  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  texture.minFilter = LinearFilter
  texture.magFilter = LinearFilter
  texture.generateMipmaps = false

  const material = new MeshBasicMaterial({
    map: texture,
    transparent: true,
    opacity: 1,
    alphaTest: 0.015,
    depthTest: true,
    depthWrite: false,
    side: DoubleSide,
    toneMapped: false,
  })

  const mesh = new Mesh(new PlaneGeometry(1, 1), material)
  mesh.name = name
  mesh.frustumCulled = false
  mesh.renderOrder = 40
  mesh.visible = false

  return { canvas, texture, material, mesh }
}

export function configureDragonEyelidOverlay(
  overlay: DragonEyelidOverlay,
  x: number,
  y: number,
  z: number,
  width: number,
  height: number,
  yaw: number,
): void {
  overlay.mesh.position.set(x, y, z)
  overlay.mesh.scale.set(width, height, 1)
  overlay.mesh.rotation.set(0, yaw, 0)
}

function traceEyeOpening(
  context: CanvasRenderingContext2D,
  halfWidth: number,
  halfHeight: number,
): void {
  context.beginPath()
  context.moveTo(-halfWidth, 0)
  context.quadraticCurveTo(0, -halfHeight, halfWidth, 0)
  context.quadraticCurveTo(0, halfHeight, -halfWidth, 0)
  context.closePath()
}

export function drawDragonEyelidOverlay(
  overlay: DragonEyelidOverlay,
  blink: number,
  side: 'left' | 'right',
): void {
  const context = overlay.canvas.getContext('2d')
  if (!context) return

  const closure = resolveDragonEyelidClosure(blink)
  const width = overlay.canvas.width
  const height = overlay.canvas.height
  const halfWidth = width * 0.46
  const halfHeight = height * 0.38

  context.clearRect(0, 0, width, height)
  overlay.mesh.visible = closure > 0.001
  if (!overlay.mesh.visible) {
    overlay.texture.needsUpdate = true
    return
  }

  context.save()
  context.translate(width / 2, height / 2)
  context.rotate(side === 'left' ? -0.035 : 0.035)
  traceEyeOpening(context, halfWidth, halfHeight)
  context.clip()

  const upperEdge = -halfHeight + halfHeight * closure
  const lowerEdge = halfHeight - halfHeight * closure

  const upperGradient = context.createLinearGradient(0, -halfHeight, 0, halfHeight * 0.12)
  upperGradient.addColorStop(0, 'rgba(246, 252, 253, 1)')
  upperGradient.addColorStop(0.55, 'rgba(218, 234, 238, 1)')
  upperGradient.addColorStop(1, 'rgba(155, 184, 194, 0.99)')
  context.fillStyle = upperGradient
  context.beginPath()
  context.moveTo(-halfWidth * 1.1, -halfHeight * 1.3)
  context.lineTo(halfWidth * 1.1, -halfHeight * 1.3)
  context.lineTo(halfWidth * 1.1, upperEdge)
  context.quadraticCurveTo(
    0,
    upperEdge + halfHeight * (1 - closure) * 0.14,
    -halfWidth * 1.1,
    upperEdge,
  )
  context.closePath()
  context.fill()

  const lowerGradient = context.createLinearGradient(0, -halfHeight * 0.1, 0, halfHeight)
  lowerGradient.addColorStop(0, 'rgba(166, 193, 201, 0.99)')
  lowerGradient.addColorStop(0.48, 'rgba(214, 231, 235, 1)')
  lowerGradient.addColorStop(1, 'rgba(240, 249, 251, 1)')
  context.fillStyle = lowerGradient
  context.beginPath()
  context.moveTo(-halfWidth * 1.1, lowerEdge)
  context.quadraticCurveTo(
    0,
    lowerEdge - halfHeight * (1 - closure) * 0.08,
    halfWidth * 1.1,
    lowerEdge,
  )
  context.lineTo(halfWidth * 1.1, halfHeight * 1.3)
  context.lineTo(-halfWidth * 1.1, halfHeight * 1.3)
  context.closePath()
  context.fill()

  const edgeAlpha = 0.28 + closure * 0.5
  context.strokeStyle = `rgba(76, 111, 123, ${edgeAlpha})`
  context.lineWidth = Math.max(2, width * 0.012)
  context.lineCap = 'round'

  context.beginPath()
  context.moveTo(-halfWidth * 0.96, upperEdge)
  context.quadraticCurveTo(
    0,
    upperEdge + halfHeight * (1 - closure) * 0.14,
    halfWidth * 0.96,
    upperEdge,
  )
  context.stroke()

  context.beginPath()
  context.moveTo(-halfWidth * 0.96, lowerEdge)
  context.quadraticCurveTo(
    0,
    lowerEdge - halfHeight * (1 - closure) * 0.08,
    halfWidth * 0.96,
    lowerEdge,
  )
  context.stroke()

  if (closure > 0.82) {
    const closedAmount = clamp((closure - 0.82) / 0.18)
    context.strokeStyle = `rgba(45, 76, 88, ${0.46 + closedAmount * 0.34})`
    context.lineWidth = Math.max(2.5, width * 0.016)
    context.beginPath()
    context.moveTo(-halfWidth * 0.9, 0)
    context.quadraticCurveTo(0, halfHeight * 0.035, halfWidth * 0.9, 0)
    context.stroke()
  }

  context.restore()
  overlay.texture.needsUpdate = true
}

export function disposeDragonEyelidOverlay(overlay: DragonEyelidOverlay): void {
  overlay.mesh.geometry.dispose()
  overlay.texture.dispose()
  overlay.material.dispose()
}
