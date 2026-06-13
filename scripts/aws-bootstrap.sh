#!/usr/bin/env bash
# One-time AWS setup: ECR repo + GitHub OIDC role (no static keys in CI).
set -euo pipefail

AWS_REGION="${AWS_REGION:-ap-south-1}"
REPO="${ECR_REPOSITORY:-server-info}"
GH_ORG="${GH_ORG:?set GH_ORG}"
GH_REPO="${GH_REPO:-server-info}"

# 1. Create ECR repo with scan-on-push + immutable tags.
aws ecr create-repository \
  --repository-name "$REPO" \
  --image-scanning-configuration scanOnPush=true \
  --image-tag-mutability IMMUTABLE \
  --region "$AWS_REGION" || echo "repo exists"

# 2. Lifecycle policy: expire untagged images after 7 days.
aws ecr put-lifecycle-policy --repository-name "$REPO" --region "$AWS_REGION" \
  --lifecycle-policy-text '{"rules":[{"rulePriority":1,"description":"expire untagged","selection":{"tagStatus":"untagged","countType":"sinceImagePushed","countUnit":"days","countNumber":7},"action":{"type":"expire"}}]}'

# 3. GitHub OIDC provider (idempotent).
aws iam create-open-id-connect-provider \
  --url https://token.actions.githubusercontent.com \
  --client-id-list sts.amazonaws.com \
  --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1 || echo "oidc provider exists"

echo "Now create an IAM role trusting repo:${GH_ORG}/${GH_REPO} (sub: repo:${GH_ORG}/${GH_REPO}:ref:refs/heads/main)"
echo "Attach AmazonEC2ContainerRegistryPowerUser (or a scoped ECR push policy). Set its ARN as the AWS_ROLE_ARN GitHub secret."
