set -uo pipefail
B=cepi-icloud-648395693289
R=us-east-2

echo "== create-bucket"
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

echo "== instance profile del EC2 de prod"
aws ec2 describe-instances --region "$R" --instance-ids i-0d28fe3302bae7a23 \
  --query 'Reservations[].Instances[].{perfil:IamInstanceProfile.Arn,estado:State.Name}' --output json
