-- Sincroniza el Fitbit Air de todos los conectados dos veces al día (hora de CDMX, UTC-6): 7:40 y 21:40.
-- Usa call_edge_function, que ya autentica con app_settings.edge_function_secret como las demás tareas.
select cron.schedule('salud-fitbit-sync', '40 3,13 * * *', $$select call_edge_function('fitbit-sync')$$);
