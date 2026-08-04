export interface MaskManifest {
  id: string
  name: string
  version: string
  supportsNeck: boolean
  supportsEyeTracking: boolean
  supportsMouthTracking: boolean
  model?: {
    high: string
    medium: string
    low: string
  }
}
