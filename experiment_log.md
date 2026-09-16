# Experiment Log

*Este documento registra los aprendizajes, cambios y métricas diarias del experimento.*

## DAY 0 - FASE 3: Setup Estructural
- **Arquitectura:** Inicialización del proyecto Next.js puro (App Router).
- **Herramientas:** TypeScript y ESLint configurados (vía `eslint-config-next` para mantener estándares).
- **Entorno:** Creado `.env.example` con la separación lógica de Supabase (Source of Truth), PayPal, PostHog y Seguridad (Hashing salt).
- **Privacidad:** Asegurado que el `.env.local` y los logs queden fuera de control de versiones vía `.gitignore`.
- **Decisión:** PayPal como único proveedor de pagos inicial. La arquitectura abstraerá a PayPal para no mezclar lógica.
