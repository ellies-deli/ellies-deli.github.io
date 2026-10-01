# Ellie's Deli (Coyle Hall): guía de instalación

> La página web queda en inglés. Solo esta guía está en español.
> Los nombres de los botones de Firebase pueden variar un poco según la versión. Si algo no coincide, búscalo por el ícono o la posición.

Son dos páginas:
- `index.html`: donde los estudiantes hacen su pedido. Ponen su correo ND, su hall, nombre, hora de recojo, notas y si pagan en efectivo o con tarjeta, y ven su lugar en la cola.
- `kitchen.html`: el tablero del personal, protegido con usuario y contraseña. Solo las cuentas del staff pueden ver los pedidos, marcarlos como listos o abrir y cerrar el deli.

Firebase y GitHub son gratis (no piden tarjeta). Lo único que cuesta es el dominio propio, unos $10–12 al año. Te toma unos 30 minutos, más la espera para que se conecte el dominio.

---

## Parte 1: Firebase (base de datos y accesos)

1. Entra a **console.firebase.google.com** con tu Gmail personal (no la cuenta @nd.edu).
2. **Crear un proyecto**, con nombre `ellies-deli`. Gemini y Google Analytics pueden quedar activados o desactivados; no afectan la página.
3. En el menú de la izquierda: **Compilación → Firestore Database** (puede aparecer como "Bases de datos y almacenamiento") → **Crear base de datos**.
   - Edición: **Estándar**, si te lo pregunta.
   - Ubicación: **nam5 (Estados Unidos)**. No se puede cambiar después.
   - Elige **Comenzar en modo de producción** → **Crear**.
4. Abre la pestaña **Reglas**. Borra todo lo que hay, pega el contenido completo del archivo `firestore.rules` y haz clic en **Publicar**.
5. Ve a **Compilación → Authentication** → **Comenzar**. En **Método de acceso**, activa:
   - **Anónimo**, para que los estudiantes pidan sin crear cuenta.
   - **Correo electrónico/contraseña**, para el acceso del staff.
6. En Authentication, abre la pestaña **Usuarios** → **Agregar usuario**. Crea el acceso del staff, por ejemplo una sola cuenta compartida para quien esté de turno, como `ellies.staff@gmail.com`, con una contraseña segura. Cuando se cree, **copia su UID de usuario** (el código largo de la lista).
7. Vuelve a **Firestore Database → Datos** → **Iniciar colección**:
   - ID de colección: `staff`
   - ID del documento: pega el **UID de usuario** del paso 6
   - Agrega un campo: `role` (tipo string) = `staff`
   - **Guardar**.

   Repite los pasos 6 y 7 para cada acceso adicional. Para quitarle acceso a alguien, borra su documento en `staff`.
8. Haz clic en el engranaje (arriba a la izquierda) → **Configuración del proyecto**. En **Tus apps**, haz clic en el ícono web `</>`, ponle `ellies-web` y dale a **Registrar app** (no actives Firebase Hosting). Aparecerá un bloque `firebaseConfig = { ... }`. Deja esa pestaña abierta.
9. Abre `firebase-config.js` con cualquier editor de texto (Bloc de notas o TextEdit) y reemplaza cada `PASTE_HERE` con el valor correspondiente del paso 8. Guarda.

## Parte 2: GitHub Pages (la página web)

GitHub solo está en inglés, así que los botones van en inglés.

10. Crea una cuenta gratis en **github.com**.
11. Haz clic en **+ → New repository**. Nombre: `ellies-deli`, visibilidad **Public** → **Create repository**.
12. Haz clic en **uploading an existing file**, arrastra **todos** los archivos de la carpeta y luego **Commit changes**.
13. En el repositorio: **Settings → Pages**. En **Build and deployment**, pon Source: **Deploy from a branch**, Branch: **main**, carpeta **/ (root)** → **Save**.
14. Espera 1–2 minutos. La página estará en `https://TU-USUARIO-GITHUB.github.io/ellies-deli/`. Esa dirección ya funciona sola; en la Parte 3 le pones un dominio propio.
15. De vuelta en Firebase: **Authentication → Configuración → Dominios autorizados → Agregar dominio**, y agrega `TU-USUARIO-GITHUB.github.io`.

## Parte 3: Dominio propio, como thebuffduncan.com (unos $10–12 al año)

La página de Duncan es un sitio de GitHub Pages con su propio dominio apuntando a él. Tú vas a hacer lo mismo. Pon "coyle" y "ellies" en el nombre para que coincida con lo que la gente busca, por ejemplo `coyleellies.com` o `elliesdelind.com`.

16. Compra el dominio en **Porkbun**, **Namecheap** o **Cloudflare**. Busca tu idea y compra el `.com` si está libre. No compres extras como correo o "privacy plus"; la privacidad WHOIS gratis es suficiente.
17. En la configuración **DNS** del dominio, borra los registros de "parking" que vengan por defecto y agrega:

    | Tipo  | Host / Nombre | Valor                          |
    |-------|---------------|--------------------------------|
    | A     | @ (vacío)     | 185.199.108.153                |
    | A     | @ (vacío)     | 185.199.109.153                |
    | A     | @ (vacío)     | 185.199.110.153                |
    | A     | @ (vacío)     | 185.199.111.153                |
    | CNAME | www           | TU-USUARIO-GITHUB.github.io    |

18. En GitHub: **Settings → Pages → Custom domain**, escribe tu dominio (ej. `coyleellies.com`) → **Save**. GitHub revisa el DNS, lo que puede tardar desde unos minutos hasta unas horas. Cuando pase la revisión, marca **Enforce HTTPS**.
19. En Firebase: **Authentication → Configuración → Dominios autorizados → Agregar dominio**. Agrega tu dominio y también la versión con `www.` (ej. `coyleellies.com` y `www.coyleellies.com`). **Si te saltas esto, los pedidos no van a funcionar en la nueva dirección.**

Tu página quedará en `https://coyleellies.com` y la cocina en `https://coyleellies.com/kitchen.html`.

## Parte 4: Que aparezca en Google

La página ya está preparada: su título, descripción y datos internos dicen "Ellie's Deli · Coyle Hall, Notre Dame", y la página de la cocina está oculta para los buscadores. Para que Google la encuentre:

20. Entra a **search.google.com/search-console** con tu Gmail. **Agregar propiedad** → elige **Dominio** → escribe tu dominio.
21. Google te dará un **registro TXT** (empieza con `google-site-verification=`). Agrégalo en el DNS de tu dominio (Tipo `TXT`, Host `@`, Valor = ese texto), espera unos minutos y haz clic en **Verificar**.
22. En Search Console, abre **Inspección de URLs**, pega `https://tudominio.com/` y haz clic en **Solicitar indexación**.
23. (Opcional) Haz lo mismo en **bing.com/webmasters**. Se puede importar directo desde Google Search Console. Bing también alimenta a DuckDuckGo y otros.
24. Para que suba en los resultados: pon el link en la bio de Instagram de Ellie's o de Coyle, en el GroupMe del hall y en un póster con código QR en el hall. Google confía más en páginas a las que otros sitios enlazan.

Google suele tardar **entre unos días y dos semanas** en mostrar una página nueva. Nadie puede garantizar la posición. Pero "coyle ellies deli" es una búsqueda muy específica y tu título y dominio coinciden con ella, así que debería aparecer una vez indexada.

## Parte 5: Probarla

25. Abre `https://tudominio.com/kitchen.html`, entra con el acceso del staff y haz clic en **Open the deli for orders**. El deli empieza cerrado hasta que el staff lo abra.
26. Desde tu celular, abre `https://tudominio.com` y haz un pedido de prueba. Debe aparecer en el tablero de la cocina con un sonido.
27. Haz clic en **Start making** y luego en **Mark ready**. Tu celular debe mostrar "Ready for pickup" y el título de la pestaña cambia a READY.
28. Haz clic en **Picked up**. ¡Listo, ya está funcionando! Comparte el link principal o conviértelo en un código QR para pegarlo en Ellie's.

---

## En cada turno

- Abre `kitchen.html` en la laptop o tablet del deli e inicia sesión.
- Haz clic en **Open the deli for orders** al empezar el turno y en **Stop taking orders** al terminar.
- Mueve cada pedido: **Start making → Mark ready → Picked up**. El conteo de la cola que ven los estudiantes solo incluye pedidos en New y Making, así que mover los pedidos a tiempo mantiene el número correcto. Usa **Cancel order** para quienes no recogen o para errores.

## Cambiar el menú

Edita `menu.js` en GitHub: abre el archivo, haz clic en el lápiz y luego en **Commit changes**. Los precios van en centavos (`700` = $7.00). La lista de halls está en el mismo archivo. Los cambios se publican en más o menos un minuto.

## Bueno saber

- **Quién ve qué:** cada estudiante solo ve su propio pedido más un conteo anónimo de la cola. Los nombres, correos y detalles de los pedidos solo los ven las cuentas del staff. Esto lo hacen cumplir las reglas de la base de datos, no solo la página.
- **A los estudiantes se les recuerda por navegador.** Si cambian de celular, no verán un pedido anterior en el nuevo.
- **Los correos no se verifican.** La página revisa que terminen en `@nd.edu`, pero no puede confirmar que sean de quien los escribe.
- **Los totales se calculan en el celular del estudiante.** Cobra según los productos que aparecen en el ticket de la cocina, con tus precios reales.
- **No hay pago en línea.** La opción de efectivo o tarjeta solo le avisa al staff cómo va a pagar la persona en el mostrador.
