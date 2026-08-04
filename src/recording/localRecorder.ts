const MIME_CANDIDATES = [
  'video/mp4;codecs=h264,aac',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
]

export function selectSupportedMimeType(): string {
  return MIME_CANDIDATES.find((mimeType) => MediaRecorder.isTypeSupported(mimeType)) ?? ''
}

interface OpfsTarget {
  directory: FileSystemDirectoryHandle
  filename: string
  writable: FileSystemWritableFileStream
}

export class LocalRecorder {
  private recorder: MediaRecorder | null = null
  private fallbackChunks: Blob[] = []
  private opfsTarget: OpfsTarget | null = null
  private writeChain: Promise<void> = Promise.resolve()
  private mimeType = ''

  async start(stream: MediaStream): Promise<void> {
    this.mimeType = selectSupportedMimeType()
    this.fallbackChunks = []
    this.opfsTarget = await this.createOpfsTarget()
    this.recorder = new MediaRecorder(stream, this.mimeType ? { mimeType: this.mimeType } : undefined)
    this.recorder.addEventListener('dataavailable', (event) => {
      if (!event.data.size) return
      if (this.opfsTarget) {
        this.writeChain = this.writeChain.then(async () => {
          await this.opfsTarget?.writable.write(event.data)
        })
      } else {
        this.fallbackChunks.push(event.data)
      }
    })
    this.recorder.start(1_000)
  }

  async stop(): Promise<File> {
    if (!this.recorder) throw new Error('No hay una grabación activa.')
    const recorder = this.recorder
    await new Promise<void>((resolve, reject) => {
      recorder.addEventListener('stop', () => resolve(), { once: true })
      recorder.addEventListener('error', () => reject(new Error('La grabación falló.')), { once: true })
      recorder.stop()
    })
    await this.writeChain

    const extension = this.mimeType.includes('mp4') ? 'mp4' : 'webm'
    const downloadName = `facecam-${new Date().toISOString().replaceAll(':', '-')}.${extension}`

    if (this.opfsTarget) {
      await this.opfsTarget.writable.close()
      const handle = await this.opfsTarget.directory.getFileHandle(this.opfsTarget.filename)
      const storedFile = await handle.getFile()
      const result = new File([storedFile], downloadName, { type: this.mimeType || storedFile.type })
      await this.opfsTarget.directory.removeEntry(this.opfsTarget.filename)
      this.opfsTarget = null
      this.recorder = null
      return result
    }

    const result = new File(this.fallbackChunks, downloadName, { type: this.mimeType || 'video/webm' })
    this.fallbackChunks = []
    this.recorder = null
    return result
  }

  private async createOpfsTarget(): Promise<OpfsTarget | null> {
    if (!navigator.storage?.getDirectory) return null
    try {
      const directory = await navigator.storage.getDirectory()
      const filename = `recording-${crypto.randomUUID()}.tmp`
      const handle = await directory.getFileHandle(filename, { create: true })
      const writable = await handle.createWritable()
      return { directory, filename, writable }
    } catch {
      return null
    }
  }
}
