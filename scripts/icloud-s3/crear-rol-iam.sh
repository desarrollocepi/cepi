#!/usr/bin/env bash
# Rol de instancia para que el EC2 de prod escriba en el bucket del espejo.
# Sin claves de acceso largas: el EC2 saca credenciales temporales del metadata.
#
# Correr desde la maquina de desarrollo con las credenciales de admin:
#   dotrino-env run --ns aws-admin -- bash scripts/icloud-s3/crear-rol-iam.sh
set -uo pipefail

DIR=$(cd "$(dirname "$0")" && pwd)
R=us-east-2
ROL=cepi-icloud-sync
PERFIL=cepi-icloud-sync
INST=i-0d28fe3302bae7a23

echo "== rol $ROL"
aws iam create-role --role-name "$ROL" \
  --description "Escribe el espejo de iCloud en s3://cepi-icloud-648395693289/inbox" \
  --assume-role-policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"ec2.amazonaws.com"},"Action":"sts:AssumeRole"}]}' \
  --query 'Role.Arn' --output text 2>&1 | tail -2

echo "== politica inline (listar el bucket, escribir solo en inbox/, sin borrar)"
aws iam put-role-policy --role-name "$ROL" --policy-name escribir-inbox \
  --policy-document "file://$DIR/iam-policy.json" && echo ok

echo "== instance profile"
aws iam create-instance-profile --instance-profile-name "$PERFIL" \
  --query 'InstanceProfile.Arn' --output text 2>&1 | tail -2
aws iam add-role-to-instance-profile --instance-profile-name "$PERFIL" --role-name "$ROL" 2>&1 | tail -2

echo "== asociar al EC2 (reintenta: IAM tarda en propagar)"
for i in 1 2 3 4 5 6; do
  if SALIDA=$(aws ec2 associate-iam-instance-profile --region "$R" --instance-id "$INST" \
                --iam-instance-profile Name="$PERFIL" --output text 2>&1); then
    echo "asociado en el intento $i"; break
  fi
  # Sin esto el error real queda invisible y el bucle parece un problema de
  # propagacion cuando en realidad puede ser falta de iam:PassRole.
  echo "intento $i fallo: $(echo "$SALIDA" | grep -v '^$' | tail -1)"
  sleep 5
done

echo "== estado de la asociacion"
aws ec2 describe-iam-instance-profile-associations --region "$R" \
  --filters Name=instance-id,Values="$INST" \
  --query 'IamInstanceProfileAssociations[].{perfil:IamInstanceProfile.Arn,estado:State}' --output json
