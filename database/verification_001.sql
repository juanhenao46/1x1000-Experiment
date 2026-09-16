-- =====================================================================================
-- 1000x1 EXPERIMENT - VERIFICATION 001
-- Verifica que migration_001 se aplicó correctamente.
-- Ejecutar en el SQL Editor de Supabase. Solo lectura, no modifica nada.
-- =====================================================================================

-- -------------------------------------------------------
-- VERIFICACIÓN 1: CHECKs sobre tabla payments
-- Esperado: 2 filas con los nombres de las restricciones
-- -------------------------------------------------------
SELECT
    constraint_name,
    constraint_type
FROM information_schema.table_constraints
WHERE table_name = 'payments'
  AND constraint_type = 'CHECK'
  AND constraint_name IN ('payments_status_check', 'payments_amount_minimum_check');
-- RESULTADO ESPERADO: 2 filas

-- -------------------------------------------------------
-- VERIFICACIÓN 2: Índice sobre payments.provider_order_id
-- Esperado: 1 fila con el nombre del índice
-- -------------------------------------------------------
SELECT indexname, tablename
FROM pg_indexes
WHERE tablename = 'payments'
  AND indexname = 'idx_payments_provider_order_id';
-- RESULTADO ESPERADO: 1 fila

-- -------------------------------------------------------
-- VERIFICACIÓN 3: Trigger updated_at sobre payments
-- Esperado: 1 fila con el nombre del trigger
-- -------------------------------------------------------
SELECT trigger_name, event_manipulation, event_object_table
FROM information_schema.triggers
WHERE trigger_name = 'payments_updated_at'
  AND event_object_table = 'payments';
-- RESULTADO ESPERADO: 1 fila

-- -------------------------------------------------------
-- VERIFICACIÓN 4: CHECK sobre webhook_events.processing_status
-- Esperado: 1 fila con el nombre de la restricción
-- -------------------------------------------------------
SELECT constraint_name, constraint_type
FROM information_schema.table_constraints
WHERE table_name = 'webhook_events'
  AND constraint_type = 'CHECK'
  AND constraint_name = 'webhook_events_status_check';
-- RESULTADO ESPERADO: 1 fila

-- -------------------------------------------------------
-- VERIFICACIÓN 5: CHECK sobre experiment_stats.participant_count
-- Esperado: 1 fila con el nombre de la restricción
-- -------------------------------------------------------
SELECT constraint_name, constraint_type
FROM information_schema.table_constraints
WHERE table_name = 'experiment_stats'
  AND constraint_type = 'CHECK'
  AND constraint_name = 'experiment_stats_count_non_negative';
-- RESULTADO ESPERADO: 1 fila

-- -------------------------------------------------------
-- VERIFICACIÓN 6: Función RPC register_new_participant existe
-- Esperado: 1 fila con el nombre de la función
-- -------------------------------------------------------
SELECT routine_name, routine_type
FROM information_schema.routines
WHERE routine_name = 'register_new_participant'
  AND routine_schema = 'public';
-- RESULTADO ESPERADO: 1 fila

-- -------------------------------------------------------
-- VERIFICACIÓN 7 (funcional): La RPC retorna NULL para un
-- identity_hash ya existente, sin tocar el contador.
-- Solo ejecutar si ya tienes participantes de prueba,
-- reemplaza el valor del hash por uno real o por cualquier
-- string que YA exista en la tabla participants.
-- -------------------------------------------------------
-- SELECT register_new_participant(
--     'hash_que_ya_existe',
--     null, null, null, null
-- );
-- RESULTADO ESPERADO: NULL (sin cambiar participant_count)
