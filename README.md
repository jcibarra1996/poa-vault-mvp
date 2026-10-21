# Ibarra Quezada

Dos apps estáticas (sin build) en el mismo despliegue de Vercel y el mismo proyecto de Supabase (`iq-taskforge`). El acceso es para los correos de la tabla `crm_usuarios`.

| Ruta | App |
|---|---|
| `/` | **Prospección**: CRM de socios contadores, clientes PyME, seguimientos, referidos y plantillas (`index.html`, `app.js`). |
| `/fitbit-air/` | **Salud**: panel estilo Oura (Recuperación, Sueño, Actividad) con los datos del Google Fitbit Air (`fitbit-air/`). |

Para autorizar otro correo:

```sql
insert into public.crm_usuarios (email) values ('otro@correo.com');
```

## Salud · Fitbit Air

```
Fitbit Air ─▶ app Google Health ─▶ Google Health API v4 ─▶ Edge Function fitbit-sync ─▶ salud_dias ─▶ /fitbit-air/
```

- `supabase/functions/fitbit-sync/`: OAuth con Google y sincronización. Guarda un renglón por día en `salud_dias` (pasos, minutos en zona, FC en reposo, VFC, SpO2, respiración, temperatura y la noche de sueño con su hipnograma). Los tokens de Google viven en `salud_conexion`, que no tiene políticas RLS: solo la función los lee.
- `fitbit-air/scores.js`: calcula las puntuaciones en el navegador contra la línea base personal de 30 días. No son los algoritmos de Oura ni de Google; los pesos están en el archivo.
- Cada usuario conecta su propia cuenta y solo ve sus datos (`salud_dias` filtra por el correo de la sesión).

### Puesta en marcha (una vez)

1. **Migración**: aplica `supabase/migrations/20261020000000_salud_fitbit.sql`.
2. **Google Cloud**: habilita la *Google Health API*, crea un cliente OAuth tipo *Web application* y registra como redirect URI la URL de la función: `https://uzyzeaoliwzkmxiaudso.supabase.co/functions/v1/fitbit-sync`. En la pantalla de consentimiento agrega a los usuarios como *test users*. Mientras la app esté en modo *Testing*, Google vence el refresh token cada 7 días; publícala para evitarlo (sin verificación aplica un tope de 100 usuarios).
3. **Secretos de la función** (Supabase → Edge Functions → Secrets): `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET`. Opcionales: `SALUD_APP_URL` (por default regresa al sitio desde donde se pidió conectar), `SALUD_STATE_SECRET` (por default firma con la service role key) y `SALUD_CRON_SECRET`.
4. **Desplegar** sin verificación de JWT (Google regresa a la función sin sesión de Supabase; la función valida al usuario por su cuenta). Ya está desplegada en `iq-taskforge`; para volver a hacerlo:
   ```sh
   supabase functions deploy fitbit-sync --no-verify-jwt
   ```
5. En el teléfono, la app **Google Health** debe estar vinculada a la cuenta de Google; si no, la API responde `ACCOUNT_NOT_LINKED`.

La app sincroniza sola al abrirla si pasaron más de 2 horas. Para sincronizar en segundo plano, define `SALUD_CRON_SECRET` y prográmalo con `pg_cron` + `pg_net`:

```sql
select cron.schedule('salud-fitbit', '17 */3 * * *', $$
  select net.http_post(
    url := 'https://uzyzeaoliwzkmxiaudso.supabase.co/functions/v1/fitbit-sync',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', '<SALUD_CRON_SECRET>'),
    body := '{}'::jsonb);
$$);
```

### Pruebas

```sh
node --test tests/*.test.*
```
