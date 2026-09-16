-- =====================================================================================
-- 1000x1 EXPERIMENT - MIGRATION 001
-- Aplica correcciones al schema inicial sin cambiar la arquitectura.
-- Ejecutar en el SQL Editor de Supabase DESPUÉS de haber aplicado schema.sql
-- =====================================================================================


-- =====================================================================================
-- CORRECCIÓN 1: Estado 'disputed' en payments
-- El comentario original omitía 'disputed' como estado válido.
-- Esto no es un cambio de columna (sigue siendo VARCHAR), pero documentamos
-- los estados válidos y agregamos un CHECK para que la BD los valide.
-- =====================================================================================
ALTER TABLE payments
    ADD CONSTRAINT payments_status_check
    CHECK (status IN ('pending', 'completed', 'failed', 'refunded', 'disputed'));


-- =====================================================================================
-- CORRECCIÓN 2: CHECK amount_cents >= 100
-- Garantiza en la BD que nunca se registre un pago inferior a $1.00 USD.
-- La lógica de negocio en el backend ya lo valida, pero la BD es el último
-- guardia. El valor 100 representa $1.00 en centavos.
-- =====================================================================================
ALTER TABLE payments
    ADD CONSTRAINT payments_amount_minimum_check
    CHECK (amount_cents >= 100);


-- =====================================================================================
-- CORRECCIÓN 3: provider_order_id indexado en payments
-- El webhook busca por provider_order_id para vincular la captura con el
-- registro pending. Sin índice, cada webhook hace un full table scan.
-- =====================================================================================
CREATE INDEX IF NOT EXISTS idx_payments_provider_order_id
    ON payments (provider_order_id);


-- =====================================================================================
-- CORRECCIÓN 4: updated_at automático en payments
-- La columna updated_at existe pero no se actualiza sola.
-- Creamos un trigger para que se actualice automáticamente en cada UPDATE.
-- =====================================================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER payments_updated_at
    BEFORE UPDATE ON payments
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();


-- =====================================================================================
-- CORRECCIÓN 5: Idempotencia de webhook - estado 'skipped' permitido
-- El webhook code marca eventos como 'skipped' (evento ignorado por tipo)
-- pero el schema original solo documentaba 'pending', 'processed', 'failed'.
-- Agregamos CHECK explícito para los estados válidos del webhook.
-- =====================================================================================
ALTER TABLE webhook_events
    ADD CONSTRAINT webhook_events_status_check
    CHECK (processing_status IN ('pending', 'processed', 'failed', 'skipped'));


-- =====================================================================================
-- CORRECCIÓN 6: Validación de experiment_stats - participant_count no negativo
-- El contador nunca debería ser negativo. Lo garantizamos a nivel de BD.
-- =====================================================================================
ALTER TABLE experiment_stats
    ADD CONSTRAINT experiment_stats_count_non_negative
    CHECK (participant_count >= 0);


-- =====================================================================================
-- CORRECCIÓN 7: RPC mejorada - maneja identity_hash ya existente explícitamente
-- La versión original lanzaba una excepción genérica si el identity_hash
-- ya existía (UNIQUE violation), dejando el manejo de ese caso al caller.
-- 
-- Esta versión retorna NULL de forma controlada cuando el participante ya existe,
-- en lugar de lanzar una excepción. Esto permite al webhook distinguir entre:
--   - NULL  → participante ya existe (pago recurrente, no suma al contador)
--   - UUID  → nuevo participante creado exitosamente
--
-- El rollback del contador sigue garantizado: si el INSERT falla por
-- cualquier razón distinta a duplicado, la excepción sube y hace rollback
-- de toda la transacción incluyendo el UPDATE del contador.
-- =====================================================================================
CREATE OR REPLACE FUNCTION register_new_participant(
    p_identity_hash VARCHAR,
    p_first_campaign_source VARCHAR,
    p_first_referral_source VARCHAR,
    p_first_touch_source VARCHAR,
    p_last_touch_source VARCHAR
) RETURNS UUID AS $$
DECLARE
    v_next_number INT;
    v_participant_id UUID;
BEGIN
    -- Verificar si ya existe antes de tocar el contador
    SELECT id INTO v_participant_id
    FROM participants
    WHERE identity_hash = p_identity_hash
    LIMIT 1;

    -- Si ya existe, retornar NULL inmediatamente (sin modificar el contador)
    IF v_participant_id IS NOT NULL THEN
        RETURN NULL;
    END IF;

    -- 1. Bloquea y actualiza atómicamente el contador
    UPDATE experiment_stats
    SET participant_count = participant_count + 1
    WHERE id = 1
    RETURNING participant_count INTO v_next_number;

    -- 2. Crea el participante con el número obtenido.
    -- Si por race condition otro proceso creó el mismo identity_hash
    -- entre el SELECT y el INSERT, el UNIQUE constraint lanzará
    -- una excepción que hace ROLLBACK de toda la transacción
    -- (incluyendo el UPDATE del contador). Cero huecos garantizados.
    INSERT INTO participants (
        participant_number,
        identity_hash,
        first_campaign_source,
        first_referral_source,
        first_touch_source,
        last_touch_source
    ) VALUES (
        v_next_number,
        p_identity_hash,
        p_first_campaign_source,
        p_first_referral_source,
        p_first_touch_source,
        p_last_touch_source
    ) RETURNING id INTO v_participant_id;

    -- 3. Retorna el UUID del nuevo participante
    RETURN v_participant_id;
END;
$$ LANGUAGE plpgsql;
