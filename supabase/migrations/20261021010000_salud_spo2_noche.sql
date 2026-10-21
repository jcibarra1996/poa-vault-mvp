-- Oxígeno minuto a minuto durante la noche principal: { inicio, paso, valores[], promedio, minimo, bajo90, caidas, indice }
alter table public.salud_dias add column if not exists spo2_noche jsonb;
