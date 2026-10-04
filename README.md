# Arriendo alquileres

Aplicación web en React + TypeScript + Vite para gestionar alquileres, contratos y caja.

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

## Despliegue en Vercel

1. Conecta el repositorio a un proyecto de Vercel.
2. En el dashboard de Vercel, agrega las variables de entorno anteriores.
3. Usa el comando de build por defecto de Vite:

```bash
npm run build
```

4. El proyecto ya incluye `vercel.json` para manejar rutas SPA y redirigir todas las URLs a `index.html`.

## Desarrollo local

```bash
npm install
npm run dev
```

## Build local

```bash
npm run build
```
