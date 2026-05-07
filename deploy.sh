#!/bin/bash
# Deploy elevages-crm — preview → prod
set -e

PROD_DIR="/var/www/hexagroupe/elevages-crm"
BACKUP_DIR="/var/backups/hexagroupe-elevages-crm"
COMMIT_MSG="${1:-deploy}"

cd "$PROD_DIR"

# Backup
mkdir -p "$BACKUP_DIR"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
tar -czf "$BACKUP_DIR/elevages-crm-$TIMESTAMP.tar.gz" --exclude='.git' .
echo "✅ Backup: $BACKUP_DIR/elevages-crm-$TIMESTAMP.tar.gz"

# Commit & push
git add -A
git commit -m "$COMMIT_MSG" 2>/dev/null || echo "Nothing to commit"
git push origin master
echo "✅ Pushed to GitHub"

# Tag
git tag "prod-$TIMESTAMP"
git push origin "prod-$TIMESTAMP"
echo "✅ Tagged: prod-$TIMESTAMP"

# Permissions
chown -R jb:jb "$PROD_DIR"
echo "✅ Permissions OK"

echo "🎉 Deploy terminé"
