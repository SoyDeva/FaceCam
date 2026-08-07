import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { installStaticDragonCpuEyeMorphPatch } from './masks/three/cpuEyeMorphPatch'
import './styles.css'

installStaticDragonCpuEyeMorphPatch()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
