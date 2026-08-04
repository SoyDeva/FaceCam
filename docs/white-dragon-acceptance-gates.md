# Puertas de aprobación — Dragón Blanco

El modelo no puede activarse en FaceCam mediante una aprobación general. Cada gate se valida por separado y debe dejar evidencia reproducible.

## Gate A — Diseño y silueta

**Responsable:** dirección artística.

Debe aprobarse antes de retopología.

- vistas frontal, 3/4, perfil, posterior, superior e inferior;
- misma escala y cámara ortográfica;
- hocico, ojos, cuernos y mandíbula coinciden con la dirección canónica;
- variante con cuello y sin cuello conserva la misma cabeza;
- boca abierta muestra una anatomía plausible;
- no existen bordes abiertos ni zonas no diseñadas en la parte posterior.

**Evidencia:** renders PNG y archivo fuente de escultura.

## Gate B — Topología y LOD

**Responsable:** modelado técnico.

- High: 60k–90k triángulos;
- Medium: 25k–40k triángulos;
- Low: 12k–18k triángulos;
- flujo de loops correcto en párpados, labios, comisuras y mandíbula;
- densidad concentrada en zonas expresivas;
- misma escala, origen y orientación en los tres LOD;
- ningún LOD modifica la silueta primaria;
- cuello independiente y desmontable;
- mallas sin vértices duplicados accidentales, caras degeneradas o normales invertidas.

**Evidencia:** estadísticas, wireframes y reporte del validador glTF.

## Gate C — UV y materiales PBR

**Responsable:** look development.

- UV sin solapamientos no intencionales;
- texel density coherente;
- albedo sin iluminación horneada dominante;
- normal, roughness y AO independientes;
- metallic nulo;
- ojos con córnea e iris separados;
- símbolo frontal como objeto o material separado;
- KTX2/Basis para las texturas de distribución;
- resoluciones máximas: High 4K, Medium 2K, Low 1K;
- ausencia de apariencia plástica, cromada o de porcelana.

**Evidencia:** canales individuales y renders bajo luz neutra, cálida y fría.

## Gate D — Rig y morph targets

**Responsable:** rigging.

- jerarquía y nombres coinciden con el manifiesto;
- mandíbula rota desde la bisagra anatómica;
- ojos rotan sin atravesar párpados;
- cuello acompaña cabeza con amortiguación;
- morph targets canónicos presentes en los tres LOD;
- parpadeo cierra completamente sin colapsar escamas;
- boca cierra sin interpenetración;
- expresiones extremas no rompen labios, dientes ni fosas;
- transformaciones neutras idénticas entre LOD.

**Evidencia:** video de prueba y reporte automático de nombres.

## Gate E — Integración técnica

**Responsable:** frontend 3D.

- GLB carga con Three.js sin advertencias críticas;
- Meshopt y KTX2 se decodifican en GitHub Pages;
- retargeting mueve ojos, párpados, mandíbula y expresiones;
- cuello on/off no recarga el modelo;
- fallback procedural permanece disponible;
- pérdida y recuperación de tracking no producen saltos violentos;
- cámara en retrato y paisaje mantiene proporción correcta;
- grabación captura exactamente la composición visible.

**Evidencia:** pruebas automatizadas y grabaciones de escritorio/móvil.

## Gate F — Rendimiento móvil

**Responsable:** optimización.

Dispositivos mínimos de prueba: un iPhone compatible, un Android de gama media y Chrome de escritorio.

- Medium: 25–30 FPS sostenidos en móvil compatible;
- Low: al menos 24 FPS en perfil Safe;
- tiempo de carga Medium razonable en red móvil;
- paquete Medium menor o igual a 12 MiB;
- paquete Low menor o igual a 6 MiB;
- sin crecimiento continuo de memoria al cambiar cámara o cuello;
- sin cierres durante una sesión de 30 minutos;
- temperatura y batería observadas, sin degradación severa inmediata.

**Evidencia:** tabla de dispositivos, FPS percentil 10/50/90, memoria y duración.

## Gate G — Calidad final y lanzamiento

**Responsable:** producto.

- la identidad coincide con la referencia aprobada;
- realismo consistente bajo tres iluminaciones;
- ojos y símbolo no presentan bloom excesivo;
- rostro humano, cabello y orejas quedan cubiertos;
- cuello se integra con ropa y hombros;
- grabación local funciona con audio y sin audio;
- archivos descargados se reproducen;
- manifiesto tiene una versión real y `enabled: true`;
- todas las aprobaciones están marcadas con evidencia.

## Regla de lanzamiento

`public/models/white-dragon/manifest.json` solo puede cambiar a `enabled: true` cuando `approval.json` declare todos los gates aprobados y el validador automático confirme la existencia, cabecera y tamaño de los tres GLB.