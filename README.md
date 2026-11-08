# Arriendo alquileres

Aplicación web en React + TypeScript + Vite para gestionar alquileres, contratos y caja.

La caja permanece abierta al cambiar el día; se cierra únicamente cuando se usa la acción manual **Cerrar caja**. Los movimientos posteriores a medianoche siguen asociados a esa misma caja. Las cajas de días anteriores que quedaron abiertas con versiones antiguas no se reactivan automáticamente.

Los nombres de clientes se escriben y se guardan en mayúsculas en contratos, ventas y en el directorio de clientes.

Al registrar un contrato, la seña abonada es obligatoria; si no hubo seña se debe ingresar `0`.

El PDF incluye el membrete sin fondo en la esquina superior derecha del contrato y en la copia del cliente. La vista previa se muestra en la aplicación; desde ella puedes imprimir, abrir o descargar el PDF.

## Requisitos de despliegue

La app requiere las siguientes variables de entorno en Vercel:

```bash
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
```

Estas variables se leen desde `src/firebase.ts` y deben estar disponibles en el entorno del cliente (`VITE_*`).

## Acceso de administrador

El acceso se valida con Firebase Authentication; no hay credenciales de administrador incluidas en el código del sitio.

1. En Firebase Console, abre **Authentication → Sign-in method** y habilita **Email/Password**.
2. En **Authentication → Users**, crea la cuenta administradora con su correo y una contraseña nueva.
3. Despliega de nuevo la aplicación. En el login se usa ese correo y contraseña.

No reutilices la contraseña local que se usaba antes; al estar publicada en el código debe considerarse comprometida.

## Despliegue en Vercel

1. Conecta el repositorio a un proyecto de Vercel.
2. En el dashboard de Vercel, agrega las variables de entorno anteriores.
3. Usa el comando de build por defecto de Vite:

```bash
npm run build
```

4. El proyecto ya incluye `vercel.json` para manejar rutas SPA y redirigir todas las URLs a `index.html`.

## Reglas de Firestore

El archivo `firestore.rules` permite leer y escribir las colecciones de la aplicación solo a usuarios autenticados. Para publicar las reglas en el proyecto Firebase configurado:

```bash
npx firebase-tools deploy --only firestore:rules --project arriendo-2d45d
```

Ejecuta el comando desde una terminal con Firebase CLI autenticado en una cuenta con permisos para administrar las reglas del proyecto. No uses reglas públicas para solucionar errores de permisos.

## Desarrollo local

```bash
npm install
npm run dev
```

## Build local

```bash
npm run build
```
