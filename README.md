# FaceCam

Aplicación web para grabar cámara y micrófono con máscaras faciales procesadas localmente en el navegador.

## Estado

La versión pública incluye:

- autenticación pública con nickname y contraseña mediante Supabase;
- nickname único y preferencias protegidas con RLS;
- cámara frontal, trasera, integrada o USB;
- vista normal o espejo;
- salida que conserva la proporción real de la cámara;
- grabación local de hasta 30 minutos;
- escritura progresiva en OPFS cuando el navegador lo permite;
- prototipo técnico procedural del Dragón Blanco animado con MediaPipe;
- CI y despliegue en GitHub Pages.

> La máscara visible actualmente sigue siendo un prototipo procedural. El diseño hiperrealista aprobado necesita producirse como activo 3D GLB; no puede obtenerse únicamente aumentando el detalle del dibujo 2D.

## Fundación del Dragón Blanco 3D

El repositorio contiene el contrato para sustituir el prototipo por un activo de producción:

- especificación completa en `docs/white-dragon-3d-production-spec.md`;
- manifiesto versionado en `public/models/white-dragon/manifest.json`;
- perfiles automáticos Safe, High y Ultra;
- selección de LOD según capacidad del dispositivo;
- contrato canónico de huesos, nodos y morph targets;
- retargeting inicial de los 52 blendshapes de MediaPipe;
- cargador GLB con Meshopt y texturas KTX2/Basis Universal;
- renderer Three.js PBR preparado para iluminación, cuello activable y expresiones.

El manifiesto 3D permanece con `enabled: false` hasta recibir y validar los tres GLB. Esto mantiene estable la máscara actual y evita publicar un activo incompleto.

## Privacidad

Los fotogramas, el audio, los landmarks faciales y las grabaciones no se envían a Supabase. Supabase solo almacena la identidad técnica, el nickname y las preferencias. MediaPipe descarga el runtime WASM y el modelo de seguimiento, pero la inferencia se ejecuta en el dispositivo.

## Desarrollo

Requisitos: Node.js 22.12 o superior.

```bash
npm install
npm run dev
```

Los comandos `dev` y `build` copian automáticamente el transcoder KTX2/Basis incluido en Three.js a los recursos públicos de compilación.

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

## Ruta de producción

1. producir y validar `white-dragon-high.glb`, `white-dragon-medium.glb` y `white-dragon-low.glb`;
2. calibrar la matriz facial de MediaPipe contra el origen del modelo;
3. activar el renderer 3D manteniendo el procedural como fallback;
4. añadir estimación de iluminación y oclusión facial;
5. probar sesiones de 30 minutos en iPhone, Android y escritorio;
6. activar el manifiesto 3D solo después de superar criterios visuales y de rendimiento.
