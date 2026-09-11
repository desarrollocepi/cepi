#!/usr/bin/env bash
# Bucket de media clínica + permiso de escritura para el EC2 (PAPER §23.4).
#
# Acá van los adjuntos de CEPI cuando STORAGE_BACKEND=s3: imágenes de
# histopatología, fotos de lesión, consentimientos. Datos de pacientes: bucket
# privado, cifrado, versionado y sin acceso sin TLS.
#
# Bucket aparte del espejo de iCloud a propósito: son dos ciclos de vida
# distintos y el de iCloud puede no usarse nunca.
#
# Correr desde la máquina de desarrollo con las credenciales de admin:
#   dotrino-env run --ns aws-admin -- bash scripts/icloud-s3/crear-bucket-media.sh
set -uo pipefail

DIR=$(cd "$(dirname "$0")" && pwd)
B=cepi-media-648395693289
R=us-east-2
ROL=cepi-icloud-sync   # el rol de instancia del EC2 (uno solo por instancia)

echo "== create-bucket $B"
aws s3api create-bucket --bucket "$B" --region "$R" \
  --create-bucket-configuration LocationConstraint="$R" 2>&1 | tail -2

echo "== block public access"
aws s3api put-public-access-block --bucket "$B" --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true && echo ok

echo "== versionado"
aws s3api put-bucket-versioning --bucket "$B" --versioning-configuration Status=Enabled && echo ok

echo "== cifrado SSE-S3"
aws s3api put-bucket-encryption --bucket "$B" --server-side-encryption-configuration \
  '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"},"BucketKeyEnabled":true}]}' && echo ok

echo "== lifecycle (aborta multipart colgados a los 7 dias)"
aws s3api put-bucket-lifecycle-configuration --bucket "$B" --lifecycle-configuration \
  '{"Rules":[{"ID":"abort-multipart","Status":"Enabled","Filter":{"Prefix":""},"AbortIncompleteMultipartUpload":{"DaysAfterInitiation":7}}]}' && echo ok

echo "== politica: solo TLS"
aws s3api put-bucket-policy --bucket "$B" --policy "{
  \"Version\":\"2012-10-17\",
  \"Statement\":[{
    \"Sid\":\"SoloTLS\",
    \"Effect\":\"Deny\",
    \"Principal\":\"*\",
    \"Action\":\"s3:*\",
    \"Resource\":[\"arn:aws:s3:::$B\",\"arn:aws:s3:::$B/*\"],
    \"Condition\":{\"Bool\":{\"aws:SecureTransport\":\"false\"}}
  }]
}" && echo ok

# El backend borra un adjunto cuando queda huérfano, así que acá SÍ hace falta
# DeleteObject — a diferencia del espejo de iCloud, que nunca borra. El versionado
# del bucket es la red: un delete deja la versión anterior recuperable.
echo "== policy del rol $ROL"
aws iam put-role-policy --role-name "$ROL" --policy-name adjuntos-media \
  --policy-document "{
    \"Version\": \"2012-10-17\",
    \"Statement\": [
      {
        \"Sid\": \"ListarElBucket\",
        \"Effect\": \"Allow\",
        \"Action\": [\"s3:ListBucket\", \"s3:ListBucketMultipartUploads\", \"s3:GetBucketLocation\"],
        \"Resource\": \"arn:aws:s3:::$B\"
      },
      {
        \"Sid\": \"AdjuntosBajoPrefijo\",
        \"Effect\": \"Allow\",
        \"Action\": [\"s3:PutObject\", \"s3:GetObject\", \"s3:DeleteObject\",
                    \"s3:AbortMultipartUpload\", \"s3:ListMultipartUploadParts\"],
        \"Resource\": \"arn:aws:s3:::$B/adjuntos/*\"
      }
    ]
  }" && echo ok

echo "== policies del rol"
aws iam list-role-policies --role-name "$ROL" --output json

cat <<FIN

Listo. Para activarlo en el EC2, en el entorno del backend:

  STORAGE_BACKEND=s3
  S3_BUCKET=$B
  S3_PREFIX=adjuntos
  AWS_REGION=$R

Sin STORAGE_BACKEND=s3 el backend sigue escribiendo a disco, y lo que ya esté en
disco se sigue leyendo igual (la lectura resuelve por existencia, no por config).
FIN
