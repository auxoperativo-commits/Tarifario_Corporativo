# Tarifario — Salud Renal

Sistema web interno para comparar costos de envío de insumos médicos entre cualquier par de puntos de Argentina. Funciona como un comparador de vuelos: mostrás la ruta, la cantidad y el tipo de carga, y el sistema devuelve todas las opciones de transporte ordenadas por la mejor relación precio/tiempo.

---

## Stack

| Capa | Tecnología |
|---|---|
| Frontend + Backend | Next.js 14 (App Router) + TypeScript |
| Estilos | Tailwind CSS + shadcn/ui |
| Base de datos + Auth | Supabase (PostgreSQL) |
| Localidades AR | API Georef del gobierno argentino |
| Despliegue | Vercel (frontend) + Supabase (DB) |

---

## Requisitos previos

- **Node.js 18+** y **npm 9+**
- Una cuenta en [Supabase](https://supabase.com) (plan Free alcanza)
- Una cuenta en [Vercel](https://vercel.com) (plan Hobby alcanza)

---

## Configuración local

### 1. Clonar el repositorio

```bash
git clone <url-del-repo>
cd sistema_tarifario_saludRenal
npm install
```

### 2. Crear el proyecto en Supabase

1. Entrá a [app.supabase.com](https://app.supabase.com) → **New project**
2. Anotá la **URL del proyecto** y la **anon key** (Settings → API)

### 3. Crear las tablas

En el **SQL Editor** de Supabase ejecutá los siguientes scripts en orden:

1. `schema_tarifario.sql` — crea todas las tablas, índices, políticas RLS y datos de ejemplo
2. `supabase/migrations/00_create_perfil_trigger.sql` — crea el trigger que genera automáticamente un perfil de usuario al registrarse
3. `supabase/migrations/01_tarifas_pallet.sql`
4. `supabase/migrations/02_bulto_inicial_y_peritoneal.sql`
5. `supabase/migrations/03_contacto_transportes.sql` — agrega teléfono y correo a cada transporte

### Importar configuraciones desde Excel

Desde **Configuraciones → Importar configuración** se puede cargar un archivo `.xlsx`, `.xls` o `.csv` con estas columnas exactas:

| NOMBRE DE TRANSPORTE | ORIGEN | DESTINO | LOCALIDAD DESTINO | PRECIO X BULTO | PRECIO X PALLET |
|---|---|---|---|---:|---:|
| TRANSPORTE EJEMPLO | Tucumán | Buenos Aires | La Plata | 22000 | 99000 |

La localidad destino es opcional. El sistema intenta reconocerla con Georef ignorando mayúsculas y tildes; si necesita revisión, la vista previa permite buscar y seleccionar la localidad correcta o indicar “Sin localidad”. El origen solo usa la provincia. Las localidades, tiempos, camión, tags y tramos adicionales se pueden completar luego desde **Editar**. Se validan transportes registrados, precios, columnas obligatorias, rutas duplicadas y configuraciones ya existentes antes de importar.

### 4. Variables de entorno

Copiá el archivo de ejemplo y completá con tus credenciales:

```bash
cp .env.local.example .env.local
```

Editá `.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=https://tu-proyecto.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=tu-anon-key-aqui
```

Estas variables son las únicas necesarias. Ambas son públicas (se usan en el cliente del browser), la seguridad la maneja Supabase con Row Level Security.

### 5. Correr en desarrollo

```bash
npm run dev
```

Abrí [http://localhost:3000](http://localhost:3000). Te redirige a `/login`.

---

## Despliegue en Vercel

### 1. Subir el código a GitHub

```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin <tu-repo-github>
git push -u origin main
```

### 2. Importar en Vercel

1. [vercel.com/new](https://vercel.com/new) → **Import Git Repository**
2. Seleccioná el repositorio
3. Framework: **Next.js** (se detecta automáticamente)
4. En **Environment Variables** agregá:

| Variable | Valor |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | URL de tu proyecto Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Anon key de tu proyecto Supabase |

5. **Deploy** → en 2–3 minutos está publicado

### 3. Configurar la URL de callback en Supabase

Para que el magic link y la confirmación de email funcionen con el dominio de Vercel:

1. Supabase → **Authentication** → **URL Configuration**
2. **Site URL**: `https://tu-app.vercel.app`
3. **Redirect URLs**: agregar `https://tu-app.vercel.app/auth/callback`

---

## Primer uso

1. Accedé a la app → pantalla de login
2. Registrá el primer usuario con tu email. El rol por defecto es `operario`
3. Para asignar rol `admin`, ejecutá en el SQL Editor de Supabase:

```sql
update perfiles_usuario
set rol = 'admin'
where id = (select id from auth.users where email = 'tu@email.com');
```

4. Con rol `admin` podés cambiar roles desde la base de datos. Los roles disponibles son: `operario`, `compras`, `licitaciones`, `gerencia`, `admin`

---

## Módulos

### Envíos (home)
- Selector de origen y destino con autocompletado Georef
- Botón swap para intercambiar origen/destino
- Tipos de envío: Bultos / Pallets / Camión completo
- Resultados ordenados por Recomendado / Mejor precio / Más rápido
- Filtro por tags
- Desglose del cálculo desplegable por cada resultado
- Guardar en historial al elegir una opción

### Transportes
- CRUD de empresas de transporte
- Baja lógica (inactivo) y borrado físico con confirmación doble
- Link directo a las configuraciones del transporte

### Configuraciones de Envío
- Se accede filtrando por transporte
- Cada configuración define una ruta (provincia/localidad origen → provincia/localidad destino)
- Tramos escalonados de precio por bulto (dinámicos)
- Precio fijo por pallet y por camión completo
- Tags multi-select con creación al vuelo
- Prioridad: configuración con localidad sobre configuración solo por provincia

### Tags
- CRUD con selector de color (paleta preset + color libre)
- Las tags se usan para filtrar resultados en el módulo de Envíos

### Mi Perfil
- Editar nombre
- Configurar origen y destino predeterminados (se precargan en Envíos)

---

## Lógica de cálculo

### Precio por bultos
Se toma el precio del tramo con el mayor `desde_bulto` que sea `<= cantidad total` y se multiplica por todos los bultos. Ejemplo con tramos `{1 → $24.000, 10 → $10.587}` y 12 bultos: `12 × $10.587 = $127.044`.

Si el tramo desde bulto 1 está marcado como `es_valor_inicial`, el primer bulto conserva su precio y los restantes usan el tramo vigente según la cantidad total. Con los mismos tramos y 12 bultos: `$24.000 + 11 × $10.587 = $140.457`. Si la cantidad es menor que 10, todos conservan el precio inicial.

### Precio por pallets
`precio_pallet × cantidad`. Si no está cargado, la configuración no aparece en resultados de tipo pallet.

### Precio camión completo
`precio_camion_completo` fijo. Si no está cargado, no aparece en resultados de tipo camión.

### Ranking "Recomendado"
Se normalizan precio y tiempo promedio `(min+max)/2` a escala 0–1 y se calcula `score = 0.6 × precio_norm + 0.4 × tiempo_norm`. Menor score = mejor opción.

---

## Permisos por rol

| Módulo | operario | compras | licitaciones | gerencia | admin |
|---|---|---|---|---|---|
| Ver Envíos | ✓ | ✓ | ✓ | ✓ | ✓ |
| Editar Transportes | — | ✓ | ✓ | ✓ | ✓ |
| Editar Configuraciones | — | ✓ | ✓ | ✓ | ✓ |
| Editar Tags | — | ✓ | ✓ | ✓ | ✓ |
| Gestionar usuarios | — | — | — | — | ✓ |

---

## Estructura de archivos

```
├── app/
│   ├── (app)/                    # Rutas protegidas (requieren auth)
│   │   ├── layout.tsx            # Layout con AppShell + verificación de sesión
│   │   ├── envios/               # Módulo principal
│   │   ├── transportes/          # CRUD transportes
│   │   ├── configuraciones/      # CRUD configuraciones de envío
│   │   ├── tags/                 # CRUD tags
│   │   └── perfil/               # Perfil de usuario
│   ├── login/                    # Página de login/registro
│   ├── auth/callback/            # Callback OAuth/magic link
│   ├── actions/auth.ts           # Server action de logout
│   └── layout.tsx                # Root layout
├── components/
│   ├── ui/                       # Componentes shadcn/ui
│   ├── georef/                   # GeorefCombobox
│   └── layout/                   # AppShell, PageHeader, EmptyState
├── lib/
│   ├── supabase/                 # Clientes browser/server/middleware
│   ├── types/database.ts         # Tipos TypeScript del esquema
│   ├── calculos/envios.ts        # Motor de cálculo y ranking
│   └── context/UserContext.tsx   # Contexto de usuario autenticado
├── hooks/use-toast.ts            # Hook de notificaciones
├── middleware.ts                 # Protección de rutas
├── schema_tarifario.sql          # Esquema completo de la base de datos
└── supabase/migrations/          # Triggers adicionales
```

---

## Variables de entorno completas

| Variable | Descripción | Requerida |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | URL del proyecto Supabase | Sí |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Clave pública anónima de Supabase | Sí |

No hay variables de entorno privadas necesarias para el MVP. El acceso seguro a la base de datos está garantizado por las políticas Row Level Security de Supabase.

---

## Problemas frecuentes

**"Error: supabase URL is required"**
→ Falta el archivo `.env.local` o las variables no están cargadas. Reiniciá el servidor de desarrollo.

**El usuario puede registrarse pero no ingresar**
→ En Supabase → Authentication → Email → desactivar "Confirm email" para entornos sin servidor de correo configurado.

**Las configuraciones no aparecen en Envíos**
→ Verificá que estén marcadas como activas y que la ruta coincida exactamente con los nombres de provincia devueltos por la API Georef (case-insensitive, el sistema normaliza).

**Error 406 al cargar el perfil**
→ El trigger `on_auth_user_created` no está cargado. Ejecutá `supabase/migrations/00_create_perfil_trigger.sql` en el SQL Editor.
