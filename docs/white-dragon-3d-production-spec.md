# Dragón Blanco — Especificación 3D de producción

Estado: contrato técnico v1.0  
Referencia visual: Dragón Blanco hiperrealista aprobado para FaceCam  
Destino: navegador, escritorio y móvil, renderizado local en tiempo real

## 1. Objetivo de calidad

El activo debe reproducir la sensación de la referencia aprobada: un dragón blanco nacarado, anatómicamente convincente, con ojos cian reptilianos, símbolo frontal luminoso, cuernos ceremoniales y cuello de placas integrado con el cuerpo. No debe parecer casco, juguete, ilustración 2D ni superficie de porcelana.

La meta de producción es sostener 25–30 FPS en móviles compatibles y 30 FPS en escritorio durante sesiones largas. El activo debe priorizar silueta, materiales, ojos, hocico y deformación facial antes que densidad geométrica innecesaria.

## 2. Entregables obligatorios

El paquete final debe contener:

- `white-dragon-high.glb`
- `white-dragon-medium.glb`
- `white-dragon-low.glb`
- texturas KTX2/Basis Universal embebidas o referenciadas de forma relativa
- archivo fuente de producción en Blender
- set de texturas fuente sin compresión
- tabla de morph targets exportados
- pruebas visuales frontal, tres cuartos, perfil y posterior
- prueba de boca cerrada, boca abierta, parpadeo y giro de cuello

Todos los GLB deben compartir origen, escala, jerarquía, nombres de nodos, huesos y morph targets.

## 3. Sistema de coordenadas y escala

- Formato: glTF 2.0 / GLB
- Eje vertical: +Y
- Frente del personaje: +Z negativo en cámara de producción; validar orientación al importar en Three.js
- Unidad: metros
- Origen del activo: centro aproximado del cráneo, entre los ojos y ligeramente hacia atrás
- Escala de referencia: distancia interpupilar del modelo igual a 0.063 m
- Transformaciones de objetos aplicadas antes de exportar
- Ningún nodo con escala negativa

## 4. Presupuesto geométrico

| Nivel | Triángulos objetivo | Uso |
|---|---:|---|
| High | 60.000–90.000 | escritorio potente |
| Medium | 25.000–40.000 | iPhone y Android recientes |
| Low | 12.000–18.000 | dispositivos limitados |

Reglas:

- Los tres LOD deben conservar la misma silueta frontal y de tres cuartos.
- Reducir primero microgeometría de escamas, nunca ojos, párpados, boca o contorno de cuernos.
- Los detalles pequeños deben migrar a normal map.
- Máximo recomendado: 6 materiales y 8 draw calls para Medium.
- Evitar piezas duplicadas y geometría oculta permanente.

## 5. Jerarquía obligatoria

```text
WhiteDragon_Root
├── Head_Rig
│   ├── Head
│   ├── Jaw
│   ├── Eye_L
│   ├── Eye_R
│   ├── Teeth_Upper
│   ├── Teeth_Lower
│   ├── Tongue
│   ├── Dragon_Head_Mesh
│   ├── Dragon_Eyes_Mesh
│   └── Forehead_Sigil
└── Neck_Rig
    ├── Neck_01
    ├── Neck_02
    ├── Neck_03
    └── Dragon_Neck
```

Nombres reservados que la aplicación buscará:

- `WhiteDragon_Root`
- `Head_Rig`
- `Jaw`
- `Eye_L`
- `Eye_R`
- `Dragon_Head_Mesh`
- `Dragon_Eyes_Mesh`
- `Forehead_Sigil`
- `Dragon_Neck`

## 6. Rig

### Huesos mínimos

- raíz
- cabeza
- mandíbula
- ojo izquierdo
- ojo derecho
- tres huesos de cuello
- lengua opcional con dos huesos

### Reglas de deformación

- La mandíbula rota desde una articulación posterior realista.
- Los dientes inferiores acompañan la mandíbula.
- Los ojos rotan independientemente sin salir de las órbitas.
- El cuello distribuye giro e inclinación entre tres segmentos.
- Los cuernos no se deforman con expresiones faciales.
- La transición mandíbula–cuello debe permanecer cerrada en todos los gestos.

## 7. Morph targets canónicos

Los siguientes nombres son el contrato entre el GLB y FaceCam:

```text
blinkLeft
blinkRight
squintLeft
squintRight
eyeWideLeft
eyeWideRight
browDownLeft
browDownRight
browInnerUp
jawOpen
jawForward
jawLeft
jawRight
mouthClose
mouthFunnel
mouthPucker
mouthSmileLeft
mouthSmileRight
mouthFrownLeft
mouthFrownRight
mouthUpperUpLeft
mouthUpperUpRight
mouthLowerDownLeft
mouthLowerDownRight
mouthPressLeft
mouthPressRight
noseSneerLeft
noseSneerRight
nostrilFlare
```

Criterios:

- Rango normalizado de 0 a 1.
- Neutral sin deformación residual.
- `jawOpen` debe revelar una cavidad bucal completa, no una superficie negra plana.
- Sonrisas humanas se reinterpretan como tensión del hocico; no deben humanizar al dragón.
- Los párpados deben cerrar sobre la esfera ocular sin atravesarla.
- Los targets asimétricos deben funcionar de forma independiente.

## 8. Materiales PBR

### Material de escamas

Modelo recomendado: `MeshPhysicalMaterial` compatible con glTF PBR.

- Base color blanco marfil, nunca blanco puro uniforme.
- Metallic: 0.
- Roughness variable entre 0.32 y 0.72 según tipo de escama.
- Specular moderado.
- Clearcoat muy bajo y localizado; evitar acabado automotriz.
- Iridescencia muy sutil solo en placas grandes.
- Normal map con microescamas.
- AO en cavidades y separación entre placas.

### Ojos

- Globo ocular separado.
- Iris cian con pupila vertical.
- Esclerótica azul muy oscura o gris profunda.
- Capa húmeda mediante clearcoat o geometría corneal separada.
- Emisión del iris limitada; el ojo debe conservar textura y reflejos.

### Símbolo frontal

- Nodo separado `Forehead_Sigil`.
- Emissive cian.
- Intensidad base baja y ajustable desde la aplicación.
- Debe estar integrado entre placas, no flotando sobre la piel.

### Boca y dientes

- Interior con profundidad real.
- Lengua y encías con roughness alta.
- Dientes marfil, no blancos puros.
- Sin dientes visibles con boca cerrada.

## 9. Texturas

| Perfil | Resolución máxima recomendada |
|---|---:|
| High | 4096 px |
| Medium | 2048 px |
| Low | 1024 px |

Mapas mínimos:

- base color en sRGB
- normal en espacio lineal
- ORM empaquetado: occlusion, roughness, metallic
- emissive para ojos y símbolo

Requisitos:

- KTX2/Basis Universal para distribución web.
- Mipmaps incluidos.
- UV sin solapamientos involuntarios.
- Padding suficiente para mipmapping.
- No usar transparencias grandes en cuernos o escamas.

## 10. Compresión

- Geometría: Meshopt preferido.
- Texturas: KTX2/Basis Universal.
- El modelo Medium completo debe apuntar a menos de 12 MB transferidos.
- El modelo Low debe apuntar a menos de 6 MB transferidos.
- High puede llegar a 20 MB si la mejora es visible y medible.

## 11. Cuello activable

`Dragon_Neck` debe poder ocultarse sin afectar la cabeza.

Con cuello activo:

- placas centrales en V
- transición anatómica debajo de mandíbula
- volumen lateral suficiente
- extremo inferior diseñado para entrar visualmente en la camiseta

Con cuello inactivo:

- la parte posterior de la mandíbula debe cerrar correctamente
- no debe aparecer un corte abierto ni geometría interior

## 12. Oclusión y máscara humana

El modelo debe cerrar completamente la cabeza en 360 grados. La aplicación añadirá una malla de oclusión para ocultar fragmentos del rostro real. Por ello:

- no dejar agujeros alrededor de ojos o boca
- no depender de que el rostro humano permanezca visible
- evitar superficies de una sola cara en zonas externas
- mantener normales consistentes

## 13. Iluminación de referencia

La validación debe hacerse en tres entornos:

1. habitación cálida y luminosa
2. habitación fría y tenue
3. contraluz moderado

El activo debe conservar lectura de escamas sin quemar blancos. Los ojos y el símbolo deben ser visibles sin dominar toda la cara.

## 14. Criterios de aceptación visual

El activo se aprueba cuando:

- la silueta coincide con la referencia aprobada
- el hocico tiene volumen y fosas nasales creíbles
- los ojos son el foco visual y siguen la mirada
- los cuernos parecen orgánicos, no conos lisos
- las escamas muestran variación de tamaño y material
- el cuello no parece un óvalo o corbata
- la boca se abre con profundidad y dientes correctos
- frontal y tres cuartos son convincentes
- no hay intersecciones visibles durante parpadeo y mandíbula
- Medium sostiene el objetivo de rendimiento en móvil de prueba

## 15. Criterios de rechazo

Rechazar el activo si presenta cualquiera de estos defectos:

- cabeza ovalada o humana con textura de escamas
- ojos humanos visibles
- cuernos con apariencia de orejas
- piel plástica, cromada o de porcelana
- boca como línea o elipse plana
- cuello rígido y plano
- brillo emissive excesivo
- más de 12 draw calls en Medium sin justificación
- nombres de nodos o morph targets distintos del contrato
- cambios de origen o escala entre LOD

## 16. Prueba de entrega

Antes de integrar, ejecutar:

- validación glTF
- inspección de jerarquía y nombres
- prueba de todos los morph targets de 0 a 1
- prueba de mandíbula con dientes y lengua
- prueba de cuello encendido/apagado
- prueba de carga de High, Medium y Low
- inspección de texturas KTX2 en Safari/WebKit y Chrome
- medición de memoria GPU y tiempo de carga

Este documento es vinculante para el primer activo hiperrealista del proyecto. Los cambios de nombres, escala o estructura requieren actualizar primero el contrato y el código de retargeting.