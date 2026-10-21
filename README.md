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
- **Medir en vivo** (Bluetooth): con "Compartir frecuencia cardiaca" activo en la app Google Health, el Fitbit Air transmite con el perfil estándar de ritmo cardiaco (0x180D). La página lo lee con Web Bluetooth (Chrome en Android o computadora; Safari en iPhone no lo soporta) y, si llegan intervalos RR, calcula VFC (RMSSD) y estima la FR por arritmia sinusal respiratoria (`fitbit-air/vivo.js`).
- **SpO2 nocturna**: la sincronización trae `oxygen-saturation` minuto a minuto y la asigna a la noche principal (`salud_dias.spo2_noche`: promedio, mínimo, minutos debajo de 90% y caídas de ≥3 puntos por hora).
- **Medir** (estilo "momento"): el usuario se queda quieto 1, 3 o 5 min con una guía de respiración; al terminar, cuando la app Google Health sincroniza, la función trae del Fitbit las muestras de pulso de esa ventana (FC promedio, mínima, máxima y VFC si el reloj la registró) y se guardan en `salud_mediciones`. El Fitbit Air no transmite en vivo por la API y solo calcula la frecuencia respiratoria durante el sueño, así que la FR que se muestra es la de la última noche.

### Puesta en marcha (una vez)

1. **Migración**: aplica `supabase/migrations/20261020000000_salud_fitbit.sql`.
2. **Google Cloud**: habilita la *Google Health API*, crea un cliente OAuth tipo *Web application* y registra como redirect URI la URL de la función: `https://uzyzeaoliwzkmxiaudso.supabase.co/functions/v1/fitbit-sync`. En la pantalla de consentimiento agrega a los usuarios como *test users*. Mientras la app esté en modo *Testing*, Google vence el refresh token cada 7 días; publícala para evitarlo (sin verificación aplica un tope de 100 usuarios).
3. **Secretos de la función** (Supabase → Edge Functions → Secrets): `GOOGLE_CLIENT_SECRET`. El client ID del proyecto está en el código (no es secreto); `GOOGLE_CLIENT_ID` solo hace falta para usar otro cliente. Para revisar la configuración sin exponer el secreto: `GET /functions/v1/fitbit-sync?diagnostico`. Opcionales: `SALUD_APP_URL` (por default regresa al sitio desde donde se pidió conectar), `SALUD_STATE_SECRET` (por default firma con la service role key) y `SALUD_CRON_SECRET`.
4. **Desplegar** sin verificación de JWT (Google regresa a la función sin sesión de Supabase; la función valida al usuario por su cuenta). Ya está desplegada en `iq-taskforge`; para volver a hacerlo:
   ```sh
   supabase functions deploy fitbit-sync --no-verify-jwt
   ```
5. En el teléfono, la app **Google Health** debe estar vinculada a la cuenta de Google; si no, la API responde `ACCOUNT_NOT_LINKED`.

La sincronización corre sola dos veces al día (5:30 y 21:40, hora de CDMX) con las tareas `salud-fitbit-sync-manana` y `salud-fitbit-sync-noche` de pg_cron, que llama a la función con `call_edge_function` (la función acepta el mismo `app_settings.edge_function_secret` que usan las demás tareas del proyecto). La app también sincroniza al abrirla si pasaron más de 2 horas. En **Tabla → Descargar CSV** se baja un renglón por día para analizar en Excel o Sheets.

### Pruebas

```sh
node --test tests/*.test.*
```
