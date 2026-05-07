-- ============================================================
-- ELEVAGES CRM — Tables Supabase (AGENTARO)
-- Coller dans : https://supabase.com/dashboard/project/slpxwhfbvziihcmyuvot/sql/new
-- ============================================================

-- Table principale : les 8132 élevages
CREATE TABLE IF NOT EXISTS elevages (
    id BIGSERIAL PRIMARY KEY,
    nom TEXT NOT NULL,
    adresse TEXT,
    code_postal TEXT,
    ville TEXT,
    departement TEXT,
    telephone TEXT,
    email TEXT,
    forme_juridique TEXT,
    dirigeant TEXT,
    immatriculation TEXT,
    annee_ca TEXT,
    ca TEXT,
    resultat TEXT,
    effectif TEXT,
    naf TEXT,
    siret TEXT,
    effectif_min TEXT,
    effectif_max TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index pour les recherches fréquentes
CREATE INDEX IF NOT EXISTS idx_elevages_departement ON elevages(departement);
CREATE INDEX IF NOT EXISTS idx_elevages_naf ON elevages(naf);
CREATE INDEX IF NOT EXISTS idx_elevages_siret ON elevages(siret);
CREATE INDEX IF NOT EXISTS idx_elevages_ville ON elevages(ville);
CREATE INDEX IF NOT EXISTS idx_elevages_email ON elevages(email);

-- Table CRM : statuts, notes, assignations
CREATE TABLE IF NOT EXISTS crm_elevages (
    id BIGINT PRIMARY KEY REFERENCES elevages(id) ON DELETE CASCADE,
    status TEXT DEFAULT 'nouveau',
    notes TEXT DEFAULT '',
    actions JSONB DEFAULT '[]'::jsonb,
    assigned_to TEXT,
    assigned_to_secondary TEXT,
    travel_time_min INTEGER,
    tags TEXT[] DEFAULT '{}',
    last_contact_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index CRM
CREATE INDEX IF NOT EXISTS idx_crm_elevages_status ON crm_elevages(status);
CREATE INDEX IF NOT EXISTS idx_crm_elevages_assigned ON crm_elevages(assigned_to);

-- RLS : autoriser l'accès anon pour le frontend
ALTER TABLE elevages ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_elevages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "elevages_read_all" ON elevages FOR SELECT USING (true);
CREATE POLICY "crm_elevages_read_all" ON crm_elevages FOR SELECT USING (true);
CREATE POLICY "crm_elevages_insert_all" ON crm_elevages FOR INSERT WITH CHECK (true);
CREATE POLICY "crm_elevages_update_all" ON crm_elevages FOR UPDATE USING (true);
CREATE POLICY "crm_elevages_delete_all" ON crm_elevages FOR DELETE USING (true);

-- Trigger pour mettre à jour updated_at automatiquement
CREATE OR REPLACE FUNCTION update_crm_elevages_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_crm_elevages_updated_at
    BEFORE UPDATE ON crm_elevages
    FOR EACH ROW
    EXECUTE FUNCTION update_crm_elevages_updated_at();
