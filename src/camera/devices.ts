export interface CameraDevice {
  deviceId: string
  label: string
}

export async function listCameras(): Promise<CameraDevice[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return []

  const devices = await navigator.mediaDevices.enumerateDevices()
  return devices
    .filter((device) => device.kind === 'videoinput')
    .map((device, index) => ({
      deviceId: device.deviceId,
      label: device.label || `Cámara ${index + 1}`,
    }))
}

function preferredVideoConstraints(deviceId?: string): MediaTrackConstraints {
  return {
    ...(deviceId
      ? { deviceId: { exact: deviceId } }
      : { facingMode: { ideal: 'user' } }),
    width: { ideal: 1280 },
    height: { ideal: 720 },
    frameRate: { ideal: 30 },
  }
}

async function openVideo(deviceId?: string): Promise<MediaStream> {
  const attempts: MediaStreamConstraints[] = [
    { audio: false, video: preferredVideoConstraints(deviceId) },
    {
      audio: false,
      video: deviceId
        ? { deviceId: { exact: deviceId } }
        : { facingMode: { ideal: 'user' } },
    },
    { audio: false, video: true },
  ]

  let lastError: unknown
  for (const constraints of attempts) {
    try {
      return await navigator.mediaDevices.getUserMedia(constraints)
    } catch (error) {
      lastError = error
      if (error instanceof DOMException && ['NotAllowedError', 'SecurityError'].includes(error.name)) {
        throw error
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error('No se encontró una cámara compatible.')
}

async function addMicrophone(stream: MediaStream): Promise<void> {
  try {
    const microphone = await navigator.mediaDevices.getUserMedia({
      video: false,
      audio: {
        echoCancellation: { ideal: true },
        noiseSuppression: { ideal: true },
        autoGainControl: { ideal: true },
      },
    })
    microphone.getAudioTracks().forEach((track) => stream.addTrack(track))
  } catch (error) {
    // La cámara debe continuar funcionando aunque el micrófono esté bloqueado.
    console.warn('FaceCam continuará sin micrófono.', error)
  }
}

export async function openCamera(deviceId?: string): Promise<MediaStream> {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    throw new Error('La cámara requiere HTTPS y un navegador compatible.')
  }

  const stream = await openVideo(deviceId)
  await addMicrophone(stream)
  return stream
}

export function describeMediaError(error: unknown): string {
  if (!(error instanceof DOMException)) {
    return error instanceof Error ? error.message : 'No fue posible activar la cámara.'
  }

  switch (error.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'El navegador no tiene permiso para usar la cámara. En iPhone abre Configuración > Privacidad y seguridad > Cámara y habilita Chrome; haz lo mismo en Micrófono.'
    case 'NotFoundError':
      return 'No se encontró una cámara disponible en este dispositivo.'
    case 'NotReadableError':
    case 'AbortError':
      return 'La cámara está siendo usada por otra aplicación. Cierra Cámara, WhatsApp, Instagram o videollamadas y vuelve a intentarlo.'
    case 'OverconstrainedError':
      return 'La cámara no admite la configuración solicitada. FaceCam intentó usar una configuración básica, pero el dispositivo la rechazó.'
    default:
      return error.message || 'No fue posible activar la cámara.'
  }
}

export function stopStream(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => track.stop())
}
