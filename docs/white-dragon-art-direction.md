# Dirección artística canónica — Dragón Blanco

Estado: aprobado para producción 3D

Esta guía convierte la referencia visual aprobada en requisitos observables. El activo final debe parecer una criatura real integrada en la cámara, no una ilustración, un casco ni una máscara plástica.

## 1. Lectura visual

El Dragón Blanco debe transmitir, en este orden:

1. inteligencia y serenidad;
2. majestuosidad ceremonial;
3. poder contenido;
4. misticismo tecnológico discreto.

La expresión neutra no es agresiva. Los arcos orbitales pueden ser intensos, pero la boca, la mandíbula y las fosas nasales deben permanecer relajadas.

## 2. Silueta aprobada

- Cráneo alargado y ligeramente ancho sobre los ojos.
- Hocico reptiliano de longitud media, no humanoide ni excesivamente corto.
- Dos cuernos principales largos que nacen detrás de los arcos orbitales y apuntan arriba y atrás.
- Cresta frontal central y espinas secundarias con jerarquía clara.
- Mandíbula definida, estrechándose hacia el hocico sin terminar en punta.
- Cuello anatómico con placas superpuestas en V.
- Parte posterior completa para giros de cabeza; no se acepta una máscara frontal abierta.

### Proporciones de referencia

- Ancho máximo de cabeza: 1,20–1,30 veces el ancho facial humano calibrado.
- Altura de cráneo sin cuernos: 1,10–1,20 veces la altura facial.
- Longitud visible del hocico: 25–30 % de la altura de la cabeza.
- Cuernos principales: 35–45 % de la altura del cráneo.
- Ojos: separación ligeramente superior a la humana, sin aspecto caricaturesco.

## 3. Hoja ortográfica obligatoria

Antes de aprobar la escultura, deben entregarse vistas con la misma escala, cámara ortográfica y expresión neutra:

- frontal;
- tres cuartos izquierdo;
- perfil izquierdo;
- posterior;
- superior;
- inferior;
- boca abierta a 70 %;
- cabeza sin cuello;
- cabeza con cuello;
- detalle de ojo, hocico, cuerno y símbolo frontal.

Cada vista debe incluir líneas de referencia para eje central, altura de ojos, base nasal, línea de boca, articulación mandibular y comienzo del cuello.

## 4. Anatomía facial

### Ojos

- Iris cian con profundidad radial y variación tonal.
- Pupila vertical negra, estrecha en luz y más abierta en sombra.
- Esclerótica oscura azul-gris, nunca blanca.
- Globo ocular, iris y capa corneal separados.
- Párpados superior e inferior modelados con grosor.
- Microescamas alrededor del borde palpebral.
- Reflejos de la escena sobre la córnea.

No se aceptan ojos pintados directamente en la malla de la cabeza.

### Hocico y nariz

- Puente nasal ancho en la base y afinado progresivo.
- Fosas nasales profundas con volumen interior.
- Planos claros entre frente, puente, mejillas y mandíbula.
- Microescamas alrededor de fosas, labios y comisuras.
- La nariz no puede conservar la silueta de una nariz humana.

### Boca

- Mandíbula articulada desde una bisagra posterior.
- Labio superior e inferior con grosor y sellado correcto en reposo.
- Cavidad oral completa: paladar, encías, lengua y garganta simplificada.
- Dientes de marfil con pequeñas variaciones de tamaño y orientación.
- Los dientes no sobresalen con la boca cerrada.
- Al abrir, la cavidad debe conservar profundidad desde frontal y perfil.

## 5. Cuernos y espinas

- Cuernos principales con curvatura orgánica y sección no perfectamente circular.
- Surcos longitudinales finos y desgaste muy leve en puntas.
- Color marfil con variaciones gris perla.
- Espinas secundarias progresivamente menores hacia laterales y nuca.
- Asimetría microscópica permitida; la silueta general debe seguir siendo equilibrada.

Quedan prohibidos cuernos lisos con forma de cono, orejas triangulares o simetría matemática perfecta.

## 6. Escamas

Se requieren tres escalas de detalle:

### Microescamas

Zonas: párpados, fosas nasales, labios, comisuras y transición de mandíbula.

### Escamas medias

Zonas: mejillas, frente, laterales del cráneo y mandíbula.

### Placas grandes

Zonas: centro de la frente, puente del hocico, garganta y cuello.

Las escamas deben seguir el flujo anatómico. No se acepta una textura uniforme repetida ni un patrón estampado sin dirección.

## 7. Materiales PBR

Canales mínimos:

- base color;
- normal;
- roughness;
- ambient occlusion;
- emissive para ojos y símbolo;
- máscara opcional de variación perlada.

### Comportamiento físico

- Metallic: cero o casi cero.
- Roughness variable: mayor en microescamas, menor en placas grandes.
- Reflejos perlados sutiles, nunca cromados.
- Blanco base cálido con variación gris y azul muy leve.
- Oclusión visible en surcos y uniones de placas.
- El material no debe parecer porcelana, plástico húmedo ni metal.

### Paleta de referencia

- blanco base: `#E8E9E5`;
- luces: `#FAFCFB`;
- sombras claras: `#B8C0C5`;
- sombras profundas: `#59636C`;
- iris: `#54E8FF`;
- iris profundo: `#087A9A`;
- símbolo: `#65F0FF`;
- dientes: `#E6E0D1`;
- boca: `#160F18`.

## 8. Símbolo frontal

- Diamante geométrico integrado entre las escamas.
- Línea vertical inferior.
- Malla o material independiente llamado `Forehead_Sigil`.
- Emisión cian tenue y estable.
- Sin bloom excesivo ni sobreexposición.
- Debe deformarse de forma controlada con la frente.

## 9. Cuello

El cuello no es un accesorio plano. Debe incluir:

- volumen posterior y lateral;
- placas centrales en V;
- transición orgánica bajo la mandíbula;
- deformación mediante huesos;
- terminación limpia dentro del área de la camiseta;
- objeto independiente `Dragon_Neck` para permitir encendido y apagado.

No se aceptan óvalos, cilindros lisos, columnas rígidas ni una punta flotante sobre el pecho.

## 10. Expresiones canónicas

El modelo debe admitir los morph targets definidos en `docs/white-dragon-3d-production-spec.md`.

Prioridad visual:

1. parpadeo y mirada;
2. mandíbula y cierre labial;
3. sonrisa o tensión de comisuras reinterpretada;
4. elevación de placas orbitales;
5. fosas nasales y tensión del hocico.

Las expresiones humanas deben reinterpretarse como anatomía dracónica. Una sonrisa no puede convertir el hocico en una boca humana.

## 11. Presentación para aprobación

Cada gate artístico se entrega con:

- render frontal neutro;
- render tres cuartos neutro;
- render de perfil;
- render con boca abierta;
- render con iluminación cálida;
- render con iluminación fría;
- captura de wireframe;
- captura de UV;
- captura de canales PBR;
- video corto de parpadeo, mirada y mandíbula.

## 12. Criterios de rechazo inmediato

- cabeza ovalada o lisa;
- ojos humanos visibles;
- cuernos con apariencia de orejas;
- boca como línea plana;
- interior oral sin profundidad;
- patrón de escamas repetitivo;
- brillo plástico uniforme;
- cuello con forma de corbata u óvalo;
- bordes abiertos visibles en giros;
- proporciones diferentes entre LOD;
- cambios de identidad visual entre cabeza con cuello y sin cuello.

## 13. Gate de aprobación artística

La dirección artística se considera aprobada únicamente cuando:

- la silueta coincide en frontal, tres cuartos y perfil;
- ojos, hocico y cuernos conservan la identidad aprobada;
- el cuello se integra anatómicamente;
- las texturas funcionan bajo luz cálida y fría;
- las expresiones no rompen escamas ni labios;
- el modelo sigue pareciendo la misma criatura en los tres LOD.
