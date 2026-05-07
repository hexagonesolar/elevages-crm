#!/usr/bin/env python3
"""
Import des 8132 élevages depuis le XLS vers Supabase.
Usage: python3 02_import_data.py
"""

import xlrd
import requests
import json
import time
import sys
import re

SUPABASE_URL = "https://slpxwhfbvziihcmyuvot.supabase.co"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNscHh3aGZidnppaWhjbXl1dm90Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDEyNTUwNjEsImV4cCI6MjA1NjgzMTA2MX0.KdIGP1YwtSW-loZ4gw99pj6QIfwiSD7FCUDMHyG1aFs"
XLS_PATH = "/tmp/ELEVAGE D'ANIMAUX.xls"
BATCH_SIZE = 200


def clean_phone(val):
    """Nettoie un numéro de téléphone"""
    if not val:
        return ""
    # Convertir le float en string
    s = str(int(val)) if isinstance(val, float) else str(val)
    s = s.strip()
    # Ajouter le 0 devant si nécessaire (numéro français)
    if len(s) == 9 and s[0] in "1234567":
        s = "0" + s
    # Formater avec des espaces
    if len(s) == 10:
        s = " ".join([s[i:i+2] for i in range(0, 10, 2)])
    return s


def clean_cp(val):
    """Nettoie le code postal"""
    if not val:
        return ""
    s = str(int(val)) if isinstance(val, float) else str(val)
    return s.zfill(5)


def clean_siret(val):
    """Nettoie le SIRET"""
    if not val:
        return ""
    s = str(int(val)) if isinstance(val, float) else str(val)
    return s.strip()


def clean_text(val):
    """Nettoie un champ texte"""
    if val is None:
        return ""
    s = str(val).strip()
    if s == "0" or s == "0.0":
        return ""
    return s


def parse_xls():
    """Parse le fichier XLS et retourne les données nettoyées"""
    wb = xlrd.open_workbook(XLS_PATH)
    sh = wb.sheet_by_index(0)
    
    records = []
    for r in range(1, sh.nrows):
        nom = clean_text(sh.cell_value(r, 0))
        if not nom:
            continue
            
        cp = clean_cp(sh.cell_value(r, 2))
        dept = cp[:2] if len(cp) >= 2 else ""
        # Gestion DOM-TOM
        if cp.startswith("97"):
            dept = cp[:3]
        
        naf_raw = clean_text(sh.cell_value(r, 13))
        # Normaliser le NAF : "0147Z" ou "147.0" → "01.47Z"
        naf = ""
        if naf_raw:
            naf_clean = re.sub(r'[^0-9A-Z]', '', naf_raw.upper())
            if len(naf_clean) == 5 and naf_clean[4].isalpha():
                naf = naf_clean[:2] + "." + naf_clean[2:]
            elif len(naf_clean) == 4 and naf_clean[3].isalpha():
                naf = "0" + naf_clean[:1] + "." + naf_clean[1:]
            else:
                naf = naf_raw

        record = {
            "nom": nom,
            "adresse": clean_text(sh.cell_value(r, 1)),
            "code_postal": cp,
            "ville": clean_text(sh.cell_value(r, 3)),
            "departement": dept,
            "telephone": clean_phone(sh.cell_value(r, 4)),
            "email": clean_text(sh.cell_value(r, 5)),
            "forme_juridique": clean_text(sh.cell_value(r, 6)),
            "dirigeant": clean_text(sh.cell_value(r, 7)),
            "immatriculation": clean_text(sh.cell_value(r, 8)),
            "annee_ca": clean_text(sh.cell_value(r, 9)),
            "ca": clean_text(sh.cell_value(r, 10)),
            "resultat": clean_text(sh.cell_value(r, 11)),
            "effectif": clean_text(sh.cell_value(r, 12)),
            "naf": naf,
            "siret": clean_siret(sh.cell_value(r, 14)),
            "effectif_min": clean_text(sh.cell_value(r, 15)),
            "effectif_max": clean_text(sh.cell_value(r, 16)),
        }
        records.append(record)
    
    return records


def insert_batch(records):
    """Insère un batch dans Supabase"""
    url = f"{SUPABASE_URL}/rest/v1/elevages"
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal"
    }
    
    resp = requests.post(url, headers=headers, json=records, timeout=30)
    if resp.status_code not in (200, 201):
        print(f"  ERREUR: HTTP {resp.status_code} — {resp.text[:200]}")
        return False
    return True


def create_crm_entries():
    """Crée les entrées CRM pour tous les élevages"""
    print("\nCréation des entrées CRM...")
    
    # Récupérer tous les IDs
    url = f"{SUPABASE_URL}/rest/v1/elevages?select=id&order=id"
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
    }
    
    all_ids = []
    offset = 0
    while True:
        resp = requests.get(f"{url}&offset={offset}&limit=1000", headers=headers, timeout=30)
        data = resp.json()
        if not data:
            break
        all_ids.extend([d["id"] for d in data])
        offset += 1000
    
    print(f"  {len(all_ids)} élevages trouvés")
    
    # Insérer les entrées CRM par batch
    crm_url = f"{SUPABASE_URL}/rest/v1/crm_elevages"
    crm_headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal"
    }
    
    inserted = 0
    for i in range(0, len(all_ids), BATCH_SIZE):
        batch = [{"id": id_} for id_ in all_ids[i:i+BATCH_SIZE]]
        resp = requests.post(crm_url, headers=crm_headers, json=batch, timeout=30)
        if resp.status_code in (200, 201):
            inserted += len(batch)
            if inserted % 1000 == 0:
                print(f"  CRM: {inserted}/{len(all_ids)}")
        else:
            print(f"  CRM ERREUR: HTTP {resp.status_code} — {resp.text[:200]}")
        time.sleep(0.1)
    
    print(f"  CRM: {inserted} entrées créées")
    return inserted


def main():
    print("=" * 60)
    print("IMPORT ÉLEVAGES → SUPABASE")
    print("=" * 60)
    
    # 1. Parser le XLS
    print("\n1. Parsing du fichier XLS...")
    records = parse_xls()
    print(f"   {len(records)} élevages parsés")
    
    # Stats
    with_email = sum(1 for r in records if r["email"])
    with_phone = sum(1 for r in records if r["telephone"])
    with_siret = sum(1 for r in records if r["siret"])
    print(f"   Avec email: {with_email}")
    print(f"   Avec téléphone: {with_phone}")
    print(f"   Avec SIRET: {with_siret}")
    
    # 2. Insérer par batch
    print(f"\n2. Insertion dans Supabase ({BATCH_SIZE} par batch)...")
    inserted = 0
    errors = 0
    
    for i in range(0, len(records), BATCH_SIZE):
        batch = records[i:i+BATCH_SIZE]
        if insert_batch(batch):
            inserted += len(batch)
        else:
            errors += 1
        
        if inserted % 1000 == 0 or i + BATCH_SIZE >= len(records):
            print(f"   {inserted}/{len(records)} insérés ({errors} erreurs)")
        
        time.sleep(0.2)
    
    print(f"\n   Total inséré: {inserted}")
    
    # 3. Créer les entrées CRM
    crm_count = create_crm_entries()
    
    # 4. Résumé
    print("\n" + "=" * 60)
    print("IMPORT TERMINÉ")
    print(f"  Élevages: {inserted}")
    print(f"  CRM entries: {crm_count}")
    print(f"  Erreurs: {errors}")
    print("=" * 60)
    
    return 0 if errors == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
