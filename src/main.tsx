import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { installStaticDragonEyeShaderPatch } from './masks/three/shaderEyeMorphPatch'
import './styles.css'

installStaticDragonEyeShaderPatch()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
