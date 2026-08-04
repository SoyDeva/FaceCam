# FaceCam

Aplicación web para grabar cámara y micrófono con máscaras faciales procesadas localmente en el navegador.

## Estado

Este primer incremento incluye:

- autenticación pública con nickname y contraseña mediante Supabase;
- nickname único y preferencias protegidas con RLS;
- cámara frontal, trasera, integrada o USB;
- vista normal o espejo;
- salida 720p;
- grabación local de hasta 30 minutos;
- escritura progresiva en OPFS cuando el navegador lo permite;
- prototipo técnico del Dragón Blanco animado con MediaPipe;
- estructura preparada para máscaras GLB con varios niveles de detalle;
- CI y despliegue en GitHub Pages.

> La máscara incluida es deliberadamente un prototipo procedural para validar seguimiento, grabación y rendimiento. El modelo 3D hiperrealista 360° todavía debe producirse como activo GLB con texturas PBR y morph targets.

## Privacidad

Los fotogramas, el audio, los landmarks faciales y las grabaciones no se envían a Supabase. Supabase solo almacena la identidad técnica, el nickname y las preferencias. MediaPipe descarga el runtime WASM y el modelo de seguimiento, pero la inferencia se ejecuta en el dispositivo.

## Desarrollo

Requisitos: Node.js 22.12 o superior.

```bash
npm install
npm run dev
```

## Variables

El proyecto contiene valores públicos de Supabase como fallback. También pueden configurarse mediante:

```bash
VITE_SUPABASE_URL=...
VITE_SUPABASE_PUBLISHABLE_KEY=...
```

La clave `service_role` nunca debe incorporarse al frontend ni al repositorio.

## Comprobaciones

```bash
npm run typecheck
npm test
npm run build
```

## Supabase

La migración está en `supabase/migrations`. Las funciones públicas de registro e inicio de sesión están en `supabase/functions` y deben desplegarse con `verify_jwt=false`, porque se utilizan antes de crear una sesión. Ambas validan las credenciales y el alta utiliza un nonce de servidor para impedir registros directos que omitan las reglas de FaceCam.

## Próximo incremento

- mover la inferencia de MediaPipe a Web Worker;
- importar el modelo GLB hiperrealista del Dragón Blanco;
- implementar retargeting de 52 blendshapes;
- oclusión y suavizado temporal avanzado;
- pruebas físicas en iPhone, Android y escritorio.
