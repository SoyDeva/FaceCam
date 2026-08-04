# FaceCam · Ruta de producción del Dragón Blanco

## Objetivo final

Una máscara 3D local apta para grabación de contenido: seguimiento estable, habla expresiva, parpadeo real, privacidad de fallo cerrado, estética celestial animada y rendimiento sostenido en Chrome de escritorio y móvil.

## Etapa 1 · Expresividad y presencia

- Fusionar blendshapes de MediaPipe con mediciones geométricas de labios y párpados.
- Respuesta de mandíbula rápida al abrir y estable al cerrar.
- Parpadeo independiente con mayor sensibilidad y amplitud del morph.
- Sustituir el disco blanco por un ocultador oscuro detrás del GLB y un aura celestial animada multicapa.
- Mantener todos los efectos dentro del canvas grabado.

## Etapa 2 · Ajuste anatómico del rig

- Revisar el contacto de labios en pose neutral.
- Afinar pivote, rango y simetría de `jawOpen`.
- Refinar `eyeBlinkLeft` y `eyeBlinkRight` sobre párpados reales.
- Separar globos oculares o añadir morphs de mirada sin prótesis visuales.

## Etapa 3 · Habla avanzada

- Añadir morphs `mouthFunnel`, `mouthPucker`, `mouthClose` y sonrisas laterales.
- Retargeting de visemas para vocales y consonantes visibles.
- Compensación de latencia y predicción corta para grabación a 30 fps.

## Etapa 4 · Integración hiperrealista

- Iluminación estimada de la cámara y adaptación de exposición.
- Sombras de contacto y mejor unión cuello–torso.
- Oclusión de cabello/orejas refinada y fail-closed ante pérdida de tracking.
- Perfiles de calidad automáticos según GPU, temperatura y fps.

## Criterios de salida

- La cara real no aparece durante tracking válido ni pérdida breve.
- Boca y párpados reaccionan sin capas 2D superpuestas.
- El dragón mantiene escala al girar y responde a distancia real.
- Vista previa y grabación producen la misma composición.
- 720p y objetivo de 24–30 fps en dispositivos compatibles.
