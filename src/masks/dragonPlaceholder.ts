import type { FaceLandmarkerResult, NormalizedLandmark } from '@mediapipe/tasks-vision'

type BlendshapeMap = Record<string, number>

function point(landmarks: NormalizedLandmark[], index: number, width: number, height: number) {
  const landmark = landmarks[index]
  if (!landmark) return { x: width / 2, y: height / 2 }
  return { x: landmark.x * width, y: landmark.y * height }
}

function blendshapes(result: FaceLandmarkerResult): BlendshapeMap {
  const categories = result.faceBlendshapes[0]?.categories ?? []
  return Object.fromEntries(categories.map((category) => [category.categoryName, category.score]))
}

export function drawWhiteDragon(
  context: CanvasRenderingContext2D,
  result: FaceLandmarkerResult | null,
  width: number,
  height: number,
  neckEnabled: boolean,
): boolean {
  const landmarks = result?.faceLandmarks[0]
  if (!landmarks) return false

  const top = point(landmarks, 10, width, height)
  const chin = point(landmarks, 152, width, height)
  const left = point(landmarks, 234, width, height)
  const right = point(landmarks, 454, width, height)
  const nose = point(landmarks, 1, width, height)
  const leftEye = point(landmarks, 468, width, height)
  const rightEye = point(landmarks, 473, width, height)
  const scores = blendshapes(result!)

  const faceWidth = Math.max(120, Math.hypot(right.x - left.x, right.y - left.y))
  const faceHeight = Math.max(160, Math.hypot(chin.x - top.x, chin.y - top.y))
  const cx = (left.x + right.x) / 2
  const headTop = top.y - faceHeight * 0.42
  const headBottom = chin.y + faceHeight * 0.16
  const jawOpen = scores.jawOpen ?? 0
  const blinkLeft = scores.eyeBlinkLeft ?? 0
  const blinkRight = scores.eyeBlinkRight ?? 0
  const gazeX = ((scores.eyeLookOutLeft ?? 0) - (scores.eyeLookInLeft ?? 0)) * faceWidth * 0.04
  const gazeY = ((scores.eyeLookDownLeft ?? 0) - (scores.eyeLookUpLeft ?? 0)) * faceHeight * 0.025

  context.save()
  context.lineJoin = 'round'
  context.lineCap = 'round'

  if (neckEnabled) {
    const neckGradient = context.createLinearGradient(cx - faceWidth, chin.y, cx + faceWidth, height)
    neckGradient.addColorStop(0, '#8d96a5')
    neckGradient.addColorStop(0.45, '#f4f7fb')
    neckGradient.addColorStop(1, '#6c7482')
    context.fillStyle = neckGradient
    context.beginPath()
    context.moveTo(cx - faceWidth * 0.54, chin.y - faceHeight * 0.05)
    context.bezierCurveTo(cx - faceWidth * 0.72, chin.y + faceHeight * 0.35, cx - faceWidth * 0.58, height, cx, height)
    context.bezierCurveTo(cx + faceWidth * 0.58, height, cx + faceWidth * 0.72, chin.y + faceHeight * 0.35, cx + faceWidth * 0.54, chin.y - faceHeight * 0.05)
    context.closePath()
    context.fill()
  }

  const headGradient = context.createRadialGradient(
    nose.x - faceWidth * 0.18,
    top.y,
    faceWidth * 0.05,
    cx,
    nose.y,
    faceWidth * 0.92,
  )
  headGradient.addColorStop(0, '#ffffff')
  headGradient.addColorStop(0.42, '#dfe7ef')
  headGradient.addColorStop(0.78, '#9ba6b5')
  headGradient.addColorStop(1, '#454d5a')

  context.fillStyle = headGradient
  context.strokeStyle = 'rgba(220, 239, 255, 0.72)'
  context.lineWidth = Math.max(2, faceWidth * 0.012)
  context.beginPath()
  context.moveTo(cx, headTop)
  context.bezierCurveTo(cx - faceWidth * 0.72, headTop + faceHeight * 0.04, cx - faceWidth * 0.82, top.y + faceHeight * 0.34, left.x - faceWidth * 0.18, nose.y)
  context.bezierCurveTo(left.x - faceWidth * 0.1, chin.y, cx - faceWidth * 0.35, headBottom, cx, headBottom)
  context.bezierCurveTo(cx + faceWidth * 0.35, headBottom, right.x + faceWidth * 0.1, chin.y, right.x + faceWidth * 0.18, nose.y)
  context.bezierCurveTo(cx + faceWidth * 0.82, top.y + faceHeight * 0.34, cx + faceWidth * 0.72, headTop + faceHeight * 0.04, cx, headTop)
  context.closePath()
  context.fill()
  context.stroke()

  // Cuernos ceremoniales.
  context.fillStyle = '#d9e5ef'
  context.strokeStyle = '#738092'
  context.lineWidth = Math.max(2, faceWidth * 0.01)
  for (const side of [-1, 1]) {
    context.beginPath()
    context.moveTo(cx + side * faceWidth * 0.28, headTop + faceHeight * 0.12)
    context.quadraticCurveTo(cx + side * faceWidth * 0.76, headTop - faceHeight * 0.4, cx + side * faceWidth * 0.62, headTop + faceHeight * 0.22)
    context.quadraticCurveTo(cx + side * faceWidth * 0.44, headTop + faceHeight * 0.18, cx + side * faceWidth * 0.28, headTop + faceHeight * 0.12)
    context.fill()
    context.stroke()
  }

  // Escamas y cresta central.
  context.strokeStyle = 'rgba(86, 105, 128, 0.48)'
  context.lineWidth = Math.max(1, faceWidth * 0.006)
  for (let row = 0; row < 6; row += 1) {
    const y = headTop + faceHeight * (0.2 + row * 0.1)
    const spread = faceWidth * (0.2 + row * 0.055)
    context.beginPath()
    context.moveTo(cx - spread, y)
    context.quadraticCurveTo(cx, y + faceHeight * 0.07, cx + spread, y)
    context.stroke()
  }

  function drawEye(center: { x: number; y: number }, blink: number) {
    const eyeWidth = faceWidth * 0.19
    const eyeHeight = Math.max(2, faceHeight * 0.07 * (1 - Math.min(0.9, blink)))
    context.save()
    context.translate(center.x, center.y - faceHeight * 0.015)
    context.fillStyle = '#111a22'
    context.beginPath()
    context.ellipse(0, 0, eyeWidth, eyeHeight, 0, 0, Math.PI * 2)
    context.fill()
    const irisGradient = context.createRadialGradient(-eyeWidth * 0.2, -eyeHeight * 0.25, 1, gazeX, gazeY, eyeWidth * 0.58)
    irisGradient.addColorStop(0, '#f7ffff')
    irisGradient.addColorStop(0.2, '#8ef6ff')
    irisGradient.addColorStop(0.56, '#32aeb9')
    irisGradient.addColorStop(1, '#063943')
    context.fillStyle = irisGradient
    context.shadowBlur = faceWidth * 0.06
    context.shadowColor = '#75f6ff'
    context.beginPath()
    context.ellipse(gazeX, gazeY, eyeWidth * 0.54, Math.max(2, eyeHeight * 0.8), 0, 0, Math.PI * 2)
    context.fill()
    context.shadowBlur = 0
    context.fillStyle = '#020407'
    context.beginPath()
    context.ellipse(gazeX, gazeY, eyeWidth * 0.08, Math.max(2, eyeHeight * 0.82), 0, 0, Math.PI * 2)
    context.fill()
    context.restore()
  }

  drawEye(leftEye, blinkLeft)
  drawEye(rightEye, blinkRight)

  // Hocico y boca articulada.
  const mouthY = chin.y - faceHeight * 0.2
  context.fillStyle = 'rgba(16, 19, 25, 0.96)'
  context.beginPath()
  context.ellipse(cx, mouthY + jawOpen * faceHeight * 0.08, faceWidth * 0.34, faceHeight * (0.025 + jawOpen * 0.12), 0, 0, Math.PI * 2)
  context.fill()

  if (jawOpen > 0.12) {
    context.fillStyle = '#ebe7dc'
    const toothCount = 8
    for (let index = 0; index < toothCount; index += 1) {
      const t = index / (toothCount - 1)
      const x = cx - faceWidth * 0.27 + t * faceWidth * 0.54
      context.beginPath()
      context.moveTo(x - faceWidth * 0.025, mouthY - faceHeight * 0.01)
      context.lineTo(x + faceWidth * 0.025, mouthY - faceHeight * 0.01)
      context.lineTo(x, mouthY + faceHeight * (0.04 + jawOpen * 0.025))
      context.closePath()
      context.fill()
    }
  }

  // Símbolo frontal discreto.
  context.strokeStyle = 'rgba(120, 246, 255, 0.85)'
  context.shadowBlur = faceWidth * 0.035
  context.shadowColor = '#72f4ff'
  context.lineWidth = Math.max(1.5, faceWidth * 0.008)
  context.beginPath()
  context.moveTo(cx, top.y - faceHeight * 0.22)
  context.lineTo(cx - faceWidth * 0.08, top.y - faceHeight * 0.08)
  context.lineTo(cx, top.y + faceHeight * 0.02)
  context.lineTo(cx + faceWidth * 0.08, top.y - faceHeight * 0.08)
  context.closePath()
  context.stroke()

  context.restore()
  return true
}
