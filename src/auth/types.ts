export interface AuthFunctionResponse {
  session?: {
    access_token: string
    refresh_token: string
  }
  user?: {
    id: string
  }
  error?: string
}

export interface UserSettings {
  user_id: string
  selected_mask_id: string
  neck_enabled: boolean
  mirror_enabled: boolean
  preferred_resolution: '720p'
  tracking_smoothing: number
  effects_quality: 'auto' | 'low' | 'medium' | 'high'
  updated_at: string
}
