-- =====================================================================================
-- 1000x1 EXPERIMENT - DATABASE SCHEMA
-- Execute this script in your Supabase SQL Editor.
-- =====================================================================================

-- 1. WEBHOOK EVENTS (Idempotencia)
-- Evita procesar el mismo pago de PayPal dos veces
CREATE TABLE webhook_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider VARCHAR(50) NOT NULL, -- e.g., 'paypal'
    provider_event_id VARCHAR(255) NOT NULL,
    event_type VARCHAR(100) NOT NULL,
    received_at TIMESTAMPTZ DEFAULT NOW(),
    processed_at TIMESTAMPTZ,
    processing_status VARCHAR(50) DEFAULT 'pending', -- 'pending', 'processed', 'failed'
    payload_hash VARCHAR(255),
    UNIQUE(provider, provider_event_id)
);

-- 2. EXPERIMENT STATS (Contador Oficial Transaccional)
-- Garantiza que no haya huecos en la numeración al hacer rollback
CREATE TABLE experiment_stats (
    id INT PRIMARY KEY DEFAULT 1,
    participant_count INT NOT NULL DEFAULT 0,
    CONSTRAINT single_row CHECK (id = 1) -- Asegura que solo exista una fila
);

-- Inicializa el contador
INSERT INTO experiment_stats (id, participant_count) VALUES (1, 0);

-- 3. PARTICIPANTS (Identidad del Usuario)
CREATE TABLE participants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    participant_number INT NOT NULL UNIQUE,
    identity_hash VARCHAR(255) NOT NULL UNIQUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    first_campaign_source VARCHAR(255),
    first_referral_source VARCHAR(255),
    first_touch_source VARCHAR(255),
    last_touch_source VARCHAR(255)
);

-- 4. PAYMENTS (Transacciones)
CREATE TABLE payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    participant_id UUID REFERENCES participants(id),
    provider VARCHAR(50) NOT NULL,
    provider_transaction_id VARCHAR(255) NOT NULL UNIQUE,
    provider_order_id VARCHAR(255),
    amount_cents INT NOT NULL,
    currency VARCHAR(10) NOT NULL DEFAULT 'USD',
    status VARCHAR(50) NOT NULL, -- 'pending', 'completed', 'failed', 'refunded'
    campaign_source VARCHAR(255),
    referral_source VARCHAR(255),
    first_touch_source VARCHAR(255),
    last_touch_source VARCHAR(255),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================================================
-- FUNCIÓN TRANSACCIONAL (RPC) PARA CREAR PARTICIPANTES SIN HUECOS
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
    -- 1. Bloquea y actualiza atómicamente el contador
    UPDATE experiment_stats 
    SET participant_count = participant_count + 1 
    WHERE id = 1 
    RETURNING participant_count INTO v_next_number;

    -- 2. Crea el participante con el número obtenido
    -- Si el identity_hash ya existe, esto fallará por el UNIQUE constraint,
    -- lo cual hace ROLLBACK de TODA la transacción (incluyendo el contador).
    -- Así garantizamos CERO HUECOS.
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
