-- El análisis diario es a las 6:00 (CDMX, UTC-6): la sincronización de la mañana pasa a las 5:30 para que llegue antes.
select cron.unschedule('salud-fitbit-sync');
select cron.schedule('salud-fitbit-sync-manana', '30 11 * * *', $$select call_edge_function('fitbit-sync')$$);
select cron.schedule('salud-fitbit-sync-noche', '40 3 * * *', $$select call_edge_function('fitbit-sync')$$);
