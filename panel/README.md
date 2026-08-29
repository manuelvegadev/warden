# panel

UI del proyecto (Next.js 15, App Router, Tailwind v4, shadcn/ui). Se conecta al daemon `wardend` (ver `../docs/api.md`).

```bash
cp .env.example .env.local
npm install
npx shadcn@latest init   # una vez, para configurar components.json
npm run dev              # http://localhost:3000
```

## Despliegue con Dokploy
1. Crear aplicación → tipo **Dockerfile**, repo este, *Build path* `panel/`, *Dockerfile path* `panel/Dockerfile`.
2. Build arg / env: `NEXT_PUBLIC_WARDEND_URL=https://wardend.tudominio.com`.
3. Dominio con HTTPS (Traefik de Dokploy).
4. En el daemon: `WARDEND_ALLOWED_ORIGINS=https://panel.tudominio.com`.
