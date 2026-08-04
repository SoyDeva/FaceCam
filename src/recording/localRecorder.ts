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

export interface LocalRecording {
  blob: Blob
  filename: string
  release: () => Promise<void>
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
    this.writeChain = Promise.resolve()
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

  async stop(): Promise<LocalRecording> {
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
      const target = this.opfsTarget
      await target.writable.close()
      const handle = await target.directory.getFileHandle(target.filename)
      const storedFile = await handle.getFile()

      this.opfsTarget = null
      this.recorder = null

      return {
        blob: storedFile,
        filename: downloadName,
        release: async () => {
          try {
            await target.directory.removeEntry(target.filename)
          } catch (error) {
            if (!(error instanceof DOMException && error.name === 'NotFoundError')) throw error
          }
        },
      }
    }

    const result = new Blob(this.fallbackChunks, { type: this.mimeType || 'video/webm' })
    this.fallbackChunks = []
    this.recorder = null

    return {
      blob: result,
      filename: downloadName,
      release: async () => undefined,
    }
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
