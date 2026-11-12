# Arriendo alquileres

Aplicación web en React + TypeScript + Vite para gestionar alquileres, contratos y caja.

La caja permanece abierta al cambiar el día; se cierra únicamente cuando se usa la acción manual **Cerrar caja**. Los movimientos posteriores a medianoche siguen asociados a esa misma caja. Las cajas de días anteriores que quedaron abiertas con versiones antiguas no se reactivan automáticamente.

Los nombres de clientes se escriben y se guardan en mayúsculas en contratos, ventas y en el directorio de clientes.

Al registrar un contrato, la seña abonada es obligatoria; si no hubo seña se debe ingresar `0`.

Las ventas aceptan pagos parciales. El recibo registra el importe recibido y el saldo pendiente; cada abono posterior queda asociado a la misma venta, genera un recibo propio y se contabiliza en caja solo en la fecha y caja en que se cobra. Los recibos llevan el mismo membrete y teléfono de contacto que el contrato, y usan un formato compacto de 21 × 14 cm para imprimir en media hoja A4. Los saldos se pueden buscar por código de recibo, nombre o CI desde **Saldos pendientes**. Las ventas antiguas, sin historial de pagos, se mantienen como ventas totalmente pagadas.

El PDF incluye el membrete sin fondo en la esquina superior derecha del contrato y en la copia del cliente. Tanto los contratos como los recibos se abren en una vista previa en la aplicación; desde allí puedes imprimir, abrir o descargar el PDF. Al imprimir un recibo, selecciona papel A4 y tamaño real para conservar sus dimensiones de 21 × 14 cm.

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
