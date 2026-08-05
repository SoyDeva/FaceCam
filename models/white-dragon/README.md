# Entrega del activo Dragón Blanco

Este directorio recibe únicamente los archivos de distribución validados:

- `white-dragon-high.glb`
- `white-dragon-medium.glb`
- `white-dragon-low.glb`
- `manifest.json`
- `approval.json`

Los archivos fuente de Blender, ZBrush, Substance, texturas sin comprimir y renders de revisión no deben publicarse aquí. Deben conservarse en almacenamiento de producción y enlazarse como evidencia desde `approval.json`.

## Antes de entregar

1. Aplicar escala y transformaciones.
2. Mantener idéntico origen, orientación y pose neutra en los tres LOD.
3. Verificar nombres de nodos, huesos y morph targets contra `docs/white-dragon-3d-production-spec.md`.
4. Exportar glTF 2.0 binario.
5. Usar Meshopt para geometría cuando corresponda.
6. Convertir texturas de distribución a KTX2/Basis.
7. Ejecutar un validador glTF externo.
8. Completar los gates y evidencias de `approval.json`.
9. Actualizar `assetVersion` en ambos JSON.
10. Cambiar `enabled` a `true` únicamente en el commit de lanzamiento.

## Comprobación local

```bash
npm run validate:dragon
```

Mientras `enabled` sea `false`, el comando valida el contrato y permite que los GLB todavía no existan. Cuando `enabled` pase a `true`, exige:

- todos los gates aprobados;
- evidencia en cada gate;
- versiones coincidentes;
- tres GLB presentes;
- cabecera GLB 2.0 válida;
- High ≤ 30 MiB;
- Medium ≤ 12 MiB;
- Low ≤ 6 MiB.

La máscara procedural continúa siendo el fallback hasta completar este proceso.