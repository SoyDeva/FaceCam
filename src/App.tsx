import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { AuthPanel } from './auth/AuthPanel'
import { CameraStudio } from './camera/CameraStudio'
import { supabase } from './config/supabase'
import { StaticDragonCameraLab } from './labs/StaticDragonCameraLab'
import { MainDragonInstaller } from './masks/three/MainDragonInstaller'

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const dragonLabEnabled = new URLSearchParams(window.location.search).get('dragonLab') === '1'

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      setLoading(false)
    })
    return () => data.subscription.unsubscribe()
  }, [])

  if (loading) {
    return <div className="center-screen"><div className="loader" /><p>Abriendo FaceCam…</p></div>
  }

  if (!session) return <div className="auth-shell"><AuthPanel /></div>

  if (dragonLabEnabled) return <StaticDragonCameraLab />

  return (
    <>
      <MainDragonInstaller />
      <CameraStudio userId={session.user.id} />
    </>
  )
}
